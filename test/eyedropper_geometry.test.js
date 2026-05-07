'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEyedropperGeometry } = require('../src/js/eyedropper_geometry.js');

function createGeometry(overrides = {}) {
  const boardCanvas = {
    width: 400,
    height: 300,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 150 }),
  };
  return createEyedropperGeometry({
    boardCanvas: () => boardCanvas,
    canvasBackgroundColor: () => 'rgb(12, 34, 56)',
    imageTransformFromObject: (obj) => obj.data || {},
    isSidewaysRotation: (rotation) => rotation === 90 || rotation === 270,
    objects: () => [],
    parseCssColor: () => [12, 34, 56, 255],
    toWorld: () => null,
    view: () => ({ panX: 5, panY: 10, zoom: 2 }),
    ...overrides,
  });
}

test('maps client pixels into source canvas coordinates', () => {
  const geometry = createGeometry();
  assert.deepEqual(
    geometry.displayedBoardSourcePoint(60, 95),
    {
      x: 100,
      y: 150,
      sourceW: 400,
      sourceH: 300,
      rect: { left: 10, top: 20, width: 200, height: 150 },
    }
  );
});

test('converts screen and client points to board world coordinates', () => {
  const geometry = createGeometry();
  assert.deepEqual(geometry.clientToBoardScreenPoint(60, 95), { x: 50, y: 75 });
  assert.deepEqual(geometry.screenToBoardWorldPoint({ x: 50, y: 75 }), { x: 22.5, y: 32.5 });
  assert.deepEqual(geometry.clientToBoardWorldPoint(60, 95), { x: 22.5, y: 32.5 });
});

test('hit-tests rotated image objects in local unit coordinates', () => {
  const geometry = createGeometry();
  const image = {
    type: 'image',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    data: { flipX: false, flipY: false, rotation: 0 },
  };
  assert.deepEqual(geometry.worldPointToImageLocalUnit(image, { x: 50, y: 25 }), { u: 0.5, v: 0.5 });
  assert.equal(geometry.worldPointToImageLocalUnit(image, { x: 120, y: 25 }), null);
  assert.equal(geometry.imageBoundsDistanceSqToWorldPoint(image, { x: 120, y: 25 }), 400);
});

test('finds the topmost object containing a world point', () => {
  const bottom = { id: 'bottom', type: 'text', x: 0, y: 0, w: 100, h: 100 };
  const top = { id: 'top', type: 'text', x: 20, y: 20, w: 20, h: 20 };
  const geometry = createGeometry({ objects: () => [bottom, top] });
  assert.equal(geometry.topObjectAtWorldPoint({ x: 25, y: 25 }), top);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 5, y: 5 }), bottom);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 200, y: 200 }), null);
});
