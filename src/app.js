'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────

const canvas      = document.getElementById('canvas');
const boardCanvas = document.getElementById('board-canvas');
const ctx         = boardCanvas.getContext('2d');
const ctxMenu     = document.getElementById('ctx-menu');
const fileInput   = document.getElementById('file-input');
const selOverlay  = document.getElementById('sel-overlay');
const multiSelOverlay = document.getElementById('multi-sel-overlay');
const islZoom     = document.getElementById('isl-zoom');
const objCtxMenu  = document.getElementById('obj-ctx-menu');
const copyBtn           = document.getElementById('obj-btn-copy');
const saveImageBtn      = document.getElementById('obj-btn-save-image');
const saveImagesBtn     = document.getElementById('obj-btn-save-images');
const exportSep         = document.getElementById('obj-sep-export');
const imageActionsSep   = document.getElementById('obj-sep-image-actions');
const flipHorizontalBtn = document.getElementById('obj-btn-flip-horizontal');
const flipVerticalBtn   = document.getElementById('obj-btn-flip-vertical');
const rubberBand       = document.getElementById('rubber-band');
const exportAllImageBtn = document.getElementById('btn-export-all-images');
const exportAllTextBtn  = document.getElementById('btn-export-all-text');
const exportAllSep      = document.getElementById('ctx-sep-export-all');
const IS_WIN = /Win/.test(navigator.platform) || /Win/.test(navigator.userAgent);


// ─── Viewport ─────────────────────────────────────────────────────────────────

let panX = 0, panY = 0, zoom = 1;

let _vpSaveTimer = null;
function saveViewport() {
  clearTimeout(_vpSaveTimer);
  _vpSaveTimer = setTimeout(() => {
    localStorage.setItem('bf_vp', JSON.stringify({ panX, panY, zoom }));
  }, 400);
}


let _lastZoomPct = -1;
function updateZoomDisplay() {
  const pct = Math.round(zoom * 100);
  if (pct === _lastZoomPct) return;
  _lastZoomPct = pct;
  islZoom.textContent = pct + '%';
}

let _islMsgTimer = null;

function showIslandMsg(msg, duration = 0) {
  clearTimeout(_islMsgTimer);
  islZoom.style.color = 'rgba(255,255,255,0)';
  setTimeout(() => {
    islZoom.textContent = msg;
    islZoom.style.color = 'rgba(255,255,255,0.38)';
    if (duration > 0) {
      _islMsgTimer = setTimeout(() => restoreIslandZoom(), duration);
    }
  }, 500);
}

function restoreIslandZoom() {
  islZoom.style.color = 'rgba(255,255,255,0)';
  setTimeout(() => {
    _lastZoomPct = -1;
    updateZoomDisplay();
    islZoom.style.color = 'rgba(255,255,255,0.38)';
  }, 500);
}


const FONT_SIZE = 16;
const LINE_H    = 24;
const TEXT_PAD  = 4;
const NEW_TEXT_EDIT_MIN_LINES = 3;
const FONT      = `${FONT_SIZE}px 'Geist', 'Geist Sans', Inter, -apple-system, 'Segoe UI', system-ui, sans-serif`;

const _measureCanvas = document.createElement('canvas');
const _measureCtx = _measureCanvas.getContext('2d');
_measureCtx.font = FONT;
const _mwCache = Object.create(null);
function measureTextW(text) {
  if (text in _mwCache) return _mwCache[text];
  _measureCtx.font = FONT;
  return (_mwCache[text] = _measureCtx.measureText(text).width);
}

function clearTextMeasurementCaches() {
  for (const k of Object.keys(_mwCache)) delete _mwCache[k];
  _linesCacheMap.clear();
  _prefixCache.clear();
  for (const obj of objects) delete obj._layoutCache;
  syncAllTextAutoHeights();
  invalidateOffscreen();
  scheduleRender(true, true);
}

// ─── Offscreen buffer ─────────────────────────────────────────────────────────

const _offscreen = document.createElement('canvas');
const _offCtx    = _offscreen.getContext('2d');
let _offscreenDirty = true;
function invalidateOffscreen() {
  _offscreenDirty = true;
}

// External line layout cache: id -> {content, w, lines: [{text, startIndex}]}
// Auto-invalidates on content/width change; never serialized with objects.
const _linesCacheMap = new Map();

// Prefix-width cache: line text -> Float64Array of prefix widths [0, w0, w0+w1, ...]
// Computed once per unique line string; avoids O(n²) slice allocations on every frame.
const _prefixCache = new Map();
function getPrefixWidths(text) {
  const hit = _prefixCache.get(text);
  if (hit) return hit;
  const pw = new Float64Array(text.length + 1);
  for (let k = 0; k < text.length; k++) {
    pw[k + 1] = measureTextW(text.slice(0, k + 1));
  }
  _prefixCache.set(text, pw);
  return pw;
}

// ─── History delta tracking ───────────────────────────────────────────────────

const _dirtyIds = new Set();
function markDirty(id) { _dirtyIds.add(id); }

// ─── Canvas resize ────────────────────────────────────────────────────────────

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  boardCanvas.width  = Math.round(window.innerWidth  * dpr);
  boardCanvas.height = Math.round(window.innerHeight * dpr);
  invalidateOffscreen();
  scheduleRender(true, false);
}

// Wraps obj.data.content into lines with character-index tracking.
// Cached by (id, content, w) — auto-invalidates on any change, never hits JSON.stringify.
// Returns [{text: string, startIndex: number}]
function getWrappedLines(obj) {
  const cached = _linesCacheMap.get(obj.id);
  if (cached && cached.content === obj.data.content && cached.w === obj.w) return cached.lines;

  const maxW = obj.w - TEXT_PAD * 2;
  const result = [];
  const paragraphs = obj.data.content.split('\n');
  let paraStart = 0;
  const spaceW = measureTextW(' ');

  for (const para of paragraphs) {
    if (!para) {
      result.push({ text: '', startIndex: paraStart });
      paraStart++;
      continue;
    }
    const words = para.split(' ');
    // Prefix sums: pw[i] = width of words[0..i) joined with spaces
    const pw = new Array(words.length + 1);
    pw[0] = 0;
    for (let i = 0; i < words.length; i++) {
      pw[i + 1] = pw[i] + (i > 0 ? spaceW : 0) + measureTextW(words[i]);
    }
    // Width of words[s..e) joined with spaces (O(1), no allocation)
    const rangeW = (s, e) => pw[e] - pw[s] - (s > 0 ? spaceW : 0);

    let s = 0, withinPara = 0;
    while (s < words.length) {
      let lineText;
      if (rangeW(s, words.length) <= maxW) {
        lineText = words.slice(s).join(' '); s = words.length;
      } else if (pw[s + 1] - pw[s] > maxW) {
        lineText = words[s]; s++;
      } else {
        let lo = 1, hi = words.length - s - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          rangeW(s, s + mid) <= maxW ? lo = mid : hi = mid - 1;
        }
        lineText = words.slice(s, s + lo).join(' '); s += lo;
      }
      result.push({ text: lineText, startIndex: paraStart + withinPara });
      withinPara += lineText.length + 1;
    }
    paraStart += para.length + 1;
  }

  _linesCacheMap.set(obj.id, { content: obj.data.content, w: obj.w, lines: result });
  return result;
}

function getTextAutoHeight(obj, minLines = 1) {
  return Math.max(minLines * LINE_H + TEXT_PAD * 2, getWrappedLines(obj).length * LINE_H + TEXT_PAD * 2);
}

function syncTextAutoHeight(obj, minLines = 1) {
  if (!obj || obj.type !== 'text') return false;
  const h = getTextAutoHeight(obj, minLines);
  if (obj.h === h) return false;
  obj.h = h;
  return true;
}

function getTextMinLines(obj) {
  return obj && obj.id === editingId ? (obj._editMinLines || 1) : 1;
}

function syncAllTextAutoHeights() {
  let changed = false;
  for (const obj of objects) {
    if (syncTextAutoHeight(obj)) {
      markDirty(obj.id);
      changed = true;
    }
  }
  return changed;
}

// Per-line layout for the editing object (world coords).
// Prefix widths keep caret positions aligned with rendered glyphs without
// allocating one object per character.
// Each entry: { text, startIndex, y, prefixWidths }
function calculateTextLayout(obj) {
  const lines = getWrappedLines(obj);
  return lines.map((line, i) => {
    const y = obj.y + TEXT_PAD + i * LINE_H;
    return { text: line.text, startIndex: line.startIndex, y, prefixWidths: getPrefixWidths(line.text) };
  });
}

function getTextLayout(obj) {
  if (obj._layoutCache) return obj._layoutCache;
  obj._layoutCache = calculateTextLayout(obj);
  return obj._layoutCache;
}

function lineXAtOffset(line, obj, offset) {
  return obj.x + TEXT_PAD + line.prefixWidths[Math.max(0, Math.min(offset, line.text.length))];
}

function lineEndX(line, obj) {
  return lineXAtOffset(line, obj, line.text.length);
}

function layoutHitTest(layout, wx, wy, obj) {
  if (!layout.length) return 0;
  let line = layout[layout.length - 1];
  for (let i = 0; i < layout.length; i++) {
    if (wy < layout[i].y + LINE_H) { line = layout[i]; break; }
  }
  if (!line.text.length) return line.startIndex;
  const baseX = obj.x + TEXT_PAD;
  const pw = line.prefixWidths;
  for (let j = 0; j < line.text.length; j++) {
    if (wx < baseX + pw[j] + (pw[j + 1] - pw[j]) / 2) return line.startIndex + j;
  }
  return line.startIndex + line.text.length;
}

