'use strict';

const EyedropperGeometry = BoardfishEyedropperGeometry.createEyedropperGeometry({
  boardCanvas: () => boardCanvas,
  canvasBackgroundColor: () => getComputedStyle(canvas).backgroundColor,
  imageTransformFromObject,
  isSidewaysRotation,
  objects: () => objects,
  parseCssColor,
  toWorld: () => (typeof toWorld === 'function' ? toWorld : null),
  view: () => ({ panX, panY, zoom }),
});
globalThis.boardBackgroundPixel = EyedropperGeometry.boardBackgroundPixel;
globalThis.clientToBoardScreenPoint = EyedropperGeometry.clientToBoardScreenPoint;
globalThis.clientToBoardWorldPoint = EyedropperGeometry.clientToBoardWorldPoint;
globalThis.displayedBoardSourcePoint = EyedropperGeometry.displayedBoardSourcePoint;
globalThis.imageBoundsDistanceSqToWorldPoint = EyedropperGeometry.imageBoundsDistanceSqToWorldPoint;
globalThis.objectContainsWorldPoint = EyedropperGeometry.objectContainsWorldPoint;
globalThis.screenToBoardWorldPoint = EyedropperGeometry.screenToBoardWorldPoint;
globalThis.topObjectAtWorldPoint = EyedropperGeometry.topObjectAtWorldPoint;
globalThis.worldPointToImageLocalUnit = EyedropperGeometry.worldPointToImageLocalUnit;

function cssPx(value) {
  const px = Number.parseFloat(value);
  return Number.isFinite(px) ? px : 0;
}

const resizeEyedropperCanvasBackingStore = (canvas, width, height = width) => {
  if (!canvas) return false;
  const nextWidth = Math.max(1, Math.round(Number(width) || 1));
  const nextHeight = Math.max(1, Math.round(Number(height) || nextWidth));
  let changed = false;
  if (canvas.width !== nextWidth) {
    canvas.width = nextWidth;
    changed = true;
  }
  if (canvas.height !== nextHeight) {
    canvas.height = nextHeight;
    changed = true;
  }
  EyedropperDebug._countPerf(changed ? 'backingStoreResizes' : 'backingStoreResizeSkips');
  return changed;
};

function eyedropperLoupeCssWidth(style = eyedropperLoupe ? getComputedStyle(eyedropperLoupe) : null) {
  if (!style) return 0;
  return cssPx(style.width) || cssPx(style.getPropertyValue('--eyedropper-loupe-width'));
}

function eyedropperPreviewCssSize() {
  const styleArg = arguments[0] || null;
  const rectArg = arguments[1] || null;
  const rect = rectArg || eyedropperPreview?.getBoundingClientRect();
  if (rect?.width > 0) return rect.width;

  const style = styleArg || (eyedropperLoupe ? getComputedStyle(eyedropperLoupe) : null);
  if (!style) return EYEDROPPER_PREVIEW_CSS;

  const borderX = cssPx(style.borderLeftWidth) + cssPx(style.borderRightWidth);
  const declaredWidth = eyedropperLoupeCssWidth(style) || EYEDROPPER_PREVIEW_CSS;
  const viewportMax = Math.max(1, window.innerWidth - 24);
  const outerWidth = Math.min(declaredWidth, viewportMax);
  // The preview wrapper has negative horizontal margins that bleed through the
  // loupe padding, so its visible width is the border-box width minus borders.
  const contentWidth = style.boxSizing === 'border-box'
    ? outerWidth - borderX
    : outerWidth;

  return Math.max(1, contentWidth || EYEDROPPER_PREVIEW_CSS);
}

function eyedropperPreviewDrawSize(dpr = window.devicePixelRatio || 1) {
  const metrics = arguments[1] || null;
  if (metrics?.drawSize) return metrics.drawSize;
  return Math.max(1, Math.round(eyedropperPreviewCssSize() * dpr));
}

const invalidateEyedropperLayoutMetrics = () => {
  if (eyedropperActiveCard) eyedropperActiveCard.layoutMetrics = null;
  if (eyedropperCard && eyedropperCard !== eyedropperActiveCard) eyedropperCard.layoutMetrics = null;
};

const measureEyedropperLayoutMetrics = (dpr = window.devicePixelRatio || 1) => {
  const style = eyedropperLoupe ? getComputedStyle(eyedropperLoupe) : null;
  const loupeRect = eyedropperLoupe?.getBoundingClientRect?.() || null;
  const previewRect = eyedropperPreview?.getBoundingClientRect?.() || null;
  const previewCssSize = eyedropperPreviewCssSize(style, previewRect);
  const drawSize = Math.max(1, Math.round(previewCssSize * dpr));
  const hasLoupeRect = !!(loupeRect?.width && loupeRect?.height);
  const hasPreviewRect = !!(previewRect?.width && previewRect?.height);
  const hasVisibleRects = hasLoupeRect && hasPreviewRect;
  const width = hasLoupeRect ? loupeRect.width : (eyedropperLoupeCssWidth(style) || EYEDROPPER_PREVIEW_CSS);
  const height = hasLoupeRect ? loupeRect.height : EYEDROPPER_LOUPE_CSS_HEIGHT;
  const metrics = {
    card: eyedropperActiveCard,
    dpr,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    visible: !!eyedropperLoupe?.classList.contains('visible'),
    hasVisibleRects,
    width,
    height,
    previewCssSize,
    previewWidth: hasPreviewRect ? previewRect.width : previewCssSize,
    previewTopOffset: hasVisibleRects ? previewRect.top - loupeRect.top : 0,
    previewLeftOffset: hasVisibleRects ? previewRect.left - loupeRect.left : 0,
    drawSize,
  };
  if (eyedropperActiveCard) eyedropperActiveCard.layoutMetrics = metrics;
  EyedropperDebug._countPerf('layoutCacheMisses');
  return metrics;
};

const getEyedropperLayoutMetrics = (dpr = window.devicePixelRatio || 1, options = {}) => {
  const metrics = eyedropperActiveCard?.layoutMetrics || null;
  if (metrics &&
      metrics.card === eyedropperActiveCard &&
      metrics.dpr === dpr &&
      metrics.viewportWidth === window.innerWidth &&
      metrics.viewportHeight === window.innerHeight &&
      (!options.requireVisibleRects || metrics.hasVisibleRects)) {
    EyedropperDebug._countPerf('layoutCacheHits');
    return metrics;
  }
  return measureEyedropperLayoutMetrics(dpr);
};

function eyedropperSampleDotCssCenter(drawSize, dpr = window.devicePixelRatio || 1) {
  const dot = eyedropperSampleDotCanvasPoint(drawSize);
  const scale = Math.max(1, Number(dpr) || 1);
  return {
    x: (dot.x + 0.5) / scale,
    y: (dot.y + 0.5) / scale,
  };
}

function inputEventAgeMs(e, now = performance.now()) {
  const timeStamp = Number(e?.timeStamp);
  if (!Number.isFinite(timeStamp) || timeStamp <= 0) return null;
  if (timeStamp > now + 100000 && typeof Date.now === 'function') return Math.max(0, Date.now() - timeStamp);
  return Math.max(0, now - timeStamp);
}

function eyedropperPointerDebugEvent(e, receivedAt = performance.now()) {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    timeStamp: Number(e.timeStamp) || 0,
    receivedAt,
    inputAgeAtReceiveMs: inputEventAgeMs(e, receivedAt),
    coalescedMoves: 0,
  };
}

function analyzeEyedropperPreviewSurface(previewSample = null, expectedPixel = null) {
  const rect = eyedropperCanvas?.getBoundingClientRect?.();
  const out = {
    readable: false,
    readError: '',
    centerHex: '',
    expectedHex: rgbaToHex(expectedPixel),
    centerMatches: '',
    suspectedBlank: false,
    uniform: '',
    opaqueSamples: '',
    uniqueColors: '',
    loupeVisible: !!eyedropperLoupe?.classList.contains('visible'),
    canvasW: eyedropperCanvas?.width || 0,
    canvasH: eyedropperCanvas?.height || 0,
    rectW: rect?.width || 0,
    rectH: rect?.height || 0,
    painted: !!previewSample?.painted,
    drawnImages: previewSample?.drawnImages ?? '',
    drawnText: previewSample?.drawnText ?? '',
  };
  if (!eyedropperCtx || !out.canvasW || !out.canvasH) {
    out.readError = 'missing-preview-canvas';
    out.suspectedBlank = true;
    return out;
  }
  if (previewSample?.readbackUnsafe || previewSample?.pendingSafeImage) {
    out.readError = previewSample?.pendingSafeImage
      ? 'preview-readback-safe-image-pending'
      : 'preview-readback-unsafe';
    out.suspectedBlank = !previewSample?.painted ||
      (!previewSample?.drawnImages && !previewSample?.drawnText && !!expectedPixel);
    return out;
  }
  if (_eyedropperPreviewDiagnosticsCanvasTainted) {
    out.readError = 'preview-canvas-tainted';
    out.suspectedBlank = false;
    return out;
  }
  if (!_eyedropperPreviewDiagnosticsCanvasReadbackEnabled) {
    out.readError = 'preview-canvas-readback-disabled';
    out.suspectedBlank = false;
    return out;
  }

  const cx = Math.max(0, Math.min(out.canvasW - 1, Math.floor(out.canvasW / 2)));
  const cy = Math.max(0, Math.min(out.canvasH - 1, Math.floor(out.canvasH / 2)));
  const step = Math.max(1, Math.floor(Math.min(out.canvasW, out.canvasH) / 6));
  const points = [
    [cx, cy],
    [cx - step, cy],
    [cx + step, cy],
    [cx, cy - step],
    [cx, cy + step],
    [cx - step, cy - step],
    [cx + step, cy + step],
    [cx - step, cy + step],
    [cx + step, cy - step],
  ].map(([x, y]) => [
    Math.max(0, Math.min(out.canvasW - 1, x)),
    Math.max(0, Math.min(out.canvasH - 1, y)),
  ]);

  try {
    const colors = [];
    let opaqueSamples = 0;
    for (const [x, y] of points) {
      const data = eyedropperCtx.getImageData(x, y, 1, 1).data;
      const color = [data[0], data[1], data[2], data[3]];
      if (color[3] > 0) opaqueSamples++;
      colors.push(rgbaToHex(color));
    }
    out.readable = true;
    out.centerHex = colors[0] || '';
    out.centerMatches = !!out.expectedHex && out.centerHex === out.expectedHex;
    out.opaqueSamples = opaqueSamples;
    out.uniqueColors = new Set(colors).size;
    out.uniform = out.uniqueColors <= 1;
    out.suspectedBlank = !previewSample?.painted || opaqueSamples === 0 ||
      (out.uniform && !out.centerMatches && (previewSample?.drawnImages || previewSample?.drawnText));
  } catch (err) {
    out.readError = String(err?.message || err || 'preview-readback-failed').slice(0, 160);
    if (err?.name === 'SecurityError' || /tainted by cross-origin data/i.test(out.readError)) {
      _eyedropperPreviewDiagnosticsCanvasTainted = true;
      out.readError = 'preview-canvas-tainted';
    }
    out.suspectedBlank = !previewSample?.painted ||
      (!previewSample?.drawnImages && !previewSample?.drawnText && !!expectedPixel);
  }
  return out;
}

function setEyedropperPreviewDiagnosticsEnabled(enabled, options = {}) {
  _eyedropperPreviewDiagnosticsEnabled = !!enabled;
  _eyedropperPreviewDiagnosticsCanvasReadbackEnabled = !!options.canvasReadback;
  if (enabled) _eyedropperPreviewDiagnosticsCanvasTainted = false;
}

// EyedropperDebug is initialized by js/eyedropper_debug.js.

const cardPart = (card, className, id) => {
  return card?.el?.querySelector(`.${className}`) || card?.el?.querySelector(`#${id}`) || null;
};

function useEyedropperCard(card) {
  if (!card) return null;
  if (eyedropperActiveCard !== card) invalidateEyedropperLayoutMetrics();
  eyedropperActiveCard = card;
  eyedropperLoupe = card.el;
  eyedropperPreview = card.preview;
  eyedropperCanvas = card.canvas;
  eyedropperSwatch = card.swatch;
  eyedropperHex = card.hex;
  eyedropperRgb = card.rgb;
  eyedropperCtx = card.ctx;
  return card;
}

const isPinnedEyedropperCard = (card) => {
  return !!(card?.el?.classList.contains('visible') && card.el.classList.contains('pinned'));
};

const clampEyedropperCardPosition = (card, left, top) => {
  const margin = MENU_VIEWPORT_EDGE_MARGIN;
  const rect = card?.el?.getBoundingClientRect?.();
  const width = rect?.width || eyedropperLoupeCssWidth() || 1;
  const height = rect?.height || EYEDROPPER_LOUPE_CSS_HEIGHT;
  return {
    left: Math.round(Math.max(margin, Math.min(window.innerWidth - width - margin, Number(left) || margin))),
    top: Math.round(Math.max(margin, Math.min(window.innerHeight - height - margin, Number(top) || margin))),
  };
};

const applyEyedropperCardPosition = (card, left, top) => {
  if (!card?.el) return;
  const position = clampEyedropperCardPosition(card, left, top);
  card.el.style.left = `${position.left}px`; card.el.style.top = `${position.top}px`;
};

function createEyedropperCard() {
  if (eyedropperCard) return useEyedropperCard(eyedropperCard);
  const el = eyedropperLoupe || document.getElementById('eyedropper-loupe');
  if (!el) return null;
  el.classList.add('eyedropper-loupe');
  el.classList.remove('visible', 'pinned', 'dragging');

  const card = {
    el,
    preview: null,
    canvas: null,
    swatch: null,
    hex: null,
    rgb: null,
    ctx: null,
    previewDataUrl: '',
    previewCanvasWidth: 0,
    previewCanvasHeight: 0,
    pendingPreviewDataUrl: '',
    pendingPreviewCanvasWidth: 0,
    pendingPreviewCanvasHeight: 0,
    layoutMetrics: null,
    lastSwatchCss: '',
    lastHex: '',
    lastRgb: '',
    bound: false,
  };
  card.preview = cardPart(card, 'eyedropper-preview', 'eyedropper-preview');
  card.canvas = cardPart(card, 'eyedropper-canvas', 'eyedropper-canvas');
  card.swatch = cardPart(card, 'eyedropper-swatch', 'eyedropper-swatch');
  card.hex = cardPart(card, 'eyedropper-hex', 'eyedropper-hex');
  card.rgb = cardPart(card, 'eyedropper-rgb', 'eyedropper-rgb');
  card.ctx = card.canvas?.getContext('2d', { willReadFrequently: true });
  eyedropperCard = card;
  bindEyedropperCardEvents(card);
  return useEyedropperCard(card);
}

