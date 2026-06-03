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

const setPillMessageText = (text, { animate = true } = {}) => {
  const nextText = text == null ? '' : String(text);
  const previousText = islZoom.textContent || '';
  const textChanged = previousText !== nextText;
  islZoom.textContent = nextText;
  syncOpeningShieldPill(nextText);
  if (animate && textChanged) globalThis.BoardfishMotion?.applyActionAnimation?.('pill-message-update', { pill: true });
  return textChanged;
};

function setIslandVisible(visible) {
  if (island.classList.contains('visible') !== visible) island.classList.toggle('visible', visible);
  const ariaHidden = visible ? 'false' : 'true';
  if (island.getAttribute?.('aria-hidden') !== ariaHidden) island.setAttribute('aria-hidden', ariaHidden);
}

const syncIslandZoomDisplay = (reason = 'zoom-sync') => {
  if (_islMsgActive) return;
  const zoomText = formatZoomPercent();
  const changed = island.dataset.mode !== 'zoom' || _lastIslandZoomText !== zoomText || !island.classList.contains('visible');
  if (islZoom.textContent !== zoomText) islZoom.textContent = zoomText;
  _lastIslandZoomText = zoomText;
  if (island.dataset.mode !== 'zoom') island.dataset.mode = 'zoom';
  if (island.title !== 'Reset Zoom') island.title = 'Reset Zoom';
  setIslandVisible(true);
  if (changed) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('pill-message-open', { pill: true });
    PillDebug.log('zoomIsland:shown', { reason, zoom, text: zoomText });
  }
};

function showIslandForMessage(text) {
  const wasVisible = island.classList.contains('visible');
  const previousMode = island.dataset.mode;
  island.dataset.mode = 'message';
  island.title = '';
  setIslandVisible(true);
  const textChanged = setPillMessageText(text, { animate: false });
  if (!wasVisible || previousMode !== 'message' || textChanged) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('pill-message-open', { pill: true });
  }
}

