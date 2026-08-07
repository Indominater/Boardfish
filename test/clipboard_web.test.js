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
    clearTimeout,
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
    setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\n` +
      'globalThis.setJsClipboard = setJsClipboard;\n' +
      'globalThis.getJsClipboardWebToken = getJsClipboardWebToken;\n' +
      'globalThis.markJsClipboardWebTokenWritten = markJsClipboardWebTokenWritten;\n' +
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
  const selectedObject = options.selectedObject || textObject;
  let nowMs = 0;
  const calls = {
    canvasToPngBlob: 0,
    copiedImages: [],
    copiedTexts: [],
    debugEnds: [],
    debugSteps: [],
    jello: [],
    objectJello: [],
    deleted: 0,
    pendingImageCopyResolves: [],
    pendingTextCopyResolves: [],
    pulses: 0,
    renderImageToCanvas: 0,
    renders: [],
    resolveNextCopiedText(result = { boardfishTokenWritten: true }) {
      const resolve = calls.pendingTextCopyResolves.shift();
      if (!resolve) throw new Error('No pending text copy to resolve');
      resolve(result);
    },
    resolveNextCopiedImage(result = { boardfishTokenWritten: true }) {
      const resolve = calls.pendingImageCopyResolves.shift();
      if (!resolve) throw new Error('No pending image copy to resolve');
      resolve(result);
    },
  };
  const context = {
    Blob,
    console,
    Promise,
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    window: {
      addEventListener() {},
    },
    performance: {
      now() {
        nowMs += 1;
        return nowMs;
      },
    },
    editingId: null,
    selectedIds: new Set([selectedObject.id]),
    textObject,
    selectedObject,
    calls,
    BoardfishClipboardIO: {
      copyImageBlobToClipboard(blob, token) {
        calls.copiedImages.push({ blob, token });
        if (options.deferCopyImage) {
          return new Promise((resolve) => calls.pendingImageCopyResolves.push(resolve));
        }
        return Promise.resolve({ boardfishTokenWritten: true });
      },
      copyTextToClipboard(text) {
        calls.copiedTexts.push(text);
        if (options.deferCopyText) {
          return new Promise((resolve) => calls.pendingTextCopyResolves.push(resolve));
        }
        return Promise.resolve({ boardfishTokenWritten: true });
      },
    },
    BoardfishImageStore: {
      getSource() { return options.imageSource || ''; },
    },
    BoardfishWebBoardContainer: options.BoardfishWebBoardContainer,
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
      end(_dbg, meta = {}) { calls.debugEnds.push({ ...meta }); },
      start() { return {}; },
      step(_dbg, step, meta = {}) { calls.debugSteps.push({ step, meta: { ...meta } }); },
    },
    cloneObject(obj) {
      return { ...obj, data: { ...obj.data } };
    },
    getFirstSelectedObject() {
      return selectedObject;
    },
    hasSelection() {
      return context.selectedIds.size > 0;
    },
    getJsClipboardWebToken() {
      return 'web-token';
    },
    markJsClipboardWebTokenWritten() {},
    imageNeedsRendering: options.imageNeedsRendering || (() => false),
    isWebImageRef: options.isWebImageRef || (() => false),
    normalizeTextContent(value) {
      return String(value ?? '').replace(/\r\n?/g, '\n');
    },
    renderImageToCanvas() {
      calls.renderImageToCanvas++;
      return options.renderedCanvas || null;
    },
    canvasToPngBlob() {
      calls.canvasToPngBlob++;
      return Promise.resolve(options.renderedBlob || null);
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
    deleteSelected() {
      calls.deleted++;
      context.selectedIds.clear();
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.copySelected = copySelected;\nglobalThis.cutSelected = cutSelected;\n`, context, {
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
    editCalls: [],
    histories: [],
    selections: [],
    synced: [],
    textBytes: [],
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
      textByteLength(text) {
        calls.textBytes.push(String(text ?? ''));
        return String(text ?? '').length;
      },
    },
    ClipDebug: {
      end() {},
      start() { return {}; },
      step() {},
    },
    cloneObjects(list) {
      return JSON.parse(JSON.stringify(list));
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
    enterEdit(id, options = {}) {
      calls.editCalls.push({ id, options });
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
  const end = source.indexOf('const deleteTextEditSelection', start);
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
  context.markJsClipboardWebTokenWritten(token);

  assert.equal(await context.jsClipboardStillCurrent(null, {
    webClipboardTokenChecked: true,
    webClipboardToken: token,
  }), true);

  assert.equal(await context.jsClipboardStillCurrent(null, {
    webClipboardTokenChecked: true,
    webClipboardToken: '',
  }), false);
});

