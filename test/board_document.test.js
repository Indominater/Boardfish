'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const BoardDocument = require('../src/js/board_document.js');
const BoardSchema = require('../src/js/board_schema.js');

test('creates v3 board save data with image manifest refs', () => {
  const data = BoardDocument.createBoardDataForSave({
    viewport: { panX: 1, panY: 2, zoom: 1.5 },
    imageStore: {
      'img-1': 'data:image/jpeg;base64,abc',
      'img-2': { native: true, path: 'images/img-2.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 20, z: 1, data: { imgKey: 'img-1' } },
      { id: 'obj-2', type: 'image', x: 5, y: 5, w: 20, h: 10, z: 2, data: { imgKey: 'img-2' } },
    ],
  }, {
    schema: BoardSchema,
    isNativeImageRef: (src) => !!src?.native,
    guessImageExtFromDataUrl: () => 'jpg',
  });

  assert.equal(data.version, 3);
  assert.equal(data.format, 'boardfish-container');
  assert.deepEqual(data.imageStore['img-1'], {
    path: 'images/img-1.jpg',
    mime: 'image/jpeg',
    ext: 'jpg',
  });
  assert.deepEqual(data.imageStore['img-2'], {
    path: 'images/img-2.png',
    mime: 'image/png',
    ext: 'png',
  });
});

test('summarizes image store without runtime globals', () => {
  const summary = BoardDocument.summarizeImageStore({
    'img-1': 'data:image/png;base64,abc',
    'img-2': { native: true, path: 'images/img-2.png', mime: 'image/png', ext: 'png' },
  }, {
    isNativeImageRef: (src) => !!src?.native,
    imageStoreBytesEstimate: (src) => typeof src === 'string' ? src.length : JSON.stringify(src).length,
  });

  assert.equal(summary.imageCount, 2);
  assert.equal(summary.nativeRefs, 1);
  assert.equal(summary.dataUrlRefs, 1);
  assert.equal(summary.manifestRefs, 0);
  assert.ok(summary.imageStoreBytes > 0);
});
