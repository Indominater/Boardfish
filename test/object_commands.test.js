'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadDuplicateHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/object_commands.js'), 'utf8');
  const sourceObjects = [
    { id: 'text-1', type: 'text', x: 10, y: 20, w: 20, h: 10, z: 1, data: { content: 'text' } },
    { id: 'image-1', type: 'image', x: 50, y: 60, w: 10, h: 20, z: 2, data: { imgKey: 'img-1' } },
  ];
  let idCounter = 0;
  const calls = {
    added: [],
    histories: [],
    renders: [],
    selections: [],
  };
  const context = {
    console,
    calls,
    editingId: null,
    selectedIds: new Set(sourceObjects.map((obj) => obj.id)),
    objectsMap: new Map(sourceObjects.map((obj) => [obj.id, obj])),
    zCounter: 10,
    window: { innerWidth: 1000, innerHeight: 800 },
    BoardfishWebLimits: {
      canAddObjects() { return true; },
      canAcceptAdditionalContentBytes() { return true; },
      isLimitedRuntime() { return true; },
      textByteLength(text) { return String(text ?? '').length; },
    },
    BoardfishEditorState: {
      addObject(obj) {
        calls.added.push(obj);
        context.objectsMap.set(obj.id, obj);
      },
      setSelection(ids, options = {}) {
        calls.selections.push({ ids, options });
        context.selectedIds = new Set(ids);
      },
    },
    BoardfishMotion: {
      applyActionAnimation() {},
    },
    cloneObject(obj) {
      return JSON.parse(JSON.stringify(obj));
    },
    newId() {
      idCounter++;
      return `dup-${idCounter}`;
    },
    scheduleRender(board, overlay, reason) {
      calls.renders.push({ board, overlay, reason });
    },
    pushHistory(reason) {
      calls.histories.push(reason);
    },
    toWorld() {
      return { x: 0, y: 0 };
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.duplicateSelected = duplicateSelected;\n`, context, {
    filename: 'object_commands.js',
  });
  return context;
}

test('duplicateSelected centers the duplicated group on the supplied point', () => {
  const context = loadDuplicateHarness();

  context.duplicateSelected({ x: 100, y: 200 });

  assert.equal(context.calls.added.length, 2);
  const minX = Math.min(...context.calls.added.map((obj) => obj.x));
  const minY = Math.min(...context.calls.added.map((obj) => obj.y));
  const maxX = Math.max(...context.calls.added.map((obj) => obj.x + obj.w));
  const maxY = Math.max(...context.calls.added.map((obj) => obj.y + obj.h));
  assert.equal((minX + maxX) / 2, 100);
  assert.equal((minY + maxY) / 2, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.histories)), ['duplicate-selected']);
});
