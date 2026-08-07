'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const {
  boardMasterBox,
  clampPanToBoardMasterBox,
} = require('../src/js/viewport_state.js');

test('board masterbox uses the outermost edges of every image and text box', () => {
  const bounds = boardMasterBox([
    { type: 'image', x: 100, y: 200, w: 300, h: 400 },
    { type: 'text', x: -50, y: 50, w: 25, h: 25 },
    { type: 'shape', x: -1000, y: -1000, w: 2000, h: 2000 },
    { type: 'text', x: Number.NaN, y: 0, w: 10, h: 10 },
  ]);

  assert.deepEqual(bounds, {
    x1: -50,
    y1: 50,
    x2: 400,
    y2: 600,
    count: 2,
  });
});

test('viewport panning stops at the masterbox on all four sides', () => {
  const objects = [
    { type: 'image', x: 100, y: 200, w: 300, h: 400 },
    { type: 'text', x: -50, y: 50, w: 25, h: 25 },
  ];
  const surface = { width: 1000, height: 800 };
  const zoom = 2;

  const towardTopLeft = clampPanToBoardMasterBox(
    { panX: 100000, panY: 100000, zoom },
    objects,
    surface,
  );
  assert.equal(towardTopLeft.panX, 1100);
  assert.equal(towardTopLeft.panY, 700);

  const towardBottomRight = clampPanToBoardMasterBox(
    { panX: -100000, panY: -100000, zoom },
    objects,
    surface,
  );
  assert.equal(towardBottomRight.panX, -800);
  assert.equal(towardBottomRight.panY, -1200);

  assert.equal(
    (-towardTopLeft.panX + surface.width) / zoom,
    -50,
  );
  assert.equal(
    -towardBottomRight.panX / zoom,
    400,
  );
  assert.equal(
    (-towardTopLeft.panY + surface.height) / zoom,
    50,
  );
  assert.equal(
    -towardBottomRight.panY / zoom,
    600,
  );
});

test('viewport panning remains unchanged inside the limits and on an empty board', () => {
  const viewport = { panX: 12, panY: -34, zoom: 1.25 };
  const surface = { width: 1000, height: 800 };
  const objects = [{ type: 'text', x: 0, y: 0, w: 100, h: 100 }];

  assert.deepEqual(clampPanToBoardMasterBox(viewport, objects, surface), viewport);
  assert.deepEqual(clampPanToBoardMasterBox(viewport, [], surface), viewport);
});

test('a masterbox edge permits only the direction that returns toward the board', () => {
  const objects = [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }];
  const surface = { width: 1000, height: 800 };
  const cases = [
    {
      current: { panX: 900, panY: 0, zoom: 1 },
      proposed: { panX: 850, panY: 100, zoom: 1 },
      expected: { panX: 850, panY: 0, zoom: 1 },
    },
    {
      current: { panX: -400, panY: 0, zoom: 1 },
      proposed: { panX: -350, panY: 100, zoom: 1 },
      expected: { panX: -350, panY: 0, zoom: 1 },
    },
    {
      current: { panX: 0, panY: 600, zoom: 1 },
      proposed: { panX: 100, panY: 550, zoom: 1 },
      expected: { panX: 0, panY: 550, zoom: 1 },
    },
    {
      current: { panX: 0, panY: -600, zoom: 1 },
      proposed: { panX: 100, panY: -550, zoom: 1 },
      expected: { panX: 0, panY: -550, zoom: 1 },
    },
  ];

  for (const { current, proposed, expected } of cases) {
    assert.deepEqual(
      clampPanToBoardMasterBox(proposed, objects, surface, current),
      expected,
    );
  }
});

test('a masterbox corner permits both inward recovery directions and no others', () => {
  const objects = [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }];
  const surface = { width: 1000, height: 800 };
  const current = { panX: 900, panY: 600, zoom: 1 };

  assert.deepEqual(
    clampPanToBoardMasterBox(
      { panX: 850, panY: 550, zoom: 1 },
      objects,
      surface,
      current,
    ),
    { panX: 850, panY: 550, zoom: 1 },
  );
  assert.deepEqual(
    clampPanToBoardMasterBox(
      { panX: 950, panY: 550, zoom: 1 },
      objects,
      surface,
      current,
    ),
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
} = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/viewport_state.js'), 'utf8');
  const context = {
    console,
    innerWidth: width,
    innerHeight: height,
    objects,
  };
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

test('wheel and drag state methods share the same constrained pan path', () => {
  const context = loadViewportStateHarness({
    objects: [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }],
  });

  context.BoardfishViewportState.panBy(100000, -100000);
  assert.deepEqual(
    { ...context.viewportSnapshot() },
    {
      panX: 900,
      panY: -600,
      zoom: 1,
    },
  );

  context.BoardfishViewportState.setPan(-100000, 100000);
  assert.deepEqual(
    { ...context.viewportSnapshot() },
    {
      panX: -400,
      panY: 600,
      zoom: 1,
    },
  );
});

test('zooming around a client point keeps its world-space anchor fixed', () => {
  const context = loadViewportStateHarness({ panX: 10, panY: 20, zoom: 2 });
  const next = context.BoardfishViewportState.zoomAroundClient(110, 220, 4);

  assert.deepEqual({ ...next }, { panX: -90, panY: -180, zoom: 4 });
  assert.deepEqual({ ...context.viewportSnapshot() }, { panX: -90, panY: -180, zoom: 4 });
});

test('pan state stays fully locked at an edge until movement returns toward the board', () => {
  const context = loadViewportStateHarness({
    objects: [{ type: 'image', x: 100, y: 200, w: 300, h: 400 }],
    panX: 900,
    panY: 0,
  });

  context.BoardfishViewportState.panBy(50, 75);
  assert.deepEqual(
    { ...context.viewportSnapshot() },
    { panX: 900, panY: 0, zoom: 1 },
  );

  context.BoardfishViewportState.panBy(-25, 75);
  assert.deepEqual(
    { ...context.viewportSnapshot() },
    { panX: 875, panY: 0, zoom: 1 },
  );

  context.BoardfishViewportState.panBy(0, 75);
  assert.deepEqual(
    { ...context.viewportSnapshot() },
    { panX: 875, panY: 75, zoom: 1 },
  );
});
