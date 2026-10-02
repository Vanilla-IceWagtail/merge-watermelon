/*!
 * 合成大西瓜 · 内嵌图片库（占位，等你的图片）
 *
 * 这里就是「图片库」本体：游戏不带任何导入功能，图片全部内嵌在这个文件里，
 * 用户在「选图小窗口」里从图库里挑 11 张放到 11 个水果位上。
 *
 * 现在图库是空的（游戏用 emoji 默认外观）。等你把图片交给我之后，我会：
 *   1. 把每张图压缩成 WebP 并转成 base64，填进 images；
 *   2. 按你的说明填好 groups（分组）和每张图的 group；
 *   3. 把你指定的那几张默认图填进 defaults（{ '1':'i01', ... } 表示第 1 级默认用 i01）；
 *   4. 写上 builtAt 和 fingerprint（指纹）。
 *
 * images 里每张图的字段：
 *   { id:'i01', file:'01-cherry.png', group:'g1', w:512, h:512, note:'', src:'data:image/webp;base64,...' }
 */
window.SUIKA_IMAGE_LIBRARY = {
  version: 0,
  builtAt: null,
  groups: [],
  images: [],
  defaults: {}
};
