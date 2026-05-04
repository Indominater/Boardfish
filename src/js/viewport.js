// ─── Viewport ─────────────────────────────────────────────────────────────────
var panX = 0, panY = 0, zoom = 1;
var _vpSaveTimer = null;
var BoardRenderer = null;
function saveViewport() {
  clearTimeout(_vpSaveTimer);
  _vpSaveTimer = setTimeout(() => {
    localStorage.setItem('bf_vp', JSON.stringify({ panX, panY, zoom }));
  }, 400);
}


// PillDebug and MenuDebug are initialized by js/viewport_debug_ui.js.

function islSetWidth(text) {
  PillDebug.log('islSetWidth:before', { text });
  const measuredWidth = measureIslandTextWidth(text);
  islZoom.style.width = measuredWidth + 'px';
  PillDebug.log('islSetWidth:after', { text, measuredWidth });
}

function measureIslandTextWidth(text) {
  islMeasure.textContent = text;
  return islMeasure.offsetWidth;
}
var _lastZoomPct = -1;
var _islMsgActive = false;
var _imageCopyInFlight = 0;
var _lastZoomDisplayAt = 0;
var _zoomDisplayTimer = null;

function applyIslandInteractionState() {
  const disabled = _islMsgActive || _imageCopyInFlight > 0;
  islZoom.style.pointerEvents = disabled ? 'none' : '';
  islZoom.style.cursor = disabled ? 'default' : '';
}

function beginImageCopyInteractionLock() {
  _imageCopyInFlight += 1;
  applyIslandInteractionState();
}

function endImageCopyInteractionLock() {
  _imageCopyInFlight = Math.max(0, _imageCopyInFlight - 1);
  applyIslandInteractionState();
}

function updateZoomDisplay(force = false) {
  if (_islMsgActive) return;
  const pct = Math.round(zoom * 100);
  if (pct === _lastZoomPct) return;
  const now = performance.now();
  if (!force && now - _lastZoomDisplayAt < 80) {
    clearTimeout(_zoomDisplayTimer);
    _zoomDisplayTimer = setTimeout(() => updateZoomDisplay(true), 90);
    return;
  }
  _lastZoomDisplayAt = now;
  _lastZoomPct = pct;
  const text = pct + '%';
  PillDebug.log('updateZoomDisplay:set', { force, text });
  islZoom.textContent = text;
  islSetWidth(text);
}
var _islMsgTimer = null;
var _islFadeTimer = null;
var _islAnimToken = 0;

function islandTextAlpha() {
  const color = getComputedStyle(islZoom).color;
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(',').map((part) => part.trim());
  return parts.length >= 4 ? Number(parts[3]) || 0 : 1;
}

function waitForIslandTransition(propertyName, timeoutMs = 700) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      islZoom.removeEventListener('transitionend', onEnd);
      islZoom.removeEventListener('transitioncancel', onCancel);
      resolve(reason);
    };
    const onEnd = (event) => {
      if (event.target === islZoom && event.propertyName === propertyName) finish('transitionend');
    };
    const onCancel = (event) => {
      if (event.target === islZoom && event.propertyName === propertyName) finish('transitioncancel');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    islZoom.addEventListener('transitionend', onEnd);
    islZoom.addEventListener('transitioncancel', onCancel);
  });
}

function forceIslandTextTransparent() {
  const transition = islZoom.style.transition;
  islZoom.style.transition = 'none';
  islZoom.style.color = TRANSPARENT_TEXT_COLOR;
  void islZoom.offsetWidth;
  islZoom.style.transition = transition;
  PillDebug.log('forceIslandTextTransparent');
}

function waitForIslandFrames(count = 1, token = _islAnimToken) {
  return new Promise((resolve) => {
    const step = (remaining) => {
      requestAnimationFrame(() => {
        if (token !== _islAnimToken) { resolve('stale'); return; }
        if (remaining <= 1) { resolve('frames'); return; }
        step(remaining - 1);
      });
    };
    step(Math.max(1, count));
  });
}

async function fadeIslandTextTo(color, { token = _islAnimToken, timeoutMs = 700, skipTransparent = false } = {}) {
  if (token !== _islAnimToken) return 'stale';
  const alreadyTransparent = skipTransparent && color === TRANSPARENT_TEXT_COLOR && islandTextAlpha() <= 0.05;
  const done = alreadyTransparent
    ? Promise.resolve('already-transparent')
    : waitForIslandTransition('color', timeoutMs);
  islZoom.style.color = color;
  const reason = await done;
  if (token !== _islAnimToken) return 'stale';
  return reason;
}

