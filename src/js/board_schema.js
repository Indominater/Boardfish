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
      data: {},
    };
    if (obj.type === OBJECT_TYPES.TEXT) {
      normalized.data.content = typeof data.content === 'string' ? data.content : '';
      if (Array.isArray(data.lineAlign)) {
        const align = data.lineAlign
          .map((value) => ['left', 'center', 'right'].includes(value) ? value : 'left');
        while (align.length && align[align.length - 1] === 'left') align.pop();
        if (align.length) normalized.data.lineAlign = align;
      }
      if (Array.isArray(data.scriptRanges)) {
        const scriptRanges = [];
        for (const range of data.scriptRanges) {
          const kind = ['sup', 'sub'].includes(range?.kind) ? range.kind : '';
          const start = Math.trunc(Number(range?.start));
          const end = Math.trunc(Number(range?.end));
          if (!kind || !Number.isFinite(start) || !Number.isFinite(end)) continue;
          scriptRanges.push({
            start: Math.max(0, start),
            end: Math.max(0, end),
            kind,
          });
        }
        if (scriptRanges.length) normalized.data.scriptRanges = scriptRanges;
      }
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
    const normalized = {
      version: Number(data.version || 3),
      format: BOARD_FORMAT,
      viewport: normalizeViewport(data.viewport),
      imageStore,
      objects,
    };
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
    validateBoardData,
  };

  root.BoardSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
