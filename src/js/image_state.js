// ─── Image store (keeps base64 data OUT of boardHistory snapshots) ─────────────────
var imageStore = {};
var imageCache = {}; // Deprecated: kept empty for compatibility/debug probes.
var imageMetadataCache = {}; // key -> lightweight display metadata; no decoded image element retained.
var imageBitmapCache = {}; // key -> ImageBitmap (GPU-resident, never evicted by WebKit)
var imageBitmapFailed = new Set();
var imgKeyCounter = 1;
var _imageStoreGeneration = 0;
var _imageDecodeQueue = [];
var _imageDecodeActive = 0;
var _imageDecodeScheduled = false;
var MAX_IMAGE_DECODE_ACTIVE = 2;
const MAX_OPEN_IMAGE_DECODE_ACTIVE = 8;
var imageReadyPromises = new Map();

function newImgKey() { return 'img-' + (imgKeyCounter++); }

const isWebImageRef = (src) => {
  return typeof BoardfishWebBoardContainer !== 'undefined' &&
    !!BoardfishWebBoardContainer?.isWebImageRef?.(src);
};

const webImageDisplaySrc = (src) => {
  if (!isWebImageRef(src)) return '';
  return BoardfishWebBoardContainer.displaySrcForImageSource?.(src) || '';
};

const webImageDataUrl = (src) => {
  if (!isWebImageRef(src)) return '';
  return BoardfishWebBoardContainer.dataUrlForImageSource?.(src) || '';
};

const revokeWebImageSource = (src) => {
  if (!isWebImageRef(src)) return false;
  return BoardfishWebBoardContainer.revokeImageSource?.(src) || false;
};

function imageStoreBytesEstimate(src) {
  if (typeof src === 'string') return src.length;
  if (isWebImageRef(src)) return Number(src.bytes || 0) || 0;
  return 0;
}

function imageSourceDebugInfo(src) {
  if (isWebImageRef(src)) {
    return {
      kind: 'web-ref',
      length: Number(src.bytes || 0) || '',
      prefix: webImageDisplaySrc(src).slice(0, 96) || src.path || '',
    };
  }
  if (typeof src !== 'string') {
    return {
      kind: typeof src,
      length: '',
      prefix: '',
    };
  }
  const comma = src.indexOf(',');
  return {
    kind: src.startsWith('data:') ? 'data-url' : src.startsWith('asset:') ? 'asset-url' : 'string',
    length: src.length,
    prefix: comma > 0 ? src.slice(0, comma) : src.slice(0, 96),
  };
}

const isImageDisplayCacheRequestCurrent = (key, src, generation) => {
  if (generation !== _imageStoreGeneration) return false;
  const stored = imageStore[key];
  if (typeof stored === 'string') return stored === src;
  if (isWebImageRef(stored)) return !!src && webImageDisplaySrc(stored) === src;
  return false;
};

function imageNeedsRendering(obj) {
  return imageTransformNeedsRendering(imageTransformFromObject(obj));
}

function renderImageToCanvas(obj, sourceImg = null) {
  const transform = imageTransformFromObject(obj);
  const dbg = ClipDebug.start('renderImageToCanvas', {
    id: obj?.id,
    imgKey: obj?.data?.imgKey,
    ...transform,
  });
  const img = sourceImg || imageBitmapCache[obj.data.imgKey] || imageCache[obj.data.imgKey];
  const sourceW = img?.naturalWidth || img?.width || 0;
  const sourceH = img?.naturalHeight || img?.height || 0;
  const ready = img && (img instanceof (typeof ImageBitmap !== 'undefined' ? ImageBitmap : Object) || img.complete || sourceW > 0);
  if (!ready || !sourceW || !sourceH) {
    ClipDebug.end(dbg, { ready: false });
    return null;
  }
  const sideways = isSidewaysRotation(transform.rotation);
  const tmp = document.createElement('canvas');
  tmp.width = sideways ? sourceH : sourceW;
  tmp.height = sideways ? sourceW : sourceH;
  const tctx = tmp.getContext('2d');
  tctx.save();
  tctx.translate(tmp.width / 2, tmp.height / 2);
  tctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
  if (transform.rotation) tctx.rotate((transform.rotation * Math.PI) / 180);
  tctx.drawImage(img, -sourceW / 2, -sourceH / 2, sourceW, sourceH);
  tctx.restore();
  ClipDebug.end(dbg, { ready: true, width: tmp.width, height: tmp.height });
  return tmp;
}

