// ─── Context menu ─────────────────────────────────────────────────────────────
var _lastBoardCursorClientX = null;
var _lastBoardCursorClientY = null;
const HAS_POINTER_EVENTS = 'PointerEvent' in window;
const BOARD_CURSOR_CLIENT_EVENT_TYPES = Object.freeze([
  ...(HAS_POINTER_EVENTS
    ? ['pointerover', 'pointerenter', 'pointermove', 'pointerdown', 'pointerup']
    : ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup']),
  'click', 'dblclick', 'auxclick', 'contextmenu', 'dragenter', 'dragover', 'drop',
]);

function rememberBoardCursorClientPoint(event) {
  _lastBoardCursorClientX = event.clientX;
  _lastBoardCursorClientY = event.clientY;
}

function boardCursorWorldPoint() {
  return toWorld(
    _lastBoardCursorClientX ?? window.innerWidth / 2,
    _lastBoardCursorClientY ?? window.innerHeight / 2,
  );
}

function menuCommandWorldPoint(event = null) {
  const x = event?.clientX;
  const y = event?.clientY;
  if (Number.isFinite(x) && Number.isFinite(y)) return toWorld(x, y);
  return boardCursorWorldPoint();
}

for (const type of BOARD_CURSOR_CLIENT_EVENT_TYPES) {
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
  menu.classList.add('visible');
  const rect = menu.getBoundingClientRect();
  const bounds = menuViewportBounds();
  menu.style.left = `${Math.round(clampMenuCoord(x, rect.width, bounds.left, bounds.right))}px`;
  menu.style.top = `${Math.round(clampMenuCoord(y, rect.height, bounds.top, bounds.bottom))}px`;
  return bounds;
}

const closeFloatingSurface = (surface) => {
  surface.classList.remove('visible');
};

var ctxActionItems = ctxActions.getElementsByClassName('ctx-action-item');

function updateCtxActionStates() {
  darkModeMenuBtn.setAttribute('aria-pressed', appTheme === 'dark' ? 'true' : 'false');
}

function closeCtxActions(reason) {
  MenuDebug.log('ctx-actions:close', { reason });
  closeFloatingSurface(ctxActions);
}

function openCtxMenuAt(x, y) {
  closeOpenMenusExcept('ctx-menu', 'open-ctx-menu');
  updateCtxActionStates();
  ctxMenu.classList.add('visible');
  ctxActions.classList.add('visible');
  const { gap, left, right, top, bottom } = menuViewportBounds();
  const menuRect = ctxMenu.getBoundingClientRect();
  const menuWidth = ctxMenu.offsetWidth;
  const actionWidth = ctxActions.offsetWidth;
  const minActionLeft = left + gap;
  const maxActionRight = right - gap;
  const maxActionLeft = Math.max(minActionLeft, maxActionRight - actionWidth);
  let menuLeft = Math.round(clampMenuCoord(x, menuRect.width, left, right));
  if (menuLeft <= left + MENU_VIEWPORT_EDGE_MARGIN) menuLeft = minActionLeft;
  let actionLeft = menuLeft + menuWidth + gap;

  if (actionLeft + actionWidth > maxActionRight) {
    actionLeft = maxActionLeft;
    menuLeft = actionLeft - gap - menuWidth;
  }

  if (menuLeft < minActionLeft) {
    menuLeft = minActionLeft;
    actionLeft = Math.min(maxActionLeft, menuLeft + menuWidth + gap);
  }

  ctxMenu.style.left = `${Math.round(menuLeft)}px`;
  ctxMenu.style.top = `${Math.round(clampMenuCoord(y, menuRect.height, top, bottom))}px`;
  ctxActions.style.left = `${Math.round(actionLeft)}px`;
  ctxActions.style.top = ctxMenu.style.top;
}

if (DEBUG_TOOLS_ENABLED) {
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu']) {
    document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:capture`, e), true);
    document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:bubble`, e), false);
    ctxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`ctx-menu:${type}`, e));
    objCtxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`obj-ctx-menu:${type}`, e));
    textCtxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`text-ctx-menu:${type}`, e));
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
  closeFloatingSurface(textCtxMenu);
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
var _lastPointerMenuCommandAt = 0;