function ensureEyedropperCard() {
  if (eyedropperActiveCard) return eyedropperActiveCard;
  return createEyedropperCard();
}

function eyedropperCardFromEvent(e) {
  const el = e?.target?.closest?.('.eyedropper-loupe');
  return eyedropperCard?.el === el ? eyedropperCard : null;
}

function prepareEyedropperSamplingCard() {
  const card = ensureEyedropperCard() || createEyedropperCard();
  useEyedropperCard(card);
  BoardfishEyedropperCards.preservePinnedCardUntilNextSample(card, EyedropperDebug);
  card.el.classList.remove('visible', 'pinned', 'dragging');
  invalidateEyedropperLayoutMetrics();
  resetEyedropperCardPreviewState(card);
  return card;
}

function hideEyedropperCard(card) {
  if (!card) return;
  const wasVisible = card.el?.classList.contains('visible'); if (_eyedropperDragState?.card === card) _eyedropperDragState = null;
  card.el.classList.remove('visible', 'pinned', 'dragging'); if (wasVisible) globalThis.BoardfishMotion?.applyActionAnimation?.('eyedropper-loupe-close');
  invalidateEyedropperLayoutMetrics();
}

function pinEyedropperCard(card) {
  if (!card?.el?.classList.contains('visible')) return false;
  card.el.classList.add('pinned');
  updateEyedropperCardPreviewSnapshot(card, 'pin');
  return true;
}

function finishEyedropperSampleCard(shouldPin = true) {
  const card = ensureEyedropperCard();
  if (!card?.el?.classList.contains('visible')) return;
  card.el.classList.remove('dragging');
  if (shouldPin && pinEyedropperCard(card)) return;
  hideEyedropperCard(card);
}

function closeEyedropperCard(card) {
  if (!card) return;
  const closingActive = card === eyedropperActiveCard;
  hideEyedropperCard(card);
  if (closingActive) useEyedropperCard(eyedropperCard || createEyedropperCard());
}

const captureEyedropperCanvasPreview = (canvas, where = 'card-preview-capture', options = {}) => {
  if (!canvas?.width || !canvas.height || typeof canvas.toDataURL !== 'function') return '';
  try {
    let captureCanvas = canvas;
    if (options.reticle) {
      const reticleCanvas = document.createElement('canvas');
      reticleCanvas.width = canvas.width;
      reticleCanvas.height = canvas.height;
      const reticleCtx = reticleCanvas.getContext('2d', { willReadFrequently: true });
      if (reticleCtx) {
        reticleCtx.drawImage(canvas, 0, 0);
        drawEyedropperCanvasReticle(reticleCtx, reticleCanvas.width, reticleCanvas.height, options.dpr);
        captureCanvas = reticleCanvas;
      }
    }
    const dataUrl = captureCanvas.toDataURL('image/png');
    return dataUrl && dataUrl !== 'data:,' ? dataUrl : '';
  } catch (err) {
    EyedropperDebug._logReadbackFailure(where, { error: String(err) });
    return '';
  }
};

const captureEyedropperCardPreview = (card) => {
  return captureEyedropperCanvasPreview(card?.canvas, 'card-preview-capture', {
    reticle: true,
    dpr: eyedropperReticleDisplayScaleForCard(card),
  });
};

const updateEyedropperCardPreviewSnapshot = (card, reason = 'snapshot') => {
  const pendingDataUrl = card?.pendingPreviewDataUrl || '';
  const dataUrl = pendingDataUrl || captureEyedropperCardPreview(card);
  if (!dataUrl) return false;
  card.previewDataUrl = dataUrl;
  card.previewCanvasWidth = pendingDataUrl ? card.pendingPreviewCanvasWidth || 0 : card.canvas?.width || 0;
  card.previewCanvasHeight = pendingDataUrl ? card.pendingPreviewCanvasHeight || 0 : card.canvas?.height || 0;
  if (pendingDataUrl) {
    card.pendingPreviewDataUrl = '';
    card.pendingPreviewCanvasWidth = 0;
    card.pendingPreviewCanvasHeight = 0;
  }
  EyedropperDebug._logSamplingEvent('card-preview-snapshot', {
    reason,
    bytes: dataUrl.length,
    canvasWidth: card.previewCanvasWidth,
    canvasHeight: card.previewCanvasHeight,
  });
  return true;
};

const rememberEyedropperPendingCardPreviewSnapshot = (card, canvas, reason = 'sample') => {
  if (!card || !canvas) return false;
  const dataUrl = captureEyedropperCanvasPreview(canvas, 'card-preview-rendered-sample', {
    reticle: true,
    dpr: eyedropperReticleDisplayScaleForCard(card, canvas),
  });
  if (!dataUrl) {
    EyedropperDebug._logSamplingEvent('card-preview-snapshot-missing', { reason });
    return false;
  }
  card.pendingPreviewDataUrl = dataUrl;
  card.pendingPreviewCanvasWidth = canvas.width || 0;
  card.pendingPreviewCanvasHeight = canvas.height || 0;
  EyedropperDebug._logSamplingEvent('card-preview-pending-snapshot', {
    reason,
    bytes: dataUrl.length,
    canvasWidth: card.pendingPreviewCanvasWidth,
    canvasHeight: card.pendingPreviewCanvasHeight,
  });
  return true;
};

const resetEyedropperCardVisual = (card) => {
  if (!card?.el) return;
  BoardfishEyedropperCards.removePendingPinnedCardClone(card);
  card.el.classList.remove('visible', 'pinned', 'dragging');
  card.el.style.left = card.el.style.top = '';
  resetEyedropperCardPreviewState(card);
  if (card.hex) card.hex.textContent = '#000000';
  if (card.rgb) card.rgb.textContent = '0 0 0';
  if (card.swatch) card.swatch.style.background = 'transparent';
  card.lastSwatchCss = '';
  card.lastHex = '';
  card.lastRgb = '';
  if (card.canvas && card.ctx) {
    resizeEyedropperCanvasBackingStore(
      card.canvas,
      Math.max(1, card.canvas.width || 1),
      Math.max(1, card.canvas.height || 1),
    );
    card.ctx.setTransform(1, 0, 0, 1, 0, 0);
    card.ctx.clearRect(0, 0, card.canvas.width, card.canvas.height);
  }
  invalidateEyedropperLayoutMetrics();
};

const clearEyedropperCardForBoard = () => {
  if (_eyedropperDragState) _eyedropperDragState = null;
  cancelPendingEyedropperSample();
  eyedropperSampling = false;
  _eyedropperLastSampleEvent = null;
  _eyedropperLatestPointerEvent = null;
  _eyedropperPendingSampleEvent = null;
  if (eyedropperCard) resetEyedropperCardVisual(eyedropperCard);
  eyedropperActiveCard = null;
  useEyedropperCard(eyedropperCard || createEyedropperCard());
};

function setEyedropperEnabled(enabled, options = {}) {
  const requestedEnabled = !!enabled;
  const toggleStart = performance.now();
  const toggleMeta = {
    requested: requestedEnabled,
    before: eyedropperEnabled,
  };
  const recordPhase = (name, start) => {
    toggleMeta[`${name}Ms`] = Math.round((performance.now() - start) * 100) / 100;
  };

  let phaseStart = performance.now();
  eyedropperEnabled = requestedEnabled;
  recordPhase('assign', phaseStart);

  phaseStart = performance.now();
  if (eyedropperEnabled) prepareEyedropperWallpaper();
  else {
    restoreEyedropperViewportScaling();
    resetEyedropperWallpaper();
  }
  recordPhase('wallpaper', phaseStart);

  phaseStart = performance.now();
  if (eyedropperEnabled && !_eyedropperShieldRelease) {
    _eyedropperShieldRelease = acquireInputShield(
      'pointermove',
      'mousemove',
      'key:escape',
      'key:shift',
      'code:shiftleft',
      'code:shiftright',
      { visual: false, keepSelectionOverlay: true },
    );
  } else if (!eyedropperEnabled && _eyedropperShieldRelease) {
    _eyedropperShieldRelease();
    _eyedropperShieldRelease = null;
  }
  if (!eyedropperEnabled) {
    _eyedropperHoldActive = false;
    document.body.classList.remove('eyedropper-hold-active');
  }
  recordPhase('shield', phaseStart);

  phaseStart = performance.now();
  document.body.classList.toggle('eyedropper-enabled', eyedropperEnabled);
  recordPhase('bodyClass', phaseStart);

  if (eyedropperEnabled) {
    phaseStart = performance.now();
    hideMenusForEyedropperMode();
    recordPhase('hideMenus', phaseStart);
  }

  if (eyedropperEnabled) {
    phaseStart = performance.now(); if (typeof markOpenEyedropperNativeDecodePrewarmStarted === 'function') markOpenEyedropperNativeDecodePrewarmStarted('eyedropper-enabled');
    scheduleEyedropperNativeDecodePrewarm('eyedropper-enabled');
    recordPhase('prewarmSchedule', phaseStart);
  } else {
    phaseStart = performance.now();
    if (options.keepSample) endEyedropperSample();
    else hideEyedropperSample();
    recordPhase('hideSample', phaseStart);
    if (toggleMeta.before) releaseEyedropperCachesAfterDisable();
  }

  phaseStart = performance.now();
  updateSelectionOverlay();
  recordPhase('selectionOverlay', phaseStart);

  toggleMeta.after = eyedropperEnabled;
  toggleMeta.totalMs = Math.round((performance.now() - toggleStart) * 100) / 100;
  Object.assign(toggleMeta, EyedropperDebug.state({ table: false }));
  EyedropperDebug._logToggle(toggleMeta);
  if (eyedropperEnabled) EyedropperDebug._startFrameProbe();
  else EyedropperDebug._stopFrameProbe();

  if (EyedropperDebug.enabled) {
    const frameStart = performance.now();
    requestAnimationFrame(() => {
      EyedropperDebug._logToggle({
        requested: requestedEnabled,
        before: toggleMeta.before,
        after: eyedropperEnabled,
        nextFrameMs: Math.round((performance.now() - frameStart) * 100) / 100,
        ...EyedropperDebug.state({ table: false }),
      });
    });
  }
}

function isEyedropperShieldActive() {
  return eyedropperEnabled && !!_eyedropperShieldRelease;
}

function hideMenusForEyedropperMode() {
  if (typeof closeOpenMenusExcept === 'function') {
    closeOpenMenusExcept('', 'eyedropper-enabled');
    return;
  }
  ctxMenu?.classList.remove('visible');
  ctxActions?.classList.remove('visible');
  objCtxMenu?.classList.remove('visible');
}

function resetEyedropperWallpaper() {
  eyedropperZoomWallpaperReady = false;
  _eyedropperSnapshotDirtyAfterSample = false;
  _eyedropperNavigationBlockUntil = 0;
  if (_eyedropperNavigationBlockTimer) clearTimeout(_eyedropperNavigationBlockTimer);
  _eyedropperNavigationBlockTimer = null;
  if (eyedropperZoomWallpaperCanvas) {
    resizeEyedropperCanvasBackingStore(eyedropperZoomWallpaperCanvas, 1, 1);
  }
  invalidateEyedropperLayoutMetrics();
}

function captureEyedropperZoomWallpaper(geometry, renderSize) {
  if (!geometry || !boardCanvas || !eyedropperZoomWallpaperCtx || !Number.isFinite(renderSize) || renderSize <= 0) {
    eyedropperZoomWallpaperReady = false;
    return null;
  }
  const size = Math.max(1, Math.round(renderSize));
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const previousViewportCullingEnabled = typeof viewportCullingEnabled !== 'undefined'
    ? viewportCullingEnabled
    : null;
  try {
    resizeEyedropperCanvasBackingStore(eyedropperZoomWallpaperCanvas, size, size);
    resetCanvasToScreen(eyedropperZoomWallpaperCtx);
    fillBoardBackground(eyedropperZoomWallpaperCtx, size, size);
    setWorldCanvasTransform(eyedropperZoomWallpaperCtx, geometry.view.dpr, geometry.view);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = true;
    const drawn = drawVisibleObjects(eyedropperZoomWallpaperCtx, counters, {
      viewportRect: geometry.viewportRect,
      view: geometry.view,
    });
    resetCanvasToScreen(eyedropperZoomWallpaperCtx);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = false;
    eyedropperZoomWallpaperReady = true;
    return {
      width: size,
      height: size,
      counters,
      drawnImages: drawn?.drawnImages || 0,
      drawnText: drawn?.drawnText || 0,
      pendingImages: counters.readbackSafePendingImages || 0,
      missingImages: counters.missingImages || 0,
    };
  } catch (err) {
    resetCanvasToScreen(eyedropperZoomWallpaperCtx);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = false;
    eyedropperZoomWallpaperReady = false;
    EyedropperDebug._logReadbackFailure('eyedropper-local-zoom-render', {
      width: size,
      height: size,
      error: String(err),
    });
    return null;
  }
}

function markEyedropperSnapshotDirty() {
  eyedropperZoomWallpaperReady = false;
}

function cancelEyedropperSnapshotRefresh() {
  if (_eyedropperSnapshotRefreshTimer) clearTimeout(_eyedropperSnapshotRefreshTimer);
  if (_eyedropperSnapshotRefreshRaf) cancelAnimationFrame(_eyedropperSnapshotRefreshRaf);
  _eyedropperSnapshotRefreshTimer = null;
  _eyedropperSnapshotRefreshRaf = null;
}

function scheduleEyedropperSnapshotRefresh(reason = 'viewport', options = {}) {
  if (!eyedropperEnabled) return;
  if (eyedropperSampling) {
    _eyedropperSnapshotDirtyAfterSample = true;
    EyedropperDebug._recordPrewarmTiming({
      reason: `snapshot-deferred:${reason}`,
      ready: false,
      deferred: true,
    }, 0);
    return;
  }
  markEyedropperSnapshotDirty();
  cancelEyedropperSnapshotRefresh();
  EyedropperDebug._recordPrewarmTiming({
    reason: `snapshot-dirty:${reason}`,
    ready: false,
    deferred: true,
  }, 0);
}

