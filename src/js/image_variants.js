'use strict';

var IMAGE_SCALE_LEVELS = [0.25];
function imageVariantMemoryLimit() {
  const maxBytes = 1024 * 1024 * 1024;
  const minBytes = 64 * 1024 * 1024;
  const deviceMemoryGb = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : NaN;
  if (!Number.isFinite(deviceMemoryGb) || deviceMemoryGb <= 0) return maxBytes;
  return Math.max(minBytes, Math.min(maxBytes, Math.floor(deviceMemoryGb * 1024 * 1024 * 1024 / 4)));
}
var IMAGE_VARIANT_MEMORY_LIMIT = imageVariantMemoryLimit();
/* BOARDFISH_DEV_DIAGNOSTICS_START */
var VIEWPORT_PERF_MODES = {
  '1': { label: 'culling + scaled images', culling: true, scaling: true },
  '2': { label: 'scaled images only', culling: false, scaling: true },
  '3': { label: 'culling only', culling: true, scaling: false },
  '4': { label: 'none', culling: false, scaling: false },
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */
var imageScaledBitmapStore = BoardfishBitmapCache.createGroupedLruCache({
  memoryLimit: IMAGE_VARIANT_MEMORY_LIMIT,
  onEvict(entry) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') imageScaledVariantEvictionCount++;
    dropDrawableBitmapWarmup(entry?.bitmap);
  },
});
var imageScaledBitmapCache = imageScaledBitmapStore.groups; // key -> Map(scale -> LRU node)
var imageScaledBitmapPending = new Map(); // pending key -> estimated bytes
var imageScaledBitmapFailures = new Map();
var imageScaledBitmapPendingByteTotal = 0;
var imageScaledBitmapBytes = 0;
var imageScaledVariantRenderTimer = null;
/* BOARDFISH_DEV_DIAGNOSTICS_START */
var imageScaledVariantRenderCount = 0;
/* BOARDFISH_DEV_DIAGNOSTICS_END */
var imageScaledVariantQueue = [];
var imageScaledVariantQueueScheduled = false;
var imageScaledVariantQueueTimer = null;
var imageScaledVariantQueueActive = 0;
var imageScaledVariantFailureReleaseScheduled = false;
var lastViewportInputAt = 0;
var IMAGE_VARIANT_INPUT_IDLE_MS = 180;
var IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS = 0;
var IMAGE_VARIANT_QUEUE_CONCURRENCY = 4;
var IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS = 180;
var IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT = 1.18;
/* BOARDFISH_DEV_DIAGNOSTICS_START */
var imageScaledVariantBuildCount = 0;
var imageScaledVariantBuildTotalMs = 0;
var imageScaledVariantBuildMaxMs = 0;
var imageScaledVariantResizeBitmapCount = 0;
var imageScaledVariantCanvasFallbackCount = 0;
var imageScaledVariantEvictionCount = 0;
var imageScaledVariantMemorySkipCount = 0;
var imageScaledVariantActiveInputFullFallbackCount = 0;
var imageScaledVariantPriorityBoostCount = 0;
/* BOARDFISH_DEV_DIAGNOSTICS_END */
var imageScaledVariantPrewarmTimer = null;
/* BOARDFISH_DEV_DIAGNOSTICS_START */
var imageScaledVariantPrewarmRunCount = 0;
var imageScaledVariantPrewarmCandidateCount = 0;
var imageScaledVariantPrewarmQueuedCount = 0;
var imageScaledVariantPrewarmReadyCount = 0;
var imageScaledVariantPrewarmNoSourceCount = 0;
var imageScaledVariantSourceReadyCandidateCount = 0;
var imageScaledVariantSourceReadyQueuedCount = 0;
var imageScaledVariantSourceReadyReadyCount = 0;
var imageScaledVariantSourceReadyNoSourceCount = 0;
var imageScaledVariantSourceReadyFullScaleCount = 0;
/* BOARDFISH_DEV_DIAGNOSTICS_END */
var IMAGE_VARIANT_PREWARM_PAD_PX = 768;
var viewportCullingEnabled = true;
var VIEWPORT_IMAGE_SCALING_SUPPORTED = typeof createImageBitmap === 'function';
var viewportImageScalingEnabled = VIEWPORT_IMAGE_SCALING_SUPPORTED;
var drawableBitmapWarmupCanvas = null;
var drawableBitmapWarmupContext = null;
var drawableBitmapWarmupQueue = new Map();
var drawableBitmapWarmupScheduled = false;
var drawableBitmapWarmupReady = typeof WeakSet !== 'undefined' ? new WeakSet() : new Set();
/* BOARDFISH_DEV_DIAGNOSTICS_START */
var drawableBitmapWarmupQueuedCount = 0;
var drawableBitmapWarmupWarmedCount = 0;
var drawableBitmapWarmupTotalMs = 0;
var drawableBitmapWarmupMaxMs = 0;
var drawableBitmapWarmupTotalPixels = 0;
var drawableBitmapWarmupMaxPixels = 0;
var drawableBitmapWarmupErrorCount = 0;
var drawableBitmapWarmupUnsupportedCount = 0;
var drawableBitmapWarmupQueuedByKind = {};
var drawableBitmapWarmupWarmedByKind = {};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function isViewportImageScalingActive() {
  return VIEWPORT_IMAGE_SCALING_SUPPORTED && viewportImageScalingEnabled;
}

