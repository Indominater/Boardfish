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
      toggle() {},
    },
    appendChild() {},
    addEventListener() {},
    contains() { return false; },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    querySelectorAll() { return []; },
  };
}

function addListener(listeners, type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
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
  const documentListeners = new Map();
  const context = {
    console,
    window: { devicePixelRatio: options.devicePixelRatio ?? 1 },
    document: {
      getElementById: (id) => createElement(id),
      createElement: () => createElement(),
      addEventListener(type, fn) { addListener(documentListeners, type, fn); },
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
    textCtxMenu: createElement('text-ctx-menu'),
    ctxActions: createElement('ctx-actions'),
    island: createElement('island'),
    openingShield: createElement('opening-shield'),
    dialogOverlay: createElement('dialog-overlay'),
    unsavedDialog: createElement('dialog'),
    _boardOpening: false,
    _inputShieldStack: [],
    selectedIds,
    selectedId: options.selectedId ?? (objects.length === 1 ? objects[0].id : null),
    objectsMap: byId,
    editingId: null,
    zCounter: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    _boardSurfaceCssSizeCache: { width: 1000, height: 800 },
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
    drawBoardCalls: 0,
    motionLookups: 0,
    renders: [],
    syncedTextIds: [],
    motionPulses: [],
    isMultiSelected: () => selectedIds.size > 1,
    selectedBounds: () => objectBounds(objects),
    hasSelection: () => selectedIds.size > 0,
    getFirstSelectedObject: () => objects[0] || null,
    isBoardInputBlocked: () => context._boardOpening || context._inputShieldStack.length > 0,
    shouldKeepSelectionOverlayWhileBlocked: () => false,
    isUnsavedDialogOpen: () => false,
    acquireInputShield: () => () => {},
    bringObjectToFront() {},
    BoardfishEditorState: {
      clearSelection() {
        selectedIds.clear();
        context.selectedId = null;
      },
      setSelection(ids, options = {}) {
        selectedIds.clear();
        for (const id of ids) selectedIds.add(id);
        context.selectedId = options.primaryId ?? ids[0] ?? null;
      },
    },
    beginDocumentDrag(handlers) { context.drag = handlers; },
    createRafCommitter(apply) {
      let args = null;
      return {
        schedule(...next) { args = next; if (!options.deferRaf) this.flush(); },
        flush() { if (args) { const next = args; args = null; apply(...next); } },
      };
    },
    drawBoard() { context.drawBoardCalls++; },
    scheduleRender(board, overlay) { context.renders.push({ board, overlay }); },
    syncTextAutoHeight(obj) {
      context.syncedTextIds.push(obj.id);
      if (options.syncTextAutoHeight) {
        return options.syncTextAutoHeight(obj, context);
      }
      obj.h = Math.max(32, Math.round(obj.h));
      return true;
    },
    getTextMinWidth(obj) {
      return options.getTextMinWidth ? options.getTextMinWidth(obj, context) : 100;
    },
    getTextMinLines: () => 1,
    markDirty(obj) { context.dirty.push(obj.id); },
    pushHistory(reason, dirty, beforeEditState) {
      for (const item of dirty || []) context.dirty.push(item?.obj?.id ?? item?.id ?? item);
      context.history.push(reason);
      context.historyOptions.push({ beforeEditState });
    },
    BoardfishMotion: {
      applyCopyFeedback(payload = {}) {
        if (!payload.selection) return false;
        context.motionPulses.push({});
        return true;
      },
      hasLastDrawnObjectMotions() {
        return !!options.objectMotions?.size;
      },
      getLastDrawnObjectMotion(value) {
        context.motionLookups++;
        return options.objectMotions?.get(typeof value === 'string' ? value : value?.id) || null;
      },
    },
  };
  context.documentEvent = (type, init = {}) => {
    const event = {
      type,
      key: '',
      code: '',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      cancelable: true,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...init,
    };
    for (const fn of documentListeners.get(type) || []) fn(event);
    return event;
  };

  vm.createContext(context);
  vm.runInContext(
    `${source}\n` +
      'globalThis.beginSelectionHandleDrag = beginSelectionHandleDrag;\n' +
      'globalThis.updateSelectionOverlay = updateSelectionOverlay;\n' +
      'globalThis.flushEditHistoryCheckpoint = flushEditHistoryCheckpoint;\n' +
      'globalThis.beginTextEditHistoryAction = beginTextEditHistoryAction;\n' +
      'globalThis.recordTextEditInputHistory = recordTextEditInputHistory;\n' +
      'globalThis.isShieldInputAllowed = isShieldInputAllowed;\n',
    context,
  );
  return context;
}

test('selection chrome is hidden when its box only touches a viewport edge', () => {
  const bounds = { x1: 100, y1: 200, x2: 300, y2: 400 };
  for (const [view, visible] of [
    [{ zoom: 1, panX: 900, panY: 0 }, false],
    [{ zoom: 1, panX: -300, panY: 0 }, false],
    [{ zoom: 1, panX: 0, panY: 600 }, false],
    [{ zoom: 1, panX: 0, panY: -400 }, false],
    [{ zoom: 2, panX: 0, panY: 0 }, true],
  ]) {
    const context = loadSelectionInputHarness([{
      id: 'object-a', type: 'rect', x: bounds.x1, y: bounds.y1, w: bounds.x2 - bounds.x1, h: bounds.y2 - bounds.y1,
    }]);
    Object.assign(context, view);
    context.updateSelectionOverlay();
    assert.equal(context.selOverlay.className.startsWith('visible'), visible);
  }
});

test('shielded system key cancels active rubber-band selection before blocking input', () => {
  const context = loadSelectionInputHarness([]);
  context._rubberBandDragActive = true;
  context._inputShieldStack.push('rubber-band');
  context.cancelCalls = [];
  context.cancelRubberBandSelection = (reason) => {
    context.cancelCalls.push(reason);
    context._rubberBandDragActive = false;
    return true;
  };

  const event = context.documentEvent('keydown', {
    key: 'Meta',
    code: 'MetaLeft',
    metaKey: true,
  });

  assert.deepEqual(context.cancelCalls, ['key-cancel']);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test('rubber-band shield allows only the mouse events required to finish its drag', () => {
  const context = loadSelectionInputHarness([]);
  context._rubberBandDragActive = true;
  context._inputShieldStack.push({});

  assert.equal(context.isShieldInputAllowed({ type: 'mousemove' }), true);
  assert.equal(context.isShieldInputAllowed({ type: 'mouseup', button: 0 }), true);
  assert.equal(context.isShieldInputAllowed({ type: 'mouseup', button: 1 }), false);
  assert.equal(context.isShieldInputAllowed({ type: 'pointermove' }), false);

  context._inputShieldStack.push({});
  assert.equal(context.isShieldInputAllowed({ type: 'mousemove' }), false);
});

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
  assert.deepEqual(context.motionPulses, []);
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

test('selection overlay expands snapped outline edges to cover object bounds', () => {
  const text = { id: 'text-a', type: 'text', x: 10.25, y: 20.25, w: 100.6, h: 40.6, data: { content: 'hello' } };
  const context = loadSelectionInputHarness([text], { devicePixelRatio: 2 });
  context.panX = 0.1;
  context.panY = 0.2;

  context.updateSelectionOverlay();

  assert.equal(context.selOverlay.style.transform, 'translate(10px,20px)');
  assert.equal(context.selOverlay.style.width, '101px');
  assert.equal(context.selOverlay.style.height, '41.5px');
  assert.equal(context.motionLookups, 0);
  assert.equal(context.selOverlay.className, 'visible text-resize');
  context.editingId = text.id;
  context.updateSelectionOverlay();
  assert.equal(context.selOverlay.className, 'visible editing text-resize');
});

test('selection overlay follows fixed-screen-distance copy motion at zoom', () => {
  const text = { id: 'text-a', type: 'text', x: 10, y: 20, w: 100, h: 40, data: { content: 'hello' } };
  const objectMotions = new Map([[
    text.id,
    { translateX: 5 / 2, translateY: 10.75 / 2 },
  ]]);
  const context = loadSelectionInputHarness([text], { objectMotions, devicePixelRatio: 2 });
  context.zoom = 2;

  context.updateSelectionOverlay();

  assert.equal(context.selOverlay.style.transform, 'translate(25px,50.75px)');
  assert.equal(context.selOverlay.style.width, '200px');
  assert.equal(context.selOverlay.style.height, '80px');

  objectMotions.delete(text.id);
  context.updateSelectionOverlay();

  assert.equal(context.selOverlay.style.transform, 'translate(20px,40px)');
  assert.equal(context.selOverlay.style.width, '200px');
  assert.equal(context.selOverlay.style.height, '80px');
});

test('selection overlay matches translated non-uniform scaling around the object center', () => {
  const text = { id: 'text-a', type: 'text', x: 10, y: 20, w: 100, h: 40, data: { content: 'hello' } };
  const objectMotions = new Map([[
    text.id,
    { translateX: 2, translateY: 3, scaleX: 1.25, scaleY: 0.5 },
  ]]);
  const context = loadSelectionInputHarness([text], { objectMotions, devicePixelRatio: 2 });

  context.updateSelectionOverlay();

  assert.equal(context.selOverlay.style.transform, 'translate(-0.5px,33px)');
  assert.equal(context.selOverlay.style.width, '125px');
  assert.equal(context.selOverlay.style.height, '20px');
});

test('selection overlay matches deformation around the requested upper attachment origin', () => {
  const text = { id: 'text-a', type: 'text', x: 10, y: 20, w: 100, h: 40, data: { content: 'hello' } };
  const objectMotions = new Map([[
    text.id,
    {
      translateX: 2,
      translateY: 3,
      scaleX: 1.25,
      scaleY: 0.8,
      scaleOriginX: 0.5,
      scaleOriginY: 0.12,
    },
  ]]);
  const context = loadSelectionInputHarness([text], { objectMotions, devicePixelRatio: 2 });

  context.updateSelectionOverlay();

  assert.equal(context.selOverlay.style.transform, 'translate(-0.5px,23.96px)');
  assert.equal(context.selOverlay.style.width, '125px');
  assert.equal(context.selOverlay.style.height, '32px');
});

test('fractional animated translation stays continuous without changing snapped outline dimensions', () => {
  const text = { id: 'text-a', type: 'text', x: 10.2, y: 20.2, w: 100.6, h: 40.6, data: { content: 'hello' } };
  const objectMotions = new Map([[text.id, { translateX: 0.2, translateY: 0.2 }]]);
  const context = loadSelectionInputHarness([text], { objectMotions, devicePixelRatio: 1 });

  context.updateSelectionOverlay();
  assert.equal(context.selOverlay.style.transform, 'translate(10.2px,20.2px)');
  assert.equal(context.selOverlay.style.width, '101px');
  assert.equal(context.selOverlay.style.height, '41px');

  objectMotions.set(text.id, { translateX: 0.9, translateY: 0.9 });
  context.updateSelectionOverlay();
  assert.equal(context.selOverlay.style.transform, 'translate(10.9px,20.9px)');
  assert.equal(context.selOverlay.style.width, '101px');
  assert.equal(context.selOverlay.style.height, '41px');
});

test('multi-selection keeps a stable outer outline while object boxes follow secondary motion', () => {
  const objects = [
    { id: 'image-a', type: 'image', x: 0, y: 0, w: 100, h: 100, data: {} },
    { id: 'image-b', type: 'image', x: 200, y: 0, w: 100, h: 100, data: {} },
  ];
  const objectMotions = new Map([
    ['image-a', {
      translateX: -5,
      translateY: 2,
      scaleX: 1.04,
      scaleY: 1 / 1.04,
      scaleOriginX: 0.5,
      scaleOriginY: 0.12,
    }],
    ['image-b', {
      translateX: 10,
      translateY: -3,
      scaleX: 0.96,
      scaleY: 1 / 0.96,
      scaleOriginX: 0.5,
      scaleOriginY: 0.12,
    }],
  ]);
  const context = loadSelectionInputHarness(objects, { objectMotions });

  context.updateSelectionOverlay();

  assert.equal(context.selOverlay.style.transform, 'translate(1.5px,-1.5px)');
  assert.equal(context.selOverlay.style.width, '302px');
  assert.equal(context.selOverlay.style.height, '102px');
  assert.equal(context._multiSelBoxes[0].style.transform, 'translate(-8px,1.461538462px)');
  assert.equal(context._multiSelBoxes[0].style.width, '106px');
  assert.equal(context._multiSelBoxes[1].style.transform, 'translate(211px,-4.5px)');
  assert.equal(context._multiSelBoxes[1].style.width, '98px');
  assert.equal(context.motionLookups, objects.length);
});

test('image selection overlay covers renderer edge overdraw', () => {
  const image = { id: 'image-a', type: 'image', x: 10, y: 20, w: 100, h: 40, data: {} };
  const context = loadSelectionInputHarness([image], { devicePixelRatio: 2 });

  context.updateSelectionOverlay();

  assert.equal(context.selOverlay.style.transform, 'translate(9.5px,19.5px)');
  assert.equal(context.selOverlay.style.width, '101px');
  assert.equal(context.selOverlay.style.height, '41px');
});

test('selection surfaces share the same outline color token', () => {
  const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

  assert.match(styles, /--selection-outline:\s*rgba\(10,\s*132,\s*255,\s*1\);/);
  assert.match(styles, /--selection-highlight:\s*rgba\(10,\s*132,\s*255,\s*0\.3\);/);
  assert.match(styles, /--text-edit-outline:\s*var\(--selection-outline\);/);
  assert.match(styles, /#canvas\.panning, #canvas\.panning \.s-handle \{ cursor: grabbing !important; \}/);
  assert.doesNotMatch(styles, /#canvas\.panning\s+\*/);
  assert.match(styles, /\.multi-sel-box\s*\{[\s\S]*box-shadow:\s*inset 0 0 0 1px var\(--selection-outline\);/);
  assert.match(styles, /#rubber-band\s*\{[\s\S]*border:\s*1px solid var\(--selection-outline\);/);
});

test('single image resize uses the smaller implied scale and anchors the opposite corner', () => {
  const image = { id: 'image-a', type: 'image', x: 0, y: 0, w: 200, h: 100, data: {} };
  const context = loadSelectionInputHarness([image]);

  context.beginSelectionHandleDrag({
    dataset: { dir: 'ne' },
  }, {
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ clientX: 80, clientY: -10 });
  context.drag.up();

  assert.equal(Math.round(image.x), 0);
  assert.equal(Math.round(image.y), -10);
  assert.equal(Math.round(image.w), 220);
  assert.equal(Math.round(image.h), 110);
  assert.equal(Math.round(image.x + image.w), 220);
  assert.equal(Math.round(image.y + image.h), 100);
  assert.equal(context.drawBoardCalls, 1);
  assert.deepEqual(context.renders, []);
  assert.deepEqual(context.motionPulses, []);
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

test('single text horizontal resize clamps to the measured word minimum width', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'wide' } };
  const context = loadSelectionInputHarness([text], {
    getTextMinWidth: () => 47,
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
  context.drag.move({ clientX: -180, clientY: 0 });
  context.drag.up();

  assert.equal(text.x, 0);
  assert.equal(text.w, 47);
  assert.deepEqual(context.history, ['resize']);
});

test('single text horizontal resize records passive perf debug phases', () => {
  const text = {
    id: 'text-a',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'alpha\nbeta gamma' },
  };
  const context = loadSelectionInputHarness([text], {
    syncTextAutoHeight(obj) {
      obj.h = 72;
      return true;
    },
  });
  const debugEvents = [];
  context.ManualPerfDebug = {
    isTextResizeTraceActive() {
      return true;
    },
    startTextResizeDrag(meta) {
      debugEvents.push({ step: 'start', meta });
      return 'drag-1';
    },
    recordTextResizeStep(step, meta) {
      debugEvents.push({ step, meta });
    },
    finishTextResizeDrag(dragId, meta) {
      debugEvents.push({ step: 'end', meta: { dragId, ...meta } });
    },
  };

  context.beginSelectionHandleDrag({
    dataset: { dir: 'e' },
  }, {
    type: 'mousedown',
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ type: 'mousemove', clientX: 40, clientY: 0 });
  context.drag.up();

  const steps = debugEvents.map((event) => event.step);
  assert.ok(steps.includes('start'));
  assert.ok(steps.includes('move'));
  assert.ok(steps.includes('apply-start'));
  assert.ok(steps.includes('apply-end'));
  assert.ok(steps.includes('flush'));
  assert.ok(steps.includes('history-pushed'));
  assert.equal(steps.at(-1), 'end');
  assert.equal(debugEvents[0].meta.contentChars, text.data.content.length);
  assert.equal(debugEvents[0].meta.logicalLines, 2);
  assert.equal(debugEvents[0].meta.startW, 200);
  assert.equal(debugEvents.find((event) => event.step === 'move').meta.minTextW, 100);
  assert.equal(debugEvents.find((event) => event.step === 'move').meta.w, 240);
  assert.equal(debugEvents.find((event) => event.step === 'apply-end').meta.autoHeightChanged, true);
  assert.equal(debugEvents.find((event) => event.step === 'history-pushed').meta.historyReason, 'resize');
});

test('single text horizontal resize reuses measured minimum width during one drag', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'wide' } };
  let minWidthCalls = 0;
  const context = loadSelectionInputHarness([text], {
    deferRaf: true,
    getTextMinWidth() {
      minWidthCalls++;
      return 90;
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
  context.drag.move({ clientX: -80, clientY: 0 });
  context.drag.move({ clientX: -70, clientY: 0 });
  context.drag.move({ clientX: -60, clientY: 0 });
  assert.equal(minWidthCalls, 0);
  context.drag.up();

  assert.equal(minWidthCalls, 1);
  assert.equal(text.w, 140);
});

test('selecting text schedules delayed minimum-width cache warm', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'wide' } };
  let minWidthCalls = 0;
  const context = loadSelectionInputHarness([text], {
    selectedId: null,
    getTextMinWidth(obj) {
      minWidthCalls++;
      assert.equal(obj.id, 'text-a');
      return 90;
    },
  });

  context.selectObject('text-a');

  assert.equal(minWidthCalls, 0);
  assert.equal(context.timeoutDelay, 250);

  context.timeoutHandler();

  assert.equal(minWidthCalls, 1);
});

test('deselecting text cancels delayed minimum-width cache warm', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'wide' } };
  let minWidthCalls = 0;
  const context = loadSelectionInputHarness([text], {
    getTextMinWidth() {
      minWidthCalls++;
      return 90;
    },
  });

  context.selectObject('text-a');
  context.deselectAll();
  context.timeoutHandler();

  assert.deepEqual(context.clearedTimeouts, [1]);
  assert.equal(minWidthCalls, 0);
});

test('single text resize skips auto-height when clamped width is unchanged', () => {
  const text = { id: 'text-a', type: 'text', x: 0, y: 0, w: 200, h: 40, data: { content: 'wide' } };
  const context = loadSelectionInputHarness([text], {
    getTextMinWidth: () => 100,
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
  context.drag.move({ clientX: -120, clientY: 0 });
  context.drag.move({ clientX: -140, clientY: 0 });
  context.drag.up();

  assert.equal(text.w, 100);
  assert.equal(text.h, 80);
  assert.deepEqual(context.syncedTextIds, ['text-a']);
});

test('large text resize updates auto-height and board content during drag', () => {
  const text = {
    id: 'text-a',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'word '.repeat(5000) },
  };
  const context = loadSelectionInputHarness([text], {
    syncTextAutoHeight(obj) {
      obj.h = 120;
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
  context.drag.move({ clientX: 80, clientY: 0 });

  assert.equal(text.w, 280);
  assert.equal(text.h, 120);
  assert.deepEqual(context.syncedTextIds, ['text-a']);
  assert.equal(context.drawBoardCalls, 1);

  context.drag.up();

  assert.equal(text.h, 120);
  assert.deepEqual(context.syncedTextIds, ['text-a']);
  assert.equal(context.drawBoardCalls, 1);
});

test('large text resize skips board redraw when clamped width is unchanged', () => {
  const text = {
    id: 'text-a',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'word '.repeat(5000) },
  };
  const context = loadSelectionInputHarness([text], {
    getTextMinWidth: () => 100,
    syncTextAutoHeight(obj) {
      obj.h = 120;
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
  context.drag.move({ clientX: -120, clientY: 0 });
  context.drag.move({ clientX: -140, clientY: 0 });

  assert.equal(text.w, 100);
  assert.equal(text.h, 120);
  assert.deepEqual(context.syncedTextIds, ['text-a']);
  assert.equal(context.drawBoardCalls, 1);

  context.drag.up();

  assert.equal(text.h, 120);
  assert.deepEqual(context.syncedTextIds, ['text-a']);
  assert.equal(context.drawBoardCalls, 1);
});

test('large text resize records live cache-keyed auto-height debug evidence', () => {
  const text = {
    id: 'text-a',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'word '.repeat(5000) },
  };
  const context = loadSelectionInputHarness([text], {
    syncTextAutoHeight(obj) {
      obj.h = 120;
      return true;
    },
  });
  const debugEvents = [];
  context.ManualPerfDebug = {
    isTextResizeTraceActive() {
      return true;
    },
    startTextResizeDrag(meta) {
      debugEvents.push({ step: 'start', meta });
      return 'drag-large';
    },
    recordTextResizeStep(step, meta) {
      debugEvents.push({ step, meta });
    },
    finishTextResizeDrag(dragId, meta) {
      debugEvents.push({ step: 'end', meta: { dragId, ...meta } });
    },
  };

  context.beginSelectionHandleDrag({
    dataset: { dir: 'e' },
  }, {
    type: 'mousedown',
    button: 0,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  context.drag.move({ type: 'mousemove', clientX: 80, clientY: 0 });
  context.drag.up();

  const applyEnd = debugEvents.find((event) => event.step === 'apply-end');
  const flush = debugEvents.find((event) => event.step === 'flush');

  assert.equal(applyEnd.meta.renderBoard, true);
  assert.equal(applyEnd.meta.pendingSizeSync, false);
  assert.equal(applyEnd.meta.autoHeightReason, 'resize');
  assert.equal(applyEnd.meta.layoutInvalidationMethod, 'cache-keyed');
  assert.equal(flush.meta.pendingSizeSync, false);
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

  assert.equal(context.recordTextEditInputHistory(text.id, 'deleteContentBackward'), false);

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

    assert.equal(context.recordTextEditInputHistory(text.id, meta.inputType, meta.hadSelection), true);
    assert.equal(context._editHistoryTimer, null);
    assert.equal(context.timeoutDelay, null);
    assert.deepEqual(context.history, ['text-edit-checkpoint']);
  }
});
