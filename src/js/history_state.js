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
    collectImageKeysFromObjects(entry?.objects, keys);
  }
  collectImageKeysFromObjects(jsClipboard?.objects, keys);
  const clipboardImageData = jsClipboard?.imageData || {};
  for (const key in clipboardImageData) {
    if (!Object.prototype.hasOwnProperty.call(clipboardImageData, key)) continue;
    if (key) keys.add(key);
  }
  return keys;
}

const hasObjectCacheEntries = (value) => {
  if (!value || typeof value !== 'object') return false;
  for (const key in value) {
    if (Object.hasOwn(value, key)) return true;
  }
  return false;
};
const hasCollectionCacheEntries = (value) => !!(value && typeof value.size === 'number' && value.size);

function hasPruneableImageCacheState() {
  if (typeof pruneImageCachesToKeys === 'function') {
    if (typeof imageStore !== 'undefined' && hasObjectCacheEntries(imageStore)) return true;
    if (typeof imageBitmapCache !== 'undefined' && hasObjectCacheEntries(imageBitmapCache)) return true;
    if (typeof imageBitmapFailed !== 'undefined' && hasCollectionCacheEntries(imageBitmapFailed)) return true;
  }
  return false;
}

function pruneImageCachesAfterHistoryChange(reason = 'history-change') {
  if (!hasPruneableImageCacheState()) return;
  const retainedKeys = retainedImageKeysForCurrentAndHistory();
  let imageResult = null;
  if (typeof pruneImageCachesToKeys === 'function') {
    imageResult = pruneImageCachesToKeys(retainedKeys);
  }
  const removedImageCaches = (imageResult?.removedSources || 0) +
    (imageResult?.removedDisplayImages || 0) +
    (imageResult?.removedAssetUrls || 0) +
    (imageResult?.removedBitmaps || 0) +
    (imageResult?.removedBitmapFailures || 0);
  if (removedImageCaches && typeof HistoryDebug !== 'undefined') {
    HistoryDebug.step(null, 'image-cache-prune', {
      reason,
      ...(imageResult || {}),
      retained: retainedKeys.size,
    });
  }
}

const isHistoryDebugEnabled = () => !!(typeof HistoryDebug !== 'undefined' && (
  HistoryDebug.enabled === true || HistoryDebug.isEnabled?.() === true
));

const historyDebugRound = (value) => Math.round((Number(value) || 0) * 100) / 100;

function historyEditProxyValue(proxy) {
  if (typeof proxy?._boardfishLogicalValue === 'string') return proxy._boardfishLogicalValue;
  return String(proxy?.value ?? '');
}

function setHistoryEditProxyLogicalValue(proxy, value = '') {
  if (!proxy) return;
  const nextValue = String(value ?? '');
  const domSynced = String(proxy.value ?? '') === nextValue;
  if (typeof proxy._boardfishSetLogicalValue === 'function') {
    proxy._boardfishSetLogicalValue(nextValue, { domSynced });
    return;
  }
  proxy._boardfishLogicalValue = nextValue;
  proxy._boardfishDomValueStale = !domSynced;
}

function syncHistoryEditProxyDomValueForSelection(proxy, start, end) {
  const domValue = String(proxy?.value ?? '');
  const logicalValue = historyEditProxyValue(proxy);
  const domCharsBefore = domValue.length;
  const selectionStart = Math.max(0, Math.trunc(Number(start)) || 0);
  const selectionEnd = Math.max(selectionStart, Math.trunc(Number(end)) || selectionStart);
  const stale = !!proxy?._boardfishDomValueStale || domValue !== logicalValue;
  const needsSelectionRange = selectionStart !== selectionEnd || selectionEnd > domCharsBefore;
  if (!proxy || !stale || !needsSelectionRange) {
    return {
      synced: false,
      reason: !proxy ? 'missing-proxy' : (!stale ? 'dom-current' : 'selection-fits-stale-dom'),
      ms: 0,
      domCharsBefore,
      domCharsAfter: domCharsBefore,
    };
  }
  const startedAt = performance.now();
  proxy.value = logicalValue;
  setHistoryEditProxyLogicalValue(proxy, logicalValue);
  return {
    synced: true,
    reason: selectionStart !== selectionEnd ? 'restore-highlight' : 'selection-outside-stale-dom',
    ms: historyDebugRound(performance.now() - startedAt),
    domCharsBefore,
    domCharsAfter: String(proxy.value ?? '').length,
  };
}

