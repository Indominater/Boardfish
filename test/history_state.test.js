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
  const actionCalls = [];
  const imagePruneCalls = [];
  const jiggleActions = new Set([
    'copy-selected-objects',
    'copy-text-object',
    'copy-text-selection',
  ]);
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
    _editHistoryActionStartState: null,
    _selChangeListener: null,
    _editEl: null,
    enterEditCalls: [],
    replaceBoardObjectsOptions: [],
    collapseTextOnReplace: false,
    pulses,
    jelloAdded,
    jelloRemoved,
    smoothAdded,
    smoothRemoved,
    actionCalls,
    imagePruneCalls,
    BoardfishEditorState: {
      replaceBoardObjects(nextObjects, options = {}) {
        context.replaceBoardObjectsOptions.push({ ...(options || {}) });
        context.objects = nextObjects;
        if (context.collapseTextOnReplace && options.syncTextHeights !== false) {
          for (const obj of context.objects) {
            if (obj?.type === 'text') obj.h = 32;
          }
        }
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
        actionCalls.push({
          action,
          ids: ids(list),
          removedIds: ids(removed),
          selection: !!payload.selection,
          options: { ...motionOptions },
        });
        if (action === 'object-delete') {
          return false;
        }
        if (String(action).startsWith('text-box-')) {
          return false;
        }
        if (!jiggleActions.has(action)) {
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
    pruneImageCachesToKeys(retainedKeys) {
      imagePruneCalls.push([...retainedKeys].sort());
      return null;
    },
    scheduleRender() {},
    enterEdit(id, options = {}) {
      context.enterEditCalls.push({ id, options: { ...(options || {}) } });
      context.editingId = id;
      const obj = context.objectsMap.get(id);
      if (obj && !options.preserveSize) obj.h = 32;
      context._editEl = {
        value: obj?.data?.content || '',
        selectionStart: 0,
        selectionEnd: 0,
        selectionDirection: 'none',
        remove() {},
        setSelectionRange(start, end, direction = 'none') {
          this.selectionStart = start;
          this.selectionEnd = end;
          this.selectionDirection = direction;
        },
      };
    },
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

function loadTextEditHistoryStateHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/selection_input.js'), 'utf8');
  const start = source.indexOf('const normalizeTextEditHistoryState');
  const end = source.indexOf('const consumeTextEditHistoryActionStartState', start);
  const context = {
    editingId: 'text-1',
    objectsMap: new Map(),
    _editEl: null,
    _editHistoryTimer: null,
    _editHistoryActionStartState: null,
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(start, end) +
      '\nglobalThis.normalizeTextEditHistoryState = normalizeTextEditHistoryState;\n' +
      'globalThis.beginTextEditHistoryAction = beginTextEditHistoryAction;\n',
    context,
    { filename: 'selection_input_history_state_slice.js' },
  );
  return context;
}

function setBoard(context, objects, selectedIds = []) {
  context.objects = objects.map(cloneObject);
  context.objectsMap = new Map(context.objects.map((obj) => [obj.id, obj]));
  context.selectedIds = new Set(selectedIds);
  context.selectedId = selectedIds[selectedIds.length - 1] || null;
}

test('text-only history skips image cache pruning when no image cache state exists', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
  ], ['text-1']);

  context.snapshot();
  context.objectsMap.get('text-1').data.content = 'hello world';
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint');

  assert.deepEqual(context.imagePruneCalls, []);
});

test('history keeps image cache pruning when pruneable image state exists', () => {
  const context = loadHistoryHarness();
  context.imageStore = {
    'img-1': 'data:image/png;base64,AQ==',
    'img-unused': 'data:image/png;base64,Ag==',
  };
  setBoard(context, [
    { id: 'image-1', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: { imgKey: 'img-1' } },
  ], ['image-1']);

  context.snapshot();
  setBoard(context, [], []);
  context.pushHistory('delete-selected');

  assert.deepEqual(context.imagePruneCalls, [['img-1'], ['img-1']]);
});

test('undo and redo keep text-safe actions inert under copy-only jiggle policy', () => {
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

  assert.deepEqual(context.pulses, []);
  assert.deepEqual(context.jelloAdded, []);
  assert.deepEqual(context.jelloRemoved, []);
  assert.deepEqual(context.smoothAdded, []);
  assert.deepEqual(context.smoothRemoved, []);
});

