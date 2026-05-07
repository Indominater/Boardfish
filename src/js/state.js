// ─── Object state ─────────────────────────────────────────────────────────────
var zCounter = 1;
var selectedId = null;
var selectedIds = new Set();
var editingId  = null;
var objects    = [];
var objectsMap = new Map();
var idCounter  = 1;
var _boardOpening = false;
var _bulkImageInsertDepth = 0;
var _bulkImageInsertAdded = 0;
var _bulkImageInsertLastRender = 0;
var _imageReadyLastRender = 0;

function rebuildObjectsMap() {
  objectsMap.clear();
  for (const obj of objects) objectsMap.set(obj.id, obj);
}

function newId() { return 'obj-' + (idCounter++); }

function cloneObject(obj) {
  HistoryDebug.count('cloneObjectCalls');
  const data = obj.type === 'image'
    ? {
        imgKey: obj.data.imgKey,
        ...imageTransformFromObject(obj),
      }
    : { content: normalizeTextContent(obj.data.content) };
  return {
    id: obj.id,
    type: obj.type,
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    z: obj.z,
    locked: obj.locked === true,
    data,
  };
}

function cloneObjects(list) {
  const dbg = HistoryDebug.start('cloneObjects', { objectCount: list.length });
  const t0 = performance.now();
  HistoryDebug.count('cloneObjectsCalls');
  HistoryDebug.count('clonedObjects', list.length);
  const clones = new Array(list.length);
  for (let i = 0; i < list.length; i++) clones[i] = cloneObject(list[i]);
  const ms = performance.now() - t0;
  HistoryDebug.max('maxCloneObjectsMs', ms);
  HistoryDebug.end(dbg, { objectCount: list.length, ms });
  return clones;
}

function bringObjectToFront(id) {
  const idx = objects.findIndex((o) => o.id === id);
  if (idx < 0 || idx === objects.length - 1) return;
  const [obj] = objects.splice(idx, 1);
  objects.push(obj);
}

const isObjectLocked = (objOrId) => {
  const obj = typeof objOrId === 'string' ? objectsMap.get(objOrId) : objOrId;
  return obj?.locked === true;
};

const selectedLockSummary = () => {
  let total = 0;
  let locked = 0;
  let unlocked = 0;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    total++;
    if (isObjectLocked(obj)) locked++;
    else unlocked++;
  }
  return {
    total,
    locked,
    unlocked,
    anyLocked: locked > 0,
    allLocked: total > 0 && unlocked === 0,
    anyUnlocked: unlocked > 0,
  };
};

const selectedHasLockedObjects = () => {
  return selectedLockSummary().anyLocked;
};

const selectedUnlockedObjectIds = () => {
  const ids = [];
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj && !isObjectLocked(obj)) ids.push(id);
  }
  return ids;
};

const toggleSelectedLock = () => {
  if (!selectedIds.size) return false;
  const summary = selectedLockSummary();
  if (!summary.total) return false;
  const unlockSingle = summary.total === 1 && summary.locked === 1;
  const targetIds = unlockSingle ? [...selectedIds] : selectedUnlockedObjectIds();
  if (!targetIds.length) return false;
  const nextLocked = !unlockSingle;
  return BoardfishEditorState.commitMutation(nextLocked ? 'lock-selected' : 'unlock-selected', () => {
    let changed = false;
    if (editingId && selectedIds.has(editingId)) exitEdit();
    for (const id of targetIds) {
      const obj = objectsMap.get(id);
      if (!obj || obj.locked === nextLocked) continue;
      obj.locked = nextLocked;
      markDirty(obj.id);
      changed = true;
    }
    if (changed && nextLocked) BoardfishEditorState.clearSelection();
    return changed;
  });
};

function sendSelectedToBack() {
  if (!selectedIds.size) return;
  BoardfishEditorState.commitMutation('send-selected-to-back', () => {
    // Pull out movable selected objects (preserving their relative order), prepend to front.
    const selected = [], rest = [];
    for (const o of objects) {
      if (selectedIds.has(o.id) && !isObjectLocked(o)) selected.push(o);
      else rest.push(o);
    }
    if (!selected.length) return false;
    objects.length = 0;
    objects.push(...selected, ...rest);
    for (const obj of selected) markDirty(obj.id);
    return true;
  });
}

function flipSelectedImages(axis) {
  const dbg = ClipDebug.start('flipSelectedImages', { axis, selectedCount: selectedIds.size });
  let imageCount = 0;
  const flipped = BoardfishEditorState.commitMutation(`flip-image-${axis}`, () => {
    let didFlip = false;
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj || obj.type !== 'image' || isObjectLocked(obj)) continue;
      imageCount++;
      if (axis === 'x') obj.data.flipX = !obj.data.flipX;
      else obj.data.flipY = !obj.data.flipY;
      markDirty(obj.id);
      didFlip = true;
    }
    return didFlip;
  }, { invalidate: true });
  ClipDebug.step(dbg, 'toggle-flags', { imageCount, flipped });
  if (!flipped) { ClipDebug.end(dbg, { skipped: true }); return; }
  ClipDebug.end(dbg, { historyIndex });
}

function rotateSelectedImages(dir) {
  BoardfishEditorState.commitMutation(`rotate-image-${dir}`, () => {
    let rotated = false;
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj || obj.type !== 'image' || isObjectLocked(obj)) continue;
      const transform = imageTransformFromObject(obj);
      const current = transform.rotation;
      const oddFlip = transform.flipX !== transform.flipY;
      const delta = (dir === 'cw') !== oddFlip ? 90 : 270;
      obj.data.rotation = (current + delta) % 360;
      const cx = obj.x + obj.w / 2;
      const cy = obj.y + obj.h / 2;
      const nextW = obj.h;
      const nextH = obj.w;
      obj.w = nextW;
      obj.h = nextH;
      obj.x = cx - nextW / 2;
      obj.y = cy - nextH / 2;
      markDirty(obj.id);
      rotated = true;
    }
    return rotated;
  }, { invalidate: true });
}

function isMultiSelected() {
  return selectedIds.size > 1;
}

function hasSelection() {
  return selectedIds.size > 0;
}

function isSelected(id) {
  return selectedIds.has(id);
}

function getFirstSelectedObject() {
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj) return obj;
  }
  return null;
}