function canvasToPngBlob(canvas) {
  const dbg = ClipDebug.start('canvasToPngBlob', { width: canvas?.width, height: canvas?.height });
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      ClipDebug.end(dbg, { blobSize: blob?.size || 0 });
      resolve(blob);
    }, 'image/png');
  });
}

async function getRenderedImageDataUrl(obj, dbg = null) {
  const imgKey = obj?.data?.imgKey;
  const transform = imageTransformFromObject(obj);
  const needsRender = imageTransformNeedsRendering(transform);
  const baseMeta = {
    objectId: obj?.id,
    imgKey,
    ...transform,
    needsRender,
    storedKind: isWebImageRef(imageStore[imgKey]) ? 'web-ref' : typeof imageStore[imgKey],
    storedMB: Math.round(imageStoreBytesEstimate(imageStore[imgKey]) / 1024 / 1024 * 100) / 100,
  };
  const totalStart = performance.now();
  const sourceStart = performance.now();
  const src = await ensureImageDataUrl(imgKey);
  const sourceMs = performance.now() - sourceStart;
  const sourceKind = typeof imageStore[imgKey] === 'string' ? 'data-url' : baseMeta.storedKind;
  if (!src || !needsRender) {
    ExportDebug.step(dbg, 'render:done', {
      ...baseMeta,
      sourceKind,
      sourceMs,
      totalRenderMs: performance.now() - totalStart,
      hasDataUrl: !!src,
      passthrough: true,
      dataUrlLen: src?.length || 0,
      dataUrlMB: Math.round((src?.length || 0) / 1024 / 1024 * 100) / 100,
    });
    return src;
  }

  const bitmapStart = performance.now();
  const bitmap = await createImageBitmapForSource(src, src).catch((err) => {
    ExportDebug.step(dbg, 'render:image-bitmap-error', { ...baseMeta, sourceMs, error: String(err) });
    return null;
  });
  const loadMs = performance.now() - bitmapStart;
  if (!bitmap) {
    ExportDebug.step(dbg, 'render:done', {
      ...baseMeta,
      sourceKind,
      sourceMs,
      loadMs,
      totalRenderMs: performance.now() - totalStart,
      hasDataUrl: false,
      ok: false,
      error: 'image bitmap failed',
    });
    return '';
  }

  const drawStart = performance.now();
  const canvas = renderImageToCanvas(obj, bitmap);
  bitmap.close?.();
  const drawMs = performance.now() - drawStart;
  if (!canvas) {
    ExportDebug.step(dbg, 'render:done', {
      ...baseMeta,
      sourceKind,
      sourceMs,
      loadMs,
      drawMs,
      totalRenderMs: performance.now() - totalStart,
      hasDataUrl: false,
      ok: false,
      error: 'canvas render failed',
    });
    return '';
  }

  const encodeStart = performance.now();
  const dataUrl = canvas.toDataURL('image/png');
  const encodeMs = performance.now() - encodeStart;
  ExportDebug.step(dbg, 'render:done', {
    ...baseMeta,
    sourceKind,
    sourceMs,
    loadMs,
    drawMs,
    encodeMs,
    totalRenderMs: performance.now() - totalStart,
    width: canvas.width,
    height: canvas.height,
    megapixels: Math.round(canvas.width * canvas.height / 10000) / 100,
    hasDataUrl: !!dataUrl,
    ok: !!dataUrl,
    dataUrlLen: dataUrl.length,
    dataUrlMB: Math.round(dataUrl.length / 1024 / 1024 * 100) / 100,
  });
  return dataUrl;
}

