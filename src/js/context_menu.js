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
  closeOpenMenusExcept('ctx-menu', 'open-ctx-menu');
  openMenuAt(ctxMenu, x, y);
  if (!ctxActions || !ctxActions.querySelector('.ctx-action-item')) return;

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

function menuSurfaces() {
  return [
    { id: 'ctx-menu', close: closeCtxMenu },
    { id: 'obj-ctx-menu', close: closeObjCtxMenu },
  ];
}

function closeOpenMenusExcept(activeMenuId = '', reason = 'menu-switch') {
  for (const surface of menuSurfaces()) {
    if (surface.id === activeMenuId || typeof surface.close !== 'function') continue;
    surface.close(`${reason}:switch`);
  }
}

function openExclusiveMenuAt(menu, menuId, x, y, reason) {
  closeOpenMenusExcept(menuId, reason);
  openMenuAt(menu, x, y);
}
var _menuPointerCommand = null;
var _menuMouseCommand = null;
var _lastPointerMenuCommandAt = 0;
var MENU_COMMANDS = {
  'btn-new': () => { closeCtxMenu('command:new'); newBoard(); },
  'btn-add-text': () => { closeCtxMenu('command:add-text'); addText(ctxPos.x, ctxPos.y); },
  'btn-add-image': () => { closeCtxMenu('command:add-image'); pickAndInsertImages(ctxPos.x, ctxPos.y); },
  'btn-paste': () => { closeCtxMenu('command:paste'); pasteAtPos(ctxPos.x, ctxPos.y); },
  'btn-reset-zoom': () => { closeCtxMenu('command:reset-zoom'); resetZoomToClosestObject(); },
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
  if (button?.disabled) {
    MenuDebug.log('menu:command:blocked', { command, source, reason: 'disabled' });
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

function pointToObjectCenterDistanceSq(point, obj) {
  const dx = point.x - (obj.x + obj.w / 2);
  const dy = point.y - (obj.y + obj.h / 2);
  return dx * dx + dy * dy;
}

function closestResetZoomObjectToViewportCenter() {
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  const hasImages = objects.some((obj) => obj?.type === 'image');
  const targetType = hasImages ? 'image' : 'text';
  let closest = null;
  let closestDistanceSq = Infinity;
  for (const obj of objects) {
    if (obj?.type !== targetType) continue;
    const distanceSq = pointToObjectCenterDistanceSq(center, obj);
    if (distanceSq < closestDistanceSq) {
      closest = obj;
      closestDistanceSq = distanceSq;
    }
  }
  return { object: closest, targetType, distanceSq: closestDistanceSq, center };
}

function resetZoomToClosestObject() {
  const dbg = ViewportDebug.start('resetZoom', { panX, panY, zoom, objectCount: objects.length });
  const { object, targetType, distanceSq, center } = closestResetZoomObjectToViewportCenter();
  if (!object) {
    ViewportDebug.end(dbg, { skipped: 'no-reset-target' });
    return false;
  }
  const targetZoom = 1;
  const objectCenterX = object.x + object.w / 2;
  const objectCenterY = object.y + object.h / 2;
  BoardfishViewportState.setZoomPan(
    targetZoom,
    window.innerWidth / 2 - objectCenterX * targetZoom,
    window.innerHeight / 2 - objectCenterY * targetZoom,
  );
  scheduleTransform('reset-zoom');
  ViewportDebug.end(dbg, {
    objectId: object.id,
    objectType: targetType,
    distanceSq,
    centerX: center.x,
    centerY: center.y,
    objectCenterX,
    objectCenterY,
    panX,
    panY,
    zoom,
  });
  return true;
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
  let selectedCount = 0;
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (!o) continue;
    selectedCount++;
    if (o.type === 'image') imageCount++;
  }
  const multiSelected = isMultiSelected();
  const showImageActions = imageCount >= 1;
  const showLayerActions = selectedCount >= 1;
  const showExport = imageCount >= 1;
  const showDelete = selectedCount >= 1;
  if (copyBtn) copyBtn.style.display = '';
  if (imageActionsSep) imageActionsSep.style.display = showImageActions ? 'block' : 'none';
  if (flipHorizontalBtn) flipHorizontalBtn.style.display = showImageActions ? '' : 'none';
  if (flipVerticalBtn) flipVerticalBtn.style.display = showImageActions ? '' : 'none';
  if (rotateBtn) rotateBtn.style.display = showImageActions ? '' : 'none';
  if (layerActionsSep) layerActionsSep.style.display = showLayerActions ? 'block' : 'none';
  if (moveToBackBtn) moveToBackBtn.style.display = showLayerActions ? '' : 'none';
  if (saveImageBtn) saveImageBtn.style.display = !multiSelected && imageCount === 1 ? '' : 'none';
  if (saveImagesBtn) {
    const label = saveImagesBtn.querySelector?.('.ctx-label');
    if (label) label.textContent = imageCount === 1 ? 'Export Image' : 'Export Images';
    else saveImagesBtn.textContent = imageCount === 1 ? 'Export Image' : 'Export Images';
    saveImagesBtn.style.display = multiSelected && imageCount >= 1 ? '' : 'none';
  }
  if (exportSep) exportSep.style.display = showExport ? 'block' : 'none';
  if (deleteSep) deleteSep.style.display = showDelete ? 'block' : 'none';
  if (deleteBtn) deleteBtn.style.display = showDelete ? '' : 'none';
}

function updateCtxMenuActions() {
  const hasImages = objects.some((o) => o.type === 'image');
  const hasText   = objects.some((o) => o.type === 'text');
  const show = hasImages || hasText;
  if (resetZoomSep) resetZoomSep.style.display = show ? 'block' : 'none';
  if (resetZoomBtn) resetZoomBtn.style.display = show ? '' : 'none';
  if (exportAllTextBtn) exportAllTextBtn.style.display = show && hasText ? '' : 'none';
  if (exportAllImageBtn) exportAllImageBtn.style.display = show && hasImages ? '' : 'none';
  if (exportAllSep) exportAllSep.style.display = show ? 'block' : 'none';
}

function showCanvasContextMenuAt(clientX, clientY) {
  if (_rubberBandDragActive) {
    MenuDebug.log('canvas:contextmenu:blocked-rubber-band', { x: clientX, y: clientY });
    return;
  }
  const wp = toWorld(clientX, clientY);
  MenuDebug.log('canvas:contextmenu', { x: clientX, y: clientY, wx: wp.x, wy: wp.y });

  if (eyedropperEnabled) {
    closeOpenMenusExcept('', 'canvas-contextmenu:eyedropper');
    MenuDebug.log('canvas:contextmenu:blocked-eyedropper', { x: clientX, y: clientY, wx: wp.x, wy: wp.y });
    return;
  }

  const obj = hitTest(wp.x, wp.y);

  // Multi-select: right-click anywhere inside the selected bounding box shows
  // the group menu.
  if (isMultiSelected()) {
    if (rectContainsPoint(selectedBounds(), wp) && (!obj || isSelected(obj.id))) {
      updateObjMenuActions();
      openExclusiveMenuAt(objCtxMenu, 'obj-ctx-menu', clientX, clientY, 'show-obj-menu:multi');
      MenuDebug.log('obj-ctx-menu:open', { reason: 'multi', x: clientX, y: clientY });
      return;
    }
  }

  MenuDebug.log('canvas:contextmenu-hit', {
    hit: !!obj,
    objectId: obj?.id || '',
    objectType: obj?.type || '',
    selectedCount: selectedIds.size,
    x: clientX,
    y: clientY,
    wx: wp.x,
    wy: wp.y,
  });
  if (obj) {
    if (!isSelected(obj.id)) selectObject(obj.id);
    updateObjMenuActions();
    openExclusiveMenuAt(objCtxMenu, 'obj-ctx-menu', clientX, clientY, 'show-obj-menu:object');
    MenuDebug.log('obj-ctx-menu:open', { reason: 'object', objectId: obj.id, objectType: obj.type, x: clientX, y: clientY });
    return;
  }
  ctxPos = wp;
  updateCtxMenuActions();
  openCtxMenuAt(clientX, clientY);
  MenuDebug.log('ctx-menu:open', { x: clientX, y: clientY, wx: wp.x, wy: wp.y });
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showCanvasContextMenuAt(e.clientX, e.clientY);
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
  closeOpenMenusExcept('', 'document-click');
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
  if (ctxActions?.contains(e.currentTarget) && !isCtxActionHotspotEvent(e, e.currentTarget)) return;
  closeCtxMenu('command:dark-mode');
  Promise.resolve(toggleAppTheme()).finally(updateCtxActionStates);
});
