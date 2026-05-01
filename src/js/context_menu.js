// ─── Context menu ─────────────────────────────────────────────────────────────
var ctxPos = { x: 0, y: 0 };

function openMenuAt(menu, x, y) {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('visible');
}

if (DEBUG_TOOLS_ENABLED) {
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu']) {
    document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:capture`, e), true);
    document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:bubble`, e), false);
    ctxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`ctx-menu:${type}`, e));
    objCtxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`obj-ctx-menu:${type}`, e));
  }
}

function closeCtxMenu(reason) {
  MenuDebug.log('ctx-menu:close', { reason });
  ctxMenu.classList.remove('visible');
}

function closeObjCtxMenu(reason) {
  MenuDebug.log('obj-ctx-menu:close', { reason });
  objCtxMenu.classList.remove('visible');
}
var _menuPointerCommand = null;
var _menuMouseCommand = null;
var _lastPointerMenuCommandAt = 0;
var MENU_COMMANDS = {
  'btn-new': () => { closeCtxMenu('command:new'); newBoard(); },
  'btn-add-text': () => { closeCtxMenu('command:add-text'); addText(ctxPos.x, ctxPos.y); },
  'btn-add-image': () => { closeCtxMenu('command:add-image'); pickAndInsertImages(ctxPos.x, ctxPos.y); },
  'btn-paste': () => { closeCtxMenu('command:paste'); pasteAtPos(ctxPos.x, ctxPos.y); },
  'btn-save': () => { closeCtxMenu('command:save'); saveBoard(); },
  'btn-save-as': () => { closeCtxMenu('command:save-as'); saveBoardAs(); },
  'btn-open': () => { closeCtxMenu('command:open'); openBoard(); },
  'btn-export-all-images': () => { closeCtxMenu('command:export-all-images'); showInputShield(); exportAllImages(); },
  'btn-export-all-text': () => { closeCtxMenu('command:export-all-text'); exportAllText(); },
  'obj-btn-copy': () => { closeObjCtxMenu('command:copy'); copySelected(); },
  'obj-btn-delete': () => { closeObjCtxMenu('command:delete'); deleteSelected(); },
  'obj-btn-duplicate': () => { closeObjCtxMenu('command:duplicate'); duplicateSelected(); },
  'obj-btn-move-to-back': () => { closeObjCtxMenu('command:move-to-back'); sendSelectedToBack(); },
  'obj-btn-flip-horizontal': () => { flipSelectedImages('x'); },
  'obj-btn-flip-vertical': () => { flipSelectedImages('y'); },
  'obj-btn-rotate': () => { rotateSelectedImages('cw'); },
  'obj-btn-save-image': () => { closeObjCtxMenu('command:save-image'); saveSelectedImage(); },
  'obj-btn-save-images': () => { closeObjCtxMenu('command:save-images'); showInputShield(); saveSelectedImages(); },
};

function menuCommandFromButton(button) {
  return button?.id ? MENU_COMMANDS[button.id] || null : null;
}

function menuCommandName(button) {
  return button?.id ? button.id.replace(/^(btn|obj-btn)-/, '') : '';
}

function runMenuCommand(button, source) {
  const run = menuCommandFromButton(button);
  const command = menuCommandName(button);
  if (!run) {
    MenuDebug.log('menu:command:missing', { command, source, target: button?.id || '' });
    return false;
  }
  if ((source === 'click' || source === 'mouseup') && performance.now() - _lastPointerMenuCommandAt < 800) {
    MenuDebug.log('menu:click-command:suppressed', { command });
    return true;
  }
  MenuDebug.log(button.id.startsWith('obj-') ? 'obj-ctx-menu:command' : 'ctx-menu:command', {
    command,
    source,
  });
  if (source === 'pointerup' || source === 'mouseup') _lastPointerMenuCommandAt = performance.now();
  const runWithDebug = () => {
    MenuDebug.log('menu:command:start', { command, source });
    try {
      run();
      MenuDebug.log('menu:command:end', { command, source });
    } catch (err) {
      MenuDebug.log('menu:command:error', { command, source, error: String(err) });
      console.error('[Boardfish menu] command failed:', command, err);
    }
  };
  if (source === 'pointerup') {
    setTimeout(runWithDebug, 0);
  } else {
    runWithDebug();
  }
  return true;
}

function onMenuPointerDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || e.button !== 0) return;
  e.stopPropagation();
  _menuPointerCommand = button;
  MenuDebug.log('menu:pointer-command:start', { command: menuCommandName(button), target: button.id });
}

