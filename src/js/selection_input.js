// ─── Screen-space selection overlay ──────────────────────────────────────────
var _selOverlayStyleState = { transform: '', width: '', height: '' };
var _multiSelBoxes = [];
var _rubberBandDragActive = false;
var _textMinWidthWarmCancel = null;
var _textMinWidthWarmObjectId = '';
const SELECTION_IMAGE_EDGE_OVERDRAW_DEVICE_PX = 1;

function setSelectionOverlayScreenRect(element, state, resting, animated, padDevicePx = 0) {
  const restingX = resting.x1 * zoom + panX;
  const restingY = resting.y1 * zoom + panY;
  const restingWidth = (resting.x2 - resting.x1) * zoom;
  const restingHeight = (resting.y2 - resting.y1) * zoom;
  const scale = window.devicePixelRatio || 1;
  const pad = padDevicePx / scale;
  const x1 = Math.floor((restingX - pad) * scale) / scale;
  const y1 = Math.floor((restingY - pad) * scale) / scale;
  const x2 = Math.ceil((restingX + restingWidth + pad) * scale) / scale;
  const y2 = Math.ceil((restingY + restingHeight + pad) * scale) / scale;
  const snappedWidth = x2 - x1;
  const snappedHeight = y2 - y1;
  const deltaX = _cleanOverlay((animated.x1 - resting.x1) * zoom);
  const deltaY = _cleanOverlay((animated.y1 - resting.y1) * zoom);
  const deltaWidth = _cleanOverlay((animated.x2 - animated.x1) * zoom - restingWidth);
  const deltaHeight = _cleanOverlay((animated.y2 - animated.y1) * zoom - restingHeight);
  _setStyleIfChanged(element, 'transform', `translate(${_cleanOverlay(x1 + deltaX)}px,${_cleanOverlay(y1 + deltaY)}px)`, state);
  _setStyleIfChanged(element, 'width', _cleanOverlay(Math.max(0, snappedWidth + deltaWidth)) + 'px', state);
  _setStyleIfChanged(element, 'height', _cleanOverlay(Math.max(0, snappedHeight + deltaHeight)) + 'px', state);
}

function selectionOverlayObjectBounds(obj) {
  if (!obj) return null;
  const motion = globalThis.BoardfishMotion?.getLastDrawnObjectMotion?.(obj);
  if (!motion) return null;
  const { scaleX = 1, scaleY = 1, scaleOriginX = 0.5, scaleOriginY = 0.5, translateX = 0, translateY = 0 } = motion;
  const x1 = obj.x + obj.w * scaleOriginX * (1 - scaleX) + translateX;
  const y1 = obj.y + obj.h * scaleOriginY * (1 - scaleY) + translateY;
  return { x1, y1, x2: x1 + obj.w * scaleX, y2: y1 + obj.h * scaleY };
}

function selectionOverlaySelectedBounds(resting, obj, hasMotion) {
  if (!hasMotion) return resting;
  if (selectedIds.size === 1) {
    return selectionOverlayObjectBounds(obj) || resting;
  }
  let translateX = 0;
  let translateY = 0;
  let motionCount = 0;
  for (const id of selectedIds) {
    const motion = globalThis.BoardfishMotion?.getLastDrawnObjectMotion?.(id) || null;
    if (!motion) continue;
    translateX += motion.groupTranslateX ?? motion.translateX ?? 0;
    translateY += motion.groupTranslateY ?? motion.translateY ?? 0;
    motionCount++;
  }
  if (!motionCount) return resting;
  translateX /= motionCount;
  translateY /= motionCount;
  return {
    x1: resting.x1 + translateX,
    y1: resting.y1 + translateY,
    x2: resting.x2 + translateX,
    y2: resting.y2 + translateY,
  };
}

function _cleanOverlay(value) {
  if (Math.abs(value) < 1e-9) return 0;
  return Math.round(value * 1e9) / 1e9;
}

function beginRubberBandDrag() {
  if (_rubberBandDragActive) return;
  _rubberBandDragActive = true;
  _rubberBandShieldRelease = acquireInputShield();
}

function finishRubberBandDrag() {
  if (!_rubberBandDragActive) return;
  _rubberBandDragActive = false;
  if (_rubberBandShieldRelease) {
    _rubberBandShieldRelease();
    _rubberBandShieldRelease = null;
  }
}
var _rubberBandShieldRelease = null;

