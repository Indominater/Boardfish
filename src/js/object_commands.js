// ─── Add objects ─────────────────────────────────────────────────────────────

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const objectCommandDebugNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const objectCommandTextStats = (value) => {
  const text = String(value ?? '');
  const lines = text ? text.split('\n') : [];
  let largestLineChars = 0;
  for (const line of lines) largestLineChars = Math.max(largestLineChars, line.length);
  return {
    textLen: text.length,
    textLineCount: lines.length,
    largestLineChars,
    textBytes: BoardfishWebLimits.textByteLength(text),
  };
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function addText(wx, wy, content = '', options = {}) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = typeof BOARDFISH_PRODUCTION === 'undefined' ? options?.debug || null : null;
  let stepStartedAt = dbg && objectCommandDebugNow();
  const addStartedAt = stepStartedAt;
  const logStep = (step, meta = {}) => {
    if (!dbg || typeof ClipDebug === 'undefined') return;
    const details = typeof meta === 'function' ? meta() : meta;
    const now = objectCommandDebugNow();
    ClipDebug.step(dbg, `addText:${step}`, {
      ms: Math.round((now - stepStartedAt) * 100) / 100,
      totalMs: Math.round((now - addStartedAt) * 100) / 100,
      ...details,
    });
    stepStartedAt = now;
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  logStep('start', () => ({
    wx,
    wy,
    anchor: options?.anchor || '',
    ...objectCommandTextStats(content),
  }));

  if (!BoardfishWebLimits.canAddObjects(1)) {
    logStep('object-limit-denied');
    return;
  }
  if (!options.contentPrepared) content = textForTextObjectPaste(content);
  logStep('trim-done', () => objectCommandTextStats(content));
  const data = { content };
  const textBytes = BoardfishWebLimits.textByteLength(content);
  const accepted = BoardfishWebLimits.canAcceptAdditionalContentBytes(textBytes, 1);
  logStep('content-limit-done', { textBytes, accepted });
  if (!accepted) return;
  const h = (content ? 1 : NEW_TEXT_EDIT_MIN_LINES) * LINE_H + TEXT_PAD * 2;
  let w = content ? 200 : h * 6;
  if (content) {
    const lines = content.split('\n');
    const charW = 9.2, pad = 8;
    let maxLineLen = 1;
    for (const line of lines) {
      if (line.length > maxLineLen) maxLineLen = line.length;
    }
    w = Math.min(Math.max(Math.round(maxLineLen * charW + pad * 2), 120), 700);
  }
  const obj = { id: newId(), type: 'text', x: wx, y: wy, w, h, z: ++zCounter, data };
  logStep('size-estimate-done', () => ({ w, h, ...objectCommandTextStats(content) }));
  const heightChanged = syncTextAutoHeight(obj, content ? 1 : NEW_TEXT_EDIT_MIN_LINES);
  logStep('auto-height-done', () => ({
    objectId: obj.id,
    heightChanged,
    w: obj.w,
    h: obj.h,
    ...objectCommandTextStats(content),
  }));
  if (options?.anchor === 'center') {
    obj.x = wx - obj.w / 2;
    obj.y = wy - obj.h / 2;
  }
  logStep('position-done', { objectId: obj.id, x: obj.x, y: obj.y, w: obj.w, h: obj.h });
  BoardfishEditorState.addObject(obj);
  logStep('add-object-done', { objectId: obj.id, objectCountAfter: objects.length });
  selectObject(obj.id);
  logStep('render-scheduled', { objectId: obj.id });
  const shouldEnterEdit = !content || options?.editAfterCreate === true;
  if (!shouldEnterEdit || options?.enterEditHistory === false) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const historyStartedAt = dbg && objectCommandDebugNow();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    pushHistory('add-text');
    logStep('history-pushed', () => ({
      objectId: obj.id,
      historyMs: Math.round((objectCommandDebugNow() - historyStartedAt) * 100) / 100,
    }));
  }
  if (shouldEnterEdit) {
    const enterEditOptions = content
      ? { history: options?.enterEditHistory !== false, placeInitialCaret: true }
      : {};
    enterEdit(obj.id, enterEditOptions);
    logStep('enter-edit-done', {
      objectId: obj.id,
      editAfterCreate: !!content,
      enterEditHistory: enterEditOptions.history ?? true,
    });
  }
  logStep('end', { objectId: obj.id, objectCountAfter: objects.length });
}
var _inputShieldStack = [];
var _inputShieldReleases = [];

function updateInputShieldVisual() {
  if (isUnsavedDialogOpen()) {
    openingShield.classList.remove('active');
    return;
  }
  if (_boardOpening) {
    openingShield.classList.add('active');
    return;
  }
  let hasVisualShieldToken = false;
  for (const token of _inputShieldStack) {
    if (token.visual === false) continue;
    hasVisualShieldToken = true;
    break;
  }
  if (hasVisualShieldToken) openingShield.classList.add('active');
  else openingShield.classList.remove('active');
}

