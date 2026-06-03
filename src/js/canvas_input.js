// ─── Zoom ─────────────────────────────────────────────────────────────────────
var ZOOM_MIN = 0.01, ZOOM_MAX = 100;
var _editEl = null;
var _caretVisible = true;
var _caretBlinkInterval = null;
var _selChangeListener = null;
var _editHistoryTimer = null, _editHistoryLastContent = null;
var EDIT_HISTORY_DEBOUNCE_MS = 500;
var _textInputSelectionHistorySuppress = null, _editHistoryActionStartState = null;

function handleViewportWheel(e) {
  if (e.__boardfishViewportWheelHandled) return;
  try { e.__boardfishViewportWheelHandled = true; } catch (_) {}
  const collectDebug = ViewportDebug.isEnabled();
  const handlerStart = collectDebug ? performance.now() : 0;
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
    if (collectDebug) ViewportDebug.timing('wheelHandler', performance.now() - handlerStart);
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
    const handlerStart = collectDebug ? performance.now() : 0;
    try {
      ViewportDebug.count('mousePanMoves');
      BoardfishViewportState.setPan(startPanX + (ev.clientX - startX), startPanY + (ev.clientY - startY));
      globalThis.BoardfishMotion?.applyActionAnimation?.('board-canvas-pan');
      scheduleTransform('mouse-pan', ev);
    } finally {
      if (collectDebug) ViewportDebug.timing('mousePanHandler', performance.now() - handlerStart);
    }
  }
  function onUp(ev) {
    if (ev.button !== 0) return;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    ViewportDebug.end(panDbg, { endX: ev.clientX, endY: ev.clientY, panX, panY });
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
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
    if (typeof setTextEditCaretIndex === 'function') setTextEditCaretIndex(obj, index);
    else obj._textEditCaretIndex = index;
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
  else delete obj._textEditCaretIndex;
}

function startTextSelectionDrag(e, obj, wp) {
  if (typeof flushEditHistoryCheckpoint === 'function') flushEditHistoryCheckpoint();
  const layout = getTextLayout(obj);
  const clickHit = textCaretHitForPoint(layout, wp.x, wp.y, obj);
  const clickIdx = clickHit.index;
  if (_editEl) {
    _editEl.focus({ preventScroll: true });
    applyTextEditCaretHit(obj, _editEl, clickHit);
    TextSelDebug._logSelection('mouse-down', _editEl);
    _caretVisible = true;
    globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-caret-move');
    scheduleRender(true, false);
  }
  function onSelMove(ev) {
    const wp2 = toWorld(ev.clientX, ev.clientY);
    const endHit = textCaretHitForPoint(obj._layoutCache || layout, wp2.x, wp2.y, obj);
    const endIdx = endHit.index;
    if (_editEl) {
      _editEl.setSelectionRange(Math.min(clickIdx, endIdx), Math.max(clickIdx, endIdx));
      if (clickIdx === endIdx) applyTextEditCaretHit(obj, _editEl, endHit);
      else clearTextEditCaretHit(obj);
      TextSelDebug._logSelection('mouse-drag', _editEl);
      _caretVisible = true;
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-drag-select');
      scheduleRender(true, false);
    }
  }
  beginDocumentDrag({ move: onSelMove });
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
        enterEdit(obj.id);
        if (_editEl && ev) {
          const upPoint = toWorld(ev.clientX, ev.clientY);
          const layout = getTextLayout(obj);
          const clickHit = textCaretHitForPoint(layout, upPoint.x, upPoint.y, obj);
          _editEl.focus({ preventScroll: true });
          applyTextEditCaretHit(obj, _editEl, clickHit);
          TextSelDebug._logSelection('click-to-edit', _editEl);
          _caretVisible = true;
          globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-caret-move');
          scheduleRender(true, false);
        }
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
  BoardfishEditorState.deleteEmptyTextObjects('delete-empty-text', {
    preserveIds: editingId ? [editingId] : [],
  });
  const wp = toWorld(e.clientX, e.clientY);
  const obj = hitTest(wp.x, wp.y);
  const additive = e.metaKey || e.ctrlKey;

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
