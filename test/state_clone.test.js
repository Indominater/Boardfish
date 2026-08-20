'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = (value) => JSON.parse(JSON.stringify(value));

function loadStateCloneHarness() {
  const context = {
    HistoryDebug: {
      count() {},
      end() {},
      max() {},
      start() { return {}; },
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

test('text clone copies canonical content without normalization', () => {
  const context = loadStateCloneHarness();
  const clone = context.__stateClone.cloneObject({
    id: 'text-1',
    type: 'text',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z: 5,
    data: { content: 'hello\nworld' },
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
});

test('text clone copies canonical line alignment independently', () => {
  const context = loadStateCloneHarness();
  const source = {
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
    },
  };
  const clone = context.__stateClone.cloneObject(source);

  assert.deepEqual(plain(clone.data), {
    content: 'hello',
    lineAlign: ['center'],
  });
  assert.notEqual(clone.data.lineAlign, source.data.lineAlign);
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
  const runtimeClone = context.__stateClone.cloneObject(source, true);

  assert.equal(regularClone._runtimeCopiedFrom, undefined);
  assert.equal(runtimeClone._runtimeCopiedFrom, 'text-1');
});

test('newId skips ids already present in the live object map', () => {
  const context = loadStateCloneHarness();

  context.objectsMap.set('obj-1', { id: 'obj-1' });

  assert.equal(context.__stateClone.newId(), 'obj-2');
});
