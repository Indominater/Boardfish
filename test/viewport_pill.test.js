'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function createElement(id = 'el') {
  const attrs = new Map();
  const children = [];
  const classes = new Set();
  let textContentValue = '';
  let textContentWrites = 0;
  const el = {
    id,
    dataset: {},
    style: {},
    parentNode: null,
    children,
    get textContent() {
      return textContentValue;
    },
    set textContent(value) {
      textContentWrites += 1;
      textContentValue = String(value);
    },
    textContentWriteCount() {
      return textContentWrites;
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    remove() {
      if (!el.parentNode) return;
      const siblings = el.parentNode.children || [];
      const index = siblings.indexOf(el);
      if (index >= 0) siblings.splice(index, 1);
      el.parentNode = null;
    },
    querySelector(selector) {
      if (selector !== '.opening-shield-pill') return null;
      return children.find((child) => child.classList.contains('opening-shield-pill')) || null;
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    get firstElementChild() {
      return children[0] || null;
    },
  };
  el.classList = {
    add(...names) {
      for (const name of names) classes.add(name);
    },
    remove(...names) {
      for (const name of names) classes.delete(name);
    },
    contains(name) {
      return classes.has(name);
    },
    toggle(name, force) {
      const next = force === undefined ? !classes.has(name) : !!force;
      if (next) classes.add(name);
      else classes.delete(name);
      return next;
    },
  };
  Object.defineProperty(el, 'className', {
    get() {
      return [...classes].join(' ');
    },
    set(value) {
      classes.clear();
      for (const name of String(value).split(/\s+/).filter(Boolean)) classes.add(name);
    },
  });
  return el;
}

function loadViewportPillHarness() {
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'viewport.js'), 'utf8');
  const prefixEnd = source.indexOf('var _offscreen = document.createElement');
  assert.ok(prefixEnd > 0, 'viewport pill bootstrap section is missing');
  const openingShield = createElement('opening-shield');
  openingShield.classList.add('active', 'opening-freeze');
  const island = createElement('island');
  const islZoom = createElement('isl-zoom');
  const context = {
    console,
    document: {
      createElement: () => createElement(),
    },
    openingShield,
    island,
    islZoom,
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
    performance: {
      now: () => 0,
    },
    PillDebug: {
      log() {},
    },
  };

  vm.createContext(context);
  vm.runInContext(
    `${source.slice(0, prefixEnd)}\n` +
      'globalThis.showIslandMsg = showIslandMsg;\n' +
      'globalThis.startPillTask = startPillTask;\n' +
      'globalThis.updatePillTask = updatePillTask;\n' +
      'globalThis.syncIslandZoomDisplay = syncIslandZoomDisplay;\n',
    context,
    { filename: 'viewport.js' },
  );
  return context;
}

function loadViewportRenderSchedulerHarness({ selected = false, overlayVisible = false } = {}) {
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'viewport.js'), 'utf8');
  const functionStart = source.indexOf('function scheduleRender(');
  assert.ok(functionStart > 0, 'scheduleRender is missing');
  const functionEnd = source.indexOf('\n}', functionStart);
  assert.ok(functionEnd > functionStart, 'scheduleRender is unterminated');
  const scheduled = [];
  const context = {
    selected,
    scheduled,
    selOverlay: createElement('sel-overlay'),
    multiSelOverlay: createElement('multi-sel-overlay'),
    hasSelection() {
      return context.selected;
    },
    scheduleFrame(sourceName) {
      scheduled.push(sourceName);
    },
  };
  if (overlayVisible) context.selOverlay.classList.add('visible');
  vm.createContext(context);
  vm.runInContext(
    'var _needBoardRender = false;\n' +
      'var _needOverlayRender = false;\n' +
      'var _masterBounds = {};\n' +
      `${source.slice(functionStart, functionEnd + 2)}\n` +
      'globalThis.scheduleRender = scheduleRender;\n' +
      'globalThis.renderFlags = () => ({ board: _needBoardRender, overlay: _needOverlayRender });\n',
    context,
    { filename: 'viewport-render-scheduler.js' },
  );
  return context;
}

