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
      'img-2': { web: true, path: 'images/img-2.png', mime: 'image/png', ext: 'png' },
      'img-3': { web: true, path: 'images/img-3.webp', mime: 'image/webp', ext: 'webp', bytes: 12 },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 20, z: 1, data: { imgKey: 'img-1' } },
      { id: 'obj-2', type: 'image', x: 5, y: 5, w: 20, h: 10, z: 2, data: { imgKey: 'img-2' } },
      { id: 'obj-3', type: 'image', x: 10, y: 10, w: 30, h: 15, z: 3, data: { imgKey: 'img-3' } },
    ],
  }, {
    schema: BoardSchema,
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

test('saved image metadata regenerates canonical paths for web refs', () => {
  const data = BoardDocument.createBoardDataForSave({
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {
      'img-1': { web: true, path: '../evil.png', mime: 'image/png', ext: 'png', bytes: 4 },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  }, {
    schema: BoardSchema,
  });

  assert.deepEqual(data.imageStore['img-1'], {
    path: 'images/img-1.png',
    mime: 'image/png',
    ext: 'png',
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

test('omits unsupported transient board data from board data', () => {
  const data = BoardDocument.createBoardDataForSave({
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {},
    objects: [],
    transientPanelState: { visible: true },
  }, {
    schema: BoardSchema,
    guessImageExtFromDataUrl: () => 'png',
  });

  assert.equal(Object.hasOwn(data, 'transientPanelState'), false);
});

test('strips runtime text layout caches from saved board data', () => {
  const content = Array.from({ length: 3000 }, (_, index) => `word${index}`).join(' ');
  const runtimeTextObject = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 20,
    w: 600,
    h: 900,
    z: 1,
    data: { content },
    _layoutCache: Array.from({ length: 120 }, (_, index) => ({
      text: `line ${index}`,
      startIndex: index,
      endIndex: index + 1,
      scriptRanges: [],
      content,
      prefixWidths: [0, 10],
    })),
    _textEditCaretIndex: content.length,
    _editStartContent: content,
    _editMinLines: 5,
  };

  const data = BoardDocument.createBoardDataForSave({
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {},
    objects: [runtimeTextObject],
  }, {
    schema: BoardSchema,
  });

  assert.deepEqual(Object.keys(data.objects[0]).sort(), ['data', 'h', 'id', 'type', 'w', 'x', 'y', 'z'].sort());
  assert.deepEqual(Object.keys(data.objects[0].data), ['content']);
  assert.equal(data.objects[0].data.content, content);

  const json = JSON.stringify(data);
  assert.equal(json.includes('_layoutCache'), false);
  assert.equal(json.includes('_editStartContent'), false);
  assert.ok(json.length < content.length * 2);

  const metrics = BoardDocument.getBoardSaveMetrics(data, { rawObjects: [runtimeTextObject] });
  assert.equal(metrics.textCharCount, content.length);
  assert.equal(metrics.largestTextChars, content.length);
  assert.equal(metrics.runtimeTextCacheObjects, 1);
  assert.equal(metrics.runtimeTextCacheLines, 120);
  assert.equal(metrics.runtimeTextCacheContentChars, content.length * 120);
  assert.equal(metrics.runtimeTextCachePrefixEntries, 240);
  assert.ok(metrics.runtimeTextPrivateFields >= 4);
});