function acquireInputShield(options = {}) {
  const token = {
    allowBoardNavigation: options.allowBoardNavigation === true,
    keepSelectionOverlay: options.keepSelectionOverlay === true,
    visual: options.visual !== false,
    released: false,
  };
  _inputShieldStack.push(token);
  updateInputShieldVisual();
  return () => {
    if (token.released) return;
    token.released = true;
    const index = _inputShieldStack.indexOf(token);
    if (index !== -1) _inputShieldStack.splice(index, 1);
    updateInputShieldVisual();
    if (!_inputShieldStack.length && !_boardOpening) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(false, true, 'input-shield-release');
      else scheduleRender(false, true);
    }
  };
}

function showInputShield(options = {}) {
  _inputShieldReleases.push(acquireInputShield(options));
}
function hideInputShield() {
  const release = _inputShieldReleases.pop();
  if (release) release();
  else {
    updateInputShieldVisual();
    if (!_inputShieldStack.length && !_boardOpening) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(false, true, 'input-shield-release');
      else scheduleRender(false, true);
    }
  }
}

function isBoardInputBlocked() {
  return _boardOpening || _inputShieldStack.length > 0;
}

function isBoardNavigationAllowedWhileBlocked() {
  if (_boardOpening || openingShield.classList.contains('active') || !_inputShieldStack.length) return false;
  for (const token of _inputShieldStack) {
    if (!token.allowBoardNavigation) return false;
  }
  return true;
}

function shouldKeepSelectionOverlayWhileBlocked() {
  if (_boardOpening) return false;
  for (const token of _inputShieldStack) {
    if (token.keepSelectionOverlay) return true;
  }
  return false;
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
  if (isCleanDefaultEmptyBoardState() && !currentFilePath && !currentFileRef) {
    return;
  }
  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') { const saved = await saveBoard(); if (!saved) return; }
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = OpenDebug.start('newBoard', { objectCount: objects.length });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  BoardfishEditorState.setBoardOpening(true);
  if (typeof beginOpeningFreeze === 'function') beginOpeningFreeze();
  else openingShield.classList.add('active');
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const openingStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  startPillTask({ message: 'Opening' });
  BoardfishEditorState.resetBoardObjectState();
  OpenDebug.step(dbg, 'exitEdit', {});
  clearJsClipboard();
  invalidateOffscreen();
  OpenDebug.step(dbg, 'clearState', {});
  currentFilePath = null;
  currentFileRef = null;
  BoardfishViewportState.reset();
  clearImageStore(true);
  OpenDebug.step(dbg, 'clearImageStore', {});
  snapshot();
  markSaved();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const elapsed = performance.now() - openingStart;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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

function duplicateSelected(anchorPoint = null) {
  if (!selectedIds.size || editingId || !BoardfishWebLimits.canAddObjects(selectedIds.size)) return;
  const selectedObjects = [];
  let additionalTextBytes = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    selectedObjects.push(obj);
    if (obj?.type === 'text') additionalTextBytes += BoardfishWebLimits.textByteLength(String(obj.data?.content || ''));
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + obj.w);
    maxY = Math.max(maxY, obj.y + obj.h);
  }
  if (!selectedObjects.length) return;
  if (!BoardfishWebLimits.canAcceptAdditionalContentBytes(additionalTextBytes, selectedObjects.length)) return;
  const center = (
    anchorPoint &&
    Number.isFinite(Number(anchorPoint.x)) &&
    Number.isFinite(Number(anchorPoint.y))
  )
    ? { x: Number(anchorPoint.x), y: Number(anchorPoint.y) }
    : (typeof boardCursorWorldPoint === 'function'
        ? boardCursorWorldPoint()
        : toWorld(window.innerWidth / 2, window.innerHeight / 2));
  const dx = center.x - (minX + maxX) / 2;
  const dy = center.y - (minY + maxY) / 2;
  const duplicatedIds = [];
  for (const source of selectedObjects) {
    const obj = cloneObject(source);
    obj.id = newId();
    obj.x += dx;
    obj.y += dy;
    obj.z = ++zCounter;
    BoardfishEditorState.addObject(obj);
    duplicatedIds.push(obj.id);
  }
  BoardfishEditorState.setSelection(duplicatedIds, {
    primaryId: duplicatedIds[duplicatedIds.length - 1],
  });
  if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, 'duplicate-selected');
  else scheduleRender(true, true);
  pushHistory('duplicate-selected');
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!hasSelection() || editingId) return;
  BoardfishEditorState.removeObjectsById(selectedIds);
  scheduleRender(true, true);
  pushHistory('delete-selected');
}