function bitmapByteSize(bitmap) {
  return (bitmap?.width || 0) * (bitmap?.height || 0) * 4;
}

function isImageVariantDrawableSource(source) {
  if (!source) return false;
  const ImageBitmapCtor = typeof ImageBitmap !== 'undefined' ? ImageBitmap : null;
  if (ImageBitmapCtor && source instanceof ImageBitmapCtor) return true;
  return !!(source.complete && source.naturalWidth > 0) || !!(source.width > 0 && source.height > 0);
}

function drawableBitmapWarmupKind(meta = {}) {
  const kind = String(meta.kind || '');
  if (kind === 'full-image') return 'fullImage';
  if (kind === 'scaled-variant') return 'scaledVariant';
  if (kind === 'open-preview') return 'openPreview';
  return 'other';
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function countDrawableBitmapWarmupKind(target, meta = {}) {
  const kind = drawableBitmapWarmupKind(meta);
  target[kind] = (target[kind] || 0) + 1;
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function drawableBitmapWarmupMaxEdge(meta = {}) {
  const kind = drawableBitmapWarmupKind(meta);
  if (kind === 'scaledVariant' || kind === 'openPreview') return 512;
  if (kind === 'fullImage') return 256;
  return 1;
}

function drawableBitmapWarmupTargetSize(source, meta = {}) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!(sourceW > 0 && sourceH > 0)) return { sourceW, sourceH, width: 1, height: 1 };
  const maxEdge = Math.max(1, Math.trunc(Number(drawableBitmapWarmupMaxEdge(meta)) || 1));
  const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
  return {
    sourceW,
    sourceH,
    width: Math.max(1, Math.round(sourceW * scale)),
    height: Math.max(1, Math.round(sourceH * scale)),
  };
}

function dropDrawableBitmapWarmup(source) {
  if (!source) return;
  drawableBitmapWarmupQueue.delete(source);
  drawableBitmapWarmupReady.delete(source);
}

function dropDrawableBitmapWarmupsForKey(key) {
  if (!key || !drawableBitmapWarmupQueue.size) return;
  for (const [source, meta] of drawableBitmapWarmupQueue) {
    if (meta?.key === key) drawableBitmapWarmupQueue.delete(source);
  }
}

function drawableBitmapWarmup2dContext(width, height) {
  if (!drawableBitmapWarmupCanvas && typeof OffscreenCanvas !== 'undefined') drawableBitmapWarmupCanvas = new OffscreenCanvas(width, height);
  else if (!drawableBitmapWarmupCanvas && typeof document !== 'undefined') drawableBitmapWarmupCanvas = document.createElement('canvas');
  if (!drawableBitmapWarmupCanvas) return null;
  if (drawableBitmapWarmupCanvas.width < width) drawableBitmapWarmupCanvas.width = width;
  if (drawableBitmapWarmupCanvas.height < height) drawableBitmapWarmupCanvas.height = height;
  if (!drawableBitmapWarmupContext) {
    drawableBitmapWarmupContext = drawableBitmapWarmupCanvas.getContext?.('2d', { alpha: false }) || null;
  }
  return drawableBitmapWarmupContext;
}

function warmDrawableBitmapForDrawNow(source, meta = {}) {
  if (!isImageVariantDrawableSource(source)) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { warmed: false, skipped: 'not-drawable' }
      : false;
  }
  if (drawableBitmapWarmupReady.has(source)) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { warmed: false, skipped: 'already-warmed' }
      : false;
  }
  const target = drawableBitmapWarmupTargetSize(source, meta);
  const ctx = drawableBitmapWarmup2dContext(target.width, target.height);
  if (!ctx) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      drawableBitmapWarmupUnsupportedCount++;
      return { warmed: false, skipped: 'unsupported' };
    }
    return false;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const start = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  try {
    try { ctx.imageSmoothingEnabled = false; } catch (_) {}
    ctx.drawImage(source, 0, 0, target.sourceW, target.sourceH, 0, 0, target.width, target.height);
    drawableBitmapWarmupReady.add(source);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const ms = performance.now() - start;
      const pixels = target.width * target.height;
      drawableBitmapWarmupWarmedCount++;
      countDrawableBitmapWarmupKind(drawableBitmapWarmupWarmedByKind, meta);
      drawableBitmapWarmupTotalMs += ms;
      drawableBitmapWarmupMaxMs = Math.max(drawableBitmapWarmupMaxMs, ms);
      drawableBitmapWarmupTotalPixels += pixels;
      drawableBitmapWarmupMaxPixels = Math.max(drawableBitmapWarmupMaxPixels, pixels);
      if (typeof ViewportDebug !== 'undefined') {
        ViewportDebug.count?.('drawableBitmapWarmup');
        ViewportDebug.max?.('drawableBitmapWarmupMaxMs', ms);
      }
      return { warmed: true, ms, pixels, width: target.width, height: target.height, meta };
    }
    return true;
  } catch (err) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      drawableBitmapWarmupErrorCount++;
      return { warmed: false, skipped: 'error', error: String(err), meta };
    }
    return false;
  }
}

