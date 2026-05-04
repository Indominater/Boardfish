// ─── Context menu ─────────────────────────────────────────────────────────────
var ctxPos = { x: 0, y: 0 };

function clampMenuCoord(value, size, margin = MENU_VIEWPORT_EDGE_MARGIN) {
  const max = Math.max(margin, window.innerWidth - size - margin);
  return Math.max(margin, Math.min(max, value));
}

function clampMenuTop(value, size, margin = MENU_VIEWPORT_EDGE_MARGIN) {
  const max = Math.max(margin, window.innerHeight - size - margin);
  return Math.max(margin, Math.min(max, value));
}

function openMenuAt(menu, x, y) {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('visible');
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.round(clampMenuCoord(x, rect.width))}px`;
  menu.style.top = `${Math.round(clampMenuTop(y, rect.height))}px`;
}

function menuGapPx() {
  const value = parseFloat(cssVar('--menu-shell-padding'));
  return Number.isFinite(value) ? value : 8;
}

function updateCtxActionStates() {
  if (darkModeMenuBtn) darkModeMenuBtn.setAttribute('aria-pressed', appTheme === 'dark' ? 'true' : 'false');
  if (eyedropperMenuBtn) eyedropperMenuBtn.setAttribute('aria-pressed', eyedropperEnabled ? 'true' : 'false');
  updateEyedropperCommandState();
}

function closeCtxActions(reason) {
  MenuDebug.log('ctx-actions:close', { reason });
  ctxActions?.classList.remove('visible');
}

function syncCtxActionsWithMenu(reason) {
  if (ctxMenu.classList.contains('visible')) return;
  closeCtxActions(reason);
}

function openCtxMenuAt(x, y) {
  openMenuAt(ctxMenu, x, y);
  if (!ctxActions) return;

  updateCtxActionStates();
  ctxActions.classList.add('visible');
  const gap = menuGapPx();
  const menuRect = ctxMenu.getBoundingClientRect();
  const actionRect = ctxActions.getBoundingClientRect();
  const left = clampMenuCoord(menuRect.left, actionRect.width);
  let top = menuRect.top - actionRect.height - gap;
  if (top < MENU_VIEWPORT_EDGE_MARGIN) top = menuRect.bottom + gap;
  ctxActions.style.left = `${Math.round(left)}px`;
  ctxActions.style.top = `${Math.round(clampMenuTop(top, actionRect.height))}px`;
}

if (ctxActions) {
  new MutationObserver(() => syncCtxActionsWithMenu('ctx-menu-visibility-sync'))
    .observe(ctxMenu, { attributes: true, attributeFilter: ['class'] });
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
  closeCtxActions(reason);
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
  'obj-btn-cut': () => {
    closeObjCtxMenu('command:cut');
    (async () => {
      await copySelected();
      deleteSelected();
    })();
  },
  'obj-btn-delete': () => { closeObjCtxMenu('command:delete'); deleteSelected(); },
  'obj-btn-duplicate': () => { closeObjCtxMenu('command:duplicate'); duplicateSelected(); },
  'obj-btn-move-to-back': () => { closeObjCtxMenu('command:move-to-back'); sendSelectedToBack(); },
  'obj-btn-flip-horizontal': () => { flipSelectedImages('x'); },
  'obj-btn-flip-vertical': () => { flipSelectedImages('y'); },
  'obj-btn-rotate': () => { rotateSelectedImages('cw'); },
  'obj-btn-save-image': () => { closeObjCtxMenu('command:save-image'); saveSelectedImage(); },
  'obj-btn-save-images': () => { closeObjCtxMenu('command:save-images'); showInputShield({ keepSelectionOverlay: true }); saveSelectedImages(); },
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
  if (button?.disabled || isCommandBlockedByEyedropper(button?.id || '')) {
    MenuDebug.log('menu:command:blocked', { command, source, reason: 'eyedropper' });
    return true;
  }
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

function runAddImagesCommandFromShortcut() {
  if (ctxMenu.classList.contains('visible')) {
    runMenuCommand(addImageBtn, 'shortcut');
    return;
  }
  ctxPos = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  runMenuCommand(addImageBtn, 'shortcut');
}

function runAddTextCommandFromShortcut() {
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  const defaultW = 200;
  const defaultH = NEW_TEXT_EDIT_MIN_LINES * LINE_H + TEXT_PAD * 2;
  ctxPos = { x: center.x - defaultW / 2, y: center.y - defaultH / 2 };
  runMenuCommand(addTextBtn, 'shortcut');
}

function onMenuPointerDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || button.disabled || e.button !== 0) return;
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
  if (!button || button.disabled || e.button !== 0) return;
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
for (const menu of [ctxMenu, objCtxMenu, ctxActions].filter(Boolean)) {
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
  if (copyBtn) copyBtn.style.display = '';
  if (imageActionsSep) imageActionsSep.style.display = imageCount >= 1 ? 'block' : 'none';
  if (flipHorizontalBtn) flipHorizontalBtn.style.display = imageCount >= 1 ? '' : 'none';
  if (flipVerticalBtn) flipVerticalBtn.style.display = imageCount >= 1 ? '' : 'none';
  if (rotateBtn) rotateBtn.style.display = imageCount >= 1 ? '' : 'none';
  if (saveImageBtn) saveImageBtn.style.display = !multiSelected && imageCount === 1 ? '' : 'none';
  if (saveImagesBtn) {
    const label = saveImagesBtn.querySelector?.('.ctx-label');
    if (label) label.textContent = imageCount === 1 ? 'Export Image' : 'Export Images';
    else saveImagesBtn.textContent = imageCount === 1 ? 'Export Image' : 'Export Images';
    saveImagesBtn.style.display = multiSelected && imageCount >= 1 ? '' : 'none';
  }
  if (exportSep) exportSep.style.display = imageCount >= 1 ? 'block' : 'none';
}

function updateCtxMenuActions() {
  const hasImages = objects.some((o) => o.type === 'image');
  const hasText   = objects.some((o) => o.type === 'text');
  const show = !eyedropperEnabled && (hasImages || hasText);
  updateEyedropperCommandState();
  if (exportAllTextBtn) exportAllTextBtn.style.display = show && hasText ? '' : 'none';
  if (exportAllImageBtn) exportAllImageBtn.style.display = show && hasImages ? '' : 'none';
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

  if (eyedropperEnabled) {
    hideEyedropperSample();
    closeObjCtxMenu('show-canvas-menu:eyedropper');
    ctxPos = wp;
    updateCtxMenuActions();
    openCtxMenuAt(e.clientX, e.clientY);
    MenuDebug.log('ctx-menu:open', { reason: 'eyedropper', x: e.clientX, y: e.clientY, wx: wp.x, wy: wp.y });
    return;
  }

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
  openCtxMenuAt(e.clientX, e.clientY);
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
  if (ctxMenu.contains(e.target) || objCtxMenu.contains(e.target) || ctxActions?.contains(e.target)) {
    MenuDebug.log('document-click:inside-menu');
    return;
  }
  closeCtxMenu('document-click');
  closeObjCtxMenu('document-click');
});

function ctxActionHotspotRect(button) {
  const rect = button.getBoundingClientRect();
  const inset = parseFloat(cssVar('--menu-shell-padding')) || 0;
  if (!button.classList.contains('ctx-action-icon')) {
    return {
      left: rect.left + inset,
      top: rect.top + inset,
      right: rect.right - inset,
      bottom: rect.bottom - inset,
    };
  }
  const size = parseFloat(cssVar('--menu-item-height')) || Math.max(0, rect.height - inset * 2);
  const cx = rect.left + rect.width / 2;
  return {
    left: cx - size / 2,
    top: rect.top + inset,
    right: cx + size / 2,
    bottom: rect.bottom - inset,
  };
}

function isCtxActionHotspotEvent(e, button) {
  if (!button) return false;
  if (!e.detail && e.clientX === 0 && e.clientY === 0) return true;
  const hot = ctxActionHotspotRect(button);
  return e.clientX >= hot.left && e.clientX <= hot.right && e.clientY >= hot.top && e.clientY <= hot.bottom;
}

function updateCtxActionHotspotState(e, active = false) {
  const button = e.target.closest?.('.ctx-action-item');
  for (const item of ctxActions?.querySelectorAll('.ctx-action-item') || []) {
    const hot = item === button && isCtxActionHotspotEvent(e, item);
    item.classList.toggle('hotspot-hover', hot);
    item.classList.toggle('hotspot-active', active && hot);
  }
}

function clearCtxActionHotspotState() {
  for (const item of ctxActions?.querySelectorAll('.ctx-action-item') || []) {
    item.classList.remove('hotspot-hover', 'hotspot-active');
  }
}

ctxActions?.addEventListener('pointermove', (e) => updateCtxActionHotspotState(e));
ctxActions?.addEventListener('pointerdown', (e) => {
  const button = e.target.closest?.('.ctx-action-item');
  if (!isCtxActionHotspotEvent(e, button)) {
    e.preventDefault();
    e.stopPropagation();
    clearCtxActionHotspotState();
    return;
  }
  updateCtxActionHotspotState(e, true);
});
ctxActions?.addEventListener('pointerup', clearCtxActionHotspotState);
ctxActions?.addEventListener('pointerleave', clearCtxActionHotspotState);

darkModeMenuBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!isCtxActionHotspotEvent(e, e.currentTarget)) return;
  closeCtxMenu('command:dark-mode');
  Promise.resolve(toggleAppTheme()).finally(updateCtxActionStates);
});

eyedropperMenuBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!isCtxActionHotspotEvent(e, e.currentTarget)) return;
  closeCtxMenu('command:eyedropper');
  setEyedropperEnabled(!eyedropperEnabled);
  updateCtxActionStates();
});

islZoom.addEventListener('mousedown', e => e.preventDefault());
island.addEventListener('wheel', (e) => {
  e.preventDefault();
  e.stopPropagation();
}, { capture: true, passive: false });
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
    BoardfishViewportState.setZoomPan(
      startZoom + (targetZoom - startZoom) * e,
      startPanX + (targetPanX - startPanX) * e,
      startPanY + (targetPanY - startPanY) * e,
    );
    ViewportDebug.step(dbg, 'animate', { t, panX, panY, zoom });
    applyTransform();
    if (t < 1) requestAnimationFrame(animate);
    else ViewportDebug.end(dbg, { panX, panY, zoom });
  }
  requestAnimationFrame(animate);
});