// Draws a single non-editing object onto any canvas context (world coords).
function drawSingleObj(context, obj) {
  if (obj.type === 'text') {
    context.fillStyle = '#ffffff';
    const lines = getWrappedLines(obj);
    for (let i = 0; i < lines.length; i++) {
      context.fillText(lines[i].text, obj.x + TEXT_PAD, obj.y + TEXT_PAD + i * LINE_H);
    }
  } else if (obj.type === 'image') {
    const img = imageCache[obj.data.imgKey];
    if (img && img.complete && img.naturalWidth > 0) {
      const flipX = !!obj.data.flipX;
      const flipY = !!obj.data.flipY;
      if (flipX || flipY) {
        context.save();
        context.translate(obj.x + (flipX ? obj.w : 0), obj.y + (flipY ? obj.h : 0));
        context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        context.drawImage(img, 0, 0, obj.w, obj.h);
        context.restore();
      } else {
        context.drawImage(img, obj.x, obj.y, obj.w, obj.h);
      }
    }
  }
}


function drawBoard() {
  const dpr = window.devicePixelRatio || 1;

  if (editingId) {
    // Rebuild offscreen (all non-editing objects) only when dirty
    if (_offscreenDirty) {
      _offscreen.width  = boardCanvas.width;
      _offscreen.height = boardCanvas.height;
      _offCtx.setTransform(1, 0, 0, 1, 0, 0);
      _offCtx.fillStyle = '#1c1c1e';
      _offCtx.fillRect(0, 0, _offscreen.width, _offscreen.height);
      _offCtx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
      _offCtx.font = FONT;
      _offCtx.textBaseline = 'top';
      for (const obj of objects) {
        if (obj.id === editingId) continue;
        drawSingleObj(_offCtx, obj);
      }
      _offCtx.setTransform(1, 0, 0, 1, 0, 0);
      _offscreenDirty = false;
    }

    // Blit offscreen (background + all other objects)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(_offscreen, 0, 0);

    // Draw editing object on top
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
    const obj = objectsMap.get(editingId);
    if (obj && obj.type === 'text') {
      ctx.font = FONT;
      ctx.textBaseline = 'top';

      const selStart = _editEl ? _editEl.selectionStart : 0;
      const selEnd   = _editEl ? _editEl.selectionEnd   : 0;
      const layout = getTextLayout(obj);

      // Selection highlight
      if (selStart !== selEnd) {
        ctx.fillStyle = 'rgba(10, 132, 255, 0.3)';
        for (const line of layout) {
          const ls = line.startIndex, le = ls + line.text.length;
          const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, le);
          if (h0 < h1) {
            const o0 = h0 - ls, o1 = h1 - ls;
            const endX = lineEndX(line, obj);
            const x1 = o0 < line.text.length ? lineXAtOffset(line, obj, o0) : endX;
            const x2 = o1 < line.text.length ? lineXAtOffset(line, obj, o1) : endX;
            ctx.fillRect(x1, line.y - (IS_WIN ? 5 : 1), x2 - x1, LINE_H);
          }
        }
      }

      // Text
      ctx.fillStyle = '#ffffff';
      for (const line of layout) ctx.fillText(line.text, obj.x + TEXT_PAD, line.y);

      // Caret
      if (selStart === selEnd && _caretVisible) {
        let cx = obj.x + TEXT_PAD, cy = obj.y + TEXT_PAD;
        for (const line of layout) {
          const ls = line.startIndex, le = ls + line.text.length;
          if (selStart >= ls && selStart <= le) {
            const off = selStart - ls;
            cx = off < line.text.length ? lineXAtOffset(line, obj, off) : lineEndX(line, obj);
            cy = line.y;
            break;
          }
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx, cy - (IS_WIN ? 5 : 1), 2 / zoom, LINE_H);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1c1c1e';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    for (const obj of objects) {
      drawSingleObj(ctx, obj);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function hitTest(wx, wy) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (wx >= obj.x && wx <= obj.x + obj.w && wy >= obj.y && wy <= obj.y + obj.h) return obj;
  }
  return null;
}

function applyTransform() {
  if (editingId) invalidateOffscreen();
  drawBoard();
  updateZoomDisplay();
  saveViewport();
  updateSelectionOverlay();
}

function toWorld(sx, sy) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

let _frameRaf = null;
let _needTransform = false;
let _needBoardRender = false;
let _needOverlayRender = false;

function scheduleFrame() {
  if (_frameRaf) return;
  _frameRaf = requestAnimationFrame(() => {
    _frameRaf = null;
    const doTransform = _needTransform;
    const doBoard = _needBoardRender;
    const doOverlay = _needOverlayRender;
    _needTransform = false;
    _needBoardRender = false;
    _needOverlayRender = false;

    if (doTransform) {
      applyTransform();
      return;
    }
    if (doBoard) drawBoard();
    if (doOverlay) updateSelectionOverlay();
  });
}

function scheduleTransform() {
  _needTransform = true;
  scheduleFrame();
}

function scheduleRender(board = true, overlay = true) {
  if (board) _needBoardRender = true;
  if (overlay) _needOverlayRender = true;
  scheduleFrame();
}



// ─── Object state ─────────────────────────────────────────────────────────────

let zCounter = 1;
let selectedId = null;
const selectedIds = new Set();
let editingId  = null;
let objects    = [];
const objectsMap = new Map();
let idCounter  = 1;

function rebuildObjectsMap() {
  objectsMap.clear();
  for (const obj of objects) objectsMap.set(obj.id, obj);
}

function newId() { return 'obj-' + (idCounter++); }

function cloneObject(obj) {
  const data = obj.type === 'image'
    ? { imgKey: obj.data.imgKey, flipX: !!obj.data.flipX, flipY: !!obj.data.flipY }
    : { content: obj.data.content };
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
  const clones = new Array(list.length);
  for (let i = 0; i < list.length; i++) clones[i] = cloneObject(list[i]);
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
  pushHistory();
}

function flipSelectedImages(axis) {
  let flipped = false;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'image') continue;
    if (axis === 'x') obj.data.flipX = !obj.data.flipX;
    else obj.data.flipY = !obj.data.flipY;
    markDirty(obj.id);
    flipped = true;
  }
  if (!flipped) return;
  invalidateOffscreen();
  scheduleRender(true, true);
  pushHistory();
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

function allSelectedAreImages() {
  if (!selectedIds.size) return false;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'image') return false;
  }
  return true;
}

// ─── Image store (keeps base64 data OUT of history snapshots) ─────────────────

const imageStore = {};
const imageCache = {}; // key -> HTMLImageElement (decoded, ready for drawImage)
let imgKeyCounter = 1;

function storeImage(src) {
  const key = 'img-' + (imgKeyCounter++);
  imageStore[key] = src;
  cacheImage(key, src);
  // Pre-cache in Rust immediately for newly imported images so first copy is instant.
  if (window.__TAURI__) {
    window.__TAURI__.core.invoke('cache_image_for_clipboard', { imgKey: key, dataUrl: src })
      .catch(() => {});
  }
  return key;
}

function getImageSrc(obj) { return imageStore[obj.data.imgKey] || ''; }

function imageNeedsRendering(obj) {
  return !!(obj?.data?.flipX || obj?.data?.flipY);
}

