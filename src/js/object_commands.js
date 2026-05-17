// ─── Add objects ─────────────────────────────────────────────────────────────

function addText(wx, wy, content = '', options = {}) {
  if (eyedropperEnabled) return;
  if (!BoardfishWebLimits.canAddObjects(1)) return;
  const textBytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(String(content || '')).length : String(content || '').length;
  if (!BoardfishWebLimits.canAcceptAdditionalContentBytes(textBytes, 1)) return;
  content = normalizeTextContent(content);
  let w = 200, h = content ? LINE_H + TEXT_PAD * 2 : NEW_TEXT_EDIT_MIN_LINES * LINE_H + TEXT_PAD * 2;
  if (content) {
    const lines = content.split('\n');
    const charW = 9.2, pad = 8;
    const maxLineLen = Math.max(...lines.map(l => l.length), 1);
    w = Math.min(Math.max(Math.round(maxLineLen * charW + pad * 2), 120), 700);
  }

  const obj = { id: newId(), type: 'text', x: wx, y: wy, w, h, z: ++zCounter, data: { content } };
  syncTextAutoHeight(obj, content ? 1 : NEW_TEXT_EDIT_MIN_LINES);
  if (options?.anchor === 'center') {
    obj.x = wx - obj.w / 2;
    obj.y = wy - obj.h / 2;
  }
  BoardfishEditorState.addObject(obj);
  globalThis.BoardfishMotion?.applyActionAnimation?.(
    content ? 'plain-text-paste-as-text-box' : 'text-box-create',
    { objects: [obj] }
  );
  selectObject(obj.id);
  scheduleRender(true, false);
  pushHistory('add-text');
  if (!content) enterEdit(obj.id);
}
var _inputShieldCount = 0;
var _inputShieldStack = [];
var _inputShieldReleases = [];

function updateInputShieldVisual() {
  if (isUnsavedDialogOpen()) openingShield.classList.remove('active');
  else if (_boardOpening || _inputShieldStack.some((token) => token.visual !== false)) openingShield.classList.add('active');
  else openingShield.classList.remove('active');
}

function acquireInputShield(...allowedInputs) {
  let options = {};
  if (
    allowedInputs.length &&
    allowedInputs[allowedInputs.length - 1] &&
    typeof allowedInputs[allowedInputs.length - 1] === 'object' &&
    !Array.isArray(allowedInputs[allowedInputs.length - 1])
  ) {
    options = allowedInputs.pop();
  }
  const token = {
    allow: new Set(allowedInputs.flat().filter(Boolean)),
    allowBoardNavigation: options.allowBoardNavigation === true,
    keepSelectionOverlay: options.keepSelectionOverlay === true,
    visual: options.visual !== false,
    released: false,
  };
  _inputShieldStack.push(token);
  _inputShieldCount = _inputShieldStack.length;
  updateInputShieldVisual();
  return () => {
    if (token.released) return;
    token.released = true;
    const index = _inputShieldStack.indexOf(token);
    if (index !== -1) _inputShieldStack.splice(index, 1);
    _inputShieldCount = _inputShieldStack.length;
    updateInputShieldVisual();
    if (!_inputShieldStack.length && !_boardOpening) scheduleRender(false, true, 'input-shield-release');
  };
}

function showInputShield(...allowedInputs) {
  _inputShieldReleases.push(acquireInputShield(...allowedInputs));
}
function hideInputShield() {
  const release = _inputShieldReleases.pop();
  if (release) release();
  else {
    _inputShieldCount = Math.max(0, _inputShieldCount - 1);
    updateInputShieldVisual();
    if (!_inputShieldStack.length && !_boardOpening) scheduleRender(false, true, 'input-shield-release');
  }
}

function isBoardInputBlocked() {
  return _boardOpening || _inputShieldStack.length > 0 || openingShield.classList.contains('active');
}

function isBoardNavigationAllowedWhileBlocked() {
  return !_boardOpening &&
    !openingShield.classList.contains('active') &&
    _inputShieldStack.length > 0 &&
    _inputShieldStack.every((token) => token.allowBoardNavigation);
}

function shouldKeepSelectionOverlayWhileBlocked() {
  return !_boardOpening && _inputShieldStack.some((token) => token.keepSelectionOverlay);
}

async function runShieldedPillTask({
  releaseInputShield,
  startMessage = null,
  successMessage = null,
  task,
}) {
  try {
    if (startMessage) startPillTask({ message: startMessage });
    const result = await task();
    finishPillTask({ beforeFinish: releaseInputShield, finalMsg: successMessage });
    return result;
  } catch (err) {
    finishPillTask({ beforeFinish: releaseInputShield });
    throw err;
  }
}

