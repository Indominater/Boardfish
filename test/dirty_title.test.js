'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadDirtyTitleHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/io_close.js'), 'utf8');
  const end = source.indexOf('// ─── Unsaved changes dialog');
  let title = 'Boardfish';
  let titleWrites = 0;
  const context = {
    BoardfishRuntime: {
      fileNameFromRef(ref, fallback = '') {
        return ref ? path.basename(String(ref)) : fallback;
      },
    },
    boardHistory: [],
    historyIndex: -1,
    objects: [],
    _dirtyIds: new Set(),
    window: {
      addEventListener(type, handler) {
        if (type === 'beforeunload') context.beforeUnloadHandler = handler;
      },
    },
    document: {
      get title() { return title; },
      set title(value) { title = value; titleWrites++; },
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(0, end), context, { filename: 'io_close_dirty_title.js' });
  vm.runInContext(
    source.slice(source.lastIndexOf("window.addEventListener('beforeunload'")),
    context,
    { filename: 'io_close_beforeunload.js' },
  );
  context.setCurrentFilePath = (value) => {
    context._nextFilePath = value;
    vm.runInContext('currentFilePath = _nextFilePath', context);
  };
  Object.defineProperty(context, 'titleWrites', { get: () => titleWrites });
  return context;
}

function addHistory(context, revision, objects = context.objects) {
  context.boardHistory.length = context.historyIndex + 1;
  context.boardHistory.push({ revision, objects: structuredClone(objects) });
  context.historyIndex++;
}

test('saved board title follows content revisions while no-op edit entries stay clean', () => {
  const context = loadDirtyTitleHarness();
  context.setCurrentFilePath('/boards/boardgirl2.bf');
  context.objects = [{ id: 'text-1', type: 'text', data: { content: 'before' } }];
  addHistory(context, 1);
  context.markSaved();
  assert.equal(context.document.title, 'boardgirl2.bf');

  addHistory(context, 1); // text-edit-enter does not change persisted content.
  context.objects[0].data.content = 'after';
  addHistory(context, 2);
  context.updateTitle();
  assert.equal(context.document.title, '* boardgirl2.bf');

  const closeEvent = {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  context.beforeUnloadHandler(closeEvent);
  assert.equal(closeEvent.prevented, true);
  assert.equal(closeEvent.returnValue, '');

  // Canceling the browser close is state-neutral; the first undo restores the saved revision.
  context.historyIndex--;
  context.objects = structuredClone(context.boardHistory[context.historyIndex].objects);
  context.updateTitle();
  assert.equal(context.isDirty(), false);
  assert.equal(context.document.title, 'boardgirl2.bf');
});

test('saved revision survives a branch that reuses its former history index', () => {
  const context = loadDirtyTitleHarness();
  context.setCurrentFilePath('/boards/branch.bf');
  context.objects = [{ id: 'text-1', type: 'text', data: { content: 'one' } }];
  addHistory(context, 1);
  context.objects[0].data.content = 'saved';
  addHistory(context, 2);
  context.markSaved();

  context.historyIndex--;
  context.objects[0].data.content = 'branched';
  addHistory(context, 3);
  context.updateTitle();
  assert.equal(context.isDirty(), true);
  assert.equal(context.document.title, '* branch.bf');
});

test('unsaved new boards never show a dirty star and identical titles skip writes', () => {
  const context = loadDirtyTitleHarness();
  context.objects = [{ id: 'text-1', type: 'text', data: { content: 'new' } }];
  addHistory(context, 1);
  context._dirtyIds.add('text-1');
  context.updateTitle();
  context.updateTitle();
  assert.equal(context.isDirty(), true);
  assert.equal(context.document.title, 'Boardfish');
  assert.equal(context.titleWrites, 0);
});
