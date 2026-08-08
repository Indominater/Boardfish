'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('createRafCommitter coalesces scheduled state and supports flush', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  let requestCount = 0;
  const cancelled = [];
  globalThis.requestAnimationFrame = () => {
    requestCount++;
    return 0;
  };
  globalThis.cancelAnimationFrame = (id) => cancelled.push(id);
  const Interaction = require('../src/js/interaction_utils.js');
  const applied = [];

  try {
    const committer = Interaction.createRafCommitter((...values) => applied.push(values));
    committer.schedule(1, 2, 3, 4);
    committer.schedule(5, 6, 7, 8);
    assert.equal(requestCount, 1);
    assert.equal(committer.pending, true);
    assert.deepEqual(applied, []);
    committer.flush();
    assert.deepEqual(cancelled, [0]);
    assert.deepEqual(applied, [[5, 6, 7, 8]]);
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
    listeners.get('mouseup')({ x: 4 });
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
