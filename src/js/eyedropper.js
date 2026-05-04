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
globalThis.objectContainsWorldPoint = EyedropperGeometry.objectContainsWorldPoint;
globalThis.screenToBoardWorldPoint = EyedropperGeometry.screenToBoardWorldPoint;
globalThis.topObjectAtWorldPoint = EyedropperGeometry.topObjectAtWorldPoint;
globalThis.worldPointToImageLocalUnit = EyedropperGeometry.worldPointToImageLocalUnit;

function cssPx(value) {
  const px = Number.parseFloat(value);
  return Number.isFinite(px) ? px : 0;
}

function eyedropperLoupeCssWidth(style = eyedropperLoupe ? getComputedStyle(eyedropperLoupe) : null) {
  if (!style) return 0;
  return cssPx(style.width) || cssPx(style.getPropertyValue('--eyedropper-loupe-width'));
}

function eyedropperPreviewCssSize() {
  const rect = eyedropperPreview?.getBoundingClientRect();
  if (rect?.width > 0) return rect.width;

  const style = eyedropperLoupe ? getComputedStyle(eyedropperLoupe) : null;
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
  return Math.max(1, Math.round(eyedropperPreviewCssSize() * dpr));
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
  if (eyedropperWallpaperCanRead === false) {
    out.readError = 'wallpaper-readback-unsafe';
    out.suspectedBlank = !previewSample?.painted ||
      (!previewSample?.drawnImages && !previewSample?.drawnText && !!expectedPixel);
    return out;
  }
  if (previewSample?.readbackUnsafe) {
    out.readError = 'preview-readback-unsafe';
    out.suspectedBlank = !previewSample?.painted ||
      (!previewSample?.drawnImages && !previewSample?.drawnText && !!expectedPixel);
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
    out.suspectedBlank = !previewSample?.painted ||
      (!previewSample?.drawnImages && !previewSample?.drawnText && !!expectedPixel);
  }
  return out;
}

function setEyedropperPreviewDiagnosticsEnabled(enabled) {
  _eyedropperPreviewDiagnosticsEnabled = !!enabled;
}

// EyedropperDebug is initialized by js/eyedropper_debug.js.