function runDrawableBitmapWarmupQueue(options = {}) {
  const force = options.force === true;
  if (!force && typeof isActiveViewportInput === 'function' && isActiveViewportInput()) {
    scheduleDrawableBitmapWarmupQueue();
    return;
  }
  const budgetMs = Math.max(1, Number(options.budgetMs) || 4);
  const maxItems = Math.max(1, Math.trunc(Number(options.maxItems) || 4));
  const start = performance.now();
  let count = 0;
  for (const [source, meta] of drawableBitmapWarmupQueue) {
    if (count >= maxItems || (count > 0 && performance.now() - start >= budgetMs)) break;
    drawableBitmapWarmupQueue.delete(source);
    warmDrawableBitmapForDrawNow(source, meta);
    count++;
  }
  if (drawableBitmapWarmupQueue.size) scheduleDrawableBitmapWarmupQueue();
}

function scheduleDrawableBitmapWarmupQueue() {
  if (drawableBitmapWarmupScheduled) return;
  drawableBitmapWarmupScheduled = true;
  const run = () => {
    drawableBitmapWarmupScheduled = false;
    runDrawableBitmapWarmupQueue();
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 400 });
  } else {
    setTimeout(run, 32);
  }
}

function scheduleDrawableBitmapWarmup(source, meta = {}, options = {}) {
  if (!isImageVariantDrawableSource(source)) return false;
  if (drawableBitmapWarmupReady.has(source) || drawableBitmapWarmupQueue.has(source)) {
    return false;
  }
  drawableBitmapWarmupQueue.set(source, meta);
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    drawableBitmapWarmupQueuedCount++;
    countDrawableBitmapWarmupKind(drawableBitmapWarmupQueuedByKind, meta);
  }
  if (options.immediate === true) {
    runDrawableBitmapWarmupQueue({
      force: true,
      budgetMs: options.budgetMs,
      maxItems: options.maxItems || 1,
    });
  } else {
    scheduleDrawableBitmapWarmupQueue();
  }
  return true;
}

function scaledVariantEstimatedBytes(sourceW, sourceH, scale) {
  return Math.max(1, Math.ceil(sourceW * scale)) * Math.max(1, Math.ceil(sourceH * scale)) * 4;
}

function pendingScaledVariantBytes() {
  return imageScaledBitmapPendingByteTotal;
}

function addPendingScaledVariantBytes(key, bytes) {
  imageScaledBitmapPending.set(key, bytes);
  imageScaledBitmapPendingByteTotal += bytes;
}

function removePendingScaledVariantBytes(key) {
  const bytes = imageScaledBitmapPending.get(key) || 0;
  if (imageScaledBitmapPending.delete(key)) {
    imageScaledBitmapPendingByteTotal -= bytes;
  }
}

function clearScaledImageVariants(key = null) {
  if (key) {
    imageScaledBitmapStore.removeGroup(key);
    dropDrawableBitmapWarmupsForKey(key);
    if (imageScaledVariantQueue.length) {
      let write = 0;
      for (let read = 0; read < imageScaledVariantQueue.length; read++) {
        const task = imageScaledVariantQueue[read];
        if (task?.variantKey === key) continue;
        imageScaledVariantQueue[write++] = task;
      }
      imageScaledVariantQueue.length = write;
      if (!imageScaledVariantQueue.length) cancelScheduledScaledVariantQueue();
    }
    for (const pendingKey of imageScaledBitmapPending.keys()) {
      if (pendingKey.startsWith(`${key}:`)) {
        removePendingScaledVariantBytes(pendingKey);
      }
    }
    for (const failedKey of imageScaledBitmapFailures.keys()) {
      if (failedKey.startsWith(`${key}:`)) imageScaledBitmapFailures.delete(failedKey);
    }
    imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
    return;
  }
  imageScaledBitmapStore.clear();
  imageScaledBitmapPending.clear();
  imageScaledBitmapFailures.clear();
  imageScaledVariantFailureReleaseScheduled = false;
  imageScaledBitmapPendingByteTotal = 0;
  imageScaledVariantQueue.length = 0;
  cancelScheduledScaledVariantQueue();
  imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
  clearTimeout(imageScaledVariantRenderTimer);
  imageScaledVariantRenderTimer = null;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    imageScaledVariantRenderCount = 0;
    imageScaledVariantBuildCount = 0;
    imageScaledVariantBuildTotalMs = 0;
    imageScaledVariantBuildMaxMs = 0;
    imageScaledVariantResizeBitmapCount = 0;
    imageScaledVariantCanvasFallbackCount = 0;
    imageScaledVariantEvictionCount = 0;
    imageScaledVariantMemorySkipCount = 0;
    imageScaledVariantActiveInputFullFallbackCount = 0;
    imageScaledVariantPriorityBoostCount = 0;
    imageScaledVariantPrewarmRunCount = 0;
    imageScaledVariantPrewarmCandidateCount = 0;
    imageScaledVariantPrewarmQueuedCount = 0;
    imageScaledVariantPrewarmReadyCount = 0;
    imageScaledVariantPrewarmNoSourceCount = 0;
    imageScaledVariantSourceReadyCandidateCount = 0;
    imageScaledVariantSourceReadyQueuedCount = 0;
    imageScaledVariantSourceReadyReadyCount = 0;
    imageScaledVariantSourceReadyNoSourceCount = 0;
    imageScaledVariantSourceReadyFullScaleCount = 0;
  }
  drawableBitmapWarmupQueue.clear();
  drawableBitmapWarmupScheduled = false;
  drawableBitmapWarmupReady = typeof WeakSet !== 'undefined' ? new WeakSet() : new Set();
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    drawableBitmapWarmupQueuedCount = 0;
    drawableBitmapWarmupWarmedCount = 0;
    drawableBitmapWarmupTotalMs = 0;
    drawableBitmapWarmupMaxMs = 0;
    drawableBitmapWarmupTotalPixels = 0;
    drawableBitmapWarmupMaxPixels = 0;
    drawableBitmapWarmupErrorCount = 0;
    drawableBitmapWarmupUnsupportedCount = 0;
    drawableBitmapWarmupQueuedByKind = {};
    drawableBitmapWarmupWarmedByKind = {};
  }
  clearTimeout(imageScaledVariantPrewarmTimer);
  imageScaledVariantPrewarmTimer = null;
}

