// ─── Image store (keeps base64 data OUT of boardHistory snapshots) ─────────────────
var imageStore = {};
var imageCache = {}; // key -> HTMLImageElement (for clipboard/metadata operations)
var imageAssetUrlCache = {}; // key -> Tauri asset URL for display-only native images
var imageBitmapCache = {}; // key -> ImageBitmap (GPU-resident, never evicted by WebKit)
var imageBitmapFailed = new Set();
var imageReadbackSafeSourceCache = new Map();
var imageSourceCachePromises = new Map();
var imageHydrationPromises = new Map();
var imageAssetMaterializePromises = new Map();
var imgKeyCounter = 1;
var _skipImageSourceRegistration = false;
var _imageStoreGeneration = 0;
var _imageDecodeQueue = [];
var _imageDecodeActive = 0;
var _imageDecodeScheduled = false;
var MAX_IMAGE_DECODE_ACTIVE = 2;
var imageReadyPromises = new Map();
var imageSourceRequestCounter = 1;

function newImgKey() { return 'img-' + (imgKeyCounter++); }

function isNativeImageRef(src) {
  return !!(src && typeof src === 'object' && src.native);
}

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
  if (isNativeImageRef(src)) return JSON.stringify(src).length;
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
      kind: isNativeImageRef(src) ? 'native-ref' : typeof src,
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

const createImageSourceToken = (key) => {
  return `${key || 'img'}:${Date.now().toString(36)}:${imageSourceRequestCounter++}`;
};

const cleanupNativeImageSourceToken = (key, sourceToken) => {
  if (!key || !sourceToken || !hasTauri()) return;
  BoardfishTauri.removeCachedImageSources([key], [sourceToken])
    .catch((err) => console.warn('[image-source-cache] stale source cleanup failed:', err));
};

const isImageSourceRequestCurrent = (key, expectedSource, generation) => {
  return generation === _imageStoreGeneration && imageStore[key] === expectedSource;
};

const isImageDisplayCacheRequestCurrent = (key, src, generation) => {
  if (generation !== _imageStoreGeneration) return false;
  const stored = imageStore[key];
  if (typeof stored === 'string') return stored === src;
  if (isNativeImageRef(stored)) return !!src && imageAssetUrlCache[key] === src;
  if (isWebImageRef(stored)) return !!src && webImageDisplaySrc(stored) === src;
  return false;
};

function cacheImageSourceForSave(key, src, dbg = null) {
  if (!hasTauri() || !src || isNativeImageRef(src)) return Promise.resolve();
  const existing = imageSourceCachePromises.get(key);
  if (existing) return existing;
  const generation = _imageStoreGeneration;
  const sourceToken = createImageSourceToken(key);
  const promise = SaveDebug.wrap(dbg, TAURI_COMMANDS.REGISTER_IMAGE_SOURCE, () => BoardfishTauri.registerImageSource(key, src, sourceToken), { imgKey: key, dataUrl: src })
    .then((result) => {
      if (!isImageSourceRequestCurrent(key, src, generation)) {
        cleanupNativeImageSourceToken(key, sourceToken);
        return result;
      }
      if (typeof noteEyedropperImageAvailable === 'function') noteEyedropperImageAvailable(key, 'image-source-ready');
      return result;
    })
    .finally(() => imageSourceCachePromises.delete(key));
  imageSourceCachePromises.set(key, promise);
  return promise;
}

