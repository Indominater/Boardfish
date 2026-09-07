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

function cssBlocksForPrelude(source, prelude) {
  const blocks = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const headerStart = source.indexOf(prelude, searchFrom);
    if (headerStart < 0) break;
    const blockStart = source.indexOf('{', headerStart + prelude.length);
    assert.notEqual(blockStart, -1, `missing CSS block for ${prelude}`);
    let depth = 1;
    let cursor = blockStart + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    assert.equal(depth, 0, `unterminated CSS block for ${prelude}`);
    blocks.push(source.slice(blockStart + 1, cursor - 1));
    searchFrom = cursor;
  }
  return blocks;
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
        context.zoomCalls.push({ clientX, clientY, nextZoom }); return true;
      },
      panBy() { return true; },
    },
    scheduleTransform(changed, source, event) {
      context.transforms.push({ changed, source, event });
    },
    createRafCommitter: () => ({ schedule() {}, flush() {} }),
    beginDocumentDrag() {},
    isBoardInputBlocked: () => false,
    isBoardNavigationAllowedWhileBlocked: () => false,
    isMultiSelected: () => false,
    hasSelection: () => false,
    BoardObjectGeometry: { topObjectAtWorldPoint: () => null },
    toWorld: () => ({ x: 0, y: 0 }),
    deselectAll() {},
    BoardfishEditorState: { setSelection() {} },
  };

  vm.createContext(context);
  vm.runInContext(readSource('src/js/canvas_input.js'), context);
  context.listeners = listeners;
  return context;
}