function renderImageToCanvas(obj) {
  const img = imageCache[obj.data.imgKey];
  if (!img || !img.complete || !img.naturalWidth) return null;
  const tmp = document.createElement('canvas');
  tmp.width = img.naturalWidth;
  tmp.height = img.naturalHeight;
  const tctx = tmp.getContext('2d');
  const flipX = !!obj.data.flipX;
  const flipY = !!obj.data.flipY;
  tctx.save();
  tctx.translate(flipX ? tmp.width : 0, flipY ? tmp.height : 0);
  tctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  tctx.drawImage(img, 0, 0);
  tctx.restore();
  return tmp;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function getRenderedImageDataUrl(obj) {
  const src = getImageSrc(obj);
  if (!src || !imageNeedsRendering(obj)) return src;
  const canvas = renderImageToCanvas(obj);
  return canvas ? canvas.toDataURL('image/png') : '';
}

function cacheImage(key, src) {
  if (imageCache[key]) return;
  const img = new Image();
  img.onload = () => { invalidateOffscreen(); scheduleRender(true, false); };
  img.src = src;
  imageCache[key] = img;
}

function clearImageStore() {
  for (const k of Object.keys(imageStore)) delete imageStore[k];
  for (const k of Object.keys(imageCache)) delete imageCache[k];
  imgKeyCounter = 1;
  if (window.__TAURI__) {
    window.__TAURI__.core
      .invoke('clear_clipboard_image_cache')
      .catch((err) => console.warn('[clipboard-cache] clear_clipboard_image_cache failed:', err));
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

function trimHistory() {
  if (history.length > MAX_HISTORY) {
    const trim = history.length - MAX_HISTORY;
    history.splice(0, trim);
    historyIndex = Math.max(-1, historyIndex - trim);
    savedHistoryIndex = Math.max(-1, savedHistoryIndex - trim);
  }
}

function snapshot() {
  history.length = historyIndex + 1;
  const objectsSnapshot = cloneObjects(objects);
  const editState = captureEditState();
  history.push({
    objects: objectsSnapshot,
    editState,
  });
  historyIndex = history.length - 1;
  _dirtyIds.clear();
  trimHistory();
}

// Delta push: only deep-clones objects that changed since last snapshot.
// Unchanged objects share the previous snapshot's reference (safe since
// restoreSnapshot always deep-clones before mutating).
function pushHistory() {
  history.length = historyIndex + 1;
  const prevEntry = historyIndex >= 0 ? history[historyIndex] : [];
  const prevObjects = Array.isArray(prevEntry) ? prevEntry : (prevEntry.objects || []);
  const prevMap = new Map();
  for (const o of prevObjects) prevMap.set(o.id, o);
  const entry = objects.map(o =>
    (_dirtyIds.has(o.id) || !prevMap.has(o.id))
      ? cloneObject(o)
      : prevMap.get(o.id)
  );
  _dirtyIds.clear();
  const editState = captureEditState();
  history.push({
    objects: entry,
    editState,
  });
  historyIndex++;
  trimHistory();
  updateTitle();
}

function restoreSnapshot(s) {
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
  const prevSelectedIds = new Set(selectedIds);
  const snapshotObjects = Array.isArray(s) ? s : (s?.objects || []);
  const editState = Array.isArray(s) ? null : (s?.editState || null);
  objects = cloneObjects(snapshotObjects);
  _dirtyIds.clear();
  _linesCacheMap.clear();
  _prefixCache.clear();
  rebuildObjectsMap();
  syncAllTextAutoHeights();
  invalidateOffscreen();
  // Preserve selection for objects that still exist in the restored state
  selectedId = null;
  selectedIds.clear();
  for (const id of prevSelectedIds) {
    if (objectsMap.has(id)) { selectedIds.add(id); selectedId = id; }
  }
  renderAll();

  if (!editState || !editState.id) return;
  const obj = objectsMap.get(editState.id);
  if (!obj || obj.type !== 'text') return;

  selectedId = obj.id;
  selectedIds.clear();
  selectedIds.add(obj.id);
  enterEdit(obj.id);

  if (!_editEl) return;
  const max = _editEl.value.length;
  const start = Math.max(0, Math.min(editState.selectionStart ?? max, max));
  const end = Math.max(0, Math.min(editState.selectionEnd ?? max, max));
  _editEl.setSelectionRange(start, end, editState.selectionDirection || 'none');
  _caretVisible = true;
  scheduleRender(true, true);
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
  historyIndex--;
  restoreSnapshot(history[historyIndex]);
  updateTitle();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restoreSnapshot(history[historyIndex]);
  updateTitle();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  scheduleRender(true, true);
}


// ─── Screen-space selection overlay ──────────────────────────────────────────

const _selOverlayStyleState = { transform: '', width: '', height: '' };
const _multiSelBoxes = [];
const _multiSelStyleState = new WeakMap();
const _rubberBandStyleState = { display: '', left: '', top: '', width: '', height: '' };

function _setStyleIfChanged(el, prop, value, state) {
  if (state[prop] === value) return;
  state[prop] = value;
  el.style[prop] = value;
}

function _setMultiBoxDisplayIfChanged(el, value) {
  let state = _multiSelStyleState.get(el);
  if (!state) {
    state = { display: '', transform: '', width: '', height: '' };
    _multiSelStyleState.set(el, state);
  }
  _setStyleIfChanged(el, 'display', value, state);
  return state;
}

function hideMultiSelectionOverlay() {
  if (!multiSelOverlay) return;
  if (multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.remove('visible');
  for (const box of _multiSelBoxes) _setMultiBoxDisplayIfChanged(box, 'none');
}

function updateMultiSelectionOverlay() {
  if (!multiSelOverlay || !isMultiSelected()) {
    hideMultiSelectionOverlay();
    return;
  }

  while (_multiSelBoxes.length < selectedIds.size) {
    const box = document.createElement('div');
    box.className = 'multi-sel-box';
    _multiSelBoxes.push(box);
    _multiSelStyleState.set(box, { display: '', transform: '', width: '', height: '' });
    multiSelOverlay.appendChild(box);
  }

  let selectedIdx = 0;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    const box = _multiSelBoxes[selectedIdx++];
    const state = _setMultiBoxDisplayIfChanged(box, 'block');
    _setStyleIfChanged(box, 'transform', `translate(${obj.x * zoom + panX}px,${obj.y * zoom + panY}px)`, state);
    _setStyleIfChanged(box, 'width', (obj.w * zoom) + 'px', state);
    _setStyleIfChanged(box, 'height', (obj.h * zoom) + 'px', state);
  }

  for (let i = selectedIdx; i < _multiSelBoxes.length; i++) {
    _setMultiBoxDisplayIfChanged(_multiSelBoxes[i], 'none');
  }

  if (!multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.add('visible');
}

function updateSelectionOverlay() {
  if (!hasSelection()) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    return;
  }

  const firstSelectedObj = getFirstSelectedObject();
  if (!firstSelectedObj) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    selectedId = null;
    selectedIds.clear();
    return;
  }

  // Compute bounding box (works for both single and multi-select)
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (!o) continue;
    bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
    bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
  }

  const sx = bx1 * zoom + panX;
  const sy = by1 * zoom + panY;
  const sw = (bx2 - bx1) * zoom;
  const sh = (by2 - by1) * zoom;

  _setStyleIfChanged(selOverlay, 'transform', `translate(${sx}px,${sy}px)`, _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'width', sw + 'px', _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'height', sh + 'px', _selOverlayStyleState);
  if (isMultiSelected()) {
    if (!selOverlay.classList.contains('multi')) selOverlay.classList.add('multi');
  } else {
    if (selOverlay.classList.contains('multi')) selOverlay.classList.remove('multi');
  }
  if (editingId) {
    if (!selOverlay.classList.contains('editing')) selOverlay.classList.add('editing');
  } else {
    if (selOverlay.classList.contains('editing')) selOverlay.classList.remove('editing');
  }
  if (!isMultiSelected() && firstSelectedObj.type === 'text') {
    if (!selOverlay.classList.contains('text-resize')) selOverlay.classList.add('text-resize');
  } else {
    if (selOverlay.classList.contains('text-resize')) selOverlay.classList.remove('text-resize');
  }
  updateMultiSelectionOverlay();
  if (!selOverlay.classList.contains('visible')) selOverlay.classList.add('visible');
}

// Init overlay handle listeners once — they always operate on selectedId / selectedIds
(function initOverlayHandles() {
  for (const handle of selOverlay.querySelectorAll('.s-handle')) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;

      // ── Multi-select: scale non-text objects proportionally within bounding box ──
      if (isMultiSelected()) {
        let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o) continue;
          bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
          bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
        }
        const origBX = bx1, origBY = by1, origBW = bx2 - bx1, origBH = by2 - by1;
        const ratio = origBW / origBH;

        const snapshots = [];
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o || o.type === 'text') continue;
          snapshots.push({
            id,
            relX: (o.x - origBX) / origBW, relY: (o.y - origBY) / origBH,
            relW: o.w / origBW, relH: o.h / origBH,
          });
        }
        if (!snapshots.length) return;

        const MIN_B = 20;
        let resizeRaf = null, hasPendingResize = false, pendingState = null;

        function applyMultiResize({ bx, by, bw, bh }) {
          for (const snap of snapshots) {
            const o = objectsMap.get(snap.id);
            if (!o) continue;
            o.x = bx + snap.relX * bw; o.y = by + snap.relY * bh;
            o.w = snap.relW * bw; o.h = snap.relH * bh;
          }
          scheduleRender(true, true);
        }

        function scheduleMultiResizeFrame() {
          if (resizeRaf) return;
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = null;
            if (!hasPendingResize) return;
            hasPendingResize = false;
            applyMultiResize(pendingState);
          });
        }

        function onMultiMove(ev) {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          const useX = Math.abs(dx) >= Math.abs(dy);
          let bw = origBW, bh = origBH, bx = origBX, by = origBY;

          if (dir === 'se') { bw = Math.max(MIN_B, useX ? origBW + dx : (origBH + dy) * ratio); }
          else if (dir === 'sw') { bw = Math.max(MIN_B, useX ? origBW - dx : (origBH + dy) * ratio); }
          else if (dir === 'ne') { bw = Math.max(MIN_B, useX ? origBW + dx : (origBH - dy) * ratio); }
          else if (dir === 'nw') { bw = Math.max(MIN_B, useX ? origBW - dx : (origBH - dy) * ratio); }
          bh = bw / ratio;

          if (dir.includes('w')) bx = origBX + origBW - bw;
          if (dir.includes('n')) by = origBY + origBH - bh;

          pendingState = { bx, by, bw, bh };
          hasPendingResize = true;
          scheduleMultiResizeFrame();
        }

        function onMultiUp() {
          document.removeEventListener('mousemove', onMultiMove);
          document.removeEventListener('mouseup', onMultiUp);
          if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = null; }
          if (hasPendingResize) { hasPendingResize = false; applyMultiResize(pendingState); }
          for (const snap of snapshots) markDirty(snap.id);
          pushHistory();
        }

        document.addEventListener('mousemove', onMultiMove);
        document.addEventListener('mouseup', onMultiUp);
        return;
      }

      // ── Single select ──
      if (!selectedId) return;
      const obj = objectsMap.get(selectedId);
      if (!obj) return;

      const { x: ox, y: oy, w: ow, h: oh } = obj;
      const MIN = 20;
      let resizeRaf = null;
      let hasPendingResize = false;
      let pendingResize = { x: ox, y: oy, w: ow, h: oh };

      function applyResize(state) {
        obj.x = state.x;
        obj.y = state.y;
        obj.w = state.w;
        obj.h = state.h;
        if (obj.type === 'text') {
          delete obj._layoutCache;
          syncTextAutoHeight(obj, getTextMinLines(obj));
        }
        scheduleRender(true, true);
      }

      function scheduleResizeFrame() {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          if (!hasPendingResize) return;
          hasPendingResize = false;
          applyResize(pendingResize);
        });
      }

      function onMove(ev) {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let x = ox, y = oy, w = ow, h = oh;

        if (obj.type === 'image') {
          const ratio = ow / oh;
          const useX = Math.abs(dx) >= Math.abs(dy);
          if (dir.includes('e') && dir.includes('s')) { w = Math.max(MIN, useX ? ow + dx : (oh + dy) * ratio); }
          else if (dir.includes('w') && dir.includes('s')) { w = Math.max(MIN, useX ? ow - dx : (oh + dy) * ratio); }
          else if (dir.includes('e') && dir.includes('n')) { w = Math.max(MIN, useX ? ow + dx : (oh - dy) * ratio); }
          else if (dir.includes('w') && dir.includes('n')) { w = Math.max(MIN, useX ? ow - dx : (oh - dy) * ratio); }
          h = w / ratio;
          if (dir.includes('w')) x = ox + ow - w;
          if (dir.includes('n')) y = oy + oh - h;
        } else {
          if (dir.includes('e')) w = Math.max(MIN, ow + dx);
          h = oh;
          if (dir.includes('w')) { w = Math.max(MIN, ow - dx); x = ox + ow - w; }
        }

        pendingResize = { x, y, w, h };
        hasPendingResize = true;
        scheduleResizeFrame();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (resizeRaf) {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = null;
        }
        if (hasPendingResize) {
          hasPendingResize = false;
          applyResize(pendingResize);
        }
        markDirty(obj.id);
        pushHistory();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
})();


