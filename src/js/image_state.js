// ─── Image store (keeps base64 data OUT of boardHistory snapshots) ─────────────────
var imageStore = {};
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

function newImgKey() {
  let key;
  do {
    key = 'img-' + (imgKeyCounter++);
  } while (Object.hasOwn(imageStore, key));
  return key;
}

const isWebImageRef = (src) => !!globalThis.BoardfishWebBoardContainer?.isWebImageRef?.(src);

function imageStoreBytesEstimate(src) {
  if (typeof src === 'string') return src.length;
  if (isWebImageRef(src)) return Number(src.bytes || 0) || 0;
  return 0;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function imageSourceDebugInfo(src) {
  if (isWebImageRef(src)) {
    return {
      kind: 'web-ref',
      length: Number(src.bytes || 0) || '',
      prefix: src.path || '',
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
/* BOARDFISH_DEV_DIAGNOSTICS_END */

const isImageDisplayCacheRequestCurrent = (key, source, generation) => (
  generation === _imageStoreGeneration && imageStore[key] === source
);

function imageNeedsRendering(obj) {
  return !!(obj.data?.flipX || obj.data?.flipY || obj.data?.rotation);
}

function renderImageToCanvas(obj, sourceImg = null) {
  const transform = obj.data;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = ClipDebug.start('renderImageToCanvas', {
    id: obj?.id,
    imgKey: obj?.data?.imgKey,
    ...transform,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const img = sourceImg || imageBitmapCache[obj.data.imgKey];
  const sourceW = img?.naturalWidth || img?.width || 0;
  const sourceH = img?.naturalHeight || img?.height || 0;
  if (!img || !sourceW || !sourceH) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    ClipDebug.end(dbg, { ready: false });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return null;
  }
  const sideways = Math.abs(transform.rotation) % 180 === 90;
  const tmp = document.createElement('canvas');
  tmp.width = sideways ? sourceH : sourceW;
  tmp.height = sideways ? sourceW : sourceH;
  const tctx = tmp.getContext('2d');
  tctx.translate(tmp.width / 2, tmp.height / 2);
  tctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
  if (transform.rotation) tctx.rotate((transform.rotation * Math.PI) / 180);
  tctx.drawImage(img, -sourceW / 2, -sourceH / 2, sourceW, sourceH);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  ClipDebug.end(dbg, { ready: true, width: tmp.width, height: tmp.height });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return tmp;
}

function canvasToPngBlob(canvas) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = ClipDebug.start('canvasToPngBlob', { width: canvas?.width, height: canvas?.height });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      ClipDebug.end(dbg, { blobSize: blob?.size || 0 });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      resolve(blob);
    }, 'image/png');
  });
}

async function renderStoredImageToCanvas(obj, source = imageStore[obj?.data?.imgKey]) {
  if (!isWebImageRef(source) && (typeof source !== 'string' || !source)) return null;
  const bitmap = await createImageBitmapForSource(source).catch(() => null);
  if (!bitmap) return null;
  const canvas = renderImageToCanvas(obj, bitmap);
  bitmap.close?.();
  return canvas;
}

const bitmapSourceFromImageSource = async (source) => {
  if (typeof isWebImageRef === 'function' && isWebImageRef(source)) {
    const container = globalThis.BoardfishWebBoardContainer;
    const blob = container?.blobForImageSource?.(source);
    if (blob) return blob;
  }
  if (source && typeof Blob !== 'undefined' && source instanceof Blob) return source;
  if (typeof source === 'string' && source && typeof fetch === 'function') {
    const response = await fetch(source);
    if (!response.ok && !source.startsWith('data:') && !source.startsWith('blob:')) {
      throw new Error(`image fetch failed: ${response.status}`);
    }
    return response.blob();
  }
  return source;
};

