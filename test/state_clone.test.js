'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = (value) => JSON.parse(JSON.stringify(value));

function loadStateCloneHarness() {
  const calls = { lineAlign: 0, scriptRanges: 0 };
  const context = {
    calls,
    HistoryDebug: {
      count() {},
      end() {},
      max() {},
      start() { return {}; },
    },
    imageTransformFromObject(obj) {
      return {
        flipX: !!obj.data?.flipX,
        flipY: !!obj.data?.flipY,
        rotation: Number(obj.data?.rotation) || 0,
      };
    },
    normalizeTextContent(value) {
      return String(value ?? '').replace(/\r\n?/g, '\n');
    },
    normalizeTextLineAlignForContent(_content, lineAlign) {
      calls.lineAlign++;
      return Array.isArray(lineAlign) ? lineAlign.filter((value) => value !== 'left') : [];
    },
    normalizeTextScriptRangesForContent(_content, scriptRanges) {
      calls.scriptRanges++;
      return Array.isArray(scriptRanges) ? scriptRanges.map((range) => ({ ...range })) : [];
    },
    cloneTextObjectRuntimeCaches(source, target) {
      target._runtimeCopiedFrom = source.id;
      return target;
    },
    performance: { now: () => 0 },
  };
  vm.createContext(context);
  vm.runInContext(
    `${fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'state.js'), 'utf8')}\n` +
      'globalThis.__stateClone = { cloneObject, newId };\n',
    context,
    { filename: 'state.js' },
  );
  return context;
}

test('text clone skips optional metadata normalizers when metadata is absent', () => {
  const context = loadStateCloneHarness();
  const clone = context.__stateClone.cloneObject({
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: { content: 'hello\r\nworld' },
  });

  assert.deepEqual(plain(clone), {
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: { content: 'hello\nworld' },
  });
  assert.deepEqual(context.calls, { lineAlign: 0, scriptRanges: 0 });
});

test('text clone still normalizes present optional metadata', () => {
  const context = loadStateCloneHarness();
  const clone = context.__stateClone.cloneObject({
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: {
      content: 'hello',
      lineAlign: ['center'],
      scriptRanges: [{ start: 2, end: 4, kind: 'sup' }],
    },
  });

  assert.deepEqual(plain(clone.data), {
    content: 'hello',
    lineAlign: ['center'],
    scriptRanges: [{ start: 2, end: 4, kind: 'sup' }],
  });
  assert.deepEqual(context.calls, { lineAlign: 1, scriptRanges: 1 });
});

test('text clone reuses current normalized script range cache', () => {
  const context = loadStateCloneHarness();
  const scriptRanges = [{ start: 2, end: 4, kind: 'sup' }];
  const clone = context.__stateClone.cloneObject({
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: {
      content: 'hello',
      scriptRanges,
    },
    _textScriptRangesCache: scriptRanges,
    _textScriptRangesCacheContent: 'hello',
    _textScriptRangesCacheSourceKey: JSON.stringify(scriptRanges),
  });

  assert.deepEqual(plain(clone.data), {
    content: 'hello',
    scriptRanges: [{ start: 2, end: 4, kind: 'sup' }],
  });
  assert.deepEqual(context.calls, { lineAlign: 0, scriptRanges: 0 });
  assert.notEqual(clone.data.scriptRanges[0], scriptRanges[0]);
});

test('text clone copies runtime caches only when requested', () => {
  const context = loadStateCloneHarness();
  const source = {
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: { content: 'hello' },
  };

  const regularClone = context.__stateClone.cloneObject(source);
  const runtimeClone = context.__stateClone.cloneObject(source, { runtimeTextCache: true });

  assert.equal(regularClone._runtimeCopiedFrom, undefined);
  assert.equal(runtimeClone._runtimeCopiedFrom, 'text-1');
});

test('newId skips ids already present in the live object map', () => {
  const context = loadStateCloneHarness();

  context.objectsMap.set('obj-1', { id: 'obj-1' });

  assert.equal(context.__stateClone.newId(), 'obj-2');
});
