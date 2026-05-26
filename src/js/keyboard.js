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

function hasOtherActiveKeyboardKey(keyId) {
  for (const activeKey of activeKeyboardKeys) {
    if (activeKey !== keyId) return true;
  }
  return false;
}

function clearNonModifierActiveKeyboardKeys() {
  for (const keyId of [...activeKeyboardKeys]) {
    if (!isModifierKeyId(keyId)) deleteActiveKeyboardKey(keyId);
  }
}

function endEyedropperHoldIfActive(e = null) {
  if (
    typeof _eyedropperHoldActive !== 'undefined' &&
    _eyedropperHoldActive &&
    typeof endEyedropperHoldSample === 'function'
  ) {
    if (e?.cancelable) e.preventDefault();
    endEyedropperHoldSample(e);
    return true;
  }
  return false;
}

function reconcileEyedropperHoldModifierState(e) {
  if (!e || e.shiftKey || e.key === 'Shift') return false;
  return endEyedropperHoldIfActive(e);
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

const isNativeFindShortcut = (e) => {
  const commandFind = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'f');
  const findByLetter = (e.ctrlKey || e.metaKey) && isShortcutKey(e, 'g') && !e.altKey;
  const findNext = e.key === 'F3' || e.code === 'F3';
  return commandFind || findByLetter || findNext;
};

document.addEventListener('keydown', (e) => {
  if (isNativeFindShortcut(e)) {
    if (hasExactCommandModifier(e) && isShortcutKey(e, 'f') && canTransformSelectedImagesFromKeyboard()) return;
    globalThis.BoardfishMotion?.applyActionAnimation?.('native-find-shortcut');
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

document.addEventListener('keydown', (e) => {
  const keyId = e.code || e.key;
  const keyDownAt = performance.now();
  pruneActiveKeyboardKeys(keyDownAt);
  reconcileModifierKeyboardState(e);
  reconcileEyedropperHoldModifierState(e);
  const hasOtherKeyDown = hasOtherActiveKeyboardKey(keyId);
  activeKeyboardKeys.add(keyId);
  activeKeyboardKeyTimes.set(keyId, keyDownAt);

  if (e.key === 'Alt') { e.preventDefault(); return; }
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

  if (isShiftOnlyKey(e) && !editingId) {
    const shiftDebug = typeof beginEyedropperShiftKeyDebug === 'function'
      ? beginEyedropperShiftKeyDebug(e, { keyId, keyDownAt, hasOtherKeyDown, activeKeyCount: activeKeyboardKeys.size })
      : { activationAt: keyDownAt };
    if (!e.repeat && !hasOtherKeyDown) {
      e.preventDefault();
      const enableStart = performance.now();
      setEyedropperEnabled(true);
      const enableMs = performance.now() - enableStart;
      const beginStart = performance.now();
      const holdStarted = beginEyedropperHoldSample(e, shiftDebug);
      if (typeof finishEyedropperShiftKeyDebug === 'function') {
        finishEyedropperShiftKeyDebug(e, { ...shiftDebug, enableMs, beginHoldMs: performance.now() - beginStart, totalMs: performance.now() - keyDownAt, holdStarted });
      }
    } else if (typeof logEyedropperShortcutDebug === 'function') {
      logEyedropperShortcutDebug('shift-keydown-skipped', { repeat: !!e.repeat, hasOtherKeyDown, enabled: eyedropperEnabled, holdActive: _eyedropperHoldActive });
    }
    return;
  }

  if (hasNoShortcutModifiers(e) && isShortcutKey(e, 't') && !editingId && !e.repeat) {
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

document.addEventListener('keyup', (e) => {
  const keyId = e.code || e.key;
  const keyUpAt = performance.now();
  deleteActiveKeyboardKey(keyId);
  if (isModifierKeyId(keyId)) clearNonModifierActiveKeyboardKeys();
  reconcileModifierKeyboardState(e);
  if (e.key === 'Shift') {
    const endedHold = endEyedropperHoldIfActive(e);
    if (typeof logEyedropperShiftKeyupDebug === 'function') logEyedropperShiftKeyupDebug(e, { keyUpAt, endedHold });
    if (endedHold) return;
  }
  reconcileEyedropperHoldModifierState(e);
});

window.addEventListener('blur', () => {
  clearActiveKeyboardKeys();
  endEyedropperHoldIfActive();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    clearActiveKeyboardKeys();
    endEyedropperHoldIfActive();
  }
});
