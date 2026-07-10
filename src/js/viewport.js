// ─── Viewport ─────────────────────────────────────────────────────────────────
var panX = 0, panY = 0, zoom = 1;
var _vpSaveTimer = null;
var _vpSaveDueAt = 0;
var BoardRenderer = null;
const VIEWPORT_TEXT_DRAW_STATS_DISABLED = Object.freeze({ collectStats: false });
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
var _offscreenCacheKind = '';
function invalidateOffscreen() {
  _offscreenDirty = true;
  _offscreenVersion++;
}

function setEditOffscreenCacheKind(kind) {
  const nextKind = String(kind || '');
  if (_offscreenCacheKind === nextKind) return;
  _offscreenCacheKind = nextKind;
  invalidateOffscreen();
}

function _rebuildOffscreen() {
  if (_offscreenRebuilding) return false;
  _offscreenRebuilding = true;
  const snapshotEditingId = editingId;
  const snapshotCacheKind = _offscreenCacheKind;
  const rebuildVersion = _offscreenVersion;
  const dbg = ViewportDebug.start('offscreenRebuild', { objectCount: objects.length, editingId: snapshotEditingId, cacheKind: snapshotCacheKind, version: rebuildVersion });

  // Bail if edit mode or cache state changed before the rebuild starts.
  if (!editingId ||
      editingId !== snapshotEditingId ||
      snapshotCacheKind !== _offscreenCacheKind ||
      rebuildVersion !== _offscreenVersion) {
    _offscreenRebuilding = false;
    ViewportDebug.end(dbg, { stale: true, currentCacheKind: _offscreenCacheKind, currentVersion: _offscreenVersion });
    return false;
  }

  const dpr = window.devicePixelRatio || 1;
  if (_offscreen.width !== boardCanvas.width) _offscreen.width = boardCanvas.width;
  if (_offscreen.height !== boardCanvas.height) _offscreen.height = boardCanvas.height;
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);
  fillBoardBackground(_offCtx, _offscreen.width, _offscreen.height);
  _offCtx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
  setCanvasImageQuality(_offCtx);
  _offCtx.font = FONT;
  _offCtx.textBaseline = 'alphabetic';
  const viewportRect = currentViewportWorldRect(0);
  for (const obj of objects) {
    if (obj.id === editingId) continue;
    if (snapshotCacheKind === 'non-text' && obj.type === 'text') continue;
    if (viewportCullingEnabled && !objectIntersectsRect(obj, viewportRect)) continue;
    drawSingleObj(_offCtx, obj, null, { viewportRect, view: { zoom, dpr } });
  }
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);

  _offscreenRebuilding = false;
  const ready = rebuildVersion === _offscreenVersion;
  if (ready) _offscreenDirty = false;
  ViewportDebug.end(dbg, { stale: !ready });
  return ready;
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

var VIEWPORT_CULL_PADDING_PX = 256;

