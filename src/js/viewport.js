// ─── Viewport ─────────────────────────────────────────────────────────────────
var panX = 0, panY = 0, zoom = 1;
var _vpSaveTimer = null;
var _vpSaveDueAt = 0;
var BoardRenderer = null;
function saveViewport() {
  _vpSaveDueAt = performance.now() + 400;
  if (_vpSaveTimer) return;
  function flushViewportSave() {
    const remainingMs = _vpSaveDueAt - performance.now();
    if (remainingMs > 1) {
      _vpSaveTimer = setTimeout(flushViewportSave, remainingMs);
      return;
    }
    _vpSaveTimer = null;
    localStorage.setItem('bf_vp', JSON.stringify({ panX, panY, zoom }));
  }
  _vpSaveTimer = setTimeout(flushViewportSave, 400);
}


// PillDebug and MenuDebug are initialized by js/viewport_debug_ui.js.
var short_message = 1500;
var long_message = 3 * short_message;
var _islMsgActive = false;
var _islMsgTimer = null;
var _islMsgToken = 0;
var _lastIslandZoomText = '';

const formatZoomPercent = (value = zoom) => {
  const pct = Math.max(0, (Number.isFinite(value) ? value : 1) * 100);
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `${Math.max(0.1, Math.round(pct * 10) / 10)}%`;
};

const isOpeningFreezeActive = () => {
  return !!openingShield?.classList.contains('active') && openingShield.classList.contains('opening-freeze');
};

const getOpeningShieldPill = () => {
  const pill = openingShield?.querySelector?.('.opening-shield-pill') || null;
  return pill?.parentNode === openingShield ? pill : null;
};

const hideOpeningShieldPill = () => {
  getOpeningShieldPill()?.remove();
};

const ensureOpeningShieldPill = () => {
  if (!isOpeningFreezeActive()) {
    hideOpeningShieldPill();
    return null;
  }
  const existing = getOpeningShieldPill();
  if (existing) return existing;
  const pill = document.createElement('div');
  pill.className = 'opening-shield-pill';
  pill.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'opening-shield-pill-text';
  pill.appendChild(text);
  openingShield.appendChild(pill);
  return pill;
};

const syncOpeningShieldPill = (text = islZoom.textContent) => {
  const pill = ensureOpeningShieldPill();
  if (!pill) return;
  pill.firstElementChild.textContent = text;
  pill.classList.toggle('visible', !!text);
};

