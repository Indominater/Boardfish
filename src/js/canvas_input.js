// ─── Zoom ─────────────────────────────────────────────────────────────────────
var ZOOM_MIN = 0.01, ZOOM_MAX = 100;
var _editEl = null;
var _caretVisible = true;
var _caretBlinkInterval = null;
var _selChangeListener = null;
var _editHistoryTimer = null, _editHistoryLastContent = null;
var EDIT_HISTORY_DEBOUNCE_MS = 500;
var _textInputSelectionHistorySuppress = null, _editHistoryActionStartState = null;

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function canvasInputNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function canvasInputDebugRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function canvasInputEventTimestampMs(event = null) {
  const timestamp = Number(event?.timeStamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return canvasInputNow();
  return timestamp > performance.timeOrigin ? timestamp - performance.timeOrigin : timestamp;
}

function canvasInputWheelDeltaScale(deltaMode) {
  if (deltaMode === 1) return 16;
  if (deltaMode === 2) return Math.max(1, Number(window.innerHeight) || 1);
  return 1;
}

function canvasInputWheelDebugMeta(e) {
  const deltaMode = Number(e?.deltaMode) || 0;
  const scale = canvasInputWheelDeltaScale(deltaMode);
  return {
    deltaMode,
    deltaModeLabel: deltaMode === 1 ? 'line' : deltaMode === 2 ? 'page' : 'pixel',
    deltaX: e?.deltaX ?? '',
    deltaY: e?.deltaY ?? '',
    deltaZ: e?.deltaZ ?? '',
    wheelDeltaXPx: (Number(e?.deltaX) || 0) * scale,
    wheelDeltaYPx: (Number(e?.deltaY) || 0) * scale,
    wheelDeltaZPx: (Number(e?.deltaZ) || 0) * scale,
  };
}

function canvasInputEventDebugMeta(e) {
  const eventAt = canvasInputEventTimestampMs(e);
  return {
    eventAt,
    eventAgeMs: Math.max(0, canvasInputNow() - eventAt),
    eventType: e?.type || '',
    clientX: e?.clientX ?? '',
    clientY: e?.clientY ?? '',
    button: e?.button ?? '',
    buttons: e?.buttons ?? '',
    movementX: e?.movementX ?? '',
    movementY: e?.movementY ?? '',
    ctrlKey: !!e?.ctrlKey,
    metaKey: !!e?.metaKey,
    shiftKey: !!e?.shiftKey,
    altKey: !!e?.altKey,
    defaultPrevented: !!e?.defaultPrevented,
    cancelable: !!e?.cancelable,
    isTrusted: e?.isTrusted ?? '',
  };
}

function canvasInputViewportDebugSnapshot(prefix = '') {
  const key = (name) => prefix ? `${name}${prefix}` : name;
  return {
    [key('panX')]: panX,
    [key('panY')]: panY,
    [key('zoom')]: zoom,
  };
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function selectionSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function canvasInputTextDebugLog(label, obj = null, meta = {}) {
  if (typeof TextSelDebug === 'undefined') return;
  TextSelDebug._logEditLifecycle?.(label, obj, meta);
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function focusTextEditProxyNow(proxy
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , obj = null, label = null, meta = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
    if (!proxy || (typeof document !== 'undefined' && document.activeElement === proxy)) return false;
    proxy.focus({ preventScroll: true });
    return true;
  } else {
    if (label == null) label = 'text-edit-focus';
    if (meta == null) meta = {};
    if (!proxy) return { focused: false, skipped: true, reason: 'missing-proxy', focusMs: '' };
    if (typeof document !== 'undefined' && document.activeElement === proxy) {
      const out = { focused: false, skipped: true, reason: 'already-active', focusMs: 0, activeElementIsProxy: true };
      canvasInputTextDebugLog(label, obj, { ...meta, ...out });
      return out;
    }
    const focusStart = canvasInputNow();
    proxy.focus({ preventScroll: true });
    const out = {
      focused: true,
      skipped: false,
      reason: '',
      focusMs: canvasInputDebugRound(canvasInputNow() - focusStart),
      activeElementIsProxy: typeof document !== 'undefined' ? document.activeElement === proxy : '',
    };
    canvasInputTextDebugLog(label, obj, { ...meta, ...out });
    return out;
  }
}

function handleViewportWheel(e) {
  if (!e.ctrlKey && !e.metaKey && !isEventInsideViewportWheelSurface(e)) return;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const collectDebug = ViewportDebug.isEnabled();
  const handlerStart = collectDebug ? canvasInputNow() : 0;
  const wheelMeta = collectDebug ? canvasInputWheelDebugMeta(e) : null;
  const eventMeta = collectDebug ? canvasInputEventDebugMeta(e) : null;
  const beforeMeta = collectDebug ? canvasInputViewportDebugSnapshot('Before') : null;
  const dbg = collectDebug
    ? ViewportDebug.start('wheel', {
      ...eventMeta,
      ...wheelMeta,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      ...beforeMeta,
      panX,
      panY,
      zoom,
    })
    : null;
  try {
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ViewportDebug.count('wheel');
    e.preventDefault();
    if (_rubberBandDragActive) {
      if (collectDebug) {
        ViewportDebug.recordPanZoom?.('wheel-blocked-rubber-band', {
          mode: 'blocked',
          source: 'wheel',
          blocked: true,
          reason: 'rubber-band',
          ...wheelMeta,
          ...beforeMeta,
          ...canvasInputViewportDebugSnapshot('After'),
        }, e);
        ViewportDebug.end(dbg, { mode: 'blocked-rubber-band', panX, panY, zoom });
      }
      return;
    }
    if (editingId) {
      _caretVisible = true;
    }
    if (e.ctrlKey || e.metaKey) {
      ViewportDebug.count('wheelZoom');
      const factor = Math.abs(e.deltaY) < 30
        ? Math.pow(0.995, e.deltaY)
        : e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const requestedZoom = zoom * factor;
      BoardfishViewportState.zoomAroundClient(e.clientX, e.clientY, requestedZoom);
      if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleTransform('wheel-zoom', e);
      else scheduleTransform(e);
      if (collectDebug) {
        const { panXBefore, panYBefore, zoomBefore } = beforeMeta;
        const handlerMs = canvasInputDebugRound(canvasInputNow() - handlerStart);
        const zoomDeltaPct = zoomBefore ? ((zoom / zoomBefore) - 1) * 100 : 0;
        const panDeltaX = panX - panXBefore;
        const panDeltaY = panY - panYBefore;
        const focusWorldX = (e.clientX - panXBefore) / Math.max(zoomBefore || 1, 0.0001);
        const focusWorldY = (e.clientY - panYBefore) / Math.max(zoomBefore || 1, 0.0001);
        ViewportDebug.recordPanZoom?.('wheel-zoom', {
          mode: 'zoom',
          source: 'wheel-zoom',
          ...eventMeta,
          ...wheelMeta,
          panXBefore,
          panYBefore,
          zoomBefore,
          panXAfter: panX,
          panYAfter: panY,
          zoomAfter: zoom,
          panDeltaX,
          panDeltaY,
          panDistancePx: Math.hypot(panDeltaX, panDeltaY),
          zoomDelta: zoom - zoomBefore,
          zoomDeltaPct,
          factor,
          requestedZoom,
          clamped: zoom !== requestedZoom,
          focusWorldX,
          focusWorldY,
          handlerMs,
        }, e);
        ViewportDebug.end(dbg, {
          mode: 'zoom',
          source: 'wheel-zoom',
          newZoom: zoom,
          zoomBefore,
          zoomAfter: zoom,
          zoomDeltaPct,
          panX,
          panY,
          panDeltaX,
          panDeltaY,
          handlerMs,
        });
      }
      return;
    }

    ViewportDebug.count('wheelPan');
    BoardfishViewportState.panBy(-e.deltaX, -e.deltaY);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleTransform('wheel-pan', e);
    else scheduleTransform(e);
    if (collectDebug) {
      const { panXBefore, panYBefore, zoomBefore } = beforeMeta;
      const appliedPanX = -e.deltaX, appliedPanY = -e.deltaY;
      const handlerMs = canvasInputDebugRound(canvasInputNow() - handlerStart);
      const panDeltaX = panX - panXBefore;
      const panDeltaY = panY - panYBefore;
      ViewportDebug.recordPanZoom?.('wheel-pan', {
        mode: 'pan',
        source: 'wheel-pan',
        ...eventMeta,
        ...wheelMeta,
        panXBefore,
        panYBefore,
        zoomBefore,
        panXAfter: panX,
        panYAfter: panY,
        zoomAfter: zoom,
        appliedPanX,
        appliedPanY,
        panDeltaX,
        panDeltaY,
        panDistancePx: Math.hypot(panDeltaX, panDeltaY),
        handlerMs,
      }, e);
      ViewportDebug.end(dbg, {
        mode: 'pan',
        source: 'wheel-pan',
        appliedDX: e.deltaX,
        appliedDY: e.deltaY,
        appliedPanX,
        appliedPanY,
        panX,
        panY,
        panDeltaX,
        panDeltaY,
        handlerMs,
      });
    }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  } finally {
    if (collectDebug) ViewportDebug.timing('wheelHandler', canvasInputNow() - handlerStart);
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('wheel', handleViewportWheel, { capture: true, passive: false });
}

// ─── Pan (spacebar + left click) ─────────────────────────────────────────────
var _spaceDown = false,
  _rubberBandSelectionCleanup = null,
  hideRubberBandSelectionVisual = null,
  cancelRubberBandSelection = null;

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (isBoardInputBlocked() && !isBoardNavigationAllowedWhileBlocked()) {
    e.preventDefault();
    return;
  }
  if (_rubberBandDragActive) {
    e.preventDefault();
    return;
  }
  if (editingId) return;
  e.preventDefault();
  if (e.repeat) return;
  _spaceDown = true;
  canvas.classList.add('panning');
});

document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  if (_spaceDown || !editingId) e.preventDefault();
  _spaceDown = false;
  canvas.classList.remove('panning');
});

