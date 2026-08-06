// ─── Context menu ─────────────────────────────────────────────────────────────
var ctxPos = { x: 0, y: 0 };
var _lastBoardCursorClientX = null;
var _lastBoardCursorClientY = null;
const BOARD_CURSOR_CLIENT_EVENT_TYPES = Object.freeze([
  'pointerover',
  'pointerenter',
  'pointermove',
  'pointerdown',
  'pointerup',
  'mouseover',
  'mouseenter',
  'mousemove',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'dragenter',
  'dragover',
  'drop',
]);

function rememberBoardCursorClientPoint(event) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  _lastBoardCursorClientX = x;
  _lastBoardCursorClientY = y;
}

function boardCursorWorldPoint() {
  return toWorld(
    _lastBoardCursorClientX ?? window.innerWidth / 2,
    _lastBoardCursorClientY ?? window.innerHeight / 2,
  );
}

function menuCommandWorldPoint(event = null) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  if (Number.isFinite(x) && Number.isFinite(y)) return toWorld(x, y);
  return boardCursorWorldPoint();
}

for (const type of BOARD_CURSOR_CLIENT_EVENT_TYPES) {
  document.addEventListener(type, rememberBoardCursorClientPoint, true);
  window.addEventListener(type, rememberBoardCursorClientPoint, true);
}

function addTextAtMenuCommandPoint(event = null) {
  const point = menuCommandWorldPoint(event);
  closeCtxMenu('command:add-text');
  addText(point.x, point.y, '', { anchor: 'center' });
}

function menuViewportBounds() {
  const viewport = window.visualViewport;
  const left = Number(viewport?.offsetLeft) || 0;
  const top = Number(viewport?.offsetTop) || 0;
  const width = Number(viewport?.width) || Number(window.innerWidth) || 0;
  const height = Number(viewport?.height) || Number(window.innerHeight) || 0;
  const style = getComputedStyle(document.body);
  const inset = (name) => {
    const value = parseFloat(style.getPropertyValue(`--safe-area-${name}`));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };
  const gap = parseFloat(style.getPropertyValue('--menu-shell-padding'));
  return {
    left: left + inset('left'),
    top: top + inset('top'),
    right: left + width - inset('right'),
    bottom: top + height - inset('bottom'),
    gap: Number.isFinite(gap) ? gap : 8,
  };
}

function clampMenuCoord(value, size, start, end, margin = MENU_VIEWPORT_EDGE_MARGIN) {
  const min = start + margin;
  const max = Math.max(min, end - size - margin);
  return Math.max(min, Math.min(max, value));
}

function openMenuAt(menu, x, y) {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('visible');
  const rect = menu.getBoundingClientRect();
  const bounds = menuViewportBounds();
  menu.style.left = `${Math.round(clampMenuCoord(x, rect.width, bounds.left, bounds.right))}px`;
  menu.style.top = `${Math.round(clampMenuCoord(y, rect.height, bounds.top, bounds.bottom))}px`;
  return bounds;
}

const closeFloatingSurface = (surface) => {
  surface?.classList.remove('visible');
};

var ctxActionItems = ctxActions ? ctxActions.getElementsByClassName('ctx-action-item') : [];

function updateCtxActionStates() {
  if (darkModeMenuBtn) darkModeMenuBtn.setAttribute('aria-pressed', appTheme === 'dark' ? 'true' : 'false');
}

function closeCtxActions(reason) {
  MenuDebug.log('ctx-actions:close', { reason });
  closeFloatingSurface(ctxActions);
}

function syncCtxActionsWithMenu(reason) {
  if (ctxMenu.classList.contains('visible')) return;
  closeCtxActions(reason);
}

