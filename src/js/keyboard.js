'use strict';

document.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); return; }

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

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    if (!editingId) {
      e.preventDefault();
      selectAllObjects();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'w')) {
    if (hasTauri()) {
      e.preventDefault();
      requestAppClose();
    }
    return;
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && hasSelection() && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !editingId) {
    e.preventDefault();
    newBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !editingId) {
    e.preventDefault();
    openBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveBoardAs();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBoard(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingId) { e.preventDefault(); copySelected(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && !editingId) {
    e.preventDefault();
    (async () => {
      await copySelected();
      deleteSelected();
    })();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) { e.preventDefault(); redo(); return; }

  if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !editingId) { e.preventDefault(); duplicateSelected(); return; }
});