function currentViewportWorldRect(padScreenPx = VIEWPORT_CULL_PADDING_PX, view = { panX, panY, zoom }) {
  return viewportWorldRect(padScreenPx, view);
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

function drawVisibleObjects(context, counters, { skipId = null, skipIds = null, viewportRect = currentViewportWorldRect(), view = { zoom, dpr: window.devicePixelRatio || 1 }, imageSourceResolver = null, skipText = false, onlyText = false } = {}) {
  return BoardRenderer.drawVisibleObjects(context, counters, { skipId, skipIds, viewportRect, view, imageSourceResolver, skipText, onlyText });
}

const collectTextSelectionRuns = (obj, layout, selStart, selEnd, options = {}) => {
  const viewportRect = options.viewportRect || null;
  if (selStart === selEnd) return null;
  let firstLine = null;
  for (const line of layout) {
    if (Array.isArray(line?.scriptRanges) && line.scriptRanges.length) {
      firstLine = line;
      break;
    }
  }
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
  const sorted = [];
  for (const value of values || []) {
    if (Number.isFinite(value)) sorted.push(value);
  }
  sorted.sort((a, b) => a - b);
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
  if (rects.length === 0) return [];
  if (rects.length === 1) {
    const rect = rects[0];
    return [{
      x: rect.x1,
      y: rect.y1,
      w: rect.x2 - rect.x1,
      h: rect.y2 - rect.y1,
    }];
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
    let activeWrite = 0;
    for (let activeRead = 0; activeRead < activeRects.length; activeRead++) {
      const rect = activeRects[activeRead];
      if (rect.y2 >= y2 - TEXT_SELECTION_RECT_EPSILON) activeRects[activeWrite++] = rect;
    }
    activeRects.length = activeWrite;
    const intervals = [];
    for (const rect of activeRects) {
      if (rect.y1 <= y1 + TEXT_SELECTION_RECT_EPSILON && rect.y2 >= y2 - TEXT_SELECTION_RECT_EPSILON) {
        intervals.push({ x1: rect.x1, x2: rect.x2 });
      }
    }
    intervals.sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2);
    const mergedIntervals = [];
    for (const interval of intervals) {
      const previous = mergedIntervals[mergedIntervals.length - 1];
      if (previous && interval.x1 <= previous.x2 + TEXT_SELECTION_RECT_EPSILON) {
        previous.x2 = Math.max(previous.x2, interval.x2);
      } else {
        mergedIntervals.push({ x1: interval.x1, x2: interval.x2 });
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
  const out = new Array(mergedRects.length);
  for (let i = 0; i < mergedRects.length; i++) {
    const rect = mergedRects[i];
    out[i] = {
      x: rect.x1,
      y: rect.y1,
      w: rect.x2 - rect.x1,
      h: rect.y2 - rect.y1,
    };
  }
  return out;
};

const applyTextSelectionMotionTransform = (context, bounds, motion) => {
  if (!motion) return false;
  const scaleX = motion.scaleX ?? 1;
  const scaleY = motion.scaleY ?? 1;
  const scaleOriginX = Number.isFinite(motion.scaleOriginX) ? Math.max(0, Math.min(1, motion.scaleOriginX)) : 0.5;
  const scaleOriginY = Number.isFinite(motion.scaleOriginY) ? Math.max(0, Math.min(1, motion.scaleOriginY)) : 0.5;
  const translateX = Number.isFinite(motion.translateX) ? motion.translateX : 0;
  const translateY = Number.isFinite(motion.translateY) ? motion.translateY : 0;
  context.globalAlpha = (Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1) * (motion.opacity ?? 1);
  if (translateX || translateY) context.translate(translateX, translateY);
  if (scaleX !== 1 || scaleY !== 1) {
    const scalePivotX = bounds.left + (bounds.right - bounds.left) * scaleOriginX;
    const scalePivotY = bounds.top + (bounds.bottom - bounds.top) * scaleOriginY;
    context.translate(scalePivotX, scalePivotY);
    context.scale(scaleX, scaleY);
    context.translate(-scalePivotX, -scalePivotY);
  }
  return true;
};

const textLayoutLineIntersectsViewport = (line, viewportRect = null) => {
  if (!viewportRect) return true;
  const y = Number(line?.y);
  if (!Number.isFinite(y)) return true;
  return y + LINE_H >= viewportRect.y1 && y <= viewportRect.y2;
};

const visibleTextLayoutLines = (layout, viewportRect = null) => {
  if (!viewportRect) return layout;
  const visibleLines = [];
  for (const line of layout) {
    if (textLayoutLineIntersectsViewport(line, viewportRect)) visibleLines.push(line);
  }
  return visibleLines;
};

const drawTextLayoutStatic = (context, obj, layout, selectionGap = null, options = {}) => {
  context.fillStyle = canvasTextColor();
  const lines = options.lines || visibleTextLayoutLines(layout, options.viewportRect || null);
  const stats = options.stats || null;
  if (!selectionGap) {
    for (const line of lines) {
      drawTextLineRange(context, line, obj, 0, line.text.length, VIEWPORT_TEXT_DRAW_STATS_DISABLED);
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
      drawTextLineRange(context, line, obj, 0, line.text.length, VIEWPORT_TEXT_DRAW_STATS_DISABLED);
      if (stats) stats.editDrawnTextLines = (stats.editDrawnTextLines || 0) + 1;
      continue;
    }
    const o0 = h0 - ls, o1 = h1 - ls;
    const hasBefore = o0 > 0;
    const hasAfter = o1 < line.text.length;
    if (hasBefore) drawTextLineRange(context, line, obj, 0, o0, VIEWPORT_TEXT_DRAW_STATS_DISABLED);
    if (hasAfter) drawTextLineRange(context, line, obj, o1, line.text.length, VIEWPORT_TEXT_DRAW_STATS_DISABLED);
    if (stats && (hasBefore || hasAfter)) stats.editDrawnTextLines = (stats.editDrawnTextLines || 0) + 1;
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
  context.fillStyle = typeof canvasSelectionHighlightColor === 'function'
    ? canvasSelectionHighlightColor()
    : 'rgba(10, 132, 255, 0.3)';
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
    if (run.endOffset > run.startOffset) {
      drawTextLineRange(
        context,
        run.line,
        obj,
        run.startOffset,
        run.endOffset,
        VIEWPORT_TEXT_DRAW_STATS_DISABLED,
      );
    }
  }
  context.restore();
  return true;
};

const textSelectionJelloSpecsForDraw = () => (
  globalThis.BoardfishMotion?.textSelectionJelloSpecsForDraw?.() || []
);

const textSelectionJelloSpecForId = (specs = [], id = null) => {
  for (const spec of specs) {
    if (spec?.id && spec.id === id) return spec;
  }
  return null;
};

const textSelectionJelloSkipIds = (specs = [], exceptId = null) => {
  let ids = null;
  for (const spec of specs) {
    if (!spec?.id || spec.id === exceptId) continue;
    if (!ids) ids = new Set();
    ids.add(spec.id);
  }
  return ids;
};

const drawTextSelectionJelloOverlays = (context, viewportRect = null, view = { zoom, panX, panY, dpr: window.devicePixelRatio || 1 }, specs = null) => {
  specs = Array.isArray(specs) ? specs : textSelectionJelloSpecsForDraw();
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
    const off = Math.max(0, selStart - ls);
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
    let preferredLine = null;
    for (const line of layout) {
      if (line.startIndex !== preferredLineStart) continue;
      preferredLine = line;
      break;
    }
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
  const scaleOriginX = Number.isFinite(motion.scaleOriginX) ? Math.max(0, Math.min(1, motion.scaleOriginX)) : 0.5;
  const scaleOriginY = Number.isFinite(motion.scaleOriginY) ? Math.max(0, Math.min(1, motion.scaleOriginY)) : 0.5;
  const translateX = Number.isFinite(motion.translateX) ? motion.translateX : 0;
  const translateY = Number.isFinite(motion.translateY) ? motion.translateY : 0;
  context.globalAlpha = (Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1) * opacity;
  if (translateX || translateY) context.translate(translateX, translateY);
  if (scaleX !== 1 || scaleY !== 1) {
    const scalePivotX = obj.x + obj.w * scaleOriginX;
    const scalePivotY = obj.y + obj.h * scaleOriginY;
    context.translate(scalePivotX, scalePivotY);
    context.scale(scaleX, scaleY);
    context.translate(-scalePivotX, -scalePivotY);
  }
  return true;
};

function drawEditingTextOverlay(context, options = {}) {
  const obj = objectsMap.get(editingId);
  if (!obj || obj.type !== 'text') return null;
  const view = options.view || { zoom, panX, panY, dpr: window.devicePixelRatio || 1 };
  const viewportRect = options.viewportRect || currentViewportWorldRect(0);
  const copiedSelectionSpec = textSelectionJelloSpecForId(options.textSelectionSpecs || [], obj.id);
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

    const liveSelStart = _editEl ? _editEl.selectionStart : 0;
    const liveSelEnd   = _editEl ? _editEl.selectionEnd   : 0;
    const liveStart = Math.min(liveSelStart, liveSelEnd);
    const liveEnd = Math.max(liveSelStart, liveSelEnd);
    const copiedMotion = copiedSelectionSpec
      ? globalThis.BoardfishMotion?.textSelectionMotionForDraw?.(obj.id, copiedSelectionSpec.start, copiedSelectionSpec.end, { view }) || null
      : null;
    const liveMatchesCopied = copiedSelectionSpec &&
      liveStart === copiedSelectionSpec.start &&
      liveEnd === copiedSelectionSpec.end;
    const useCopiedSelectionMotion = !!copiedMotion && (liveSelStart === liveSelEnd || liveMatchesCopied);
    const selStart = useCopiedSelectionMotion ? copiedSelectionSpec.start : liveSelStart;
    const selEnd   = useCopiedSelectionMotion ? copiedSelectionSpec.end   : liveSelEnd;
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
    const textSelectionMotion = useCopiedSelectionMotion ? copiedMotion : selStart !== selEnd
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
  const lightTheme = typeof appTheme !== 'undefined'
    ? appTheme !== 'dark'
    : document?.body?.dataset?.theme !== 'dark';
  if (!lightTheme) return false;
  // Canvas-to-canvas blits can subtly change text antialiasing. While editing,
  // render other text boxes through the same direct path as normal mode.
  if (typeof objects !== 'undefined' && Array.isArray(objects)) {
    for (const obj of objects) {
      if (obj?.type === 'text' && obj.id !== editingId) return false;
    }
    return true;
  }
  return true;
}

function editOffscreenCacheKind() {
  if (shouldUseEditOffscreenCache()) return 'full';
  // Keep text on the direct canvas path so antialiasing stays identical, but
  // still reuse a static background/image layer during edit caret frames.
  return 'non-text';
}

function drawBoard(options = {}) {
  const bypassEditOffscreenCache = options.bypassEditOffscreenCache === true;
  const collectViewportDebug = ViewportDebug.isEnabled();
  const dbg = collectViewportDebug
    ? ViewportDebug.start('drawBoard', { source: _activeRenderSource, objectCount: objects.length, editing: !!editingId, offscreenDirty: _offscreenDirty, bypassEditOffscreenCache })
    : null;
  if (_boardOpening) {
    if (collectViewportDebug) ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  const hasOpenPreviewFallback = typeof hasOpenInitialImagePreviews === 'function' &&
    hasOpenInitialImagePreviews();
  const collectOpenInitialRenderDebug = OpenDebug.isInitialRenderDebugActive?.() === true;
  const collectOpenPreviewFallbackDebug = OpenDebug.enabled === true && hasOpenPreviewFallback;
  const collectDrawDebug = collectViewportDebug || collectOpenInitialRenderDebug || collectOpenPreviewFallbackDebug;
  const drawStart = collectDrawDebug ? performance.now() : 0;
  const drawPhases = collectDrawDebug ? {} : null;
  const counters = collectDrawDebug ? createDrawCounters() : null;
  const dpr = window.devicePixelRatio || 1;
  const viewportRect = currentViewportWorldRect(0);
  let drawnImages = 0;
  let drawnText = 0;
  const textSelectionSpecs = textSelectionJelloSpecsForDraw();
  const copiedSelectionSkipIds = textSelectionJelloSkipIds(textSelectionSpecs, editingId || null);
  const hasCopiedSelectionSkipIds = !!copiedSelectionSkipIds?.size;
  const openInitialImageSourceResolver = (collectOpenInitialRenderDebug || hasOpenPreviewFallback) &&
      typeof resolveOpenInitialImageSourceForDraw === 'function'
    ? resolveOpenInitialImageSourceForDraw
    : null;

  if (editingId) {
    const editCacheKind = hasCopiedSelectionSkipIds ? '' : editOffscreenCacheKind();
    setEditOffscreenCacheKind(editCacheKind);
    const useEditOffscreenCache = !!editCacheKind && !bypassEditOffscreenCache;
    if (useEditOffscreenCache && _offscreenDirty) {
      _rebuildOffscreen();
    }
    if (useEditOffscreenCache && !_offscreenDirty) {
      // Blit cached offscreen (background + non-editing objects, or non-text static layer)
      const blitStart = collectDrawDebug ? performance.now() : 0;
      resetCanvasToScreen(ctx);
      ctx.drawImage(_offscreen, 0, 0);
      if (collectDrawDebug) drawPhases.offscreenBlitMs = performance.now() - blitStart;
      if (editCacheKind === 'non-text') {
        const textStart = collectDrawDebug ? performance.now() : 0;
        setWorldCanvasTransform(ctx, dpr);
        const drawn = drawVisibleObjects(ctx, counters, { skipId: editingId, skipIds: copiedSelectionSkipIds, viewportRect, imageSourceResolver: openInitialImageSourceResolver, onlyText: true });
        if (collectDrawDebug) drawPhases.offscreenTextDrawMs = performance.now() - textStart;
        drawnText += drawn.drawnText;
      }
    } else {
      const setupStart = collectDrawDebug ? performance.now() : 0;
      resetCanvasToScreen(ctx);
      fillBoardBackground(ctx, boardCanvas.width, boardCanvas.height);
      setWorldCanvasTransform(ctx, dpr);
      if (collectDrawDebug) drawPhases.backgroundSetupMs = performance.now() - setupStart;
      const objectsStart = collectDrawDebug ? performance.now() : 0;
      const drawn = drawVisibleObjects(ctx, counters, { skipId: editingId, skipIds: copiedSelectionSkipIds, viewportRect, imageSourceResolver: openInitialImageSourceResolver });
      if (collectDrawDebug) drawPhases.objectLoopMs = performance.now() - objectsStart;
      drawnImages += drawn.drawnImages;
      drawnText += drawn.drawnText;
    }

    const editStart = collectDrawDebug ? performance.now() : 0;
    setWorldCanvasTransform(ctx, dpr);
    const overlayView = { zoom, panX, panY, dpr };
    drawTextSelectionJelloOverlays(ctx, viewportRect, overlayView, textSelectionSpecs);
    const editStats = drawEditingTextOverlay(ctx, { view: overlayView, viewportRect, collectDebug: collectDrawDebug, textSelectionSpecs });
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
    const drawn = drawVisibleObjects(ctx, counters, { viewportRect, skipIds: copiedSelectionSkipIds, imageSourceResolver: openInitialImageSourceResolver });
    if (collectDrawDebug) drawPhases.objectLoopMs = performance.now() - objectsStart;
    drawnImages = drawn.drawnImages;
    drawnText = drawn.drawnText;
    drawTextSelectionJelloOverlays(ctx, viewportRect, { zoom, panX, panY, dpr }, textSelectionSpecs);
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
      bypassEditOffscreenCache,
      openPreviewFallback: !!hasOpenPreviewFallback,
      objectCount: objects.length,
      totalMeasuredMs: performance.now() - drawStart,
      ...drawPhases,
      ...counters,
    };
    _lastDrawBoardMeta = drawMeta;
    if (hasOpenPreviewFallback && typeof OpenDebug.recordPreviewFallbackDraw === 'function') {
      OpenDebug.recordPreviewFallbackDraw(drawMeta);
    }
    if (collectViewportDebug) ViewportDebug.end(dbg, drawMeta);
  } else {
    _lastDrawBoardMeta = null;
    if (collectViewportDebug) ViewportDebug.end(dbg);
  }
}

function hitTest(wx, wy) {
  return BoardObjectGeometry.topObjectAtWorldPoint({ x: wx, y: wy });
}

function applyTransform(frameDbg = null) {
  const collectOpenInitialRenderDebug = OpenDebug.isInitialRenderDebugActive?.() === true;
  const collectViewportDebug = ViewportDebug.isEnabled();
  const collectTransformDebug = collectViewportDebug || collectOpenInitialRenderDebug;
  const dbg = collectViewportDebug
    ? ViewportDebug.start('applyTransform', { editing: !!editingId, panX, panY, zoom, objectCount: objects.length, selectedCount: selectedIds.size })
    : null;
  if (_boardOpening) {
    getLastApplyTransformMeta.last = { skipped: 'board-opening', panX, panY, zoom, objectCount: objects.length };
    if (collectViewportDebug) ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  if (editingId) invalidateOffscreen();
  const transformStart = collectTransformDebug ? performance.now() : 0;
  const drawStart = collectTransformDebug ? performance.now() : 0;
  // Viewport transforms already require a direct redraw at the new pan/zoom.
  // Rebuilding the edit cache here would render the static scene twice in the
  // same frame; leave it dirty for the next non-navigation edit render.
  drawBoard({ bypassEditOffscreenCache: true });
  const drawMs = collectTransformDebug ? performance.now() - drawStart : 0;
  if (collectTransformDebug) {
    if (collectViewportDebug) {
      ViewportDebug.step(dbg, 'drawBoard', { ms: drawMs, ...(_lastDrawBoardMeta || {}) });
      ViewportDebug.step(frameDbg, 'drawBoard', { ms: drawMs, ...(_lastDrawBoardMeta || {}) });
    }
  }
  const saveStart = collectTransformDebug ? performance.now() : 0;
  saveViewport();
  const saveMs = collectTransformDebug ? performance.now() - saveStart : 0;
  if (collectTransformDebug) {
    if (collectViewportDebug) {
      ViewportDebug.step(dbg, 'saveViewport', { ms: saveMs });
      ViewportDebug.step(frameDbg, 'saveViewport', { ms: saveMs });
    }
  }
  const overlayStart = collectTransformDebug ? performance.now() : 0;
  const needsOverlayUpdate = hasSelection()
    || selOverlay.classList.contains('visible')
    || multiSelOverlay.classList.contains('visible');
  if (needsOverlayUpdate) updateSelectionOverlay();
  else ViewportDebug.count('selectionOverlaySkipped');
  const overlayMs = collectTransformDebug ? performance.now() - overlayStart : 0;
  if (collectTransformDebug) {
    if (collectViewportDebug) {
      ViewportDebug.step(dbg, 'updateSelectionOverlay', { ms: overlayMs, skipped: !needsOverlayUpdate });
      ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: overlayMs, skipped: !needsOverlayUpdate });
    }
  }
  scheduleVisibleHydrationAfterIdle();
  // The frame already laid out and drew the visible text. The legacy automatic
  // prewarm rescanned up to 100 large text objects in one unbounded main-thread
  // callback, which could delay the next gesture. Keep prewarm available to the
  // explicit performance debugger, but do not run it after navigation.
  if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
    scheduleVisibleScaledVariantPrewarmAfterIdle(_activeRenderSource || 'transform');
  }
  syncIslandZoomDisplay(_activeRenderSource || 'transform');
  const baseMeta = {
    overlaySkipped: !needsOverlayUpdate,
    source: _activeRenderSource,
    editing: !!editingId,
    panX,
    panY,
    zoom,
    objectCount: objects.length,
    selectedCount: selectedIds.size,
  };
  if (collectTransformDebug) {
    const totalMeasuredMs = performance.now() - transformStart;
    getLastApplyTransformMeta.last = {
      totalMeasuredMs,
      drawMs,
      saveViewportMs: saveMs,
      overlayMs,
      ...baseMeta,
      drawBoard: _lastDrawBoardMeta ? { ..._lastDrawBoardMeta } : null,
    };
    if (collectViewportDebug) {
      ViewportDebug.end(dbg, {
        totalMeasuredMs,
        drawMs,
        saveViewportMs: saveMs,
        overlayMs,
        ...baseMeta,
      });
    }
  } else {
    getLastApplyTransformMeta.last = baseMeta;
  }
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
var _lastVisibleTextLayoutPrewarm = null;
var _visibleTextLayoutPrewarmHistory = [];
var _textDrawWarmupCanvas = null;
var _textDrawWarmupCtx = null;
const TEXT_DRAW_WARMUP_CANVAS_MAX_W = 2048;
const TEXT_DRAW_WARMUP_CANVAS_MAX_H = 128;
const TEXT_DRAW_WARMUP_MARGIN_PX = 8;
const TEXT_DRAW_WARMUP_TARGET_OFFSCREEN = 'offscreen';
const TEXT_DRAW_WARMUP_TARGET_BOARD = 'board';

function setCanvasImageQuality(context) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
}

BoardRenderer = BoardfishRenderer.createBoardRenderer({
  objects: () => objects,
  imageStore: () => imageStore,
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

function finishMotionViewportRenderFrame(source, meta = {}) {
  globalThis.BoardfishMotion?.afterViewportRenderFrame?.({
    source: source || _activeRenderSource || 'render',
    ...meta,
  });
}

function textPrewarmLogicalLineCount(content) {
  const text = typeof normalizeTextContent === 'function'
    ? normalizeTextContent(content)
    : String(content ?? '').replace(/\r\n?/g, '\n');
  return text ? text.split('\n').length : 1;
}

function textDrawWarmupContext() {
  if (_textDrawWarmupCtx) return _textDrawWarmupCtx;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    _textDrawWarmupCanvas = document.createElement('canvas');
    _textDrawWarmupCanvas.width = 1;
    _textDrawWarmupCanvas.height = 1;
    _textDrawWarmupCtx = _textDrawWarmupCanvas.getContext('2d');
  } catch (_) {
    _textDrawWarmupCanvas = null;
    _textDrawWarmupCtx = null;
  }
  return _textDrawWarmupCtx;
}

function normalizeTextDrawWarmupTarget(value) {
  return value === TEXT_DRAW_WARMUP_TARGET_BOARD
    ? TEXT_DRAW_WARMUP_TARGET_BOARD
    : TEXT_DRAW_WARMUP_TARGET_OFFSCREEN;
}

function textDrawWarmupTarget(options = {}) {
  const target = normalizeTextDrawWarmupTarget(options.drawWarmupTarget ?? options.target);
  if (target === TEXT_DRAW_WARMUP_TARGET_BOARD) {
    return {
      target,
      ctx: typeof ctx !== 'undefined' ? ctx : null,
      canvas: typeof boardCanvas !== 'undefined' ? boardCanvas : null,
      restore: options.drawWarmupRestore !== false,
    };
  }
  return {
    target: TEXT_DRAW_WARMUP_TARGET_OFFSCREEN,
    ctx: textDrawWarmupContext(),
    canvas: _textDrawWarmupCanvas,
    restore: false,
  };
}

function createBoardTextDrawWarmupSnapshot(canvas) {
  if (!canvas || !(canvas.width > 0) || !(canvas.height > 0)) return null;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const snapshot = document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const snapshotCtx = snapshot.getContext('2d');
    snapshotCtx.drawImage(canvas, 0, 0);
    return snapshot;
  } catch (_) {
    return null;
  }
}

function restoreBoardTextDrawWarmupSnapshot(context, canvas, snapshot) {
  if (!context || !canvas || !snapshot) return 0;
  const startedAt = performance.now();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    try { context.globalAlpha = 1; } catch (_) {}
    try { context.globalCompositeOperation = 'copy'; } catch (_) {}
    context.drawImage(snapshot, 0, 0);
    try { context.globalCompositeOperation = 'source-over'; } catch (_) {}
  } catch (_) {
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(snapshot, 0, 0);
    } catch (_) {}
  }
  return performance.now() - startedAt;
}

