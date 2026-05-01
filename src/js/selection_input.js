// ─── Screen-space selection overlay ──────────────────────────────────────────
var _selOverlayStyleState = { transform: '', width: '', height: '' };
var _multiSelBoxes = [];
var _multiSelStyleState = new WeakMap();
var _rubberBandStyleState = { display: '', left: '', top: '', width: '', height: '' };
var _rubberBandDragActive = false;

function beginRubberBandDrag() {
  if (_rubberBandDragActive) return;
  _rubberBandDragActive = true;
  _rubberBandShieldRelease = acquireInputShield('pointermove', 'pointerup:0', 'mousemove', 'mouseup:0');
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

function inputNameFromEvent(e) {
  if (e.type === 'keydown' || e.type === 'keyup') {
    return e.key ? `key:${e.key.toLowerCase()}` : e.type;
  }
  return e.type;
}

function isUnsavedDialogOpen() {
  return !!document.getElementById('dialog-overlay')?.classList.contains('show');
}

function isEventInsideUnsavedDialog(e) {
  const dialog = document.getElementById('dialog');
  return !!dialog && e.target instanceof Node && dialog.contains(e.target);
}

function isEventInsideVisibleContextMenu(e) {
  if (!(e.target instanceof Node)) return false;
  return (
    (ctxMenu.classList.contains('visible') && ctxMenu.contains(e.target)) ||
    (objCtxMenu.classList.contains('visible') && objCtxMenu.contains(e.target))
  );
}

function isShieldInputAllowed(e) {
  if (isUnsavedDialogOpen()) return isEventInsideUnsavedDialog(e);
  if (isEventInsideVisibleContextMenu(e)) return true;
  if (openingShield.classList.contains('active') && !_inputShieldStack.length) return false;
  if (_boardOpening) return false;
  if (_inputShieldStack.length === 0) return true;
  const input = inputNameFromEvent(e);
  const buttonInput = typeof e.button === 'number' ? `${e.type}:${e.button}` : '';
  return _inputShieldStack.every(({ allow }) => (
    allow.has(input) || (buttonInput && allow.has(buttonInput))
  ));
}

function blockShieldInput(e) {
  if (isShieldInputAllowed(e)) return;
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

function _setMultiBoxDisplayIfChanged(el, value) {
  let state = _multiSelStyleState.get(el);
  if (!state) {
    state = { display: '', transform: '', width: '', height: '' };
    _multiSelStyleState.set(el, state);
  }
  _setStyleIfChanged(el, 'display', value, state);
  return state;
}

function hideMultiSelectionOverlay() {
  if (!multiSelOverlay) return;
  if (multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.remove('visible');
  for (const box of _multiSelBoxes) _setMultiBoxDisplayIfChanged(box, 'none');
}

function updateMultiSelectionOverlay() {
  if (!multiSelOverlay || !isMultiSelected()) {
    hideMultiSelectionOverlay();
    return;
  }

  while (_multiSelBoxes.length < selectedIds.size) {
    const box = document.createElement('div');
    box.className = 'multi-sel-box';
    _multiSelBoxes.push(box);
    _multiSelStyleState.set(box, { display: '', transform: '', width: '', height: '' });
    multiSelOverlay.appendChild(box);
  }

  let selectedIdx = 0;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    const box = _multiSelBoxes[selectedIdx++];
    const state = _setMultiBoxDisplayIfChanged(box, 'block');
    _setStyleIfChanged(box, 'transform', `translate(${obj.x * zoom + panX}px,${obj.y * zoom + panY}px)`, state);
    _setStyleIfChanged(box, 'width', (obj.w * zoom) + 'px', state);
    _setStyleIfChanged(box, 'height', (obj.h * zoom) + 'px', state);
  }

  for (let i = selectedIdx; i < _multiSelBoxes.length; i++) {
    _setMultiBoxDisplayIfChanged(_multiSelBoxes[i], 'none');
  }

  if (!multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.add('visible');
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
    selectedId = null;
    selectedIds.clear();
    return;
  }

  const bounds = selectedBounds();
  if (!bounds) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    selectedId = null;
    selectedIds.clear();
    return;
  }

  const sx = bounds.x1 * zoom + panX;
  const sy = bounds.y1 * zoom + panY;
  const sw = (bounds.x2 - bounds.x1) * zoom;
  const sh = (bounds.y2 - bounds.y1) * zoom;

  _setStyleIfChanged(selOverlay, 'transform', `translate(${sx}px,${sy}px)`, _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'width', sw + 'px', _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'height', sh + 'px', _selOverlayStyleState);
  if (isMultiSelected()) {
    if (!selOverlay.classList.contains('multi')) selOverlay.classList.add('multi');
  } else {
    if (selOverlay.classList.contains('multi')) selOverlay.classList.remove('multi');
  }
  if (editingId) {
    if (!selOverlay.classList.contains('editing')) selOverlay.classList.add('editing');
  } else {
    if (selOverlay.classList.contains('editing')) selOverlay.classList.remove('editing');
  }
  if (!isMultiSelected() && firstSelectedObj.type === 'text') {
    if (!selOverlay.classList.contains('text-resize')) selOverlay.classList.add('text-resize');
  } else {
    if (selOverlay.classList.contains('text-resize')) selOverlay.classList.remove('text-resize');
  }
  updateMultiSelectionOverlay();
  if (!selOverlay.classList.contains('visible')) selOverlay.classList.add('visible');
}

// Init overlay handle listeners once — they always operate on selectedId / selectedIds
(function initOverlayHandles() {
  for (const handle of selOverlay.querySelectorAll('.s-handle')) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;

      // ── Multi-select: scale non-text objects proportionally within bounding box ──
      if (isMultiSelected()) {
        const bounds = selectedBounds();
        if (!bounds) return;
        const origBX = bounds.x1, origBY = bounds.y1, origBW = bounds.x2 - bounds.x1, origBH = bounds.y2 - bounds.y1;
        const ratio = origBW / origBH;

        const snapshots = [];
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o || o.type === 'text') continue;
          snapshots.push({
            id,
            relX: (o.x - origBX) / origBW, relY: (o.y - origBY) / origBH,
            relW: o.w / origBW, relH: o.h / origBH,
          });
        }
        if (!snapshots.length) return;

        const MIN_B = 20;
        function applyMultiResize({ bx, by, bw, bh }) {
          for (const snap of snapshots) {
            const o = objectsMap.get(snap.id);
            if (!o) continue;
            o.x = bx + snap.relX * bw; o.y = by + snap.relY * bh;
            o.w = snap.relW * bw; o.h = snap.relH * bh;
          }
          scheduleRender(true, true);
        }
        const resizeCommitter = createRafCommitter(applyMultiResize);

        function onMultiMove(ev) {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          const useX = Math.abs(dx) >= Math.abs(dy);
          let bw = origBW, bh = origBH, bx = origBX, by = origBY;

          if (dir === 'se') { bw = Math.max(MIN_B, useX ? origBW + dx : (origBH + dy) * ratio); }
          else if (dir === 'sw') { bw = Math.max(MIN_B, useX ? origBW - dx : (origBH + dy) * ratio); }
          else if (dir === 'ne') { bw = Math.max(MIN_B, useX ? origBW + dx : (origBH - dy) * ratio); }
          else if (dir === 'nw') { bw = Math.max(MIN_B, useX ? origBW - dx : (origBH - dy) * ratio); }
          bh = bw / ratio;

          if (dir.includes('w')) bx = origBX + origBW - bw;
          if (dir.includes('n')) by = origBY + origBH - bh;

          resizeCommitter.schedule({ bx, by, bw, bh });
        }

        beginDocumentDrag({
          move: onMultiMove,
          up() {
            resizeCommitter.flush();
            for (const snap of snapshots) markDirty(snap.id);
            pushHistory('multi-resize');
          },
        });
        return;
      }

      // ── Single select ──
      if (!selectedId) return;
      const obj = objectsMap.get(selectedId);
      if (!obj) return;

      const { x: ox, y: oy, w: ow, h: oh } = obj;
      const MIN = 20;

      function applyResize(state) {
        obj.x = state.x;
        obj.y = state.y;
        obj.w = state.w;
        obj.h = state.h;
        if (obj.type === 'text') {
          delete obj._layoutCache;
          syncTextAutoHeight(obj, getTextMinLines(obj));
        }
        scheduleRender(true, true);
      }
      const resizeCommitter = createRafCommitter(applyResize);

      function onMove(ev) {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let x = ox, y = oy, w = ow, h = oh;

        if (obj.type === 'image') {
          const ratio = ow / oh;
          const useX = Math.abs(dx) >= Math.abs(dy);
          if (dir.includes('e') && dir.includes('s')) { w = Math.max(MIN, useX ? ow + dx : (oh + dy) * ratio); }
          else if (dir.includes('w') && dir.includes('s')) { w = Math.max(MIN, useX ? ow - dx : (oh + dy) * ratio); }
          else if (dir.includes('e') && dir.includes('n')) { w = Math.max(MIN, useX ? ow + dx : (oh - dy) * ratio); }
          else if (dir.includes('w') && dir.includes('n')) { w = Math.max(MIN, useX ? ow - dx : (oh - dy) * ratio); }
          h = w / ratio;
          if (dir.includes('w')) x = ox + ow - w;
          if (dir.includes('n')) y = oy + oh - h;
        } else {
          if (dir.includes('e')) w = Math.max(MIN, ow + dx);
          h = oh;
          if (dir.includes('w')) { w = Math.max(MIN, ow - dx); x = ox + ow - w; }
        }

        resizeCommitter.schedule({ x, y, w, h });
      }

      beginDocumentDrag({
        move: onMove,
        up() {
          resizeCommitter.flush();
          markDirty(obj.id);
          pushHistory('resize');
        },
      });
    });
  }
})();


