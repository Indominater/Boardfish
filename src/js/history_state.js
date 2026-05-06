// ─── History ──────────────────────────────────────────────────────────────────
var boardHistory = [];
var historyIndex = -1;
var MAX_HISTORY = 50;

function trimHistory() {
  if (boardHistory.length > MAX_HISTORY) {
    const trim = boardHistory.length - MAX_HISTORY;
    boardHistory.splice(0, trim);
    historyIndex = Math.max(-1, historyIndex - trim);
    savedHistoryIndex = Math.max(-1, savedHistoryIndex - trim);
  }
}

function collectImageKeysFromObjects(sourceObjects, out) {
  for (const obj of sourceObjects || []) {
    const key = obj?.type === 'image' ? obj.data?.imgKey : '';
    if (key) out.add(key);
  }
}

function retainedImageKeysForCurrentAndHistory() {
  const keys = new Set();
  collectImageKeysFromObjects(objects, keys);
  for (const entry of boardHistory) {
    collectImageKeysFromObjects(Array.isArray(entry) ? entry : entry?.objects, keys);
  }
  return keys;
}

function pruneEyedropperCachesAfterHistoryChange(reason = 'history-change') {
  if (typeof pruneEyedropperSafeImagesToKeys !== 'function') return;
  const result = pruneEyedropperSafeImagesToKeys(retainedImageKeysForCurrentAndHistory());
  if (result?.removed && typeof HistoryDebug !== 'undefined') {
    HistoryDebug.step(null, 'eyedropper-cache-prune', { reason, ...result });
  }
}

function snapshot() {
  const dbg = HistoryDebug.start('snapshot', { objectCount: objects.length, historyLength: boardHistory.length, historyIndex });
  const t0 = performance.now();
  HistoryDebug.count('snapshots');
  boardHistory.length = historyIndex + 1;
  const objectsSnapshot = cloneObjects(objects);
  HistoryDebug.step(dbg, 'cloneObjects', { objectCount: objectsSnapshot.length });
  const editState = captureEditState();
  HistoryDebug.step(dbg, 'captureEditState', { editState: !!editState });
  boardHistory.push({
    objects: objectsSnapshot,
    editState,
  });
  historyIndex = boardHistory.length - 1;
  _dirtyIds.clear();
  trimHistory();
  pruneEyedropperCachesAfterHistoryChange('snapshot');
  const ms = performance.now() - t0;
  HistoryDebug.max('maxSnapshotMs', ms);
  HistoryDebug.end(dbg, { ms, historyLength: boardHistory.length, historyIndex });
}

// Delta push: only deep-clones objects that changed since last snapshot.
// Unchanged objects share the previous snapshot's reference (safe since
// restoreSnapshot always deep-clones before mutating).
function pushHistory(reason = '') {
  const dbg = HistoryDebug.start('pushHistory', {
    reason,
    objectCount: objects.length,
    dirtyCount: _dirtyIds.size,
    historyLength: boardHistory.length,
    historyIndex,
  });
  const t0 = performance.now();
  HistoryDebug.count('pushHistory');
  boardHistory.length = historyIndex + 1;
  const prevEntry = historyIndex >= 0 ? boardHistory[historyIndex] : [];
  const prevObjects = Array.isArray(prevEntry) ? prevEntry : (prevEntry.objects || []);
  const prevMap = new Map();
  for (const o of prevObjects) prevMap.set(o.id, o);
  HistoryDebug.step(dbg, 'build-prev-map', { objectCount: prevObjects.length });
  let cloned = 0;
  let reused = 0;
  const entry = objects.map(o =>
    (_dirtyIds.has(o.id) || !prevMap.has(o.id))
      ? (cloned++, cloneObject(o))
      : (reused++, prevMap.get(o.id))
  );
  HistoryDebug.count('clonedObjects', cloned);
  HistoryDebug.count('reusedObjects', reused);
  HistoryDebug.step(dbg, 'clone-dirty-objects', { cloned, reused, objectCount: entry.length });
  _dirtyIds.clear();
  const editState = captureEditState();
  HistoryDebug.step(dbg, 'captureEditState', { editState: !!editState });
  boardHistory.push({
    objects: entry,
    editState,
  });
  historyIndex++;
  trimHistory();
  pruneEyedropperCachesAfterHistoryChange(reason || 'pushHistory');
  updateTitle();
  const ms = performance.now() - t0;
  HistoryDebug.max('maxPushHistoryMs', ms);
  HistoryDebug.end(dbg, { reason, ms, cloned, reused, historyLength: boardHistory.length, historyIndex });
}