function cancelTextMinWidthWarm() {
  if (_textMinWidthWarmCancel) {
    _textMinWidthWarmCancel();
    _textMinWidthWarmCancel = null;
  }
  _textMinWidthWarmObjectId = '';
}

function scheduleTextMinWidthWarm(obj) {
  cancelTextMinWidthWarm();
  if (!obj || obj.type !== 'text' || typeof getTextMinWidth !== 'function') return;
  const objectId = obj.id || '';
  if (!objectId) return;
  _textMinWidthWarmObjectId = objectId;
  const run = () => {
    _textMinWidthWarmCancel = null;
    if (_textMinWidthWarmObjectId !== objectId) return;
    _textMinWidthWarmObjectId = '';
    if (selectedId !== objectId || !selectedIds.has(objectId)) return;
    const current = objectsMap.get(objectId);
    if (!current || current.type !== 'text') return;
    try { getTextMinWidth(current); } catch (_) {}
  };
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 1000 });
    _textMinWidthWarmCancel = () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
    };
    return;
  }
  if (typeof setTimeout === 'function') {
    const handle = setTimeout(run, 250);
    _textMinWidthWarmCancel = () => clearTimeout(handle);
  }
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function selectionInputPerfDebugApi() {
  return typeof ManualPerfDebug !== 'undefined' ? ManualPerfDebug : null;
}

function selectionResizeDebugNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function selectionResizeDebugRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function selectionResizeEventMeta(event = null) {
  const now = selectionResizeDebugNow();
  const timestamp = Number(event?.timeStamp);
  const timeOrigin = typeof performance !== 'undefined' ? Number(performance.timeOrigin) || 0 : 0;
  const eventAt = Number.isFinite(timestamp) && timestamp > 0
    ? (timestamp > timeOrigin ? timestamp - timeOrigin : timestamp)
    : now;
  return {
    eventType: event?.type || '',
    eventAt: selectionResizeDebugRound(eventAt),
    eventAgeMs: selectionResizeDebugRound(Math.max(0, now - eventAt)),
    clientX: event?.clientX ?? '',
    clientY: event?.clientY ?? '',
    button: event?.button ?? '',
    buttons: event?.buttons ?? '',
  };
}

function selectionResizeTextLineCount(value = '') {
  if (!value) return 0;
  let lines = 1;
  for (let index = value.indexOf('\n'); index >= 0; index = value.indexOf('\n', index + 1)) lines++;
  return lines;
}

function selectionResizeTextObjectStats(obj) {
  const content = typeof obj?.data?.content === 'string' ? obj.data.content : '';
  return {
    objectId: obj?.id || '',
    contentChars: content.length,
    logicalLines: selectionResizeTextLineCount(content),
    scriptRanges: Array.isArray(obj?.data?.scriptRanges) ? obj.data.scriptRanges.length : 0,
    layoutCachePresent: !!obj?._layoutCache,
    layoutCacheLines: Array.isArray(obj?._layoutCache) ? obj._layoutCache.length : '',
    minWidthCachePresent: Number.isFinite(obj?._textMinWidthCache),
    paragraphPrefixCacheEntries: obj?._textParagraphPrefixCache?.size || 0,
    wrappedLineCountCachePresent: Number.isFinite(obj?._textWrappedLineCountCacheValue),
    wrappedLineCountCacheW: Number.isFinite(obj?._textWrappedLineCountCacheW) ? obj._textWrappedLineCountCacheW : '',
    wrappedLineIndexCacheEntries: obj?._textWrappedLineIndexCache?.entries?.length ?? '',
    wrappedLineIndexCacheLines: obj?._textWrappedLineIndexCache?.lineCount ?? '',
    wrappedLineIndexWidthCacheSize: obj?._textWrappedLineIndexWidthCache?.size ?? '',
    scriptMetricsCachePresent: !!obj?._textScriptLayoutMetrics,
  };
}