// ─── Selection ────────────────────────────────────────────────────────────────

function selectObject(id) {
  if (editingId && editingId !== id) exitEdit();
  selectedIds.clear();
  selectedIds.add(id);
  selectedId = id;
  const obj = objectsMap.get(id);
  if (obj) {
    bringObjectToFront(id);
    markDirty(id);
    obj.z = ++zCounter;
  }
  scheduleRender(true, true);
}

function deselectAll() {
  if (editingId) exitEdit();
  selectedId = null;
  selectedIds.clear();
  scheduleRender(false, true);
}

function selectAllObjects() {
  if (editingId || !objects.length) return;
  selectedIds.clear();
  for (const obj of objects) selectedIds.add(obj.id);
  selectedId = objects[objects.length - 1].id;
  scheduleRender(false, true);
}

function hideMenus() {
  ctxMenu.classList.remove('visible');
  objCtxMenu.classList.remove('visible');
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

function pushEditHistoryIfChanged(id) {
  const obj = objectsMap.get(id);
  if (!obj) return;
  if (_editHistoryLastContent === null) _editHistoryLastContent = obj.data.content;
  if (obj.data.content === _editHistoryLastContent) return;
  markDirty(id);
  pushHistory();
  _editHistoryLastContent = obj.data.content;
}

function scheduleEditHistoryCheckpoint(id) {
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = setTimeout(() => {
    _editHistoryTimer = null;
    pushEditHistoryIfChanged(id);
  }, EDIT_HISTORY_DEBOUNCE_MS);
}


function enterEdit(id) {
  if (editingId === id) return;
  if (editingId) exitEdit();
  editingId = id;

  const obj = objectsMap.get(id);
  if (!obj) return;
  obj._editStartContent = obj.data.content;
  obj._editMinLines = obj.data.content ? 1 : NEW_TEXT_EDIT_MIN_LINES;
  syncTextAutoHeight(obj, obj._editMinLines);
  _editHistoryLastContent = obj.data.content;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;

  const proxy = document.createElement('textarea');
  proxy.id = 'editor-proxy';
  proxy.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;';
  proxy.value = obj.data.content;
  document.body.appendChild(proxy);
  _editEl = proxy;

  proxy.addEventListener('input', () => {
    markDirty(id);
    obj.data.content = proxy.value;
    delete obj._layoutCache;
    const heightChanged = syncTextAutoHeight(obj, obj._editMinLines || 1);
    scheduleEditHistoryCheckpoint(id);
    scheduleRender(true, heightChanged);
  });
  proxy.addEventListener('keydown', (e) => {
    _caretVisible = true;

    // The 1px-wide proxy treats all content as a single column, so the browser's
    // own up/down logic navigates char-by-char instead of line-by-line. Intercept
    // and compute line navigation from the canvas layout instead.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const layout = getTextLayout(obj);
      if (!layout.length) { scheduleRender(true, false); return; }

      const isUp = e.key === 'ArrowUp';

      // Which end of the selection to navigate from
      let refPos;
      if (e.shiftKey) {
        const d = proxy.selectionDirection;
        refPos = d === 'backward' ? proxy.selectionStart : proxy.selectionEnd;
      } else {
        refPos = isUp ? proxy.selectionStart : proxy.selectionEnd;
      }

      // Find the line containing refPos
      let refLineIdx = layout.length - 1;
      for (let i = 0; i < layout.length; i++) {
        const ln = layout[i];
        if (refPos >= ln.startIndex && refPos <= ln.startIndex + ln.text.length) {
          refLineIdx = i; break;
        }
      }
      const refLine = layout[refLineIdx];

      // Caret world-x in the reference line
      const off = refPos - refLine.startIndex;
      const caretX = lineXAtOffset(refLine, obj, off);

      // Find nearest position in the target line
      const targetIdx = isUp ? refLineIdx - 1 : refLineIdx + 1;
      let newPos;
      if (targetIdx < 0) {
        newPos = 0;
      } else if (targetIdx >= layout.length) {
        newPos = proxy.value.length;
      } else {
        newPos = layoutHitTest([layout[targetIdx]], caretX, layout[targetIdx].y, obj);
      }

      if (e.shiftKey) {
        const d = proxy.selectionDirection;
        const anchorPos = d === 'backward' ? proxy.selectionEnd : proxy.selectionStart;
        proxy.setSelectionRange(
          Math.min(anchorPos, newPos), Math.max(anchorPos, newPos),
          anchorPos <= newPos ? 'forward' : 'backward'
        );
      } else {
        proxy.setSelectionRange(newPos, newPos);
      }

      scheduleRender(true, false);
      return;
    }

    scheduleRender(true, false);
  });

  _selChangeListener = () => {
    if (document.activeElement === proxy) { _caretVisible = true; scheduleRender(true, false); }
  };
  document.addEventListener('selectionchange', _selChangeListener);

  _caretVisible = true;
  _caretBlinkInterval = setInterval(() => {
    _caretVisible = !_caretVisible;
    if (editingId) scheduleRender(true, false);
  }, 500);

  // Offscreen is now stale: it was built with this object; now we exclude it
  invalidateOffscreen();

  proxy.focus({ preventScroll: true });
  proxy.setSelectionRange(proxy.value.length, proxy.value.length);
  scheduleRender(true, true);
}

function exitEdit() {
  if (!editingId) return;
  const id = editingId;
  const proxy = _editEl;
  editingId = null;
  _editEl = null;

  clearInterval(_caretBlinkInterval);
  _caretBlinkInterval = null;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  if (_selChangeListener) {
    document.removeEventListener('selectionchange', _selChangeListener);
    _selChangeListener = null;
  }

  if (proxy) proxy.remove();

  invalidateOffscreen();

  const obj = objectsMap.get(id);
  if (obj) {
    if (obj.data.content.trim() === '') {
      const idx = objects.findIndex((o) => o.id === id);
      if (idx >= 0) objects.splice(idx, 1);
      objectsMap.delete(id);
      _linesCacheMap.delete(id);
      selectedIds.delete(id);
      selectedId = null;
      delete obj._editStartContent;
      delete obj._editMinLines;
      _editHistoryLastContent = null;
      scheduleRender(true, true);
      pushHistory();
      return;
    }
    delete obj._layoutCache;
    const heightChanged = syncTextAutoHeight(obj);
    if (heightChanged) markDirty(id);
    const contentChanged = obj.data.content !== _editHistoryLastContent;
    pushEditHistoryIfChanged(id);
    if (heightChanged && !contentChanged) pushHistory();
    delete obj._editStartContent;
    delete obj._editMinLines;
  }

  _editHistoryLastContent = null;
  scheduleRender(true, true);
  window.getSelection()?.removeAllRanges();
}

// ─── Add objects ─────────────────────────────────────────────────────────────

function addText(wx, wy, content = '') {
  let w = 200, h = content ? LINE_H + TEXT_PAD * 2 : NEW_TEXT_EDIT_MIN_LINES * LINE_H + TEXT_PAD * 2;
  if (content) {
    const lines = content.split('\n');
    const charW = 9.2, pad = 8;
    const maxLineLen = Math.max(...lines.map(l => l.length), 1);
    w = Math.min(Math.max(Math.round(maxLineLen * charW + pad * 2), 120), 700);
  }

  const obj = { id: newId(), type: 'text', x: wx, y: wy, w, h, z: ++zCounter, data: { content } };
  syncTextAutoHeight(obj, content ? 1 : NEW_TEXT_EDIT_MIN_LINES);
  objects.push(obj);
  objectsMap.set(obj.id, obj);
  selectObject(obj.id);
  scheduleRender(true, false);
  pushHistory();
  if (!content) enterEdit(obj.id);
}