// ─── Selection ────────────────────────────────────────────────────────────────

function selectObject(id) {
  if (editingId && editingId !== id) exitEdit();
  selectedIds.clear();
  selectedIds.add(id);
  selectedId = id;
  const obj = objectsMap.get(id);
  if (obj) {
    bringObjectToFront(id);
    markDirty(id);
    obj.z = ++zCounter;
  }
  scheduleRender(true, true);
}

function deselectAll() {
  if (editingId) exitEdit();
  selectedId = null;
  selectedIds.clear();
  scheduleRender(false, true);
}

function selectAllObjects() {
  if (editingId || !objects.length) return;
  selectedIds.clear();
  for (const obj of objects) selectedIds.add(obj.id);
  selectedId = objects[objects.length - 1].id;
  scheduleRender(false, true);
}

function hideMenus() {
  MenuDebug.log('hideMenus', { reason: 'generic' });
  ctxMenu.classList.remove('visible');
  objCtxMenu.classList.remove('visible');
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

function pushEditHistoryIfChanged(id) {
  const obj = objectsMap.get(id);
  if (!obj) return;
  if (_editHistoryLastContent === null) _editHistoryLastContent = obj.data.content;
  if (obj.data.content === _editHistoryLastContent) return;
  markDirty(id);
  pushHistory('text-edit-checkpoint');
  _editHistoryLastContent = obj.data.content;
}

function scheduleEditHistoryCheckpoint(id) {
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = setTimeout(() => {
    _editHistoryTimer = null;
    pushEditHistoryIfChanged(id);
  }, EDIT_HISTORY_DEBOUNCE_MS);
}