function recordSelectionTextResizeStep(step, dragId, meta = {}) {
  selectionInputPerfDebugApi()?.recordTextResizeStep?.(step, { dragId: dragId || '', ...meta });
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

var _dialogResolve = null;

function isUnsavedDialogOpen() {
  return _dialogResolve !== null;
}

function isEventInsideUnsavedDialog(e) {
  return !!unsavedDialog && e.target instanceof Node && unsavedDialog.contains(e.target);
}

const _inputEventPointElementCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

function pointedElementForInputEvent(e) {
  if (!e || (typeof e !== 'object' && typeof e !== 'function')) return null;
  if (_inputEventPointElementCache) {
    try {
      if (_inputEventPointElementCache.has(e)) return _inputEventPointElementCache.get(e);
    } catch (_) {}
  }
  const x = Number(e?.clientX);
  const y = Number(e?.clientY);
  const pointed = Number.isFinite(x) && Number.isFinite(y)
    ? document.elementFromPoint(x, y)
    : null;
  const element = pointed instanceof Node ? pointed : null;
  try { _inputEventPointElementCache?.set(e, element); } catch (_) {}
  return element;
}

const isEventInsideVisibleSurface = (e, surface) => {
  if (!surface || !surface.classList.contains('visible')) return false;
  if (e.target instanceof Node && surface.contains(e.target)) return true;
  // A concrete event target is already the browser's hit-test result. Only use
  // elementFromPoint for ambiguous document/window-targeted synthetic events.
  if (e.target instanceof Node && e.target.nodeType === 1) return false;
  const pointed = pointedElementForInputEvent(e);
  return pointed instanceof Node && surface.contains(pointed);
};

const isEventInsideVisibleContextMenu = (e) => {
  return (
    isEventInsideVisibleSurface(e, ctxMenu) ||
    isEventInsideVisibleSurface(e, objCtxMenu) ||
    isEventInsideVisibleSurface(e, textCtxMenu) ||
    isEventInsideVisibleSurface(e, ctxActions)
  );
};

const isEventInsideVisibleIsland = (e) => {
  return isEventInsideVisibleSurface(e, island);
};

const isEventInsideViewportWheelSurface = (e) => {
  return (e.target instanceof Node && canvas.contains(e.target)) ||
    isEventInsideVisibleContextMenu(e) || isEventInsideVisibleIsland(e);
};

function isShieldInputAllowed(e) {
  if (isUnsavedDialogOpen()) return isEventInsideUnsavedDialog(e);
  if (isEventInsideVisibleContextMenu(e)) return true;
  if (_boardOpening || !_inputShieldStack.length) return false;
  return _rubberBandDragActive &&
    _inputShieldStack.length === 1 &&
    (e.type === 'mousemove' || (e.type === 'mouseup' && e.button === 0));
}

function blockShieldInput(e) {
  if (!_boardOpening && !_inputShieldStack.length && _dialogResolve === null) return;
  if (
    e.type === 'keydown' &&
    (e.key === 'Escape' || e.key === 'Meta' || e.key === 'OS' || e.metaKey)
  ) {
    if (typeof cancelRubberBandSelection === 'function' && cancelRubberBandSelection('key-cancel')) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  if (isShieldInputAllowed(e)) return;
  ViewportDebug.recordShieldBlock?.(e, { reason: 'input-shield' });
  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
}
var INPUT_SHIELD_EVENT_OPTIONS = { capture: true, passive: false };
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'keydown', 'keyup', 'beforeinput', 'input', 'paste', 'drop', 'dragover']) {
  document.addEventListener(type, blockShieldInput, INPUT_SHIELD_EVENT_OPTIONS);
}

function _setStyleIfChanged(el, prop, value, state) {
  if (state[prop] === value) return;
  state[prop] = value;
  el.style[prop] = value;
}

const oppositeSelectionDir = function oppositeSelectionDir(dir) {
  if (dir === 'nw') return 'se';
  if (dir === 'ne') return 'sw';
  if (dir === 'se') return 'nw';
  if (dir === 'sw') return 'ne';
  return '';
};

const boundsCornerPoint = function boundsCornerPoint(bounds, dir) {
  if (!bounds || !dir) return null;
  return {
    x: dir.includes('e') ? bounds.x2 : bounds.x1,
    y: dir.includes('s') ? bounds.y2 : bounds.y1,
  };
};

