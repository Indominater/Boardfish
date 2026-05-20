'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWebRuntimeHarness({ clickSelectsFile = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'web_runtime.js'), 'utf8');
  const timers = [];
  const rootListeners = new Map();
  const inputListeners = new Map();
  const calls = {
    appended: 0,
    clicked: 0,
    removed: 0,
  };
  const selectedFile = {
    name: 'board.bf',
    type: 'application/octet-stream',
  };
  const input = {
    type: '',
    accept: '',
    style: {},
    files: [],
    addEventListener(type, handler) {
      inputListeners.set(type, handler);
    },
    click() {
      calls.clicked++;
      if (clickSelectsFile) {
        input.files = [selectedFile];
        inputListeners.get('change')?.();
      }
    },
    remove() {
      calls.removed++;
    },
  };
  const context = {
    console,
    Blob,
    Promise,
    Uint8Array,
    performance: { now: () => 0 },
    setTimeout(callback, delay = 0) {
      const id = timers.length + 1;
      timers.push({ callback, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].active = false;
    },
    addEventListener(type, handler) {
      rootListeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (rootListeners.get(type) === handler) rootListeners.delete(type);
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'input');
        return input;
      },
      body: {
        appendChild() {
          calls.appended++;
        },
      },
    },
    URL: {
      createObjectURL() { return 'blob:board'; },
      revokeObjectURL() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'web_runtime.js' });
  return {
    calls,
    context,
    input,
    rootListeners,
    runTimers() {
      for (const timer of [...timers]) {
        if (!timer.active) continue;
        timer.active = false;
        timer.callback();
      }
    },
  };
}

test('fallback file picker does not retain focus listener after selected file settles', async () => {
  const harness = loadWebRuntimeHarness();

  const result = await harness.context.BoardfishRuntime.openFileDialog();
  assert.equal(result.kind, 'web-file');
  assert.equal(result.file.name, 'board.bf');
  assert.equal(harness.calls.clicked, 1);
  assert.equal(harness.calls.removed, 1);

  harness.runTimers();
  assert.equal(harness.rootListeners.has('focus'), false);
});