function textDrawWarmupLineWidth(line, obj) {
  const textLength = String(line?.text ?? '').length;
  if (typeof lineXAtOffset === 'function') {
    return Math.max(1, lineXAtOffset(line, obj, textLength) - lineXAtOffset(line, obj, 0));
  }
  if (line?.prefixWidths && Number.isFinite(Number(line.prefixWidths[textLength]))) {
    return Math.max(1, Number(line.prefixWidths[textLength]) || 1);
  }
  return Math.max(1, (Number(obj?.w) || 0) - TEXT_PAD * 2);
}

function textDrawWarmupBaseX(line, obj) {
  if (typeof lineXAtOffset === 'function') return lineXAtOffset(line, obj, 0);
  return (Number(obj?.x) || 0) + TEXT_PAD;
}

function resizeTextDrawWarmupCanvas(width, height, target = null) {
  const canvas = target?.canvas || _textDrawWarmupCanvas;
  if (!canvas || target?.target === TEXT_DRAW_WARMUP_TARGET_BOARD) return;
  const nextW = Math.min(TEXT_DRAW_WARMUP_CANVAS_MAX_W, Math.max(1, Math.ceil(width)));
  const nextH = Math.min(TEXT_DRAW_WARMUP_CANVAS_MAX_H, Math.max(1, Math.ceil(height)));
  if (canvas.width < nextW) canvas.width = nextW;
  if (canvas.height < nextH) canvas.height = nextH;
}