function scheduleScaledVariantReadyRender(
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  countReadyVariant = true
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  if (typeof BOARDFISH_PRODUCTION === 'undefined' && countReadyVariant) imageScaledVariantRenderCount++;
  invalidateOffscreen();
  if (typeof hasOpenInitialImagePreviews === 'function' && hasOpenInitialImagePreviews()) {
    const previewRelease = typeof releaseReadyOpenInitialImagePreviewsForOpen === 'function'
      ? releaseReadyOpenInitialImagePreviewsForOpen()
      : null;
    if (typeof BOARDFISH_PRODUCTION === 'undefined' &&
      (previewRelease?.released || previewRelease?.pending || previewRelease?.failed) &&
      typeof OpenDebug !== 'undefined') {
      OpenDebug.step?.(null, 'open-preview-release', {
        ...previewRelease,
        source: 'image-scale-variant',
      });
    }
    if (previewRelease?.released) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        const count = imageScaledVariantRenderCount;
        imageScaledVariantRenderCount = 0;
        scheduleRender(true, null, `open-preview-scaled-variant-release-${count}`);
      } else {
        scheduleRender(true);
      }
      return;
    }
    if (!previewRelease || previewRelease.pending > 0) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined' && typeof OpenDebug !== 'undefined') OpenDebug.recordPreviewHeldRender?.({
        source: 'image-scale-variant',
        pendingReadyVariants: imageScaledVariantRenderCount,
      });
      return;
    }
  }
  const inputIdleMs = performance.now() - lastViewportInputAt;
  if (imageScaledVariantRenderTimer) return;
  imageScaledVariantRenderTimer = setTimeout(() => {
    imageScaledVariantRenderTimer = null;
    if (isActiveViewportInput()) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        scheduleScaledVariantReadyRender(false);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } else {
        scheduleScaledVariantReadyRender();
      }
      return;
    }
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const count = imageScaledVariantRenderCount;
      imageScaledVariantRenderCount = 0;
      scheduleRender(true, null, `image-scale-variant-batch-${count}`);
    } else {
      scheduleRender(true);
    }
  }, inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS ? Math.max(40, IMAGE_VARIANT_INPUT_IDLE_MS - inputIdleMs) : 120);
}

function enqueueScaledVariantTask(task, priority = false) {
  task.priority = priority === true;
  if (task.priority) {
    imageScaledVariantQueue.unshift(task);
    cancelScheduledScaledVariantQueue();
  } else {
    imageScaledVariantQueue.push(task);
  }
  scheduleScaledVariantQueue();
}

function prioritizeScaledVariantQueue(pendingKey) {
  if (!pendingKey || !imageScaledVariantQueue.length) return false;
  const index = imageScaledVariantQueue.findIndex((task) => task?.pendingKey === pendingKey);
  if (index < 0) return false;
  const task = imageScaledVariantQueue[index];
  const boosted = task.priority !== true || index > 0;
  if (!boosted) return false;
  task.priority = true;
  if (index > 0) {
    imageScaledVariantQueue.splice(index, 1);
    imageScaledVariantQueue.unshift(task);
  }
  if (typeof BOARDFISH_PRODUCTION === 'undefined') imageScaledVariantPriorityBoostCount++;
  cancelScheduledScaledVariantQueue();
  scheduleScaledVariantQueue();
  return true;
}

function shouldBuildScaledImageVariant(pendingKey, generation) {
  return generation === _imageStoreGeneration && imageScaledBitmapPending.has(pendingKey);
}