function historyTextContentDebugMetrics(content) {
  const text = String(content ?? '');
  if (!text) return { lineCount: 0, largestLineChars: 0 };
  let lineCount = 1;
  let currentLineChars = 0;
  let largestLineChars = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      largestLineChars = Math.max(largestLineChars, currentLineChars);
      currentLineChars = 0;
      lineCount++;
    } else {
      currentLineChars++;
    }
  }
  largestLineChars = Math.max(largestLineChars, currentLineChars);
  return { lineCount, largestLineChars };
}

function prefixHistoryDebugMetrics(prefix, metrics = {}) {
  if (!prefix) return metrics;
  const out = {};
  for (const key in metrics) {
    if (!Object.prototype.hasOwnProperty.call(metrics, key)) continue;
    const value = metrics[key];
    out[`${prefix}${key[0].toUpperCase()}${key.slice(1)}`] = value;
  }
  return out;
}

function getHistoryEditStateDebugMetrics(editState = null, prefix = 'editState') {
  if (!isHistoryDebugEnabled() || !editState) return {};
  const start = Number(editState.selectionStart) || 0;
  const end = Number(editState.selectionEnd) || start;
  return {
    [`${prefix}Id`]: editState.id || '',
    [`${prefix}SelectionStart`]: start,
    [`${prefix}SelectionEnd`]: end,
    [`${prefix}SelectedChars`]: Math.abs(end - start),
    [`${prefix}SelectionDirection`]: editState.selectionDirection || 'none',
    [`${prefix}ScriptCaretIndex`]: editState.scriptCaretIndex ?? '',
    [`${prefix}ScriptCaretAffinity`]: editState.scriptCaretAffinity || '',
  };
}

function historyEntryReason(entry) {
  return entry?.reason || '';
}

function historyEntryObjects(entry) {
  return Array.isArray(entry?.objects) ? entry.objects : [];
}

function getHistoryEntryDebugMetrics(entry, prefix = 'entry') {
  if (!isHistoryDebugEnabled()) return {};
  const entryObjects = historyEntryObjects(entry);
  const editState = entry?.editState || null;
  const beforeEditState = entry?.beforeEditState || null;
  return {
    [`${prefix}Reason`]: historyEntryReason(entry),
    [`${prefix}ObjectCount`]: entryObjects.length,
    [`${prefix}HasEditState`]: !!editState,
    [`${prefix}HasBeforeEditState`]: !!beforeEditState,
    ...prefixHistoryDebugMetrics(prefix, getHistoryTextDebugMetrics(entryObjects)),
    ...getHistoryEditStateDebugMetrics(editState, `${prefix}EditState`),
    ...getHistoryEditStateDebugMetrics(beforeEditState, `${prefix}BeforeEditState`),
  };
}

function getHistoryTextDebugMetrics(sourceObjects = objects) {
  if (!isHistoryDebugEnabled()) return {};
  let textObjectCount = 0;
  let textCharCount = 0;
  let largestTextChars = 0;
  let largestTextId = '';
  let textLineCount = 0;
  let largestTextLineChars = 0;
  let runtimeTextLayoutObjects = 0;
  let runtimeTextLayoutLines = 0;
  let runtimeTextLayoutPrefixEntries = 0;
  let runtimeTextLineContentChars = 0;
  for (const obj of sourceObjects || []) {
    if (obj?.type !== 'text') continue;
    textObjectCount++;
    const content = String(obj.data?.content || '');
    const chars = content.length;
    const contentMetrics = historyTextContentDebugMetrics(content);
    textCharCount += chars;
    textLineCount += contentMetrics.lineCount;
    largestTextLineChars = Math.max(largestTextLineChars, contentMetrics.largestLineChars);
    if (chars > largestTextChars) {
      largestTextChars = chars;
      largestTextId = obj.id || '';
    }
    if (!Array.isArray(obj._layoutCache)) continue;
    runtimeTextLayoutObjects++;
    runtimeTextLayoutLines += obj._layoutCache.length;
    for (const line of obj._layoutCache) {
      runtimeTextLayoutPrefixEntries += Number(line?.prefixWidths?.length) || 0;
      runtimeTextLineContentChars += String(line?.content || '').length;
    }
  }
  return {
    textObjectCount,
    textCharCount,
    largestTextChars,
    largestTextId,
    textLineCount,
    largestTextLineChars,
    runtimeTextLayoutObjects,
    runtimeTextLayoutLines,
    runtimeTextLayoutPrefixEntries,
    runtimeTextLineContentChars,
  };
}

