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

function newId() {
  let id = '';
  do {
    id = 'obj-' + (idCounter++);
  } while (objectsMap?.has?.(id));
  return id;
}

function cloneTextScriptRangesForObject(obj, content, sourceScriptRanges) {
  if (!Array.isArray(sourceScriptRanges) || !sourceScriptRanges.length) return [];
  if (typeof normalizeTextScriptRangesForContent === 'function') {
    const sourceKey = JSON.stringify(sourceScriptRanges);
    if (
      Array.isArray(obj._textScriptRangesCache) &&
      obj._textScriptRangesCacheContent === content &&
      obj._textScriptRangesCacheSourceKey === sourceKey
    ) {
      return obj._textScriptRangesCache.map((range) => ({ ...range }));
    }
    return normalizeTextScriptRangesForContent(content, sourceScriptRanges);
  }
  return sourceScriptRanges.map((range) => ({ ...range }));
}

function cloneObject(obj, options = {}) {
  HistoryDebug.count('cloneObjectCalls');
  const data = obj.type === 'image'
    ? {
        imgKey: obj.data.imgKey,
        ...imageTransformFromObject(obj),
      }
    : (() => {
        const content = normalizeTextContent(obj.data.content);
        const textData = { content };
        const sourceLineAlign = obj.data?.lineAlign;
        if (Array.isArray(sourceLineAlign) && sourceLineAlign.length) {
          if (typeof normalizeTextLineAlignForContent === 'function') {
            const lineAlign = normalizeTextLineAlignForContent(content, sourceLineAlign);
            if (lineAlign.length) textData.lineAlign = lineAlign;
          } else {
            textData.lineAlign = [...sourceLineAlign];
          }
        }
        const sourceScriptRanges = obj.data?.scriptRanges;
        if (Array.isArray(sourceScriptRanges) && sourceScriptRanges.length) {
          const scriptRanges = cloneTextScriptRangesForObject(obj, content, sourceScriptRanges);
          if (scriptRanges.length) textData.scriptRanges = scriptRanges;
        }
        return textData;
      })();
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
  if (
    options.runtimeTextCache === true &&
    cloned.type === 'text' &&
    typeof cloneTextObjectRuntimeCaches === 'function'
  ) {
    cloneTextObjectRuntimeCaches(obj, cloned);
  }
  return cloned;
}

function cloneObjects(list, options = {}) {
  const dbg = HistoryDebug.start('cloneObjects', { objectCount: list.length });
  const t0 = performance.now();
  HistoryDebug.count('cloneObjectsCalls');
  HistoryDebug.count('clonedObjects', list.length);
  const clones = new Array(list.length);
  for (let i = 0; i < list.length; i++) clones[i] = cloneObject(list[i], options);
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
  const moved = BoardfishEditorState.commitMutation('send-selected-to-back', () => {
    // Pull out selected objects (preserving their relative order), prepend to front.
    const selected = [], rest = [];
    for (const o of objects) {
      if (selectedIds.has(o.id)) selected.push(o);
      else rest.push(o);
    }
    if (!selected.length) return false;
    objects.length = 0;
    objects.push(...selected, ...rest);
    for (const obj of selected) markDirty(obj.id);
    return true;
  });
  if (moved) globalThis.BoardfishMotion?.applyActionAnimation?.('send-selected-to-back', { selection: true });
}

function flipSelectedImages() {
  const dbg = ClipDebug.start('flipSelectedImages', { selectedCount: selectedIds.size });
  let imageCount = 0;
  const flipped = BoardfishEditorState.commitMutation('flip-image', () => {
    let didFlip = false;
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj || obj.type !== 'image') continue;
      imageCount++;
      obj.data.flipX = !obj.data.flipX;
      markDirty(obj.id);
      didFlip = true;
    }
    return didFlip;
  }, { invalidate: true });
  ClipDebug.step(dbg, 'toggle-flags', { imageCount, flipped });
  if (!flipped) { ClipDebug.end(dbg, { skipped: true }); return; }
  globalThis.BoardfishMotion?.applyActionAnimation?.('flip-image', { selection: true });
  ClipDebug.end(dbg, { historyIndex });
}

function rotateSelectedImages(dir) {
  const rotatedAny = BoardfishEditorState.commitMutation(`rotate-image-${dir}`, () => {
    let rotated = false;
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj || obj.type !== 'image') continue;
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
  if (rotatedAny) globalThis.BoardfishMotion?.applyActionAnimation?.('rotate-image', { selection: true });
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