async function createScaledImageVariantBitmap(source, sourceW, sourceH, scale) {
  const w = Math.max(1, Math.ceil(sourceW * scale));
  const h = Math.max(1, Math.ceil(sourceH * scale));
  try {
    const bitmap = await createImageBitmap(source, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
    if (typeof BOARDFISH_PRODUCTION === 'undefined') imageScaledVariantResizeBitmapCount++;
    return bitmap;
  } catch (_) {
    if (typeof document === 'undefined') throw _;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(source, 0, 0, w, h);
    const bitmap = await createImageBitmap(canvas);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') imageScaledVariantCanvasFallbackCount++;
    return bitmap;
  }
}

async function buildScaledImageVariantNow(key, source, scale, options = {}) {
  if (!isViewportImageScalingActive() || !key || !source || scale >= 1) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, ready: false, skipped: 'disabled-or-invalid' }
      : false;
  }
  const pendingKey = `${key}:${scale}`;
  if (hasScaledImageVariant(key, scale)) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, ready: true, skipped: 'already-ready' }
      : true;
  }
  if (imageScaledBitmapPending.has(pendingKey)) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, ready: false, skipped: 'pending' }
      : false;
  }
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, ready: false, skipped: 'missing-size' }
      : false;
  }
  const estimatedBytes = scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (imageScaledBitmapBytes + pendingScaledVariantBytes() + estimatedBytes > IMAGE_VARIANT_MEMORY_LIMIT) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      imageScaledVariantMemorySkipCount++;
      recordScaledImageVariantFailure(key, scale, 'memory-limit');
      return { key, scale, ready: false, skipped: 'memory-limit', estimatedBytes };
    }
    recordScaledImageVariantFailure(key, scale);
    return false;
  }

  imageScaledBitmapFailures.delete(pendingKey);
  addPendingScaledVariantBytes(pendingKey, estimatedBytes);
  const generation = _imageStoreGeneration;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const buildStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let bitmap = null;
  try {
    bitmap = await createScaledImageVariantBitmap(source, sourceW, sourceH, scale);
    if (!shouldBuildScaledImageVariant(pendingKey, generation)) {
      bitmap.close?.();
      return typeof BOARDFISH_PRODUCTION === 'undefined'
        ? { key, scale, ready: false, skipped: 'stale', ms: performance.now() - buildStart }
        : false;
    }
    const bytes = bitmapByteSize(bitmap);
    imageScaledBitmapStore.set(key, scale, { bitmap, bytes });
    const warmupMeta = { kind: 'scaled-variant', key };
    if (typeof BOARDFISH_PRODUCTION === 'undefined') Object.assign(warmupMeta, { scale, source: 'build-now' });
    scheduleDrawableBitmapWarmup(bitmap, warmupMeta, {
      immediate: options.warmupImmediate === true,
      budgetMs: 8,
      maxItems: 1,
    });
    bitmap = null;
    imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
    if (options.scheduleRender !== false) scheduleScaledVariantReadyRender();
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, ready: true, bytes, ms: performance.now() - buildStart }
      : true;
  } catch (err) {
    bitmap?.close?.();
    if (shouldBuildScaledImageVariant(pendingKey, generation)) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') recordScaledImageVariantFailure(key, scale, 'error');
      else recordScaledImageVariantFailure(key, scale);
    }
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, ready: false, skipped: 'error', error: String(err), ms: performance.now() - buildStart }
      : false;
  } finally {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const buildMs = performance.now() - buildStart;
      imageScaledVariantBuildCount++;
      imageScaledVariantBuildTotalMs += buildMs;
      imageScaledVariantBuildMaxMs = Math.max(imageScaledVariantBuildMaxMs, buildMs);
    }
    removePendingScaledVariantBytes(pendingKey);
  }
}

function cancelScheduledScaledVariantQueue() {
  if (imageScaledVariantQueueTimer !== null) clearTimeout(imageScaledVariantQueueTimer);
  imageScaledVariantQueueTimer = null;
  imageScaledVariantQueueScheduled = false;
}

function scaledVariantQueueTaskIdleThresholdMs(task) {
  if (task?.priority === true) {
    return Math.max(0, Number(IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS) || 0);
  }
  return Math.max(0, Number(IMAGE_VARIANT_INPUT_IDLE_MS) || 0);
}

function scheduleScaledVariantQueue() {
  const concurrency = Math.max(1, Math.trunc(Number(IMAGE_VARIANT_QUEUE_CONCURRENCY) || 1));
  if (imageScaledVariantQueueActive >= concurrency) return;
  if (!imageScaledVariantQueue.length) return;
  if (imageScaledVariantQueueScheduled) return;
  imageScaledVariantQueueScheduled = true;
  const runReadyTasks = () => {
    while (imageScaledVariantQueue.length && imageScaledVariantQueueActive < concurrency) {
      const task = imageScaledVariantQueue[0];
      if (!task) {
        imageScaledVariantQueue.shift();
        continue;
      }
      const inputIdleMs = activeViewportInputIdleMs();
      if (inputIdleMs < scaledVariantQueueTaskIdleThresholdMs(task)) break;
      imageScaledVariantQueue.shift();
      imageScaledVariantQueueActive++;
      task()
        .catch(() => {})
        .finally(() => {
          imageScaledVariantQueueActive = Math.max(0, imageScaledVariantQueueActive - 1);
          if (imageScaledVariantQueue.length) scheduleScaledVariantQueue();
        });
    }
  };
  const run = () => {
    imageScaledVariantQueueTimer = null;
    imageScaledVariantQueueScheduled = false;
    runReadyTasks();
    if (imageScaledVariantQueue.length && imageScaledVariantQueueActive < concurrency) {
      scheduleScaledVariantQueue();
    }
  };
  const inputIdleMs = activeViewportInputIdleMs();
  const idleThresholdMs = scaledVariantQueueTaskIdleThresholdMs(imageScaledVariantQueue[0]);
  const delay = inputIdleMs < idleThresholdMs ? idleThresholdMs - inputIdleMs : 0;
  imageScaledVariantQueueTimer = setTimeout(run, delay);
}

function chooseImageScaleForDraw(obj, source, view = { zoom, dpr: window.devicePixelRatio || 1 }, activeOverscale = false) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return 1;
  const viewZoom = Math.max(view?.zoom || zoom || 1, 0.0001);
  const dpr = view?.dpr || window.devicePixelRatio || 1;
  const neededW = obj.w * viewZoom * dpr;
  const neededH = obj.h * viewZoom * dpr;
  const overscaleLimit = activeOverscale === true
    ? Math.max(1, Number(IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT) || 1)
    : 1;
  const scale = IMAGE_SCALE_LEVELS[0];
  return sourceW * scale * overscaleLimit >= neededW &&
    sourceH * scale * overscaleLimit >= neededH ? scale : 1;
}

