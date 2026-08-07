// ─── Image store (keeps base64 data OUT of boardHistory snapshots) ─────────────────
var imageStore = {};
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
const MAX_DYNAMIC_OPEN_PREVIEW_ACTIVE = 4;
var imageReadyPromises = new Map();
var imageOpenPreviewBitmapCache = new Map();
var imageOpenPreviewRequestPending = new Set();
var imageOpenPreviewRequestQueue = [];
var imageOpenPreviewRequestActive = 0;
var imageOpenPreviewRequestScheduled = false;
var imageOpenPreviewRequestEpoch = 0;

function newImgKey() {
  let key = '';
  do {
    key = 'img-' + (imgKeyCounter++);
  } while (Object.hasOwn(imageStore, key));
  return key;
}

const isWebImageRef = (src) => {
  return typeof BoardfishWebBoardContainer !== 'undefined' &&
    !!BoardfishWebBoardContainer?.isWebImageRef?.(src);
};

const webImageDisplaySrc = (src) => {
  if (!isWebImageRef(src)) return '';
  return BoardfishWebBoardContainer.displaySrcForImageSource?.(src) || '';
};

const webImageDataUrl = async (src) => {
  if (!isWebImageRef(src)) return '';
  if (typeof BoardfishWebBoardContainer.dataUrlForImageSourceAsync === 'function') {
    return await BoardfishWebBoardContainer.dataUrlForImageSourceAsync(src) || '';
  }
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

/* BOARDFISH_DEV_DIAGNOSTICS_START */
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
/* BOARDFISH_DEV_DIAGNOSTICS_END */

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
  const sideways = isSidewaysRotation(transform.rotation);
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

async function getRenderedImageDataUrl(obj
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const imgKey = obj?.data?.imgKey;
  const transform = imageTransformFromObject(obj);
  const needsRender = imageTransformNeedsRendering(transform);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const src = await ensureImageDataUrl(imgKey);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const sourceMs = performance.now() - sourceStart;
  const sourceKind = typeof imageStore[imgKey] === 'string' ? 'data-url' : baseMeta.storedKind;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!src || !needsRender) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return src;
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const bitmapStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const bitmap = await createImageBitmapForSource(src, src).catch((
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    err
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) => {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    ExportDebug.step(dbg, 'render:image-bitmap-error', { ...baseMeta, sourceMs, error: String(err) });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return null;
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const loadMs = performance.now() - bitmapStart;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!bitmap) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return '';
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const drawStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const canvas = renderImageToCanvas(obj, bitmap);
  bitmap.close?.();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const drawMs = performance.now() - drawStart;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!canvas) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return '';
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const encodeStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const dataUrl = canvas.toDataURL('image/png');
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
    const container = globalThis.BoardfishWebBoardContainer;
    const blob = container?.blobForImageSource?.(source);
    if (blob) return blob;
    const bytes = container?.bytesForImageSource?.(source);
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

const openPreviewTargetForObject = (obj, view = {}) => {
  const dpr = Number(view.dpr || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
  const z = Math.max(0.001, Number(view.zoom || 1));
  const transform = typeof imageTransformFromObject === 'function'
    ? imageTransformFromObject(obj)
    : { rotation: 0 };
  const sideways = typeof isSidewaysRotation === 'function' && isSidewaysRotation(transform.rotation);
  const worldW = Math.max(1, sideways ? Number(obj?.h || 0) : Number(obj?.w || 0));
  const worldH = Math.max(1, sideways ? Number(obj?.w || 0) : Number(obj?.h || 0));
  return {
    width: Math.max(1, Math.min(4096, Math.ceil(worldW * z * dpr))),
    height: Math.max(1, Math.min(4096, Math.ceil(worldH * z * dpr))),
  };
};

async function buildOpenInitialImagePreviewForOpen(key, obj, view = {}
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  , options = {}
) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const t0 = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof createImageBitmap !== 'function') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { key, ready: false, skipped: 'createImageBitmap-unavailable' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { ready: false };
  }
  if (!key || !obj) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { key, ready: false, skipped: 'invalid' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { ready: false };
  }
  const current = imageOpenPreviewBitmapCache.get(key);
  if (current?.generation === _imageStoreGeneration && current.bitmap) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { key, ready: true, skipped: 'already-ready', width: current.bitmap.width, height: current.bitmap.height };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { ready: true };
  }
  const source = imageStore[key];
  if (typeof source !== 'string' && !isWebImageRef(source)) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { key, ready: false, skipped: 'non-hydratable' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { ready: false };
  }
  const generation = _imageStoreGeneration;
  const target = openPreviewTargetForObject(obj, view);
  let bitmap = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let sourceKind = 'store';
  let sourceFallbackError = '';
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  try {
    const preferredSource = options.sourceBitmap || null;
    const preferredW = preferredSource?.width || preferredSource?.naturalWidth || 0;
    const preferredH = preferredSource?.height || preferredSource?.naturalHeight || 0;
    let bitmapSource = null;
    if (preferredW > 0 && preferredH > 0) {
      try {
        bitmap = await createImageBitmap(preferredSource, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        sourceKind = 'bitmap';
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } catch
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        (err)
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        sourceFallbackError = String(err);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        bitmap = null;
      }
    }
    if (!bitmap) {
      bitmapSource = await bitmapSourceFromImageSource(source, '');
      bitmap = await createImageBitmap(bitmapSource, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high',
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      sourceKind = 'store';
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    if (generation !== _imageStoreGeneration || imageStore[key] !== source) {
      bitmap.close?.();
      bitmap = null;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      return { key, ready: false, skipped: 'stale', ms: performance.now() - t0 };
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return { ready: false };
    }
    const previous = imageOpenPreviewBitmapCache.get(key);
    if (typeof dropDrawableBitmapWarmup === 'function') dropDrawableBitmapWarmup(previous?.bitmap);
    previous?.bitmap?.close?.();
    imageOpenPreviewBitmapCache.set(key, {
      bitmap,
      generation,
      width: bitmap.width,
      height: bitmap.height,
      targetWidth: target.width,
      targetHeight: target.height,
      objectId: obj.id || '',
      objectW: Number(obj.w || 0) || 0,
      objectH: Number(obj.h || 0) || 0,
      viewZoom: Number(view.zoom || 0) || 0,
      viewDpr: Number(view.dpr || 0) || 0,
    });
    if (typeof scheduleDrawableBitmapWarmup === 'function') {
      const warmupMeta = { kind: 'open-preview', key };
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      Object.assign(warmupMeta, { objectId: obj.id || '', source: options.source || '' });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      scheduleDrawableBitmapWarmup(bitmap, warmupMeta, {
        immediate: options.warmupImmediate === true || (typeof _boardOpening !== 'undefined' && _boardOpening),
        budgetMs: 8,
        maxItems: 1,
      });
    }
    bitmap = null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return {
      key,
      ready: true,
      width: target.width,
      height: target.height,
      bytes: target.width * target.height * 4,
      ms: performance.now() - t0,
      sourceKind,
      sourceFallbackError,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { ready: true };
  } catch
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    (err)
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  {
    bitmap?.close?.();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    OpenDebug.step(dbg, 'open-preview-image:error', { imgKey: key, error: String(err), ms: performance.now() - t0 });
    return { key, ready: false, skipped: 'error', error: String(err), ms: performance.now() - t0 };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { ready: false };
  }
}

function scheduleOpenInitialImagePreviewRequestQueue() {
  if (imageOpenPreviewRequestScheduled) return;
  imageOpenPreviewRequestScheduled = true;
  setTimeout(() => {
    imageOpenPreviewRequestScheduled = false;
    while (imageOpenPreviewRequestActive < MAX_DYNAMIC_OPEN_PREVIEW_ACTIVE && imageOpenPreviewRequestQueue.length) {
      const task = imageOpenPreviewRequestQueue.shift();
      imageOpenPreviewRequestActive++;
      task()
        .catch(() => {})
        .finally(() => {
          imageOpenPreviewRequestActive = Math.max(0, imageOpenPreviewRequestActive - 1);
          if (imageOpenPreviewRequestQueue.length) scheduleOpenInitialImagePreviewRequestQueue();
        });
    }
  }, 0);
}

function requestOpenInitialImagePreviewForDraw(key, obj, view = {}, options = {}) {
  if (typeof createImageBitmap !== 'function') return false;
  if (!key || !obj || imageOpenPreviewBitmapCache.has(key) || imageOpenPreviewRequestPending.has(key)) return false;
  const source = imageStore[key];
  if (typeof source !== 'string' && !isWebImageRef(source)) return false;
  const requestEpoch = imageOpenPreviewRequestEpoch;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const queuedAt = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const sourceBitmap = options.sourceBitmap || null;
  imageOpenPreviewRequestPending.add(key);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (typeof OpenDebug !== 'undefined' && typeof OpenDebug.recordDynamicPreview === 'function') {
    const sourceBitmapW = sourceBitmap?.width || sourceBitmap?.naturalWidth || 0;
    const sourceBitmapH = sourceBitmap?.height || sourceBitmap?.naturalHeight || 0;
    OpenDebug.recordDynamicPreview({
      imgKey: key,
      objectId: obj.id || '',
      reason: options.reason || '',
      queued: true,
      pending: imageOpenPreviewRequestPending.size,
      queuedCount: imageOpenPreviewRequestQueue.length + 1,
      active: imageOpenPreviewRequestActive,
      concurrency: MAX_DYNAMIC_OPEN_PREVIEW_ACTIVE,
      sourceBitmap: sourceBitmapW > 0 && sourceBitmapH > 0,
      sourceBitmapW: sourceBitmapW || '',
      sourceBitmapH: sourceBitmapH || '',
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const task = async () => {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const startedAt = performance.now();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    try {
      if (requestEpoch !== imageOpenPreviewRequestEpoch || imageStore[key] !== source) return;
      const buildOptions = {
        warmupImmediate: true,
        sourceBitmap,
      };
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      buildOptions.source = options.source || 'open-preview-dynamic-ready';
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const result = await buildOpenInitialImagePreviewForOpen(key, obj, view
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , null
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        , buildOptions
      );
      if (result?.ready) {
        if (requestEpoch === imageOpenPreviewRequestEpoch) {
          if (typeof scheduleRender === 'function') {
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            scheduleRender(true, false, options.source || 'open-preview-dynamic-ready');
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
            if (typeof BOARDFISH_PRODUCTION !== 'undefined') scheduleRender(true, false);
          }
        } else {
          clearOpenInitialImagePreviews(key);
        }
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (typeof OpenDebug !== 'undefined' && typeof OpenDebug.recordDynamicPreview === 'function') {
        const completedAt = performance.now();
        OpenDebug.recordDynamicPreview({
          imgKey: key,
          objectId: obj.id || '',
          reason: options.reason || '',
          queuedMs: startedAt - queuedAt,
          waitMs: startedAt - queuedAt,
          buildMs: result?.ms ?? '',
          totalMs: completedAt - queuedAt,
          ready: result?.ready === true,
          skipped: result?.skipped || '',
          width: result?.width ?? '',
          height: result?.height ?? '',
          ms: result?.ms ?? '',
          active: imageOpenPreviewRequestActive,
          queuedCount: imageOpenPreviewRequestQueue.length,
          concurrency: MAX_DYNAMIC_OPEN_PREVIEW_ACTIVE,
          sourceKind: result?.sourceKind || '',
          sourceFallbackError: result?.sourceFallbackError || '',
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } finally {
      imageOpenPreviewRequestPending.delete(key);
    }
  };
  task.imgKey = key;
  imageOpenPreviewRequestQueue.push(task);
  scheduleOpenInitialImagePreviewRequestQueue();
  return true;
}

function hasOpenInitialImagePreviews() {
  for (const entry of imageOpenPreviewBitmapCache.values()) {
    if (entry?.generation === _imageStoreGeneration && entry.bitmap) return true;
  }
  return false;
}

function hasBlockingOpenInitialImagePreviewsForOpen() {
  for (const [key, entry] of imageOpenPreviewBitmapCache.entries()) {
    if (entry?.generation === _imageStoreGeneration && entry.bitmap && !imageBitmapFailed.has(key)) return true;
  }
  return false;
}

function removeOpenPreviewRequestsForKey(key) {
  let write = 0;
  for (let read = 0; read < imageOpenPreviewRequestQueue.length; read++) {
    const task = imageOpenPreviewRequestQueue[read];
    if (task?.imgKey === key) continue;
    imageOpenPreviewRequestQueue[write++] = task;
  }
  imageOpenPreviewRequestQueue.length = write;
}

function clearOpenInitialImagePreviews(key = null) {
  if (key) {
    const entry = imageOpenPreviewBitmapCache.get(key);
    if (typeof dropDrawableBitmapWarmup === 'function') dropDrawableBitmapWarmup(entry?.bitmap);
    entry?.bitmap?.close?.();
    imageOpenPreviewBitmapCache.delete(key);
    imageOpenPreviewRequestPending.delete(key);
    if (imageOpenPreviewRequestQueue.length) {
      removeOpenPreviewRequestsForKey(key);
    }
    return;
  }
  imageOpenPreviewRequestEpoch++;
  imageOpenPreviewRequestPending.clear();
  imageOpenPreviewRequestQueue.length = 0;
  for (const entry of imageOpenPreviewBitmapCache.values()) {
    if (typeof dropDrawableBitmapWarmup === 'function') dropDrawableBitmapWarmup(entry?.bitmap);
    entry?.bitmap?.close?.();
  }
  imageOpenPreviewBitmapCache.clear();
}

function openInitialPreviewReleaseTargetScale(key, entry) {
  const fullSource = imageBitmapCache[key] || null;
  if (!fullSource || typeof chooseImageScaleForDraw !== 'function') return 1;
  return chooseImageScaleForDraw(
    {
      w: Math.max(1, Number(entry?.objectW || 0) || Number(entry?.targetWidth || 1) || 1),
      h: Math.max(1, Number(entry?.objectH || 0) || Number(entry?.targetHeight || 1) || 1),
    },
    fullSource,
    {
      zoom: Number(entry?.viewZoom || 0) || (typeof zoom !== 'undefined' ? zoom : 1),
      dpr: Number(entry?.viewDpr || 0) || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1),
    },
  );
}

function openInitialPreviewIsCoveredByDrawSource(key, entry) {
  if (imageBitmapFailed.has(key)) return true;
  const fullSource = imageBitmapCache[key] || null;
  if (!fullSource) return false;
  if (typeof isViewportImageScalingActive !== 'function' ||
    !isViewportImageScalingActive() ||
    typeof hasScaledImageVariant !== 'function') {
    return true;
  }
  const targetScale = openInitialPreviewReleaseTargetScale(key, entry);
  return !(targetScale > 0 && targetScale < 1) ||
    hasScaledImageVariant(key, targetScale) ||
    (typeof hasScaledImageVariantFailure === 'function' && hasScaledImageVariantFailure(key, targetScale));
}

function releaseReadyOpenInitialImagePreviewsForOpen() {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let total = 0;
  let ready = 0;
  let failed = 0;
  let stale = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let pending = 0;
  let released = 0;
  for (const [key, entry] of imageOpenPreviewBitmapCache.entries()) {
    if (!entry?.bitmap || entry.generation !== _imageStoreGeneration) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      stale++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      clearOpenInitialImagePreviews(key);
      continue;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    total++;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (imageBitmapFailed.has(key)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      failed++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    else if (openInitialPreviewIsCoveredByDrawSource(key, entry)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      ready++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      clearOpenInitialImagePreviews(key);
      released++;
    } else pending++;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return { total, ready, pending, failed, stale, released, remaining: imageOpenPreviewBitmapCache.size };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return { pending, released };
}

function resolveOpenInitialImageSourceForDraw(key, obj, view = { zoom, dpr: window.devicePixelRatio || 1 }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , counters = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  , options = {}
) {
  let entry = imageOpenPreviewBitmapCache.get(key);
  if (entry?.generation === _imageStoreGeneration && entry.bitmap &&
      !imageBitmapFailed.has(key) &&
      openInitialPreviewIsCoveredByDrawSource(key, entry)) {
    clearOpenInitialImagePreviews(key);
    entry = null;
  }
  if (entry?.generation === _imageStoreGeneration && entry.bitmap) {
    const fullSource = imageBitmapCache[key] || null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const targetScale =
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    fullSource && typeof queueScaledImageVariantForDraw === 'function'
      ? queueScaledImageVariantForDraw(key, obj, fullSource, view, { priority: true, activeOverscale: options.activeInput === true })
      : 0.25;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { source: entry.bitmap, scale: 0.25, targetScale, openPreview: true };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { source: entry.bitmap };
  }
  const fullSource = imageBitmapCache[key] || null;
  const selected = fullSource && typeof selectImageSourceForDraw === 'function'
    ? selectImageSourceForDraw(key, obj, fullSource, view, options)
    : null;
  if (selected?.activeInputFullFallback === true && hasOpenInitialImagePreviews()) {
    const previewOptions = { sourceBitmap: fullSource };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    Object.assign(previewOptions, {
      reason: 'active-input-full-fallback',
      source: 'open-preview-dynamic-ready',
    });
    const requested =
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    requestOpenInitialImagePreviewForDraw(key, obj, view, previewOptions);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (requested && counters) {
      counters.dynamicOpenPreviewRequests = (counters.dynamicOpenPreviewRequests || 0) + 1;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  return selected;
}

const addImageRuntimeObjectKeysToSet = (keys, value) => {
  if (!value || typeof value !== 'object') return keys;
  for (const sourceKey in value) {
    if (Object.hasOwn(value, sourceKey)) keys.add(sourceKey);
  }
  return keys;
};

const IMAGE_READY_RENDER_INTERVAL_MS = 120;
const BULK_IMAGE_READY_RENDER_INTERVAL_MS = 450;

function scheduleImageReadyRender(
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  source = 'image-load',
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  options = {}
) {
  invalidateOffscreen();
  const now = performance.now();
  const intervalMs = Number(options.minIntervalMs) > 0
    ? Number(options.minIntervalMs)
    : (_bulkImageInsertDepth > 0 ? BULK_IMAGE_READY_RENDER_INTERVAL_MS : IMAGE_READY_RENDER_INTERVAL_MS);
  if (now - _imageReadyLastRender > intervalMs) {
    _imageReadyLastRender = now;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    scheduleRender(true, false, source);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') scheduleRender(true, false);
  } else {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    scheduleRender(false, true, `${source}-overlay`);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') scheduleRender(false, true);
  }
}

function ensureImageDisplaySrc(key
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const stored = imageStore[key];
  if (typeof stored === 'string') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { src: stored, source: 'data-url', dataUrlLen: stored.length };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { src: stored };
  }
  if (isWebImageRef(stored)) {
    const src = webImageDisplaySrc(stored);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { src, source: 'web-blob', dataUrlLen: 0 };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { src };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'ensure-image-display-src:missing', { imgKey: key, kind: imageRefKind(stored), hasStore: !!stored });
  return { src: '', source: 'missing', dataUrlLen: 0 };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return { src: '' };
}

async function ensureImageDataUrl(key) {
  const src = imageStore[key];
  if (typeof src === 'string') return src;
  if (isWebImageRef(src)) return webImageDataUrl(src);
  return '';
}
var _imageHydrationScheduled = false;
var _imageHydrationQueue = [];
var _imageHydrationQueued = new Set();

function queueImageHydration(key
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const source = imageStore[key];
  if (!source || getImageDisplayMetadata(key) || _imageHydrationQueued.has(key)) return;
  if (typeof source !== 'string' && !isWebImageRef(source)) return;
  _imageHydrationQueued.add(key);
  _imageHydrationQueue.push({
    key,
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg,
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  });
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
  while (_imageHydrationQueue.length && (count === 0 || performance.now() - batchStart < 6)) {
    const { key
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } = _imageHydrationQueue.shift();
    _imageHydrationQueued.delete(key);
    const source = imageStore[key];
    if (!source || getImageDisplayMetadata(key)) continue;
    if (typeof source !== 'string' && !isWebImageRef(source)) continue;
    count++;
    try {
      const display = ensureImageDisplaySrc(key
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
      if (display?.src && !getImageDisplayMetadata(key)) cacheImage(key, source
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        , { skipSourceRegistration: true }
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
  if (_imageHydrationQueue.length) scheduleImageHydration();
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

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const isDebugApiEnabled = (api) => {
  return !!(api && (api.enabled === true || api.isEnabled?.() === true));
};

const shouldPrepareImagePreviewDebug = (dbg = null) => {
  return isDebugApiEnabled(ViewportDebug) || (!!dbg && isDebugApiEnabled(OpenDebug));
};

function ensureImagePreviewBitmap(key, dbg = null) {
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    const t0 = performance.now();
    // Placeholder hook for future lower-resolution previews. The timing is kept
    // separate from ImageBitmap creation so readiness reports show the true stage.
    ViewportDebug.count('imagePreviewPrepared');
    const ms = performance.now() - t0;
    ViewportDebug.max('maxImagePreviewMs', ms);
    if (dbg) ViewportDebug.step(dbg, 'previewBitmap', { key, ms, skipped: true });
  }
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function cacheImage(key, src
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  , options = {}
) {
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
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const cacheStart = performance.now();
  const cacheMetrics = {
    cacheTotalMs: 0,
    cacheQueueWaitMs: 0,
    cacheBitmapMs: 0,
    cachePreviewMs: 0,
    cacheRenderScheduleMs: 0,
    cacheRenderSkipped: '',
    cacheReadyStage: '',
  };
  const vpDbg = ViewportDebug.start('cacheImage', { key, src: displaySrc, bitmapOnly: true });
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
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let resolveReady;
  let readyResolved = false;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  imageReadyPromises.set(key, readyPromise);
  function resolveReadyOnce(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    stage
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    if (readyResolved) return;
    readyResolved = true;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    cacheMetrics.cacheReadyStage = stage;
    cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const metadata = getImageDisplayMetadata(key);
    const dimensions = {
      width: metadata?.width || 0,
      height: metadata?.height || 0,
      naturalWidth: metadata?.naturalWidth || 0,
      naturalHeight: metadata?.naturalHeight || 0,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    resolveReady({ ...cacheMetrics, ...dimensions });
    return;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    resolveReady(dimensions);
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
    try {
      const bitmap = await createImageBitmapForSource(src, displaySrc);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const bitmapMs = performance.now() - bitmapStart;
      cacheMetrics.cacheBitmapMs = bitmapMs;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (!isImageDisplayCacheRequestCurrent(key, displaySrc, generation)) {
        bitmap.close?.();
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        ViewportDebug.step(vpDbg, 'createImageBitmap:stale', { ms: bitmapMs });
        OpenDebug.step(dbg, 'cache-image:createImageBitmap:stale', { imgKey: key, ms: bitmapMs });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } else {
        const selectedBitmap = imageBitmapCache[key] || bitmap;
        if (imageBitmapCache[key]) bitmap.close?.();
        else imageBitmapCache[key] = bitmap;
        setImageDisplayMetadata(key, selectedBitmap, displaySrc);
        if (typeof scheduleDrawableBitmapWarmup === 'function') {
          const warmupMeta = { kind: 'full-image', key };
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          warmupMeta.source = 'cache-image';
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          scheduleDrawableBitmapWarmup(selectedBitmap, warmupMeta);
        }
        if (typeof queueScaledImageVariantForReadyImage === 'function') {
          const previewEntry = imageOpenPreviewBitmapCache.get(key);
          const previewPriority = previewEntry?.generation === generation && !!previewEntry.bitmap;
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const variantQueue =
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          queueScaledImageVariantForReadyImage(key, selectedBitmap, {
            priority: previewPriority,
          });
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          OpenDebug.step(dbg, 'cache-image:queue-scaled-variant', {
            imgKey: key,
            scale: variantQueue?.scale ?? '',
            queued: variantQueue?.queued === true,
            skipped: variantQueue?.skipped || '',
            priority: previewPriority,
          });
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        }
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
      if (isImageDisplayCacheRequestCurrent(key, displaySrc, generation)) imageBitmapFailed.add(key);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      ViewportDebug.count('imageBitmapFailures');
      ViewportDebug.max('maxImageBitmapMs', bitmapMs);
      ViewportDebug.step(vpDbg, 'createImageBitmap:error', { ms: bitmapMs, error: String(err), bitmapOnly: true });
      OpenDebug.step(dbg, 'cache-image:createImageBitmap:error', { imgKey: key, ms: bitmapMs, error: String(err), bitmapOnly: true });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }

    if (!isImageDisplayCacheRequestCurrent(key, displaySrc, generation)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
      ViewportDebug.end(vpDbg, { key, stale: true });
      OpenDebug.step(dbg, 'cache-image:stale', { imgKey: key, ms: cacheMetrics.cacheTotalMs });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (imageReadyPromises.get(key) === readyPromise) imageReadyPromises.delete(key);
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
    if (shouldPrepareImagePreviewDebug(dbg) && imageBitmapCache[key]) {
      const previewStart = performance.now();
      try {
        ensureImagePreviewBitmap(key, dbg);
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
    /* BOARDFISH_DEV_DIAGNOSTICS_END */

    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const renderScheduleStart = performance.now();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const deferBitmapReadyRenderForOpenPreview = hasBlockingOpenInitialImagePreviewsForOpen();
    if (!deferBitmapReadyRenderForOpenPreview) {
      scheduleImageReadyRender(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        'image-bitmap-ready',
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        { minIntervalMs: options.readyRenderMinIntervalMs }
      );
    }
    if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
      scheduleVisibleScaledVariantPrewarmAfterIdle(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        'image-ready'
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    cacheMetrics.cacheRenderScheduleMs = performance.now() - renderScheduleStart;
    cacheMetrics.cacheRenderSkipped = deferBitmapReadyRenderForOpenPreview ? 'open-preview-held' : '';
    cacheMetrics.cacheTotalMs = performance.now() - cacheStart;
    OpenDebug.step(dbg, 'cache-image:schedule-render', {
      imgKey: key,
      ms: cacheMetrics.cacheRenderScheduleMs,
      skipped: cacheMetrics.cacheRenderSkipped,
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
      previewMs: cacheMetrics.cachePreviewMs,
      renderScheduleMs: cacheMetrics.cacheRenderScheduleMs,
      cacheRenderSkipped: cacheMetrics.cacheRenderSkipped,
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
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return readyPromise;
}

const removeImageRuntimeCachesForKey = (key) => {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const removed = {
    displayImages: 0,
    bitmaps: 0,
    bitmapFailures: 0,
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (imageMetadataCache[key]) {
    delete imageMetadataCache[key];
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    removed.displayImages++;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  if (imageBitmapCache[key]) {
    if (typeof dropDrawableBitmapWarmup === 'function') dropDrawableBitmapWarmup(imageBitmapCache[key]);
    try { imageBitmapCache[key].close(); } catch (_) {}
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
  clearOpenInitialImagePreviews(key);
  clearScaledImageVariants(key);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return removed;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

const invalidateImageSourceCachesForKey = (key) => {
  if (!key) return;
  _imageStoreGeneration++;
  _imageHydrationQueued.delete(key);
  let write = 0;
  for (let read = 0; read < _imageHydrationQueue.length; read++) {
    const item = _imageHydrationQueue[read];
    if (item?.key === key) continue;
    _imageHydrationQueue[write++] = item;
  }
  _imageHydrationQueue.length = write;
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
  addImageRuntimeObjectKeysToSet(keys, imageMetadataCache);
  addImageRuntimeObjectKeysToSet(keys, imageBitmapCache);
  for (const key of imageBitmapFailed) keys.add(key);
  let removedSource = false;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const result = {
    removedSources: 0,
    removedDisplayImages: 0,
    removedBitmaps: 0,
    removedBitmapFailures: 0,
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (const key of keys) {
    if (retainedKeys.has(key)) continue;
    if (Object.hasOwn(imageStore, key)) {
      revokeWebImageSource(imageStore[key]);
      delete imageStore[key];
      removedSource = true;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      result.removedSources++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const removed =
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    removeImageRuntimeCachesForKey(key);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    result.removedDisplayImages += removed.displayImages;
    result.removedBitmaps += removed.bitmaps;
    result.removedBitmapFailures += removed.bitmapFailures;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  if (removedSource) {
    _imageStoreGeneration++;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return result;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

function clearImageStore() {
  if (typeof clearVisibleHydrationTimer === 'function') clearVisibleHydrationTimer();
  _imageStoreGeneration++;
  for (const k in imageStore) {
    if (!Object.prototype.hasOwnProperty.call(imageStore, k)) continue;
    revokeWebImageSource(imageStore[k]);
    delete imageStore[k];
  }
  imageMetadataCache = {};
  for (const k in imageBitmapCache) {
    if (!Object.prototype.hasOwnProperty.call(imageBitmapCache, k)) continue;
    try { imageBitmapCache[k].close(); } catch (_) {}
    delete imageBitmapCache[k];
  }
  clearOpenInitialImagePreviews();
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