function onMenuPointerUp(e) {
  if (!_menuPointerCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuPointerCommand;
  _menuPointerCommand = null;
  if (button !== started) {
    MenuDebug.log('menu:pointer-command:cancel', { started: started.id, ended: button?.id || '' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  runMenuCommand(button, 'pointerup');
}

function onMenuMouseDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || e.button !== 0) return;
  _menuMouseCommand = button;
  MenuDebug.log('menu:mouse-command:start', { command: menuCommandName(button), target: button.id });
}

function onMenuMouseUp(e) {
  if (!_menuMouseCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuMouseCommand;
  _menuMouseCommand = null;
  if (button !== started) {
    MenuDebug.log('menu:mouse-command:cancel', { started: started.id, ended: button?.id || '' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  runMenuCommand(button, 'mouseup');
}

ctxMenu.addEventListener('pointerdown', onMenuPointerDown);
ctxMenu.addEventListener('pointerup', onMenuPointerUp);
objCtxMenu.addEventListener('pointerdown', onMenuPointerDown);
objCtxMenu.addEventListener('pointerup', onMenuPointerUp);
ctxMenu.addEventListener('mousedown', onMenuMouseDown);
ctxMenu.addEventListener('mouseup', onMenuMouseUp);
objCtxMenu.addEventListener('mousedown', onMenuMouseDown);
objCtxMenu.addEventListener('mouseup', onMenuMouseUp);
for (const menu of [ctxMenu, objCtxMenu]) {
  for (const type of ['click', 'contextmenu']) {
    menu.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'contextmenu') e.preventDefault();
    });
  }
}

function updateObjMenuActions() {
  let imageCount = 0;
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (o && o.type === 'image') imageCount++;
  }
  const multiSelected = isMultiSelected();
  if (copyBtn) copyBtn.style.display = 'block';
  if (imageActionsSep) imageActionsSep.style.display = imageCount >= 1 ? 'block' : 'none';
  if (flipHorizontalBtn) flipHorizontalBtn.style.display = imageCount >= 1 ? 'block' : 'none';
  if (flipVerticalBtn) flipVerticalBtn.style.display = imageCount >= 1 ? 'block' : 'none';
  if (rotateBtn) rotateBtn.style.display = imageCount >= 1 ? 'block' : 'none';
  if (saveImageBtn) saveImageBtn.style.display = !multiSelected && imageCount === 1 ? 'block' : 'none';
  if (saveImagesBtn) {
    saveImagesBtn.textContent = imageCount === 1 ? 'Export Image' : 'Export Images';
    saveImagesBtn.style.display = multiSelected && imageCount >= 1 ? 'block' : 'none';
  }
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
  if (_rubberBandDragActive) {
    MenuDebug.log('canvas:contextmenu:blocked-rubber-band', { x: e.clientX, y: e.clientY });
    return;
  }
  const wp = toWorld(e.clientX, e.clientY);
  MenuDebug.log('canvas:contextmenu', { x: e.clientX, y: e.clientY, wx: wp.x, wy: wp.y });

  // Multi-select: right-click anywhere inside bounding box shows obj menu
  if (isMultiSelected()) {
    if (rectContainsPoint(selectedBounds(), wp)) {
      updateObjMenuActions();
      closeCtxMenu('show-obj-menu:multi');
      openMenuAt(objCtxMenu, e.clientX, e.clientY);
      MenuDebug.log('obj-ctx-menu:open', { reason: 'multi', x: e.clientX, y: e.clientY });
      return;
    }
  }

  const obj = hitTest(wp.x, wp.y);
  MenuDebug.log('canvas:contextmenu-hit', {
    hit: !!obj,
    objectId: obj?.id || '',
    objectType: obj?.type || '',
    selectedCount: selectedIds.size,
    x: e.clientX,
    y: e.clientY,
    wx: wp.x,
    wy: wp.y,
  });
  if (obj) {
    if (!isSelected(obj.id)) selectObject(obj.id);
    updateObjMenuActions();
    closeCtxMenu('show-obj-menu:object');
    openMenuAt(objCtxMenu, e.clientX, e.clientY);
    MenuDebug.log('obj-ctx-menu:open', { reason: 'object', objectId: obj.id, objectType: obj.type, x: e.clientX, y: e.clientY });
    return;
  }
  closeObjCtxMenu('show-canvas-menu');
  ctxPos = wp;
  updateCtxMenuActions();
  openMenuAt(ctxMenu, e.clientX, e.clientY);
  MenuDebug.log('ctx-menu:open', { x: e.clientX, y: e.clientY, wx: wp.x, wy: wp.y });
});

for (const id of Object.keys(MENU_COMMANDS)) {
  document.getElementById(id)?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    runMenuCommand(event.currentTarget, 'click');
  });
}


document.addEventListener('click', (e) => {
  if (ctxMenu.contains(e.target) || objCtxMenu.contains(e.target)) {
    MenuDebug.log('document-click:inside-menu');
    return;
  }
  closeCtxMenu('document-click');
  closeObjCtxMenu('document-click');
});

islZoom.addEventListener('mousedown', e => e.preventDefault());
islZoom.addEventListener('click', () => {
  if (_imageCopyInFlight > 0) return;
  const dbg = ViewportDebug.start('zoomReset', { panX, panY, zoom, objectCount: objects.length });
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
    ViewportDebug.step(dbg, 'animate', { t, panX, panY, zoom });
    applyTransform();
    if (t < 1) requestAnimationFrame(animate);
    else ViewportDebug.end(dbg, { panX, panY, zoom });
  }
  requestAnimationFrame(animate);
});
