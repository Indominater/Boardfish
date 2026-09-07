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

  // State mutations accept canonical objects normalized by their input paths.
  function addObject(obj) {
    objects.push(obj);
    objectsMap.set(obj.id, obj);
    return obj;
  }

  function removeObjectsById(ids = []) {
    const idsToRemove = ids instanceof Set ? ids : new Set(ids);
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

  function resetObjectCounters() {
    idCounter = 1;
    zCounter = 1;
  }

  function restoreObjectCounters() {
    resetObjectCounters();
    for (const obj of objects) {
      const idNumber = parseInt(obj.id.slice(4));
      if (idNumber >= idCounter) idCounter = idNumber + 1;
      if (obj.z >= zCounter) zCounter = obj.z + 1;
    }
  }

  function setViewportState(viewport = null) {
    if (!viewport) return;
    BoardfishViewportState.setViewport(viewport);
  }

  function replaceBoardObjects(nextObjects = [], {
    syncTextHeights = true,
  } = {}) {
    objects = Array.isArray(nextObjects) ? nextObjects : [];
    objectsMap.clear();
    for (const obj of objects) {
      objectsMap.set(obj.id, obj);
    }
    if (syncTextHeights) syncAllTextAutoHeights();
    return objects;
  }

  function resetBoardObjectState() {
    if (editingId) exitEdit();
    clearSelectionState();
    objects = [];
    objectsMap.clear();
    clearTextLayoutCaches();
    if (typeof ctx !== 'undefined') ctx?.resetResources?.();
    resetObjectCounters();
  }

  function setBoardOpening(opening) {
    _boardOpening = !!opening;
    updateInputShieldVisual();
  }

  function commitMutation(reason, mutate) {
    const result = mutate();
    if (!result) return result;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, reason || 'mutation');
    else scheduleRender(true, true);
    pushHistory(reason);
    return result;
  }

  root.BoardfishEditorState = Object.freeze({
    addObject,
    clearSelection: clearSelectionState,
    commitMutation,
    removeObjectsById,
    replaceBoardObjects,
    resetBoardObjectState,
    restoreObjectCounters,
    setSelection: setSelectionState,
    setBoardOpening,
    setViewport: setViewportState,
  });
})(typeof window !== 'undefined' ? window : globalThis);
