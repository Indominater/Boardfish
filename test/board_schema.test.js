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

function textObject(id, content) {
  return { id, type: 'text', x: 0, y: 0, w: 100, h: 60, z: 1, data: { content } };
}

test('accepts boards at the object and total text character limits', () => {
  const board = BoardSchema.normalizeBoardData({
    objects: Array.from({ length: 100 }, (_, index) => textObject(`text-${index}`, '😀'.repeat(250))),
  });
  assert.equal(board.objects.length, 100);
});

test('rejects boards above the object limit before pruning empty textboxes', () => {
  assert.throws(
    () => BoardSchema.normalizeBoardData({
      objects: Array.from({ length: 101 }, (_, index) => textObject(`text-${index}`, '')),
    }),
    (err) => err.boardfishLimit === true && err.boardfishUserMessage === 'Board Limit: 100 Objects',
  );
});

test('rejects excessive combined textbox characters, including whitespace before pruning', () => {
  assert.throws(
    () => BoardSchema.normalizeBoardData({
      objects: [textObject('text-1', 'a'.repeat(12500)), textObject('text-2', '\t'.repeat(12501))],
    }),
    (err) => err.boardfishLimit === true && err.boardfishUserMessage === 'Board Limit: 25,000 Characters',
  );
});

test('normalizes valid board data from shared v3 fixture', () => {
  const board = BoardSchema.normalizeBoardData(readFixture('valid_v3_board.json'));

  assert.equal(board.viewport.zoom, 2);
  assert.equal(board.objects[1].data.rotation, 270);
  assert.equal(Object.hasOwn(board, 'preferences'), false);
});

test('clamps viewport zoom to 1.0 percent through 10000 percent', () => {
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

  assert.equal(belowMin.viewport.zoom, 0.01);
  assert.equal(aboveMax.viewport.zoom, 100);
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
    /Missing Image: img-1/
  );
});

test('rejects malformed unused image sources before pruning', () => {
  assert.throws(() => BoardSchema.normalizeBoardData({
    imageStore: { 'img-unused': 42 },
    objects: [],
  }), /Invalid Image Source: img-unused/);
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
  assert.throws(() => BoardSchema.normalizeBoardData({ version: 99 }), /Unsupported Board Version/);
  assert.throws(() => BoardSchema.normalizeBoardData({ format: 'other' }), /Unsupported Board Format/);
});
