'use strict';

var eyedropperLoupe = document.getElementById('eyedropper-loupe');
var eyedropperPreview = document.getElementById('eyedropper-preview');
var eyedropperCanvas = document.getElementById('eyedropper-canvas');
var eyedropperSwatch = document.getElementById('eyedropper-swatch');
var eyedropperHex = document.getElementById('eyedropper-hex');
var eyedropperRgb = document.getElementById('eyedropper-rgb');
var eyedropperCtx = eyedropperCanvas?.getContext('2d', { willReadFrequently: true });
var eyedropperCard = null;
var eyedropperActiveCard = null;
var eyedropperRenderedSampleCanvas = document.createElement('canvas');
var eyedropperRenderedSampleCtx = eyedropperRenderedSampleCanvas.getContext('2d', { willReadFrequently: true });
var eyedropperZoomWallpaperCanvas = document.createElement('canvas');
var eyedropperZoomWallpaperCtx = eyedropperZoomWallpaperCanvas.getContext('2d', { willReadFrequently: true });
var eyedropperReadoutCanvas = document.createElement('canvas');
var eyedropperReadoutCtx = eyedropperReadoutCanvas.getContext('2d', { willReadFrequently: true });
var eyedropperEnabled = false;
var eyedropperSampling = false;
var eyedropperZoomWallpaperReady = false;
var eyedropperPreviousImageScalingEnabled = null;
var _eyedropperLastSampleEvent = null;
var _eyedropperPendingSampleEvent = null;
var _eyedropperLatestPointerEvent = null;
var _eyedropperPendingSampleCoalesced = 0;
var _eyedropperSampleRaf = null;
var _eyedropperShieldRelease = null;
var _eyedropperHoldActive = false;
var _eyedropperLastMouseEvent = null;
var eyedropperSafeImageCache = new Map();
var eyedropperSafeImagePromises = new Map();
var eyedropperSafeDisplayReloadPromises = new Map();
var EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT = 1024 * 1024 * 1024;
var eyedropperSafeScaledBitmapStore = BoardfishBitmapCache.createGroupedLruCache({
  memoryLimit: EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT,
  onEvict() { EyedropperDebug._count('safeScaledEvictions'); },
});
var eyedropperSafeScaledBitmapCache = eyedropperSafeScaledBitmapStore.groups;
var eyedropperSafeScaledBitmapPending = new Set();
var eyedropperSafeScaledBitmapPendingBytes = new Map();
var eyedropperSafeDisplayProbeFailures = new Map();
var eyedropperSafeTileCache = new Map();
var eyedropperSafeTileCachePending = new Set();
var eyedropperSafeTileCacheBytes = 0;
var eyedropperSafeTileCacheUseCounter = 1;
var eyedropperNativeSourceSkipLogged = new Set();
var eyedropperReadbackProbeCanvas = document.createElement('canvas');
var eyedropperReadbackProbeCtx = eyedropperReadbackProbeCanvas.getContext('2d', { willReadFrequently: true });
var _eyedropperNativePixelInFlight = false;
var _eyedropperNativePixelTarget = null;
var indominaterGreedyEyedropperNativeDecodePrewarm = {
  active: new Map(),
  ready: new Set(),
  failed: new Map(),
  scheduled: false,
  pendingReasons: new Set(),
  decoders: {
    d1: { id: 'd1', mode: 'nearest-pointer', running: false, key: '' },
    d2: { id: 'd2', mode: 'largest-cost', running: false, key: '' },
    d3: { id: 'd3', mode: 'sampler-pointer', running: false, key: '' },
  },
};
var _eyedropperSnapshotRefreshTimer = null;
var _eyedropperSnapshotRefreshRaf = null;
var _eyedropperSnapshotDirtyAfterSample = false;
var _eyedropperNavigationBlockTimer = null;
var _eyedropperNavigationBlockUntil = 0;
var _eyedropperPreviewDiagnosticsEnabled = false;
var _eyedropperPreviewDiagnosticsCanvasReadbackEnabled = false;
var _eyedropperPreviewDiagnosticsCanvasTainted = false;
var _eyedropperDragState = null;
var EYEDROPPER_SAFE_TILE_SIZE = 1;
var EYEDROPPER_SAFE_TILE_MEMORY_LIMIT = 32 * 1024 * 1024;
var EYEDROPPER_PREVIEW_ZOOM_SCALE = 3;
var EYEDROPPER_PREVIEW_CSS = 96;
var EYEDROPPER_LOUPE_CSS_HEIGHT = 392;

const hasEyedropperNativePixelCacheSource = (key) => {
  if (!key) return false;
  return !!(
    isNativeImageRef(imageStore[key]) ||
    imageAssetUrlCache[key] ||
    indominaterGreedyEyedropperNativeDecodePrewarm.active.has(key) ||
    indominaterGreedyEyedropperNativeDecodePrewarm.ready.has(key)
  );
};

Object.assign(globalThis, {
  hasEyedropperNativePixelCacheSource,
});

function releaseEyedropperCachesAfterDisable() {
  clearEyedropperSafeImageCache();
  if (hasTauri() && BoardfishTauri?.clearDecodedImageSourceCache) {
    BoardfishTauri.clearDecodedImageSourceCache()
      .catch((err) => console.warn('[eyedropper] clear decoded image source cache failed:', err));
  }
}

const resetEyedropperCardPreviewState = (card) => card && Object.assign(card, {
  previewStateVersion: (card.previewStateVersion || 0) + 1,
  previewToken: '', previewDataUrl: '', previewCanvasWidth: 0, previewCanvasHeight: 0,
  pendingPreviewDataUrl: '', pendingPreviewCanvasWidth: 0, pendingPreviewCanvasHeight: 0,
  previewScene: null, previewSnapshotPromise: null,
});

function eyedropperReticleDisplayScaleForCard(card, canvas = card?.canvas) {
  const width = Number(canvas?.width) || 0;
  const rectWidth = card?.preview?.getBoundingClientRect?.().width || eyedropperPreviewCssSize();
  if (width > 0 && rectWidth > 0) return Math.max(1, width / rectWidth);
  return Math.max(1, Number(window.devicePixelRatio) || 1);
}

function drawEyedropperReticleCore(context, cx, cy, outerRadius, innerRadius) {
  if (!context) return false;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.beginPath();
  context.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  context.fillStyle = 'rgba(0,0,0,0.9)';
  context.fill();
  context.beginPath();
  context.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255,255,255,1)';
  context.fill();
  context.restore();
  return true;
}

function drawEyedropperCanvasReticle(context, width, height = width, dpr = window.devicePixelRatio || 1) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || safeWidth));
  const dotX = Math.max(0, Math.min(safeWidth - 1, Math.floor(safeWidth / 2)));
  const dotY = Math.max(0, Math.min(safeHeight - 1, Math.floor(safeHeight / 2)));
  const displayScale = Math.max(1, Number(dpr) || 1);
  return drawEyedropperReticleCore(
    context,
    dotX + 0.5,
    dotY + 0.5,
    3 * displayScale,
    2 * displayScale,
  );
}
