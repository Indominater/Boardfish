'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const keyboardSource = fs.readFileSync(
  path.join(__dirname, '..', 'src/js/keyboard.js'),
  'utf8',
);

function keyEvent(overrides = {}) {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    cancelable: true,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...overrides,
  };
}

function loadKeyboard(overrides = {}) {
  const listeners = [];
  const calls = [];
  const context = {
    console,
    calls,
    document: {
      addEventListener(type, handler, options) {
        listeners.push({ type, handler, options });
      },
    },
    window: {
      innerWidth: 1000,
      innerHeight: 800,
    },
    selectedIds: new Set(),
    objectsMap: new Map(),
    editingId: null,
    isBoardInputBlocked: () => false,
    hasOpenContextMenu: () => false,
    runVisibleMenuCommandForShortcut: () => false,
    closeOpenMenusExcept: (activeMenuId, reason) => calls.push(['close', activeMenuId, reason]),
    newBoard: () => calls.push(['newBoard']),
    copySelected: () => calls.push(['copySelected']),
    saveBoard: () => calls.push(['saveBoard']),
    pasteAtPos: (x, y) => calls.push(['pasteAtPos', x, y]),
    toWorld: (x, y) => ({ x: x + 1, y: y + 1 }),
    hasSelection: () => false,
    applyTextLineAlignmentRange: () => false,
    textLogicalLineCount: () => 1,
    markDirty: () => calls.push(['markDirty']),
    scheduleRender: () => calls.push(['scheduleRender']),
    pushHistory: () => calls.push(['pushHistory']),
    rotateSelectedImages: () => calls.push(['rotateSelectedImages']),
    flipSelectedImages: () => calls.push(['flipSelectedImages']),
    runAddImagesCommandFromShortcut: () => calls.push(['runAddImagesCommandFromShortcut']),
    runAddTextCommandFromShortcut: () => calls.push(['runAddTextCommandFromShortcut']),
    hideMenus: () => calls.push(['hideMenus']),
    deselectAll: () => calls.push(['deselectAll']),
    openBoard: () => calls.push(['openBoard']),
    saveBoardAs: () => calls.push(['saveBoardAs']),
    resetZoomToClosestObject: () => calls.push(['resetZoomToClosestObject']),
    selectAllObjects: () => calls.push(['selectAllObjects']),
    deleteSelected: () => calls.push(['deleteSelected']),
    sendSelectedToBack: () => calls.push(['sendSelectedToBack']),
    BoardfishExportUtils: {
      selectedImageObjects: () => [],
    },
    saveSelectedImage: () => calls.push(['saveSelectedImage']),
    showInputShield: () => calls.push(['showInputShield']),
    saveSelectedImages: () => calls.push(['saveSelectedImages']),
    cutSelected: () => calls.push(['cutSelected']),
    redo: () => calls.push(['redo']),
    undo: () => calls.push(['undo']),
    duplicateSelected: () => calls.push(['duplicateSelected']),
    BoardfishMotion: {
      applyActionAnimation: (name) => calls.push(['motion', name]),
    },
  };
  context.globalThis = context;
  Object.assign(context, overrides);
  vm.createContext(context);
  vm.runInContext(keyboardSource, context, { filename: 'src/js/keyboard.js' });
  const keydownListeners = listeners.filter((listener) => listener.type === 'keydown');
  return {
    calls,
    context,
    keydownListeners,
    mainKeydown: keydownListeners[1].handler,
  };
}

test('keyboard shortcuts register the app command handler in capture phase', () => {
  const { keydownListeners } = loadKeyboard();

  assert.equal(keydownListeners.length, 2);
  assert.equal(keydownListeners[0].options, true);
  assert.equal(keydownListeners[1].options, true);
});

test('plain n is consumed and runs new board', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({ key: 'n', code: 'KeyN' });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [['newBoard']]);
});

test('plain n stays native while text editing', () => {
  const { calls, mainKeydown } = loadKeyboard({ editingId: 'text-1' });
  const event = keyEvent({ key: 'n', code: 'KeyN' });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test('cmd or ctrl+n is no longer the new board shortcut', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({ key: 'n', code: 'KeyN', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test('plain n is blocked during board input shields without running new board', () => {
  const { calls, mainKeydown } = loadKeyboard({
    isBoardInputBlocked: () => true,
  });
  const event = keyEvent({ key: 'n', code: 'KeyN' });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, []);
});

test('shortcuts use the visible menu command before fallback actions', () => {
  const { calls, mainKeydown } = loadKeyboard({
    editingId: 'text-1',
    hasOpenContextMenu: () => true,
    runVisibleMenuCommandForShortcut: (shortcutName) => {
      calls.push(['visibleMenuCommand', shortcutName]);
      return true;
    },
  });
  const event = keyEvent({ key: 'c', code: 'KeyC', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [['visibleMenuCommand', 'copy']]);
});

test('shortcuts close open menus before running fallback commands', () => {
  const { calls, mainKeydown } = loadKeyboard({
    hasOpenContextMenu: () => true,
    runVisibleMenuCommandForShortcut: (shortcutName) => {
      calls.push(['visibleMenuCommand', shortcutName]);
      return false;
    },
  });
  const event = keyEvent({ key: 's', code: 'KeyS', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [
    ['visibleMenuCommand', 'save'],
    ['close', '', 'shortcut:save'],
    ['saveBoard'],
  ]);
});

test('paste keydown stays native unless a context menu is open', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({ key: 'v', code: 'KeyV', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});