function setEyedropperEnabled(enabled) {
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
      'pointerdown:0',
      'pointermove',
      'pointerup:0',
      'mousedown:0',
      'mousemove',
      'mouseup:0',
      'contextmenu',
      'wheel',
      'key:escape',
      'key:i',
      'key:o',
      'key:s',
      'code:keyo',
      'code:keys',
      'code:space',
      { visual: false, allowBoardNavigation: true },
    );
  } else if (!eyedropperEnabled && _eyedropperShieldRelease) {
    _eyedropperShieldRelease();
    _eyedropperShieldRelease = null;
  }
  recordPhase('shield', phaseStart);

  phaseStart = performance.now();
  if (eyedropperMenuBtn) eyedropperMenuBtn.setAttribute('aria-pressed', eyedropperEnabled ? 'true' : 'false');
  recordPhase('button', phaseStart);

  phaseStart = performance.now();
  document.body.classList.toggle('eyedropper-enabled', eyedropperEnabled);
  recordPhase('bodyClass', phaseStart);

  phaseStart = performance.now();
  updateEyedropperCommandState();
  recordPhase('commandState', phaseStart);

  phaseStart = performance.now();
  if (typeof updateCtxMenuActions === 'function') updateCtxMenuActions();
  recordPhase('ctxActions', phaseStart);

  if (eyedropperEnabled) {
    phaseStart = performance.now();
    recordPhase('prewarmSchedule', phaseStart);
  } else {
    phaseStart = performance.now();
    hideEyedropperSample();
    recordPhase('hideSample', phaseStart);
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

function isCommandBlockedByEyedropper(commandId) {
  return eyedropperEnabled && ['btn-add-text', 'btn-add-image', 'btn-paste'].includes(commandId);
}

function updateEyedropperCommandState() {
  const creationGroupTrailingSep = pasteBtn?.nextElementSibling?.classList?.contains('ctx-sep')
    ? pasteBtn.nextElementSibling
    : null;
  for (const button of [addTextBtn, addImageBtn, pasteBtn]) {
    if (!button) continue;
    button.disabled = eyedropperEnabled;
    button.setAttribute('aria-disabled', eyedropperEnabled ? 'true' : 'false');
    button.style.display = eyedropperEnabled ? 'none' : '';
  }
  if (creationGroupTrailingSep) creationGroupTrailingSep.style.display = eyedropperEnabled ? 'none' : '';
}

function resetEyedropperWallpaper() {
  eyedropperWallpaperReady = false;
  eyedropperWallpaperCanRead = null;
  eyedropperZoomWallpaperReady = false;
  _eyedropperSnapshotDirty = false;
  _eyedropperSnapshotDirtyAfterSample = false;
  _eyedropperNavigationBlockUntil = 0;
  if (_eyedropperNavigationBlockTimer) clearTimeout(_eyedropperNavigationBlockTimer);
  _eyedropperNavigationBlockTimer = null;
  if (eyedropperWallpaperCanvas) {
    eyedropperWallpaperCanvas.width = 1;
    eyedropperWallpaperCanvas.height = 1;
  }
  if (eyedropperZoomWallpaperCanvas) {
    eyedropperZoomWallpaperCanvas.width = 1;
    eyedropperZoomWallpaperCanvas.height = 1;
  }
}

function eyedropperSnapshotCanvasSize(scale = 1) {
  if (!boardCanvas) return null;
  return {
    width: Math.max(1, Math.round(boardCanvas.width * scale)),
    height: Math.max(1, Math.round(boardCanvas.height * scale)),
  };
}

function eyedropperSnapshotView(scale = 1) {
  const dpr = window.devicePixelRatio || 1;
  return {
    zoom: Math.max(zoom || 1, 0.0001) * scale,
    panX: panX * scale,
    panY: panY * scale,
    dpr,
  };
}

function renderEyedropperSnapshot(targetCanvas, targetCtx, scale = 1) {
  const size = eyedropperSnapshotCanvasSize(scale);
  if (!size || !targetCanvas || !targetCtx) return null;
  const view = eyedropperSnapshotView(scale);
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const previousViewportCullingEnabled = typeof viewportCullingEnabled !== 'undefined'
    ? viewportCullingEnabled
    : null;
  try {
    targetCanvas.width = size.width;
    targetCanvas.height = size.height;
    resetCanvasToScreen(targetCtx);
    fillBoardBackground(targetCtx, size.width, size.height);
    setWorldCanvasTransform(targetCtx, view.dpr, view);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = true;
    const drawn = drawVisibleObjects(targetCtx, counters, {
      viewportRect: currentViewportWorldRect(EYEDROPPER_PREWARM_PAD_CSS),
      view,
      imageSourceResolver: selectEyedropperSafeImageSourceForDraw,
    });
    resetCanvasToScreen(targetCtx);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = false;
    return {
      width: size.width,
      height: size.height,
      counters,
      drawnImages: drawn?.drawnImages || 0,
      drawnText: drawn?.drawnText || 0,
      pendingImages: counters.readbackSafePendingImages || 0,
      missingImages: counters.missingImages || 0,
    };
  } catch (err) {
    resetCanvasToScreen(targetCtx);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = false;
    EyedropperDebug._logReadbackFailure('eyedropper-snapshot-render', {
      scale,
      width: size.width,
      height: size.height,
      error: String(err),
    });
    return null;
  }
}

function captureEyedropperReadbackWallpaper() {
  if (!boardCanvas || !eyedropperWallpaperCtx) {
    resetEyedropperWallpaper();
    return false;
  }
  const normal = renderEyedropperSnapshot(eyedropperWallpaperCanvas, eyedropperWallpaperCtx, 1);
  if (!normal) {
    resetEyedropperWallpaper();
    return false;
  }
  eyedropperWallpaperReady = true;
  eyedropperWallpaperCanRead = null;
  _eyedropperSnapshotDirty = false;
  return true;
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
    eyedropperZoomWallpaperCanvas.width = size;
    eyedropperZoomWallpaperCanvas.height = size;
    resetCanvasToScreen(eyedropperZoomWallpaperCtx);
    fillBoardBackground(eyedropperZoomWallpaperCtx, size, size);
    setWorldCanvasTransform(eyedropperZoomWallpaperCtx, geometry.view.dpr, geometry.view);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = true;
    const drawn = drawVisibleObjects(eyedropperZoomWallpaperCtx, counters, {
      viewportRect: geometry.viewportRect,
      view: geometry.view,
      imageSourceResolver: selectEyedropperPreviewImageSourceForDraw,
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

function captureEyedropperWallpaper(options = {}) {
  const readbackReady = captureEyedropperReadbackWallpaper();
  if (!readbackReady) return false;
  if (options.includeZoom === true) return false;
  eyedropperZoomWallpaperReady = false;
  return true;
}

function markEyedropperSnapshotDirty() {
  _eyedropperSnapshotDirty = true;
  eyedropperWallpaperReady = false;
  eyedropperZoomWallpaperReady = false;
  eyedropperWallpaperCanRead = null;
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
  const margin = 18;
  const gap = 22;
  const rect = eyedropperLoupe.getBoundingClientRect();
  const previewRect = eyedropperPreview?.getBoundingClientRect();
  const width = rect.width || eyedropperLoupeCssWidth();
  const height = rect.height || EYEDROPPER_MENU_CSS_HEIGHT;
  const previewHeight = previewRect?.height || width;
  const previewTopOffset = previewRect?.height ? previewRect.top - rect.top : 0;
  const rightSideLeft = clientX + gap;
  const leftSideLeft = clientX - width - gap;
  const unclampedTop = clientY - previewTopOffset - (previewHeight / 2);
  if (_eyedropperLoupeHorizontalSide === 'right') {
    if (rightSideLeft + width + margin > window.innerWidth) {
      _eyedropperLoupeHorizontalSide = 'left';
    }
  } else if (leftSideLeft < margin) {
    _eyedropperLoupeHorizontalSide = 'right';
  }
  let left = _eyedropperLoupeHorizontalSide === 'left' ? leftSideLeft : rightSideLeft;
  left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
  const top = Math.max(margin, Math.min(window.innerHeight - height - margin, unclampedTop));
  eyedropperLoupe.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
}

function updateEyedropperColorReadout(pixel) {
  const cssColor = rgbaToCss(pixel);
  if (eyedropperSwatch) eyedropperSwatch.style.background = cssColor;
  if (eyedropperHex) eyedropperHex.textContent = rgbaToHex(pixel);
  if (eyedropperRgb) eyedropperRgb.textContent = rgbaToRgbText(pixel);
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

function sampleEyedropperWallpaperPixel(sourceX, sourceY) {
  if (!eyedropperWallpaperCtx || eyedropperWallpaperCanRead === false) return null;
  const pixel = sampleCanvasPixel(eyedropperWallpaperCtx, sourceX, sourceY, {
    where: 'eyedropper-wallpaper-readout',
    source: 'sampleEyedropperReadoutPixel',
    logFailures: false,
  });
  eyedropperWallpaperCanRead = !!pixel;
  if (!pixel) {
    EyedropperDebug._logReadbackFailure('eyedropper-wallpaper-readout', {
      x: sourceX,
      y: sourceY,
      width: eyedropperWallpaperCanvas?.width ?? '',
      height: eyedropperWallpaperCanvas?.height ?? '',
      reason: 'canvas-tainted-or-unreadable',
    });
  }
  return pixel;
}

function renderEyedropperLocalReadoutPixel(clientX, clientY) {
  if (!eyedropperReadoutCtx || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const dpr = window.devicePixelRatio || 1;
  const cssSize = 1 / Math.max(dpr, 1);
  const z = Math.max(zoom || 1, 0.0001);
  const view = {
    zoom: z,
    panX: panX - clientX,
    panY: panY - clientY,
    dpr,
  };
  const viewportRect = {
    x1: (clientX - panX) / z,
    y1: (clientY - panY) / z,
    x2: (clientX + cssSize - panX) / z,
    y2: (clientY + cssSize - panY) / z,
  };
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const previousViewportCullingEnabled = typeof viewportCullingEnabled !== 'undefined'
    ? viewportCullingEnabled
    : null;
  try {
    eyedropperReadoutCanvas.width = 1;
    eyedropperReadoutCanvas.height = 1;
    resetCanvasToScreen(eyedropperReadoutCtx);
    eyedropperReadoutCtx.fillStyle = rgbaToCss(boardBackgroundPixel());
    eyedropperReadoutCtx.fillRect(0, 0, 1, 1);
    setWorldCanvasTransform(eyedropperReadoutCtx, dpr, view);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = true;
    drawVisibleObjects(eyedropperReadoutCtx, counters, {
      viewportRect,
      view,
      imageSourceResolver: selectEyedropperSafeImageSourceForDraw,
    });
    resetCanvasToScreen(eyedropperReadoutCtx);
    if (previousViewportCullingEnabled === false) viewportCullingEnabled = false;
    const pixel = sampleCanvasPixel(eyedropperReadoutCtx, 0, 0, {
      where: 'eyedropper-local-readout',
      source: 'sampleEyedropperReadoutPixel',
      logFailures: false,
    });
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

function removeEyedropperSafePixelCache(key) {
  const existing = eyedropperSafePixelCache.get(key);
  if (!existing) return;
  eyedropperSafePixelCacheBytes -= existing.bytes || existing.data?.byteLength || 0;
  eyedropperSafePixelCache.delete(key);
  eyedropperSafePixelCacheBytes = Math.max(0, eyedropperSafePixelCacheBytes);
}

function trimEyedropperSafePixelCache(protectedKey = '') {
  while (eyedropperSafePixelCacheBytes > EYEDROPPER_SAFE_PIXEL_MEMORY_LIMIT && eyedropperSafePixelCache.size > 1) {
    let oldestKey = '';
    let oldestUse = Number.POSITIVE_INFINITY;
    for (const [key, entry] of eyedropperSafePixelCache.entries()) {
      if (key === protectedKey) continue;
      const lastUsed = entry?.lastUsed || 0;
      if (lastUsed < oldestUse) {
        oldestUse = lastUsed;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    removeEyedropperSafePixelCache(oldestKey);
  }
}

function scheduleEyedropperSafePixelCache(key, token, source) {
  const { width, height } = imageSourceSize(source);
  if (!key || !token || !isDrawableImageSource(source) || width <= 0 || height <= 0) return;
  const existing = eyedropperSafePixelCache.get(key);
  if (existing?.token === token) return;
  if (eyedropperSafePixelCachePending.has(key)) return;
  eyedropperSafePixelCachePending.add(key);
  scheduleIdleTask(() => {
    eyedropperSafePixelCachePending.delete(key);
    const latest = eyedropperSafeImageCache.get(key);
    if (latest?.token !== token || latest.source !== source || latest.sourceKind !== 'data-url') return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const pixelCtx = canvas.getContext('2d', { willReadFrequently: true });
      if (!pixelCtx) return;
      pixelCtx.drawImage(source, 0, 0, width, height);
      const imageData = pixelCtx.getImageData(0, 0, width, height);
      removeEyedropperSafePixelCache(key);
      const bytes = imageData.data.byteLength;
      eyedropperSafePixelCache.set(key, {
        token,
        width,
        height,
        data: imageData.data,
        bytes,
        lastUsed: eyedropperSafePixelCacheUseCounter++,
      });
      eyedropperSafePixelCacheBytes += bytes;
      trimEyedropperSafePixelCache(key);
    } catch (err) {
      EyedropperDebug._logReadbackFailure('safe-pixel-cache-build', {
        imgKey: key,
        width,
        height,
        error: String(err),
      });
    }
  });
}

function sampleEyedropperSafePixelCache(key, token, sourceX, sourceY) {
  const cached = eyedropperSafePixelCache.get(key);
  if (!cached || cached.token !== token) return null;
  cached.lastUsed = eyedropperSafePixelCacheUseCounter++;
  const x = Math.max(0, Math.min(cached.width - 1, Math.floor(sourceX)));
  const y = Math.max(0, Math.min(cached.height - 1, Math.floor(sourceY)));
  const index = (y * cached.width + x) * 4;
  const data = cached.data;
  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
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
  let cached = eyedropperSafeTileCache.get(cacheKey);
  if (!cached || cached.token !== token) {
    cached = buildEyedropperSafeTileCache(key, token, source, sourceX, sourceY, options);
  }
  if (!cached || cached.token !== token) return null;
  cached.lastUsed = eyedropperSafeTileCacheUseCounter++;
  const localX = Math.max(0, Math.min(cached.width - 1, x - cached.tileX));
  const localY = Math.max(0, Math.min(cached.height - 1, y - cached.tileY));
  const index = (localY * cached.width + localX) * 4;
  const data = cached.data;
  return {
    pixel: [data[index], data[index + 1], data[index + 2], data[index + 3]],
    tile: cached,
    sourceX: x,
    sourceY: y,
  };
}

function sampleEyedropperCachedPixelAt(clientX, clientY) {
  const point = clientToBoardWorldPoint(clientX, clientY);
  const topObject = topObjectAtWorldPoint(point);
  if (!topObject) {
    return {
      pixel: boardBackgroundPixel(),
      source: 'background',
      reason: 'empty-board',
      objectId: '',
      objectType: '',
      layers: [],
    };
  }
  if (topObject.type !== 'image') return null;
  const key = topObject.data?.imgKey;
  const local = worldPointToImageLocalUnit(topObject, point);
  const cached = key ? eyedropperSafePixelCache.get(key) : null;
  const safeEntry = key ? eyedropperSafeImageCache.get(key) : null;
  const token = safeEntry?.token || (key ? eyedropperSafeImageToken(key) : '');
  if (!key || !local || !token) return null;
  let sourceW = cached?.width || 0;
  let sourceH = cached?.height || 0;
  let sourceX = local.u * Math.max(0, sourceW - 1);
  let sourceY = local.v * Math.max(0, sourceH - 1);
  let pixel = cached?.token === token ? sampleEyedropperSafePixelCache(key, token, sourceX, sourceY) : null;
  if (!pixel) {
    if (safeEntry?.token === token && isDrawableImageSource(safeEntry.source)) {
      const size = imageSourceSize(safeEntry.source);
      sourceW = size.width;
      sourceH = size.height;
      sourceX = local.u * Math.max(0, sourceW - 1);
      sourceY = local.v * Math.max(0, sourceH - 1);
      const tileSample = sampleEyedropperSafeTileCache(key, token, safeEntry.source, sourceX, sourceY);
      pixel = tileSample?.pixel || null;
      sourceX = tileSample?.sourceX ?? sourceX;
      sourceY = tileSample?.sourceY ?? sourceY;
    } else {
      resolveEyedropperSafeImageSource(key);
      return null;
    }
  }
  if (!pixel) return null;
  return {
    pixel,
    source: 'pixel-cache',
    reason: cached?.token === token ? 'cached-image-pixel' : 'cached-image-tile',
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

function sampleDisplayedBoardPixel(clientX, clientY) {
  return displayedBoardPixelSampleInfo(clientX, clientY).pixel;
}

function eyedropperWallpaperSourcePoint(clientX, clientY) {
  return displayedBoardSourcePoint(clientX, clientY, eyedropperWallpaperCanvas);
}

function eyedropperZoomWallpaperSourcePoint(clientX, clientY) {
  return displayedBoardSourcePoint(clientX, clientY, eyedropperZoomWallpaperCanvas);
}

function sampleEyedropperReadoutPixel(clientX, clientY, previewSample = null) {
  const cachedPixel = sampleEyedropperCachedPixelAt(clientX, clientY);
  if (cachedPixel) return cachedPixel;
  if (previewSample?.painted && previewSample.centerX != null && previewSample.centerY != null && !previewSample.readbackUnsafe) {
    const previewPixel = sampleCanvasPixel(eyedropperRenderedSampleCtx, previewSample.centerX, previewSample.centerY, {
      where: 'zoomed-preview-center-readout',
      source: 'sampleEyedropperReadoutPixel',
      logFailures: false,
    });
    if (previewPixel) {
      previewSample.pixel = previewPixel;
      return {
        pixel: previewPixel,
        source: 'preview-center',
        reason: 'rendered-preview-center',
        objectId: '',
        objectType: '',
        sourceX: previewSample.centerX,
        sourceY: previewSample.centerY,
        sourceW: eyedropperRenderedSampleCanvas?.width || '',
        sourceH: eyedropperRenderedSampleCanvas?.height || '',
        inBounds: true,
        counters: previewSample.counters || {},
        layers: [],
      };
    }
  }
  const local = renderEyedropperLocalReadoutPixel(clientX, clientY);
  if (!local) {
    return {
      pixel: previewSample?.pixel || boardBackgroundPixel(),
      source: 'background',
      reason: 'local-readout-failed',
      objectId: '',
      objectType: '',
      layers: [],
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

  eyedropperCtx.save();
  eyedropperCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperCtx.beginPath();
  eyedropperCtx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  eyedropperCtx.fillStyle = 'rgba(0,0,0,0.9)';
  eyedropperCtx.fill();
  eyedropperCtx.beginPath();
  eyedropperCtx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  eyedropperCtx.fillStyle = 'rgba(255,255,255,1)';
  eyedropperCtx.fill();
  eyedropperCtx.restore();
}

function resetEyedropperRenderedSampleSize(width, height) {
  eyedropperRenderedSampleCanvas.width = width;
  eyedropperRenderedSampleCanvas.height = height;
}

function refreshEyedropperAfterSafeImageReady() {
  if (!eyedropperEnabled) return;
  scheduleEyedropperSnapshotRefresh('safe-image-ready', { delayMs: 40 });
  if (eyedropperSampling && _eyedropperLastSampleEvent) updateEyedropperSample(_eyedropperLastSampleEvent);
}

function refreshEyedropperViewportAfterSafeImageReady() {
  if (!eyedropperEnabled) return;
  scheduleEyedropperSnapshotRefresh('safe-image-ready', { delayMs: 40 });
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

function clearEyedropperSafeImageCache() {
  for (const entry of eyedropperSafeImageCache.values()) closeEyedropperSafeImageEntry(entry);
  eyedropperSafeScaledBitmapStore.clear();
  eyedropperSafeImageCache.clear();
  eyedropperSafeImagePromises.clear();
  eyedropperSafeDisplayReloadPromises.clear();
  eyedropperSafeScaledBitmapPending.clear();
  eyedropperSafeScaledBitmapPendingBytes.clear();
  eyedropperSafePixelCache.clear();
  eyedropperSafePixelCachePending.clear();
  eyedropperSafePixelCacheBytes = 0;
  eyedropperSafeTileCache.clear();
  eyedropperSafeTileCachePending.clear();
  eyedropperSafeTileCacheBytes = 0;
  eyedropperSafeDisplayProbeFailures.clear();
  eyedropperNativeSourceSkipLogged.clear();
}

function storeEyedropperSafeImage(key, token, source, options = {}) {
  const existing = eyedropperSafeImageCache.get(key);
  if (existing && existing.token !== token) {
    closeEyedropperSafeImageEntry(existing);
    closeEyedropperSafeScaledImages(key);
    removeEyedropperSafePixelCache(key);
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
    eyedropperReadbackProbeCanvas.width = 1;
    eyedropperReadbackProbeCanvas.height = 1;
    eyedropperReadbackProbeCtx.setTransform(1, 0, 0, 1, 0, 0);
    eyedropperReadbackProbeCtx.clearRect(0, 0, 1, 1);
    eyedropperReadbackProbeCtx.drawImage(source, 0, 0, 1, 1);
    eyedropperReadbackProbeCtx.getImageData(0, 0, 1, 1);
    return true;
  } catch (err) {
    eyedropperReadbackProbeCanvas.width = 1;
    eyedropperReadbackProbeCanvas.height = 1;
    countEyedropperCounter(counters, 'safeDisplayProbeFailures');
    rememberEyedropperUnsafeDisplaySource(key, token, sourceKind, err);
    return false;
  }
}

function resolveEyedropperDisplayCacheSource(key, token, counters = null) {
  if (isNativeImageRef(imageStore[key])) return null;
  if (imageAssetUrlCache[key]) return null;

  const displayImg = imageCache[key];
  if (isDrawableImageSource(displayImg) && isEyedropperReadbackSafeDisplaySource(key, token, displayImg, 'imageCache', counters)) {
    storeEyedropperSafeImage(key, token, displayImg, { owned: false, sourceKind: 'display-cache' });
    countEyedropperCounter(counters, 'safeDisplayImages');
    return displayImg;
  }
  return null;
}

function resolveEyedropperCorsDisplaySource(key, token, counters = null) {
  const assetSrc = imageAssetUrlCache[key];
  if (!assetSrc || typeof loadImageElement !== 'function') return null;

  const cached = eyedropperSafeImageCache.get(key);
  if (cached?.token === token && cached.sourceKind === 'display-cors' && isDrawableImageSource(cached.source)) {
    countEyedropperCounter(counters, 'safeDisplayCorsImages');
    return cached.source;
  }

  if (eyedropperSafeDisplayReloadPromises.has(key)) {
    countEyedropperCounter(counters, 'readbackSafePendingImages');
    countEyedropperCounter(counters, 'safeDisplayCorsPending');
    return null;
  }

  const promise = loadImageElement(assetSrc, { crossOrigin: 'anonymous' })
    .then((img) => {
      storeEyedropperSafeImage(key, token, img, { owned: false, sourceKind: 'display-cors' });
      EyedropperDebug._count('safeDisplayCorsLoads');
      refreshEyedropperAfterSafeImageReady();
      refreshEyedropperViewportAfterSafeImageReady();
      return img;
    })
    .catch((err) => {
      countEyedropperCounter(counters, 'safeDisplayCorsFailures');
      EyedropperDebug._logUnsafeImageSkip({
        where: 'display-cors-reload',
        imgKey: key,
        cacheSource: 'display-cors',
        reason: 'display-cors-load-failed',
        error: String(err),
      });
      return null;
    })
    .finally(() => eyedropperSafeDisplayReloadPromises.delete(key));

  eyedropperSafeDisplayReloadPromises.set(key, promise);
  countEyedropperCounter(counters, 'readbackSafePendingImages');
  countEyedropperCounter(counters, 'safeDisplayCorsPending');
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

  const promise = ensureImageDataUrl(key)
    .then((dataUrl) => {
      if (!dataUrl) return null;
      const dataToken = eyedropperSafeImageToken(key, dataUrl);
      const latest = eyedropperSafeImageCache.get(key);
      if (latest?.token === dataToken && isDrawableImageSource(latest.source)) return latest.source;
      return loadImageElement(dataUrl)
        .then(async (img) => {
          let source = img;
          if (typeof createImageBitmap === 'function') {
            try {
              source = await createImageBitmap(img);
            } catch (_) {}
          }
          storeEyedropperSafeImage(key, dataToken, source, { owned: source !== img, sourceKind: 'data-url' });
          EyedropperDebug._count('safeDataUrlLoads');
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
    .finally(() => eyedropperSafeImagePromises.delete(key));

  eyedropperSafeImagePromises.set(key, promise);
  countEyedropperCounter(counters, 'readbackSafePendingImages');
  countEyedropperCounter(counters, 'safeDataUrlPending');
  return null;
}

function countEyedropperSafeSourceUse(entry, counters = null) {
  if (!entry) return;
  if (entry.sourceKind === 'display-cache') countEyedropperCounter(counters, 'safeDisplayImages');
  else if (entry.sourceKind === 'display-cors') countEyedropperCounter(counters, 'safeDisplayCorsImages');
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

  const promise = Promise.resolve(stored)
    .then((dataUrl) => {
      if (!dataUrl) return null;
      const dataToken = eyedropperSafeImageToken(key, dataUrl);
      const latest = eyedropperSafeImageCache.get(key);
      if (latest?.token === dataToken && isDrawableImageSource(latest.source)) return latest.source;
      return loadImageElement(dataUrl)
        .then(async (img) => {
          let source = img;
          if (typeof createImageBitmap === 'function') {
            try {
              source = await createImageBitmap(img);
            } catch (_) {}
          }
          storeEyedropperSafeImage(key, dataToken, source, { owned: source !== img, sourceKind: 'data-url' });
          EyedropperDebug._count('safeDataUrlLoads');
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
    .finally(() => eyedropperSafeImagePromises.delete(key));

  eyedropperSafeImagePromises.set(key, promise);
  countEyedropperCounter(counters, 'readbackSafePendingImages');
  countEyedropperCounter(counters, 'safeDataUrlPending');
  return null;
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

function getEyedropperSafeScaledMap(key) {
  return eyedropperSafeScaledBitmapStore.getGroup(key);
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
  const map = getEyedropperSafeScaledMap(key);
  if (map.has(scale) || eyedropperSafeScaledBitmapPending.has(pendingKey)) return;
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
  const fullSource = resolveEyedropperSafeImageSource(key, counters);
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

function selectEyedropperPreviewImageSourceForDraw(key, obj, view, counters = null) {
  const cached = eyedropperSafeImageCache.get(key);
  if (cached?.token && isDrawableImageSource(cached.source)) {
    countEyedropperSafeSourceUse(cached, counters);
    const decision = eyedropperSafeScaleDecision(obj, cached.source, view);
    return {
      source: cached.source,
      scale: 1,
      targetScale: decision.targetScale,
      readbackSafe: true,
    };
  }

  const fallbackSource = imageBitmapCache[key] || imageCache[key] || null;
  if (!isDrawableImageSource(fallbackSource)) {
    resolveEyedropperSafeImageSource(key, counters);
    return null;
  }

  if (counters) counters.previewUnsafeImages = (counters.previewUnsafeImages || 0) + 1;
  return {
    source: fallbackSource,
    scale: 1,
    targetScale: 1,
    readbackSafe: false,
    visualFallback: true,
  };
}

function selectEyedropperWarmedScaledImageForViewport(key, targetScale) {
  if (!key || !(targetScale < 1)) return null;
  const map = eyedropperSafeScaledBitmapCache.get(key);
  if (!map) return null;
  const scaleLevels = Array.isArray(IMAGE_SCALE_LEVELS) ? IMAGE_SCALE_LEVELS : [];
  const availableScale = scaleLevels
    .filter((scale) => scale >= targetScale && map.has(scale))
    .reduce((best, scale) => Math.min(best, scale), 1);
  if (!(availableScale < 1)) return null;
  const entry = eyedropperSafeScaledBitmapStore.get(key, availableScale);
  const bitmap = entry?.bitmap;
  if (!isDrawableImageSource(bitmap)) return null;
  return { source: bitmap, scale: availableScale, targetScale, readbackSafe: true, warmedEyedropper: true };
}

function eyedropperPrewarmRect(clientX, clientY, padCss = EYEDROPPER_PREWARM_PAD_CSS) {
  const a = clientToBoardWorldPoint(clientX - padCss, clientY - padCss);
  const b = clientToBoardWorldPoint(clientX + padCss, clientY + padCss);
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  };
}

function distanceSqToObject(point, obj) {
  const cx = Math.max(obj.x, Math.min(obj.x + obj.w, point.x));
  const cy = Math.max(obj.y, Math.min(obj.y + obj.h, point.y));
  const dx = point.x - cx;
  const dy = point.y - cy;
  return dx * dx + dy * dy;
}

function collectEyedropperPrewarmCandidates(point, rect, limit) {
  return objects
    .filter(obj => obj?.type === 'image' && obj.data?.imgKey && objectIntersectsRect(obj, rect))
    .map(obj => ({ obj, distanceSq: distanceSqToObject(point, obj) }))
    .sort((a, b) => a.distanceSq - b.distanceSq)
    .slice(0, limit);
}

function eyedropperPreviewScaleView() {
  const dpr = window.devicePixelRatio || 1;
  return {
    zoom: Math.max(zoom || 1, 0.0001) * EYEDROPPER_PREVIEW_ZOOM_SCALE,
    panX: 0,
    panY: 0,
    dpr,
  };
}

function eyedropperViewportScaleView() {
  const dpr = window.devicePixelRatio || 1;
  return {
    zoom: Math.max(zoom || 1, 0.0001),
    panX,
    panY,
    dpr,
  };
}

function runEyedropperPrewarmCandidates(candidates, view, counters) {
  const rows = [];
  let ready = 0;
  for (const { obj, distanceSq } of candidates) {
    const key = obj.data.imgKey;
    const beforePending = eyedropperSafeImagePromises.has(key) || eyedropperSafeDisplayReloadPromises.has(key);
    const selected = selectEyedropperSafeImageSourceForDraw(key, obj, view, counters);
    const cacheEntry = eyedropperSafeImageCache.get(key);
    const isReady = isDrawableImageSource(selected?.source);
    if (isReady) ready++;
    rows.push({
      objectId: obj.id,
      imgKey: key,
      ready: isReady,
      cacheSource: cacheEntry?.sourceKind || '',
      pendingBefore: beforePending,
      pendingAfter: eyedropperSafeImagePromises.has(key) || eyedropperSafeDisplayReloadPromises.has(key),
      scaledPending: [...eyedropperSafeScaledBitmapPending].some(pendingKey => pendingKey.startsWith(`${key}:`)),
      nativeRef: isNativeImageRef(imageStore[key]),
      distance: Math.round(Math.sqrt(distanceSq || 0)),
    });
  }
  return { rows, ready };
}

function getViewportScaledVariantForEyedropperPrewarm(key, targetScale) {
  if (!key || !(targetScale < 1) || typeof imageScaledBitmapCache === 'undefined') return null;
  const map = imageScaledBitmapCache.get(key);
  if (!map) return null;
  const scaleLevels = Array.isArray(IMAGE_SCALE_LEVELS) ? IMAGE_SCALE_LEVELS : [];
  const selectedScale = scaleLevels
    .filter((scale) => scale >= targetScale && map.has(scale))
    .reduce((best, scale) => Math.min(best, scale), 1);
  return selectedScale < 1 ? map.get(selectedScale) : null;
}

function prewarmViewportScaledVariantForEyedropper(obj, view) {
  const key = obj?.data?.imgKey;
  if (typeof isViewportImageScalingActive === 'function' && !isViewportImageScalingActive()) {
    return { ready: true, queued: false, targetScale: 1, skipped: 'scaling-disabled' };
  }
  if (!key || typeof chooseImageScaleForDraw !== 'function') return { ready: false, queued: false };
  const fullSource = imageBitmapCache[key] || imageCache[key] || null;
  if (!isDrawableImageSource(fullSource)) return { ready: false, queued: false };
  const targetScale = chooseImageScaleForDraw(obj, fullSource, view);
  if (!(targetScale < 1)) return { ready: true, queued: false, targetScale };
  if (getViewportScaledVariantForEyedropperPrewarm(key, targetScale)) {
    return { ready: true, queued: false, targetScale };
  }
  if (typeof queueScaledImageVariant === 'function') {
    queueScaledImageVariant(key, fullSource, targetScale);
    return { ready: false, queued: true, targetScale };
  }
  return { ready: false, queued: false, targetScale };
}

function prewarmEyedropperSafeImages(clientX, clientY, options = {}) {
  if (eyedropperEnabled) {
    return { summary: { skipped: 'eyedropper-snapshot-only' }, rows: [] };
  }
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return { summary: { skipped: 'invalid-point' }, rows: [] };
  }
  const limit = Math.max(1, Number(options.limit) || EYEDROPPER_PREWARM_LIMIT);
  const point = clientToBoardWorldPoint(clientX, clientY);
  const rect = options.rect || eyedropperPrewarmRect(clientX, clientY, Number(options.padCss) || EYEDROPPER_PREWARM_PAD_CSS);
  const view = eyedropperPreviewScaleView();
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const { rows, ready } = runEyedropperPrewarmCandidates(
    collectEyedropperPrewarmCandidates(point, rect, limit),
    view,
    counters,
  );
  EyedropperDebug._count('prewarmRuns');
  EyedropperDebug._count('prewarmCandidates', rows.length);
  EyedropperDebug._count('prewarmReady', ready);
  return {
    summary: {
      candidates: rows.length,
      ready,
      pending: rows.filter(row => row.pendingAfter).length,
      nativeSkipped: counters.nativeSourceHydrationSkipped || 0,
      displayReused: counters.safeDisplayImages || 0,
      displayCorsReused: counters.safeDisplayCorsImages || 0,
      displayCorsPending: counters.safeDisplayCorsPending || 0,
      dataUrlReady: counters.safeDataUrlImages || 0,
      probeFailures: counters.safeDisplayProbeFailures || 0,
    },
    rows,
  };
}

function collectEyedropperViewportPrewarmCandidates(limit = EYEDROPPER_VIEWPORT_PREWARM_LIMIT) {
  const rect = typeof currentViewportWorldRect === 'function'
    ? currentViewportWorldRect(EYEDROPPER_PREWARM_PAD_CSS)
    : null;
  if (!rect) return { point: null, rect: null, candidates: [] };
  const point = {
    x: (rect.x1 + rect.x2) / 2,
    y: (rect.y1 + rect.y2) / 2,
  };
  const candidates = objects
    .filter(obj => obj?.type === 'image' && obj.data?.imgKey && objectIntersectsRect(obj, rect))
    .map(obj => ({ obj, distanceSq: distanceSqToObject(point, obj) }))
    .sort((a, b) => a.distanceSq - b.distanceSq)
    .slice(0, Math.max(1, Number(limit) || EYEDROPPER_VIEWPORT_PREWARM_LIMIT));
  return { point, rect, candidates };
}

function prewarmEyedropperVisibleImages(options = {}) {
  if (eyedropperEnabled) {
    EyedropperDebug._count('viewportPrewarmRuns');
    return {
      summary: {
        skipped: 'eyedropper-snapshot-only',
        candidates: 0,
        ready: 0,
        viewportScaleReady: 0,
        viewportScaleQueued: 0,
        pending: 0,
        scaledPending: 0,
        nativeSkipped: 0,
        displayReused: 0,
        displayCorsReused: 0,
        displayCorsPending: 0,
        dataUrlReady: 0,
        probeFailures: 0,
      },
      rows: [],
    };
  }
  const { candidates } = collectEyedropperViewportPrewarmCandidates(options.limit);
  const view = eyedropperPreviewScaleView();
  const viewportView = eyedropperViewportScaleView();
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const { rows, ready } = runEyedropperPrewarmCandidates(candidates, view, counters);
  let viewportScaleReady = 0;
  let viewportScaleQueued = 0;
  for (const { obj } of candidates) {
    selectEyedropperSafeImageSourceForDraw(obj.data.imgKey, obj, viewportView, counters);
    const scaleWarm = prewarmViewportScaledVariantForEyedropper(obj, viewportView);
    if (scaleWarm.ready) viewportScaleReady++;
    if (scaleWarm.queued) viewportScaleQueued++;
  }
  EyedropperDebug._count('viewportPrewarmRuns');
  EyedropperDebug._count('viewportPrewarmCandidates', rows.length);
  EyedropperDebug._count('viewportPrewarmReady', ready);
  EyedropperDebug._count('viewportScalePrewarmReady', viewportScaleReady);
  EyedropperDebug._count('viewportScalePrewarmQueued', viewportScaleQueued);
  return {
    summary: {
      candidates: rows.length,
      ready,
      viewportScaleReady,
      viewportScaleQueued,
      pending: rows.filter(row => row.pendingAfter).length,
      scaledPending: rows.filter(row => row.scaledPending).length,
      nativeSkipped: counters.nativeSourceHydrationSkipped || 0,
      displayReused: counters.safeDisplayImages || 0,
      displayCorsReused: counters.safeDisplayCorsImages || 0,
      displayCorsPending: counters.safeDisplayCorsPending || 0,
      dataUrlReady: counters.safeDataUrlImages || 0,
      probeFailures: counters.safeDisplayProbeFailures || 0,
    },
    rows,
  };
}

function prewarmEyedropperCenterTile(clientX, clientY, options = {}) {
  if (!eyedropperEnabled || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const point = clientToBoardWorldPoint(clientX, clientY);
  const topObject = topObjectAtWorldPoint(point);
  if (!topObject || topObject.type !== 'image') return false;
  const key = topObject.data?.imgKey;
  const safeEntry = key ? eyedropperSafeImageCache.get(key) : null;
  const token = safeEntry?.token || (key ? eyedropperSafeImageToken(key) : '');
  const local = worldPointToImageLocalUnit(topObject, point);
  if (!key || !token || !local) return false;

  if (!safeEntry || safeEntry.token !== token || !isDrawableImageSource(safeEntry.source)) {
    resolveEyedropperSafeImageSource(key);
    return false;
  }

  const { width, height } = imageSourceSize(safeEntry.source);
  if (width <= 0 || height <= 0) return false;
  const sourceX = local.u * Math.max(0, width - 1);
  const sourceY = local.v * Math.max(0, height - 1);
  buildEyedropperSafeTileCache(key, token, safeEntry.source, sourceX, sourceY, {
    sync: options.sync !== false,
  });
  return true;
}

function scheduleEyedropperHoverTilePrewarm(e) {
  if (!eyedropperEnabled || eyedropperSampling || !e || e.clientX == null || e.clientY == null) return;
  _eyedropperPendingHoverTileEvent = { clientX: e.clientX, clientY: e.clientY };
  if (_eyedropperHoverTilePrewarmRaf) return;
  _eyedropperHoverTilePrewarmRaf = requestAnimationFrame(() => {
    _eyedropperHoverTilePrewarmRaf = null;
    const event = _eyedropperPendingHoverTileEvent;
    _eyedropperPendingHoverTileEvent = null;
    if (!event) return;
    prewarmEyedropperCenterTile(event.clientX, event.clientY, { sync: false });
  });
}

function scheduleEyedropperViewportPrewarm(reason = 'viewport', options = {}) {
  if (!eyedropperEnabled) return;
  EyedropperDebug._count('viewportPrewarmRuns');
}

function noteEyedropperNavigationActive(reason = 'viewport', durationMs = 180) {
  if (!eyedropperEnabled) return;
  const now = performance.now();
  _eyedropperNavigationBlockUntil = Math.max(_eyedropperNavigationBlockUntil, now + Math.max(0, durationMs));
  if (_eyedropperNavigationBlockTimer) clearTimeout(_eyedropperNavigationBlockTimer);
  _eyedropperNavigationBlockTimer = setTimeout(() => {
    _eyedropperNavigationBlockTimer = null;
    if (performance.now() >= _eyedropperNavigationBlockUntil) _eyedropperNavigationBlockUntil = 0;
  }, Math.max(0, durationMs) + 16);
  EyedropperDebug._count(`navigation:${reason}`);
}

function isEyedropperNavigationActive() {
  return eyedropperEnabled && performance.now() < _eyedropperNavigationBlockUntil;
}

function handleEyedropperViewportChanged(reason = 'viewport') {
  if (!eyedropperEnabled) return;
  if (eyedropperSampling) hideEyedropperSample();
  scheduleEyedropperSnapshotRefresh(reason);
}

function scheduleEyedropperSafeImagePrewarm(e, options = {}) {
  if (eyedropperEnabled) return;
  if (!e || e.clientX == null || e.clientY == null) return;
  if (eyedropperSampling && !options.allowDuringSampling) {
    EyedropperDebug._count('prewarmDeferredDuringSampling');
    return;
  }
  _eyedropperPendingPrewarmEvent = { clientX: e.clientX, clientY: e.clientY };
  EyedropperDebug._countPerf('prewarmScheduled');
  if (_eyedropperPrewarmRaf) {
    EyedropperDebug._countPerf('prewarmCoalesced');
    return;
  }
  _eyedropperPrewarmRaf = requestAnimationFrame(() => {
    _eyedropperPrewarmRaf = null;
    const event = _eyedropperPendingPrewarmEvent;
    _eyedropperPendingPrewarmEvent = null;
    if (eyedropperSampling && event) {
      const prewarmStart = performance.now();
      const result = prewarmEyedropperSafeImages(event.clientX, event.clientY);
      EyedropperDebug._recordPrewarmTiming(result?.summary, performance.now() - prewarmStart);
    }
  });
}

function cancelEyedropperBackgroundPrewarm() {
  if (_eyedropperPrewarmRaf) cancelAnimationFrame(_eyedropperPrewarmRaf);
  if (_eyedropperViewportPrewarmRaf) cancelAnimationFrame(_eyedropperViewportPrewarmRaf);
  cancelEyedropperSnapshotRefresh();
  _eyedropperPrewarmRaf = null;
  _eyedropperViewportPrewarmRaf = null;
  _eyedropperPendingPrewarmEvent = null;
  _eyedropperViewportPrewarmScheduled = false;
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
    viewportRect,
    counters: wallpaper.rendered.counters,
    drawnImages: wallpaper.rendered.drawnImages || 0,
    drawnText: wallpaper.rendered.drawnText || 0,
    testedObjects: wallpaper.rendered.counters?.testedObjects || 0,
    intersectingObjects: wallpaper.rendered.counters?.visibleObjects || 0,
    wallpaper: true,
    readbackUnsafe: !!wallpaper.rendered.counters?.previewUnsafeImages,
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
  if ((!eyedropperSampling && !options.force) || !eyedropperLoupe || !eyedropperCanvas || !eyedropperCtx) return;
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
  const dpr = window.devicePixelRatio || 1;
  const drawSizeStart = performance.now();
  const drawSize = eyedropperPreviewDrawSize(dpr);
  timings.drawSize = performance.now() - drawSizeStart;

  const resizeStart = performance.now();
  if (eyedropperCanvas.width !== drawSize || eyedropperCanvas.height !== drawSize) {
    eyedropperCanvas.width = drawSize;
    eyedropperCanvas.height = drawSize;
    timings.resizeVisibleChanged = 1;
  }
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
  const canvasReadoutStart = performance.now();
  let readoutSample = sampleEyedropperReadoutPixel(e.clientX, e.clientY, previewSample);
  timings.canvasReadout = performance.now() - canvasReadoutStart;
  let centerPixel = readoutSample?.pixel;
  timings.previewReadback = 0;
  if (previewSample?.painted && previewSample.centerX != null && previewSample.centerY != null &&
    !previewSample.readbackUnsafe && (!centerPixel || readoutSample?.source === 'preview-render')) {
    const previewReadbackStart = performance.now();
    const previewPixel = sampleCanvasPixel(eyedropperRenderedSampleCtx, previewSample.centerX, previewSample.centerY, {
      where: 'zoomed-preview-center-fallback',
      source: 'commitEyedropperSample',
    });
    timings.previewReadback = performance.now() - previewReadbackStart;
    if (previewPixel) {
      centerPixel = previewPixel;
      previewSample.pixel = previewPixel;
      readoutSample = {
        ...(readoutSample || {}),
        pixel: previewPixel,
        source: 'preview-render',
        reason: readoutSample?.reason || 'preview-readback-fallback',
      };
    }
  }
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
  if (centerPixel) updateEyedropperColorReadout(centerPixel);
  timings.readout = performance.now() - readoutStart;
  const visibleStart = performance.now();
  if (!eyedropperLoupe.classList.contains('visible')) eyedropperLoupe.classList.add('visible');
  timings.showLoupe = performance.now() - visibleStart;
  const visibleAt = performance.now();
  const clickToPreviewVisibleMs = Number.isFinite(receivedAt) ? Math.max(0, visibleAt - receivedAt) : 0;
  const eventToPreviewVisibleMs = inputEventAgeMs(e, visibleAt);
  latency.clickToPreviewVisibleMs = Math.round(clickToPreviewVisibleMs * 100) / 100;
  latency.eventToPreviewVisibleMs = eventToPreviewVisibleMs == null ? '' : Math.round(eventToPreviewVisibleMs * 100) / 100;
  const positionStart = performance.now();
  positionEyedropperLoupe(e.clientX, e.clientY);
  timings.position = performance.now() - positionStart;
  timings.total = performance.now() - totalStart;
  if (previewSample) previewSample.timings = timings;
  if (previewSample) {
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
}

function updateEyedropperSample(e) {
  if (!eyedropperSampling || !e) return;
  EyedropperDebug._countPerf('sampleMoves');
  const pointerEvent = eyedropperPointerDebugEvent(e);
  _eyedropperLatestPointerEvent = pointerEvent;
  if (_eyedropperSampleRaf) {
    _eyedropperPendingSampleCoalesced++;
    pointerEvent.coalescedMoves = _eyedropperPendingSampleCoalesced;
  }
  _eyedropperPendingSampleEvent = pointerEvent;
  _eyedropperLastSampleEvent = _eyedropperPendingSampleEvent;
  if (_eyedropperSampleRaf) {
    EyedropperDebug._countPerf('sampleCoalescedMoves');
    return;
  }
  _eyedropperSampleRaf = requestAnimationFrame(() => {
    _eyedropperSampleRaf = null;
    const sampleEvent = _eyedropperPendingSampleEvent;
    _eyedropperPendingSampleEvent = null;
    _eyedropperPendingSampleCoalesced = 0;
    if (sampleEvent) commitEyedropperSample(sampleEvent);
  });
}

function cancelPendingEyedropperSample() {
  if (_eyedropperSampleRaf) cancelAnimationFrame(_eyedropperSampleRaf);
  if (_eyedropperPrewarmRaf) cancelAnimationFrame(_eyedropperPrewarmRaf);
  if (_eyedropperHoverTilePrewarmRaf) cancelAnimationFrame(_eyedropperHoverTilePrewarmRaf);
  if (_eyedropperViewportPrewarmRaf) cancelAnimationFrame(_eyedropperViewportPrewarmRaf);
  _eyedropperSampleRaf = null;
  _eyedropperPrewarmRaf = null;
  _eyedropperHoverTilePrewarmRaf = null;
  _eyedropperViewportPrewarmRaf = null;
  _eyedropperPendingSampleEvent = null;
  _eyedropperPendingSampleCoalesced = 0;
  _eyedropperPendingPrewarmEvent = null;
  _eyedropperPendingHoverTileEvent = null;
  _eyedropperViewportPrewarmScheduled = false;
}

function stopEyedropperPointerTracking() {
  if (_eyedropperTrackingRelease) _eyedropperTrackingRelease();
  _eyedropperTrackingRelease = null;
  _eyedropperActivePointerId = null;
}

function endEyedropperSample(e = null) {
  stopEyedropperPointerTracking();
  if (eyedropperSampling && e?.clientX != null && e?.clientY != null) {
    cancelPendingEyedropperSample();
    const pointerEvent = eyedropperPointerDebugEvent(e);
    _eyedropperLatestPointerEvent = pointerEvent;
    commitEyedropperSample(pointerEvent);
    eyedropperSampling = false;
    if (_eyedropperSnapshotDirtyAfterSample) {
      _eyedropperSnapshotDirtyAfterSample = false;
      markEyedropperSnapshotDirty();
    }
    return;
  } else {
    cancelPendingEyedropperSample();
  }
  eyedropperSampling = false;
  if (_eyedropperSnapshotDirtyAfterSample) {
    _eyedropperSnapshotDirtyAfterSample = false;
    markEyedropperSnapshotDirty();
  }
}

function isEyedropperSampleVisible() {
  return !!eyedropperLoupe?.classList.contains('visible');
}

function hideEyedropperSample() {
  endEyedropperSample();
  _eyedropperLastSampleEvent = null;
  _eyedropperLoupeHorizontalSide = 'right';
  if (eyedropperLoupe) eyedropperLoupe.classList.remove('visible');
}

function hideInactiveEyedropperSampleForNavigation() {
  if (!eyedropperEnabled || eyedropperSampling || !isEyedropperSampleVisible()) return false;
  hideEyedropperSample();
  return true;
}

function isPointInsideVisibleEyedropperLoupe(clientX, clientY) {
  if (!isEyedropperSampleVisible()) return false;
  const rect = eyedropperLoupe.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function isEventInsideVisibleEyedropperLoupe(e) {
  return !!(isEyedropperSampleVisible() && e.target instanceof Node && eyedropperLoupe?.contains(e.target));
}

function showEyedropperCopiedMessage() {
  if (typeof finishPillTransition === 'function') finishPillTransition({ finalMsg: 'Copied' });
}

async function copyEyedropperValue(targetId) {
  const value = document.getElementById(targetId)?.textContent || '';
  if (!value) return;
  try {
    await BoardfishClipboardIO.copyTextToClipboard(value);
    showEyedropperCopiedMessage();
  } catch (_) {}
}

function eyedropperEventTargetName(e) {
  const target = e?.target;
  if (!(target instanceof Element)) return '';
  return target.id ? `#${target.id}` : target.tagName.toLowerCase();
}

function logEyedropperInteraction(e, allowed, reason) {
  EyedropperDebug._logInteraction({
    eventType: e?.type || '',
    pointerType: e?.pointerType || '',
    pointerId: e?.pointerId ?? '',
    button: e?.button ?? '',
    buttons: e?.buttons ?? '',
    clientX: e?.clientX ?? '',
    clientY: e?.clientY ?? '',
    target: eyedropperEventTargetName(e),
    allowed: !!allowed,
    reason,
    enabled: eyedropperEnabled,
    sampling: eyedropperSampling,
    activePointerId: _eyedropperActivePointerId ?? '',
    shieldActive: isEyedropperShieldActive(),
  });
}

function beginEyedropperPointerTracking(e) {
  stopEyedropperPointerTracking();
  const supportsPointerTracking = e?.type === 'pointerdown' && e.pointerId != null;
  const moveEvent = supportsPointerTracking ? 'pointermove' : 'mousemove';
  const upEvent = supportsPointerTracking ? 'pointerup' : 'mouseup';
  if (supportsPointerTracking) {
    _eyedropperActivePointerId = e.pointerId;
    _eyedropperLastPointerStartAt = performance.now();
  }

  const onMove = (moveEvent) => {
    if (supportsPointerTracking && _eyedropperActivePointerId != null && moveEvent.pointerId !== _eyedropperActivePointerId) return;
    updateEyedropperSample(moveEvent);
  };
  const onUp = (upEvent) => {
    if (supportsPointerTracking && _eyedropperActivePointerId != null && upEvent.pointerId !== _eyedropperActivePointerId) return;
    endEyedropperSample(upEvent);
    logEyedropperInteraction(upEvent, true, 'sample-released');
  };
  document.addEventListener(moveEvent, onMove, true);
  document.addEventListener(upEvent, onUp, true);
  _eyedropperTrackingRelease = () => {
    document.removeEventListener(moveEvent, onMove, true);
    document.removeEventListener(upEvent, onUp, true);
  };
}

eyedropperLoupe?.addEventListener('pointerdown', (e) => e.stopPropagation());
eyedropperLoupe?.addEventListener('mousedown', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
eyedropperLoupe?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const target = e.target.closest?.('.eyedropper-copy-icon');
  if (target) copyEyedropperValue(target.dataset.copyTarget);
});
eyedropperLoupe?.addEventListener('keydown', (e) => {
  const target = e.target.closest?.('.eyedropper-copy-icon');
  if (!target || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  e.stopPropagation();
  copyEyedropperValue(target.dataset.copyTarget);
});

function startEyedropperSample(e) {
  if (typeof _spaceDown !== 'undefined' && _spaceDown) {
    logEyedropperInteraction(e, false, 'space-pan');
    return false;
  }
  if (e.type === 'mousedown' && performance.now() - _eyedropperLastPointerStartAt < 700) {
    e.preventDefault();
    e.stopImmediatePropagation();
    logEyedropperInteraction(e, false, 'mouse-after-pointer');
    return true;
  }
  if (!eyedropperEnabled) {
    logEyedropperInteraction(e, false, 'disabled');
    return false;
  }
  if (e.button !== 0) {
    logEyedropperInteraction(e, false, 'non-primary-button');
    return false;
  }
  if (e.type === 'pointerdown' && _eyedropperActivePointerId != null && _eyedropperActivePointerId !== e.pointerId) {
    logEyedropperInteraction(e, false, 'different-active-pointer');
    return true;
  }
  if (e.type === 'pointerdown') _eyedropperLastPointerStartAt = performance.now();
  if (isEyedropperNavigationActive()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    logEyedropperInteraction(e, false, 'navigation-active');
    return true;
  }
  if (_boardOpening || (isBoardInputBlocked() && !isEyedropperShieldActive())) {
    logEyedropperInteraction(e, false, _boardOpening ? 'board-opening' : 'input-blocked');
    return false;
  }
  if (isPointInsideVisibleEyedropperLoupe(e.clientX, e.clientY)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    logEyedropperInteraction(e, true, 'inside-loupe');
    return true;
  }
  if (!(e.target instanceof Node) || !canvas.contains(e.target)) {
    logEyedropperInteraction(e, false, 'outside-canvas');
    return false;
  }
  if (isEventInsideVisibleContextMenu(e)) {
    logEyedropperInteraction(e, false, 'inside-menu');
    return false;
  }
  if (ctxMenu.classList.contains('visible') || objCtxMenu.classList.contains('visible') || ctxActions?.classList.contains('visible')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    hideMenus();
    logEyedropperInteraction(e, true, 'closed-menu-before-sample');
  }
  if (eyedropperSampling) {
    e.preventDefault();
    e.stopImmediatePropagation();
    endEyedropperSample(e);
    logEyedropperInteraction(e, true, 'sample-set');
    return true;
  }
  if (isEyedropperSampleVisible()) {
    hideEyedropperSample();
    logEyedropperInteraction(e, true, 'restart-visible-sample');
  }

  e.preventDefault();
  e.stopImmediatePropagation();
  hideMenus();
  eyedropperSampling = true;
  if (typeof cancelWheelPan === 'function') cancelWheelPan();
  cancelEyedropperBackgroundPrewarm();
  const pointerEvent = eyedropperPointerDebugEvent(e);
  _eyedropperLatestPointerEvent = pointerEvent;
  commitEyedropperSample(pointerEvent, { first: true });
  beginEyedropperPointerTracking(e);
  logEyedropperInteraction(e, true, 'sample-started');
  return true;
}

canvas.addEventListener('pointerdown', startEyedropperSample, true);
canvas.addEventListener('mousedown', startEyedropperSample, true);
document.addEventListener('pointermove', scheduleEyedropperHoverTilePrewarm, true);
document.addEventListener('mousemove', scheduleEyedropperHoverTilePrewarm, true);
