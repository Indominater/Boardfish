'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSource } = require('../test-support/source.js');

function loadSaveHarness({ existing = true, outcome = 'saved' } = {}) {
  const sourceRef = existing ? { kind: 'web-file-handle', name: 'original.bf' } : null;
  const chosenRef = { kind: 'web-file-handle', name: 'copy.bf' };
  const calls = { pickers: 0, writes: [], messages: [], shields: 0, releases: 0 };
  const context = {
    BOARDFISH_PRODUCTION: true,
    objects: [{ type: 'text', data: { content: 'unsaved text' } }],
    boardHistory: [{ revision: 1 }],
    historyIndex: 0,
    _dirtyIds: new Set(['text-1']),
    long_message: 1200,
    console: { error() {} },
    document: { getElementById() { return { addEventListener() {} }; } },
    window: { addEventListener() {} },
    unsavedDialog: { addEventListener() {} },
    BoardfishExportUtils: { randomHex: () => '3ca6d7' },
    startPillTask({ message }) { calls.messages.push(message); },
    finishPillTask({ beforeFinish, finalMsg }) {
      beforeFinish();
      if (finalMsg) calls.messages.push(finalMsg);
    },
    showIslandMsg(message, duration) {
      assert.equal(duration, context.long_message);
      calls.messages.push(message);
    },
    BoardfishRuntime: {
      canSaveToExistingTarget(ref) { return ref?.kind === 'web-file-handle'; },
      describeFileRef(ref) { return ref.name; },
      fileNameFromRef(ref, fallback) { return ref?.name || fallback; },
      async saveFileDialog(defaultName) {
        assert.equal(defaultName, '3ca6d7.bf');
        calls.pickers++;
        if (outcome === 'picker-error') throw new Error('picker failed');
        return outcome === 'cancelled' ? null : chosenRef;
      },
    },
  };
  vm.createContext(context);
  for (const file of ['object_commands.js', 'io_close.js']) {
    const source = readSource(`src/js/${file}`).replace(
      /\/\* BOARDFISH_DEV_DIAGNOSTICS_START \*\/[\s\S]*?\/\* BOARDFISH_DEV_DIAGNOSTICS_END \*\//g, '',
    );
    vm.runInContext(source, context, { filename: file });
  }
  context.currentFileRef = sourceRef;
  context.currentFilePath = sourceRef?.name || null;
  context.acquireInputShield = (options) => {
    assert.equal(options.visual, false);
    assert.equal(options.keepSelectionOverlay, true);
    calls.shields++;
    let released = false;
    return () => { if (!released) calls.releases++; released = true; };
  };
  context.invokeSaveBoard = async (target, options) => {
    calls.writes.push(target);
    assert.equal(options.sourceFileRef, sourceRef);
    if (outcome === 'write-error') throw new Error('write failed');
    if (outcome === 'limit-error') throw Object.assign(new Error('Board Limit: 500 MB'), {
      boardfishLimit: true,
      boardfishUserMessage: 'Board Limit: 500 MB',
    });
  };
  return { context, calls, sourceRef, chosenRef };
}

test('save commands preserve file identity, dirty state and pill cleanup across outcomes', async () => {
  for (const mode of ['save', 'save-as', 'new-target']) {
    const outcomes = mode === 'save' ? ['saved', 'write-error', 'limit-error'] : ['saved', 'write-error', 'limit-error', 'cancelled', 'picker-error'];
    for (const outcome of outcomes) {
      const { context, calls, sourceRef, chosenRef } = loadSaveHarness({ existing: mode !== 'new-target', outcome });
      const pending = mode === 'save-as' ? context.saveBoardAs() : context.saveBoard();
      const picksTarget = mode !== 'save';
      const saved = outcome === 'saved';
      const writes = saved || outcome === 'write-error' || outcome === 'limit-error';
      const target = picksTarget ? chosenRef : sourceRef;
      const label = `${mode}: ${outcome}`;

      assert.equal(calls.pickers, Number(picksTarget), `${label}: picker must start synchronously`);
      assert.equal(await pending, saved, label);
      assert.equal(context.currentFileRef, saved ? target : sourceRef, label);
      assert.equal(context.currentFilePath, (saved ? target : sourceRef)?.name || null, label);
      assert.equal(context.isDirty(), !saved, label);
      assert.deepEqual(calls.writes, writes ? [target] : [], label);
      assert.deepEqual(calls.messages, outcome === 'cancelled' ? []
        : [...(writes ? ['Saving'] : []), saved ? 'Saved' : outcome === 'limit-error' ? 'Board Limit: 500 MB' : 'Save Failed'], label);
      assert.equal(calls.shields, 1, label);
      assert.equal(calls.releases, 1, label);
    }
  }
});

test('concurrent save commands share pending work and allow a later save', async () => {
  const { context, calls } = loadSaveHarness();
  let finishWrite;
  const pendingWrite = new Promise(resolve => { finishWrite = resolve; });
  context.invokeSaveBoard = () => pendingWrite;
  const first = context.saveBoard();
  assert.equal(context.saveBoardAs(), first);
  assert.equal(calls.pickers, 0);
  assert.equal(calls.shields, 1);
  assert.equal(calls.releases, 0);
  finishWrite();
  assert.equal(await first, true);
  const next = context.saveBoard();
  assert.notEqual(next, first);
  assert.equal(await next, true);
  assert.equal(calls.shields, 2);
  assert.equal(calls.releases, 2);
});
