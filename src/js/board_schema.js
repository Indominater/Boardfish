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
        const align = new Array(data.lineAlign.length);
        for (let i = 0; i < data.lineAlign.length; i++) {
          const value = data.lineAlign[i];
          align[i] = value === 'center' || value === 'right' || value === 'left' ? value : 'left';
        }
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
      normalized.data.rotation = ((finiteNumber(data.rotation) % 360) + 360) % 360;
    }
    return normalized;
  }

  function normalizeBoardData(data) {
    if (!isObject(data)) throw new Error('board data must be an object');
    if (data.version != null && !isSupportedBoardVersion(data.version)) {
      throw new Error(`unsupported board version ${data.version}`);
    }
    if (data.format != null && data.format !== BOARD_FORMAT) {
      throw new Error(`unsupported board format ${data.format}`);
    }
    const sourceImageStore = isObject(data.imageStore) ? data.imageStore : {};
    for (const key in sourceImageStore) {
      if (!Object.prototype.hasOwnProperty.call(sourceImageStore, key)) continue;
      const value = sourceImageStore[key];
      if (!key) throw new Error('imageStore contains an empty key');
      if (typeof value !== 'string' && !isObject(value)) {
        throw new Error(`imageStore.${key} must be a string or object`);
      }
    }
    const objects = [];
    if (Array.isArray(data.objects)) {
      for (let i = 0; i < data.objects.length; i++) objects.push(normalizeObject(data.objects[i], i));
    }
    const imageStore = {};
    for (const obj of objects) {
      if (obj.type !== OBJECT_TYPES.IMAGE) continue;
      const key = obj.data.imgKey;
      if (key === '__proto__' || !Object.prototype.hasOwnProperty.call(sourceImageStore, key)) {
        throw new Error(`image object ${obj.id} references missing image ${obj.data.imgKey}`);
      }
      imageStore[key] = sourceImageStore[key];
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

  const api = {
    normalizeBoardData,
  };

  root.BoardSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