function warmTextLayoutDrawLines(obj, layout, options = {}) {
  const target = textDrawWarmupTarget(options);
  const ctx = target.ctx;
  const canvas = target.canvas;
  if (!ctx || typeof drawTextLineRange !== 'function' || !Array.isArray(layout) || !layout.length) {
    return {
      available: !!ctx,
      target: target.target,
      warmedLines: 0,
      drawUnits: 0,
      totalMs: 0,
      maxLineMs: 0,
      restoreMs: 0,
      restored: false,
      errors: 0,
    };
  }
  const maxLines = Math.max(0, Math.trunc(Number(options.maxLines ?? 256)) || 0);
  if (!maxLines) {
    return {
      available: true,
      target: target.target,
      warmedLines: 0,
      drawUnits: 0,
      totalMs: 0,
      maxLineMs: 0,
      restoreMs: 0,
      restored: false,
      errors: 0,
    };
  }
  const viewZoom = Math.max(0.01, Number(options.zoom ?? zoom) || 1);
  const viewDpr = Math.max(1, Number(options.dpr ?? window.devicePixelRatio) || 1);
  const deviceScale = viewZoom * viewDpr;
  const startedAt = performance.now();
  const snapshot = target.restore ? createBoardTextDrawWarmupSnapshot(canvas) : null;
  if (target.target === TEXT_DRAW_WARMUP_TARGET_BOARD && target.restore && !snapshot) {
    return {
      available: false,
      skipped: 'board-warmup-snapshot-unavailable',
      target: target.target,
      warmedLines: 0,
      drawUnits: 0,
      totalMs: Math.round((performance.now() - startedAt) * 100) / 100,
      maxLineMs: 0,
      restoreMs: 0,
      restored: false,
      errors: 0,
    };
  }
  let warmedLines = 0;
  let drawUnits = 0;
  let maxLineMs = 0;
  let restoreMs = 0;
  let errors = 0;

  try {
    if (target.target === TEXT_DRAW_WARMUP_TARGET_BOARD && typeof ctx.save === 'function') ctx.save();
    for (const line of layout) {
      if (warmedLines >= maxLines) break;
      if (!line || !String(line.text ?? '').length) continue;
      const lineWidth = textDrawWarmupLineWidth(line, obj);
      const drawW = lineWidth * deviceScale + TEXT_DRAW_WARMUP_MARGIN_PX * 2;
      const drawH = LINE_H * deviceScale + TEXT_DRAW_WARMUP_MARGIN_PX * 2;
      resizeTextDrawWarmupCanvas(drawW, drawH, target);
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (target.target !== TEXT_DRAW_WARMUP_TARGET_BOARD && canvas) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        ctx.fillStyle = canvasTextColor();
        ctx.textBaseline = 'alphabetic';
        ctx.font = FONT;
        const baseX = textDrawWarmupBaseX(line, obj);
        const textY = Number.isFinite(Number(line.textY)) ? Number(line.textY) : Number(line.y || 0) + TEXT_BASELINE_Y_OFFSET;
        ctx.setTransform(
          deviceScale,
          0,
          0,
          deviceScale,
          TEXT_DRAW_WARMUP_MARGIN_PX - baseX * deviceScale,
          TEXT_DRAW_WARMUP_MARGIN_PX - textY * deviceScale,
        );
        const lineStart = performance.now();
        const stats = drawTextLineRange(ctx, line, obj, 0, line.text.length);
        const lineMs = performance.now() - lineStart;
        drawUnits += Number(stats?.drawUnits) || 0;
        maxLineMs = Math.max(maxLineMs, lineMs);
        warmedLines++;
      } catch (_) {
        errors++;
      } finally {
        try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch (_) {}
      }
    }
  } finally {
    restoreMs = restoreBoardTextDrawWarmupSnapshot(ctx, canvas, snapshot);
    if (target.target === TEXT_DRAW_WARMUP_TARGET_BOARD && typeof ctx.restore === 'function') {
      try { ctx.restore(); } catch (_) {}
    }
  }

  return {
    available: true,
    target: target.target,
    warmedLines,
    drawUnits,
    totalMs: Math.round((performance.now() - startedAt) * 100) / 100,
    maxLineMs: Math.round(maxLineMs * 100) / 100,
    restoreMs: Math.round(restoreMs * 100) / 100,
    restored: !!snapshot,
    errors,
  };
}

function roundTextDrawWarmupZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return Math.round(numeric * 10000) / 10000;
}

function normalizeTextDrawWarmupZooms(options = {}) {
  const fallbackZoom = Number(options.zoom ?? zoom);
  const fallback = Number.isFinite(fallbackZoom) && fallbackZoom > 0 ? fallbackZoom : 1;
  const raw = Array.isArray(options.drawWarmupZooms)
    ? options.drawWarmupZooms
    : options.drawWarmupZooms == null ? [fallback] : [options.drawWarmupZooms];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    const rounded = roundTextDrawWarmupZoom(numeric);
    const key = String(rounded);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(numeric);
  }
  return out.length ? out : [fallback];
}

function createTextDrawWarmupAggregate() {
  return {
    available: true,
    warmedLines: 0,
    drawUnits: 0,
    totalMs: 0,
    maxLineMs: 0,
    restoreMs: 0,
    errors: 0,
    zooms: [],
    targets: [],
  };
}

function addTextDrawWarmupAggregate(target, stats, warmupZoom) {
  if (!target || !stats) return;
  target.available = target.available && stats.available !== false;
  target.warmedLines += Number(stats.warmedLines) || 0;
  target.drawUnits += Number(stats.drawUnits) || 0;
  target.totalMs += Number(stats.totalMs) || 0;
  target.maxLineMs = Math.max(target.maxLineMs, Number(stats.maxLineMs) || 0);
  target.restoreMs += Number(stats.restoreMs) || 0;
  target.errors += Number(stats.errors) || 0;
  if ((Number(stats.warmedLines) || 0) > 0) {
    target.zooms.push(roundTextDrawWarmupZoom(warmupZoom));
    const statsTarget = normalizeTextDrawWarmupTarget(stats.target);
    if (!target.targets.includes(statsTarget)) target.targets.push(statsTarget);
  }
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
  const drawWarmup = options.drawWarmup !== false;
  const drawWarmupMaxLines = Math.max(0, Math.trunc(Number(options.drawWarmupMaxLines ?? 2048)) || 0);
  const drawWarmupMaxLinesPerObject = Math.max(1, Math.trunc(Number(options.drawWarmupMaxLinesPerObject ?? 256)) || 256);
  const drawWarmupFullObjectLines = options.drawWarmupFullObjectLines !== false;
  const drawWarmupZooms = normalizeTextDrawWarmupZooms(options);
  const requestedDrawWarmupTarget = normalizeTextDrawWarmupTarget(options.drawWarmupTarget);
  const drawWarmupRestore = options.drawWarmupRestore !== false;
  const drawWarmupBoardSnapshot = drawWarmup && requestedDrawWarmupTarget === TEXT_DRAW_WARMUP_TARGET_BOARD && drawWarmupRestore
    ? createBoardTextDrawWarmupSnapshot(typeof boardCanvas !== 'undefined' ? boardCanvas : null)
    : null;
  const drawWarmupTarget = requestedDrawWarmupTarget === TEXT_DRAW_WARMUP_TARGET_BOARD && drawWarmupRestore && !drawWarmupBoardSnapshot
    ? TEXT_DRAW_WARMUP_TARGET_OFFSCREEN
    : requestedDrawWarmupTarget;
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
    drawWarmupTarget,
    requestedDrawWarmupTarget,
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
  let drawWarmupTextObjects = 0;
  let drawWarmupLines = 0;
  let drawWarmupDrawUnits = 0;
  let drawWarmupTotalMs = 0;
  let drawWarmupMaxLineMs = 0;
  let drawWarmupErrors = 0;

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
    const totalLines = Math.max(layout.length, Math.trunc(Number(layout.totalLines)) || layout.length);
    let drawWarmupStats = null;
    let drawWarmupSource = '';
    if (drawWarmup && drawWarmupLines < drawWarmupMaxLines) {
      let remainingWarmupLines = Math.min(drawWarmupMaxLinesPerObject, drawWarmupMaxLines - drawWarmupLines);
      let drawWarmupLayout = layout;
      drawWarmupSource = 'visible';
      if (
        drawWarmupFullObjectLines &&
        totalLines > 0 &&
        totalLines <= remainingWarmupLines &&
        typeof getTextLayoutForLineRange === 'function'
      ) {
        drawWarmupLayout = getTextLayoutForLineRange(obj, 0, totalLines - 1);
        drawWarmupSource = 'full-object';
      }
      drawWarmupStats = createTextDrawWarmupAggregate();
      for (const warmupZoom of drawWarmupZooms) {
        if (remainingWarmupLines <= 0 || drawWarmupLines >= drawWarmupMaxLines) break;
        const stats = warmTextLayoutDrawLines(obj, drawWarmupLayout, {
          maxLines: remainingWarmupLines,
          zoom: warmupZoom,
          dpr: window.devicePixelRatio || 1,
          drawWarmupTarget,
          drawWarmupRestore: false,
        });
        addTextDrawWarmupAggregate(drawWarmupStats, stats, warmupZoom);
        const usedLines = Number(stats?.warmedLines) || 0;
        remainingWarmupLines = Math.min(
          drawWarmupMaxLinesPerObject - drawWarmupStats.warmedLines,
          drawWarmupMaxLines - drawWarmupLines - drawWarmupStats.warmedLines,
        );
        if (usedLines <= 0 && stats?.available === false) break;
      }
      drawWarmupStats.totalMs = Math.round(drawWarmupStats.totalMs * 100) / 100;
      drawWarmupStats.maxLineMs = Math.round(drawWarmupStats.maxLineMs * 100) / 100;
      drawWarmupStats.restoreMs = Math.round(drawWarmupStats.restoreMs * 100) / 100;
      if (drawWarmupStats.warmedLines > 0) drawWarmupTextObjects++;
      drawWarmupLines += drawWarmupStats.warmedLines || 0;
      drawWarmupDrawUnits += drawWarmupStats.drawUnits || 0;
      drawWarmupTotalMs += drawWarmupStats.totalMs || 0;
      drawWarmupMaxLineMs = Math.max(drawWarmupMaxLineMs, drawWarmupStats.maxLineMs || 0);
      drawWarmupErrors += drawWarmupStats.errors || 0;
    }
    const objectMs = performance.now() - objectStart;
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
      drawWarmupLines: drawWarmupStats?.warmedLines ?? '',
      drawWarmupDrawUnits: drawWarmupStats?.drawUnits ?? '',
      drawWarmupMs: drawWarmupStats ? Math.round((drawWarmupStats.totalMs || 0) * 100) / 100 : '',
      drawWarmupMaxLineMs: drawWarmupStats ? Math.round((drawWarmupStats.maxLineMs || 0) * 100) / 100 : '',
      drawWarmupErrors: drawWarmupStats?.errors ?? '',
      drawWarmupZooms: drawWarmupStats?.zooms?.join(',') || '',
      drawWarmupTargets: drawWarmupStats?.targets?.join(',') || '',
      drawWarmupRestoreMs: drawWarmupStats?.restoreMs ?? '',
      drawWarmupSource,
      wrappedLineIndexEntries: obj._textWrappedLineIndexCache?.entries?.length ?? '',
      scriptMetricsCachePresent: !!obj._textScriptLayoutMetrics,
    });
  }

  const boardRestoreMs = drawWarmupBoardSnapshot
    ? restoreBoardTextDrawWarmupSnapshot(
        typeof ctx !== 'undefined' ? ctx : null,
        typeof boardCanvas !== 'undefined' ? boardCanvas : null,
        drawWarmupBoardSnapshot,
      )
    : 0;
  rows.sort((a, b) => (b.ms || 0) - (a.ms || 0) || (b.chars || 0) - (a.chars || 0));
  const totalMs = performance.now() - startedAt;
  let drawWarmupZoomsText = '';
  for (let i = 0; i < drawWarmupZooms.length; i++) {
    if (i > 0) drawWarmupZoomsText += ',';
    drawWarmupZoomsText += roundTextDrawWarmupZoom(drawWarmupZooms[i]);
  }
  let rowRestoreMs = 0;
  for (const row of rows) rowRestoreMs += Number(row.drawWarmupRestoreMs) || 0;
  const rawTopObjectLimit = Math.max(0, Math.min(20, Number(options.limit ?? 8)));
  const topObjectLimit = Number.isFinite(rawTopObjectLimit) ? Math.trunc(rawTopObjectLimit) : 0;
  const topObjects = new Array(Math.min(topObjectLimit, rows.length));
  for (let i = 0; i < topObjects.length; i++) topObjects[i] = rows[i];
  const out = {
    available: true,
    source,
    padScreenPx,
    minChars,
    maxObjects,
    fullLineCache,
    fullLineCacheMaxLines,
    drawWarmup,
    requestedDrawWarmupTarget,
    drawWarmupTarget,
    drawWarmupTargetFallback: requestedDrawWarmupTarget !== drawWarmupTarget,
    drawWarmupRestored: !!drawWarmupBoardSnapshot,
    drawWarmupMaxLines,
    drawWarmupMaxLinesPerObject,
    drawWarmupFullObjectLines,
    drawWarmupZooms: drawWarmupZoomsText,
    drawWarmupZoomCount: drawWarmupZooms.length,
    textObjectCount,
    visibleTextObjects,
    warmedTextObjects,
    skippedSmallTextObjects,
    warmedChars,
    warmedLogicalLines,
    warmedVisibleLines,
    warmedTotalLines,
    drawWarmupTextObjects,
    drawWarmupLines,
    drawWarmupDrawUnits,
    drawWarmupTotalMs: Math.round(drawWarmupTotalMs * 100) / 100,
    drawWarmupMaxLineMs: Math.round(drawWarmupMaxLineMs * 100) / 100,
    drawWarmupRestoreMs: Math.round((boardRestoreMs + rowRestoreMs) * 100) / 100,
    drawWarmupErrors,
    totalMs: Math.round(totalMs * 100) / 100,
    avgObjectMs: warmedTextObjects ? Math.round((totalMs / warmedTextObjects) * 100) / 100 : 0,
    maxObjectMs: Math.round(maxObjectMs * 100) / 100,
    topObjects,
  };
  _lastVisibleTextLayoutPrewarm = out;
  _visibleTextLayoutPrewarmHistory.push(out);
  if (_visibleTextLayoutPrewarmHistory.length > 12) _visibleTextLayoutPrewarmHistory.shift();
  ViewportDebug.end(dbg, out);
  return out;
}