function loadResetZoomHarness({ objects = [], panX = 0, panY = 0, zoom = 1, selectedIds = [], editingId = null } = {}) {
  const source = readSource('src/js/context_menu.js');
  const match = source.match(/function resetZoomToClosestObject\(\) \{[\s\S]*?\r?\n\r?\nconst resetZoomFromPill/);
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
        context.panY = nextPanY; return true;
      },
    },
    scheduleTransform(changed, sourceName) {
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

function loadMenuCommandHarness() {
  const source = readSource('src/js/context_menu.js');
  const match = source.match(/function menuCommandFromButton\(button\) \{[\s\S]*?\n\}\n\nfunction contextMenuSurfaceById/);
  assert.ok(match, 'menu command dispatcher is missing');

  const context = {
    calls: [],
    timers: [],
    console,
    MenuDebug: { log() {} },
    MENU_COMMANDS: {
      'btn-open': (event) => context.calls.push(event),
    },
    setTimeout(callback) {
      context.timers.push(callback);
    },
  };

  vm.createContext(context);
  vm.runInContext(
    `${match[0].replace(/\n\nfunction contextMenuSurfaceById$/, '')}\nthis.runMenuCommand = runMenuCommand;`,
    context,
  );
  return context;
}

function loadTextEditMenuHarness() {
  const source = readSource('src/js/context_menu.js');
  const start = source.indexOf('const showTextEditContextMenuAt');
  const end = source.indexOf('function showCanvasContextMenuAt', start);
  assert.ok(start >= 0 && end > start, 'text edit menu helpers are missing');

  const calls = {
    clipboardReads: 0,
    focuses: 0,
    opens: [],
  };
  const context = {
    calls,
    editingId: 'text-1',
    navigator: {
      clipboard: {
        readText() {
          calls.clipboardReads++;
          return Promise.resolve('clipboard text');
        },
      },
    },
    textCopyBtn: { style: {} },
    textPasteBtn: { style: { display: '' } },
    textDeleteSep: { style: {} },
    textDeleteBtn: { style: {} },
    textCtxMenu: {},
    getTextEditSelectionState() {
      return { hasSelection: false };
    },
    focusTextEditProxy() {
      calls.focuses++;
    },
    closeOpenMenusExcept() {},
    openExclusiveMenuAt(...args) {
      calls.opens.push(args);
    },
    MenuDebug: { log() {} },
  };

  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\n` +
      'this.showTextEditContextMenuAt = showTextEditContextMenuAt;\n',
    context,
  );
  return context;
}

function loadTextEditPasteHarness() {
  const source = readSource('src/js/context_menu.js');
  const readStart = source.indexOf('const readTextClipboardForEditMenu');
  const readEnd = source.indexOf('const writeTextClipboardFromEditMenu', readStart);
  const pasteStart = source.indexOf('const pasteTextIntoEditSelection');
  const pasteEnd = source.indexOf('function menuCommandFromButton', pasteStart);
  assert.ok(readStart >= 0 && readEnd > readStart, 'text clipboard reader is missing');
  assert.ok(pasteStart >= 0 && pasteEnd > pasteStart, 'text edit paste helper is missing');

  const calls = {
    clipboardReadActivations: [],
    internalPasteAttempts: 0,
    replacements: [],
  };
  const context = {
    Promise,
    calls,
    clipboardActivation: true,
    navigator: {
      clipboard: {
        readText() {
          calls.clipboardReadActivations.push(context.clipboardActivation);
          return Promise.resolve('external text');
        },
      },
    },
    currentBoardfishTextSelectionClipboardPayload() {
      return null;
    },
    pasteBoardfishTextSelectionIntoEditSelection() {
      calls.internalPasteAttempts++;
      return Promise.resolve(false);
    },
    clearJsClipboard() {},
    focusTextEditProxy() {},
    replaceTextEditSelection(text, options) {
      calls.replacements.push({ text, options });
    },
    MenuDebug: { log() {} },
  };

  vm.createContext(context);
  vm.runInContext(
    `${source.slice(readStart, readEnd)}\n${source.slice(pasteStart, pasteEnd)}\n` +
      'this.pasteTextIntoEditSelection = pasteTextIntoEditSelection;\n',
    context,
  );
  return context;
}

test('canvas and context menu use regular hit testing', () => {
  const canvasInputSource = readSource('src/js/canvas_input.js');
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(canvasInputSource, /BoardObjectGeometry\.topObjectAtWorldPoint\(wp\)/);
  assert.match(contextMenuSource, /BoardObjectGeometry\.topObjectAtWorldPoint\(wp\)/);
});

test('background context menu clears object selection before opening', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');
  const styles = readSource('src/styles.css');

  assert.match(contextMenuSource, /if \(obj\) \{[\s\S]*obj-ctx-menu:open[\s\S]*return;[\s\S]*\}\s*if \(selectedIds\.size\) deselectAll\(\);\s*openCtxMenuAt\(clientX, clientY\);/);
  assert.doesNotMatch(contextMenuSource, /addTextBtn\.disabled|addImageBtn\.disabled|updateCtxMenuActions|button\??\.disabled|reason: 'disabled'/);
  assert.doesNotMatch(styles, /\.ctx-item:disabled|aria-disabled/);
});

test('context menu command buttons use the button click point as the object center', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(contextMenuSource, /const HAS_POINTER_EVENTS = 'PointerEvent' in window;/);
  assert.match(contextMenuSource, /const BOARD_CURSOR_CLIENT_EVENT_TYPES = Object\.freeze\(\[[\s\S]*HAS_POINTER_EVENTS[\s\S]*'pointermove'[\s\S]*'mousemove'[\s\S]*'click'[\s\S]*'dragover'[\s\S]*'drop'[\s\S]*\]\);/);
  assert.match(contextMenuSource, /for \(const type of BOARD_CURSOR_CLIENT_EVENT_TYPES\) \{\s*window\.addEventListener\(type, rememberBoardCursorClientPoint, true\);\s*\}/);
  assert.doesNotMatch(contextMenuSource, /document\.addEventListener\(type, rememberBoardCursorClientPoint, true\)/);
  assert.match(contextMenuSource, /function menuCommandWorldPoint\(event = null\) \{[\s\S]*return toWorld\(x, y\);[\s\S]*return boardCursorWorldPoint\(\);[\s\S]*\}/);
  assert.match(contextMenuSource, /const point = menuCommandWorldPoint\(event\);[\s\S]*addText\(point\.x, point\.y, '', \{ anchor: 'center' \}\)/);
  assert.match(contextMenuSource, /'btn-add-image': \(event\) => \{[\s\S]*const point = menuCommandWorldPoint\(event\);[\s\S]*pickAndInsertImages\(point\.x, point\.y\);[\s\S]*\}/);
  assert.match(contextMenuSource, /'btn-paste': \(event\) => \{[\s\S]*const point = menuCommandWorldPoint\(event\);[\s\S]*pasteAtPos\(point\.x, point\.y\);[\s\S]*\}/);
  assert.match(contextMenuSource, /'obj-btn-duplicate': \(event\) => \{[\s\S]*const point = menuCommandWorldPoint\(event\);[\s\S]*duplicateSelected\(point\);[\s\S]*\}/);
  assert.match(contextMenuSource, /const MENU_COMMAND_UP_EVENT = HAS_POINTER_EVENTS \? 'pointerup' : 'mouseup';/);
  assert.match(contextMenuSource, /runMenuCommand\(button, MENU_COMMAND_UP_EVENT, e\);/);
  assert.match(contextMenuSource, /runMenuCommand\(event\.currentTarget, 'click', event\);/);
  assert.match(contextMenuSource, /function runAddImagesCommandFromShortcut\(\) \{ runMenuCommand\(addImageBtn, 'shortcut'\); \}/);
  assert.match(contextMenuSource, /function runAddTextCommandFromShortcut\(\) \{ runMenuCommand\(addTextBtn, 'shortcut'\); \}/);
  assert.doesNotMatch(contextMenuSource, /\bctxPos\b/);
});

test('pointerup menu commands keep user activation and suppress the follow-up click', () => {
  const context = loadMenuCommandHarness();
  const button = { id: 'btn-open' };
  const pointerEvent = { type: 'pointerup' };

  assert.equal(context.runMenuCommand(button, 'pointerup', pointerEvent), true);
  assert.deepEqual(context.calls, [pointerEvent]);
  assert.deepEqual(context.timers, []);

  assert.equal(context.runMenuCommand(button, 'click', { type: 'click', detail: 1 }), true);
  assert.deepEqual(context.calls, [pointerEvent]);

  const keyboardClick = { type: 'click', detail: 0 };
  assert.equal(context.runMenuCommand(button, 'click', keyboardClick), true);
  assert.deepEqual(context.calls, [pointerEvent, keyboardClick]);
});

test('text editing context menu uses text actions before object actions', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');
  const indexSource = readSource('src/index.html');

  assert.match(contextMenuSource, /if \(editingId && obj\?\.id === editingId\) \{\s*showTextEditContextMenuAt\(clientX, clientY\);\s*return;\s*\}/);

  const textMenuStart = indexSource.indexOf('<div id="text-ctx-menu">');
  assert.notEqual(textMenuStart, -1);
  const textMenuEnd = indexSource.indexOf('<input type="file"', textMenuStart);
  const textMenu = indexSource.slice(textMenuStart, textMenuEnd);
  assert.ok(textMenu.indexOf('id="text-btn-copy"') < textMenu.indexOf('id="text-btn-paste"'));
  assert.equal(textMenu.indexOf('id="text-btn-cut"'), -1);
  assert.ok(textMenu.indexOf('id="text-btn-paste"') < textMenu.indexOf('id="text-sep-delete"'));
  assert.ok(textMenu.indexOf('id="text-sep-delete"') < textMenu.indexOf('id="text-btn-delete"'));
});

test('opening the text editing context menu keeps Paste visible without reading the clipboard', () => {
  const context = loadTextEditMenuHarness();

  context.showTextEditContextMenuAt(24, 48);

  assert.equal(context.calls.clipboardReads, 0);
  assert.equal(context.textPasteBtn.style.display, '');
  assert.equal(context.textCopyBtn.style.display, 'none');
  assert.equal(context.textDeleteSep.style.display, 'none');
  assert.equal(context.textDeleteBtn.style.display, 'none');
  assert.equal(context.calls.opens.length, 1);
  assert.equal(context.calls.opens[0][0], context.textCtxMenu);
  assert.deepEqual(context.calls.opens[0].slice(1), ['text-ctx-menu', 24, 48, 'show-text-menu:edit']);
});

test('external text Paste starts its clipboard read before user activation expires', async () => {
  const context = loadTextEditPasteHarness();
  const activationExpires = Promise.resolve().then(() => {
    context.clipboardActivation = false;
  });

  const paste = context.pasteTextIntoEditSelection();
  await Promise.all([activationExpires, paste]);

  assert.deepEqual(context.calls.clipboardReadActivations, [true]);
  assert.equal(context.calls.internalPasteAttempts, 0);
  assert.equal(context.calls.replacements.length, 1);
  assert.equal(context.calls.replacements[0].text, 'external text');
  assert.equal(context.calls.replacements[0].options.immediateHistory, true);
  assert.equal(context.calls.replacements[0].options.inputType, 'insertFromPaste');
});

test('stale internal text candidate primes external fallback before user activation expires', async () => {
  const context = loadTextEditPasteHarness();
  context._jsClipboardWebMaybeStale = true;
  context.currentBoardfishTextSelectionClipboardPayload = () => ({
    type: 'text-selection',
    text: 'stale internal text',
  });
  const activationExpires = Promise.resolve().then(() => {
    context.clipboardActivation = false;
  });

  const paste = context.pasteTextIntoEditSelection();
  await Promise.all([activationExpires, paste]);

  assert.deepEqual(context.calls.clipboardReadActivations, [true]);
  assert.equal(context.calls.internalPasteAttempts, 1);
  assert.equal(context.calls.replacements.length, 1);
  assert.equal(context.calls.replacements[0].text, 'external text');
});

test('wheel zoom over visible floating UI uses the viewport wheel handler', () => {
  const inputSource = readSource('src/js/canvas_input.js');
  const selectionSource = readSource('src/js/selection_input.js');
  const viewportSource = readSource('src/js/viewport.js');
  const styles = readSource('src/styles.css');

  assert.match(inputSource, /function handleViewportWheel\(e\) \{\s*if \(!e\.ctrlKey && !e\.metaKey && !isEventInsideViewportWheelSurface\(e\)\) return;/);
  assert.match(inputSource, /window\.addEventListener\('wheel', handleViewportWheel, \{ capture: true, passive: false \}\);/);
  assert.doesNotMatch(inputSource, /canvas\.addEventListener\('wheel'/);
  assert.doesNotMatch(inputSource, /viewportWheelSurfaces/);
  assert.match(inputSource, /const requestedZoom = zoom \* factor;\s*if \(typeof BOARDFISH_PRODUCTION === 'undefined'\) scheduleTransform\(BoardfishViewportState\.zoomAroundClient\(e\.clientX, e\.clientY, requestedZoom\), 'wheel-zoom', e\);/);
  assert.match(viewportSource, /lastViewportInputAt = now;\s*if \(changed === false && !editingId\) return;/);
  assert.doesNotMatch(viewportSource, /scheduleViewportInputSettleRender/);
  assert.doesNotMatch(inputSource, /const newZoom = Math\.min\(ZOOM_MAX/);
  assert.match(selectionSource, /document\.elementFromPoint\(x, y\)/);
  assert.match(selectionSource, /if \(e\.target instanceof Node && e\.target\.nodeType === 1\) return false;/);
  assert.match(selectionSource, /const isEventInsideViewportWheelSurface = \(e\) => \{[\s\S]*canvas\.contains\(e\.target\)[\s\S]*isEventInsideVisibleContextMenu\(e\) \|\| isEventInsideVisibleSurface\(e, island\);[\s\S]*\};/);
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
  assert.match(styles, /:where\(\.ctx-item:focus-visible,\s*\.ctx-action-item:focus-visible\)\s*\{\s*--ui-highlight-nudge-transform: translateX\(var\(--highlight-nudge-x\)\);\s*\}/);
  assert.match(styles, /\.ctx-item:focus-visible\s*\{\s*background: var\(--firefox-menu-hover-bg\);\s*\}/);
  assert.match(styles, /\.ctx-action-item:focus-visible::before\s*\{\s*background: var\(--firefox-menu-hover-bg\);\s*\}/);
  assert.match(styles, /#dlg-discard:focus-visible\s*\{\s*background: var\(--danger-hover-bg\);\s*\}/);
  assert.doesNotMatch(styles, /#island:focus-visible #isl-zoom/);
});

test('hover effects are limited to hover-capable fine pointers', () => {
  const styles = readSource('src/styles.css');
  const hoverBlocks = cssBlocksForPrelude(styles, '@media (hover: hover) and (pointer: fine)');
  const gatedHoverStyles = hoverBlocks.join('\n');
  const occurrences = (source, pattern) => source.match(pattern)?.length || 0;

  assert.ok(hoverBlocks.length > 0);
  assert.equal(occurrences(gatedHoverStyles, /:hover/g), occurrences(styles, /:hover/g));
  assert.doesNotMatch(styles, /hotspot-hover/);
  assert.match(gatedHoverStyles, /\.ctx-item:hover/);
  assert.match(gatedHoverStyles, /\.ctx-action-item:hover::before/);
  assert.match(gatedHoverStyles, /#island:hover #isl-zoom/);
  assert.match(gatedHoverStyles, /#dlg-discard:hover/);
  assert.match(styles, /\.ctx-item\.menu-pressed\s*\{\s*background: var\(--menu-active-bg\);/);
  assert.doesNotMatch(styles, /\.ctx-item:active/);
  assert.match(styles, /#island:active #isl-zoom\s*\{\s*background: var\(--menu-active-bg\);/);
  assert.match(styles, /#dlg-discard:active\s*\{\s*background: var\(--danger-active-bg\);/);
});

test('context actions use native hover and explicit pressed state', () => {
  const source = readSource('src/js/context_menu.js');
  const styles = readSource('src/styles.css');
  const indexSource = readSource('src/index.html');

  assert.doesNotMatch(source, /isCtxActionHotspotEvent|updateCtxActionHotspotState|addEventListener\('pointermove'/);
  assert.match(source, /ctxActions\.addEventListener\('pointerdown',[\s\S]*button\.classList\.add\('hotspot-active'\);/);
  assert.match(source, /function clearCtxActionHotspotState\(\) \{[\s\S]*classList\.remove\('hotspot-active'\);[\s\S]*\}/);
  assert.match(source, /addEventListener\('pointerup', clearCtxActionHotspotState\)/);
  assert.match(source, /addEventListener\('pointerleave', clearCtxActionHotspotState\)/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.ctx-action-item:hover::before/);
  assert.match(styles, /\.ctx-action-item\.hotspot-active::before/);
  assert.match(styles, /#ctx-actions\.visible\s*\{[\s\S]*gap: 8px;/);
  assert.doesNotMatch(indexSource, /ctx-action-sep/);
});

test('menu rows clear explicit pressed state on release, cancellation, and close', () => {
  const source = readSource('src/js/context_menu.js');
  const styles = readSource('src/styles.css');

  assert.match(source, /button\.classList\.add\('menu-pressed'\);/);
  assert.match(source, /function clearMenuCommandPressState\(\) \{[\s\S]*classList\.remove\('menu-pressed'\);[\s\S]*_menuPointerCommand = null;[\s\S]*\}/);
  assert.doesNotMatch(source, /_menuMouseCommand/);
  assert.match(source, /function onMenuPointerUp\(e\) \{[\s\S]*clearMenuCommandPressState\(\);[\s\S]*e\.pointerType === 'touch'[\s\S]*started\.blur\?\.\(\);/);
  assert.match(source, /const MENU_COMMAND_CANCEL_EVENTS = HAS_POINTER_EVENTS[\s\S]*'pointercancel'[\s\S]*'pointerleave'[\s\S]*'lostpointercapture'[\s\S]*'mouseleave'/);
  assert.match(source, /menu\.addEventListener\(MENU_COMMAND_DOWN_EVENT, onMenuPointerDown\);[\s\S]*menu\.addEventListener\(MENU_COMMAND_UP_EVENT, onMenuPointerUp\);[\s\S]*MENU_COMMAND_CANCEL_EVENTS/);
  assert.match(source, /function closeObjCtxMenu\(reason\) \{[\s\S]*clearMenuCommandPressState\(\);[\s\S]*closeFloatingSurface\(objCtxMenu\);/);
  const coarseStyles = [
    ...cssBlocksForPrelude(styles, '@media (hover: none)'),
    ...cssBlocksForPrelude(styles, '@media (pointer: coarse)'),
  ].join('\n');
  assert.match(coarseStyles, /\.ctx-item:focus-visible\s*\{[\s\S]*background: transparent;/);
});

test('coarse pointers reuse the desktop context menu and island visual scale', () => {
  const styles = readSource('src/styles.css');
  const coarseStyles = cssBlocksForPrelude(styles, '@media (pointer: coarse)').join('\n');

  assert.match(styles, /--menu-item-height:\s*32px;/);
  assert.match(styles, /--menu-item-line-height:\s*32px;/);
  assert.match(styles, /--menu-item-padding:\s*0 8px;/);
  assert.match(styles, /--menu-item-font-size:\s*13px;/);
  assert.doesNotMatch(coarseStyles, /--menu-item-(height|line-height|padding|font-size):/);
  assert.match(styles, /#ctx-actions\s*\{[\s\S]*width: calc\(var\(--menu-item-height\) \+ \(var\(--menu-shell-padding\) \* 2\) \+ 2px\);[\s\S]*\}/);
  assert.match(styles, /\.ctx-action-item\s*\{[\s\S]*width: var\(--menu-item-height\);[\s\S]*height: var\(--menu-item-height\);[\s\S]*font: var\(--text-font-style\) var\(--regular_text\) var\(--menu-item-font-size\) var\(--text-font-family\);[\s\S]*\}/);
  assert.match(styles, /\.ctx-item\s*\{[\s\S]*height: var\(--menu-item-height\);[\s\S]*padding: var\(--menu-item-padding\);[\s\S]*font: var\(--text-font-style\) var\(--regular_text\) var\(--menu-item-font-size\) var\(--text-font-family\);[\s\S]*\}/);
  assert.match(styles, /#isl-zoom,\s*\.opening-shield-pill-text\s*\{[\s\S]*min-height: var\(--menu-item-height\);[\s\S]*padding: var\(--menu-item-padding\);[\s\S]*font: var\(--text-font-style\) var\(--regular_text\) var\(--menu-item-font-size\) var\(--text-font-family\);[\s\S]*\}/);
});

test('menu borders and separators share a secondary color while shortcuts use their own tone', () => {
  const styles = readSource('src/styles.css');

  assert.match(styles, /--menu-secondary-color:\s*#70707a;/);
  assert.match(styles, /--menu-shortcut-color:\s*#b8b8bc;/);
  assert.match(styles, /--firefox-menu-border:\s*var\(--menu-secondary-color\);/);
  assert.match(styles, /--firefox-menu-separator:\s*var\(--menu-secondary-color\);/);
  assert.match(styles, /\.ctx-shortcut\s*\{[\s\S]*color: var\(--menu-shortcut-color\);[\s\S]*\}/);
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
  assert.doesNotMatch(contextMenuSource, /document\.activeElement === island/);
});

test('text edit caret honors visual line preference at wrapped line start', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawCaret(context, obj, layout, selStart');
  const end = viewportSource.indexOf('function drawEditingTextOverlay', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = {
    _caretVisible: true,
    LINE_H: 24,
    TEXT_PAD: 16,
    TEXT_BASELINE_Y_OFFSET: 16,
    zoom: 1,
    canvasTextColor: () => '#111',
    lineCaretXAtOffset(line, obj, offset) {
      return obj.x + context.TEXT_PAD + offset * 10;
    },
    lineEndX(line, obj) {
      return obj.x + context.TEXT_PAD + line.text.length * 10;
    },
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
  const end = viewportSource.indexOf('function drawEditingTextOverlay', start);
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
    lineEndX(line, obj) {
      return obj.x + context.TEXT_PAD + line.text.length * 10;
    },
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
  const end = viewportSource.indexOf('function drawEditingTextOverlay', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = {
    _caretVisible: true,
    LINE_H: 24,
    TEXT_PAD: 16,
    TEXT_BASELINE_Y_OFFSET: 16,
    zoom: 1,
    canvasTextColor: () => '#111',
    lineCaretXAtOffset(line, obj, offset) {
      return obj.x + context.TEXT_PAD + offset * 10;
    },
    lineEndX(line, obj) {
      return obj.x + context.TEXT_PAD + line.text.length * 10;
    },
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
  assert.equal(context.drawCaret(canvasContext, obj, layout, 0, 0.25), true);
  assert.equal(context.drawCaret(canvasContext, obj, layout, 3, 0.25), true);
  assert.deepEqual(fillRects, [
    [26, 0, 8, 24],
    [26, 0, 8, 24],
  ]);
});

function loadDeviceCaretDrawingHarness() {
  const source = readSource('src/js/viewport.js');
  const start = source.indexOf('function drawCaret(context, obj, layout, selStart');
  const end = source.indexOf('function drawEditingTextOverlay', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return vm.runInNewContext(`${source.slice(start, end)}\ndrawCaret`, {
    LINE_H: 24,
    TEXT_PAD: 16,
    zoom: 1,
    lineCaretXAtOffset(line, obj, offset) { return obj.x + 16 + offset * 10.3; },
  });
}

test('text edit caret keeps a whole device-pixel width across display scales and moving origins', () => {
  const drawCaret = loadDeviceCaretDrawingHarness();
  const obj = { x: 10.13, y: 0, w: 120, h: 24 };
  const layout = [{ text: 'abc', startIndex: 0, endIndex: 3, y: 0.27 }];
  const before = JSON.stringify({ obj, layout });
  for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
    for (const viewZoom of [0.1, 0.25, 0.7, 1, 1.3, 2.75]) {
      for (const pan of [-3.75, -0.1, 0, 0.2, 0.5, 1.1]) {
        // Chrome's Canvas2D transform can round its scale to float32 precision.
        const scale = Math.fround(dpr * viewZoom);
        const transform = { a: scale, b: 0, c: 0, d: scale, e: pan * dpr, f: 0.37 * dpr };
        const previousTransform = { ...transform };
        const rectangles = [];
        const context = {
          getTransform: () => transform,
          fillRect(...rect) { rectangles.push(rect); },
        };
        for (const offset of [0, 1, 2, 3]) {
          assert.equal(drawCaret(context, obj, layout, offset, viewZoom), true);
        }
        for (const [x, y, width, height] of rectangles) {
          const pixelX = x * scale + transform.e;
          const pixelWidth = width * scale;
          assert.ok(Math.abs(pixelX - Math.round(pixelX)) < 1e-9, `fractional caret edge at ${dpr}/${viewZoom}/${pan}`);
          assert.ok(Math.abs(pixelWidth - Math.floor(2 * dpr)) < 1e-9, `changing caret width at ${dpr}/${viewZoom}/${pan}`);
          assert.equal(y, layout[0].y);
          assert.equal(height, 24);
        }
        assert.deepEqual(transform, previousTransform);
      }
    }
  }
  assert.equal(JSON.stringify({ obj, layout }), before);
});

test('pixel-aligned text edit caret remains inside narrow content at low zoom', () => {
  const drawCaret = loadDeviceCaretDrawingHarness();
  const obj = { x: 10.13, y: 0, w: 40, h: 24 };
  const layout = [{ text: 'abc', startIndex: 0, endIndex: 3, y: 0 }];
  for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
    for (const pan of [-3.75, -0.1, 0, 0.2, 0.5, 1.1]) {
      const viewZoom = 0.25;
      const scale = dpr * viewZoom;
      const transform = { a: scale, b: 0, c: 0, d: scale, e: pan * dpr, f: 0 };
      const left = Math.round((obj.x + 16) * scale + transform.e);
      const right = Math.round((obj.x + obj.w - 16) * scale + transform.e);
      const rectangles = [];
      const context = {
        getTransform: () => transform,
        fillRect(...rect) { rectangles.push(rect); },
      };
      drawCaret(context, obj, layout, 0, viewZoom);
      drawCaret(context, obj, layout, 3, viewZoom);
      for (const [x, , width] of rectangles) {
        const pixelX = x * scale + transform.e;
        assert.ok(pixelX >= left - 1e-9);
        assert.ok(pixelX + width * scale <= right + 1e-9);
        assert.ok(Math.abs(width * scale - Math.floor(2 * dpr)) < 1e-9);
      }
    }
  }
});

test('text edit overlay draws only visible layout lines', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawEditingTextOverlay');
  const end = viewportSource.indexOf('function drawBoard', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const overlaySource = viewportSource.slice(start, end);

  assert.match(overlaySource, /const layout = getTextLayoutForViewport\(obj, boardRenderer\.textViewportRect\(viewportRect,/);
  assert.doesNotMatch(overlaySource, /visibleTextLayoutLines/);
  assert.match(overlaySource, /editVisibleLines/);
  assert.match(overlaySource, /editCulledLines/);
  assert.match(overlaySource, /for \(const line of layout\)[\s\S]*drawTextLineRange\(context, line, obj/);
});

test('entering text edit sets the editing object before proxy setup', () => {
  const textEditorSource = readSource('src/js/text_editor.js');
  const start = textEditorSource.indexOf('function enterEdit');
  const end = textEditorSource.indexOf('function exitEdit', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const enterSource = textEditorSource.slice(start, end);
  const editingIndex = enterSource.indexOf('editingId = id;');
  const proxyIndex = enterSource.indexOf("document.createElement('textarea')");

  assert.ok(editingIndex >= 0, 'enterEdit must set editingId');
  assert.ok(proxyIndex > editingIndex, 'enterEdit must set editingId before proxy setup can focus or render');
  assert.match(enterSource, /scheduleRender\(true, true\)/, 'enterEdit must schedule its own render');
});

test('editing overlay draws the live selection and restores the caret when it collapses', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawTextSelectionHighlight');
  const end = viewportSource.indexOf('function drawBoard', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const obj = { id: 'text-a', type: 'text', x: 10, y: 20, w: 140, h: 80 };
  const layout = [
    { text: 'hello', startIndex: 0, endIndex: 5, y: 36 },
    { text: 'world', startIndex: 6, endIndex: 11, y: 60 },
  ];
  layout.totalLines = 5;
  const drawCalls = [];
  const context = {
    LINE_H: 24,
    TEXT_PAD: 16,
    VIEWPORT_TEXT_DRAW_STATS_DISABLED: {},
    objectsMap: new Map([[obj.id, obj]]),
    editingId: obj.id,
    _editEl: { selectionStart: 1, selectionEnd: 4 },
    _caretVisible: true,
    performance: { now: () => 100 },
    TextSelDebug: { _logDraw() {} },
    window: { devicePixelRatio: 1 },
    boardRenderer: { textViewportRect: rect => rect },
    getTextLayoutForViewport: () => layout,
    lineXAtOffset: (_line, object, offset) => object.x + 16 + offset * 8,
    lineCaretXAtOffset: (_line, object, offset) => object.x + 16 + offset * 8,
    drawTextLineRange(_context, line, _obj, from = 0, to = line.text.length) {
      drawCalls.push(['text', line.text, from, to]);
    },
  };
  vm.createContext(context);
  vm.runInContext(viewportSource.slice(start, end), context);
  const canvasContext = {
    save() {},
    restore() {},
    beginPath() {},
    rect(...args) { drawCalls.push(['selection', ...args]); },
    fill() {},
    fillRect(...args) { drawCalls.push(['caret', ...args]); },
  };
  const viewport = { x1: 0, y1: 0, x2: 500, y2: 100 };

  const selectedStats = context.drawEditingTextOverlay(canvasContext, 1, viewport, true);
  assert.deepEqual(drawCalls, [
    ['selection', 34, 36, 24, 24],
    ['text', 'hello', 0, 5],
    ['text', 'world', 0, 5],
  ]);
  assert.equal(selectedStats.editSelectionRuns, 1);
  assert.equal(selectedStats.editSelectedChars, 3);
  assert.equal(selectedStats.editDrawnTextLines, 2);
  assert.equal(selectedStats.editCulledLines, 3);
  assert.equal(selectedStats.editCaretDrawn, false);

  drawCalls.length = 0;
  context._editEl.selectionStart = 8;
  context._editEl.selectionEnd = 8;
  const caretStats = context.drawEditingTextOverlay(canvasContext, 1, viewport, true);
  assert.deepEqual(drawCalls, [
    ['text', 'hello', 0, 5],
    ['text', 'world', 0, 5],
    ['caret', 41, 60, 2, 24],
  ]);
  assert.equal(caretStats.editSelectionRuns, 0);
  assert.equal(caretStats.editCaretDrawn, true);
});

test('overlapping text selection highlight runs share one path fill', () => {
  const viewportSource = readSource('src/js/viewport.js');
  const start = viewportSource.indexOf('function drawTextSelectionHighlight');
  const end = viewportSource.indexOf('function drawCaret', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const layout = [
    { text: 'abcdefghij', startIndex: 0, x: 0, y: 0 },
    { text: 'abcdefghij', startIndex: 0, x: 20, y: 0 },
  ];
  const drawCalls = [];
  const context = {
    LINE_H: 24,
    lineXAtOffset: (line, _obj, offset) => line.x + offset * 4,
    TextSelDebug: { _logDraw() {} },
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

  context.drawTextSelectionHighlight(canvasContext, {}, layout, 0, 10);
  assert.deepEqual(drawCalls, [
    ['save'],
    ['beginPath'],
    ['rect', 0, 0, 40, 24],
    ['rect', 20, 0, 40, 24],
    ['fill'],
    ['restore'],
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
  assert.match(readSource('src/app.js'), /var unsavedDialog\s*= document\.getElementById\('dialog'\);/);
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
  assert.equal(documentWheel, undefined);

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
  assert.equal(context.debugEnd.objectId, image.id);
  assert.equal(context.debugEnd.objectType, 'image');
});