function loadViewportInputSettleHarness() {
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'viewport.js'), 'utf8');
  const functionStart = source.indexOf('function scheduleViewportInputSettleRender(');
  assert.ok(functionStart > 0, 'viewport input settle scheduler is missing');
  const functionEnd = source.indexOf('\n}', functionStart);
  assert.ok(functionEnd > functionStart, 'viewport input settle scheduler is unterminated');
  let now = 1000;
  const timers = [];
  const renders = [];
  let invalidations = 0;
  const context = {
    _boardOpening: false,
    lastViewportInputAt: now,
    performance: { now: () => now },
    setTimeout(callback, ms) {
      timers.push({ callback, ms });
      return timers.length;
    },
    invalidateOffscreen() {
      invalidations++;
    },
    scheduleRender(...args) {
      renders.push(args);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    'const VIEWPORT_INPUT_SETTLE_MS = 180;\n' +
      'var _viewportInputSettleRenderTimer = null;\n' +
      `${source.slice(functionStart, functionEnd + 2)}\n` +
      'globalThis.scheduleViewportInputSettleRender = scheduleViewportInputSettleRender;\n',
    context,
    { filename: 'viewport-input-settle.js' },
  );
  return {
    context,
    timers,
    renders,
    invalidations: () => invalidations,
    setNow(value) {
      now = value;
    },
  };
}

function loadBoardCanvasQualityRestoreHarness() {
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'viewport.js'), 'utf8');
  const functionStart = source.indexOf('function restoreBoardCanvasQualityIfSettled()');
  const functionEnd = source.indexOf('\n}\n\n/* BOARDFISH_DEV_DIAGNOSTICS_START */', functionStart);
  assert.ok(functionStart > 0, 'canvas quality restore function is missing');
  assert.ok(functionEnd > functionStart, 'canvas quality restore function is unterminated');
  const renders = [];
  let activeInput = false;
  let activeMotion = false;
  let invalidations = 0;
  const context = {
    BoardfishMotion: {
      hasActiveMotionsForDraw: () => activeMotion,
    },
    isActiveViewportInput: () => activeInput,
    invalidateOffscreen: () => invalidations++,
    scheduleRender: (...args) => renders.push(args),
  };
  vm.createContext(context);
  vm.runInContext(
    'var _lastBoardFrameLowLatency = false;\n' +
      `${source.slice(functionStart, functionEnd + 2)}\n` +
      'globalThis.restoreBoardCanvasQualityIfSettled = restoreBoardCanvasQualityIfSettled;\n' +
      'globalThis.setLastFrameLowLatency = value => { _lastBoardFrameLowLatency = value; };\n',
    context,
    { filename: 'viewport-quality-restore.js' },
  );
  return {
    context,
    renders,
    invalidations: () => invalidations,
    setActiveInput(value) { activeInput = value; },
    setActiveMotion(value) { activeMotion = value; },
  };
}