function eyedropperZoomedWallpaperGeometry(clientX, clientY, renderSize, dpr = window.devicePixelRatio || 1) {
  const worldPoint = clientToBoardWorldPoint(clientX, clientY);
  if (!worldPoint || !Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) return null;
  const sampleDot = eyedropperSampleDotCanvasPoint(renderSize);
  const sampleDotCenterX = sampleDot.x + 0.5;
  const sampleDotCenterY = sampleDot.y + 0.5;
  const previewZoom = Math.max(zoom || 1, 0.0001) * EYEDROPPER_PREVIEW_ZOOM_SCALE;
  const previewCssSize = renderSize / dpr;
  const view = {
    zoom: previewZoom,
    panX: sampleDotCenterX / dpr - worldPoint.x * previewZoom,
    panY: sampleDotCenterY / dpr - worldPoint.y * previewZoom,
    dpr,
  };
  const viewportRect = {
    x1: -view.panX / previewZoom,
    y1: -view.panY / previewZoom,
    x2: (previewCssSize - view.panX) / previewZoom,
    y2: (previewCssSize - view.panY) / previewZoom,
  };
  return {
    worldPoint,
    sampleDot,
    sampleDotCenterX,
    sampleDotCenterY,
    previewZoom,
    previewCssSize,
    view,
    viewportRect,
  };
}

function captureEyedropperZoomedWallpaper(clientX, clientY, renderSize, options = {}) {
  if (!eyedropperZoomWallpaperCtx || !Number.isFinite(renderSize) || renderSize <= 0) return null;
  const geometry = options.geometry || eyedropperZoomedWallpaperGeometry(clientX, clientY, renderSize);
  if (!geometry) return null;
  const rendered = captureEyedropperZoomWallpaper(geometry, renderSize);
  if (!rendered) return null;
  return { geometry, rendered };
}

function prepareEyedropperWallpaper() {
  cancelEyedropperSnapshotRefresh();
  const shouldForceFullImageRender = typeof IS_WIN !== 'undefined' && IS_WIN &&
    typeof viewportImageScalingEnabled !== 'undefined' &&
    viewportImageScalingEnabled;
  if (shouldForceFullImageRender) {
    eyedropperPreviousImageScalingEnabled = viewportImageScalingEnabled;
    viewportImageScalingEnabled = false;
    if (typeof invalidateOffscreen === 'function') invalidateOffscreen();
    if (typeof withRenderSource === 'function' && typeof drawBoard === 'function') {
      withRenderSource('eyedropper-full-render', () => drawBoard());
    } else if (typeof drawBoard === 'function') {
      drawBoard();
    }
  } else if (eyedropperPreviousImageScalingEnabled == null) {
    eyedropperPreviousImageScalingEnabled = null;
  }
  markEyedropperSnapshotDirty();
}

function restoreEyedropperViewportScaling() {
  if (eyedropperPreviousImageScalingEnabled == null || typeof viewportImageScalingEnabled === 'undefined') return;
  viewportImageScalingEnabled = eyedropperPreviousImageScalingEnabled;
  eyedropperPreviousImageScalingEnabled = null;
  if (typeof invalidateOffscreen === 'function') invalidateOffscreen();
  if (typeof scheduleRender === 'function') scheduleRender(true, false, 'eyedropper-restore-scaling');
}

function positionEyedropperLoupe(clientX, clientY) {
  const margin = MENU_VIEWPORT_EDGE_MARGIN;
  const layoutArg = arguments[2] || null;
  const dpr = layoutArg?.dpr || window.devicePixelRatio || 1;
  const layout = layoutArg?.hasVisibleRects
    ? layoutArg
    : getEyedropperLayoutMetrics(dpr, { requireVisibleRects: true });
  const width = layout.width || eyedropperLoupeCssWidth();
  const height = layout.height || EYEDROPPER_LOUPE_CSS_HEIGHT;
  const drawSize = eyedropperPreviewDrawSize(dpr, layout);
  const sampleCenter = eyedropperSampleDotCssCenter(drawSize, dpr);
  const previewWidth = layout.previewWidth || eyedropperPreviewCssSize();
  const previewTopOffset = layout.previewTopOffset || 0;
  const previewLeftOffset = layout.previewLeftOffset || 0;
  const unclampedLeft = clientX - previewLeftOffset - Math.min(sampleCenter.x, previewWidth);
  const unclampedTop = clientY - previewTopOffset - sampleCenter.y;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, unclampedLeft));
  const top = Math.max(margin, Math.min(window.innerHeight - height - margin, unclampedTop));
  eyedropperLoupe.style.left = `${Math.round(left)}px`; eyedropperLoupe.style.top = `${Math.round(top)}px`;
  return layout;
}

const eyedropperColorReadoutDebugState = () => {
  const card = eyedropperActiveCard;
  const classes = card?.el?.classList;
  return {
    hasActiveCard: !!card, activeCardVisible: !!classes?.contains('visible'), activeCardPinned: !!classes?.contains('pinned'),
    activeCardOwnsSwatch: card?.swatch ? card.swatch === eyedropperSwatch : '',
    activeCardOwnsHex: card?.hex ? card.hex === eyedropperHex : '',
    activeCardOwnsRgb: card?.rgb ? card.rgb === eyedropperRgb : '',
    swatchPresent: !!eyedropperSwatch, hexPresent: !!eyedropperHex, rgbPresent: !!eyedropperRgb,
    swatchConnected: !!eyedropperSwatch?.isConnected, hexConnected: !!eyedropperHex?.isConnected, rgbConnected: !!eyedropperRgb?.isConnected,
    domHex: eyedropperHex?.textContent || '', domRgb: eyedropperRgb?.textContent || '',
    swatchStyle: eyedropperSwatch?.style?.background || '',
    cardLastHex: card?.lastHex || '', cardLastRgb: card?.lastRgb || '', cardLastSwatchCss: card?.lastSwatchCss || '',
  };
};
function updateEyedropperColorReadout(pixel, meta = {}) {
  const cssColor = rgbaToCss(pixel);
  const hex = rgbaToHex(pixel);
  const rgb = rgbaToRgbText(pixel);
  const card = eyedropperActiveCard;
  const before = eyedropperColorReadoutDebugState();
  let changed = false, swatchChanged = false, hexChanged = false, rgbChanged = false;
  if (eyedropperSwatch && card?.lastSwatchCss !== cssColor) {
    eyedropperSwatch.style.background = cssColor;
    changed = true;
    swatchChanged = true;
  }
  if (eyedropperHex && card?.lastHex !== hex) {
    eyedropperHex.textContent = hex;
    changed = true;
    hexChanged = true;
  }
  if (eyedropperRgb && card?.lastRgb !== rgb) {
    eyedropperRgb.textContent = rgb;
    changed = true;
    rgbChanged = true;
  }
  if (card) {
    card.lastSwatchCss = cssColor;
    card.lastHex = hex;
    card.lastRgb = rgb;
  }
  EyedropperDebug._countPerf(changed ? 'colorReadoutDomWrites' : 'colorReadoutDomSkips');
  const after = eyedropperColorReadoutDebugState();
  EyedropperDebug._logReadoutUpdate({
    ...meta,
    hasPixel: true,
    pixelHex: hex,
    pixelRgb: rgb,
    cssColor,
    changed,
    swatchChanged,
    hexChanged,
    rgbChanged,
    domMatchesPixel: after.domHex === hex && after.domRgb === rgb,
    before,
    after,
  });
  return changed;
}

function sampleCanvasPixel(context, sourceX, sourceY, meta = {}) {
  try {
    const data = context.getImageData(sourceX, sourceY, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  } catch (err) {
    if (meta.logFailures !== false) {
      EyedropperDebug._logReadbackFailure(meta.where || 'canvas-pixel', {
        x: sourceX,
        y: sourceY,
        width: context?.canvas?.width ?? '',
        height: context?.canvas?.height ?? '',
        error: String(err),
        ...meta,
      });
    }
    return null;
  }
}

function renderEyedropperLocalReadoutPixel(clientX, clientY) {
  if (!eyedropperReadoutCtx || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const options = arguments[2] || {};
  const timings = options.timings || {};
  const totalStart = performance.now();
  const dpr = window.devicePixelRatio || 1;
  const sampleCenterOffset = 0.5 / Math.max(dpr, 1);
  const z = Math.max(zoom || 1, 0.0001);
  const view = { zoom: z, panX: panX - clientX + sampleCenterOffset, panY: panY - clientY + sampleCenterOffset, dpr };
  const viewportRect = {
    x1: (clientX - sampleCenterOffset - panX) / z,
    y1: (clientY - sampleCenterOffset - panY) / z,
    x2: (clientX + sampleCenterOffset - panX) / z,
    y2: (clientY + sampleCenterOffset - panY) / z,
  };
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const previousViewportCullingEnabled = typeof viewportCullingEnabled !== 'undefined'
    ? viewportCullingEnabled
    : null;
  try {
    const setupStart = performance.now();
    timings.localReadoutResizeChanged = resizeEyedropperCanvasBackingStore(eyedropperReadoutCanvas, 1, 1) ? 1 : 0;
    resetCanvasToScreen(eyedropperReadoutCtx);
    eyedropperReadoutCtx.fillStyle = rgbaToCss(boardBackgroundPixel());
    eyedropperReadoutCtx.fillRect(0, 0, 1, 1);
    setWorldCanvasTransform(eyedropperReadoutCtx, dpr, view);
    timings.localReadoutSetup = performance.now() - setupStart;
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = true;
    const drawStart = performance.now();
    drawVisibleObjects(eyedropperReadoutCtx, counters, {
      viewportRect,
      view,
      imageSourceResolver: selectEyedropperSafeImageSourceForDraw,
    });
    timings.localReadoutDraw = performance.now() - drawStart;
    const resetStart = performance.now();
    resetCanvasToScreen(eyedropperReadoutCtx);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = false;
    timings.localReadoutReset = performance.now() - resetStart;
    if ((counters.previewUnsafeImages || 0) > 0 || (counters.readbackSafePendingImages || 0) > 0) {
      timings.localReadoutTotal = performance.now() - totalStart;
      return {
        pixel: null,
        counters,
        viewportRect,
        sourceX: 0,
        sourceY: 0,
        sourceW: 1,
        sourceH: 1,
        readbackUnsafe: (counters.previewUnsafeImages || 0) > 0,
        pendingSafeImage: (counters.readbackSafePendingImages || 0) > 0,
      };
    }
    const readbackStart = performance.now();
    const pixel = sampleCanvasPixel(eyedropperReadoutCtx, 0, 0, {
      where: 'eyedropper-local-readout',
      source: 'sampleEyedropperReadoutPixel',
      logFailures: false,
    });
    timings.localReadoutReadback = performance.now() - readbackStart;
    timings.localReadoutTotal = performance.now() - totalStart;
    return {
      pixel,
      counters,
      viewportRect,
      sourceX: 0,
      sourceY: 0,
      sourceW: 1,
      sourceH: 1,
    };
  } catch (err) {
    resetCanvasToScreen(eyedropperReadoutCtx);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = false;
    timings.localReadoutTotal = performance.now() - totalStart;
    EyedropperDebug._logReadbackFailure('eyedropper-local-readout', {
      x: clientX,
      y: clientY,
      error: String(err),
    });
    return null;
  }
}

function imageSourceSize(source) {
  return {
    width: source?.width || source?.naturalWidth || 0,
    height: source?.height || source?.naturalHeight || 0,
  };
}

const eyedropperSourcePixelFromLocalUnit = (unit, sourceSize) => {
  const size = Math.max(1, Math.floor(Number(sourceSize) || 0));
  return Math.max(0, Math.min(size - 1, Math.floor((Number.isFinite(unit) ? unit : 0) * size)));
};

function scheduleIdleTask(callback) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(callback, { timeout: 250 });
  } else {
    setTimeout(callback, 0);
  }
}

function eyedropperTileCacheKey(key, tileX, tileY, tileSize = EYEDROPPER_SAFE_TILE_SIZE) {
  return `${key}:${tileSize}:${tileX}:${tileY}`;
}

function removeEyedropperSafeTileCache(cacheKey) {
  const existing = eyedropperSafeTileCache.get(cacheKey);
  if (!existing) return;
  eyedropperSafeTileCacheBytes -= existing.bytes || existing.data?.byteLength || 0;
  eyedropperSafeTileCache.delete(cacheKey);
  eyedropperSafeTileCacheBytes = Math.max(0, eyedropperSafeTileCacheBytes);
}

function removeEyedropperSafeTileCacheForImage(key) {
  if (!key) return;
  for (const cacheKey of [...eyedropperSafeTileCache.keys()]) {
    if (cacheKey.startsWith(`${key}:`)) removeEyedropperSafeTileCache(cacheKey);
  }
  for (const cacheKey of [...eyedropperSafeTileCachePending]) {
    if (cacheKey.startsWith(`${key}:`)) eyedropperSafeTileCachePending.delete(cacheKey);
  }
}

function trimEyedropperSafeTileCache(protectedKey = '') {
  while (eyedropperSafeTileCacheBytes > EYEDROPPER_SAFE_TILE_MEMORY_LIMIT && eyedropperSafeTileCache.size > 1) {
    let oldestKey = '';
    let oldestUse = Number.POSITIVE_INFINITY;
    for (const [cacheKey, entry] of eyedropperSafeTileCache.entries()) {
      if (cacheKey === protectedKey) continue;
      const lastUsed = entry?.lastUsed || 0;
      if (lastUsed < oldestUse) {
        oldestUse = lastUsed;
        oldestKey = cacheKey;
      }
    }
    if (!oldestKey) break;
    removeEyedropperSafeTileCache(oldestKey);
  }
}

