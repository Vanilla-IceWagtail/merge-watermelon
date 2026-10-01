/*!
 * 合成大西瓜 · 水果贴图包
 *
 * 需求（第 2 条）：先用 emoji 默认外观跑通，水果图片由你在「贴图工坊」里导入；
 * 你导出贴图包（.json）发给我 → 我把它内嵌进 js/assets-builtin.js 并 locked: true
 * → 之后游戏固定使用内嵌图片，界面上的导入功能自动关闭，图片就不可再改了。
 *
 * 优先级：内嵌贴图（已锁定） > 本机导入的贴图 > 默认 emoji 外观
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SuikaAssets = factory(root);
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

  var CFG = root.SuikaConfig || tryRequire('./config.js');

  var MAX_EDGE_CAP = 384; // 单张贴图最长边上限（够大又省空间）
  var WEBP_QUALITY = 0.92;

  /* ---------------- 纯函数（可在 node 下测试） ---------------- */

  function isDataImage(s) {
    return typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif|avif|bmp);base64,/i.test(s);
  }

  function mimeOf(dataUrl) {
    var m = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(dataUrl || '');
    return m ? m[1].toLowerCase() : '';
  }

  /** base64 数据的真实字节数（用于显示占用空间） */
  function byteLength(dataUrl) {
    if (typeof dataUrl !== 'string') return 0;
    var i = dataUrl.indexOf(',');
    if (i < 0) return dataUrl.length;
    var b64 = dataUrl.slice(i + 1);
    var pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
  }

  /**
   * 根据文件名猜是哪一级水果，支持：
   *   01-cherry.png / 2.png / 03.png / strawberry.webp / 草莓.png / 葡萄.jpg
   * 返回 1..11，识别不出返回 0。
   */
  function matchTier(fileName, tiers) {
    var list = tiers || (CFG ? CFG.TIERS : []);
    var name = String(fileName || '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .trim();
    if (!name) return 0;
    var i;
    // 去掉开头的序号：01-cherry → cherry
    var stripped = name.replace(/^\d+[\s._-]*/, '');
    // 1) 先看整体是否能对上英文 key / 中文名，避免 watermelon 被 melon 抢走
    for (i = 0; i < list.length; i++) {
      var t = list[i];
      if (stripped === String(t.key).toLowerCase() || stripped === String(t.name).toLowerCase()) return t.tier;
    }
    // 2) 再看包含关系，长的 key 优先（watermelon 先于 melon）
    var byLength = list.slice().sort(function (a, b) {
      return String(b.key).length - String(a.key).length;
    });
    for (i = 0; i < byLength.length; i++) {
      var s = byLength[i];
      if (name.indexOf(String(s.key)) >= 0 || name.indexOf(String(s.name)) >= 0) return s.tier;
    }
    // 3) 最后才认开头的数字
    var m = /(?:^|\D)(\d{1,2})(?:\D|$)/.exec(name);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n >= 1 && n <= list.length) return n;
    }
    return 0;
  }

  /** 把各种形态的贴图包统一成 { tier: {dataUrl, file, mime, bytes} } */
  function normalizePack(raw, tiers) {
    var list = tiers || (CFG ? CFG.TIERS : []);
    var out = {};
    var count = 0;
    var rejected = 0;
    var data = raw;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return { ok: false, slots: {}, count: 0, rejected: 0, error: 'JSON 解析失败' };
      }
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, slots: {}, count: 0, rejected: 0, error: '贴图包内容不是对象' };
    }

    function put(tier, entry) {
      var n = Math.floor(Number(tier));
      if (!(n >= 1 && n <= list.length)) {
        rejected++;
        return;
      }
      var dataUrl = typeof entry === 'string' ? entry : entry && (entry.dataUrl || entry.url || entry.data);
      if (!isDataImage(dataUrl)) {
        rejected++;
        return;
      }
      if (!(n in out)) count++;
      out[n] = {
        dataUrl: dataUrl,
        file: (entry && entry.file) || (entry && entry.fileName) || '',
        mime: mimeOf(dataUrl),
        bytes: byteLength(dataUrl)
      };
    }

    var i;
    var slots = data.slots || data.images || data.fruits || data;
    if (Array.isArray(slots)) {
      for (i = 0; i < slots.length; i++) {
        var it = slots[i];
        if (!it || typeof it !== 'object') continue;
        var tier = it.tier != null ? it.tier : it.index != null ? Number(it.index) + 1 : matchTier(it.key || it.name || it.file, list);
        put(tier, it);
      }
    } else if (slots && typeof slots === 'object') {
      var keys = Object.keys(slots);
      for (i = 0; i < keys.length; i++) {
        var k = keys[i];
        var val = slots[k];
        var tierNum = /^\d+$/.test(k) ? Number(k) : matchTier(k, list);
        put(tierNum, val);
      }
    }
    if (!count) {
      return { ok: false, slots: {}, count: 0, rejected: rejected, error: '没找到合法的图片数据（需要 data:image/... base64）' };
    }
    return { ok: true, slots: out, count: count, rejected: rejected, error: null };
  }

  /** 贴图包指纹：同样的图片得到同样的 16 位指纹，用来确认「是不是我提交的那一版」 */
  function fingerprint(slots) {
    var str = '';
    var keys = Object.keys(slots || {})
      .map(Number)
      .filter(function (n) {
        return n >= 1;
      })
      .sort(function (a, b) {
        return a - b;
      });
    for (var i = 0; i < keys.length; i++) {
      var s = slots[keys[i]];
      var d = typeof s === 'string' ? s : s && s.dataUrl;
      if (!d) continue;
      str += keys[i] + '|' + d + '\n';
    }
    if (!str) return '--------';
    function fnv(text, seed) {
      var h = seed >>> 0;
      for (var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return ('00000000' + h.toString(16)).slice(-8);
    }
    return fnv(str, 2166136261) + fnv(str, 16777619);
  }

  /* ---------------- 运行时 ---------------- */

  function create(opts) {
    opts = opts || {};
    var storage = opts.storage || null;
    var key = opts.key || (CFG ? CFG.STORAGE_KEYS.assets : 'suika.assets.v1');
    var tiers = (CFG ? CFG.TIERS : []).slice();

    var builtinRaw = root.SUIKA_BUILTIN_ASSETS || opts.builtin || null;
    var builtin = normalizePack(builtinRaw && builtinRaw.slots ? { slots: builtinRaw.slots } : builtinRaw || {});
    var builtinLocked = !!(builtinRaw && builtinRaw.locked) || opts.forceLock === true;
    var builtinInfo = builtinRaw && builtinRaw.integratedAt ? builtinRaw : null;

    var custom = {};
    var customLocked = false;
    var images = {}; // tier -> HTMLImageElement
    var listeners = [];

    function readCustom() {
      try {
        var raw = storage && storage.getItem(key);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        var res = normalizePack(parsed, tiers);
        if (res.ok) {
          custom = res.slots;
          customLocked = !!parsed.locked;
        }
      } catch (e) {
        /* 忽略损坏的本地数据 */
      }
    }

    function saveCustom() {
      try {
        if (!storage) return { ok: true };
        if (!Object.keys(custom).length) {
          storage.removeItem(key);
          return { ok: true };
        }
        storage.setItem(key, JSON.stringify({ version: 1, locked: customLocked, slots: custom }));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: /quota|exceed/i.test(String(e && e.name) + String(e && e.message)) ? 'quota' : 'storage' };
      }
    }

    /** 当前实际生效的贴图来源 */
    function sourceOf(tier) {
      if (builtin.slots[tier]) return 'builtin';
      if (custom[tier]) return 'custom';
      return 'default';
    }

    function urlOf(tier) {
      var s = builtin.slots[tier] || custom[tier];
      return s ? s.dataUrl : null;
    }

    function imageOf(tier) {
      var url = urlOf(tier);
      if (!url) return null;
      var img = images[tier];
      if (img && img.__url === url && img.complete && img.naturalWidth) return img;
      return null;
    }

    function preload(tier) {
      var url = urlOf(tier);
      if (!url) {
        delete images[tier];
        return Promise.resolve(null);
      }
      var existing = images[tier];
      if (existing && existing.__url === url && existing.complete && existing.naturalWidth) return Promise.resolve(existing);
      return new Promise(function (resolve) {
        var img = new Image();
        img.__url = url;
        img.onload = function () {
          images[tier] = img;
          resolve(img);
        };
        img.onerror = function () {
          resolve(null);
        };
        img.src = url;
      });
    }

    function preloadAll() {
      return Promise.all(tiers.map(function (t) {
        return preload(t.tier);
      }));
    }

    function notify() {
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i](info());
        } catch (e) {
          /* noop */
        }
      }
    }

    function onChange(fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }

    function totalBytes() {
      var n = 0;
      var src = Object.keys(builtin.slots).length ? builtin.slots : custom;
      Object.keys(src).forEach(function (k) {
        n += src[k].bytes || 0;
      });
      return n;
    }

    function info() {
      var active = Object.keys(builtin.slots).length ? builtin.slots : custom;
      var filled = Object.keys(active).length;
      return {
        mode: builtinLocked ? 'builtin' : Object.keys(builtin.slots).length ? 'builtin' : filled ? 'custom' : 'default',
        locked: builtinLocked,
        customLocked: customLocked,
        customCount: Object.keys(custom).length,
        builtinCount: Object.keys(builtin.slots).length,
        filled: filled,
        bytes: totalBytes(),
        fingerprint: fingerprint(active),
        integratedAt: builtinInfo ? builtinInfo.integratedAt : null,
        canEdit: !builtinLocked
      };
    }

    /* ---- 导入 ---- */

    function maxEdgeFor(tier) {
      var def = CFG ? CFG.tierByNumber(tier) : null;
      var r = def ? def.r : 64;
      return Math.max(96, Math.min(MAX_EDGE_CAP, Math.round(r * 2 * 1.6)));
    }

    function readFileAsImage(file) {
      return new Promise(function (resolve, reject) {
        if (!/^image\//.test(file.type)) {
          reject(new Error('不是图片文件：' + file.name));
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            resolve(img);
          };
          img.onerror = function () {
            reject(new Error('图片解码失败：' + file.name));
          };
          img.src = String(reader.result);
        };
        reader.onerror = function () {
          reject(new Error('读取失败：' + file.name));
        };
        reader.readAsDataURL(file);
      });
    }

    /** 等比缩放 + WebP 编码（不支持时退回 PNG），既保透明又省空间 */
    function encodeImage(img, tier) {
      var maxEdge = maxEdgeFor(tier);
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      var url = canvas.toDataURL('image/webp', WEBP_QUALITY);
      if (!/^data:image\/webp/i.test(url)) url = canvas.toDataURL('image/png');
      return { dataUrl: url, w: cw, h: ch, mime: mimeOf(url), bytes: byteLength(url) };
    }

    function setSlot(tier, file, img) {
      return encodeImage(img, tier).then(function (enc) {
        var prev = custom[tier];
        custom[tier] = { dataUrl: enc.dataUrl, file: file ? file.name : (prev && prev.file) || '', mime: enc.mime, bytes: enc.bytes, w: enc.w, h: enc.h };
        return preload(tier).then(function () {
          var saved = saveCustom();
          if (!saved.ok) {
            if (prev) custom[tier] = prev;
            else delete custom[tier];
            return preload(tier).then(function () {
              return { ok: false, error: saved.error, tier: tier };
            });
          }
          notify();
          return { ok: true, tier: tier, bytes: enc.bytes };
        });
      });
    }

    function setFromFile(tier, file) {
      if (builtinLocked) return Promise.resolve({ ok: false, error: 'locked' });
      return readFileAsImage(file)
        .then(function (img) {
          return setSlot(tier, file, img);
        })
        .catch(function (err) {
          return { ok: false, error: String(err.message || err), tier: tier };
        });
    }

    /** 批量导入：按文件名自动分配到对应等级 */
    function importFiles(files) {
      if (builtinLocked) return Promise.resolve({ ok: false, error: 'locked', assigned: [], unmatched: [] });
      var list = Array.prototype.slice.call(files || []);
      var assigned = [];
      var unmatched = [];
      var chain = Promise.resolve();
      list.forEach(function (file) {
        var tier = matchTier(file.name, tiers);
        if (!tier) {
          unmatched.push(file.name);
          return;
        }
        chain = chain.then(function () {
          return setFromFile(tier, file).then(function (res) {
            if (res.ok) assigned.push({ tier: tier, file: file.name });
            else unmatched.push(file.name);
          });
        });
      });
      return chain.then(function () {
        return { ok: true, assigned: assigned, unmatched: unmatched };
      });
    }

    function clearSlot(tier) {
      if (builtinLocked) return { ok: false, error: 'locked' };
      delete custom[tier];
      delete images[tier];
      saveCustom();
      notify();
      return { ok: true };
    }

    function clearAll() {
      if (builtinLocked) return { ok: false, error: 'locked' };
      custom = {};
      images = {};
      customLocked = false;
      saveCustom();
      notify();
      return { ok: true };
    }

    function setLocked(flag) {
      customLocked = !!flag;
      saveCustom();
      notify();
      return customLocked;
    }

    /** 导出贴图包：把这个 .json 发给我即可 */
    function exportPack(packNote) {
      var slots = [];
      tiers.forEach(function (t) {
        var s = builtin.slots[t.tier] || custom[t.tier];
        if (!s) return;
        slots.push({
          tier: t.tier,
          key: t.key,
          name: t.name,
          file: s.file || (CFG ? CFG.suggestFileName(t) : t.key + '.png'),
          mime: s.mime || mimeOf(s.dataUrl),
          bytes: s.bytes || byteLength(s.dataUrl),
          dataUrl: s.dataUrl
        });
      });
      var pack = {
        app: 'suika-game',
        packVersion: 1,
        gameVersion: CFG ? CFG.VERSION : '',
        createdAt: new Date().toISOString(),
        fingerprint: fingerprint(builtin.slots[t.tier] ? builtin.slots : custom),
        slots: slots,
        note: packNote || '《合成大西瓜》水果贴图包：把它发给 AI 即可内嵌为最终版，之后图片不可再改。'
      };
      return JSON.stringify(pack, null, 1);
    }

    /** 导入贴图包（.json 文本或对象） */
    function importPack(text) {
      if (builtinLocked) return { ok: false, error: 'locked' };
      var res = normalizePack(text, tiers);
      if (!res.ok) return res;
      var backup = custom;
      custom = res.slots;
      var saved = saveCustom();
      if (!saved.ok) {
        custom = backup;
        saveCustom();
        return { ok: false, error: saved.error, count: 0 };
      }
      images = {};
      preloadAll().then(notify);
      return { ok: true, count: res.count, slots: res.slots };
    }

    readCustom();
    // 首次读取后，异步把图片对象准备好；渲染层在图片就绪前会用默认外观
    setTimeout(function () {
      preloadAll().then(notify);
    }, 0);

    return {
      tiers: tiers,
      info: info,
      onChange: onChange,
      sourceOf: sourceOf,
      urlOf: urlOf,
      imageOf: imageOf,
      preload: preload,
      preloadAll: preloadAll,
      setFromFile: setFromFile,
      importFiles: importFiles,
      clearSlot: clearSlot,
      clearAll: clearAll,
      setLocked: setLocked,
      exportPack: exportPack,
      importPack: importPack,
      slotInfo: function (tier) {
        var s = builtin.slots[tier] || custom[tier];
        return s ? { source: sourceOf(tier), file: s.file, bytes: s.bytes, mime: s.mime, dataUrl: s.dataUrl } : null;
      }
    };
  }

  return Object.assign(
    {
      create: create,
      MAX_EDGE_CAP: MAX_EDGE_CAP
    },
    {
      matchTier: matchTier,
      normalizePack: normalizePack,
      fingerprint: fingerprint,
      byteLength: byteLength,
      isDataImage: isDataImage,
      mimeOf: mimeOf
    }
  );
});
