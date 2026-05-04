'use strict';

(function initEyedropperColor(root) {
  function rgbaToCss(pixel) {
    if (!pixel) return 'transparent';
    return `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${Math.round((pixel[3] / 255) * 1000) / 1000})`;
  }

  function colorByteToHex(value) {
    return Number(value || 0).toString(16).padStart(2, '0').toUpperCase();
  }

  function rgbaToHex(pixel) {
    if (!pixel) return '#000000';
    const hex = `#${colorByteToHex(pixel[0])}${colorByteToHex(pixel[1])}${colorByteToHex(pixel[2])}`;
    return pixel[3] === 255 ? hex : `${hex}${colorByteToHex(pixel[3])}`;
  }

  function rgbaToRgbText(pixel) {
    if (!pixel) return '0 0 0';
    return `${pixel[0]} ${pixel[1]} ${pixel[2]}`;
  }

  function parseRgbColor(value, fallback = [0, 0, 0, 255]) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/);
    if (!match) return fallback;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean);
    const alpha = parts[3] == null ? 1 : Number(parts[3]);
    return [
      Math.max(0, Math.min(255, Math.round(Number(parts[0]) || 0))),
      Math.max(0, Math.min(255, Math.round(Number(parts[1]) || 0))),
      Math.max(0, Math.min(255, Math.round(Number(parts[2]) || 0))),
      Math.max(0, Math.min(255, Math.round((Number.isFinite(alpha) ? alpha : 1) * 255))),
    ];
  }

  function parseHexColor(value, fallback = [0, 0, 0, 255]) {
    const hex = String(value || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{3,8}$/i.test(hex)) return fallback;
    const full = hex.length === 3 || hex.length === 4
      ? hex.split('').map((part) => part + part).join('')
      : hex;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      full.length >= 8 ? parseInt(full.slice(6, 8), 16) : 255,
    ];
  }

  function parseCssColor(value, fallback = [0, 0, 0, 255]) {
    return String(value || '').trim().startsWith('#')
      ? parseHexColor(value, fallback)
      : parseRgbColor(value, fallback);
  }

  const api = Object.freeze({
    colorByteToHex,
    parseCssColor,
    parseHexColor,
    parseRgbColor,
    rgbaToCss,
    rgbaToHex,
    rgbaToRgbText,
  });

  root.BoardfishEyedropperColor = api;
  root.colorByteToHex = colorByteToHex;
  root.parseCssColor = parseCssColor;
  root.parseHexColor = parseHexColor;
  root.parseRgbColor = parseRgbColor;
  root.rgbaToCss = rgbaToCss;
  root.rgbaToHex = rgbaToHex;
  root.rgbaToRgbText = rgbaToRgbText;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
