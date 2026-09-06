'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BoardSchema = require('../src/js/board_schema.js');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function imageObject(id, imgKey, z = 1) {
  return { id, type: 'image', x: 0, y: 0, w: 10, h: 10, z, data: { imgKey } };
}

test('normalizes valid board data from shared v3 fixture', () => {
  const board = BoardSchema.normalizeBoardData(readFixture('valid_v3_board.json'));

  assert.equal(board.viewport.zoom, 2);
  assert.equal(board.objects[1].data.rotation, 270);
  assert.equal(Object.hasOwn(board, 'preferences'), false);
});

test('clamps viewport zoom to 10 percent through 1000 percent', () => {
  const belowMin = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
    viewport: { panX: 0, panY: 0, zoom: 0.001 },
  });
  const aboveMax = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
    viewport: { panX: 0, panY: 0, zoom: 1000 },
  });

  assert.equal(belowMin.viewport.zoom, 0.1);
  assert.equal(aboveMax.viewport.zoom, 10);
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

test('strips unsupported transient board fields', () => {
  const board = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
    transientPanelState: { visible: true },
  });

  assert.equal(Object.hasOwn(board, 'transientPanelState'), false);
});

test('strips retired text alignment metadata', () => {
  const board = BoardSchema.normalizeBoardData({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [{
      id: 'text-1',
      type: 'text',
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      z: 1,
      data: { content: 'hello', lineAlign: ['right'] },
    }],
  });

  assert.deepEqual(board.objects[0].data, { content: 'hello' });
});

test('rejects image objects with missing image sources', () => {
  assert.throws(
    () => BoardSchema.normalizeBoardData({
      version: 3,
      format: 'boardfish-container',
      imageStore: {},
      objects: [imageObject('obj-1', 'img-1')],
    }),
    /references missing image/
  );
});

test('rejects malformed unused image sources before pruning', () => {
  assert.throws(() => BoardSchema.normalizeBoardData({
    imageStore: { 'img-unused': 42 },
    objects: [],
  }), /imageStore\.img-unused must be a string or object/);
});

test('prunes unused sources and invisible empty text through round trips', () => {
  const board = BoardSchema.normalizeBoardData({
    imageStore: {
      'img-unused': 'data:image/png;base64,unused',
      'img-2': { path: 'images/img-2.png', mime: 'image/png', ext: 'png' },
      'img-1': 'data:image/png;base64,AQID',
    },
    objects: [imageObject('obj-1', 'img-1'), { id: 'empty', type: 'text', x: 0, y: 0, w: 10, h: 10, z: 2, data: { content: ' \u200B' } }, imageObject('obj-2', 'img-2', 3), imageObject('obj-3', 'img-1', 4)],
  });

  assert.deepEqual(Object.keys(board.imageStore), ['img-1', 'img-2']);
  assert.deepEqual(board.objects.map((obj) => obj.data.imgKey), ['img-1', 'img-2', 'img-1']);
  assert.deepEqual(BoardSchema.normalizeBoardData(JSON.parse(JSON.stringify(board))), board);
});

test('rejects unsupported versions and formats', () => {
  assert.throws(() => BoardSchema.normalizeBoardData({ version: 99 }), /unsupported board version/);
  assert.throws(() => BoardSchema.normalizeBoardData({ format: 'other' }), /unsupported board format/);
});