function clearMenuCommandPressState() {
  _menuPointerCommand?.classList.remove('menu-pressed');
  _menuPointerCommand = null;
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
  'obj-btn-arrange-images': () => {
    closeObjCtxMenu('command:arrange-images');
    sortSelectedImages();
  },
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

const focusTextEditProxy = () => focusTextEditProxyNow(_editEl);

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
  const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
  const selection = getTextEditSelectionState();
  if (!selection || !_editEl) return false;
  const inputTypeValue = String(inputType || '').toLowerCase();
  const normalizedText = normalizeTextContent(text);
  const replacementText = inputTypeValue.includes('paste') && typeof textForTextObjectPaste === 'function'
    ? textForTextObjectPaste(normalizedText)
    : normalizedText;
  if (inputTypeValue.includes('paste') && !replacementText) return false;
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
  if (collectDiagnostics && typeof nextTextEditInputDebugSeq === 'function') {
    replacementState._debugSeq = nextTextEditInputDebugSeq();
  }
  if (immediateHistory) {
    beginTextEditHistoryAction(editingId, replacementState);
  }
  if (typeof setPendingTextEditInputState === 'function') setPendingTextEditInputState(_editEl, replacementState);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const debugNow = collectDiagnostics
    ? (typeof textEditorDebugNow === 'function' ? textEditorDebugNow : () => Date.now())
    : null;
  const debugRound = collectDiagnostics
    ? (typeof textEditorDebugRound === 'function'
        ? textEditorDebugRound
        : (value) => Math.round((Number(value) || 0) * 100) / 100)
    : null;
  const mutationStartedAt = collectDiagnostics ? debugNow() : 0;
  const mutationResult =
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  typeof replaceTextEditProxyRange === 'function'
    ? replaceTextEditProxyRange(
      _editEl, replacementText, selection.start, selection.end, 'end', inputTypeValue.startsWith('delete'),
    )
    : (() => {
      _editEl.setRangeText(replacementText, selection.start, selection.end, 'end');
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      return collectDiagnostics
        ? {
            method: 'setRangeText',
            setRangeTextMs: '',
            valueAssignMs: '',
            valueBuildMs: '',
            valueSetMs: '',
            logicalSetMs: '',
            selectionSetMs: '',
          }
        : null;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    })();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const nextValue = typeof textEditProxyValue === 'function' ? textEditProxyValue(_editEl) : String(_editEl.value ?? '');
  if (collectDiagnostics && typeof recordTextEditorInputPerfStep === 'function') {
    const mutationMs = debugRound(debugNow() - mutationStartedAt);
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
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  _caretVisible = true;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dispatchStartedAt = collectDiagnostics ? debugNow() : 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  _editEl.dispatchEvent(new Event('input', { bubbles: true }));
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (collectDiagnostics && typeof recordTextEditorInputPerfStep === 'function') {
    recordTextEditorInputPerfStep('menu-replace-input-dispatched', {
      seq: replacementState._debugSeq ?? '',
      inputType,
      objectId: editingId,
      dispatchMs: debugRound(debugNow() - dispatchStartedAt),
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  focusTextEditProxy();
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
    globalThis.BoardfishMotion?.applyCopyFeedback?.({
      textSelection: {
        id: editingId,
        ...selection,
      },
    });
  }
  await writeTextClipboardFromEditMenu(textSelectionForClipboard(selectedText), {
    allowEmpty: !!selectedText,
  });
  focusTextEditProxy();
};

const deleteTextEditSelection = () => {
  if (!getTextEditSelectionState()?.hasSelection) {
    focusTextEditProxy();
    return;
  }
  replaceTextEditSelection('', { immediateHistory: true, inputType: 'deleteContentBackward' });
};

const pasteTextIntoEditSelection = async () => {
  const hasBoardfishTextPayload = (
    typeof currentBoardfishTextSelectionClipboardPayload === 'function' &&
    !!currentBoardfishTextSelectionClipboardPayload()
  );
  const pendingBoardfishPaste = (
    hasBoardfishTextPayload &&
    typeof pasteBoardfishTextSelectionIntoEditSelection === 'function'
  ) ? pasteBoardfishTextSelectionIntoEditSelection({ immediateHistory: true }) : null;
  const pendingExternalText = (
    !hasBoardfishTextPayload || (
      typeof _jsClipboardWebMaybeStale !== 'undefined' &&
      _jsClipboardWebMaybeStale
    )
  ) ? readTextClipboardForEditMenu() : null;
  if (pendingBoardfishPaste && await pendingBoardfishPaste) {
    focusTextEditProxy();
    return;
  }
  const text = await (pendingExternalText || readTextClipboardForEditMenu());
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
  MenuDebug.log(button.id.startsWith('obj-')
    ? 'obj-ctx-menu:command'
    : button.id.startsWith('text-')
      ? 'text-ctx-menu:command'
      : 'ctx-menu:command', { command, source });
  if (source === 'pointerup' || source === 'mouseup') _lastPointerMenuCommandAt = performance.now();
  // Keep activation-sensitive file pickers and text focus inside the trusted
  // pointer event. The following click is still suppressed by the timestamp.
  MenuDebug.log('menu:command:start', { command, source });
  try {
    run(commandEvent);
    MenuDebug.log('menu:command:end', { command, source });
  } catch (err) {
    MenuDebug.log('menu:command:error', { command, source, error: String(err) });
    console.error('[Boardfish menu] command failed:', command, err);
  }
  return true;
}

function contextMenuSurfaceById(id) {
  if (id === 'ctx-menu') return ctxMenu;
  if (id === 'obj-ctx-menu') return objCtxMenu;
  if (id === 'text-ctx-menu') return textCtxMenu;
  return null;
}

function hasOpenContextMenu() {
  return !!(
    ctxMenu.classList.contains('visible') ||
    objCtxMenu.classList.contains('visible') ||
    textCtxMenu.classList.contains('visible')
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
  'arrange-images': [['obj-ctx-menu', 'obj-btn-arrange-images']],
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

function runAddImagesCommandFromShortcut() { runMenuCommand(addImageBtn, 'shortcut'); }

function runAddTextCommandFromShortcut() { runMenuCommand(addTextBtn, 'shortcut'); }

function resetZoomToClosestObject() {
  const dbg = ViewportDebug.start('resetZoom', { panX, panY, zoom, objectCount: objects.length });
  if (selectedIds.size || editingId) deselectAll();
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  let closestImage = null;
  let closestImageDistanceSq = Infinity;
  let closestText = null;
  let closestTextDistanceSq = Infinity;
  for (const obj of objects) {
    if (obj?.type !== 'image' && obj?.type !== 'text') continue;
    const dx = center.x - (obj.x + obj.w / 2);
    const dy = center.y - (obj.y + obj.h / 2);
    const candidateDistanceSq = dx * dx + dy * dy;
    if (obj.type === 'image') {
      if (candidateDistanceSq < closestImageDistanceSq) {
        closestImage = obj;
        closestImageDistanceSq = candidateDistanceSq;
      }
    } else if (candidateDistanceSq < closestTextDistanceSq) {
      closestText = obj;
      closestTextDistanceSq = candidateDistanceSq;
    }
  }
  const targetType = closestImage ? 'image' : 'text';
  const object = closestImage || closestText;
  const distanceSq = closestImage ? closestImageDistanceSq : closestTextDistanceSq;
  const targetZoom = 1;
  if (!object) {
    const changed = BoardfishViewportState.setZoomPan(
      targetZoom,
      window.innerWidth / 2 - center.x * targetZoom,
      window.innerHeight / 2 - center.y * targetZoom,
    );
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleTransform(changed, 'reset-zoom');
    else scheduleTransform(changed);
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
  const changed = BoardfishViewportState.setZoomPan(
    targetZoom,
    window.innerWidth / 2 - objectCenterX * targetZoom,
    window.innerHeight / 2 - objectCenterY * targetZoom,
  );
  if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleTransform(changed, 'reset-zoom');
  else scheduleTransform(changed);
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

const MENU_COMMAND_INPUT_FAMILY = HAS_POINTER_EVENTS ? 'pointer' : 'mouse';
const MENU_COMMAND_DOWN_EVENT = HAS_POINTER_EVENTS ? 'pointerdown' : 'mousedown';
const MENU_COMMAND_UP_EVENT = HAS_POINTER_EVENTS ? 'pointerup' : 'mouseup';
const MENU_COMMAND_CANCEL_EVENTS = HAS_POINTER_EVENTS
  ? ['pointercancel', 'pointerleave', 'lostpointercapture']
  : ['mouseleave'];

function onMenuPointerDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || e.button !== 0) return;
  if (HAS_POINTER_EVENTS) e.stopPropagation();
  clearMenuCommandPressState();
  _menuPointerCommand = button;
  button.classList.add('menu-pressed');
  MenuDebug.log(`menu:${MENU_COMMAND_INPUT_FAMILY}-command:start`, { command: menuCommandName(button), target: button.id });
}

function onMenuPointerUp(e) {
  if (!_menuPointerCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuPointerCommand;
  clearMenuCommandPressState();
  if (e.pointerType === 'touch') started.blur?.();
  if (button !== started) {
    MenuDebug.log(`menu:${MENU_COMMAND_INPUT_FAMILY}-command:cancel`, { started: started.id, ended: button?.id || '' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  runMenuCommand(button, MENU_COMMAND_UP_EVENT, e);
}

for (const menu of [ctxMenu, objCtxMenu, textCtxMenu]) {
  menu.addEventListener(MENU_COMMAND_DOWN_EVENT, onMenuPointerDown);
  menu.addEventListener(MENU_COMMAND_UP_EVENT, onMenuPointerUp);
  for (const type of MENU_COMMAND_CANCEL_EVENTS) menu.addEventListener(type, clearMenuCommandPressState);
}
const contextMenuStopSurfaces = [ctxMenu, objCtxMenu, textCtxMenu, ctxActions];
for (const menu of contextMenuStopSurfaces) {
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
    textCtxMenu.contains(e.target) ||
    ctxActions.contains(e.target)
  ));
}

function updateObjMenuActions() {
  let imageCount = 0;
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (!o) continue;
    if (o.type === 'image') imageCount++;
  }
  const multiSelected = isMultiSelected();
  const showImageActions = imageCount >= 1;
  objectActionsSep.style.display = showImageActions ? 'block' : 'none';
  flipBtn.style.display = showImageActions ? '' : 'none';
  rotateBtn.style.display = showImageActions ? '' : 'none';
  arrangeImagesBtn.style.display = imageCount >= 2 ? '' : 'none';
  saveImageBtn.style.display = !multiSelected && imageCount === 1 ? '' : 'none';
  saveImagesBtn.firstElementChild.textContent = imageCount === 1 ? 'Export Image' : 'Export Images';
  saveImagesBtn.style.display = multiSelected && imageCount >= 1 ? '' : 'none';
  exportSep.style.display = showImageActions ? 'block' : 'none';
}

const showTextEditContextMenuAt = (clientX, clientY) => {
  focusTextEditProxy();
  const hasSelection = !!getTextEditSelectionState()?.hasSelection;
  textCopyBtn.style.display = hasSelection ? '' : 'none';
  // Clipboard contents cannot be probed just to build a menu: mobile browsers
  // may gate that read behind their own Paste control. Keep the action
  // available and defer the protected read until the user invokes it.
  textDeleteSep.style.display = hasSelection ? 'block' : 'none';
  textDeleteBtn.style.display = hasSelection ? '' : 'none';
  if (!editingId) return;
  openExclusiveMenuAt(textCtxMenu, 'text-ctx-menu', clientX, clientY, 'show-text-menu:edit');
  MenuDebug.log('text-ctx-menu:open', {
    hasSelection,
    pasteVisible: textPasteBtn.style.display !== 'none',
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

  const obj = BoardObjectGeometry.topObjectAtWorldPoint(wp);

  if (editingId && obj?.id === editingId) {
    showTextEditContextMenuAt(clientX, clientY);
    return;
  }

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
  if (selectedIds.size) deselectAll();
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


for (const type of ['pointerdown', 'click']) {
  const reason = `document-${type}`;
  document.addEventListener(type, (e) => {
    if (!hasOpenContextMenu()) return;
    if (isContextMenuSurfaceEvent(e)) {
      MenuDebug.log(`${reason}:inside-menu`);
      return;
    }
    closeOpenMenusExcept('', reason);
  });
}

function clearCtxActionHotspotState() {
  for (let i = 0; i < ctxActionItems.length; i++) {
    ctxActionItems[i].classList.remove('hotspot-active');
  }
}

ctxActions.addEventListener('pointerdown', (e) => {
  const button = e.target.closest?.('.ctx-action-item');
  if (!button) return;
  clearCtxActionHotspotState();
  button.classList.add('hotspot-active');
});
ctxActions.addEventListener('pointerup', clearCtxActionHotspotState);
ctxActions.addEventListener('pointerleave', clearCtxActionHotspotState);

darkModeMenuBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeCtxMenu('command:dark-mode');
  toggleAppTheme();
  updateCtxActionStates();
});
