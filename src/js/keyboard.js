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

function isShiftOnlyKey(e) {
  return e.key === 'Shift' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

const activeKeyboardKeys = new Set();
const activeKeyboardKeyTimes = new Map();
const STALE_ACTIVE_KEY_MS = 1200;
const MODIFIER_KEY_IDS = new Set([
  'Alt',
  'AltLeft',
  'AltRight',
  'Control',
  'ControlLeft',
  'ControlRight',
  'Meta',
  'MetaLeft',
  'MetaRight',
  'Shift',
  'ShiftLeft',
  'ShiftRight',
]);

function isModifierKeyId(keyId) {
  return MODIFIER_KEY_IDS.has(keyId);
}

function clearActiveKeyboardKeys() {
  activeKeyboardKeys.clear();
  activeKeyboardKeyTimes.clear();
}

function deleteActiveKeyboardKey(keyId) {
  activeKeyboardKeys.delete(keyId);
  activeKeyboardKeyTimes.delete(keyId);
}

function pruneActiveKeyboardKeys(now = performance.now()) {
  for (const keyId of activeKeyboardKeys) {
    const pressedAt = activeKeyboardKeyTimes.get(keyId) || 0;
    if (!isModifierKeyId(keyId) && now - pressedAt > STALE_ACTIVE_KEY_MS) {
      deleteActiveKeyboardKey(keyId);
    }
  }
}

function clearNonModifierActiveKeyboardKeys() {
  for (const keyId of [...activeKeyboardKeys]) {
    if (!isModifierKeyId(keyId)) deleteActiveKeyboardKey(keyId);
  }
}

function reconcileModifierKeyboardState(e) {
  if (!e.altKey) {
    deleteActiveKeyboardKey('Alt');
    deleteActiveKeyboardKey('AltLeft');
    deleteActiveKeyboardKey('AltRight');
  }
  if (!e.ctrlKey) {
    deleteActiveKeyboardKey('Control');
    deleteActiveKeyboardKey('ControlLeft');
    deleteActiveKeyboardKey('ControlRight');
  }
  if (!e.metaKey) {
    deleteActiveKeyboardKey('Meta');
    deleteActiveKeyboardKey('MetaLeft');
    deleteActiveKeyboardKey('MetaRight');
  }
  if (!e.shiftKey && e.key !== 'Shift') {
    deleteActiveKeyboardKey('Shift');
    deleteActiveKeyboardKey('ShiftLeft');
    deleteActiveKeyboardKey('ShiftRight');
  }
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
  const keyId = e.code || e.key;
  const keyDownAt = performance.now();
  pruneActiveKeyboardKeys(keyDownAt);
  reconcileModifierKeyboardState(e);
  const hasOtherKeyDown = [...activeKeyboardKeys].some((activeKey) => activeKey !== keyId);
  activeKeyboardKeys.add(keyId);
  activeKeyboardKeyTimes.set(keyId, keyDownAt);

  if (e.key === 'Alt') { e.preventDefault(); return; }
  if (hasExactCommandModifier(e) && isShortcutKey(e, 'r')) { e.preventDefault(); return; }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 'i') && !editingId) {
    e.preventDefault();
    runAddImagesCommandFromShortcut();
    return;
  }

  if (isShiftOnlyKey(e) && !editingId) {
    if (!e.repeat && !hasOtherKeyDown) {
      e.preventDefault();
      setEyedropperEnabled(true);
      beginEyedropperHoldSample(e);
    }
    return;
  }

  if (hasExactCommandModifier(e) && isShortcutKey(e, 't') && !editingId) {
    e.preventDefault();
    runAddTextCommandFromShortcut();
    return;
  }

  if (e.key === 'Escape') {
    hideMenus();
    if (isEyedropperSampleVisible() && (typeof isEyedropperSamplePinned !== 'function' || !isEyedropperSamplePinned())) {
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

  if (hasExactCommandModifier(e) && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') && !editingId) {
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

document.addEventListener('keyup', (e) => {
  const keyId = e.code || e.key;
  deleteActiveKeyboardKey(keyId);
  if (isModifierKeyId(keyId)) clearNonModifierActiveKeyboardKeys();
  reconcileModifierKeyboardState(e);
  if (e.key === 'Shift' && !editingId && typeof _eyedropperHoldActive !== 'undefined' && _eyedropperHoldActive) {
    e.preventDefault();
    endEyedropperHoldSample(e);
  }
});

window.addEventListener('blur', () => {
  clearActiveKeyboardKeys();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') clearActiveKeyboardKeys();
});
