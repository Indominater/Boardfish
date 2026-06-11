'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCanvasInputHarness({ selected = true } = {}) {
  const obj = { id: 'text-1', type: 'text', x: 10, y: 20, w: 160, h: 40, data: { content: 'hello' } };
  const selectedIds = selected ? new Set([obj.id]) : new Set();
  const dragHandlers = [];
  const deferredTimers = [];
  const animationFrames = [];
  const context = {
    console,
    canvas: { addEventListener() {}, classList: { add() {}, remove() {} } },
    boardCanvas: {},
    document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame(fn) {
      animationFrames.push(fn);
      return animationFrames.length;
    },
    setTimeout(fn) {
      deferredTimers.push(fn);
      return deferredTimers.length;
    },
    flushDeferredTasks() {
      while (animationFrames.length || deferredTimers.length) {
        const frames = animationFrames.splice(0);
        for (const fn of frames) fn();
        const timers = deferredTimers.splice(0);
        for (const fn of timers) fn();
      }
    },
    objectsMap: new Map([[obj.id, obj]]),
    selectedIds,
    editingId: null,
    zoom: 1,
    entered: [],
    enterOptions: [],
    history: [],
    menus: [],
    selections: [],
    renders: [],
    logs: [],
    obj,
    isSelected(id) { return selectedIds.has(id); },
    selectObject(id) { selectedIds.clear(); selectedIds.add(id); },
    exitEdit() {},
    createRafCommitter(apply) {
      let state = null;
      return {
        schedule(nextState) { state = nextState; },
        flush() { if (state) apply(state); state = null; },
      };
    },
    beginDocumentDrag(handlers) { dragHandlers.push(handlers); },
    ViewportDebug: { start() { return {}; }, end() {} },
    withRenderSource(_source, fn) { fn(); },
    drawBoard() {},
    updateSelectionOverlay() {},
    markDirty(id) { context.dirty = id; },
    pushHistory(reason) { context.history.push(reason); },
    enterEdit(id, options = {}) {
      context.entered.push(id);
      context.enterOptions.push({ ...(options || {}) });
      context.editingId = id;
      context._editEl = context.editProxy;
    },
    editProxy: {
      focused: false,
      selection: null,
      value: 'hello',
      selectionStart: 0,
      selectionEnd: 0,
      focus() {
        this.focused = true;
        context.document.activeElement = this;
      },
      setSelectionRange(start, end) {
        this.selection = [start, end];
        this.selectionStart = start;
        this.selectionEnd = end;
      },
    },
    toWorld(clientX, clientY) { return { x: clientX, y: clientY }; },
    getTextLayout() { return [{ text: 'hello', startIndex: 0, prefixWidths: new Float64Array([0]) }]; },
    layoutHitTest(_layout, wx, wy) {
      context.hitPoint = { x: wx, y: wy };
      return 3;
    },
    TextSelDebug: { _logSelection(type) { context.logs.push(type); } },
    scheduleRender(select, overlay) { context.renders.push({ select, overlay }); },
    showTextEditContextMenuAt(clientX, clientY) { context.menus.push({ clientX, clientY }); },
  };
  context.latestDrag = () => dragHandlers[dragHandlers.length - 1];

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'canvas_input.js'), 'utf8'),
    context,
    { filename: 'canvas_input.js' },
  );
  return context;
}

function addListener(listeners, type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}

