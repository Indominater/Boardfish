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

test('web board content estimate ignores runtime text layout cache fields', () => {
  const previousObjects = globalThis.objects;
  const previousImageStore = globalThis.imageStore;
  const originalEncode = TextEncoder.prototype.encode;
  let estimatedJson = '';
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
    data: {
      content: 'hello',
    },
    _layoutCache: {
      toJSON() {
        throw new Error('runtime layout cache should not be serialized');
      },
    },
  }];
  TextEncoder.prototype.encode = function captureEstimatedJson(value) {
    estimatedJson = String(value);
    return originalEncode.call(this, value);
  };
  try {
    assert.equal(WebLimits.canAcceptAdditionalContentBytes(0, 1, { notifyUser: false }), true);
    const { _layoutCache, ...object } = globalThis.objects[0];
    assert.deepEqual(JSON.parse(estimatedJson), {
      viewport: { panX: 0, panY: 0, zoom: 1 },
      objects: [object],
    });
  } finally {
    TextEncoder.prototype.encode = originalEncode;
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

test('board JSON estimate uses UTF-8 byte length rather than UTF-16 string length', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/board_limits.js'), 'utf8');

  assert.match(source, /return total \+ textByteLength\(json\) \+ 1024;/);
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
