'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../src/js/web_board_container.js');
const WebLimits = require('../src/js/board_limits.js');

test('web board payload limits reject too many objects', () => {
  assert.throws(
    () => WebLimits.validateBoardPayload({ objectCount: WebLimits.LIMITS.maxObjects + 1 }),
    (err) => {
      assert.equal(err.message, 'This board has 101 objects; Boardfish is limited to 100 objects.');
      assert.equal(err.boardfishUserMessage, 'Boardfish is limited to 100 objects');
      return true;
    },
  );
});

test('web board payload limits count decoded image bytes toward board content', () => {
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

test('web board content estimate ignores runtime text layout cache fields', () => {
  const previousObjects = globalThis.objects;
  const previousImageStore = globalThis.imageStore;
  const previousViewport = {
    panX: globalThis.panX,
    panY: globalThis.panY,
    zoom: globalThis.zoom,
  };
  globalThis.panX = 0;
  globalThis.panY = 0;
  globalThis.zoom = 1;
  globalThis.imageStore = {};
  globalThis.objects = [{
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 240,
    h: 120,
    z: 1,
    data: { content: 'hello' },
    _layoutCache: {
      toJSON() {
        throw new Error('runtime layout cache should not be serialized');
      },
    },
  }];
  try {
    assert.equal(WebLimits.canAcceptAdditionalContentBytes(0, 1, { notifyUser: false }), true);
  } finally {
    if (previousObjects === undefined) delete globalThis.objects;
    else globalThis.objects = previousObjects;
    if (previousImageStore === undefined) delete globalThis.imageStore;
    else globalThis.imageStore = previousImageStore;
    if (previousViewport.panX === undefined) delete globalThis.panX;
    else globalThis.panX = previousViewport.panX;
    if (previousViewport.panY === undefined) delete globalThis.panY;
    else globalThis.panY = previousViewport.panY;
    if (previousViewport.zoom === undefined) delete globalThis.zoom;
    else globalThis.zoom = previousViewport.zoom;
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
      assert.equal(err.message, 'This board is 500 MB; Boardfish boards are limited to 500 MB.');
      assert.equal(err.boardfishUserMessage, 'Boardfish boards are limited to 500 MB');
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

test('opened image entry metadata rejects unsupported image types', async () => {
  await assert.rejects(
    () => WebLimits.validateOpenedImageEntries([
      { path: 'images/img-1.txt', mime: 'text/plain', byteLength: 4 },
    ]),
    /unsupported image metadata/,
  );
});

test('board JSON estimate uses UTF-8 byte length rather than UTF-16 string length', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/board_limits.js'), 'utf8');

  assert.match(source, /return textByteLength\(json\) \+ 1024;/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{[\s\S]*\}\)\.length \+ 1024/);
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
