/*!
 * 合成大西瓜 · 逻辑测试（node --test）
 *
 *   cd "C:\Users\极光\Desktop\合成大西瓜"
 *   node --test tests
 *
 * 测的是真东西：物理合成、计分、判负、排行榜排序与「不写个人表」、贴图包解析。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');

const CFG = require(path.join(ROOT, 'js/config.js'));
const ASSETS = require(path.join(ROOT, 'js/assets.js'));
const ENGINE = require(path.join(ROOT, 'js/engine.js'));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function runSteps(game, ms, step = CFG.BOARD.fixedStep) {
  const n = Math.round(ms / step);
  for (let i = 0; i < n; i++) game.step(step);
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    _data: data
  };
}

/* ---------------- 配置与计分规则 ---------------- */

test('配置：11 级水果、半径递增、分值随体积递增', () => {
  assert.equal(CFG.TIERS.length, 11);
  assert.equal(CFG.RULES.maxTier, 11);
  for (let i = 1; i < CFG.TIERS.length; i++) {
    assert.ok(CFG.TIERS[i].r > CFG.TIERS[i - 1].r, `第 ${i + 1} 级半径应更大`);
    assert.ok(CFG.TIERS[i].score > CFG.TIERS[i - 1].score, `第 ${i + 1} 级分值应更高`);
  }
  assert.deepEqual(
    CFG.TIERS.map((t) => t.score),
    [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55]
  );
  assert.equal(CFG.scoreOf(11), 55);
  assert.equal(CFG.scoreOf(0), CFG.RULES.watermelonBonus);
  assert.ok(CFG.widthRatio(11) < 1, '最大的西瓜必须塞得进场地');
});

test('配置：随机掉落的只有前 5 级，且权重覆盖完整', () => {
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(CFG.pickSpawnTier());
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.equal(CFG.pickSpawnTier(() => 0), 1);
  assert.equal(CFG.pickSpawnTier(() => 0.999999), 5);
});

/* ---------------- 物理 + 合成 ---------------- */

test('两颗相同水果碰在一起会合成更大的水果，并按大小加分', () => {
  const game = ENGINE.create({});
  const merges = [];
  game.on('merge', (m) => merges.push(m));

  game.debugSpawn(1, 240, 600);
  game.debugSpawn(1, 240, 545);
  runSteps(game, 2500);

  assert.equal(merges.length, 1, '应该正好合成一次');
  assert.equal(merges[0].resultTier, 2);
  assert.equal(merges[0].gained, CFG.scoreOf(2));
  assert.equal(game.getState().score, 1);
  const fruits = game.fruits();
  assert.equal(fruits.length, 1);
  assert.equal(fruits[0].suikaTier, 2);
});

test('不同水果不会合成', () => {
  const game = ENGINE.create({});
  let merged = 0;
  game.on('merge', () => merged++);
  game.debugSpawn(1, 150, 600);
  game.debugSpawn(2, 150, 520);
  game.debugSpawn(3, 320, 600);
  runSteps(game, 2000);
  assert.equal(merged, 0);
  assert.equal(game.getState().score, 0);
  assert.equal(game.fruits().length, 3);
});

test('连锁合成会继续升级并累加分数，总分等于每次合成之和', () => {
  const game = ENGINE.create({});
  const gained = [];
  game.on('merge', (m) => gained.push(m.gained));
  game.debugSpawn(1, 240, 620);
  game.debugSpawn(1, 240, 570);
  game.debugSpawn(1, 240, 300);
  game.debugSpawn(1, 240, 250);
  runSteps(game, 4000);

  const st = game.getState();
  assert.ok(st.merges >= 3, `至少合成 3 次，实际 ${st.merges}`);
  assert.ok(st.maxTier >= 3, `最大水果至少到第 3 级，实际 ${st.maxTier}`);
  assert.equal(
    st.score,
    gained.reduce((a, b) => a + b, 0),
    '总分必须正好等于每次合成得分之和'
  );
  assert.ok(st.score >= st.merges, '每次合成至少 1 分');
  assert.ok(st.bestCombo >= 2, `连锁合成应该形成连击，实际最高连击 ${st.bestCombo}`);
});

