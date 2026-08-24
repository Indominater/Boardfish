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
  const selectedObject = options.selectedObject || options.selectedObjects?.[0] || textObject;
  const selectedObjects = options.selectedObjects || [selectedObject];
  let nowMs = 0;
  const calls = {
    canvasToPngBlob: 0,
    copiedImages: [],
    copiedTexts: [],
    copiedTokens: [],
    debugEnds: [],
    debugSteps: [],
    insertedImages: [],
    jsClipboards: [],
    jello: [],
    objectJello: [],
    deleted: 0,
    pendingImageCopyResolves: [],
    pendingPngBlobResolves: [],
    pendingTextCopyResolves: [],
    pendingTokenCopyResolves: [],
    pulses: 0,
    renderImageToCanvas: 0,
    renders: [],
    resolveNextCopiedText(result = { boardfishTokenWritten: true }) {
      const pending = calls.pendingTextCopyResolves.shift();
      if (!pending) throw new Error('No pending text copy to resolve');
      pending.resolve(result);
    },
    rejectNextCopiedText(error = new Error('clipboard text write failed')) {
      const pending = calls.pendingTextCopyResolves.shift();
      if (!pending) throw new Error('No pending text copy to reject');
      pending.reject(error);
    },
    resolveNextCopiedImage(result = { boardfishTokenWritten: true }) {
      const pending = calls.pendingImageCopyResolves.shift();
      if (!pending) throw new Error('No pending image copy to resolve');
      pending.resolve(result);
    },
    rejectNextCopiedImage(error = new Error('clipboard image write failed')) {
      const pending = calls.pendingImageCopyResolves.shift();
      if (!pending) throw new Error('No pending image copy to reject');
      pending.reject(error);
    },
    resolveNextCopiedToken(result = { boardfishTokenWritten: true }) {
      const pending = calls.pendingTokenCopyResolves.shift();
      if (!pending) throw new Error('No pending token copy to resolve');
      pending.resolve(result);
    },
    resolveNextPngBlob(blob = options.renderedBlob || null) {
      const pending = calls.pendingPngBlobResolves.shift();
      if (!pending) throw new Error('No pending PNG blob to resolve');
      pending.resolve(blob);
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
    objects: [],
    selectedIds: new Set(selectedObjects.map((obj) => obj.id)),
    objectsMap: new Map(selectedObjects.map((obj) => [obj.id, obj])),
    textObject,
    selectedObject,
    calls,
    BoardfishClipboardIO: {
      copyBoardfishTokenToClipboard(token) {
        calls.copiedTokens.push(token);
        if (options.deferCopyToken) {
          return new Promise((resolve, reject) => calls.pendingTokenCopyResolves.push({ resolve, reject }));
        }
        return Promise.resolve({ boardfishTokenWritten: true });
      },
      copyImageBlobToClipboard(blobOrPromise, token) {
        calls.copiedImages.push({ blob: blobOrPromise, token });
        const blobPromise = Promise.resolve(blobOrPromise);
        const writePromise = options.deferCopyImage
          ? new Promise((resolve, reject) => calls.pendingImageCopyResolves.push({ resolve, reject }))
          : Promise.resolve({ boardfishTokenWritten: true });
        return Promise.all([blobPromise, writePromise]).then(([, result]) => result);
      },
      copyTextToClipboard(text) {
        calls.copiedTexts.push(text);
        if (options.deferCopyText) {
          return new Promise((resolve, reject) => calls.pendingTextCopyResolves.push({ resolve, reject }));
        }
        return Promise.resolve({ boardfishTokenWritten: true });
      },
    },
    BoardfishImageStore: {
      getSource() { return options.imageSource || ''; },
    },
    BoardfishWebBoardContainer: options.BoardfishWebBoardContainer,
    BoardfishMotion: {
      applyCopyFeedback(payload = {}) {
        if (payload.textSelection) calls.jello.push({ ...payload.textSelection });
        if (payload.objects) calls.objectJello.push(payload.objects.map((obj) => obj.id));
        if (payload.selection) calls.pulses++;
        return true;
      },
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
    imageFileDebugName: (file, fallback = 'clipboard-image') => file?.name || `${fallback}.${file?.type === 'image/jpeg' ? 'jpg' : 'png'}`,
    async insertImageFiles(files, x, y, source) { calls.insertedImages.push({ files, x, y, source }); context.objects.push({}); },
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
      if (options.deferCanvasToPngBlob) {
        return new Promise((resolve, reject) => calls.pendingPngBlobResolves.push({ resolve, reject }));
      }
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
    setJsClipboard(value) {
      calls.jsClipboards.push(value);
      return 'clip-token';
    },
    deleteSelected() {
      calls.deleted++;
      context.selectedIds.clear();
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.copySelected = copySelected;\nglobalThis.cutSelected = cutSelected;\nglobalThis.pasteWebImageBlob = pasteWebImageBlob;\n`, context, {
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
    clones: 0,
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
    },
    _jsClipboardWebMaybeStale: false,
    _pasteInProgress: false,
    historyIndex: 0,
    zCounter: 1,
    BoardfishClipboardIO: {
      describeClipboardData() { return {}; },
      readBoardfishClipboardTokenFromEvent() { return ''; },
      readBoardfishClipboardTokenFromBrowser() { calls.histories.push('browser-token-read'); return Promise.resolve({ checked: true, token: '' }); },
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
      applyCopyFeedback() {},
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
      calls.clones++;
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

function loadTextEditCopyHarness(value, options = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/context_menu.js'), 'utf8');
  const start = source.indexOf('const getTextEditSelectionState');
  const end = source.indexOf('const deleteTextEditSelection', start);
  assert.ok(start >= 0 && end > start, 'text edit copy helpers are missing');
  const calls = {
    copiedTexts: [],
    jello: [],
    pendingTextCopyResolves: [],
    renders: [],
    resolveNextCopiedText(result = {}) {
      const pending = calls.pendingTextCopyResolves.shift();
      if (!pending) throw new Error('No pending text copy to resolve');
      pending.resolve(result);
    },
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
        if (options.deferCopyText) {
          return new Promise((resolve, reject) => calls.pendingTextCopyResolves.push({ resolve, reject }));
        }
        return Promise.resolve();
      },
    },
    BoardfishMotion: {
      applyCopyFeedback(payload = {}) {
        if (payload.textSelection) calls.jello.push({ ...payload.textSelection });
      },
    },
    MenuDebug: { log() {} },
    clearJsClipboard() {},
    focusTextEditProxyNow(proxy) { proxy?.focus({ preventScroll: true }); },
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

  context.setJsClipboard({ type: 'objects', objects: [{ id: 'obj-1' }] });
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

  context.setJsClipboard({ type: 'objects', objects: [{ id: 'obj-1' }] });
  context.forceJsClipboardSetAt(Date.now() - 1000);
  context.markJsClipboardMaybeStaleFromWebBlur();

  assert.equal(await context.jsClipboardStillCurrent(null, {
    webClipboardTokenChecked: true,
    webClipboardToken: '',
  }), false);
});

test('clipboard IO writes the same rich image representations on every reported platform', async () => {
  const previous = {
    BoardfishWebLimits: globalThis.BoardfishWebLimits,
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
    globalThis.BoardfishWebLimits = { textByteLength: (text) => Buffer.byteLength(String(text)) };
    globalThis.ClipboardItem = FakeClipboardItem;
    globalThis.ClipDebug = { step() {} };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent: '',
        userAgentData: { platform: '' },
        clipboard: {
          async write(items) {
            writes.push(items[0]);
            await Promise.all(Object.values(items[0].parts).map((part) => Promise.resolve(part)));
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

    let resolveImageBlob;
    const pendingImageBlob = new Promise((resolve) => { resolveImageBlob = resolve; });
    let imageCopySettled = false;
    const imageCopyPromise = ClipboardIO.copyImageBlobToClipboard(pendingImageBlob, 'bf-image')
      .then((result) => {
        imageCopySettled = true;
        return result;
      });

    // The browser write must begin in the copy event, before PNG encoding or
    // the HTML data URL representation has finished.
    assert.equal(writes.length, 2);
    assert.equal(typeof writes[1].parts['image/png']?.then, 'function');
    assert.equal(typeof writes[1].parts['text/html']?.then, 'function');
    await Promise.resolve();
    assert.equal(imageCopySettled, false);

    resolveImageBlob(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    const imageResult = await imageCopyPromise;
    assert.equal(imageResult.boardfishTokenWritten, true);
    const imageBlob = await writes[1].parts['image/png'];
    assert.equal(imageBlob.type, 'image/png');
    const imageHtmlBlob = await writes[1].parts['text/html'];
    const imageHtml = await imageHtmlBlob.text();
    assert.match(imageHtml, /boardfish-clipboard:bf-image/);
    assert.match(imageHtml, /<img src="data:image\/png;base64,AQID" alt="">/);

    globalThis.navigator.userAgentData.platform = 'Android';
    let resolveAndroidImageBlob;
    const pendingAndroidImageBlob = new Promise((resolve) => { resolveAndroidImageBlob = resolve; });
    const androidCopyPromise = ClipboardIO.copyImageBlobToClipboard(
      pendingAndroidImageBlob,
      'bf-android-image',
    );
    assert.equal(writes.length, 3);
    assert.deepEqual(Object.keys(writes[2].parts), ['image/png', 'text/html']);
    assert.equal(typeof writes[2].parts['image/png']?.then, 'function');
    assert.equal(typeof writes[2].parts['text/html']?.then, 'function');
    resolveAndroidImageBlob(new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' }));
    const androidResult = await androidCopyPromise;
    assert.equal(androidResult.boardfishTokenWritten, true);
    assert.match(await (await writes[2].parts['text/html']).text(), /boardfish-clipboard:bf-android-image/);

    globalThis.navigator.userAgentData.platform = '';
    globalThis.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36';
    const androidUaBlob = new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' });
    const androidUaResult = await ClipboardIO.copyImageBlobToClipboard(
      androidUaBlob,
      'bf-android-ua-image',
    );
    assert.equal(writes.length, 4);
    assert.deepEqual(Object.keys(writes[3].parts), ['image/png', 'text/html']);
    assert.equal(writes[3].parts['image/png'], androidUaBlob);
    assert.equal(androidUaResult.boardfishTokenWritten, true);
    assert.match(await (await writes[3].parts['text/html']).text(), /boardfish-clipboard:bf-android-ua-image/);

    globalThis.navigator.userAgent = '';
    class DirectBlobOnlyClipboardItem {
      constructor(parts) {
        if (Object.values(parts).some((part) => typeof part?.then === 'function')) {
          throw new TypeError('promised clipboard representations are unsupported');
        }
        this.parts = parts;
      }
    }
    globalThis.ClipboardItem = DirectBlobOnlyClipboardItem;
    const legacyBlob = new Blob([new Uint8Array([10, 11, 12])], { type: 'image/png' });
    const legacyResult = await ClipboardIO.copyImageBlobToClipboard(legacyBlob, 'bf-legacy-image');
    assert.equal(writes.length, 5);
    assert.deepEqual(Object.keys(writes[4].parts), ['image/png']);
    assert.equal(writes[4].parts['image/png'], legacyBlob);
    assert.equal(legacyResult.boardfishTokenWritten, false);

    const textResult = await ClipboardIO.copyTextToClipboard(
      'A&<\r\nB\rC\nD',
      null,
      { boardfishToken: 'bf-rich-text' },
    );
    assert.equal(textResult.boardfishTokenWritten, true);
    assert.equal(writes.length, 6);
    assert.equal(await writes[5].parts['text/plain'].text(), 'A&<\r\nB\rC\nD');
    assert.equal(
      await writes[5].parts['text/html'].text(),
      '<!--boardfish-clipboard:bf-rich-text--><div>A&amp;&lt;<br>B<br>C<br>D</div>',
    );
  } finally {
    delete require.cache[require.resolve('../src/js/clipboard_io.js')];
    if (previous.BoardfishWebLimits === undefined) delete globalThis.BoardfishWebLimits;
    else globalThis.BoardfishWebLimits = previous.BoardfishWebLimits;
    if (previous.ClipboardItem === undefined) delete globalThis.ClipboardItem;
    else globalThis.ClipboardItem = previous.ClipboardItem;
    if (previous.ClipDebug === undefined) delete globalThis.ClipDebug;
    else globalThis.ClipDebug = previous.ClipDebug;
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
    else delete globalThis.navigator;
  }
});

test('copying a selected text object jiggles after its clipboard write finishes', async () => {
  const context = loadClipboardExportHarness({ deferCopyText: true });

  const copyResult = context.copySelected();

  assert.equal('imageData' in context.calls.jsClipboards[0], false);
  assert.deepEqual(context.calls.copiedTexts, [context.textObject.data.content]);
  assert.deepEqual(context.calls.jello, []);
  assert.deepEqual(context.calls.objectJello, []);
  assert.equal(context.calls.pulses, 0);
  assert.deepEqual(context.calls.renders, []);

  assert.equal(copyResult, true);
  assert.equal(context.calls.pendingTextCopyResolves.length, 1);
  context.calls.resolveNextCopiedText();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(context.calls.objectJello.map((ids) => [...ids]), [['text-1']]);
});

test('a failed text write does not start copy feedback', async () => {
  const context = loadClipboardExportHarness({ deferCopyText: true });
  context.console = { error() {} };

  assert.equal(context.copySelected(), true);
  assert.deepEqual(context.calls.objectJello, []);
  context.calls.rejectNextCopiedText();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(context.calls.objectJello, []);
});

test('copying an ordinary object starts feedback after its in-app clipboard copy', () => {
  const shape = {
    id: 'shape-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    w: 120,
    h: 80,
    z: 1,
    data: {},
  };
  const context = loadClipboardExportHarness({ selectedObject: shape });

  assert.equal(context.copySelected(), true);
  assert.equal(context.calls.jsClipboards.length, 1);
  assert.equal(context.calls.jsClipboards[0].type, 'objects');
  assert.deepEqual([...context.calls.jsClipboards[0].objects].map((obj) => obj.id), ['shape-1']);
  assert.deepEqual(context.calls.objectJello.map((ids) => [...ids]), [['shape-1']]);
});

test('copying multiple objects jiggles after the browser clipboard marker settles', async () => {
  const first = {
    id: 'shape-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    w: 120,
    h: 80,
    z: 1,
    data: {},
  };
  const second = {
    id: 'shape-2',
    type: 'ellipse',
    x: 160,
    y: 0,
    w: 120,
    h: 80,
    z: 2,
    data: {},
  };
  const context = loadClipboardExportHarness({
    selectedObjects: [first, second],
    deferCopyToken: true,
  });

  assert.equal(context.copySelected(), true);
  assert.deepEqual([...context.calls.jsClipboards[0].objects].map((obj) => obj.id), ['shape-1', 'shape-2']);
  assert.deepEqual(context.calls.copiedTokens, ['web-token']);
  assert.equal(context.calls.pulses, 0);

  context.calls.resolveNextCopiedToken();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(context.calls.pulses, 1);
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

test('cutting a selected image keeps copy feedback disabled after the system write settles', async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71]);
  const imageSource = { web: true, mime: 'image/png' };
  const imageObject = {
    id: 'image-cut',
    type: 'image',
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    z: 1,
    data: { imgKey: 'img-cut' },
  };
  const context = loadClipboardExportHarness({
    selectedObject: imageObject,
    imageSource,
    BoardfishWebBoardContainer: {
      blobForImageSource() { return new Blob([pngBytes], { type: 'image/png' }); },
      bytesForImageSource() { return pngBytes; },
    },
    isWebImageRef: (source) => source?.web === true,
    deferCopyImage: true,
  });

  assert.equal(context.cutSelected(), true);
  assert.equal(context.calls.copiedImages.length, 1);
  assert.deepEqual(context.calls.objectJello, []);
  assert.equal(context.calls.deleted, 1);

  context.calls.resolveNextCopiedImage();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(context.calls.objectJello, []);
});

test('copying an untransformed web PNG image writes source bytes without rendering', async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageSource = {
    web: true,
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
  assert.deepEqual(context.calls.objectJello.map((ids) => [...ids]), [['image-1']]);
  assert.equal(context.calls.debugSteps.some((entry) => entry.step === 'copy:web-source-png-blob'), true);
  assert.equal(context.calls.debugEnds.at(-1).path, 'image-web-source-png');
});

test('copying a transformed image starts the clipboard write before PNG encoding finishes', async () => {
  const renderedBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const imageObject = {
    id: 'image-transformed',
    type: 'image',
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    z: 1,
    data: { imgKey: 'img-transformed', rotation: 90 },
  };
  const context = loadClipboardExportHarness({
    selectedObject: imageObject,
    imageNeedsRendering: () => true,
    renderedCanvas: {},
    renderedBlob,
    deferCanvasToPngBlob: true,
    deferCopyImage: true,
  });

  let copySettled = false;
  const copyPromise = context.copySelected().then((result) => {
    copySettled = true;
    return result;
  });

  assert.equal(context.calls.renderImageToCanvas, 1);
  assert.equal(context.calls.canvasToPngBlob, 1);
  assert.equal(context.calls.copiedImages.length, 1);
  assert.equal(context.calls.copiedImages[0].token, 'web-token');
  assert.equal(typeof context.calls.copiedImages[0].blob?.then, 'function');
  assert.equal(copySettled, false);
  assert.deepEqual(context.calls.objectJello, []);

  context.calls.resolveNextPngBlob();
  assert.equal(await context.calls.copiedImages[0].blob, renderedBlob);
  assert.equal(copySettled, false);
  assert.deepEqual(context.calls.objectJello, []);

  context.calls.resolveNextCopiedImage();
  assert.equal(await copyPromise, true);
  assert.deepEqual(context.calls.objectJello.map((ids) => [...ids]), [['image-transformed']]);
});

test('a rejected system image write does not start copy feedback', async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71]);
  const imageSource = { web: true, mime: 'image/png' };
  const imageObject = {
    id: 'image-failed-copy',
    type: 'image',
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    z: 1,
    data: { imgKey: 'img-failed-copy' },
  };
  const context = loadClipboardExportHarness({
    selectedObject: imageObject,
    imageSource,
    BoardfishWebBoardContainer: {
      blobForImageSource() { return new Blob([pngBytes], { type: 'image/png' }); },
      bytesForImageSource() { return pngBytes; },
    },
    isWebImageRef: (source) => source?.web === true,
    deferCopyImage: true,
  });

  context.console = { error() {} };
  const copyPromise = context.copySelected();
  assert.deepEqual(context.calls.objectJello, []);
  context.calls.rejectNextCopiedImage();

  assert.equal(await copyPromise, false);
  assert.deepEqual(context.calls.objectJello, []);
});

test('pasting an image retains typed Blobs and only adds a MIME view when missing', async () => {
  const context = loadClipboardExportHarness();
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const typed = new Blob([bytes], { type: 'image/png' });
  Object.defineProperty(typed, 'arrayBuffer', { value() { throw new Error('paste should not materialize Blob bytes'); } });
  await context.pasteWebImageBlob(typed, 10, 20, 'web-paste-browser');
  assert.equal(context.calls.insertedImages[0].files[0], typed);
  const untyped = new Blob([bytes]);
  await context.pasteWebImageBlob(untyped, 30, 40, 'web-paste-event');
  const typedView = context.calls.insertedImages[1].files[0];
  assert.deepEqual({ type: typedView.type, size: typedView.size }, { type: 'image/png', size: untyped.size });
  assert.deepEqual(new Uint8Array(await typedView.arrayBuffer()), bytes);
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

test('copying highlighted text jiggles after the context-menu clipboard write finishes', async () => {
  const context = loadTextEditCopyHarness('selected text', { deferCopyText: true });

  const copyPromise = context.copyTextEditSelection();

  assert.deepEqual(context.calls.copiedTexts, ['selected text']);
  assert.deepEqual(context.calls.jello, []);
  assert.equal(context.calls.pendingTextCopyResolves.length, 1);

  context.calls.resolveNextCopiedText();
  await copyPromise;
  assert.deepEqual(context.calls.jello, [{
    id: 'text-1',
    start: 0,
    end: 'selected text'.length,
    direction: 'none',
    hasSelection: true,
  }]);
});

test('pasting Boardfish text objects strips whitespace-only edge lines from the pasted clone', async () => {
  const { context, sourceTextObject } = loadClipboardPasteObjectsHarness();

  await context.pasteAtPos(300, 200);

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
  context._jsClipboardWebMaybeStale = true;
  await context.pasteAtPos(300, 200);
  assert.equal(context.calls.clones, 0);
  assert.deepEqual([context.calls.synced, context.calls.textBytes, context.calls.added, context.calls.histories], [[], [], [], ['browser-token-read']]);
});
