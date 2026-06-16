'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const gutter = require('../src/js/text_edit_rectangle_gutter.js');
const EPSILON = 1e-9;

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function createDomElement(id = 'el') {
  const attrs = new Map();
  const classes = new Set();
  return {
    id,
    children: [],
    dataset: {},
    style: {
      setProperty(name, value) {
        this[name] = String(value);
      },
      removeProperty(name) {
        delete this[name];
      },
    },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child) {
      this.children.unshift(child);
      return child;
    },
    addEventListener() {},
    contains() { return false; },
    getAttribute(name) { return attrs.get(name) ?? null; },
    querySelectorAll() { return []; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
  };
}

test('cursor box is three caret heights square and merges with the text outline in the interior', () => {
  const geometry = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: 100,
    centerY: 70,
    caretHeightPx: 24,
    marginPx: 4,
  });
  const points = gutter.curvePoints(geometry, 8);

  assert.equal(geometry.sideLengthPx, 72);
  assert.equal(geometry.halfSideLengthPx, 36);
  assert.equal(geometry.leftX, 64);
  assert.equal(geometry.rightX, 136);
  assert.equal(geometry.topY, 34);
  assert.equal(geometry.bottomY, 106);
  assert.equal(geometry.svgLeftPx, 0);
  assert.equal(geometry.svgTopPx, 0);
  assert.equal(geometry.svgRightPx, 200);
  assert.equal(geometry.svgBottomPx, 180);
  assert.equal(geometry.svgWidthPx, 200);
  assert.equal(geometry.svgHeightPx, 180);
  assert.equal(points[0].x, geometry.leftX);
  assert.equal(points[0].y, geometry.topY);
  assert.equal(points[1].x, geometry.rightX);
  assert.equal(points[1].y, geometry.topY);
  assert.equal(points[2].x, geometry.rightX);
  assert.equal(points[2].y, geometry.bottomY);
  assert.equal(points.at(-1).x, geometry.leftX);
  assert.equal(points.at(-1).y, geometry.bottomY);
  assert.equal(gutter.pathData(geometry), 'M 0.5 0.5 L 199.5 0.5 L 199.5 179.5 L 0.5 179.5 Z');
  assert.equal(gutter.hitTestLocal(100, 70, geometry), false);
});

test('cursor box protrudes from each side when it overlaps that border', () => {
  const left = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: 16,
    centerY: 90,
    caretHeightPx: 24,
    marginPx: 4,
  });
  const right = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: 190,
    centerY: 90,
    caretHeightPx: 24,
    marginPx: 4,
  });
  const top = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: 100,
    centerY: 16,
    caretHeightPx: 24,
    marginPx: 4,
  });
  const bottom = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: 100,
    centerY: 170,
    caretHeightPx: 24,
    marginPx: 4,
  });

  assert.equal(left.svgLeftPx, -20);
  assert.equal(gutter.pathData(left), 'M 0.5 0.5 L 199.5 0.5 L 199.5 179.5 L 0.5 179.5 L 0.5 126 L -20 126 L -20 54 L 0.5 54 Z');
  assert.equal(right.svgRightPx, 226);
  assert.equal(gutter.pathData(right), 'M 0.5 0.5 L 199.5 0.5 L 199.5 54 L 226 54 L 226 126 L 199.5 126 L 199.5 179.5 L 0.5 179.5 Z');
  assert.equal(top.svgTopPx, -20);
  assert.equal(gutter.pathData(top), 'M 64 -20 L 136 -20 L 136 0.5 L 199.5 0.5 L 199.5 179.5 L 0.5 179.5 L 0.5 0.5 L 64 0.5 Z');
  assert.equal(bottom.svgBottomPx, 206);
  assert.equal(gutter.pathData(bottom), 'M 0.5 0.5 L 199.5 0.5 L 199.5 179.5 L 136 179.5 L 136 206 L 64 206 L 64 179.5 L 0.5 179.5 Z');
});

