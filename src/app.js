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
const FONT      = `${FONT_SIZE}px 'Geist', 'Geist Sans', Inter, -apple-system, 'Segoe UI', system-ui, sans-serif`;

// Hidden span uses same CSS engine as the textarea for exact wrap matching
const _measurer = (() => {
  const el = document.createElement('span');
  el.style.cssText = `position:absolute;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none;white-space:pre;font-family:'Geist','Geist Sans',Inter,-apple-system,'Segoe UI',system-ui,sans-serif;font-size:${FONT_SIZE}px`;
  document.body.appendChild(el);
  return el;
})();
const _mwCache = Object.create(null);
function measureTextW(text) {
  if (text in _mwCache) return _mwCache[text];
  _measurer.textContent = text;
  return (_mwCache[text] = _measurer.getBoundingClientRect().width);
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

// Per-character layout for the editing object (world coords).
// Uses full-prefix measurements (not per-char accumulation) so kerning is
// accounted for and caret positions match the actual rendered glyphs exactly.
// Prefix strings are cached in _mwCache so repeated frames are O(n) lookups.
// Each entry: { text, startIndex, y, chars: [{char, x, w, index}] }
function calculateTextLayout(obj) {
  const lines = getWrappedLines(obj);
  return lines.map((line, i) => {
    const y = obj.y + TEXT_PAD + i * LINE_H;
    const pw = getPrefixWidths(line.text); // O(1) after first call for this string
    const chars = [];
    for (let j = 0; j < line.text.length; j++) {
      chars.push({ char: line.text[j], x: obj.x + TEXT_PAD + pw[j], w: pw[j + 1] - pw[j], index: line.startIndex + j });
    }
    return { text: line.text, startIndex: line.startIndex, y, chars };
  });
}

function layoutHitTest(layout, wx, wy) {
  if (!layout.length) return 0;
  let line = layout[layout.length - 1];
  for (let i = 0; i < layout.length; i++) {
    if (wy < layout[i].y + LINE_H) { line = layout[i]; break; }
  }
  if (!line.chars.length) return line.startIndex;
  for (const ch of line.chars) {
    if (wx < ch.x + ch.w / 2) return ch.index;
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
      context.drawImage(img, obj.x, obj.y, obj.w, obj.h);
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
      const layout = calculateTextLayout(obj);
      obj._layoutCache = layout;

      // Selection highlight
      if (selStart !== selEnd) {
        ctx.fillStyle = 'rgba(10, 132, 255, 0.3)';
        for (const line of layout) {
          const ls = line.startIndex, le = ls + line.text.length;
          const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, le);
          if (h0 < h1) {
            const o0 = h0 - ls, o1 = h1 - ls;
            const x1 = o0 < line.chars.length ? line.chars[o0].x : obj.x + TEXT_PAD + measureTextW(line.text);
            const x2 = o1 < line.chars.length ? line.chars[o1].x : obj.x + TEXT_PAD + measureTextW(line.text);
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
            cx = off < line.chars.length ? line.chars[off].x : obj.x + TEXT_PAD + measureTextW(line.text);
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

function bringObjectToFront(id) {
  const idx = objects.findIndex((o) => o.id === id);
  if (idx < 0 || idx === objects.length - 1) return;
  const [obj] = objects.splice(idx, 1);
  objects.push(obj);
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

function getSelectedObjects() {
  return [...selectedIds].map((id) => objectsMap.get(id)).filter(Boolean);
}

function allSelectedAreImages() {
  const objs = getSelectedObjects();
  return objs.length > 0 && objs.every((o) => o.type === 'image');
}

// ─── Image store (keeps base64 data OUT of history snapshots) ─────────────────

const imageStore = {};
const imageCache = {}; // key -> HTMLImageElement (decoded, ready for drawImage)
let imgKeyCounter = 1;

function storeImage(src) {
  const key = 'img-' + (imgKeyCounter++);
  imageStore[key] = src;
  const img = new Image();
  img.onload = () => { invalidateOffscreen(); scheduleRender(true, false); };
  img.src = src;
  imageCache[key] = img;
  return key;
}

function getImageSrc(obj) { return imageStore[obj.data.imgKey] || ''; }

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
const MAX_HISTORY = 20;

function trimHistory() {
  if (history.length > MAX_HISTORY) {
    const trim = history.length - MAX_HISTORY;
    history = history.slice(trim);
    historyIndex = history.length - 1;
    savedHistoryIndex = Math.max(-1, savedHistoryIndex - trim);
  }
}

function snapshot() {
  history = history.slice(0, historyIndex + 1);
  history.push({
    objects: JSON.parse(JSON.stringify(objects)),
    editState: captureEditState(),
  });
  historyIndex = history.length - 1;
  _dirtyIds.clear();
  trimHistory();
}

// Delta push: only deep-clones objects that changed since last snapshot.
// Unchanged objects share the previous snapshot's reference (safe since
// restoreSnapshot always deep-clones before mutating).
function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  const prevEntry = historyIndex >= 0 ? history[historyIndex] : [];
  const prevObjects = Array.isArray(prevEntry) ? prevEntry : (prevEntry.objects || []);
  const prevMap = new Map(prevObjects.map(o => [o.id, o]));
  const entry = objects.map(o =>
    (_dirtyIds.has(o.id) || !prevMap.has(o.id))
      ? JSON.parse(JSON.stringify(o))
      : prevMap.get(o.id)
  );
  _dirtyIds.clear();
  history.push({
    objects: entry,
    editState: captureEditState(),
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
  const snapshotObjects = Array.isArray(s) ? s : (s?.objects || []);
  const editState = Array.isArray(s) ? null : (s?.editState || null);
  objects = JSON.parse(JSON.stringify(snapshotObjects));
  _dirtyIds.clear();
  _linesCacheMap.clear();
  _prefixCache.clear();
  rebuildObjectsMap();
  invalidateOffscreen();
  selectedId = null;
  selectedIds.clear();
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

const _multiSelBoxes = [];
const _selOverlayStyleState = { left: '', top: '', width: '', height: '' };
const _multiSelStyleState = new WeakMap();

function _setStyleIfChanged(el, prop, value, state) {
  if (state[prop] === value) return;
  state[prop] = value;
  el.style[prop] = value;
}

function _setDisplayIfChanged(el, value) {
  let state = _multiSelStyleState.get(el);
  if (!state) {
    state = { display: '', left: '', top: '', width: '', height: '' };
    _multiSelStyleState.set(el, state);
  }
  _setStyleIfChanged(el, 'display', value, state);
  return state;
}

function updateSelectionOverlay() {
  function hideMultiSelectionOverlay() {
    if (!multiSelOverlay) return;
    if (multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.remove('visible');
  }

  if (!hasSelection()) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    return;
  }

  const selectedObjs = getSelectedObjects();
  if (!selectedObjs.length) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    selectedId = null;
    selectedIds.clear();
    hideMultiSelectionOverlay();
    return;
  }

  if (isMultiSelected()) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    if (!multiSelOverlay) return;
    while (_multiSelBoxes.length < selectedObjs.length) {
      const box = document.createElement('div');
      box.className = 'multi-sel-box';
      _multiSelBoxes.push(box);
      _multiSelStyleState.set(box, { display: '', left: '', top: '', width: '', height: '' });
      multiSelOverlay.appendChild(box);
    }

    for (let i = 0; i < _multiSelBoxes.length; i++) {
      const box = _multiSelBoxes[i];
      if (i >= selectedObjs.length) {
        _setDisplayIfChanged(box, 'none');
        continue;
      }
      const obj = selectedObjs[i];
      const state = _setDisplayIfChanged(box, 'block');
      _setStyleIfChanged(box, 'left', (obj.x * zoom + panX) + 'px', state);
      _setStyleIfChanged(box, 'top', (obj.y * zoom + panY) + 'px', state);
      _setStyleIfChanged(box, 'width', (obj.w * zoom) + 'px', state);
      _setStyleIfChanged(box, 'height', (obj.h * zoom) + 'px', state);
    }

    if (!multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.add('visible');
    return;
  }

  hideMultiSelectionOverlay();

  const obj = selectedObjs[0];
  const sx = obj.x * zoom + panX;
  const sy = obj.y * zoom + panY;
  const sw = obj.w * zoom;
  const sh = obj.h * zoom;

  _setStyleIfChanged(selOverlay, 'left', sx + 'px', _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'top', sy + 'px', _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'width', sw + 'px', _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'height', sh + 'px', _selOverlayStyleState);
  if (selOverlay.classList.contains('multi')) selOverlay.classList.remove('multi');
  if (!selOverlay.classList.contains('visible')) selOverlay.classList.add('visible');
}

// Init overlay handle listeners once — they always operate on selectedId
(function initOverlayHandles() {
  for (const handle of selOverlay.querySelectorAll('.s-handle')) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      if (!selectedId || isMultiSelected()) return;
      const obj = objectsMap.get(selectedId);
      if (!obj) return;

      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;
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
          if (dir.includes('s')) h = Math.max(MIN, oh + dy);
          if (dir.includes('w')) { w = Math.max(MIN, ow - dx); x = ox + ow - w; }
          if (dir.includes('n')) { h = Math.max(MIN, oh - dy); y = oy + oh - h; }
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
    scheduleEditHistoryCheckpoint(id);
    scheduleRender(true, false);
  });
  proxy.addEventListener('keydown', (e) => {
    _caretVisible = true;

    // The 1px-wide proxy treats all content as a single column, so the browser's
    // own up/down logic navigates char-by-char instead of line-by-line. Intercept
    // and compute line navigation from the canvas layout instead.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const layout = obj._layoutCache || calculateTextLayout(obj);
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
      const caretX = off < refLine.chars.length
        ? refLine.chars[off].x
        : refLine.chars.length > 0
          ? refLine.chars[refLine.chars.length - 1].x + refLine.chars[refLine.chars.length - 1].w
          : obj.x + TEXT_PAD;

      // Find nearest position in the target line
      const targetIdx = isUp ? refLineIdx - 1 : refLineIdx + 1;
      let newPos;
      if (targetIdx < 0) {
        newPos = 0;
      } else if (targetIdx >= layout.length) {
        newPos = proxy.value.length;
      } else {
        newPos = layoutHitTest([layout[targetIdx]], caretX, layout[targetIdx].y);
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
  scheduleRender(true, false);
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
      objects = objects.filter(o => o.id !== id);
      objectsMap.delete(id);
      _linesCacheMap.delete(id);
      selectedIds.delete(id);
      selectedId = null;
      delete obj._editStartContent;
      _editHistoryLastContent = null;
      scheduleRender(true, true);
      pushHistory();
      return;
    }
    pushEditHistoryIfChanged(id);
    delete obj._editStartContent;
    delete obj._layoutCache;
  }

  _editHistoryLastContent = null;
  scheduleRender(true, false);
  window.getSelection()?.removeAllRanges();
}

// ─── Add objects ─────────────────────────────────────────────────────────────

function addText(wx, wy, content = '') {
  let w = 200, h = 80;
  if (content) {
    const lines = content.split('\n');
    const charW = 9.2, lineH = 24, pad = 8;
    const maxLineLen = Math.max(...lines.map(l => l.length), 1);
    w = Math.min(Math.max(Math.round(maxLineLen * charW + pad * 2), 120), 700);
    const totalLines = lines.reduce((acc, line) => acc + Math.max(1, Math.ceil((line.length * charW) / (w - pad * 2))), 0);
    h = Math.max(Math.round(totalLines * lineH + pad * 2), 40);
  }

  const obj = { id: newId(), type: 'text', x: wx, y: wy, w, h, z: ++zCounter, data: { content } };
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
      const MAX = 800;
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
  const originals = getSelectedObjects();
  if (!originals.length) return;
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  const cloned = JSON.parse(JSON.stringify(originals));
  const imageData = {};
  for (const o of cloned) {
    if (o.type === 'image') {
      const src = imageStore[o.data.imgKey];
      if (src) imageData[o.data.imgKey] = src;
    }
  }
  jsClipboard = { type: 'objects', objects: cloned, imageData };
  _jsClipboardSetAt = Date.now();
  pasteAtPos(center.x, center.y);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!hasSelection() || editingId) return;
  const deleted = new Set(selectedIds);
  objects = objects.filter(o => !deleted.has(o.id));
  for (const id of deleted) {
    objectsMap.delete(id);
    _linesCacheMap.delete(id);
  }
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
const EDIT_HISTORY_DEBOUNCE_MS = 350;
let _setMode  = null; // 'pan' | 'zoom' | null (null = no active set)
let _setTimer = null;


canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (editingId) {
    _caretVisible = true;
  }
  if (e.ctrlKey) {
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
  if (_setMode === null) {
    const abs = Math.abs(e.deltaY);
    _setMode = (abs < 4 || e.deltaX !== 0) ? 'pan' : 'zoom';
  }
  clearTimeout(_setTimer);
  _setTimer = setTimeout(() => { _setMode = null; }, 250);

  const isPan = _setMode === 'pan';

  if (isPan) {
    panX -= e.deltaX;
    panY -= e.deltaY;
    scheduleTransform();
  } else {
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    panX = e.clientX - (e.clientX - panX) * (newZoom / zoom);
    panY = e.clientY - (e.clientY - panY) * (newZoom / zoom);
    zoom = newZoom;
    scheduleTransform();
  }
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
      rubberBand.style.cssText = `display:block;left:${l}px;top:${t}px;width:${w}px;height:${h}px`;
    }
    function onRbUp(ev) {
      document.removeEventListener('mousemove', onRbMove);
      document.removeEventListener('mouseup', onRbUp);
      rubberBand.style.display = 'none';
      if (!rbActive) return;
      const x1 = Math.min(rbStartX, ev.clientX), y1 = Math.min(rbStartY, ev.clientY);
      const x2 = Math.max(rbStartX, ev.clientX), y2 = Math.max(rbStartY, ev.clientY);
      const wx1 = (x1 - panX) / zoom, wy1 = (y1 - panY) / zoom;
      const wx2 = (x2 - panX) / zoom, wy2 = (y2 - panY) / zoom;
      const hits = objects.filter(o =>
        o.x < wx2 && o.x + o.w > wx1 && o.y < wy2 && o.y + o.h > wy1
      );
      if (!hits.length) return;
      if (!additive) selectedIds.clear();
      for (const o of hits) { selectedIds.add(o.id); selectedId = o.id; }
      scheduleRender(true, true);
    }
    document.addEventListener('mousemove', onRbMove);
    document.addEventListener('mouseup', onRbUp);
    return;
  }

  if (additive) {
    if (isSelected(obj.id)) {
      selectedIds.delete(obj.id);
      if (selectedId === obj.id) selectedId = [...selectedIds].at(-1) || null;
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
    const layout = obj._layoutCache || calculateTextLayout(obj);
    const clickIdx = layoutHitTest(layout, wp.x, wp.y);
    if (_editEl) {
      _editEl.focus({ preventScroll: true });
      _editEl.setSelectionRange(clickIdx, clickIdx);
      _caretVisible = true;
      scheduleRender(true, false);
    }
    function onSelMove(ev) {
      const wp2 = toWorld(ev.clientX, ev.clientY);
      const endIdx = layoutHitTest(obj._layoutCache || layout, wp2.x, wp2.y);
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
  const dragIds = [...selectedIds];
  const originById = new Map();
  for (const id of dragIds) {
    const o = objectsMap.get(id);
    if (o) originById.set(id, { x: o.x, y: o.y });
  }
  let moved = false;
  const moveThreshold = 9 / (zoom * zoom);
  let lastDx = 0, lastDy = 0;
  let dragRaf = null;

  function applyDrag(dx, dy) {
    for (const id of dragIds) {
      const start = originById.get(id);
      const o = objectsMap.get(id);
      if (!start || !o) continue;
      o.x = start.x + dx;
      o.y = start.y + dy;
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
      if (!isSelected(obj.id) || selectedIds.size > 1) selectObject(obj.id);
      return;
    }
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = null;
    }
    applyDrag(lastDx, lastDy);
    for (const id of dragIds) markDirty(id);
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
  const multi = selectedIds.size > 1;
  const imagesOnly = allSelectedAreImages();
  const singleImageSelected = !multi && imagesOnly;
  const multiImagesSelected = multi && imagesOnly;
  const showExport = singleImageSelected || multiImagesSelected;
  if (copyBtn) copyBtn.style.display = 'block';
  if (saveImageBtn) saveImageBtn.style.display = singleImageSelected ? 'block' : 'none';
  if (saveImagesBtn) saveImagesBtn.style.display = multiImagesSelected ? 'block' : 'none';
  if (exportSep) exportSep.style.display = showExport ? 'block' : 'none';
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
    showIslandMsg('Opened', 1500);
  } catch (err) { console.error('Open failed:', err); }
}

// ─── Close guard ─────────────────────────────────────────────────────────────

if (window.__TAURI__) {
  window.__TAURI__.event.listen('boardfish://close-requested', async () => {
    if (isDirty()) {
      const choice = await showUnsavedDialog();
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const saved = await saveBoard();
        if (!saved) return;
      }
    }
    // Use process.exit instead of appWindow.close() to avoid re-triggering
    // the CloseRequested event in Rust (which would cause an infinite loop)
    await window.__TAURI__.core.invoke('exit_app');
  });
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

let jsClipboard = null; // in-app clipboard, avoids system clipboard format issues
let _jsClipboardSetAt = 0;

// When the user switches away and copies something else, clear in-app clipboard
// so the next paste uses whatever is most recent on the system clipboard.
// Grace period prevents osascript subprocess focus round-trip from wiping jsClipboard.
window.addEventListener('focus', () => { if (Date.now() - _jsClipboardSetAt > 1500) jsClipboard = null; });

async function copySelected() {
  const selectedObjs = getSelectedObjects();
  if (!selectedObjs.length) return;
  if (selectedObjs.length > 1) {
    const clonedObjs = JSON.parse(JSON.stringify(selectedObjs));
    const imageData = {};
    for (const o of clonedObjs) {
      if (o.type === 'image') {
        const src = imageStore[o.data.imgKey];
        if (src) imageData[o.data.imgKey] = src;
      }
    }
    jsClipboard = { type: 'objects', objects: clonedObjs, imageData };
    _jsClipboardSetAt = Date.now();
    return;
  }
  const obj = selectedObjs[0];

  // Always store as objects so pasteAtPos has a single branch
  const cloned = JSON.parse(JSON.stringify(obj));
  const imgData = {};
  if (obj.type === 'image') {
    const src = imageStore[obj.data.imgKey];
    if (src) imgData[obj.data.imgKey] = src;
  }
  jsClipboard = { type: 'objects', objects: [cloned], imageData: imgData };
  _jsClipboardSetAt = Date.now();

  const isTauri = !!window.__TAURI__;

  if (obj.type === 'text') {
    if (isTauri) {
      try {
        await window.__TAURI__.core.invoke('copy_text_to_clipboard', { text: obj.data.content });
      } catch (err) {
        console.error('[copy] copy_text_to_clipboard FAILED:', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(obj.data.content);
      } catch (err) {
        console.error('[copy] writeText FAILED:', err);
      }
    }
    return;
  }

  if (obj.type === 'image') {
    if (isTauri) {
      try {
        await window.__TAURI__.core.invoke('copy_cached_image_to_clipboard', { imgKey: obj.data.imgKey });
      } catch (err) {
        try {
          const src = getImageSrc(obj);
          if (!src) throw new Error('missing image source');
          await window.__TAURI__.core.invoke('cache_image_for_clipboard', { imgKey: obj.data.imgKey, dataUrl: src });
          await window.__TAURI__.core.invoke('copy_cached_image_to_clipboard', { imgKey: obj.data.imgKey });
        } catch (cacheErr) {
          console.error('[copy] copy_cached_image_to_clipboard FAILED:', cacheErr);
        }
      }
    } else {
      const img = imageCache[obj.data.imgKey];
      if (!img || !img.complete || !img.naturalWidth) { console.warn('[copy] image not ready'); return; }
      const tmp = document.createElement('canvas');
      tmp.width = img.naturalWidth;
      tmp.height = img.naturalHeight;
      tmp.getContext('2d').drawImage(img, 0, 0);
      const pngBlob = await new Promise(res => tmp.toBlob(res, 'image/png'));
      if (!pngBlob) { console.warn('[copy] toBlob returned null'); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      } catch (err) {
        console.error('[copy] clipboard.write FAILED:', err);
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

  const src = getImageSrc(obj);
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
  const selectedObjs = getSelectedObjects().filter((o) => o.type === 'image');
  if (selectedObjs.length < 2 || selectedObjs.length !== selectedIds.size) return;

  if (window.__TAURI__) {
    const dataUrls = selectedObjs.map((o) => getImageSrc(o)).filter(Boolean);
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
    const src = getImageSrc(selectedObjs[i]);
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
    const dataUrls = imageObjs.map((o) => getImageSrc(o)).filter(Boolean);
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
    const src = getImageSrc(imageObjs[i]);
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
  if (jsClipboard) {
    if (jsClipboard.type === 'objects') {
      const clones = JSON.parse(JSON.stringify(jsClipboard.objects || []));
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

  // In-app clipboard: handles copy/paste within Boardfish without system clipboard format issues
  if (jsClipboard) {
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    pasteAtPos(center.x, center.y);
    return;
  }

  // System clipboard: handles paste from external sources
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of [...items]) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
            addImage(ev.target.result, center.x, center.y);
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    }
  }
  const text = e.clipboardData?.getData('text/plain');
  if (text && text.trim()) {
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    addText(center.x - 100, center.y - 40, text);
  }
});

// ─── Keyboard ────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') { if (!editingId) e.preventDefault(); return; }

  if (e.key === 'Escape') { if (editingId) { exitEdit(); return; } deselectAll(); return; }

  if ((e.key === 'Backspace' || e.key === 'Delete') && hasSelection() && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBoard(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingId) { e.preventDefault(); copySelected(); return; }

if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) { e.preventDefault(); redo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
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
    showIslandMsg('Opened', 1500);
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
