/*!
 * 合成大西瓜 · 最终内嵌贴图（占位）
 *
 * 这个文件现在是空的，所有水果都用默认 emoji 外观。
 * 等你在「贴图工坊」里导好图片并导出贴图包交给我之后，
 * 我会把图片以 base64 的形式填进 slots、把 locked 改成 true、写上 integratedAt，
 * 之后游戏固定使用内嵌图片，界面上的导入功能会自动关闭 —— 图片就不可再改了。
 *
 * 结构示例（tier 为 1~11）：
 *   window.SUIKA_BUILTIN_ASSETS = {
 *     packVersion: 1,
 *     locked: true,
 *     integratedAt: '2025-01-01T00:00:00.000Z',
 *     fingerprint: '0123456789abcdef',
 *     slots: { 1: { dataUrl: 'data:image/webp;base64,...', file: '01-cherry.webp' }, ... }
 *   };
 */
window.SUIKA_BUILTIN_ASSETS = {
  packVersion: 1,
  locked: false,
  integratedAt: null,
  fingerprint: null,
  slots: {}
};
