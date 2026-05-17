'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function createElement(id = 'el') {
  const attrs = new Map();
  return {
    id,
    style: {},
    dataset: {},
    className: '',
    classList: {
      contains() { return false; },
      add() {},
      remove() {},
    },
    appendChild() {},
    addEventListener() {},
    contains() { return false; },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    querySelectorAll() { return []; },
  };
}

function objectBounds(objects) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const obj of objects) {
    x1 = Math.min(x1, obj.x);
    y1 = Math.min(y1, obj.y);
    x2 = Math.max(x2, obj.x + obj.w);
    y2 = Math.max(y2, obj.y + obj.h);
  }
  return { x1, y1, x2, y2 };
}

function loadSelectionInputHarness(objects, options = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/selection_input.js'), 'utf8');
  const byId = new Map(objects.map((obj) => [obj.id, obj]));
  const selectedIds = new Set(objects.map((obj) => obj.id));
  const context = {
    console,
    document: {
      getElementById: (id) => createElement(id),
      createElement: () => createElement(),
      addEventListener() {},
    },
    clearTimeout(id) { context.clearedTimeouts.push(id); },
    setTimeout(handler, delay) {
      context.timeoutHandler = handler;
      context.timeoutDelay = delay;
      return 1;
    },
    Node: function Node() {},
    selOverlay: createElement('sel-overlay'),
    multiSelOverlay: createElement('multi-sel-overlay'),
    rubberBand: createElement('rubber-band'),
    ctxMenu: createElement('ctx-menu'),
    objCtxMenu: createElement('obj-ctx-menu'),
    ctxActions: createElement('ctx-actions'),
    island: createElement('island'),
    openingShield: createElement('opening-shield'),
    selectedIds,
    selectedId: options.selectedId ?? (objects.length === 1 ? objects[0].id : null),
    objectsMap: byId,
    editingId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    dirty: [],
    history: [],
    historyOptions: [],
    _editEl: null,
    _editHistoryTimer: null,
    _editHistoryLastContent: null,
    _editHistoryActionStartState: null,
    clearedTimeouts: [],
    timeoutDelay: null,
    timeoutHandler: null,
    EDIT_HISTORY_DEBOUNCE_MS: 500,
    renders: [],
    syncedTextIds: [],
    motionPulses: [],
    isMultiSelected: () => selectedIds.size > 1,
    selectedObjectsList: () => objects,
    selectedBounds: () => objectBounds(objects),
    hasSelection: () => selectedIds.size > 0,
    getFirstSelectedObject: () => objects[0] || null,
    isBoardInputBlocked: () => false,
    shouldKeepSelectionOverlayWhileBlocked: () => false,
    acquireInputShield: () => () => {},
    BoardfishEditorState: { clearSelection() {} },
    beginDocumentDrag(handlers) { context.drag = handlers; },
    createRafCommitter(apply) {
      return {
        schedule(state) { apply(state); },
        flush() {},
      };
    },
    scheduleRender(board, overlay) { context.renders.push({ board, overlay }); },
    syncTextAutoHeight(obj) {
      context.syncedTextIds.push(obj.id);
      if (options.syncTextAutoHeight) {
        return options.syncTextAutoHeight(obj, context);
      }
      obj.h = Math.max(32, Math.round(obj.h));
      return true;
    },
    getTextMinLines: () => 1,
    markDirty(id) { context.dirty.push(id); },
    pushHistory(reason, historyOptions = {}) {
      context.history.push(reason);
      context.historyOptions.push(historyOptions);
    },
    BoardfishMotion: {
      applyActionAnimation(_action, payload = {}, options = {}) {
        if (!payload.selection) return false;
        context.motionPulses.push({ ...(payload.options || {}), ...options });
        return true;
      },
      pulseSelection(options = {}) {
        context.motionPulses.push(options);
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(
    `${source}\n` +
      'globalThis.beginSelectionHandleDrag = beginSelectionHandleDrag;\n' +
      'globalThis.proportionalCornerResizeSize = proportionalCornerResizeSize;\n' +
      'globalThis.flushEditHistoryCheckpoint = flushEditHistoryCheckpoint;\n' +
      'globalThis.beginTextEditHistoryAction = beginTextEditHistoryAction;\n' +
      'globalThis.recordTextEditInputHistory = recordTextEditInputHistory;\n',
    context,
  );
  return context;
}

test('multi-selection resize leaves text objects unchanged', () => {
  const objects = [
    { id: 'image-a', type: 'image', x: 0, y: 0, w: 100, h: 100, data: {} },
    { id: 'text-a', type: 'text', x: 200, y: 0, w: 100, h: 40, data: { content: 'a' } },
  ];
  const originalText = { ...objects[1] };
  const context = loadSelectionInputHarness(objects);

  context.beginSelectionHandleDrag({
    dataset: { dir: 'se' },
  }, {
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ clientX: 30, clientY: 30 });
  context.drag.up();

  assert.equal(Math.round(objects[0].w), 110);
  assert.equal(Math.round(objects[0].h), 110);
  assert.equal(objects[1].x, originalText.x);
  assert.equal(objects[1].y, originalText.y);
  assert.equal(objects[1].w, originalText.w);
  assert.equal(objects[1].h, originalText.h);
  assert.deepEqual(context.syncedTextIds, []);
  assert.deepEqual(context.dirty, ['image-a']);
  assert.deepEqual(context.history, ['multi-resize']);
  assert.equal(context.motionPulses.length, 1);
  assert.equal(context.motionPulses[0].includeText, false);
});

test('multi-selection resize anchors the opposite rectangle corner', () => {
  const objects = [
    { id: 'image-a', type: 'image', x: 0, y: 0, w: 100, h: 100, data: {} },
    { id: 'image-b', type: 'image', x: 200, y: 0, w: 100, h: 100, data: {} },
  ];
  const context = loadSelectionInputHarness(objects);

  context.beginSelectionHandleDrag({
    dataset: { dir: 'se' },
  }, {
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ clientX: 30, clientY: 10 });
  context.drag.up();

  const nextBounds = objectBounds(objects);
  assert.equal(Math.round(nextBounds.x1), 0);
  assert.equal(Math.round(nextBounds.y1), 0);
  assert.equal(Math.round(nextBounds.x2), 330);
  assert.equal(Math.round(nextBounds.y2), 110);
  assert.equal(Math.round(objects[0].x), 0);
  assert.equal(Math.round(objects[1].x), 220);
});

test('multi-selection resize follows the limiting axis of the dragged rectangle handle', () => {
  const objects = [
    { id: 'top-left', type: 'image', x: 0, y: 0, w: 200, h: 120, data: {} },
    { id: 'right', type: 'image', x: 400, y: 160, w: 200, h: 200, data: {} },
    { id: 'bottom-left', type: 'image', x: 0, y: 400, w: 200, h: 200, data: {} },
  ];
  const startBounds = objectBounds(objects);
  const context = loadSelectionInputHarness(objects);

  context.beginSelectionHandleDrag({
    dataset: { dir: 'ne' },
  }, {
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ clientX: 400, clientY: 40 });
  context.drag.up();

  const nextBounds = objectBounds(objects);
  assert.equal(Math.round(nextBounds.y1), startBounds.y1 + 40);
});

test('proportional corner resize uses the smaller implied scale', () => {
  const context = loadSelectionInputHarness([
    { id: 'image-a', type: 'image', x: 0, y: 0, w: 200, h: 100, data: {} },
    { id: 'image-b', type: 'image', x: 240, y: 0, w: 200, h: 100, data: {} },
  ]);

  const resized = context.proportionalCornerResizeSize('ne', 200, 100, 40, 10, 0.1);
  assert.equal(resized.w, 180);
  assert.equal(resized.h, 90);
});

test('single image resize anchors the opposite corner', () => {
  const image = { id: 'image-a', type: 'image', x: 0, y: 0, w: 200, h: 100, data: {} };
  const context = loadSelectionInputHarness([image]);

  context.beginSelectionHandleDrag({
    dataset: { dir: 'se' },
  }, {
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ clientX: 40, clientY: 20 });
  context.drag.up();

  assert.equal(Math.round(image.x), 0);
  assert.equal(Math.round(image.y), 0);
  assert.equal(Math.round(image.w), 240);
  assert.equal(Math.round(image.h), 120);
  assert.equal(Math.round(image.x + image.w), 240);
  assert.equal(Math.round(image.y + image.h), 120);
  assert.equal(context.motionPulses.length, 1);
  assert.equal(context.motionPulses[0].includeText, false);
});

test('single text horizontal resize anchors the opposite side after auto-height sync', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'hello' } };
  const context = loadSelectionInputHarness([text], {
    syncTextAutoHeight(obj) {
      obj.h = 80;
      return true;
    },
  });

  context.beginSelectionHandleDrag({
    dataset: { dir: 'e' },
  }, {
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ clientX: 40, clientY: 0 });
  context.drag.up();

  assert.equal(text.x, 0);
  assert.equal(text.y, 0);
  assert.equal(text.w, 240);
  assert.equal(text.h, 80);
  assert.deepEqual(context.motionPulses, []);
});