function queueScaledImageVariant(key, source, scale, priority = false) {
  if (!isViewportImageScalingActive() || !key || !source || scale >= 1) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, queued: false, skipped: 'disabled-or-invalid' }
      : false;
  }
  const pendingKey = `${key}:${scale}`;
  if (hasScaledImageVariant(key, scale)) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, queued: false, skipped: 'already-ready' }
      : false;
  }
  if (imageScaledBitmapPending.has(pendingKey)) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const priorityBoosted = priority === true && prioritizeScaledVariantQueue(pendingKey);
      return { key, scale, queued: false, skipped: 'pending', priorityBoosted };
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    if (priority === true) prioritizeScaledVariantQueue(pendingKey);
    return false;
  }
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { key, scale, queued: false, skipped: 'missing-size' }
      : false;
  }
  const estimatedBytes = scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (imageScaledBitmapBytes + pendingScaledVariantBytes() + estimatedBytes > IMAGE_VARIANT_MEMORY_LIMIT) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      imageScaledVariantMemorySkipCount++;
      recordScaledImageVariantFailure(key, scale, 'memory-limit');
      return { key, scale, queued: false, skipped: 'memory-limit', estimatedBytes };
    }
    recordScaledImageVariantFailure(key, scale);
    return false;
  }
  imageScaledBitmapFailures.delete(pendingKey);
  addPendingScaledVariantBytes(pendingKey, estimatedBytes);
  const generation = _imageStoreGeneration;
  const task = async () => {
    if (!shouldBuildScaledImageVariant(pendingKey, generation)) {
      removePendingScaledVariantBytes(pendingKey);
      return;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const buildStart = performance.now();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    let bitmap = null;
    try {
      bitmap = await createScaledImageVariantBitmap(source, sourceW, sourceH, scale);
      if (!shouldBuildScaledImageVariant(pendingKey, generation)) {
        bitmap.close?.();
        return;
      }
      const bytes = bitmapByteSize(bitmap);
      imageScaledBitmapStore.set(key, scale, { bitmap, bytes });
      const warmupMeta = { kind: 'scaled-variant', key };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') Object.assign(warmupMeta, { scale, source: 'queue' });
      scheduleDrawableBitmapWarmup(bitmap, warmupMeta);
      bitmap = null;
      imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
      scheduleScaledVariantReadyRender();
    } catch (_) {
      bitmap?.close?.();
      if (shouldBuildScaledImageVariant(pendingKey, generation)) {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') recordScaledImageVariantFailure(key, scale, 'error');
        else recordScaledImageVariantFailure(key, scale);
      }
    } finally {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        const buildMs = performance.now() - buildStart;
        imageScaledVariantBuildCount++;
        imageScaledVariantBuildTotalMs += buildMs;
        imageScaledVariantBuildMaxMs = Math.max(imageScaledVariantBuildMaxMs, buildMs);
      }
      removePendingScaledVariantBytes(pendingKey);
    }
  };
  task.variantKey = key;
  task.pendingKey = pendingKey;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') task.generation = generation;
  enqueueScaledVariantTask(task, priority);
  return typeof BOARDFISH_PRODUCTION === 'undefined'
    ? { key, scale, queued: true, priority: priority === true, estimatedBytes }
    : true;
}

function queueScaledImageVariantForReadyImage(key, source, options = {}) {
  if (typeof BOARDFISH_PRODUCTION === 'undefined') imageScaledVariantSourceReadyCandidateCount++;
  if (!isViewportImageScalingActive() || !key) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      imageScaledVariantSourceReadyNoSourceCount++;
      return { queued: false, skipped: 'disabled-or-invalid' };
    }
    return false;
  }
  if (!isImageVariantDrawableSource(source)) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      imageScaledVariantSourceReadyNoSourceCount++;
      return { key, queued: false, skipped: 'missing-source' };
    }
    return false;
  }
  const scale = Number(options.scale) || IMAGE_SCALE_LEVELS[0] || 0.25;
  if (!(scale > 0 && scale < 1)) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      imageScaledVariantSourceReadyFullScaleCount++;
      return { key, scale, queued: false, skipped: 'full-scale' };
    }
    return false;
  }
  const result = queueScaledImageVariant(key, source, scale, options.priority === true);
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    if (result?.queued) imageScaledVariantSourceReadyQueuedCount++;
    else if (result?.skipped === 'already-ready' || result?.skipped === 'pending') {
      imageScaledVariantSourceReadyReadyCount++;
    }
    return result || { key, scale, queued: false, skipped: 'not-queued' };
  }
  return result;
}

function queueScaledImageVariantForDraw(key, obj, source, view = { zoom, dpr: window.devicePixelRatio || 1 }, priority = false, activeOverscale = false) {
  const targetScale = chooseImageScaleForDraw(obj, source, view, activeOverscale);
  if (targetScale < 1) queueScaledImageVariant(key, source, targetScale, priority);
  return targetScale;
}

