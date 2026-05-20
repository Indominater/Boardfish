'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const WebContainer = require('../src/js/web_board_container.js');

test('writes and reads Boardfish .bf containers in browser format', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 1, panY: 2, zoom: 1 },
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const imageStore = {
    'img-1': 'data:image/png;base64,AQIDBA==',
  };

  const payload = await WebContainer.createBoardContainerBlob(board, imageStore);
  assert.equal(payload.imageBytes, 4);
  assert.equal(payload.imageCount, 1);
  assert.ok(payload.bytes[0] === 0x50 && payload.bytes[1] === 0x4b);

  const result = await WebContainer.readBoardContainer(payload.blob);
  assert.equal(result.board.version, 3);
  const source = result.board.imageStore['img-1'];
  assert.equal(WebContainer.isWebImageRef(source), true);
  assert.equal(source.mime, 'image/png');
  assert.equal(source.ext, 'png');
  assert.equal(source.bytes, 4);
  assert.equal(WebContainer.dataUrlForImageSource(source), imageStore['img-1']);
  assert.equal(result.debug.image_bytes, 4);
  assert.equal(result.imageEntries[0].path, 'images/img-1.png');

  const savedAgain = await WebContainer.createBoardContainerBlob(board, result.board.imageStore);
  assert.equal(savedAgain.imageBytes, 4);
});

test('read validates advertised image bytes before materializing image entries', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });
  const maxBoardContentBytes = payload.boardJsonBytes + 3;
  const validations = [];

  await assert.rejects(
    () => WebContainer.readBoardContainer(payload.blob, {
      maxBoardContentBytes,
      validateBoardPayload(next) {
        validations.push({ ...next });
        if ((next.boardJsonBytes || 0) + (next.imageBytes || 0) > maxBoardContentBytes) {
          throw new Error('board content limit');
        }
      },
    }),
    /board content limit/,
  );
  assert.ok(validations.some((next) => next.imageBytes === 4));
});

test('measures data URL payload bytes without base64 inflation', () => {
  assert.equal(WebContainer.dataUrlByteLength('data:image/png;base64,AQIDBA=='), 4);
});

test('creates byte-backed web image refs for inserted files', async () => {
  const source = WebContainer.createWebImageRef({
    path: 'images/img-2.jpg',
    mime: 'image/jpeg',
    ext: 'jpg',
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
  });

  assert.equal(WebContainer.isWebImageRef(source), true);
  assert.equal(source.bytes, 5);
  assert.equal(source.dataUrl ? source.dataUrl.startsWith('data:image/jpeg;base64,') : true, true);
  assert.equal(WebContainer.bytesForImageSource(source).length, 5);
  assert.equal(WebContainer.dataUrlForImageSource(source), 'data:image/jpeg;base64,AQIDBAU=');
});
