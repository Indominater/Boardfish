'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadViewportHitTest() {
  const source = readSource('src/js/viewport.js');
  const match = source.match(/function hitTest\(wx, wy\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'viewport hitTest function is missing');

  const context = {
    nextObject: null,
    BoardObjectGeometry: {
      topObjectAtWorldPoint(point) {
        context.lastPoint = point;
        return context.nextObject;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${match[0]}\nthis.hitTest = hitTest;`, context);
  return context;
}

function loadCanvasWheelHarness() {
  const listeners = { window: [], document: [], canvas: [], island: [] };
  const makeTarget = (name) => ({
    addEventListener(type, handler, options) {
      listeners[name].push({ type, handler, options });
    },
    classList: { add() {}, remove() {} },
  });
  const context = {
    console,
    performance: { now: () => 100 },
    window: {
      addEventListener(type, handler, options) {
        listeners.window.push({ type, handler, options });
      },
    },
    document: {
      addEventListener(type, handler, options) {
        listeners.document.push({ type, handler, options });
      },
      removeEventListener() {},
    },
    canvas: makeTarget('canvas'),
    boardCanvas: {},
    island: makeTarget('island'),
    objectsMap: new Map(),
    selectedIds: new Set(),
    editingId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    _rubberBandDragActive: false,
    zoomCalls: [],
    transforms: [],
    navigationNotes: [],
    isEventInsideViewportWheelSurface: (e) => e.insideViewportWheelSurface === true,
    isEventInsideVisibleEyedropperLoupe: () => false,
    ViewportDebug: {
      isEnabled: () => false,
      start: () => ({}),
      count() {},
      end() {},
      timing() {},
    },
    BoardfishViewportState: {
      zoomAroundClient(clientX, clientY, nextZoom) {
        context.zoom = nextZoom;
        context.zoomCalls.push({ clientX, clientY, nextZoom });
      },
      panBy() {},
    },
    scheduleTransform(source, event) {
      context.transforms.push({ source, event });
    },
    noteEyedropperNavigationActive(reason) {
      context.navigationNotes.push(reason);
    },
    createRafCommitter: () => ({ schedule() {}, flush() {} }),
    beginDocumentDrag() {},
    isBoardInputBlocked: () => false,
    isBoardNavigationAllowedWhileBlocked: () => false,
    isMultiSelected: () => false,
    hasSelection: () => false,
    hitTest: () => null,
    toWorld: () => ({ x: 0, y: 0 }),
    deselectAll() {},
    BoardfishEditorState: { deleteEmptyTextObjects() {}, setSelection() {} },
  };

  vm.createContext(context);
  vm.runInContext(readSource('src/js/canvas_input.js'), context);
  context.listeners = listeners;
  return context;
}

function loadResetZoomHarness({ objects = [], panX = 0, panY = 0, zoom = 1 } = {}) {
  const source = readSource('src/js/context_menu.js');
  const match = source.match(/function pointToObjectCenterDistanceSq\(point, obj\) \{[\s\S]*?\r?\n\r?\nconst resetZoomFromPill/);
  assert.ok(match, 'reset zoom functions are missing');

  const context = {
    objects,
    panX,
    panY,
    zoom,
    transforms: [],
    debugEnd: null,
    window: { innerWidth: 1000, innerHeight: 800 },
    toWorld(sx, sy) {
      return {
        x: (sx - context.panX) / context.zoom,
        y: (sy - context.panY) / context.zoom,
      };
    },
    ViewportDebug: {
      start() { return {}; },
      end(_dbg, meta = {}) { context.debugEnd = meta; },
    },
    BoardfishViewportState: {
      setZoomPan(nextZoom, nextPanX, nextPanY) {
        context.zoom = nextZoom;
        context.panX = nextPanX;
        context.panY = nextPanY;
      },
    },
    scheduleTransform(sourceName) {
      context.transforms.push(sourceName);
    },
  };

  vm.createContext(context);
  vm.runInContext(match[0].replace(/\r?\n\r?\nconst resetZoomFromPill$/, ''), context);
  return context;
}

test('hitTest returns the top object at the world point', () => {
  const context = loadViewportHitTest();
  const object = { id: 'obj-1' };

  context.nextObject = object;
  assert.equal(context.hitTest(10, 20), object);
  assert.equal(context.lastPoint.x, 10);
  assert.equal(context.lastPoint.y, 20);
});

test('canvas and context menu use regular hit testing', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(contextMenuSource, /hitTest\(wp\.x, wp\.y\)/);
});

test('background context menu clears object selection before opening', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(contextMenuSource, /if \(obj\) \{[\s\S]*obj-ctx-menu:open[\s\S]*return;[\s\S]*\}\s*if \(selectedIds\.size\) deselectAll\(\);\s*ctxPos = wp;\s*updateCtxMenuActions\(\);\s*openCtxMenuAt\(clientX, clientY\);/);
});

test('text editing context menu uses text actions before object actions', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');
  const indexSource = readSource('src/index.html');

  assert.match(contextMenuSource, /if \(editingId && obj\?\.id === editingId\) \{\s*showTextEditContextMenuAt\(clientX, clientY\);\s*return;\s*\}/);
  assert.match(contextMenuSource, /const showPaste = clipboardText\.length > 0;/);
  assert.match(contextMenuSource, /return hasSelection \|\| showPaste;/);

  const textMenuStart = indexSource.indexOf('<div id="text-ctx-menu">');
  assert.notEqual(textMenuStart, -1);
  const textMenuEnd = indexSource.indexOf('<input type="file"', textMenuStart);
  const textMenu = indexSource.slice(textMenuStart, textMenuEnd);
  assert.ok(textMenu.indexOf('id="text-btn-copy"') < textMenu.indexOf('id="text-btn-paste"'));
  assert.ok(textMenu.indexOf('id="text-btn-paste"') < textMenu.indexOf('id="text-btn-cut"'));
  assert.ok(textMenu.indexOf('id="text-btn-cut"') < textMenu.indexOf('id="text-sep-delete"'));
  assert.ok(textMenu.indexOf('id="text-sep-delete"') < textMenu.indexOf('id="text-btn-delete"'));
});

test('wheel zoom over visible floating UI uses the viewport wheel handler', () => {
  const inputSource = readSource('src/js/canvas_input.js');
  const selectionSource = readSource('src/js/selection_input.js');
  const styles = readSource('src/styles.css');

  assert.match(inputSource, /function handleGlobalViewportWheel\(e\) \{[\s\S]*if \(e\.__boardfishViewportWheelHandled\) return;[\s\S]*const viewportZoomGesture = e\.ctrlKey \|\| e\.metaKey;[\s\S]*isEventInsideViewportWheelSurface[\s\S]*isEventInsideVisibleEyedropperLoupe[\s\S]*if \(!viewportZoomGesture && !insideViewportWheelSurface && !insideEyedropperLoupe\) return;\s*handleViewportWheel\(e\);[\s\S]*\}/);
  assert.match(inputSource, /window\.addEventListener\('wheel', handleGlobalViewportWheel, \{ capture: true, passive: false \}\);/);
  assert.match(inputSource, /document\.addEventListener\('wheel', handleGlobalViewportWheel, \{ capture: true, passive: false \}\);/);
  assert.match(selectionSource, /document\.elementFromPoint\(x, y\)/);
  assert.match(selectionSource, /const isEventInsideViewportWheelSurface = \(e\) => \{[\s\S]*isEventInsideVisibleContextMenu\(e\) \|\| isEventInsideVisibleIsland\(e\);[\s\S]*\};/);
  assert.match(selectionSource, /const isEventInsideVisibleContextMenu = \(e\) => \{[\s\S]*isEventInsideVisibleSurface\(e, ctxMenu\)[\s\S]*isEventInsideVisibleSurface\(e, objCtxMenu\)[\s\S]*isEventInsideVisibleSurface\(e, ctxActions\)[\s\S]*\};/);
  assert.match(styles, /#island \{[\s\S]*overscroll-behavior: none;[\s\S]*touch-action: none;/);
});

test('zoom pill stays out of keyboard focus and Space reset paths', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const contextMenuSource = readSource('src/js/context_menu.js');
  const styles = readSource('src/styles.css');

  assert.match(styles, /#island:hover #isl-zoom\s*\{[\s\S]*background: var\(--firefox-menu-hover-bg\);[\s\S]*\}/);
  assert.doesNotMatch(styles, /#island:hover #isl-zoom,\s*#island:focus-visible #isl-zoom/);
  assert.doesNotMatch(styles, /#island:focus-visible #isl-zoom/);
  assert.doesNotMatch(viewportSource, /island\.setAttribute\('tabindex', '0'\)/);
  assert.doesNotMatch(viewportSource, /island\.setAttribute\('role', 'button'\)/);
  assert.doesNotMatch(contextMenuSource, /island\?\.addEventListener\('keydown'/);
  assert.match(contextMenuSource, /if \(document\.activeElement === island\) island\.blur\(\);/);
});

test('zoom pill suppresses browser context menu without resetting zoom', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');
  const handlerBlock = contextMenuSource.match(/const suppressZoomPillContextMenu = \(e\) => \{[\s\S]*?\n\};/);

  assert.ok(handlerBlock, 'zoom pill contextmenu suppressor is missing');
  assert.match(handlerBlock[0], /e\.preventDefault\(\);/);
  assert.match(handlerBlock[0], /e\.stopPropagation\(\);/);
  assert.doesNotMatch(handlerBlock[0], /resetZoom|closeOpenMenus/);
  assert.match(contextMenuSource, /island\?\.addEventListener\('contextmenu', suppressZoomPillContextMenu\);/);
});

test('unsaved changes dialog suppresses browser context menu without closing', () => {
  const ioCloseSource = readSource('src/js/io_close.js');
  const handlerBlock = ioCloseSource.match(/unsavedDialog\.addEventListener\('contextmenu', \(e\) => \{[\s\S]*?\n\}\);/);

  assert.ok(handlerBlock, 'dialog contextmenu suppressor is missing');
  assert.match(ioCloseSource, /var unsavedDialog = document\.getElementById\('dialog'\);/);
  assert.match(handlerBlock[0], /e\.preventDefault\(\);/);
  assert.match(handlerBlock[0], /e\.stopPropagation\(\);/);
  assert.doesNotMatch(handlerBlock[0], /_dialogClose|classList\.remove/);
});

test('global capture wheel zoom over the zoom pill is handled once by the board', () => {
  const context = loadCanvasWheelHarness();
  const windowWheel = context.listeners.window.find((entry) => entry.type === 'wheel');
  const documentWheel = context.listeners.document.find((entry) => entry.type === 'wheel');
  assert.equal(windowWheel.options.capture, true);
  assert.equal(windowWheel.options.passive, false);
  assert.equal(documentWheel.options.capture, true);
  assert.equal(documentWheel.options.passive, false);

  const event = {
    ctrlKey: true,
    metaKey: false,
    deltaX: 0,
    deltaY: -100,
    clientX: 180,
    clientY: 120,
    insideViewportWheelSurface: true,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  windowWheel.handler(event);
  documentWheel.handler(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(context.zoomCalls.length, 1);
  assert.deepEqual(context.transforms.map((entry) => entry.source), ['wheel-zoom']);
  assert.deepEqual(context.navigationNotes, ['wheel-zoom']);
  assert.ok(context.zoomCalls[0].nextZoom > 1);
});

test('reset zoom on an empty board zooms to 100 percent around the current center', () => {
  const context = loadResetZoomHarness({ panX: 200, panY: 100, zoom: 2 });

  assert.equal(context.resetZoomToClosestObject(), true);

  assert.equal(context.zoom, 1);
  assert.equal(context.panX, 350);
  assert.equal(context.panY, 250);
  assert.deepEqual(context.transforms, ['reset-zoom']);
  assert.equal(context.toWorld(500, 400).x, 150);
  assert.equal(context.toWorld(500, 400).y, 150);
  assert.equal(context.debugEnd.mode, 'empty-board-center');
});