function hideIsland(reason = 'hide') {
  ++_islMsgToken;
  clearTimeout(_islMsgTimer);
  _islMsgTimer = null;
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
  _islMsgTimer = null;
  _islMsgActive = true;
  showIslandForMessage(text);
  PillDebug.log('busyIslandMsg:shown', { text });

  return {
    update(nextText) {
      if (token !== _islMsgToken) return;
      setPillMessageText(nextText);
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
  _islMsgTimer = null;
  _islMsgActive = true;
  showIslandForMessage(msg);
  PillDebug.log('showIslandMsg:shown', { msg });
  if (duration > 0) {
    _islMsgTimer = setTimeout(() => {
      if (token !== _islMsgToken) return;
      _islMsgTimer = null;
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

  // Images are decoded into ImageBitmap by cacheImage(); no retained
  // HTMLImageElement source remains for offscreen rebuilds.
  const bitmapPromises = [];
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

function drawVisibleObjects(context, counters, { skipId = null, viewportRect = currentViewportWorldRect(), view = { zoom, dpr: window.devicePixelRatio || 1 }, imageSourceResolver = null, skipText = false } = {}) {
  return BoardRenderer.drawVisibleObjects(context, counters, { skipId, viewportRect, view, imageSourceResolver, skipText });
}

const collectTextSelectionRuns = (obj, layout, selStart, selEnd) => {
  if (selStart === selEnd) return null;
  const runs = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const selectionBoxForState = (line, state) => {
    if (state?.depth > 0) {
      return {
        y: line.textY + state.offset - (TEXT_BASELINE_Y_OFFSET * state.scale),
        height: LINE_H * state.scale,
      };
    }
    return { y: line.y, height: LINE_H };
  };
  for (const line of layout) {
    const ls = line.startIndex, textEnd = ls + line.text.length;
    const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
    if (h0 < h1) {
      const o0 = h0 - ls, o1 = h1 - ls;
      const endX = lineEndX(line, obj);
      let i = o0;
      while (i < o1) {
        const globalIndex = line.startIndex + i;
        if (typeof isTextScriptMarkerHiddenAt === 'function' && isTextScriptMarkerHiddenAt(line.scriptRanges || [], globalIndex, line.content || '')) {
          i++;
          continue;
        }
        const state = typeof textScriptStateAt === 'function'
          ? textScriptStateAt(line.scriptRanges || [], globalIndex)
          : { key: '', depth: 0, offset: 0, scale: 1 };
        let j = i + 1;
        while (j < o1) {
          const nextGlobalIndex = line.startIndex + j;
          if (typeof isTextScriptMarkerHiddenAt === 'function' && isTextScriptMarkerHiddenAt(line.scriptRanges || [], nextGlobalIndex, line.content || '')) break;
          const nextState = typeof textScriptStateAt === 'function'
            ? textScriptStateAt(line.scriptRanges || [], nextGlobalIndex)
            : { key: '', depth: 0, offset: 0, scale: 1 };
          if (nextState.key !== state.key) break;
          j++;
        }
        const x1 = i < line.text.length ? lineXAtOffset(line, obj, i) : endX;
        const x2 = j < line.text.length ? lineXAtOffset(line, obj, j) : endX;
        const box = selectionBoxForState(line, state);
        const run = {
          line,
          x1,
          x2,
          y: box.y,
          height: box.height,
          startOffset: i,
          endOffset: j,
          text: line.text.slice(i, j),
        };
        runs.push(run);
        if (x1 < left) left = x1;
        if (box.y < top) top = box.y;
        if (x2 > right) right = x2;
        if (box.y + box.height > bottom) bottom = box.y + box.height;
        i = j;
      }
    }
  }
  if (!runs.length) return null;
  return {
    runs,
    bounds: { left, top, right, bottom },
  };
};

const textSelectionMotionForOptions = (obj, selStart, selEnd, options = {}) => {
  if (Object.prototype.hasOwnProperty.call(options, 'motion')) return options.motion || null;
  return globalThis.BoardfishMotion?.textSelectionMotionForDraw?.(obj.id, selStart, selEnd, { view: options.view }) || null;
};

const textSelectionRunsForOptions = (obj, layout, selStart, selEnd, options = {}) => {
  if (Object.prototype.hasOwnProperty.call(options, 'selection')) return options.selection || null;
  return collectTextSelectionRuns(obj, layout, selStart, selEnd);
};

const applyTextSelectionMotionTransform = (context, bounds, motion) => {
  if (!motion) return false;
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  const scaleX = motion.scaleX ?? 1;
  const scaleY = motion.scaleY ?? 1;
  const translateX = Number.isFinite(motion.translateX) ? motion.translateX : 0;
  const translateY = Number.isFinite(motion.translateY) ? motion.translateY : 0;
  context.globalAlpha = (Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1) * (motion.opacity ?? 1);
  if (translateX || translateY) context.translate(translateX, translateY);
  if (scaleX !== 1 || scaleY !== 1) {
    context.translate(cx, cy);
    context.scale(scaleX, scaleY);
    context.translate(-cx, -cy);
  }
  return true;
};

const drawTextLayoutStatic = (context, obj, layout, selectionGap = null) => {
  context.fillStyle = canvasTextColor();
  if (!selectionGap) {
    for (const line of layout) drawTextLineRange(context, line, obj);
    return;
  }
  const selStart = Math.min(selectionGap.start, selectionGap.end);
  const selEnd = Math.max(selectionGap.start, selectionGap.end);
  for (const line of layout) {
    const ls = line.startIndex, textEnd = ls + line.text.length;
    const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
    if (h0 >= h1) {
      drawTextLineRange(context, line, obj);
      continue;
    }
    const o0 = h0 - ls, o1 = h1 - ls;
    const before = line.text.slice(0, o0);
    const after = line.text.slice(o1);
    if (before) drawTextLineRange(context, line, obj, 0, o0);
    if (after) drawTextLineRange(context, line, obj, o1, line.text.length);
  }
};

function drawTextSelectionHighlight(context, obj, layout, selStart, selEnd, options = {}) {
  if (selStart === selEnd) return false;
  const requireMotion = options.requireMotion === true;
  const selection = textSelectionRunsForOptions(obj, layout, selStart, selEnd, options);
  if (!selection) return false;
  const motion = textSelectionMotionForOptions(obj, selStart, selEnd, options);
  if (requireMotion && !motion) return false;
  context.save();
  applyTextSelectionMotionTransform(context, selection.bounds, motion);
  context.fillStyle = 'rgba(10, 132, 255, 0.3)';
  for (const run of selection.runs) {
    TextSelDebug._logDraw(run.line, selStart, selEnd, run.x1, run.x2);
    context.fillRect(run.x1, run.y ?? run.line.y, run.x2 - run.x1, run.height ?? LINE_H);
  }
  context.restore();
  return true;
}

const drawTextSelectionContentJello = (context, obj, layout, selStart, selEnd, options = {}) => {
  const selection = textSelectionRunsForOptions(obj, layout, selStart, selEnd, options);
  if (!selection) return false;
  const motion = textSelectionMotionForOptions(obj, selStart, selEnd, options);
  if (!motion) return false;
  context.save();
  applyTextSelectionMotionTransform(context, selection.bounds, motion);
  context.fillStyle = canvasTextColor();
  for (const run of selection.runs) {
    if (run.text) drawTextLineRange(context, run.line, obj, run.startOffset, run.endOffset);
  }
  context.restore();
  return true;
};

const drawTextSelectionJelloOverlays = (context, viewportRect = null, view = { zoom, panX, panY, dpr: window.devicePixelRatio || 1 }) => {
  const specs = globalThis.BoardfishMotion?.textSelectionJelloSpecsForDraw?.() || [];
  if (!specs.length) return 0;
  let drawn = 0;
  for (const spec of specs) {
    if (spec.id === editingId) continue;
    const obj = objectsMap.get(spec.id);
    if (!obj || obj.type !== 'text') continue;
    if (viewportCullingEnabled && viewportRect && !objectIntersectsRect(obj, viewportRect)) continue;
    const layout = getTextLayout(obj);
    const motion = globalThis.BoardfishMotion?.textSelectionMotionForDraw?.(spec.id, spec.start, spec.end, { view }) || null;
    if (!motion) continue;
    const selection = collectTextSelectionRuns(obj, layout, spec.start, spec.end);
    if (!drawTextSelectionHighlight(context, obj, layout, spec.start, spec.end, { requireMotion: true, motion, selection })) continue;
    drawTextLayoutStatic(context, obj, layout, { start: spec.start, end: spec.end });
    drawTextSelectionContentJello(context, obj, layout, spec.start, spec.end, { motion, selection });
    drawn++;
  }
  return drawn;
};

function drawCaret(context, obj, layout, selStart) {
  if (!_caretVisible) return;
  let cx = obj.x + TEXT_PAD, cy = obj.y + TEXT_PAD;
  let caretHeight = LINE_H;
  for (const line of layout) {
    const ls = line.startIndex;
    const le = line.caretEndIndex ?? line.endIndex ?? (ls + line.text.length);
    if (selStart >= ls && selStart <= le) {
      const off = Math.min(selStart - ls, line.text.length);
      cx = off < line.text.length ? lineXAtOffset(line, obj, off) : lineEndX(line, obj);
      const state = typeof textScriptCaretStateAt === 'function'
        ? textScriptCaretStateAt(obj, selStart)
        : { depth: 0, offset: 0, scale: 1 };
      if (state?.depth > 0) {
        const scale = Number.isFinite(state.scale) && state.scale > 0 ? state.scale : 1;
        const textY = Number.isFinite(line.textY) ? line.textY : line.y + TEXT_BASELINE_Y_OFFSET;
        cy = textY + state.offset - (TEXT_BASELINE_Y_OFFSET * scale);
        caretHeight = LINE_H * scale;
      } else {
        cy = line.y;
        caretHeight = LINE_H;
      }
      break;
    }
  }
  context.fillStyle = canvasTextColor();
  context.fillRect(cx, cy, 2 / zoom, caretHeight);
}

const applyObjectMotionForDraw = (context, obj, motion) => {
  if (!motion || motion.skip || !context.save) return false;
  context.save();
  const opacity = Number.isFinite(motion.opacity) ? Math.max(0, Math.min(1, motion.opacity)) : 1;
  const scale = Number.isFinite(motion.scale) ? Math.max(0.01, motion.scale) : 1;
  const scaleX = Number.isFinite(motion.scaleX) ? Math.max(0.01, motion.scaleX) : scale;
  const scaleY = Number.isFinite(motion.scaleY) ? Math.max(0.01, motion.scaleY) : scale;
  const translateX = Number.isFinite(motion.translateX) ? motion.translateX : 0;
  const translateY = Number.isFinite(motion.translateY) ? motion.translateY : 0;
  context.globalAlpha = (Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1) * opacity;
  if (translateX || translateY) context.translate(translateX, translateY);
  if (scaleX !== 1 || scaleY !== 1) {
    context.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
    context.scale(scaleX, scaleY);
    context.translate(-(obj.x + obj.w / 2), -(obj.y + obj.h / 2));
  }
  return true;
};

function drawEditingTextOverlay(context, options = {}) {
  const obj = objectsMap.get(editingId);
  if (!obj || obj.type !== 'text') return;
  const view = options.view || { zoom, panX, panY, dpr: window.devicePixelRatio || 1 };
  const viewportRect = options.viewportRect || currentViewportWorldRect(0);
  const motion = globalThis.BoardfishMotion?.objectMotionForDraw(obj, { view, viewportRect });
  if (motion?.skip) return;
  const restoreMotion = applyObjectMotionForDraw(context, obj, motion);
  try {
    context.font = FONT;
    context.textBaseline = 'alphabetic';

    const selStart = _editEl ? _editEl.selectionStart : 0;
    const selEnd   = _editEl ? _editEl.selectionEnd   : 0;
    const layout = getTextLayout(obj);
    const textSelectionMotion = selStart !== selEnd
      ? globalThis.BoardfishMotion?.textSelectionMotionForDraw?.(obj.id, selStart, selEnd, { view }) || null
      : null;
    const selection = collectTextSelectionRuns(obj, layout, selStart, selEnd);

    drawTextSelectionHighlight(context, obj, layout, selStart, selEnd, { motion: textSelectionMotion, selection });

    drawTextLayoutStatic(
      context,
      obj,
      layout,
      textSelectionMotion ? { start: selStart, end: selEnd } : null,
    );
    drawTextSelectionContentJello(context, obj, layout, selStart, selEnd, { motion: textSelectionMotion, selection });

    if (selStart === selEnd) drawCaret(context, obj, layout, selStart);
  } finally {
    if (restoreMotion) context.restore();
  }
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
  const counters = collectDrawDebug ? createDrawCounters() : null;
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
    const overlayView = { zoom, panX, panY, dpr };
    drawTextSelectionJelloOverlays(ctx, viewportRect, overlayView);
    drawEditingTextOverlay(ctx, { view: overlayView, viewportRect });
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
    drawTextSelectionJelloOverlays(ctx, viewportRect, { zoom, panX, panY, dpr });
    const resetStart = collectDrawDebug ? performance.now() : 0;
    resetCanvasToScreen(ctx);
    if (collectDrawDebug) drawPhases.resetMs = performance.now() - resetStart;
  }
  if (collectDrawDebug) {
    ViewportDebug.count('croppedImages', counters.croppedImages);
    ViewportDebug.count('imageDrawMissing', counters.missingImages);
    ViewportDebug.count('imageDrawFallback', counters.fallbackImages);
    ViewportDebug.count('imageDrawErrors', counters.erroredImages);
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
  drawTextLineRange,
  getTextLayout,
  getWrappedLines,
  imageTransformFromObject,
  imageTransformNeedsRendering,
  isSidewaysRotation,
  objectIntersectsRect,
  motionObjectsForDraw: (options) => globalThis.BoardfishMotion?.motionObjectsForDraw(options) || [],
  noteImageObjectDrawn: (obj) => globalThis.BoardfishImageInsertMotion?.noteDrawn(obj),
  objectMotionForDraw: (obj, options) => globalThis.BoardfishMotion?.objectMotionForDraw(obj, options) || null,
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
    const sources = _frameSources.length <= 1 ? _frameSources : [...new Set(_frameSources)];
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