function alignCtxActionsToMenuRow(gap, viewport) {
  const layoutBox = (surface) => {
    const rect = surface.getBoundingClientRect();
    const left = parseFloat(surface.style.left);
    const top = parseFloat(surface.style.top);
    return {
      left: Number.isFinite(left) ? left : rect.left,
      top: Number.isFinite(top) ? top : rect.top,
      width: surface.offsetWidth || rect.width,
    };
  };
  const menuBox = layoutBox(ctxMenu);
  const actionBox = layoutBox(ctxActions);
  const edgeGap = gap;
  const minActionLeft = viewport.left + edgeGap;
  const maxActionRight = viewport.right - edgeGap;
  const maxActionLeft = Math.max(minActionLeft, maxActionRight - actionBox.width);
  let menuLeft = menuBox.left <= viewport.left + MENU_VIEWPORT_EDGE_MARGIN ? minActionLeft : menuBox.left;
  let actionLeft = menuLeft + menuBox.width + gap;

  if (actionLeft + actionBox.width > maxActionRight) {
    actionLeft = maxActionLeft;
    menuLeft = actionLeft - gap - menuBox.width;
  }

  if (menuLeft < minActionLeft) {
    menuLeft = minActionLeft;
    actionLeft = Math.min(maxActionLeft, menuLeft + menuBox.width + gap);
  }

  ctxMenu.style.left = `${Math.round(menuLeft)}px`;
  ctxActions.style.left = `${Math.round(actionLeft)}px`;
  ctxActions.style.top = `${Math.round(menuBox.top)}px`;
}

function openCtxMenuAt(x, y) {
  closeOpenMenusExcept('ctx-menu', 'open-ctx-menu');
  const viewport = openMenuAt(ctxMenu, x, y);
  if (!ctxActions || !ctxActionItems.length) {
    return;
  }

  updateCtxActionStates();
  ctxActions.classList.add('visible');
  alignCtxActionsToMenuRow(viewport.gap, viewport);
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
    BoardfishDOM.textCtxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`text-ctx-menu:${type}`, e));
  }
}

function closeCtxMenu(reason) {
  MenuDebug.log('ctx-menu:close', { reason });
  clearMenuCommandPressState();
  closeFloatingSurface(ctxMenu);
  closeCtxActions(reason);
}

function closeObjCtxMenu(reason) {
  MenuDebug.log('obj-ctx-menu:close', { reason });
  clearMenuCommandPressState();
  closeFloatingSurface(objCtxMenu);
}

const closeTextCtxMenu = (reason) => {
  MenuDebug.log('text-ctx-menu:close', { reason });
  clearMenuCommandPressState();
  closeFloatingSurface(BoardfishDOM.textCtxMenu);
};

function closeOpenMenusExcept(activeMenuId = '', reason = 'menu-switch') {
  const switchReason = `${reason}:switch`;
  if (activeMenuId !== 'ctx-menu') closeCtxMenu(switchReason);
  if (activeMenuId !== 'obj-ctx-menu') closeObjCtxMenu(switchReason);
  if (activeMenuId !== 'text-ctx-menu') closeTextCtxMenu(switchReason);
}

function openExclusiveMenuAt(menu, menuId, x, y, reason) {
  closeOpenMenusExcept(menuId, reason);
  openMenuAt(menu, x, y);
}
var _menuPointerCommand = null;
var _menuMouseCommand = null;
var _lastPointerMenuCommandAt = 0;

function clearMenuCommandPressState() {
  _menuPointerCommand?.classList.remove('menu-pressed');
  if (_menuMouseCommand !== _menuPointerCommand) _menuMouseCommand?.classList.remove('menu-pressed');
  _menuPointerCommand = null;
  _menuMouseCommand = null;
}