function replaceObjectContentsInPlace(target, source) {
  if (!target || !source) return target;
  for (const key in target) {
    if (Object.prototype.hasOwnProperty.call(target, key)) delete target[key];
  }
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  }
  return target;
}

function hydrateRestoredTextCachesFromLiveObjects(restoredObjects = []) {
  if (typeof cloneTextObjectRuntimeCaches !== 'function') {
    return { skipped: 'cloneTextObjectRuntimeCaches-unavailable' };
  }
  let candidates = 0;
  let hydrated = 0;
  let layoutCaches = 0;
  let scriptRangeCaches = 0;
  let scriptMetricCaches = 0;
  for (const obj of restoredObjects || []) {
    if (!obj || obj.type !== 'text' || !obj.id) continue;
    const live = objectsMap.get(obj.id);
    if (!live || live === obj || live.type !== 'text') continue;
    candidates++;
    const hadLayout = Array.isArray(obj._layoutCache);
    const hadScriptRanges = Array.isArray(obj._textScriptRangesCache);
    const hadScriptMetrics = !!obj._textScriptLayoutMetrics;
    cloneTextObjectRuntimeCaches(live, obj);
    const hasLayout = Array.isArray(obj._layoutCache);
    const hasScriptRanges = Array.isArray(obj._textScriptRangesCache);
    const hasScriptMetrics = !!obj._textScriptLayoutMetrics;
    const changed = (!hadLayout && hasLayout) ||
      (!hadScriptRanges && hasScriptRanges) ||
      (!hadScriptMetrics && hasScriptMetrics);
    if (!changed) continue;
    hydrated++;
    if (!hadLayout && hasLayout) layoutCaches++;
    if (!hadScriptRanges && hasScriptRanges) scriptRangeCaches++;
    if (!hadScriptMetrics && hasScriptMetrics) scriptMetricCaches++;
  }
  return { candidates, hydrated, layoutCaches, scriptRangeCaches, scriptMetricCaches };
}

function snapshot() {
  const dbg = HistoryDebug.start('snapshot', {
    objectCount: objects.length,
    historyLength: boardHistory.length,
    historyIndex,
    ...getHistoryTextDebugMetrics(objects),
  });
  const t0 = performance.now();
  HistoryDebug.count('snapshots');
  boardHistory.length = historyIndex + 1;
  const objectsSnapshot = cloneObjects(objects);
  HistoryDebug.step(dbg, 'cloneObjects', { objectCount: objectsSnapshot.length, ...getHistoryTextDebugMetrics(objectsSnapshot) });
  const editState = captureEditState();
  HistoryDebug.step(dbg, 'captureEditState', { editState: !!editState });
  boardHistory.push({
    reason: 'snapshot',
    objects: objectsSnapshot,
    editState,
  });
  historyIndex = boardHistory.length - 1;
  _dirtyIds.clear();
  trimHistory();
  pruneImageCachesAfterHistoryChange('snapshot');
  const ms = performance.now() - t0;
  HistoryDebug.max('maxSnapshotMs', ms);
  HistoryDebug.end(dbg, { ms, historyLength: boardHistory.length, historyIndex, ...getHistoryTextDebugMetrics(objects) });
}