function setIslandVisible(visible) {
  island.classList.toggle('visible', visible);
  island.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

const syncIslandZoomDisplay = (reason = 'zoom-sync') => {
  if (_islMsgActive) return;
  const zoomText = formatZoomPercent();
  const changed = island.dataset.mode !== 'zoom' || _lastIslandZoomText !== zoomText || !island.classList.contains('visible');
  islZoom.textContent = zoomText;
  _lastIslandZoomText = zoomText;
  island.dataset.mode = 'zoom';
  island.setAttribute('role', 'button');
  island.setAttribute('tabindex', '0');
  island.setAttribute('aria-label', `Reset zoom (${zoomText})`);
  island.title = 'Reset Zoom';
  setIslandVisible(true);
  if (changed) PillDebug.log('zoomIsland:shown', { reason, zoom, text: zoomText });
};

function showIslandForMessage(text) {
  islZoom.textContent = text;
  island.dataset.mode = 'message';
  island.setAttribute('role', 'button');
  island.setAttribute('tabindex', '0');
  island.setAttribute('aria-label', `${text}. Reset zoom`);
  island.title = 'Reset Zoom';
  setIslandVisible(true);
  syncOpeningShieldPill(text);
}

function hideIsland(reason = 'hide') {
  ++_islMsgToken;
  clearTimeout(_islMsgTimer);
  _islMsgActive = false;
  islZoom.textContent = '';
  hideOpeningShieldPill();
  syncIslandZoomDisplay(reason);
  PillDebug.log('hideIsland', { reason });
  return reason;
}

function startIslandBusyMsg(text) {
  const token = ++_islMsgToken;
  clearTimeout(_islMsgTimer);
  _islMsgActive = true;
  showIslandForMessage(text);
  PillDebug.log('busyIslandMsg:shown', { text });

  return {
    update(nextText) {
      if (token !== _islMsgToken) return;
      islZoom.textContent = nextText;
      syncOpeningShieldPill(nextText);
      PillDebug.log('busyIslandMsg:update', { text: nextText });
    },
    done(finalMsg = null, duration = short_message, onRestore = null) {
      if (token !== _islMsgToken) return;
      if (finalMsg) return showIslandMsg(finalMsg, duration, onRestore);
      return hideIsland('busy-done');
    },
  };
}

function startPillTask({
  message = null,
  beforeStart = null,
  progress = false,
} = {}) {
  if (beforeStart) beforeStart();
  if (!message) return null;
  return progress ? startIslandBusyMsg(message) : showIslandMsg(message);
}

function updatePillTask(busyPill, nextText) {
  if (!busyPill) return;
  busyPill.update(nextText);
}

function finishPillTask({
  beforeFinish = null,
  busyPill = null,
  finalMsg = null,
  duration = short_message,
} = {}) {
  if (beforeFinish) beforeFinish();
  if (busyPill) return busyPill.done(finalMsg, duration);
  if (finalMsg) return showIslandMsg(finalMsg, duration);
  return hideIsland('pill-finished');
}

function showIslandMsg(msg, duration = 0, onRestore = null) {
  const token = ++_islMsgToken;
  PillDebug.log('showIslandMsg:start', { msg, duration });
  clearTimeout(_islMsgTimer);
  _islMsgActive = true;
  showIslandForMessage(msg);
  PillDebug.log('showIslandMsg:shown', { msg });
  if (duration > 0) {
    _islMsgTimer = setTimeout(() => {
      if (token !== _islMsgToken) return;
      const hideReason = hideIsland('message-timeout');
      if (onRestore) onRestore();
      PillDebug.log('showIslandMsg:onHide', { msg, hideReason });
    }, duration);
  }
  return 'shown';
}
syncIslandZoomDisplay('init');
// ─── Offscreen buffer ─────────────────────────────────────────────────────────
var _offscreen = document.createElement('canvas');
var _offCtx    = _offscreen.getContext('2d');
var _offscreenDirty = true;
var _offscreenRebuilding = false;
var _offscreenVersion = 0;
function invalidateOffscreen() {
  _offscreenDirty = true;
  _offscreenVersion++;
}

async function _rebuildOffscreenAsync() {
  if (_offscreenRebuilding) return;
  _offscreenRebuilding = true;
  const snapshotEditingId = editingId;
  const rebuildVersion = _offscreenVersion;
  const dbg = ViewportDebug.start('offscreenRebuild', { objectCount: objects.length, editingId: snapshotEditingId, version: rebuildVersion });

  // Ensure all images have GPU-resident ImageBitmap before drawing
  const bitmapPromises = [];
  for (const obj of objects) {
    if (obj.id === snapshotEditingId || obj.type !== 'image') continue;
    const key = obj.data?.imgKey;
    if (!key || imageBitmapCache[key] || imageBitmapFailed.has(key)) continue;
    const img = imageCache[key];
    if (!img || !img.complete) continue;
    bitmapPromises.push(
      createImageBitmap(img)
        .then(bm => { imageBitmapCache[key] = bm; })
        .catch(() => { imageBitmapFailed.add(key); ViewportDebug.count('imageBitmapFailures'); })
    );
  }
  const bitmapStart = performance.now();
  await Promise.all(bitmapPromises);
  ViewportDebug.step(dbg, 'ensure-bitmaps', { count: bitmapPromises.length, ms: performance.now() - bitmapStart });

  // Bail if edit mode or viewport content changed while we were awaiting.
  if (!editingId || editingId !== snapshotEditingId || rebuildVersion !== _offscreenVersion) {
    _offscreenRebuilding = false;
    ViewportDebug.end(dbg, { stale: true, currentVersion: _offscreenVersion });
    if (editingId && _offscreenDirty) scheduleRender(true, false, 'offscreen-stale');
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  _offscreen.width  = boardCanvas.width;
  _offscreen.height = boardCanvas.height;
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);
  fillBoardBackground(_offCtx, _offscreen.width, _offscreen.height);
  _offCtx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
  setCanvasImageQuality(_offCtx);
  _offCtx.font = FONT;
  _offCtx.textBaseline = 'alphabetic';
  const viewportRect = currentViewportWorldRect(0);
  for (const obj of objects) {
    if (obj.id === editingId) continue;
    if (viewportCullingEnabled && !objectIntersectsRect(obj, viewportRect)) continue;
    drawSingleObj(_offCtx, obj, null, { viewportRect, view: { zoom, dpr } });
  }
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);

  _offscreenRebuilding = false;
  if (rebuildVersion === _offscreenVersion) _offscreenDirty = false;
  // Re-render to display the fresh offscreen (caret/selection on top)
  scheduleRender(true, false, 'offscreen-ready');
  ViewportDebug.end(dbg, { stale: false });
}

