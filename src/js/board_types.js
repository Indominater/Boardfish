'use strict';

(function initBoardTypes(root) {
  const BOARD_FORMAT = 'boardfish-container';
  const BOARD_VERSION_CONTAINER = 3;
  const OBJECT_TYPES = Object.freeze({
    IMAGE: 'image',
    TEXT: 'text',
  });
  const IMAGE_REF_KINDS = Object.freeze({
    DATA_URL: 'data-url',
    MANIFEST: 'manifest',
    MISSING: 'missing',
    STRING: 'string',
  });
  const MIN_ZOOM = 0.1, MAX_ZOOM = 10;

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isSupportedBoardVersion(value) {
    const version = Number(value);
    return version === 2 || version === BOARD_VERSION_CONTAINER;
  }

  function isBoardObjectType(value) {
    return value === OBJECT_TYPES.TEXT || value === OBJECT_TYPES.IMAGE;
  }

  function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clampZoom(value, fallback = 1) {
    const zoom = finiteNumber(value, fallback);
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  }

  // Textboxes use one plain ASCII representation regardless of their input
  // source. Preserve indentation/newlines; discard unsupported characters
  // rather than transliterating them or introducing fallback font glyphs.
  function normalizeTextContent(value) {
    const text = String(value ?? '');
    return text.replace(/\r\n?|[^\x09\x0A\x0D\x20-\x7E]+/g, (match) => match[0] === '\r' ? '\n' : '');
  }

  function imageRefKind(src) {
    if (typeof src === 'string') return src.startsWith('data:') ? IMAGE_REF_KINDS.DATA_URL : IMAGE_REF_KINDS.STRING;
    if (isObject(src) && (src.path || src.mime || src.ext)) return IMAGE_REF_KINDS.MANIFEST;
    if (src == null) return IMAGE_REF_KINDS.MISSING;
    return typeof src;
  }

  function extForMime(mime = '') {
    const value = String(mime || '').toLowerCase();
    if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
    if (value === 'image/webp') return 'webp';
    if (value === 'image/gif') return 'gif';
    return 'png';
  }

  function mimeForExt(ext = '') {
    const value = String(ext || '').replace(/^\./, '').toLowerCase();
    if (value === 'jpg' || value === 'jpeg') return 'image/jpeg';
    if (value === 'webp') return 'image/webp';
    if (value === 'gif') return 'image/gif';
    return 'image/png';
  }

  function normalizeImageExt(ext = '', mime = '') {
    const value = String(ext || '').replace(/^\./, '').toLowerCase();
    return value || extForMime(mime);
  }

  const api = Object.freeze({
    BOARD_FORMAT,
    BOARD_VERSION_CONTAINER,
    OBJECT_TYPES,
    clampZoom,
    extForMime,
    finiteNumber,
    imageRefKind,
    isBoardObjectType,
    isObject,
    isSupportedBoardVersion,
    mimeForExt,
    normalizeImageExt,
    normalizeTextContent,
  });

  root.BoardfishBoardTypes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
