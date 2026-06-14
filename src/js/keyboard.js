'use strict';

function isShortcutKey(e, letter) {
  const normalizedLetter = letter.toLowerCase();
  return e.key.toLowerCase() === normalizedLetter || e.code === `Key${normalizedLetter.toUpperCase()}`;
}

function hasExactCommandModifier(e, { shift = false, alt = false } = {}) {
  return e.ctrlKey !== e.metaKey && e.shiftKey === shift && e.altKey === alt;
}

function hasNoShortcutModifiers(e) {
  return !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
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

const selectedTextObjectsForKeyboard = () => {
  const textObjects = [];
  if (!selectedIds?.size || !objectsMap?.get) return textObjects;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj?.type === 'text') textObjects.push(obj);
  }
  return textObjects;
};

const applySelectedTextAlignmentFromKeyboard = (direction) => {
  if (editingId || isBoardInputBlocked() || typeof applyTextLineAlignmentRange !== 'function') return false;
  const textObjects = selectedTextObjectsForKeyboard();
  if (!textObjects.length) return false;
  let changed = false;
  for (const obj of textObjects) {
    const lineCount = typeof textLogicalLineCount === 'function' ? textLogicalLineCount(obj.data?.content || '') : 1;
    if (applyTextLineAlignmentRange(obj, 0, Math.max(0, lineCount - 1), direction)) {
      markDirty(obj.id);
      changed = true;
    }
  }
  if (!changed) return false;
  globalThis.BoardfishMotion?.applyActionAnimation?.('text-align', { objects: textObjects });
  scheduleRender(true, true, 'text-align');
  pushHistory('text-align');
  return true;
};

const isBrowserFindShortcut = (e) => {
  const commandFind = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'f');
  const findByLetter = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'g') && !e.altKey;
  const findNext = e.key === 'F3' || e.code === 'F3';
  return commandFind || findByLetter || findNext;
};

document.addEventListener('keydown', (e) => {
  if (isBrowserFindShortcut(e)) {
    if (hasExactCommandModifier(e) && isShortcutKey(e, 'f')) return;
    globalThis.BoardfishMotion?.applyActionAnimation?.('browser-find-shortcut');
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

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
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  pasteAtPos(center.x, center.y);
}

document.addEventListener('keydown', (e) => {
  if (
    isBrowserFindShortcut(e) &&
    !(hasExactCommandModifier(e) && isShortcutKey(e, 'f') && canTransformSelectedImagesFromKeyboard())
  ) {
    return;
  }
  if (e.key === 'Alt') { e.preventDefault(); return; }

  if (hasNoShortcutModifiers(e) && isShortcutKey(e, 'n') && !editingId && !e.repeat) {
    consumeShortcutEvent(e);
    runShortcutCommand('new-board', () => {
      if (!isBoardInputBlocked()) newBoard();
    });
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'v') && contextMenusOpenForShortcut()) {
    consumeShortcutEvent(e);
    runShortcutCommand('paste', pasteAtViewportCenterFromShortcut);
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'c')) {
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

  if (hasExactCommandModifier(e) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
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

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'r')) {
    if (!canTransformSelectedImagesFromKeyboard()) return;
    consumeShortcutEvent(e);
    runShortcutCommand('rotate-image', () => {
      rotateSelectedImages('cw');
    });
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'f')) {
    if (!canTransformSelectedImagesFromKeyboard()) return;
    consumeShortcutEvent(e);
    runShortcutCommand('flip-image', () => {
      flipSelectedImages();
    });
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'i') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('add-images', runAddImagesCommandFromShortcut);
    return;
  }

  if (hasNoShortcutModifiers(e) && isShortcutKey(e, 't') && !editingId && !e.repeat) {
    consumeShortcutEvent(e);
    runShortcutCommand('add-text', runAddTextCommandFromShortcut);
    return;
  }

  if (e.key === 'Escape') {
    consumeShortcutEvent(e);
    hideMenus();
    deselectAll();
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'o') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('open', openBoard);
    return;
  }

  if (hasExactCommandModifier(e, { shift: true }) && isShortcutKey(e, 's')) {
    consumeShortcutEvent(e);
    runShortcutCommand('save-as', saveBoardAs);
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 's')) {
    consumeShortcutEvent(e);
    runShortcutCommand('save', saveBoard);
    return;
  }

  if (hasExactCommandModifier(e) && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
    consumeShortcutEvent(e);
    runShortcutCommand('reset-zoom', resetZoomToClosestObject);
    return;
  }

  if (isBoardInputBlocked()) { consumeShortcutEvent(e); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'a')) {
    if (!editingId) {
      consumeShortcutEvent(e);
      runShortcutCommand('select-all', selectAllObjects);
    }
    return;
  }

  if (hasNoShortcutModifiers(e) && (e.key === 'Backspace' || e.key === 'Delete')) {
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

  if (hasExactCommandModifier(e) && (e.code === 'BracketLeft' || e.key === '[') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('move-to-back', sendSelectedToBack);
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'e') && !editingId) {
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

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'x') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('cut', cutSelected);
    return;
  }

  if (hasExactCommandModifier(e, { shift: true }) && isShortcutKey(e, 'z')) {
    consumeShortcutEvent(e);
    runShortcutCommand('redo', redo);
    return;
  }

  if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && isShortcutKey(e, 'y')) {
    consumeShortcutEvent(e);
    runShortcutCommand('redo', redo);
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'z')) {
    consumeShortcutEvent(e);
    runShortcutCommand('undo', undo);
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'd') && !editingId) {
    consumeShortcutEvent(e);
    runShortcutCommand('duplicate', duplicateSelected);
  }
}, true);