// Delta push: only deep-clones objects that changed since last snapshot.
// Unchanged objects share the previous snapshot's reference (safe since
// restoreSnapshot always deep-clones before mutating).
function pushHistory(reason = '', options = {}) {
  const dbg = HistoryDebug.start('pushHistory', {
    reason,
    objectCount: objects.length,
    dirtyCount: _dirtyIds.size,
    historyLength: boardHistory.length,
    historyIndex,
    ...getHistoryTextDebugMetrics(objects),
  });
  const t0 = performance.now();
  HistoryDebug.count('pushHistory');
  boardHistory.length = historyIndex + 1;
  const prevEntry = historyIndex >= 0 ? boardHistory[historyIndex] : null;
  const prevObjects = prevEntry?.objects || [];
  const prevMap = new Map();
  for (const o of prevObjects) prevMap.set(o.id, o);
  HistoryDebug.step(dbg, 'build-prev-map', { objectCount: prevObjects.length });
  const cacheEditingText = !!editingId && (
    reason === 'text-edit-checkpoint' || reason === 'text-edit-enter'
  );
  let cloned = 0;
  let reused = 0;
  const entry = new Array(objects.length);
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    const runtimeTextCache = cacheEditingText && o.type === 'text' && o.id === editingId;
    if (_dirtyIds.has(o.id) || !prevMap.has(o.id) || runtimeTextCache) {
      cloned++;
      entry[i] = cloneObject(o, runtimeTextCache);
      continue;
    }
    reused++;
    entry[i] = prevMap.get(o.id);
  }
  HistoryDebug.count('clonedObjects', cloned);
  HistoryDebug.count('reusedObjects', reused);
  HistoryDebug.step(dbg, 'clone-dirty-objects', { cloned, reused, objectCount: entry.length, ...getHistoryTextDebugMetrics(entry) });
  _dirtyIds.clear();
  const editState = captureEditState();
  HistoryDebug.step(dbg, 'captureEditState', { editState: !!editState });
  boardHistory.push({
    reason,
    objects: entry,
    editState,
    beforeEditState: options.beforeEditState || null,
  });
  historyIndex++;
  trimHistory();
  pruneImageCachesAfterHistoryChange(reason || 'pushHistory');
  updateTitle();
  const ms = performance.now() - t0;
  HistoryDebug.max('maxPushHistoryMs', ms);
  HistoryDebug.end(dbg, { reason, ms, cloned, reused, historyLength: boardHistory.length, historyIndex, ...getHistoryTextDebugMetrics(entry) });
}

function snapshotContainsTextObject(snapshotObjects = [], id = '') {
  for (const obj of snapshotObjects || []) {
    if (obj?.id === id && obj?.type === 'text') return true;
  }
  return false;
}

