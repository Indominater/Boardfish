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
      `${source.slice(functionStart, functionEnd + 2)}\n` +
      'globalThis.scheduleRender = scheduleRender;\n' +
      'globalThis.renderFlags = () => ({ board: _needBoardRender, overlay: _needOverlayRender });\n',
    context,
    { filename: 'viewport-render-scheduler.js' },
  );
  return context;
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
  const sectionStart = source.indexOf('var _canvasResizeObserver = null;');
  assert.ok(sectionStart > 0, 'canvas size tracking state is missing');
  const sectionEnd = source.indexOf('\nvar VIEWPORT_CULL_PADDING_PX', sectionStart);
  assert.ok(sectionEnd > sectionStart, 'canvas size tracking section is unterminated');
  const fallbackReads = { clientWidth: 0, clientHeight: 0, innerWidth: 0, innerHeight: 0 };
  const boardCanvas = {
    width: innerWidth * dpr,
    height: innerHeight * dpr,
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
    canvas: {
      getBoundingClientRect() {
        return context.surfaceRect;
      },
    },
    boardCanvas,
    fallbackReads,
    invalidations: 0,
    renders: [],
    observedTargets: [],
    resizeObserverInstances: 0,
    visualViewportListeners: [],
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
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(sectionStart, sectionEnd)}\n` +
      'globalThis.resizeCanvas = resizeCanvas;\n' +
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

test('canvas backing store follows the rendered surface instead of stale window dimensions', () => {
  const context = loadViewportCanvasSizeHarness();

  assert.equal(context.resizeCanvas(), true);
  assert.equal(context.boardCanvas.width, 3320);
  assert.equal(context.boardCanvas.height, 2160);
  assert.equal(context.invalidations, 1);
  assert.deepEqual(context.renders, [{ board: true, overlay: undefined }]);
  assert.deepEqual(context.fallbackReads, { clientWidth: 0, clientHeight: 0, innerWidth: 0, innerHeight: 0 });

  assert.equal(context.resizeCanvas(), false);
  assert.equal(context.invalidations, 1);
  assert.deepEqual(context.renders, [{ board: true, overlay: undefined }]);
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

  context.surfaceRect.height = 1080;
  context.resizeObserverCallback([{ contentRect: context.surfaceRect }]);
  assert.equal(context.boardCanvas.height, 2160);
  assert.equal(context.invalidations, 1);
  assert.deepEqual(context.renders, [{ board: true, overlay: undefined }]);
});
