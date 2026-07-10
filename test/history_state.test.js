'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function cloneObject(obj, options = {}) {
  const cloned = JSON.parse(JSON.stringify(obj));
  if (obj?.type !== 'text') return cloned;
  if (options.runtimeTextCache === true) return cloned;
  clearTextRuntimeCache(cloned);
  return cloned;
}

function clearTextRuntimeCache(obj) {
  if (obj?.type !== 'text') return;
  delete obj._layoutCache;
  delete obj._layoutCacheKey;
  delete obj._layoutCacheContent;
  delete obj._layoutCacheW;
  delete obj._layoutCacheScriptKey;
  delete obj._layoutCacheAlignKey;
  delete obj._layoutCacheY;
  delete obj._textScriptRangesCache;
  delete obj._textScriptRangesCacheContent;
  delete obj._textScriptRangesCacheSourceKey;
  delete obj._textScriptLayoutMetrics;
  delete obj._textScriptLayoutMetricsContent;
  delete obj._textScriptLayoutMetricsScriptKey;
}

function cloneTextObjectRuntimeCaches(source, target) {
  if (!source || !target || source.type !== 'text' || target.type !== 'text') return target;
  const content = String(target.data?.content ?? '').replace(/\r\n?/g, '\n');
  if (
    Array.isArray(source._layoutCache) &&
    source._layoutCacheContent === content &&
    source._layoutCacheW === target.w
  ) {
    target._layoutCache = source._layoutCache.map((line) => ({ ...line }));
    target._layoutCacheKey = source._layoutCacheKey;
    target._layoutCacheContent = source._layoutCacheContent;
    target._layoutCacheW = source._layoutCacheW;
    target._layoutCacheScriptKey = source._layoutCacheScriptKey;
    target._layoutCacheAlignKey = source._layoutCacheAlignKey;
    target._layoutCacheY = target.y;
  }
  if (source._textScriptRangesCacheContent === content && Array.isArray(source._textScriptRangesCache)) {
    target._textScriptRangesCache = source._textScriptRangesCache.map((range) => ({ ...range }));
    target._textScriptRangesCacheContent = source._textScriptRangesCacheContent;
    target._textScriptRangesCacheSourceKey = source._textScriptRangesCacheSourceKey;
  }
  if (source._textScriptLayoutMetricsContent === content && source._textScriptLayoutMetrics) {
    target._textScriptLayoutMetrics = source._textScriptLayoutMetrics;
    target._textScriptLayoutMetricsContent = source._textScriptLayoutMetricsContent;
    target._textScriptLayoutMetricsScriptKey = source._textScriptLayoutMetricsScriptKey;
  }
  return target;
}

function makeEditProxy({
  value = '',
  selectionStart = 0,
  selectionEnd = selectionStart,
  selectionDirection = 'none',
  clampSelectionToDomValue = false,
} = {}) {
  return {
    value,
    selectionStart,
    selectionEnd,
    selectionDirection,
    removed: false,
    focused: false,
    _boardfishLogicalValue: value,
    _boardfishDomValueStale: false,
    setRangeTextCalls: [],
    _boardfishSetLogicalValue(nextValue, { domSynced = true } = {}) {
      this._boardfishLogicalValue = String(nextValue ?? '');
      this._boardfishDomValueStale = domSynced === false || this.value !== this._boardfishLogicalValue;
    },
    remove() {
      this.removed = true;
    },
    focus() {
      this.focused = true;
    },
    setSelectionRange(start, end, direction = 'none') {
      if (clampSelectionToDomValue) {
        const max = String(this.value ?? '').length;
        const normalizedStart = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, max));
        const normalizedEnd = Math.max(0, Math.min(Math.trunc(Number(end)) || normalizedStart, max));
        this.selectionStart = normalizedStart;
        this.selectionEnd = normalizedEnd;
      } else {
        this.selectionStart = start;
        this.selectionEnd = end;
      }
      this.selectionDirection = direction;
    },
    setRangeText(text, start, end, selectionMode = 'preserve') {
      const from = Math.max(0, Math.min(start, this.value.length));
      const to = Math.max(from, Math.min(end, this.value.length));
      const inserted = String(text ?? '');
      this.setRangeTextCalls.push({ text: inserted, start: from, end: to, selectionMode });
      this.value = `${this.value.slice(0, from)}${inserted}${this.value.slice(to)}`;
      if (selectionMode === 'start') {
        this.selectionStart = from;
        this.selectionEnd = from;
      } else if (selectionMode === 'end') {
        this.selectionStart = from + inserted.length;
        this.selectionEnd = from + inserted.length;
      } else if (selectionMode === 'select') {
        this.selectionStart = from;
        this.selectionEnd = from + inserted.length;
      }
    },
  };
}