const imageMetadataFromBitmap = (bitmap, src = '') => {
  const width = Number(bitmap?.width || bitmap?.naturalWidth || 0) || 0;
  const height = Number(bitmap?.height || bitmap?.naturalHeight || 0) || 0;
  return {
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
    complete: width > 0 && height > 0,
    src: src || '',
    currentSrc: src || '',
  };
};

const setImageDisplayMetadata = (key, bitmap, src = '') => {
  if (!key || !bitmap) return null;
  const metadata = imageMetadataFromBitmap(bitmap, src);
  imageMetadataCache[key] = metadata;
  return metadata;
};

const getImageDisplayMetadata = (key) => {
  return imageMetadataCache[key] || (imageBitmapCache[key] ? imageMetadataFromBitmap(imageBitmapCache[key]) : null);
};

const bitmapSourceFromImageSource = async (source, displaySrc) => {
  if (typeof isWebImageRef === 'function' && isWebImageRef(source)) {
    const bytes = globalThis.BoardfishWebBoardContainer?.bytesForImageSource?.(source);
    if (bytes && typeof Blob !== 'undefined') {
      return new Blob([bytes], { type: source.mime || 'image/png' });
    }
  }
  if (source && typeof Blob !== 'undefined' && source instanceof Blob) return source;
  if (typeof displaySrc === 'string' && displaySrc && typeof fetch === 'function') {
    const response = await fetch(displaySrc);
    if (!response.ok && !displaySrc.startsWith('data:') && !displaySrc.startsWith('blob:')) {
      throw new Error(`image fetch failed: ${response.status}`);
    }
    return response.blob();
  }
  return displaySrc;
};

const createImageBitmapForSource = async (source, displaySrc) => {
  if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap unavailable');
  const bitmapSource = await bitmapSourceFromImageSource(source, displaySrc);
  return createImageBitmap(bitmapSource);
};

const addImageRuntimeObjectKeysToSet = (keys, value) => {
  if (!value || typeof value !== 'object') return keys;
  for (const sourceKey in value) {
    if (Object.hasOwn(value, sourceKey)) keys.add(sourceKey);
  }
  return keys;
};

const IMAGE_READY_RENDER_INTERVAL_MS = 120;
const BULK_IMAGE_READY_RENDER_INTERVAL_MS = 450;

function scheduleImageReadyRender(source = 'image-load', options = {}) {
  invalidateOffscreen();
  const now = performance.now();
  const intervalMs = Number(options.minIntervalMs) > 0
    ? Number(options.minIntervalMs)
    : (_bulkImageInsertDepth > 0 ? BULK_IMAGE_READY_RENDER_INTERVAL_MS : IMAGE_READY_RENDER_INTERVAL_MS);
  if (now - _imageReadyLastRender > intervalMs) {
    _imageReadyLastRender = now;
    scheduleRender(true, false, source);
  } else {
    scheduleRender(false, true, `${source}-overlay`);
  }
}

async function ensureImageDisplaySrc(key, dbg = null) {
  const stored = imageStore[key];
  if (typeof stored === 'string') return { src: stored, source: 'data-url', dataUrlLen: stored.length };
  if (isWebImageRef(stored)) return { src: webImageDisplaySrc(stored), source: 'web-blob', dataUrlLen: 0 };
  OpenDebug.step(dbg, 'ensure-image-display-src:missing', { imgKey: key, kind: imageRefKind(stored), hasStore: !!stored });
  return { src: '', source: 'missing', dataUrlLen: 0 };
}

async function ensureImageDataUrl(key, dbg = null) {
  const src = imageStore[key];
  if (typeof src === 'string') return src;
  if (isWebImageRef(src)) return webImageDataUrl(src);
  return '';
}
var _imageHydrationScheduled = false;
var _imageHydrationQueue = [];
var _imageHydrationQueued = new Set();

function queueImageHydration(key, dbg = null) {
  const source = imageStore[key];
  if (!source || getImageDisplayMetadata(key) || imageBitmapCache[key] || _imageHydrationQueued.has(key)) return;
  if (typeof source !== 'string' && !isWebImageRef(source)) return;
  _imageHydrationQueued.add(key);
  _imageHydrationQueue.push({ key, dbg });
  scheduleImageHydration();
}