function restoreSnapshot(s, {
  editStateOverride = undefined,
} = {}) {
  const snapshotObjects = s?.objects || [];
  const snapshotEditState = s?.editState || null;
  const editState = editStateOverride === undefined ? snapshotEditState : editStateOverride;
  const hadEditing = !!editingId;
  const dbg = HistoryDebug.start('restoreSnapshot', {
    objectCount: snapshotObjects.length,
    historyLength: boardHistory.length,
    historyIndex,
    selectedCount: selectedIds.size,
    editState: !!editState,
    sourceReason: historyEntryReason(s),
    ...getHistoryEntryDebugMetrics(s, 'source'),
    ...getHistoryEditStateDebugMetrics(editState, 'editState'),
    ...getHistoryTextDebugMetrics(snapshotObjects),
  });
  const t0 = performance.now();
  HistoryDebug.count('restores');
  const clearEditMeta = {
    hadEditing,
    previousEditingId: editingId || '',
    previousProxyChars: typeof _editEl?.value === 'string' ? _editEl.value.length : '',
    previousSelectionStart: _editEl?.selectionStart ?? '',
    previousSelectionEnd: _editEl?.selectionEnd ?? '',
    hadSelectionListener: !!_selChangeListener,
    hadCaretTimer: !!_caretBlinkInterval,
    hadHistoryTimer: !!_editHistoryTimer,
  };
  const liveEditId = editingId || '';
  const liveEditProxy = _editEl || null;
  const liveEditObject = liveEditId ? objectsMap.get(liveEditId) : null;
  const preserveLiveEdit = !!(
    editState?.id &&
    liveEditId === editState.id &&
    liveEditProxy &&
    liveEditObject?.type === 'text' &&
    snapshotContainsTextObject(snapshotObjects, editState.id)
  );
  let liveSelectionListenerRemoved = false;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;
  if (editingId && preserveLiveEdit) {
    if (_selChangeListener) {
      document.removeEventListener('selectionchange', _selChangeListener);
      liveSelectionListenerRemoved = true;
    }
    clearEditMeta.preservedLiveEdit = true;
    clearEditMeta.removedSelectionListenerTemporarily = liveSelectionListenerRemoved;
  } else if (editingId) {
    clearInterval(_caretBlinkInterval);
    _caretBlinkInterval = null;
    _editHistoryLastContent = null;
    if (_selChangeListener) {
      document.removeEventListener('selectionchange', _selChangeListener);
      _selChangeListener = null;
    }
    if (_editEl) {
      const removeProxyStart = performance.now();
      _editEl.remove();
      clearEditMeta.removeProxyMs = historyDebugRound(performance.now() - removeProxyStart);
    }
    editingId = null;
    _editEl = null;
  }
  _editHistoryActionStartState = null;
  HistoryDebug.step(dbg, 'clear-editing', clearEditMeta);
  const prevSelectedIds = new Set(selectedIds);
  const cloneObjectsStart = performance.now();
  const clonedSnapshotObjects = cloneObjects(snapshotObjects, true);
  const liveCacheHydrateMeta = hydrateRestoredTextCachesFromLiveObjects(clonedSnapshotObjects);
  HistoryDebug.step(dbg, 'hydrate-live-text-caches', liveCacheHydrateMeta);
  if (preserveLiveEdit) {
    const liveIndex = clonedSnapshotObjects.findIndex((obj) => obj?.id === liveEditId && obj?.type === 'text');
    if (liveIndex >= 0) {
      replaceObjectContentsInPlace(liveEditObject, clonedSnapshotObjects[liveIndex]);
      clonedSnapshotObjects[liveIndex] = liveEditObject;
    }
  }
  const cloneObjectsMs = performance.now() - cloneObjectsStart;
  HistoryDebug.step(dbg, 'clone-snapshot-objects', {
    cloneObjectsMs,
    objectCount: clonedSnapshotObjects.length,
    preservedLiveEdit: preserveLiveEdit,
    ...getHistoryTextDebugMetrics(clonedSnapshotObjects),
  });
  const replaceStart = performance.now();
  BoardfishEditorState.replaceBoardObjects(clonedSnapshotObjects, {
    normalizeText: false,
    syncTextHeights: false,
    preserveTextRuntimeCaches: true,
  });
  const replaceBoardObjectsMs = performance.now() - replaceStart;
  HistoryDebug.step(dbg, 'replace-board-objects', {
    replaceBoardObjectsMs,
    objectCount: objects.length,
    ...getHistoryTextDebugMetrics(objects),
  });
  HistoryDebug.step(dbg, 'normalize-text', { objectCount: objects.length });
  _dirtyIds.clear();
  HistoryDebug.step(dbg, 'rebuild-caches', { objectCount: objectsMap.size });
  HistoryDebug.step(dbg, 'preserve-text-heights');
  const invalidateStart = performance.now();
  invalidateOffscreen();
  HistoryDebug.step(dbg, 'invalidate-offscreen', { invalidateOffscreenMs: performance.now() - invalidateStart });
  // Preserve selection for objects that still exist in the restored state
  const selectionStart = performance.now();
  BoardfishEditorState.setSelection(prevSelectedIds, { exitEditing: false });
  HistoryDebug.step(dbg, 'restore-selection', {
    setSelectionMs: performance.now() - selectionStart,
    previousSelectedCount: prevSelectedIds.size,
    selectedCount: selectedIds.size,
  });
  const renderStart = performance.now();
  renderAll();
  HistoryDebug.step(dbg, 'renderAll-scheduled', {
    renderScheduleMs: performance.now() - renderStart,
    selectedCount: selectedIds.size,
    ...getHistoryTextDebugMetrics(objects),
  });
  if (!editState || !editState.id) {
    const ms = performance.now() - t0;
    HistoryDebug.max('maxRestoreMs', ms);
    HistoryDebug.end(dbg, { ms, objectCount: objects.length, selectedCount: selectedIds.size, ...getHistoryTextDebugMetrics(objects) });
    return;
  }
  const obj = objectsMap.get(editState.id);
  if (!obj || obj.type !== 'text') {
    const ms = performance.now() - t0;
    HistoryDebug.max('maxRestoreMs', ms);
    HistoryDebug.end(dbg, { ms, skippedEditRestore: true, ...getHistoryTextDebugMetrics(objects) });
    return;
  }

  HistoryDebug.step(dbg, 'restore-edit-start', {
    editValueChars: String(obj.data?.content || '').length,
    objectWidth: obj.w,
    objectHeight: obj.h,
    ...getHistoryEditStateDebugMetrics(editState, 'editState'),
  });
  const editSelectionStart = performance.now();
  BoardfishEditorState.setSelection([obj.id], { primaryId: obj.id, exitEditing: false });
  HistoryDebug.step(dbg, 'restore-edit-selection', {
    setSelectionMs: performance.now() - editSelectionStart,
    selectedCount: selectedIds.size,
    editStateId: editState.id,
  });
  const enterEditStart = performance.now();
  let reusedEditProxy = false;
  if (preserveLiveEdit && _editEl === liveEditProxy && obj === liveEditObject) {
    reusedEditProxy = true;
    setHistoryEditProxyLogicalValue(_editEl, obj.data?.content);
    obj._editStartContent = obj.data.content;
    if (typeof setTextEditMinLinesForSession === 'function') {
      setTextEditMinLinesForSession(obj, { preserveSize: true });
    } else if (typeof textEditMinLinesForSession === 'function') {
      obj._editMinLines = textEditMinLinesForSession(obj, { preserveSize: true });
    }
    _editHistoryLastContent = obj.data.content;
    _editHistoryActionStartState = null;
  } else {
    enterEdit(obj.id, {
      history: false,
      preserveSize: true,
      placeInitialCaret: false,
      normalizeForEdit: false,
    });
  }
  HistoryDebug.step(dbg, 'enter-edit-restored', {
    enterEditMs: performance.now() - enterEditStart,
    editStateId: editState.id,
    reusedEditProxy,
    proxyChars: historyEditProxyValue(_editEl).length,
    objectWidth: obj.w,
    objectHeight: obj.h,
    ...getHistoryTextDebugMetrics([obj]),
  });

  if (!_editEl) {
    const ms = performance.now() - t0;
    HistoryDebug.max('maxRestoreMs', ms);
    HistoryDebug.end(dbg, { ms, skippedEditRestore: 'missing-edit-proxy', ...getHistoryTextDebugMetrics(objects) });
    return;
  }
  const max = historyEditProxyValue(_editEl).length;
  const start = Math.max(0, Math.min(editState.selectionStart ?? max, max));
  const end = Math.max(0, Math.min(editState.selectionEnd ?? max, max));
  const proxyDomSync = syncHistoryEditProxyDomValueForSelection(_editEl, start, end);
  const setSelectionRangeStart = performance.now();
  _textInputSelectionHistorySuppress = { start, end };
  _editEl.setSelectionRange(start, end, editState.selectionDirection || 'none');
  const setSelectionRangeMs = performance.now() - setSelectionRangeStart;
  let focusMs = '';
  let focusSkipped = '';
  const editProxyAlreadyFocused = typeof document !== 'undefined' && document.activeElement === _editEl;
  if (reusedEditProxy && editProxyAlreadyFocused) {
    focusSkipped = 'already-focused';
  } else if (typeof _editEl.focus === 'function') {
    const focusStart = performance.now();
    _editEl.focus({ preventScroll: true });
    focusMs = performance.now() - focusStart;
  } else {
    focusSkipped = 'missing-focus';
  }
  HistoryDebug.step(dbg, 'restore-edit-caret', {
    setSelectionRangeMs,
    focusMs,
    focusSkipped,
    editStateId: editState.id,
    editValueChars: max,
    proxyDomSyncedForSelection: proxyDomSync.synced,
    proxyDomSyncReason: proxyDomSync.reason,
    proxyDomSyncMs: proxyDomSync.ms,
    proxyDomCharsBeforeSelection: proxyDomSync.domCharsBefore,
    proxyDomCharsAfterSelection: proxyDomSync.domCharsAfter,
    selectionStart: start,
    selectionEnd: end,
    selectedChars: Math.abs(end - start),
    selectionDirection: editState.selectionDirection || 'none',
    scriptCaretIndex: editState.scriptCaretIndex ?? '',
    scriptCaretAffinity: editState.scriptCaretAffinity || '',
  });
  if (typeof TextSelDebug !== 'undefined') {
    TextSelDebug._logHistoryAction?.('history-restore-edit-caret', {
      objectId: obj.id,
      editValueChars: max,
      selectionStart: start,
      selectionEnd: end,
      selectedChars: Math.abs(end - start),
      selectionDirection: editState.selectionDirection || 'none',
      reusedEditProxy,
      proxyDomSyncedForSelection: proxyDomSync.synced,
      proxyDomSyncReason: proxyDomSync.reason,
      proxyDomCharsBeforeSelection: proxyDomSync.domCharsBefore,
      proxyDomCharsAfterSelection: proxyDomSync.domCharsAfter,
      proxyChars: typeof _editEl?.value === 'string' ? _editEl.value.length : '',
    });
  }
  if (start === end) {
    obj._textEditCaretIndex = start;
    if (editState.scriptCaretIndex === start && editState.scriptCaretAffinity) {
      obj._textScriptCaretIndex = start;
      obj._textScriptCaretAffinity = editState.scriptCaretAffinity;
    } else {
      delete obj._textScriptCaretIndex;
      delete obj._textScriptCaretAffinity;
    }
  } else {
    delete obj._textEditCaretIndex;
    delete obj._textScriptCaretIndex;
    delete obj._textScriptCaretAffinity;
  }
  if (liveSelectionListenerRemoved && _selChangeListener) {
    document.addEventListener('selectionchange', _selChangeListener);
    HistoryDebug.step(dbg, 'restore-edit-listener', { editStateId: editState.id, restoredSelectionListener: true });
  }
  _caretVisible = true;
  const scheduleStart = performance.now();
  scheduleRender(true, true);
  HistoryDebug.step(dbg, 'restore-render-scheduled', {
    renderScheduleMs: performance.now() - scheduleStart,
    editStateId: editState.id,
    selectionStart: start,
    selectionEnd: end,
  });
  const ms = performance.now() - t0;
  HistoryDebug.max('maxRestoreMs', ms);
  HistoryDebug.end(dbg, { ms, objectCount: objects.length, selectedCount: selectedIds.size, restoredEdit: true, ...getHistoryTextDebugMetrics(objects) });
}

