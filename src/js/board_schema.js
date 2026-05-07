'use strict';

(function initBoardSchema(root) {
  const BoardTypes = root.BoardfishBoardTypes ||
    (typeof require === 'function' ? require('./board_types.js') : null);
  const {
    BOARD_FORMAT,
    OBJECT_TYPES,
    clampZoom,
    finiteNumber,
    isBoardObjectType,
    isObject,
    isSupportedBoardVersion,
  } = BoardTypes;

  function normalizeBoardRotation(value) {
    if (typeof root.normalizeRotation === 'function') return root.normalizeRotation(value);
    return ((Number(value) || 0) % 360 + 360) % 360;
  }

  function normalizeViewport(viewport = {}) {
    return {
      panX: finiteNumber(viewport.panX),
      panY: finiteNumber(viewport.panY),
      zoom: clampZoom(viewport.zoom),
    };
  }

  function finitePositiveNumber(value, fallback = 1) {
    const number = finiteNumber(value, fallback);
    return number > 0 ? number : fallback;
  }

  function normalizeColorByte(value, fallback = 0) {
    const number = Number(value);
    return Math.max(0, Math.min(255, Math.round(Number.isFinite(number) ? number : fallback)));
  }

  function normalizeEyedropperRgba(value, index) {
    if (!Array.isArray(value) || value.length < 3) {
      throw new Error(`eyedropper card ${index} is missing rgba`);
    }
    return [
      normalizeColorByte(value[0]),
      normalizeColorByte(value[1]),
      normalizeColorByte(value[2]),
      normalizeColorByte(value[3], 255),
    ];
  }

  function normalizeEyedropperCard(card, index) {
    if (!isObject(card)) throw new Error(`eyedropper card ${index} is not an object`);
    const normalized = {
      rgba: normalizeEyedropperRgba(card.rgba, index),
      left: finiteNumber(card.left),
      top: finiteNumber(card.top),
      order: finiteNumber(card.order, index + 1),
    };
    if (card.canvasWidth != null) normalized.canvasWidth = finitePositiveNumber(card.canvasWidth);
    if (card.canvasHeight != null) normalized.canvasHeight = finitePositiveNumber(card.canvasHeight);
    if (typeof card.previewDataUrl === 'string' && card.previewDataUrl.startsWith('data:image/')) {
      normalized.previewDataUrl = card.previewDataUrl;
    }
    return normalized;
  }

  function normalizeEyedropperCards(cards = []) {
    if (cards == null) return [];
    if (!Array.isArray(cards)) throw new Error('eyedropperCards must be an array');
    return cards.slice(0, 5).map((card, index) => normalizeEyedropperCard(card, index));
  }

  function normalizeObject(obj, index) {
    if (!isObject(obj)) throw new Error(`object ${index} is not an object`);
    if (!isBoardObjectType(obj.type)) {
      throw new Error(`object ${index} has unsupported type`);
    }
    if (typeof obj.id !== 'string' || !obj.id) {
      throw new Error(`object ${index} is missing id`);
    }
    const data = isObject(obj.data) ? obj.data : {};
    const normalized = {
      id: obj.id,
      type: obj.type,
      x: finiteNumber(obj.x),
      y: finiteNumber(obj.y),
      w: Math.max(1, finiteNumber(obj.w, 1)),
      h: Math.max(1, finiteNumber(obj.h, 1)),
      z: finiteNumber(obj.z),
      locked: obj.locked === true,
      data: {},
    };
    if (obj.type === OBJECT_TYPES.TEXT) {
      normalized.data.content = typeof data.content === 'string' ? data.content : '';
    } else {
      if (typeof data.imgKey !== 'string' || !data.imgKey) {
        throw new Error(`image object ${obj.id} is missing imgKey`);
      }
      normalized.data.imgKey = data.imgKey;
      normalized.data.flipX = !!data.flipX;
      normalized.data.flipY = !!data.flipY;
      normalized.data.rotation = normalizeBoardRotation(finiteNumber(data.rotation));
    }
    return normalized;
  }

  function validateImageStore(imageStore) {
    if (!isObject(imageStore)) throw new Error('imageStore must be an object');
    for (const [key, value] of Object.entries(imageStore)) {
      if (!key) throw new Error('imageStore contains an empty key');
      const validValue = typeof value === 'string' || isObject(value);
      if (!validValue) throw new Error(`imageStore.${key} must be a string or object`);
    }
  }

  function normalizeBoardData(data) {
    if (!isObject(data)) throw new Error('board data must be an object');
    if (data.version != null && !isSupportedBoardVersion(data.version)) {
      throw new Error(`unsupported board version ${data.version}`);
    }
    if (data.format != null && data.format !== BOARD_FORMAT) {
      throw new Error(`unsupported board format ${data.format}`);
    }
    const imageStore = isObject(data.imageStore) ? { ...data.imageStore } : {};
    validateImageStore(imageStore);
    const objects = Array.isArray(data.objects)
      ? data.objects.map((obj, index) => normalizeObject(obj, index))
      : [];
    for (const obj of objects) {
      if (obj.type === OBJECT_TYPES.IMAGE && !Object.prototype.hasOwnProperty.call(imageStore, obj.data.imgKey)) {
        throw new Error(`image object ${obj.id} references missing image ${obj.data.imgKey}`);
      }
    }
    const eyedropperCards = normalizeEyedropperCards(data.eyedropperCards);
    const { preferences: _preferences, eyedropperCards: _eyedropperCards, ...boardFields } = data;
    const normalized = {
      ...boardFields,
      version: Number(data.version || 3),
      viewport: normalizeViewport(data.viewport),
      imageStore,
      objects,
    };
    if (eyedropperCards.length) normalized.eyedropperCards = eyedropperCards;
    return normalized;
  }

  function validateBoardData(data) {
    normalizeBoardData(data);
    return true;
  }

  const api = {
    BOARD_FORMAT,
    OBJECT_TYPES,
    normalizeBoardData,
    normalizeEyedropperCards,
    validateBoardData,
  };

  root.BoardSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