function cacheImageSourceForExport(key, src, dbg = null) {
  if (!hasTauri() || !src || isNativeImageRef(src)) return Promise.resolve();
  const existing = imageSourceCachePromises.get(key);
  if (existing) {
    ExportDebug.step(dbg, 'register:reuse-pending', { imgKey: key });
    return existing;
  }
  const generation = _imageStoreGeneration;
  const sourceToken = createImageSourceToken(key);
  const promise = ExportDebug.wrap(dbg, TAURI_COMMANDS.REGISTER_IMAGE_SOURCE, () => BoardfishTauri.registerImageSource(key, src, sourceToken), { imgKey: key })
    .then((result) => {
      if (!isImageSourceRequestCurrent(key, src, generation)) {
        cleanupNativeImageSourceToken(key, sourceToken);
        return result;
      }
      if (typeof noteEyedropperImageAvailable === 'function') noteEyedropperImageAvailable(key, 'image-source-ready');
      return result;
    })
    .finally(() => imageSourceCachePromises.delete(key));
  imageSourceCachePromises.set(key, promise);
  return promise;
}

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
  const img = sourceImg || imageCache[obj.data.imgKey];
  if (!img || !img.complete || !img.naturalWidth) {
    ClipDebug.end(dbg, { ready: false });
    return null;
  }
  const sourceW = img.naturalWidth;
  const sourceH = img.naturalHeight;
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
  const baseMeta = {
    objectId: obj?.id,
    imgKey,
    ...transform,
    needsRender: imageNeedsRendering(obj),
    storedKind: isNativeImageRef(imageStore[imgKey]) ? 'native-ref' : typeof imageStore[imgKey],
    storedMB: Math.round(imageStoreBytesEstimate(imageStore[imgKey]) / 1024 / 1024 * 100) / 100,
  };
  const totalStart = performance.now();
  const sourceStart = performance.now();
  const src = await ensureImageDataUrl(imgKey);
  const sourceMs = performance.now() - sourceStart;
  const sourceKind = baseMeta.storedKind === 'native-ref'
    ? 'hydrated-native-ref'
    : (typeof imageStore[imgKey] === 'string' ? 'data-url' : baseMeta.storedKind);
  if (!src || !imageNeedsRendering(obj)) {
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

  const loadStart = performance.now();
  const img = await loadImageElement(src).catch((err) => {
    ExportDebug.step(dbg, 'render:image-load-error', { ...baseMeta, sourceMs, error: String(err) });
    return null;
  });
  const loadMs = performance.now() - loadStart;
  if (!img) {
    ExportDebug.step(dbg, 'render:done', {
      ...baseMeta,
      sourceKind,
      sourceMs,
      loadMs,
      totalRenderMs: performance.now() - totalStart,
      hasDataUrl: false,
      ok: false,
      error: 'image load failed',
    });
    return '';
  }

  const drawStart = performance.now();
  const canvas = renderImageToCanvas(obj, img);
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

function loadImageElement(src, options = {}) {
  const timeoutMs = typeof options === 'number' ? options : (options.timeoutMs || 10000);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const crossOrigin = typeof options === 'object' ? options.crossOrigin : '';
    if (crossOrigin) img.crossOrigin = crossOrigin;
    let settled = false;
    const done = (fn) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timeout = () => reject(new Error('image load timed out'));
    const timer = setTimeout(() => done(timeout)(), timeoutMs);
    img.onload = done(() => resolve(img));
    img.onerror = done(() => reject(new Error('image load failed')));
    img.src = src;
  });
}

function imageReadbackProbeKey(src) {
  if (typeof src !== 'string') return '';
  return src.length > 512 ? `${src.length}:${src.slice(0, 256)}:${src.slice(-128)}` : src;
}

function probeImageCanvasReadback(img, src = '') {
  if (!img || !img.naturalWidth || !img.naturalHeight) return false;
  const cacheKey = imageReadbackProbeKey(src);
  if (cacheKey && imageReadbackSafeSourceCache.has(cacheKey)) {
    return imageReadbackSafeSourceCache.get(cacheKey);
  }
  let safe = false;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const probeCtx = probe.getContext('2d', { willReadFrequently: true });
    probeCtx.drawImage(img, 0, 0, 1, 1);
    probeCtx.getImageData(0, 0, 1, 1);
    safe = true;
  } catch (_) {
    safe = false;
  }
  if (cacheKey) imageReadbackSafeSourceCache.set(cacheKey, safe);
  return safe;
}