function captureEditState() {
  if (!editingId) return null;
  if (!_editEl) return { id: editingId, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' };
  const state = {
    id: editingId,
    selectionStart: _editEl.selectionStart,
    selectionEnd: _editEl.selectionEnd,
    selectionDirection: _editEl.selectionDirection || 'none',
  };
  const obj = objectsMap.get(editingId);
  if (
    state.selectionStart === state.selectionEnd &&
    obj?._textScriptCaretIndex === state.selectionStart &&
    obj?._textScriptCaretAffinity
  ) {
    state.scriptCaretIndex = obj._textScriptCaretIndex;
    state.scriptCaretAffinity = obj._textScriptCaretAffinity;
  }
  return state;
}

function undo() {
  const dbg = HistoryDebug.start('undo', {
    historyLength: boardHistory.length,
    historyIndex,
    editing: !!editingId,
    ...getHistoryTextDebugMetrics(objects),
  });
  let flushedCheckpoint = false;
  if (typeof flushEditHistoryCheckpoint === 'function') {
    const flushStart = performance.now();
    flushedCheckpoint = !!flushEditHistoryCheckpoint();
    HistoryDebug.step(dbg, 'flush-edit-history', {
      flushedCheckpoint,
      flushMs: performance.now() - flushStart,
      historyLength: boardHistory.length,
      historyIndex,
      ...getHistoryTextDebugMetrics(objects),
    });
  }
  if (historyIndex <= 0) {
    HistoryDebug.end(dbg, { skipped: 'at-start', flushedCheckpoint, historyLength: boardHistory.length, historyIndex });
    return;
  }
  HistoryDebug.count('undo');
  const actionEntry = boardHistory[historyIndex];
  const targetEntry = boardHistory[historyIndex - 1];
  HistoryDebug.step(dbg, 'target-ready', {
    actionReason: historyEntryReason(actionEntry),
    targetReason: historyEntryReason(targetEntry),
    flushedCheckpoint,
    ...getHistoryEntryDebugMetrics(actionEntry, 'action'),
    ...getHistoryEntryDebugMetrics(targetEntry, 'target'),
  });
  historyIndex--;
  const undoEditState = actionEntry?.reason === 'text-edit-checkpoint'
    ? actionEntry.beforeEditState || undefined
    : undefined;
  const restoreStart = performance.now();
  restoreSnapshot(boardHistory[historyIndex], {
    editStateOverride: undoEditState,
  });
  HistoryDebug.step(dbg, 'restore-done', {
    restoreMs: performance.now() - restoreStart,
    historyLength: boardHistory.length,
    historyIndex,
    ...getHistoryTextDebugMetrics(objects),
  });
  updateTitle();
  HistoryDebug.end(dbg, {
    historyLength: boardHistory.length,
    historyIndex,
    actionReason: historyEntryReason(actionEntry),
    targetReason: historyEntryReason(targetEntry),
    flushedCheckpoint,
    ...getHistoryTextDebugMetrics(objects),
  });
}

function redo() {
  const dbg = HistoryDebug.start('redo', {
    historyLength: boardHistory.length,
    historyIndex,
    editing: !!editingId,
    ...getHistoryTextDebugMetrics(objects),
  });
  let flushedCheckpoint = false;
  if (typeof flushEditHistoryCheckpoint === 'function') {
    const flushStart = performance.now();
    flushedCheckpoint = !!flushEditHistoryCheckpoint();
    HistoryDebug.step(dbg, 'flush-edit-history', {
      flushedCheckpoint,
      flushMs: performance.now() - flushStart,
      historyLength: boardHistory.length,
      historyIndex,
      ...getHistoryTextDebugMetrics(objects),
    });
  }
  if (flushedCheckpoint) {
    HistoryDebug.end(dbg, { skipped: 'flushed-pending-checkpoint', flushedCheckpoint, historyLength: boardHistory.length, historyIndex });
    return;
  }
  if (historyIndex >= boardHistory.length - 1) {
    HistoryDebug.end(dbg, { skipped: 'at-end', flushedCheckpoint, historyLength: boardHistory.length, historyIndex });
    return;
  }
  HistoryDebug.count('redo');
  historyIndex++;
  const actionEntry = boardHistory[historyIndex];
  HistoryDebug.step(dbg, 'target-ready', {
    targetReason: historyEntryReason(actionEntry),
    flushedCheckpoint,
    ...getHistoryEntryDebugMetrics(actionEntry, 'target'),
  });
  const restoreStart = performance.now();
  restoreSnapshot(actionEntry);
  HistoryDebug.step(dbg, 'restore-done', {
    restoreMs: performance.now() - restoreStart,
    historyLength: boardHistory.length,
    historyIndex,
    ...getHistoryTextDebugMetrics(objects),
  });
  updateTitle();
  HistoryDebug.end(dbg, {
    historyLength: boardHistory.length,
    historyIndex,
    targetReason: historyEntryReason(actionEntry),
    flushedCheckpoint,
    ...getHistoryTextDebugMetrics(objects),
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  scheduleRender(true, true, 'renderAll');
}
