'use strict';

(function initEditorStateBoundary(root) {
  function clearSelectionState() {
    selectedId = null;
    selectedIds.clear();
  }

  function setSelectionState(ids = [], {
    primaryId = null,
    exitEditing = true,
  } = {}) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const startedAt = root.performance?.now?.() ?? Date.now();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const nextIds = ids || [];
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const previousCount = selectedIds.size;
    const previousPrimaryId = selectedId || '';
    const previousEditingId = editingId || '';
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (exitEditing && editingId && !(ids instanceof Set ? ids.has(editingId) : nextIds.includes(editingId))) exitEdit();
    selectedIds.clear();
    let lastExistingId = null;
    for (const id of nextIds) {
      if (!objectsMap.has(id)) continue;
      selectedIds.add(id);
      lastExistingId = id;
    }
    selectedId = primaryId && selectedIds.has(primaryId) ? primaryId : lastExistingId;
    if (editingId && !selectedIds.has(editingId)) exitEdit();
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      root.TextSelDebug?._logObjectSelection?.('set-selection', nextIds, {
        ms: Math.round(((root.performance?.now?.() ?? Date.now()) - startedAt) * 100) / 100,
        previousCount,
        previousPrimaryId,
        previousEditingId,
        exitEditing,
        requestedPrimaryId: primaryId || '',
      });
    }
    return selectedIds.size;
  }

  function addObject(obj) {
    objects.push(obj);
    objectsMap.set(obj.id, obj);
    return obj;
  }

  function removeObjectsById(ids = []) {
    const idsToRemove = new Set(ids);
    if (!idsToRemove.size) {
      if (selectedId && !selectedIds.has(selectedId)) selectedId = null;
      return 0;
    }
    let write = 0;
    let removed = 0;
    for (let read = 0; read < objects.length; read++) {
      const obj = objects[read];
      if (idsToRemove.has(obj.id)) {
        objectsMap.delete(obj.id);
        _linesCacheMap.delete(obj.id);
        selectedIds.delete(obj.id);
        if (selectedId === obj.id) selectedId = null;
        removed++;
        continue;
      }
      objects[write++] = obj;
    }
    objects.length = write;
    if (selectedId && !selectedIds.has(selectedId)) selectedId = null;
    return removed;
  }

  function removeEmptyTextObjects({
    ids = null,
    preserveIds = [],
  } = {}) {
    const candidateIds = ids ? new Set(ids) : null;
    const preserved = new Set();
    for (const id of preserveIds || []) {
      if (id) preserved.add(id);
    }
    const idsToRemove = [];
    for (const obj of objects) {
      if (!obj || obj.type !== 'text') continue;
      if (candidateIds && !candidateIds.has(obj.id)) continue;
      if (preserved.has(obj.id)) continue;
      if (!isTextContentEmpty(obj.data?.content)) continue;
      idsToRemove.push(obj.id);
    }
    return removeObjectsById(idsToRemove);
  }

  function deleteEmptyTextObjects(reason = 'delete-empty-text', options = {}) {
    return commitMutation(reason, () => removeEmptyTextObjects(options) > 0);
  }

  function clearTextLayoutState(options = {}) {
    if (typeof clearTextLayoutCaches === 'function') {
      clearTextLayoutCaches({
        objectLayout: options.objectLayout !== false,
      });
      return;
    }
    _linesCacheMap.clear();
    _prefixCache.clear();
  }

  function resetObjectCounters() {
    idCounter = 1;
    zCounter = 1;
  }

  function restoreObjectCountersFromObjects(objectsSnapshot = objects) {
    resetObjectCounters();
    for (const obj of objectsSnapshot) {
      const idNumber = parseInt(String(obj.id || '').split('-')[1]);
      if (!isNaN(idNumber) && idNumber >= idCounter) idCounter = idNumber + 1;
      if (obj.z >= zCounter) zCounter = obj.z + 1;
    }
  }

  function setViewportState(viewport = null) {
    if (!viewport) return;
    BoardfishViewportState.setViewport(viewport);
  }

  function replaceBoardObjects(nextObjects = [], {
    normalizeText = true,
    syncTextHeights = true,
    restoreCounters = true,
    preserveTextRuntimeCaches = false,
  } = {}) {
    objects = Array.isArray(nextObjects) ? nextObjects : [];
    clearTextLayoutState({ objectLayout: preserveTextRuntimeCaches !== true });
    if (normalizeText) {
      for (const obj of objects) {
        if (obj?.type !== 'text') continue;
        if (!obj.data) obj.data = {};
        obj.data.content = normalizeTextContent(obj.data?.content);
        if (typeof normalizeTextLineAlignForContent === 'function' && Array.isArray(obj.data.lineAlign)) {
          const lineAlign = normalizeTextLineAlignForContent(obj.data.content, obj.data.lineAlign);
          if (lineAlign.length) obj.data.lineAlign = lineAlign;
          else delete obj.data.lineAlign;
        }
        if (typeof normalizeTextScriptRangesForContent === 'function' && Array.isArray(obj.data.scriptRanges)) {
          const scriptRanges = normalizeTextScriptRangesForContent(obj.data.content, obj.data.scriptRanges);
          if (scriptRanges.length) obj.data.scriptRanges = scriptRanges;
          else delete obj.data.scriptRanges;
        }
      }
    }
    rebuildObjectsMap();
    if (syncTextHeights) syncAllTextAutoHeights();
    if (restoreCounters) restoreObjectCountersFromObjects(objects);
    return objects;
  }

  function resetBoardObjectState() {
    if (editingId) exitEdit();
    clearSelectionState();
    objects = [];
    objectsMap.clear();
    clearTextLayoutState();
    resetObjectCounters();
  }

  function setBoardOpening(opening) {
    _boardOpening = !!opening;
    updateInputShieldVisual();
  }

  function commitMutation(reason, mutate, options = {}) {
    const history = options.history === undefined ? true : options.history;
    const invalidate = options.invalidate === undefined ? false : options.invalidate;
    const renderBoard = options.renderBoard === undefined ? true : options.renderBoard;
    const renderOverlay = options.renderOverlay === undefined ? true : options.renderOverlay;
    const result = typeof mutate === 'function' ? mutate() : undefined;
    if (!result) return result;
    if (invalidate && typeof invalidateOffscreen === 'function') invalidateOffscreen();
    if (typeof scheduleRender === 'function') {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        const renderSource = options.renderSource === undefined
          ? reason || 'mutation'
          : options.renderSource;
        scheduleRender(renderBoard, renderOverlay, renderSource);
      } else {
        scheduleRender(renderBoard, renderOverlay);
      }
    }
    if (history && typeof pushHistory === 'function') pushHistory(reason);
    return result;
  }

  root.BoardfishEditorState = Object.freeze({
    addObject,
    clearSelection: clearSelectionState,
    commitMutation,
    deleteEmptyTextObjects,
    removeEmptyTextObjects,
    removeObjectsById,
    replaceBoardObjects,
    resetBoardObjectState,
    restoreObjectCountersFromObjects,
    setSelection: setSelectionState,
    setBoardOpening,
    setViewport: setViewportState,
  });
})(typeof window !== 'undefined' ? window : globalThis);
