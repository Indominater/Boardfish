'use strict';

const EDITABLE_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

function isShortcutKey(e, letter) {
  return e.key.toLowerCase() === letter || e.code === `Key${letter.toUpperCase()}`;
}

function isEditableTextShortcutTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tagName = String(target.tagName || target.nodeName || '').toLowerCase();
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;
  const type = String(target.type || '').toLowerCase();
  return !type || EDITABLE_INPUT_TYPES.has(type);
}

function hasDocumentTextSelectionForShortcut() {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return String(selection) !== '';
}

function hasTextEditingOrSelectionContextForShortcut(e) {
  return !!editingId ||
    (typeof _editEl !== 'undefined' && !!_editEl) ||
    isEditableTextShortcutTarget(e.target) ||
    (typeof document !== 'undefined' && isEditableTextShortcutTarget(document.activeElement)) ||
    hasDocumentTextSelectionForShortcut();
}

function hasActiveTextEditAlignmentContext() {
  return !!editingId && typeof _editEl !== 'undefined' && !!_editEl;
}

const selectedImageCountForKeyboardAction = () => {
  if (!selectedIds?.size || !objectsMap?.get) return 0;
  let count = 0;
  for (const id of selectedIds) {
    if (objectsMap.get(id)?.type === 'image') count++;
  }
  return count;
};

const hasSelectedImagesForKeyboardTransform = () => {
  return selectedImageCountForKeyboardAction() >= 1;
};

const canTransformSelectedImagesFromKeyboard = () => {
  return !editingId && !isBoardInputBlocked() && hasSelectedImagesForKeyboardTransform();
};

const canArrangeSelectedImagesFromKeyboard = () => {
  return !editingId && !isBoardInputBlocked() && selectedImageCountForKeyboardAction() >= 2;
};

const selectedTextObjectForKeyboardEdit = () => {
  if (!selectedIds || selectedIds.size !== 1 || !objectsMap?.get) return null;
  const [id] = selectedIds;
  const obj = objectsMap.get(id);
  return obj?.type === 'text' ? obj : null;
};

const enterSelectedTextEditFromKeyboard = (e) => {
  if (
    editingId ||
    e.repeat ||
    e.isComposing ||
    isBoardInputBlocked() ||
    typeof enterEdit !== 'function' ||
    isEditableTextShortcutTarget(e.target) ||
    (typeof document !== 'undefined' && isEditableTextShortcutTarget(document.activeElement))
  ) {
    return false;
  }
  const obj = selectedTextObjectForKeyboardEdit();
  if (!obj) return false;
  enterEdit(obj.id, { placeInitialCaret: true });
  return true;
};

const applySelectedTextAlignmentFromKeyboard = (direction) => {
  if (editingId || isBoardInputBlocked()) return false;
  if (!selectedIds?.size || !objectsMap?.get) return false;
  const dirty = [];
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj?.type !== 'text') continue;
    if (applyTextLineAlignmentRange(obj, 0, Infinity, direction)) dirty.push(obj.id);
  }
  if (!dirty.length) return false;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, 'text-align');
  else scheduleRender(true, true);
  pushHistory('text-align', dirty);
  return true;
};

function consumeShortcutEvent(e) {
  if (e.cancelable !== false) e.preventDefault();
  e.stopPropagation();
}

function contextMenusOpenForShortcut() {
  return typeof hasOpenContextMenu === 'function' && hasOpenContextMenu();
}

function closeMenusForShortcut(shortcutName) {
  if (!contextMenusOpenForShortcut() || typeof closeOpenMenusExcept !== 'function') return;
  closeOpenMenusExcept('', `shortcut:${shortcutName}`);
}

function runShortcutCommand(shortcutName, fallback) {
  if (
    typeof runVisibleMenuCommandForShortcut === 'function' &&
    runVisibleMenuCommandForShortcut(shortcutName)
  ) {
    return true;
  }
  closeMenusForShortcut(shortcutName);
  if (typeof fallback === 'function') fallback();
  return true;
}

function pasteAtViewportCenterFromShortcut() {
  if (editingId || typeof pasteAtPos !== 'function') return;
  const point = typeof boardCursorWorldPoint === 'function'
    ? boardCursorWorldPoint()
    : toWorld(window.innerWidth / 2, window.innerHeight / 2);
  pasteAtPos(point.x, point.y);
}

function arrangeSelectedImagesFromShortcut() {
  if (editingId || typeof sortSelectedImages !== 'function') return;
  sortSelectedImages();
}