test('save flushes a pending text edit checkpoint into the saved baseline', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'after' } };
  const context = loadSelectionInputHarness([text]);
  context.editingId = text.id;
  context._editHistoryTimer = 42;
  context._editHistoryLastContent = 'before';

  assert.equal(context.flushEditHistoryCheckpoint(), true);
  assert.equal(context._editHistoryTimer, null);
  assert.equal(context._editHistoryLastContent, 'after');
  assert.deepEqual(context.dirty, [text.id]);
  assert.deepEqual(context.history, ['text-edit-checkpoint']);
});

test('continuous text edits debounce into a 500ms checkpoint', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'after' } };
  const context = loadSelectionInputHarness([text]);
  context.editingId = text.id;
  context._editEl = {
    value: 'before',
    selectionStart: 3,
    selectionEnd: 3,
    selectionDirection: 'none',
  };
  context._editHistoryLastContent = 'before';
  context.beginTextEditHistoryAction(text.id, {
    start: 3,
    end: 3,
    direction: 'none',
  });

  assert.equal(context.recordTextEditInputHistory(text.id, {
    inputType: 'deleteContentBackward',
    hadSelection: false,
  }), false);

  assert.equal(context.timeoutDelay, 500);
  assert.deepEqual(context.history, []);
  context.timeoutHandler();
  assert.equal(context._editHistoryTimer, null);
  assert.deepEqual(context.history, ['text-edit-checkpoint']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.historyOptions[0].beforeEditState)), {
    id: text.id,
    selectionStart: 3,
    selectionEnd: 3,
    selectionDirection: 'none',
  });
});

test('selection replace and paste text edits commit without debounce', () => {
  for (const meta of [
    { inputType: 'deleteContentBackward', hadSelection: true },
    { inputType: 'insertFromPaste', hadSelection: false },
  ]) {
    const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'after' } };
    const context = loadSelectionInputHarness([text]);
    context.editingId = text.id;
    context._editHistoryTimer = 42;
    context._editHistoryLastContent = 'before';

    assert.equal(context.recordTextEditInputHistory(text.id, meta), true);
    assert.equal(context._editHistoryTimer, null);
    assert.equal(context.timeoutDelay, null);
    assert.deepEqual(context.history, ['text-edit-checkpoint']);
  }
});
