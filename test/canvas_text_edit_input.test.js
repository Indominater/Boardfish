'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCanvasInputHarness({ selected = true, touchInput = false } = {}) {
  const obj = { id: 'text-1', type: 'text', x: 10, y: 20, w: 160, h: 40, data: { content: 'hello' } };
  const selectedIds = selected ? new Set([obj.id]) : new Set();
  const dragHandlers = [];
  const deferredTimers = [];
  const animationFrames = [];
  const canvasListeners = new Map();
  const context = {
    console,
    canvas: {
      addEventListener(type, listener) { addListener(canvasListeners, type, listener); },
      contains() { return true; },
      classList: { add() {}, remove() {} },
    },
    boardCanvas: {},
    document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
    TouchEvent: touchInput ? function TouchEvent() {} : undefined,
    navigator: { maxTouchPoints: touchInput ? 5 : 0 },
    requestAnimationFrame(fn) {
      animationFrames.push(fn);
      return animationFrames.length;
    },
    setTimeout(fn) {
      deferredTimers.push(fn);
      return deferredTimers.length;
    },
    clearTimeout() {},
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
    panX: 0,
    panY: 0,
    entered: [],
    enterOptions: [],
    history: [],
    menus: [],
    selections: [],
    renders: [],
    logs: [],
    viewportPans: [],
    obj,
    isSelected(id) { return selectedIds.has(id); },
    selectedBounds() {
      if (!selectedIds.size) return null;
      return { x1: obj.x, y1: obj.y, x2: obj.x + obj.w, y2: obj.y + obj.h };
    },
    rectContainsPoint(bounds, point) {
      return point.x >= bounds.x1 && point.x <= bounds.x2 && point.y >= bounds.y1 && point.y <= bounds.y2;
    },
    selectObject(id) { selectedIds.clear(); selectedIds.add(id); },
    exitEdit() {},
    createRafCommitter(apply) {
      let args = null;
      return {
        schedule(...nextArgs) { args = nextArgs; },
        flush() { if (args) apply(...args); args = null; },
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
      _boardfishLogicalValue: 'hello',
      _boardfishDomValueStale: false,
      selectionStart: 0,
      selectionEnd: 0,
      focus() {
        this.focused = true;
        context.document.activeElement = this;
      },
      setSelectionRange(start, end, direction = 'none') {
        const max = String(this.value ?? '').length;
        const normalizedStart = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, max));
        const normalizedEnd = Math.max(normalizedStart, Math.min(Math.trunc(Number(end)) || normalizedStart, max));
        this.selection = [normalizedStart, normalizedEnd];
        this.selectionStart = normalizedStart;
        this.selectionEnd = normalizedEnd;
        this.selectionDirection = direction;
      },
    },
    textEditProxyValue(proxy) {
      if (typeof proxy?._boardfishLogicalValue === 'string') return proxy._boardfishLogicalValue;
      return String(proxy?.value ?? '');
    },
    setTextEditProxySelectionRange(proxy, start, end = start, direction = 'none', options = {}) {
      const text = String(options.value ?? context.textEditProxyValue(proxy));
      const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, text.length));
      const to = Math.max(from, Math.min(Math.trunc(Number(end ?? start)) || from, text.length));
      const domLength = String(proxy.value ?? '').length;
      const domStale = !!proxy._boardfishDomValueStale || String(proxy.value ?? '') !== text;
      if (domStale && (from > domLength || to > domLength)) {
        proxy.value = text;
        proxy._boardfishLogicalValue = text;
        proxy._boardfishDomValueStale = false;
      }
      proxy.setSelectionRange(from, to, direction);
    },
    toWorld(clientX, clientY) { return { x: clientX, y: clientY }; },
    getTextLayout() { return [{ text: 'hello', startIndex: 0, prefixWidths: new Float64Array([0]) }]; },
    layoutHitTest(_layout, wx, wy) {
      context.hitPoint = { x: wx, y: wy };
      return 3;
    },
    layoutHitTestCaret(...args) { return { index: context.layoutHitTest(...args), affinity: '' }; },
    setTextScriptCaretAffinity(target, index, affinity) {
      target._textScriptCaretIndex = target._textEditCaretIndex = index;
      target._textScriptCaretAffinity = affinity;
      delete target._textEditCaretLineStartIndex;
    },
    clearTextScriptCaretAffinity(target) {
      delete target._textScriptCaretIndex;
      delete target._textScriptCaretAffinity;
    },
    setTextEditCaretIndex(target, index, options = {}) {
      target._textEditCaretIndex = index;
      if (Number.isFinite(options.lineStartIndex)) target._textEditCaretLineStartIndex = options.lineStartIndex;
    },
    clearTextEditCaretIndex(target) {
      delete target._textEditCaretIndex;
      delete target._textEditCaretLineStartIndex;
    },
    flushEditHistoryCheckpoint() {},
    TextSelDebug: { _logSelection(type) { context.logs.push(type); } },
    scheduleRender(select, overlay) { context.renders.push({ select, overlay }); },
    scheduleTransform() {},
    BoardfishViewportState: {
      panBy(dx, dy) { context.viewportPans.push({ dx, dy }); },
    },
    showTextEditContextMenuAt(clientX, clientY) { context.menus.push({ clientX, clientY }); },
  };
  context.latestDrag = () => dragHandlers[dragHandlers.length - 1];
  context.dispatchCanvas = (type, event) => {
    for (const listener of canvasListeners.get(type) || []) listener(event);
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'canvas_input.js'), 'utf8'),
    context,
    { filename: 'canvas_input.js' },
  );
  if (touchInput) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'touch_input.js'), 'utf8'),
      context,
      { filename: 'touch_input.js' },
    );
  }
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
    rubberBand: { style: {} },
    rubberBandCommits: [],
    cleaned: 0,
    deselected: 0,
    motions: [],
    renders: [],
    selections: [],
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
    createRafCommitter(apply) {
      let args = null;
      const flush = () => {
        if (args === null) return;
        const nextArgs = args;
        args = null;
        apply(...nextArgs);
        context.rubberBandCommits.push(context.rubberBand.style.cssText);
      };
      context.flushRubberBandFrame = flush;
      return { schedule(...nextArgs) { args = nextArgs; }, flush };
    },
    isBoardInputBlocked: () => false,
    isBoardNavigationAllowedWhileBlocked: () => false,
    isMultiSelected: () => false,
    hasSelection: () => false,
    BoardObjectGeometry: { topObjectAtWorldPoint: () => null },
    toWorld: () => ({ x: 0, y: 0 }),
  };
  context.windowEvent = (type) => {
    for (const fn of windowListeners.get(type) || []) fn();
  };
  context.documentEvent = (type, event) => {
    for (const fn of documentListeners.get(type) || []) fn(event);
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
  assert.deepEqual(context.motions, []);
});

