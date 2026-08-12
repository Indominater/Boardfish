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
var _imageReadyLastRender = 0;

function newId() {
  let id = '';
  do {
    id = 'obj-' + (idCounter++);
  } while (objectsMap.has(id));
  return id;
}

function cloneObject(obj, runtimeTextCache = false) {
  HistoryDebug.count('cloneObjectCalls');
  let data = obj.type === 'image' ? { ...obj.data } : null;
  if (!data) {
    const content = obj.data.content;
    data = { content };
    const sourceLineAlign = obj.data?.lineAlign;
    if (Array.isArray(sourceLineAlign) && sourceLineAlign.length) data.lineAlign = sourceLineAlign.slice();
    const sourceScriptRanges = obj.data?.scriptRanges;
    if (Array.isArray(sourceScriptRanges) && sourceScriptRanges.length) {
      const scriptRanges = obj._textScriptRangesCache !== sourceScriptRanges || obj._textScriptRangesCacheContent !== content
        ? normalizeTextScriptRangesForContent(content, sourceScriptRanges)
        : cloneTextScriptRanges(sourceScriptRanges);
      if (scriptRanges.length) data.scriptRanges = scriptRanges;
    }
  }
  const cloned = {
    id: obj.id,
    type: obj.type,
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    z: obj.z,
    data,
  };
  if (runtimeTextCache && cloned.type === 'text') {
    cloneTextObjectRuntimeCaches(obj, cloned);
  }
  return cloned;
}

function cloneObjects(list, runtimeTextCache = false) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = HistoryDebug.start('cloneObjects', { objectCount: list.length });
  const t0 = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  HistoryDebug.count('cloneObjectsCalls');
  HistoryDebug.count('clonedObjects', list.length);
  const clones = new Array(list.length);
  for (let i = 0; i < list.length; i++) clones[i] = cloneObject(list[i], runtimeTextCache);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const ms = performance.now() - t0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  HistoryDebug.max('maxCloneObjectsMs', ms);
  HistoryDebug.end(dbg, { objectCount: list.length, ms });
  return clones;
}

function bringObjectToFront(obj) {
  if (objects[objects.length - 1] === obj) return;
  const idx = objects.indexOf(obj);
  if (idx < 0) return;
  objects.splice(idx, 1);
  objects.push(obj);
  markDirty(obj);
  obj.z = ++zCounter;
}

function sendSelectedToBack() {
  if (!selectedIds.size) return;
  BoardfishEditorState.commitMutation('send-selected-to-back', () => {
    // Pull out selected objects (preserving their relative order), prepend to front.
    const selected = [], rest = [];
    for (const o of objects) {
      if (selectedIds.has(o.id)) selected.push(o);
      else rest.push(o);
    }
    if (!selected.length || !rest.length) return false;
    objects = selected.concat(rest);
    return true;
  });
}

function flipSelectedImages() {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = ClipDebug.start('flipSelectedImages', { selectedCount: selectedIds.size });
  let imageCount = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const flipped = BoardfishEditorState.commitMutation('flip-image', () => {
    let didFlip = false;
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj || obj.type !== 'image') continue;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      imageCount++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      obj.data.flipX = !obj.data.flipX;
      markDirty(obj);
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
      if (!obj || obj.type !== 'image') continue;
      const transform = obj.data;
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
      markDirty(obj);
      rotated = true;
    }
    return rotated;
  }, { invalidate: true });
}

const imageSortGeometryMatches = (obj, placement) => {
  const matches = (left, right) => (
    Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-12
  );
  return matches(obj.x, placement.x) && matches(obj.y, placement.y) &&
    matches(obj.w, placement.w) && matches(obj.h, placement.h);
};

function sortSelectedImages() {
  const selectedImages = [];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const obj of objects) {
    if (!selectedIds.has(obj.id)) continue;
    x1 = Math.min(x1, obj.x); y1 = Math.min(y1, obj.y);
    x2 = Math.max(x2, obj.x + obj.w); y2 = Math.max(y2, obj.y + obj.h);
    if (obj.type !== 'image') continue;
    if (!(Number.isFinite(obj.w) && obj.w > 0 && Number.isFinite(obj.h) && obj.h > 0)) continue;
    selectedImages.push(obj);
  }
  if (selectedImages.length < 2 || !isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return false;
  const center = {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  };
  const layout = BoardfishImageLayout.planGoldenRatioImageLayout(
    selectedImages,
    center,
    { shuffleOrder: true, randomizeTies: true },
  );
  if (!layout || layout.placements.length < 2) return false;
  let geometryChanged = false;
  for (const placement of layout.placements) {
    if (!imageSortGeometryMatches(objectsMap.get(placement.id), placement)) {
      geometryChanged = true;
      break;
    }
  }
  if (!geometryChanged) return false;

  return BoardfishEditorState.commitMutation('sort-images', () => {
    for (const placement of layout.placements) {
      const obj = objectsMap.get(placement.id);
      obj.x = placement.x;
      obj.y = placement.y;
      obj.w = placement.w;
      obj.h = placement.h;
      markDirty(obj);
    }
    return true;
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
  return objectsMap.get(selectedId) || null;
}
