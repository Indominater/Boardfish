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
var VIEWPORT_PERF_MODES = {
  '1': { label: 'culling + scaled images', culling: true, scaling: true },
  '2': { label: 'scaled images only', culling: false, scaling: true },
  '3': { label: 'culling only', culling: true, scaling: false },
  '4': { label: 'none', culling: false, scaling: false },
};
var imageScaledBitmapStore = BoardfishBitmapCache.createGroupedLruCache({
  memoryLimit: IMAGE_VARIANT_MEMORY_LIMIT,
  onEvict(entry) {
    imageScaledVariantEvictionCount++;
    dropDrawableBitmapWarmup(entry?.bitmap);
  },
});
var imageScaledBitmapCache = imageScaledBitmapStore.groups; // key -> Map(scale -> { bitmap, bytes, lastUsed })
var imageScaledBitmapPending = new Set();
var imageScaledBitmapPendingBytes = new Map();
var imageScaledBitmapPendingByteTotal = 0;
var imageScaledBitmapBytes = 0;
var imageScaledBitmapUseCounter = 1;
var imageScaledVariantRenderTimer = null;
var imageScaledVariantRenderCount = 0;
var imageScaledVariantQueue = [];
var imageScaledVariantQueueScheduled = false;
var imageScaledVariantQueueActive = 0;
var lastViewportInputAt = 0;
var IMAGE_VARIANT_INPUT_IDLE_MS = 180;
var IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS = 0;
var IMAGE_VARIANT_QUEUE_CONCURRENCY = 4;
var IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS = 180;
var IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT = 1.18;
var imageScaledVariantBuildCount = 0;
var imageScaledVariantBuildTotalMs = 0;
var imageScaledVariantBuildMaxMs = 0;
var imageScaledVariantResizeBitmapCount = 0;
var imageScaledVariantCanvasFallbackCount = 0;
var imageScaledVariantEvictionCount = 0;
var imageScaledVariantMemorySkipCount = 0;
var imageScaledVariantActiveInputFullFallbackCount = 0;
var imageScaledVariantPriorityBoostCount = 0;
var imageScaledVariantPrewarmTimer = null;
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
var IMAGE_VARIANT_PREWARM_PAD_PX = 768;
var viewportCullingEnabled = true;
var VIEWPORT_IMAGE_SCALING_SUPPORTED = typeof createImageBitmap === 'function';
var viewportImageScalingEnabled = VIEWPORT_IMAGE_SCALING_SUPPORTED;
var drawableBitmapWarmupCanvas = null;
var drawableBitmapWarmupContext = null;
var drawableBitmapWarmupQueue = [];
var drawableBitmapWarmupScheduled = false;
var drawableBitmapWarmupQueued = typeof WeakSet !== 'undefined' ? new WeakSet() : new Set();
var drawableBitmapWarmupReady = typeof WeakSet !== 'undefined' ? new WeakSet() : new Set();
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

function drawableBitmapWarmupHas(set, source) {
  try { return !!set?.has?.(source); } catch (_) { return false; }
}

function drawableBitmapWarmupAdd(set, source) {
  try { set?.add?.(source); } catch (_) {}
}

function drawableBitmapWarmupDelete(set, source) {
  try { set?.delete?.(source); } catch (_) {}
}

function drawableBitmapWarmupKind(meta = {}) {
  const kind = String(meta.kind || '');
  if (kind === 'full-image') return 'fullImage';
  if (kind === 'scaled-variant') return 'scaledVariant';
  if (kind === 'open-preview') return 'openPreview';
  return 'other';
}

function countDrawableBitmapWarmupKind(target, meta = {}) {
  const kind = drawableBitmapWarmupKind(meta);
  target[kind] = (target[kind] || 0) + 1;
}

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
  drawableBitmapWarmupDelete(drawableBitmapWarmupQueued, source);
  drawableBitmapWarmupDelete(drawableBitmapWarmupReady, source);
  if (drawableBitmapWarmupQueue.length) {
    let write = 0;
    for (let read = 0; read < drawableBitmapWarmupQueue.length; read++) {
      const task = drawableBitmapWarmupQueue[read];
      if (task?.source === source) continue;
      drawableBitmapWarmupQueue[write++] = task;
    }
    drawableBitmapWarmupQueue.length = write;
  }
}