test('web js clipboard without a browser marker is invalidated after leaving the page', async () => {
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

    const imageResult = await ClipboardIO.copyImageBlobToClipboard(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      'bf-image',
    );
    assert.equal(imageResult.boardfishTokenWritten, true);
    assert.equal(writes.length, 2);
    assert.ok(writes[1].parts['image/png']);
    const imageHtml = await writes[1].parts['text/html'].text();
    assert.match(imageHtml, /boardfish-clipboard:bf-image/);
    assert.match(imageHtml, /<img src="data:image\/png;base64,AQID" alt="">/);
  } finally {
    delete require.cache[require.resolve('../src/js/clipboard_io.js')];
    if (previous.ClipboardItem === undefined) delete globalThis.ClipboardItem;
    else globalThis.ClipboardItem = previous.ClipboardItem;
    if (previous.ClipDebug === undefined) delete globalThis.ClipDebug;
    else globalThis.ClipDebug = previous.ClipDebug;
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

test('cutting a selected object copies without jiggle and deletes immediately', () => {
  const context = loadClipboardExportHarness({ deferCopyText: true });

  const cutResult = context.cutSelected();

  assert.equal(cutResult, true);
  assert.deepEqual(context.calls.copiedTexts, [context.textObject.data.content]);
  assert.deepEqual(context.calls.jello, []);
  assert.deepEqual(context.calls.objectJello, []);
  assert.equal(context.calls.pulses, 0);
  assert.equal(context.calls.deleted, 1);
  assert.equal(context.calls.pendingTextCopyResolves.length, 1);
});

test('copying an untransformed web PNG image writes source bytes without rendering', async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageSource = {
    web: true,
    objectUrl: 'blob:test-image',
    mime: 'image/png',
    bytes: pngBytes.length,
  };
  const imageObject = {
    id: 'image-1',
    type: 'image',
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    z: 1,
    data: { imgKey: 'img-1' },
  };
  const context = loadClipboardExportHarness({
    selectedObject: imageObject,
    imageSource,
    BoardfishWebBoardContainer: {
      blobForImageSource(source) {
        assert.equal(source, imageSource);
        return new Blob([pngBytes], { type: 'image/png' });
      },
      bytesForImageSource() {
        throw new Error('Blob-backed source should not be materialized before clipboard write');
      },
    },
    imageNeedsRendering: () => false,
    isWebImageRef: (source) => source?.web === true,
    deferCopyImage: true,
  });

  const copyPromise = context.copySelected();

  assert.equal(context.calls.renderImageToCanvas, 0);
  assert.equal(context.calls.canvasToPngBlob, 0);
  assert.equal(context.calls.copiedImages.length, 1);
  assert.equal(context.calls.copiedImages[0].token, 'web-token');
  assert.equal(context.calls.copiedImages[0].blob.type, 'image/png');
  assert.equal(context.calls.copiedImages[0].blob.size, pngBytes.length);
  assert.deepEqual(
    new Uint8Array(await context.calls.copiedImages[0].blob.arrayBuffer()),
    pngBytes,
  );
  assert.deepEqual(context.calls.objectJello, []);

  context.calls.resolveNextCopiedImage();
  assert.equal(await copyPromise, true);
  assert.deepEqual(context.calls.objectJello.map((call) => ({
    action: call.action,
    ids: [...call.ids],
  })), [{
    action: 'copy-selected-objects',
    ids: ['image-1'],
  }]);
  assert.equal(context.calls.debugSteps.some((entry) => entry.step === 'copy:web-source-png-blob'), true);
  assert.equal(context.calls.debugEnds.at(-1).path, 'image-web-source-png');
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
  assert.equal(context.calls.added[0].x + context.calls.added[0].w / 2, 300);
  assert.equal(context.calls.added[0].y + context.calls.added[0].h / 2, 200);
  assert.deepEqual(context.calls.textBytes, ['first line\nsecond line']);
  assert.equal(sourceTextObject.data.content, '   \n\t\nfirst line\nsecond line\n   \n\t');
  assert.deepEqual(context.calls.histories, ['paste-objects']);
  assert.deepEqual(context.calls.editCalls, []);
});

test('object-limit rejection happens before pasted text trimming and measurement', async () => {
  const { context } = loadClipboardPasteObjectsHarness();
  context.BoardfishWebLimits.canAddObjects = () => false;
  await context.pasteAtPos(300, 200, { getData: () => '' });
  assert.deepEqual([context.calls.synced, context.calls.textBytes, context.calls.added, context.calls.histories], [[], [], [], []]);
});