function shouldSkipReadbackProbeForNativeDisplaySource(key, src) {
  if (!isNativeImageRef(imageStore[key])) return false;
  return !!src && imageAssetUrlCache[key] === src;
}

async function ensureCanvasSafeNativeImageDataUrl(key, unsafeSrc = '', dbg = null) {
  if (!hasTauri() || !isNativeImageRef(imageStore[key])) return '';
  if (imageAssetUrlCache[key] === unsafeSrc) delete imageAssetUrlCache[key];
  ViewportDebug.step(dbg, 'readback-fallback:start', { key, from: unsafeSrc ? 'unsafe-display-src' : 'native-ref' });
  const dataUrl = await ensureImageDataUrl(key, dbg);
  ViewportDebug.step(dbg, 'readback-fallback:end', { key, dataUrlLen: dataUrl?.length || 0 });
  return dataUrl;
}

function convertTauriFileSrc(path) {
  if (typeof path === 'string' && path.startsWith('data:')) {
    const info = imageSourceDebugInfo(path);
    console.warn('[Boardfish image] convertTauriFileSrc received data URL', info);
    if (typeof ClipDebug !== 'undefined') {
      const dbg = ClipDebug.start('convertTauriFileSrc', info);
      ClipDebug.end(dbg, { error: 'data-url-used-as-file-src', ...info });
    }
    return path;
  }
  return tauriConvertFileSrc(path);
}

function scheduleImageReadyRender(source = 'image-load') {
  invalidateOffscreen();
  const now = performance.now();
  if (now - _imageReadyLastRender > 120) {
    _imageReadyLastRender = now;
    scheduleRender(true, false, source);
  } else {
    scheduleRender(false, true, `${source}-overlay`);
  }
}

async function materializeImageAssets(keys, dbg = null) {
  const pending = keys.filter((key) => isNativeImageRef(imageStore[key]) && !imageAssetUrlCache[key]);
  if (!pending.length || !hasTauri()) {
    OpenDebug.step(dbg, 'materialize-image-assets:skip', { requested: keys.length, pending: pending.length, tauri: hasTauri() });
    return 0;
  }
  const promiseKey = pending.slice().sort().join('|');
  const existing = imageAssetMaterializePromises.get(promiseKey);
  if (existing) return existing;
  const generation = _imageStoreGeneration;
  const promise = OpenDebug.wrap(
    dbg,
    TAURI_COMMANDS.MATERIALIZE_CACHED_IMAGE_SOURCES,
    () => BoardfishTauri.materializeCachedImageSources(pending),
    { count: pending.length }
  )
    .then((entries) => {
      let count = 0;
      let skipped = 0;
      if (generation !== _imageStoreGeneration) return 0;
      for (const entry of entries || []) {
        const key = entry.img_key || entry.imgKey;
        if (!key || !entry.path || !isNativeImageRef(imageStore[key])) {
          skipped++;
          continue;
        }
        const pathInfo = imageSourceDebugInfo(entry.path);
        OpenDebug.step(dbg, 'materialize-image-assets:entry', {
          imgKey: key,
          pathKind: pathInfo.kind,
          pathLen: pathInfo.length,
          pathPrefix: pathInfo.prefix,
        });
        if (typeof ClipDebug !== 'undefined') {
          ClipDebug.step(dbg, 'materialize-image-assets:entry', {
            imgKey: key,
            pathKind: pathInfo.kind,
            pathLen: pathInfo.length,
            pathPrefix: pathInfo.prefix,
          });
        }
        imageAssetUrlCache[key] = convertTauriFileSrc(entry.path);
        const assetInfo = imageSourceDebugInfo(imageAssetUrlCache[key]);
        OpenDebug.step(dbg, 'materialize-image-assets:asset-url', {
          imgKey: key,
          assetKind: assetInfo.kind,
          assetLen: assetInfo.length,
          assetPrefix: assetInfo.prefix,
        });
        if (typeof ClipDebug !== 'undefined') {
          ClipDebug.step(dbg, 'materialize-image-assets:asset-url', {
            imgKey: key,
            assetKind: assetInfo.kind,
            assetLen: assetInfo.length,
            assetPrefix: assetInfo.prefix,
          });
        }
        count++;
      }
      OpenDebug.step(dbg, 'materialize-image-assets', { requested: pending.length, returned: entries?.length || 0, count, skipped });
      return count;
    })
    .finally(() => imageAssetMaterializePromises.delete(promiseKey));
  imageAssetMaterializePromises.set(promiseKey, promise);
  return promise;
}

