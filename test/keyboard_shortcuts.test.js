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
      activeElement: null,
      addEventListener(type, handler, options) {
        listeners.push({ type, handler, options });
      },
    },
    window: {
      innerWidth: 1000,
      innerHeight: 800,
      getSelection: () => ({ isCollapsed: true, toString: () => '' }),
    },
    selectedIds: new Set(),
    objectsMap: new Map(),
    editingId: null,
    _editEl: null,
    isBoardInputBlocked: () => false,
    hasOpenContextMenu: () => false,
    runVisibleMenuCommandForShortcut: () => false,
    closeOpenMenusExcept: (activeMenuId, reason) => calls.push(['close', activeMenuId, reason]),
    newBoard: () => calls.push(['newBoard']),
    copySelected: () => calls.push(['copySelected']),
    saveBoard: () => calls.push(['saveBoard']),
    pasteAtPos: (x, y) => calls.push(['pasteAtPos', x, y]),
    enterEdit: (id, options = {}) => calls.push(['enterEdit', id, options]),
    toWorld: (x, y) => ({ x: x + 1, y: y + 1 }),
    hasSelection: () => false,
    applyTextLineAlignmentRange: () => false,
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
    mainKeydown: keydownListeners[0].handler,
  };
}

test('keyboard shortcuts register the app command handler in capture phase', () => {
  const { keydownListeners } = loadKeyboard();

  assert.equal(keydownListeners.length, 1);
  assert.equal(keydownListeners[0].options, true);
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

test('held copy shortcut is consumed without repeating the copy command', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({ key: 'c', code: 'KeyC', metaKey: true, repeat: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, []);
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

test('paste shortcut fallback uses the current cursor point', () => {
  const { calls, mainKeydown } = loadKeyboard({
    hasOpenContextMenu: () => true,
    runVisibleMenuCommandForShortcut: (shortcutName) => {
      calls.push(['visibleMenuCommand', shortcutName]);
      return false;
    },
    boardCursorWorldPoint: () => ({ x: 41, y: 42 }),
  });
  const event = keyEvent({ key: 'v', code: 'KeyV', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [
    ['visibleMenuCommand', 'paste'],
    ['close', '', 'shortcut:paste'],
    ['pasteAtPos', 41, 42],
  ]);
});

test('plain enter edits a single selected text object with the caret at the end', () => {
  const selectedIds = new Set(['text-1']);
  const textObject = { id: 'text-1', type: 'text', data: { content: 'selected text' } };
  const objectsMap = new Map([[textObject.id, textObject]]);
  const { calls, mainKeydown } = loadKeyboard({ selectedIds, objectsMap });
  const event = keyEvent({ key: 'Enter', code: 'Enter' });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['enterEdit', 'text-1', { placeInitialCaret: true }],
  ]);
});

test('plain enter does not edit text objects in a multi-selection', () => {
  const selectedIds = new Set(['text-1', 'image-1']);
  const textObject = { id: 'text-1', type: 'text', data: { content: 'selected text' } };
  const imageObject = { id: 'image-1', type: 'image' };
  const objectsMap = new Map([
    [textObject.id, textObject],
    [imageObject.id, imageObject],
  ]);
  const { calls, mainKeydown } = loadKeyboard({ selectedIds, objectsMap });
  const event = keyEvent({ key: 'Enter', code: 'Enter' });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test('cmd+arrow text alignment applies to the active text edit', () => {
  const { calls, mainKeydown } = loadKeyboard({
    editingId: 'text-1',
    _editEl: {},
    applyTextEditAlignmentFromKeyboard: (direction) => {
      calls.push(['alignEdit', direction]);
      return true;
    },
  });
  const event = keyEvent({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [['alignEdit', 'right']]);
});

test('cmd+arrow text alignment falls through for editable DOM targets', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({
    key: 'ArrowRight',
    code: 'ArrowRight',
    metaKey: true,
    target: { tagName: 'INPUT', type: 'text' },
  });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test('cmd+arrow text alignment falls through while document text is selected', () => {
  const { calls, mainKeydown } = loadKeyboard({
    window: {
      innerWidth: 1000,
      innerHeight: 800,
      getSelection: () => ({ isCollapsed: false, toString: () => 'selected text' }),
    },
  });
  const event = keyEvent({ key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test('cmd+arrow text alignment still applies to selected text objects outside editing', () => {
  const selectedIds = new Set(['text-1', 'image-1']);
  const textObject = { id: 'text-1', type: 'text', data: { content: 'one\ntwo' } };
  const objectsMap = new Map([
    [textObject.id, textObject],
    ['image-1', { id: 'image-1', type: 'image' }],
  ]);
  const { calls, mainKeydown } = loadKeyboard({
    selectedIds,
    objectsMap,
    applyTextLineAlignmentRange: (obj, startLine, endLine, direction) => {
      calls.push(['align', obj.id, startLine, endLine, direction]);
      return true;
    },
    markDirty: (id) => calls.push(['markDirty', id]),
    scheduleRender: (board, overlay, reason) => calls.push(['scheduleRender', board, overlay, reason]),
    pushHistory: (reason) => calls.push(['pushHistory', reason]),
  });
  const event = keyEvent({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [
    ['align', 'text-1', 0, Infinity, 'right'],
    ['markDirty', 'text-1'],
    ['scheduleRender', true, true, 'text-align'],
    ['pushHistory', 'text-align'],
  ]);
});

test('cmd+r falls through to browser reload when no image can rotate', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({ key: 'r', code: 'KeyR', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test('cmd+r rotates selected images when available', () => {
  const selectedIds = new Set(['obj-1']);
  const objectsMap = new Map([['obj-1', { id: 'obj-1', type: 'image' }]]);
  const { calls, mainKeydown } = loadKeyboard({ selectedIds, objectsMap });
  const event = keyEvent({ key: 'r', code: 'KeyR', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [
    ['rotateSelectedImages'],
  ]);
});

test('cmd+f falls through to browser find when no image can flip', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({ key: 'f', code: 'KeyF', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test('cmd+f flips selected images when available', () => {
  const selectedIds = new Set(['obj-1']);
  const objectsMap = new Map([['obj-1', { id: 'obj-1', type: 'image' }]]);
  let blockedChecks = 0;
  const { calls, mainKeydown } = loadKeyboard({
    selectedIds,
    objectsMap,
    isBoardInputBlocked: () => !(++blockedChecks),
  });
  const event = keyEvent({ key: 'f', code: 'KeyF', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [
    ['flipSelectedImages'],
  ]);
  assert.equal(blockedChecks, 1);
});

test('cmd+y is consumed as redo before browser actions', () => {
  const { calls, mainKeydown } = loadKeyboard();
  const event = keyEvent({ key: 'y', code: 'KeyY', metaKey: true });

  mainKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(calls, [
    ['redo'],
  ]);
});
