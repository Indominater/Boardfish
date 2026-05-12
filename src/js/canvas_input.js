// ─── Zoom ─────────────────────────────────────────────────────────────────────
var ZOOM_MIN = 0.001, ZOOM_MAX = 1000;
var _editEl = null;
var _caretVisible = true;
var _caretBlinkInterval = null;
var _selChangeListener = null;
var _editHistoryTimer = null;
var _editHistoryLastContent = null;
var EDIT_HISTORY_DEBOUNCE_MS = 500;

function cancelWheelPan() {
  // Wheel panning is applied immediately and coalesced by the shared render RAF.
}


function handleViewportWheel(e) {
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
    if (typeof eyedropperSampling !== 'undefined' && eyedropperSampling) {
      cancelWheelPan();
      ViewportDebug.end(dbg, { mode: 'blocked-eyedropper-sampling', panX, panY, zoom });
      return;
    }
    if (editingId) {
      _caretVisible = true;
    }
    if (e.ctrlKey || e.metaKey) {
      if (typeof noteEyedropperNavigationActive === 'function') noteEyedropperNavigationActive('wheel-zoom');
      ViewportDebug.count('wheelZoom');
      const factor = Math.abs(e.deltaY) < 30
        ? Math.pow(0.995, e.deltaY)
        : e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      BoardfishViewportState.zoomAroundClient(e.clientX, e.clientY, newZoom);
      scheduleTransform('wheel-zoom', e);
      ViewportDebug.end(dbg, { mode: 'zoom', newZoom, panX, panY });
      return;
    }

    if (typeof noteEyedropperNavigationActive === 'function') noteEyedropperNavigationActive('wheel-pan');
    ViewportDebug.count('wheelPan');
    BoardfishViewportState.panBy(-e.deltaX, -e.deltaY);
    scheduleTransform('wheel-pan', e);
    ViewportDebug.end(dbg, { mode: 'pan', appliedDX: e.deltaX, appliedDY: e.deltaY, panX, panY });
  } finally {
    if (collectDebug) ViewportDebug.timing('wheelHandler', performance.now() - handlerStart);
  }
}

canvas.addEventListener('wheel', handleViewportWheel, { passive: false });
document.addEventListener('wheel', (e) => {
  const insideContextMenu =
    typeof isEventInsideVisibleContextMenu === 'function' &&
    isEventInsideVisibleContextMenu(e);
  const insideEyedropperLoupe =
    typeof isEventInsideVisibleEyedropperLoupe === 'function' &&
    isEventInsideVisibleEyedropperLoupe(e);
  if (!insideContextMenu && !insideEyedropperLoupe) return;
  handleViewportWheel(e);
}, { capture: true, passive: false });

// ─── Pan (spacebar + left click) ─────────────────────────────────────────────
var _spaceDown = false;

document.addEventListener('keydown', (e) => {
  if (typeof eyedropperSampling !== 'undefined' && eyedropperSampling && e.code === 'Space') {
    e.preventDefault();
    return;
  }
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
    if (typeof noteEyedropperNavigationActive === 'function') noteEyedropperNavigationActive('space');
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
  if (typeof noteEyedropperNavigationActive === 'function') noteEyedropperNavigationActive('mouse-pan', 240);
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;
  const startPanX = panX, startPanY = panY;
  function onMove(ev) {
    const collectDebug = ViewportDebug.isEnabled();
    const handlerStart = collectDebug ? performance.now() : 0;
    try {
      ViewportDebug.count('mousePanMoves');
      if (typeof noteEyedropperNavigationActive === 'function') noteEyedropperNavigationActive('mouse-pan', 240);
      BoardfishViewportState.setPan(startPanX + (ev.clientX - startX), startPanY + (ev.clientY - startY));
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

document.addEventListener('mousedown', (e) => {
  if (typeof isEventInsideVisibleEyedropperLoupe !== 'function' || !isEventInsideVisibleEyedropperLoupe(e)) return;
  if (e.button === 0 && _spaceDown) startMousePan(e);
}, true);

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
      for (const item of grpItems) markDirty(item.obj.id);
      pushHistory('group-drag');
    },
  });
  return true;
}

function startRubberBandSelection(e, additive) {
  if (!additive) deselectAll();
  const rbStartX = e.clientX, rbStartY = e.clientY;
  beginRubberBandDrag();
  let rbActive = false;
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
    finishRubberBandDrag();
    _setStyleIfChanged(rubberBand, 'display', 'none', _rubberBandStyleState);
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
  }
  beginDocumentDrag({ move: onRbMove, up: onRbUp });
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
}

function startTextSelectionDrag(e, obj, wp) {
  const layout = getTextLayout(obj);
  const clickIdx = layoutHitTest(layout, wp.x, wp.y, obj);
  if (_editEl) {
    _editEl.focus({ preventScroll: true });
    _editEl.setSelectionRange(clickIdx, clickIdx);
    TextSelDebug._logSelection('mouse-down', _editEl);
    _caretVisible = true;
    scheduleRender(true, false);
  }
  function onSelMove(ev) {
    const wp2 = toWorld(ev.clientX, ev.clientY);
    const endIdx = layoutHitTest(obj._layoutCache || layout, wp2.x, wp2.y, obj);
    if (_editEl) {
      _editEl.setSelectionRange(Math.min(clickIdx, endIdx), Math.max(clickIdx, endIdx));
      TextSelDebug._logSelection('mouse-drag', _editEl);
      _caretVisible = true;
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
          const clickIdx = layoutHitTest(layout, upPoint.x, upPoint.y, obj);
          _editEl.focus({ preventScroll: true });
          _editEl.setSelectionRange(clickIdx, clickIdx);
          TextSelDebug._logSelection('click-to-edit', _editEl);
          _caretVisible = true;
          scheduleRender(true, false);
        }
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
  if (typeof eyedropperSampling !== 'undefined' && eyedropperSampling) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
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
