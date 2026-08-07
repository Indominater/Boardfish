'use strict';

(function initBoardTypes(root) {
  const BOARD_FORMAT = 'boardfish-container';
  const BOARD_VERSION_LEGACY = 2;
  const BOARD_VERSION_CONTAINER = 3;
  const SUPPORTED_BOARD_VERSIONS = Object.freeze([BOARD_VERSION_LEGACY, BOARD_VERSION_CONTAINER]);
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
  const VIEWPORT_LIMITS = Object.freeze({
    MIN_ZOOM: 0.01,
    MAX_ZOOM: 100,
  });

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isSupportedBoardVersion(value) {
    return SUPPORTED_BOARD_VERSIONS.includes(Number(value));
  }

  function isBoardObjectType(value) {
    return value === OBJECT_TYPES.TEXT || value === OBJECT_TYPES.IMAGE;
  }

  function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clampZoom(value, fallback = 1) {
    const zoom = finiteNumber(value, fallback);
    return Math.max(VIEWPORT_LIMITS.MIN_ZOOM, Math.min(VIEWPORT_LIMITS.MAX_ZOOM, zoom));
  }

  function imageRefKind(src) {
    if (typeof src === 'string') return src.startsWith('data:') ? IMAGE_REF_KINDS.DATA_URL : IMAGE_REF_KINDS.STRING;
    if (isObject(src) && (src.path || src.mime || src.ext)) return IMAGE_REF_KINDS.MANIFEST;
    if (src == null) return IMAGE_REF_KINDS.MISSING;
    return typeof src;
  }

  const api = Object.freeze({
    BOARD_FORMAT,
    BOARD_VERSION_CONTAINER,
    OBJECT_TYPES,
    clampZoom,
    finiteNumber,
    imageRefKind,
    isBoardObjectType,
    isObject,
    isSupportedBoardVersion,
  });

  root.BoardfishBoardTypes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
