/*!
 * 合成大西瓜 · 基础配置
 * 纯数据 + 纯函数，不依赖 DOM，可以直接在 node 下 require 做逻辑测试。
 * 想改水果顺序 / 半径 / 分值 / 难度 / 物理手感，只改这一个文件就够了。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuikaConfig = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '0.2.0';

  /* 画布与场地（逻辑像素，渲染时按 devicePixelRatio 放大） */
  var BOARD = {
    width: 480,
    height: 700,
    wall: 8, // 左右墙 / 地板的厚度
    spawnY: 72, // 待投放水果的中心高度
    dangerY: 145, // 危险线默认位置（随难度变化，见 DIFFICULTY）
    dropCooldownMs: 350, // 投放冷却默认值（随难度变化）
    fixedStep: 1000 / 60,
    stepsPerFrame: 5,
    aimPadding: 3
  };

  /* 物理参数：调手感主要动这里 */
  var PHYSICS = {
    gravity: 1,
    // 迭代次数越高，堆叠越不容易互相陷进去（实测 12 次时挤入墙里 <3px，8 次会有 10px）
    positionIterations: 12,
    velocityIterations: 12,
    /*
     * 关闭 Matter 的「沉睡」是必须的：水果在半空中互相卡住不动时会被判定为睡着，
     * 睡着之后引擎不再对它施加重力，它就会永远挂在那儿（草莓卡住不掉就是这个原因）。
     */
    enableSleeping: false,
    fruit: {
      restitution: 0.12,
      // 摩擦调小：圆水果之间应该互相打滑滚开，而不是像粘在一起
      friction: 0.1,
      frictionStatic: 0.16,
      frictionAir: 0.004,
      density: 0.0012,
      slop: 0.02
    },
    wall: { friction: 0.3, restitution: 0.05 }
  };

  /*
   * 11 级水果。
   * r     = 半径（像素，决定体积和外观大小）
   * score = 「合成出这一级」时获得的分数，越大的水果分数越高
   * 前 5 级会随机从天上掉下来，后面的只能靠合成得到。
   */
  var TIERS = [
    { tier: 1, key: 'cherry', name: '樱桃', emoji: '🍒', r: 20, score: 0, color: '#e8483f', edge: '#9e1f18' },
    { tier: 2, key: 'strawberry', name: '草莓', emoji: '🍓', r: 24, score: 1, color: '#f2536b', edge: '#ab2540' },
    { tier: 3, key: 'grape', name: '葡萄', emoji: '🍇', r: 29, score: 3, color: '#8e5ad6', edge: '#52298f' },
    { tier: 4, key: 'orange', name: '橘子', emoji: '🍊', r: 35, score: 6, color: '#f79331', edge: '#b25c0a' },
    { tier: 5, key: 'kiwi', name: '猕猴桃', emoji: '🥝', r: 42, score: 10, color: '#8bbf3f', edge: '#547f19' },
    { tier: 6, key: 'tomato', name: '番茄', emoji: '🍅', r: 50, score: 15, color: '#e8402f', edge: '#9c1d12' },
    { tier: 7, key: 'peach', name: '桃子', emoji: '🍑', r: 60, score: 21, color: '#f7a6a0', edge: '#c4635c' },
    { tier: 8, key: 'pineapple', name: '菠萝', emoji: '🍍', r: 72, score: 28, color: '#e8c53f', edge: '#9c7d0f' },
    { tier: 9, key: 'coconut', name: '椰子', emoji: '🥥', r: 87, score: 36, color: '#c69a6d', edge: '#7d5528' },
    { tier: 10, key: 'melon', name: '哈密瓜', emoji: '🍈', r: 104, score: 45, color: '#c9e07a', edge: '#839933' },
    { tier: 11, key: 'watermelon', name: '西瓜', emoji: '🍉', r: 125, score: 55, color: '#3fae5a', edge: '#1c6f32' }
  ];

  /* 规则 */
  var RULES = {
    maxTier: TIERS.length,
    maxDropTier: 5, // 只有前 5 级会随机掉落
    watermelonBonus: 100, // 两个西瓜相撞：双双消失，额外加 100 分
    dangerGraceMs: 2000, // 越过危险线并静止多久判定结束
    dangerWarnMs: 800, // 超过这个时间开始闪红警告
    dangerSpeedLimit: 1.25, // 速度低于此值才算「停下」，避免把下落中的水果算成越线
    /*
     * 连击加分：两次合成间隔不超过 windowMs 就算连击。
     * 倍率 = 1 + (连击数-1) * step，最高 maxMultiplier；
     * 实际加成取「倍率加成」和「每连击 +1 分」里更大的那个（保证小水果连击也有收益）。
     */
    combo: { windowMs: 1000, step: 0.3, maxMultiplier: 2.5 }
  };

  /* 难度：1~10 级，默认第 5 级（比原来的 4 级难一档） */
  var DEFAULT_DIFFICULTY = 5;

  var DIFFICULTY = [
    { level: 1, name: '悠闲', dangerY: 116, dropCooldownMs: 460, spawnWeights: [46, 28, 16, 8, 2] },
    { level: 2, name: '轻松', dangerY: 124, dropCooldownMs: 440, spawnWeights: [42, 27, 17, 10, 4] },
    { level: 3, name: '常规', dangerY: 132, dropCooldownMs: 410, spawnWeights: [38, 27, 18, 12, 5] },
    { level: 4, name: '进阶', dangerY: 138, dropCooldownMs: 380, spawnWeights: [32, 26, 20, 14, 8] },
    { level: 5, name: '熟练', dangerY: 146, dropCooldownMs: 350, spawnWeights: [29, 25, 20, 16, 10] },
    { level: 6, name: '挑战', dangerY: 154, dropCooldownMs: 330, spawnWeights: [26, 24, 20, 18, 12] },
    { level: 7, name: '困难', dangerY: 162, dropCooldownMs: 310, spawnWeights: [23, 23, 20, 19, 15] },
    { level: 8, name: '硬核', dangerY: 170, dropCooldownMs: 292, spawnWeights: [20, 22, 20, 20, 18] },
    { level: 9, name: '大师', dangerY: 178, dropCooldownMs: 275, spawnWeights: [17, 21, 20, 21, 21] },
    { level: 10, name: '地狱', dangerY: 186, dropCooldownMs: 258, spawnWeights: [14, 20, 20, 22, 24] }
  ];

  /*
   * 全球排行榜（做法 C：没有自己的服务器，把整张榜单当成一个 JSON 文档
   * 存在第三方免费 KV 上，全世界玩家的浏览器读写同一份）。
   *
   * provider：
   *   'textdb' —— 默认。第三方免费 KV，免注册、CORS 全开，静态页面（含 GitHub Pages）直接可用。
   *               整份文档由客户端「读-合并-写-确认」维护，谁都能改（没有服务端校验）。
   *   'rest'   —— 换成自己那台 Node 服务器（server.cjs 的 /api/scores），有服务端去重与排序。
   *   'local'  —— 不联网，只在本机记成绩。
   * 也可以在网址后面加 ?board=textdb|rest|local 临时切换（调试用）。
   */
  var BOARD_SYNC = {
    provider: 'textdb',
    refreshMs: 30 * 60 * 1000, // 总榜自动刷新周期：30 分钟
    liveThrottleMs: 20000, // 实时榜最短重复拉取间隔：20 秒
    maxPending: 50, // 待上传队列上限
    pushTries: 3, // 提交重试次数
    textdb: {
      // 这就是「这张榜的地址」：换一个 key 就是另一张榜（也方便你自建私有榜）
      endpoint: 'https://textdb.dev/api/data/suika-daxigua-board-9c4f21e7',
      timeoutMs: 12000,
      maxChars: 60000 // 文档超过这个体积就先裁实时榜
    },
    rest: {
      path: '/api/scores', // 同源相对地址（启动游戏.cmd / 启动共享榜.cmd）
      endpoint: '', // 写绝对地址就强制用某个服务器
      timeoutMs: 8000
    }
  };

  var STORAGE_KEYS = {
    assets: 'suika.assets.v1',
    leaderboard: 'suika.leaderboard.v1',
    board: 'suika.board.v1',
    pending: 'suika.pending.v1',
    best: 'suika.best.v1',
    prefs: 'suika.prefs.v1'
  };

  /* ---------- 纯函数工具 ---------- */

  function tierAt(index) {
    return TIERS[index] || null;
  }

  /** 1-based 取得水果定义 */
  function tierByNumber(n) {
    return TIERS[n - 1] || null;
  }

  function radiusOf(n) {
    var t = tierByNumber(n);
    return t ? t.r : 0;
  }

  /** 合成出第 n 级水果的基础得分；n = 0 表示两个西瓜相撞（双双消失） */
  function scoreOf(n) {
    if (n === 0) return RULES.watermelonBonus;
    var t = tierByNumber(n);
    return t ? t.score : 0;
  }

  function clampDifficulty(level) {
    var n = Math.round(Number(level));
    if (!isFinite(n)) return DEFAULT_DIFFICULTY;
    return Math.min(DIFFICULTY.length, Math.max(1, n));
  }

  function difficultyOf(level) {
    return DIFFICULTY[clampDifficulty(level) - 1];
  }

  /** 随机掉落的水果等级（在指定权重里抽，默认用默认难度的权重） */
  function pickSpawnTier(rand, weights) {
    var w = weights || difficultyOf(DEFAULT_DIFFICULTY).spawnWeights;
    var total = 0;
    var i;
    for (i = 0; i < w.length; i++) total += w[i];
    var r = (typeof rand === 'function' ? rand() : Math.random()) * total;
    var acc = 0;
    for (i = 0; i < w.length; i++) {
      acc += w[i];
      if (r < acc) return i + 1;
    }
    return 1;
  }

  /** 连击倍率 */
  function comboMultiplier(combo) {
    var c = Math.max(1, Math.floor(Number(combo) || 1));
    return Math.min(RULES.combo.maxMultiplier, 1 + (c - 1) * RULES.combo.step);
  }

  /** 连击加成后的实得分数 */
  function scoreWithCombo(baseScore, combo) {
    var base = Math.max(0, Math.round(Number(baseScore) || 0));
    var c = Math.max(1, Math.floor(Number(combo) || 1));
    if (c <= 1) return { base: base, multiplier: 1, bonus: 0, gained: base, combo: 1 };
    var m = comboMultiplier(c);
    var bonus = Math.max(c - 1, Math.round(base * (m - 1)));
    return { base: base, multiplier: m, bonus: bonus, gained: base + bonus, combo: c };
  }

  /** 每级水果的直径占场地宽度的比例，用来检查配置是否塞得下 */
  function widthRatio(n) {
    return (radiusOf(n) * 2) / (BOARD.width - BOARD.wall * 2);
  }

  function formatScore(n) {
    var v = Math.max(0, Math.floor(Number(n) || 0));
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 给贴图工坊用的建议文件名，例如 01-cherry.png */
  function suggestFileName(t) {
    return (t.tier < 10 ? '0' + t.tier : '' + t.tier) + '-' + t.key + '.png';
  }

  return {
    VERSION: VERSION,
    BOARD: BOARD,
    PHYSICS: PHYSICS,
    TIERS: TIERS,
    RULES: RULES,
    DIFFICULTY: DIFFICULTY,
    DEFAULT_DIFFICULTY: DEFAULT_DIFFICULTY,
    BOARD_SYNC: BOARD_SYNC,
    STORAGE_KEYS: STORAGE_KEYS,
    tierAt: tierAt,
    tierByNumber: tierByNumber,
    radiusOf: radiusOf,
    scoreOf: scoreOf,
    clampDifficulty: clampDifficulty,
    difficultyOf: difficultyOf,
    pickSpawnTier: pickSpawnTier,
    comboMultiplier: comboMultiplier,
    scoreWithCombo: scoreWithCombo,
    widthRatio: widthRatio,
    formatScore: formatScore,
    suggestFileName: suggestFileName
  };
});