function addImage(src, cx, cy, exactSize = false) {
  const img = new Image();
  img.onload = () => {
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!exactSize) {
      const MAX = 600;
      if (w > MAX || h > MAX) {
        const scale = MAX / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
    }
    const imgKey = storeImage(src);
    const obj = { id: newId(), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, z: ++zCounter, data: { imgKey } };
    objects.push(obj);
    objectsMap.set(obj.id, obj);
    selectObject(obj.id);
    scheduleRender(true, false);
    pushHistory();
  };
  img.src = src;
}

// ─── New board ───────────────────────────────────────────────────────────────

async function newBoard() {
  if (objects.length === 0 && !currentFilePath) return;
  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') { const saved = await saveBoard(); if (!saved) return; }
  }
  if (editingId) exitEdit();
  selectedId = null;
  selectedIds.clear();
  objects = [];
  objectsMap.clear();
  _linesCacheMap.clear();
  _prefixCache.clear();
  invalidateOffscreen();
  currentFilePath = null;
  panX = 0; panY = 0; zoom = 1;
  clearImageStore();
  history = []; historyIndex = -1;
  idCounter = 1; zCounter = 1;
  applyTransform();
  snapshot();
  markSaved();
  updateTitle();
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

function duplicateSelected() {
  if (!selectedIds.size) return;
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  const cloned = [];
  const imageData = {};
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    const o = cloneObject(obj);
    if (o.type === 'image') {
      const src = imageStore[o.data.imgKey];
      if (src) imageData[o.data.imgKey] = src;
    }
    cloned.push(o);
  }
  if (!cloned.length) return;
  jsClipboard = { type: 'objects', objects: cloned, imageData };
  _jsClipboardSetAt = Date.now();
  _jsCbFingerprint = 'skip';
  _blurredSinceCopy = false;
  pasteAtPos(center.x, center.y);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!hasSelection() || editingId) return;
  let write = 0;
  for (let read = 0; read < objects.length; read++) {
    const obj = objects[read];
    if (selectedIds.has(obj.id)) {
      objectsMap.delete(obj.id);
      _linesCacheMap.delete(obj.id);
      continue;
    }
    objects[write++] = obj;
  }
  objects.length = write;
  selectedId = null;
  selectedIds.clear();
  scheduleRender(true, true);
  pushHistory();
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.05, ZOOM_MAX = 10;

let _editEl = null;
let _caretVisible = true;
let _caretBlinkInterval = null;
let _selChangeListener = null;
let _editHistoryTimer = null;
let _editHistoryLastContent = null;
const EDIT_HISTORY_DEBOUNCE_MS = 500;


canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (editingId) {
    _caretVisible = true;
  }
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.abs(e.deltaY) < 30
      ? Math.pow(0.995, e.deltaY)
      : e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    panX = e.clientX - (e.clientX - panX) * (newZoom / zoom);
    panY = e.clientY - (e.clientY - panY) * (newZoom / zoom);
    zoom = newZoom;
    scheduleTransform();
    return;
  }

  panX -= e.deltaX;
  panY -= e.deltaY;
  scheduleTransform();
}, { passive: false });

// ─── Pan (middle mouse button) ────────────────────────────────────────────────

canvas.addEventListener('mousedown', (e) => {
  // Middle mouse: pan
  if (e.button === 1) {
    e.preventDefault();
    e.stopPropagation();
    canvas.classList.add('panning');
    const startX = e.clientX, startY = e.clientY;
    const startPanX = panX, startPanY = panY;
    function onMove(ev) { panX = startPanX + (ev.clientX - startX); panY = startPanY + (ev.clientY - startY); scheduleTransform(); }
    function onUp(ev) { if (ev.button !== 1) return; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); canvas.classList.remove('panning'); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return;
  }

  if (e.button !== 0) return;

  // Don't capture clicks on sel-overlay handles
  if (e.target !== canvas && e.target !== boardCanvas) return;

  e.preventDefault();
  const wp = toWorld(e.clientX, e.clientY);
  const obj = hitTest(wp.x, wp.y);
  const additive = e.metaKey || e.ctrlKey;

  // Multi-select: any click inside the bounding box (object or empty space) → drag group
  if (isMultiSelected() && !additive) {
    let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
    for (const id of selectedIds) {
      const o = objectsMap.get(id);
      if (!o) continue;
      bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
      bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
    }
    if (wp.x >= bx1 && wp.x <= bx2 && wp.y >= by1 && wp.y <= by2) {
      const grpStartX = e.clientX, grpStartY = e.clientY;
      const grpItems = [];
      for (const id of selectedIds) {
        const o = objectsMap.get(id);
        if (o) grpItems.push({ obj: o, startX: o.x, startY: o.y });
      }
      let grpMoved = false;
      const grpThreshold = 9 / (zoom * zoom);
      let grpLastDx = 0, grpLastDy = 0, grpRaf = null;
      function applyGrpDrag(dx, dy) {
        for (const item of grpItems) { item.obj.x = item.startX + dx; item.obj.y = item.startY + dy; }
        drawBoard(); updateSelectionOverlay();
      }
      function onGrpMove(ev) {
        const dx = (ev.clientX - grpStartX) / zoom, dy = (ev.clientY - grpStartY) / zoom;
        if (!grpMoved && dx*dx + dy*dy > grpThreshold) grpMoved = true;
        if (!grpMoved) return;
        grpLastDx = dx; grpLastDy = dy;
        if (grpRaf) return;
        grpRaf = requestAnimationFrame(() => { grpRaf = null; applyGrpDrag(grpLastDx, grpLastDy); });
      }
      function onGrpUp() {
        document.removeEventListener('mousemove', onGrpMove);
        document.removeEventListener('mouseup', onGrpUp);
        if (grpRaf) { cancelAnimationFrame(grpRaf); grpRaf = null; }
        if (grpMoved) { applyGrpDrag(grpLastDx, grpLastDy); for (const item of grpItems) markDirty(item.obj.id); pushHistory(); }
      }
      document.addEventListener('mousemove', onGrpMove);
      document.addEventListener('mouseup', onGrpUp);
      return;
    }
  }

  if (!obj) {
    if (!additive) deselectAll();
    const rbStartX = e.clientX, rbStartY = e.clientY;
    let rbActive = false;
    function onRbMove(ev) {
      const dx = ev.clientX - rbStartX, dy = ev.clientY - rbStartY;
      if (!rbActive && dx*dx + dy*dy > 16) rbActive = true;
      if (!rbActive) return;
      const l = Math.min(rbStartX, ev.clientX), t = Math.min(rbStartY, ev.clientY);
      const w = Math.abs(dx), h = Math.abs(dy);
      _setStyleIfChanged(rubberBand, 'display', 'block', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'left', l + 'px', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'top', t + 'px', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'width', w + 'px', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'height', h + 'px', _rubberBandStyleState);
    }
    function onRbUp(ev) {
      document.removeEventListener('mousemove', onRbMove);
      document.removeEventListener('mouseup', onRbUp);
      _setStyleIfChanged(rubberBand, 'display', 'none', _rubberBandStyleState);
      if (!rbActive) return;
      const x1 = Math.min(rbStartX, ev.clientX), y1 = Math.min(rbStartY, ev.clientY);
      const x2 = Math.max(rbStartX, ev.clientX), y2 = Math.max(rbStartY, ev.clientY);
      const wx1 = (x1 - panX) / zoom, wy1 = (y1 - panY) / zoom;
      const wx2 = (x2 - panX) / zoom, wy2 = (y2 - panY) / zoom;
      if (!additive) selectedIds.clear();
      let hitCount = 0;
      for (const o of objects) {
        if (o.x < wx2 && o.x + o.w > wx1 && o.y < wy2 && o.y + o.h > wy1) {
          selectedIds.add(o.id);
          selectedId = o.id;
          hitCount++;
        }
      }
      if (!hitCount) return;
      scheduleRender(true, true);
    }
    document.addEventListener('mousemove', onRbMove);
    document.addEventListener('mouseup', onRbUp);
    return;
  }

  if (additive) {
    if (isSelected(obj.id)) {
      selectedIds.delete(obj.id);
      if (selectedId === obj.id) {
        selectedId = null;
        for (const id of selectedIds) selectedId = id;
      }
      if (editingId && !isSelected(editingId)) exitEdit();
    } else {
      if (editingId && editingId !== obj.id) exitEdit();
      selectedIds.add(obj.id);
      selectedId = obj.id;
      const addedObj = objectsMap.get(obj.id);
      if (addedObj) {
        bringObjectToFront(obj.id);
        markDirty(obj.id);
        addedObj.z = ++zCounter;
      }
    }
    scheduleRender(true, true);
    return;
  }

  // Click inside the currently edited text object: position caret / start drag-select
  if (editingId && obj.id === editingId && selectedIds.size === 1) {
    const layout = getTextLayout(obj);
    const clickIdx = layoutHitTest(layout, wp.x, wp.y, obj);
    if (_editEl) {
      _editEl.focus({ preventScroll: true });
      _editEl.setSelectionRange(clickIdx, clickIdx);
      _caretVisible = true;
      scheduleRender(true, false);
    }
    function onSelMove(ev) {
      const wp2 = toWorld(ev.clientX, ev.clientY);
      const endIdx = layoutHitTest(obj._layoutCache || layout, wp2.x, wp2.y, obj);
      if (_editEl) {
        _editEl.setSelectionRange(Math.min(clickIdx, endIdx), Math.max(clickIdx, endIdx));
        _caretVisible = true;
        scheduleRender(true, false);
      }
    }
    function onSelUp() {
      document.removeEventListener('mousemove', onSelMove);
      document.removeEventListener('mouseup', onSelUp);
    }
    document.addEventListener('mousemove', onSelMove);
    document.addEventListener('mouseup', onSelUp);
    return;
  }

  if (editingId && editingId !== obj.id) exitEdit();

  if (!isSelected(obj.id)) selectObject(obj.id);

  const startX = e.clientX, startY = e.clientY;
  const dragItems = [];
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (o) dragItems.push({ obj: o, startX: o.x, startY: o.y });
  }
  let moved = false;
  const moveThreshold = 9 / (zoom * zoom);
  let lastDx = 0, lastDy = 0;
  let dragRaf = null;

  function applyDrag(dx, dy) {
    for (const item of dragItems) {
      item.obj.x = item.startX + dx;
      item.obj.y = item.startY + dy;
    }
    drawBoard();
    updateSelectionOverlay();
  }

  function scheduleDragFrame() {
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(() => {
      dragRaf = null;
      applyDrag(lastDx, lastDy);
    });
  }

  function onMove(ev) {
    const dx = (ev.clientX - startX) / zoom;
    const dy = (ev.clientY - startY) / zoom;
    if (!moved && dx*dx + dy*dy > moveThreshold) moved = true;
    if (!moved) return;
    lastDx = dx;
    lastDy = dy;
    scheduleDragFrame();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!moved) {
      if (!isSelected(obj.id)) selectObject(obj.id);
      return;
    }
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = null;
    }
    applyDrag(lastDx, lastDy);
    for (const item of dragItems) markDirty(item.obj.id);
    pushHistory();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