async function ensureImageDisplaySrc(key, dbg = null) {
  if (imageAssetUrlCache[key]) return { src: imageAssetUrlCache[key], source: 'asset', dataUrlLen: 0 };
  const stored = imageStore[key];
  if (typeof stored === 'string') return { src: stored, source: 'data-url', dataUrlLen: stored.length };
  if (isWebImageRef(stored)) return { src: webImageDisplaySrc(stored), source: 'web-blob', dataUrlLen: 0 };
  if (!isNativeImageRef(stored)) {
    OpenDebug.step(dbg, 'ensure-image-display-src:missing', { imgKey: key, kind: imageRefKind(stored), hasStore: !!stored });
    return { src: '', source: 'missing', dataUrlLen: 0 };
  }
  try {
    await materializeImageAssets([key], dbg);
    if (imageAssetUrlCache[key]) return { src: imageAssetUrlCache[key], source: 'asset', dataUrlLen: 0 };
  } catch (err) {
    OpenDebug.step(dbg, 'materialize-image-assets:error', { imgKey: key, error: String(err) });
  }
  const dataUrl = await ensureImageDataUrl(key, dbg);
  return { src: dataUrl, source: 'data-url-fallback', dataUrlLen: dataUrl?.length || 0 };
}

async function ensureImageDataUrl(key, dbg = null) {
  const src = imageStore[key];
  if (typeof src === 'string') return src;
  if (isWebImageRef(src)) return webImageDataUrl(src);
  if (!isNativeImageRef(src) || !hasTauri()) return '';
  const existing = imageHydrationPromises.get(key);
  if (existing) return existing;
  const generation = _imageStoreGeneration;
  const promise = OpenDebug.wrap(dbg, TAURI_COMMANDS.GET_CACHED_IMAGE_DATA_URL, () => BoardfishTauri.getCachedImageDataUrl(key), { imgKey: key })
    .then((dataUrl) => {
      if (generation === _imageStoreGeneration && isNativeImageRef(imageStore[key])) imageStore[key] = dataUrl;
      return dataUrl;
    })
    .finally(() => imageHydrationPromises.delete(key));
  imageHydrationPromises.set(key, promise);
  return promise;
}
var _imageHydrationScheduled = false;
var _imageHydrationQueue = [];
var _imageHydrationQueued = new Set();

