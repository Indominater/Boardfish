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
  const context = {
    console,
    canvas: { addEventListener() {}, classList: { add() {}, remove() {} } },
    boardCanvas: {},
    document: { addEventListener() {}, removeEventListener() {} },
    objectsMap: new Map([[obj.id, obj]]),
    selectedIds,
    editingId: null,
    zoom: 1,
    entered: [],
    history: [],
    selections: [],
    renders: [],
    logs: [],
    obj,
    isObjectLocked(target) { return target?.locked === true; },
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
    enterEdit(id) {
      context.entered.push(id);
      context._editEl = context.editProxy;
    },
    editProxy: {
      focused: false,
      selection: null,
      focus() { this.focused = true; },
      setSelectionRange(start, end) { this.selection = [start, end]; },
    },
    toWorld(clientX, clientY) { return { x: clientX, y: clientY }; },
    getTextLayout() { return [{ text: 'hello', startIndex: 0, prefixWidths: new Float64Array([0]) }]; },
    layoutHitTest(_layout, wx, wy) {
      context.hitPoint = { x: wx, y: wy };
      return 3;
    },
    TextSelDebug: { _logSelection(type) { context.logs.push(type); } },
    scheduleRender(select, overlay) { context.renders.push({ select, overlay }); },
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

test('click-release on an already selected text object enters edit mode', () => {
  const context = loadCanvasInputHarness();

  context.startObjectDrag({ clientX: 12, clientY: 22 }, context.obj);
  context.latestDrag().up({ clientX: 32, clientY: 42 });

  assert.deepEqual(context.entered, ['text-1']);
  assert.equal(context.editProxy.focused, true);
  assert.deepEqual(context.editProxy.selection, [3, 3]);
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
