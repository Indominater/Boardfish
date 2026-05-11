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
      'img-3': { web: true, path: 'images/img-3.webp', mime: 'image/webp', ext: 'webp', bytes: 12 },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 20, z: 1, data: { imgKey: 'img-1' } },
      { id: 'obj-2', type: 'image', x: 5, y: 5, w: 20, h: 10, z: 2, data: { imgKey: 'img-2' } },
      { id: 'obj-3', type: 'image', x: 10, y: 10, w: 30, h: 15, z: 3, data: { imgKey: 'img-3' } },
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
  assert.deepEqual(data.imageStore['img-3'], {
    path: 'images/img-3.webp',
    mime: 'image/webp',
    ext: 'webp',
  });
});

test('prunes unreferenced image store entries from saved board data', () => {
  const imageStore = {
    'img-1': 'data:image/png;base64,abc',
    'img-2': 'data:image/png;base64,def',
    'img-unused': 'data:image/png;base64,unused',
  };
  const objects = [
    { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 20, z: 1, data: { imgKey: 'img-1' } },
    { id: 'obj-2', type: 'text', x: 0, y: 0, w: 10, h: 20, z: 2, data: { text: 'hello' } },
    { id: 'obj-3', type: 'image', x: 5, y: 5, w: 20, h: 10, z: 3, data: { imgKey: 'img-2' } },
  ];

  const prune = BoardDocument.pruneImageStoreForObjects(imageStore, objects);
  assert.deepEqual(Object.keys(prune.imageStore).sort(), ['img-1', 'img-2']);
  assert.equal(prune.removed, 1);
  assert.equal(prune.kept, 2);
  assert.equal(prune.referenced, 2);

  const data = BoardDocument.createBoardDataForSave({
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore,
    objects,
  }, {
    schema: BoardSchema,
    guessImageExtFromDataUrl: () => 'png',
  });

  assert.deepEqual(Object.keys(data.imageStore).sort(), ['img-1', 'img-2']);
});

test('omits transient eyedropper card data from board data', () => {
  const data = BoardDocument.createBoardDataForSave({
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {},
    objects: [],
    eyedropperCards: [
      {
        rgba: [254, 224, 198, 255],
        left: 30,
        top: 20,
        order: 1,
        canvasWidth: 96,
        canvasHeight: 96,
        previewDataUrl: 'data:image/png;base64,abc',
      },
    ],
  }, {
    schema: BoardSchema,
    guessImageExtFromDataUrl: () => 'png',
  });

  assert.equal(Object.hasOwn(data, 'eyedropperCards'), false);
  assert.equal(Object.hasOwn(BoardDocument.getBoardSaveMetrics(data), 'eyedropperCardPreviewCount'), false);
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
