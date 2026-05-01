'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BoardSchema = require('../src/js/board_schema.js');

test('normalizes valid board data', () => {
  const board = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 10, panY: -5, zoom: 2 },
    imageStore: { 'img-1': { native: true, path: 'images/img-1.png' } },
    objects: [
      { id: 'obj-1', type: 'text', x: 1, y: 2, w: 120, h: 40, z: 3, data: { content: 'hello' } },
      { id: 'obj-2', type: 'image', x: 4, y: 5, w: 200, h: 100, z: 6, data: { imgKey: 'img-1', rotation: -90 } },
    ],
  });

  assert.equal(board.viewport.zoom, 2);
  assert.equal(board.objects[1].data.rotation, 270);
});

test('rejects image objects with missing image sources', () => {
  assert.throws(
    () => BoardSchema.normalizeBoardData({
      version: 3,
      format: 'boardfish-container',
      imageStore: {},
      objects: [
        { id: 'obj-1', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: { imgKey: 'img-1' } },
      ],
    }),
    /references missing image/
  );
});

test('rejects unsupported versions and formats', () => {
  assert.throws(() => BoardSchema.normalizeBoardData({ version: 99 }), /unsupported board version/);
  assert.throws(() => BoardSchema.normalizeBoardData({ format: 'other' }), /unsupported board format/);
});