test('cursor box protrudes from both sides at a corner', () => {
  const geometry = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: 0,
    centerY: 180,
    caretHeightPx: 24,
    marginPx: 4,
  });

  assert.equal(geometry.centerX, 0);
  assert.equal(geometry.centerY, 180);
  assert.equal(geometry.leftX, -36);
  assert.equal(geometry.rightX, 36);
  assert.equal(geometry.topY, 144);
  assert.equal(geometry.bottomY, 216);
  assert.equal(geometry.svgLeftPx, -36);
  assert.equal(geometry.svgBottomPx, 216);
  assert.equal(gutter.pathData(geometry), 'M 0.5 0.5 L 199.5 0.5 L 199.5 179.5 L 36 179.5 L 36 216 L -36 216 L -36 144 L 0.5 144 Z');
});

test('cursor box center clamps to the text box while the box protrudes past it', () => {
  const geometry = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: -12,
    centerY: -12,
    caretHeightPx: 24,
    marginPx: 4,
  });

  assert.equal(geometry.centerX, 0);
  assert.equal(geometry.centerY, 0);
  assert.equal(geometry.leftX, -36);
  assert.equal(geometry.topY, -36);
  assert.equal(geometry.rightX, 36);
  assert.equal(geometry.bottomY, 36);
});

test('cursor box keeps the same square size across zoom levels', () => {
  for (const zoom of [0.5, 1, 2]) {
    const caretHeightPx = 24 * zoom;
    const marginPx = 4 * zoom;
    const geometry = gutter.createGeometry({
      widthPx: 320 * zoom,
      heightPx: 240 * zoom,
      centerX: 160 * zoom,
      centerY: 120 * zoom,
      caretHeightPx,
      marginPx,
    });

    assert.equal(geometry.sideLengthPx, 72 * zoom);
    assert.equal(geometry.halfSideLengthPx, 36 * zoom);
    assert.equal(geometry.rightX - geometry.leftX, 72 * zoom);
    assert.equal(geometry.bottomY - geometry.topY, 72 * zoom);
  }
});

test('cursor box hit testing accepts protrusions on every side only', () => {
  const geometry = gutter.createGeometry({
    widthPx: 200,
    heightPx: 180,
    centerX: 16,
    centerY: 170,
    caretHeightPx: 24,
    marginPx: 4,
  });

  assert.equal(gutter.hitTestLocal(-10, 170, geometry), true);
  assert.equal(gutter.hitTestLocal(16, 198, geometry), true);
  assert.equal(gutter.hitTestLocal(-10, 198, geometry), true);
  assert.equal(gutter.hitTestLocal(16, 170, geometry), false);
  assert.equal(gutter.hitTestLocal(-30, 170, geometry), false);
  assert.equal(gutter.hitTestLocal(16, 208, geometry), false);
});