canvas.addEventListener('dblclick', (e) => {
  if (isMultiSelected()) return;
  const wp = toWorld(e.clientX, e.clientY);
  const obj = hitTest(wp.x, wp.y);
  if (obj && obj.type === 'text') { selectObject(obj.id); enterEdit(obj.id); }
});

// Prevent middle-click scroll/autoscroll behavior
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// ─── Context menu ─────────────────────────────────────────────────────────────

let ctxPos = { x: 0, y: 0 };

function updateObjMenuActions() {
  let imageCount = 0;
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (o && o.type === 'image') imageCount++;
  }
  if (copyBtn) copyBtn.style.display = 'block';
  if (imageActionsSep) imageActionsSep.style.display = imageCount >= 1 ? 'block' : 'none';
  if (flipHorizontalBtn) flipHorizontalBtn.style.display = imageCount >= 1 ? 'block' : 'none';
  if (flipVerticalBtn) flipVerticalBtn.style.display = imageCount >= 1 ? 'block' : 'none';
  if (saveImageBtn) saveImageBtn.style.display = imageCount === 1 ? 'block' : 'none';
  if (saveImagesBtn) saveImagesBtn.style.display = imageCount >= 2 ? 'block' : 'none';
  if (exportSep) exportSep.style.display = imageCount >= 1 ? 'block' : 'none';
}

function updateCtxMenuActions() {
  const hasImages = objects.some((o) => o.type === 'image');
  const hasText   = objects.some((o) => o.type === 'text');
  const show = hasImages || hasText;
  if (exportAllTextBtn) exportAllTextBtn.style.display = hasText ? 'block' : 'none';
  if (exportAllImageBtn) exportAllImageBtn.style.display = hasImages ? 'block' : 'none';
  if (exportAllSep) exportAllSep.style.display = show ? 'block' : 'none';
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const wp = toWorld(e.clientX, e.clientY);

  // Multi-select: right-click anywhere inside bounding box shows obj menu
  if (isMultiSelected()) {
    let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
    for (const id of selectedIds) {
      const o = objectsMap.get(id);
      if (!o) continue;
      bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
      bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
    }
    if (wp.x >= bx1 && wp.x <= bx2 && wp.y >= by1 && wp.y <= by2) {
      updateObjMenuActions();
      ctxMenu.classList.remove('visible');
      objCtxMenu.style.left = e.clientX + 'px';
      objCtxMenu.style.top  = e.clientY + 'px';
      objCtxMenu.classList.add('visible');
      return;
    }
  }

  const obj = hitTest(wp.x, wp.y);
  if (obj) {
    if (!isSelected(obj.id)) selectObject(obj.id);
    updateObjMenuActions();
    ctxMenu.classList.remove('visible');
    objCtxMenu.style.left = e.clientX + 'px';
    objCtxMenu.style.top  = e.clientY + 'px';
    objCtxMenu.classList.add('visible');
    return;
  }
  objCtxMenu.classList.remove('visible');
  ctxPos = wp;
  updateCtxMenuActions();
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top  = e.clientY + 'px';
  ctxMenu.classList.add('visible');
});

document.getElementById('btn-new').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  newBoard();
});

document.getElementById('btn-add-text').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  addText(ctxPos.x, ctxPos.y);
});

document.getElementById('btn-add-image').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  fileInput.value = '';
  fileInput.click();
});

document.getElementById('btn-paste').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  pasteAtPos(ctxPos.x, ctxPos.y);
});

document.getElementById('btn-save').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  saveBoard();
});

document.getElementById('btn-save-as').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  saveBoardAs();
});

document.getElementById('btn-open').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  openBoard();
});


fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => addImage(ev.target.result, ctxPos.x, ctxPos.y);
  reader.readAsDataURL(file);
});

document.addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  objCtxMenu.classList.remove('visible');
});

document.getElementById('obj-btn-copy').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  copySelected();
});

document.getElementById('obj-btn-delete').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  deleteSelected();
});

document.getElementById('obj-btn-duplicate').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  duplicateSelected();
});

document.getElementById('obj-btn-move-to-back').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  sendSelectedToBack();
});

document.getElementById('obj-btn-flip-horizontal').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  flipSelectedImages('x');
});

document.getElementById('obj-btn-flip-vertical').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  flipSelectedImages('y');
});

document.getElementById('obj-btn-save-image').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  saveSelectedImage();
});

document.getElementById('obj-btn-save-images').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  saveSelectedImages();
});

document.getElementById('btn-export-all-images').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  exportAllImages();
});

document.getElementById('btn-export-all-text').addEventListener('click', () => {
  ctxMenu.classList.remove('visible');
  exportAllText();
});

islZoom.addEventListener('click', () => {
  deselectAll();
  const vw = window.innerWidth, vh = window.innerHeight;
  const anyVisible = objects.some(o => {
    const sx = o.x * zoom + panX, sy = o.y * zoom + panY;
    return sx + o.w * zoom > 0 && sx < vw && sy + o.h * zoom > 0 && sy < vh;
  });
  const targetZoom = 1;
  let targetPanX, targetPanY;
  if (!anyVisible && objects.length) {
    const cx = (vw / 2 - panX) / zoom, cy = (vh / 2 - panY) / zoom;
    let nearest = null, nearestDist = Infinity;
    for (const o of objects) {
      const d = (o.x + o.w / 2 - cx) ** 2 + (o.y + o.h / 2 - cy) ** 2;
      if (d < nearestDist) { nearestDist = d; nearest = o; }
    }
    targetPanX = vw / 2 - (nearest.x + nearest.w / 2) * targetZoom;
    targetPanY = vh / 2 - (nearest.y + nearest.h / 2) * targetZoom;
  } else {
    targetPanX = vw / 2 - (vw / 2 - panX) * (targetZoom / zoom);
    targetPanY = vh / 2 - (vh / 2 - panY) * (targetZoom / zoom);
  }
  const startPanX = panX, startPanY = panY, startZoom = zoom;
  const startTime = performance.now();
  const duration = 350;
  function animate(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const e = 1 - Math.pow(1 - t, 3);
    zoom = startZoom + (targetZoom - startZoom) * e;
    panX = startPanX + (targetPanX - startPanX) * e;
    panY = startPanY + (targetPanY - startPanY) * e;
    applyTransform();
    if (t < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
});

// ─── Drag and drop images ─────────────────────────────────────────────────────

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

// HTML5 drop — works for images dragged from a browser
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const pos = toWorld(e.clientX, e.clientY);
  for (const file of [...e.dataTransfer.files]) {
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = (ev) => addImage(ev.target.result, pos.x, pos.y);
    reader.readAsDataURL(file);
  }
});

// Tauri native drop — place at center of visible canvas (Rust drop position unreliable)
if (window.__TAURI__) {
  window.__TAURI__.event.listen('boardfish://file-drop', async (event) => {
    const { paths } = event.payload;
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    for (const path of paths) {
      if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) continue;
      try {
        const b64 = await window.__TAURI__.core.invoke('read_binary_file_base64', { path });
        const ext = path.split('.').pop().toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                   : ext === 'gif' ? 'image/gif'
                   : ext === 'webp' ? 'image/webp'
                   : 'image/png';
        addImage('data:' + mime + ';base64,' + b64, center.x, center.y);
      } catch (err) { console.error('Failed to load dropped file:', err); }
    }
  });
}


// ─── Dirty tracking ───────────────────────────────────────────────────────────

// historyIndex at last save (or open). -1 means never saved.
let savedHistoryIndex = -1;
let currentFilePath = null;

