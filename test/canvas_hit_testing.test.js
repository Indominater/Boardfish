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
    isEventInsideViewportWheelSurface: (e) => e.insideViewportWheelSurface === true,
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

function loadResetZoomHarness({ objects = [], panX = 0, panY = 0, zoom = 1, selectedIds = [], editingId = null } = {}) {
  const source = readSource('src/js/context_menu.js');
  const match = source.match(/function pointToObjectCenterDistanceSq\(point, obj\) \{[\s\S]*?\r?\n\r?\nconst resetZoomFromPill/);
  assert.ok(match, 'reset zoom functions are missing');

  const context = {
    objects,
    panX,
    panY,
    zoom,
    selectedIds: new Set(selectedIds),
    editingId,
    transforms: [],
    deselectCalls: 0,
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
    deselectAll() {
      context.deselectCalls++;
      context.selectedIds.clear();
      context.editingId = null;
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
  const styles = readSource('src/styles.css');

  assert.match(contextMenuSource, /if \(obj\) \{[\s\S]*obj-ctx-menu:open[\s\S]*return;[\s\S]*\}\s*if \(selectedIds\.size\) deselectAll\(\);\s*ctxPos = wp;\s*openCtxMenuAt\(clientX, clientY\);/);
  assert.doesNotMatch(contextMenuSource, /addTextBtn\.disabled|addImageBtn\.disabled|updateCtxMenuActions|button\??\.disabled|reason: 'disabled'/);
  assert.doesNotMatch(styles, /\.ctx-item:disabled|aria-disabled/);
});

test('context menu command buttons use the button click point as the object center', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(contextMenuSource, /const BOARD_CURSOR_CLIENT_EVENT_TYPES = Object\.freeze\(\[[\s\S]*'pointerover'[\s\S]*'pointerenter'[\s\S]*'pointermove'[\s\S]*'pointerdown'[\s\S]*'pointerup'[\s\S]*'mouseover'[\s\S]*'mouseenter'[\s\S]*'mousemove'[\s\S]*'mousedown'[\s\S]*'mouseup'[\s\S]*'click'[\s\S]*'dragover'[\s\S]*'drop'[\s\S]*\]\);/);
  assert.match(contextMenuSource, /for \(const type of BOARD_CURSOR_CLIENT_EVENT_TYPES\) \{\s*document\.addEventListener\(type, rememberBoardCursorClientPoint, true\);\s*window\.addEventListener\(type, rememberBoardCursorClientPoint, true\);\s*\}/);
  assert.match(contextMenuSource, /function menuCommandWorldPoint\(event = null\) \{[\s\S]*return toWorld\(x, y\);[\s\S]*return boardCursorWorldPoint\(\);[\s\S]*\}/);
  assert.match(contextMenuSource, /const point = menuCommandWorldPoint\(event\);[\s\S]*addText\(point\.x, point\.y, '', \{ anchor: 'center' \}\)/);
  assert.match(contextMenuSource, /'btn-add-image': \(event\) => \{[\s\S]*const point = menuCommandWorldPoint\(event\);[\s\S]*pickAndInsertImages\(point\.x, point\.y\);[\s\S]*\}/);
  assert.match(contextMenuSource, /'btn-paste': \(event\) => \{[\s\S]*const point = menuCommandWorldPoint\(event\);[\s\S]*pasteAtPos\(point\.x, point\.y\);[\s\S]*\}/);
  assert.match(contextMenuSource, /'obj-btn-duplicate': \(event\) => \{[\s\S]*const point = menuCommandWorldPoint\(event\);[\s\S]*duplicateSelected\(point\);[\s\S]*\}/);
  assert.match(contextMenuSource, /runMenuCommand\(button, 'pointerup', e\);/);
  assert.match(contextMenuSource, /runMenuCommand\(button, 'mouseup', e\);/);
  assert.match(contextMenuSource, /runMenuCommand\(event\.currentTarget, 'click', event\);/);
  assert.match(contextMenuSource, /ctxPos = boardCursorWorldPoint\(\);[\s\S]*runMenuCommand\(addImageBtn, 'shortcut'\);/);
  assert.match(contextMenuSource, /ctxPos = boardCursorWorldPoint\(\);[\s\S]*runMenuCommand\(addTextBtn, 'shortcut'\);/);
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
  assert.equal(textMenu.indexOf('id="text-btn-cut"'), -1);
  assert.ok(textMenu.indexOf('id="text-btn-paste"') < textMenu.indexOf('id="text-sep-delete"'));
  assert.ok(textMenu.indexOf('id="text-sep-delete"') < textMenu.indexOf('id="text-btn-delete"'));
});

test('wheel zoom over visible floating UI uses the viewport wheel handler', () => {
  const inputSource = readSource('src/js/canvas_input.js');
  const selectionSource = readSource('src/js/selection_input.js');
  const styles = readSource('src/styles.css');

  assert.match(inputSource, /function handleGlobalViewportWheel\(e\) \{[\s\S]*if \(e\.__boardfishViewportWheelHandled\) return;[\s\S]*const viewportZoomGesture = e\.ctrlKey \|\| e\.metaKey;[\s\S]*isEventInsideViewportWheelSurface[\s\S]*if \(!viewportZoomGesture && !insideViewportWheelSurface\) return;\s*handleViewportWheel\(e\);[\s\S]*\}/);
  assert.match(inputSource, /window\.addEventListener\('wheel', handleGlobalViewportWheel, \{ capture: true, passive: false \}\);/);
  assert.match(inputSource, /document\.addEventListener\('wheel', handleGlobalViewportWheel, \{ capture: true, passive: false \}\);/);
  assert.match(selectionSource, /document\.elementFromPoint\(x, y\)/);
  assert.match(selectionSource, /if \(e\.target instanceof Node && e\.target\.nodeType === 1\) return false;/);
  assert.match(selectionSource, /const isEventInsideViewportWheelSurface = \(e\) => \{[\s\S]*isEventInsideVisibleContextMenu\(e\) \|\| isEventInsideVisibleIsland\(e\);[\s\S]*\};/);
  assert.match(selectionSource, /const isEventInsideVisibleContextMenu = \(e\) => \{[\s\S]*isEventInsideVisibleSurface\(e, ctxMenu\)[\s\S]*isEventInsideVisibleSurface\(e, objCtxMenu\)[\s\S]*isEventInsideVisibleSurface\(e, ctxActions\)[\s\S]*\};/);
  assert.match(styles, /#island \{[\s\S]*overscroll-behavior: none;[\s\S]*touch-action: none;/);
});

test('keyboard focus mirrors menu hover styling without focusing the zoom pill', () => {
  const styles = readSource('src/styles.css');
  const indexSource = readSource('src/index.html');

  assert.match(indexSource, /<button class="ctx-action-item[^"]*" id="ctx-btn-dark-mode"/);
  assert.match(indexSource, /<a class="ctx-action-item[^"]*" id="ctx-btn-github"/);
  assert.match(styles, /button\s*\{\s*outline: none;\s*\}/);
  assert.doesNotMatch(styles, /button:focus,\s*button:focus-visible\s*\{\s*outline: none;\s*\}/);
  assert.match(styles, /\.ctx-action-item\s*\{[\s\S]*outline: none;[\s\S]*\}/);
  assert.doesNotMatch(styles, /\.ctx-action-item:focus,\s*\.ctx-action-item:focus-visible\s*\{\s*outline: none;\s*\}/);
  assert.match(styles, /:where\(\.ctx-item:hover,\s*\.ctx-item:focus-visible,\s*\.ctx-action-item:focus-visible,[\s\S]*#island:hover \.ui-highlight-nudge\)\s*\{[\s\S]*--ui-highlight-nudge-transform: translateX\(var\(--highlight-nudge-x\)\);[\s\S]*\}/);
  assert.match(styles, /\.ctx-item:focus-visible\s*\{\s*background: var\(--firefox-menu-hover-bg\);\s*\}/);
  assert.match(styles, /\.ctx-action-item\.hotspot-hover::before,\s*\.ctx-action-item:focus-visible::before\s*\{\s*background: var\(--firefox-menu-hover-bg\);\s*\}/);
  assert.match(styles, /#dlg-discard:focus-visible\s*\{\s*background: var\(--danger-hover-bg\);\s*\}/);
  assert.doesNotMatch(styles, /#island:focus-visible #isl-zoom/);
});

test('destructive dialog action uses shared danger color tokens', () => {
  const styles = readSource('src/styles.css');

  assert.match(styles, /--danger-text:\s*#FF453A;/);
  assert.match(styles, /--danger-bg:\s*rgba\(255,\s*69,\s*58,\s*0\.18\);/);
  assert.match(styles, /--danger-hover-bg:\s*rgba\(255,\s*69,\s*58,\s*0\.26\);/);
  assert.match(styles, /--danger-active-bg:\s*rgba\(255,\s*69,\s*58,\s*0\.34\);/);
  assert.match(styles, /#dlg-discard\s*\{[\s\S]*background: var\(--danger-bg\);[\s\S]*color: var\(--danger-text\);[\s\S]*\}/);
  assert.match(styles, /#dlg-discard:hover\s*\{\s*background: var\(--danger-hover-bg\);\s*\}/);
  assert.match(styles, /#dlg-discard:active\s*\{\s*background: var\(--danger-active-bg\);\s*\}/);
});

test('zoom pill stays out of keyboard focus and Space reset paths', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const contextMenuSource = readSource('src/js/context_menu.js');
  const styles = readSource('src/styles.css');

  assert.match(styles, /#island:hover #isl-zoom\s*\{[\s\S]*background: var\(--firefox-menu-hover-bg\);[\s\S]*\}/);
  assert.match(styles, /#island\[data-mode="message"\] \{[\s\S]*pointer-events: none;[\s\S]*\}/);
  assert.match(styles, /#island\[data-mode="message"\] #isl-zoom\s*\{[\s\S]*--ui-highlight-nudge-transform: translateX\(0\);[\s\S]*background: transparent;[\s\S]*transform: none;[\s\S]*\}/);
  assert.doesNotMatch(styles, /#island:hover #isl-zoom,\s*#island:focus-visible #isl-zoom/);
  assert.doesNotMatch(styles, /#island:focus-visible #isl-zoom/);
  assert.doesNotMatch(viewportSource, /island\.setAttribute\('tabindex', '0'\)/);
  assert.doesNotMatch(viewportSource, /island\.setAttribute\('role', 'button'\)/);
  assert.doesNotMatch(contextMenuSource, /island\?\.addEventListener\('keydown'/);
  assert.match(contextMenuSource, /const resetZoomFromPill = \(e\) => \{\s*if \(island\?\.dataset\?\.mode !== 'zoom'\) return;/);
  assert.match(contextMenuSource, /const suppressZoomPillContextMenu = \(e\) => \{\s*if \(island\?\.dataset\?\.mode !== 'zoom'\) return;/);
  assert.match(contextMenuSource, /if \(document\.activeElement === island\) island\.blur\(\);/);
});

test('text edit caret height follows script formatting', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawCaret(context, obj, layout, selStart');
  const end = viewportSource.indexOf('const applyObjectMotionForDraw', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const drawCaretSource = viewportSource.slice(start, end);

  assert.match(drawCaretSource, /textScriptCaretStateAt/);
  assert.match(drawCaretSource, /caretHeight = LINE_H \* scale;/);
  assert.match(drawCaretSource, /TEXT_BASELINE_Y_OFFSET \* scale/);
});

test('text edit caret honors visual line preference at wrapped line start', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawCaret(context, obj, layout, selStart');
  const end = viewportSource.indexOf('const applyObjectMotionForDraw', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = {
    _caretVisible: true,
    LINE_H: 24,
    TEXT_PAD: 16,
    TEXT_BASELINE_Y_OFFSET: 16,
    zoom: 1,
    canvasTextColor: () => '#111',
    lineXAtOffset(line, obj, offset) {
      return obj.x + context.TEXT_PAD + offset * 10;
    },
    lineEndX(line, obj) {
      return obj.x + context.TEXT_PAD + line.text.length * 10;
    },
    textLayoutLineIntersectsViewport: () => true,
    textScriptCaretStateAt: () => ({ depth: 0, offset: 0, scale: 1 }),
  };
  vm.createContext(context);
  vm.runInContext(
    `${viewportSource.slice(start, end)}\n` +
      'globalThis.drawCaret = drawCaret;\n',
    context,
  );

  const fillRects = [];
  const canvasContext = {
    fillStyle: '',
    fillRect(...args) { fillRects.push(args); },
  };
  const obj = {
    x: 10,
    y: 0,
    w: 120,
    h: 48,
    _textEditCaretIndex: 3,
    _textEditCaretLineStartIndex: 3,
  };
  const layout = [
    { text: 'abc', startIndex: 0, endIndex: 3, caretEndIndex: 3, y: 0 },
    { text: 'def', startIndex: 3, endIndex: 6, caretEndIndex: 6, y: 24 },
  ];

  assert.equal(context.drawCaret(canvasContext, obj, layout, 3), true);
  assert.deepEqual(fillRects, [[26, 24, 2, 24]]);
});

test('text edit caret passes consumed soft-wrap space offsets to layout', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawCaret(context, obj, layout, selStart');
  const end = viewportSource.indexOf('const applyObjectMotionForDraw', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const seenOffsets = [];
  const context = {
    _caretVisible: true,
    LINE_H: 24,
    TEXT_PAD: 16,
    TEXT_BASELINE_Y_OFFSET: 16,
    zoom: 1,
    canvasTextColor: () => '#111',
    lineCaretXAtOffset(line, obj, offset) {
      seenOffsets.push(offset);
      return obj.x + context.TEXT_PAD + offset * 10;
    },
    lineXAtOffset(line, obj, offset) {
      return obj.x + context.TEXT_PAD + offset * 10;
    },
    lineEndX(line, obj) {
      return obj.x + context.TEXT_PAD + line.text.length * 10;
    },
    textLayoutLineIntersectsViewport: () => true,
    textScriptCaretStateAt: () => ({ depth: 0, offset: 0, scale: 1 }),
  };
  vm.createContext(context);
  vm.runInContext(
    `${viewportSource.slice(start, end)}\n` +
      'globalThis.drawCaret = drawCaret;\n',
    context,
  );

  const fillRects = [];
  const canvasContext = {
    fillStyle: '',
    fillRect(...args) { fillRects.push(args); },
  };
  const obj = { x: 10, y: 0, w: 120, h: 24 };
  const layout = [{ text: 'hi', startIndex: 0, endIndex: 2, caretEndIndex: 4, y: 0 }];

  assert.equal(context.drawCaret(canvasContext, obj, layout, 3), true);
  assert.deepEqual(seenOffsets, [3]);
  assert.deepEqual(fillRects, [[55, 0, 2, 24]]);
});

test('text edit caret stays inside content bounds at low zoom', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawCaret(context, obj, layout, selStart');
  const end = viewportSource.indexOf('const applyObjectMotionForDraw', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = {
    _caretVisible: true,
    LINE_H: 24,
    TEXT_PAD: 16,
    TEXT_BASELINE_Y_OFFSET: 16,
    zoom: 1,
    canvasTextColor: () => '#111',
    lineXAtOffset(line, obj, offset) {
      return obj.x + context.TEXT_PAD + offset * 10;
    },
    lineEndX(line, obj) {
      return obj.x + context.TEXT_PAD + line.text.length * 10;
    },
    textLayoutLineIntersectsViewport: () => true,
    textScriptCaretStateAt: () => ({ depth: 0, offset: 0, scale: 1 }),
  };
  vm.createContext(context);
  vm.runInContext(
    `${viewportSource.slice(start, end)}\n` +
      'globalThis.drawCaret = drawCaret;\n',
    context,
  );

  const fillRects = [];
  const canvasContext = {
    fillStyle: '',
    fillRect(...args) { fillRects.push(args); },
  };
  const obj = { x: 10, y: 0, w: 40, h: 24 };
  const layout = [{ text: 'abc', startIndex: 0, endIndex: 3, caretEndIndex: 3, y: 0 }];
  const view = { zoom: 0.25 };

  assert.equal(context.drawCaret(canvasContext, obj, layout, 0, { view }), true);
  assert.equal(context.drawCaret(canvasContext, obj, layout, 3, { view }), true);
  assert.deepEqual(fillRects, [
    [26, 0, 8, 24],
    [26, 0, 8, 24],
  ]);
});

test('text edit overlay draws only visible layout lines', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawEditingTextOverlay');
  const end = viewportSource.indexOf('function drawBoard', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const overlaySource = viewportSource.slice(start, end);

  assert.match(overlaySource, /visibleTextLayoutLines\(layout, viewportRect\)/);
  assert.match(overlaySource, /editVisibleLines/);
  assert.match(overlaySource, /editCulledLines/);
  assert.match(overlaySource, /drawTextLayoutStatic\([\s\S]*lines: visibleLines/);
});

test('entering text edit invalidates the offscreen cache before proxy setup', () => {
  const textEditorSource = readSource('src/js/text_editor.js');
  const start = textEditorSource.indexOf('function enterEdit');
  const end = textEditorSource.indexOf('function exitEdit', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const enterSource = textEditorSource.slice(start, end);
  const editingIndex = enterSource.indexOf('editingId = id;');
  const invalidateIndex = enterSource.indexOf('invalidateOffscreen();', editingIndex);
  const proxyIndex = enterSource.indexOf("document.createElement('textarea')");

  assert.ok(editingIndex >= 0, 'enterEdit must set editingId');
  assert.ok(invalidateIndex > editingIndex, 'enterEdit must invalidate after editingId changes');
  assert.ok(proxyIndex > invalidateIndex, 'offscreen invalidation must happen before proxy setup can focus or render');
});

test('text edit mode keeps text direct while caching static non-text layers', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const helperStart = viewportSource.indexOf('function shouldUseEditOffscreenCache');
  const helperEnd = viewportSource.indexOf('function drawBoard', helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  for (const { theme, objects, editingId, expectedFullCache, expectedCacheKind } of [
    { theme: 'dark', objects: [], editingId: 'text-1', expectedFullCache: false, expectedCacheKind: 'non-text' },
    { theme: 'light', objects: [{ id: 'img-1', type: 'image' }], editingId: 'text-1', expectedFullCache: true, expectedCacheKind: 'full' },
    {
      theme: 'light',
      objects: [
        { id: 'text-1', type: 'text' },
        { id: 'text-2', type: 'text' },
      ],
      editingId: 'text-1',
      expectedFullCache: false,
      expectedCacheKind: 'non-text',
    },
  ]) {
    const context = { appTheme: theme, document: { body: { dataset: { theme } } }, objects, editingId };
    vm.createContext(context);
    vm.runInContext(
      `${viewportSource.slice(helperStart, helperEnd)}\n` +
        'globalThis.shouldUseEditOffscreenCache = shouldUseEditOffscreenCache;\n' +
        'globalThis.editOffscreenCacheKind = editOffscreenCacheKind;\n',
      context,
    );
    assert.equal(context.shouldUseEditOffscreenCache(), expectedFullCache);
    assert.equal(context.editOffscreenCacheKind(), expectedCacheKind);
  }

  const drawStart = viewportSource.indexOf('function drawBoard');
  const drawEnd = viewportSource.indexOf('function hitTest', drawStart);
  assert.notEqual(drawStart, -1);
  assert.notEqual(drawEnd, -1);
  const drawSource = viewportSource.slice(drawStart, drawEnd);

  assert.match(drawSource, /const textSelectionSpecs = textSelectionJelloSpecsForDraw\(\);/);
  assert.match(drawSource, /const copiedSelectionSkipIds = textSelectionJelloSkipIds\(textSelectionSpecs, editingId \|\| null\);/);
  assert.match(drawSource, /const hasCopiedSelectionSkipIds = !!copiedSelectionSkipIds\?\.size;/);
  assert.match(drawSource, /const editCacheKind = hasCopiedSelectionSkipIds \? '' : editOffscreenCacheKind\(\);/);
  assert.match(drawSource, /setEditOffscreenCacheKind\(editCacheKind\);/);
  assert.match(drawSource, /const bypassEditOffscreenCache = options\.bypassEditOffscreenCache === true;/);
  assert.match(drawSource, /const useEditOffscreenCache = !!editCacheKind && !bypassEditOffscreenCache;/);
  assert.match(drawSource, /if \(useEditOffscreenCache && _offscreenDirty\) \{\s*_rebuildOffscreen\(\);\s*\}/);
  assert.match(drawSource, /if \(useEditOffscreenCache && !_offscreenDirty\)[\s\S]*ctx\.drawImage\(_offscreen, 0, 0\);/);
  assert.match(drawSource, /if \(editCacheKind === 'non-text'\)[\s\S]*drawVisibleObjects\(ctx, counters, \{ skipId: editingId, skipIds: copiedSelectionSkipIds, viewportRect, imageSourceResolver: openInitialImageSourceResolver, onlyText: true \}\);/);
  assert.match(drawSource, /else \{[\s\S]*drawVisibleObjects\(ctx, counters, \{ skipId: editingId, skipIds: copiedSelectionSkipIds, viewportRect, imageSourceResolver: openInitialImageSourceResolver \}\);/);
  assert.match(drawSource, /drawVisibleObjects\(ctx, counters, \{ viewportRect, skipIds: copiedSelectionSkipIds, imageSourceResolver: openInitialImageSourceResolver \}\);/);
  assert.match(drawSource, /drawTextSelectionJelloOverlays\(ctx, viewportRect, \{ zoom, panX, panY, dpr \}, textSelectionSpecs\);/);

  const transformStart = viewportSource.indexOf('function applyTransform');
  const transformEnd = viewportSource.indexOf('function getLastApplyTransformMeta', transformStart);
  const transformSource = viewportSource.slice(transformStart, transformEnd);
  assert.match(transformSource, /drawBoard\(\{ bypassEditOffscreenCache: true \}\);/);
  assert.doesNotMatch(transformSource, /_rebuildOffscreen\(/);
});

test('text selection collection uses indexed script metrics while editing math text', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('const collectTextSelectionRuns =');
  const end = viewportSource.indexOf('const textSelectionMotionForOptions', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const selectionSource = viewportSource.slice(start, end);

  assert.match(selectionSource, /getTextScriptLayoutMetrics/);
  assert.match(selectionSource, /const isHiddenAt = \(line, globalIndex\) =>/);
  assert.match(selectionSource, /const stateAt = \(line, globalIndex\) =>/);
  assert.match(selectionSource, /textScriptMetricsHiddenAt/);
  assert.match(selectionSource, /textScriptMetricsStateAt/);
});

test('editing overlay keeps copied text selection highlighted while its jiggle is active', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawEditingTextOverlay');
  const end = viewportSource.indexOf('function shouldUseEditOffscreenCache', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const overlaySource = viewportSource.slice(start, end);

  assert.match(overlaySource, /const copiedSelectionSpec = textSelectionJelloSpecForId\(options\.textSelectionSpecs \|\| \[\], obj\.id\);/);
  assert.match(overlaySource, /const useCopiedSelectionMotion = !!copiedMotion && \(liveSelStart === liveSelEnd \|\| liveMatchesCopied\);/);
  assert.match(overlaySource, /const selStart = useCopiedSelectionMotion \? copiedSelectionSpec\.start : liveSelStart;/);
  assert.match(overlaySource, /const selEnd\s+= useCopiedSelectionMotion \? copiedSelectionSpec\.end\s+: liveSelEnd;/);
  assert.match(overlaySource, /drawTextLayoutStatic\([\s\S]*textSelectionMotion \? \{ start: selStart, end: selEnd \} : null/);
});

test('overlapping text selection highlight runs collapse before fill', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('const TEXT_SELECTION_RECT_EPSILON =');
  const end = viewportSource.indexOf('const drawTextSelectionContentJello', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const selection = {
    bounds: { left: 0, top: 0, right: 40, bottom: 24 },
    runs: [
      { line: { y: 0 }, x1: 0, x2: 40, y: 0, height: 24 },
      { line: { y: 0 }, x1: 20, x2: 60, y: 0, height: 24 },
    ],
  };
  const drawCalls = [];
  const context = {
    LINE_H: 24,
    TextSelDebug: { _logDraw() {} },
    applyTextSelectionMotionTransform() {},
    textSelectionMotionForOptions() { return null; },
    textSelectionRunsForOptions() { return selection; },
  };
  vm.createContext(context);
  vm.runInContext(
    `${viewportSource.slice(start, end)}\n` +
      'globalThis.drawTextSelectionHighlight = drawTextSelectionHighlight;\n',
    context,
  );

  const canvasContext = {
    fillStyle: '',
    save() { drawCalls.push(['save']); },
    restore() { drawCalls.push(['restore']); },
    beginPath() { drawCalls.push(['beginPath']); },
    rect(...args) { drawCalls.push(['rect', ...args]); },
    fill() { drawCalls.push(['fill']); },
    fillRect(...args) { drawCalls.push(['fillRect', ...args]); },
  };

  assert.equal(context.drawTextSelectionHighlight(canvasContext, {}, [], 0, 10), true);
  assert.deepEqual(drawCalls, [
    ['save'],
    ['beginPath'],
    ['rect', 0, 0, 60, 24],
    ['fill'],
    ['restore'],
  ]);
});

test('script text selection highlight removes base overlap before fill', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('const TEXT_SELECTION_RECT_EPSILON =');
  const end = viewportSource.indexOf('const drawTextSelectionContentJello', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const selection = {
    bounds: { left: 0, top: -6, right: 100, bottom: 24 },
    runs: [
      { line: { y: 0 }, x1: 0, x2: 100, y: 0, height: 24 },
      { line: { y: 0 }, x1: 40, x2: 70, y: -6, height: 17 },
    ],
  };
  const rectCalls = [];
  const context = {
    LINE_H: 24,
    TextSelDebug: { _logDraw() {} },
    applyTextSelectionMotionTransform() {},
    textSelectionMotionForOptions() { return null; },
    textSelectionRunsForOptions() { return selection; },
  };
  vm.createContext(context);
  vm.runInContext(
    `${viewportSource.slice(start, end)}\n` +
      'globalThis.drawTextSelectionHighlight = drawTextSelectionHighlight;\n',
    context,
  );

  const canvasContext = {
    fillStyle: '',
    save() {},
    restore() {},
    beginPath() {},
    rect(...args) { rectCalls.push(args); },
    fill() {},
  };

  assert.equal(context.drawTextSelectionHighlight(canvasContext, {}, [], 0, 10), true);
  assert.deepEqual(rectCalls, [
    [40, -6, 30, 6],
    [0, 0, 100, 24],
  ]);
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

test('reset zoom clears selected and edited objects before zooming', () => {
  const image = { id: 'img-1', type: 'image', x: 600, y: 300, w: 100, h: 100 };
  const text = { id: 'text-1', type: 'text', x: 100, y: 100, w: 200, h: 80 };
  const context = loadResetZoomHarness({
    objects: [image, text],
    selectedIds: [image.id, text.id],
    editingId: text.id,
    panX: 0,
    panY: 0,
    zoom: 2,
  });

  assert.equal(context.resetZoomToClosestObject(), true);

  assert.equal(context.deselectCalls, 1);
  assert.equal(context.selectedIds.size, 0);
  assert.equal(context.editingId, null);
  assert.equal(context.zoom, 1);
  assert.deepEqual(context.transforms, ['reset-zoom']);
});