function loadViewportCanvasSizeHarness({
  rect = { width: 1660, height: 1080 },
  clientWidth = 1660,
  clientHeight = 1080,
  innerWidth = 1660,
  innerHeight = 1030,
  dpr = 2,
} = {}) {
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'viewport.js'), 'utf8');
  const geometrySource = fs.readFileSync(path.join(root, 'src', 'js', 'geometry.js'), 'utf8');
  const sectionStart = source.indexOf('var _canvasResizeObserver = null;');
  assert.ok(sectionStart > 0, 'canvas size tracking state is missing');
  const viewportRectEnd = source.indexOf('\nconst collectTextSelectionRuns', sectionStart);
  assert.ok(viewportRectEnd > sectionStart, 'viewport rectangle section is unterminated');
  const fallbackReads = { clientWidth: 0, clientHeight: 0, innerWidth: 0, innerHeight: 0 };
  const backingWrites = { width: 0, height: 0 };
  let backingWidth = innerWidth * dpr;
  let backingHeight = innerHeight * dpr;
  const boardCanvas = {
    get width() {
      return backingWidth;
    },
    set width(value) {
      backingWrites.width++;
      backingWidth = value;
    },
    get height() {
      return backingHeight;
    },
    set height(value) {
      backingWrites.height++;
      backingHeight = value;
    },
    get clientWidth() {
      fallbackReads.clientWidth++;
      return clientWidth;
    },
    get clientHeight() {
      fallbackReads.clientHeight++;
      return clientHeight;
    },
  };
  const context = {
    surfaceRect: { ...rect },
    surfaceRectReads: 0,
    canvas: {
      getBoundingClientRect() {
        context.surfaceRectReads++;
        return context.surfaceRect;
      },
    },
    boardCanvas,
    backingWrites,
    fallbackReads,
    invalidations: 0,
    renders: [],
    observedTargets: [],
    resizeObserverInstances: 0,
    visualViewportListeners: [],
    windowResizeListeners: [],
    invalidateOffscreen() {
      context.invalidations++;
    },
    scheduleRender(board, overlay) {
      context.renders.push({ board, overlay });
    },
    ResizeObserver: class ResizeObserver {
      constructor(callback) {
        context.resizeObserverInstances++;
        context.resizeObserverCallback = callback;
      }
      observe(target) {
        context.observedTargets.push(target);
      }
    },
    window: {
      get innerWidth() {
        fallbackReads.innerWidth++;
        return innerWidth;
      },
      get innerHeight() {
        fallbackReads.innerHeight++;
        return innerHeight;
      },
      devicePixelRatio: dpr,
      visualViewport: {
        addEventListener(type, listener) {
          context.visualViewportListeners.push({ type, listener });
        },
      },
      addEventListener(type, listener) {
        if (type === 'resize' && !context.windowResizeListeners.includes(listener)) {
          context.windowResizeListeners.push(listener);
        }
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    'var panX = 0, panY = 0, zoom = 1;\n' +
      `${geometrySource}\n` +
      `${source.slice(sectionStart, viewportRectEnd)}\n` +
      'globalThis.resizeCanvas = resizeCanvas;\n' +
      'globalThis.boardCanvasRenderDpr = boardCanvasRenderDpr;\n' +
      'globalThis.syncBoardCanvasBackingStore = syncBoardCanvasBackingStore;\n' +
      'globalThis.startCanvasSizeTracking = startCanvasSizeTracking;\n',
    context,
    { filename: 'viewport-canvas-size.js' },
  );
  return context;
}

test('opening shield pill text mirrors the zoom pill visual motion surface', () => {
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

  assert.match(styles, /--pill-radius:\s*999px;/);
  assert.match(styles, /--menu-item-radius:\s*var\(--pill-radius\);/);
  assert.match(styles, /--pill-text-line-height:\s*18px;/);
  assert.match(styles, /--pill-text-min-width:\s*44px;/);
  assert.match(styles, /--pill-text-max-width:\s*min\(680px, calc\(100vw - 56px\)\);/);
  for (const selector of ['#island', '.opening-shield-pill', '#isl-zoom,\n.opening-shield-pill-text']) {
    const start = styles.lastIndexOf(`\n${selector} {`);
    assert.notEqual(start, -1, `${selector} style block is missing`);
    const end = styles.indexOf('\n}', start);
    assert.notEqual(end, -1, `${selector} style block is unterminated`);
    const block = styles.slice(start, end);
    assert.match(block, /border-radius: var\(--pill-radius\);/);
    if (selector === '#island' || selector === '.opening-shield-pill') continue;
    assert.match(block, /line-height: var\(--pill-text-line-height\);/);
    assert.match(block, /min-width: var\(--pill-text-min-width\);/);
    assert.match(block, /max-width: var\(--pill-text-max-width\);/);
    assert.match(block, /transform: var\(--ui-highlight-nudge-transform\);/);
    assert.match(block, /transition:\s*[\s\S]*background-color var\(--smooth-slide-duration\) var\(--smooth-slide-ease\),[\s\S]*color var\(--smooth-slide-duration\) var\(--smooth-slide-ease\),[\s\S]*transform var\(--smooth-slide-duration\) var\(--smooth-slide-ease\);/);
  }
  assert.match(styles, /\.opening-shield-pill-text\s*\{[\s\S]*--ui-highlight-nudge-transform: translateX\(0\);/);
});

test('pill messages update without redundant text writes', () => {
  const context = loadViewportPillHarness();

  context.showIslandMsg('Saved');
  assert.equal(context.islZoom.textContent, 'Saved');
  assert.equal(context.island.dataset.mode, 'message');
  assert.equal(context.island.title, '');

  context.showIslandMsg('Saved');

  context.showIslandMsg('Copied');
  assert.equal(context.islZoom.textContent, 'Copied');
});

test('busy pill progress updates in place', () => {
  const context = loadViewportPillHarness();
  const busyPill = context.startPillTask({ message: '0/2', progress: true });

  context.updatePillTask(busyPill, '0/2');

  context.updatePillTask(busyPill, '1/2');

  const openingPill = context.openingShield.querySelector('.opening-shield-pill');
  assert.equal(openingPill.firstElementChild.textContent, '1/2');
  assert.equal(openingPill.classList.contains('visible'), true);
});

test('zoom pill sync skips unchanged text writes', () => {
  const context = loadViewportPillHarness();
  assert.equal(context.islZoom.textContent, '100%');
  assert.equal(context.island.dataset.mode, 'zoom');
  assert.equal(context.island.title, 'Reset Zoom');

  const writesAfterInit = context.islZoom.textContentWriteCount();
  context.syncIslandZoomDisplay('same-zoom');
  assert.equal(context.islZoom.textContentWriteCount(), writesAfterInit);

  context.zoom = 2;
  context.syncIslandZoomDisplay('zoom-changed');
  assert.equal(context.islZoom.textContent, '200%');
  assert.equal(context.islZoom.textContentWriteCount(), writesAfterInit + 1);
});

test('automatic board refreshes sync active overlays while explicit false opts out', () => {
  for (const options of [
    { selected: true, overlayVisible: false },
    { selected: false, overlayVisible: true },
  ]) {
    const context = loadViewportRenderSchedulerHarness(options);
    context.scheduleRender(true, null, 'image-scale-variant-batch-1');
    assert.equal(context.renderFlags().board, true);
    assert.equal(context.renderFlags().overlay, true);
    assert.deepEqual(context.scheduled, ['image-scale-variant-batch-1']);
  }

  const idle = loadViewportRenderSchedulerHarness();
  idle.scheduleRender(true, null, 'background-refresh');
  assert.equal(idle.renderFlags().board, true);
  assert.equal(idle.renderFlags().overlay, false);

  const optedOut = loadViewportRenderSchedulerHarness({ selected: true });
  optedOut.scheduleRender(true, false, 'text-only-refresh');
  assert.equal(optedOut.renderFlags().overlay, false);
});

test('viewport input settles once after the latest gesture sample and restores a full-quality frame', () => {
  const harness = loadViewportInputSettleHarness();

  harness.context.scheduleViewportInputSettleRender();
  harness.context.scheduleViewportInputSettleRender();
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].ms, 180);

  harness.context.lastViewportInputAt = 1100;
  harness.setNow(1180);
  harness.timers[0].callback();
  assert.equal(harness.renders.length, 0);
  assert.equal(harness.timers.length, 2);
  assert.equal(harness.timers[1].ms, 100);

  harness.setNow(1280);
  harness.timers[1].callback();
  assert.equal(harness.invalidations(), 1);
  assert.deepEqual(harness.renders, [[true, null, 'viewport-input-settled']]);
});