function scheduleImageHydration() {
  if (_imageHydrationScheduled) return;
  _imageHydrationScheduled = true;
  requestAnimationFrame(processImageHydrationQueue);
}

function processImageHydrationQueue() {
  _imageHydrationScheduled = false;
  const batchStart = performance.now();
  let count = 0;
  while (_imageHydrationQueue.length && count < 1 && performance.now() - batchStart < 6) {
    const { key, dbg } = _imageHydrationQueue.shift();
    _imageHydrationQueued.delete(key);
    const source = imageStore[key];
    if (!source || getImageDisplayMetadata(key) || imageBitmapCache[key]) continue;
    if (typeof source !== 'string' && !isWebImageRef(source)) continue;
    count++;
    ensureImageDisplaySrc(key, dbg)
      .then((display) => {
        if (display?.src && !getImageDisplayMetadata(key) && !imageBitmapCache[key]) cacheImage(key, source, dbg, null, { skipSourceRegistration: true });
      })
      .catch((err) => OpenDebug.step(dbg, 'hydrate-image:error', { imgKey: key, error: String(err) }));
  }
  if (_imageHydrationQueue.length) scheduleImageHydration();
}

function enqueueImageDecode(task) {
  _imageDecodeQueue.push(task);
  ViewportDebug.count('imageDecodeQueued');
  ViewportDebug.max('maxImageDecodeQueueDepth', _imageDecodeQueue.length + _imageDecodeActive);
  scheduleImageDecodeQueue();
}

function scheduleImageDecodeQueue() {
  if (_imageDecodeScheduled) return;
  _imageDecodeScheduled = true;
  if (typeof _boardOpening !== 'undefined' && _boardOpening) {
    setTimeout(processImageDecodeQueue, 0);
  } else {
    requestAnimationFrame(processImageDecodeQueue);
  }
}

function processImageDecodeQueue() {
  _imageDecodeScheduled = false;
  const activeLimit = (typeof _boardOpening !== 'undefined' && _boardOpening)
    ? MAX_OPEN_IMAGE_DECODE_ACTIVE
    : MAX_IMAGE_DECODE_ACTIVE;
  while (_imageDecodeActive < activeLimit && _imageDecodeQueue.length) {
    const task = _imageDecodeQueue.shift();
    _imageDecodeActive++;
    task()
      .catch(() => {})
      .finally(() => {
        _imageDecodeActive = Math.max(0, _imageDecodeActive - 1);
        if (_imageDecodeQueue.length) scheduleImageDecodeQueue();
      });
  }
}

function imageReadyPromiseForKey(key) {
  return imageReadyPromises.get(key) || Promise.resolve();
}

const isDebugApiEnabled = (api) => {
  return !!(api && (api.enabled === true || api.isEnabled?.() === true));
};

const shouldPrepareImagePreviewDebug = (dbg = null) => {
  return isDebugApiEnabled(ViewportDebug) || (!!dbg && isDebugApiEnabled(OpenDebug));
};

function ensureImagePreviewBitmap(key, img, dbg = null) {
  const t0 = performance.now();
  // Placeholder hook for future lower-resolution previews. The timing is kept
  // separate from ImageBitmap creation so readiness reports show the true stage.
  ViewportDebug.count('imagePreviewPrepared');
  const ms = performance.now() - t0;
  ViewportDebug.max('maxImagePreviewMs', ms);
  if (dbg) ViewportDebug.step(dbg, 'previewBitmap', { key, ms, skipped: true });
}