var MENU_COMMANDS = {
  'btn-new': () => { closeCtxMenu('command:new'); newBoard(); },
  'btn-add-text': addTextAtMenuCommandPoint,
  'btn-add-image': (event) => {
    const point = menuCommandWorldPoint(event);
    closeCtxMenu('command:add-image');
    pickAndInsertImages(point.x, point.y);
  },
  'btn-paste': (event) => {
    const point = menuCommandWorldPoint(event);
    closeCtxMenu('command:paste');
    pasteAtPos(point.x, point.y);
  },
  'btn-save': () => { closeCtxMenu('command:save'); saveBoard(); },
  'btn-save-as': () => { closeCtxMenu('command:save-as'); saveBoardAs(); },
  'btn-open': () => { closeCtxMenu('command:open'); openBoard(); },
  'obj-btn-copy': () => { closeObjCtxMenu('command:copy'); copySelected(); },
  'obj-btn-delete': () => { closeObjCtxMenu('command:delete'); deleteSelected(); },
  'obj-btn-duplicate': (event) => {
    const point = menuCommandWorldPoint(event);
    closeObjCtxMenu('command:duplicate');
    duplicateSelected(point);
  },
  'obj-btn-move-to-back': () => { closeObjCtxMenu('command:move-to-back'); sendSelectedToBack(); },
  'obj-btn-flip': () => { flipSelectedImages(); },
  'obj-btn-rotate': () => { rotateSelectedImages('cw'); },
  'obj-btn-save-image': () => { closeObjCtxMenu('command:save-image'); saveSelectedImage(); },
  'obj-btn-save-images': () => { closeObjCtxMenu('command:save-images'); showInputShield({ keepSelectionOverlay: true }); saveSelectedImages(); },
  'text-btn-copy': () => { closeTextCtxMenu('command:copy'); copyTextEditSelection(); },
  'text-btn-paste': () => { closeTextCtxMenu('command:paste'); pasteTextIntoEditSelection(); },
  'text-btn-delete': () => { closeTextCtxMenu('command:delete'); deleteTextEditSelection(); },
};

const getTextEditSelectionState = () => {
  if (!editingId || !_editEl) return null;
  const value = typeof textEditProxyValue === 'function' ? textEditProxyValue(_editEl) : String(_editEl.value ?? '');
  const start = Math.max(0, Math.min(_editEl.selectionStart ?? 0, value.length));
  const end = Math.max(0, Math.min(_editEl.selectionEnd ?? start, value.length));
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    direction: _editEl.selectionDirection || 'none',
    hasSelection: start !== end,
  };
};

const focusTextEditProxy = () => {
  if (!_editEl) return;
  _editEl.focus({ preventScroll: true });
};

const selectedTextForEditMenu = () => {
  const selection = getTextEditSelectionState();
  if (!selection?.hasSelection || !_editEl) return '';
  const value = typeof textEditProxyValue === 'function' ? textEditProxyValue(_editEl) : String(_editEl.value ?? '');
  return value.slice(selection.start, selection.end);
};

const readTextClipboardForEditMenu = async () => {
  try {
    if (navigator.clipboard?.readText) {
      return String(await navigator.clipboard.readText() || '');
    }
  } catch (err) {
    MenuDebug.log('text-ctx-menu:clipboard-text-miss', { error: String(err) });
  }
  return '';
};

const writeTextClipboardFromEditMenu = async (text, { allowEmpty = false } = {}) => {
  if (!text && !allowEmpty) return false;
  clearJsClipboard();
  try {
    await BoardfishClipboardIO.copyTextToClipboard(text);
    return true;
  } catch (err) {
    MenuDebug.log('text-ctx-menu:clipboard-write-miss', { error: String(err) });
    return false;
  }
};

