'use strict';

(function initBoardDocument(root) {
  const BoardTypes = root.BoardfishBoardTypes ||
    (typeof require === 'function' ? require('./board_types.js') : null);

  function defaultImageRefKind(src) {
    return BoardTypes.imageRefKind(src);
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

  function mimeFromDataUrl(dataUrl = '') {
    return /^data:([^;,]+);base64,/i.exec(String(dataUrl || ''))?.[1] || 'image/png';
  }

  function imageMetaForBoardFile(imgKey, src = '', deps = {}) {
    const guessImageExtFromDataUrl = deps.guessImageExtFromDataUrl || (() => 'png');
    if (src && typeof src === 'object' && (src.path || src.mime || src.ext)) {
      const ext = normalizeImageExt(src.ext, src.mime);
      const mime = src.mime || mimeForExt(ext);
      const path = src.path || `images/${imgKey}.${ext}`;
      return { path, mime, ext };
    }
    const comma = typeof src === 'string' ? src.indexOf(',') : -1;
    const header = comma > 0 ? src.slice(0, comma) : '';
    const ext = guessImageExtFromDataUrl(src);
    const mime = header ? mimeFromDataUrl(src) : mimeForExt(ext);
    return { path: `images/${imgKey}.${ext}`, mime, ext };
  }

  function referencedImageKeys(objects = []) {
    const keys = new Set();
    for (const obj of objects || []) {
      const key = obj?.type === BoardTypes.OBJECT_TYPES.IMAGE ? obj.data?.imgKey : '';
      if (key) keys.add(key);
    }
    return keys;
  }

  function pruneImageStoreForObjects(imageStore = {}, objects = []) {
    const referenced = referencedImageKeys(objects);
    const pruned = {};
    let removed = 0;
    let kept = 0;
    for (const [key, src] of Object.entries(imageStore || {})) {
      if (referenced.has(key)) {
        pruned[key] = src;
        kept++;
      } else {
        removed++;
      }
    }
    return {
      imageStore: pruned,
      removed,
      kept,
      referenced: referenced.size,
    };
  }

  function pruneBoardDataImageStore(data = {}) {
    const result = pruneImageStoreForObjects(data.imageStore || {}, data.objects || []);
    return {
      data: {
        ...data,
        imageStore: result.imageStore,
      },
      removed: result.removed,
      kept: result.kept,
      referenced: result.referenced,
    };
  }

  function createBoardDataForSave({ viewport, imageStore, objects }, deps = {}) {
    const prune = pruneImageStoreForObjects(imageStore || {}, objects || []);
    const imageManifest = {};
    for (const [key, src] of Object.entries(prune.imageStore || {})) {
      imageManifest[key] = imageMetaForBoardFile(key, src, deps);
    }
    const data = {
      version: BoardTypes.BOARD_VERSION_CONTAINER,
      format: BoardTypes.BOARD_FORMAT,
      viewport,
      imageStore: imageManifest,
      objects,
    };
    if (deps.schema?.normalizeBoardData) return deps.schema.normalizeBoardData(data);
    if (deps.schema?.validateBoardData) deps.schema.validateBoardData(data);
    return data;
  }

  function summarizeImageStore(store = {}, deps = {}, { includeRuntime = false } = {}) {
    const imageStoreBytesEstimate = deps.imageStoreBytesEstimate || (() => 0);
    const imageRefKind = deps.imageRefKind || defaultImageRefKind;
    const runtime = deps.runtime || {};
    let imageCount = 0;
    let imageStoreBytes = 0;
    let largestImageKey = '';
    let largestImageBytes = 0;
    let manifestRefs = 0;
    let dataUrlRefs = 0;
    let otherRefs = 0;
    let cachedImages = 0;
    let bitmaps = 0;
    let bitmapFailures = 0;
    for (const [key, src] of Object.entries(store || {})) {
      imageCount++;
      const bytes = imageStoreBytesEstimate(src);
      imageStoreBytes += bytes;
      const kind = imageRefKind(src);
      if (kind === 'manifest') manifestRefs++;
      else if (kind === 'data-url' || kind === 'string') dataUrlRefs++;
      else otherRefs++;
      if (includeRuntime) {
        if (runtime.imageCache?.[key]) cachedImages++;
        if (runtime.imageBitmapCache?.[key]) bitmaps++;
        if (runtime.imageBitmapFailed?.has?.(key)) bitmapFailures++;
      }
      if (bytes > largestImageBytes) {
        largestImageBytes = bytes;
        largestImageKey = key;
      }
    }
    return {
      imageCount,
      imageStoreBytes,
      largestImageKey,
      largestImageBytes,
      manifestRefs,
      dataUrlRefs,
      otherRefs,
      ...(includeRuntime ? { cachedImages, bitmaps, bitmapFailures } : {}),
    };
  }

  function getObjectTypeCounts(objectsList = []) {
    let imageObjectCount = 0;
    let textObjectCount = 0;
    for (const obj of objectsList) {
      if (obj?.type === 'image') imageObjectCount++;
      else if (obj?.type === 'text') textObjectCount++;
    }
    return { imageObjectCount, textObjectCount };
  }

  function getTextSaveMetrics(objectsList = []) {
    let textCharCount = 0;
    let largestTextId = '';
    let largestTextChars = 0;
    for (const obj of objectsList || []) {
      if (obj?.type !== 'text') continue;
      const chars = String(obj.data?.content || '').length;
      textCharCount += chars;
      if (chars > largestTextChars) {
        largestTextChars = chars;
        largestTextId = obj.id || '';
      }
    }
    return { textCharCount, largestTextId, largestTextChars };
  }

  function getTextRuntimeMetrics(objectsList = []) {
    let runtimeTextCacheObjects = 0;
    let runtimeTextCacheLines = 0;
    let runtimeTextCacheContentChars = 0;
    let runtimeTextCachePrefixEntries = 0;
    let runtimeTextCacheKeyChars = 0;
    let runtimeTextPrivateFields = 0;
    for (const obj of objectsList || []) {
      if (obj?.type !== 'text') continue;
      const privateKeys = Object.keys(obj).filter((key) => key.startsWith('_'));
      runtimeTextPrivateFields += privateKeys.length;
      if (Array.isArray(obj._layoutCache)) {
        runtimeTextCacheObjects++;
        runtimeTextCacheLines += obj._layoutCache.length;
        for (const line of obj._layoutCache) {
          runtimeTextCacheContentChars += String(line?.content || '').length;
          runtimeTextCachePrefixEntries += Number(line?.prefixWidths?.length) || 0;
        }
      }
      if (typeof obj._layoutCacheKey === 'string') runtimeTextCacheKeyChars += obj._layoutCacheKey.length;
    }
    return {
      runtimeTextCacheObjects,
      runtimeTextCacheLines,
      runtimeTextCacheContentChars,
      runtimeTextCachePrefixEntries,
      runtimeTextCacheKeyChars,
      runtimeTextPrivateFields,
    };
  }

  function getBoardSaveMetrics(data, deps = {}) {
    const imageSummary = summarizeImageStore(data.imageStore || {}, deps);
    const objectCounts = getObjectTypeCounts(data.objects || []);
    const textSummary = getTextSaveMetrics(data.objects || []);
    const runtimeTextSummary = getTextRuntimeMetrics(deps.rawObjects || data.objects || []);
    const rawImageStore = deps.rawImageStore || {};
    const imageStoreBytesEstimate = deps.imageStoreBytesEstimate || (() => 0);
    return {
      objectCount: data.objects?.length || 0,
      imageCount: imageSummary.imageCount,
      ...objectCounts,
      ...textSummary,
      ...runtimeTextSummary,
      imageStoreBytes: imageSummary.imageStoreBytes,
      rawImageStoreBytes: Object.values(rawImageStore).reduce((sum, src) => sum + imageStoreBytesEstimate(src), 0),
      largestImageKey: imageSummary.largestImageKey,
      largestImageBytes: imageSummary.largestImageBytes,
      historyLength: deps.historyLength ?? 0,
      historyIndex: deps.historyIndex ?? -1,
      dirty: deps.dirty === true,
    };
  }

  function getBoardOpenMetrics(data, deps = {}) {
    const imageSummary = summarizeImageStore(data?.imageStore || {}, deps);
    const objectCounts = getObjectTypeCounts(data?.objects || []);
    return {
      objectCount: data?.objects?.length || 0,
      imageCount: imageSummary.imageCount,
      ...objectCounts,
      imageStoreBytes: imageSummary.imageStoreBytes,
      largestImageKey: imageSummary.largestImageKey,
      largestImageBytes: imageSummary.largestImageBytes,
      manifestRefs: imageSummary.manifestRefs,
      dataUrlRefs: imageSummary.dataUrlRefs,
      otherRefs: imageSummary.otherRefs,
    };
  }

  function getImageStoreDebugSample(store = {}, deps = {}, limit = 12) {
    const rows = [];
    const runtime = deps.runtime || {};
    const imageRefKind = deps.imageRefKind || defaultImageRefKind;
    for (const [key, src] of Object.entries(store || {})) {
      rows.push({
        key,
        kind: imageRefKind(src),
        path: typeof src?.path === 'string' ? src.path : '',
        mime: typeof src?.mime === 'string' ? src.mime : '',
        ext: typeof src?.ext === 'string' ? src.ext : '',
        bytes: src?.bytes ?? '',
        cachedImage: !!runtime.imageCache?.[key],
        bitmap: !!runtime.imageBitmapCache?.[key],
        bitmapFailed: !!runtime.imageBitmapFailed?.has?.(key),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  function getImageRuntimeMetrics(store = {}, deps = {}) {
    const imageSummary = summarizeImageStore(store, deps, { includeRuntime: true });
    return {
      imageCount: imageSummary.imageCount,
      manifestRefs: imageSummary.manifestRefs,
      dataUrlRefs: imageSummary.dataUrlRefs,
      otherRefs: imageSummary.otherRefs,
      cachedImages: imageSummary.cachedImages,
      bitmaps: imageSummary.bitmaps,
      bitmapFailures: imageSummary.bitmapFailures,
    };
  }

  const api = Object.freeze({
    createBoardDataForSave,
    defaultImageRefKind,
    getBoardOpenMetrics,
    getBoardSaveMetrics,
    getImageRuntimeMetrics,
    getImageStoreDebugSample,
    getObjectTypeCounts,
    imageMetaForBoardFile,
    pruneBoardDataImageStore,
    pruneImageStoreForObjects,
    referencedImageKeys,
    summarizeImageStore,
  });

  root.BoardfishBoardDocument = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
