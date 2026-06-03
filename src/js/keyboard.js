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
    if (hasExactCommandModifier(e) && isShortcutKey(e, 'f') && canTransformSelectedImagesFromKeyboard()) return;
    globalThis.BoardfishMotion?.applyActionAnimation?.('browser-find-shortcut');
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') { e.preventDefault(); return; }
  if (hasExactCommandModifier(e) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    if (!editingId) applySelectedTextAlignmentFromKeyboard(e.key === 'ArrowRight' ? 'right' : 'left');
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'r')) {
    e.preventDefault();
    if (canTransformSelectedImagesFromKeyboard()) rotateSelectedImages('cw');
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'f')) {
    e.preventDefault();
    if (canTransformSelectedImagesFromKeyboard()) flipSelectedImages();
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'i') && !editingId) {
    e.preventDefault();
    runAddImagesCommandFromShortcut();
    return;
  }

  if (hasNoShortcutModifiers(e) && isShortcutKey(e, 't') && !editingId && !e.repeat) {
    e.preventDefault();
    runAddTextCommandFromShortcut();
    return;
  }

  if (e.key === 'Escape') {
    hideMenus();
    if (editingId) {
      deselectAll();
      return;
    }
    deselectAll();
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'o') && !editingId) {
    e.preventDefault();
    openBoard();
    return;
  }

  if (hasExactCommandModifier(e, { shift: true }) && isShortcutKey(e, 's')) {
    e.preventDefault();
    saveBoardAs();
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 's')) { e.preventDefault(); saveBoard(); return; }

  if (hasExactCommandModifier(e) && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
    e.preventDefault();
    resetZoomToClosestObject();
    return;
  }

  if (isBoardInputBlocked()) { e.preventDefault(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'a')) {
    if (!editingId) {
      e.preventDefault();
      selectAllObjects();
    }
    return;
  }

  if (hasNoShortcutModifiers(e) && (e.key === 'Backspace' || e.key === 'Delete') && hasSelection() && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'n') && !editingId) {
    e.preventDefault();
    newBoard();
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'c') && !editingId) { e.preventDefault(); copySelected(); return; }

  if (hasExactCommandModifier(e) && (e.code === 'BracketLeft' || e.key === '[') && !editingId) {
    e.preventDefault();
    sendSelectedToBack();
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'e') && !editingId) {
    const imageObjs = BoardfishExportUtils.selectedImageObjects();
    if (imageObjs.length) {
      e.preventDefault();
      if (imageObjs.length === 1) saveSelectedImage();
      else {
        showInputShield({ keepSelectionOverlay: true });
        saveSelectedImages();
      }
    }
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'x') && !editingId) {
    e.preventDefault();
    cutSelected();
    return;
  }

  if (hasExactCommandModifier(e, { shift: true }) && isShortcutKey(e, 'z')) { e.preventDefault(); redo(); return; }

  if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && isShortcutKey(e, 'y')) { e.preventDefault(); redo(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'z')) { e.preventDefault(); undo(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'd') && !editingId) { e.preventDefault(); duplicateSelected(); return; }
});