const createImageBitmapForSource = async (source) => {
  if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap unavailable');
  const bitmapSource = await bitmapSourceFromImageSource(source);
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

function scheduleImageReadyRender() {
  if (_boardOpening) return;
  const now = performance.now();
  const intervalMs = _bulkImageInsertDepth > 0 ? BULK_IMAGE_READY_RENDER_INTERVAL_MS : IMAGE_READY_RENDER_INTERVAL_MS;
  if (now - _imageReadyLastRender <= intervalMs) return;
  _imageReadyLastRender = now;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  scheduleRender(true, null, 'image-bitmap-ready');
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') scheduleRender(true);
}

var _imageHydrationScheduled = false;
var _imageHydrationQueue = new Map();

function queueImageHydration(key
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const source = imageStore[key];
  if (!source || imageBitmapCache[key] || _imageHydrationQueue.has(key)) return;
  if (typeof source !== 'string' && !isWebImageRef(source)) return;
  _imageHydrationQueue.set(key
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
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
  for (const [key
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ] of _imageHydrationQueue) {
    if (count > 0 && performance.now() - batchStart >= 6) break;
    _imageHydrationQueue.delete(key);
    const source = imageStore[key];
    if (!source || imageBitmapCache[key]) continue;
    if (typeof source !== 'string' && !isWebImageRef(source)) continue;
    count++;
    try {
      cacheImage(key, source
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
    } catch
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      (err)
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      OpenDebug.step(dbg, 'hydrate-image:error', { imgKey: key, error: String(err) });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
  }
  if (_imageHydrationQueue.size) scheduleImageHydration();
}

function enqueueImageDecode(task) {
  _imageDecodeQueue.push(task);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  ViewportDebug.count('imageDecodeQueued');
  ViewportDebug.max('maxImageDecodeQueueDepth', _imageDecodeQueue.length + _imageDecodeActive);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
  const done = () => {
    _imageDecodeActive--;
    if (_imageDecodeQueue.length) scheduleImageDecodeQueue();
  };
  while (_imageDecodeActive < activeLimit && _imageDecodeQueue.length) {
    const task = _imageDecodeQueue.shift();
    _imageDecodeActive++;
    task().then(done, done);
  }
}

function cacheImage(key, src
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  if (!isWebImageRef(src) && (typeof src !== 'string' || !src)) return;
  let ready;
  if (!imageBitmapFailed.delete(key) && (ready = imageReadyPromises.get(key))) return ready;
  const generation = _imageStoreGeneration;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const cacheStart = performance.now();
  const cacheMetrics = {
    cacheTotalMs: 0,
    cacheQueueWaitMs: 0,
    cacheBitmapMs: 0,
    cacheRenderScheduleMs: 0,
    cacheReadyStage: '',
  };
  const srcInfo = imageSourceDebugInfo(src);
  const vpDbg = ViewportDebug.start('cacheImage', { key, src: srcInfo.prefix, bitmapOnly: true });
  OpenDebug.step(dbg, 'cache-image:source', {
    imgKey: key,
    sourceKind: srcInfo.kind,
    sourceLen: srcInfo.length,
    sourcePrefix: srcInfo.prefix,
  });
  if (typeof ClipDebug !== 'undefined') {
    ClipDebug.step(dbg, 'cache-image:source', {
      imgKey: key,
      sourceKind: srcInfo.kind,
      sourceLen: srcInfo.length,
      sourcePrefix: srcInfo.prefix,
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let resolveReady;
  ready = new Promise((resolve) => { resolveReady = resolve; });
  imageReadyPromises.set(key, ready);
  function resolveReadyOnce(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    stage
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    cacheMetrics.cacheReadyStage = stage;
    cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
    const bitmap = imageBitmapCache[key];
    const width = bitmap?.width || 0;
    const height = bitmap?.height || 0;
    const dimensions = {
      width,
      height,
      naturalWidth: width,
      naturalHeight: height,
    };
    resolveReady({ ...cacheMetrics, ...dimensions });
    return;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    resolveReady();
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const queuedAt = performance.now();
  OpenDebug.step(dbg, 'cache-image:decode-queue:queued', { imgKey: key, active: _imageDecodeActive, queued: _imageDecodeQueue.length, bitmapOnly: true });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  enqueueImageDecode(async () => {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const queueWaitMs = performance.now() - queuedAt;
    cacheMetrics.cacheQueueWaitMs = queueWaitMs;
    OpenDebug.step(dbg, 'cache-image:decode-queue:start', { imgKey: key, queueWaitMs, active: _imageDecodeActive, queued: _imageDecodeQueue.length, bitmapOnly: true });
    ViewportDebug.count('imageDecodes');
    ViewportDebug.step(vpDbg, 'decode', { skipped: true, reason: 'createImageBitmap-source' });
    OpenDebug.step(dbg, 'cache-image:decode', { imgKey: key, skipped: true, reason: 'createImageBitmap-source' });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */

    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const bitmapStart = performance.now();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    let same;
    try {
      const bitmap = await createImageBitmapForSource(src);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const bitmapMs = performance.now() - bitmapStart;
      cacheMetrics.cacheBitmapMs = bitmapMs;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      same = isImageDisplayCacheRequestCurrent(key, src, generation);
      if (!same) {
        bitmap.close?.();
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        ViewportDebug.step(vpDbg, 'createImageBitmap:stale', { ms: bitmapMs });
        OpenDebug.step(dbg, 'cache-image:createImageBitmap:stale', { imgKey: key, ms: bitmapMs });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } else {
        let selectedBitmap = imageBitmapCache[key];
        if (selectedBitmap) bitmap.close?.();
        else imageBitmapCache[key] = selectedBitmap = bitmap;
        const warmupMeta = { kind: 'full-image', key };
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        warmupMeta.source = 'cache-image';
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        scheduleDrawableBitmapWarmup(selectedBitmap, warmupMeta);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const variantQueue =
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        queueScaledImageVariantForReadyImage(key, selectedBitmap, false);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        OpenDebug.step(dbg, 'cache-image:queue-scaled-variant', {
          imgKey: key,
          scale: variantQueue?.scale ?? '',
          queued: variantQueue?.queued === true,
          skipped: variantQueue?.skipped || '',
          priority: false,
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        ViewportDebug.count('imageBitmaps');
        ViewportDebug.max('maxImageBitmapMs', bitmapMs);
        ViewportDebug.step(vpDbg, 'createImageBitmap', { ms: bitmapMs, bitmapOnly: true });
        OpenDebug.step(dbg, 'cache-image:createImageBitmap', { imgKey: key, ms: bitmapMs, ok: true, bitmapOnly: true });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
    } catch
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      (err)
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const bitmapMs = performance.now() - bitmapStart;
      cacheMetrics.cacheBitmapMs = bitmapMs;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      same = isImageDisplayCacheRequestCurrent(key, src, generation);
      if (same) imageBitmapFailed.add(key);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      ViewportDebug.count('imageBitmapFailures');
      ViewportDebug.max('maxImageBitmapMs', bitmapMs);
      ViewportDebug.step(vpDbg, 'createImageBitmap:error', { ms: bitmapMs, error: String(err), bitmapOnly: true });
      OpenDebug.step(dbg, 'cache-image:createImageBitmap:error', { imgKey: key, ms: bitmapMs, error: String(err), bitmapOnly: true });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }

    if (!same) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
      ViewportDebug.end(vpDbg, { key, stale: true });
      OpenDebug.step(dbg, 'cache-image:stale', { imgKey: key, ms: cacheMetrics.cacheTotalMs });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (imageReadyPromises.get(key) === ready) imageReadyPromises.delete(key);
      if (!imageBitmapCache[key]) queueImageHydration(key
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
      resolveReadyOnce(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        'stale'
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
      return;
    }

    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const renderScheduleStart = performance.now();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    scheduleImageReadyRender();
    scheduleVisibleImageWorkAfterIdle();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    cacheMetrics.cacheRenderScheduleMs = performance.now() - renderScheduleStart;
    cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
    OpenDebug.step(dbg, 'cache-image:schedule-render', {
      imgKey: key,
      ms: cacheMetrics.cacheRenderScheduleMs,
    });
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
      renderScheduleMs: cacheMetrics.cacheRenderScheduleMs,
      bitmapReady: !!imageBitmapCache[key],
      bitmapFailed: imageBitmapFailed.has(key),
      bitmapOnly: true,
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    resolveReadyOnce(
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      imageBitmapCache[key] ? 'bitmap' : 'error'
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    );
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  ViewportDebug.step(vpDbg, 'set-src', { src: srcInfo.prefix, bitmapOnly: true });
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
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return ready;
}

const removeImageRuntimeCachesForKey = (key) => {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const removed = {
    bitmaps: 0,
    bitmapFailures: 0,
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const bitmap = imageBitmapCache[key];
  if (bitmap) {
    dropDrawableBitmapWarmup(bitmap);
    try { bitmap.close(); } catch (_) {}
    delete imageBitmapCache[key];
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    removed.bitmaps++;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const removedBitmapFailure =
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  imageBitmapFailed.delete(key);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (removedBitmapFailure) removed.bitmapFailures++;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  imageReadyPromises.delete(key);
  clearScaledImageVariants(key);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return removed;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

const invalidateImageSourceCachesForKey = (key) => {
  if (!key) return;
  _imageStoreGeneration++;
  _imageHydrationQueue.delete(key);
  removeImageRuntimeCachesForKey(key);
};

const pruneImageCachesToKeys = (retainedKeys = new Set()) => {
  if (!retainedKeys || typeof retainedKeys.has !== 'function') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { removedSources: 0 };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return;
  }
  const keys = new Set();
  addImageRuntimeObjectKeysToSet(keys, imageStore);
  addImageRuntimeObjectKeysToSet(keys, imageBitmapCache);
  for (const key of imageBitmapFailed) keys.add(key);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const result = {
    removedSources: 0,
    removedBitmaps: 0,
    removedBitmapFailures: 0,
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (const key of keys) {
    if (retainedKeys.has(key)) continue;
    if (Object.hasOwn(imageStore, key)) {
      delete imageStore[key];
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      result.removedSources++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const removed =
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    removeImageRuntimeCachesForKey(key);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    result.removedBitmaps += removed.bitmaps;
    result.removedBitmapFailures += removed.bitmapFailures;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return result;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

function clearImageStore() {
  _imageStoreGeneration++;
  imageStore = {};
  for (const k in imageBitmapCache) {
    if (!Object.prototype.hasOwnProperty.call(imageBitmapCache, k)) continue;
    try { imageBitmapCache[k].close(); } catch (_) {}
  }
  imageBitmapCache = {};
  clearScaledImageVariants();
  imageBitmapFailed.clear();
  imageReadyPromises.clear();
  _imageHydrationQueue.clear();
  _imageDecodeQueue.length = 0;
  _imageDecodeScheduled = false;
  _imageReadyLastRender = 0;
  imgKeyCounter = 1;
}

// ─── History ──────────────────────────────────────────────────────────────────
