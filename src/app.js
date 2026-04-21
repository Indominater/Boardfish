'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────

const canvas     = document.getElementById('canvas');
const world      = document.getElementById('world');
const ctxMenu    = document.getElementById('ctx-menu');
const fileInput  = document.getElementById('file-input');
const selOverlay = document.getElementById('sel-overlay');
const islZoom    = document.getElementById('isl-zoom');
const objCtxMenu = document.getElementById('obj-ctx-menu');

// ─── Background canvas (eliminates contrails by explicit repaint) ─────────────

const bgCanvas = document.getElementById('canvas-bg');
const bgCtx    = bgCanvas.getContext('2d');

function resizeBg() {
  bgCanvas.width  = canvas.offsetWidth;
  bgCanvas.height = canvas.offsetHeight;
  paintBg();
}

function paintBg() {
  bgCtx.fillStyle = '#1c1c1e';
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
}

let bgFrames = 0;
let bgRaf    = null;

// After zoom/pan, repaint background for N frames to wipe any contrail pixels
function scheduleBgRepaint(frames = 8) {
  bgFrames = frames;
  if (bgRaf) return;
  function loop() {
    paintBg();
    if (--bgFrames > 0) { bgRaf = requestAnimationFrame(loop); }
    else { bgRaf = null; }
  }
  bgRaf = requestAnimationFrame(loop);
}

window.addEventListener('resize', resizeBg);
resizeBg();

// ─── Viewport ─────────────────────────────────────────────────────────────────

let panX = 0, panY = 0, zoom = 1;

let _vpSaveTimer = null;
function saveViewport() {
  clearTimeout(_vpSaveTimer);
  _vpSaveTimer = setTimeout(() => {
    localStorage.setItem('bf_vp', JSON.stringify({ panX, panY, zoom }));
  }, 400);
}

function updateAllGeom() {
  for (const obj of objects) {
    const el = document.getElementById(obj.id);
    if (el) setElGeom(el, obj);
  }
}

function updateZoomDisplay() {
  islZoom.textContent = Math.round(zoom * 100) + '%';
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
  setTimeout(() => { updateZoomDisplay(); islZoom.style.color = 'rgba(255,255,255,0.38)'; }, 500);
}


