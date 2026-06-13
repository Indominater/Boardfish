'use strict';

var IMAGE_SCALE_LEVELS = [0.5];
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
  onEvict() { imageScaledVariantEvictionCount++; },
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
var lastViewportInputAt = 0;
var IMAGE_VARIANT_INPUT_IDLE_MS = 180;
var IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS = 16;
var imageScaledVariantBuildCount = 0;
var imageScaledVariantBuildTotalMs = 0;
var imageScaledVariantBuildMaxMs = 0;
var imageScaledVariantResizeBitmapCount = 0;
var imageScaledVariantCanvasFallbackCount = 0;
var imageScaledVariantEvictionCount = 0;
var imageScaledVariantMemorySkipCount = 0;
var imageScaledVariantPrewarmTimer = null;
var imageScaledVariantPrewarmRunCount = 0;
var imageScaledVariantPrewarmCandidateCount = 0;
var imageScaledVariantPrewarmQueuedCount = 0;
var imageScaledVariantPrewarmReadyCount = 0;
var imageScaledVariantPrewarmNoSourceCount = 0;
var IMAGE_VARIANT_PREWARM_PAD_PX = 768;
var viewportCullingEnabled = true;
var VIEWPORT_IMAGE_SCALING_SUPPORTED = typeof createImageBitmap === 'function';
var viewportImageScalingEnabled = VIEWPORT_IMAGE_SCALING_SUPPORTED;

function isViewportImageScalingActive() {
  return VIEWPORT_IMAGE_SCALING_SUPPORTED && viewportImageScalingEnabled;
}

