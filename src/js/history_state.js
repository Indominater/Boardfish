// ─── History ──────────────────────────────────────────────────────────────────
var boardHistory = [];
var historyIndex = -1;
var MAX_HISTORY = 50;
const HISTORY_FULL_SELECTION_PULSE_REASONS = new Set([
  'send-selected-to-back',
]);
const HISTORY_ADDED_OBJECT_REASONS = new Set([
  'add-image',
  'add-native-data-url-image',
  'add-native-image',
  'bulk-image-insert',
  'duplicate-selected',
  'paste-objects',
  'paste-native-image',
]);
const HISTORY_SMOOTH_SLIDE_REASONS = new Set([
]);
const HISTORY_RESTORE_DELETED_REASONS = new Set([
  'delete-selected',
]);
const HISTORY_NO_REPLAY_REASONS = new Set([
  'snapshot',
  'add-text',
  'delete-empty-text',
  'text-edit-checkpoint',
  'text-height-change',
]);

const historyReasonUsesFullSelectionPulse = (reason = '') => {
  const value = String(reason || '');
  return HISTORY_FULL_SELECTION_PULSE_REASONS.has(value) ||
    value.startsWith('flip-image-') ||
    value.startsWith('rotate-image-');
};

const historySelectionPulseOptions = (entry) => {
  const reason = Array.isArray(entry) ? '' : entry?.reason;
  return historyReasonUsesFullSelectionPulse(reason) ? {} : { includeText: false };
};

const historyMotionForReason = (reason = '') => {
  const value = String(reason || '');
  if (!value || HISTORY_NO_REPLAY_REASONS.has(value)) return { type: 'none' };
  if (HISTORY_ADDED_OBJECT_REASONS.has(value)) return { type: 'added-objects', options: { includeText: false } };
  if (HISTORY_SMOOTH_SLIDE_REASONS.has(value)) return { type: 'smooth-slide' };
  if (HISTORY_RESTORE_DELETED_REASONS.has(value)) return { type: 'restore-deleted-objects', options: { includeText: false } };
  return { type: 'jello', options: historyReasonUsesFullSelectionPulse(value) ? {} : { includeText: false } };
};

const historyMotionForEntry = (entry) => {
  if (Array.isArray(entry)) return historyMotionForReason('');
  const motion = entry?.motion;
  if (motion?.type === 'added-objects') return { type: 'added-objects', options: { ...(motion.options || {}) } };
  if (motion?.type === 'restore-deleted-objects') return { type: 'restore-deleted-objects', options: { ...(motion.options || {}) } };
  if (motion?.type === 'smooth-slide') return { type: 'smooth-slide' };
  if (motion?.type === 'jello') return { type: 'jello', options: { ...(motion.options || {}) } };
  if (motion?.type === 'none') return { type: 'none' };
  return historyMotionForReason(entry?.reason || '');
};

const applyHistoryAddedObjectsMotion = (added, removed, options = {}) => {
  if (added.length) {
    if (options.textMotion === 'smooth-slide') {
      const textObjects = added.filter((obj) => obj?.type === 'text');
      const nonTextObjects = added.filter((obj) => obj?.type !== 'text');
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-redo-create', { objects: textObjects }, options);
      globalThis.BoardfishMotion?.applyActionAnimation?.('history-object-jiggle-replay', { objects: nonTextObjects }, {
        ...options,
        includeText: false,
      });
    } else {
      globalThis.BoardfishMotion?.applyActionAnimation?.('history-object-jiggle-replay', { objects: added }, options);
    }
  }
  if (removed.length) globalThis.BoardfishMotion?.applyActionAnimation?.('object-delete', { removedObjects: removed }, options);
};

const applyHistoryRestoredDeleteMotion = (added, removed, options = {}) => {
  if (added.length) {
    const textObjects = added.filter((obj) => obj?.type === 'text');
    const imageObjects = added.filter((obj) => obj?.type === 'image');
    globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-undo-delete', { objects: textObjects });
    globalThis.BoardfishMotion?.applyActionAnimation?.('object-undo-delete', { objects: imageObjects }, {
      ...options,
      includeText: false,
    });
  }
  if (removed.length) globalThis.BoardfishMotion?.applyActionAnimation?.('object-delete', { removedObjects: removed }, options);
};

const historyRestoreMotionTransition = (beforeObjects = [], targetObjects = []) => {
  const beforeIds = new Set();
  for (const obj of beforeObjects || []) {
    if (obj?.id) beforeIds.add(obj.id);
  }
  const targetIds = new Set();
  const addedIds = [];
  for (const obj of targetObjects || []) {
    if (!obj?.id) continue;
    targetIds.add(obj.id);
    if (!beforeIds.has(obj.id)) addedIds.push(obj.id);
  }
  const removed = [];
  for (const obj of beforeObjects || []) {
    if (!obj?.id || targetIds.has(obj.id)) continue;
    removed.push(cloneObject(obj));
  }
  return { addedIds, removed };
};