test('a low-latency frame restores once input settles even while copy motion is active', () => {
  const harness = loadBoardCanvasQualityRestoreHarness();
  const { context } = harness;

  context.restoreBoardCanvasQualityIfSettled();
  assert.equal(harness.invalidations(), 0);

  context.setLastFrameLowLatency(true);
  harness.setActiveInput(true);
  context.restoreBoardCanvasQualityIfSettled();
  harness.setActiveInput(false);
  harness.setActiveMotion(true);
  context.restoreBoardCanvasQualityIfSettled();
  context.restoreBoardCanvasQualityIfSettled();
  assert.equal(harness.invalidations(), 1);
  assert.deepEqual(harness.renders, [[true, null, 'low-latency-frame-settled']]);
});

test('canvas resize keeps visible pixels until the render frame syncs the backing store', () => {
  const context = loadViewportCanvasSizeHarness();

  assert.equal(context.resizeCanvas(), true);
  assert.equal(context.boardCanvas.width, 3320);
  assert.equal(context.boardCanvas.height, 2060);
  assert.deepEqual(context.backingWrites, { width: 0, height: 0 });
  assert.equal(context.invalidations, 0);
  assert.deepEqual(context.renders, [{ board: true, overlay: undefined }]);
  assert.deepEqual(context.fallbackReads, { clientWidth: 0, clientHeight: 0, innerWidth: 0, innerHeight: 0 });

  assert.equal(context.syncBoardCanvasBackingStore(), true);
  assert.equal(context.boardCanvas.width, 3320);
  assert.equal(context.boardCanvas.height, 2160);
  assert.deepEqual(context.backingWrites, { width: 0, height: 1 });
  assert.equal(context.invalidations, 1);

  assert.equal(context.resizeCanvas(), false);
  assert.equal(context.invalidations, 1);
  assert.deepEqual(context.renders, [{ board: true, overlay: undefined }]);
});