function buildEyedropperSafeTileCache(key, token, source, sourceX, sourceY, options = {}) {
  const { width, height } = imageSourceSize(source);
  if (!key || !token || !isDrawableImageSource(source) || width <= 0 || height <= 0) return null;
  const tileSize = Math.max(1, Number(options.tileSize) || EYEDROPPER_SAFE_TILE_SIZE);
  const x = Math.max(0, Math.min(width - 1, Math.floor(sourceX)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(sourceY)));
  const tileX = Math.floor(x / tileSize) * tileSize;
  const tileY = Math.floor(y / tileSize) * tileSize;
  const tileW = Math.max(1, Math.min(tileSize, width - tileX));
  const tileH = Math.max(1, Math.min(tileSize, height - tileY));
  const cacheKey = eyedropperTileCacheKey(key, tileX, tileY, tileSize);
  const cached = eyedropperSafeTileCache.get(cacheKey);
  if (cached?.token === token) {
    cached.lastUsed = eyedropperSafeTileCacheUseCounter++;
    return cached;
  }
  if (options.sync === false && eyedropperSafeTileCachePending.has(cacheKey)) return null;

  const build = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = tileW;
      canvas.height = tileH;
      const tileCtx = canvas.getContext('2d', { willReadFrequently: true });
      if (!tileCtx) return null;
      tileCtx.drawImage(source, tileX, tileY, tileW, tileH, 0, 0, tileW, tileH);
      const imageData = tileCtx.getImageData(0, 0, tileW, tileH);
      removeEyedropperSafeTileCache(cacheKey);
      const entry = {
        token,
        data: imageData.data,
        width: tileW,
        height: tileH,
        tileX,
        tileY,
        tileSize,
        sourceW: width,
        sourceH: height,
        bytes: imageData.data.byteLength,
        lastUsed: eyedropperSafeTileCacheUseCounter++,
      };
      eyedropperSafeTileCache.set(cacheKey, entry);
      eyedropperSafeTileCacheBytes += entry.bytes;
      trimEyedropperSafeTileCache(cacheKey);
      return entry;
    } catch (err) {
      EyedropperDebug._logReadbackFailure('safe-tile-cache-build', {
        imgKey: key,
        sourceX,
        sourceY,
        tileX,
        tileY,
        tileW,
        tileH,
        error: String(err),
      });
      return null;
    }
  };

  if (options.sync === false) {
    eyedropperSafeTileCachePending.add(cacheKey);
    scheduleIdleTask(() => {
      eyedropperSafeTileCachePending.delete(cacheKey);
      const latest = eyedropperSafeImageCache.get(key);
      if (latest?.token !== token || latest.source !== source) return;
      build();
    });
    return null;
  }

  return build();
}

function sampleEyedropperSafeTileCache(key, token, source, sourceX, sourceY, options = {}) {
  const { width, height } = imageSourceSize(source);
  if (width <= 0 || height <= 0) return null;
  const tileSize = Math.max(1, Number(options.tileSize) || EYEDROPPER_SAFE_TILE_SIZE);
  const x = Math.max(0, Math.min(width - 1, Math.floor(sourceX)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(sourceY)));
  const tileX = Math.floor(x / tileSize) * tileSize;
  const tileY = Math.floor(y / tileSize) * tileSize;
  const cacheKey = eyedropperTileCacheKey(key, tileX, tileY, tileSize);
  const timings = options.timings || {};
  let cached = eyedropperSafeTileCache.get(cacheKey);
  if (!cached || cached.token !== token) {
    const buildStart = performance.now();
    cached = buildEyedropperSafeTileCache(key, token, source, sourceX, sourceY, options);
    timings.safeTileBuild = performance.now() - buildStart;
  } else {
    timings.safeTileCacheHit = (timings.safeTileCacheHit || 0) + 1;
  }
  if (!cached || cached.token !== token) return null;
  const readStart = performance.now();
  cached.lastUsed = eyedropperSafeTileCacheUseCounter++;
  const localX = Math.max(0, Math.min(cached.width - 1, x - cached.tileX));
  const localY = Math.max(0, Math.min(cached.height - 1, y - cached.tileY));
  const index = (localY * cached.width + localX) * 4;
  const data = cached.data;
  timings.safeTileRead = performance.now() - readStart;
  return {
    pixel: [data[index], data[index + 1], data[index + 2], data[index + 3]],
    tile: cached,
    sourceX: x,
    sourceY: y,
  };
}

function clearEyedropperNativePixelTarget() {
  if (_eyedropperNativePixelInFlight) return;
  _eyedropperNativePixelTarget = null;
}

const nativePixelQueueDebugState = (pointer = null, target = null, extra = {}) => {
  const latest = _eyedropperLatestPointerEvent;
  return {
    inFlight: _eyedropperNativePixelInFlight,
    sampling: eyedropperSampling,
    hasPointer: !!pointer,
    latestClientX: latest?.clientX ?? '',
    latestClientY: latest?.clientY ?? '',
    latestPointerAgeMs: latest?.receivedAt ? Math.max(0, performance.now() - latest.receivedAt) : '',
    targetKey: target?.key || _eyedropperNativePixelTarget?.key || '',
    targetSourceX: target?.sourceX ?? _eyedropperNativePixelTarget?.sourceX ?? '',
    targetSourceY: target?.sourceY ?? _eyedropperNativePixelTarget?.sourceY ?? '',
    safeImagePending: eyedropperSafeImagePromises.size,
    ...extra,
  };
};

const logEyedropperNativePixelResolveMiss = (reason, meta = {}) => {
  EyedropperDebug._count('nativePixelResolveMisses');
  EyedropperDebug._logSamplingEvent('native-pixel-resolve-miss', {
    sourceKind: 'native-pixel',
    reason,
    ...meta,
  });
};

const resolveEyedropperImageReadoutTargetAt = (clientX, clientY, timings = null) => {
  const hitStart = performance.now();
  const point = clientToBoardWorldPoint(clientX, clientY);
  const topObject = topObjectAtWorldPoint(point);
  if (timings) timings.cachedPixelHitTest = performance.now() - hitStart;
  if (!topObject) return { kind: 'background' };
  if (topObject.type !== 'image') return { kind: 'other', object: topObject };

  const sourceStart = performance.now();
  const key = topObject.data?.imgKey;
  const local = worldPointToImageLocalUnit(topObject, point);
  const safeEntry = key ? eyedropperSafeImageCache.get(key) : null;
  const token = safeEntry?.token || (key ? eyedropperSafeImageToken(key) : '');
  if (timings) timings.cachedPixelSourceSetup = performance.now() - sourceStart;
  if (!key) return { kind: 'image-miss', object: topObject, reason: 'missing-img-key' };
  if (!local) return { kind: 'image-miss', object: topObject, key, reason: 'missing-local-image-point' };
  if (!token) return { kind: 'image-miss', object: topObject, key, reason: 'missing-image-token' };
  return { kind: 'image', object: topObject, key, local, safeEntry, token };
};
function resolveEyedropperNativePixelTargetAt(clientX, clientY, timings = null) {
  const options = arguments[3] || {};
  const logMiss = options.logMiss === true;
  const miss = (reason, meta = {}) => {
    if (logMiss) logEyedropperNativePixelResolveMiss(reason, {
      clientX,
      clientY,
      ...meta,
    });
    return null;
  };
  const hitStart = performance.now();
  const point = clientToBoardWorldPoint(clientX, clientY);
  const topObject = topObjectAtWorldPoint(point);
  if (timings) timings.nativePixelResolveHitTest = performance.now() - hitStart;
  if (!topObject) return miss('empty-board');
  if (topObject.type !== 'image') return miss('top-object-not-image', {
    objectId: topObject.id || '',
    objectType: topObject.type || '',
  });

  const sourceStart = performance.now();
  const key = topObject.data?.imgKey;
  const local = worldPointToImageLocalUnit(topObject, point);
  const safeEntry = key ? eyedropperSafeImageCache.get(key) : null;
  const token = safeEntry?.token || (key ? eyedropperSafeImageToken(key) : '');
  if (timings) timings.nativePixelResolveSource = performance.now() - sourceStart;
  if (!key) return miss('missing-img-key', { objectId: topObject.id || '', objectType: topObject.type || '' });
  if (!local) return miss('missing-local-image-point', { imgKey: key, objectId: topObject.id || '', objectType: topObject.type || '' });
  if (!token) return miss('missing-image-token', { imgKey: key, objectId: topObject.id || '', objectType: topObject.type || '' });
  if (!globalThis.hasEyedropperNativePixelCacheSource?.(key)) return miss('missing-native-pixel-cache-source', {
    imgKey: key,
    objectId: topObject.id || '',
    objectType: topObject.type || '',
  });
  const dimensionSource = imageBitmapCache[key] || imageCache[key] || safeEntry?.source || null;
  const dimensionSize = imageSourceSize(dimensionSource);
  if (!dimensionSource) return miss('missing-dimension-source', { imgKey: key, objectId: topObject.id || '', objectType: topObject.type || '' });
  if (dimensionSize.width <= 0 || dimensionSize.height <= 0) return miss('invalid-dimension-size', {
    imgKey: key,
    objectId: topObject.id || '',
    objectType: topObject.type || '',
    sourceW: dimensionSize.width,
    sourceH: dimensionSize.height,
  });

  return {
    key,
    token,
    sourceX: eyedropperSourcePixelFromLocalUnit(local.u, dimensionSize.width),
    sourceY: eyedropperSourcePixelFromLocalUnit(local.v, dimensionSize.height),
    sourceW: dimensionSize.width,
    sourceH: dimensionSize.height,
    clientX,
    clientY,
  };
}

function indominaterPumpEyedropperNativePixelQueue() {
  if (_eyedropperNativePixelInFlight) {
    EyedropperDebug._count('nativePixelBusySkips');
    EyedropperDebug._logSamplingEvent('native-pixel-queue-busy', nativePixelQueueDebugState(
      _eyedropperLatestPointerEvent || _eyedropperLastSampleEvent,
      _eyedropperNativePixelTarget,
      { sourceKind: 'native-pixel', reason: 'tauri-in-flight' },
    ));
    return;
  }
  const pointer = _eyedropperLatestPointerEvent || _eyedropperLastSampleEvent;
  const target = pointer?.clientX != null && pointer?.clientY != null
    ? resolveEyedropperNativePixelTargetAt(pointer.clientX, pointer.clientY, null, { logMiss: true })
    : null;
  _eyedropperNativePixelTarget = target;
  if (!target) return;
  if (indominaterGreedyEyedropperNativeDecodePrewarm.active.has(target.key)) {
    EyedropperDebug._logSamplingEvent('native-pixel-wait-decode-prewarm', nativePixelQueueDebugState(pointer, target, {
      sourceKind: 'native-pixel',
      reason: 'decode-prewarm-active',
      imgKey: target.key,
      clientX: target.clientX,
      clientY: target.clientY,
      sourceX: target.sourceX,
      sourceY: target.sourceY,
    }));
    return;
  }
  if (!indominaterGreedyEyedropperNativeDecodePrewarm.ready.has(target.key)) {
    EyedropperDebug._logSamplingEvent('native-pixel-wait-decode-prewarm', nativePixelQueueDebugState(pointer, target, {
      sourceKind: 'native-pixel',
      reason: 'decode-not-ready',
      imgKey: target.key,
      clientX: target.clientX,
      clientY: target.clientY,
      sourceX: target.sourceX,
      sourceY: target.sourceY,
    }));
    scheduleEyedropperSamplerDecode('native-pixel-target');
    return;
  }
  if (typeof hasTauri !== 'function' || !hasTauri() || !BoardfishTauri?.sampleCachedImagePixel) {
    EyedropperDebug._logSamplingEvent('native-pixel-resolve-miss', nativePixelQueueDebugState(pointer, target, {
      sourceKind: 'native-pixel',
      reason: 'tauri-unavailable',
      imgKey: target.key,
      clientX: target.clientX,
      clientY: target.clientY,
      sourceX: target.sourceX,
      sourceY: target.sourceY,
    }));
    return;
  }
  _eyedropperNativePixelInFlight = true;
  const requestStart = performance.now();
  EyedropperDebug._count('nativePixelRequests');
  EyedropperDebug._logSamplingEvent('native-pixel-request-start', {
    imgKey: target.key,
    sourceKind: 'native-pixel',
    clientX: target.clientX,
    clientY: target.clientY,
    sourceX: target.sourceX,
    sourceY: target.sourceY,
    inFlight: true,
    latestClientX: pointer?.clientX ?? '',
    latestClientY: pointer?.clientY ?? '',
    safeImagePending: eyedropperSafeImagePromises.size,
  });
  BoardfishTauri.sampleCachedImagePixel(target.key, target.sourceX, target.sourceY)
    .then((result) => {
      const currentToken = eyedropperSafeImageToken(target.key);
      if (currentToken !== target.token) {
        EyedropperDebug._logSamplingEvent('native-pixel-discarded', {
          imgKey: target.key,
          sourceKind: 'native-pixel',
          sourceX: target.sourceX,
          sourceY: target.sourceY,
          reason: 'token-changed',
        });
        return;
      }
      const rgba = result?.rgba;
      if (!Array.isArray(rgba) || rgba.length < 4) return;
      const sourceX = Number(result.sourceX);
      const sourceY = Number(result.sourceY);
      const pixel = [rgba[0], rgba[1], rgba[2], rgba[3]];
      indominaterGreedyEyedropperNativeDecodePrewarm.ready.add(target.key);
      indominaterGreedyEyedropperNativeDecodePrewarm.failed.delete(target.key);
      updateEyedropperColorReadout(pixel, {
        source: 'native-pixel',
        reason: 'native-pixel-ready',
        clientX: target.clientX,
        clientY: target.clientY,
        imgKey: target.key,
        sourceX,
        sourceY,
      });
      EyedropperDebug._count('nativePixelReady');
      EyedropperDebug._logSamplingEvent('native-pixel-ready', {
        imgKey: target.key,
        sourceKind: 'native-pixel',
        clientX: target.clientX,
        clientY: target.clientY,
        sourceX,
        sourceY,
        durationMs: performance.now() - requestStart,
        stageMs: result.totalMs ?? '',
        targetKey: _eyedropperNativePixelTarget?.key || '',
        targetSourceX: _eyedropperNativePixelTarget?.sourceX ?? '',
        targetSourceY: _eyedropperNativePixelTarget?.sourceY ?? '',
        latestClientX: _eyedropperLatestPointerEvent?.clientX ?? '',
        latestClientY: _eyedropperLatestPointerEvent?.clientY ?? '',
        safeImagePending: eyedropperSafeImagePromises.size,
      });
    })
    .catch((err) => {
      indominaterGreedyEyedropperNativeDecodePrewarm.ready.delete(target.key);
      scheduleEyedropperSamplerDecode('native-pixel-sample-miss');
      EyedropperDebug._logReadbackFailure('native-pixel-sample', {
        imgKey: target.key,
        sourceX: target.sourceX,
        sourceY: target.sourceY,
        error: String(err),
      });
    })
    .finally(() => {
      _eyedropperNativePixelInFlight = false;
      _eyedropperNativePixelTarget = null;
      if (eyedropperSampling && (_eyedropperLatestPointerEvent || _eyedropperLastSampleEvent)) {
        EyedropperDebug._logSamplingEvent('native-pixel-pump-next', nativePixelQueueDebugState(
          _eyedropperLatestPointerEvent || _eyedropperLastSampleEvent,
          null,
          { sourceKind: 'native-pixel', reason: 'request-finished' },
        ));
        indominaterPumpEyedropperNativePixelQueue();
      }
    });
}