function queueImageHydration(key, dbg = null) {
  if (!isNativeImageRef(imageStore[key]) || imageCache[key] || _imageHydrationQueued.has(key)) return;
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
    if (!isNativeImageRef(imageStore[key]) || imageCache[key]) continue;
    count++;
    ensureImageDataUrl(key, dbg)
      .then((dataUrl) => {
        if (dataUrl && !imageCache[key]) cacheImage(key, dataUrl);
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
  while (_imageDecodeActive < MAX_IMAGE_DECODE_ACTIVE && _imageDecodeQueue.length) {
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

async function ensureImagePreviewBitmap(key, img, dbg = null) {
  const t0 = performance.now();
  // Placeholder hook for future lower-resolution previews. The timing is kept
  // separate from ImageBitmap creation so readiness reports show the true stage.
  ViewportDebug.count('imagePreviewPrepared');
  const ms = performance.now() - t0;
  ViewportDebug.max('maxImagePreviewMs', ms);
  if (dbg) ViewportDebug.step(dbg, 'previewBitmap', { key, ms, skipped: true });
}

function cacheImage(key, src, dbg = null, loadedImg = null, options = {}) {
  if (imageCache[key]) return imageReadyPromiseForKey(key);
  if (isNativeImageRef(src)) return;
  const displaySrc = isWebImageRef(src) ? webImageDisplaySrc(src) : src;
  if (typeof displaySrc !== 'string' || !displaySrc) return;
  const generation = _imageStoreGeneration;
  imageBitmapFailed.delete(key);
  const cacheStart = performance.now();
  const cacheMetrics = {
    cacheTotalMs: 0,
    cacheQueueWaitMs: 0,
    cacheBitmapMs: 0,
    cachePreviewMs: 0,
    cacheRenderScheduleMs: 0,
    cacheReadbackProbeMs: 0,
    skippedReadbackProbe: '',
    requiredReadbackSafe: options.requireReadbackSafe === true,
    readbackSafe: '',
  };
  const vpDbg = ViewportDebug.start('cacheImage', { key, src: displaySrc, reusedLoadedImage: !!loadedImg });
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
  let img = loadedImg || new Image();
  let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  imageReadyPromises.set(key, readyPromise);
  // ImageBitmap creation handles decode work for the renderer. Keeping this in a
  // bounded queue avoids serializing large-image hydration while still limiting
  // memory pressure during board open.
  const loadStart = performance.now();
  function finishLoadForImage(loaded, loadedSrc, reusedLoadedImage = false) {
    if (!isImageDisplayCacheRequestCurrent(key, loadedSrc, generation)) {
      cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
      ViewportDebug.end(vpDbg, { key, stale: true });
      OpenDebug.step(dbg, 'cache-image:stale', { imgKey: key, ms: cacheMetrics.cacheTotalMs });
      resolveReady(cacheMetrics);
      return;
    }
    const loadMs = performance.now() - loadStart;
    ViewportDebug.count('imageLoads');
    ViewportDebug.max('maxImageLoadMs', loadMs);
    ViewportDebug.step(vpDbg, 'load', { width: loaded.naturalWidth, height: loaded.naturalHeight, ms: loadMs, src: loadedSrc, reusedLoadedImage });
    OpenDebug.step(dbg, 'cache-image:load', {
      imgKey: key,
      ms: loadMs,
      width: loaded.naturalWidth,
      height: loaded.naturalHeight,
      reusedLoadedImage,
    });

    const needsReadbackSafe = options.requireReadbackSafe === true;
    const readbackProbeStart = performance.now();
    const skipReadbackProbe = !needsReadbackSafe || shouldSkipReadbackProbeForNativeDisplaySource(key, loadedSrc);
    const readbackSafe = skipReadbackProbe ? !needsReadbackSafe : probeImageCanvasReadback(loaded, loadedSrc);
    const readbackProbeMs = performance.now() - readbackProbeStart;
    cacheMetrics.cacheReadbackProbeMs += readbackProbeMs;
    cacheMetrics.skippedReadbackProbe = skipReadbackProbe;
    cacheMetrics.readbackSafe = readbackSafe;
    ViewportDebug.step(vpDbg, 'readback-probe', { key, safe: readbackSafe, skipped: skipReadbackProbe, required: needsReadbackSafe, src: loadedSrc });
    OpenDebug.step(dbg, 'cache-image:readback-probe', {
      imgKey: key,
      ms: readbackProbeMs,
      safe: readbackSafe,
      skipped: skipReadbackProbe,
      required: needsReadbackSafe,
    });
    if (needsReadbackSafe && !readbackSafe) {
      ViewportDebug.count('imageReadbackUnsafeDisplaySources');
      OpenDebug.step(dbg, 'cache-image:readback-fallback:start', { imgKey: key });
      ensureCanvasSafeNativeImageDataUrl(key, loadedSrc, vpDbg)
        .then(async (safeSrc) => {
          if (!safeSrc || safeSrc === loadedSrc) throw new Error('no safe fallback image source');
          OpenDebug.step(dbg, 'cache-image:readback-fallback:loaded-src', { imgKey: key, dataUrlLen: safeSrc.length });
          const safeImg = await loadImageElement(safeSrc);
          finishLoadForImage(safeImg, safeSrc, false);
        })
        .catch((err) => {
          cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
          if (generation === _imageStoreGeneration && imageStore[key]) {
            imageBitmapFailed.add(key);
            ViewportDebug.end(vpDbg, { key, error: 'image readback probe failed', fallbackError: String(err) });
            OpenDebug.step(dbg, 'cache-image:readback-fallback:error', { imgKey: key, ms: cacheMetrics.cacheTotalMs, error: String(err) });
          } else {
            ViewportDebug.end(vpDbg, { key, stale: true, fallbackError: String(err) });
            OpenDebug.step(dbg, 'cache-image:readback-fallback:stale', { imgKey: key, ms: cacheMetrics.cacheTotalMs, error: String(err) });
          }
          resolveReady(cacheMetrics);
        });
      return;
    }

    img = loaded;
    imageCache[key] = loaded;
    if (typeof noteEyedropperImageAvailable === 'function') noteEyedropperImageAvailable(key, 'image-load');

    const queuedAt = performance.now();
    OpenDebug.step(dbg, 'cache-image:decode-queue:queued', { imgKey: key, active: _imageDecodeActive, queued: _imageDecodeQueue.length });
    enqueueImageDecode(async () => {
      const queueWaitMs = performance.now() - queuedAt;
      cacheMetrics.cacheQueueWaitMs = queueWaitMs;
      OpenDebug.step(dbg, 'cache-image:decode-queue:start', { imgKey: key, queueWaitMs, active: _imageDecodeActive, queued: _imageDecodeQueue.length });
      ViewportDebug.count('imageDecodes');
      ViewportDebug.step(vpDbg, 'decode', { skipped: true, reason: 'createImageBitmap' });
      OpenDebug.step(dbg, 'cache-image:decode', { imgKey: key, skipped: true, reason: 'createImageBitmap' });

      const bitmapStart = performance.now();
      try {
        const bitmap = await createImageBitmap(loaded);
        const bitmapMs = performance.now() - bitmapStart;
        cacheMetrics.cacheBitmapMs = bitmapMs;
        if (!isImageDisplayCacheRequestCurrent(key, loadedSrc, generation)) {
          bitmap.close();
          ViewportDebug.step(vpDbg, 'createImageBitmap:stale', { ms: bitmapMs });
          OpenDebug.step(dbg, 'cache-image:createImageBitmap:stale', { imgKey: key, ms: bitmapMs });
        } else {
          imageBitmapCache[key] = bitmap;
          ViewportDebug.count('imageBitmaps');
          ViewportDebug.max('maxImageBitmapMs', bitmapMs);
          ViewportDebug.step(vpDbg, 'createImageBitmap', { ms: bitmapMs });
          OpenDebug.step(dbg, 'cache-image:createImageBitmap', { imgKey: key, ms: bitmapMs, ok: true });
        }
      } catch (err) {
        const bitmapMs = performance.now() - bitmapStart;
        cacheMetrics.cacheBitmapMs = bitmapMs;
        if (isImageDisplayCacheRequestCurrent(key, loadedSrc, generation)) imageBitmapFailed.add(key);
        ViewportDebug.count('imageBitmapFailures');
        ViewportDebug.max('maxImageBitmapMs', bitmapMs);
        ViewportDebug.step(vpDbg, 'createImageBitmap:error', { ms: bitmapMs, error: String(err) });
        OpenDebug.step(dbg, 'cache-image:createImageBitmap:error', { imgKey: key, ms: bitmapMs, error: String(err) });
      }

      if (!isImageDisplayCacheRequestCurrent(key, loadedSrc, generation)) {
        cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
        ViewportDebug.end(vpDbg, { key, stale: true });
        OpenDebug.step(dbg, 'cache-image:stale', { imgKey: key, ms: cacheMetrics.cacheTotalMs });
        resolveReady(cacheMetrics);
        return;
      }

      const previewStart = performance.now();
      try {
        await ensureImagePreviewBitmap(key, loaded, dbg);
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
      } finally {
        const renderScheduleStart = performance.now();
        scheduleImageReadyRender('image-load');
        if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
          scheduleVisibleScaledVariantPrewarmAfterIdle('image-ready');
        }
        cacheMetrics.cacheRenderScheduleMs = performance.now() - renderScheduleStart;
        cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
        OpenDebug.step(dbg, 'cache-image:schedule-render', { imgKey: key, ms: cacheMetrics.cacheRenderScheduleMs });
        ViewportDebug.end(vpDbg, {
          key,
          decodeReady: true,
          bitmapReady: !!imageBitmapCache[key],
          bitmapFailed: imageBitmapFailed.has(key),
          readbackSafe,
        });
        OpenDebug.step(dbg, 'cache-image:done', {
          imgKey: key,
          ms: cacheMetrics.cacheTotalMs,
          queueWaitMs: cacheMetrics.cacheQueueWaitMs,
          bitmapMs: cacheMetrics.cacheBitmapMs,
          previewMs: cacheMetrics.cachePreviewMs,
          renderScheduleMs: cacheMetrics.cacheRenderScheduleMs,
          readbackProbeMs: cacheMetrics.cacheReadbackProbeMs,
          skippedReadbackProbe: cacheMetrics.skippedReadbackProbe,
          requiredReadbackSafe: cacheMetrics.requiredReadbackSafe,
          readbackSafe,
          bitmapReady: !!imageBitmapCache[key],
          bitmapFailed: imageBitmapFailed.has(key),
        });
        resolveReady(cacheMetrics);
      }
    });
  }
  img.onload = () => finishLoadForImage(img, displaySrc, !!loadedImg);
  img.onerror = () => {
    if (!isImageDisplayCacheRequestCurrent(key, displaySrc, generation)) {
      cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
      ViewportDebug.end(vpDbg, { key, stale: true, error: 'image load failed' });
      OpenDebug.step(dbg, 'cache-image:stale-load-error', { imgKey: key, ms: cacheMetrics.cacheTotalMs });
      resolveReady(cacheMetrics);
      return;
    }
    imageBitmapFailed.add(key);
    cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
    ViewportDebug.end(vpDbg, { key, error: 'image load failed' });
    OpenDebug.step(dbg, 'cache-image:load-error', {
      imgKey: key,
      ms: cacheMetrics.cacheTotalMs,
      error: 'image load failed',
      sourceKind: srcInfo.kind,
      sourceLen: srcInfo.length,
      sourcePrefix: srcInfo.prefix,
    });
    if (typeof ClipDebug !== 'undefined') {
      ClipDebug.step(dbg, 'cache-image:load-error', {
        imgKey: key,
        ms: cacheMetrics.cacheTotalMs,
        error: 'image load failed',
        sourceKind: srcInfo.kind,
        sourceLen: srcInfo.length,
        sourcePrefix: srcInfo.prefix,
      });
    }
    resolveReady(cacheMetrics);
  };
  if (loadedImg) {
    ViewportDebug.step(vpDbg, 'reuse-loaded-image', { width: img.naturalWidth, height: img.naturalHeight });
    OpenDebug.step(dbg, 'cache-image:reuse-loaded-image', { imgKey: key, width: img.naturalWidth, height: img.naturalHeight });
    finishLoadForImage(img, displaySrc, true);
  } else {
    img.src = displaySrc;
    ViewportDebug.step(vpDbg, 'set-src', { src: displaySrc });
    OpenDebug.step(dbg, 'cache-image:set-src', {
      imgKey: key,
      sourceKind: srcInfo.kind,
      sourceLen: srcInfo.length,
      sourcePrefix: srcInfo.prefix,
    });
    if (typeof ClipDebug !== 'undefined') {
      ClipDebug.step(dbg, 'cache-image:set-src', {
        imgKey: key,
        sourceKind: srcInfo.kind,
        sourceLen: srcInfo.length,
        sourcePrefix: srcInfo.prefix,
      });
    }
  }
  if (!_skipImageSourceRegistration && !options.skipSourceRegistration) cacheImageSourceForSave(key, src).catch(() => {});
  return readyPromise;
}

const removeImageRuntimeCachesForKey = (key) => {
  let removed = {
    displayImages: 0,
    assetUrls: 0,
    bitmaps: 0,
    bitmapFailures: 0,
    scaledVariants: 0,
  };
  if (imageCache[key]) {
    delete imageCache[key];
    removed.displayImages++;
  }
  if (imageAssetUrlCache[key]) {
    delete imageAssetUrlCache[key];
    removed.assetUrls++;
  }
  if (imageBitmapCache[key]) {
    try { imageBitmapCache[key].close(); } catch (_) {}
    delete imageBitmapCache[key];
    removed.bitmaps++;
  }
  if (imageBitmapFailed.delete(key)) removed.bitmapFailures++;
  imageReadyPromises.delete(key);
  imageHydrationPromises.delete(key);
  clearScaledImageVariants(key);
  return removed;
};

const pruneImageCachesToKeys = (retainedKeys = new Set()) => {
  if (!retainedKeys || typeof retainedKeys.has !== 'function') {
    return { removedSources: 0, removedNativeSources: 0 };
  }
  const keys = new Set([
    ...Object.keys(imageStore),
    ...Object.keys(imageCache),
    ...Object.keys(imageAssetUrlCache),
    ...Object.keys(imageBitmapCache),
    ...imageBitmapFailed,
  ]);
  const removedSourceKeys = [];
  const result = {
    removedSources: 0,
    removedDisplayImages: 0,
    removedAssetUrls: 0,
    removedBitmaps: 0,
    removedBitmapFailures: 0,
    requestedNativeRemovals: 0,
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
    result.removedAssetUrls += removed.assetUrls;
    result.removedBitmaps += removed.bitmaps;
    result.removedBitmapFailures += removed.bitmapFailures;
  }
  if (removedSourceKeys.length) {
    _imageStoreGeneration++;
    if (hasTauri()) {
      result.requestedNativeRemovals = removedSourceKeys.length;
      BoardfishTauri.removeCachedImageSources(removedSourceKeys)
        .catch((err) => console.warn('[image-source-cache] prune remove_cached_image_sources failed:', err));
    }
  }
  return result;
};

function clearImageStore(clearNativeCaches = true) {
  _imageStoreGeneration++;
  for (const k of Object.keys(imageStore)) {
    revokeWebImageSource(imageStore[k]);
    delete imageStore[k];
  }
  for (const k of Object.keys(imageCache)) delete imageCache[k];
  for (const k of Object.keys(imageAssetUrlCache)) delete imageAssetUrlCache[k];
  for (const k of Object.keys(imageBitmapCache)) { imageBitmapCache[k].close(); delete imageBitmapCache[k]; }
  clearScaledImageVariants();
  if (typeof clearEyedropperSafeImageCache === 'function') clearEyedropperSafeImageCache();
  imageBitmapFailed.clear();
  imageReadbackSafeSourceCache.clear();
  imageSourceCachePromises.clear();
  imageReadyPromises.clear();
  imageHydrationPromises.clear();
  imageAssetMaterializePromises.clear();
  _imageHydrationQueue.length = 0;
  _imageHydrationQueued.clear();
  _imageHydrationScheduled = false;
  _imageDecodeQueue.length = 0;
  _imageDecodeActive = 0;
  _imageDecodeScheduled = false;
  _imageReadyLastRender = 0;
  imgKeyCounter = 1;
  if (clearNativeCaches && hasTauri()) {
    BoardfishTauri.clearImageSourceCache()
      .catch((err) => console.warn('[image-source-cache] clear_image_source_cache failed:', err));
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
