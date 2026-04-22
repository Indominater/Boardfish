'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────

const canvas      = document.getElementById('canvas');
const boardCanvas = document.getElementById('board-canvas');
const ctx         = boardCanvas.getContext('2d');
const ctxMenu     = document.getElementById('ctx-menu');
const fileInput   = document.getElementById('file-input');
const selOverlay  = document.getElementById('sel-overlay');
const islZoom     = document.getElementById('isl-zoom');
const objCtxMenu  = document.getElementById('obj-ctx-menu');


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
    _lastZoomPct = -1; // force re-render even if zoom didn't change
    updateZoomDisplay();
    islZoom.style.color = 'rgba(255,255,255,0.38)';
  }, 500);
}


const FONT_SIZE = 16;
const LINE_H    = 24;
const TEXT_PAD  = 4;
const FONT      = `${FONT_SIZE}px 'Geist', 'Geist Sans', Inter, -apple-system, 'Segoe UI', system-ui, sans-serif`;

// Hidden span that uses the same CSS engine as the textarea for exact wrap matching
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

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  boardCanvas.width  = Math.round(window.innerWidth  * dpr);
  boardCanvas.height = Math.round(window.innerHeight * dpr);
  drawBoard();
}

function wrapLine(text, maxW) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let s = 0;
  while (s < words.length) {
    const remaining = words.slice(s).join(' ');
    if (measureTextW(remaining) <= maxW) { lines.push(remaining); break; }
    if (measureTextW(words[s]) > maxW) { lines.push(words[s++]); continue; }
    let lo = 1, hi = words.length - s - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      measureTextW(words.slice(s, s + mid).join(' ')) <= maxW ? lo = mid : hi = mid - 1;
    }
    lines.push(words.slice(s, s + lo).join(' '));
    s += lo;
  }
  return lines.length ? lines : [''];
}

function drawBoard() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1c1c1e';
  ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);

  const sorted = [...objects].sort((a, b) => a.z - b.z);
  for (const obj of sorted) {
    if (obj.id === editingId) continue;
    if (obj.type === 'text') {
      ctx.font = FONT;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      const maxW = obj.w - TEXT_PAD * 2;
      let lineY = obj.y + TEXT_PAD;
      for (const rawLine of obj.data.content.split('\n')) {
        for (const wl of wrapLine(rawLine, maxW)) {
          ctx.fillText(wl, obj.x + TEXT_PAD, lineY);
          lineY += LINE_H;
        }
      }
    } else if (obj.type === 'image') {
      const img = imageCache[obj.data.imgKey];
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
      }
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  updateEditorOverlay();
}

function hitTest(wx, wy) {
  const sorted = [...objects].sort((a, b) => b.z - a.z);
  for (const obj of sorted) {
    if (wx >= obj.x && wx <= obj.x + obj.w && wy >= obj.y && wy <= obj.y + obj.h) return obj;
  }
  return null;
}

function applyTransform() {
  drawBoard();
  updateZoomDisplay();
  saveViewport();
  updateSelectionOverlay();
}

let _transformRaf = null;
function scheduleTransform() {
  if (_transformRaf) return;
  _transformRaf = requestAnimationFrame(() => {
    _transformRaf = null;
    applyTransform();
  });
}

function toWorld(sx, sy) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}



// ─── Object state ─────────────────────────────────────────────────────────────

let zCounter = 1;
let selectedId = null;
let editingId  = null;
let objects    = [];
const objectsMap = new Map();
let idCounter  = 1;

function rebuildObjectsMap() {
  objectsMap.clear();
  for (const obj of objects) objectsMap.set(obj.id, obj);
}

function newId() { return 'obj-' + (idCounter++); }

// ─── Image store (keeps base64 data OUT of history snapshots) ─────────────────

const imageStore = {};
const imageCache = {}; // key -> HTMLImageElement (decoded, ready for drawImage)
let imgKeyCounter = 1;

function storeImage(src) {
  const key = 'img-' + (imgKeyCounter++);
  imageStore[key] = src;
  const img = new Image();
  img.onload = () => drawBoard();
  img.src = src;
  imageCache[key] = img;
  return key;
}

function getImageSrc(obj) { return imageStore[obj.data.imgKey] || ''; }

