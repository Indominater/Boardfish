'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createObjectGeometry } = require('../src/js/object_geometry.js');

function createGeometry(overrides = {}) {
  return createObjectGeometry({
    imageTransformFromObject: (obj) => obj.data || {},
    isSidewaysRotation: (rotation) => rotation === 90 || rotation === 270,
    objects: () => [],
    ...overrides,
  });
}

test('maps image world points into local unit coordinates', () => {
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
});

test('hit-tests rotated image objects by rendered shape', () => {
  const geometry = createGeometry();
  const image = {
    type: 'image',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    data: { flipX: false, flipY: false, rotation: 90 },
  };
  assert.equal(geometry.objectContainsWorldPoint(image, { x: 50, y: 25 }), true);
  assert.equal(geometry.objectContainsWorldPoint(image, { x: -10, y: 25 }), false);
});

test('finds topmost object using shared hit-testing rules', () => {
  const bottom = { id: 'bottom', type: 'text', x: 0, y: 0, w: 100, h: 100 };
  const top = { id: 'top', type: 'text', x: 20, y: 20, w: 20, h: 20 };
  const geometry = createGeometry({ objects: () => [bottom, top] });
  assert.equal(geometry.topObjectAtWorldPoint({ x: 25, y: 25 }), top);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 5, y: 5 }), bottom);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 200, y: 200 }), null);
});