// ─── History delta tracking ───────────────────────────────────────────────────
var _dirtyIds = new Set();
function markDirty(id) {
  const wasDirty = isDirty();
  _dirtyIds.add(id);
  if (typeof noteEyedropperBoardContentChanged === 'function') {
    noteEyedropperBoardContentChanged('object-dirty');
  }
  if (!wasDirty) updateTitle();
}

// ─── Canvas resize ────────────────────────────────────────────────────────────

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(window.innerWidth * dpr);
  const height = Math.round(window.innerHeight * dpr);
  if (boardCanvas.width === width && boardCanvas.height === height) return;
  boardCanvas.width = width;
  boardCanvas.height = height;
  invalidateOffscreen();
  scheduleRender(true, false);
  if (typeof handleEyedropperViewportChanged === 'function') {
    handleEyedropperViewportChanged('resize');
  }
}

function drawImageObj(context, obj, img) {
  return BoardRenderer.drawImageObj(context, obj, img);
}

function isDrawableImageSource(source) {
  return BoardRenderer.isDrawableImageSource(source);
}
var VIEWPORT_CULL_PADDING_PX = 256;

function currentViewportWorldRect(padScreenPx = VIEWPORT_CULL_PADDING_PX, view = { panX, panY, zoom }) {
  return viewportWorldRect(padScreenPx, view);
}

function countCulledObject(obj, counters = null) {
  return BoardRenderer.countCulledObject(obj, counters);
}

// Draws a single non-editing object onto any canvas context (world coords).
function drawSingleObj(context, obj, counters = null, { view = { zoom, dpr: window.devicePixelRatio || 1 }, imageSourceResolver = null, viewportRect = null } = {}) {
  return BoardRenderer.drawSingleObj(context, obj, counters, { view, imageSourceResolver, viewportRect });
}


function createDrawCounters() {
  return BoardRenderer.createDrawCounters();
}

function resetCanvasToScreen(context) {
  return BoardRenderer.resetCanvasToScreen(context);
}

function setWorldCanvasTransform(context, dpr = window.devicePixelRatio || 1, view = { zoom, panX, panY }) {
  return BoardRenderer.setWorldCanvasTransform(context, dpr, view);
}

function drawVisibleObjects(context, counters, { skipId = null, viewportRect = currentViewportWorldRect(), view = { zoom, dpr: window.devicePixelRatio || 1 }, imageSourceResolver = null } = {}) {
  return BoardRenderer.drawVisibleObjects(context, counters, { skipId, viewportRect, view, imageSourceResolver });
}

function drawTextSelectionHighlight(context, obj, layout, selStart, selEnd) {
  if (selStart === selEnd) return;
  context.fillStyle = 'rgba(10, 132, 255, 0.3)';
  for (const line of layout) {
    const ls = line.startIndex, textEnd = ls + line.text.length;
    const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
    if (h0 < h1) {
      const o0 = h0 - ls, o1 = h1 - ls;
      const endX = lineEndX(line, obj);
      const x1 = o0 < line.text.length ? lineXAtOffset(line, obj, o0) : endX;
      const x2 = o1 < line.text.length ? lineXAtOffset(line, obj, o1) : endX;
      TextSelDebug._logDraw(line, selStart, selEnd, x1, x2);
      context.fillRect(x1, line.y, x2 - x1, LINE_H);
    }
  }
}

function drawCaret(context, obj, layout, selStart) {
  if (!_caretVisible) return;
  let cx = obj.x + TEXT_PAD, cy = obj.y + TEXT_PAD;
  for (const line of layout) {
    const ls = line.startIndex, le = line.endIndex ?? (ls + line.text.length);
    if (selStart >= ls && selStart <= le) {
      const off = selStart - ls;
      cx = off < line.text.length ? lineXAtOffset(line, obj, off) : lineEndX(line, obj);
      cy = line.y;
      break;
    }
  }
  context.fillStyle = canvasTextColor();
  context.fillRect(cx, cy, 2 / zoom, LINE_H);
}