function requestEyedropperNativePixel() {
  if (typeof hasTauri !== 'function' || !hasTauri() || !BoardfishTauri?.sampleCachedImagePixel) return false;
  indominaterPumpEyedropperNativePixelQueue();
  return true;
}

function sampleEyedropperCachedPixelAt(clientX, clientY) {
  const options = arguments[2] || {};
  const timings = options.timings || {};
  if (_eyedropperNativePixelInFlight) {
    EyedropperDebug._count('nativePixelReadoutPending');
    EyedropperDebug._logSamplingEvent('native-pixel-readout-pending', nativePixelQueueDebugState(
      _eyedropperLatestPointerEvent || _eyedropperLastSampleEvent,
      _eyedropperNativePixelTarget,
      {
        clientX,
        clientY,
        sourceKind: 'native-pixel',
        reason: 'tauri-in-flight',
      },
    ));
    timings.cachedPixelImageMiss = 1;
    timings.cachedPixelImageMissReason = 'native-pixel-pending';
    return null;
  }
  const target = resolveEyedropperImageReadoutTargetAt(clientX, clientY, timings);
  if (target.kind === 'background') {
    clearEyedropperNativePixelTarget();
    return {
      pixel: boardBackgroundPixel(),
      source: 'background',
      reason: 'empty-board',
      objectId: '',
      objectType: '',
      layers: [],
    };
  }
  if (target.kind === 'other') {
    clearEyedropperNativePixelTarget();
    return null;
  }
  if (target.kind === 'image-miss') {
    clearEyedropperNativePixelTarget();
    timings.cachedPixelImageMiss = 1;
    timings.cachedPixelImageMissReason = target.reason || 'image-target-missing';
    return null;
  }
  const { key, local, token, object: topObject } = target;
  let safeEntry = target.safeEntry;
  if (safeEntry?.token !== token || !isDrawableImageSource(safeEntry.source)) {
    const requestStart = performance.now();
    const resolvedSource = resolveEyedropperSafeImageSource(key);
    timings.cachedPixelSafeImageRequest = performance.now() - requestStart;
    safeEntry = eyedropperSafeImageCache.get(key);
    if (resolvedSource && safeEntry?.token === token && isDrawableImageSource(safeEntry.source)) {
      timings.cachedPixelSafeImageResolvedSync = 1;
    }
  }
  if (safeEntry?.token === token && isDrawableImageSource(safeEntry.source)) {
    clearEyedropperNativePixelTarget();
    const sampleStart = performance.now();
    const { width: sourceW, height: sourceH } = imageSourceSize(safeEntry.source);
    let sourceX = eyedropperSourcePixelFromLocalUnit(local.u, sourceW);
    let sourceY = eyedropperSourcePixelFromLocalUnit(local.v, sourceH);
    const tileSample = sampleEyedropperSafeTileCache(key, token, safeEntry.source, sourceX, sourceY, {
      timings,
      sync: options.syncTileBuild === true,
    });
    timings.cachedPixelTileSample = performance.now() - sampleStart;
    const pixel = tileSample?.pixel || null;
    sourceX = tileSample?.sourceX ?? sourceX;
    sourceY = tileSample?.sourceY ?? sourceY;
    if (!pixel) {
      timings.cachedPixelImageMiss = 1;
      timings.cachedPixelImageMissReason = 'safe-tile-pending';
      return null;
    }
    return {
      pixel,
      source: 'pixel-cache',
      reason: 'cached-image-tile',
      objectId: topObject.id || '',
      objectType: topObject.type || '',
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      inBounds: true,
      layers: [],
    };
  }
  if (globalThis.hasEyedropperNativePixelCacheSource?.(key)) {
    requestEyedropperNativePixel();
    timings.cachedPixelImageMiss = 1;
    timings.cachedPixelImageMissReason = 'native-pixel-pending';
    return null;
  }
  timings.cachedPixelImageMiss = 1;
  timings.cachedPixelImageMissReason = 'safe-image-pending';
  return null;
}

function displayedBoardPixelSampleInfo(clientX, clientY, options = {}) {
  const out = {
    clientX,
    clientY,
    boardCanvasPresent: !!boardCanvas,
    ctxPresent: !!ctx,
    inBounds: false,
    sourceX: '',
    sourceY: '',
    pixel: null,
    hex: '#000000',
    rgbaText: '',
    reason: '',
  };
  if (!boardCanvas || !ctx) {
    out.reason = !boardCanvas ? 'missing-board-canvas' : 'missing-board-context';
    return out;
  }

  const rect = boardCanvas.getBoundingClientRect();
  const scaleX = rect.width ? boardCanvas.width / rect.width : 0;
  const scaleY = rect.height ? boardCanvas.height / rect.height : 0;
  Object.assign(out, {
    canvasW: boardCanvas.width,
    canvasH: boardCanvas.height,
    rectLeft: rect.left,
    rectTop: rect.top,
    rectRight: rect.right,
    rectBottom: rect.bottom,
    rectW: rect.width,
    rectH: rect.height,
    scaleX,
    scaleY,
  });

  if (!rect.width || !rect.height) {
    out.reason = 'empty-board-rect';
    return out;
  }
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
    out.reason = 'outside-board-rect';
    return out;
  }

  out.inBounds = true;
  out.sourceX = Math.max(0, Math.min(
    boardCanvas.width - 1,
    Math.floor((clientX - rect.left) * scaleX),
  ));
  out.sourceY = Math.max(0, Math.min(
    boardCanvas.height - 1,
    Math.floor((clientY - rect.top) * scaleY),
  ));

  out.pixel = sampleCanvasPixel(ctx, out.sourceX, out.sourceY, {
    where: 'displayed-board-pixel',
    source: 'displayedBoardPixelSampleInfo',
    logFailures: options.logFailures !== false,
  });
  out.hex = rgbaToHex(out.pixel);
  out.rgbaText = out.pixel ? out.pixel.join(' ') : '';
  out.reason = out.pixel ? 'ok' : 'readback-failed';
  return out;
}

function sampleEyedropperReadoutPixel(clientX, clientY, previewSample = null, options = {}) {
  const timings = {};
  const cacheStart = performance.now();
  const cachedPixel = sampleEyedropperCachedPixelAt(clientX, clientY, {
    timings,
    syncTileBuild: options.syncTileBuild !== false,
  });
  timings.cachedPixelLookup = performance.now() - cacheStart;
  if (cachedPixel) return { ...cachedPixel, timings };
  if (timings.cachedPixelImageMissReason === 'native-pixel-pending') {
    return {
      pixel: null,
      source: 'native-pixel',
      reason: 'native-pixel-pending',
      objectId: '',
      objectType: 'image',
      inBounds: false,
      noReadoutUpdate: true,
      counters: previewSample?.counters || {},
      layers: [],
      timings,
    };
  }
  if (timings.cachedPixelImageMiss && options.localImageFallback !== true) {
    return {
      pixel: null,
      source: 'pixel-cache',
      reason: timings.cachedPixelImageMissReason || 'image-cache-pending',
      objectId: '',
      objectType: 'image',
      inBounds: false,
      noReadoutUpdate: true,
      counters: previewSample?.counters || {},
      layers: [],
      timings,
    };
  }
  const previewReadbackSafe = previewSample?.painted &&
    previewSample.centerX != null &&
    previewSample.centerY != null &&
    !previewSample.readbackUnsafe &&
    !previewSample.pendingSafeImage;
  if (previewReadbackSafe) {
    timings.previewCenterReadbackSkipped = 1;
  }
  const localStart = performance.now();
  const local = renderEyedropperLocalReadoutPixel(clientX, clientY, { timings });
  timings.localReadout = performance.now() - localStart;
  if (!local) {
    return {
      pixel: previewSample?.pixel || boardBackgroundPixel(),
      source: 'background',
      reason: 'local-readout-failed',
      objectId: '',
      objectType: '',
      layers: [],
      timings,
    };
  }
  return {
    pixel: local.pixel || previewSample?.pixel || boardBackgroundPixel(),
    source: local.pixel ? 'local-readout' : 'background',
    reason: local.pixel ? 'local-rendered-canvas' : 'local-readback-failed',
    objectId: '',
    objectType: '',
    sourceX: local.sourceX,
    sourceY: local.sourceY,
    sourceW: local.sourceW,
    sourceH: local.sourceH,
    inBounds: !!local.pixel,
    counters: local.counters,
    layers: [],
    timings,
  };
}

function eyedropperSampleDotCanvasPoint(drawSize) {
  const size = Math.max(1, Math.round(drawSize));
  const point = Math.floor(size / 2);
  return {
    x: Math.max(0, Math.min(size - 1, point)),
    y: Math.max(0, Math.min(size - 1, point)),
  };
}

function drawEyedropperSampleDot(drawSize, dpr = window.devicePixelRatio || 1) {
  const dot = eyedropperSampleDotCanvasPoint(drawSize);
  const cx = dot.x + 0.5;
  const cy = dot.y + 0.5;
  const displayScale = Math.max(1, Number(dpr) || 1);
  const outerRadius = 3 * displayScale;
  const innerRadius = 2 * displayScale;

  drawEyedropperReticleCore(eyedropperCtx, cx, cy, outerRadius, innerRadius);
}

function resetEyedropperRenderedSampleSize(width, height) {
  return resizeEyedropperCanvasBackingStore(eyedropperRenderedSampleCanvas, width, height);
}

function refreshEyedropperAfterSafeImageReady() {
  if (!eyedropperEnabled) return;
  scheduleEyedropperSnapshotRefresh('safe-image-ready');
  if (eyedropperSampling && _eyedropperLastSampleEvent) updateEyedropperSample(_eyedropperLastSampleEvent);
}

function refreshEyedropperViewportAfterSafeImageReady() {
  if (!eyedropperEnabled) return;
  scheduleEyedropperSnapshotRefresh('safe-image-ready');
}

function eyedropperSafeImageToken(key, dataUrl = null) {
  if (dataUrl) return dataUrl;
  const stored = imageStore[key];
  if (typeof stored === 'string') return stored;
  if (isNativeImageRef(stored)) {
    return [
      'native',
      stored.cache_key || stored.cacheKey || '',
      stored.path || '',
      stored.mtime || '',
      stored.size || '',
    ].join(':');
  }
  if (typeof isWebImageRef === 'function' && isWebImageRef(stored)) return ['web', stored.path || '', stored.mime || '', stored.ext || '', stored.bytes || '', webImageDisplaySrc(stored) || webImageDataUrl(stored)].join(':');
  return '';
}

function closeEyedropperImageSource(source) {
  try {
    if (source?.close) source.close();
  } catch (_) {}
}

function closeEyedropperSafeImageEntry(entry) {
  if (entry?.owned) closeEyedropperImageSource(entry.source);
}

function closeEyedropperSafeScaledImages(key) {
  eyedropperSafeScaledBitmapStore.removeGroup(key);
}

function removeEyedropperSafeImageKey(key) {
  if (!key) return false;
  const existing = eyedropperSafeImageCache.get(key);
  if (existing) closeEyedropperSafeImageEntry(existing);
  eyedropperSafeImageCache.delete(key);
  eyedropperSafeImagePromises.delete(key);
  closeEyedropperSafeScaledImages(key);
  removeEyedropperSafeTileCacheForImage(key);
  if (typeof removeEyedropperSafePixelCache === 'function') removeEyedropperSafePixelCache(key);
  for (const pendingKey of [...eyedropperSafeScaledBitmapPending]) {
    if (pendingKey.startsWith(`${key}:`)) {
      eyedropperSafeScaledBitmapPending.delete(pendingKey);
      eyedropperSafeScaledBitmapPendingBytes.delete(pendingKey);
    }
  }
  ['imageCache', 'display-cache', 'bitmap-cache'].forEach(kind => eyedropperSafeDisplayProbeFailures.delete(eyedropperDisplayProbeFailureKey(key, kind)));
  eyedropperNativeSourceSkipLogged.delete(key);
  resetEyedropperDecodedImageKey(key);
  return !!existing;
}

function clearEyedropperSafeImageCache() {
  for (const entry of eyedropperSafeImageCache.values()) closeEyedropperSafeImageEntry(entry);
  eyedropperSafeScaledBitmapStore.clear();
  eyedropperSafeImageCache.clear();
  eyedropperSafeImagePromises.clear();
  eyedropperSafeScaledBitmapPending.clear();
  eyedropperSafeScaledBitmapPendingBytes.clear();
  eyedropperSafeTileCache.clear();
  eyedropperSafeTileCachePending.clear();
  eyedropperSafeTileCacheBytes = 0;
  _eyedropperNativePixelTarget = null;
  indominaterGreedyEyedropperNativeDecodePrewarm.ready.clear();
  indominaterGreedyEyedropperNativeDecodePrewarm.failed.clear();
  indominaterGreedyEyedropperNativeDecodePrewarm.pendingReasons.clear();
  eyedropperSafeDisplayProbeFailures.clear();
  eyedropperNativeSourceSkipLogged.clear();
}

function pruneEyedropperSafeImagesToKeys(retainedKeys = new Set()) {
  if (!retainedKeys || typeof retainedKeys.has !== 'function') return { removed: 0, retained: eyedropperSafeImageCache.size };
  let removed = 0;
  for (const key of [...eyedropperSafeImageCache.keys()]) {
    if (retainedKeys.has(key)) continue;
    if (removeEyedropperSafeImageKey(key)) removed++;
  }
  if (removed) {
    EyedropperDebug._count('safeImageCachePruned', removed);
  }
  return { removed, retained: eyedropperSafeImageCache.size };
}

function storeEyedropperSafeImage(key, token, source, options = {}) {
  const existing = eyedropperSafeImageCache.get(key);
  if (existing && existing.token !== token) {
    closeEyedropperSafeImageEntry(existing);
    closeEyedropperSafeScaledImages(key);
    if (typeof removeEyedropperSafePixelCache === 'function') removeEyedropperSafePixelCache(key);
    removeEyedropperSafeTileCacheForImage(key);
  }
  eyedropperSafeImageCache.set(key, {
    token,
    source,
    owned: options.owned !== false,
    sourceKind: options.sourceKind || 'data-url',
  });
}

