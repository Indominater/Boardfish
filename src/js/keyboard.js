'use strict';

function isShortcutKey(e, letter) {
  const normalizedLetter = letter.toLowerCase();
  return e.key.toLowerCase() === normalizedLetter || e.code === `Key${normalizedLetter.toUpperCase()}`;
}

function isEditableTextShortcutTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tagName = String(target.tagName || target.nodeName || '').toLowerCase();
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;
  const type = String(target.type || '').toLowerCase();
  return !type || [
    'text',
    'search',
    'url',
    'tel',
    'email',
    'password',
    'number',
  ].includes(type);
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

const hasSelectedImagesForKeyboardTransform = () => {
  if (!selectedIds?.size || !objectsMap?.get) return false;
  for (const id of selectedIds) {
    if (objectsMap.get(id)?.type === 'image') return true;
  }
  return false;
};

const canTransformSelectedImagesFromKeyboard = () => {
  return !editingId && !isBoardInputBlocked() && hasSelectedImagesForKeyboardTransform();
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
  if (editingId || isBoardInputBlocked() || typeof applyTextLineAlignmentRange !== 'function') return false;
  if (!selectedIds?.size || !objectsMap?.get) return false;
  let changed = false;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj?.type !== 'text') continue;
    const lineCount = typeof textLogicalLineCount === 'function' ? textLogicalLineCount(obj.data?.content || '') : 1;
    if (applyTextLineAlignmentRange(obj, 0, Math.max(0, lineCount - 1), direction)) {
      markDirty(obj.id);
      changed = true;
    }
  }
  if (!changed) return false;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, 'text-align');
  else scheduleRender(true, true);
  pushHistory('text-align');
  return true;
};

const isBrowserFindShortcut = (e) => {
  const commandFind = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'f');
  const findByLetter = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'g') && !e.altKey;
  const findNext = e.key === 'F3' || e.code === 'F3';
  return commandFind || findByLetter || findNext;
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

document.addEventListener('keydown', (e) => {
  const command = e.ctrlKey !== e.metaKey && !e.altKey;
  const commandOnly = command && !e.shiftKey, shiftCommandOnly = command && e.shiftKey;
  const noShortcutModifiers = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
  if (isBrowserFindShortcut(e)) {
    const commandFind = commandOnly && isShortcutKey(e, 'f');
    if (commandFind && canTransformSelectedImagesFromKeyboard()) {
      consumeShortcutEvent(e);
      runShortcutCommand('flip-image', () => {
        flipSelectedImages();
      });
    } else if (!commandFind) {
      consumeShortcutEvent(e);
    }
    return;
  }
  if (e.key === 'Alt') { e.preventDefault(); return; }

  if (noShortcutModifiers && isShortcutKey(e, 'n') && !editingId && !e.repeat) {
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

  if (commandOnly && isShortcutKey(e, 'i') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('add-images', runAddImagesCommandFromShortcut);
    return;
  }

  if (noShortcutModifiers && isShortcutKey(e, 't') && !editingId && !e.repeat) {
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

  if (commandOnly && isShortcutKey(e, 'o') && !editingId) {
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

  if (commandOnly && (e.code === 'BracketLeft' || e.key === '[') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('move-to-back', sendSelectedToBack);
    return;
  }

  if (commandOnly && isShortcutKey(e, 'e') && !editingId) {
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

  if (commandOnly && isShortcutKey(e, 'x') && !editingId) {
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

  if (commandOnly && isShortcutKey(e, 'd') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('duplicate', duplicateSelected);
  }
}, true);