function cacheImage(key, src) {
  if (imageCache[key]) return;
  const img = new Image();
  img.onload = () => drawBoard();
  img.src = src;
  imageCache[key] = img;
}

function clearImageStore() {
  for (const k of Object.keys(imageStore)) delete imageStore[k];
  for (const k of Object.keys(imageCache)) delete imageCache[k];
  imgKeyCounter = 1;
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
  history.push(JSON.parse(JSON.stringify(objects)));
  historyIndex = history.length - 1;
  trimHistory();
}

function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push(JSON.parse(JSON.stringify(objects)));
  historyIndex++;
  trimHistory();
  updateTitle();
}

function restoreSnapshot(s) {
  if (editingId) {
    const ta = document.getElementById('board-editor');
    if (ta) ta.remove();
    editingId = null;
    _editEl = null;
  }
  objects = JSON.parse(JSON.stringify(s));
  rebuildObjectsMap();
  if (selectedId && !objectsMap.has(selectedId)) selectedId = null;
  renderAll();
}

function undo() { if (historyIndex <= 0) return; historyIndex--; restoreSnapshot(history[historyIndex]); updateTitle(); }
function redo() { if (historyIndex >= history.length - 1) return; historyIndex++; restoreSnapshot(history[historyIndex]); updateTitle(); }

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  drawBoard();
  updateSelectionOverlay();
}


// ─── Screen-space selection overlay ──────────────────────────────────────────

function updateSelectionOverlay() {
  if (!selectedId) {
    selOverlay.classList.remove('visible');
    return;
  }
  const obj = objectsMap.get(selectedId);
  if (!obj) {
    selOverlay.classList.remove('visible');
    return;
  }

  const sx = obj.x * zoom + panX;
  const sy = obj.y * zoom + panY;
  const sw = obj.w * zoom;
  const sh = obj.h * zoom;

  selOverlay.style.left   = sx + 'px';
  selOverlay.style.top    = sy + 'px';
  selOverlay.style.width  = sw + 'px';
  selOverlay.style.height = sh + 'px';
  selOverlay.classList.add('visible');
}

