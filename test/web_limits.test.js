'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/js/web_board_container.js');
const WebLimits = require('../src/js/web_limits.js');

test('web board payload limits reject too many objects', () => {
  assert.throws(
    () => WebLimits.validateBoardPayload({ objectCount: WebLimits.LIMITS.maxObjects + 1 }),
    (err) => {
      assert.equal(err.message, 'This board has 101 objects; Boardfish Web is limited to 100 objects.');
      assert.equal(err.boardfishUserMessage, 'Boardfish Web is limited to 100 objects');
      return true;
    },
  );
});

test('web board payload limits count decoded image bytes toward board content', () => {
  assert.equal(WebLimits.dataUrlByteLength('data:image/png;base64,AQIDBA=='), 4);
  assert.equal(
    WebLimits.validateBoardPayload({
      objectCount: 1,
      boardJsonBytes: 10,
      imageEntries: [{ key: 'img-1', byteLength: 33 * 1024 * 1024 }],
    }),
    true,
  );
});

test('web data URL image validation measures bytes without decoding payload', async () => {
  const previousContainer = globalThis.BoardfishWebBoardContainer;
  const previousObjects = globalThis.objects;
  const previousImageStore = globalThis.imageStore;
  let byteLengthCalls = 0;
  let decodeCalls = 0;
  globalThis.objects = [];
  globalThis.imageStore = {};
  globalThis.BoardfishWebBoardContainer = {
    dataUrlByteLength(dataUrl) {
      byteLengthCalls += 1;
      assert.equal(dataUrl, 'data:image/png;base64,AQIDBA==');
      return 4;
    },
    dataUrlToBytes() {
      decodeCalls += 1;
      throw new Error('data URL validation should not decode bytes');
    },
  };
  try {
    assert.deepEqual(
      await WebLimits.validateDataUrlImage('data:image/png;base64,AQIDBA=='),
      { bytes: 4 },
    );
    assert.deepEqual(
      await WebLimits.validateDataUrlImage('not-a-data-url'),
      { bytes: 0 },
    );
    assert.equal(byteLengthCalls, 1);
    assert.equal(decodeCalls, 0);
  } finally {
    globalThis.BoardfishWebBoardContainer = previousContainer;
    if (previousObjects === undefined) delete globalThis.objects;
    else globalThis.objects = previousObjects;
    if (previousImageStore === undefined) delete globalThis.imageStore;
    else globalThis.imageStore = previousImageStore;
  }
});

test('web board content limit carries a short user-facing message', () => {
  assert.throws(
    () => WebLimits.validateBoardPayload({
      objectCount: 1,
      boardJsonBytes: WebLimits.LIMITS.maxBoardContentBytes + 1,
      imageEntries: [],
    }),
    (err) => {
      assert.equal(err.message, 'This board is 500 MB; Boardfish Web boards are limited to 500 MB.');
      assert.equal(err.boardfishUserMessage, 'Boardfish Web boards are limited to 500 MB');
      return true;
    },
  );
});

test('web image pixel cap is not enforced', async () => {
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({
    width: 8001,
    height: 8001,
    close() {},
  });
  try {
    await assert.doesNotReject(
      () => WebLimits.validateOpenedImageEntries([
        {
          path: 'images/huge.png',
          mime: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    );
  } finally {
    if (previousCreateImageBitmap) globalThis.createImageBitmap = previousCreateImageBitmap;
    else delete globalThis.createImageBitmap;
  }
});

test('web limit notifications remain visible long enough to read', () => {
  const calls = [];
  const previousShowIslandMsg = globalThis.showIslandMsg;
  globalThis.showIslandMsg = (message, duration) => calls.push({ message, duration });
  try {
    WebLimits.notify('limit message');
  } finally {
    if (previousShowIslandMsg) globalThis.showIslandMsg = previousShowIslandMsg;
    else delete globalThis.showIslandMsg;
  }
  assert.deepEqual(calls, [{ message: 'limit message', duration: 4500 }]);
});