function loadHistoryHarness() {
  const pulses = [];
  const jelloAdded = [];
  const jelloRemoved = [];
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
      addEventListener() {},
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
    _textInputSelectionHistorySuppress: null,
    _selChangeListener: null,
    _editEl: null,
    enterEditCalls: [],
    replaceBoardObjectsOptions: [],
    collapseTextOnReplace: false,
    pulses,
    jelloAdded,
    jelloRemoved,
    actionCalls,
    imagePruneCalls,
    BoardfishEditorState: {
      replaceBoardObjects(nextObjects, options = {}) {
        context.replaceBoardObjectsOptions.push({ ...(options || {}) });
        context.objects = nextObjects;
        if (options.preserveTextRuntimeCaches !== true) {
          for (const obj of context.objects) clearTextRuntimeCache(obj);
        }
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
    },
    HistoryDebug: {
      count() {},
      end() {},
      max() {},
      start() { return {}; },
      step() {},
    },
    cloneObject,
    cloneObjects(list, options = {}) {
      return list.map((obj) => cloneObject(obj, options));
    },
    cloneTextObjectRuntimeCaches,
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
      context._editEl = makeEditProxy({
        value: obj?.data?.content || '',
        selectionStart: 0,
        selectionEnd: 0,
        selectionDirection: 'none',
      });
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
    textEditProxyValue(proxy) {
      if (typeof proxy?._boardfishLogicalValue === 'string') return proxy._boardfishLogicalValue;
      return String(proxy?.value ?? '');
    },
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

test('text edit history state clamps against logical proxy length when DOM is stale', () => {
  const context = loadTextEditHistoryStateHarness();
  const obj = { id: 'text-1', type: 'text', data: { content: '0123456789' } };
  context.objectsMap.set(obj.id, obj);
  context._editEl = makeEditProxy({ value: '0123', selectionStart: 4, selectionEnd: 4 });
  context._editEl._boardfishSetLogicalValue(obj.data.content, { domSynced: false });

  const normalized = context.normalizeTextEditHistoryState(obj.id, {
    start: 0,
    end: obj.data.content.length,
    direction: 'forward',
  });

  assert.equal(normalized.selectionStart, 0);
  assert.equal(normalized.selectionEnd, obj.data.content.length);
  assert.equal(normalized.selectionDirection, 'forward');
});

function setBoard(context, objects, selectedIds = []) {
  context.objects = objects.map(cloneObject);
  context.objectsMap = new Map(context.objects.map((obj) => [obj.id, obj]));
  context.selectedIds = new Set(selectedIds);
  context.selectedId = selectedIds[selectedIds.length - 1] || null;
}

function attachTextRuntimeCache(obj, content, label = content) {
  obj._layoutCache = [{
    text: label,
    content: label,
    startIndex: 0,
    endIndex: String(content).length,
    prefixWidths: [0, 10],
  }];
  obj._layoutCacheKey = `${String(content).length}:${obj.w}:2:`;
  obj._layoutCacheContent = content;
  obj._layoutCacheW = obj.w;
  obj._layoutCacheScriptKey = '[]';
  obj._layoutCacheAlignKey = '';
  obj._layoutCacheY = obj.y;
  obj._textScriptRangesCache = [];
  obj._textScriptRangesCacheContent = content;
  obj._textScriptRangesCacheSourceKey = '[]';
  obj._textScriptLayoutMetrics = { label };
  obj._textScriptLayoutMetricsContent = content;
  obj._textScriptLayoutMetricsScriptKey = '[]';
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
    assert.deepEqual(context.jelloRemoved, [], reason);
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
  assert.deepEqual(context.jelloRemoved, []);
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
  context._editEl = makeEditProxy({
    value: 'after',
    selectionStart: 5,
    selectionEnd: 5,
    selectionDirection: 'none',
  });
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
  context._editEl = makeEditProxy({
    value: 'before',
    selectionStart: 6,
    selectionEnd: 6,
    selectionDirection: 'none',
  });
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
  context._editEl = makeEditProxy({
    value: 'one two three',
    selectionStart: 13,
    selectionEnd: 13,
    selectionDirection: 'none',
  });
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

test('undoing a selected text replacement restores the replaced highlight range', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'one two three' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = makeEditProxy({
    value: 'one two three',
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: 'none',
  });
  context.pushHistory('text-edit-enter');

  const text = context.objectsMap.get('text-1');
  text.data.content = 'one PASTE three';
  context._editEl.value = text.data.content;
  context._editEl._boardfishSetLogicalValue(text.data.content, { domSynced: true });
  context._editEl.selectionStart = 9;
  context._editEl.selectionEnd = 9;
  context._editEl.selectionDirection = 'none';
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', {
    beforeEditState: {
      id: 'text-1',
      selectionStart: 4,
      selectionEnd: 7,
      selectionDirection: 'forward',
    },
  });

  context.undo();

  assert.equal(context.objectsMap.get('text-1').data.content, 'one two three');
  assert.equal(context.editingId, 'text-1');
  assert.equal(context._editEl.selectionStart, 4);
  assert.equal(context._editEl.selectionEnd, 7);
  assert.equal(context._editEl.selectionDirection, 'forward');

  context.redo();

  assert.equal(context.objectsMap.get('text-1').data.content, 'one PASTE three');
  assert.equal(context._editEl.selectionStart, 9);
  assert.equal(context._editEl.selectionEnd, 9);
  assert.equal(context._editEl.selectionDirection, 'none');
});