document.addEventListener('keydown', (e) => {
  const command = e.ctrlKey !== e.metaKey && !e.altKey;
  const commandOnly = command && !e.shiftKey, shiftCommandOnly = command && e.shiftKey;
  const noShortcutModifiers = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
  if (((e.ctrlKey || e.metaKey) && (isShortcutKey(e, 'f') || (isShortcutKey(e, 'g') && !e.altKey))) || e.key === 'F3' || e.code === 'F3') {
    const commandFind = commandOnly && isShortcutKey(e, 'f');
    if (commandFind && canTransformSelectedImagesFromKeyboard()) {
      consumeShortcutEvent(e);
      runShortcutCommand('flip-image', flipSelectedImages);
    } else if (!commandFind) {
      consumeShortcutEvent(e);
    }
    return;
  }
  if (e.key === 'Alt') { e.preventDefault(); return; }

  if (noShortcutModifiers && !editingId && !e.repeat && isShortcutKey(e, 'n')) {
    consumeShortcutEvent(e);
    runShortcutCommand('new-board', () => {
      if (!isBoardInputBlocked()) newBoard();
    });
    return;
  }

  if (commandOnly && isShortcutKey(e, 'v') && contextMenusOpenForShortcut()) {
    consumeShortcutEvent(e);
    runShortcutCommand('paste', pasteAtViewportCenterFromShortcut);
    return;
  }

  if (commandOnly && isShortcutKey(e, 'c')) {
    if (e.repeat) {
      if (!editingId || contextMenusOpenForShortcut()) consumeShortcutEvent(e);
      return;
    }
    if (contextMenusOpenForShortcut()) {
      consumeShortcutEvent(e);
      runShortcutCommand('copy', () => {
        if (!editingId) copySelected();
      });
      return;
    }
    if (!editingId) {
      consumeShortcutEvent(e);
      runShortcutCommand('copy', copySelected);
      return;
    }
    return;
  }

  if (commandOnly && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const direction = e.key === 'ArrowRight' ? 'right' : 'left';
    if (
      hasActiveTextEditAlignmentContext() &&
      typeof applyTextEditAlignmentFromKeyboard === 'function'
    ) {
      consumeShortcutEvent(e);
      runShortcutCommand(`text-align-${direction}`, () => {
        applyTextEditAlignmentFromKeyboard(direction);
      });
      return;
    }
    if (hasTextEditingOrSelectionContextForShortcut(e)) return;
    consumeShortcutEvent(e);
    runShortcutCommand(`text-align-${direction}`, () => {
      applySelectedTextAlignmentFromKeyboard(direction);
    });
    return;
  }

  if (commandOnly && isShortcutKey(e, 'r')) {
    if (!canTransformSelectedImagesFromKeyboard()) return;
    consumeShortcutEvent(e);
    runShortcutCommand('rotate-image', () => {
      rotateSelectedImages('cw');
    });
    return;
  }

  if (commandOnly && isShortcutKey(e, 'j')) {
    if (!canArrangeSelectedImagesFromKeyboard()) return;
    consumeShortcutEvent(e);
    if (e.repeat) return;
    runShortcutCommand('arrange-images', arrangeSelectedImagesFromShortcut);
    return;
  }

  if (commandOnly && !editingId && isShortcutKey(e, 'i')) {
    consumeShortcutEvent(e);
    runShortcutCommand('add-images', runAddImagesCommandFromShortcut);
    return;
  }

  if (noShortcutModifiers && !editingId && !e.repeat && isShortcutKey(e, 't')) {
    consumeShortcutEvent(e);
    runShortcutCommand('add-text', runAddTextCommandFromShortcut);
    return;
  }

  if (noShortcutModifiers && e.key === 'Enter') {
    if (enterSelectedTextEditFromKeyboard(e)) {
      consumeShortcutEvent(e);
      return;
    }
  }

  if (e.key === 'Escape') {
    consumeShortcutEvent(e);
    hideMenus();
    deselectAll();
    return;
  }

  if (commandOnly && !editingId && isShortcutKey(e, 'o')) {
    consumeShortcutEvent(e);
    runShortcutCommand('open', openBoard);
    return;
  }

  if (shiftCommandOnly && isShortcutKey(e, 's')) {
    consumeShortcutEvent(e);
    runShortcutCommand('save-as', saveBoardAs);
    return;
  }

  if (commandOnly && isShortcutKey(e, 's')) {
    consumeShortcutEvent(e);
    runShortcutCommand('save', saveBoard);
    return;
  }

  if (commandOnly && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
    consumeShortcutEvent(e);
    runShortcutCommand('reset-zoom', resetZoomToClosestObject);
    return;
  }

  if (isBoardInputBlocked()) { consumeShortcutEvent(e); return; }

  if (commandOnly && isShortcutKey(e, 'a')) {
    if (!editingId) {
      consumeShortcutEvent(e);
      runShortcutCommand('select-all', selectAllObjects);
    }
    return;
  }

  if (noShortcutModifiers && (e.key === 'Backspace' || e.key === 'Delete')) {
    if (contextMenusOpenForShortcut()) {
      consumeShortcutEvent(e);
      runShortcutCommand('delete', () => {
        if (hasSelection() && !editingId) deleteSelected();
      });
      return;
    }
    if (hasSelection() && !editingId) {
      consumeShortcutEvent(e);
      runShortcutCommand('delete', deleteSelected);
    }
    return;
  }

  if (commandOnly && !editingId && (e.code === 'BracketLeft' || e.key === '[')) {
    consumeShortcutEvent(e);
    runShortcutCommand('move-to-back', sendSelectedToBack);
    return;
  }

  if (commandOnly && !editingId && isShortcutKey(e, 'e')) {
    const imageObjs = BoardfishExportUtils.selectedImageObjects();
    if (contextMenusOpenForShortcut() || imageObjs.length) {
      consumeShortcutEvent(e);
      runShortcutCommand('export-image', () => {
        if (!imageObjs.length) return;
        if (imageObjs.length === 1) saveSelectedImage();
        else {
          showInputShield({ keepSelectionOverlay: true });
          saveSelectedImages();
        }
      });
    }
    return;
  }

  if (commandOnly && !editingId && isShortcutKey(e, 'x')) {
    consumeShortcutEvent(e);
    runShortcutCommand('cut', cutSelected);
    return;
  }

  if (shiftCommandOnly && isShortcutKey(e, 'z')) {
    consumeShortcutEvent(e);
    runShortcutCommand('redo', redo);
    return;
  }

  if (commandOnly && isShortcutKey(e, 'y')) {
    consumeShortcutEvent(e);
    runShortcutCommand('redo', redo);
    return;
  }

  if (commandOnly && isShortcutKey(e, 'z')) {
    consumeShortcutEvent(e);
    runShortcutCommand('undo', undo);
    return;
  }

  if (commandOnly && !editingId && isShortcutKey(e, 'd')) {
    consumeShortcutEvent(e);
    runShortcutCommand('duplicate', duplicateSelected);
  }
}, true);
