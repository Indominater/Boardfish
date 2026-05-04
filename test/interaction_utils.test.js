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
