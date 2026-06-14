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

const collectTextSelectionRuns = (obj, layout, selStart, selEnd, options = {}) => {
  const viewportRect = options.viewportRect || null;
  if (selStart === selEnd) return null;
  const firstLine = layout.find((line) => Array.isArray(line?.scriptRanges) && line.scriptRanges.length);
  const content = normalizeTextContent(obj?.data?.content || '');
  const scriptMetrics = firstLine?._scriptMetrics ||
    (firstLine && typeof getTextScriptLayoutMetricsForObject === 'function'
      ? getTextScriptLayoutMetricsForObject(obj, content, firstLine.scriptRanges || [])
      : null) ||
    (firstLine && typeof getTextScriptLayoutMetrics === 'function'
      ? getTextScriptLayoutMetrics(content, firstLine.scriptRanges || [])
      : null);
  const isHiddenAt = (line, globalIndex) => {
    if (scriptMetrics && typeof textScriptMetricsHiddenAt === 'function') {
      return textScriptMetricsHiddenAt(scriptMetrics, globalIndex);
    }
    return typeof isTextScriptMarkerHiddenAt === 'function' &&
      isTextScriptMarkerHiddenAt(line.scriptRanges || [], globalIndex, content);
  };
  const stateAt = (line, globalIndex) => {
    if (scriptMetrics && typeof textScriptMetricsStateAt === 'function') {
      return textScriptMetricsStateAt(scriptMetrics, globalIndex);
    }
    return typeof textScriptStateAt === 'function'
      ? textScriptStateAt(line.scriptRanges || [], globalIndex)
      : { key: '', depth: 0, offset: 0, scale: 1 };
  };
  const runs = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let scannedLines = 0;
  let selectedLines = 0;
  let hiddenChars = 0;
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
    if (!textLayoutLineIntersectsViewport(line, viewportRect)) continue;
    scannedLines++;
    const ls = line.startIndex, textEnd = ls + line.text.length;
    const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
    if (h0 < h1) {
      selectedLines++;
      const o0 = h0 - ls, o1 = h1 - ls;
      const endX = lineEndX(line, obj);
      let i = o0;
      while (i < o1) {
        const globalIndex = line.startIndex + i;
        if (isHiddenAt(line, globalIndex)) {
          hiddenChars++;
          i++;
          continue;
        }
        const state = stateAt(line, globalIndex);
        let j = i + 1;
        while (j < o1) {
          const nextGlobalIndex = line.startIndex + j;
          if (isHiddenAt(line, nextGlobalIndex)) break;
          const nextState = stateAt(line, nextGlobalIndex);
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
    metrics: {
      scannedLines,
      selectedLines,
      hiddenChars,
      selectedChars: Math.abs((selEnd ?? 0) - (selStart ?? 0)),
    },
  };
};

const textSelectionMotionForOptions = (obj, selStart, selEnd, options = {}) => {
  if (Object.prototype.hasOwnProperty.call(options, 'motion')) return options.motion || null;
  return globalThis.BoardfishMotion?.textSelectionMotionForDraw?.(obj.id, selStart, selEnd, { view: options.view }) || null;
};

const textSelectionRunsForOptions = (obj, layout, selStart, selEnd, options = {}) => {
  if (Object.prototype.hasOwnProperty.call(options, 'selection')) return options.selection || null;
  return collectTextSelectionRuns(obj, layout, selStart, selEnd, { viewportRect: options.viewportRect || null });
};

const TEXT_SELECTION_RECT_EPSILON = 1e-7;

const textSelectionSortedUniqueCoordinates = (values) => {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const unique = [];
  for (const value of sorted) {
    if (!unique.length || Math.abs(unique[unique.length - 1] - value) > TEXT_SELECTION_RECT_EPSILON) {
      unique.push(value);
    }
  }
  return unique;
};

const textSelectionHighlightRects = (runs = []) => {
  const rects = [];
  const yEdges = [];
  for (const run of runs) {
    const x1 = Math.min(Number(run.x1), Number(run.x2));
    const x2 = Math.max(Number(run.x1), Number(run.x2));
    const y1 = Number(run.y ?? run.line?.y);
    const height = Number(run.height ?? LINE_H);
    const y2 = y1 + height;
    if (!(x2 - x1 > TEXT_SELECTION_RECT_EPSILON && y2 - y1 > TEXT_SELECTION_RECT_EPSILON)) continue;
    rects.push({ x1, x2, y1, y2 });
    yEdges.push(y1, y2);
  }
  if (rects.length <= 1) {
    return rects.map((rect) => ({
      x: rect.x1,
      y: rect.y1,
      w: rect.x2 - rect.x1,
      h: rect.y2 - rect.y1,
    }));
  }

  rects.sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2 || a.x1 - b.x1 || a.x2 - b.x2);
  const edges = textSelectionSortedUniqueCoordinates(yEdges);
  const mergedRects = [];
  let nextRectIndex = 0;
  let activeRects = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const y1 = edges[i];
    const y2 = edges[i + 1];
    if (!(y2 - y1 > TEXT_SELECTION_RECT_EPSILON)) continue;
    while (
      nextRectIndex < rects.length &&
      rects[nextRectIndex].y1 <= y1 + TEXT_SELECTION_RECT_EPSILON
    ) {
      activeRects.push(rects[nextRectIndex]);
      nextRectIndex++;
    }
    activeRects = activeRects.filter((rect) => rect.y2 >= y2 - TEXT_SELECTION_RECT_EPSILON);
    const intervals = activeRects
      .filter((rect) => rect.y1 <= y1 + TEXT_SELECTION_RECT_EPSILON && rect.y2 >= y2 - TEXT_SELECTION_RECT_EPSILON)
      .map((rect) => ({ x1: rect.x1, x2: rect.x2 }))
      .sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2);
    const mergedIntervals = [];
    for (const interval of intervals) {
      const previous = mergedIntervals[mergedIntervals.length - 1];
      if (previous && interval.x1 <= previous.x2 + TEXT_SELECTION_RECT_EPSILON) {
        previous.x2 = Math.max(previous.x2, interval.x2);
      } else {
        mergedIntervals.push({ ...interval });
      }
    }
    for (const interval of mergedIntervals) {
      let mergedIntoPrevious = false;
      for (let j = mergedRects.length - 1; j >= 0; j--) {
        const previous = mergedRects[j];
        if (
          Math.abs(previous.x1 - interval.x1) <= TEXT_SELECTION_RECT_EPSILON &&
          Math.abs(previous.x2 - interval.x2) <= TEXT_SELECTION_RECT_EPSILON &&
          Math.abs(previous.y2 - y1) <= TEXT_SELECTION_RECT_EPSILON
        ) {
          previous.y2 = y2;
          mergedIntoPrevious = true;
          break;
        }
      }
      if (!mergedIntoPrevious) mergedRects.push({ x1: interval.x1, x2: interval.x2, y1, y2 });
    }
  }
  return mergedRects.map((rect) => ({
    x: rect.x1,
    y: rect.y1,
    w: rect.x2 - rect.x1,
    h: rect.y2 - rect.y1,
  }));
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