function hideMultiSelectionOverlay() {
  if (!multiSelOverlay) return;
  if (multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.remove('visible');
}

function updateMultiSelectionOverlay(hasMotion, multiSelected) {
  if (!multiSelOverlay || !multiSelected) {
    hideMultiSelectionOverlay();
    return 0;
  }

  while (_multiSelBoxes.length < selectedIds.size) {
    const box = document.createElement('div');
    box.className = 'multi-sel-box';
    box._styleState = { transform: '', width: '', height: '' };
    _multiSelBoxes.push(box);
    multiSelOverlay.appendChild(box);
  }

  let selectedIdx = 0;
  let imageEdgePad = 0;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    const resting = { x1: obj.x, y1: obj.y, x2: obj.x + obj.w, y2: obj.y + obj.h };
    const bounds = hasMotion ? selectionOverlayObjectBounds(obj) || resting : resting;
    const box = _multiSelBoxes[selectedIdx++];
    const state = box._styleState;
    const pad = obj.type === 'image' ? SELECTION_IMAGE_EDGE_OVERDRAW_DEVICE_PX : 0;
    imageEdgePad ||= pad;
    setSelectionOverlayScreenRect(
      box,
      state,
      resting,
      bounds,
      pad,
    );
  }

  while (_multiSelBoxes.length > selectedIdx) {
    const box = _multiSelBoxes.pop();
    box?.parentNode?.removeChild(box);
  }

  if (!multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.add('visible');
  return imageEdgePad;
}

function updateSelectionOverlay() {
  if (isBoardInputBlocked() && !shouldKeepSelectionOverlayWhileBlocked()) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    return;
  }
  if (!hasSelection()) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    return;
  }

  const firstSelectedObj = getFirstSelectedObject();
  if (!firstSelectedObj) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    BoardfishEditorState.clearSelection();
    return;
  }

  const resting = selectedBounds();
  const hasMotion = !!globalThis.BoardfishMotion?.hasLastDrawnObjectMotions?.();
  const bounds = resting && selectionOverlaySelectedBounds(resting, firstSelectedObj, hasMotion);
  if (!bounds) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    BoardfishEditorState.clearSelection();
    return;
  }
  const { width, height } = _boardSurfaceCssSizeCache || boardSurfaceCssSize();
  const screenX1 = bounds.x1 * zoom + panX, screenY1 = bounds.y1 * zoom + panY;
  const screenX2 = bounds.x2 * zoom + panX, screenY2 = bounds.y2 * zoom + panY;
  if (!(screenX1 < width && screenX2 > 0 && screenY1 < height && screenY2 > 0)) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    return;
  }

  const multiSelected = isMultiSelected();
  const imageEdgePad = updateMultiSelectionOverlay(hasMotion, multiSelected) ||
    (firstSelectedObj.type === 'image' ? SELECTION_IMAGE_EDGE_OVERDRAW_DEVICE_PX : 0);
  setSelectionOverlayScreenRect(
    selOverlay,
    _selOverlayStyleState,
    resting,
    bounds,
    imageEdgePad,
  );
  const nextClasses = `visible${multiSelected ? ' multi' : ''}${editingId ? ' editing' : ''}${!multiSelected && firstSelectedObj.type === 'text' ? ' text-resize' : ''}`;
  if (selOverlay.className !== nextClasses) selOverlay.className = nextClasses;
}

