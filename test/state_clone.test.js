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

test('text clone drops retired line alignment metadata', () => {
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
  });
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

test('clockwise rotation preserves image centers and respects flip parity', () => {
  const context = loadStateCloneHarness();
  const dirtyIds = [];
  const histories = [];
  const renders = [];
  context.markDirty = (obj) => dirtyIds.push(obj.id);
  context.pushHistory = (reason) => histories.push(reason);
  context.scheduleRender = (...args) => renders.push(args);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'editor_state_boundary.js'), 'utf8'),
    context,
    { filename: 'editor_state_boundary.js' },
  );
  const images = [
    { flipX: false, flipY: false, expectedRotation: 0 },
    { flipX: true, flipY: false, expectedRotation: 180 },
    { flipX: false, flipY: true, expectedRotation: 180 },
    { flipX: true, flipY: true, expectedRotation: 0 },
  ].map(({ flipX, flipY, expectedRotation }, index) => ({
    id: `image-${index}`,
    type: 'image', x: 10, y: 20, w: 200, h: 100, z: index,
    data: { imgKey: `img-${index}`, rotation: 270, flipX, flipY },
    expectedRotation,
  }));
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 100, h: 50, data: { content: 'text' } };
  for (const obj of [...images, text]) {
    context.objects.push(obj);
    context.objectsMap.set(obj.id, obj);
    context.selectedIds.add(obj.id);
  }

  context.rotateSelectedImages();

  for (const obj of images) {
    assert.equal(obj.data.rotation, obj.expectedRotation);
    assert.equal(obj.x + obj.w / 2, 110);
    assert.equal(obj.y + obj.h / 2, 70);
    assert.equal(obj.w, 100);
    assert.equal(obj.h, 200);
  }
  assert.deepEqual(text, { id: 'text-1', type: 'text', x: 0, y: 0, w: 100, h: 50, data: { content: 'text' } });
  assert.deepEqual(dirtyIds, images.map((obj) => obj.id));
  assert.deepEqual(histories, ['rotate-image-cw']);
  assert.deepEqual(renders, [[true, true, 'rotate-image-cw']]);
});