function cloneVisibleTextLayoutPrewarm(report) {
  if (!report) return null;
  const sourceTopObjects = report.topObjects || [];
  const topObjects = new Array(sourceTopObjects.length);
  for (let i = 0; i < sourceTopObjects.length; i++) {
    topObjects[i] = { ...sourceTopObjects[i] };
  }
  return {
    ...report,
    topObjects,
  };
}

function getLastVisibleTextLayoutPrewarm() {
  return cloneVisibleTextLayoutPrewarm(_lastVisibleTextLayoutPrewarm);
}

function getVisibleTextLayoutPrewarmHistory(limit = 12) {
  const count = Math.max(1, Math.trunc(Number(limit)) || 12);
  const start = Math.max(0, _visibleTextLayoutPrewarmHistory.length - count);
  const out = new Array(_visibleTextLayoutPrewarmHistory.length - start);
  for (let i = start; i < _visibleTextLayoutPrewarmHistory.length; i++) {
    out[i - start] = cloneVisibleTextLayoutPrewarm(_visibleTextLayoutPrewarmHistory[i]);
  }
  return out;
}

function getBestVisibleTextLayoutPrewarm() {
  let best = null;
  for (const report of _visibleTextLayoutPrewarmHistory) {
    if (!best ||
      (Number(report.drawWarmupZoomCount) || 0) > (Number(best.drawWarmupZoomCount) || 0) ||
      ((Number(report.drawWarmupZoomCount) || 0) === (Number(best.drawWarmupZoomCount) || 0) &&
        (Number(report.drawWarmupLines) || 0) > (Number(best.drawWarmupLines) || 0))) {
      best = report;
    }
  }
  return cloneVisibleTextLayoutPrewarm(best);
}

