'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function cloneObject(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadHistoryHarness() {
  const pulses = [];
  const jelloAdded = [];
  const jelloRemoved = [];
  const smoothAdded = [];
  const smoothRemoved = [];
  const ids = (items) => Array.from(items || [], (obj) => obj.id);
  const motionItems = (items, options = {}) => {
    const list = Array.from(items || []);
    return options.includeText === false ? list.filter((obj) => obj?.type !== 'text') : list;
  };
  const context = {
    console,
    performance: { now: () => 0 },
    clearInterval() {},
    clearTimeout() {},
    document: {
      removeEventListener() {},
    },
    jsClipboard: null,
    objects: [],
    objectsMap: new Map(),
    selectedId: null,
    selectedIds: new Set(),
    editingId: null,
    _dirtyIds: new Set(),
    _caretBlinkInterval: null,
    _editHistoryTimer: null,
    _editHistoryLastContent: null,
    _selChangeListener: null,
    _editEl: null,
    pulses,
    jelloAdded,
    jelloRemoved,
    smoothAdded,
    smoothRemoved,
    BoardfishEditorState: {
      replaceBoardObjects(nextObjects) {
        context.objects = nextObjects;
        context.objectsMap = new Map(nextObjects.map((obj) => [obj.id, obj]));
        return nextObjects;
      },
      setSelection(ids = []) {
        context.selectedIds.clear();
        context.selectedId = null;
        for (const id of ids) {
          if (!context.objectsMap.has(id)) continue;
          context.selectedIds.add(id);
          context.selectedId = id;
        }
        return context.selectedIds.size;
      },
    },
    BoardfishMotion: {
      applyActionAnimation(action, payload = {}, options = {}) {
        const list = Array.from(payload.objects || payload.addedObjects || []);
        const removed = Array.from(payload.removedObjects || []);
        const motionOptions = { ...(payload.options || {}), ...options };
        if (action === 'object-delete') {
          return false;
        }
        if (String(action).startsWith('text-box-')) {
          return false;
        }
        if (payload.selection) {
          pulses.push({ ...motionOptions });
          return true;
        }
        const addedIds = ids(motionItems(list, motionOptions));
        const removedIds = ids(motionItems(removed, motionOptions));
        if (addedIds.length) jelloAdded.push({ ids: addedIds, options: { ...motionOptions } });
        if (removedIds.length) jelloRemoved.push({ ids: removedIds, options: { ...motionOptions } });
        return !!(addedIds.length || removedIds.length);
      },
      noteObjectsAdded(items, options = {}) {
        const list = Array.from(items || []);
        if (options.textMotion === 'smooth-slide') {
          const textIds = options.includeText === false ? [] : ids(list.filter((obj) => obj?.type === 'text'));
          const jelloIds = ids(list.filter((obj) => obj?.type !== 'text'));
          if (textIds.length) smoothAdded.push(textIds);
          if (jelloIds.length) jelloAdded.push({ ids: jelloIds, options: { ...options, includeText: false } });
          return;
        }
        const motionIds = ids(motionItems(list, options));
        if (motionIds.length) jelloAdded.push({ ids: motionIds, options: { ...options } });
      },
      noteObjectsJello(items, options = {}) {
        const motionIds = ids(motionItems(items, options));
        if (motionIds.length) jelloAdded.push({ ids: motionIds, options: { ...options } });
      },
      noteObjectsJelloRemoved(items, options = {}) {
        const motionIds = ids(motionItems(items, options));
        if (motionIds.length) jelloRemoved.push({ ids: motionIds, options: { ...options } });
      },
      noteObjectsRemoved(items, options = {}) {
        const motionIds = ids(motionItems(items, options));
        if (motionIds.length) smoothRemoved.push(motionIds);
      },
      noteObjectsSmoothSlideAdded(items) {
        smoothAdded.push(ids(items));
      },
      pulseSelection(options = {}) {
        pulses.push({ ...options });
      },
    },
    HistoryDebug: {
      count() {},
      end() {},
      max() {},
      start() { return {}; },
      step() {},
    },
    cloneObject,
    cloneObjects(list) {
      return list.map(cloneObject);
    },
    invalidateOffscreen() {},
    markDirty(id) {
      context._dirtyIds.add(id);
    },
    pruneEyedropperSafeImagesToKeys() {
      return null;
    },
    pruneImageCachesToKeys() {
      return null;
    },
    scheduleRender() {},
    updateTitle() {},
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/js/history_state.js'), 'utf8'),
    context,
    { filename: 'history_state.js' },
  );
  return context;
}

function setBoard(context, objects, selectedIds = []) {
  context.objects = objects.map(cloneObject);
  context.objectsMap = new Map(context.objects.map((obj) => [obj.id, obj]));
  context.selectedIds = new Set(selectedIds);
  context.selectedId = selectedIds[selectedIds.length - 1] || null;
}

