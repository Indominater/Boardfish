'use strict';

var IMAGE_SCALE_LEVELS = [0.25];
var IMAGE_SCALE_QUALITY_BUFFER = 1;
var IMAGE_VARIANT_MEMORY_LIMIT = 512 * 1024 * 1024;
var VIEWPORT_PERF_MODES = {
  '1': { label: 'culling + 0.25', culling: true, scaling: true },
  '2': { label: '0.25 only', culling: false, scaling: true },
  '3': { label: 'culling only', culling: true, scaling: false },
  '4': { label: 'none', culling: false, scaling: false },
};
var imageScaledBitmapCache = new Map(); // key -> Map(scale -> { bitmap, bytes, lastUsed })
var imageScaledBitmapPending = new Set();
var imageScaledBitmapPendingBytes = new Map();
var imageScaledBitmapBytes = 0;
var imageScaledBitmapUseCounter = 1;
var imageScaledVariantRenderTimer = null;
var imageScaledVariantRenderCount = 0;
var imageScaledVariantQueue = [];
var imageScaledVariantQueueScheduled = false;
var lastViewportInputAt = 0;
var IMAGE_VARIANT_INPUT_IDLE_MS = 180;
var imageScaledVariantBuildCount = 0;
var imageScaledVariantBuildTotalMs = 0;
var imageScaledVariantBuildMaxMs = 0;
var imageScaledVariantResizeBitmapCount = 0;
var imageScaledVariantCanvasFallbackCount = 0;
var imageScaledVariantEvictionCount = 0;
var imageScaledVariantMemorySkipCount = 0;
var viewportCullingEnabled = true;
var viewportImageScalingEnabled = !IS_MAC;

function bitmapByteSize(bitmap) {
  return (bitmap?.width || 0) * (bitmap?.height || 0) * 4;
}

function scaledVariantEstimatedBytes(sourceW, sourceH, scale) {
  return Math.max(1, Math.round(sourceW * scale)) * Math.max(1, Math.round(sourceH * scale)) * 4;
}

function pendingScaledVariantBytes() {
  let bytes = 0;
  for (const value of imageScaledBitmapPendingBytes.values()) bytes += value || 0;
  return bytes;
}

function getImageVariantMap(key) {
  let map = imageScaledBitmapCache.get(key);
  if (!map) {
    map = new Map();
    imageScaledBitmapCache.set(key, map);
  }
  return map;
}

function clearScaledImageVariants(key = null) {
  const clearMap = (map) => {
    for (const entry of map.values()) {
      if (entry?.bitmap?.close) entry.bitmap.close();
      imageScaledBitmapBytes -= entry?.bytes || 0;
    }
    map.clear();
  };
  if (key) {
    const map = imageScaledBitmapCache.get(key);
    if (map) clearMap(map);
    imageScaledBitmapCache.delete(key);
    for (const pendingKey of [...imageScaledBitmapPending]) {
      if (pendingKey.startsWith(`${key}:`)) {
        imageScaledBitmapPending.delete(pendingKey);
        imageScaledBitmapPendingBytes.delete(pendingKey);
      }
    }
    imageScaledBitmapBytes = Math.max(0, imageScaledBitmapBytes);
    return;
  }
  for (const map of imageScaledBitmapCache.values()) clearMap(map);
  imageScaledBitmapCache.clear();
  imageScaledBitmapPending.clear();
  imageScaledBitmapPendingBytes.clear();
  imageScaledVariantQueue.length = 0;
  imageScaledVariantQueueScheduled = false;
  imageScaledBitmapBytes = 0;
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
}