test('undoing a selected replacement syncs stale proxy DOM before restoring highlight', () => {
  const context = loadHistoryHarness();
  const original = 'prefix selected text suffix';
  const pasted = 'prefix X suffix';
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: original } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = makeEditProxy({
    value: original,
    selectionStart: original.length,
    selectionEnd: original.length,
    selectionDirection: 'none',
    clampSelectionToDomValue: true,
  });
  context.pushHistory('text-edit-enter');

  const text = context.objectsMap.get('text-1');
  text.data.content = pasted;
  context._editEl.value = pasted;
  context._editEl._boardfishSetLogicalValue(pasted, { domSynced: true });
  context._editEl.selectionStart = 8;
  context._editEl.selectionEnd = 8;
  context._editEl.selectionDirection = 'none';
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', {
    beforeEditState: {
      id: 'text-1',
      selectionStart: 7,
      selectionEnd: 20,
      selectionDirection: 'forward',
    },
  });

  context.undo();

  assert.equal(context.objectsMap.get('text-1').data.content, original);
  assert.equal(context._editEl.value, original);
  assert.equal(context._editEl._boardfishLogicalValue, original);
  assert.equal(context._editEl._boardfishDomValueStale, false);
  assert.equal(context._editEl.selectionStart, 7);
  assert.equal(context._editEl.selectionEnd, 20);
  assert.equal(context._editEl.selectionDirection, 'forward');
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
  context._editEl = makeEditProxy({
    value: obj.data.content,
    selectionStart: 10,
    selectionEnd: 10,
    selectionDirection: 'none',
  });

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

test('immediate text edit history actions replace stale start selection', () => {
  const context = loadTextEditHistoryStateHarness();
  const obj = {
    id: 'text-1',
    type: 'text',
    data: { content: 'one two three' },
  };
  context.objectsMap.set(obj.id, obj);
  context._editEl = makeEditProxy({
    value: obj.data.content,
    selectionStart: 1,
    selectionEnd: 1,
    selectionDirection: 'none',
  });

  context.beginTextEditHistoryAction('text-1', {
    start: 1,
    end: 1,
    direction: 'none',
  });
  context._editEl.setSelectionRange(4, 7, 'forward');
  const state = context.beginTextEditHistoryAction('text-1', {
    start: 4,
    end: 7,
    direction: 'forward',
  }, { splitPending: true });

  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    id: 'text-1',
    selectionStart: 4,
    selectionEnd: 7,
    selectionDirection: 'forward',
  });
});

