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
        flipX: !!obj.data.flipX,
        flipY: !!obj.data.flipY,
        rotation: ((obj.data.rotation || 0) % 360 + 360) % 360,
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

function sendSelectedToBack() {
  if (!selectedIds.size) return;
  // Pull out selected objects (preserving their relative order), prepend to front
  const selected = [], rest = [];
  for (const o of objects) (selectedIds.has(o.id) ? selected : rest).push(o);
  objects.length = 0;
  objects.push(...selected, ...rest);
  scheduleRender(true, true);
  pushHistory('send-selected-to-back');
}

function flipSelectedImages(axis) {
  const dbg = ClipDebug.start('flipSelectedImages', { axis, selectedCount: selectedIds.size });
  let flipped = false;
  let imageCount = 0;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'image') continue;
    imageCount++;
    if (axis === 'x') obj.data.flipX = !obj.data.flipX;
    else obj.data.flipY = !obj.data.flipY;
    markDirty(obj.id);
    flipped = true;
  }
  ClipDebug.step(dbg, 'toggle-flags', { imageCount, flipped });
  if (!flipped) { ClipDebug.end(dbg, { skipped: true }); return; }
  invalidateOffscreen();
  scheduleRender(true, true);
  pushHistory(`flip-image-${axis}`);
  ClipDebug.end(dbg, { historyIndex });
}

function rotateSelectedImages(dir) {
  let rotated = false;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'image') continue;
    const current = ((obj.data.rotation || 0) % 360 + 360) % 360;
    const oddFlip = !!obj.data.flipX !== !!obj.data.flipY;
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
  if (!rotated) return;
  invalidateOffscreen();
  scheduleRender(true, true);
  pushHistory(`rotate-image-${dir}`);
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