function bitmapByteSize(bitmap) {
  return (bitmap?.width || 0) * (bitmap?.height || 0) * 4;
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
    if (imageScaledVariantQueue.length) {
      imageScaledVariantQueue = imageScaledVariantQueue.filter((task) => task?.variantKey !== key);
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
  imageScaledVariantPrewarmRunCount = 0;
  imageScaledVariantPrewarmCandidateCount = 0;
  imageScaledVariantPrewarmQueuedCount = 0;
  imageScaledVariantPrewarmReadyCount = 0;
  imageScaledVariantPrewarmNoSourceCount = 0;
  clearTimeout(imageScaledVariantPrewarmTimer);
  imageScaledVariantPrewarmTimer = null;
}

function scheduleScaledVariantReadyRender(countReadyVariant = true) {
  if (countReadyVariant) imageScaledVariantRenderCount++;
  invalidateOffscreen();
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

function enqueueScaledVariantTask(task) {
  imageScaledVariantQueue.push(task);
  scheduleScaledVariantQueue();
}

function shouldBuildScaledImageVariant(pendingKey, generation) {
  return generation === _imageStoreGeneration && imageScaledBitmapPending.has(pendingKey);
}

function scheduleScaledVariantQueue() {
  if (imageScaledVariantQueueScheduled) return;
  imageScaledVariantQueueScheduled = true;
  const activeInputQueueDelayMs = Math.max(0, Number(IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS) || 0);
  const run = () => {
    imageScaledVariantQueueScheduled = false;
    const inputIdleMs = performance.now() - lastViewportInputAt;
    const idleThresholdMs = activeInputQueueDelayMs;
    if (inputIdleMs < idleThresholdMs) {
      scheduleScaledVariantQueue();
      return;
    }
    const task = imageScaledVariantQueue.shift();
    if (!task) return;
    task()
      .catch(() => {})
      .finally(() => {
        if (imageScaledVariantQueue.length) scheduleScaledVariantQueue();
      });
  };
  const inputIdleMs = performance.now() - lastViewportInputAt;
  const idleThresholdMs = activeInputQueueDelayMs;
  const delay = inputIdleMs < idleThresholdMs ? idleThresholdMs - inputIdleMs : 16;
  setTimeout(run, delay);
}

function chooseImageScaleForDraw(obj, source, view = { zoom, dpr: window.devicePixelRatio || 1 }) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return 1;
  const viewZoom = Math.max(view?.zoom || zoom || 1, 0.0001);
  const dpr = view?.dpr || window.devicePixelRatio || 1;
  const neededW = obj.w * viewZoom * dpr;
  const neededH = obj.h * viewZoom * dpr;
  let selectedScale = Infinity;
  for (const scale of IMAGE_SCALE_LEVELS) {
    if (sourceW * scale >= neededW && sourceH * scale >= neededH && scale < selectedScale) {
      selectedScale = scale;
    }
  }
  return Number.isFinite(selectedScale) ? selectedScale : 1;
}

function queueScaledImageVariant(key, source, scale) {
  if (!isViewportImageScalingActive() || typeof createImageBitmap !== 'function' || !key || !source || scale >= 1) return;
  const pendingKey = `${key}:${scale}`;
  const map = imageScaledBitmapCache.get(key);
  if (map?.has(scale) || imageScaledBitmapPending.has(pendingKey)) return;
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
    try {
      const w = Math.max(1, Math.ceil(sourceW * scale));
      const h = Math.max(1, Math.ceil(sourceH * scale));
      let bitmap;
      try {
        bitmap = await createImageBitmap(source, {
          resizeWidth: w,
          resizeHeight: h,
          resizeQuality: 'high',
        });
        imageScaledVariantResizeBitmapCount++;
      } catch (_) {
        if (!shouldBuildScaledImageVariant(pendingKey, generation)) return;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext('2d');
        setCanvasImageQuality(c);
        c.drawImage(source, 0, 0, w, h);
        bitmap = await createImageBitmap(canvas);
        imageScaledVariantCanvasFallbackCount++;
      }
      if (!shouldBuildScaledImageVariant(pendingKey, generation)) {
        bitmap.close();
        return;
      }
      const bytes = bitmapByteSize(bitmap);
      imageScaledBitmapStore.set(key, scale, { bitmap, bytes });
      imageScaledBitmapBytes = imageScaledBitmapStore.bytes;
      imageScaledBitmapUseCounter = imageScaledBitmapStore.useCounter;
      scheduleScaledVariantReadyRender();
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
  enqueueScaledVariantTask(task);
}

function hasScaledImageVariant(key, scale) {
  return !!imageScaledBitmapCache.get(key)?.has(scale);
}

function isScaledImageVariantPending(key, scale) {
  return imageScaledBitmapPending.has(`${key}:${scale}`);
}

function prewarmVisibleScaledImageVariants(options = {}) {
  if (!isViewportImageScalingActive() || _boardOpening) return { skipped: 'disabled-or-opening' };
  const scale = Number(options.scale) || IMAGE_SCALE_LEVELS[0] || 0.5;
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
    if (!isDrawableImageSource(source)) {
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
  const targetScale = chooseImageScaleForDraw(obj, fullSource, view);
  const map = imageScaledBitmapCache.get(key);
  if (map && targetScale < 1) {
    let selectedScale = 1;
    for (const scale of IMAGE_SCALE_LEVELS) {
      if (scale >= targetScale && map.has(scale) && scale < selectedScale) selectedScale = scale;
    }
    if (selectedScale < 1) {
      const entry = map.get(selectedScale);
      entry.lastUsed = imageScaledBitmapUseCounter++;
      return { source: entry.bitmap, scale: selectedScale, targetScale };
    }
  }
  queueScaledImageVariant(key, fullSource, targetScale);
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
  const active = Object.entries(VIEWPORT_PERF_MODES).find(([, mode]) => (
    mode.culling === viewportCullingEnabled && mode.scaling === viewportImageScalingEnabled
  ));
  const key = modeKey || active?.[0] || '';
  const mode = VIEWPORT_PERF_MODES[key] || active?.[1] || {};
  return {
    key,
    label: mode.label || 'custom',
    culling: viewportCullingEnabled,
    scalingEnabled: viewportImageScalingEnabled,
    scaleLevels: viewportImageScalingEnabled ? IMAGE_SCALE_LEVELS.join(',') : 'off',
  };
}