/* ---------------- 连击加分 ---------------- */

test('连击规则：倍率封顶、小水果也有加成、永远不亏', () => {
  assert.equal(CFG.comboMultiplier(1), 1);
  assert.ok(Math.abs(CFG.comboMultiplier(2) - 1.3) < 1e-9);
  assert.equal(CFG.comboMultiplier(99), CFG.RULES.combo.maxMultiplier, '倍率要封顶');

  assert.deepEqual(
    [CFG.scoreWithCombo(1, 1).gained, CFG.scoreWithCombo(1, 2).gained, CFG.scoreWithCombo(1, 3).gained],
    [1, 2, 3],
    '基础分很小时按「每连击 +1」兜底'
  );
  assert.equal(CFG.scoreWithCombo(55, 2).gained, 55 + 17, '大水果按倍率加成（55×0.3=16.5→17）');
  assert.equal(CFG.scoreWithCombo(55, 6).multiplier, CFG.RULES.combo.maxMultiplier);
  assert.equal(CFG.scoreWithCombo(55, 6).gained, 55 + Math.round(55 * (CFG.RULES.combo.maxMultiplier - 1)));
  assert.equal(CFG.scoreWithCombo(100, 1).bonus, 0, '没有连击就没有加成');

  for (const base of CFG.TIERS.map((t) => t.score).concat([100])) {
    for (let c = 1; c <= 12; c++) {
      const r = CFG.scoreWithCombo(base, c);
      assert.ok(r.gained >= base, `连击不能让得分变少：base=${base} combo=${c}`);
      assert.equal(r.gained, r.base + r.bonus);
    }
  }
});

test('引擎连击：1 秒内连续合成会累计连击并加价，超时后归零', () => {
  const game = ENGINE.create({ gravity: 0 }); // 关掉重力，让两次合成发生在同一帧，结果确定
  const events = [];
  game.on('merge', (m) => events.push(m));
  let ended = null;
  game.on('combo-end', (info) => {
    ended = info;
  });

  game.debugSpawn(1, 140, 300);
  game.debugSpawn(1, 170, 300); // 左边一对
  game.debugSpawn(1, 340, 300);
  game.debugSpawn(1, 370, 300); // 右边一对
  runSteps(game, CFG.BOARD.fixedStep * 2);

  assert.equal(events.length, 2, '同一帧里应该发生两次合成');
  assert.equal(events[0].combo, 1);
  assert.equal(events[1].combo, 2, '第二次合成要算连击');
  assert.ok(events[1].bonus >= 1, '连击要有额外加成');
  assert.equal(game.getState().score, events[0].gained + events[1].gained);
  assert.equal(game.getState().bestCombo, 2);

  // 超过连击窗口没再合成 → 连击清零
  runSteps(game, CFG.RULES.combo.windowMs + 200);
  assert.equal(game.getState().combo, 0);
  assert.ok(ended, '连击结束要发事件，界面才知道把连击条收起来');
  assert.equal(ended.bestCombo, 2);
});

/* ---------------- 草莓粘连 / 悬空（用户反馈的 bug） ---------------- */

test('悬空的水果一定会掉下来，不会卡在半空（沉睡已关闭）', () => {
  const game = ENGINE.create({});
  assert.equal(game.engine.enableSleeping, false, 'Matter 的沉睡必须关闭，否则水果会在半空睡着不再下落');
  const body = game.debugSpawn(2, 240, 180); // 半空放一颗草莓
  runSteps(game, 2500);
  assert.ok(body.position.y > 400, `草莓应该落到下面，实际停在 y=${body.position.y.toFixed(1)}`);
  assert.ok(body.speed < 1, '最后应该已经落地停稳');
});