function loadRubberBandHarness() {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const selectedIds = new Set();
  const objects = [{ id: 'image-1', type: 'image', x: 0, y: 0, w: 50, h: 50, data: {} }];
  const context = {
    console,
    window: {
      addEventListener(type, fn) { addListener(windowListeners, type, fn); },
    },
    canvas: { addEventListener() {}, classList: { add() {}, remove() {} } },
    boardCanvas: {},
    document: {
      visibilityState: 'visible',
      hidden: false,
      addEventListener(type, fn) { addListener(documentListeners, type, fn); },
      removeEventListener() {},
    },
    objects,
    objectsMap: new Map(objects.map((obj) => [obj.id, obj])),
    selectedIds,
    editingId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    _rubberBandDragActive: false,
    _rubberBandStyleState: { display: '', left: '', top: '', width: '', height: '' },
    rubberBand: { style: {} },
    cleaned: 0,
    deselected: 0,
    motions: [],
    renders: [],
    selections: [],
    _setStyleIfChanged(el, prop, value, state) {
      if (state[prop] === value) return;
      state[prop] = value;
      el.style[prop] = value;
    },
    beginRubberBandDrag() {
      context._rubberBandDragActive = true;
    },
    finishRubberBandDrag() {
      context._rubberBandDragActive = false;
    },
    beginDocumentDrag(handlers) {
      context.drag = handlers;
      return (event) => {
        context.cleaned += 1;
        handlers.up(event);
      };
    },
    deselectAll() {
      context.deselected += 1;
      selectedIds.clear();
    },
    objectIntersectsRect() { return true; },
    BoardfishEditorState: {
      deleteEmptyTextObjects() {},
      setSelection(ids) {
        context.selections.push(Array.from(ids));
        selectedIds.clear();
        for (const id of ids) selectedIds.add(id);
      },
    },
    BoardfishMotion: {
      applyActionAnimation(action) { context.motions.push(action); },
    },
    scheduleRender(board, overlay) { context.renders.push({ board, overlay }); },
    ViewportDebug: { isEnabled: () => false, start() { return {}; }, count() {}, end() {}, timing() {} },
    BoardfishViewportState: { zoomAroundClient() {}, panBy() {}, setPan() {} },
    scheduleTransform() {},
    createRafCommitter: () => ({ schedule() {}, flush() {} }),
    isBoardInputBlocked: () => false,
    isBoardNavigationAllowedWhileBlocked: () => false,
    isMultiSelected: () => false,
    hasSelection: () => false,
    hitTest: () => null,
    toWorld: () => ({ x: 0, y: 0 }),
  };
  context.windowEvent = (type) => {
    for (const fn of windowListeners.get(type) || []) fn();
  };
  context.documentEvent = (type) => {
    for (const fn of documentListeners.get(type) || []) fn();
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'canvas_input.js'), 'utf8'),
    context,
    { filename: 'canvas_input.js' },
  );
  return context;
}

test('rubber-band selection cancels on window blur without selecting objects', () => {
  const context = loadRubberBandHarness();

  context.startRubberBandSelection({ clientX: 0, clientY: 0 }, false);
  context.drag.move({ clientX: 20, clientY: 20 });
  context.windowEvent('blur');

  assert.equal(context._rubberBandDragActive, false);
  assert.equal(context.rubberBand.style.display, 'none');
  assert.equal(context.cleaned, 1);
  assert.deepEqual(context.selections, []);
  assert.deepEqual(context.motions, []);
});

test('rubber-band selection still selects objects on normal mouse release', () => {
  const context = loadRubberBandHarness();

  context.startRubberBandSelection({ clientX: 0, clientY: 0 }, false);
  context.drag.move({ clientX: 20, clientY: 20 });
  context.drag.up({ clientX: 20, clientY: 20 });

  assert.equal(context._rubberBandDragActive, false);
  assert.equal(context.rubberBand.style.display, 'none');
  assert.deepEqual(context.selections, [['image-1']]);
  assert.deepEqual(context.motions, ['rubber-band-release', 'rubber-band-select']);
});

test('click-release on an already selected text object enters edit mode', () => {
  const context = loadCanvasInputHarness();

  context.startObjectDrag({ clientX: 12, clientY: 22 }, context.obj);
  context.latestDrag().up({ clientX: 32, clientY: 42 });

  assert.deepEqual(context.entered, ['text-1']);
  assert.deepEqual(context.enterOptions, [{ placeInitialCaret: false }]);
  assert.deepEqual(context.editProxy.selection, [3, 3]);
  assert.equal(context.editProxy.focused, false);
  context.flushDeferredTasks();
  assert.equal(context.editProxy.focused, true);
  assert.deepEqual(context.hitPoint, { x: 32, y: 42 });
  assert.deepEqual(context.history, []);
});

