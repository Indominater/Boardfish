'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('createRafCommitter coalesces scheduled state and supports flush', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  let callback = null;
  globalThis.requestAnimationFrame = (fn) => {
    callback = fn;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  const Interaction = require('../src/js/interaction_utils.js');
  const applied = [];

  try {
    const committer = Interaction.createRafCommitter((state) => applied.push(state));
    committer.schedule({ value: 1 });
    committer.schedule({ value: 2 });
    assert.equal(committer.pending, true);
    assert.deepEqual(applied, []);
    callback();
    assert.deepEqual(applied, [{ value: 2 }]);
    assert.equal(committer.pending, false);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('beginDocumentDrag attaches listeners and cleanup calls the up handler once', () => {
  const previousDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  delete require.cache[require.resolve('../src/js/interaction_utils.js')];
  const Interaction = require('../src/js/interaction_utils.js');
  const moves = [];
  const ups = [];

  try {
    const cleanup = Interaction.beginDocumentDrag({
      move: (event) => moves.push(event.x),
      up: (event) => ups.push(event?.x ?? null),
    });
    listeners.get('mousemove')({ x: 3 });
    cleanup({ x: 4 });
    cleanup({ x: 5 });
    assert.deepEqual(moves, [3]);
    assert.deepEqual(ups, [4]);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('beginDocumentDrag cancels and cleans up on window blur', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentListeners = new Map();
  const windowListeners = new Map();
  globalThis.document = {
    hidden: false,
    visibilityState: 'visible',
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (documentListeners.get(type) === handler) documentListeners.delete(type);
    },
  };
  globalThis.window = {
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (windowListeners.get(type) === handler) windowListeners.delete(type);
    },
  };
  delete require.cache[require.resolve('../src/js/interaction_utils.js')];
  const Interaction = require('../src/js/interaction_utils.js');
  const ups = [];

  try {
    Interaction.beginDocumentDrag({
      move() {},
      up: (event) => ups.push(event),
    });
    windowListeners.get('blur')({ type: 'blur' });
    assert.equal(ups.length, 1);
    assert.equal(ups[0].__boardfishDragCancel, true);
    assert.equal(ups[0].type, 'blur');
    assert.equal(documentListeners.size, 0);
    assert.equal(windowListeners.size, 0);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('activateInteractiveSurface closes menus and clears object selection by contract', () => {
  const previousGlobals = {
    closeOpenMenusExcept: globalThis.closeOpenMenusExcept,
    deselectAll: globalThis.deselectAll,
    selectedIds: globalThis.selectedIds,
    editingId: globalThis.editingId,
  };
  delete require.cache[require.resolve('../src/js/interaction_utils.js')];
  const Interaction = require('../src/js/interaction_utils.js');
  const calls = [];

  try {
    globalThis.selectedIds = new Set(['obj-1']);
    globalThis.editingId = 'obj-1';
    globalThis.closeOpenMenusExcept = (activeMenuId, reason) => calls.push(['close', activeMenuId, reason]);
    globalThis.deselectAll = () => calls.push(['deselect']);

    const result = Interaction.activateInteractiveSurface({
      kind: 'floating-panel',
      reason: 'floating-panel:pointerdown',
      closeMenus: true,
      clearObjectSelection: true,
      exitTextEdit: true,
    });

    assert.deepEqual(calls, [
      ['close', '', 'floating-panel:pointerdown'],
      ['deselect'],
    ]);
    assert.deepEqual(result, {
      kind: 'floating-panel',
      reason: 'floating-panel:pointerdown',
      closedMenus: true,
      clearedObjectSelection: true,
      exitedTextEdit: true,
    });
  } finally {
    globalThis.closeOpenMenusExcept = previousGlobals.closeOpenMenusExcept;
    globalThis.deselectAll = previousGlobals.deselectAll;
    globalThis.selectedIds = previousGlobals.selectedIds;
    globalThis.editingId = previousGlobals.editingId;
  }
});
