'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadDirtyStateHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/io_close.js'), 'utf8');
  const end = source.indexOf('// ─── Unsaved changes dialog');
  const context = {
    boardHistory: [],
    historyIndex: -1,
    objects: [],
    _dirtyIds: new Set(),
    window: {
      addEventListener(type, handler) {
        if (type === 'beforeunload') context.beforeUnloadHandler = handler;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(0, end), context, { filename: 'io_close_dirty_state.js' });
  vm.runInContext(
    source.slice(source.lastIndexOf("window.addEventListener('beforeunload'")),
    context,
    { filename: 'io_close_beforeunload.js' },
  );
  return context;
}

function addHistory(context, revision, objects = context.objects) {
  context.boardHistory.length = context.historyIndex + 1;
  context.boardHistory.push({ revision, objects: structuredClone(objects) });
  context.historyIndex++;
}

test('saved state follows content revisions while no-op edit entries stay clean', () => {
  const context = loadDirtyStateHarness();
  context.objects = [{ id: 'text-1', type: 'text', data: { content: 'before' } }];
  addHistory(context, 1);
  context.markSaved();
  assert.equal(context.isDirty(), false);

  addHistory(context, 1); // text-edit-enter does not change persisted content.
  assert.equal(context.isDirty(), false);

  context.objects[0].data.content = 'after';
  addHistory(context, 2);
  assert.equal(context.isDirty(), true);

  context.historyIndex--;
  context.objects = structuredClone(context.boardHistory[context.historyIndex].objects);
  assert.equal(context.isDirty(), false);
});

test('saved revision survives a branch that reuses its former history index', () => {
  const context = loadDirtyStateHarness();
  context.objects = [{ id: 'text-1', type: 'text', data: { content: 'one' } }];
  addHistory(context, 1);
  context.objects[0].data.content = 'saved';
  addHistory(context, 2);
  context.markSaved();

  context.historyIndex--;
  context.objects[0].data.content = 'branched';
  addHistory(context, 3);
  assert.equal(context.isDirty(), true);
});

test('unsaved populated boards remain dirty', () => {
  const context = loadDirtyStateHarness();
  context.objects = [{ id: 'text-1', type: 'text', data: { content: 'new' } }];
  addHistory(context, 1);
  context._dirtyIds.add('text-1');
  assert.equal(context.isDirty(), true);
});

test('closing a dirty board keeps the browser warning enabled', () => {
  const context = loadDirtyStateHarness();
  context.objects = [{ id: 'text-1', type: 'text', data: { content: 'changed' } }];
  addHistory(context, 1);
  context._dirtyIds.add('text-1');
  const event = {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };

  context.beforeUnloadHandler(event);

  assert.equal(event.prevented, true);
  assert.equal(event.returnValue, '');
});