function drawEditingTextOverlay(context) {
  const obj = objectsMap.get(editingId);
  if (!obj || obj.type !== 'text') return;
  context.font = FONT;
  context.textBaseline = 'alphabetic';

  const selStart = _editEl ? _editEl.selectionStart : 0;
  const selEnd   = _editEl ? _editEl.selectionEnd   : 0;
  const layout = getTextLayout(obj);

  drawTextSelectionHighlight(context, obj, layout, selStart, selEnd);

  context.fillStyle = canvasTextColor();
  for (const line of layout) context.fillText(line.text, obj.x + TEXT_PAD, line.textY);

  if (selStart === selEnd) drawCaret(context, obj, layout, selStart);
}

function drawBoard() {
  const dbg = ViewportDebug.start('drawBoard', { source: _activeRenderSource, objectCount: objects.length, editing: !!editingId, offscreenDirty: _offscreenDirty });
  if (_boardOpening) {
    ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  const collectDrawDebug = ViewportDebug.isEnabled();
  const drawStart = collectDrawDebug ? performance.now() : 0;
  const drawPhases = {};
  const counters = createDrawCounters();
  const dpr = window.devicePixelRatio || 1;
  const viewportRect = currentViewportWorldRect(0);
  let drawnImages = 0;
  let drawnText = 0;

  if (editingId) {
    if (_offscreenDirty) {
      // Kick off async rebuild (pre-decodes images to avoid GPU stall).
      // Draw all objects directly this frame while the rebuild is pending.
      _rebuildOffscreenAsync();
      const setupStart = collectDrawDebug ? performance.now() : 0;
      resetCanvasToScreen(ctx);
      fillBoardBackground(ctx, boardCanvas.width, boardCanvas.height);
      setWorldCanvasTransform(ctx, dpr);
      if (collectDrawDebug) drawPhases.backgroundSetupMs = performance.now() - setupStart;
      const objectsStart = collectDrawDebug ? performance.now() : 0;
      const drawn = drawVisibleObjects(ctx, counters, { skipId: editingId, viewportRect });
      if (collectDrawDebug) drawPhases.objectLoopMs = performance.now() - objectsStart;
      drawnImages += drawn.drawnImages;
      drawnText += drawn.drawnText;
    } else {
      // Blit cached offscreen (background + all non-editing objects)
      const blitStart = collectDrawDebug ? performance.now() : 0;
      resetCanvasToScreen(ctx);
      ctx.drawImage(_offscreen, 0, 0);
      if (collectDrawDebug) drawPhases.offscreenBlitMs = performance.now() - blitStart;
    }

    const editStart = collectDrawDebug ? performance.now() : 0;
    setWorldCanvasTransform(ctx, dpr);
    drawEditingTextOverlay(ctx);
    resetCanvasToScreen(ctx);
    if (collectDrawDebug) drawPhases.editingOverlayMs = performance.now() - editStart;
  } else {
    const setupStart = collectDrawDebug ? performance.now() : 0;
    resetCanvasToScreen(ctx);
    fillBoardBackground(ctx, boardCanvas.width, boardCanvas.height);
    setWorldCanvasTransform(ctx, dpr);
    if (collectDrawDebug) drawPhases.backgroundSetupMs = performance.now() - setupStart;
    const objectsStart = collectDrawDebug ? performance.now() : 0;
    const drawn = drawVisibleObjects(ctx, counters, { viewportRect });
    if (collectDrawDebug) drawPhases.objectLoopMs = performance.now() - objectsStart;
    drawnImages = drawn.drawnImages;
    drawnText = drawn.drawnText;
    const resetStart = collectDrawDebug ? performance.now() : 0;
    resetCanvasToScreen(ctx);
    if (collectDrawDebug) drawPhases.resetMs = performance.now() - resetStart;
  }
  ViewportDebug.count('croppedImages', counters.croppedImages);
  ViewportDebug.count('imageDrawMissing', counters.missingImages);
  ViewportDebug.count('imageDrawFallback', counters.fallbackImages);
  ViewportDebug.count('imageDrawErrors', counters.erroredImages);
  if (collectDrawDebug) {
    const drawMeta = {
      source: _activeRenderSource,
      drawnImages,
      drawnText,
      dpr,
      zoom,
      panX,
      panY,
      canvasW: boardCanvas.width,
      canvasH: boardCanvas.height,
      viewportX1: viewportRect.x1,
      viewportY1: viewportRect.y1,
      viewportX2: viewportRect.x2,
      viewportY2: viewportRect.y2,
      viewportW: viewportRect.x2 - viewportRect.x1,
      viewportH: viewportRect.y2 - viewportRect.y1,
      editing: !!editingId,
      offscreenDirty: !!_offscreenDirty,
      objectCount: objects.length,
      totalMeasuredMs: performance.now() - drawStart,
      ...drawPhases,
      ...counters,
    };
    _lastDrawBoardMeta = drawMeta;
    ViewportDebug.end(dbg, drawMeta);
  } else {
    _lastDrawBoardMeta = null;
    ViewportDebug.end(dbg);
  }
}

function hitTest(wx, wy) {
  return BoardObjectGeometry.topObjectAtWorldPoint({ x: wx, y: wy });
}

function applyTransform(frameDbg = null) {
  const dbg = ViewportDebug.start('applyTransform', { editing: !!editingId, panX, panY, zoom, objectCount: objects.length, selectedCount: selectedIds.size });
  if (_boardOpening) {
    getLastApplyTransformMeta.last = { skipped: 'board-opening', panX, panY, zoom, objectCount: objects.length };
    ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  if (editingId) invalidateOffscreen();
  const collectTransformDebug = ViewportDebug.isEnabled();
  const transformStart = performance.now();
  const drawStart = performance.now();
  drawBoard();
  const drawMs = performance.now() - drawStart;
  if (collectTransformDebug) {
    ViewportDebug.step(dbg, 'drawBoard', { ms: drawMs, ...(_lastDrawBoardMeta || {}) });
    ViewportDebug.step(frameDbg, 'drawBoard', { ms: drawMs, ...(_lastDrawBoardMeta || {}) });
  }
  const saveStart = performance.now();
  saveViewport();
  const saveMs = performance.now() - saveStart;
  if (collectTransformDebug) {
    ViewportDebug.step(dbg, 'saveViewport', { ms: saveMs });
    ViewportDebug.step(frameDbg, 'saveViewport', { ms: saveMs });
  }
  const overlayStart = performance.now();
  const needsOverlayUpdate = hasSelection()
    || selOverlay.classList.contains('visible')
    || multiSelOverlay.classList.contains('visible');
  if (needsOverlayUpdate) updateSelectionOverlay();
  else ViewportDebug.count('selectionOverlaySkipped');
  const overlayMs = performance.now() - overlayStart;
  if (collectTransformDebug) {
    ViewportDebug.step(dbg, 'updateSelectionOverlay', { ms: overlayMs, skipped: !needsOverlayUpdate });
    ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: overlayMs, skipped: !needsOverlayUpdate });
  }
  scheduleVisibleHydrationAfterIdle();
  if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
    scheduleVisibleScaledVariantPrewarmAfterIdle(_activeRenderSource || 'transform');
  }
  if (typeof handleEyedropperViewportChanged === 'function') {
    handleEyedropperViewportChanged(_activeRenderSource || 'transform');
  }
  syncIslandZoomDisplay(_activeRenderSource || 'transform');
  getLastApplyTransformMeta.last = {
    totalMeasuredMs: performance.now() - transformStart,
    drawMs,
    saveViewportMs: saveMs,
    overlayMs,
    overlaySkipped: !needsOverlayUpdate,
    source: _activeRenderSource,
    editing: !!editingId,
    panX,
    panY,
    zoom,
    objectCount: objects.length,
    selectedCount: selectedIds.size,
    drawBoard: _lastDrawBoardMeta ? { ..._lastDrawBoardMeta } : null,
  };
  ViewportDebug.end(dbg);
}

