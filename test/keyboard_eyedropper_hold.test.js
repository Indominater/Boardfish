'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function addListener(listeners, type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}

function makeKeyboardEvent(type, init = {}) {
  return {
    type,
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
    ...init,
  };
}

function loadKeyboardHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/keyboard.js'), 'utf8');
  const documentListeners = new Map();
  const windowListeners = new Map();
  let now = 0;
  const context = {
    console,
    performance: { now: () => ++now },
    editingId: null,
    _eyedropperHoldActive: false,
    eyedropperEnabled: false,
    calls: [],
    document: {
      visibilityState: 'visible',
      addEventListener(type, fn) { addListener(documentListeners, type, fn); },
    },
    window: {
      addEventListener(type, fn) { addListener(windowListeners, type, fn); },
    },
    setEyedropperEnabled(enabled) {
      context.eyedropperEnabled = !!enabled;
      context.calls.push(['set', !!enabled]);
    },
    beginEyedropperHoldSample(e) {
      context._eyedropperHoldActive = true;
      context.calls.push(['begin', e?.type || null]);
    },
    endEyedropperHoldSample(e) {
      context._eyedropperHoldActive = false;
      context.eyedropperEnabled = false;
      context.calls.push(['end', e?.type || null]);
    },
    runAddImagesCommandFromShortcut() {},
    runAddTextCommandFromShortcut() {
      context.calls.push(['add-text']);
    },
    hideMenus() {},
    isEyedropperSampleVisible: () => false,
    hideEyedropperSample() {},
    exitEdit() {},
    BoardfishEditorState: { clearSelection() {} },
    scheduleRender() {},
    deselectAll() {},
    openBoard() {},
    saveBoardAs() {},
    saveBoard() {},
    resetZoomToClosestObject() {
      context.calls.push(['reset-zoom']);
    },
    isBoardInputBlocked: () => false,
    selectAllObjects() {},
    hasTauri: () => false,
    requestAppClose() {},
    hasSelection: () => false,
    deleteSelected() {},
    newBoard() {},
    copySelected() {},
    sendSelectedToBack() {},
    selectedIds: new Set(),
    objectsMap: new Map(),
    saveSelectedImage() {},
    showInputShield() {},
    saveSelectedImages() {},
    redo() {},
    undo() {},
    duplicateSelected() {},
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    context,
    documentEvent(type, init = {}) {
      const event = makeKeyboardEvent(type, init);
      for (const fn of documentListeners.get(type) || []) fn(event);
      return event;
    },
    windowEvent(type) {
      for (const fn of windowListeners.get(type) || []) fn();
    },
  };
}

function beginShiftHold(harness) {
  harness.documentEvent('keydown', {
    key: 'Shift',
    code: 'ShiftLeft',
    shiftKey: true,
  });
  assert.equal(harness.context._eyedropperHoldActive, true);
  assert.equal(harness.context.eyedropperEnabled, true);
}

test('shift eyedropper hold ends when window blurs before keyup', () => {
  const harness = loadKeyboardHarness();
  beginShiftHold(harness);

  harness.windowEvent('blur');

  assert.equal(harness.context._eyedropperHoldActive, false);
  assert.equal(harness.context.eyedropperEnabled, false);
  assert.deepEqual(harness.context.calls.at(-1), ['end', null]);
});

test('shift eyedropper hold ends when document is hidden before keyup', () => {
  const harness = loadKeyboardHarness();
  beginShiftHold(harness);

  harness.context.document.visibilityState = 'hidden';
  harness.documentEvent('visibilitychange');

  assert.equal(harness.context._eyedropperHoldActive, false);
  assert.equal(harness.context.eyedropperEnabled, false);
  assert.deepEqual(harness.context.calls.at(-1), ['end', null]);
});

test('shift eyedropper hold ends when later keydown reports shift released', () => {
  const harness = loadKeyboardHarness();
  beginShiftHold(harness);

  const event = harness.documentEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    shiftKey: false,
  });

  assert.equal(harness.context._eyedropperHoldActive, false);
  assert.equal(harness.context.eyedropperEnabled, false);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.context.calls.at(-1), ['end', 'keydown']);
});

test('plain T adds text without command modifier', () => {
  const harness = loadKeyboardHarness();

  const event = harness.documentEvent('keydown', {
    key: 't',
    code: 'KeyT',
  });

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.context.calls.at(-1), ['add-text']);
});

test('command T no longer adds text', () => {
  const harness = loadKeyboardHarness();

  const event = harness.documentEvent('keydown', {
    key: 't',
    code: 'KeyT',
    ctrlKey: true,
  });

  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.context.calls.some((call) => call[0] === 'add-text'), false);
});

test('command 0 resets zoom while editing text', () => {
  const harness = loadKeyboardHarness();
  harness.context.editingId = 'text-1';

  const event = harness.documentEvent('keydown', {
    key: '0',
    code: 'Digit0',
    ctrlKey: true,
  });

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.context.calls.at(-1), ['reset-zoom']);
});
