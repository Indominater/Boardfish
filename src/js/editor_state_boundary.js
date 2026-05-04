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
    if (exitEditing && editingId && !ids.includes(editingId)) exitEdit();
    selectedIds.clear();
    let lastExistingId = null;
    for (const id of ids) {
      if (!objectsMap.has(id)) continue;
      selectedIds.add(id);
      lastExistingId = id;
    }
    selectedId = primaryId && selectedIds.has(primaryId) ? primaryId : lastExistingId;
    if (editingId && !selectedIds.has(editingId)) exitEdit();
    return selectedIds.size;
  }

  function addObject(obj) {
    objects.push(obj);
    objectsMap.set(obj.id, obj);
    return obj;
  }

  function addObjects(nextObjects = []) {
    for (const obj of nextObjects) addObject(obj);
    return nextObjects;
  }

  function removeObjectsById(ids = []) {
    const idsToRemove = new Set(ids);
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

  function removeSelectedObjects() {
    return removeObjectsById([...selectedIds]);
  }

  function clearTextLayoutState() {
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
  } = {}) {
    objects = Array.isArray(nextObjects) ? nextObjects : [];
    if (normalizeText) {
      for (const obj of objects) {
        if (obj?.type === 'text') obj.data.content = normalizeTextContent(obj.data?.content);
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

  function snapshotObjectsMap(objectsSnapshot) {
    const map = new Map();
    for (const obj of objectsSnapshot) map.set(obj.id, obj);
    return map;
  }

  function snapshotImageStore() {
    return BoardfishImageStore.snapshotSources();
  }

  function snapshotSelection() {
    return {
      selectedId,
      selectedIds: [...selectedIds],
      editingId,
    };
  }

  function snapshotViewport() {
    return BoardfishViewportState.snapshot();
  }

  function snapshotBoardState() {
    const objectsSnapshot = cloneObjects(objects);
    return {
      objects: objectsSnapshot,
      objectsMap: snapshotObjectsMap(objectsSnapshot),
      imageStore: snapshotImageStore(),
      imageCacheKeys: BoardfishImageStore.cacheKeys(),
      history: { boardHistory, historyIndex },
      selection: snapshotSelection(),
      viewport: snapshotViewport(),
    };
  }

  root.BoardfishEditorState = Object.freeze({
    addObject,
    addObjects,
    clearSelection: clearSelectionState,
    clearTextLayoutState,
    commitMutation,
    removeObjectsById,
    removeSelectedObjects,
    replaceBoardObjects,
    resetBoardObjectState,
    resetObjectCounters,
    restoreObjectCountersFromObjects,
    setSelection: setSelectionState,
    setBoardOpening,
    setViewport: setViewportState,
    snapshotBoardState,
    snapshotSelection,
    snapshotViewport,
  });
})(typeof window !== 'undefined' ? window : globalThis);