function restoreSnapshot(s) {
  const snapshotObjects = Array.isArray(s) ? s : (s?.objects || []);
  const editState = Array.isArray(s) ? null : (s?.editState || null);
  const hadEditing = !!editingId;
  const dbg = HistoryDebug.start('restoreSnapshot', {
    objectCount: snapshotObjects.length,
    historyLength: boardHistory.length,
    historyIndex,
    selectedCount: selectedIds.size,
    editState: !!editState,
  });
  const t0 = performance.now();
  HistoryDebug.count('restores');
  if (editingId) {
    clearInterval(_caretBlinkInterval);
    _caretBlinkInterval = null;
    clearTimeout(_editHistoryTimer);
    _editHistoryTimer = null;
    _editHistoryLastContent = null;
    if (_selChangeListener) {
      document.removeEventListener('selectionchange', _selChangeListener);
      _selChangeListener = null;
    }
    if (_editEl) _editEl.remove();
    editingId = null;
    _editEl = null;
  }
  HistoryDebug.step(dbg, 'clear-editing', { hadEditing });
  const prevSelectedIds = new Set(selectedIds);
  BoardfishEditorState.replaceBoardObjects(cloneObjects(snapshotObjects));
  HistoryDebug.step(dbg, 'clone-snapshot', { objectCount: objects.length });
  HistoryDebug.step(dbg, 'normalize-text', { objectCount: objects.length });
  _dirtyIds.clear();
  HistoryDebug.step(dbg, 'rebuild-caches', { objectCount: objectsMap.size });
  HistoryDebug.step(dbg, 'sync-text-heights');
  invalidateOffscreen();
  // Preserve selection for objects that still exist in the restored state
  BoardfishEditorState.setSelection([...prevSelectedIds], { exitEditing: false });
  renderAll();
  HistoryDebug.step(dbg, 'renderAll', { selectedCount: selectedIds.size });

  if (!editState || !editState.id) {
    const ms = performance.now() - t0;
    HistoryDebug.max('maxRestoreMs', ms);
    HistoryDebug.end(dbg, { ms, objectCount: objects.length, selectedCount: selectedIds.size });
    return;
  }
  const obj = objectsMap.get(editState.id);
  if (!obj || obj.type !== 'text') {
    const ms = performance.now() - t0;
    HistoryDebug.max('maxRestoreMs', ms);
    HistoryDebug.end(dbg, { ms, skippedEditRestore: true });
    return;
  }

  BoardfishEditorState.setSelection([obj.id], { primaryId: obj.id, exitEditing: false });
  enterEdit(obj.id);

  if (!_editEl) return;
  const max = _editEl.value.length;
  const start = Math.max(0, Math.min(editState.selectionStart ?? max, max));
  const end = Math.max(0, Math.min(editState.selectionEnd ?? max, max));
  _editEl.setSelectionRange(start, end, editState.selectionDirection || 'none');
  _caretVisible = true;
  scheduleRender(true, true);
  const ms = performance.now() - t0;
  HistoryDebug.max('maxRestoreMs', ms);
  HistoryDebug.end(dbg, { ms, objectCount: objects.length, selectedCount: selectedIds.size, restoredEdit: true });
}

function captureEditState() {
  if (!editingId) return null;
  if (!_editEl) return { id: editingId, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' };
  return {
    id: editingId,
    selectionStart: _editEl.selectionStart,
    selectionEnd: _editEl.selectionEnd,
    selectionDirection: _editEl.selectionDirection || 'none',
  };
}

function undo() {
  if (historyIndex <= 0) return;
  HistoryDebug.count('undo');
  const dbg = HistoryDebug.start('undo', { historyLength: boardHistory.length, historyIndex });
  historyIndex--;
  restoreSnapshot(boardHistory[historyIndex]);
  updateTitle();
  HistoryDebug.end(dbg, { historyLength: boardHistory.length, historyIndex });
}

function redo() {
  if (historyIndex >= boardHistory.length - 1) return;
  HistoryDebug.count('redo');
  const dbg = HistoryDebug.start('redo', { historyLength: boardHistory.length, historyIndex });
  historyIndex++;
  restoreSnapshot(boardHistory[historyIndex]);
  updateTitle();
  HistoryDebug.end(dbg, { historyLength: boardHistory.length, historyIndex });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  scheduleRender(true, true, 'renderAll');
}