test('dragging an already selected text object translates instead of entering edit mode', () => {
  const context = loadCanvasInputHarness();

  context.startObjectDrag({ clientX: 12, clientY: 22 }, context.obj);
  context.latestDrag().move({ clientX: 22, clientY: 22 });
  context.latestDrag().up({ clientX: 22, clientY: 22 });

  assert.deepEqual(context.entered, []);
  assert.equal(context.obj.x, 20);
  assert.equal(context.obj.y, 20);
  assert.deepEqual(context.history, ['drag']);
});

test('first click on an unselected text object only selects it', () => {
  const context = loadCanvasInputHarness({ selected: false });

  context.startObjectDrag({ clientX: 12, clientY: 22 }, context.obj);
  context.latestDrag().up({ clientX: 12, clientY: 22 });

  assert.deepEqual(context.entered, []);
  assert.equal(context.isSelected('text-1'), true);
});

test('releasing a dragged text highlight does not open the text edit menu', () => {
  const context = loadCanvasInputHarness();
  const hits = [1, 4];
  context.editingId = context.obj.id;
  context._editEl = context.editProxy;
  context.layoutHitTest = () => hits.shift() ?? 4;

  context.startTextSelectionDrag({ clientX: 12, clientY: 22 }, context.obj, { x: 12, y: 22 });
  context.latestDrag().move({ clientX: 42, clientY: 22 });
  context.latestDrag().up?.({ button: 0, clientX: 42, clientY: 22 });

  assert.deepEqual(context.editProxy.selection, [1, 4]);
  assert.deepEqual(context.menus, []);
});

test('releasing a caret-only text click does not open the text edit menu', () => {
  const context = loadCanvasInputHarness();
  context.editingId = context.obj.id;
  context._editEl = context.editProxy;
  context.layoutHitTest = () => 2;

  context.startTextSelectionDrag({ clientX: 12, clientY: 22 }, context.obj, { x: 12, y: 22 });
  context.latestDrag().up?.({ button: 0, clientX: 12, clientY: 22 });

  assert.deepEqual(context.editProxy.selection, [2, 2]);
  assert.deepEqual(context.menus, []);
});

test('text click preserves script caret affinity from rich hit testing', () => {
  const context = loadCanvasInputHarness();
  context.obj.data.content = 'e^{x^{2}}';
  context.editProxy.value = context.obj.data.content;
  context.editingId = context.obj.id;
  context._editEl = context.editProxy;
  context.layoutHitTestCaret = () => ({ index: 8, affinity: 'after' });

  context.startTextSelectionDrag({ clientX: 12, clientY: 22 }, context.obj, { x: 12, y: 22 });

  assert.deepEqual(context.editProxy.selection, [8, 8]);
  assert.equal(context.obj._textEditCaretIndex, 8);
  assert.equal(context.obj._textScriptCaretIndex, 8);
  assert.equal(context.obj._textScriptCaretAffinity, 'after');
});

test('text click stores visual line preference at wrapped line start', () => {
  const context = loadCanvasInputHarness();
  context.obj.data.content = 'abcdef';
  context.editProxy.value = context.obj.data.content;
  context.editingId = context.obj.id;
  context._editEl = context.editProxy;
  context.layoutHitTestCaret = () => ({ index: 3, affinity: '', lineStartIndex: 3 });

  context.startTextSelectionDrag({ clientX: 12, clientY: 44 }, context.obj, { x: 12, y: 44 });

  assert.deepEqual(context.editProxy.selection, [3, 3]);
  assert.equal(context.obj._textEditCaretIndex, 3);
  assert.equal(context.obj._textEditCaretLineStartIndex, 3);
});

test('double-clicking text while editing places the caret without selecting a word', () => {
  const context = loadCanvasInputHarness();
  context.obj.data.content = '  alpha\tbeta gamma';
  context.editProxy.value = context.obj.data.content;
  context.editingId = context.obj.id;
  context._editEl = context.editProxy;
  context.layoutHitTest = () => 10;

  context.startTextSelectionDrag({ clientX: 12, clientY: 22, detail: 2 }, context.obj, { x: 12, y: 22 });

  assert.deepEqual(context.editProxy.selection, [10, 10]);
  assert.deepEqual(context.logs.at(-1), 'mouse-down');
});