test('大量水果落地后：没有水果悬在半空不接触任何东西', () => {
  const game = ENGINE.create({});
  let rnd = 987654321;
  const rand = () => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return rnd / 2147483648;
  };
  for (let i = 0; i < 30; i++) {
    game.drop(1 + Math.floor(rand() * 5), CFG.BOARD.wall + 30 + rand() * (CFG.BOARD.width - 2 * CFG.BOARD.wall - 60));
    runSteps(game, 380);
  }
  runSteps(game, 2500);

  const fruits = game.fruits();
  const floorY = CFG.BOARD.height - CFG.BOARD.wall;
  const nearWall = (b) =>
    b.position.x - b.circleRadius <= CFG.BOARD.wall + 4 || b.position.x + b.circleRadius >= CFG.BOARD.width - CFG.BOARD.wall - 4;
  assert.ok(fruits.length > 0);
  for (const b of fruits) {
    const onFloor = b.position.y + b.circleRadius >= floorY - 4;
    const touching = fruits.some(
      (o) => o !== b && Math.hypot(o.position.x - b.position.x, o.position.y - b.position.y) <= b.circleRadius + o.circleRadius + 4
    );
    assert.ok(
      onFloor || nearWall(b) || touching,
      `第 ${b.suikaTier} 级水果悬空了：x=${b.position.x.toFixed(1)} y=${b.position.y.toFixed(1)}`
    );
  }
});

/* ---------------- 难度 ---------------- */

test('难度：10 级、参数逐级变难、默认第 5 级', () => {
  assert.equal(CFG.DIFFICULTY.length, 10);
  assert.equal(CFG.DEFAULT_DIFFICULTY, 5);
  for (let i = 1; i < CFG.DIFFICULTY.length; i++) {
    const easy = CFG.DIFFICULTY[i - 1];
    const hard = CFG.DIFFICULTY[i];
    assert.ok(hard.dangerY > easy.dangerY, `Lv.${hard.level} 的危险线应该更低（可用高度更小）`);
    assert.ok(hard.dropCooldownMs < easy.dropCooldownMs, `Lv.${hard.level} 的投放间隔应该更短`);
    assert.ok(hard.spawnWeights[4] >= easy.spawnWeights[4], `Lv.${hard.level} 掉大水果的概率不该更低`);
    assert.ok(hard.spawnWeights[0] <= easy.spawnWeights[0], `Lv.${hard.level} 掉最小水果的概率不该更高`);
    assert.equal(hard.spawnWeights.reduce((a, b) => a + b, 0), 100, '权重总和必须正好 100');
    assert.equal(hard.spawnWeights.length, 5);
  }
  assert.equal(CFG.clampDifficulty(99), 10);
  assert.equal(CFG.clampDifficulty(-3), 1);
  assert.equal(CFG.clampDifficulty('abc'), CFG.DEFAULT_DIFFICULTY);
  assert.equal(CFG.difficultyOf(5).name, '熟练');
});

test('难度：越高越容易掉大水果，引擎采用该等级的危险线', () => {
  const easy = CFG.difficultyOf(1);
  const hard = CFG.difficultyOf(10);
  const spread = (weights) => {
    const seen = [0, 0, 0, 0, 0];
    let rnd = 42;
    const rand = () => {
      rnd = (rnd * 1103515245 + 12345) % 2147483648;
      return rnd / 2147483648;
    };
    for (let i = 0; i < 3000; i++) seen[CFG.pickSpawnTier(rand, weights) - 1]++;
    return seen;
  };
  const e = spread(easy.spawnWeights);
  const h = spread(hard.spawnWeights);
  assert.ok(e[0] > h[0], '低难度应该掉更多小水果');
  assert.ok(h[4] > e[4], '高难度应该掉更多大水果');

  const game = ENGINE.create({ difficulty: 10 });
  assert.equal(game.getDifficulty(), 10);
  assert.equal(game.getState().dangerY, hard.dangerY);
  assert.equal(game.getState().difficulty, 10);
  game.setDifficulty(1);
  assert.equal(game.getState().dangerY, easy.dangerY);
  assert.equal(game.pickTier(() => 0), 1, '抽到权重区间最前面就是第 1 级');
});