function dropDrawableBitmapWarmupsForKey(key) {
  if (!key || !drawableBitmapWarmupQueue.length) return;
  const kept = [];
  for (const task of drawableBitmapWarmupQueue) {
    if (task?.meta?.key === key) {
      drawableBitmapWarmupDelete(drawableBitmapWarmupQueued, task.source);
    } else {
      kept.push(task);
    }
  }
  drawableBitmapWarmupQueue = kept;
}

function drawableBitmapWarmupResetSet() {
  return typeof WeakSet !== 'undefined' ? new WeakSet() : new Set();
}

function drawableBitmapWarmup2dContext(width = 1, height = 1) {
  const w = Math.max(1, Math.trunc(Number(width) || 1));
  const h = Math.max(1, Math.trunc(Number(height) || 1));
  if (drawableBitmapWarmupContext) return drawableBitmapWarmupContext;
  if (typeof OffscreenCanvas !== 'undefined') {
    drawableBitmapWarmupCanvas = new OffscreenCanvas(w, h);
  } else if (typeof document !== 'undefined') {
    drawableBitmapWarmupCanvas = document.createElement('canvas');
    drawableBitmapWarmupCanvas.width = w;
    drawableBitmapWarmupCanvas.height = h;
  }
  const ctx = drawableBitmapWarmupCanvas?.getContext?.('2d', { alpha: false });
  if (!ctx) return null;
  if (drawableBitmapWarmupCanvas.width !== w) drawableBitmapWarmupCanvas.width = w;
  if (drawableBitmapWarmupCanvas.height !== h) drawableBitmapWarmupCanvas.height = h;
  try { ctx.imageSmoothingEnabled = false; } catch (_) {}
  try { ctx.imageSmoothingQuality = 'low'; } catch (_) {}
  drawableBitmapWarmupContext = ctx;
  return drawableBitmapWarmupContext;
}

function warmDrawableBitmapForDrawNow(source, meta = {}) {
  if (!isImageVariantDrawableSource(source)) return { warmed: false, skipped: 'not-drawable' };
  if (drawableBitmapWarmupHas(drawableBitmapWarmupReady, source)) return { warmed: false, skipped: 'already-warmed' };
  const target = drawableBitmapWarmupTargetSize(source, meta);
  const ctx = drawableBitmapWarmup2dContext(target.width, target.height);
  if (!ctx) {
    drawableBitmapWarmupUnsupportedCount++;
    return { warmed: false, skipped: 'unsupported' };
  }
  const start = performance.now();
  try {
    if (drawableBitmapWarmupCanvas) {
      if (drawableBitmapWarmupCanvas.width !== target.width) drawableBitmapWarmupCanvas.width = target.width;
      if (drawableBitmapWarmupCanvas.height !== target.height) drawableBitmapWarmupCanvas.height = target.height;
    }
    try { ctx.imageSmoothingEnabled = false; } catch (_) {}
    try { ctx.imageSmoothingQuality = 'low'; } catch (_) {}
    ctx.clearRect?.(0, 0, target.width, target.height);
    if (target.sourceW > 0 && target.sourceH > 0) {
      ctx.drawImage(source, 0, 0, target.sourceW, target.sourceH, 0, 0, target.width, target.height);
    } else {
      ctx.drawImage(source, 0, 0, target.width, target.height);
    }
    const ms = performance.now() - start;
    const pixels = target.width * target.height;
    drawableBitmapWarmupAdd(drawableBitmapWarmupReady, source);
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
  } catch (err) {
    drawableBitmapWarmupErrorCount++;
    return { warmed: false, skipped: 'error', error: String(err), meta };
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
  while (drawableBitmapWarmupQueue.length && count < maxItems) {
    if (count > 0 && performance.now() - start >= budgetMs) break;
    const task = drawableBitmapWarmupQueue.shift();
    drawableBitmapWarmupDelete(drawableBitmapWarmupQueued, task.source);
    warmDrawableBitmapForDrawNow(task.source, task.meta);
    count++;
  }
  if (drawableBitmapWarmupQueue.length) scheduleDrawableBitmapWarmupQueue();
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
  if (drawableBitmapWarmupHas(drawableBitmapWarmupReady, source) ||
      drawableBitmapWarmupHas(drawableBitmapWarmupQueued, source)) {
    return false;
  }
  drawableBitmapWarmupAdd(drawableBitmapWarmupQueued, source);
  drawableBitmapWarmupQueue.push({ source, meta });
  drawableBitmapWarmupQueuedCount++;
  countDrawableBitmapWarmupKind(drawableBitmapWarmupQueuedByKind, meta);
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
  const previous = imageScaledBitmapPendingBytes.get(key) || 0;
  imageScaledBitmapPendingBytes.set(key, bytes);
  imageScaledBitmapPendingByteTotal += bytes - previous;
}

function removePendingScaledVariantBytes(key) {
  const bytes = imageScaledBitmapPendingBytes.get(key) || 0;
  if (imageScaledBitmapPendingBytes.delete(key)) {
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
    }
    for (const pendingKey of imageScaledBitmapPending) {
      if (pendingKey.startsWith(`${key}:`)) {
        imageScaledBitmapPending.delete(pendingKey);
        removePendingScaledVariantBytes(pendingKey);
      }
    }
    imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
    return;
  }
  imageScaledBitmapStore.clear();
  imageScaledBitmapPending.clear();
  imageScaledBitmapPendingBytes.clear();
  imageScaledBitmapPendingByteTotal = 0;
  imageScaledVariantQueue.length = 0;
  imageScaledVariantQueueScheduled = false;
  imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
  clearTimeout(imageScaledVariantRenderTimer);
  imageScaledVariantRenderTimer = null;
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
  drawableBitmapWarmupQueue.length = 0;
  drawableBitmapWarmupScheduled = false;
  drawableBitmapWarmupQueued = drawableBitmapWarmupResetSet();
  drawableBitmapWarmupReady = drawableBitmapWarmupResetSet();
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
  clearTimeout(imageScaledVariantPrewarmTimer);
  imageScaledVariantPrewarmTimer = null;
}

