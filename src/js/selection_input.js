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

const unsavedDialogOverlayForInputShield = document.getElementById('dialog-overlay');
const unsavedDialogForInputShield = document.getElementById('dialog');

function isUnsavedDialogOpen() {
  return !!unsavedDialogOverlayForInputShield?.classList.contains('show');
}

function isEventInsideUnsavedDialog(e) {
  return !!unsavedDialogForInputShield && e.target instanceof Node && unsavedDialogForInputShield.contains(e.target);
}

const isEventInsideVisibleSurface = (e, surface) => {
  if (!surface || !surface.classList.contains('visible')) return false;
  if (e.target instanceof Node && surface.contains(e.target)) return true;
  const x = Number(e?.clientX);
  const y = Number(e?.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const pointed = document.elementFromPoint(x, y);
  return pointed instanceof Node && surface.contains(pointed);
};

const isEventInsideVisibleContextMenu = (e) => {
  return (
    isEventInsideVisibleSurface(e, ctxMenu) ||
    isEventInsideVisibleSurface(e, objCtxMenu) ||
    isEventInsideVisibleSurface(e, typeof BoardfishDOM !== 'undefined' ? BoardfishDOM.textCtxMenu : null) ||
    isEventInsideVisibleSurface(e, ctxActions)
  );
};

function isEventInsideIsland(e) {
  return !!(island && e.target instanceof Node && island.contains(e.target));
}

const isEventInsideVisibleIsland = (e) => {
  return isEventInsideVisibleSurface(e, island);
};

const isEventInsideViewportWheelSurface = (e) => {
  return isEventInsideVisibleContextMenu(e) || isEventInsideVisibleIsland(e);
};

function isShieldInputAllowed(e) {
  if (isUnsavedDialogOpen()) return isEventInsideUnsavedDialog(e);
  if (isEventInsideVisibleContextMenu(e)) return true;
  if (typeof isEventInsideVisibleEyedropperLoupe === 'function' && isEventInsideVisibleEyedropperLoupe(e)) return true;
  if (typeof eyedropperEnabled !== 'undefined' && eyedropperEnabled && isEventInsideIsland(e)) return true;
  if (openingShield.classList.contains('active') && !_inputShieldStack.length) return false;
  if (_boardOpening) return false;
  if (_inputShieldStack.length === 0) return true;
  const input = inputNameFromEvent(e);
  const codeInput = e.type === 'keydown' || e.type === 'keyup'
    ? `code:${String(e.code || '').toLowerCase()}`
    : '';
  const buttonInput = typeof e.button === 'number' ? `${e.type}:${e.button}` : '';
  return _inputShieldStack.every(({ allow }) => (
    allow.has(input) || (codeInput && allow.has(codeInput)) || (buttonInput && allow.has(buttonInput))
  ));
}

function blockShieldInput(e) {
  if (
    _rubberBandDragActive &&
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

const proportionalCornerResizeSize = function proportionalCornerResizeSize(dir, startW, startH, dx, dy, minScale) {
  if (![startW, startH, dx, dy, minScale].every(Number.isFinite) || startW <= 0 || startH <= 0) {
    return { w: startW, h: startH };
  }
  const candidateW = dir.includes('e') ? startW + dx : startW - dx;
  const candidateH = dir.includes('s') ? startH + dy : startH - dy;
  const scaleW = candidateW / startW;
  const scaleH = candidateH / startH;
  const scale = Math.max(minScale, Math.min(scaleW, scaleH));
  return { w: startW * scale, h: startH * scale };
};

const proportionalScaleFromHandleDrag = function proportionalScaleFromHandleDrag(anchor, handlePoint, dx, dy, minScale) {
  if (!anchor || !handlePoint || ![dx, dy, minScale].every(Number.isFinite)) return 1;
  const vx = handlePoint.x - anchor.x;
  const vy = handlePoint.y - anchor.y;
  const pointerX = handlePoint.x + dx;
  const pointerY = handlePoint.y + dy;
  const scales = [];
  if (Math.abs(vx) > 1e-9) scales.push((pointerX - anchor.x) / vx);
  if (Math.abs(vy) > 1e-9) scales.push((pointerY - anchor.y) / vy);
  if (!scales.length) return 1;
  return Math.max(minScale, Math.min(...scales.filter(Number.isFinite)));
};

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
    BoardfishEditorState.clearSelection();
    return;
  }

  const bounds = selectedBounds();
  if (!bounds) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    BoardfishEditorState.clearSelection();
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

const beginSelectionHandleDrag = function beginSelectionHandleDrag(handle, e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.dir;
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

        const snapshots = [];
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o || o.type === 'text') continue;
          if (![o.x, o.y, o.w, o.h].every(Number.isFinite) || o.w <= 0 || o.h <= 0) continue;
          snapshots.push({
            id,
            x: o.x,
            y: o.y,
            w: o.w, h: o.h,
          });
        }
        if (!snapshots.length) return;

        const MIN_OBJECT_SIZE = 100;
        let minObjectScale = 0;
        for (const snap of snapshots) {
          minObjectScale = Math.max(minObjectScale, MIN_OBJECT_SIZE / snap.w, MIN_OBJECT_SIZE / snap.h);
        }
        minObjectScale = Math.min(1, minObjectScale);
        function applyMultiResize({ scale }) {
          for (const snap of snapshots) {
            const o = objectsMap.get(snap.id);
            if (!o) continue;
            o.x = anchorPoint.x + (snap.x - anchorPoint.x) * scale;
            o.y = anchorPoint.y + (snap.y - anchorPoint.y) * scale;
            o.w = snap.w * scale;
            o.h = snap.h * scale;
          }
          scheduleRender(true, true);
        }
        const resizeCommitter = createRafCommitter(applyMultiResize);

        function onMultiMove(ev) {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          const scale = proportionalScaleFromHandleDrag(anchorPoint, handlePoint, dx, dy, minObjectScale);
          resizeCommitter.schedule({ scale });
        }

        beginDocumentDrag({
          move: onMultiMove,
          up() {
            resizeCommitter.flush();
            for (const snap of snapshots) markDirty(snap.id);
            globalThis.BoardfishMotion?.applyActionAnimation?.('object-multi-resize', {
              selection: true,
              options: { includeText: false },
            });
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
      const MIN = 100;

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
          const minScale = Math.min(1, Math.max(MIN / ow, MIN / oh));
          const size = proportionalCornerResizeSize(dir, ow, oh, dx, dy, minScale);
          w = size.w;
          h = size.h;
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
          if (obj.type === 'text') {
            globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-resize');
          } else {
            globalThis.BoardfishMotion?.applyActionAnimation?.('object-resize', {
              selection: true,
              options: { includeText: false },
            });
          }
          pushHistory('resize');
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
  if (obj) {
    bringObjectToFront(id);
    markDirty(id);
    obj.z = ++zCounter;
  }
  scheduleRender(true, true);
  globalThis.BoardfishMotion?.applyActionAnimation?.('object-select', {
    selection: true,
    options: { includeText: false },
  });
}

function deselectAll() {
  const hadSelection = selectedIds.size > 0;
  if (editingId) exitEdit();
  BoardfishEditorState.clearSelection();
  if (hadSelection) globalThis.BoardfishMotion?.applyActionAnimation?.('object-deselect');
  scheduleRender(false, true);
}

function selectAllObjects() {
  if (editingId || !objects.length) return;
  BoardfishEditorState.setSelection(objects.map((obj) => obj.id), {
    primaryId: objects[objects.length - 1].id,
    exitEditing: false,
  });
  scheduleRender(false, true);
  globalThis.BoardfishMotion?.applyActionAnimation?.('object-select', {
    selection: true,
    options: { includeText: false },
  });
}

function hideMenus() {
  MenuDebug.log('hideMenus', { reason: 'generic' });
  if (typeof closeOpenMenusExcept === 'function') {
    closeOpenMenusExcept('', 'hideMenus');
    return;
  }
  ctxMenu.classList.remove('visible');
  ctxActions?.classList.remove('visible');
  objCtxMenu.classList.remove('visible');
  if (typeof BoardfishDOM !== 'undefined') BoardfishDOM.textCtxMenu.classList.remove('visible');
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

const normalizeTextEditHistoryState = (id, state = null) => {
  const targetId = id || state?.id || editingId;
  if (!targetId) return null;
  const valueLength = _editEl?.value?.length ?? objectsMap.get(targetId)?.data?.content?.length ?? 0;
  const start = Math.max(0, Math.min(state?.start ?? state?.selectionStart ?? _editEl?.selectionStart ?? 0, valueLength));
  const end = Math.max(0, Math.min(state?.end ?? state?.selectionEnd ?? start, valueLength));
  return {
    id: targetId,
    selectionStart: start,
    selectionEnd: end,
    selectionDirection: state?.direction || state?.selectionDirection || _editEl?.selectionDirection || 'none',
  };
};

const beginTextEditHistoryAction = (id = editingId, state = null, { splitPending = false } = {}) => {
  if (!id) return null;
  if (splitPending && _editHistoryTimer) flushEditHistoryCheckpoint();
  if (!_editHistoryActionStartState || _editHistoryActionStartState.id !== id) {
    _editHistoryActionStartState = normalizeTextEditHistoryState(id, state);
  }
  return _editHistoryActionStartState;
};

const consumeTextEditHistoryActionStartState = (id) => {
  const state = _editHistoryActionStartState?.id === id ? _editHistoryActionStartState : null;
  _editHistoryActionStartState = null;
  return state;
};

function pushEditHistoryIfChanged(id) {
  const obj = objectsMap.get(id);
  if (!obj) return false;
  if (_editHistoryLastContent === null) _editHistoryLastContent = obj.data.content;
  if (obj.data.content === _editHistoryLastContent) return false;
  markDirty(id);
  pushHistory('text-edit-checkpoint', {
    beforeEditState: consumeTextEditHistoryActionStartState(id),
  });
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

function scheduleEditHistoryCheckpoint(id) {
  clearEditHistoryCheckpointTimer();
  _editHistoryTimer = setTimeout(() => {
    _editHistoryTimer = null;
    pushEditHistoryIfChanged(id);
  }, EDIT_HISTORY_DEBOUNCE_MS);
}

const shouldCommitTextEditInputImmediately = (inputType = '', hadSelection = false) => {
  const value = String(inputType || '').toLowerCase();
  return !!hadSelection || value.includes('paste') || value.includes('cut');
};

const recordTextEditInputHistory = (id, {
  inputType = '',
  hadSelection = false,
  immediate = false,
} = {}) => {
  if (immediate || shouldCommitTextEditInputImmediately(inputType, hadSelection)) {
    clearEditHistoryCheckpointTimer();
    return pushEditHistoryIfChanged(id);
  }
  scheduleEditHistoryCheckpoint(id);
  return false;
};
