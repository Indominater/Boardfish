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

function isNativeFindShortcut(e) {
  const commandFind = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'f');
  const findByLetter = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'g') && !e.altKey;
  const findNext = e.key === 'F3' || e.code === 'F3';
  return commandFind || findByLetter || findNext;
}

document.addEventListener('keydown', (e) => {
  if (isNativeFindShortcut(e)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') { e.preventDefault(); return; }
  if (hasExactCommandModifier(e) && isShortcutKey(e, 'r')) { e.preventDefault(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'i') && !editingId) {
    e.preventDefault();
    runAddImagesCommandFromShortcut();
    return;
  }

  if (hasNoShortcutModifiers(e) && isShortcutKey(e, 'i') && !editingId) {
    e.preventDefault();
    setEyedropperEnabled(!eyedropperEnabled);
    updateCtxActionStates();
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 't') && !editingId) {
    e.preventDefault();
    runAddTextCommandFromShortcut();
    return;
  }

  if (e.key === 'Escape') {
    hideMenus();
    if (isEyedropperSampleVisible()) {
      e.preventDefault();
      hideEyedropperSample();
      return;
    }
    if (editingId) {
      exitEdit();
      BoardfishEditorState.clearSelection();
      scheduleRender(false, true);
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

  if (isBoardInputBlocked()) { e.preventDefault(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'a')) {
    if (!editingId) {
      e.preventDefault();
      selectAllObjects();
    }
    return;
  }

  if (hasExactCommandModifier(e) && (isShortcutKey(e, 'q') || isShortcutKey(e, 'w'))) {
    if (hasTauri()) {
      e.preventDefault();
      requestAppClose();
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

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'x') && !editingId) {
    e.preventDefault();
    (async () => {
      await copySelected();
      deleteSelected();
    })();
    return;
  }

  if (hasExactCommandModifier(e, { shift: true }) && isShortcutKey(e, 'z')) { e.preventDefault(); redo(); return; }

  if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && isShortcutKey(e, 'y')) { e.preventDefault(); redo(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'z')) { e.preventDefault(); undo(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'd') && !editingId) { e.preventDefault(); duplicateSelected(); return; }
});