const textLayoutLineIntersectsViewport = (line, viewportRect = null) => {
  if (!viewportRect) return true;
  const y = Number(line?.y);
  if (!Number.isFinite(y)) return true;
  return y + LINE_H >= viewportRect.y1 && y <= viewportRect.y2;
};

const visibleTextLayoutLines = (layout, viewportRect = null) => (
  viewportRect ? layout.filter((line) => textLayoutLineIntersectsViewport(line, viewportRect)) : layout
);

const drawTextLayoutStatic = (context, obj, layout, selectionGap = null, options = {}) => {
  context.fillStyle = canvasTextColor();
  const lines = options.lines || visibleTextLayoutLines(layout, options.viewportRect || null);
  const stats = options.stats || null;
  if (!selectionGap) {
    for (const line of lines) {
      drawTextLineRange(context, line, obj);
      if (stats) stats.editDrawnTextLines = (stats.editDrawnTextLines || 0) + 1;
    }
    return;
  }
  const selStart = Math.min(selectionGap.start, selectionGap.end);
  const selEnd = Math.max(selectionGap.start, selectionGap.end);
  for (const line of lines) {
    const ls = line.startIndex, textEnd = ls + line.text.length;
    const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
    if (h0 >= h1) {
      drawTextLineRange(context, line, obj);
      if (stats) stats.editDrawnTextLines = (stats.editDrawnTextLines || 0) + 1;
      continue;
    }
    const o0 = h0 - ls, o1 = h1 - ls;
    const before = line.text.slice(0, o0);
    const after = line.text.slice(o1);
    if (before) drawTextLineRange(context, line, obj, 0, o0);
    if (after) drawTextLineRange(context, line, obj, o1, line.text.length);
    if (stats && (before || after)) stats.editDrawnTextLines = (stats.editDrawnTextLines || 0) + 1;
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
  const pathFill = typeof context.beginPath === 'function' &&
    typeof context.rect === 'function' &&
    typeof context.fill === 'function';
  if (pathFill) context.beginPath();
  for (const run of selection.runs) {
    TextSelDebug._logDraw(run.line, selStart, selEnd, run.x1, run.x2);
  }
  const selectionRects = textSelectionHighlightRects(selection.runs);
  for (const rect of selectionRects) {
    if (pathFill) context.rect(rect.x, rect.y, rect.w, rect.h);
    else context.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  if (pathFill && selectionRects.length) context.fill();
  TextSelDebug._logSelectionDraw?.({
    objectId: obj?.id || '',
    selStart,
    selEnd,
    selectedChars: Math.abs((selEnd ?? 0) - (selStart ?? 0)),
    selectionRuns: selection.runs.length,
    selectionRects: selectionRects.length,
    ...(selection.metrics || {}),
  });
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

function drawCaret(context, obj, layout, selStart, options = {}) {
  if (!_caretVisible) return false;
  let cx = obj.x + TEXT_PAD, cy = obj.y + TEXT_PAD;
  let caretHeight = LINE_H;
  let caretLine = null;
  const preferredLineStart = obj?._textEditCaretIndex === selStart &&
    Number.isFinite(obj?._textEditCaretLineStartIndex)
    ? obj._textEditCaretLineStartIndex
    : null;
  const placeCaretOnLine = (line) => {
    const ls = line.startIndex;
    const le = line.caretEndIndex ?? line.endIndex ?? (ls + line.text.length);
    if (!(selStart >= ls && selStart <= le)) return false;
    const off = Math.min(selStart - ls, line.text.length);
    cx = typeof lineCaretXAtOffset === 'function'
      ? lineCaretXAtOffset(line, obj, off)
      : off < line.text.length ? lineXAtOffset(line, obj, off) : lineEndX(line, obj);
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
    caretLine = line;
    return true;
  };
  if (preferredLineStart != null) {
    const preferredLine = layout.find((line) => line.startIndex === preferredLineStart);
    if (preferredLine) placeCaretOnLine(preferredLine);
  }
  if (!caretLine) {
    for (const line of layout) {
      if (placeCaretOnLine(line)) break;
    }
  }
  if (caretLine && !textLayoutLineIntersectsViewport(caretLine, options.viewportRect || null)) return false;
  context.fillStyle = canvasTextColor();
  const viewZoom = Number(options.view?.zoom ?? zoom);
  const caretZoom = Number.isFinite(viewZoom) && viewZoom > 0 ? viewZoom : 1;
  const caretWidth = 2 / caretZoom;
  const contentLeft = obj.x + TEXT_PAD;
  const contentRight = Math.max(contentLeft, obj.x + obj.w - TEXT_PAD);
  const maxCaretX = Math.max(contentLeft, contentRight - caretWidth);
  const caretX = Math.max(contentLeft, Math.min(cx - caretWidth / 2, maxCaretX));
  context.fillRect(caretX, cy, caretWidth, caretHeight);
  return true;
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
  if (!obj || obj.type !== 'text') return null;
  const view = options.view || { zoom, panX, panY, dpr: window.devicePixelRatio || 1 };
  const viewportRect = options.viewportRect || currentViewportWorldRect(0);
  const collectDebug = options.collectDebug === true;
  const stats = collectDebug ? {
    editLayoutMs: 0,
    editSelectionMs: 0,
    editTextDrawMs: 0,
    editCaretMs: 0,
    editLayoutLines: 0,
    editVisibleLines: 0,
    editCulledLines: 0,
    editDrawnTextLines: 0,
    editSelectionRuns: 0,
    editCaretDrawn: false,
  } : null;
  const motion = globalThis.BoardfishMotion?.objectMotionForDraw(obj, { view, viewportRect });
  if (motion?.skip) return stats;
  const restoreMotion = applyObjectMotionForDraw(context, obj, motion);
  try {
    context.font = FONT;
    context.textBaseline = 'alphabetic';

    const selStart = _editEl ? _editEl.selectionStart : 0;
    const selEnd   = _editEl ? _editEl.selectionEnd   : 0;
    const layoutStart = collectDebug ? performance.now() : 0;
    const layout = getTextLayout(obj);
    if (collectDebug) {
      stats.editLayoutMs = performance.now() - layoutStart;
      stats.editLayoutLines = layout.length;
    }
    const visibleLines = visibleTextLayoutLines(layout, viewportRect);
    if (collectDebug) {
      stats.editVisibleLines = visibleLines.length;
      stats.editCulledLines = Math.max(0, layout.length - visibleLines.length);
    }
    const textSelectionMotion = selStart !== selEnd
      ? globalThis.BoardfishMotion?.textSelectionMotionForDraw?.(obj.id, selStart, selEnd, { view }) || null
      : null;
    const selectionStart = collectDebug ? performance.now() : 0;
    const selection = collectTextSelectionRuns(obj, layout, selStart, selEnd, { viewportRect });
    if (collectDebug) {
      stats.editSelectionMs = performance.now() - selectionStart;
      stats.editSelectionRuns = selection?.runs?.length || 0;
      stats.editSelectedChars = Math.abs((selEnd ?? 0) - (selStart ?? 0));
      stats.editSelectionLines = selection?.metrics?.selectedLines || 0;
      stats.editSelectionVisibleLines = selection?.metrics?.scannedLines || 0;
    }

    drawTextSelectionHighlight(context, obj, layout, selStart, selEnd, { motion: textSelectionMotion, selection });

    const textDrawStart = collectDebug ? performance.now() : 0;
    drawTextLayoutStatic(
      context,
      obj,
      layout,
      textSelectionMotion ? { start: selStart, end: selEnd } : null,
      { lines: visibleLines, view, stats },
    );
    drawTextSelectionContentJello(context, obj, layout, selStart, selEnd, { motion: textSelectionMotion, selection });
    if (collectDebug) stats.editTextDrawMs = performance.now() - textDrawStart;

    if (selStart === selEnd) {
      const caretStart = collectDebug ? performance.now() : 0;
      const drawn = drawCaret(context, obj, layout, selStart, { viewportRect, view });
      if (collectDebug) {
        stats.editCaretMs = performance.now() - caretStart;
        stats.editCaretDrawn = !!drawn;
      }
    }
  } finally {
    if (restoreMotion) context.restore();
  }
  return stats;
}

function shouldUseEditOffscreenCache() {
  if (typeof appTheme !== 'undefined') return appTheme !== 'dark';
  return document?.body?.dataset?.theme !== 'dark';
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
    const useEditOffscreenCache = shouldUseEditOffscreenCache();
    if (useEditOffscreenCache && _offscreenDirty) {
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
    } else if (useEditOffscreenCache) {
      // Blit cached offscreen (background + all non-editing objects)
      const blitStart = collectDrawDebug ? performance.now() : 0;
      resetCanvasToScreen(ctx);
      ctx.drawImage(_offscreen, 0, 0);
      if (collectDrawDebug) drawPhases.offscreenBlitMs = performance.now() - blitStart;
    } else {
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
    }

    const editStart = collectDrawDebug ? performance.now() : 0;
    setWorldCanvasTransform(ctx, dpr);
    const overlayView = { zoom, panX, panY, dpr };
    drawTextSelectionJelloOverlays(ctx, viewportRect, overlayView);
    const editStats = drawEditingTextOverlay(ctx, { view: overlayView, viewportRect, collectDebug: collectDrawDebug });
    resetCanvasToScreen(ctx);
    if (collectDrawDebug) {
      drawPhases.editingOverlayMs = performance.now() - editStart;
      if (editStats) Object.assign(drawPhases, editStats);
    }
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
  scheduleVisibleTextLayoutPrewarmAfterIdle(_activeRenderSource || 'transform');
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
var _visibleTextLayoutPrewarmCancel = null;
var _lastVisibleTextLayoutPrewarm = null;
var TEXT_LAYOUT_PREWARM_INPUT_IDLE_MS = 180;

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
  getTextLayoutForViewport,
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

function textPrewarmLogicalLineCount(content) {
  const text = typeof normalizeTextContent === 'function'
    ? normalizeTextContent(content)
    : String(content ?? '').replace(/\r\n?/g, '\n');
  return text ? text.split('\n').length : 1;
}

function prewarmVisibleTextLayoutCaches(options = {}) {
  if (typeof getTextLayoutForViewport !== 'function') {
    return { available: false, skipped: 'getTextLayoutForViewport-unavailable' };
  }
  if (_boardOpening) {
    return { available: true, skipped: 'board-opening' };
  }
  const source = options.source || 'visible-text-layout-prewarm';
  const padScreenPx = Math.max(0, Math.trunc(Number(options.padScreenPx ?? 1024)) || 0);
  const minChars = Math.max(0, Math.trunc(Number(options.minChars ?? 1024)) || 0);
  const maxObjects = Math.max(1, Math.trunc(Number(options.maxObjects ?? 100)) || 100);
  const fullLineCache = options.fullLineCache === true;
  const fullLineCacheMaxLines = Math.max(1, Math.trunc(Number(options.fullLineCacheMaxLines ?? 8192)) || 8192);
  const viewportRect = typeof currentViewportWorldRect === 'function'
    ? currentViewportWorldRect(padScreenPx)
    : null;
  const exactViewportRect = typeof currentViewportWorldRect === 'function'
    ? currentViewportWorldRect(0)
    : viewportRect;
  const dbg = ViewportDebug.start('visibleTextLayoutPrewarm', {
    source,
    padScreenPx,
    minChars,
    objectCount: objects.length,
    viewportX1: viewportRect?.x1 ?? '',
    viewportY1: viewportRect?.y1 ?? '',
    viewportX2: viewportRect?.x2 ?? '',
    viewportY2: viewportRect?.y2 ?? '',
  });
  const startedAt = performance.now();
  const rows = [];
  let textObjectCount = 0;
  let visibleTextObjects = 0;
  let warmedTextObjects = 0;
  let skippedSmallTextObjects = 0;
  let warmedChars = 0;
  let warmedLogicalLines = 0;
  let warmedVisibleLines = 0;
  let warmedTotalLines = 0;
  let maxObjectMs = 0;

  for (const obj of objects) {
    if (obj?.type !== 'text') continue;
    textObjectCount++;
    if (viewportCullingEnabled && viewportRect && !objectIntersectsRect(obj, viewportRect)) continue;
    visibleTextObjects++;
    const content = normalizeTextContent(obj.data?.content || '');
    if (content.length < minChars) {
      skippedSmallTextObjects++;
      continue;
    }
    if (warmedTextObjects >= maxObjects) break;
    const objectStart = performance.now();
    const runtimePrewarm = typeof prewarmTextObjectLayoutRuntimeCaches === 'function' && options.runtimeCaches !== false
      ? prewarmTextObjectLayoutRuntimeCaches(obj)
      : null;
    let fullLineCacheLines = 0;
    let fullLineCacheMs = 0;
    const fullLineCount = Math.trunc(Number(obj._textWrappedLineIndexCache?.lineCount || obj._textWrappedLineCountCacheValue)) || 0;
    if (
      fullLineCache &&
      fullLineCount > 0 &&
      fullLineCount <= fullLineCacheMaxLines &&
      typeof getTextLayoutForLineRange === 'function'
    ) {
      const fullLineCacheStart = performance.now();
      const fullLineLayout = getTextLayoutForLineRange(obj, 0, fullLineCount - 1);
      fullLineCacheMs = performance.now() - fullLineCacheStart;
      fullLineCacheLines = fullLineLayout.length;
    }
    const layout = getTextLayoutForViewport(obj, viewportRect);
    const exactLayout = exactViewportRect &&
      exactViewportRect !== viewportRect &&
      (!viewportCullingEnabled || objectIntersectsRect(obj, exactViewportRect))
        ? getTextLayoutForViewport(obj, exactViewportRect)
        : layout;
    const objectMs = performance.now() - objectStart;
    const totalLines = Math.max(layout.length, Math.trunc(Number(layout.totalLines)) || layout.length);
    const logicalLines = textPrewarmLogicalLineCount(content);
    warmedTextObjects++;
    warmedChars += content.length;
    warmedLogicalLines += logicalLines;
    warmedVisibleLines += layout.length;
    warmedTotalLines += totalLines;
    maxObjectMs = Math.max(maxObjectMs, objectMs);
    rows.push({
      id: obj.id || '',
      ms: Math.round(objectMs * 100) / 100,
      chars: content.length,
      logicalLines,
      visibleLines: layout.length,
      exactVisibleLines: exactLayout.length,
      totalLines,
      fullLineCacheLines,
      fullLineCacheMs: fullLineCacheLines ? Math.round(fullLineCacheMs * 100) / 100 : '',
      scriptRanges: Array.isArray(obj.data?.scriptRanges) ? obj.data.scriptRanges.length : 0,
      paragraphPrefixCacheEntries: obj._textParagraphPrefixCache?.size ?? '',
      runtimePrefixCacheEntriesAdded: runtimePrewarm?.prefixCacheEntriesAdded ?? '',
      runtimePrewarmMs: runtimePrewarm?.totalMs ?? '',
      wrappedLineIndexEntries: obj._textWrappedLineIndexCache?.entries?.length ?? '',
      scriptMetricsCachePresent: !!obj._textScriptLayoutMetrics,
    });
  }

  rows.sort((a, b) => (b.ms || 0) - (a.ms || 0) || (b.chars || 0) - (a.chars || 0));
  const totalMs = performance.now() - startedAt;
  const out = {
    available: true,
    source,
    padScreenPx,
    minChars,
    maxObjects,
    fullLineCache,
    fullLineCacheMaxLines,
    textObjectCount,
    visibleTextObjects,
    warmedTextObjects,
    skippedSmallTextObjects,
    warmedChars,
    warmedLogicalLines,
    warmedVisibleLines,
    warmedTotalLines,
    totalMs: Math.round(totalMs * 100) / 100,
    avgObjectMs: warmedTextObjects ? Math.round((totalMs / warmedTextObjects) * 100) / 100 : 0,
    maxObjectMs: Math.round(maxObjectMs * 100) / 100,
    topObjects: rows.slice(0, Math.max(0, Math.min(20, Number(options.limit ?? 8)))),
  };
  _lastVisibleTextLayoutPrewarm = out;
  ViewportDebug.end(dbg, out);
  return out;
}

function getLastVisibleTextLayoutPrewarm() {
  if (!_lastVisibleTextLayoutPrewarm) return null;
  return {
    ..._lastVisibleTextLayoutPrewarm,
    topObjects: (_lastVisibleTextLayoutPrewarm.topObjects || []).map((row) => ({ ...row })),
  };
}

function clearVisibleTextLayoutPrewarmAfterIdle() {
  if (!_visibleTextLayoutPrewarmCancel) return;
  _visibleTextLayoutPrewarmCancel();
  _visibleTextLayoutPrewarmCancel = null;
}

function scheduleVisibleTextLayoutPrewarmAfterIdle(source = 'render', options = {}) {
  clearVisibleTextLayoutPrewarmAfterIdle();
  const run = () => {
    _visibleTextLayoutPrewarmCancel = null;
    const idleMs = typeof lastViewportInputAt !== 'undefined'
      ? performance.now() - lastViewportInputAt
      : Infinity;
    const idleThresholdMs = Math.max(0, Math.trunc(Number(options.inputIdleMs ?? TEXT_LAYOUT_PREWARM_INPUT_IDLE_MS)) || 0);
    if (idleMs < idleThresholdMs) {
      scheduleVisibleTextLayoutPrewarmAfterIdle(source, {
        ...options,
        delayMs: idleThresholdMs - idleMs,
      });
      return;
    }
    prewarmVisibleTextLayoutCaches({
      ...options,
      source,
    });
  };
  const requestedDelay = Number(options.delayMs);
  if (Number.isFinite(requestedDelay) && requestedDelay > 0) {
    const handle = setTimeout(run, Math.max(0, requestedDelay));
    _visibleTextLayoutPrewarmCancel = () => clearTimeout(handle);
    return handle;
  }
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, {
      timeout: Math.max(50, Math.trunc(Number(options.timeoutMs ?? 1200)) || 1200),
    });
    _visibleTextLayoutPrewarmCancel = () => cancelIdleCallback(handle);
    return handle;
  }
  const handle = setTimeout(run, Math.max(0, Math.trunc(Number(options.delayMs ?? TEXT_LAYOUT_PREWARM_INPUT_IDLE_MS)) || 0));
  _visibleTextLayoutPrewarmCancel = () => clearTimeout(handle);
  return handle;
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