// Init overlay handle listeners once — they always operate on selectedId
(function initOverlayHandles() {
  for (const handle of selOverlay.querySelectorAll('.s-handle')) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      if (!selectedId) return;
      const obj = objectsMap.get(selectedId);
      if (!obj) return;

      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;
      const { x: ox, y: oy, w: ow, h: oh } = obj;
      const MIN = 20;

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

        obj.x = x; obj.y = y; obj.w = w; obj.h = h;
        drawBoard();
        updateSelectionOverlay();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
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
  selectedId = id;
  const obj = objectsMap.get(id);
  if (obj) obj.z = ++zCounter;
  updateSelectionOverlay();
}

function deselectAll() {
  if (editingId) exitEdit();
  selectedId = null;
  updateSelectionOverlay();
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

function updateEditorOverlay() {
  if (!editingId) return;
  const obj = objectsMap.get(editingId);
  const ta  = document.getElementById('board-editor');
  if (!obj || !ta) return;
  const sx = obj.x * zoom + panX;
  const sy = obj.y * zoom + panY;
  ta.style.transform = `matrix(${zoom},0,0,${zoom},${sx},${sy})`;
}

function enterEdit(id) {
  if (editingId === id) return;
  if (editingId) exitEdit();
  editingId = id;

  const obj = objectsMap.get(id);
  if (!obj) return;

  drawBoard(); // hides the object from canvas (editingId check in drawBoard)

  const ta = document.createElement('textarea');
  ta.id = 'board-editor';
  ta.className = 'obj-text-editor';
  ta.value = obj.data.content;
  ta.style.left         = '0';
  ta.style.top          = '0';
  ta.style.width        = obj.w + 'px';
  ta.style.height       = obj.h + 'px';
  ta.style.fontSize     = FONT_SIZE + 'px';
  ta.style.lineHeight   = LINE_H + 'px';
  ta.style.padding      = TEXT_PAD + 'px';
  ta.style.transformOrigin = '0 0';
  ta.style.transform    = `matrix(${zoom},0,0,${zoom},${obj.x * zoom + panX},${obj.y * zoom + panY})`;
  canvas.appendChild(ta);
  _editEl = ta;
  ta.focus({ preventScroll: true });
  // Prevent WebKit scroll-into-view from shifting the canvas div
  canvas.scrollTop = 0;
  canvas.scrollLeft = 0;
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function exitEdit() {
  if (!editingId) return;
  const id = editingId;
  editingId = null;
  _editEl = null;

  const ta  = document.getElementById('board-editor');
  const obj = objectsMap.get(id);

  if (ta) {
    const newContent = ta.value;
    ta.remove();
    if (obj) {
      if (newContent.trim() === '') {
        objects = objects.filter(o => o.id !== id);
        objectsMap.delete(id);
        selectedId = null;
        drawBoard();
        updateSelectionOverlay();
        pushHistory();
        return;
      }
      if (newContent !== obj.data.content) {
        obj.data.content = newContent;
        pushHistory();
      }
    }
  }

  drawBoard();
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
  drawBoard();
  pushHistory();
  if (!content) enterEdit(obj.id);
}

function addImage(src, cx, cy) {
  const img = new Image();
  img.onload = () => {
    const MAX = 800;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > MAX || h > MAX) {
      const scale = MAX / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const imgKey = storeImage(src);
    const obj = { id: newId(), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, z: ++zCounter, data: { imgKey } };
    objects.push(obj);
    objectsMap.set(obj.id, obj);
    selectObject(obj.id);
    drawBoard();
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
  objects = [];
  objectsMap.clear();
  currentFilePath = null;
  panX = 0; panY = 0; zoom = 1;
  clearImageStore();
  history = []; historyIndex = -1;
  idCounter = 1; zCounter = 1;
  renderAll();
  applyTransform();
  snapshot();
  markSaved();
  updateTitle();
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

function duplicateSelected() {
  if (!selectedId) return;
  const obj = objectsMap.get(selectedId);
  if (!obj) return;
  const newObj = JSON.parse(JSON.stringify(obj));
  newObj.id = newId();
  newObj.x += 20;
  newObj.y += 20;
  newObj.z = ++zCounter;
  objects.push(newObj);
  objectsMap.set(newObj.id, newObj);
  selectObject(newObj.id);
  drawBoard();
  pushHistory();
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!selectedId || editingId) return;
  objects = objects.filter(o => o.id !== selectedId);
  objectsMap.delete(selectedId);
  selectedId = null;
  drawBoard();
  updateSelectionOverlay();
  pushHistory();
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.05, ZOOM_MAX = 10;

let _caretTimer = null;
let _editEl = null;
let _setMode  = null; // 'pan' | 'zoom' | null (null = no active set)
let _setTimer = null;


canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (_editEl) {
    _editEl.style.caretColor = 'transparent';
    clearTimeout(_caretTimer);
    _caretTimer = setTimeout(() => {
      if (_editEl) _editEl.style.caretColor = '';
    }, 150);
  }
  if (e.ctrlKey) {
    // Trackpad pinch sends small continuous deltaY (< 30); mouse Ctrl+scroll sends large discrete steps (~100)
    const factor = Math.abs(e.deltaY) < 30
      ? Math.pow(0.995, e.deltaY)          // smooth continuous pinch
      : e.deltaY < 0 ? 1.1 : 1 / 1.1;    // stepped Ctrl+scroll
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    panX = e.clientX - (e.clientX - panX) * (newZoom / zoom);
    panY = e.clientY - (e.clientY - panY) * (newZoom / zoom);
    zoom = newZoom;
    scheduleTransform();
    return;
  }
  // First event of a new set classifies the whole set (250ms gap = new set).
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

  if (!obj) {
    deselectAll();
    return;
  }

  if (editingId && editingId !== obj.id) exitEdit();

  const startX = e.clientX, startY = e.clientY;
  const ox = obj.x, oy = obj.y;
  let moved = false;

  function onMove(ev) {
    const dx = (ev.clientX - startX) / zoom;
    const dy = (ev.clientY - startY) / zoom;
    if (!moved && Math.hypot(dx, dy) > 3 / zoom) { moved = true; selectObject(obj.id); }
    if (moved) { obj.x = ox + dx; obj.y = oy + dy; drawBoard(); updateSelectionOverlay(); }
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!moved) selectObject(obj.id);
    if (moved) pushHistory();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

canvas.addEventListener('dblclick', (e) => {
  const wp = toWorld(e.clientX, e.clientY);
  const obj = hitTest(wp.x, wp.y);
  if (obj && obj.type === 'text') { selectObject(obj.id); enterEdit(obj.id); }
});

// Prevent middle-click scroll/autoscroll behavior
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// ─── Context menu ─────────────────────────────────────────────────────────────

let ctxPos = { x: 0, y: 0 };

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const wp = toWorld(e.clientX, e.clientY);
  const obj = hitTest(wp.x, wp.y);
  if (obj) {
    ctxMenu.classList.remove('visible');
    selectObject(obj.id);
    objCtxMenu.style.left = e.clientX + 'px';
    objCtxMenu.style.top  = e.clientY + 'px';
    objCtxMenu.classList.add('visible');
    return;
  }
  objCtxMenu.classList.remove('visible');
  ctxPos = wp;
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

// ─── Drag and drop images ─────────────────────────────────────────────────────

let _dropPos = { x: 0, y: 0 };

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  _dropPos = { x: e.clientX, y: e.clientY };
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
  window.__TAURI__.core.invoke('set_title', { title: 'Boardfish — ' + name + dot });
}


// ─── Unsaved changes dialog ───────────────────────────────────────────────────

const dialogOverlay = document.getElementById('dialog-overlay');

// Returns 'save' | 'discard' | 'cancel'
function showUnsavedDialog() {
  return new Promise((resolve) => {
    dialogOverlay.classList.add('show');

    function cleanup(result) {
      dialogOverlay.classList.remove('show');
      document.getElementById('dlg-save').removeEventListener('click', onSave);
      document.getElementById('dlg-discard').removeEventListener('click', onDiscard);
      document.getElementById('dlg-cancel').removeEventListener('click', onCancel);
      resolve(result);
    }

    function onSave()    { cleanup('save'); }
    function onDiscard() { cleanup('discard'); }
    function onCancel()  { cleanup('cancel'); }

    document.getElementById('dlg-save').addEventListener('click', onSave);
    document.getElementById('dlg-discard').addEventListener('click', onDiscard);
    document.getElementById('dlg-cancel').addEventListener('click', onCancel);
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
  objects = data.objects || [];
  rebuildObjectsMap();
  for (const obj of objects) {
    const n = parseInt(obj.id.split('-')[1]);
    if (!isNaN(n) && n >= idCounter) idCounter = n + 1;
    if (obj.z >= zCounter) zCounter = obj.z + 1;
  }
  if (data.viewport) { panX = data.viewport.panX; panY = data.viewport.panY; zoom = data.viewport.zoom; }
  renderAll();
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
    showIslandMsg('Save failed', 2000);
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
      showIslandMsg('Save failed', 2000);
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
  } catch (err) { console.error('Open failed:', err); showIslandMsg('Open failed', 2000); }
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

// When the user switches away and copies something else, clear in-app clipboard
// so the next paste uses whatever is most recent on the system clipboard
window.addEventListener('focus', () => { jsClipboard = null; });

async function copySelected() {
  if (!selectedId) return;
  const obj = objectsMap.get(selectedId);
  if (!obj) return;

  if (obj.type === 'text') {
    jsClipboard = { type: 'text', content: obj.data.content };
    try { await navigator.clipboard.writeText(obj.data.content); } catch {}
    return;
  }

  if (obj.type === 'image') {
    jsClipboard = { type: 'image', imgKey: obj.data.imgKey };
    // Also write to system clipboard so user can paste into other apps
    if (window.__TAURI__) {
      try {
        await window.__TAURI__.core.invoke('copy_image_to_clipboard', { dataUrl: getImageSrc(obj) });
      } catch (err) { console.error('System clipboard write failed:', err); }
    }
  }
}

async function pasteAtPos(wx, wy) {
  if (jsClipboard) {
    if (jsClipboard.type === 'image') {
      const src = imageStore[jsClipboard.imgKey];
      if (src) { addImage(src, wx, wy); return; }
    } else if (jsClipboard.type === 'text') {
      addText(wx - 100, wy - 40, jsClipboard.content);
      return;
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
    if (jsClipboard.type === 'image') {
      const src = imageStore[jsClipboard.imgKey];
      if (src) { addImage(src, center.x, center.y); return; }
    } else if (jsClipboard.type === 'text') {
      addText(center.x - 100, center.y - 40, jsClipboard.content);
      return;
    }
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

  if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBoard(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingId) { copySelected(); return; }

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