test('rubber-band selection commits only the latest move in an animation frame', () => {
  const context = loadRubberBandHarness();

  context.startRubberBandSelection({ clientX: 0, clientY: 0 }, false);
  context.drag.move({ clientX: 20, clientY: 20 });
  context.drag.move({ clientX: 30, clientY: 40 });

  assert.deepEqual(context.rubberBandCommits, []);
  context.flushRubberBandFrame();
  assert.deepEqual(context.rubberBandCommits, [
    'display:block;left:0px;top:0px;width:30px;height:40px',
  ]);

  context.drag.up({ clientX: 30, clientY: 40 });
  assert.equal(context.rubberBand.style.display, 'none');
});

test('non-Space keydown skips board-pan state checks', () => {
  const context = loadRubberBandHarness();
  let blockedChecks = 0;
  context.isBoardInputBlocked = () => { blockedChecks++; return false; };
  context.documentEvent('keydown', { code: 'KeyA' });
  assert.equal(blockedChecks, 0);
});

test('click-release on an already selected text object enters edit mode', () => {
  const context = loadCanvasInputHarness();

  context.startObjectDrag({ clientX: 12, clientY: 22 }, context.obj);
  context.latestDrag().up({ clientX: 32, clientY: 42, isTrusted: true });

  assert.deepEqual(context.entered, ['text-1']);
  assert.deepEqual(context.enterOptions, [{ placeInitialCaret: false }]);
  assert.deepEqual(context.editProxy.selection, [3, 3]);
  assert.equal(context.editProxy.focused, true);
  assert.deepEqual(context.hitPoint, { x: 32, y: 42 });
  assert.deepEqual(context.history, []);
});

