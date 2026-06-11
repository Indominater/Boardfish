'use strict';

(function initEditorStateBoundary(root) {
  function clearSelectionState() {
    selectedId = null;
    selectedIds.clear();
  }

  function noteNewlySelectedObjects(previousSelectedIds) {
    const newlySelectedObjects = [];
    for (const id of selectedIds) {
      if (previousSelectedIds.has(id)) continue;
      const obj = objectsMap.get(id);
      if (obj && obj.type !== 'text') newlySelectedObjects.push(obj);
    }
    if (newlySelectedObjects.length) {
      root.BoardfishMotion?.applyActionAnimation?.('object-select', { objects: newlySelectedObjects });
    }
  }

  function setSelectionState(ids = [], {
    animateSelection = true,
    primaryId = null,
    exitEditing = true,
  } = {}) {
    const startedAt = root.performance?.now?.() ?? Date.now();
    const nextIds = Array.isArray(ids) ? ids : [...(ids || [])];
    const previousSelectedIds = animateSelection ? new Set(selectedIds) : null;
    const previousCount = selectedIds.size;
    const previousPrimaryId = selectedId || '';
    const previousEditingId = editingId || '';
    if (exitEditing && editingId && !nextIds.includes(editingId)) exitEdit();
    selectedIds.clear();
    let lastExistingId = null;
    for (const id of nextIds) {
      if (!objectsMap.has(id)) continue;
      selectedIds.add(id);
      lastExistingId = id;
    }
    selectedId = primaryId && selectedIds.has(primaryId) ? primaryId : lastExistingId;
    if (editingId && !selectedIds.has(editingId)) exitEdit();
    if (animateSelection) noteNewlySelectedObjects(previousSelectedIds);
    root.TextSelDebug?._logObjectSelection?.('set-selection', nextIds, {
      ms: Math.round(((root.performance?.now?.() ?? Date.now()) - startedAt) * 100) / 100,
      previousCount,
      previousPrimaryId,
      previousEditingId,
      exitEditing,
      animateSelection,
      requestedPrimaryId: primaryId || '',
    });
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
    root.BoardfishImageInsertMotion?.clear?.(idsToRemove);
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
    const preserved = new Set(preserveIds.filter(Boolean));
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
        measurements: true,
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
    root.BoardfishImageInsertMotion?.clearStale?.();
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
    root.BoardfishImageInsertMotion?.clear?.();
    resetObjectCounters();
  }

  function setBoardOpening(opening) {
    _boardOpening = !!opening;
    updateInputShieldVisual();
  }

  function commitMutation(reason, mutate, {
    history = true,
    invalidate = false,
    renderBoard = true,
    renderOverlay = true,
    renderSource = reason || 'mutation',
  } = {}) {
    const result = typeof mutate === 'function' ? mutate() : undefined;
    if (!result) return result;
    if (invalidate && typeof invalidateOffscreen === 'function') invalidateOffscreen();
    if (typeof scheduleRender === 'function') scheduleRender(renderBoard, renderOverlay, renderSource);
    if (history && typeof pushHistory === 'function') pushHistory(reason);
    return result;
  }

  root.BoardfishEditorState = Object.freeze({
    addObject,
    clearSelection: clearSelectionState,
    clearTextLayoutState,
    commitMutation,
    deleteEmptyTextObjects,
    removeEmptyTextObjects,
    removeObjectsById,
    replaceBoardObjects,
    resetBoardObjectState,
    resetObjectCounters,
    restoreObjectCountersFromObjects,
    setSelection: setSelectionState,
    setBoardOpening,
    setViewport: setViewportState,
  });
})(typeof window !== 'undefined' ? window : globalThis);