function countEyedropperCounter(counters, name, amount = 1) {
  if (counters) counters[name] = (counters[name] || 0) + amount;
  EyedropperDebug._count(name, amount);
}

function eyedropperDisplayProbeFailureKey(key, sourceKind) {
  return `${key}:${sourceKind || 'display'}`;
}

function rememberEyedropperUnsafeDisplaySource(key, token, sourceKind, error) {
  eyedropperSafeDisplayProbeFailures.set(eyedropperDisplayProbeFailureKey(key, sourceKind), token);
  EyedropperDebug._logUnsafeImageSkip({
    where: 'display-readback-probe',
    imgKey: key,
    cacheSource: sourceKind,
    reason: 'display-cache-readback-failed',
    error: String(error),
  });
}

function isEyedropperReadbackSafeDisplaySource(key, token, source, sourceKind, counters = null) {
  if (!isDrawableImageSource(source) || !eyedropperReadbackProbeCtx) return false;
  if (eyedropperSafeDisplayProbeFailures.get(eyedropperDisplayProbeFailureKey(key, sourceKind)) === token) return false;
  try {
    resizeEyedropperCanvasBackingStore(eyedropperReadbackProbeCanvas, 1, 1);
    eyedropperReadbackProbeCtx.setTransform(1, 0, 0, 1, 0, 0);
    eyedropperReadbackProbeCtx.clearRect(0, 0, 1, 1);
    eyedropperReadbackProbeCtx.drawImage(source, 0, 0, 1, 1);
    eyedropperReadbackProbeCtx.getImageData(0, 0, 1, 1);
    return true;
  } catch (err) {
    resizeEyedropperCanvasBackingStore(eyedropperReadbackProbeCanvas, 1, 1);
    countEyedropperCounter(counters, 'safeDisplayProbeFailures');
    rememberEyedropperUnsafeDisplaySource(key, token, sourceKind, err);
    return false;
  }
}

function resolveEyedropperDisplayCacheSource(key, token, counters = null) {
  if (isNativeImageRef(imageStore[key])) return null;
  if (imageAssetUrlCache[key]) return null;

  const displayImg = imageBitmapCache[key] || imageCache[key];
  const sourceKind = displayImg === imageBitmapCache[key] ? 'bitmap-cache' : 'display-cache';
  if (isDrawableImageSource(displayImg) && isEyedropperReadbackSafeDisplaySource(key, token, displayImg, sourceKind, counters)) {
    storeEyedropperSafeImage(key, token, displayImg, { owned: false, sourceKind });
    countEyedropperCounter(counters, 'safeDisplayImages');
    return displayImg;
  }
  return null;
}

function logEyedropperNativeSourceHydrationSkip(key, counters = null) {
  countEyedropperCounter(counters, 'nativeSourceHydrationSkipped');
  if (eyedropperNativeSourceSkipLogged.has(key)) return;
  eyedropperNativeSourceSkipLogged.add(key);
  EyedropperDebug._logUnsafeImageSkip({
    where: 'safe-image-resolve',
    imgKey: key,
    source: 'native-ref',
    reason: 'native-source-hydration-disabled',
  });
}

function resolveEyedropperNativeDataUrlSource(key, token, counters = null) {
  if (typeof ensureImageDataUrl !== 'function') {
    logEyedropperNativeSourceHydrationSkip(key, counters);
    return null;
  }

  if (eyedropperSafeImagePromises.has(key)) {
    countEyedropperCounter(counters, 'readbackSafePendingImages');
    countEyedropperCounter(counters, 'safeDataUrlPending');
    return null;
  }

  const requestStart = performance.now();
  EyedropperDebug._logSamplingEvent('safe-image-request-start', {
    imgKey: key,
    sourceKind: 'native-data-url',
    safeImagePending: eyedropperSafeImagePromises.size,
  });
  const promise = ensureImageDataUrl(key)
    .then((dataUrl) => {
      const dataUrlAt = performance.now();
      EyedropperDebug._logSamplingEvent('safe-image-data-url-ready', {
        imgKey: key,
        sourceKind: 'native-data-url',
        durationMs: dataUrlAt - requestStart,
        safeImagePending: eyedropperSafeImagePromises.size,
      });
      if (!dataUrl) return null;
      const dataToken = eyedropperSafeImageToken(key, dataUrl);
      const latest = eyedropperSafeImageCache.get(key);
      if (latest?.token === dataToken && isDrawableImageSource(latest.source)) return latest.source;
      const loadStart = performance.now();
      return loadImageElement(dataUrl)
        .then(async (img) => {
          const loadAt = performance.now();
          let source = img;
          if (typeof createImageBitmap === 'function') {
            try {
              const bitmapStart = performance.now();
              source = await createImageBitmap(img);
              EyedropperDebug._logSamplingEvent('safe-image-bitmap-ready', {
                imgKey: key,
                sourceKind: 'native-data-url',
                durationMs: performance.now() - requestStart,
                stageMs: performance.now() - bitmapStart,
                safeImagePending: eyedropperSafeImagePromises.size,
              });
            } catch (_) {}
          }
          storeEyedropperSafeImage(key, dataToken, source, { owned: source !== img, sourceKind: 'data-url' });
          EyedropperDebug._count('safeDataUrlLoads');
          EyedropperDebug._logSamplingEvent('safe-image-store-ready', {
            imgKey: key,
            sourceKind: 'native-data-url',
            durationMs: performance.now() - requestStart,
            stageMs: loadAt - loadStart,
            safeImagePending: eyedropperSafeImagePromises.size,
          });
          refreshEyedropperAfterSafeImageReady();
          refreshEyedropperViewportAfterSafeImageReady();
          return source;
        });
    })
    .catch((err) => {
      if (counters) {
        counters.erroredImages = (counters.erroredImages || 0) + 1;
        counters.lastDrawErrorKey = key;
        counters.lastDrawError = String(err);
      }
      return null;
    })
    .finally(() => {
      EyedropperDebug._logSamplingEvent('safe-image-request-end', {
        imgKey: key,
        sourceKind: 'native-data-url',
        durationMs: performance.now() - requestStart,
        safeImagePending: eyedropperSafeImagePromises.size,
      });
      eyedropperSafeImagePromises.delete(key);
    });

  eyedropperSafeImagePromises.set(key, promise);
  countEyedropperCounter(counters, 'readbackSafePendingImages');
  countEyedropperCounter(counters, 'safeDataUrlPending');
  return null;
}

function countEyedropperSafeSourceUse(entry, counters = null) {
  if (!entry) return;
  if (entry.sourceKind === 'display-cache' || entry.sourceKind === 'bitmap-cache') countEyedropperCounter(counters, 'safeDisplayImages');
  else if (entry.sourceKind === 'data-url') countEyedropperCounter(counters, 'safeDataUrlImages');
}

function resolveEyedropperSafeImageSource(key, counters = null) {
  if (!key) return null;
  const token = eyedropperSafeImageToken(key);
  const cached = eyedropperSafeImageCache.get(key);
  if (cached?.token === token && isDrawableImageSource(cached.source)) {
    countEyedropperSafeSourceUse(cached, counters);
    return cached.source;
  }
  if (cached && cached.token !== token) {
    closeEyedropperSafeImageEntry(cached);
    closeEyedropperSafeScaledImages(key);
    eyedropperSafeImageCache.delete(key);
  }

  const displaySource = resolveEyedropperDisplayCacheSource(key, token, counters);
  if (displaySource) return displaySource;

  const stored = imageStore[key];
  if (isNativeImageRef(stored)) {
    return resolveEyedropperNativeDataUrlSource(key, token, counters);
  }

  if (eyedropperSafeImagePromises.has(key)) {
    countEyedropperCounter(counters, 'readbackSafePendingImages');
    countEyedropperCounter(counters, 'safeDataUrlPending');
    return null;
  }

  if (typeof stored !== 'string') return null;

  const requestStart = performance.now();
  EyedropperDebug._logSamplingEvent('safe-image-request-start', {
    imgKey: key,
    sourceKind: 'stored-data-url',
    safeImagePending: eyedropperSafeImagePromises.size,
  });
  const promise = Promise.resolve(stored)
    .then((dataUrl) => {
      const dataUrlAt = performance.now();
      EyedropperDebug._logSamplingEvent('safe-image-data-url-ready', {
        imgKey: key,
        sourceKind: 'stored-data-url',
        durationMs: dataUrlAt - requestStart,
        safeImagePending: eyedropperSafeImagePromises.size,
      });
      if (!dataUrl) return null;
      const dataToken = eyedropperSafeImageToken(key, dataUrl);
      const latest = eyedropperSafeImageCache.get(key);
      if (latest?.token === dataToken && isDrawableImageSource(latest.source)) return latest.source;
      const loadStart = performance.now();
      return loadImageElement(dataUrl)
        .then(async (img) => {
          const loadAt = performance.now();
          let source = img;
          if (typeof createImageBitmap === 'function') {
            try {
              const bitmapStart = performance.now();
              source = await createImageBitmap(img);
              EyedropperDebug._logSamplingEvent('safe-image-bitmap-ready', {
                imgKey: key,
                sourceKind: 'stored-data-url',
                durationMs: performance.now() - requestStart,
                stageMs: performance.now() - bitmapStart,
                safeImagePending: eyedropperSafeImagePromises.size,
              });
            } catch (_) {}
          }
          storeEyedropperSafeImage(key, dataToken, source, { owned: source !== img, sourceKind: 'data-url' });
          EyedropperDebug._count('safeDataUrlLoads');
          EyedropperDebug._logSamplingEvent('safe-image-store-ready', {
            imgKey: key,
            sourceKind: 'stored-data-url',
            durationMs: performance.now() - requestStart,
            stageMs: loadAt - loadStart,
            safeImagePending: eyedropperSafeImagePromises.size,
          });
          refreshEyedropperAfterSafeImageReady();
          refreshEyedropperViewportAfterSafeImageReady();
          return source;
        });
    })
    .catch((err) => {
      if (counters) {
        counters.erroredImages = (counters.erroredImages || 0) + 1;
        counters.lastDrawErrorKey = key;
        counters.lastDrawError = String(err);
      }
      return null;
    })
    .finally(() => {
      EyedropperDebug._logSamplingEvent('safe-image-request-end', {
        imgKey: key,
        sourceKind: 'stored-data-url',
        durationMs: performance.now() - requestStart,
        safeImagePending: eyedropperSafeImagePromises.size,
      });
      eyedropperSafeImagePromises.delete(key);
    });

  eyedropperSafeImagePromises.set(key, promise);
  countEyedropperCounter(counters, 'readbackSafePendingImages');
  countEyedropperCounter(counters, 'safeDataUrlPending');
  return null;
}

function requestEyedropperSampleSafeImage(key, counters = null, reason = 'sample') {
  if (!key) return null;
  const cached = eyedropperSafeImageCache.get(key);
  if (cached?.token && isDrawableImageSource(cached.source)) {
    countEyedropperSafeSourceUse(cached, counters);
    return cached.source;
  }
  if (isNativeImageRef(imageStore[key])) {
    logEyedropperNativeSourceHydrationSkip(key, counters);
    EyedropperDebug._logSamplingEvent('safe-image-native-hydration-skipped', {
      imgKey: key,
      sourceKind: 'native-ref',
      reason,
      safeImagePending: eyedropperSafeImagePromises.size,
    });
    return null;
  }
  EyedropperDebug._count(`sampleSafeImageRequest:${reason}`);
  return resolveEyedropperSafeImageSource(key, counters);
}

function eyedropperSafeScaleDecision(obj, source, view) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  const viewZoom = Math.max(view?.zoom || zoom || 1, 0.0001);
  const dpr = view?.dpr || window.devicePixelRatio || 1;
  const scaleVariantsEnabled = typeof isViewportImageScalingActive === 'function'
    ? isViewportImageScalingActive()
    : typeof viewportImageScalingEnabled !== 'undefined' && viewportImageScalingEnabled;
  return {
    targetScale: scaleVariantsEnabled ? chooseImageScaleForDraw(obj, source, view) : 1,
    sourceW,
    sourceH,
    neededW: obj.w * viewZoom * dpr,
    neededH: obj.h * viewZoom * dpr,
    dpr,
    zoom: viewZoom,
  };
}

function eyedropperBitmapByteSize(bitmap) {
  if (typeof bitmapByteSize === 'function') return bitmapByteSize(bitmap);
  return (bitmap?.width || 0) * (bitmap?.height || 0) * 4;
}

function eyedropperScaledVariantEstimatedBytes(sourceW, sourceH, scale) {
  if (typeof scaledVariantEstimatedBytes === 'function') return scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  return Math.max(1, Math.ceil(sourceW * scale)) * Math.max(1, Math.ceil(sourceH * scale)) * 4;
}

function eyedropperSafeScaledPendingBytes() {
  let bytes = 0;
  for (const value of eyedropperSafeScaledBitmapPendingBytes.values()) bytes += value || 0;
  return bytes;
}

function pruneEyedropperSafeScaledImages() {
  eyedropperSafeScaledBitmapStore.prune();
}

function queueEyedropperSafeScaledImage(key, source, scale) {
  if (!key || !source || scale >= 1 || typeof createImageBitmap !== 'function') return;
  const pendingKey = `${key}:${scale}`;
  const map = eyedropperSafeScaledBitmapCache.get(key);
  if (map?.has(scale) || eyedropperSafeScaledBitmapPending.has(pendingKey)) return;
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return;
  const estimatedBytes = eyedropperScaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (eyedropperSafeScaledBitmapStore.bytes + eyedropperSafeScaledPendingBytes() + estimatedBytes > EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT) {
    EyedropperDebug._count('safeScaledMemorySkips');
    return;
  }

  eyedropperSafeScaledBitmapPending.add(pendingKey);
  eyedropperSafeScaledBitmapPendingBytes.set(pendingKey, estimatedBytes);
  requestAnimationFrame(() => {
    const w = Math.max(1, Math.ceil(sourceW * scale));
    const h = Math.max(1, Math.ceil(sourceH * scale));
    createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      .then((bitmap) => {
        const bytes = eyedropperBitmapByteSize(bitmap);
        eyedropperSafeScaledBitmapStore.set(key, scale, { bitmap, bytes });
        pruneEyedropperSafeScaledImages();
        refreshEyedropperAfterSafeImageReady();
      })
      .catch(() => {})
      .finally(() => {
        eyedropperSafeScaledBitmapPending.delete(pendingKey);
        eyedropperSafeScaledBitmapPendingBytes.delete(pendingKey);
      });
  });
}

