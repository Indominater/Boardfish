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

function loadClipboardExportHarness(options = {}) {
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
    pendingTextCopyResolves: [],
    pulses: 0,
    renders: [],
    resolveNextCopiedText(result = { boardfishTokenWritten: true }) {
      const resolve = calls.pendingTextCopyResolves.shift();
      if (!resolve) throw new Error('No pending text copy to resolve');
      resolve(result);
    },
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
        if (options.deferCopyText) {
          return new Promise((resolve) => calls.pendingTextCopyResolves.push(resolve));
        }
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
    textForClipboard(value) {
      const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
      let first = 0;
      let last = lines.length - 1;
      while (first <= last && !/\S/.test(lines[first])) first++;
      while (last >= first && !/\S/.test(lines[last])) last--;
      return first <= last ? lines.slice(first, last + 1).join('\n') : '';
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

function loadClipboardPasteObjectsHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/clipboard_export_init.js'), 'utf8');
  const sourceTextObject = {
    id: 'text-source',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 128,
    z: 1,
    data: { content: '   \n\t\nfirst line\nsecond line\n   \n\t' },
  };
  const calls = {
    added: [],
    histories: [],
    selections: [],
    synced: [],
  };
  const context = {
    console,
    Promise,
    TextEncoder,
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    window: {
      addEventListener() {},
    },
    performance: { now: () => 0 },
    calls,
    objects: [],
    jsClipboard: {
      type: 'objects',
      objects: [sourceTextObject],
      imageData: {},
    },
    _pasteInProgress: false,
    eyedropperEnabled: false,
    historyIndex: 0,
    zCounter: 1,
    BoardfishClipboardIO: {
      describeClipboardData() { return {}; },
      readBoardfishClipboardTokenFromEvent() { return ''; },
    },
    BoardfishEditorState: {
      addObject(obj) {
        context.objects.push(obj);
        calls.added.push(obj);
      },
      setSelection(ids, options = {}) {
        calls.selections.push({ ids, options });
      },
    },
    BoardfishImageStore: {
      hasSource() { return true; },
      setSource() {},
    },
    BoardfishMotion: {
      applyActionAnimation() {},
    },
    BoardfishWebLimits: {
      canAddObjects() { return true; },
      canAcceptAdditionalContentBytes() { return true; },
      imageSourceByteLength() { return 0; },
    },
    ClipDebug: {
      end() {},
      start() { return {}; },
      step() {},
    },
    cloneObjects(list) {
      return JSON.parse(JSON.stringify(list));
    },
    hasTauri() {
      return false;
    },
    jsClipboardStillCurrent() {
      return Promise.resolve(true);
    },
    newId() {
      return 'text-pasted';
    },
    resizeCanvas() {},
    scheduleRender() {},
    pushHistory(reason) {
      calls.histories.push(reason);
    },
    syncTextAutoHeight(obj) {
      calls.synced.push(obj.id);
      obj.h = 56;
      return true;
    },
    textForTextObjectPaste(value) {
      const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
      let first = 0;
      let last = lines.length - 1;
      while (first <= last && !/\S/.test(lines[first])) first++;
      while (last >= first && !/\S/.test(lines[last])) last--;
      return first <= last ? lines.slice(first, last + 1).join('\n') : '';
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.pasteAtPos = pasteAtPos;\n`, context, {
    filename: 'clipboard_export_init.js',
  });
  return { context, sourceTextObject };
}

function loadTextEditCopyHarness(value) {
  const source = fs.readFileSync(path.join(root, 'src/js/context_menu.js'), 'utf8');
  const start = source.indexOf('const getTextEditSelectionState');
  const end = source.indexOf('const cutTextEditSelection', start);
  assert.ok(start >= 0 && end > start, 'text edit copy helpers are missing');
  const calls = {
    copiedTexts: [],
    jello: [],
    renders: [],
  };
  const editProxy = {
    value,
    selectionStart: 0,
    selectionEnd: value.length,
    selectionDirection: 'none',
    focus() {},
  };
  const context = {
    console,
    editingId: 'text-1',
    _editEl: editProxy,
    calls,
    BoardfishClipboardIO: {
      copyTextToClipboard(text) {
        calls.copiedTexts.push(text);
        return Promise.resolve();
      },
    },
    BoardfishMotion: {
      applyActionAnimation(_action, payload = {}) {
        if (payload.textSelection) calls.jello.push({ ...payload.textSelection });
      },
    },
    MenuDebug: { log() {} },
    clearJsClipboard() {},
    scheduleRender(board, overlay, sourceName) {
      calls.renders.push({ board, overlay, source: sourceName });
    },
    textForClipboard(text) {
      const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
      let last = lines.length - 1;
      while (last >= 0 && !/\S/.test(lines[last])) last--;
      return last >= 0 ? lines.slice(0, last + 1).join('\n') : '';
    },
    textSelectionForClipboard(text) {
      const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
      let first = 0;
      let last = lines.length - 1;
      while (first <= last && !/\S/.test(lines[first])) first++;
      while (last >= first && !/\S/.test(lines[last])) last--;
      return first <= last ? lines.slice(first, last + 1).join('\n') : '';
    },
  };

  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\n` +
      'globalThis.copyTextEditSelection = copyTextEditSelection;\n',
    context,
    { filename: 'context_menu_text_copy.js' },
  );
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

test('copying a selected text object jiggles immediately while clipboard write continues', async () => {
  const context = loadClipboardExportHarness({ deferCopyText: true });

  const copyPromise = context.copySelected();

  assert.deepEqual(context.calls.copiedTexts, [context.textObject.data.content]);
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

  assert.equal(await copyPromise, true);
  assert.equal(context.calls.pendingTextCopyResolves.length, 1);
  context.calls.resolveNextCopiedText();
  await Promise.resolve();
});

test('copying a text object omits whitespace-only lines at plain clipboard edges', async () => {
  const context = loadClipboardExportHarness();
  context.textObject.data.content = '   \n\t\n  first line  \n second line\t \n   \n\t';

  await context.copySelected();

  assert.deepEqual(context.calls.copiedTexts, ['  first line  \n second line\t ']);
});

test('copying highlighted text omits whitespace-only lines at selection edges', async () => {
  const context = loadTextEditCopyHarness('   \n\t\n  first line  \n second line\t \n   \n\t');

  await context.copyTextEditSelection();

  assert.deepEqual(context.calls.copiedTexts, ['  first line  \n second line\t ']);
  assert.deepEqual(context.calls.jello, [{
    id: 'text-1',
    start: 0,
    end: context._editEl.value.length,
    direction: 'none',
    hasSelection: true,
  }]);
});

test('pasting Boardfish text objects strips whitespace-only edge lines from the pasted clone', async () => {
  const { context, sourceTextObject } = loadClipboardPasteObjectsHarness();

  await context.pasteAtPos(300, 200, {
    getData() { return ''; },
  });

  assert.equal(context.calls.added.length, 1);
  assert.equal(context.calls.added[0].data.content, 'first line\nsecond line');
  assert.equal(context.calls.added[0].h, 56);
  assert.equal(sourceTextObject.data.content, '   \n\t\nfirst line\nsecond line\n   \n\t');
  assert.deepEqual(context.calls.histories, ['paste-objects']);
});