function cacheImage(key, src, dbg = null, loadedImg = null, options = {}) {
  const displaySrc = isWebImageRef(src) ? webImageDisplaySrc(src) : src;
  if (typeof displaySrc !== 'string' || !displaySrc) return;
  const cachedDisplay = getImageDisplayMetadata(key);
  if (cachedDisplay) {
    const cachedSrc = cachedDisplay.currentSrc || cachedDisplay.src || '';
    if (cachedSrc === displaySrc) return imageReadyPromiseForKey(key);
    removeImageRuntimeCachesForKey(key);
  }
  const generation = _imageStoreGeneration;
  imageBitmapFailed.delete(key);
  const cacheStart = performance.now();
  const cacheMetrics = {
    cacheTotalMs: 0,
    cacheQueueWaitMs: 0,
    cacheBitmapMs: 0,
    cachePreviewMs: 0,
    cacheRenderScheduleMs: 0,
    cacheReadyStage: '',
  };
  const vpDbg = ViewportDebug.start('cacheImage', { key, src: displaySrc, reusedLoadedImage: false, bitmapOnly: true });
  const srcInfo = imageSourceDebugInfo(src);
  OpenDebug.step(dbg, 'cache-image:source', {
    imgKey: key,
    sourceKind: srcInfo.kind,
    sourceLen: srcInfo.length,
    sourcePrefix: srcInfo.prefix,
    skipSourceRegistration: options.skipSourceRegistration === true,
  });
  if (typeof ClipDebug !== 'undefined') {
    ClipDebug.step(dbg, 'cache-image:source', {
      imgKey: key,
      sourceKind: srcInfo.kind,
      sourceLen: srcInfo.length,
      sourcePrefix: srcInfo.prefix,
      skipSourceRegistration: options.skipSourceRegistration === true,
    });
  }
  let resolveReady;
  let readyResolved = false;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  imageReadyPromises.set(key, readyPromise);
  function resolveReadyOnce(stage) {
    if (readyResolved) return;
    readyResolved = true;
    cacheMetrics.cacheReadyStage = stage;
    cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
    const metadata = getImageDisplayMetadata(key);
    resolveReady({
      ...cacheMetrics,
      width: metadata?.width || 0,
      height: metadata?.height || 0,
      naturalWidth: metadata?.naturalWidth || 0,
      naturalHeight: metadata?.naturalHeight || 0,
    });
  }
  const queuedAt = performance.now();
  OpenDebug.step(dbg, 'cache-image:decode-queue:queued', { imgKey: key, active: _imageDecodeActive, queued: _imageDecodeQueue.length, bitmapOnly: true });
  enqueueImageDecode(async () => {
    const queueWaitMs = performance.now() - queuedAt;
    cacheMetrics.cacheQueueWaitMs = queueWaitMs;
    OpenDebug.step(dbg, 'cache-image:decode-queue:start', { imgKey: key, queueWaitMs, active: _imageDecodeActive, queued: _imageDecodeQueue.length, bitmapOnly: true });
    ViewportDebug.count('imageDecodes');
    ViewportDebug.step(vpDbg, 'decode', { skipped: true, reason: 'createImageBitmap-source' });
    OpenDebug.step(dbg, 'cache-image:decode', { imgKey: key, skipped: true, reason: 'createImageBitmap-source' });

    const bitmapStart = performance.now();
    try {
      const bitmap = await createImageBitmapForSource(src, displaySrc);
      const bitmapMs = performance.now() - bitmapStart;
      cacheMetrics.cacheBitmapMs = bitmapMs;
      if (!isImageDisplayCacheRequestCurrent(key, displaySrc, generation)) {
        bitmap.close?.();
        ViewportDebug.step(vpDbg, 'createImageBitmap:stale', { ms: bitmapMs });
        OpenDebug.step(dbg, 'cache-image:createImageBitmap:stale', { imgKey: key, ms: bitmapMs });
      } else {
        const selectedBitmap = imageBitmapCache[key] || bitmap;
        if (imageBitmapCache[key]) bitmap.close?.();
        else imageBitmapCache[key] = bitmap;
        setImageDisplayMetadata(key, selectedBitmap, displaySrc);
        ViewportDebug.count('imageBitmaps');
        ViewportDebug.max('maxImageBitmapMs', bitmapMs);
        ViewportDebug.step(vpDbg, 'createImageBitmap', { ms: bitmapMs, bitmapOnly: true });
        OpenDebug.step(dbg, 'cache-image:createImageBitmap', { imgKey: key, ms: bitmapMs, ok: true, bitmapOnly: true });
      }
    } catch (err) {
      const bitmapMs = performance.now() - bitmapStart;
      cacheMetrics.cacheBitmapMs = bitmapMs;
      if (isImageDisplayCacheRequestCurrent(key, displaySrc, generation)) imageBitmapFailed.add(key);
      ViewportDebug.count('imageBitmapFailures');
      ViewportDebug.max('maxImageBitmapMs', bitmapMs);
      ViewportDebug.step(vpDbg, 'createImageBitmap:error', { ms: bitmapMs, error: String(err), bitmapOnly: true });
      OpenDebug.step(dbg, 'cache-image:createImageBitmap:error', { imgKey: key, ms: bitmapMs, error: String(err), bitmapOnly: true });
    }

    if (!isImageDisplayCacheRequestCurrent(key, displaySrc, generation)) {
      cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
      ViewportDebug.end(vpDbg, { key, stale: true });
      OpenDebug.step(dbg, 'cache-image:stale', { imgKey: key, ms: cacheMetrics.cacheTotalMs });
      resolveReadyOnce('stale');
      return;
    }

    if (shouldPrepareImagePreviewDebug(dbg) && imageBitmapCache[key]) {
      const previewStart = performance.now();
      try {
        ensureImagePreviewBitmap(key, imageBitmapCache[key], dbg);
        const previewMs = performance.now() - previewStart;
        cacheMetrics.cachePreviewMs = previewMs;
        ViewportDebug.max('maxImagePreviewMs', previewMs);
        ViewportDebug.step(vpDbg, 'previewBitmap', { ms: previewMs });
        OpenDebug.step(dbg, 'cache-image:previewBitmap', { imgKey: key, ms: previewMs, ok: true });
      } catch (err) {
        const previewMs = performance.now() - previewStart;
        cacheMetrics.cachePreviewMs = previewMs;
        ViewportDebug.count('imagePreviewFailures');
        ViewportDebug.max('maxImagePreviewMs', previewMs);
        ViewportDebug.step(vpDbg, 'previewBitmap:error', { ms: previewMs, error: String(err) });
        OpenDebug.step(dbg, 'cache-image:previewBitmap:error', { imgKey: key, ms: previewMs, error: String(err) });
      }
    }

    const renderScheduleStart = performance.now();
    scheduleImageReadyRender('image-bitmap-ready', {
      minIntervalMs: options.readyRenderMinIntervalMs,
    });
    if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
      scheduleVisibleScaledVariantPrewarmAfterIdle('image-ready');
    }
    cacheMetrics.cacheRenderScheduleMs = performance.now() - renderScheduleStart;
    cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
    OpenDebug.step(dbg, 'cache-image:schedule-render', { imgKey: key, ms: cacheMetrics.cacheRenderScheduleMs });
    ViewportDebug.end(vpDbg, {
      key,
      decodeReady: !!imageBitmapCache[key],
      bitmapReady: !!imageBitmapCache[key],
      bitmapFailed: imageBitmapFailed.has(key),
    });
    OpenDebug.step(dbg, 'cache-image:done', {
      imgKey: key,
      ms: cacheMetrics.cacheTotalMs,
      queueWaitMs: cacheMetrics.cacheQueueWaitMs,
      bitmapMs: cacheMetrics.cacheBitmapMs,
      previewMs: cacheMetrics.cachePreviewMs,
      renderScheduleMs: cacheMetrics.cacheRenderScheduleMs,
      bitmapReady: !!imageBitmapCache[key],
      bitmapFailed: imageBitmapFailed.has(key),
      bitmapOnly: true,
    });
    if (imageBitmapCache[key]) resolveReadyOnce('bitmap');
    else resolveReadyOnce('error');
  });
  ViewportDebug.step(vpDbg, 'set-src', { src: displaySrc, bitmapOnly: true });
  OpenDebug.step(dbg, 'cache-image:set-src', {
    imgKey: key,
    sourceKind: srcInfo.kind,
    sourceLen: srcInfo.length,
    sourcePrefix: srcInfo.prefix,
    bitmapOnly: true,
  });
  if (typeof ClipDebug !== 'undefined') {
    ClipDebug.step(dbg, 'cache-image:set-src', {
      imgKey: key,
      sourceKind: srcInfo.kind,
      sourceLen: srcInfo.length,
      sourcePrefix: srcInfo.prefix,
      bitmapOnly: true,
    });
  }
  return readyPromise;
}