function getLastApplyTransformMeta() {
  const last = getLastApplyTransformMeta.last;
  if (!last) return null;
  return {
    ...last,
    drawBoard: last.drawBoard
      ? { ...last.drawBoard }
      : null,
  };
}

function toWorld(sx, sy) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}
var _frameRaf = null;
var _needTransform = false;
var _needBoardRender = false;
var _needOverlayRender = false;
var _frameScheduledAt = 0;
var _frameSources = [];
var _activeRenderSource = 'direct';
var _lastDrawBoardMeta = null;
var _frameInputAt = 0;
var _frameInputSource = '';

function setCanvasImageQuality(context) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
}

BoardRenderer = BoardfishRenderer.createBoardRenderer({
  objects: () => objects,
  imageStore: () => imageStore,
  imageCache: () => imageCache,
  imageBitmapCache: () => imageBitmapCache,
  viewportCullingEnabled: () => viewportCullingEnabled,
  zoom: () => zoom,
  panX: () => panX,
  panY: () => panY,
  dpr: () => window.devicePixelRatio || 1,
  font: FONT,
  textPad: TEXT_PAD,
  textBaselineYOffset: () => TEXT_BASELINE_Y_OFFSET,
  lineHeight: LINE_H,
  canvasTextColor,
  currentViewportWorldRect,
  getWrappedLines,
  imageTransformFromObject,
  imageTransformNeedsRendering,
  isSidewaysRotation,
  objectIntersectsRect,
  selectImageSourceForDraw,
  setCanvasImageQuality,
});