const applyHistoryMotionReplay = (motion, transition, selectionPulseOptions) => {
  const replay = motion || { type: 'jello', options: selectionPulseOptions };
  if (replay.type === 'none') return;
  const added = (transition?.addedIds || [])
    .map((id) => objectsMap.get(id))
    .filter(Boolean);
  const removed = transition?.removed || [];
  if (replay.type === 'smooth-slide') {
    if (added.length) {
      const textObjects = added.filter((obj) => obj?.type === 'text');
      const nonTextObjects = added.filter((obj) => obj?.type !== 'text');
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-undo-delete', { objects: textObjects });
      globalThis.BoardfishMotion?.applyActionAnimation?.('object-undo-delete', { objects: nonTextObjects }, { includeText: false });
    }
    if (removed.length) globalThis.BoardfishMotion?.applyActionAnimation?.('object-delete', { removedObjects: removed });
    return;
  }
  if (replay.type === 'added-objects') {
    applyHistoryAddedObjectsMotion(added, removed, replay.options || {});
    return;
  }
  if (replay.type === 'restore-deleted-objects') {
    applyHistoryRestoredDeleteMotion(added, removed, replay.options || {});
    return;
  }
  const options = replay.options || selectionPulseOptions || {};
  if (added.length) globalThis.BoardfishMotion?.applyActionAnimation?.('history-object-jiggle-replay', { objects: added }, options);
  if (removed.length) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('history-object-jiggle-replay', { removedObjects: removed }, options);
  }
  if (!added.length && !removed.length) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('history-object-jiggle-replay', {
      selection: true,
      options: selectionPulseOptions,
    });
  }
};

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
  collectImageKeysFromObjects(jsClipboard?.objects, keys);
  for (const key of Object.keys(jsClipboard?.imageData || {})) {
    if (key) keys.add(key);
  }
  return keys;
}

function pruneImageCachesAfterHistoryChange(reason = 'history-change') {
  const retainedKeys = retainedImageKeysForCurrentAndHistory();
  let imageResult = null;
  if (typeof pruneImageCachesToKeys === 'function') {
    imageResult = pruneImageCachesToKeys(retainedKeys);
  }
  const eyedropperResult = typeof pruneEyedropperSafeImagesToKeys === 'function'
    ? pruneEyedropperSafeImagesToKeys(retainedKeys)
    : null;
  const removedImageCaches = (imageResult?.removedSources || 0) +
    (imageResult?.removedDisplayImages || 0) +
    (imageResult?.removedAssetUrls || 0) +
    (imageResult?.removedBitmaps || 0) +
    (imageResult?.removedBitmapFailures || 0);
  if ((removedImageCaches || eyedropperResult?.removed) && typeof HistoryDebug !== 'undefined') {
    HistoryDebug.step(null, 'image-cache-prune', {
      reason,
      ...(imageResult || {}),
      eyedropperRemoved: eyedropperResult?.removed || 0,
      retained: retainedKeys.size,
    });
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
    reason: 'snapshot',
    motion: historyMotionForReason('snapshot'),
    objects: objectsSnapshot,
    editState,
  });
  historyIndex = boardHistory.length - 1;
  _dirtyIds.clear();
  trimHistory();
  pruneImageCachesAfterHistoryChange('snapshot');
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
    reason,
    motion: historyMotionForReason(reason),
    objects: entry,
    editState,
  });
  historyIndex++;
  trimHistory();
  pruneImageCachesAfterHistoryChange(reason || 'pushHistory');
  updateTitle();
  const ms = performance.now() - t0;
  HistoryDebug.max('maxPushHistoryMs', ms);
  HistoryDebug.end(dbg, { reason, ms, cloned, reused, historyLength: boardHistory.length, historyIndex });
}

function restoreSnapshot(s, {
  historyMotion = null,
  selectionPulseOptions = { includeText: false },
} = {}) {
  const snapshotObjects = Array.isArray(s) ? s : (s?.objects || []);
  const editState = Array.isArray(s) ? null : (s?.editState || null);
  const hadEditing = !!editingId;
  const motionTransition = historyRestoreMotionTransition(objects, snapshotObjects);
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
  BoardfishEditorState.setSelection([...prevSelectedIds], { exitEditing: false, animateSelection: false });
  renderAll();
  applyHistoryMotionReplay(historyMotion, motionTransition, selectionPulseOptions);
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
  globalThis.BoardfishMotion?.applyActionAnimation?.('history-undo');
  HistoryDebug.count('undo');
  const dbg = HistoryDebug.start('undo', { historyLength: boardHistory.length, historyIndex });
  const actionEntry = boardHistory[historyIndex];
  historyIndex--;
  restoreSnapshot(boardHistory[historyIndex], {
    historyMotion: historyMotionForEntry(actionEntry),
    selectionPulseOptions: historySelectionPulseOptions(actionEntry),
  });
  updateTitle();
  HistoryDebug.end(dbg, { historyLength: boardHistory.length, historyIndex });
}

function redo() {
  if (historyIndex >= boardHistory.length - 1) return;
  globalThis.BoardfishMotion?.applyActionAnimation?.('history-redo');
  HistoryDebug.count('redo');
  const dbg = HistoryDebug.start('redo', { historyLength: boardHistory.length, historyIndex });
  historyIndex++;
  const actionEntry = boardHistory[historyIndex];
  restoreSnapshot(actionEntry, {
    historyMotion: historyMotionForEntry(actionEntry),
    selectionPulseOptions: historySelectionPulseOptions(actionEntry),
  });
  updateTitle();
  HistoryDebug.end(dbg, { historyLength: boardHistory.length, historyIndex });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  scheduleRender(true, true, 'renderAll');
}