function selectEyedropperSafeImageSourceForDraw(key, obj, view, counters = null) {
  const fullSource = requestEyedropperSampleSafeImage(key, counters, 'readout');
  if (!isDrawableImageSource(fullSource)) return null;
  const decision = eyedropperSafeScaleDecision(obj, fullSource, view);
  let source = fullSource;
  let selectedScale = 1;

  if (decision.targetScale < 1) {
    const map = eyedropperSafeScaledBitmapCache.get(key);
    const scaleLevels = Array.isArray(IMAGE_SCALE_LEVELS) ? IMAGE_SCALE_LEVELS : [];
    const availableScale = scaleLevels
      .filter((scale) => scale >= decision.targetScale && map?.has(scale))
      .reduce((best, scale) => Math.min(best, scale), 1);
    if (availableScale < 1) {
      selectedScale = availableScale;
      const entry = eyedropperSafeScaledBitmapStore.get(key, availableScale);
      source = entry.bitmap;
    } else {
      queueEyedropperSafeScaledImage(key, fullSource, decision.targetScale);
    }
  }

  if (counters) {
    counters.lastImageTargetScale = decision.targetScale;
    counters.lastImageSelectedScale = selectedScale;
    counters.lastImageSourceW = decision.sourceW;
    counters.lastImageSourceH = decision.sourceH;
    counters.lastImageNeededW = decision.neededW;
    counters.lastImageNeededH = decision.neededH;
    counters.lastImageDpr = decision.dpr;
    counters.lastImageZoom = decision.zoom;
    if (selectedScale < 1) counters.readbackSafeScaledImages = (counters.readbackSafeScaledImages || 0) + 1;
  }

  return {
    source,
    scale: selectedScale,
    targetScale: decision.targetScale,
    readbackSafe: true,
  };
}

function noteEyedropperNavigationActive(reason = 'viewport', durationMs = 180) {
  if (!eyedropperEnabled && !isEyedropperSampleVisible()) return;
  const now = performance.now();
  _eyedropperNavigationBlockUntil = Math.max(_eyedropperNavigationBlockUntil, now + Math.max(0, durationMs));
  if (_eyedropperNavigationBlockTimer) clearTimeout(_eyedropperNavigationBlockTimer);
  _eyedropperNavigationBlockTimer = setTimeout(() => {
    _eyedropperNavigationBlockTimer = null;
    if (performance.now() >= _eyedropperNavigationBlockUntil) _eyedropperNavigationBlockUntil = 0;
  }, Math.max(0, durationMs) + 16);
  EyedropperDebug._count(`navigation:${reason}`);
}

function handleEyedropperViewportChanged(reason = 'viewport') {
  invalidateEyedropperLayoutMetrics();
  scheduleEyedropperNativeDecodePrewarm(reason);
  if (!eyedropperEnabled) return;
  if (eyedropperSampling) hideEyedropperSample();
  scheduleEyedropperSnapshotRefresh(reason);
}

function paintEyedropperWallpaperPreview(clientX, clientY, drawSize, options = {}) {
  if (!eyedropperRenderedSampleCtx) return null;
  const timingStart = performance.now();
  const timings = {};
  const dpr = window.devicePixelRatio || 1;
  const renderSize = Math.max(1, Math.round(drawSize));
  const geometry = eyedropperZoomedWallpaperGeometry(clientX, clientY, renderSize, dpr);
  if (!geometry) return null;
  const { previewCssSize, sampleDot, previewZoom, viewportRect } = geometry;
  const background = boardBackgroundPixel();
  timings.geometry = performance.now() - timingStart;

  const wallpaperStart = performance.now();
  const wallpaper = captureEyedropperZoomedWallpaper(clientX, clientY, renderSize, { geometry });
  timings.wallpaperRender = performance.now() - wallpaperStart;
  if (!wallpaper || !eyedropperZoomWallpaperReady) return null;

  const setupStart = performance.now();
  const resizeRenderedStart = performance.now();
  const renderedSizeChanged = eyedropperRenderedSampleCanvas.width !== renderSize ||
    eyedropperRenderedSampleCanvas.height !== renderSize;
  resetEyedropperRenderedSampleSize(renderSize, renderSize);
  timings.resizeRendered = performance.now() - resizeRenderedStart;
  timings.resizeRenderedChanged = renderedSizeChanged ? 1 : 0;
  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperRenderedSampleCtx.imageSmoothingEnabled = true;
  eyedropperRenderedSampleCtx.imageSmoothingQuality = 'high';
  eyedropperRenderedSampleCtx.fillStyle = rgbaToCss(background);
  eyedropperRenderedSampleCtx.fillRect(0, 0, renderSize, renderSize);
  timings.paintSetup = performance.now() - setupStart;

  const objectLoopStart = performance.now();
  eyedropperRenderedSampleCtx.drawImage(
    eyedropperZoomWallpaperCanvas,
    0,
    0,
    renderSize,
    renderSize,
    0,
    0,
    renderSize,
    renderSize,
  );
  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  timings.objectLoop = performance.now() - objectLoopStart;
  timings.readback = 0;
  timings.previewReadbackSkipped = options.sampleCenter === false ? 1 : 0;
  timings.wallpaperReadout = 0;

  const blitStart = performance.now();
  eyedropperCtx.imageSmoothingEnabled = false;
  eyedropperCtx.drawImage(eyedropperRenderedSampleCanvas, 0, 0, renderSize, renderSize, 0, 0, renderSize, renderSize);
  timings.blit = performance.now() - blitStart;
  timings.paintPreview = performance.now() - timingStart;
  return {
    painted: true,
    pixel: null,
    centerX: sampleDot.x,
    centerY: sampleDot.y,
    usedFallback: false,
    previewCssSize,
    drawSize: renderSize,
    previewZoom,
    view: geometry.view,
    viewportRect,
    counters: wallpaper.rendered.counters,
    drawnImages: wallpaper.rendered.drawnImages || 0,
    drawnText: wallpaper.rendered.drawnText || 0,
    testedObjects: wallpaper.rendered.counters?.testedObjects || 0,
    intersectingObjects: wallpaper.rendered.counters?.visibleObjects || 0,
    wallpaper: true,
    readbackUnsafe: !!wallpaper.rendered.counters?.previewUnsafeImages,
    pendingSafeImage: !!wallpaper.rendered.counters?.readbackSafePendingImages,
    timings,
  };
}

function paintZoomedBoardPreview(clientX, clientY, drawSize, options = {}) {
  if (!eyedropperRenderedSampleCtx) return { painted: false, pixel: null };
  const wallpaperSample = paintEyedropperWallpaperPreview(clientX, clientY, drawSize, options);
  if (wallpaperSample) return wallpaperSample;
  return { painted: false, pixel: null, reason: 'missing-wallpaper' };
}

function commitEyedropperSample(e, options = {}) {
  ensureEyedropperCard();
  if ((!eyedropperSampling && !options.force) || !eyedropperLoupe || !eyedropperCanvas || !eyedropperCtx) return;
  eyedropperLoupe.classList.remove('pinned', 'dragging');
  _eyedropperLastSampleEvent = { clientX: e.clientX, clientY: e.clientY };

  const totalStart = performance.now();
  const timings = {};
  const inputAgeAtCommitMs = inputEventAgeMs(e, totalStart);
  const receivedAt = Number(e.receivedAt ?? e._debugReceivedAt);
  const latestPointer = _eyedropperLatestPointerEvent;
  const pointerDeltaPx = latestPointer?.clientX != null && latestPointer?.clientY != null
    ? Math.hypot(latestPointer.clientX - e.clientX, latestPointer.clientY - e.clientY)
    : 0;
  const latency = {
    inputAgeAtReceiveMs: e.inputAgeAtReceiveMs ?? '',
    inputAgeAtCommitMs: inputAgeAtCommitMs == null ? '' : Math.round(inputAgeAtCommitMs * 100) / 100,
    queueDelayMs: Number.isFinite(receivedAt) ? Math.round(Math.max(0, totalStart - receivedAt) * 100) / 100 : '',
    pointerDeltaPx: Math.round(pointerDeltaPx * 100) / 100,
    frameCoalescedMoves: e.coalescedMoves ?? 0,
  };
  EyedropperDebug._logSamplingEvent('sample-commit-start', {
    clientX: e.clientX,
    clientY: e.clientY,
    firstSample: !!options.first,
    ...latency,
  });
  const dpr = window.devicePixelRatio || 1;
  const layoutStart = performance.now();
  let layoutMetrics = getEyedropperLayoutMetrics(dpr);
  timings.layout = performance.now() - layoutStart;
  const drawSizeStart = performance.now();
  const drawSize = eyedropperPreviewDrawSize(dpr, layoutMetrics);
  timings.drawSize = performance.now() - drawSizeStart;

  const resizeStart = performance.now();
  timings.resizeVisibleChanged = resizeEyedropperCanvasBackingStore(eyedropperCanvas, drawSize, drawSize) ? 1 : 0;
  timings.resizeVisible = performance.now() - resizeStart;

  const clearStart = performance.now();
  eyedropperCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperCtx.imageSmoothingEnabled = false;
  eyedropperCtx.clearRect(0, 0, drawSize, drawSize);
  timings.clearVisible = performance.now() - clearStart;

  const previewSample = paintZoomedBoardPreview(e.clientX, e.clientY, drawSize, { sampleCenter: false });
  if (previewSample) previewSample.firstSample = !!options.first;
  if (previewSample) previewSample.latency = latency;
  Object.assign(timings, previewSample?.timings || {});
  if (previewSample?.painted && (options.first || options.final || options.capturePreview)) {
    rememberEyedropperPendingCardPreviewSnapshot(eyedropperActiveCard, eyedropperRenderedSampleCanvas, options.final ? 'final-sample' : 'first-sample');
  }
  const canvasReadoutStart = performance.now();
  let readoutSample = sampleEyedropperReadoutPixel(e.clientX, e.clientY, previewSample, {
    localImageFallback: options.first === true,
    syncTileBuild: true,
  });
  timings.canvasReadout = performance.now() - canvasReadoutStart;
  for (const [name, ms] of Object.entries(readoutSample?.timings || {})) {
    timings[`readout:${name}`] = ms;
  }
  const centerPixel = readoutSample?.pixel;
  timings.previewReadback = 0;
  timings.previewReadbackSkipped = 1;
  timings.previewDiagnostics = 0;
  if (previewSample && _eyedropperPreviewDiagnosticsEnabled) {
    const diagnosticsStart = performance.now();
    previewSample.previewDiagnostics = analyzeEyedropperPreviewSurface(previewSample, centerPixel);
    timings.previewDiagnostics = performance.now() - diagnosticsStart;
  }
  timings.totalBeforeReadout = performance.now() - totalStart;
  timings.total = timings.totalBeforeReadout;
  if (previewSample) previewSample.timings = timings;
  const dotStart = performance.now();
  drawEyedropperSampleDot(drawSize, dpr);
  timings.dot = performance.now() - dotStart;
  const readoutStart = performance.now();
  timings.readoutPixelPresent = centerPixel ? 1 : 0;
  timings.readoutNoUpdate = readoutSample?.noReadoutUpdate ? 1 : 0;
  const readoutMeta = {
    source: readoutSample?.source || '', reason: readoutSample?.reason || '', clientX: e.clientX, clientY: e.clientY,
    firstSample: !!options.first, finalSample: !!options.final, noReadoutUpdate: !!readoutSample?.noReadoutUpdate,
    objectId: readoutSample?.objectId || '', objectType: readoutSample?.objectType || '',
    sourceX: readoutSample?.sourceX ?? '', sourceY: readoutSample?.sourceY ?? '',
  };
  timings.readoutChanged = centerPixel && updateEyedropperColorReadout(centerPixel, readoutMeta) ? 1 : 0;
  if (!centerPixel) EyedropperDebug._logReadoutUpdate({
    ...readoutMeta, reason: readoutMeta.reason || 'missing-readout-pixel', hasPixel: false,
    before: eyedropperColorReadoutDebugState(), after: eyedropperColorReadoutDebugState(),
  });
  timings.readout = performance.now() - readoutStart;
  const visibleStart = performance.now();
  if (!eyedropperLoupe.classList.contains('visible')) {
    if (typeof closeOpenMenusExcept === 'function') closeOpenMenusExcept('eyedropper-loupe', 'open-eyedropper-loupe');
    eyedropperLoupe.classList.add('visible'); globalThis.BoardfishMotion?.applyActionAnimation?.('eyedropper-loupe-open');
    invalidateEyedropperLayoutMetrics(); layoutMetrics = null;
  }
  timings.showLoupe = performance.now() - visibleStart;
  const visibleAt = performance.now();
  const clickToPreviewVisibleMs = Number.isFinite(receivedAt) ? Math.max(0, visibleAt - receivedAt) : 0;
  const eventToPreviewVisibleMs = inputEventAgeMs(e, visibleAt);
  latency.clickToPreviewVisibleMs = Math.round(clickToPreviewVisibleMs * 100) / 100;
  latency.eventToPreviewVisibleMs = eventToPreviewVisibleMs == null ? '' : Math.round(eventToPreviewVisibleMs * 100) / 100;
  const positionStart = performance.now();
  layoutMetrics = positionEyedropperLoupe(e.clientX, e.clientY, layoutMetrics);
  BoardfishEyedropperCards.removePendingPinnedCardClone(eyedropperActiveCard);
  timings.position = performance.now() - positionStart;
  timings.total = performance.now() - totalStart;
  if (previewSample) previewSample.timings = timings;
  if (previewSample && EyedropperDebug.enabled) {
    const presentMeta = {
      clientX: e.clientX,
      clientY: e.clientY,
      firstSample: !!options.first,
      clickToPreviewVisibleMs: latency.clickToPreviewVisibleMs,
      eventToPreviewVisibleMs: latency.eventToPreviewVisibleMs,
      sampleMs: timings.total,
      inputAgeAtReceiveMs: latency.inputAgeAtReceiveMs,
      inputAgeAtCommitMs: latency.inputAgeAtCommitMs,
      queueDelayMs: latency.queueDelayMs,
      previewPainted: !!previewSample.painted,
      drawnImages: previewSample.drawnImages ?? '',
      drawnText: previewSample.drawnText ?? '',
      previewReadable: previewSample.previewDiagnostics?.readable ?? '',
      previewSuspectedBlank: previewSample.previewDiagnostics?.suspectedBlank ?? '',
    };
    requestAnimationFrame(() => {
      const frameAt = performance.now();
      const clickToPreviewFrameMs = Number.isFinite(receivedAt) ? Math.max(0, frameAt - receivedAt) : 0;
      const eventToPreviewFrameMs = inputEventAgeMs(e, frameAt);
      latency.clickToPreviewFrameMs = Math.round(clickToPreviewFrameMs * 100) / 100;
      latency.eventToPreviewFrameMs = eventToPreviewFrameMs == null ? '' : Math.round(eventToPreviewFrameMs * 100) / 100;
      EyedropperDebug._logPreviewPresent({
        ...presentMeta,
        clickToPreviewFrameMs: latency.clickToPreviewFrameMs,
        eventToPreviewFrameMs: latency.eventToPreviewFrameMs,
      });
    });
  }
  EyedropperDebug._logSample(e.clientX, e.clientY, previewSample, centerPixel, readoutSample);
  EyedropperDebug._recordSampleTiming(e.clientX, e.clientY, previewSample, timings);
  EyedropperDebug._logSamplingEvent('sample-commit-end', {
    clientX: e.clientX,
    clientY: e.clientY,
    firstSample: !!options.first,
    sampleMs: timings.total,
    paintMs: timings.paintPreview,
    readoutMs: timings.readout,
    readoutSource: readoutSample?.source || '',
    readoutReason: readoutSample?.reason || '',
    readoutNoUpdate: !!readoutSample?.noReadoutUpdate,
    readoutPixelPresent: !!centerPixel,
    readoutChanged: timings.readoutChanged,
    positionMs: timings.position,
    previewPainted: !!previewSample?.painted,
    drawnImages: previewSample?.drawnImages ?? '',
    readbackSafePendingImages: previewSample?.counters?.readbackSafePendingImages ?? '',
    missingImages: previewSample?.counters?.missingImages ?? '',
    ...latency,
  });
}