test('duplicate and paste history replay are inert under copy-only jiggle policy', () => {
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
    assert.deepEqual(context.jelloAdded, [], reason);
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

test('undo and redo leave prior selection-pulse actions inert under copy-only jiggle policy', () => {
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

  assert.deepEqual(context.pulses, []);
});

test('undo and redo image flips replay the flip animation action', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'image-1', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: { imgKey: 'img-1', flipX: false, flipY: false } },
  ], ['image-1']);

  context.snapshot();
  context.objectsMap.get('image-1').data.flipX = true;
  context.markDirty('image-1');
  context.pushHistory('flip-image-x');

  context.undo();
  context.redo();

  assert.deepEqual(
    context.actionCalls
      .filter((call) => call.action === 'flip-image' || call.action === 'history-object-jiggle-replay')
      .map((call) => ({ action: call.action, selection: call.selection, options: call.options })),
    [
      { action: 'flip-image', selection: true, options: {} },
      { action: 'flip-image', selection: true, options: {} },
    ],
  );
});

test('redo paste replays paste actions while undo paste stays inert', () => {
  const context = loadHistoryHarness();
  setBoard(context, []);

  context.snapshot();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'hello' } },
    { id: 'image-1', type: 'image', x: 40, y: 40, w: 100, h: 100, z: 2, data: { imgKey: 'img-1' } },
  ], ['text-1', 'image-1']);
  context.markDirty('text-1');
  context.markDirty('image-1');
  context.pushHistory('paste-objects');

  context.undo();
  context.redo();

  assert.deepEqual(
    context.actionCalls
      .filter((call) => ['object-delete', 'text-box-paste', 'image-object-paste'].includes(call.action))
      .map((call) => ({
        action: call.action,
        ids: call.ids,
        removedIds: call.removedIds,
        selection: call.selection,
        options: call.options,
      })),
    [
      { action: 'object-delete', ids: [], removedIds: ['text-1', 'image-1'], selection: false, options: {} },
      { action: 'text-box-paste', ids: ['text-1'], removedIds: [], selection: false, options: {} },
      { action: 'image-object-paste', ids: ['image-1'], removedIds: [], selection: false, options: { includeText: false } },
    ],
  );
});

test('undo and redo delete stay inert under copy-only jiggle policy', () => {
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
  assert.deepEqual(context.jelloAdded, []);
  assert.deepEqual(context.jelloRemoved, []);
});

test('undo flushes a pending text edit checkpoint before restoring it', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'before' } },
  ], ['text-1']);
  context.snapshot();

  const text = context.objectsMap.get('text-1');
  text.data.content = 'after';
  context.editingId = text.id;
  context._editEl = {
    selectionStart: 5,
    selectionEnd: 5,
    selectionDirection: 'none',
    remove() {},
  };
  context._editHistoryLastContent = 'before';
  context.flushEditHistoryCheckpoint = () => {
    context.markDirty(text.id);
    context.pushHistory('text-edit-checkpoint');
    return true;
  };

  context.undo();

  assert.equal(context.historyIndex, 0);
  assert.equal(context.objectsMap.get('text-1').data.content, 'before');
});

test('undoing first text run restores the edit-entry snapshot and stays editing', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'before' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = {
    selectionStart: 6,
    selectionEnd: 6,
    selectionDirection: 'none',
    remove() {},
  };
  context.pushHistory('text-edit-enter');

  context.objectsMap.get('text-1').data.content = 'before after';
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint');

  context.undo();

  assert.equal(context.objectsMap.get('text-1').data.content, 'before');
  assert.equal(context.editingId, 'text-1');
  assert.equal(context._editEl.selectionStart, 6);
  assert.equal(context._editEl.selectionEnd, 6);
});

test('undoing a text run restores the caret saved before the run started', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'one two three' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = {
    selectionStart: 13,
    selectionEnd: 13,
    selectionDirection: 'none',
    remove() {},
  };
  context.pushHistory('text-edit-enter');

  const text = context.objectsMap.get('text-1');
  text.data.content = 'one two INSERT three';
  context._editEl.selectionStart = 14;
  context._editEl.selectionEnd = 14;
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', {
    beforeEditState: {
      id: 'text-1',
      selectionStart: 8,
      selectionEnd: 8,
      selectionDirection: 'none',
    },
  });

  context.undo();

  assert.equal(context.objectsMap.get('text-1').data.content, 'one two three');
  assert.equal(context.editingId, 'text-1');
  assert.equal(context._editEl.selectionStart, 8);
  assert.equal(context._editEl.selectionEnd, 8);

  context.redo();

  assert.equal(context.objectsMap.get('text-1').data.content, 'one two INSERT three');
  assert.equal(context._editEl.selectionStart, 14);
  assert.equal(context._editEl.selectionEnd, 14);
});