function scheduleScaledVariantReadyRender(countReadyVariant = true) {
  if (countReadyVariant) imageScaledVariantRenderCount++;
  invalidateOffscreen();
  if (typeof hasOpenInitialImagePreviews === 'function' && hasOpenInitialImagePreviews()) {
    const previewRelease = typeof releaseReadyOpenInitialImagePreviewsForOpen === 'function'
      ? releaseReadyOpenInitialImagePreviewsForOpen()
      : null;
    if ((previewRelease?.released || previewRelease?.pending || previewRelease?.failed) &&
      typeof OpenDebug !== 'undefined') {
      OpenDebug.step?.(null, 'open-preview-release', {
        ...previewRelease,
        source: 'image-scale-variant',
      });
    }
    if (previewRelease?.released) {
      const count = imageScaledVariantRenderCount;
      imageScaledVariantRenderCount = 0;
      scheduleRender(true, false, `open-preview-scaled-variant-release-${count}`);
      return;
    }
    if (!previewRelease || previewRelease.pending > 0) {
      if (typeof OpenDebug !== 'undefined') OpenDebug.recordPreviewHeldRender?.({
        source: 'image-scale-variant',
        pendingReadyVariants: imageScaledVariantRenderCount,
      });
      return;
    }
  }
  const inputIdleMs = performance.now() - lastViewportInputAt;
  if (_frameRaf || _needTransform || _needBoardRender || inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS) {
    if (!imageScaledVariantRenderTimer) {
      const delay = Math.max(40, IMAGE_VARIANT_INPUT_IDLE_MS - inputIdleMs);
      imageScaledVariantRenderTimer = setTimeout(() => {
        imageScaledVariantRenderTimer = null;
        scheduleScaledVariantReadyRender(false);
      }, delay);
    }
    return;
  }
  if (imageScaledVariantRenderTimer) return;
  imageScaledVariantRenderTimer = setTimeout(() => {
    const count = imageScaledVariantRenderCount;
    imageScaledVariantRenderTimer = null;
    imageScaledVariantRenderCount = 0;
    scheduleRender(true, false, `image-scale-variant-batch-${count}`);
  }, 120);
}

function enqueueScaledVariantTask(task, options = {}) {
  if (options.priority === true) imageScaledVariantQueue.unshift(task);
  else imageScaledVariantQueue.push(task);
  scheduleScaledVariantQueue();
}

function prioritizeScaledVariantQueue(pendingKey) {
  if (!pendingKey || imageScaledVariantQueue.length <= 1) return false;
  const index = imageScaledVariantQueue.findIndex((task) => task?.pendingKey === pendingKey);
  if (index <= 0) return false;
  const [task] = imageScaledVariantQueue.splice(index, 1);
  imageScaledVariantQueue.unshift(task);
  imageScaledVariantPriorityBoostCount++;
  scheduleScaledVariantQueue();
  return true;
}