test('难度影响判负：同一高度在 Lv.10 会结束，在 Lv.1 不会', () => {
  const mk = (level) => {
    const game = ENGINE.create({ gravity: 0, difficulty: level });
    let over = null;
    game.on('gameover', (s) => {
      over = s;
    });
    game.debugSpawn(5, 240, 176); // 顶边 y=134
    runSteps(game, CFG.RULES.dangerGraceMs + 400);
    return { over, game };
  };
  const hard = mk(10);
  assert.ok(hard.over, 'Lv.10（危险线更低）应该判负');
  assert.equal(hard.over.difficulty, 10);
  const easy = mk(1);
  assert.equal(easy.over, null, 'Lv.1（危险线更高）不该判负');
});

test('两个西瓜相撞：双双消失并加奖励分', () => {
  const game = ENGINE.create({});
  const merges = [];
  game.on('merge', (m) => merges.push(m));
  game.debugSpawn(11, 200, 560);
  game.debugSpawn(11, 260, 300);
  runSteps(game, 3500);

  assert.equal(game.fruits().length, 0, '西瓜应该都消失了');
  assert.equal(game.getState().score, CFG.RULES.watermelonBonus);
  assert.equal(merges.length, 1);
  assert.equal(merges[0].resultTier, 0);
});

test('40 颗水果乱丢：位置不炸、不出界、落地后不抖', () => {
  const game = ENGINE.create({});
  let rnd = 123456789;
  const rand = () => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return rnd / 2147483648;
  };
  for (let i = 0; i < 40; i++) {
    game.drop(1 + Math.floor(rand() * 5), CFG.BOARD.wall + 30 + rand() * (CFG.BOARD.width - 2 * CFG.BOARD.wall - 60));
    runSteps(game, 400);
  }
  runSteps(game, 3000);

  const fruits = game.fruits();
  assert.ok(fruits.length > 0);
  for (const b of fruits) {
    assert.ok(Number.isFinite(b.position.x) && Number.isFinite(b.position.y), '坐标不能是 NaN');
    assert.ok(Number.isFinite(b.velocity.x) && Number.isFinite(b.velocity.y), '速度不能是 NaN');
    assert.ok(b.position.x >= CFG.BOARD.wall - 2 && b.position.x <= CFG.BOARD.width - CFG.BOARD.wall + 2, '不能穿墙');
    assert.ok(b.position.y <= CFG.BOARD.height + 2, '不能掉出地板');
    assert.ok(b.position.y - b.circleRadius < CFG.BOARD.height, '不能沉进地板');
  }

  const speeds = fruits.map((b) => b.speed);
  const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  assert.ok(avg < 0.35, `落地后应该基本静止，平均速度 ${avg.toFixed(3)}`);
  assert.equal(game.getState().corrections, 0, '不应该出现被挤穿墙的水果（墙加厚后安全带不该被触发）');
});

/* ---------------- 判负 ---------------- */

test('水果停在危险线以上超过 2 秒 → 本局结束', () => {
  const game = ENGINE.create({ gravity: 0 }); // 关掉重力，确定性地把它挂在线上方
  let over = null;
  game.on('gameover', (s) => {
    over = s;
  });
  game.debugSpawn(5, 240, CFG.BOARD.dangerY - 20);
  runSteps(game, CFG.RULES.dangerGraceMs - 300);
  assert.equal(over, null, '还没到 2 秒不应该结束');
  assert.ok(game.getState().dangerRatio > 0.5, '危险进度应该已经在涨');
  runSteps(game, 600);
  assert.ok(over, '超过 2 秒应该结束本局');
  assert.equal(over.reason, 'danger-line');
});

