'use strict';

(function initBoardTypes(root) {
  function loadBoardContract() {
    const embedded = root.document?.getElementById?.('boardfish-board-contract')?.textContent;
    if (embedded) return JSON.parse(embedded);
    if (typeof require === 'function') return require('../shared/board_contract.json');
    throw new Error('Boardfish board contract is unavailable');
  }

  const BOARD_CONTRACT = Object.freeze(loadBoardContract());
  const BOARD_FORMAT = BOARD_CONTRACT.format;
  const BOARD_VERSION_LEGACY = BOARD_CONTRACT.versions.legacy;
  const BOARD_VERSION_CONTAINER = BOARD_CONTRACT.versions.container;
  const SUPPORTED_BOARD_VERSIONS = Object.freeze([BOARD_VERSION_LEGACY, BOARD_VERSION_CONTAINER]);
  const OBJECT_TYPES = Object.freeze({
    IMAGE: BOARD_CONTRACT.objectTypes[0],
    TEXT: BOARD_CONTRACT.objectTypes[1],
  });
  const IMAGE_REF_KINDS = Object.freeze({
    DATA_URL: 'data-url',
    MANIFEST: 'manifest',
    MISSING: 'missing',
    STRING: 'string',
  });
  const VIEWPORT_LIMITS = Object.freeze({
    MIN_ZOOM: BOARD_CONTRACT.viewport.minZoom,
    MAX_ZOOM: BOARD_CONTRACT.viewport.maxZoom,
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
    BOARD_CONTRACT,
    BOARD_VERSION_CONTAINER,
    BOARD_VERSION_LEGACY,
    IMAGE_REF_KINDS,
    OBJECT_TYPES,
    SUPPORTED_BOARD_VERSIONS,
    VIEWPORT_LIMITS,
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