const removeImageRuntimeCachesForKey = (key) => {
  let removed = {
    displayImages: 0,
    bitmaps: 0,
    bitmapFailures: 0,
  };
  if (imageCache[key]) {
    delete imageCache[key];
    removed.displayImages++;
  }
  if (imageMetadataCache[key]) {
    delete imageMetadataCache[key];
    removed.displayImages++;
  }
  if (imageBitmapCache[key]) {
    try { imageBitmapCache[key].close(); } catch (_) {}
    delete imageBitmapCache[key];
    removed.bitmaps++;
  }
  if (imageBitmapFailed.delete(key)) removed.bitmapFailures++;
  imageReadyPromises.delete(key);
  clearScaledImageVariants(key);
  return removed;
};

const invalidateImageSourceCachesForKey = (key) => {
  if (!key) return;
  _imageStoreGeneration++;
  _imageHydrationQueued.delete(key);
  _imageHydrationQueue = _imageHydrationQueue.filter((item) => item?.key !== key);
  removeImageRuntimeCachesForKey(key);
};

const pruneImageCachesToKeys = (retainedKeys = new Set()) => {
  if (!retainedKeys || typeof retainedKeys.has !== 'function') {
    return { removedSources: 0 };
  }
  const keys = new Set();
  addImageRuntimeObjectKeysToSet(keys, imageStore);
  addImageRuntimeObjectKeysToSet(keys, imageCache);
  addImageRuntimeObjectKeysToSet(keys, imageMetadataCache);
  addImageRuntimeObjectKeysToSet(keys, imageBitmapCache);
  for (const key of imageBitmapFailed) keys.add(key);
  const removedSourceKeys = [];
  const result = {
    removedSources: 0,
    removedDisplayImages: 0,
    removedBitmaps: 0,
    removedBitmapFailures: 0,
  };
  for (const key of keys) {
    if (retainedKeys.has(key)) continue;
    if (Object.hasOwn(imageStore, key)) {
      revokeWebImageSource(imageStore[key]);
      delete imageStore[key];
      removedSourceKeys.push(key);
      result.removedSources++;
    }
    const removed = removeImageRuntimeCachesForKey(key);
    result.removedDisplayImages += removed.displayImages;
    result.removedBitmaps += removed.bitmaps;
    result.removedBitmapFailures += removed.bitmapFailures;
  }
  if (removedSourceKeys.length) {
    _imageStoreGeneration++;
  }
  return result;
};

function clearImageStore() {
  if (typeof clearVisibleHydrationTimer === 'function') clearVisibleHydrationTimer();
  _imageStoreGeneration++;
  for (const k of Object.keys(imageStore)) {
    revokeWebImageSource(imageStore[k]);
    delete imageStore[k];
  }
  for (const k of Object.keys(imageCache)) delete imageCache[k];
  for (const k of Object.keys(imageMetadataCache)) delete imageMetadataCache[k];
  for (const k of Object.keys(imageBitmapCache)) { imageBitmapCache[k].close(); delete imageBitmapCache[k]; }
  clearScaledImageVariants();
  imageBitmapFailed.clear();
  imageReadyPromises.clear();
  _imageHydrationQueue.length = 0;
  _imageHydrationQueued.clear();
  _imageHydrationScheduled = false;
  _imageDecodeQueue.length = 0;
  _imageDecodeActive = 0;
  _imageDecodeScheduled = false;
  _imageReadyLastRender = 0;
  imgKeyCounter = 1;
}

// ─── History ──────────────────────────────────────────────────────────────────