async function prewarmVisibleScaledImageVariantsForOpen(options = {}) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const startedAt = typeof BOARDFISH_PRODUCTION === 'undefined' ? performance.now() : 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!isViewportImageScalingActive()) {
    return typeof BOARDFISH_PRODUCTION === 'undefined' ? { skipped: 'disabled' } : undefined;
  }
  const padPx = Number.isFinite(options.padPx) ? options.padPx : 0;
  const rect = typeof currentViewportWorldRect === 'function' ? currentViewportWorldRect(padPx) : null;
  if (!rect) return typeof BOARDFISH_PRODUCTION === 'undefined' ? { skipped: 'no-viewport' } : undefined;
  const view = {
    zoom: typeof zoom !== 'undefined' ? zoom : 1,
    dpr: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
  };
  const seen = new Set();
  const tasks = [];
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let candidates = 0;
  let alreadyReady = 0;
  let noSource = 0;
  let fullScale = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (const obj of objects) {
    if (obj?.type !== 'image' || !obj.data?.imgKey || !objectIntersectsRect(obj, rect)) continue;
    const key = obj.data.imgKey;
    if (seen.has(key)) continue;
    seen.add(key);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') candidates++;
    const source = imageBitmapCache[key] || null;
    if (!isImageVariantDrawableSource(source)) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') noSource++;
      continue;
    }
    const scale = chooseImageScaleForDraw(obj, source, view);
    if (!(scale > 0 && scale < 1)) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') fullScale++;
      continue;
    }
    if (hasScaledImageVariant(key, scale)) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') alreadyReady++;
      continue;
    }
    tasks.push({ key, source, scale });
  }
  tasks.sort((a, b) => bitmapByteSize(b.source) - bitmapByteSize(a.source));
  const limit = Math.max(0, Math.floor(Number(options.limit) || tasks.length));
  if (tasks.length > limit) tasks.length = limit;
  const concurrency = Math.max(1, Math.min(8, Math.floor(Number(options.concurrency) || 4), tasks.length || 1));
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
    await mapWithConcurrency(tasks, concurrency, ({ key, source, scale }) =>
      buildScaledImageVariantNow(key, source, scale, {
        scheduleRender: false,
        warmupImmediate: true,
      }), false);
    return;
  }
  let built = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;
  const results = await mapWithConcurrency(tasks, concurrency, async ({ key, source, scale }) => {
    const result = await buildScaledImageVariantNow(key, source, scale, {
      scheduleRender: false,
      warmupImmediate: true,
    });
    if (result.ready && !result.skipped) {
      built++;
      bytes += Number(result.bytes) || 0;
    } else if (result.skipped === 'already-ready') {
      alreadyReady++;
    } else if (result.skipped === 'error') {
      failed++;
    } else {
      skipped++;
    }
    return result;
  });
  const resultCount = Math.min(24, results.length);
  const resultRows = new Array(resultCount);
  for (let i = 0; i < resultCount; i++) {
    const result = results[i];
    resultRows[i] = {
      key: result?.key || '',
      scale: result?.scale ?? '',
      ready: result?.ready === true,
      skipped: result?.skipped || '',
      ms: result?.ms ?? '',
      bytes: result?.bytes ?? '',
      error: result?.error || '',
    };
  }
  return {
    candidates,
    selected: tasks.length,
    built,
    alreadyReady,
    noSource,
    fullScale,
    failed,
    skipped,
    bytes,
    mb: Math.round(bytes / 1024 / 1024 * 100) / 100,
    concurrency,
    padPx,
    ms: performance.now() - startedAt,
    results: resultRows,
  };
}

function hasScaledImageVariant(key, scale) {
  return !!imageScaledBitmapStore.get(key, scale, false);
}

function isScaledImageVariantPending(key, scale) {
  return imageScaledBitmapPending.has(`${key}:${scale}`);
}

function hasScaledImageVariantFailure(key, scale) {
  return imageScaledBitmapFailures.has(`${key}:${scale}`);
}

function scheduleScaledVariantFailurePreviewRelease() {
  if (imageScaledVariantFailureReleaseScheduled ||
      typeof hasOpenInitialImagePreviews !== 'function' ||
      !hasOpenInitialImagePreviews()) return;
  imageScaledVariantFailureReleaseScheduled = true;
  setTimeout(() => {
    imageScaledVariantFailureReleaseScheduled = false;
    if (typeof hasOpenInitialImagePreviews === 'function' && hasOpenInitialImagePreviews()) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        scheduleScaledVariantReadyRender(false);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } else {
        scheduleScaledVariantReadyRender();
      }
    }
  }, 0);
}

function recordScaledImageVariantFailure(key, scale, reason) {
  imageScaledBitmapFailures.set(
    `${key}:${scale}`,
    typeof BOARDFISH_PRODUCTION === 'undefined' ? (reason || 'error') : true,
  );
  scheduleScaledVariantFailurePreviewRelease();
}

function activeViewportInputIdleMs() {
  if (!(lastViewportInputAt > 0)) return Infinity;
  return Math.max(0, performance.now() - lastViewportInputAt);
}

function isActiveViewportInput() {
  return activeViewportInputIdleMs() < IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS;
}