const replaceTextEditSelection = (text, { immediateHistory = false, inputType = 'insertText' } = {}) => {
  const selection = getTextEditSelectionState();
  if (!selection || !_editEl) return false;
  const inputTypeValue = String(inputType || '');
  const normalizedText = normalizeTextContent(text);
  const replacementText = inputTypeValue.toLowerCase().includes('paste') && typeof textForTextObjectPaste === 'function'
    ? textForTextObjectPaste(normalizedText)
    : normalizedText;
  if (inputTypeValue.toLowerCase().includes('paste') && !replacementText) return false;
  const oldValue = typeof textEditProxyValue === 'function' ? textEditProxyValue(_editEl) : String(_editEl.value ?? '');
  const obj = objectsMap.get(editingId);
  const replacementState = {
    ...selection,
    value: oldValue,
    scriptRanges: typeof textEditScriptRanges === 'function' && obj ? textEditScriptRanges(obj) : [],
    inputType,
    replacement: {
      start: selection.start,
      end: selection.end,
      insertedText: replacementText,
    },
  };
  if (typeof nextTextEditInputDebugSeq === 'function') replacementState._debugSeq = nextTextEditInputDebugSeq();
  if (immediateHistory) {
    beginTextEditHistoryAction(editingId, replacementState, { splitPending: true });
  }
  if (typeof setPendingTextEditInputState === 'function') setPendingTextEditInputState(_editEl, replacementState);
  if (typeof setTextEditProxySelectionRange === 'function') {
    setTextEditProxySelectionRange(_editEl, selection.start, selection.end, selection.direction, { value: oldValue });
  } else {
    _editEl.setSelectionRange(selection.start, selection.end, selection.direction);
  }
  const debugNow = typeof textEditorDebugNow === 'function' ? textEditorDebugNow : () => Date.now();
  const debugRound = typeof textEditorDebugRound === 'function'
    ? textEditorDebugRound
    : (value) => Math.round((Number(value) || 0) * 100) / 100;
  const mutationStartedAt = debugNow();
  const mutationResult = typeof replaceTextEditProxyRange === 'function'
    ? replaceTextEditProxyRange(_editEl, replacementText, selection.start, selection.end, 'end', {
      deferDomValue: inputType && String(inputType).toLowerCase().startsWith('delete'),
    })
    : (() => {
      _editEl.setRangeText(replacementText, selection.start, selection.end, 'end');
      return {
        method: 'setRangeText',
        setRangeTextMs: '',
        valueAssignMs: '',
        valueBuildMs: '',
        valueSetMs: '',
        logicalSetMs: '',
        selectionSetMs: '',
      };
    })();
  const mutationMs = debugRound(debugNow() - mutationStartedAt);
  const nextValue = typeof textEditProxyValue === 'function' ? textEditProxyValue(_editEl) : String(_editEl.value ?? '');
  if (typeof recordTextEditorInputPerfStep === 'function') {
    recordTextEditorInputPerfStep('menu-replace-textarea-mutated', {
      seq: replacementState._debugSeq ?? '',
      inputType,
      objectId: editingId,
      textareaMutationMs: mutationMs,
      textareaMutationMethod: mutationResult.method,
      setRangeTextMs: mutationResult.setRangeTextMs || (mutationResult.method === 'setRangeText' ? mutationMs : ''),
      valueAssignMs: mutationResult.valueAssignMs,
      valueBuildMs: mutationResult.valueBuildMs,
      valueSetMs: mutationResult.valueSetMs,
      logicalSetMs: mutationResult.logicalSetMs,
      selectionSetMs: mutationResult.selectionSetMs,
      proxyChars: nextValue.length,
      domProxyChars: String(_editEl.value ?? '').length,
      domValueStale: !!_editEl._boardfishDomValueStale,
      oldChars: oldValue.length,
      nextChars: nextValue.length,
      insertedChars: replacementText.length,
      removedChars: Math.max(0, selection.end - selection.start),
      replacementStart: selection.start,
      replacementEnd: selection.end,
      ...(typeof textEditorSelectionDebugStats === 'function' ? textEditorSelectionDebugStats(selection, oldValue) : {}),
    });
  }
  _caretVisible = true;
  const dispatchStartedAt = debugNow();
  _editEl.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof recordTextEditorInputPerfStep === 'function') {
    recordTextEditorInputPerfStep('menu-replace-input-dispatched', {
      seq: replacementState._debugSeq ?? '',
      inputType,
      objectId: editingId,
      dispatchMs: debugRound(debugNow() - dispatchStartedAt),
    });
  }
  if (immediateHistory) flushEditHistoryCheckpoint();
  focusTextEditProxy();
  scheduleRender(true, false);
  return true;
};