test('text edit history start state clamps selection to captured pre-edit value', () => {
  const context = loadTextEditHistoryStateHarness();
  const oldValue = 'prefix selected text suffix';
  const obj = {
    id: 'text-1',
    type: 'text',
    data: { content: oldValue },
  };
  context.objectsMap.set(obj.id, obj);
  context._editEl = makeEditProxy({
    value: 'prefix paste suffix',
    selectionStart: 12,
    selectionEnd: 12,
    selectionDirection: 'none',
  });

  const state = context.beginTextEditHistoryAction('text-1', {
    start: 7,
    end: 20,
    direction: 'forward',
    value: oldValue,
  }, { splitPending: true });

  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    id: 'text-1',
    selectionStart: 7,
    selectionEnd: 20,
    selectionDirection: 'forward',
  });
});

test('undoing a script-boundary delete restores the saved script caret affinity', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 80, z: 1, data: { content: 'e_{i}^{2x}' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = makeEditProxy({
    value: 'e_{i}^{2x}',
    selectionStart: 10,
    selectionEnd: 10,
    selectionDirection: 'none',
  });
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
  context._editEl = makeEditProxy({
    value: 'e^{x^{2}+1}',
    selectionStart: 11,
    selectionEnd: 11,
    selectionDirection: 'none',
  });
  context.pushHistory('text-edit-enter');

  const text = context.objectsMap.get('text-1');
  const liveProxy = context._editEl;
  context.document.activeElement = liveProxy;
  text.data.content = '';
  text.w = 920;
  text.h = 96;
  context._editEl.value = '';
  context._editEl._boardfishSetLogicalValue('');
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
  assert.equal(restored, text);
  assert.equal(context.editingId, 'text-1');
  assert.equal(context._editEl, liveProxy);
  assert.equal(context._editEl._boardfishLogicalValue, restored.data.content);
  assert.equal(context._editEl.value, restored.data.content);
  assert.equal(context._editEl._boardfishDomValueStale, false);
  assert.equal(liveProxy.focused, false);
  assert.equal(liveProxy.setRangeTextCalls.length, 0);
  assert.equal(context.enterEditCalls.length, 0);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).normalizeText, false);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).syncTextHeights, false);

  context.redo();

  restored = context.objectsMap.get('text-1');
  assert.equal(restored.data.content, '');
  assert.equal(restored.w, 920);
  assert.equal(restored.h, 96);
  assert.equal(restored, text);
  assert.equal(context.editingId, 'text-1');
  assert.equal(context._editEl, liveProxy);
  assert.equal(context._editEl._boardfishLogicalValue, restored.data.content);
  assert.equal(context._editEl.value, 'e^{x^{2}+1}');
  assert.equal(context._editEl._boardfishDomValueStale, true);
  assert.equal(liveProxy.focused, false);
  assert.equal(liveProxy.setRangeTextCalls.length, 0);
  assert.equal(context.enterEditCalls.length, 0);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).normalizeText, false);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).syncTextHeights, false);
});