function shouldBuildScaledImageVariant(pendingKey, generation) {
  return generation === _imageStoreGeneration && imageScaledBitmapPending.has(pendingKey);
}

async function mapScaledVariantTasksWithConcurrency(items, limit, worker) {
  if (typeof mapWithConcurrency === 'function') return mapWithConcurrency(items, limit, worker);
  const out = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length));
  const workers = new Array(workerCount);
  for (let i = 0; i < workerCount; i++) {
    workers[i] = (async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await worker(items[index], index);
      }
    })();
  }
  await Promise.all(workers);
  return out;
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
    imageScaledVariantResizeBitmapCount++;
    return bitmap;
  } catch (_) {
    if (typeof document === 'undefined') throw _;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    setCanvasImageQuality(c);
    c.drawImage(source, 0, 0, w, h);
    const bitmap = await createImageBitmap(canvas);
    imageScaledVariantCanvasFallbackCount++;
    return bitmap;
  }
}

async function buildScaledImageVariantNow(key, source, scale, options = {}) {
  if (!isViewportImageScalingActive() || typeof createImageBitmap !== 'function' || !key || !source || scale >= 1) {
    return { key, scale, ready: false, skipped: 'disabled-or-invalid' };
  }
  const pendingKey = `${key}:${scale}`;
  const map = imageScaledBitmapCache.get(key);
  if (map?.has(scale)) return { key, scale, ready: true, skipped: 'already-ready' };
  if (imageScaledBitmapPending.has(pendingKey)) return { key, scale, ready: false, skipped: 'pending' };
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return { key, scale, ready: false, skipped: 'missing-size' };
  const estimatedBytes = scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (imageScaledBitmapBytes + pendingScaledVariantBytes() + estimatedBytes > IMAGE_VARIANT_MEMORY_LIMIT) {
    imageScaledVariantMemorySkipCount++;
    return { key, scale, ready: false, skipped: 'memory-limit', estimatedBytes };
  }

  imageScaledBitmapPending.add(pendingKey);
  addPendingScaledVariantBytes(pendingKey, estimatedBytes);
  const generation = _imageStoreGeneration;
  const buildStart = performance.now();
  let bitmap = null;
  try {
    bitmap = await createScaledImageVariantBitmap(source, sourceW, sourceH, scale);
    if (!shouldBuildScaledImageVariant(pendingKey, generation)) {
      bitmap.close?.();
      return { key, scale, ready: false, skipped: 'stale', ms: performance.now() - buildStart };
    }
    const bytes = bitmapByteSize(bitmap);
    imageScaledBitmapStore.set(key, scale, { bitmap, bytes });
    scheduleDrawableBitmapWarmup(bitmap, {
      kind: 'scaled-variant',
      key,
      scale,
      source: 'build-now',
    }, { immediate: options.warmupImmediate === true, budgetMs: 8, maxItems: 1 });
    bitmap = null;
    imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
    imageScaledBitmapUseCounter = imageScaledBitmapStore.useCounter;
    if (options.scheduleRender !== false) scheduleScaledVariantReadyRender();
    return { key, scale, ready: true, bytes, ms: performance.now() - buildStart };
  } catch (err) {
    bitmap?.close?.();
    return { key, scale, ready: false, skipped: 'error', error: String(err), ms: performance.now() - buildStart };
  } finally {
    const buildMs = performance.now() - buildStart;
    imageScaledVariantBuildCount++;
    imageScaledVariantBuildTotalMs += buildMs;
    imageScaledVariantBuildMaxMs = Math.max(imageScaledVariantBuildMaxMs, buildMs);
    imageScaledBitmapPending.delete(pendingKey);
    removePendingScaledVariantBytes(pendingKey);
  }
}

