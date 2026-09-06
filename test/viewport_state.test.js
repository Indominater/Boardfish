'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('viewport panning accepts large offsets in every direction', () => {
  const zoom = 2;

  const towardTopLeft = applyViewportState({ zoom }, 'setPan', 100000, 100000);
  assert.deepEqual(towardTopLeft, { panX: 100000, panY: 100000, zoom });

  const towardBottomRight = applyViewportState({ zoom }, 'setPan', -100000, -100000);
  assert.deepEqual(towardBottomRight, { panX: -100000, panY: -100000, zoom });
});

test('viewport state accepts an explicit pan and zoom', () => {
  const viewport = { panX: 12, panY: -34, zoom: 1.25 };

  assert.deepEqual(applyViewportState({}, 'setViewport', viewport), viewport);
});

test('invalid zoom-pan input retains the viewport', () => {
  const viewport = { panX: 12, panY: -34, zoom: 1.25 };
  assert.deepEqual(applyViewportState(viewport, 'setZoomPan', NaN, NaN, Infinity), viewport);
});

function loadViewportStateHarness({
  panX = 0,
  panY = 0,
  zoom = 1,
} = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/viewport_state.js'), 'utf8');
  const context = { console, BoardfishBoardTypes: require('../src/js/board_types.js') };
  vm.createContext(context);
  vm.runInContext(
    `var panX = ${panX}; var panY = ${panY}; var zoom = ${zoom};\n` +
      `${source}\n` +
      'globalThis.viewportSnapshot = () => ({ panX, panY, zoom });\n',
    context,
    { filename: 'viewport_state.js' },
  );
  return context;
}

function applyViewportState(options, method, ...args) {
  const context = loadViewportStateHarness(options);
  context.BoardfishViewportState[method](...args);
  return { ...context.viewportSnapshot() };
}

test('wheel and drag state methods share the same unrestricted pan path', () => {
  const context = loadViewportStateHarness();

  assert.equal(context.BoardfishViewportState.panBy(100000, -100000), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 100000, panY: -100000, zoom: 1 });

  assert.equal(context.BoardfishViewportState.setPan(-100000, 100000), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: -100000, panY: 100000, zoom: 1 });
});

test('zooming around a client point keeps its world-space anchor fixed', () => {
  const context = loadViewportStateHarness({ panX: 10, panY: 20, zoom: 2 });
  assert.equal(context.BoardfishViewportState.zoomAroundClient(110, 220, 4), true);

  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: -90, panY: -180, zoom: 4 });
});

test('every explicit viewport setter clamps zoom to 10 through 1000 percent', () => {
  for (const [requested, expected] of [[-1, 0.1], [0.01, 0.1], [0.1, 0.1], [10, 10], [100, 10]]) {
    const viewport = { panX: 12, panY: -34, zoom: expected };
    assert.deepEqual(applyViewportState({}, 'setViewport', { ...viewport, zoom: requested }), viewport);
    assert.deepEqual(applyViewportState({}, 'setZoomPan', requested, 12, -34), viewport);
  }
});

test('zoom endpoints preserve the cursor anchor and repeated clamped input is a no-op', () => {
  const clientX = 110.25, clientY = 220.75;
  for (const [requested, expected] of [[0.001, 0.1], [100, 10]]) {
    const initial = { panX: 10.125, panY: 20.625, zoom: 2 };
    const context = loadViewportStateHarness(initial);
    assert.equal(context.BoardfishViewportState.zoomAroundClient(clientX, clientY, requested), true);
    const bounded = { ...context.viewportSnapshot() };
    assert.equal(bounded.zoom, expected);
    assert.ok(Math.abs((clientX - bounded.panX) / expected - (clientX - initial.panX) / initial.zoom) < 1e-10);
    assert.ok(Math.abs((clientY - bounded.panY) / expected - (clientY - initial.panY) / initial.zoom) < 1e-10);
    assert.equal(context.BoardfishViewportState.zoomAroundClient(clientX, clientY, requested), false);
    assert.deepEqual({ ...context.viewportSnapshot() }, bounded);
  }
});

test('invalid cursor zoom input leaves the viewport unchanged', () => {
  const initial = { panX: 12.125, panY: -34.625, zoom: 1.25 };
  for (const requested of [NaN, Infinity, -Infinity, undefined]) {
    const context = loadViewportStateHarness(initial);
    assert.equal(context.BoardfishViewportState.zoomAroundClient(110, 220, requested), false);
    assert.deepEqual({ ...context.viewportSnapshot() }, initial);
  }
});

test('viewport rendering uses one native-quality branch on every platform', () => {
  const viewportSource = fs.readFileSync(path.join(root, 'src/js/viewport.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

  assert.doesNotMatch(viewportSource, /BoardfishViewportPreview|viewportTransformPreview|touch-pinch-preview/);
  assert.doesNotMatch(styles, /viewport-transform-preview/);
  assert.match(viewportSource, /function applyTransform\([\s\S]*drawBoard\(true\)/);
  assert.match(viewportSource, /function scheduleTransform\([\s\S]*lastViewportInputAt = now;[\s\S]*scheduleFrame/);
  assert.doesNotMatch(viewportSource, /scheduleViewportInputSettleRender|restoreBoardCanvasQualityIfSettled/);
  assert.doesNotMatch(viewportSource, /isViewportInputActive: isActiveViewportInput/);
  assert.doesNotMatch(viewportSource, /lowLatencyFrame|boardCanvasRenderDpr|INTERACTIVE_CANVAS_DPR_MAX/);
  assert.match(viewportSource, /function syncBoardCanvasBackingStore\(write = true\) \{\s*const dpr = window\.devicePixelRatio \|\| 1;/);
});

test('panning continues in every direction after a large prior offset', () => {
  const context = loadViewportStateHarness({
    panX: 900,
    panY: 0,
  });

  assert.equal(context.BoardfishViewportState.panBy(50, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 950, panY: 75, zoom: 1 });

  assert.equal(context.BoardfishViewportState.panBy(-25, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 925, panY: 150, zoom: 1 });

  assert.equal(context.BoardfishViewportState.panBy(0, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 925, panY: 225, zoom: 1 });
});