test('undoing and redoing text edits restore active text runtime layout caches', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 700, h: 1200, z: 1, data: { content: 'before' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = makeEditProxy({
    value: 'before',
    selectionStart: 6,
    selectionEnd: 6,
    selectionDirection: 'none',
  });
  attachTextRuntimeCache(context.objectsMap.get('text-1'), 'before', 'cached-before');
  context.pushHistory('text-edit-enter');

  const text = context.objectsMap.get('text-1');
  const liveProxy = context._editEl;
  context.document.activeElement = liveProxy;
  text.data.content = 'after';
  context._editEl.value = 'after';
  context._editEl._boardfishSetLogicalValue('after');
  context._editEl.selectionStart = 5;
  context._editEl.selectionEnd = 5;
  attachTextRuntimeCache(text, 'after', 'cached-after');
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', {
    beforeEditState: {
      id: 'text-1',
      selectionStart: 6,
      selectionEnd: 6,
      selectionDirection: 'none',
    },
  });

  context.undo();

  let restored = context.objectsMap.get('text-1');
  assert.equal(restored.data.content, 'before');
  assert.equal(restored, text);
  assert.equal(context._editEl, liveProxy);
  assert.equal(context._editEl._boardfishLogicalValue, 'before');
  assert.equal(context._editEl.value, 'before');
  assert.equal(context._editEl._boardfishDomValueStale, false);
  assert.equal(liveProxy.focused, false);
  assert.equal(liveProxy.setRangeTextCalls.length, 0);
  assert.equal(restored._layoutCacheContent, 'before');
  assert.equal(restored._layoutCache[0].text, 'cached-before');
  assert.equal(restored._textScriptRangesCacheContent, 'before');
  assert.equal(restored._textScriptLayoutMetricsContent, 'before');
  assert.equal(context.replaceBoardObjectsOptions.at(-1).normalizeText, false);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).preserveTextRuntimeCaches, true);

  context.redo();

  restored = context.objectsMap.get('text-1');
  assert.equal(restored.data.content, 'after');
  assert.equal(restored, text);
  assert.equal(context._editEl, liveProxy);
  assert.equal(context._editEl._boardfishLogicalValue, 'after');
  assert.equal(context._editEl.value, 'before');
  assert.equal(context._editEl._boardfishDomValueStale, true);
  assert.equal(liveProxy.focused, false);
  assert.equal(liveProxy.setRangeTextCalls.length, 0);
  assert.equal(restored._layoutCacheContent, 'after');
  assert.equal(restored._layoutCache[0].text, 'cached-after');
  assert.equal(restored._textScriptRangesCacheContent, 'after');
  assert.equal(restored._textScriptLayoutMetricsContent, 'after');
  assert.equal(context.replaceBoardObjectsOptions.at(-1).normalizeText, false);
  assert.equal(context.replaceBoardObjectsOptions.at(-1).preserveTextRuntimeCaches, true);
});

test('undoing and redoing text edits hydrate unchanged text runtime caches from live objects', () => {
  const context = loadHistoryHarness();
  setBoard(context, [
    { id: 'text-1', type: 'text', x: 0, y: 0, w: 700, h: 1200, z: 1, data: { content: 'before' } },
    { id: 'text-2', type: 'text', x: 0, y: 1200, w: 500, h: 120, z: 2, data: { content: 'unchanged' } },
  ], ['text-1']);
  context.snapshot();

  context.editingId = 'text-1';
  context._editEl = makeEditProxy({
    value: 'before',
    selectionStart: 6,
    selectionEnd: 6,
    selectionDirection: 'none',
  });
  attachTextRuntimeCache(context.objectsMap.get('text-1'), 'before', 'cached-before');
  context.pushHistory('text-edit-enter');

  const edited = context.objectsMap.get('text-1');
  const unchanged = context.objectsMap.get('text-2');
  attachTextRuntimeCache(unchanged, 'unchanged', 'live-unchanged-cache');
  edited.data.content = 'after';
  context._editEl.value = 'after';
  context._editEl._boardfishSetLogicalValue('after');
  context._editEl.selectionStart = 5;
  context._editEl.selectionEnd = 5;
  attachTextRuntimeCache(edited, 'after', 'cached-after');
  context.markDirty('text-1');
  context.pushHistory('text-edit-checkpoint', {
    beforeEditState: {
      id: 'text-1',
      selectionStart: 6,
      selectionEnd: 6,
      selectionDirection: 'none',
    },
  });

  context.undo();

  let restoredUnchanged = context.objectsMap.get('text-2');
  assert.notEqual(restoredUnchanged, unchanged);
  assert.equal(restoredUnchanged.data.content, 'unchanged');
  assert.equal(restoredUnchanged._layoutCacheContent, 'unchanged');
  assert.equal(restoredUnchanged._layoutCache[0].text, 'live-unchanged-cache');
  assert.equal(restoredUnchanged._textScriptRangesCacheContent, 'unchanged');
  assert.equal(restoredUnchanged._textScriptLayoutMetricsContent, 'unchanged');

  context.redo();

  restoredUnchanged = context.objectsMap.get('text-2');
  assert.equal(restoredUnchanged.data.content, 'unchanged');
  assert.equal(restoredUnchanged._layoutCacheContent, 'unchanged');
  assert.equal(restoredUnchanged._layoutCache[0].text, 'live-unchanged-cache');
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
  assert.deepEqual(context.jelloRemoved, []);
  assert.deepEqual(context.jelloAdded, []);
});