test('viewport pan input updates rectangle gutter position from the current mouse screen y', () => {
  const textObj = { id: 'text-1', type: 'text', x: 100, y: 100, w: 200, h: 240, data: { content: 'abc' } };
  const selectedIds = new Set([textObj.id]);
  const elements = new Map();
  const elementForId = (id) => {
    if (!elements.has(id)) elements.set(id, createDomElement(id));
    return elements.get(id);
  };
  const context = {
    console,
    globalThis: null,
    document: {
      getElementById: () => null,
      createElement: () => createDomElement(),
      createElementNS: () => createDomElement(),
      addEventListener() {},
    },
    BoardfishTextEditRectangleGutter: gutter,
    LINE_H: 24,
    TEXT_PAD: 4,
    zoom: 1,
    panX: 0,
    panY: 0,
    editingId: textObj.id,
    _editEl: { selectionStart: 0 },
    objectsMap: new Map([[textObj.id, textObj]]),
    selectedIds,
    selectedId: textObj.id,
    selOverlay: elementForId('sel-overlay'),
    multiSelOverlay: elementForId('multi-sel-overlay'),
    rubberBand: elementForId('rubber-band'),
    ctxMenu: elementForId('ctx-menu'),
    objCtxMenu: elementForId('obj-ctx-menu'),
    ctxActions: elementForId('ctx-actions'),
    island: elementForId('island'),
    openingShield: elementForId('opening-shield'),
    isBoardInputBlocked: () => false,
    shouldKeepSelectionOverlayWhileBlocked: () => false,
    hasSelection: () => selectedIds.size > 0,
    isMultiSelected: () => false,
    getFirstSelectedObject: () => textObj,
    selectedBounds: () => ({ x1: textObj.x, y1: textObj.y, x2: textObj.x + textObj.w, y2: textObj.y + textObj.h }),
    selectedObjectsList: () => [textObj],
    getTextLayout: () => [{ startIndex: 0, endIndex: 3, caretEndIndex: 3, y: textObj.y }],
    acquireInputShield: () => () => {},
    BoardfishEditorState: {
      clearSelection() {
        selectedIds.clear();
      },
    },
    BoardfishMotion: {},
    beginDocumentDrag() {},
    createRafCommitter: () => ({ schedule() {}, flush() {} }),
    scheduleRender() {},
    syncTextAutoHeight: () => true,
    getTextMinWidth: () => 100,
    getTextMinLines: () => 1,
    markDirty() {},
    pushHistory() {},
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(
    readSource('src/js/selection_input.js') +
      '\nglobalThis.captureTextEditRectangleGutterPointerFromEvent = captureTextEditRectangleGutterPointerFromEvent;' +
      '\nglobalThis.updateSelectionOverlay = updateSelectionOverlay;',
    context,
  );

  context.panY = 40;
  assert.equal(context.captureTextEditRectangleGutterPointerFromEvent({ clientX: 200, clientY: 260 }), true);
  context.updateSelectionOverlay();

  assert.equal(context._textEditRectangleGutterState.pointerClientX, 200);
  assert.equal(context._textEditRectangleGutterState.pointerClientY, 260);
  assert.equal(context._textEditRectangleGutterState.currentCenterX, 100);
  assert.equal(context._textEditRectangleGutterState.currentCenterY, 120);
  assert.equal(context.selOverlay.classList.contains('merged-outline'), false);
  assert.equal(context.selOverlay.children[0].children[0].getAttribute('d'), '');

  assert.equal(context.captureTextEditRectangleGutterPointerFromEvent({ clientX: 200, clientY: 120 }), true);
  context.updateSelectionOverlay();

  assert.equal(context._textEditRectangleGutterState.currentCenterX, 100);
  assert.equal(context._textEditRectangleGutterState.currentCenterY, 0);
  assert.equal(context.selOverlay.classList.contains('merged-outline'), true);
  assert.equal(
    context.selOverlay.children[0].children[0].getAttribute('d'),
    'M 64 -36 L 136 -36 L 136 0.5 L 199.5 0.5 L 199.5 239.5 L 0.5 239.5 L 0.5 0.5 L 64 0.5 Z',
  );
});

test('text resize handles remain available in selection and edit mode', () => {
  const styles = readSource('src/styles.css');

  assert.match(styles, /#sel-overlay \.s-handle\[data-dir="w"\],\s*#sel-overlay \.s-handle\[data-dir="e"\]\s*\{\s*display: none;\s*\}/);
  assert.match(styles, /#sel-overlay\.text-resize \.s-handle\[data-dir="w"\],\s*#sel-overlay\.text-resize \.s-handle\[data-dir="e"\]\s*\{\s*display: block;\s*\}/);
  assert.doesNotMatch(styles, /#sel-overlay\.editing \.s-handle\s*\{\s*display: none;\s*\}/);
});

test('editing text uses one merged outline without a shared interior seam', () => {
  const styles = readSource('src/styles.css');
  const editingRule = styles.match(/#sel-overlay\.editing\s*\{([^}]*)\}/)?.[1] || '';
  const editingTextResizeRule = styles.match(/#sel-overlay\.editing\.text-resize\s*\{([^}]*)\}/)?.[1] || '';
  const mergedOutlineRule = styles.match(/#sel-overlay\.editing\.text-resize\.merged-outline\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(styles, /#sel-overlay\s*\{[\s\S]*box-shadow:\s*inset 0 0 0 1px var\(--text-edit-outline\)/);
  assert.doesNotMatch(editingRule, /box-shadow\s*:\s*none/);
  assert.doesNotMatch(editingTextResizeRule, /box-shadow\s*:\s*none/);
  assert.match(mergedOutlineRule, /box-shadow\s*:\s*none/);
  assert.match(styles, /#sel-overlay\.editing\.text-resize #text-edit-rectangle-gutter\s*\{\s*display: block;/);
});

test('viewport transforms capture rectangle gutter pointer coordinates before redraw', () => {
  const viewportSource = readSource('src/js/viewport.js');
  assert.match(
    viewportSource,
    /function scheduleTransform[\s\S]*captureTextEditRectangleGutterPointerFromEvent\(inputEvent\)/,
  );
});

test('mousedown in the rectangle gutter starts text selection before normal hit testing', () => {
  const listeners = { canvas: [], document: [], window: [] };
  const canvas = {
    classList: { add() {}, remove() {} },
    addEventListener(type, handler, options) {
      listeners.canvas.push({ type, handler, options });
    },
  };
  const boardCanvas = {};
  const textObj = { id: 'text-1', type: 'text', x: 100, y: 100, w: 200, h: 120, data: { content: 'abc' } };
  let hitTestCalls = 0;
  let rubberBandSelections = 0;
  let documentDragStarted = false;

  const context = {
    console,
    globalThis: null,
    performance: { now: () => 100 },
    window: {
      addEventListener(type, handler, options) {
        listeners.window.push({ type, handler, options });
      },
    },
    document: {
      activeElement: null,
      addEventListener(type, handler, options) {
        listeners.document.push({ type, handler, options });
      },
      removeEventListener() {},
    },
    canvas,
    boardCanvas,
    objectsMap: new Map([[textObj.id, textObj]]),
    selectedIds: new Set([textObj.id]),
    editingId: textObj.id,
    zoom: 1,
    panX: 0,
    panY: 0,
    _rubberBandDragActive: false,
    isBoardInputBlocked: () => false,
    isBoardNavigationAllowedWhileBlocked: () => false,
    isEventInsideViewportWheelSurface: () => false,
    isMultiSelected: () => false,
    hasSelection: () => true,
    isSelected: (id) => id === textObj.id,
    selectedBounds: () => ({ x1: textObj.x, y1: textObj.y, x2: textObj.x + textObj.w, y2: textObj.y + textObj.h }),
    rectContainsPoint: () => false,
    toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
    hitTest: () => {
      hitTestCalls++;
      return null;
    },
    textEditRectangleGutterHitTest: () => ({ object: textObj }),
    layoutHitTestCaret: () => ({ index: 0, affinity: '', lineStartIndex: 0 }),
    getTextLayout: () => [{ startIndex: 0, endIndex: 3, caretEndIndex: 3, text: 'abc', y: textObj.y + 4 }],
    beginDocumentDrag: () => {
      documentDragStarted = true;
    },
    startRubberBandSelection: () => {
      rubberBandSelections++;
    },
    scheduleRender() {},
    updateSelectionOverlay() {},
    selectObject() {},
    toggleAdditiveSelection() {},
    startGroupDrag: () => false,
    createRafCommitter: () => ({ schedule() {}, flush() {} }),
    BoardfishEditorState: {
      deleteEmptyTextObjects: () => false,
      setSelection: () => {
        rubberBandSelections++;
      },
    },
    BoardfishViewportState: {
      zoomAroundClient() {},
      panBy() {},
      setPan() {},
    },
    ViewportDebug: {
      isEnabled: () => false,
      start: () => ({}),
      count() {},
      end() {},
      timing() {},
    },
    TextSelDebug: {
      _logPointer() {},
      _logLayout() {},
      _logHitTiming() {},
      _logSelection() {},
    },
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(readSource('src/js/canvas_input.js'), context);
  const proxy = {
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: 'none',
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    focus() {
      context.document.activeElement = this;
    },
  };
  context._editEl = proxy;

  const mousedown = listeners.canvas.find((entry) => entry.type === 'mousedown')?.handler;
  assert.equal(typeof mousedown, 'function');
  mousedown({
    button: 0,
    clientX: 90,
    clientY: 120,
    target: canvas,
    metaKey: false,
    ctrlKey: false,
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(hitTestCalls, 0);
  assert.equal(rubberBandSelections, 0);
  assert.equal(documentDragStarted, true);
  assert.equal(proxy.selectionStart, 0);
  assert.equal(proxy.selectionEnd, 0);
});
