'use strict';

function isShortcutKey(e, letter) {
  const normalizedLetter = letter.toLowerCase();
  return e.key.toLowerCase() === normalizedLetter || e.code === `Key${normalizedLetter.toUpperCase()}`;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'r')) { e.preventDefault(); return; }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'l')) {
    e.preventDefault();
    toggleAppTheme();
    return;
  }

  if (e.key === 'Escape') {
    hideMenus();
    if (editingId) {
      exitEdit();
      selectedId = null;
      selectedIds.clear();
      scheduleRender(false, true);
      return;
    }
    deselectAll();
    return;
  }

  if (isBoardInputBlocked()) { e.preventDefault(); return; }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'a')) {
    if (!editingId) {
      e.preventDefault();
      selectAllObjects();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && (isShortcutKey(e, 'q') || isShortcutKey(e, 'w'))) {
    if (hasTauri()) {
      e.preventDefault();
      requestAppClose();
    }
    return;
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && hasSelection() && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'n') && !editingId) {
    e.preventDefault();
    newBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'o') && !editingId) {
    e.preventDefault();
    openBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && isShortcutKey(e, 's')) {
    e.preventDefault();
    saveBoardAs();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 's')) { e.preventDefault(); saveBoard(); return; }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'c') && !editingId) { e.preventDefault(); copySelected(); return; }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'x') && !editingId) {
    e.preventDefault();
    (async () => {
      await copySelected();
      deleteSelected();
    })();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && isShortcutKey(e, 'z')) { e.preventDefault(); redo(); return; }

  if (e.ctrlKey && !e.metaKey && isShortcutKey(e, 'y')) { e.preventDefault(); redo(); return; }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'z')) { e.preventDefault(); undo(); return; }

  if ((e.ctrlKey || e.metaKey) && isShortcutKey(e, 'd') && !editingId) { e.preventDefault(); duplicateSelected(); return; }
});