function updateEyedropperSample(e) {
  if (!eyedropperSampling || !e) return;
  EyedropperDebug._countPerf('sampleMoves');
  const pointerEvent = eyedropperPointerDebugEvent(e);
  _eyedropperLatestPointerEvent = pointerEvent;
  scheduleEyedropperSamplerDecode('sample-pointer');
  EyedropperDebug._logSamplingEvent('sample-move-received', {
    clientX: pointerEvent.clientX,
    clientY: pointerEvent.clientY,
    inputAgeAtReceiveMs: pointerEvent.inputAgeAtReceiveMs,
    sampleRafActive: !!_eyedropperSampleRaf,
    pendingCoalescedMoves: _eyedropperPendingSampleCoalesced,
  });
  if (_eyedropperSampleRaf) {
    _eyedropperPendingSampleCoalesced++;
    pointerEvent.coalescedMoves = _eyedropperPendingSampleCoalesced;
  }
  _eyedropperPendingSampleEvent = pointerEvent;
  _eyedropperLastSampleEvent = _eyedropperPendingSampleEvent;
  if (_eyedropperSampleRaf) {
    EyedropperDebug._countPerf('sampleCoalescedMoves');
    EyedropperDebug._logSamplingEvent('sample-raf-coalesced', {
      clientX: pointerEvent.clientX,
      clientY: pointerEvent.clientY,
      coalescedMoves: pointerEvent.coalescedMoves,
      pendingCoalescedMoves: _eyedropperPendingSampleCoalesced,
    });
    return;
  }
  EyedropperDebug._logSamplingEvent('sample-raf-scheduled', {
    clientX: pointerEvent.clientX,
    clientY: pointerEvent.clientY,
  });
  _eyedropperSampleRaf = requestAnimationFrame(() => {
    _eyedropperSampleRaf = null;
    const sampleEvent = _eyedropperPendingSampleEvent;
    _eyedropperPendingSampleEvent = null;
    _eyedropperPendingSampleCoalesced = 0;
    EyedropperDebug._logSamplingEvent('sample-raf-fired', {
      clientX: sampleEvent?.clientX ?? '',
      clientY: sampleEvent?.clientY ?? '',
      coalescedMoves: sampleEvent?.coalescedMoves ?? '',
    });
    if (sampleEvent) commitEyedropperSample(sampleEvent);
  });
}

function cancelPendingEyedropperSample() {
  if (_eyedropperSampleRaf) cancelAnimationFrame(_eyedropperSampleRaf);
  _eyedropperSampleRaf = null;
  _eyedropperPendingSampleEvent = null;
  _eyedropperPendingSampleCoalesced = 0;
}

function endEyedropperSample(e = null, options = {}) {
  const shouldPin = options.pin !== false;
  if (eyedropperSampling && e?.clientX != null && e?.clientY != null) {
    EyedropperDebug._logSamplingEvent('sample-end-with-pointer', {
      clientX: e.clientX,
      clientY: e.clientY,
      sampleRafActive: !!_eyedropperSampleRaf,
    });
    cancelPendingEyedropperSample();
    const pointerEvent = eyedropperPointerDebugEvent(e);
    _eyedropperLatestPointerEvent = pointerEvent;
    commitEyedropperSample(pointerEvent, { final: shouldPin });
    eyedropperSampling = false;
    finishEyedropperSampleCard(shouldPin);
    if (_eyedropperSnapshotDirtyAfterSample) {
      _eyedropperSnapshotDirtyAfterSample = false;
      markEyedropperSnapshotDirty();
    }
    return;
  } else {
    EyedropperDebug._logSamplingEvent('sample-end-cancel', {
      sampleRafActive: !!_eyedropperSampleRaf,
      pendingSampleEvent: !!_eyedropperPendingSampleEvent,
    });
    cancelPendingEyedropperSample();
  }
  eyedropperSampling = false;
  finishEyedropperSampleCard(shouldPin);
  if (_eyedropperSnapshotDirtyAfterSample) {
    _eyedropperSnapshotDirtyAfterSample = false;
    markEyedropperSnapshotDirty();
  }
}

function isEyedropperSampleVisible() {
  return !!eyedropperCard?.el?.classList.contains('visible');
}

function isEyedropperSamplePinned() {
  return !!(eyedropperActiveCard?.el?.classList.contains('visible') &&
    eyedropperActiveCard.el.classList.contains('pinned') &&
    !eyedropperSampling);
}

function hideEyedropperSample() {
  endEyedropperSample(null, { pin: false });
  _eyedropperLastSampleEvent = null;
  _eyedropperDragState = null;
  hideEyedropperCard(eyedropperActiveCard);
}

const shouldProcessEyedropperMoveEvent = (e) => {
  if (!e) return false;
  const now = performance.now();
  const eventType = String(e.type || '');
  if (eventType === 'pointermove') {
    indominaterGreedyEyedropperNativeDecodePrewarm.lastPointerMoveForDedupe = {
      clientX: e.clientX,
      clientY: e.clientY,
      timeStamp: Number(e.timeStamp) || 0,
      pointerType: e.pointerType || 'mouse',
      seenAt: now,
    };
    return true;
  }
  if (eventType !== 'mousemove') return true;
  const last = indominaterGreedyEyedropperNativeDecodePrewarm.lastPointerMoveForDedupe;
  if (!last) return true;
  const samePoint = last.clientX === e.clientX && last.clientY === e.clientY;
  const timeStamp = Number(e.timeStamp) || 0;
  const sameNativeEvent = samePoint && Math.abs(timeStamp - last.timeStamp) <= 1;
  const immediateCompatibilityEvent = samePoint && now - last.seenAt < 24;
  if (sameNativeEvent || immediateCompatibilityEvent) {
    EyedropperDebug._countPerf('duplicateMouseMovesSkipped');
    EyedropperDebug._logSamplingEvent('sample-mousemove-duplicate-skipped', {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: last.pointerType,
      inputAgeAtReceiveMs: inputEventAgeMs(e, now),
    });
    return false;
  }
  return true;
};

function noteEyedropperMouseEvent(e) {
  if (!e || e.clientX == null || e.clientY == null) return;
  _eyedropperLastMouseEvent = eyedropperPointerDebugEvent(e);
  scheduleEyedropperImageDecodeWarmup('pointer');
}

function isEventInsideVisibleEyedropperLoupe(e) {
  return !!(e?.target instanceof Node &&
    eyedropperCard?.el?.classList.contains('visible') &&
    eyedropperCard.el.contains(e.target));
}

function activatePinnedEyedropperCardInteraction(card, reason = 'pinned-card-interaction') {
  if (!isPinnedEyedropperCard(card) || eyedropperSampling) return false;
  useEyedropperCard(card);
  if (typeof activateInteractiveSurface === 'function') {
    activateInteractiveSurface({
      kind: 'pinned-eyedropper-card',
      reason,
      closeMenus: true,
      clearObjectSelection: false,
      exitTextEdit: false,
    });
  }
  return true;
}

function beginEyedropperHoldSample(e = null) {
  if (!eyedropperEnabled || _eyedropperHoldActive) return false;
  _eyedropperHoldActive = true; globalThis.BoardfishMotion?.applyActionAnimation?.('eyedropper-hold-start');
  document.body.classList.add('eyedropper-hold-active');
  eyedropperSampling = true;
  prepareEyedropperSamplingCard();
  const sourceEvent = e?.clientX != null && e?.clientY != null
    ? eyedropperPointerDebugEvent(e)
    : _eyedropperLastMouseEvent;
  if (!sourceEvent) return true;
  cancelEyedropperSnapshotRefresh();
  _eyedropperLatestPointerEvent = sourceEvent;
  scheduleEyedropperSamplerDecode('sample-start');
  EyedropperDebug._logSamplingEvent('initial-sample-start', {
    clientX: sourceEvent.clientX,
    clientY: sourceEvent.clientY,
    inputAgeAtReceiveMs: sourceEvent.inputAgeAtReceiveMs,
  });
  commitEyedropperSample(sourceEvent, { first: true });
  return true;
}

function endEyedropperHoldSample(e = null) {
  if (!_eyedropperHoldActive) return false;
  _eyedropperHoldActive = false; globalThis.BoardfishMotion?.applyActionAnimation?.('eyedropper-hold-end');
  document.body.classList.remove('eyedropper-hold-active');
  if (eyedropperSampling && e?.clientX != null && e?.clientY != null) noteEyedropperMouseEvent(e);
  endEyedropperSample(_eyedropperLastMouseEvent);
  setEyedropperEnabled(false, { keepSample: true });
  return true;
}

function updateEyedropperHoldSample(e) {
  if (!shouldProcessEyedropperMoveEvent(e)) return;
  noteEyedropperMouseEvent(e);
  if (!_eyedropperHoldActive || !eyedropperEnabled) return;
  if (e && e.shiftKey === false) {
    endEyedropperHoldSample(e);
    return;
  }
  globalThis.BoardfishMotion?.applyActionAnimation?.('eyedropper-hover'); updateEyedropperSample(e);
}

function dragEyedropperLoupeTo(clientX, clientY) {
  const card = _eyedropperDragState?.card || eyedropperActiveCard;
  if (!_eyedropperDragState || !card?.el) return;
  applyEyedropperCardPosition(
    card,
    _eyedropperDragState.startLeft + clientX - _eyedropperDragState.startX,
    _eyedropperDragState.startTop + clientY - _eyedropperDragState.startY,
  );
}

function startEyedropperLoupeDrag(e, card = eyedropperActiveCard) {
  if (!card?.el?.classList.contains('pinned') || eyedropperSampling || e.button !== 0) return false;
  useEyedropperCard(card);
  const rect = card.el.getBoundingClientRect();
  _eyedropperDragState = {
    card,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startLeft: rect.left,
    startTop: rect.top,
  };
  card.el.classList.add('dragging'); globalThis.BoardfishMotion?.applyActionAnimation?.('eyedropper-loupe-drag');
  card.el.setPointerCapture?.(e.pointerId);
  return true;
}

function endEyedropperLoupeDrag(e, commit = true) {
  if (!_eyedropperDragState || _eyedropperDragState.pointerId !== e.pointerId) return false;
  const card = _eyedropperDragState.card || eyedropperActiveCard;
  if (commit) dragEyedropperLoupeTo(e.clientX, e.clientY);
  card?.el?.releasePointerCapture?.(e.pointerId);
  card?.el?.classList.remove('dragging');
  _eyedropperDragState = null;
  return true;
}

function bindEyedropperCardEvents(card) {
  if (!card || card.bound) return;
  card.bound = true;
  card.el.addEventListener('pointerdown', (e) => {
    const eventCard = eyedropperCardFromEvent(e) || card;
    useEyedropperCard(eventCard);
    activatePinnedEyedropperCardInteraction(eventCard, 'eyedropper-card:pointerdown');
    if (startEyedropperLoupeDrag(e, eventCard)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    e.stopPropagation();
  });
  card.el.addEventListener('pointermove', (e) => {
    if (!_eyedropperDragState || _eyedropperDragState.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    dragEyedropperLoupeTo(e.clientX, e.clientY);
  });
  card.el.addEventListener('pointerup', (e) => {
    if (!endEyedropperLoupeDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
  });
  card.el.addEventListener('pointercancel', (e) => {
    if (!endEyedropperLoupeDrag(e, false)) return;
    e.preventDefault();
    e.stopPropagation();
  });
  card.el.addEventListener('mousedown', (e) => {
    const eventCard = eyedropperCardFromEvent(e) || card;
    useEyedropperCard(eventCard);
    activatePinnedEyedropperCardInteraction(eventCard, 'eyedropper-card:mousedown');
    e.preventDefault();
    if (isEyedropperSamplePinned() && e.button === 0) e.stopImmediatePropagation();
    else e.stopPropagation();
  });
  card.el.addEventListener('contextmenu', (e) => {
    const eventCard = eyedropperCardFromEvent(e) || card;
    e.preventDefault();
    e.stopImmediatePropagation();
    activatePinnedEyedropperCardInteraction(eventCard, 'eyedropper-card:contextmenu');
    if (!eyedropperSampling && isPinnedEyedropperCard(eventCard)) closeEyedropperCard(eventCard);
  });
  card.el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

ensureEyedropperCard();

document.addEventListener('pointermove', updateEyedropperHoldSample, true);
document.addEventListener('mousemove', updateEyedropperHoldSample, true);