const BoardObjectGeometry = BoardfishObjectGeometry.createObjectGeometry({
  imageTransformFromObject,
  isSidewaysRotation,
  objects: () => objects,
});

function withRenderSource(source, fn) {
  const prev = _activeRenderSource;
  _activeRenderSource = source || prev;
  try {
    return fn();
  } finally {
    _activeRenderSource = prev;
  }
}

function viewportEventTime(event = null) {
  const timestamp = Number(event?.timeStamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return performance.now();
  return timestamp > performance.timeOrigin ? timestamp - performance.timeOrigin : timestamp;
}

function scheduleFrame(source = 'unknown') {
  if (source) _frameSources.push(source);
  if (_frameRaf) {
    ViewportDebug.count('coalescedFrames');
    return;
  }
  const collectDebug = ViewportDebug.isEnabled();
  _frameScheduledAt = collectDebug ? performance.now() : 0;
  ViewportDebug.count('scheduledFrames');
  _frameRaf = requestAnimationFrame(() => {
    const sources = [...new Set(_frameSources)];
    _frameSources = [];
    const doTransform = _needTransform;
    const doBoard = _needBoardRender;
    const doOverlay = _needOverlayRender;
    const inputAt = doTransform ? _frameInputAt : 0;
    const inputSource = doTransform ? _frameInputSource : '';
    const frameMeta = inputAt ? {
      inputAgeMs: Math.max(0, performance.now() - inputAt),
      inputSource,
    } : {};
    const frameDbg = collectDebug ? ViewportDebug.frameStart(performance.now() - _frameScheduledAt, frameMeta) : null;
    ViewportDebug.step(frameDbg, 'sources', { sources: sources.join(',') });
    _frameRaf = null;
    _needTransform = false;
    _needBoardRender = false;
    _needOverlayRender = false;
    if (doTransform) {
      _frameInputAt = 0;
      _frameInputSource = '';
    }

    if (doTransform) {
      ViewportDebug.count('transformFrames');
      const transformStart = collectDebug ? performance.now() : 0;
      withRenderSource(sources.join(',') || 'transform', () => applyTransform(frameDbg));
      if (collectDebug) ViewportDebug.step(frameDbg, 'applyTransformCall', { ms: performance.now() - transformStart });
      ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sources.join(',') });
      return;
    }
    if (doBoard) {
      ViewportDebug.count('boardFrames');
      const drawStart = collectDebug ? performance.now() : 0;
      withRenderSource(sources.join(',') || 'board', () => drawBoard());
      if (collectDebug) ViewportDebug.step(frameDbg, 'drawBoard', { ms: performance.now() - drawStart, ...(_lastDrawBoardMeta || {}) });
    }
    if (doOverlay) {
      const overlayStart = collectDebug ? performance.now() : 0;
      ViewportDebug.count('overlayFrames');
      updateSelectionOverlay();
      if (collectDebug) ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: performance.now() - overlayStart });
    }
    ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sources.join(',') });
  });
}

function scheduleTransform(source = 'transform', inputEvent = null) {
  lastViewportInputAt = performance.now();
  _frameInputAt = viewportEventTime(inputEvent);
  _frameInputSource = source;
  _needTransform = true;
  syncIslandZoomDisplay(source);
  scheduleFrame(source);
}

function scheduleRender(board = true, overlay = true, source = 'render') {
  if (board) _needBoardRender = true;
  if (overlay) _needOverlayRender = true;
  scheduleFrame(source);
}
