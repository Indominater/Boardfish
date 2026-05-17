'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadClipboardStateHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/clipboard_state.js'), 'utf8');
  let tokenId = 0;
  const context = {
    console,
    Date,
    Promise,
    Set,
    crypto: {
      randomUUID() {
        tokenId++;
        return `test-token-${tokenId}`;
      },
    },
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    hasTauri: () => false,
    performance: { now: () => 0 },
    window: {
      addEventListener() {},
    },
    ClipDebug: {
      step() {},
      wrap(_dbg, _command, task) {
        return task();
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\n` +
      'globalThis.setJsClipboard = setJsClipboard;\n' +
      'globalThis.clearJsClipboard = clearJsClipboard;\n' +
      'globalThis.getJsClipboardWebToken = getJsClipboardWebToken;\n' +
      'globalThis.markJsClipboardWebTokenOnNative = markJsClipboardWebTokenOnNative;\n' +
      'globalThis.markJsClipboardMaybeStaleFromWebBlur = markJsClipboardMaybeStaleFromWebBlur;\n' +
      'globalThis.jsClipboardStillCurrent = jsClipboardStillCurrent;\n' +
      'globalThis.forceJsClipboardSetAt = (value) => { _jsClipboardSetAt = value; };\n',
    context,
    { filename: 'clipboard_state.js' },
  );
  return context;
}

function loadClipboardExportHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/clipboard_export_init.js'), 'utf8');
  const textObject = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 80,
    z: 1,
    data: { content: 'first line\nsecond line' },
  };
  const calls = {
    copiedTexts: [],
    jello: [],
    objectJello: [],
    pulses: 0,
    renders: [],
  };
  const context = {
    console,
    Promise,
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    window: {
      addEventListener() {},
    },
    selectedIds: new Set([textObject.id]),
    textObject,
    calls,
    BoardfishClipboardIO: {
      copyTextToClipboard(text) {
        calls.copiedTexts.push(text);
        return Promise.resolve({ boardfishTokenWritten: true });
      },
    },
    BoardfishImageStore: {
      getSource() { return ''; },
    },
    BoardfishMotion: {
      applyActionAnimation(action, payload = {}) {
        if (payload.textSelection) calls.jello.push({ ...payload.textSelection });
        if (payload.objects) calls.objectJello.push({
          action,
          ids: payload.objects.map((obj) => obj.id),
        });
        if (payload.selection) calls.pulses++;
        return action !== 'menu-command-press';
      },
      noteTextSelectionJello(spec) { calls.jello.push({ ...spec }); },
      pulseSelection() { calls.pulses++; },
    },
    ClipDebug: {
      end() {},
      start() { return {}; },
      step() {},
    },
    cloneObject(obj) {
      return { ...obj, data: { ...obj.data } };
    },
    finishNativeClipboardWrite() {},
    getFirstSelectedObject() {
      return textObject;
    },
    getJsClipboardWebToken() {
      return 'web-token';
    },
    hasTauri() {
      return false;
    },
    markJsClipboardWebTokenOnNative() {},
    normalizeTextContent(value) {
      return String(value ?? '').replace(/\r\n?/g, '\n');
    },
    resizeCanvas() {},
    scheduleRender(board, overlay, sourceName) {
      calls.renders.push({ board, overlay, source: sourceName });
    },
    setJsClipboard() {
      return 'clip-token';
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.copySelected = copySelected;\n`, context, {
    filename: 'clipboard_export_init.js',
  });
  return context;
}

test('web js clipboard stays current only while its browser clipboard marker matches', async () => {
  const context = loadClipboardStateHarness();

  context.setJsClipboard({ type: 'objects', objects: [{ id: 'obj-1' }], imageData: {} });
  const token = context.getJsClipboardWebToken();
  context.markJsClipboardWebTokenOnNative(token);

  assert.equal(await context.jsClipboardStillCurrent(null, {
    webClipboardTokenChecked: true,
    webClipboardToken: token,
  }), true);

  assert.equal(await context.jsClipboardStillCurrent(null, {
    webClipboardTokenChecked: true,
    webClipboardToken: '',
  }), false);
});

test('web js clipboard without a native marker is invalidated after leaving the page', async () => {
  const context = loadClipboardStateHarness();

  context.setJsClipboard({ type: 'objects', objects: [{ id: 'obj-1' }], imageData: {} });
  context.forceJsClipboardSetAt(Date.now() - 1000);
  context.markJsClipboardMaybeStaleFromWebBlur();

  assert.equal(await context.jsClipboardStillCurrent(null, {
    webClipboardTokenChecked: true,
    webClipboardToken: '',
  }), false);
});

test('clipboard IO extracts and writes Boardfish web clipboard markers', async () => {
  const previous = {
    ClipboardItem: globalThis.ClipboardItem,
    ClipDebug: globalThis.ClipDebug,
    hasTauri: globalThis.hasTauri,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  const writes = [];
  class FakeClipboardItem {
    constructor(parts) {
      this.parts = parts;
    }
  }

  try {
    globalThis.ClipboardItem = FakeClipboardItem;
    globalThis.ClipDebug = { step() {} };
    globalThis.hasTauri = () => false;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          async write(items) {
            writes.push(items[0]);
          },
        },
      },
    });

    delete require.cache[require.resolve('../src/js/clipboard_io.js')];
    const ClipboardIO = require('../src/js/clipboard_io.js');

    const token = ClipboardIO.readBoardfishClipboardTokenFromEvent({
      getData(type) {
        return type === 'text/html' ? '<p>x</p><!--boardfish-clipboard:bf-test.1-->' : '';
      },
    });
    assert.equal(token, 'bf-test.1');

    const result = await ClipboardIO.copyBoardfishTokenToClipboard('bf-written');
    assert.equal(result.boardfishTokenWritten, true);
    assert.equal(writes.length, 1);
    assert.equal(await writes[0].parts['text/plain'].text(), '');
    assert.match(await writes[0].parts['text/html'].text(), /boardfish-clipboard:bf-written/);
  } finally {
    delete require.cache[require.resolve('../src/js/clipboard_io.js')];
    if (previous.ClipboardItem === undefined) delete globalThis.ClipboardItem;
    else globalThis.ClipboardItem = previous.ClipboardItem;
    if (previous.ClipDebug === undefined) delete globalThis.ClipDebug;
    else globalThis.ClipDebug = previous.ClipDebug;
    if (previous.hasTauri === undefined) delete globalThis.hasTauri;
    else globalThis.hasTauri = previous.hasTauri;
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
    else delete globalThis.navigator;
  }
});

test('copying a selected text object jiggles the whole text box like other objects', async () => {
  const context = loadClipboardExportHarness();

  await context.copySelected();

  assert.deepEqual(context.calls.jello, []);
  const objectJello = context.calls.objectJello.map((call) => ({
    action: call.action,
    ids: [...call.ids],
  }));
  assert.deepEqual(objectJello, [{
    action: 'copy-text-object',
    ids: ['text-1'],
  }]);
  assert.equal(context.calls.pulses, 0);
  assert.deepEqual(context.calls.renders, [{
    board: true,
    overlay: true,
    source: 'copy-text-object',
  }]);
  assert.deepEqual(context.calls.copiedTexts, [context.textObject.data.content]);
});