function scheduleScaledVariantQueue() {
  const concurrency = Math.max(1, Math.trunc(Number(IMAGE_VARIANT_QUEUE_CONCURRENCY) || 1));
  if (imageScaledVariantQueueActive >= concurrency) return;
  if (imageScaledVariantQueueScheduled) return;
  imageScaledVariantQueueScheduled = true;
  const activeInputQueueDelayMs = Math.max(0, Number(IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS) || 0);
  const runReadyTasks = () => {
    while (imageScaledVariantQueue.length && imageScaledVariantQueueActive < concurrency) {
      const task = imageScaledVariantQueue.shift();
      if (!task) continue;
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
    imageScaledVariantQueueScheduled = false;
    const inputIdleMs = performance.now() - lastViewportInputAt;
    const idleThresholdMs = activeInputQueueDelayMs;
    if (inputIdleMs < idleThresholdMs) {
      scheduleScaledVariantQueue();
      return;
    }
    runReadyTasks();
  };
  const inputIdleMs = performance.now() - lastViewportInputAt;
  const idleThresholdMs = activeInputQueueDelayMs;
  const delay = inputIdleMs < idleThresholdMs ? idleThresholdMs - inputIdleMs : 0;
  setTimeout(run, delay);
}

function chooseImageScaleForDraw(obj, source, view = { zoom, dpr: window.devicePixelRatio || 1 }, options = {}) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return 1;
  const viewZoom = Math.max(view?.zoom || zoom || 1, 0.0001);
  const dpr = view?.dpr || window.devicePixelRatio || 1;
  const neededW = obj.w * viewZoom * dpr;
  const neededH = obj.h * viewZoom * dpr;
  const overscaleLimit = options.activeOverscale === true
    ? Math.max(1, Number(IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT) || 1)
    : 1;
  let selectedScale = Infinity;
  for (const scale of IMAGE_SCALE_LEVELS) {
    if (sourceW * scale * overscaleLimit >= neededW &&
        sourceH * scale * overscaleLimit >= neededH &&
        scale < selectedScale) {
      selectedScale = scale;
    }
  }
  return Number.isFinite(selectedScale) ? selectedScale : 1;
}

function queueScaledImageVariant(key, source, scale, options = {}) {
  if (!isViewportImageScalingActive() || typeof createImageBitmap !== 'function' || !key || !source || scale >= 1) return;
  const pendingKey = `${key}:${scale}`;
  const map = imageScaledBitmapCache.get(key);
  if (map?.has(scale)) return;
  if (imageScaledBitmapPending.has(pendingKey)) {
    if (options.priority === true) prioritizeScaledVariantQueue(pendingKey);
    return;
  }
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return;
  const estimatedBytes = scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (imageScaledBitmapBytes + pendingScaledVariantBytes() + estimatedBytes > IMAGE_VARIANT_MEMORY_LIMIT) {
    imageScaledVariantMemorySkipCount++;
    return;
  }
  imageScaledBitmapPending.add(pendingKey);
  addPendingScaledVariantBytes(pendingKey, estimatedBytes);
  const generation = _imageStoreGeneration;
  const task = async () => {
    if (!shouldBuildScaledImageVariant(pendingKey, generation)) {
      imageScaledBitmapPending.delete(pendingKey);
      removePendingScaledVariantBytes(pendingKey);
      return;
    }
    const buildStart = performance.now();
    let bitmap = null;
    try {
      bitmap = await createScaledImageVariantBitmap(source, sourceW, sourceH, scale);
      if (!shouldBuildScaledImageVariant(pendingKey, generation)) {
        bitmap.close?.();
        return;
      }
      const bytes = bitmapByteSize(bitmap);
      imageScaledBitmapStore.set(key, scale, { bitmap, bytes });
      scheduleDrawableBitmapWarmup(bitmap, {
        kind: 'scaled-variant',
        key,
        scale,
        source: 'queue',
      });
      bitmap = null;
      imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
      imageScaledBitmapUseCounter = imageScaledBitmapStore.useCounter;
      scheduleScaledVariantReadyRender();
    } catch (_) {
      bitmap?.close?.();
    } finally {
      const buildMs = performance.now() - buildStart;
      imageScaledVariantBuildCount++;
      imageScaledVariantBuildTotalMs += buildMs;
      imageScaledVariantBuildMaxMs = Math.max(imageScaledVariantBuildMaxMs, buildMs);
      imageScaledBitmapPending.delete(pendingKey);
      removePendingScaledVariantBytes(pendingKey);
    }
  };
  task.variantKey = key;
  task.pendingKey = pendingKey;
  task.generation = generation;
  enqueueScaledVariantTask(task, { priority: options.priority === true });
}