// ─── New board ───────────────────────────────────────────────────────────────

async function newBoard() {
  if (objects.length === 0 && !currentFilePath) {
    setEyedropperEnabled(false);
    return;
  }
  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') { const saved = await saveBoard(); if (!saved) return; }
  }
  const dbg = OpenDebug.start('newBoard', { objectCount: objects.length });
  globalThis.BoardfishMotion?.applyActionAnimation?.('new-board-state-reset');
  BoardfishEditorState.setBoardOpening(true);
  if (typeof beginOpeningFreeze === 'function') beginOpeningFreeze();
  else openingShield.classList.add('active');
  const openingStart = performance.now();
  await startPillTask({ message: 'Opening' });
  setEyedropperEnabled(false);
  BoardfishEditorState.resetBoardObjectState();
  if (typeof clearEyedropperCardForBoard === 'function') {
    clearEyedropperCardForBoard();
  }
  OpenDebug.step(dbg, 'exitEdit', {});
  clearJsClipboard();
  invalidateOffscreen();
  OpenDebug.step(dbg, 'clearState', {});
  currentFilePath = null;
  currentFileRef = null;
  BoardfishViewportState.reset();
  clearImageStore(true);
  OpenDebug.step(dbg, 'clearImageStore', {});
  boardHistory = []; historyIndex = -1;
  snapshot();
  markSaved();
  updateTitle();
  const elapsed = performance.now() - openingStart;
  OpenDebug.step(dbg, 'workDone', { elapsed });
  _boardOpening = false;
  applyTransform();
  finishPillTask({
    beforeFinish: () => {
      if (typeof endOpeningFreeze === 'function') endOpeningFreeze();
      else openingShield.classList.remove('active');
    },
  });
  OpenDebug.end(dbg, { totalMs: elapsed });
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

function duplicateSelected() {
  if (!selectedIds.size || editingId) return;
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  const selectedObjects = [];
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj) selectedObjects.push(obj);
  }
  if (!selectedObjects.length || !BoardfishWebLimits.canAddObjects(selectedObjects.length)) return;
  const additionalTextBytes = selectedObjects.reduce((sum, obj) => {
    if (obj?.type !== 'text') return sum;
    const text = String(obj.data?.content || '');
    return sum + (typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length);
  }, 0);
  if (!BoardfishWebLimits.canAcceptAdditionalContentBytes(additionalTextBytes, selectedObjects.length)) return;

  const cloned = selectedObjects.map((obj) => cloneObject(obj));
  if (!cloned.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of cloned) {
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + obj.w);
    maxY = Math.max(maxY, obj.y + obj.h);
  }
  const dx = center.x - (minX + maxX) / 2;
  const dy = center.y - (minY + maxY) / 2;
  const duplicatedIds = [];
  for (const obj of cloned) {
    obj.id = newId();
    obj.x += dx;
    obj.y += dy;
    obj.z = ++zCounter;
    BoardfishEditorState.addObject(obj);
    duplicatedIds.push(obj.id);
  }
  BoardfishEditorState.setSelection(duplicatedIds, {
    primaryId: duplicatedIds[duplicatedIds.length - 1],
    animateSelection: false,
  });
  const duplicatedTextObjects = cloned.filter((obj) => obj?.type === 'text');
  const duplicatedNonTextObjects = cloned.filter((obj) => obj?.type !== 'text');
  globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-duplicate', { objects: duplicatedTextObjects });
  globalThis.BoardfishMotion?.applyActionAnimation?.('image-object-duplicate', { objects: duplicatedNonTextObjects });
  scheduleRender(true, true, 'duplicate-selected');
  pushHistory('duplicate-selected');
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!hasSelection() || editingId) return;
  const idsToDelete = [...selectedIds];
  if (!idsToDelete.length) return;
  const removedObjects = idsToDelete
    .map((id) => objectsMap.get(id))
    .filter(Boolean)
    .map((obj) => cloneObject(obj));
  globalThis.BoardfishMotion?.applyActionAnimation?.('object-delete', { removedObjects });
  BoardfishEditorState.removeObjectsById(idsToDelete);
  if (selectedIds.size) {
    const remaining = [...selectedIds];
    BoardfishEditorState.setSelection(remaining, { primaryId: remaining[remaining.length - 1], exitEditing: false });
  } else {
    BoardfishEditorState.clearSelection();
  }
  scheduleRender(true, true);
  pushHistory('delete-selected');
}