test('active viewport frames cap only backing resolution and restore native DPR', () => {
  const context = loadViewportCanvasSizeHarness({
    rect: { width: 390, height: 844 },
    clientWidth: 390,
    clientHeight: 844,
    innerWidth: 390,
    innerHeight: 844,
    dpr: 3,
  });

  assert.equal(context.boardCanvasRenderDpr(false), 3);
  assert.equal(context.boardCanvasRenderDpr(true), 1.5);
  assert.equal(context.syncBoardCanvasBackingStore(true, context.boardCanvasRenderDpr(true)), true);
  assert.equal(context.boardCanvas.width, 585);
  assert.equal(context.boardCanvas.height, 1266);

  assert.equal(context.syncBoardCanvasBackingStore(), true);
  assert.equal(context.boardCanvas.width, 1170);
  assert.equal(context.boardCanvas.height, 2532);

  context.window.devicePixelRatio = 1;
  assert.equal(context.boardCanvasRenderDpr(true), 1);
});

test('canvas size tracking observes the rendered surface exactly once', () => {
  const context = loadViewportCanvasSizeHarness({
    rect: { width: 1660, height: 1030 },
    clientHeight: 1030,
  });

  context.startCanvasSizeTracking();
  context.startCanvasSizeTracking();

  assert.equal(context.resizeObserverInstances, 1);
  assert.equal(context.observedTargets.length, 1);
  assert.strictEqual(context.observedTargets[0], context.canvas);
  assert.equal(context.visualViewportListeners.length, 0);
  assert.equal(context.windowResizeListeners.length, 1);

  context.surfaceRect.height = 1080;
  context.resizeObserverCallback([{ contentRect: context.surfaceRect }]);
  assert.equal(context.boardCanvas.height, 2060);
  assert.deepEqual(context.backingWrites, { width: 0, height: 0 });
  assert.equal(context.invalidations, 0);
  assert.deepEqual(context.renders, [{ board: true, overlay: undefined }]);

  assert.equal(context.syncBoardCanvasBackingStore(), true);
  assert.equal(context.boardCanvas.height, 2160);
  assert.deepEqual(context.backingWrites, { width: 0, height: 1 });
  assert.equal(context.invalidations, 1);
});

test('window resize preserves observed CSS size while refreshing DPR backing dimensions', () => {
  const context = loadViewportCanvasSizeHarness({
    rect: { width: 100, height: 100 },
    clientWidth: 100,
    clientHeight: 100,
    innerWidth: 100,
    innerHeight: 100,
    dpr: 2,
  });
  assert.equal(context.resizeCanvas(), false);
  context.startCanvasSizeTracking();
  assert.equal(context.surfaceRectReads, 1);

  context.window.devicePixelRatio = 3;
  context.windowResizeListeners[0]({ type: 'resize' });
  assert.equal(context.surfaceRectReads, 1);
  assert.deepEqual(context.renders, [{ board: true, overlay: undefined }]);

  assert.equal(context.syncBoardCanvasBackingStore(), true);
  assert.equal(context.boardCanvas.width, 300);
  assert.equal(context.boardCanvas.height, 300);
});

test('keyboard-style resize bursts apply only the latest backing-store height', () => {
  const context = loadViewportCanvasSizeHarness({
    rect: { width: 390, height: 500 },
    clientWidth: 390,
    clientHeight: 500,
    innerWidth: 390,
    innerHeight: 500,
    dpr: 2,
  });
  context.startCanvasSizeTracking();

  for (const height of [620, 730, 844]) {
    context.resizeObserverCallback([{ contentRect: { width: 390, height } }]);
  }

  assert.equal(context.boardCanvas.width, 780);
  assert.equal(context.boardCanvas.height, 1000);
  assert.deepEqual(context.backingWrites, { width: 0, height: 0 });
  assert.equal(context.invalidations, 0);
  assert.equal(context.renders.length, 3);

  assert.equal(context.syncBoardCanvasBackingStore(), true);
  assert.equal(context.boardCanvas.width, 780);
  assert.equal(context.boardCanvas.height, 1688);
  assert.deepEqual(context.backingWrites, { width: 0, height: 1 });
  assert.equal(context.invalidations, 1);
});

test('viewport culling follows the observed board surface while keyboard geometry settles', () => {
  const context = loadViewportCanvasSizeHarness({
    rect: { width: 390, height: 844 },
    clientWidth: 390,
    clientHeight: 844,
    innerWidth: 390,
    innerHeight: 500,
    dpr: 2,
  });

  const visibleWorld = context.viewportWorldRect();
  assert.equal(visibleWorld.x2, 390);
  assert.equal(visibleWorld.y2, 844);
  assert.equal(
    context.objectIntersectsRect({ type: 'image', x: 20, y: 700, w: 80, h: 80 }, visibleWorld),
    true,
  );
});