function applyTransform() {
  updateAllGeom();
  updateZoomDisplay();
  saveViewport();
  updateSelectionOverlay();
  scheduleBgRepaint();
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

function restoreViewport() {
  try {
    const s = localStorage.getItem('bf_vp');
    if (s) { const v = JSON.parse(s); panX = v.panX; panY = v.panY; zoom = v.zoom; }
  } catch {}
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

// ─── Object state ─────────────────────────────────────────────────────────────

let zCounter = 1;
let selectedId = null;
let editingId  = null;
let objects    = [];
let idCounter  = 1;

function newId() { return 'obj-' + (idCounter++); }

// ─── Image store (keeps base64 data OUT of history snapshots) ─────────────────

const imageStore = {};
let imgKeyCounter = 1;

function storeImage(src) {
  const key = 'img-' + (imgKeyCounter++);
  imageStore[key] = src;
  return key;
}

function getImageSrc(obj) {
  return imageStore[obj.data.imgKey] || '';
}

function clearImageStore() {
  for (const k of Object.keys(imageStore)) delete imageStore[k];
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

function pushHistory(before) {
  history = history.slice(0, historyIndex + 1);
  history.push(before);
  historyIndex++;
  history.push(JSON.parse(JSON.stringify(objects)));
  historyIndex++;
  trimHistory();
}

function restoreSnapshot(s) {
  if (editingId) {
    const el = document.getElementById(editingId);
    if (el) { const pre = el.querySelector('pre'); if (pre) pre.contentEditable = 'false'; el.classList.remove('editing'); }
    editingId = null;
  }
  objects = JSON.parse(JSON.stringify(s));
  if (selectedId && !objects.find(o => o.id === selectedId)) selectedId = null;
  renderAll();
}

function undo() { if (historyIndex <= 0) return; historyIndex--; restoreSnapshot(history[historyIndex]); }
function redo() { if (historyIndex >= history.length - 1) return; historyIndex++; restoreSnapshot(history[historyIndex]); }

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  const liveIds = new Set(objects.map(o => o.id));
  for (const el of [...world.querySelectorAll('.obj')]) {
    if (!liveIds.has(el.id)) el.remove();
  }

  for (const obj of objects) {
    let el = document.getElementById(obj.id);
    if (!el) {
      el = buildElement(obj);
      world.appendChild(el);
    } else {
      setElGeom(el, obj);
      if (obj.type === 'text') {
        const pre = el.querySelector('pre');
        if (pre && pre.contentEditable !== 'true') pre.textContent = obj.data.content;
      }
    }
  }

  const sorted = [...objects].sort((a, b) => a.z - b.z);
  for (const obj of sorted) {
    const el = document.getElementById(obj.id);
    if (el) world.appendChild(el);
  }

  updateSelectionOverlay();
}

function buildElement(obj) {
  const el = document.createElement('div');
  el.className = 'obj obj-' + obj.type;
  el.id = obj.id;
  el.draggable = false;

  const inner = document.createElement('div');
  inner.className = 'obj-inner';

  if (obj.type === 'text') {
    const pre = document.createElement('pre');
    pre.textContent = obj.data.content;
    pre.contentEditable = 'false';
    inner.appendChild(pre);
  } else {
    const img = document.createElement('img');
    img.src = getImageSrc(obj);
    img.draggable = false;
    inner.appendChild(img);
  }

  el.appendChild(inner);
  setElGeom(el, obj);
  el.addEventListener('dragstart', e => e.preventDefault());
  attachObjectListeners(el, obj);
  return el;
}

function setElGeom(el, obj) {
  el.style.left   = (obj.x * zoom + panX) + 'px';
  el.style.top    = (obj.y * zoom + panY) + 'px';
  el.style.width  = (obj.w * zoom) + 'px';
  el.style.height = (obj.h * zoom) + 'px';
  el.style.zIndex = obj.z;
  if (obj.type === 'text') {
    const pre = el.querySelector('pre');
    if (pre) pre.style.fontSize = (16 * zoom) + 'px';
  }
}

// ─── Screen-space selection overlay ──────────────────────────────────────────

function updateSelectionOverlay() {
  if (!selectedId) {
    selOverlay.classList.remove('visible');
    return;
  }
  const obj = objects.find(o => o.id === selectedId);
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
      const obj = objects.find(o => o.id === selectedId);
      if (!obj) return;

      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;
      const { x: ox, y: oy, w: ow, h: oh } = obj;
      const before = JSON.parse(JSON.stringify(objects));
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
        const el = document.getElementById(obj.id);
        if (el) setElGeom(el, obj);
        updateSelectionOverlay();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        pushHistory(before);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
})();

// ─── Object drag ─────────────────────────────────────────────────────────────

function attachObjectListeners(el, obj) {
  let moved = false;
  let before = null;

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isPanMode()) return;
    if (editingId === obj.id && e.target.tagName === 'PRE') return;

    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX, startY = e.clientY;
    const ox = obj.x, oy = obj.y;
    moved = false;
    before = null;

    function onMove(ev) {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      if (!moved && Math.hypot(dx, dy) > 3 / zoom) {
        moved = true;
        before = JSON.parse(JSON.stringify(objects));
        selectObject(obj.id);
      }
      if (moved) {
        obj.x = ox + dx;
        obj.y = oy + dy;
        const domEl = document.getElementById(obj.id);
        if (domEl) { domEl.style.left = (obj.x * zoom + panX) + 'px'; domEl.style.top = (obj.y * zoom + panY) + 'px'; }
        updateSelectionOverlay();
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (moved && before) pushHistory(before);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  el.addEventListener('click', (e) => {
    if (isPanMode()) return;
    e.stopPropagation();
    if (!moved) selectObject(obj.id);
    moved = false;
  });

  el.addEventListener('dblclick', (e) => {
    if (obj.type !== 'text') return;
    if (isPanMode()) return;
    e.stopPropagation();
    selectObject(obj.id);
    enterEdit(obj.id);
  });
}

// ─── Selection ────────────────────────────────────────────────────────────────

function selectObject(id) {
  if (editingId && editingId !== id) exitEdit();
  selectedId = id;
  const obj = objects.find(o => o.id === id);
  if (obj) {
    obj.z = ++zCounter;
    const el = document.getElementById(id);
    if (el) el.style.zIndex = obj.z;
  }
  updateSelectionOverlay();
}

function deselectAll() {
  if (editingId) exitEdit();
  selectedId = null;
  updateSelectionOverlay();
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

function enterEdit(id) {
  if (editingId === id) return;
  if (editingId) exitEdit();
  editingId = id;

  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('editing');

  const pre = el.querySelector('pre');
  if (!pre) return;
  pre.contentEditable = 'true';
  pre.focus();

  const range = document.createRange();
  range.selectNodeContents(pre);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  pre._editBefore = JSON.parse(JSON.stringify(objects));
}

function exitEdit() {
  if (!editingId) return;
  const id = editingId;
  editingId = null;

  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('editing');

  const pre = el.querySelector('pre');
  if (!pre) return;

  const obj = objects.find(o => o.id === id);
  if (obj) {
    const newContent = pre.innerText;
    if (newContent.trim() === '') {
      const before = pre._editBefore || JSON.parse(JSON.stringify(objects));
      objects = objects.filter(o => o.id !== id);
      selectedId = null;
      pre.contentEditable = 'false';
      pre._editBefore = null;
      window.getSelection()?.removeAllRanges();
      renderAll();
      pushHistory(before);
      return;
    }
    if (newContent !== obj.data.content) {
      const before = pre._editBefore || JSON.parse(JSON.stringify(objects));
      obj.data.content = newContent;
      pre.textContent = newContent;
      pushHistory(before);
    }
  }

  pre.contentEditable = 'false';
  pre._editBefore = null;
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

  const before = JSON.parse(JSON.stringify(objects));
  const obj = { id: newId(), type: 'text', x: wx, y: wy, w, h, z: ++zCounter, data: { content } };
  objects.push(obj);
  world.appendChild(buildElement(obj));
  selectObject(obj.id);
  pushHistory(before);
  if (!content) enterEdit(obj.id);
}

function addImage(src, wx, wy) {
  const img = new Image();
  img.onload = () => {
    const MAX = 1000;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > MAX || h > MAX) {
      const scale = MAX / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const before = JSON.parse(JSON.stringify(objects));
    const imgKey = storeImage(src);
    const obj = { id: newId(), type: 'image', x: wx, y: wy, w, h, z: ++zCounter, data: { imgKey } };
    objects.push(obj);
    world.appendChild(buildElement(obj));
    selectObject(obj.id);
    pushHistory(before);
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
  currentFilePath = null;
  panX = 0; panY = 0; zoom = 1;
  clearImageStore();
  history = []; historyIndex = -1;
  idCounter = 1; zCounter = 1;
  renderAll();
  applyTransform();
  snapshot();
  markSaved();
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

function duplicateSelected() {
  if (!selectedId) return;
  const obj = objects.find(o => o.id === selectedId);
  if (!obj) return;
  const before = JSON.parse(JSON.stringify(objects));
  const newObj = JSON.parse(JSON.stringify(obj));
  newObj.id = newId();
  newObj.x += 20;
  newObj.y += 20;
  newObj.z = ++zCounter;
  objects.push(newObj);
  world.appendChild(buildElement(newObj));
  selectObject(newObj.id);
  pushHistory(before);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!selectedId || editingId) return;
  const before = JSON.parse(JSON.stringify(objects));
  objects = objects.filter(o => o.id !== selectedId);
  selectedId = null;
  renderAll();
  pushHistory(before);
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.05, ZOOM_MAX = 10;

let _caretTimer = null;

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (editingId) {
    const editEl = document.getElementById(editingId);
    if (editEl) editEl.classList.add('caret-hidden');
    clearTimeout(_caretTimer);
    _caretTimer = setTimeout(() => {
      if (editingId) {
        const editEl = document.getElementById(editingId);
        if (editEl) editEl.classList.remove('caret-hidden');
      }
    }, 150);
  }
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
  panX = e.clientX - (e.clientX - panX) * (newZoom / zoom);
  panY = e.clientY - (e.clientY - panY) * (newZoom / zoom);
  zoom = newZoom;
  scheduleTransform();
}, { passive: false });

// ─── Pan (middle mouse button) ────────────────────────────────────────────────

function isPanMode() { return false; }

canvas.addEventListener('mousedown', (e) => {
  // Middle mouse button pan
  if (e.button === 1) {
    e.preventDefault();
    e.stopPropagation();
    canvas.classList.add('panning');

    const startX = e.clientX, startY = e.clientY;
    const startPanX = panX, startPanY = panY;

    function onMove(ev) {
      panX = startPanX + (ev.clientX - startX);
      panY = startPanY + (ev.clientY - startY);
      scheduleTransform();
    }

    function onUp(ev) {
      if (ev.button !== 1) return;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      canvas.classList.remove('panning');
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return;
  }

  // Left-click on empty space: drag to pan, click to deselect
  if (e.button === 0 && (e.target === canvas || e.target === world || e.target === canvasBg)) {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startPanX = panX, startPanY = panY;
    let panning = false;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!panning && Math.hypot(dx, dy) > 4) {
        panning = true;
        canvas.classList.add('panning');
      }
      if (panning) {
        panX = startPanX + dx;
        panY = startPanY + dy;
        scheduleTransform();
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      canvas.classList.remove('panning');
      if (!panning) deselectAll();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
}, true);

// Prevent middle-click scroll/autoscroll behavior
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// ─── Context menu ─────────────────────────────────────────────────────────────

let ctxPos = { x: 0, y: 0 };

const canvasBg = document.getElementById('canvas-bg');

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const objEl = e.target.closest('.obj');
  if (objEl) {
    ctxMenu.classList.remove('visible');
    selectObject(objEl.id);
    objCtxMenu.style.left = e.clientX + 'px';
    objCtxMenu.style.top  = e.clientY + 'px';
    objCtxMenu.classList.add('visible');
    return;
  }
  if (e.target !== canvas && e.target !== world && e.target !== canvasBg) return;
  objCtxMenu.classList.remove('visible');
  ctxPos = toWorld(e.clientX, e.clientY);
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

document.getElementById('obj-btn-delete').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  deleteSelected();
});

document.getElementById('obj-btn-duplicate').addEventListener('click', () => {
  objCtxMenu.classList.remove('visible');
  duplicateSelected();
});

// ─── Drag and drop images ─────────────────────────────────────────────────────

canvas.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const pos = toWorld(e.clientX, e.clientY);
  for (const file of [...e.dataTransfer.files]) {
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = (ev) => addImage(ev.target.result, pos.x - 100, pos.y - 100);
    reader.readAsDataURL(file);
  }
});


// ─── Dirty tracking ───────────────────────────────────────────────────────────

// historyIndex at last save (or open). -1 means never saved.
let savedHistoryIndex = -1;
let currentFilePath = null;

function isDirty() {
  // Dirty if board has content and history has changed since last save
  return objects.length > 0 && historyIndex !== savedHistoryIndex;
}

function markSaved() {
  savedHistoryIndex = historyIndex;
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

function boardJson() {
  return new Promise((resolve) => {
    const worker = new Worker('save-worker.js');
    worker.onmessage = (e) => { worker.terminate(); resolve(e.data); };
    worker.postMessage({ version: 2, viewport: { panX, panY, zoom }, imageStore, objects });
  });
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
    }
  }

  if (editingId) exitEdit();
  selectedId = null;
  objects = data.objects || [];
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
  const tauri = window.__TAURI__;
  if (!tauri) { alert('Save requires the desktop app.'); return false; }
  try {
    showIslandMsg('Saving');
    const minTimer = new Promise(r => setTimeout(r, 1500));
    const filePath = await tauri.dialog.save({
      filters: [{ name: 'Boardfish Board', extensions: ['bf'] }],
      defaultPath: currentFilePath || 'board.bf'
    });
    if (!filePath) { restoreIslandZoom(); return false; }
    await Promise.all([
      tauri.fs.writeTextFile(filePath, await boardJson()),
      minTimer
    ]);
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
    const tauri = window.__TAURI__;
    if (!tauri) return false;
    try {
      showIslandMsg('Saving');
      await Promise.all([
        (async () => { await tauri.fs.writeTextFile(currentFilePath, await boardJson()); })(),
        new Promise(r => setTimeout(r, 1500))
      ]);
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
  const tauri = window.__TAURI__;
  if (!tauri) { alert('Open requires the desktop app.'); return; }

  // Check dirty before opening
  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') {
      const saved = await saveBoard();
      if (!saved) return;
    }
  }

  try {
    const filePath = await tauri.dialog.open({
      filters: [{ name: 'Boardfish Board', extensions: ['bf'] }],
      multiple: false
    });
    if (!filePath) return;
    showIslandMsg('Opening');
    const data = JSON.parse(await tauri.fs.readTextFile(filePath));
    applyBoardData(data);
    currentFilePath = filePath;
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
    await window.__TAURI__.process.exit(0);
  });
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