test('synthetic click-to-edit leaves focus to the touch adapter', () => {
  const context = loadCanvasInputHarness();

  context.startObjectDrag({ clientX: 12, clientY: 22 }, context.obj);
  context.latestDrag().up({ clientX: 32, clientY: 42, isTrusted: false });

  assert.deepEqual(context.entered, ['text-1']);
  assert.deepEqual(context.editProxy.selection, [3, 3]);
  assert.equal(context.editProxy.focused, false);
  context.flushDeferredTasks();
  assert.equal(context.editProxy.focused, false);
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

test('dragging from inside a selected region moves the selection on touch', () => {
  const context = loadCanvasInputHarness();

  const drag = context.startSelectedRegionDrag({ clientX: 20, clientY: 30 });
  assert.ok(drag);
  assert.equal(drag.move(32, 45), true);
  assert.equal(drag.finish(), true);

  assert.equal(context.obj.x, 22);
  assert.equal(context.obj.y, 35);
  assert.deepEqual(context.entered, []);
  assert.deepEqual(context.history, ['group-drag']);
});

test('a mobile TouchEvent sequence drags the selected object instead of the viewport', () => {
  const context = loadCanvasInputHarness({ touchInput: true });
  const touch = (identifier, clientX, clientY) => ({
    identifier,
    clientX,
    clientY,
    target: context.canvas,
  });
  const dispatchTouch = (type, touches, changedTouches) => {
    const event = {
      target: context.canvas,
      touches,
      changedTouches,
      cancelable: true,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    context.dispatchCanvas(type, event);
    assert.equal(event.defaultPrevented, true);
  };

  const start = touch(1, 20, 30);
  const moved = touch(1, 32, 45);
  dispatchTouch('touchstart', [start], [start]);
  dispatchTouch('touchmove', [moved], [moved]);
  dispatchTouch('touchend', [], [moved]);

  assert.equal(context.obj.x, 22);
  assert.equal(context.obj.y, 35);
  assert.deepEqual(context.history, ['group-drag']);
  assert.deepEqual(context.viewportPans, []);
});

test('touch drag outside the selected region remains available for viewport panning', () => {
  const context = loadCanvasInputHarness();

  assert.equal(context.startSelectedRegionDrag({ clientX: 200, clientY: 200 }), false);
  assert.equal(context.latestDrag(), undefined);
  assert.equal(context.obj.x, 10);
  assert.equal(context.obj.y, 20);
});

test('a mobile TouchEvent drag outside the selection pans the viewport', () => {
  const context = loadCanvasInputHarness({ touchInput: true });
  const start = { identifier: 1, clientX: 200, clientY: 200, target: context.canvas };
  const moved = { identifier: 1, clientX: 212, clientY: 215, target: context.canvas };
  const dispatchTouch = (type, touches, changedTouches) => context.dispatchCanvas(type, {
    target: context.canvas,
    touches,
    changedTouches,
    cancelable: true,
    preventDefault() {},
  });

  dispatchTouch('touchstart', [start], [start]);
  dispatchTouch('touchmove', [moved], [moved]);
  dispatchTouch('touchend', [], [moved]);

  assert.deepEqual(context.viewportPans, [{ dx: 12, dy: 15 }]);
  assert.deepEqual({ x: context.obj.x, y: context.obj.y }, { x: 10, y: 20 });
  assert.deepEqual(context.history, []);
});

test('selected-region touch drag commits the exact final lift position once', () => {
  const context = loadCanvasInputHarness();
  const drag = context.startSelectedRegionDrag({ clientX: 20, clientY: 30 });

  drag.move(28, 38);
  drag.move(40, 50);
  assert.equal(drag.finish(), true);
  assert.equal(drag.finish(), false);

  assert.equal(context.obj.x, 30);
  assert.equal(context.obj.y, 40);
  assert.deepEqual(context.history, ['group-drag']);
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

test('dragging text highlight syncs stale short edit proxy before selecting logical tail', () => {
  const context = loadCanvasInputHarness();
  const logicalValue = '0123456789';
  const hits = [0, logicalValue.length];
  context.obj.data.content = logicalValue;
  context.editProxy.value = '0123';
  context.editProxy._boardfishLogicalValue = logicalValue;
  context.editProxy._boardfishDomValueStale = true;
  context.editingId = context.obj.id;
  context._editEl = context.editProxy;
  context.layoutHitTest = () => hits.shift() ?? logicalValue.length;

  context.startTextSelectionDrag({ clientX: 12, clientY: 22 }, context.obj, { x: 12, y: 22 });
  context.latestDrag().move({ clientX: 72, clientY: 22 });

  assert.equal(context.editProxy.value, logicalValue);
  assert.equal(context.editProxy._boardfishDomValueStale, false);
  assert.deepEqual(context.editProxy.selection, [0, logicalValue.length]);
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
