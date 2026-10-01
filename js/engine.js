/*!
 * 合成大西瓜 · 游戏核心（物理 + 合成 + 计分 + 判负）
 *
 * 这个文件完全不碰 DOM，只维护 Matter.js 世界和游戏状态，
 * 所以可以直接在 node 里跑模拟测试（见 tests/logic.test.mjs）。
 * 渲染、输入、界面都在 render.js / ui.js / game.js 里。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SuikaEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function tryRequire(path) {
    if (typeof require !== 'function') return null;
    try {
      return require(path);
    } catch (e) {
      return null;
    }
  }

  var Matter = root.Matter || tryRequire('../vendor/matter.min.js');
  var CFG = root.SuikaConfig || tryRequire('./config.js');

  function create(options) {
    options = options || {};
    if (!Matter || !CFG) throw new Error('SuikaEngine: 缺少 Matter.js 或 config.js');

    var Engine = Matter.Engine;
    var Composite = Matter.Composite;
    var Bodies = Matter.Bodies;
    var Body = Matter.Body;
    var Events = Matter.Events;

    var BOARD = CFG.BOARD;
    var PH = CFG.PHYSICS;
    var RULES = CFG.RULES;
    var W = BOARD.width;
    var H = BOARD.height;
    var WT = BOARD.wall;
    var innerLeft = WT;
    var innerRight = W - WT;
    var floorY = H - WT;

    var difficulty = CFG.clampDifficulty(options.difficulty != null ? options.difficulty : CFG.DEFAULT_DIFFICULTY);
    var engine = Engine.create({
      // 默认不开沉睡：见 config.js 里的说明（沉睡会让半空卡住的水果永远不掉）
      enableSleeping: options.enableSleeping != null ? options.enableSleeping : PH.enableSleeping
    });
    engine.gravity.y = options.gravity != null ? options.gravity : PH.gravity;
    engine.positionIterations = PH.positionIterations;
    engine.velocityIterations = PH.velocityIterations;
    var world = engine.world;

    var handlers = {};
    var pendingMerges = [];
    var accumulator = 0;

    var state = {
      score: 0,
      merges: 0,
      maxTier: 1,
      drops: 0,
      dangerMs: 0,
      dangerRatio: 0,
      warned: false,
      gameOver: false,
      overReason: null,
      elapsedMs: 0,
      corrections: 0,
      difficulty: difficulty,
      dangerY: CFG.difficultyOf(difficulty).dangerY,
      combo: 0,
      comboRatio: 0,
      bestCombo: 0,
      lastMergeMs: -1e9,
      tierCounts: {}
    };

    var staticOpts = {
      isStatic: true,
      friction: PH.wall.friction,
      restitution: PH.wall.restitution,
      label: 'wall'
    };
    // 墙做得比画面厚很多：Matter 没有连续碰撞检测，薄墙会被高速水果穿过去
    var BULK = 90;
    var walls = [
      Bodies.rectangle(W / 2, floorY + BULK / 2, W + BULK * 2, BULK, staticOpts),
      Bodies.rectangle(innerLeft - BULK / 2, H / 2, BULK, H + BULK * 2, staticOpts),
      Bodies.rectangle(innerRight + BULK / 2, H / 2, BULK, H + BULK * 2, staticOpts)
    ];
    Composite.add(world, walls);

    /* ---------------- 事件 ---------------- */

    function on(name, fn) {
      (handlers[name] || (handlers[name] = [])).push(fn);
      return function () {
        off(name, fn);
      };
    }

    function off(name, fn) {
      var list = handlers[name];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }

    function emit(name, payload) {
      var list = handlers[name];
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        try {
          list[i](payload);
        } catch (e) {
          // 事件处理函数里的异常不要静默吞掉：既打到 console，也交给页面上的错误横幅
          if (root.console && console.error) console.error('[suika] handler error', name, e);
          if (typeof root.SUIKA_ON_ERROR === 'function') {
            try {
              root.SUIKA_ON_ERROR(e, name);
            } catch (ignored) {
              /* noop */
            }
          }
        }
      }
    }

    /* ---------------- 水果 ---------------- */

    function spawnBody(tierNum, x, y) {
      var def = CFG.tierByNumber(tierNum);
      if (!def) return null;
      var r = def.r;
      var lo = innerLeft + r + 0.5;
      var hi = innerRight - r - 0.5;
      if (hi <= lo) x = W / 2;
      else x = Math.min(hi, Math.max(lo, x));

      var body = Bodies.circle(x, y, r, {
        label: 'fruit',
        restitution: PH.fruit.restitution,
        friction: PH.fruit.friction,
        frictionStatic: PH.fruit.frictionStatic,
        frictionAir: PH.fruit.frictionAir,
        density: PH.fruit.density,
        slop: PH.fruit.slop,
        sleepThreshold: 60
      });
      body.suikaTier = tierNum;
      body.suikaAboveMs = 0;
      body.suikaDead = false;
      body.suikaRemoved = false;
      body.suikaBornMs = state.elapsedMs;
      Composite.add(world, body);
      return body;
    }

    /** 当前场上还活着的水果（排除正在合并中的两颗） */
    function fruits() {
      var all = Composite.allBodies(world);
      var out = [];
      for (var i = 0; i < all.length; i++) {
        var b = all[i];
        if (b.suikaTier == null || b.suikaRemoved) continue;
        out.push(b);
      }
      return out;
    }

    function aliveFruits() {
      var all = Composite.allBodies(world);
      var out = [];
      for (var i = 0; i < all.length; i++) {
        var b = all[i];
        if (b.suikaTier == null || b.suikaRemoved || b.suikaDead) continue;
        out.push(b);
      }
      return out;
    }

    function drop(tierNum, x) {
      if (state.gameOver) return null;
      var body = spawnBody(tierNum, x, BOARD.spawnY);
      if (body) {
        state.drops += 1;
        emit('drop', { tier: tierNum, x: body.position.x, score: state.score });
      }
      return body;
    }

    /* ---------------- 合成 ---------------- */

    Events.on(engine, 'collisionStart', function (evt) {
      var pairs = evt.pairs;
      for (var i = 0; i < pairs.length; i++) {
        var a = pairs[i].bodyA;
        var b = pairs[i].bodyB;
        if (a.suikaTier == null || b.suikaTier == null) continue;
        if (a.suikaDead || b.suikaDead || a.suikaRemoved || b.suikaRemoved) continue;
        if (a.suikaTier !== b.suikaTier) continue;
        // 先打标记，避免同一帧里被重复配对；真正的增删留到 update 结束后做
        a.suikaDead = true;
        b.suikaDead = true;
        pendingMerges.push({ a: a, b: b });
      }
    });

    function flushMerges() {
      if (!pendingMerges.length) return;
      var queue = pendingMerges;
      pendingMerges = [];
      for (var i = 0; i < queue.length; i++) {
        var a = queue[i].a;
        var b = queue[i].b;
        if (a.suikaRemoved || b.suikaRemoved) continue;
        var tier = a.suikaTier;
        var mx = (a.position.x + b.position.x) / 2;
        var my = (a.position.y + b.position.y) / 2;
        var vx = (a.velocity.x + b.velocity.x) * 0.5;
        var vy = (a.velocity.y + b.velocity.y) * 0.5;

        a.suikaRemoved = true;
        b.suikaRemoved = true;
        Composite.remove(world, a, true);
        Composite.remove(world, b, true);

        var base;
        var resultTier;
        var created = null;
        if (tier >= RULES.maxTier) {
          // 两个西瓜相撞：双双消失 + 奖励分
          resultTier = 0;
          base = CFG.scoreOf(0);
        } else {
          resultTier = tier + 1;
          created = spawnBody(resultTier, mx, my);
          if (created) Body.setVelocity(created, { x: vx * 0.6, y: vy * 0.6 - 0.4 });
          base = CFG.scoreOf(resultTier);
          state.tierCounts[resultTier] = (state.tierCounts[resultTier] || 0) + 1;
          if (resultTier > state.maxTier) state.maxTier = resultTier;
        }

        // 连击：距离上次合成不超过 combo.windowMs 就累计，否则从 1 重新开始
        var gap = state.elapsedMs - state.lastMergeMs;
        state.combo = gap <= RULES.combo.windowMs ? state.combo + 1 : 1;
        state.lastMergeMs = state.elapsedMs;
        state.comboRatio = 1;
        if (state.combo > state.bestCombo) state.bestCombo = state.combo;
        var comboScore = CFG.scoreWithCombo(base, state.combo);

        state.score += comboScore.gained;
        state.merges += 1;
        emit('merge', {
          fromTier: tier,
          resultTier: resultTier,
          baseGained: base,
          bonus: comboScore.bonus,
          multiplier: comboScore.multiplier,
          combo: state.combo,
          gained: comboScore.gained,
          x: mx,
          y: my,
          score: state.score,
          merges: state.merges,
          maxTier: state.maxTier,
          body: created
        });
      }
    }

    /* ---------------- 兜底：万一还是被挤穿 ---------------- */

    /**
     * 正常情况下不会触发（墙已经加厚），留着当安全带：
     * 只有水果整颗被挤出场地（或掉到地板下面很深）时才拉回来，
     * 阈值放得很宽 —— 堆叠时水果陷进墙里几像素是正常的，不能每帧去硬掰它。
     */
    function containFruits() {
      var list = fruits();
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var r = b.circleRadius;
        var x = b.position.x;
        var y = b.position.y;
        var nx = x;
        var ny = y;
        if (x + r < innerLeft) nx = innerLeft + r + 1;
        else if (x - r > innerRight) nx = innerRight - r - 1;
        if (y - r > floorY + 40) ny = floorY - r - 1;
        else if (y + r < -240) ny = r + 1;
        if (nx !== x || ny !== y) {
          Body.setPosition(b, { x: nx, y: ny });
          Body.setVelocity(b, { x: b.velocity.x * 0.3, y: Math.min(0, b.velocity.y) });
          state.corrections += 1;
        }
      }
    }

    /* ---------------- 连击计时 ---------------- */

    function updateCombo() {
      if (state.combo <= 0) {
        state.comboRatio = 0;
        return;
      }
      var left = RULES.combo.windowMs - (state.elapsedMs - state.lastMergeMs);
      if (left <= 0) {
        state.combo = 0;
        state.comboRatio = 0;
        emit('combo-end', { bestCombo: state.bestCombo });
      } else {
        state.comboRatio = left / RULES.combo.windowMs;
      }
    }

    /* ---------------- 判负 ---------------- */

    function updateDanger(dt) {
      var list = fruits();
      var worst = 0;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var top = b.position.y - b.circleRadius;
        var slow = b.speed < RULES.dangerSpeedLimit;
        if (top < state.dangerY && slow && !b.suikaDead) {
          b.suikaAboveMs = (b.suikaAboveMs || 0) + dt;
        } else {
          b.suikaAboveMs = 0;
        }
        if (b.suikaAboveMs > worst) worst = b.suikaAboveMs;
      }
      state.dangerMs = worst;
      state.dangerRatio = Math.min(1, worst / RULES.dangerGraceMs);

      var warn = worst >= RULES.dangerWarnMs;
      if (warn !== state.warned) {
        state.warned = warn;
        emit(warn ? 'warn' : 'warn-clear', { dangerMs: worst, ratio: state.dangerRatio });
      }
      if (worst >= RULES.dangerGraceMs) endGame('danger-line');
    }

    function endGame(reason) {
      if (state.gameOver) return;
      state.gameOver = true;
      state.overReason = reason || 'danger-line';
      state.dangerMs = RULES.dangerGraceMs;
      state.dangerRatio = 1;
      emit('gameover', summary());
    }

    function summary() {
      return {
        score: state.score,
        merges: state.merges,
        maxTier: state.maxTier,
        drops: state.drops,
        durationMs: state.elapsedMs,
        reason: state.overReason,
        difficulty: state.difficulty,
        bestCombo: state.bestCombo,
        tierCounts: Object.assign({}, state.tierCounts)
      };
    }

    /* ---------------- 难度 ---------------- */

    function setDifficulty(level) {
      difficulty = CFG.clampDifficulty(level);
      var def = CFG.difficultyOf(difficulty);
      state.difficulty = difficulty;
      state.dangerY = def.dangerY;
      emit('difficulty', { level: difficulty, config: def });
      return difficulty;
    }

    /** 按当前难度抽一颗随机掉落的水果 */
    function pickTier(rand) {
      return CFG.pickSpawnTier(rand, CFG.difficultyOf(difficulty).spawnWeights);
    }

    /* ---------------- 主循环 ---------------- */

    function step(dtMs) {
      if (state.gameOver) return;
      var dt = Number(dtMs);
      if (!isFinite(dt) || dt <= 0) dt = BOARD.fixedStep;
      dt = Math.min(dt, 50);
      state.elapsedMs += dt;

      accumulator += dt;
      var steps = 0;
      while (accumulator >= BOARD.fixedStep && steps < BOARD.stepsPerFrame) {
        Engine.update(engine, BOARD.fixedStep);
        flushMerges();
        accumulator -= BOARD.fixedStep;
        steps += 1;
      }
      if (steps >= BOARD.stepsPerFrame) accumulator = 0;
      containFruits();
      updateCombo();
      updateDanger(dt);
    }

    function reset() {
      for (var i = 0; i < walls.length; i++) Composite.remove(world, walls[i], true);
      Composite.clear(world, false, true);
      pendingMerges = [];
      accumulator = 0;
      for (var j = 0; j < walls.length; j++) Composite.add(world, walls[j]);
      state = {
        score: 0,
        merges: 0,
        maxTier: 1,
        drops: 0,
        dangerMs: 0,
        dangerRatio: 0,
        warned: false,
        gameOver: false,
        overReason: null,
        elapsedMs: 0,
        corrections: 0,
        // 难度是一局开始时定下的，重开一局不改变难度
        difficulty: difficulty,
        dangerY: CFG.difficultyOf(difficulty).dangerY,
        combo: 0,
        comboRatio: 0,
        bestCombo: 0,
        lastMergeMs: -1e9,
        tierCounts: {}
      };
      emit('reset', {});
    }

    return {
      Matter: Matter,
      world: world,
      engine: engine,
      board: BOARD,
      drop: drop,
      step: step,
      reset: reset,
      fruits: fruits,
      aliveFruits: aliveFruits,
      getState: function () {
        return Object.assign({}, state, { gameOver: state.gameOver });
      },
      summary: summary,
      endGame: endGame,
      pickTier: pickTier,
      setDifficulty: setDifficulty,
      getDifficulty: function () {
        return difficulty;
      },
      on: on,
      off: off,
      debugSpawn: function (tierNum, x, y) {
        return spawnBody(tierNum, x, y == null ? BOARD.spawnY : y);
      }
    };
  }

  return { create: create };
});