test('undo and redo keep text out of selection pulse for text-safe actions', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
  ], ['text-1']);

  context.snapshot();
  context.objects[0].x = 24;
  context.markDirty('text-1');
  context.pushHistory('drag');

  context.undo();
  context.redo();

  assert.deepEqual(context.pulses, [
    { includeText: false },
    { includeText: false },
  ]);
  assert.deepEqual(context.jelloAdded, []);
  assert.deepEqual(context.jelloRemoved, []);
  assert.deepEqual(context.smoothAdded, []);
  assert.deepEqual(context.smoothRemoved, []);
});

test('duplicate and paste history replay leaves text unanimated while jiggling images', () => {
  for (const reason of ['duplicate-selected', 'paste-objects']) {
    const context = loadHistoryHarness();
    setBoard(context, [
      { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
      { id: 'image-1', type: 'image', x: 40, y: 40, w: 100, h: 100, z: 2, data: { imgKey: 'img-1' } },
    ], ['text-1', 'image-1']);

    context.snapshot();
    setBoard(context, [
      { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
      { id: 'image-1', type: 'image', x: 40, y: 40, w: 100, h: 100, z: 2, data: { imgKey: 'img-1' } },
      { id: 'text-2', type: 'text', x: 200, y: 0, w: 200, h: 80, z: 3, data: { content: 'hello' } },
      { id: 'image-2', type: 'image', x: 240, y: 40, w: 100, h: 100, z: 4, data: { imgKey: 'img-1' } },
    ], ['text-2', 'image-2']);
    context.markDirty('text-2');
    context.markDirty('image-2');
    context.pushHistory(reason);

    context.undo();
    context.redo();

    assert.deepEqual(context.pulses, [], reason);
    assert.deepEqual(context.smoothRemoved, [], reason);
    assert.deepEqual(context.jelloRemoved, [], reason);
    assert.deepEqual(context.smoothAdded, [], reason);
    assert.deepEqual(context.jelloAdded, [
      { ids: ['image-2'], options: { includeText: false } },
    ], reason);
  }
});

test('add-text history replay does not animate text objects', () => {
  const context = loadHistoryHarness();
  setBoard(context, []);

  context.snapshot();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
  ], ['text-1']);
  context.markDirty('text-1');
  context.pushHistory('add-text');

  context.undo();
  context.redo();

  assert.deepEqual(context.pulses, []);
  assert.deepEqual(context.smoothRemoved, []);
  assert.deepEqual(context.jelloRemoved, []);
  assert.deepEqual(context.smoothAdded, []);
  assert.deepEqual(context.jelloAdded, []);
});

test('undo and redo replay full selection pulse for actions that originally jiggle text', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
    { id: 'image-1', type: 'image', x: 40, y: 40, w: 100, h: 100, z: 2, data: { imgKey: 'img-1' } },
  ], ['text-1']);

  context.snapshot();
  context.markDirty('text-1');
  context.pushHistory('drag');
  context.markDirty('text-1');
  context.pushHistory('send-selected-to-back');

  context.undo();
  context.redo();

  assert.deepEqual(context.pulses, [
    {},
    {},
  ]);
});

test('undo delete jiggles restored images while redo delete stays inert', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'image-1', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: { imgKey: 'img-1' } },
    { id: 'text-1', type: 'text', x: 120, y: 0, w: 200, h: 80, z: 2, data: { content: 'hello' } },
  ], ['image-1']);

  context.snapshot();
  setBoard(context, [], []);
  context.pushHistory('delete-selected');

  context.undo();
  context.redo();

  assert.deepEqual(context.pulses, []);
  assert.deepEqual(context.smoothAdded, []);
  assert.deepEqual(context.smoothRemoved, []);
  assert.deepEqual(context.jelloAdded, [
    { ids: ['image-1'], options: { includeText: false } },
  ]);
  assert.deepEqual(context.jelloRemoved, []);
});

test('undo image add removes without animation and redo jiggles images back', () => {
  const context = loadHistoryHarness();
  setBoard(context, []);

  context.snapshot();
  setBoard(context, [
    { id: 'image-1', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: { imgKey: 'img-1' } },
  ], ['image-1']);
  context.markDirty('image-1');
  context.pushHistory('add-image');

  context.undo();
  context.redo();

  assert.deepEqual(context.pulses, []);
  assert.deepEqual(context.smoothRemoved, []);
  assert.deepEqual(context.jelloRemoved, []);
  assert.deepEqual(context.jelloAdded, [
    { ids: ['image-1'], options: { includeText: false } },
  ]);
  assert.deepEqual(context.smoothAdded, []);
});