let jsClipboard = null; // in-app clipboard, avoids system clipboard format issues

// When the user switches away and copies something else, clear in-app clipboard
// so the next paste uses whatever is most recent on the system clipboard
window.addEventListener('focus', () => { jsClipboard = null; });

async function copySelected() {
  if (!selectedId) return;
  const obj = objects.find(o => o.id === selectedId);
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
        await window.__TAURI__.tauri.invoke('copy_image_to_clipboard', { dataUrl: getImageSrc(obj) });
      } catch (err) { console.error('System clipboard write failed:', err); }
    }
  }
}

document.addEventListener('paste', (e) => {
  if (editingId) return;
  e.preventDefault();

  // In-app clipboard: handles copy/paste within Boardfish without system clipboard format issues
  if (jsClipboard) {
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    if (jsClipboard.type === 'image') {
      const src = imageStore[jsClipboard.imgKey];
      if (src) { addImage(src, center.x - 100, center.y - 100); return; }
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
            addImage(ev.target.result, center.x - 150, center.y - 150);
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); return; }

  if (e.key === 'Escape') { if (editingId) { exitEdit(); return; } deselectAll(); return; }

  if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBoard(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingId) { copySelected(); return; }

if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) { e.preventDefault(); redo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
});

// ─── Init ────────────────────────────────────────────────────────────────────

snapshot();
updateZoomDisplay();


// If opened by double-clicking a .bf file, load it immediately
if (window.__TAURI__) {
  window.__TAURI__.tauri.invoke('get_startup_file').then(async (filePath) => {
    if (!filePath) return;
    try {
      const data = JSON.parse(await window.__TAURI__.fs.readTextFile(filePath));
      applyBoardData(data);
      currentFilePath = filePath;
    } catch (err) { console.error('Failed to open startup file:', err); }
  });
}
