// ─── Zoom ─────────────────────────────────────────────────────────────────────
var ZOOM_MIN = 0.01, ZOOM_MAX = 100;
var _editEl = null;
var _caretVisible = true;
var _caretBlinkInterval = null;
var _selChangeListener = null;
var _editHistoryTimer = null, _editHistoryLastContent = null;
var EDIT_HISTORY_DEBOUNCE_MS = 500;
var _textInputSelectionHistorySuppress = null, _editHistoryActionStartState = null;

function canvasInputNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function canvasInputDebugRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function canvasInputTextDebugLog(label, obj = null, meta = {}) {
  if (typeof TextSelDebug === 'undefined') return;
  TextSelDebug._logEditLifecycle?.(label, obj, meta);
}

function focusTextEditProxyNow(proxy, obj = null, label = 'text-edit-focus', meta = {}) {
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

function scheduleTextEditProxyFocus(proxy, obj = null, label = 'text-edit-focus-deferred', meta = {}) {
  if (!proxy) return false;
  if (typeof document !== 'undefined' && document.activeElement === proxy) {
    canvasInputTextDebugLog(label, obj, {
      ...meta,
      skipped: true,
      reason: 'already-active',
      focusMs: 0,
      activeElementIsProxy: true,
    });
    return false;
  }
  const scheduledAt = canvasInputNow();
  const runFocus = () => {
    if (_editEl !== proxy || !editingId) {
      canvasInputTextDebugLog(label, obj, {
        ...meta,
        skipped: true,
        reason: 'stale-proxy',
        scheduledDelayMs: canvasInputDebugRound(canvasInputNow() - scheduledAt),
      });
      return;
    }
    focusTextEditProxyNow(proxy, obj, label, {
      ...meta,
      scheduledDelayMs: canvasInputDebugRound(canvasInputNow() - scheduledAt),
    });
  };
  if (typeof requestAnimationFrame === 'function' && typeof setTimeout === 'function') {
    requestAnimationFrame(() => setTimeout(runFocus, 0));
  } else if (typeof setTimeout === 'function') {
    setTimeout(runFocus, 0);
  } else {
    runFocus();
  }
  return true;
}

function handleViewportWheel(e) {
  if (e.__boardfishViewportWheelHandled) return;
  try { e.__boardfishViewportWheelHandled = true; } catch (_) {}
  const collectDebug = ViewportDebug.isEnabled();
  const handlerStart = collectDebug ? canvasInputNow() : 0;
  const dbg = ViewportDebug.start('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, panX, panY, zoom });
  try {
    ViewportDebug.count('wheel');
    e.preventDefault();
    if (_rubberBandDragActive) {
      ViewportDebug.end(dbg, { mode: 'blocked-rubber-band', panX, panY, zoom });
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
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      BoardfishViewportState.zoomAroundClient(e.clientX, e.clientY, newZoom);
      globalThis.BoardfishMotion?.applyActionAnimation?.('board-wheel-zoom');
      scheduleTransform('wheel-zoom', e);
      ViewportDebug.end(dbg, { mode: 'zoom', newZoom, panX, panY });
      return;
    }

    ViewportDebug.count('wheelPan');
    BoardfishViewportState.panBy(-e.deltaX, -e.deltaY);
    globalThis.BoardfishMotion?.applyActionAnimation?.('board-canvas-pan');
    scheduleTransform('wheel-pan', e);
    ViewportDebug.end(dbg, { mode: 'pan', appliedDX: e.deltaX, appliedDY: e.deltaY, panX, panY });
  } finally {
    if (collectDebug) ViewportDebug.timing('wheelHandler', canvasInputNow() - handlerStart);
  }
}

canvas.addEventListener('wheel', handleViewportWheel, { passive: false });
for (const surface of [
  typeof ctxMenu !== 'undefined' ? ctxMenu : null,
  typeof objCtxMenu !== 'undefined' ? objCtxMenu : null,
  typeof BoardfishDOM !== 'undefined' ? BoardfishDOM.textCtxMenu : null,
  typeof ctxActions !== 'undefined' ? ctxActions : null,
  typeof island !== 'undefined' ? island : null,
].filter(Boolean)) {
  surface.addEventListener('wheel', handleViewportWheel, { passive: false });
}

function handleGlobalViewportWheel(e) {
  if (e.__boardfishViewportWheelHandled) return;
  const viewportZoomGesture = e.ctrlKey || e.metaKey;
  const insideViewportWheelSurface =
    typeof isEventInsideViewportWheelSurface === 'function' &&
    isEventInsideViewportWheelSurface(e);
  if (!viewportZoomGesture && !insideViewportWheelSurface) return;
  handleViewportWheel(e);
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('wheel', handleGlobalViewportWheel, { capture: true, passive: false });
}
document.addEventListener('wheel', handleGlobalViewportWheel, { capture: true, passive: false });

// ─── Pan (spacebar + left click) ─────────────────────────────────────────────
var _spaceDown = false,
  _rubberBandSelectionCleanup = null,
  _rubberBandSelectionCancel = null,
  hideRubberBandSelectionVisual = null,
  cancelRubberBandSelection = null;

document.addEventListener('keydown', (e) => {
  if (isBoardInputBlocked() && !(isBoardNavigationAllowedWhileBlocked() && e.code === 'Space')) {
    if (e.code === 'Space') e.preventDefault();
    return;
  }
  if (_rubberBandDragActive) {
    if (e.code === 'Space') e.preventDefault();
    return;
  }
  if (e.code === 'Space' && !editingId) {
    e.preventDefault();
    if (e.repeat) return;
    _spaceDown = true;
    canvas.classList.add('panning');
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    if (_spaceDown || !editingId) e.preventDefault();
    _spaceDown = false;
    canvas.classList.remove('panning');
  }
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
  const panDbg = ViewportDebug.start('mousePan', { startX: e.clientX, startY: e.clientY, panX, panY, zoom });
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;
  const startPanX = panX, startPanY = panY;
  function onMove(ev) {
    const collectDebug = ViewportDebug.isEnabled();
    const handlerStart = collectDebug ? canvasInputNow() : 0;
    try {
      ViewportDebug.count('mousePanMoves');
      BoardfishViewportState.setPan(startPanX + (ev.clientX - startX), startPanY + (ev.clientY - startY));
      globalThis.BoardfishMotion?.applyActionAnimation?.('board-canvas-pan');
      scheduleTransform('mouse-pan', ev);
    } finally {
      if (collectDebug) ViewportDebug.timing('mousePanHandler', canvasInputNow() - handlerStart);
    }
  }
  function onUp(ev) {
    if (ev && !ev.__boardfishDragCancel && ev.button !== 0) return;
    ViewportDebug.end(panDbg, { endX: ev?.clientX ?? '', endY: ev?.clientY ?? '', panX, panY, cancelled: !!ev?.__boardfishDragCancel });
  }
  beginDocumentDrag({ move: onMove, up: onUp });
}

function startGroupDrag(e) {
  const grpStartX = e.clientX, grpStartY = e.clientY;
  const grpItems = dragItemsForSelection();
  if (!grpItems.length) return false;
  let grpMoved = false;
  const grpThreshold = 9 / (zoom * zoom);
  function applyGrpDrag(dx, dy) {
    for (const item of grpItems) { item.obj.x = item.startX + dx; item.obj.y = item.startY + dy; }
    withRenderSource('group-drag', () => drawBoard());
    updateSelectionOverlay();
  }
  const dragCommitter = createRafCommitter(({ dx, dy }) => applyGrpDrag(dx, dy));
  function onGrpMove(ev) {
    const dx = (ev.clientX - grpStartX) / zoom, dy = (ev.clientY - grpStartY) / zoom;
    if (!grpMoved && dx*dx + dy*dy > grpThreshold) grpMoved = true;
    if (!grpMoved) return;
    dragCommitter.schedule({ dx, dy });
  }
  beginDocumentDrag({
    move: onGrpMove,
    up() {
      if (!grpMoved) return;
      dragCommitter.flush();
      let hasText = false;
      let hasNonText = false;
      for (const item of grpItems) {
        markDirty(item.obj.id);
        if (item.obj?.type === 'text') hasText = true;
        else hasNonText = true;
      }
      if (hasText) {
        globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-drag');
      }
      if (hasNonText) {
        globalThis.BoardfishMotion?.applyActionAnimation?.('object-group-drag', {
          selection: true,
          options: { includeText: false },
        });
      }
      pushHistory('group-drag');
    },
  });
  return true;
}

hideRubberBandSelectionVisual = () => {
  finishRubberBandDrag();
  _setStyleIfChanged(rubberBand, 'display', 'none', _rubberBandStyleState);
};

cancelRubberBandSelection = (reason = 'cancel') => {
  if (_rubberBandSelectionCancel) {
    _rubberBandSelectionCancel(reason);
    return true;
  }
  if (!_rubberBandDragActive) return false;
  hideRubberBandSelectionVisual();
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
  function onRbMove(ev) {
    const dx = ev.clientX - rbStartX, dy = ev.clientY - rbStartY;
    if (!rbActive && dx*dx + dy*dy > 16) rbActive = true;
    if (!rbActive) return;
    const l = Math.min(rbStartX, ev.clientX), t = Math.min(rbStartY, ev.clientY);
    const w = Math.abs(dx), h = Math.abs(dy);
    _setStyleIfChanged(rubberBand, 'display', 'block', _rubberBandStyleState);
    _setStyleIfChanged(rubberBand, 'left', l + 'px', _rubberBandStyleState);
    _setStyleIfChanged(rubberBand, 'top', t + 'px', _rubberBandStyleState);
    _setStyleIfChanged(rubberBand, 'width', w + 'px', _rubberBandStyleState);
    _setStyleIfChanged(rubberBand, 'height', h + 'px', _rubberBandStyleState);
  }
  function onRbUp(ev) {
    if (rbFinished) return;
    rbFinished = true;
    _rubberBandSelectionCleanup = null;
    _rubberBandSelectionCancel = null;
    hideRubberBandSelectionVisual();
    if (ev?.__boardfishRubberBandCancel) return;
    globalThis.BoardfishMotion?.applyActionAnimation?.('rubber-band-release');
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
    if (nextSelection.size === selectedIds.size && [...nextSelection].every((id) => selectedIds.has(id))) return;
    BoardfishEditorState.setSelection([...nextSelection]);
    scheduleRender(true, true);
    globalThis.BoardfishMotion?.applyActionAnimation?.('rubber-band-select', {
      selection: true,
      options: { includeText: false },
    });
  }
  _rubberBandSelectionCancel = (reason) => {
    const cleanup = _rubberBandSelectionCleanup;
    const cancelEvent = { __boardfishRubberBandCancel: true, reason };
    if (cleanup) cleanup(cancelEvent);
    else onRbUp(cancelEvent);
  };
  _rubberBandSelectionCleanup = beginDocumentDrag({ move: onRbMove, up: onRbUp });
}

function toggleAdditiveSelection(obj) {
  const nextSelection = new Set(selectedIds);
  if (isSelected(obj.id)) {
    nextSelection.delete(obj.id);
    BoardfishEditorState.setSelection([...nextSelection]);
  } else {
    nextSelection.add(obj.id);
    BoardfishEditorState.setSelection([...nextSelection], { primaryId: obj.id });
    const addedObj = objectsMap.get(obj.id);
    if (addedObj) {
      bringObjectToFront(obj.id);
      markDirty(obj.id);
      addedObj.z = ++zCounter;
    }
  }
  scheduleRender(true, true);
  globalThis.BoardfishMotion?.applyActionAnimation?.('additive-select', {
    selection: true,
    options: { includeText: false },
  });
}

function textCaretHitForPoint(layout, wx, wy, obj) {
  if (typeof layoutHitTestCaret === 'function') return layoutHitTestCaret(layout, wx, wy, obj);
  return { index: layoutHitTest(layout, wx, wy, obj), affinity: '' };
}

function applyTextEditCaretHit(obj, proxy, hit) {
  if (!obj || !proxy || !hit) return;
  const textContent = typeof normalizeTextContent === 'function'
    ? normalizeTextContent(obj.data?.content || '')
    : String(obj.data?.content || '').replace(/\r\n?/g, '\n');
  const textLength = textContent.length;
  const index = Math.max(0, Math.min(Math.trunc(hit.index ?? 0), textLength));
  proxy.setSelectionRange(index, index, 'none');
  if (hit.affinity) {
    if (typeof setTextScriptCaretAffinity === 'function') {
      setTextScriptCaretAffinity(obj, index, hit.affinity);
    } else {
      obj._textScriptCaretIndex = index;
      obj._textScriptCaretAffinity = hit.affinity;
      obj._textEditCaretIndex = index;
    }
  } else {
    if (typeof clearTextScriptCaretAffinity === 'function') clearTextScriptCaretAffinity(obj);
    else {
      delete obj._textScriptCaretIndex;
      delete obj._textScriptCaretAffinity;
    }
    if (typeof setTextEditCaretIndex === 'function') {
      setTextEditCaretIndex(obj, index, { lineStartIndex: hit.lineStartIndex });
    } else {
      obj._textEditCaretIndex = index;
      if (Number.isFinite(hit.lineStartIndex)) obj._textEditCaretLineStartIndex = hit.lineStartIndex;
    }
  }
}

function clearTextEditCaretHit(obj) {
  if (!obj) return;
  if (typeof clearTextScriptCaretAffinity === 'function') clearTextScriptCaretAffinity(obj);
  else {
    delete obj._textScriptCaretIndex;
    delete obj._textScriptCaretAffinity;
  }
  if (typeof clearTextEditCaretIndex === 'function') clearTextEditCaretIndex(obj);
  else {
    delete obj._textEditCaretIndex;
    delete obj._textEditCaretLineStartIndex;
  }
}

function startTextSelectionDrag(e, obj, wp) {
  if (typeof flushEditHistoryCheckpoint === 'function') flushEditHistoryCheckpoint();
  TextSelDebug._logPointer?.('selection-drag-start', e, { objectId: obj?.id || '', wx: wp.x, wy: wp.y });
  const layoutStart = canvasInputNow();
  const layout = getTextLayout(obj);
  TextSelDebug._logLayout?.('selection-drag-start-layout', obj, layout, canvasInputNow() - layoutStart);
  const clickHitStart = canvasInputNow();
  const clickHit = textCaretHitForPoint(layout, wp.x, wp.y, obj);
  TextSelDebug._logHitTiming?.('selection-drag-start-hit', obj, clickHit, canvasInputNow() - clickHitStart, {
    wx: wp.x,
    wy: wp.y,
  });
  const clickIdx = clickHit.index;
  if (_editEl) {
    applyTextEditCaretHit(obj, _editEl, clickHit);
    focusTextEditProxyNow(_editEl, obj, 'selection-drag-focus', {
      phase: 'selection-drag',
      clientX: e?.clientX ?? '',
      clientY: e?.clientY ?? '',
    });
    TextSelDebug._logSelection('mouse-down', _editEl, obj);
    _caretVisible = true;
    globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-caret-move');
    scheduleRender(true, false);
  }
  function onSelMove(ev) {
    const wp2 = toWorld(ev.clientX, ev.clientY);
    TextSelDebug._logPointer?.('selection-drag-move', ev, { objectId: obj?.id || '', wx: wp2.x, wy: wp2.y });
    const hitStart = canvasInputNow();
    const endHit = textCaretHitForPoint(obj._layoutCache || layout, wp2.x, wp2.y, obj);
    TextSelDebug._logHitTiming?.('selection-drag-move-hit', obj, endHit, canvasInputNow() - hitStart, {
      wx: wp2.x,
      wy: wp2.y,
    });
    const endIdx = endHit.index;
    if (_editEl) {
      _editEl.setSelectionRange(Math.min(clickIdx, endIdx), Math.max(clickIdx, endIdx));
      if (clickIdx === endIdx) applyTextEditCaretHit(obj, _editEl, endHit);
      else clearTextEditCaretHit(obj);
      TextSelDebug._logSelection('mouse-drag', _editEl, obj);
      _caretVisible = true;
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-drag-select');
      scheduleRender(true, false);
    }
  }
  function onSelUp(ev) {
    if (!ev || ev.__boardfishDragCancel) return;
    const wp2 = toWorld(ev.clientX, ev.clientY);
    TextSelDebug._logPointer?.('selection-drag-end', ev, { objectId: obj?.id || '', wx: wp2.x, wy: wp2.y });
    if (_editEl) TextSelDebug._logSelection('mouse-up', _editEl, obj);
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
    const dragDbg = ViewportDebug.start('dragFrame', { items: dragItems.length });
    withRenderSource('object-drag', () => drawBoard());
    ViewportDebug.end(dragDbg);
    updateSelectionOverlay();
  }
  const dragCommitter = createRafCommitter(({ dx, dy }) => applyDrag(dx, dy));

  function onMove(ev) {
    const dx = (ev.clientX - startX) / zoom;
    const dy = (ev.clientY - startY) / zoom;
    if (!moved && dx*dx + dy*dy > moveThreshold) moved = true;
    if (!moved) return;
    dragCommitter.schedule({ dx, dy });
  }
  function onUp(ev) {
    if (!moved) {
      if (!isSelected(obj.id)) selectObject(obj.id);
      if (canClickToEditText) {
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
        logClickEditStep('click-to-edit-start', {
          hasEditProxy: !!_editEl,
          previousEditingId: editingId || '',
        });
        const enterEditStart = canvasInputNow();
        enterEdit(obj.id, { placeInitialCaret: false });
        const gutterPrimed = typeof captureTextEditRectangleGutterPointerFromEvent === 'function'
          ? captureTextEditRectangleGutterPointerFromEvent(ev)
          : false;
        logClickEditStep('click-to-edit-enter-edit', {
          enterEditMs: canvasInputDebugRound(canvasInputNow() - enterEditStart),
          hasEditProxy: !!_editEl,
          editingId: editingId || '',
          gutterPrimed,
        });
        if (_editEl && ev) {
          const worldStart = canvasInputNow();
          const upPoint = toWorld(ev.clientX, ev.clientY);
          logClickEditStep('click-to-edit-world-point', {
            wx: upPoint.x,
            wy: upPoint.y,
            worldPointMs: canvasInputDebugRound(canvasInputNow() - worldStart),
          });
          const layoutStart = canvasInputNow();
          const layout = getTextLayout(obj);
          logClickEditStep('click-to-edit-layout', {
            layoutMs: canvasInputDebugRound(canvasInputNow() - layoutStart),
            layoutLines: Array.isArray(layout) ? layout.length : '',
            layoutCached: Array.isArray(obj?._layoutCache),
          });
          const hitStart = canvasInputNow();
          const clickHit = textCaretHitForPoint(layout, upPoint.x, upPoint.y, obj);
          logClickEditStep('click-to-edit-hit', {
            hitMs: canvasInputDebugRound(canvasInputNow() - hitStart),
            returnedIdx: clickHit?.index ?? '',
            affinity: clickHit?.affinity || '',
            lineStartIndex: clickHit?.lineStartIndex ?? '',
          });
          const caretStart = canvasInputNow();
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
          const motionStart = canvasInputNow();
          globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-caret-move');
          logClickEditStep('click-to-edit-motion', {
            motionMs: canvasInputDebugRound(canvasInputNow() - motionStart),
          });
          const renderStart = canvasInputNow();
          scheduleRender(true, false);
          logClickEditStep('click-to-edit-render-scheduled', {
            renderScheduleMs: canvasInputDebugRound(canvasInputNow() - renderStart),
          });
          const focusScheduled = scheduleTextEditProxyFocus(_editEl, obj, 'click-to-edit-focus-deferred', {
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
          logClickEditStep('click-to-edit-focus-scheduled', {
            focusScheduled,
            activeElementIsProxy: typeof document !== 'undefined' ? document.activeElement === _editEl : '',
          });
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
    let hasText = false;
    let hasNonText = false;
    for (const item of dragItems) {
      markDirty(item.obj.id);
      if (item.obj?.type === 'text') hasText = true;
      else hasNonText = true;
    }
    if (hasText) {
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-drag');
    }
    if (hasNonText) {
      globalThis.BoardfishMotion?.applyActionAnimation?.('object-drag', {
        selection: true,
        options: { includeText: false },
      });
    }
    pushHistory('drag');
  }
  beginDocumentDrag({ move: onMove, up: onUp });
  return true;
}

canvas.addEventListener('mousedown', (e) => {
  const mouseDownStart = canvasInputNow();
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
  const cleanupStart = canvasInputNow();
  const emptyTextDeleted = BoardfishEditorState.deleteEmptyTextObjects('delete-empty-text', {
    preserveIds: editingId ? [editingId] : [],
  });
  const emptyTextCleanupMs = canvasInputDebugRound(canvasInputNow() - cleanupStart);
  const worldStart = canvasInputNow();
  const wp = toWorld(e.clientX, e.clientY);
  const worldPointMs = canvasInputDebugRound(canvasInputNow() - worldStart);
  const additive = e.metaKey || e.ctrlKey;
  const rectangleGutterStart = canvasInputNow();
  const rectangleGutterHit = !additive && typeof textEditRectangleGutterHitTest === 'function'
    ? textEditRectangleGutterHitTest(e.clientX, e.clientY)
    : null;
  const rectangleGutterMs = canvasInputDebugRound(canvasInputNow() - rectangleGutterStart);
  const hitStart = canvasInputNow();
  const obj = rectangleGutterHit?.object || hitTest(wp.x, wp.y);
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
    rectangleGutterHit: !!rectangleGutterHit,
    rectangleGutterMs,
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

  if (rectangleGutterHit?.object) {
    startTextSelectionDrag(e, rectangleGutterHit.object, wp);
    return;
  }

  // Multi-select: any click inside the bounding box (object or empty space) → drag group
  if (isMultiSelected() && !additive) {
    if (rectContainsPoint(selectedBounds(), wp)) {
      if (startGroupDrag(e)) return;
      return;
    }
  }

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