function queueScaledImageVariantForReadyImage(key, source, options = {}) {
  imageScaledVariantSourceReadyCandidateCount++;
  if (!isViewportImageScalingActive() || typeof createImageBitmap !== 'function' || !key) {
    imageScaledVariantSourceReadyNoSourceCount++;
    return { queued: false, skipped: 'disabled-or-invalid' };
  }
  if (!isImageVariantDrawableSource(source)) {
    imageScaledVariantSourceReadyNoSourceCount++;
    return { key, queued: false, skipped: 'missing-source' };
  }
  const scale = Number(options.scale) || IMAGE_SCALE_LEVELS[0] || 0.25;
  if (!(scale > 0 && scale < 1)) {
    imageScaledVariantSourceReadyFullScaleCount++;
    return { key, scale, queued: false, skipped: 'full-scale' };
  }
  if (hasScaledImageVariant(key, scale) || isScaledImageVariantPending(key, scale)) {
    imageScaledVariantSourceReadyReadyCount++;
    return { key, scale, queued: false, skipped: 'already-ready-or-pending' };
  }
  queueScaledImageVariant(key, source, scale, {
    priority: options.priority === true,
  });
  imageScaledVariantSourceReadyQueuedCount++;
  return { key, scale, queued: true };
}

function queueScaledImageVariantForDraw(key, obj, source, view = { zoom, dpr: window.devicePixelRatio || 1 }, options = {}) {
  const targetScale = chooseImageScaleForDraw(obj, source, view, {
    activeOverscale: options.activeOverscale === true,
  });
  queueScaledImageVariant(key, source, targetScale, options);
  return targetScale;
}

