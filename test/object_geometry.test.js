'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createObjectGeometry } = require('../src/js/object_geometry.js');

function createGeometry(overrides = {}) {
  return createObjectGeometry({
    objects: () => [],
    ...overrides,
  });
}

test('finds topmost object using shared hit-testing rules', () => {
  const bottom = { id: 'bottom', type: 'text', x: 0, y: 0, w: 100, h: 100 };
  const top = { id: 'top', type: 'text', x: 20, y: 20, w: 20, h: 20 };
  const geometry = createGeometry({ objects: () => [bottom, top] });
  assert.equal(geometry.topObjectAtWorldPoint({ x: 25, y: 25 }), top);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 5, y: 5 }), bottom);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 200, y: 200 }), null);
});

test('topmost hit-testing follows the rendered shape of rotated images', () => {
  const image = {
    id: 'image',
    type: 'image',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    data: { flipX: false, flipY: false, rotation: 90 },
  };
  const geometry = createGeometry({ objects: () => [image] });
  for (const rotation of [0, 90, 180, 270, -90, 45]) {
    image.data.rotation = rotation;
    assert.equal(geometry.topObjectAtWorldPoint({ x: 50, y: 25 }), image);
    assert.equal(geometry.topObjectAtWorldPoint({ x: -100, y: -100 }), null);
  }
});

test('image hit-testing includes rendered edges and rejects points just outside them', () => {
  const image = {
    id: 'image',
    type: 'image',
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    data: { flipX: true, flipY: true, rotation: 0 },
  };
  const geometry = createGeometry({ objects: () => [image] });

  assert.equal(geometry.topObjectAtWorldPoint({ x: 10, y: 20 }), image);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 110, y: 70 }), image);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 110.00001, y: 70 }), null);
});

test('topmost object hit-test can ignore filtered objects', () => {
  const image = { id: 'image', type: 'image', x: 0, y: 0, w: 100, h: 100 };
  const text = { id: 'text', type: 'text', x: 20, y: 20, w: 20, h: 20 };
  const geometry = createGeometry({ objects: () => [image, text] });
  assert.equal(
    geometry.topObjectAtWorldPoint({ x: 25, y: 25 }, undefined, obj => obj.type !== 'text'),
    image,
  );
});
