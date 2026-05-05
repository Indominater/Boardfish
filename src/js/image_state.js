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
var MAX_IMAGE_DECODE_ACTIVE = 1;
var imageReadyPromises = new Map();

function newImgKey() { return 'img-' + (imgKeyCounter++); }

function isNativeImageRef(src) {
  return !!(src && typeof src === 'object' && src.native);
}

function imageStoreBytesEstimate(src) {
  if (typeof src === 'string') return src.length;
  if (isNativeImageRef(src)) return JSON.stringify(src).length;
  return 0;
}

function cacheImageSourceForSave(key, src, dbg = null) {
  if (!hasTauri() || !src || isNativeImageRef(src)) return Promise.resolve();
  const existing = imageSourceCachePromises.get(key);
  if (existing) return existing;
  const promise = SaveDebug.wrap(dbg, TAURI_COMMANDS.REGISTER_IMAGE_SOURCE, () => BoardfishTauri.registerImageSource(key, src), { imgKey: key, dataUrl: src })
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
  const promise = ExportDebug.wrap(dbg, TAURI_COMMANDS.REGISTER_IMAGE_SOURCE, () => BoardfishTauri.registerImageSource(key, src), { imgKey: key })
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

async function ensureCanvasSafeNativeImageDataUrl(key, unsafeSrc = '', dbg = null) {
  if (!hasTauri() || !isNativeImageRef(imageStore[key])) return '';
  if (imageAssetUrlCache[key] === unsafeSrc) delete imageAssetUrlCache[key];
  ViewportDebug.step(dbg, 'readback-fallback:start', { key, from: unsafeSrc ? 'unsafe-display-src' : 'native-ref' });
  const dataUrl = await ensureImageDataUrl(key, dbg);
  ViewportDebug.step(dbg, 'readback-fallback:end', { key, dataUrlLen: dataUrl?.length || 0 });
  return dataUrl;
}

function convertTauriFileSrc(path) {
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
        imageAssetUrlCache[key] = convertTauriFileSrc(entry.path);
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
  requestAnimationFrame(processImageDecodeQueue);
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
  if (typeof src !== 'string' || !src) return;
  imageBitmapFailed.delete(key);
  const vpDbg = ViewportDebug.start('cacheImage', { key, src, reusedLoadedImage: !!loadedImg });
  let img = loadedImg || new Image();
  let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  imageReadyPromises.set(key, readyPromise);
  // decode() ensures the image is GPU-decoded before the first drawImage call,
  // preventing a synchronous main-thread decode stall (can be 100s of ms for large images).
  // We also defer invalidateOffscreen/scheduleRender until decode completes so that
  // multiple concurrent image loads coalesce into fewer render calls.
  const loadStart = performance.now();
  function finishLoadForImage(loaded, loadedSrc, reusedLoadedImage = false) {
    const loadMs = performance.now() - loadStart;
    ViewportDebug.count('imageLoads');
    ViewportDebug.max('maxImageLoadMs', loadMs);
    ViewportDebug.step(vpDbg, 'load', { width: loaded.naturalWidth, height: loaded.naturalHeight, ms: loadMs, src: loadedSrc, reusedLoadedImage });

    const readbackSafe = probeImageCanvasReadback(loaded, loadedSrc);
    ViewportDebug.step(vpDbg, 'readback-probe', { key, safe: readbackSafe, src: loadedSrc });
    if (!readbackSafe) {
      ViewportDebug.count('imageReadbackUnsafeDisplaySources');
      ensureCanvasSafeNativeImageDataUrl(key, loadedSrc, vpDbg)
        .then(async (safeSrc) => {
          if (!safeSrc || safeSrc === loadedSrc) throw new Error('no safe fallback image source');
          const safeImg = await loadImageElement(safeSrc);
          finishLoadForImage(safeImg, safeSrc, false);
        })
        .catch((err) => {
          imageBitmapFailed.add(key);
          ViewportDebug.end(vpDbg, { key, error: 'image readback probe failed', fallbackError: String(err) });
          resolveReady();
        });
      return;
    }

    img = loaded;
    imageCache[key] = loaded;

    enqueueImageDecode(async () => {
      const decodeStart = performance.now();
      try {
        await loaded.decode();
      } catch (err) {
        const decodeMs = performance.now() - decodeStart;
        imageBitmapFailed.add(key);
        ViewportDebug.count('imageDecodeFailures');
        ViewportDebug.max('maxImageDecodeMs', decodeMs);
        ViewportDebug.step(vpDbg, 'decode:error', { key, ms: decodeMs, error: String(err) });
        scheduleImageReadyRender('image-load');
        ViewportDebug.end(vpDbg, { key, decodeReady: false, bitmapReady: false, fallbackReady: loaded.complete && loaded.naturalWidth > 0, readbackSafe, error: String(err) });
        resolveReady();
        return;
      }
      const decodeMs = performance.now() - decodeStart;
      ViewportDebug.count('imageDecodes');
      ViewportDebug.max('maxImageDecodeMs', decodeMs);
      ViewportDebug.step(vpDbg, 'decode', { ms: decodeMs });

      const bitmapStart = performance.now();
      try {
        const bitmap = await createImageBitmap(loaded);
        const bitmapMs = performance.now() - bitmapStart;
        imageBitmapCache[key] = bitmap;
        ViewportDebug.count('imageBitmaps');
        ViewportDebug.max('maxImageBitmapMs', bitmapMs);
        ViewportDebug.step(vpDbg, 'createImageBitmap', { ms: bitmapMs });
      } catch (err) {
        const bitmapMs = performance.now() - bitmapStart;
        imageBitmapFailed.add(key);
        ViewportDebug.count('imageBitmapFailures');
        ViewportDebug.max('maxImageBitmapMs', bitmapMs);
        ViewportDebug.step(vpDbg, 'createImageBitmap:error', { ms: bitmapMs, error: String(err) });
      }

      const previewStart = performance.now();
      try {
        await ensureImagePreviewBitmap(key, loaded, dbg);
        const previewMs = performance.now() - previewStart;
        ViewportDebug.max('maxImagePreviewMs', previewMs);
        ViewportDebug.step(vpDbg, 'previewBitmap', { ms: previewMs });
      } catch (err) {
        const previewMs = performance.now() - previewStart;
        ViewportDebug.count('imagePreviewFailures');
        ViewportDebug.max('maxImagePreviewMs', previewMs);
        ViewportDebug.step(vpDbg, 'previewBitmap:error', { ms: previewMs, error: String(err) });
      } finally {
        scheduleImageReadyRender('image-load');
        if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
          scheduleVisibleScaledVariantPrewarmAfterIdle('image-ready');
        }
        ViewportDebug.end(vpDbg, {
          key,
          decodeReady: true,
          bitmapReady: !!imageBitmapCache[key],
          bitmapFailed: imageBitmapFailed.has(key),
          readbackSafe,
        });
        resolveReady();
      }
    });
  }
  img.onload = () => finishLoadForImage(img, src, !!loadedImg);
  img.onerror = () => {
    imageBitmapFailed.add(key);
    ViewportDebug.end(vpDbg, { key, error: 'image load failed' });
    resolveReady();
  };
  if (loadedImg) {
    ViewportDebug.step(vpDbg, 'reuse-loaded-image', { width: img.naturalWidth, height: img.naturalHeight });
    finishLoadForImage(img, src, true);
  } else {
    img.src = src;
    ViewportDebug.step(vpDbg, 'set-src', { src });
  }
  if (!_skipImageSourceRegistration && !options.skipSourceRegistration) cacheImageSourceForSave(key, src).catch(() => {});
  return readyPromise;
}

function clearImageStore(clearNativeCaches = true) {
  _imageStoreGeneration++;
  for (const k of Object.keys(imageStore)) delete imageStore[k];
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
