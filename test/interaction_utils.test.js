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
      kind: 'pinned-eyedropper-card',
      reason: 'eyedropper-card:pointerdown',
      closeMenus: true,
      clearObjectSelection: true,
      exitTextEdit: true,
    });

    assert.deepEqual(calls, [
      ['close', '', 'eyedropper-card:pointerdown'],
      ['deselect'],
    ]);
    assert.deepEqual(result, {
      kind: 'pinned-eyedropper-card',
      reason: 'eyedropper-card:pointerdown',
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