const copyTextEditSelection = async () => {
  const selection = getTextEditSelectionState();
  if (
    selection?.hasSelection &&
    _editEl &&
    typeof copyTextEditSelectionFromProxy === 'function'
  ) {
    await copyTextEditSelectionFromProxy(editingId, _editEl, selection);
    focusTextEditProxy();
    return;
  }
  const value = _editEl && typeof textEditProxyValue === 'function' ? textEditProxyValue(_editEl) : String(_editEl?.value ?? '');
  const selectedText = selection?.hasSelection && _editEl ? value.slice(selection.start, selection.end) : '';
  if (selectedText) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('copy-text-selection', {
      textSelection: {
        id: editingId,
        ...selection,
      },
    });
    scheduleRender(true, false, 'copy-text-selection');
  }
  await writeTextClipboardFromEditMenu(textSelectionForClipboard(selectedText), {
    allowEmpty: !!selectedText,
  });
  focusTextEditProxy();
};

const deleteTextEditSelection = () => {
  if (!selectedTextForEditMenu()) {
    focusTextEditProxy();
    return;
  }
  replaceTextEditSelection('', { immediateHistory: true, inputType: 'deleteContentBackward' });
};

const pasteTextIntoEditSelection = async () => {
  if (
    typeof pasteBoardfishTextSelectionIntoEditSelection === 'function' &&
    await pasteBoardfishTextSelectionIntoEditSelection({ immediateHistory: true })
  ) {
    focusTextEditProxy();
    return;
  }
  const text = await readTextClipboardForEditMenu();
  if (!text) {
    focusTextEditProxy();
    return;
  }
  clearJsClipboard();
  replaceTextEditSelection(text, { immediateHistory: true, inputType: 'insertFromPaste' });
};

function menuCommandFromButton(button) {
  return button?.id ? MENU_COMMANDS[button.id] || null : null;
}

function menuCommandName(button) {
  return button?.id ? button.id.replace(/^(btn|obj-btn|text-btn)-/, '') : '';
}