function dragItemsForSelection() {
  const items = [];
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (o) items.push({ obj: o, startX: o.x, startY: o.y });
  }
  return items;
}

function startMousePan(e) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const collectPanDebug = ViewportDebug.isEnabled();
  const startDebugMeta = collectPanDebug ? {
    ...canvasInputEventDebugMeta(e),
    ...canvasInputViewportDebugSnapshot('Before'),
  } : null;
  const panDbg = collectPanDebug
    ? ViewportDebug.start('mousePan', { startX: e.clientX, startY: e.clientY, ...startDebugMeta, panX, panY, zoom })
    : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const startPanX = panX, startPanY = panY;
  const startZoom = zoom;
  const panStartedAt = collectPanDebug ? canvasInputNow() : 0;
  let moveCount = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let lastClientX = startX;
  let lastClientY = startY;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (collectPanDebug) {
    ViewportDebug.recordPanZoom?.('mouse-pan-start', {
      mode: 'pan',
      source: 'mouse-pan',
      ...startDebugMeta,
      startClientX: startX,
      startClientY: startY,
      panXBefore: startPanX,
      panYBefore: startPanY,
      zoomBefore: startZoom,
    }, e);
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  function onMove(ev) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDebug = ViewportDebug.isEnabled();
    const handlerStart = collectDebug ? canvasInputNow() : 0;
    try {
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
      ViewportDebug.count('mousePanMoves');
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const panXBefore = panX;
      const panYBefore = panY;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const clientStepX = ev.clientX - lastClientX;
      const clientStepY = ev.clientY - lastClientY;
      BoardfishViewportState.panBy(clientStepX, clientStepY);
      if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleTransform('mouse-pan', ev);
      else scheduleTransform(ev);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDebug) {
        const panDeltaX = panX - panXBefore;
        const panDeltaY = panY - panYBefore;
        const handlerMs = canvasInputDebugRound(canvasInputNow() - handlerStart);
        moveCount++;
        ViewportDebug.recordPanZoom?.('mouse-pan-move', {
          mode: 'pan',
          source: 'mouse-pan',
          moveIndex: moveCount,
          ...canvasInputEventDebugMeta(ev),
          panXBefore,
          panYBefore,
          zoomBefore: startZoom,
          panXAfter: panX,
          panYAfter: panY,
          zoomAfter: zoom,
          startClientX: startX,
          startClientY: startY,
          clientDeltaX: ev.clientX - startX,
          clientDeltaY: ev.clientY - startY,
          clientStepX,
          clientStepY,
          panDeltaX,
          panDeltaY,
          panDistancePx: Math.hypot(panDeltaX, panDeltaY),
          cumulativePanX: panX - startPanX,
          cumulativePanY: panY - startPanY,
          handlerMs,
        }, ev);
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    } finally {
      if (collectDebug) ViewportDebug.timing('mousePanHandler', canvasInputNow() - handlerStart);
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  function onUp(ev) {
    if (ev && !ev.__boardfishDragCancel && ev.button !== 0) return;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectPanDebug) {
      const panDeltaX = panX - startPanX;
      const panDeltaY = panY - startPanY;
      const panDistancePx = Math.hypot(panDeltaX, panDeltaY);
      ViewportDebug.recordPanZoom?.('mouse-pan-end', {
        mode: 'pan',
        source: 'mouse-pan',
        ...(ev ? canvasInputEventDebugMeta(ev) : {}),
        startClientX: startX,
        startClientY: startY,
        endClientX: ev?.clientX ?? '',
        endClientY: ev?.clientY ?? '',
        panXBefore: startPanX,
        panYBefore: startPanY,
        zoomBefore: startZoom,
        panXAfter: panX,
        panYAfter: panY,
        zoomAfter: zoom,
        panDeltaX,
        panDeltaY,
        panDistancePx,
        moveCount,
        durationMs: canvasInputNow() - panStartedAt,
        cancelled: !!ev?.__boardfishDragCancel,
      }, ev);
      ViewportDebug.end(panDbg, {
        endX: ev?.clientX ?? '',
        endY: ev?.clientY ?? '',
        panX,
        panY,
        zoom,
        panDeltaX,
        panDeltaY,
        panDistancePx,
        moveCount,
        cancelled: !!ev?.__boardfishDragCancel,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  beginDocumentDrag({ move: onMove, up: onUp });
}

function createSelectionDragSession(startClientX, startClientY) {
  const grpItems = dragItemsForSelection();
  if (!grpItems.length) return null;
  const dragZoom = Math.max(0.0001, zoom);
  let grpMoved = false;
  let finished = false;
  const grpThreshold = 9 / (dragZoom * dragZoom);
  function applyGrpDrag(dx, dy) {
    for (const item of grpItems) { item.obj.x = item.startX + dx; item.obj.y = item.startY + dy; }
    if (typeof BOARDFISH_PRODUCTION === 'undefined') withRenderSource('group-drag', () => drawBoard());
    else drawBoard();
    updateSelectionOverlay();
  }
  const dragCommitter = createRafCommitter((dx, dy) => applyGrpDrag(dx, dy));
  function move(clientX, clientY) {
    if (finished || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    const dx = (clientX - startClientX) / dragZoom;
    const dy = (clientY - startClientY) / dragZoom;
    if (!grpMoved && dx*dx + dy*dy > grpThreshold) grpMoved = true;
    if (!grpMoved) return false;
    dragCommitter.schedule(dx, dy);
    return true;
  }
  function finish() {
    if (finished) return false;
    finished = true;
    if (!grpMoved) return false;
    dragCommitter.flush();
    for (const item of grpItems) markDirty(item.obj.id);
    pushHistory('group-drag');
    return true;
  }
  return Object.freeze({ move, finish });
}

function startGroupDrag(e) {
  const drag = createSelectionDragSession(e.clientX, e.clientY);
  if (!drag) return false;
  beginDocumentDrag({
    move: (ev) => drag.move(ev.clientX, ev.clientY),
    up: () => drag.finish(),
  });
  return true;
}

function startSelectedRegionDrag(e) {
  if (editingId || !selectedIds.size) return false;
  const bounds = selectedBounds();
  if (!bounds) return false;
  const point = toWorld(e.clientX, e.clientY);
  if (!rectContainsPoint(bounds, point)) return false;
  return createSelectionDragSession(e.clientX, e.clientY);
}

hideRubberBandSelectionVisual = () => {
  finishRubberBandDrag();
  rubberBand.style.display = 'none';
};

cancelRubberBandSelection = (reason = 'cancel') => {
  if (!_rubberBandDragActive) return false;
  const cancelEvent = { __boardfishRubberBandCancel: true, reason };
  if (_rubberBandSelectionCleanup) _rubberBandSelectionCleanup(cancelEvent);
  else hideRubberBandSelectionVisual();
  return true;
};

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('blur', () => cancelRubberBandSelection('window-blur'));
  window.addEventListener('pagehide', () => cancelRubberBandSelection('pagehide'));
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' || document.hidden) {
      cancelRubberBandSelection('document-hidden');
    }
  });
  document.addEventListener('pointercancel', () => cancelRubberBandSelection('pointercancel'), true);
}

function startRubberBandSelection(e, additive) {
  cancelRubberBandSelection('restart');
  if (!additive) deselectAll();
  const rbStartX = e.clientX, rbStartY = e.clientY;
  beginRubberBandDrag();
  let rbActive = false;
  let rbFinished = false;
  const rbStyleCommitter = createRafCommitter((l, t, w, h) => {
    rubberBand.style.cssText = `display:block;left:${l}px;top:${t}px;width:${w}px;height:${h}px`;
  });
  function onRbMove(ev) {
    const dx = ev.clientX - rbStartX, dy = ev.clientY - rbStartY;
    if (!rbActive && dx*dx + dy*dy > 16) rbActive = true;
    if (!rbActive) return;
    const l = Math.min(rbStartX, ev.clientX), t = Math.min(rbStartY, ev.clientY);
    const w = Math.abs(dx), h = Math.abs(dy);
    rbStyleCommitter.schedule(l, t, w, h);
  }
  function onRbUp(ev) {
    if (rbFinished) return;
    rbFinished = true;
    _rubberBandSelectionCleanup = null;
    rbStyleCommitter.flush();
    hideRubberBandSelectionVisual();
    if (ev?.__boardfishRubberBandCancel) return;
    if (!rbActive) return;
    const x1 = Math.min(rbStartX, ev.clientX), y1 = Math.min(rbStartY, ev.clientY);
    const x2 = Math.max(rbStartX, ev.clientX), y2 = Math.max(rbStartY, ev.clientY);
    const rbRect = {
      x1: (x1 - panX) / zoom,
      y1: (y1 - panY) / zoom,
      x2: (x2 - panX) / zoom,
      y2: (y2 - panY) / zoom,
    };
    const nextSelection = additive ? new Set(selectedIds) : new Set();
    for (const o of objects) {
      if (objectIntersectsRect(o, rbRect)) {
        nextSelection.add(o.id);
      }
    }
    if (selectionSetsEqual(nextSelection, selectedIds)) return;
    BoardfishEditorState.setSelection(nextSelection);
    scheduleRender(false, true);
  }
  _rubberBandSelectionCleanup = beginDocumentDrag({ move: onRbMove, up: onRbUp });
}

function toggleAdditiveSelection(obj) {
  const nextSelection = new Set(selectedIds);
  if (isSelected(obj.id)) {
    nextSelection.delete(obj.id);
    BoardfishEditorState.setSelection(nextSelection);
  } else {
    nextSelection.add(obj.id);
    BoardfishEditorState.setSelection(nextSelection, { primaryId: obj.id });
    bringObjectToFront(obj);
  }
  scheduleRender(true, true);
}

function applyTextEditCaretHit(obj, proxy, hit) {
  if (!obj || !proxy || !hit) return;
  const textContent = obj.data?.content || '';
  const textLength = textContent.length;
  const index = Math.max(0, Math.min(Math.trunc(hit.index ?? 0), textLength));
  setTextEditProxySelectionRange(proxy, index, index, 'none', { value: textContent });
  if (hit.affinity) {
    setTextScriptCaretAffinity(obj, index, hit.affinity);
  } else {
    clearTextScriptCaretAffinity(obj);
    setTextEditCaretIndex(obj, index, { lineStartIndex: hit.lineStartIndex });
  }
}

function clearTextEditCaretHit(obj) {
  if (!obj) return;
  clearTextScriptCaretAffinity(obj);
  clearTextEditCaretIndex(obj);
}

function startTextSelectionDrag(e, obj, wp) {
  flushEditHistoryCheckpoint();
  TextSelDebug._logPointer?.('selection-drag-start', e, { objectId: obj?.id || '', wx: wp.x, wy: wp.y });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const layoutStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const layout = getTextLayout(obj);
  TextSelDebug._logLayout?.('selection-drag-start-layout', obj, layout, canvasInputNow() - layoutStart);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const clickHitStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const clickHit = layoutHitTestCaret(layout, wp.x, wp.y, obj);
  TextSelDebug._logHitTiming?.('selection-drag-start-hit', obj, clickHit, canvasInputNow() - clickHitStart, {
    wx: wp.x,
    wy: wp.y,
  });
  const clickIdx = clickHit.index;
  if (_editEl) {
    applyTextEditCaretHit(obj, _editEl, clickHit);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      focusTextEditProxyNow(_editEl, obj, 'selection-drag-focus', {
        phase: 'selection-drag',
        clientX: e?.clientX ?? '',
        clientY: e?.clientY ?? '',
      });
    } else {
      focusTextEditProxyNow(_editEl);
    }
    TextSelDebug._logSelection('mouse-down', _editEl, obj);
    _caretVisible = true;
    scheduleRender(true, false);
  }
  function onSelMove(ev) {
    const wp2 = toWorld(ev.clientX, ev.clientY);
    TextSelDebug._logPointer?.('selection-drag-move', ev, { objectId: obj?.id || '', wx: wp2.x, wy: wp2.y });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const hitStart = canvasInputNow();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const endHit = layoutHitTestCaret(obj._layoutCache || layout, wp2.x, wp2.y, obj);
    TextSelDebug._logHitTiming?.('selection-drag-move-hit', obj, endHit, canvasInputNow() - hitStart, {
      wx: wp2.x,
      wy: wp2.y,
    });
    const endIdx = endHit.index;
    if (_editEl) {
      const start = Math.min(clickIdx, endIdx);
      const end = Math.max(clickIdx, endIdx);
      setTextEditProxySelectionRange(_editEl, start, end, 'none', { value: obj.data?.content || '' });
      if (clickIdx === endIdx) applyTextEditCaretHit(obj, _editEl, endHit);
      else clearTextEditCaretHit(obj);
      TextSelDebug._logSelection('mouse-drag', _editEl, obj);
      _caretVisible = true;
      scheduleRender(true, false);
    }
  }
  function onSelUp(ev) {
    if (!ev || ev.__boardfishDragCancel) return;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const wp2 = toWorld(ev.clientX, ev.clientY);
    TextSelDebug._logPointer?.('selection-drag-end', ev, { objectId: obj?.id || '', wx: wp2.x, wy: wp2.y });
    if (_editEl) TextSelDebug._logSelection('mouse-up', _editEl, obj);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  beginDocumentDrag({ move: onSelMove, up: onSelUp });
}

function startObjectDrag(e, obj) {
  if (editingId && editingId !== obj.id) exitEdit();
  const wasSelected = isSelected(obj.id);
  const canClickToEditText = obj.type === 'text' && wasSelected && selectedIds.size === 1;
  if (!wasSelected) selectObject(obj.id);

  const startX = e.clientX, startY = e.clientY;
  const dragItems = dragItemsForSelection();
  let moved = false;
  const moveThreshold = 9 / (zoom * zoom);

  function applyDrag(dx, dy) {
    for (const item of dragItems) {
      item.obj.x = item.startX + dx;
      item.obj.y = item.startY + dy;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const dragDbg = ViewportDebug.start('dragFrame', { items: dragItems.length });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') withRenderSource('object-drag', () => drawBoard());
    else drawBoard();
    ViewportDebug.end(dragDbg);
    updateSelectionOverlay();
  }
  const dragCommitter = createRafCommitter((dx, dy) => applyDrag(dx, dy));

  function onMove(ev) {
    const dx = (ev.clientX - startX) / zoom;
    const dy = (ev.clientY - startY) / zoom;
    if (!moved && dx*dx + dy*dy > moveThreshold) moved = true;
    if (!moved) return;
    dragCommitter.schedule(dx, dy);
  }
  function onUp(ev) {
    if (!moved) {
      if (!isSelected(obj.id)) selectObject(obj.id);
      if (canClickToEditText) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const clickEditStart = canvasInputNow();
        let clickEditStepStart = clickEditStart;
        const logClickEditStep = (label, meta = {}) => {
          const t = canvasInputNow();
          canvasInputTextDebugLog(label, obj, {
            phase: 'click-to-edit',
            clientX: ev?.clientX ?? '',
            clientY: ev?.clientY ?? '',
            startClientX: startX,
            startClientY: startY,
            selectedCount: selectedIds.size,
            wasSelected,
            canClickToEditText,
            ms: canvasInputDebugRound(t - clickEditStepStart),
            totalMs: canvasInputDebugRound(t - clickEditStart),
            ...meta,
          });
          clickEditStepStart = t;
        };
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        logClickEditStep('click-to-edit-start', {
          hasEditProxy: !!_editEl,
          previousEditingId: editingId || '',
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const enterEditStart = canvasInputNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        enterEdit(obj.id, { placeInitialCaret: false });
        logClickEditStep('click-to-edit-enter-edit', {
          enterEditMs: canvasInputDebugRound(canvasInputNow() - enterEditStart),
          hasEditProxy: !!_editEl,
          editingId: editingId || '',
        });
        if (_editEl && ev) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const worldStart = canvasInputNow();
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          const upPoint = toWorld(ev.clientX, ev.clientY);
          logClickEditStep('click-to-edit-world-point', {
            wx: upPoint.x,
            wy: upPoint.y,
            worldPointMs: canvasInputDebugRound(canvasInputNow() - worldStart),
          });
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const layoutStart = canvasInputNow();
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          const layout = getTextLayout(obj);
          logClickEditStep('click-to-edit-layout', {
            layoutMs: canvasInputDebugRound(canvasInputNow() - layoutStart),
            layoutLines: Array.isArray(layout) ? layout.length : '',
            layoutCached: Array.isArray(obj?._layoutCache),
          });
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const hitStart = canvasInputNow();
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          const clickHit = layoutHitTestCaret(layout, upPoint.x, upPoint.y, obj);
          logClickEditStep('click-to-edit-hit', {
            hitMs: canvasInputDebugRound(canvasInputNow() - hitStart),
            returnedIdx: clickHit?.index ?? '',
            affinity: clickHit?.affinity || '',
            lineStartIndex: clickHit?.lineStartIndex ?? '',
          });
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const caretStart = canvasInputNow();
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          applyTextEditCaretHit(obj, _editEl, clickHit);
          logClickEditStep('click-to-edit-caret-applied', {
            caretApplyMs: canvasInputDebugRound(canvasInputNow() - caretStart),
            selectionStart: _editEl.selectionStart ?? '',
            selectionEnd: _editEl.selectionEnd ?? '',
            selectionDirection: _editEl.selectionDirection || 'none',
            scriptCaretIndex: obj._textScriptCaretIndex ?? '',
            scriptCaretAffinity: obj._textScriptCaretAffinity || '',
            textEditCaretIndex: obj._textEditCaretIndex ?? '',
            textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
          });
          TextSelDebug._logSelection('click-to-edit', _editEl, obj);
          _caretVisible = true;
          if (ev?.isTrusted) {
            if (typeof BOARDFISH_PRODUCTION === 'undefined') {
              /* BOARDFISH_DEV_DIAGNOSTICS_START */
              const focusResult = focusTextEditProxyNow(_editEl, obj, 'click-to-edit-focus', {
                phase: 'click-to-edit',
                clientX: ev?.clientX ?? '',
                clientY: ev?.clientY ?? '',
                startClientX: startX,
                startClientY: startY,
                selectedCount: selectedIds.size,
                wasSelected,
                canClickToEditText,
                selectionStart: _editEl.selectionStart ?? '',
                selectionEnd: _editEl.selectionEnd ?? '',
              });
              logClickEditStep('click-to-edit-focus', {
                focusResult,
                activeElementIsProxy: typeof document !== 'undefined' ? document.activeElement === _editEl : '',
              });
              /* BOARDFISH_DEV_DIAGNOSTICS_END */
            } else {
              focusTextEditProxyNow(_editEl);
            }
          }
        }
        logClickEditStep('click-to-edit-end', {
          hasEditProxy: !!_editEl,
          editingId: editingId || '',
          clickToEditTotalMs: canvasInputDebugRound(canvasInputNow() - clickEditStart),
        });
      }
      return;
    }
    dragCommitter.flush();
    for (const item of dragItems) markDirty(item.obj.id);
    pushHistory('drag');
  }
  beginDocumentDrag({ move: onMove, up: onUp });
  return true;
}

canvas.addEventListener('mousedown', (e) => {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const mouseDownStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (isBoardInputBlocked() && !(isBoardNavigationAllowedWhileBlocked() && e.button === 0 && _spaceDown)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // Spacebar pan
  if (e.button === 0 && _spaceDown) {
    startMousePan(e);
    return;
  }

  if (e.button !== 0) return;

  // Don't capture clicks on sel-overlay handles
  if (e.target !== canvas && e.target !== boardCanvas) return;

  e.preventDefault();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let emptyTextDeleted = false;
  let emptyTextCleanupMs = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const cleanupStart = canvasInputNow();
    emptyTextDeleted = BoardfishEditorState.deleteEmptyTextObjects('delete-empty-text', {
      preserveId: editingId,
    });
    emptyTextCleanupMs = canvasInputDebugRound(canvasInputNow() - cleanupStart);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else {
    BoardfishEditorState.deleteEmptyTextObjects('delete-empty-text', {
      preserveId: editingId,
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const worldStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const wp = toWorld(e.clientX, e.clientY);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const worldPointMs = canvasInputDebugRound(canvasInputNow() - worldStart);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const additive = e.metaKey || e.ctrlKey;
  const groupDrag = isMultiSelected() && !additive && rectContainsPoint(selectedBounds(), wp);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hitStart = canvasInputNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const obj = groupDrag ? null : BoardObjectGeometry.topObjectAtWorldPoint(wp);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hitTestMs = canvasInputDebugRound(canvasInputNow() - hitStart);
  canvasInputTextDebugLog('canvas-mousedown-route', obj, {
    phase: 'canvas-mousedown',
    clientX: e.clientX,
    clientY: e.clientY,
    wx: wp.x,
    wy: wp.y,
    button: e.button,
    detail: e.detail ?? '',
    additive,
    groupDrag,
    emptyTextDeleted: !!emptyTextDeleted,
    emptyTextCleanupMs,
    worldPointMs,
    hitTestMs,
    hitObjectId: obj?.id || '',
    hitObjectType: obj?.type || '',
    hitObjectSelected: obj ? isSelected(obj.id) : '',
    selectedCount: selectedIds.size,
    editingId: editingId || '',
    ms: canvasInputDebugRound(canvasInputNow() - mouseDownStart),
    totalMs: canvasInputDebugRound(canvasInputNow() - mouseDownStart),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  // Multi-select: any click inside the bounding box (object or empty space) → drag group
  if (groupDrag) { startGroupDrag(e); return; }

  if (!obj) {
    startRubberBandSelection(e, additive);
    return;
  }

  if (additive) {
    toggleAdditiveSelection(obj);
    return;
  }

  // Click inside the currently edited text object: position caret / start drag-select
  if (editingId && obj.id === editingId && selectedIds.size === 1) {
    startTextSelectionDrag(e, obj, wp);
    return;
  }

  startObjectDrag(e, obj);
});