function startIslandBusyMsg(text) {
  const token = ++_islAnimToken;
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  _islMsgActive = true;
  applyIslandInteractionState();
  islZoom.style.color = islandStatusTextColor();
  islSetWidth(text);
  islZoom.textContent = text;
  PillDebug.samplePillAnimation('busyIslandMsg');

  return {
    update(nextText) {
      if (token !== _islAnimToken) return;
      islSetWidth(nextText);
      islZoom.textContent = nextText;
    },
    done(finalMsg = null, duration = 1500, onRestore = null) {
      if (token !== _islAnimToken) return;
      if (finalMsg) return showIslandMsg(finalMsg, duration, onRestore);
      return restoreIslandZoom();
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

function finishPillTransition({
  beforeTransition = null,
  busyPill = null,
  finalMsg = null,
  duration = 1500,
} = {}) {
  if (beforeTransition) beforeTransition();
  if (busyPill) return busyPill.done(finalMsg, duration);
  if (finalMsg) return showIslandMsg(finalMsg, duration);
  return restoreIslandZoom();
}

function waitForPillFrameReady({ stableFramesNeeded = 4, maxFrameGapMs = 34, minWaitMs = 120, timeoutMs = 1800 } = {}) {
  const start = performance.now();
  let lastFrame = start;
  let stableFrames = 0;
  return new Promise((resolve) => {
    const tick = (now) => {
      const elapsed = now - start;
      const frameGapMs = now - lastFrame;
      lastFrame = now;
      if (frameGapMs <= maxFrameGapMs) stableFrames += 1;
      else stableFrames = 0;
      if (elapsed >= minWaitMs && stableFrames >= stableFramesNeeded) {
        PillDebug.log('pill-frame-ready', { elapsed, frameGapMs, stableFrames });
        resolve('stable');
        return;
      }
      if (elapsed >= timeoutMs) {
        PillDebug.log('pill-frame-wait-timeout', { elapsed, frameGapMs, stableFrames });
        resolve('timeout');
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function showIslandMsg(msg, duration = 0, onRestore = null) {
  const token = ++_islAnimToken;
  PillDebug.log('showIslandMsg:start', { msg, duration });
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  _islMsgActive = true;
  applyIslandInteractionState();
  islSetWidth(msg);
  PillDebug.samplePillAnimation('showIslandMsg');
  const timerStart = performance.now();
  PillDebug.log('showIslandMsg:fadeOut', { msg, computedColor: getComputedStyle(islZoom).color, transition: getComputedStyle(islZoom).transition });
  const fadeOutReason = await fadeIslandTextTo(TRANSPARENT_TEXT_COLOR, { token, skipTransparent: true });
  if (token !== _islAnimToken) return 'stale';
  PillDebug.log('showIslandMsg:fadeOutComplete', { msg, reason: fadeOutReason, elapsed: performance.now() - timerStart });
  PillDebug.log('showIslandMsg:fadeIn', { msg, computedColorBefore: getComputedStyle(islZoom).color });
  islZoom.textContent = msg;
  const fadeInReason = await fadeIslandTextTo(islandStatusTextColor(), { token });
  PillDebug.log('showIslandMsg:fadeInSet', { computedColorAfter: getComputedStyle(islZoom).color });
  if (token !== _islAnimToken) return 'stale';
  PillDebug.log('showIslandMsg:resolved', { msg, reason: fadeInReason, elapsed: performance.now() - timerStart });
  if (duration > 0) {
    _islMsgTimer = setTimeout(async () => {
      if (token !== _islAnimToken) return;
      const zoomRestoreReason = await restoreIslandZoom();
      if (onRestore) onRestore();
      PillDebug.log('showIslandMsg:onRestore', { msg, zoomRestoreReason });
    }, duration);
  }
  return fadeInReason;
}

async function restoreIslandZoom() {
  const token = ++_islAnimToken;
  PillDebug.log('restoreIslandZoom:start');
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  const pct = Math.round(zoom * 100) + '%';
  const frameReadyReason = await waitForPillFrameReady();
  if (token !== _islAnimToken) return;
  PillDebug.log('restoreIslandZoom:frame-ready', { reason: frameReadyReason });
  const currentWidth = islZoom.getBoundingClientRect().width;
  const targetWidth = measureIslandTextWidth(pct);
  const widthDone = Math.abs(currentWidth - targetWidth) < 0.5
    ? Promise.resolve('same-width')
    : waitForIslandTransition('width', 700);
  islSetWidth(pct);
  PillDebug.samplePillAnimation('restoreIslandZoom', 1800);
  PillDebug.log('restoreIslandZoom:width-set', { pct });
  PillDebug.log('restoreIslandZoom:fadeOut');
  const [widthReason, fadeOutReason] = await Promise.all([
    widthDone,
    fadeIslandTextTo(TRANSPARENT_TEXT_COLOR, { token, skipTransparent: true }),
  ]);
  if (token !== _islAnimToken) return;
  PillDebug.log('restoreIslandZoom:widthComplete', { reason: widthReason });
  PillDebug.log('restoreIslandZoom:fadeOutComplete', { reason: fadeOutReason });
  if (islandTextAlpha() > 0.05) {
    forceIslandTextTransparent();
    if (token !== _islAnimToken) return;
  }
  _islMsgActive = false;
  _lastZoomPct = -1;
  islZoom.textContent = pct;
  PillDebug.log('restoreIslandZoom:text-set', { pct });
  const frameReason = await waitForIslandFrames(2, token);
  if (token !== _islAnimToken) return 'stale';
  PillDebug.log('restoreIslandZoom:frames-ready', { pct, reason: frameReason });
  const colorReason = await fadeIslandTextTo(islandTextColor(), { token });
  applyIslandInteractionState();
  PillDebug.log('restoreIslandZoom:shown', { pct, colorReason });
  return colorReason;
}

islZoom.addEventListener('transitionstart', (event) => {
  PillDebug.log('transitionstart', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
islZoom.addEventListener('transitionend', (event) => {
  PillDebug.log('transitionend', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
islZoom.addEventListener('transitioncancel', (event) => {
  PillDebug.log('transitioncancel', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
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
    if (!key || imageBitmapCache[key]) continue;
    const img = imageCache[key];
    if (!img || !img.complete) continue;
    bitmapPromises.push(
      img.decode()
        .then(() => createImageBitmap(img))
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
  const viewportRect = currentViewportWorldRect();
  for (const obj of objects) {
    if (obj.id === editingId) continue;
    if (viewportCullingEnabled && !objectIntersectsRect(obj, viewportRect)) continue;
    drawSingleObj(_offCtx, obj);
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
function drawSingleObj(context, obj, counters = null, { view = { zoom, dpr: window.devicePixelRatio || 1 }, imageSourceResolver = null } = {}) {
  return BoardRenderer.drawSingleObj(context, obj, counters, { view, imageSourceResolver });
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
  const viewportRect = currentViewportWorldRect();
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
    ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  if (editingId) invalidateOffscreen();
  const collectTransformDebug = ViewportDebug.isEnabled();
  const drawStart = collectTransformDebug ? performance.now() : 0;
  drawBoard();
  const drawMs = collectTransformDebug ? performance.now() - drawStart : 0;
  if (collectTransformDebug) {
    ViewportDebug.step(dbg, 'drawBoard', { ms: drawMs, ...(_lastDrawBoardMeta || {}) });
    ViewportDebug.step(frameDbg, 'drawBoard', { ms: drawMs, ...(_lastDrawBoardMeta || {}) });
  }
  const zoomStart = collectTransformDebug ? performance.now() : 0;
  updateZoomDisplay();
  const zoomMs = collectTransformDebug ? performance.now() - zoomStart : 0;
  if (collectTransformDebug) {
    ViewportDebug.step(dbg, 'updateZoomDisplay', { ms: zoomMs });
    ViewportDebug.step(frameDbg, 'updateZoomDisplay', { ms: zoomMs });
  }
  const saveStart = collectTransformDebug ? performance.now() : 0;
  saveViewport();
  const saveMs = collectTransformDebug ? performance.now() - saveStart : 0;
  if (collectTransformDebug) {
    ViewportDebug.step(dbg, 'saveViewport', { ms: saveMs });
    ViewportDebug.step(frameDbg, 'saveViewport', { ms: saveMs });
  }
  const overlayStart = collectTransformDebug ? performance.now() : 0;
  updateSelectionOverlay();
  const overlayMs = collectTransformDebug ? performance.now() - overlayStart : 0;
  if (collectTransformDebug) {
    ViewportDebug.step(dbg, 'updateSelectionOverlay', { ms: overlayMs });
    ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: overlayMs });
  }
  scheduleVisibleHydrationAfterIdle();
  if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
    scheduleVisibleScaledVariantPrewarmAfterIdle(_activeRenderSource || 'transform');
  }
  if (typeof handleEyedropperViewportChanged === 'function') {
    handleEyedropperViewportChanged(_activeRenderSource || 'transform');
  }
  ViewportDebug.end(dbg);
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
  textBaselineYOffset: TEXT_BASELINE_Y_OFFSET,
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
    const frameDbg = collectDebug ? ViewportDebug.frameStart(performance.now() - _frameScheduledAt) : null;
    ViewportDebug.step(frameDbg, 'sources', { sources: sources.join(',') });
    _frameRaf = null;
    const doTransform = _needTransform;
    const doBoard = _needBoardRender;
    const doOverlay = _needOverlayRender;
    _needTransform = false;
    _needBoardRender = false;
    _needOverlayRender = false;

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

function scheduleTransform(source = 'transform') {
  lastViewportInputAt = performance.now();
  _needTransform = true;
  scheduleFrame(source);
}

function scheduleRender(board = true, overlay = true, source = 'render') {
  if (board) _needBoardRender = true;
  if (overlay) _needOverlayRender = true;
  scheduleFrame(source);
}