function pruneScaledImageVariants() {
  if (imageScaledBitmapBytes <= IMAGE_VARIANT_MEMORY_LIMIT) return;
  const entries = [];
  for (const [key, map] of imageScaledBitmapCache.entries()) {
    for (const [scale, entry] of map.entries()) entries.push({ key, map, scale, entry });
  }
  entries.sort((a, b) => (a.entry.lastUsed || 0) - (b.entry.lastUsed || 0));
  for (const item of entries) {
    if (imageScaledBitmapBytes <= IMAGE_VARIANT_MEMORY_LIMIT) break;
    if (item.entry.bitmap?.close) item.entry.bitmap.close();
    imageScaledBitmapBytes -= item.entry.bytes || 0;
    item.map.delete(item.scale);
    imageScaledVariantEvictionCount++;
    if (!item.map.size) imageScaledBitmapCache.delete(item.key);
  }
  imageScaledBitmapBytes = Math.max(0, imageScaledBitmapBytes);
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

function scheduleScaledVariantQueue() {
  if (imageScaledVariantQueueScheduled) return;
  imageScaledVariantQueueScheduled = true;
  const run = () => {
    imageScaledVariantQueueScheduled = false;
    const inputIdleMs = performance.now() - lastViewportInputAt;
    if (inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS) {
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
  const delay = inputIdleMs < IMAGE_VARIANT_INPUT_IDLE_MS ? IMAGE_VARIANT_INPUT_IDLE_MS - inputIdleMs : 32;
  setTimeout(run, delay);
}

function chooseImageScaleForDraw(obj, source) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return 1;
  const dpr = window.devicePixelRatio || 1;
  const neededW = Math.max(1, obj.w * zoom * dpr * IMAGE_SCALE_QUALITY_BUFFER);
  const neededH = Math.max(1, obj.h * zoom * dpr * IMAGE_SCALE_QUALITY_BUFFER);
  let chosen = 1;
  for (const scale of IMAGE_SCALE_LEVELS) {
    if (sourceW * scale >= neededW && sourceH * scale >= neededH) chosen = scale;
  }
  return chosen;
}

function queueScaledImageVariant(key, source, scale) {
  if (!key || !source || scale >= 1) return;
  const pendingKey = `${key}:${scale}`;
  const map = getImageVariantMap(key);
  if (map.has(scale) || imageScaledBitmapPending.has(pendingKey)) return;
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return;
  const estimatedBytes = scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (imageScaledBitmapBytes + pendingScaledVariantBytes() + estimatedBytes > IMAGE_VARIANT_MEMORY_LIMIT) {
    imageScaledVariantMemorySkipCount++;
    return;
  }
  imageScaledBitmapPending.add(pendingKey);
  imageScaledBitmapPendingBytes.set(pendingKey, estimatedBytes);
  const generation = _imageStoreGeneration;
  enqueueScaledVariantTask(async () => {
    const buildStart = performance.now();
    try {
      const w = Math.max(1, Math.round(sourceW * scale));
      const h = Math.max(1, Math.round(sourceH * scale));
      let bitmap;
      try {
        bitmap = await createImageBitmap(source, {
          resizeWidth: w,
          resizeHeight: h,
          resizeQuality: 'high',
        });
        imageScaledVariantResizeBitmapCount++;
      } catch (_) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext('2d');
        setCanvasImageQuality(c);
        c.drawImage(source, 0, 0, w, h);
        bitmap = await createImageBitmap(canvas);
        imageScaledVariantCanvasFallbackCount++;
      }
      if (generation !== _imageStoreGeneration) {
        bitmap.close();
        return;
      }
      const bytes = bitmapByteSize(bitmap);
      const latestMap = getImageVariantMap(key);
      const existing = latestMap.get(scale);
      if (existing?.bitmap?.close) {
        existing.bitmap.close();
        imageScaledBitmapBytes -= existing.bytes || 0;
      }
      latestMap.set(scale, { bitmap, bytes, lastUsed: imageScaledBitmapUseCounter++ });
      imageScaledBitmapBytes += bytes;
      pruneScaledImageVariants();
      scheduleScaledVariantReadyRender();
    } finally {
      const buildMs = performance.now() - buildStart;
      imageScaledVariantBuildCount++;
      imageScaledVariantBuildTotalMs += buildMs;
      imageScaledVariantBuildMaxMs = Math.max(imageScaledVariantBuildMaxMs, buildMs);
      imageScaledBitmapPending.delete(pendingKey);
      imageScaledBitmapPendingBytes.delete(pendingKey);
    }
  });
}

function selectImageSourceForDraw(key, obj, fullSource) {
  if (!viewportImageScalingEnabled) return { source: fullSource, scale: 1, targetScale: 1, disabled: true };
  const targetScale = chooseImageScaleForDraw(obj, fullSource);
  const map = imageScaledBitmapCache.get(key);
  if (map && targetScale < 1) {
    const selectedScale = IMAGE_SCALE_LEVELS
      .filter((scale) => scale >= targetScale && map.has(scale))
      .reduce((best, scale) => Math.min(best, scale), 1);
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
  viewportImageScalingEnabled = !!mode.scaling;
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
    scaling025: viewportImageScalingEnabled,
    scaleLevels: viewportImageScalingEnabled ? IMAGE_SCALE_LEVELS.join(',') : 'off',
  };
}

