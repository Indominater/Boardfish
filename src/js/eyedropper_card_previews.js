'use strict';

const cloneEyedropperPreviewObject = (obj) => {
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
  } catch (_) {}
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_) {
    return null;
  }
};

const cloneEyedropperPreviewRect = (rect) => {
  return {
    x1: Number(rect?.x1) || 0,
    y1: Number(rect?.y1) || 0,
    x2: Number(rect?.x2) || 0,
    y2: Number(rect?.y2) || 0,
  };
};

const cloneEyedropperPreviewView = (view) => {
  return {
    zoom: Number(view?.zoom) || 1,
    panX: Number(view?.panX) || 0,
    panY: Number(view?.panY) || 0,
    dpr: Number(view?.dpr) || window.devicePixelRatio || 1,
  };
};

const eyedropperPreviewSceneObjects = (viewportRect) => {
  const snapshot = [];
  const list = Array.isArray(objects) ? objects : [];
  for (const obj of list) {
    if (!obj || (obj.type !== 'image' && obj.type !== 'text')) continue;
    if (typeof objectIntersectsRect === 'function' && viewportRect && !objectIntersectsRect(obj, viewportRect)) continue;
    const clone = cloneEyedropperPreviewObject(obj);
    if (clone) snapshot.push(clone);
  }
  return snapshot;
};

const rememberEyedropperCardPreviewScene = (card, previewSample = null, options = {}) => {
  if (!card || !previewSample?.painted || !previewSample.viewportRect || !previewSample.view) return false;
  const drawSize = Math.max(1, Math.round(Number(previewSample.drawSize) || eyedropperPreviewDrawSize()));
  const viewportRect = cloneEyedropperPreviewRect(previewSample.viewportRect);
  card.previewStateVersion = (card.previewStateVersion || 0) + 1;
  card.previewScene = {
    drawSize,
    canvasWidth: drawSize,
    canvasHeight: drawSize,
    view: cloneEyedropperPreviewView(previewSample.view),
    viewportRect,
    background: boardBackgroundPixel(),
    objects: eyedropperPreviewSceneObjects(viewportRect),
    reason: options.reason || 'sample',
    createdAt: Date.now(),
  };
  EyedropperDebug._logSamplingEvent('card-preview-scene-snapshot', {
    reason: card.previewScene.reason,
    drawSize,
    objectCount: card.previewScene.objects.length,
    readbackUnsafe: !!previewSample.readbackUnsafe,
    pendingSafeImage: !!previewSample.pendingSafeImage,
  });
  if (options.schedule) scheduleEyedropperCardPreviewSnapshot(card, options.reason || 'sample');
  return true;
};

const eyedropperPreviewSceneImageKeys = (scene) => {
  const keys = new Set();
  for (const obj of scene?.objects || []) {
    const key = obj?.type === 'image' ? obj.data?.imgKey : '';
    if (key) keys.add(key);
  }
  return [...keys];
};

const loadEyedropperPreviewSafeImageSource = async (key) => {
  const cached = eyedropperSafeImageCache.get(key);
  if (cached?.token && isDrawableImageSource(cached.source)) return cached.source;

  const stored = imageStore?.[key];
  let dataUrl = '';
  if (typeof stored === 'string') dataUrl = stored;
  else if (typeof isNativeImageRef === 'function' && isNativeImageRef(stored) && typeof ensureImageDataUrl === 'function') {
    dataUrl = await ensureImageDataUrl(key);
  }
  if (!dataUrl) return null;

  const img = await loadImageElement(dataUrl);
  let source = img;
  if (typeof createImageBitmap === 'function') {
    try {
      source = await createImageBitmap(img);
    } catch (_) {
      source = img;
    }
  }
  return source;
};

const loadEyedropperPreviewSceneSources = async (scene) => {
  const sources = new Map();
  await Promise.all(eyedropperPreviewSceneImageKeys(scene).map(async (key) => {
    try {
      const source = await loadEyedropperPreviewSafeImageSource(key);
      if (isDrawableImageSource(source)) sources.set(key, source);
    } catch (err) {
      EyedropperDebug._logReadbackFailure('card-preview-safe-source', { imgKey: key, error: String(err) });
    }
  }));
  return sources;
};

const renderEyedropperCardPreviewScene = async (card, reason = 'scene') => {
  const scene = card?.previewScene;
  if (!scene?.drawSize || !scene.view) return '';
  const sources = await loadEyedropperPreviewSceneSources(scene);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  canvas.width = Math.max(1, Math.round(scene.canvasWidth || scene.drawSize));
  canvas.height = Math.max(1, Math.round(scene.canvasHeight || scene.drawSize));
  resetCanvasToScreen(ctx);
  ctx.fillStyle = rgbaToCss(scene.background || boardBackgroundPixel());
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  setWorldCanvasTransform(ctx, scene.view.dpr, scene.view);

  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const resolver = (key) => {
    const source = sources.get(key);
    if (!isDrawableImageSource(source)) return null;
    return { source, scale: 1, targetScale: 1, readbackSafe: true };
  };
  for (const obj of scene.objects || []) drawSingleObj(ctx, obj, counters, { view: scene.view, imageSourceResolver: resolver });
  resetCanvasToScreen(ctx);

  const dataUrl = captureEyedropperCanvasPreview(canvas, 'card-preview-safe-render', {
    reticle: true,
    dpr: scene.view.dpr,
  });
  EyedropperDebug._logSamplingEvent('card-preview-safe-render', {
    reason,
    ok: !!dataUrl,
    bytes: dataUrl.length,
    objectCount: scene.objects?.length || 0,
    sourceCount: sources.size,
    drawnImages: counters.drawnImages ?? '',
    missingImages: counters.missingImages ?? '',
    erroredImages: counters.erroredImages ?? '',
  });
  return dataUrl;
};

const scheduleEyedropperCardPreviewSnapshot = (card, reason = 'scene') => {
  if (!card?.previewScene) return Promise.resolve(false);
  if (card.previewSnapshotPromise) return card.previewSnapshotPromise;
  const scene = card.previewScene;
  const previewStateVersion = card.previewStateVersion || 0;
  const promise = renderEyedropperCardPreviewScene(card, reason)
    .then((dataUrl) => {
      if (!dataUrl) return false;
      if (card.previewScene !== scene || (card.previewStateVersion || 0) !== previewStateVersion) return false;
      card.previewDataUrl = dataUrl;
      card.previewCanvasWidth = card.previewScene?.canvasWidth || card.previewScene?.drawSize || 0;
      card.previewCanvasHeight = card.previewScene?.canvasHeight || card.previewScene?.drawSize || 0;
      card.pendingPreviewDataUrl = '';
      card.pendingPreviewCanvasWidth = 0;
      card.pendingPreviewCanvasHeight = 0;
      EyedropperDebug._logSamplingEvent('card-preview-safe-snapshot', {
        reason,
        bytes: dataUrl.length,
        canvasWidth: card.previewCanvasWidth,
        canvasHeight: card.previewCanvasHeight,
      });
      return true;
    })
    .catch((err) => {
      EyedropperDebug._logReadbackFailure('card-preview-safe-snapshot', { reason, error: String(err) });
      return false;
    })
    .finally(() => {
      if (card.previewSnapshotPromise === promise) card.previewSnapshotPromise = null;
    });
  card.previewSnapshotPromise = promise;
  return promise;
};