function isDirty() {
  return objects.length > 0 && historyIndex !== savedHistoryIndex;
}

function markSaved() {
  savedHistoryIndex = historyIndex;
  updateTitle();
}

function updateTitle() {
  if (!window.__TAURI__) return;
  const name = currentFilePath
    ? currentFilePath.split(/[\\/]/).pop().replace(/\.bf$/i, '')
    : 'Untitled';
  const dot = isDirty() ? ' •' : '';
  const title = 'Boardfish — ' + name + dot;
  window.__TAURI__.core.invoke('set_title', { title });
}


// ─── Unsaved changes dialog ───────────────────────────────────────────────────

const dialogOverlay = document.getElementById('dialog-overlay');
let _dialogResolve = null;

function _dialogClose(result) {
  dialogOverlay.classList.remove('show');
  const r = _dialogResolve;
  _dialogResolve = null;
  if (r) r(result);
}

document.getElementById('dlg-save').addEventListener('click', () => _dialogClose('save'));
document.getElementById('dlg-discard').addEventListener('click', () => _dialogClose('discard'));
document.getElementById('dlg-cancel').addEventListener('click', () => _dialogClose('cancel'));

// Returns 'save' | 'discard' | 'cancel'
function showUnsavedDialog() {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    dialogOverlay.classList.add('show');
  });
}

// ─── Save / Open ─────────────────────────────────────────────────────────────

function boardData() {
  return { version: 2, viewport: { panX, panY, zoom }, imageStore, objects };
}

function applyBoardData(data) {
  clearImageStore();
  if (data.version === 1) {
    // Migrate v1: inline src -> imageStore
    for (const obj of (data.objects || [])) {
      if (obj.type === 'image' && obj.data && obj.data.src) {
        const key = storeImage(obj.data.src);
        obj.data = { imgKey: key };
      }
    }
  } else {
    Object.assign(imageStore, data.imageStore || {});
    for (const k of Object.keys(imageStore)) {
      const n = parseInt(k.split('-')[1]);
      if (!isNaN(n) && n >= imgKeyCounter) imgKeyCounter = n + 1;
      cacheImage(k, imageStore[k]);
    }
  }

  if (editingId) exitEdit();
  selectedId = null;
  selectedIds.clear();
  objects = data.objects || [];
  rebuildObjectsMap();
  syncAllTextAutoHeights();
  invalidateOffscreen();
  for (const obj of objects) {
    const n = parseInt(obj.id.split('-')[1]);
    if (!isNaN(n) && n >= idCounter) idCounter = n + 1;
    if (obj.z >= zCounter) zCounter = obj.z + 1;
  }
  if (data.viewport) { panX = data.viewport.panX; panY = data.viewport.panY; zoom = data.viewport.zoom; }
  applyTransform();
  history = []; historyIndex = -1; snapshot();
  markSaved();
}

async function saveBoardAs() {
  if (!window.__TAURI__) { alert('Save requires the desktop app.'); return false; }
  try {
    const defaultName = currentFilePath
      ? currentFilePath.split(/[\\/]/).pop()
      : 'board.bf';
    const filePath = await window.__TAURI__.core.invoke('save_file_dialog', { defaultName });
    if (!filePath) return false;
    await window.__TAURI__.core.invoke('save_board', { path: filePath, board: boardData() });
    currentFilePath = filePath;
    markSaved();
    showIslandMsg('Saved', 1500);
    return true;
  } catch (err) {
    console.error('Save failed:', err);
    return false;
  }
}

async function saveBoard() {
  if (currentFilePath) {
    if (!window.__TAURI__) return false;
    try {
      await window.__TAURI__.core.invoke('save_board', { path: currentFilePath, board: boardData() });
      markSaved();
      showIslandMsg('Saved', 1500);
      return true;
    } catch (err) {
      console.error('Save failed:', err);
      return false;
    }
  }
  return saveBoardAs();
}


async function openBoard() {
  if (!window.__TAURI__) { alert('Open requires the desktop app.'); return; }

  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') {
      const saved = await saveBoard();
      if (!saved) return;
    }
  }

  try {
    const filePath = await window.__TAURI__.core.invoke('open_file_dialog');
    if (!filePath) return;
    const data = JSON.parse(await window.__TAURI__.core.invoke('read_text_file', { path: filePath }));
    applyBoardData(data);
    currentFilePath = filePath;
    updateTitle();
  } catch (err) { console.error('Open failed:', err); }
}

// ─── Close guard ─────────────────────────────────────────────────────────────

let _closeGuardRunning = false;

async function requestAppClose() {
  if (!window.__TAURI__ || _closeGuardRunning) return;
  _closeGuardRunning = true;
  try {
    if (isDirty()) {
      const choice = await showUnsavedDialog();
      if (choice === 'cancel') {
        window.__TAURI__.core.invoke('cancel_pending_termination').catch(() => {});
        return;
      }
      if (choice === 'save') {
        const saved = await saveBoard();
        if (!saved) {
          window.__TAURI__.core.invoke('cancel_pending_termination').catch(() => {});
          return;
        }
      }
    }
    // Use process.exit instead of appWindow.close() to avoid re-triggering
    // the CloseRequested event in Rust (which would cause an infinite loop)
    await window.__TAURI__.core.invoke('exit_app');
  } finally {
    _closeGuardRunning = false;
  }
}

if (window.__TAURI__) {
  window.__TAURI__.event.listen('boardfish://close-requested', requestAppClose);
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

let jsClipboard = null;
let _jsClipboardSetAt = 0;
// Fingerprint of what Boardfish wrote to the system clipboard, used to detect
// external writes (e.g. screenshots) when the app regains focus.
// 'skip' = internal duplicate, never verify. null = write not yet complete.
let _jsCbFingerprint = null;
// Set to true when the window blurs after a copy — only then is an external
// clipboard write possible, so we only pay the verification cost in that case.
let _blurredSinceCopy = false;

window.addEventListener('blur', () => { if (jsClipboard) _blurredSinceCopy = true; });
window.addEventListener('focus', () => { if (Date.now() - _jsClipboardSetAt > 1500) jsClipboard = null; });

// Read current system clipboard and store fingerprint (multi-select: nothing
// was written, so we snapshot whatever is there to detect later changes).

// Returns false if system clipboard has changed since copy — caller should drop jsClipboard.
// Only runs when the app has blurred since the copy (external write is otherwise impossible).
async function jsClipboardStillValid() {
  if (!_jsCbFingerprint || _jsCbFingerprint === 'skip') return true;
  if (!_blurredSinceCopy) return true; // app never left — clipboard can't have changed externally
  try {
    if (_jsCbFingerprint.type === 'text') {
      const t = await navigator.clipboard.readText().catch(() => null);
      return t === null || t === _jsCbFingerprint.value;
    }
    if (_jsCbFingerprint.type === 'image') {
      if (!navigator.clipboard?.read) return true;
      const items = await navigator.clipboard.read().catch(() => null);
      if (!items) return true;
      for (const item of items) {
        const imgType = item.types.find(t => t.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          const r = blob.size / _jsCbFingerprint.size;
          return r > 0.8 && r < 1.2;
        }
      }
      return false; // expected image, none found
    }
  } catch { return true; }
  return true;
}

async function copySelected() {
  if (!selectedIds.size) return;

  if (selectedIds.size > 1) {
    const clonedObjs = [];
    const imageData = {};
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj) continue;
      const cloned = cloneObject(obj);
      if (cloned.type === 'image') {
        const src = imageStore[cloned.data.imgKey];
        if (src) imageData[cloned.data.imgKey] = src;
      }
      clonedObjs.push(cloned);
    }
    if (!clonedObjs.length) return;
    jsClipboard = { type: 'objects', objects: clonedObjs, imageData };
    _jsClipboardSetAt = Date.now();
    _blurredSinceCopy = false;
    _jsCbFingerprint = null;
    return;
  }

  const obj = getFirstSelectedObject();
  if (!obj) return;

  const cloned = cloneObject(obj);
  const imgData = {};
  if (obj.type === 'image') {
    const src = imageStore[obj.data.imgKey];
    if (src) imgData[obj.data.imgKey] = src;
  }
  const isTauri = !!window.__TAURI__;

  jsClipboard = { type: 'objects', objects: [cloned], imageData: imgData };
  _jsClipboardSetAt = Date.now();
  _blurredSinceCopy = false;

  if (obj.type === 'text') {
    _jsCbFingerprint = { type: 'text', value: obj.data.content };
    if (isTauri) {
      window.__TAURI__.core.invoke('copy_text_to_clipboard', { text: obj.data.content })
        .catch(err => console.error('[copy] copy_text_to_clipboard FAILED:', err));
    } else {
      navigator.clipboard.writeText(obj.data.content)
        .catch(err => console.error('[copy] writeText FAILED:', err));
    }
    return;
  }

  if (obj.type === 'image') {
    if (isTauri && !imageNeedsRendering(obj)) {
      const src = imageStore[obj.data.imgKey];
      if (src) {
        const comma = src.indexOf(',');
        _jsCbFingerprint = { type: 'image', size: Math.floor((src.length - comma - 1) * 0.75) };
      }
      window.__TAURI__.core.invoke('copy_cached_image_to_clipboard', { imgKey: obj.data.imgKey })
        .catch(async () => {
          // Cache miss fallback: render to canvas and send as data URL
          const fallbackCanvas = renderImageToCanvas(obj) || (() => {
            const im = imageCache[obj.data.imgKey];
            if (!im || !im.complete || !im.naturalWidth) return null;
            const tmp = document.createElement('canvas');
            tmp.width = im.naturalWidth; tmp.height = im.naturalHeight;
            tmp.getContext('2d').drawImage(im, 0, 0);
            return tmp;
          })();
          if (!fallbackCanvas) return;
          const fallbackBlob = await canvasToPngBlob(fallbackCanvas);
          if (!fallbackBlob) return;
          _jsCbFingerprint = { type: 'image', size: fallbackBlob.size };
          const fallbackDataUrl = fallbackCanvas.toDataURL('image/png');
          window.__TAURI__.core.invoke('copy_image_data_url_to_clipboard', { dataUrl: fallbackDataUrl })
            .then(() => {
              // Populate cache so subsequent copies use the fast path
              window.__TAURI__.core.invoke('cache_image_for_clipboard', { imgKey: obj.data.imgKey, dataUrl: imageStore[obj.data.imgKey] || fallbackDataUrl })
                .catch(() => {});
            })
            .catch(err => console.error('[copy] fallback copy_image_data_url_to_clipboard FAILED:', err));
        });
    } else {
      const canvas = renderImageToCanvas(obj);
      if (!canvas) return;
      const pngBlob = await canvasToPngBlob(canvas);
      if (!pngBlob) return;
      _jsCbFingerprint = { type: 'image', size: pngBlob.size };
      if (isTauri) {
        window.__TAURI__.core.invoke('copy_image_data_url_to_clipboard', { dataUrl: canvas.toDataURL('image/png') })
          .catch(err => console.error('[copy] copy_image_data_url_to_clipboard FAILED:', err));
      } else {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
          .catch(err => console.error('[copy] clipboard.write FAILED:', err));
      }
    }
  }
}

