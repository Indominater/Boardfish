'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../src/js/web_board_container.js');
const WebLimits = require('../src/js/board_limits.js');

function withBoardObjects(objects, fn) {
  const previousObjects = globalThis.objects;
  globalThis.objects = objects;
  try {
    return fn();
  } finally {
    if (previousObjects === undefined) delete globalThis.objects;
    else globalThis.objects = previousObjects;
  }
}

test('board text totals count spaces, tabs, newlines, and Unicode code points across textboxes', () => {
  assert.equal(WebLimits.textCharacterCount('A \t\n😀é'), 6);
  assert.equal(WebLimits.textCharacterCount('e\u0301'), 2);
  withBoardObjects([
    { type: 'text', data: { content: 'a b\tc\n' } },
    { type: 'image', data: { content: 'not textbox text' } },
    { type: 'text', data: { content: '😀é' } },
  ], () => assert.equal(WebLimits.currentTextCharacters(), 8));
});

test('additional text is accepted at the total character limit and rejected atomically above it', () => {
  const objects = [
    { type: 'text', data: { content: 'a'.repeat(12000) } },
    { type: 'text', data: { content: ' '.repeat(12999) } },
  ];
  withBoardObjects(objects, () => {
    assert.equal(WebLimits.canAcceptAdditionalTextCharacters(1, { notifyUser: false }), true);
    assert.equal(WebLimits.canAcceptAdditionalTextCharacters(2, { notifyUser: false }), false);
    assert.equal(WebLimits.currentTextCharacters(), 24999);
  });
});

test('textbox replacements free their previous characters without changing other textboxes', () => {
  const obj = { type: 'text', data: { content: 'a'.repeat(12500) } };
  const other = { type: 'text', data: { content: 'b'.repeat(12500) } };
  withBoardObjects([obj, other], () => {
    assert.equal(WebLimits.canReplaceText(obj, '😀'.repeat(12500), { notifyUser: false }), true);
    assert.equal(WebLimits.canReplaceText(obj, '😀'.repeat(12501), { notifyUser: false }), false);
    assert.equal(WebLimits.canReplaceText(obj, '', { notifyUser: false }), true);
    assert.equal(WebLimits.canReplaceText({ type: 'text', data: { content: 'a' } }, 'a', { notifyUser: false }), false);
    assert.equal(obj.data.content, 'a'.repeat(12500));
    assert.equal(other.data.content, 'b'.repeat(12500));
  });
});

test('character rejection uses the same notification format and duration as object rejection', () => {
  const calls = [];
  const previousShowIslandMsg = globalThis.showIslandMsg;
  const previousLongMessage = globalThis.long_message;
  globalThis.showIslandMsg = (message, duration) => calls.push({ message, duration });
  globalThis.long_message = 5200;
  try {
    withBoardObjects(Array.from({ length: 100 }, () => ({ type: 'text', data: { content: 'a'.repeat(250) } })), () => {
      assert.equal(WebLimits.canAddObjects(1), false);
      assert.equal(WebLimits.canAcceptAdditionalTextCharacters(1), false);
    });
  } finally {
    if (previousShowIslandMsg === undefined) delete globalThis.showIslandMsg;
    else globalThis.showIslandMsg = previousShowIslandMsg;
    if (previousLongMessage === undefined) delete globalThis.long_message;
    else globalThis.long_message = previousLongMessage;
  }
  assert.deepEqual(calls, [
    { message: 'Board Limit: 100 Objects', duration: 5200 },
    { message: 'Board Limit: 25,000 Characters', duration: 5200 },
  ]);
});

test('board payload validation rejects excessive text with the short character limit message', () => {
  assert.equal(WebLimits.validateBoardPayload({ textCharacters: 25000 }), true);
  assert.throws(
    () => WebLimits.validateBoardPayload({ textCharacters: 25001 }),
    (err) => {
      assert.equal(err.boardfishLimit, true);
      assert.equal(err.message, 'Board Limit: 25,000 Characters');
      assert.equal(err.boardfishUserMessage, 'Board Limit: 25,000 Characters');
      return true;
    },
  );
});

test('web board payload limits reject too many objects', () => {
  assert.throws(
    () => WebLimits.validateBoardPayload({ objectCount: WebLimits.LIMITS.maxObjects + 1 }),
    (err) => {
      assert.equal(err.message, 'Board Limit: 100 Objects');
      assert.equal(err.boardfishUserMessage, 'Board Limit: 100 Objects');
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
      assert.equal(err.message, 'Board Limit: 500 MB');
      assert.equal(err.boardfishUserMessage, 'Board Limit: 500 MB');
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