function viewportEventTime(event = null) {
  const timestamp = Number(event?.timeStamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return performance.now();
  return timestamp > performance.timeOrigin ? timestamp - performance.timeOrigin : timestamp;
}

function scheduleFrame(source = 'unknown') {
  if (source) _frameSources.push(source);
  const collectDebug = ViewportDebug.isEnabled();
  if (_frameRaf) {
    ViewportDebug.count('coalescedFrames');
    if (collectDebug) {
      ViewportDebug.recordFrameSchedule?.('coalesced', {
        source,
        pendingSources: _frameSources.length,
        needTransform: _needTransform,
        needBoardRender: _needBoardRender,
        needOverlayRender: _needOverlayRender,
        inputSource: _frameInputSource,
        inputAgeMs: _frameInputAt ? Math.max(0, performance.now() - _frameInputAt) : '',
        rafPending: true,
      });
    }
    return;
  }
  _frameScheduledAt = collectDebug ? performance.now() : 0;
  ViewportDebug.count('scheduledFrames');
  if (collectDebug) {
    ViewportDebug.recordFrameSchedule?.('scheduled', {
      source,
      pendingSources: _frameSources.length,
      needTransform: _needTransform,
      needBoardRender: _needBoardRender,
      needOverlayRender: _needOverlayRender,
      inputSource: _frameInputSource,
      inputAgeMs: _frameInputAt ? Math.max(0, _frameScheduledAt - _frameInputAt) : '',
      rafPending: false,
    });
  }
  _frameRaf = requestAnimationFrame(() => {
    const frameSources = _frameSources;
    let sourceLabel = '';
    let sourceCount = 0;
    if (frameSources.length === 1) {
      sourceLabel = frameSources[0] || '';
      sourceCount = sourceLabel ? 1 : 0;
    } else if (frameSources.length > 1) {
      const uniqueSources = [];
      for (const frameSource of frameSources) {
        if (!frameSource || uniqueSources.includes(frameSource)) continue;
        uniqueSources.push(frameSource);
      }
      sourceLabel = uniqueSources.join(',');
      sourceCount = uniqueSources.length;
    }
    _frameSources = [];
    const doTransform = _needTransform;
    const doBoard = _needBoardRender;
    const doOverlay = _needOverlayRender;
    const inputAt = doTransform ? _frameInputAt : 0;
    const inputSource = doTransform ? _frameInputSource : '';
    const frameMeta = collectDebug && inputAt ? {
      inputAgeMs: Math.max(0, performance.now() - inputAt),
      inputSource,
    } : null;
    const frameDbg = collectDebug ? ViewportDebug.frameStart(performance.now() - _frameScheduledAt, frameMeta || {}) : null;
    if (collectDebug) {
      ViewportDebug.recordFrameSchedule?.('raf-fired', {
        sources: sourceLabel,
        pendingSources: sourceCount,
        doTransform,
        doBoard,
        doOverlay,
        inputSource,
        inputAgeMs: frameMeta?.inputAgeMs ?? '',
      });
      ViewportDebug.step(frameDbg, 'sources', { sources: sourceLabel });
    }
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
      withRenderSource(sourceLabel || 'transform', () => applyTransform(frameDbg));
      if (collectDebug) ViewportDebug.step(frameDbg, 'applyTransformCall', { ms: performance.now() - transformStart });
      finishMotionViewportRenderFrame(sourceLabel || 'transform', { doTransform, doBoard: true, doOverlay: true });
      if (collectDebug) ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sourceLabel });
      return;
    }
    if (doBoard) {
      ViewportDebug.count('boardFrames');
      const drawStart = collectDebug ? performance.now() : 0;
      withRenderSource(sourceLabel || 'board', () => drawBoard());
      if (collectDebug) ViewportDebug.step(frameDbg, 'drawBoard', { ms: performance.now() - drawStart, ...(_lastDrawBoardMeta || {}) });
    }
    if (doOverlay) {
      const overlayStart = collectDebug ? performance.now() : 0;
      ViewportDebug.count('overlayFrames');
      updateSelectionOverlay();
      if (collectDebug) ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: performance.now() - overlayStart });
    }
    if (doBoard) finishMotionViewportRenderFrame(sourceLabel || 'board', { doTransform, doBoard, doOverlay });
    if (collectDebug) ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sourceLabel });
  });
}

function scheduleTransform(source = 'transform', inputEvent = null) {
  const now = performance.now();
  const eventAt = viewportEventTime(inputEvent);
  lastViewportInputAt = now;
  if (ViewportDebug.isEnabled()) {
    ViewportDebug.recordPanZoom?.('transform-scheduled', {
      mode: source.includes('zoom') ? 'zoom' : source.includes('pan') ? 'pan' : 'transform',
      source,
      eventAt,
      inputAgeMs: Math.max(0, now - eventAt),
      rafPending: !!_frameRaf,
      pendingSources: _frameSources.length,
      needTransformBefore: _needTransform,
      needBoardRenderBefore: _needBoardRender,
      needOverlayRenderBefore: _needOverlayRender,
    }, inputEvent);
  }
  _frameInputAt = eventAt;
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