function runMenuCommand(button, source, commandEvent = null) {
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
  const commandSurface = button.id.startsWith('obj-')
    ? 'obj-ctx-menu:command'
    : button.id.startsWith('text-')
      ? 'text-ctx-menu:command'
      : 'ctx-menu:command';
  MenuDebug.log(commandSurface, {
    command,
    source,
  });
  if (source === 'pointerup' || source === 'mouseup') _lastPointerMenuCommandAt = performance.now();
  const runWithDebug = () => {
    MenuDebug.log('menu:command:start', { command, source });
    try {
      run(commandEvent);
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

function contextMenuSurfaceById(id) {
  if (id === 'ctx-menu') return ctxMenu;
  if (id === 'obj-ctx-menu') return objCtxMenu;
  if (id === 'text-ctx-menu') return BoardfishDOM.textCtxMenu;
  return null;
}

function hasOpenContextMenu() {
  return !!(
    ctxMenu.classList.contains('visible') ||
    objCtxMenu.classList.contains('visible') ||
    BoardfishDOM.textCtxMenu.classList.contains('visible')
  );
}

function isVisibleMenuCommandButton(button) {
  return !!button &&
    !button.hidden &&
    button.style.display !== 'none' &&
    button.getAttribute('aria-hidden') !== 'true';
}

var SHORTCUT_MENU_COMMANDS = {
  'new-board': [['ctx-menu', 'btn-new']],
  'add-text': [['ctx-menu', 'btn-add-text']],
  'add-images': [['ctx-menu', 'btn-add-image']],
  paste: [
    ['text-ctx-menu', 'text-btn-paste'],
    ['ctx-menu', 'btn-paste'],
  ],
  save: [['ctx-menu', 'btn-save']],
  'save-as': [['ctx-menu', 'btn-save-as']],
  open: [['ctx-menu', 'btn-open']],
  copy: [
    ['text-ctx-menu', 'text-btn-copy'],
    ['obj-ctx-menu', 'obj-btn-copy'],
  ],
  duplicate: [['obj-ctx-menu', 'obj-btn-duplicate']],
  'move-to-back': [['obj-ctx-menu', 'obj-btn-move-to-back']],
  'flip-image': [['obj-ctx-menu', 'obj-btn-flip']],
  'rotate-image': [['obj-ctx-menu', 'obj-btn-rotate']],
  'export-image': [
    ['obj-ctx-menu', 'obj-btn-save-image'],
    ['obj-ctx-menu', 'obj-btn-save-images'],
  ],
  delete: [
    ['text-ctx-menu', 'text-btn-delete'],
    ['obj-ctx-menu', 'obj-btn-delete'],
  ],
};

function runVisibleMenuCommandForShortcut(shortcutName) {
  const candidates = SHORTCUT_MENU_COMMANDS[shortcutName] || [];
  for (const [menuId, buttonId] of candidates) {
    const menu = contextMenuSurfaceById(menuId);
    if (!menu?.classList.contains('visible')) continue;
    const button = document.getElementById(buttonId);
    if (!isVisibleMenuCommandButton(button)) continue;
    return runMenuCommand(button, 'shortcut');
  }
  return false;
}

function runAddImagesCommandFromShortcut() {
  if (ctxMenu.classList.contains('visible')) {
    runMenuCommand(addImageBtn, 'shortcut');
    return;
  }
  ctxPos = boardCursorWorldPoint();
  runMenuCommand(addImageBtn, 'shortcut');
}

function runAddTextCommandFromShortcut() {
  if (ctxMenu.classList.contains('visible')) {
    runMenuCommand(addTextBtn, 'shortcut');
    return;
  }
  ctxPos = boardCursorWorldPoint();
  runMenuCommand(addTextBtn, 'shortcut');
}

function pointToObjectCenterDistanceSq(point, obj) {
  const dx = point.x - (obj.x + obj.w / 2);
  const dy = point.y - (obj.y + obj.h / 2);
  return dx * dx + dy * dy;
}

function closestResetZoomObjectToViewportCenter() {
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  let closestImage = null;
  let closestImageDistanceSq = Infinity;
  let closestText = null;
  let closestTextDistanceSq = Infinity;
  for (const obj of objects) {
    if (obj?.type !== 'image' && obj?.type !== 'text') continue;
    const distanceSq = pointToObjectCenterDistanceSq(center, obj);
    if (obj.type === 'image') {
      if (distanceSq < closestImageDistanceSq) {
        closestImage = obj;
        closestImageDistanceSq = distanceSq;
      }
    } else if (distanceSq < closestTextDistanceSq) {
      closestText = obj;
      closestTextDistanceSq = distanceSq;
    }
  }
  const targetType = closestImage ? 'image' : 'text';
  const closest = closestImage || closestText;
  const closestDistanceSq = closestImage ? closestImageDistanceSq : closestTextDistanceSq;
  return { object: closest, targetType, distanceSq: closestDistanceSq, center };
}

function resetZoomToClosestObject() {
  const dbg = ViewportDebug.start('resetZoom', { panX, panY, zoom, objectCount: objects.length });
  if (selectedIds.size || editingId) deselectAll();
  const { object, targetType, distanceSq, center } = closestResetZoomObjectToViewportCenter();
  const targetZoom = 1;
  if (!object) {
    BoardfishViewportState.setZoomPan(
      targetZoom,
      window.innerWidth / 2 - center.x * targetZoom,
      window.innerHeight / 2 - center.y * targetZoom,
    );
    scheduleTransform('reset-zoom');
    ViewportDebug.end(dbg, {
      mode: 'empty-board-center',
      centerX: center.x,
      centerY: center.y,
      panX,
      panY,
      zoom,
    });
    return true;
  }
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

const resetZoomFromPill = (e) => {
  if (island?.dataset?.mode !== 'zoom') return;
  e.preventDefault();
  e.stopPropagation();
  closeOpenMenusExcept('', 'pill-reset-zoom');
  resetZoomToClosestObject();
};

const suppressZoomPillContextMenu = (e) => {
  if (island?.dataset?.mode !== 'zoom') return;
  e.preventDefault();
  e.stopPropagation();
};

island?.addEventListener('click', resetZoomFromPill);
island?.addEventListener('contextmenu', suppressZoomPillContextMenu);

function onMenuPointerDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || e.button !== 0) return;
  e.stopPropagation();
  clearMenuCommandPressState();
  _menuPointerCommand = button;
  button.classList.add('menu-pressed');
  MenuDebug.log('menu:pointer-command:start', { command: menuCommandName(button), target: button.id });
}

function onMenuPointerUp(e) {
  if (!_menuPointerCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuPointerCommand;
  clearMenuCommandPressState();
  if (e.pointerType === 'touch') started.blur?.();
  if (button !== started) {
    MenuDebug.log('menu:pointer-command:cancel', { started: started.id, ended: button?.id || '' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  runMenuCommand(button, 'pointerup', e);
}

function onMenuMouseDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || e.button !== 0) return;
  _menuMouseCommand = button;
  button.classList.add('menu-pressed');
  MenuDebug.log('menu:mouse-command:start', { command: menuCommandName(button), target: button.id });
}

function onMenuMouseUp(e) {
  if (!_menuMouseCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuMouseCommand;
  clearMenuCommandPressState();
  if (button !== started) {
    MenuDebug.log('menu:mouse-command:cancel', { started: started.id, ended: button?.id || '' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  runMenuCommand(button, 'mouseup', e);
}

ctxMenu.addEventListener('pointerdown', onMenuPointerDown);
ctxMenu.addEventListener('pointerup', onMenuPointerUp);
objCtxMenu.addEventListener('pointerdown', onMenuPointerDown);
objCtxMenu.addEventListener('pointerup', onMenuPointerUp);
BoardfishDOM.textCtxMenu.addEventListener('pointerdown', onMenuPointerDown);
BoardfishDOM.textCtxMenu.addEventListener('pointerup', onMenuPointerUp);
for (const menu of [ctxMenu, objCtxMenu, BoardfishDOM.textCtxMenu]) {
  menu.addEventListener('pointercancel', clearMenuCommandPressState);
  menu.addEventListener('pointerleave', clearMenuCommandPressState);
  menu.addEventListener('lostpointercapture', clearMenuCommandPressState);
}
ctxMenu.addEventListener('mousedown', onMenuMouseDown);
ctxMenu.addEventListener('mouseup', onMenuMouseUp);
objCtxMenu.addEventListener('mousedown', onMenuMouseDown);
objCtxMenu.addEventListener('mouseup', onMenuMouseUp);
BoardfishDOM.textCtxMenu.addEventListener('mousedown', onMenuMouseDown);
BoardfishDOM.textCtxMenu.addEventListener('mouseup', onMenuMouseUp);
const contextMenuStopSurfaces = [ctxMenu, objCtxMenu, BoardfishDOM.textCtxMenu, ctxActions];
for (const menu of contextMenuStopSurfaces) {
  if (!menu) continue;
  for (const type of ['click', 'contextmenu']) {
    menu.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'contextmenu') e.preventDefault();
    });
  }
}

function isContextMenuSurfaceEvent(e) {
  return !!(e?.target instanceof Node && (
    ctxMenu.contains(e.target) ||
    objCtxMenu.contains(e.target) ||
    BoardfishDOM.textCtxMenu.contains(e.target) ||
    ctxActions?.contains(e.target)
  ));
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
  if (flipBtn) flipBtn.style.display = showImageActions ? '' : 'none';
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

const updateTextEditMenuActions = async () => {
  const selection = getTextEditSelectionState();
  const hasSelection = !!selection?.hasSelection;
  const clipboardText = await readTextClipboardForEditMenu();
  const showPaste = clipboardText.length > 0;
  BoardfishDOM.textCopyBtn.style.display = hasSelection ? '' : 'none';
  BoardfishDOM.textPasteBtn.style.display = showPaste ? '' : 'none';
  BoardfishDOM.textDeleteSep.style.display = hasSelection ? 'block' : 'none';
  BoardfishDOM.textDeleteBtn.style.display = hasSelection ? '' : 'none';
  return hasSelection || showPaste;
};

const showTextEditContextMenuAt = async (clientX, clientY) => {
  const requestId = (showTextEditContextMenuAt.requestId || 0) + 1;
  showTextEditContextMenuAt.requestId = requestId;
  focusTextEditProxy();
  const hasVisibleActions = await updateTextEditMenuActions();
  if (requestId !== showTextEditContextMenuAt.requestId || !editingId) return;
  if (!hasVisibleActions) {
    closeOpenMenusExcept('', 'text-ctx-menu:empty');
    focusTextEditProxy();
    MenuDebug.log('text-ctx-menu:blocked-empty', { x: clientX, y: clientY });
    return;
  }
  openExclusiveMenuAt(BoardfishDOM.textCtxMenu, 'text-ctx-menu', clientX, clientY, 'show-text-menu:edit');
  focusTextEditProxy();
  MenuDebug.log('text-ctx-menu:open', {
    hasSelection: !!getTextEditSelectionState()?.hasSelection,
    pasteVisible: BoardfishDOM.textPasteBtn.style.display !== 'none',
    x: clientX,
    y: clientY,
  });
};

function showCanvasContextMenuAt(clientX, clientY) {
  if (_rubberBandDragActive) {
    MenuDebug.log('canvas:contextmenu:blocked-rubber-band', { x: clientX, y: clientY });
    return;
  }
  const wp = toWorld(clientX, clientY);
  MenuDebug.log('canvas:contextmenu', { x: clientX, y: clientY, wx: wp.x, wy: wp.y });

  const obj = hitTest(wp.x, wp.y);

  if (editingId && obj?.id === editingId) {
    showTextEditContextMenuAt(clientX, clientY);
    return;
  }

  // Multi-select: right-click anywhere inside the selected bounding box shows
  // the group menu.
  if (isMultiSelected()) {
    if (rectContainsPoint(selectedBounds(), wp) && (!obj || isSelected(obj.id))) {
      ctxPos = wp;
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
    ctxPos = wp;
    updateObjMenuActions();
    openExclusiveMenuAt(objCtxMenu, 'obj-ctx-menu', clientX, clientY, 'show-obj-menu:object');
    MenuDebug.log('obj-ctx-menu:open', { reason: 'object', objectId: obj.id, objectType: obj.type, x: clientX, y: clientY });
    return;
  }
  if (selectedIds.size) deselectAll();
  ctxPos = wp;
  openCtxMenuAt(clientX, clientY);
  MenuDebug.log('ctx-menu:open', { x: clientX, y: clientY, wx: wp.x, wy: wp.y });
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showCanvasContextMenuAt(e.clientX, e.clientY);
});

for (const id in MENU_COMMANDS) {
  if (!Object.prototype.hasOwnProperty.call(MENU_COMMANDS, id)) continue;
  document.getElementById(id)?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    runMenuCommand(event.currentTarget, 'click', event);
  });
}


document.addEventListener('pointerdown', (e) => {
  if (isContextMenuSurfaceEvent(e)) {
    MenuDebug.log('document-pointerdown:inside-menu');
    return;
  }
  closeOpenMenusExcept('', 'document-pointerdown');
});

document.addEventListener('click', (e) => {
  if (isContextMenuSurfaceEvent(e)) {
    MenuDebug.log('document-click:inside-menu');
    return;
  }
  closeOpenMenusExcept('', 'document-click');
});

function ctxActionHotspotRect(button) {
  const rect = button.getBoundingClientRect();
  if (ctxActions?.contains(button)) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }
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
  for (let i = 0; i < ctxActionItems.length; i++) {
    const item = ctxActionItems[i];
    const hot = item === button && isCtxActionHotspotEvent(e, item);
    item.classList.toggle('hotspot-hover', e.pointerType !== 'touch' && hot);
    item.classList.toggle('hotspot-active', active && hot);
  }
}

function clearCtxActionHotspotState() {
  for (let i = 0; i < ctxActionItems.length; i++) {
    const item = ctxActionItems[i];
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