async function prewarmVisibleScaledImageVariantsForOpen(options = {}) {
  const startedAt = performance.now();
  if (!isViewportImageScalingActive()) return { skipped: 'disabled' };
  const padPx = Number.isFinite(options.padPx) ? options.padPx : 0;
  const rect = typeof currentViewportWorldRect === 'function' ? currentViewportWorldRect(padPx) : null;
  if (!rect) return { skipped: 'no-viewport' };
  const view = {
    zoom: typeof zoom !== 'undefined' ? zoom : 1,
    dpr: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
  };
  const seen = new Set();
  const tasks = [];
  let candidates = 0;
  let alreadyReady = 0;
  let noSource = 0;
  let fullScale = 0;
  for (const obj of objects) {
    if (obj?.type !== 'image' || !obj.data?.imgKey || !objectIntersectsRect(obj, rect)) continue;
    const key = obj.data.imgKey;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates++;
    const source = imageBitmapCache[key] || null;
    if (!isImageVariantDrawableSource(source)) {
      noSource++;
      continue;
    }
    const scale = chooseImageScaleForDraw(obj, source, view);
    if (!(scale > 0 && scale < 1)) {
      fullScale++;
      continue;
    }
    if (hasScaledImageVariant(key, scale)) {
      alreadyReady++;
      continue;
    }
    tasks.push({ key, source, scale });
  }
  tasks.sort((a, b) => bitmapByteSize(b.source) - bitmapByteSize(a.source));
  const limit = Math.max(0, Math.floor(Number(options.limit) || tasks.length));
  const selectedCount = Math.min(limit, tasks.length);
  const selectedTasks = new Array(selectedCount);
  for (let i = 0; i < selectedCount; i++) selectedTasks[i] = tasks[i];
  const concurrency = Math.max(1, Math.min(8, Math.floor(Number(options.concurrency) || 4), selectedTasks.length || 1));
  let built = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;
  const results = await mapScaledVariantTasksWithConcurrency(selectedTasks, concurrency, async ({ key, source, scale }) => {
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
    selected: selectedTasks.length,
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
  return !!imageScaledBitmapCache.get(key)?.has(scale);
}

function isScaledImageVariantPending(key, scale) {
  return imageScaledBitmapPending.has(`${key}:${scale}`);
}

function activeViewportInputIdleMs() {
  if (!(lastViewportInputAt > 0)) return Infinity;
  return Math.max(0, performance.now() - lastViewportInputAt);
}

function isActiveViewportInput() {
  return activeViewportInputIdleMs() < IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS;
}

function prewarmVisibleScaledImageVariants(options = {}) {
  if (!isViewportImageScalingActive() || _boardOpening) return { skipped: 'disabled-or-opening' };
  const scale = Number(options.scale) || IMAGE_SCALE_LEVELS[0] || 0.25;
  if (!(scale > 0 && scale < 1)) return { skipped: 'invalid-scale' };
  const padPx = Number.isFinite(options.padPx) ? options.padPx : IMAGE_VARIANT_PREWARM_PAD_PX;
  const rect = typeof currentViewportWorldRect === 'function' ? currentViewportWorldRect(padPx) : null;
  if (!rect) return { skipped: 'no-viewport' };

  let candidates = 0;
  let ready = 0;
  let queued = 0;
  let noSource = 0;
  for (const obj of objects) {
    if (obj?.type !== 'image' || !obj.data?.imgKey || !objectIntersectsRect(obj, rect)) continue;
    candidates++;
    const key = obj.data.imgKey;
    if (hasScaledImageVariant(key, scale) || isScaledImageVariantPending(key, scale)) {
      ready++;
      continue;
    }
    const source = imageBitmapCache[key] || null;
    if (!isImageVariantDrawableSource(source)) {
      noSource++;
      continue;
    }
    queueScaledImageVariant(key, source, scale);
    queued++;
  }

  imageScaledVariantPrewarmRunCount++;
  imageScaledVariantPrewarmCandidateCount += candidates;
  imageScaledVariantPrewarmReadyCount += ready;
  imageScaledVariantPrewarmQueuedCount += queued;
  imageScaledVariantPrewarmNoSourceCount += noSource;
  return { candidates, ready, queued, noSource, scale, padPx };
}

function scheduleVisibleScaledVariantPrewarmAfterIdle(reason = 'viewport-settled', options = {}) {
  if (!isViewportImageScalingActive() || _boardOpening) return;
  clearTimeout(imageScaledVariantPrewarmTimer);
  const delay = Number.isFinite(options.delayMs) ? options.delayMs : IMAGE_VARIANT_INPUT_IDLE_MS;
  imageScaledVariantPrewarmTimer = setTimeout(() => {
    imageScaledVariantPrewarmTimer = null;
    const inputIdleMs = performance.now() - lastViewportInputAt;
    if (inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS) {
      scheduleVisibleScaledVariantPrewarmAfterIdle(reason, {
        ...options,
        delayMs: IMAGE_VARIANT_INPUT_IDLE_MS - inputIdleMs,
      });
      return;
    }
    prewarmVisibleScaledImageVariants({ ...options, reason });
  }, Math.max(0, delay));
}

function selectImageSourceForDraw(key, obj, fullSource, view = { zoom, dpr: window.devicePixelRatio || 1 }) {
  if (!isViewportImageScalingActive()) return { source: fullSource, scale: 1, targetScale: 1, disabled: true };
  const activeInput = isActiveViewportInput();
  const targetScale = chooseImageScaleForDraw(obj, fullSource, view, { activeOverscale: activeInput });
  const map = imageScaledBitmapCache.get(key);
  if (map && targetScale < 1) {
    let selectedScale = 1;
    for (const scale of IMAGE_SCALE_LEVELS) {
      if (scale >= targetScale && map.has(scale) && scale < selectedScale) selectedScale = scale;
    }
    if (selectedScale < 1) {
      const entry = imageScaledBitmapStore.get(key, selectedScale);
      imageScaledBitmapUseCounter = imageScaledBitmapStore.useCounter;
      return { source: entry.bitmap, scale: selectedScale, targetScale };
    }
  }
  queueScaledImageVariantForDraw(key, obj, fullSource, view, { priority: activeInput, activeOverscale: activeInput });
  if (activeInput && targetScale < 1 && isScaledImageVariantPending(key, targetScale)) {
    imageScaledVariantActiveInputFullFallbackCount++;
    return {
      source: fullSource,
      scale: 1,
      targetScale,
      scaledVariantPending: true,
      activeInputFullFallback: true,
    };
  }
  return { source: fullSource, scale: 1, targetScale };
}

function setViewportPerfMode(modeKey) {
  const mode = VIEWPORT_PERF_MODES[String(modeKey)];
  if (!mode) return null;
  viewportCullingEnabled = !!mode.culling;
  viewportImageScalingEnabled = VIEWPORT_IMAGE_SCALING_SUPPORTED && !!mode.scaling;
  if (!viewportImageScalingEnabled) clearScaledImageVariants();
  invalidateOffscreen();
  scheduleRender(true, false, `viewport-perf-mode-${modeKey}`);
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