test('高速下落的漏过危险线不会误判结束', () => {
  const game = ENGINE.create({});
  let over = null;
  game.on('gameover', (s) => {
    over = s;
  });
  for (let i = 0; i < 6; i++) {
    game.drop(1, 100 + i * 40);
    runSteps(game, 2500);
  }
  assert.equal(over, null);
  assert.equal(game.getState().gameOver, false);
});

/* ---------------- 排行榜 ---------------- */

/*
 * 本机排行榜已经并进 js/boards.js（榜单文档）和 js/sync.js（同步/缓存/队列）：
 * 现在只有一份榜单实现，测试都在 tests/boards.test.mjs 和 tests/sync.test.mjs 里。
 */

/* ---------------- 贴图包 ---------------- */

test('贴图包：文件名能自动对应到水果等级', () => {
  assert.equal(ASSETS.matchTier('01-cherry.png'), 1);
  assert.equal(ASSETS.matchTier('2.png'), 2);
  assert.equal(ASSETS.matchTier('03.webp'), 3);
  assert.equal(ASSETS.matchTier('strawberry.jpg'), 2);
  assert.equal(ASSETS.matchTier('葡萄.webp'), 3);
  assert.equal(ASSETS.matchTier('watermelon.png'), 11);
  assert.equal(ASSETS.matchTier('不知道是什么.png'), 0);
  assert.equal(ASSETS.matchTier('12.png'), 0, '超出 11 级不算');
});

test('贴图包：解析导出格式 / 键值格式 / 数组格式，并挡掉非法数据', () => {
  const exported = {
    app: 'suika-game',
    slots: [
      { tier: 1, key: 'cherry', name: '樱桃', dataUrl: PNG, file: '01-cherry.png' },
      { tier: 11, key: 'watermelon', name: '西瓜', dataUrl: PNG }
    ]
  };
  const a = ASSETS.normalizePack(exported);
  assert.equal(a.ok, true);
  assert.equal(a.count, 2);
  assert.equal(a.slots[1].file, '01-cherry.png');
  assert.equal(a.slots[11].mime, 'image/png');

  const b = ASSETS.normalizePack({ slots: { 3: PNG, grape: PNG } });
  assert.equal(b.count, 1, '两种写法指向同一级，只保留一个');

  const c = ASSETS.normalizePack([{ tier: 5, dataUrl: PNG }, { tier: 99, dataUrl: PNG }, { tier: 6, dataUrl: 'http://x/a.png' }]);
  assert.equal(c.count, 1);
  assert.equal(c.rejected, 2);

  const d = ASSETS.normalizePack('{不是 json');
  assert.equal(d.ok, false);
  assert.equal(ASSETS.normalizePack({ slots: [] }).ok, false);
  assert.equal(ASSETS.normalizePack(JSON.stringify(exported)).count, 2, '也应支持 JSON 文本');
});

test('贴图包：指纹稳定，能用来确认「就是这一版」', () => {
  const slotsA = { 1: { dataUrl: PNG }, 2: { dataUrl: PNG + 'AAA' } };
  const slotsB = { 2: { dataUrl: PNG + 'AAA' }, 1: { dataUrl: PNG } };
  assert.equal(ASSETS.fingerprint(slotsA), ASSETS.fingerprint(slotsB), '顺序不同指纹应一致');
  assert.match(ASSETS.fingerprint(slotsA), /^[0-9a-f]{16}$/);
  assert.notEqual(ASSETS.fingerprint(slotsA), ASSETS.fingerprint({ 1: { dataUrl: PNG } }));
  assert.equal(ASSETS.fingerprint({}), '--------');
});

test('贴图包：字节数算得对（用来提示存储占用）', () => {
  assert.equal(ASSETS.byteLength('data:image/png;base64,AAAA'), 3);
  assert.ok(ASSETS.byteLength(PNG) > 0);
  assert.equal(ASSETS.byteLength(''), 0);
});
