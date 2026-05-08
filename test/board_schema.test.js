'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BoardSchema = require('../src/js/board_schema.js');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

test('normalizes valid board data from shared v3 fixture', () => {
  const board = BoardSchema.normalizeBoardData(readFixture('valid_v3_board.json'));

  assert.equal(board.viewport.zoom, 2);
  assert.equal(board.objects[1].data.rotation, 270);
  assert.equal(Object.hasOwn(board, 'preferences'), false);
});

test('ignores legacy board theme preferences', () => {
  const board = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    preferences: { theme: 'dark' },
    imageStore: {},
    objects: [],
  });

  assert.equal(Object.hasOwn(board, 'preferences'), false);
});

test('normalizes saved eyedropper cards', () => {
  const board = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
    eyedropperCards: [
      {
        rgba: [254.2, 224.4, 198.1],
        left: 30,
        top: 20,
        order: 1,
        canvasWidth: 96,
        canvasHeight: 96,
        previewDataUrl: 'data:image/png;base64,abc',
      },
    ],
  });

  assert.deepEqual(board.eyedropperCards[0], {
    rgba: [254, 224, 198, 255],
    left: 30,
    top: 20,
    order: 1,
    canvasWidth: 96,
    canvasHeight: 96,
    previewDataUrl: 'data:image/png;base64,abc',
  });
});

test('limits saved eyedropper cards to one', () => {
  const board = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
    eyedropperCards: [
      { rgba: [1, 2, 3], left: 10, top: 20, order: 1 },
      { rgba: [4, 5, 6], left: 30, top: 40, order: 2 },
    ],
  });

  assert.equal(board.eyedropperCards.length, 1);
  assert.deepEqual(board.eyedropperCards[0].rgba, [1, 2, 3, 255]);
});

test('normalizes object lock state', () => {
  const board = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [
      { id: 'obj-1', type: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, locked: true, data: { content: 'locked' } },
      { id: 'obj-2', type: 'text', x: 0, y: 50, w: 100, h: 40, z: 2, locked: 'yes', data: { content: 'unlocked' } },
    ],
  });

  assert.equal(board.objects[0].locked, true);
  assert.equal(board.objects[1].locked, false);
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