function guessImageExtFromDataUrl(dataUrl) {
  if (dataUrl.startsWith('data:image/jpeg')) return 'jpg';
  if (dataUrl.startsWith('data:image/gif')) return 'gif';
  if (dataUrl.startsWith('data:image/webp')) return 'webp';
  return 'png';
}

async function saveSelectedImage() {
  if (selectedIds.size !== 1) return;
  const obj = objectsMap.get(selectedId);
  if (!obj || obj.type !== 'image') return;

  const src = await getRenderedImageDataUrl(obj);
  if (!src) return;

  const ext = guessImageExtFromDataUrl(src);
  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  const defaultName = `image_${hex}.${ext}`;

  if (window.__TAURI__) {
    try {
      const saved = await window.__TAURI__.core.invoke('save_image_as', { dataUrl: src, defaultName });
      if (saved) showIslandMsg('Image Exported', 1500);
    } catch (err) {
      console.error('Save image failed:', err);
    }
    return;
  }

  const a = document.createElement('a');
  a.href = src;
  a.download = defaultName;
  a.click();
}

async function saveSelectedImages() {
  const selectedObjs = [];
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'image') return;
    selectedObjs.push(obj);
  }
  if (selectedObjs.length < 2) return;

  if (window.__TAURI__) {
    const dataUrls = (await Promise.all(selectedObjs.map((o) => getRenderedImageDataUrl(o)))).filter(Boolean);
    if (dataUrls.length < 2) return;
    try {
      const savedCount = await window.__TAURI__.core.invoke('save_images_to_folder', { dataUrls });
      if (savedCount > 0) showIslandMsg(`${savedCount} Images Exported`, 1500);
    } catch (err) {
      console.error('Save images failed:', err);
    }
    return;
  }

  for (let i = 0; i < selectedObjs.length; i++) {
    const src = await getRenderedImageDataUrl(selectedObjs[i]);
    if (!src) continue;
    const ext = guessImageExtFromDataUrl(src);
    const a = document.createElement('a');
    a.href = src;
    a.download = `image_${i + 1}.${ext}`;
    a.click();
  }
}

async function exportAllImages() {
  const imageObjs = [...objects].sort((a, b) => b.z - a.z).filter((o) => o.type === 'image');
  if (!imageObjs.length) return;

  if (window.__TAURI__) {
    const dataUrls = (await Promise.all(imageObjs.map((o) => getRenderedImageDataUrl(o)))).filter(Boolean);
    if (!dataUrls.length) return;
    try {
      const savedCount = await window.__TAURI__.core.invoke('save_images_to_folder', { dataUrls });
      if (savedCount > 0) showIslandMsg(`${savedCount} Images Exported`, 1500);
    } catch (err) {
      console.error('Export all images failed:', err);
    }
    return;
  }

  for (let i = 0; i < imageObjs.length; i++) {
    const src = await getRenderedImageDataUrl(imageObjs[i]);
    if (!src) continue;
    const ext = guessImageExtFromDataUrl(src);
    const a = document.createElement('a');
    a.href = src;
    a.download = `image_${i + 1}.${ext}`;
    a.click();
  }
}

async function exportAllText() {
  const textObjs = [...objects].sort((a, b) => b.z - a.z).filter((o) => o.type === 'text');
  if (!textObjs.length) return;

  const combined = textObjs.map((o) => o.data.content).join('\n\n');

  if (window.__TAURI__) {
    try {
      const saved = await window.__TAURI__.core.invoke('save_text_as', { text: combined });
      if (saved) showIslandMsg('Text Exported', 1500);
    } catch (err) {
      console.error('Export all text failed:', err);
    }
    return;
  }

  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  const blob = new Blob([combined], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `text_${hex}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function pasteAtPos(wx, wy) {
  if (jsClipboard && !(await jsClipboardStillValid())) {
    jsClipboard = null;
    _jsCbFingerprint = null;
  }
  if (jsClipboard) {
    if (jsClipboard.type === 'objects') {
      const clones = cloneObjects(jsClipboard.objects || []);
      if (!clones.length) return;
      // Re-register image data in case we're on a different board
      const imgData = jsClipboard.imageData || {};
      for (const [key, src] of Object.entries(imgData)) {
        if (!imageStore[key]) { imageStore[key] = src; cacheImage(key, src); }
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const o of clones) {
        minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
        maxX = Math.max(maxX, o.x + o.w); maxY = Math.max(maxY, o.y + o.h);
      }
      const dx = wx - (minX + maxX) / 2, dy = wy - (minY + maxY) / 2;
      selectedIds.clear();
      for (const o of clones) {
        o.id = newId(); o.x += dx; o.y += dy; o.z = ++zCounter;
        objects.push(o); objectsMap.set(o.id, o); selectedIds.add(o.id);
      }
      selectedId = clones[clones.length - 1].id;
      scheduleRender(true, true); pushHistory(); return;
    }
  }
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const reader = new FileReader();
            reader.onload = (ev) => addImage(ev.target.result, wx, wy);
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
    }
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) addText(wx - 100, wy - 40, text);
  } catch {}
}

document.addEventListener('paste', (e) => {
  if (editingId) return;
  e.preventDefault();
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  pasteAtPos(center.x, center.y);
});


// ─── Keyboard ────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    if (!editingId) {
      e.preventDefault();
      selectAllObjects();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'w')) {
    if (window.__TAURI__) {
      e.preventDefault();
      requestAppClose();
    }
    return;
  }

  if (e.key === 'Escape') {
    hideMenus();
    if (editingId) {
      exitEdit();
      selectedId = null;
      selectedIds.clear();
      scheduleRender(false, true);
      return;
    }
    deselectAll();
    return;
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && hasSelection() && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !editingId) {
    e.preventDefault();
    newBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !editingId) {
    e.preventDefault();
    openBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveBoardAs();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBoard(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingId) { e.preventDefault(); copySelected(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && !editingId) {
    e.preventDefault();
    (async () => {
      await copySelected();
      deleteSelected();
    })();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) { e.preventDefault(); redo(); return; }

  if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !editingId) { e.preventDefault(); duplicateSelected(); return; }
});

// ─── Reload guard ────────────────────────────────────────────────────────────

// Prevent native WebKit context menu (which contains "Reload Page") on any
// element not already handled by the canvas contextmenu handler.
document.addEventListener('contextmenu', (e) => {
  if (!e.defaultPrevented) e.preventDefault();
});

// Treat page reload the same as New Board: show unsaved-changes dialog if dirty.
window.addEventListener('beforeunload', (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
  setTimeout(async () => {
    const choice = await showUnsavedDialog();
    if (choice === 'save') await saveBoard();
  }, 0);
});

// ─── Init ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);
document.fonts?.ready.then(clearTextMeasurementCaches).catch(() => {});
resizeCanvas();
snapshot();
updateZoomDisplay();
updateTitle();


// Open a .bf file by path — used for startup file and macOS open events
async function openFilePath(filePath) {
  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') { const saved = await saveBoard(); if (!saved) return; }
  }
  try {
    const data = JSON.parse(await window.__TAURI__.core.invoke('read_text_file', { path: filePath }));
    applyBoardData(data);
    currentFilePath = filePath;
    updateTitle();
  } catch (err) { console.error('Failed to open file:', err); }
}

if (window.__TAURI__) {
  // macOS double-click (app already running): Rust emits this event
  window.__TAURI__.event.listen('boardfish://open-file', (event) => {
    openFilePath(event.payload);
  });

  // Cold launch: check if Rust stored a file path before JS was ready
  window.__TAURI__.core.invoke('get_startup_file').then((filePath) => {
    if (filePath) openFilePath(filePath);
  });
}