const beginSelectionHandleDrag = function beginSelectionHandleDrag(handle, e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.dir;
      const resizeEast = dir.includes('e'), resizeWest = dir.includes('w');
      const resizeSouth = dir.includes('s'), resizeNorth = dir.includes('n');
      const startX = e.clientX, startY = e.clientY;

      // ── Multi-select: scale non-text objects proportionally within the bounding box ──
      if (isMultiSelected()) {
        const bounds = selectedBounds();
        if (!bounds) return;
        const origBW = bounds.x2 - bounds.x1, origBH = bounds.y2 - bounds.y1;
        if (origBW <= 0 || origBH <= 0) return;
        const handlePoint = boundsCornerPoint(bounds, dir);
        const anchorPoint = boundsCornerPoint(bounds, oppositeSelectionDir(dir));
        if (!handlePoint || !anchorPoint) return;

        const MIN_OBJECT_SIZE = 100;
        let minObjectScale = 0;
        const snapshots = [];
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o || o.type === 'text') continue;
          if (
            !Number.isFinite(o.x) ||
            !Number.isFinite(o.y) ||
            !Number.isFinite(o.w) ||
            !Number.isFinite(o.h) ||
            o.w <= 0 ||
            o.h <= 0
          ) {
            continue;
          }
          snapshots.push({
            obj: o,
            x: o.x,
            y: o.y,
            w: o.w, h: o.h,
          });
          minObjectScale = Math.max(minObjectScale, MIN_OBJECT_SIZE / o.w, MIN_OBJECT_SIZE / o.h);
        }
        if (!snapshots.length) return;

        minObjectScale = Math.min(1, minObjectScale);
        const resizeCommitter = createRafCommitter((x, y, eventZoom) => {
          const dx = (x - startX) / eventZoom, dy = (y - startY) / eventZoom;
          const scale = Math.max(minObjectScale, Math.min((handlePoint.x + dx - anchorPoint.x) / (handlePoint.x - anchorPoint.x), (handlePoint.y + dy - anchorPoint.y) / (handlePoint.y - anchorPoint.y)));
          for (const snap of snapshots) {
            const o = snap.obj;
            o.x = anchorPoint.x + (snap.x - anchorPoint.x) * scale;
            o.y = anchorPoint.y + (snap.y - anchorPoint.y) * scale;
            o.w = snap.w * scale;
            o.h = snap.h * scale;
          }
          drawBoard(); updateSelectionOverlay();
        });

        beginDocumentDrag({
          move: (ev) => resizeCommitter.schedule(ev.clientX, ev.clientY, zoom),
          up() {
            resizeCommitter.flush();
            pushHistory('multi-resize', snapshots);
          },
        });
        return;
      }

      // ── Single select ──
      if (!selectedId) return;
      const obj = objectsMap.get(selectedId);
      if (!obj) return;

      const { x: ox, y: oy, w: ow, h: oh } = obj;
      const MIN_OBJECT_SIZE = 100;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const resizeDebugActive = obj.type === 'text' && !!selectionInputPerfDebugApi()?.isTextResizeTraceActive?.();
      const resizeDebugBase = resizeDebugActive
        ? {
            ...selectionResizeTextObjectStats(obj),
            dir,
            startClientX: startX,
            startClientY: startY,
            startX: ox,
            startY: oy,
            startW: ow,
            startH: oh,
            zoom,
            panX,
            panY,
            ...selectionResizeEventMeta(e),
          }
        : null;
      const resizeDebugDragId = resizeDebugActive
        ? (selectionInputPerfDebugApi()?.startTextResizeDrag?.(resizeDebugBase) || '')
        : '';
      let resizeFinalizing = false;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */

      function syncTextResizeAutoHeight(reason) {
        if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
          syncTextAutoHeight(obj, getTextMinLines(obj));
          return;
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const diagnosticReason = reason || 'resize';
        const clearStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
        // Resize changes are already guarded by width-aware layout cache keys.
        // Keeping the caches lets auto-height and the live redraw share wrapping work.
        const clearLayoutMs = resizeDebugDragId ? selectionResizeDebugRound(selectionResizeDebugNow() - clearStartedAt) : '';
        const heightBeforeAuto = resizeDebugDragId ? obj.h : 0;
        const autoHeightStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
        syncTextAutoHeight(obj, getTextMinLines(obj));
        if (!resizeDebugDragId) return null;
        return {
          clearLayoutMs,
          autoHeightMs: selectionResizeDebugRound(selectionResizeDebugNow() - autoHeightStartedAt),
          autoHeightChanged: obj.h !== heightBeforeAuto,
          autoHeightReason: diagnosticReason,
          layoutInvalidationMethod: 'cache-keyed',
        };
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }

      function applyResize(x, y, w, h) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const applyStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
        const beforeX = obj.x;
        const beforeY = obj.y;
        const beforeW = obj.w;
        const beforeH = obj.h;
        const layoutCacheHadValue = !!obj._layoutCache;
        const layoutCacheLinesBefore = Array.isArray(obj._layoutCache) ? obj._layoutCache.length : '';
        if (resizeDebugDragId) {
          recordSelectionTextResizeStep('apply-start', resizeDebugDragId, {
            objectId: obj.id,
            beforeX,
            beforeY,
            beforeW,
            beforeH,
            x,
            y,
            w,
            h,
            layoutCacheHadValue,
            layoutCacheLinesBefore,
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        const isText = obj.type === 'text';
        const textWidthChanged = isText && obj.w !== w;
        obj.x = x;
        obj.y = y;
        obj.w = w;
        if (!isText) obj.h = h;
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        let autoHeightDebug = null;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        if (isText && textWidthChanged) {
          if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
            syncTextResizeAutoHeight();
          } else {
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            autoHeightDebug = syncTextResizeAutoHeight(resizeFinalizing ? 'resize-final' : 'resize');
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
          }
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const scheduleStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        if (!isText || textWidthChanged) drawBoard();
        updateSelectionOverlay();
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (resizeDebugDragId) {
          const scheduleRenderMs = selectionResizeDebugRound(selectionResizeDebugNow() - scheduleStartedAt);
          recordSelectionTextResizeStep('apply-end', resizeDebugDragId, {
            objectId: obj.id,
            beforeX,
            beforeY,
            beforeW,
            beforeH,
            afterX: obj.x,
            afterY: obj.y,
            afterW: obj.w,
            afterH: obj.h,
            w: obj.w,
            h: obj.h,
            layoutCacheHadValue,
            layoutCacheLinesBefore,
            layoutCachePresent: !!obj._layoutCache,
            layoutCacheLines: Array.isArray(obj._layoutCache) ? obj._layoutCache.length : '',
            minWidthCachePresent: Number.isFinite(obj._textMinWidthCache),
            paragraphPrefixCacheEntries: obj._textParagraphPrefixCache?.size || 0,
            wrappedLineCountCachePresent: Number.isFinite(obj._textWrappedLineCountCacheValue),
            wrappedLineCountCacheW: Number.isFinite(obj._textWrappedLineCountCacheW) ? obj._textWrappedLineCountCacheW : '',
            wrappedLineIndexCacheEntries: obj._textWrappedLineIndexCache?.entries?.length ?? '',
            wrappedLineIndexCacheLines: obj._textWrappedLineIndexCache?.lineCount ?? '',
            wrappedLineIndexWidthCacheSize: obj._textWrappedLineIndexWidthCache?.size ?? '',
            scriptMetricsCachePresent: !!obj._textScriptLayoutMetrics,
            clearLayoutMs: autoHeightDebug?.clearLayoutMs ?? '',
            autoHeightMs: autoHeightDebug?.autoHeightMs ?? '',
            autoHeightChanged: autoHeightDebug?.autoHeightChanged ?? '',
            autoHeightReason: autoHeightDebug?.autoHeightReason ?? '',
            layoutInvalidationMethod: autoHeightDebug?.layoutInvalidationMethod ?? '',
            pendingSizeSync: false,
            renderBoard: !isText || textWidthChanged,
            renderOverlay: true,
            scheduleRenderMs,
            applyMs: selectionResizeDebugRound(selectionResizeDebugNow() - applyStartedAt),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      const resizeCommitter = createRafCommitter(applyResize);
      let dragMinTextW = null;

      function onMove(ev) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const moveStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let x = ox, y = oy, w = ow, h = oh;
        let minTextW;
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        let minWidthMs = '';
        /* BOARDFISH_DEV_DIAGNOSTICS_END */

        if (obj.type === 'image') {
          const minScale = Math.min(1, Math.max(MIN_OBJECT_SIZE / ow, MIN_OBJECT_SIZE / oh));
          const scale = Math.max(minScale, Math.min(
            (resizeEast ? ow + dx : ow - dx) / ow,
            (resizeSouth ? oh + dy : oh - dy) / oh,
          ));
          w = ow * scale;
          h = oh * scale;
          if (resizeWest) x = ox + ow - w;
          if (resizeNorth) y = oy + oh - h;
        } else {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const minWidthStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          if (dragMinTextW == null) {
            dragMinTextW = typeof getTextMinWidth === 'function' ? getTextMinWidth(obj) : MIN_OBJECT_SIZE;
          }
          minTextW = dragMinTextW;
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (resizeDebugDragId) minWidthMs = selectionResizeDebugRound(selectionResizeDebugNow() - minWidthStartedAt);
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          if (resizeEast) w = Math.max(minTextW, ow + dx);
          h = oh;
          if (resizeWest) { w = Math.max(minTextW, ow - dx); x = ox + ow - w; }
        }

        resizeCommitter.schedule(x, y, w, h);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (resizeDebugDragId) {
          recordSelectionTextResizeStep('move', resizeDebugDragId, {
            ...selectionResizeEventMeta(ev),
            objectId: obj.id,
            dir,
            dx,
            dy,
            x,
            y,
            w,
            h,
            minTextW,
            minWidthMs,
            moveMs: selectionResizeDebugRound(selectionResizeDebugNow() - moveStartedAt),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }

      beginDocumentDrag({
        move: onMove,
        up() {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (resizeDebugDragId) {
            recordSelectionTextResizeStep('up-start', resizeDebugDragId, {
              objectId: obj.id,
              pendingBeforeFlush: !!resizeCommitter.pending,
            });
          }
          const flushStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
          resizeFinalizing = true;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          resizeCommitter.flush();
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          resizeFinalizing = false;
          if (resizeDebugDragId) {
            recordSelectionTextResizeStep('flush', resizeDebugDragId, {
              objectId: obj.id,
              flushMs: selectionResizeDebugRound(selectionResizeDebugNow() - flushStartedAt),
              pendingSizeSync: false,
              x: obj.x,
              y: obj.y,
              w: obj.w,
              h: obj.h,
            });
          }
          const historyStartedAt = resizeDebugDragId ? selectionResizeDebugNow() : 0;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          pushHistory('resize', [obj.id]);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (resizeDebugDragId) {
            recordSelectionTextResizeStep('history-pushed', resizeDebugDragId, {
              objectId: obj.id,
              historyReason: 'resize',
              historyMs: selectionResizeDebugRound(selectionResizeDebugNow() - historyStartedAt),
            });
            selectionInputPerfDebugApi()?.finishTextResizeDrag?.(resizeDebugDragId, {
              objectId: obj.id,
              x: obj.x,
              y: obj.y,
              w: obj.w,
              h: obj.h,
              ...selectionResizeTextObjectStats(obj),
            });
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        },
      });
};

// Init overlay handle listeners once — they always operate on selectedId / selectedIds
(function initOverlayHandles() {
  for (const handle of selOverlay.querySelectorAll('.s-handle')) {
    handle.addEventListener('mousedown', (e) => beginSelectionHandleDrag(handle, e));
  }
})();


// ─── Selection ────────────────────────────────────────────────────────────────

function selectObject(id) {
  if (editingId && editingId !== id) exitEdit();
  BoardfishEditorState.setSelection([id], { primaryId: id, exitEditing: false });
  const obj = objectsMap.get(id);
  if (obj) bringObjectToFront(obj);
  scheduleTextMinWidthWarm(obj);
  scheduleRender(true, true);
}

function deselectAll() {
  if (editingId) exitEdit();
  cancelTextMinWidthWarm();
  BoardfishEditorState.clearSelection();
  scheduleRender(false, true);
}

function selectAllObjects() {
  if (editingId || !objects.length) return;
  cancelTextMinWidthWarm();
  const ids = new Array(objects.length);
  for (let i = 0; i < objects.length; i++) ids[i] = objects[i].id;
  BoardfishEditorState.setSelection(ids, {
    primaryId: objects[objects.length - 1].id,
    exitEditing: false,
  });
  scheduleRender(false, true);
}

function hideMenus() {
  closeOpenMenusExcept('', 'hideMenus');
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

const normalizeTextEditHistoryState = (id, state = null) => {
  const targetId = id || state?.id || editingId;
  if (!targetId) return null;
  const obj = objectsMap.get(targetId);
  const valueLength = typeof state?.value === 'string'
    ? state.value.length
    : (_editEl
        ? (typeof textEditProxyValue === 'function' ? textEditProxyValue(_editEl).length : (_editEl.value?.length || 0))
        : (obj?.data?.content?.length || 0));
  const start = Math.max(0, Math.min(state?.start ?? state?.selectionStart ?? _editEl?.selectionStart ?? 0, valueLength));
  const end = Math.max(0, Math.min(state?.end ?? state?.selectionEnd ?? start, valueLength));
  const rawScriptCaretIndex = state?.scriptCaretIndex ?? state?.textScriptCaretIndex ?? obj?._textScriptCaretIndex;
  const scriptCaretIndexValue = Number(rawScriptCaretIndex ?? start);
  const scriptCaretIndex = Number.isFinite(scriptCaretIndexValue)
    ? Math.max(0, Math.min(scriptCaretIndexValue, valueLength))
    : start;
  const scriptCaretAffinity = state?.scriptCaretAffinity ?? state?.textScriptCaretAffinity ??
    (obj?._textScriptCaretIndex === start ? obj?._textScriptCaretAffinity : '');
  const normalized = {
    id: targetId,
    selectionStart: start,
    selectionEnd: end,
    selectionDirection: state?.direction || state?.selectionDirection || _editEl?.selectionDirection || 'none',
  };
  if (start === end && scriptCaretIndex === start && scriptCaretAffinity) {
    normalized.scriptCaretIndex = scriptCaretIndex;
    normalized.scriptCaretAffinity = scriptCaretAffinity;
  }
  return normalized;
};

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const textEditHistoryDebugMeta = (id, state = null, normalized = null, extra = {}) => {
  const obj = id ? objectsMap.get(id) : null;
  const proxyValue = typeof textEditProxyValue === 'function' && _editEl
    ? textEditProxyValue(_editEl)
    : (typeof _editEl?.value === 'string' ? _editEl.value : '');
  const rawStart = state?.start ?? state?.selectionStart ?? _editEl?.selectionStart ?? '';
  const rawEnd = state?.end ?? state?.selectionEnd ?? _editEl?.selectionEnd ?? rawStart;
  const insertedText = state?.replacement ? String(state.replacement.insertedText ?? '') : '';
  return {
    objectId: id || '',
    inputType: state?.inputType || '',
    rawStart,
    rawEnd,
    rawSelectedChars: Number.isFinite(rawStart) && Number.isFinite(rawEnd) ? Math.abs(rawEnd - rawStart) : '',
    normalizedStart: normalized?.selectionStart ?? '',
    normalizedEnd: normalized?.selectionEnd ?? '',
    normalizedSelectedChars: normalized ? Math.abs((normalized.selectionEnd ?? 0) - (normalized.selectionStart ?? 0)) : '',
    selectionDirection: normalized?.selectionDirection || state?.direction || state?.selectionDirection || '',
    stateValueChars: typeof state?.value === 'string' ? state.value.length : '',
    proxyValueChars: proxyValue.length,
    domProxyChars: typeof _editEl?.value === 'string' ? _editEl.value.length : '',
    contentChars: typeof obj?.data?.content === 'string' ? obj.data.content.length : '',
    hadSelection: state?.hasSelection ?? (Number.isFinite(rawStart) && Number.isFinite(rawEnd) ? rawStart !== rawEnd : ''),
    replacementStart: state?.replacement?.start ?? '',
    replacementEnd: state?.replacement?.end ?? '',
    insertedChars: insertedText.length,
    ...extra,
  };
};

const logTextEditHistoryDebug = (label, id, state = null, normalized = null, extra = {}) => {
  if (typeof TextSelDebug === 'undefined') return;
  TextSelDebug._logHistoryAction?.(label, textEditHistoryDebugMeta(id, state, normalized, extra));
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

const beginTextEditHistoryAction = (id = editingId, state = null) => {
  if (!id) return null;
  const splitPending = shouldCommitTextEditInputImmediately(
    state?.inputType,
    state?.hasSelection ?? (state?.start !== state?.end),
  );
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hadPendingStart = !!(_editHistoryActionStartState && _editHistoryActionStartState.id === id);
  const hadTimer = !!_editHistoryTimer;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (splitPending) {
    if (_editHistoryTimer) flushEditHistoryCheckpoint();
    if (_editHistoryActionStartState?.id === id) _editHistoryActionStartState = null;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let reusedStart = true;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!_editHistoryActionStartState || _editHistoryActionStartState.id !== id) {
    _editHistoryActionStartState = normalizeTextEditHistoryState(id, state);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    reusedStart = false;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logTextEditHistoryDebug('history-begin', id, state, _editHistoryActionStartState, {
    splitPending,
    hadTimer,
    hadPendingStart,
    reusedStart,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return _editHistoryActionStartState;
};

function pushEditHistoryIfChanged(id) {
  const obj = objectsMap.get(id);
  if (!obj) return false;
  if (_editHistoryLastContent === null) _editHistoryLastContent = obj.data.content;
  if (obj.data.content === _editHistoryLastContent) return false;
  const beforeEditState = _editHistoryActionStartState?.id === id ? _editHistoryActionStartState : null;
  _editHistoryActionStartState = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logTextEditHistoryDebug('history-push', id, null, beforeEditState, {
    previousContentChars: String(_editHistoryLastContent || '').length,
    nextContentChars: String(obj.data.content || '').length,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  pushHistory('text-edit-checkpoint', null, beforeEditState);
  _editHistoryLastContent = obj.data.content;
  return true;
}

const clearEditHistoryCheckpointTimer = () => {
  if (_editHistoryTimer) {
    clearTimeout(_editHistoryTimer);
    _editHistoryTimer = null;
  }
};

function flushEditHistoryCheckpoint() {
  clearEditHistoryCheckpointTimer();
  if (typeof _textInputSelectionHistorySuppress !== 'undefined') _textInputSelectionHistorySuppress = null;
  if (!editingId) return false;
  return pushEditHistoryIfChanged(editingId);
}

const shouldCommitTextEditInputImmediately = (inputType = '', hadSelection = false) =>
  hadSelection || inputType.includes('Paste') || inputType.includes('Cut');

const recordTextEditInputHistory = (id, inputType = '', hadSelection = false) => {
  if (shouldCommitTextEditInputImmediately(inputType, hadSelection)) {
    clearEditHistoryCheckpointTimer();
    return pushEditHistoryIfChanged(id);
  }
  clearEditHistoryCheckpointTimer();
  _editHistoryTimer = setTimeout(() => {
    _editHistoryTimer = null;
    pushEditHistoryIfChanged(id);
  }, EDIT_HISTORY_DEBOUNCE_MS);
  return false;
};