test('text edit history start state preserves script caret affinity', () => {
  const context = loadTextEditHistoryStateHarness();
  const obj = {
    id: 'text-1',
    type: 'text',
    data: { content: 'e_{i}^{2x}' },
    _textScriptCaretIndex: 10,
    _textScriptCaretAffinity: 'after',
  };
  context.objectsMap.set(obj.id, obj);
  context._editEl = {
    value: obj.data.content,
    selectionStart: 10,
    selectionEnd: 10,
    selectionDirection: 'none',
  };

  const state = context.beginTextEditHistoryAction('text-1', {
    start: 10,
    end: 10,
    direction: 'none',
    scriptCaretAffinity: 'after',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    id: 'text-1',
    selectionStart: 10,
    selectionEnd: 10,
    selectionDirection: 'none',
    scriptCaretIndex: 10,
    scriptCaretAffinity: 'after',
  });
});

test('undoing a script-boundary delete restores the saved script caret affinity', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'e_{i}^{2x}' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = {
    selectionStart: 10,
    selectionEnd: 10,
    selectionDirection: 'none',
    remove() {},
  };
  const original = context.objectsMap.get('text-1');
  original._textScriptCaretIndex = 10;
  original._textScriptCaretAffinity = 'after';
  context.pushHistory('text-edit-enter');

  const text = context.objectsMap.get('text-1');
  text.data.content = '';
  delete text.data.scriptRanges;
  context._editEl.selectionStart = 0;
  context._editEl.selectionEnd = 0;
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', {
    beforeEditState: {
      id: 'text-1',
      selectionStart: 10,
      selectionEnd: 10,
      selectionDirection: 'none',
      scriptCaretIndex: 10,
      scriptCaretAffinity: 'after',
    },
  });

  context.undo();

  const restored = context.objectsMap.get('text-1');
  assert.equal(restored.data.content, 'e_{i}^{2x}');
  assert.equal(context.editingId, 'text-1');
  assert.equal(context._editEl.selectionStart, 10);
  assert.equal(context._editEl.selectionEnd, 10);
  assert.equal(restored._textEditCaretIndex, 10);
  assert.equal(restored._textScriptCaretIndex, 10);
  assert.equal(restored._textScriptCaretAffinity, 'after');
});

test('undoing and redoing text edits preserve restored text box dimensions', () => {
  const context = loadHistoryHarness();
  context.collapseTextOnReplace = true;
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 920, h: 370, z: 1, data: { content: 'e^{x^{2}+1}' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = {
    selectionStart: 11,
    selectionEnd: 11,
    selectionDirection: 'none',
    remove() {},
  };
  context.pushHistory('text-edit-enter');

  const text = context.objectsMap.get('text-1');
  text.data.content = '';
  text.w = 920;
  text.h = 96;
  context._editEl.selectionStart = 0;
  context._editEl.selectionEnd = 0;
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', {
    beforeEditState: {
      id: 'text-1',
      selectionStart: 11,
      selectionEnd: 11,
      selectionDirection: 'none',
    },
  });

  context.undo();

  let restored = context.objectsMap.get('text-1');
  assert.equal(restored.data.content, 'e^{x^{2}+1}');
  assert.equal(restored.w, 920);
  assert.equal(restored.h, 370);
  assert.equal(context.editingId, 'text-1');
  assert.equal(context.enterEditCalls.at(-1).options.preserveSize, true);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).syncTextHeights, false);

  context.redo();

  restored = context.objectsMap.get('text-1');
  assert.equal(restored.data.content, '');
  assert.equal(restored.w, 920);
  assert.equal(restored.h, 96);
  assert.equal(context.editingId, 'text-1');
  assert.equal(context.enterEditCalls.at(-1).options.preserveSize, true);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).syncTextHeights, false);
});

test('undo and redo image add stay inert under copy-only jiggle policy', () => {
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
  assert.deepEqual(context.jelloAdded, []);
  assert.deepEqual(context.smoothAdded, []);
});
