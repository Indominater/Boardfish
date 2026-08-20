'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('viewport panning stops at the masterbox on all four sides', () => {
  const objects = [
    { type: 'image', x: 100, y: 200, w: 300, h: 400 },
    { type: 'text', x: -50, y: 50, w: 25, h: 25 },
    { type: 'shape', x: -1000, y: -1000, w: 2000, h: 2000 },
    { type: 'text', x: Number.NaN, y: 0, w: 10, h: 10 },
  ];
  const surface = { width: 1000, height: 800 };
  const zoom = 2;

  const towardTopLeft = applyViewportState({ objects, zoom }, 'setPan', 100000, 100000);
  assert.equal(towardTopLeft.panX, 1100);
  assert.equal(towardTopLeft.panY, 700);

  const towardBottomRight = applyViewportState({ objects, zoom }, 'setPan', -100000, -100000);
  assert.equal(towardBottomRight.panX, -800);
  assert.equal(towardBottomRight.panY, -1200);

  assert.equal((-towardTopLeft.panX + surface.width) / zoom, -50);
  assert.equal(-towardBottomRight.panX / zoom, 400);
  assert.equal((-towardTopLeft.panY + surface.height) / zoom, 50);
  assert.equal(-towardBottomRight.panY / zoom, 600);
});

test('viewport panning remains unchanged inside the limits and on an empty board', () => {
  const viewport = { panX: 12, panY: -34, zoom: 1.25 };
  const objects = [{ type: 'text', x: 0, y: 0, w: 100, h: 100 }];

  assert.deepEqual(applyViewportState({ objects }, 'setViewport', viewport), viewport);
  assert.deepEqual(applyViewportState({}, 'setViewport', viewport), viewport);
});

test('invalid zoom-pan input retains the viewport', () => {
  const viewport = { panX: 12, panY: -34, zoom: 1.25 };
  assert.deepEqual(applyViewportState(viewport, 'setZoomPan', NaN, NaN, Infinity), viewport);
});

test('a masterbox edge permits only the direction that returns toward the board', () => {
  const objects = [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }];
  const cases = [
    [{ panX: 900, panY: 0, zoom: 1 }, { panX: 850, panY: 100 }, { panX: 850, panY: 0, zoom: 1 }],
    [{ panX: -400, panY: 0, zoom: 1 }, { panX: -350, panY: 100 }, { panX: -350, panY: 0, zoom: 1 }],
    [{ panX: 0, panY: 600, zoom: 1 }, { panX: 100, panY: 550 }, { panX: 0, panY: 550, zoom: 1 }],
    [{ panX: 0, panY: -600, zoom: 1 }, { panX: 100, panY: -550 }, { panX: 0, panY: -550, zoom: 1 }],
  ];

  for (const [current, proposed, expected] of cases) {
    assert.deepEqual(applyViewportState({ objects, ...current }, 'setPan', proposed.panX, proposed.panY), expected);
  }
});

test('a masterbox corner permits both inward recovery directions and no others', () => {
  const objects = [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }];
  const current = { panX: 900, panY: 600, zoom: 1 };

  assert.deepEqual(
    applyViewportState({ objects, ...current }, 'setPan', 850, 550),
    { panX: 850, panY: 550, zoom: 1 },
  );
  assert.deepEqual(
    applyViewportState({ objects, ...current }, 'setPan', 950, 550),
    { panX: 900, panY: 550, zoom: 1 },
  );
});

function loadViewportStateHarness({
  objects = [],
  panX = 0,
  panY = 0,
  zoom = 1,
  width = 1000,
  height = 800,
  dpr = 1,
} = {}) {
  const geometry = fs.readFileSync(path.join(root, 'src/js/geometry.js'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src/js/viewport_state.js'), 'utf8');
  const context = {
    console,
    devicePixelRatio: dpr,
    boardCanvas: { width: width * dpr, height: height * dpr },
    boardSurfaceCssSize: () => ({ width, height }),
    objects,
  };
  vm.createContext(context);
  vm.runInContext(
    `var panX = ${panX}; var panY = ${panY}; var zoom = ${zoom};\n` +
      `${geometry}\n${source}\n` +
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

test('wheel and drag state methods share the same constrained pan path', () => {
  const context = loadViewportStateHarness({
    objects: [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }],
  });

  assert.equal(context.BoardfishViewportState.panBy(100000, -100000), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 900, panY: -600, zoom: 1 });

  assert.equal(context.BoardfishViewportState.setPan(-100000, 100000), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: -400, panY: 600, zoom: 1 });
});

test('zooming around a client point keeps its world-space anchor fixed', () => {
  const context = loadViewportStateHarness({ panX: 10, panY: 20, zoom: 2 });
  assert.equal(context.BoardfishViewportState.zoomAroundClient(110, 220, 4), true);

  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: -90, panY: -180, zoom: 4 });
});

test('viewport rendering has no mobile-only transform preview branch', () => {
  const viewportSource = fs.readFileSync(path.join(root, 'src/js/viewport.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

  assert.doesNotMatch(viewportSource, /BoardfishViewportPreview|viewportTransformPreview|touch-pinch-preview/);
  assert.doesNotMatch(styles, /viewport-transform-preview/);
  assert.match(viewportSource, /function applyTransform\([\s\S]*drawBoard\(true\)/);
});

test('pan state stays fully locked at an edge until movement returns toward the board', () => {
  const context = loadViewportStateHarness({
    objects: [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }],
    panX: 900,
    panY: 0,
  });

  assert.equal(context.BoardfishViewportState.panBy(50, 75), false);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 900, panY: 0, zoom: 1 });

  assert.equal(context.BoardfishViewportState.panBy(-25, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 875, panY: 0, zoom: 1 });

  assert.equal(context.BoardfishViewportState.panBy(0, 75), true);
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: 875, panY: 75, zoom: 1 });
});