function prewarmVisibleScaledImageVariants(options = {}) {
  if (!isViewportImageScalingActive() || _boardOpening) {
    return typeof BOARDFISH_PRODUCTION === 'undefined' ? { skipped: 'disabled-or-opening' } : undefined;
  }
  const scale = Number(options.scale) || IMAGE_SCALE_LEVELS[0] || 0.25;
  if (!(scale > 0 && scale < 1)) {
    return typeof BOARDFISH_PRODUCTION === 'undefined' ? { skipped: 'invalid-scale' } : undefined;
  }
  const padPx = Number.isFinite(options.padPx) ? options.padPx : IMAGE_VARIANT_PREWARM_PAD_PX;
  const rect = typeof currentViewportWorldRect === 'function' ? currentViewportWorldRect(padPx) : null;
  if (!rect) return typeof BOARDFISH_PRODUCTION === 'undefined' ? { skipped: 'no-viewport' } : undefined;

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let candidates = 0;
  let ready = 0;
  let queued = 0;
  let noSource = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (const obj of objects) {
    if (obj?.type !== 'image' || !obj.data?.imgKey || !objectIntersectsRect(obj, rect)) continue;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') candidates++;
    const key = obj.data.imgKey;
    if (hasScaledImageVariant(key, scale) || isScaledImageVariantPending(key, scale)) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') ready++;
      continue;
    }
    const source = imageBitmapCache[key] || null;
    if (!isImageVariantDrawableSource(source)) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') noSource++;
      continue;
    }
    queueScaledImageVariant(key, source, scale);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') queued++;
  }

  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    imageScaledVariantPrewarmRunCount++;
    imageScaledVariantPrewarmCandidateCount += candidates;
    imageScaledVariantPrewarmReadyCount += ready;
    imageScaledVariantPrewarmQueuedCount += queued;
    imageScaledVariantPrewarmNoSourceCount += noSource;
    return { candidates, ready, queued, noSource, scale, padPx };
  }
}

function scheduleVisibleImageWorkAfterIdle(
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  reason,
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  delayMs = IMAGE_VARIANT_INPUT_IDLE_MS
) {
  if (typeof BOARDFISH_PRODUCTION === 'undefined' && reason === undefined) reason = 'viewport-settled';
  if (_boardOpening) return;
  if (imageScaledVariantPrewarmTimer !== null) return;
  imageScaledVariantPrewarmTimer = setTimeout(() => {
    imageScaledVariantPrewarmTimer = null;
    if (_boardOpening) return;
    const inputIdleMs = performance.now() - lastViewportInputAt;
    if (inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS) {
      scheduleVisibleImageWorkAfterIdle(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        reason,
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        IMAGE_VARIANT_INPUT_IDLE_MS - inputIdleMs
      );
      return;
    }
    queueVisibleImageHydration(1);
    if (!isViewportImageScalingActive()) return;
    prewarmVisibleScaledImageVariants(
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      { reason }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    );
  }, Math.max(0, delayMs));
}

function selectImageSourceForDraw(key, obj, fullSource, view = { zoom, dpr: window.devicePixelRatio || 1 }, activeInput = null) {
  if (!isViewportImageScalingActive()) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { source: fullSource, scale: 1, targetScale: 1, disabled: true }
      : fullSource;
  }
  activeInput = activeInput === true || (activeInput !== false && isActiveViewportInput());
  const targetScale = chooseImageScaleForDraw(obj, fullSource, view, activeInput);
  const entry = targetScale < 1 ? imageScaledBitmapStore.get(key, targetScale, false) : null;
  if (entry) {
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? { source: entry.bitmap, scale: targetScale, targetScale }
      : entry.bitmap;
  }
  if (targetScale < 1) queueScaledImageVariant(key, fullSource, targetScale, activeInput);
  if (activeInput && targetScale < 1 && isScaledImageVariantPending(key, targetScale)) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') imageScaledVariantActiveInputFullFallbackCount++;
    return typeof BOARDFISH_PRODUCTION === 'undefined'
      ? {
          source: fullSource,
          scale: 1,
          targetScale,
          scaledVariantPending: true,
          activeInputFullFallback: true,
        }
      : { source: fullSource, activeInputFullFallback: true };
  }
  return typeof BOARDFISH_PRODUCTION === 'undefined'
    ? { source: fullSource, scale: 1, targetScale }
    : fullSource;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function setViewportPerfMode(modeKey) {
  const mode = VIEWPORT_PERF_MODES[String(modeKey)];
  if (!mode) return null;
  viewportCullingEnabled = !!mode.culling;
  viewportImageScalingEnabled = VIEWPORT_IMAGE_SCALING_SUPPORTED && !!mode.scaling;
  if (!viewportImageScalingEnabled) clearScaledImageVariants();
  invalidateOffscreen();
  scheduleRender(true, null, `viewport-perf-mode-${modeKey}`);
  const out = viewportPerfModeSummary(modeKey);
  console.info(`[Boardfish viewport] mode ${modeKey}: ${mode.label}`);
  return out;
}

function viewportPerfModeSummary(modeKey = null) {
  let activeKey = '';
  let activeMode = null;
  for (const key in VIEWPORT_PERF_MODES) {
    if (!Object.prototype.hasOwnProperty.call(VIEWPORT_PERF_MODES, key)) continue;
    const mode = VIEWPORT_PERF_MODES[key];
    if (mode.culling === viewportCullingEnabled && mode.scaling === viewportImageScalingEnabled) {
      activeKey = key;
      activeMode = mode;
      break;
    }
  }
  const key = modeKey || activeKey || '';
  const mode = VIEWPORT_PERF_MODES[key] || activeMode || {};
  return {
    key,
    label: mode.label || 'custom',
    culling: viewportCullingEnabled,
    scalingEnabled: viewportImageScalingEnabled,
    scaleLevels: viewportImageScalingEnabled ? IMAGE_SCALE_LEVELS.join(',') : 'off',
  };
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */
