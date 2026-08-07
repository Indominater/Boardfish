'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WebContainer = require('../src/js/web_board_container.js');

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

test('web board open defers image byte extraction during container read', async () => {
  const harness = loadWebRuntimeHarness();
  const seenOptions = [];
  harness.context.BoardfishWebBoardContainer = {
    async readBoardContainer(_file, options) {
      seenOptions.push(options);
      return {
        board: {
          objects: [],
          imageStore: {},
        },
        debug: {
          board_json_bytes: 2,
          image_bytes: 0,
        },
        imageEntries: [],
      };
    },
  };
  harness.context.BoardfishWebLimits = {
    LIMITS: { maxBoardContentBytes: 1024 * 1024 },
    validateBoardPayload() {},
    async validateOpenedImageEntries() {},
  };

  const ref = harness.context.BoardfishRuntime.fileRefFromFile({ name: 'board.bf', size: 6 });
  await harness.context.BoardfishRuntime.readBoard(ref);

  assert.equal(seenOptions.length, 1);
  assert.equal(seenOptions[0].lazyImageRefs, true);
  assert.equal(seenOptions[0].verifyImageCrc, false);
});

test('web save validates during the single container build and reports its actual phases', async () => {
  const harness = loadWebRuntimeHarness();
  const validations = [];
  const writes = [];
  const events = [];
  const savedBlob = new Blob([new Uint8Array([1, 2, 3])]);
  const rawImageStore = { 'img-1': 'source' };
  harness.context.BoardfishWebLimits = {
    validateBoardPayload(payload) {
      validations.push({ ...payload });
    },
  };
  harness.context.BoardfishWebBoardContainer = {
    async stabilizeVolatileImageRefs(board, imageStore) {
      events.push('stabilize-image-sources');
      assert.equal(board.objects.length, 1);
      assert.equal(imageStore, rawImageStore);
      return { refreshed: 1, bytes: 4, skipped: '' };
    },
    async createBoardContainerBlob(board, imageStore, options) {
      events.push('create-container');
      assert.equal(board.objects.length, 1);
      assert.equal(imageStore['img-1'], 'source');
      assert.equal(options.materializeBytes, false);
      options.validateBoardPayload({ objectCount: 1, boardJsonBytes: 120, imageBytes: 0 });
      options.validateBoardPayload({ objectCount: 1, boardJsonBytes: 120, imageBytes: 4 });
      return {
        blob: savedBlob,
        boardJsonBytes: 120,
        imageBytes: 4,
        imageCount: 1,
        jsonStringifyMs: 2,
        jsonEncodeMs: 3,
        imageEntriesMs: 4,
        validationMs: 5,
        zipMs: 6,
        crcMs: 7,
        crcComputedBytes: 124,
        crcComputedEntries: 2,
        crcReusedEntries: 0,
        blobImageBytes: 4,
        byteArrayImageBytes: 0,
        zipMode: 'blob-parts',
        zipBytes: 200,
      };
    },
  };
  const handle = {
    async createWritable() {
      events.push('create-writable');
      return {
        async write(blob) { events.push('write'); writes.push(blob); },
        async close() { events.push('close'); },
      };
    },
  };
  const board = { objects: [{ id: 'obj-1' }] };

  const result = await harness.context.BoardfishRuntime.saveBoard(
    { kind: 'web-save-handle', handle, name: 'board.bf' },
    board,
    { imageStore: rawImageStore },
  );

  assert.equal(validations.length, 2);
  assert.equal(writes.length, 1);
  assert.equal(result.json_bytes, 120);
  assert.equal(result.json_stringify_ms, 2);
  assert.equal(result.json_encode_ms, 3);
  assert.equal(result.source_lookup_ms, 4);
  assert.equal(result.validate_ms, 5);
  assert.equal(result.zip_ms, 6);
  assert.equal(result.crc_ms, 7);
  assert.equal(result.blob_image_bytes, 4);
  assert.equal(result.image_source_refresh_count, 1);
  assert.equal(result.image_source_refresh_bytes, 4);
  assert.equal(result.image_source_refresh_backing, 'detached-memory');
  assert.equal(result.image_source_refresh_error, '');
  assert.deepEqual(events, [
    'stabilize-image-sources',
    'create-container',
    'create-writable',
    'write',
    'close',
  ]);
});

test('same-handle saves detach File-backed images and remain readable across repeated overwrites', async () => {
  const harness = loadWebRuntimeHarness();
  const imageBytes = new Uint8Array(192 * 1024);
  for (let i = 0; i < imageBytes.length; i++) imageBytes[i] = (i * 37) % 251;
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const initial = await WebContainer.createBoardContainerBlob(board, { 'img-1': imageBytes });
  const opened = await WebContainer.readBoardContainer(
    new File([initial.blob], 'repeated-save.bf', { type: 'application/octet-stream' }),
    { lazyImageRefs: true, verifyImageCrc: false },
  );
  const rawImageStore = opened.board.imageStore;
  assert.equal(rawImageStore['img-1'].__blobVolatile, true);
  const replacedFileBlob = rawImageStore['img-1'].__blob;

  harness.context.BoardfishWebLimits = { validateBoardPayload() {} };
  harness.context.BoardfishWebBoardContainer = WebContainer;
  let persisted = null;
  let writableCount = 0;
  const handle = {
    async createWritable() {
      writableCount++;
      return {
        async write(blob) {
          assert.equal(blob instanceof Blob, true);
          persisted = new Blob([await blob.arrayBuffer()], { type: 'application/octet-stream' });
        },
        async close() {},
        async abort() {},
      };
    },
  };
  const ref = { kind: 'web-save-handle', handle, name: 'repeated-save.bf' };

  for (let attempt = 0; attempt < 3; attempt++) {
    await harness.context.BoardfishRuntime.saveBoard(ref, board, { imageStore: rawImageStore });
    assert.ok(persisted);
    const reopened = await WebContainer.readBoardContainer(persisted, {
      lazyImageRefs: true,
      verifyImageCrc: true,
    });
    assert.deepEqual(await WebContainer.bytesForImageSourceAsync(reopened.board.imageStore['img-1']), imageBytes);
    if (attempt === 0) {
      Object.defineProperties(replacedFileBlob, {
        arrayBuffer: {
          configurable: true,
          value() { throw new Error('the overwritten File snapshot is no longer readable'); },
        },
        slice: {
          configurable: true,
          value() { throw new Error('the overwritten File snapshot is no longer sliceable'); },
        },
        stream: {
          configurable: true,
          value() { throw new Error('the overwritten File snapshot is no longer streamable'); },
        },
      });
    }
  }

  assert.equal(writableCount, 3);
  assert.equal(rawImageStore['img-1'].__blobVolatile, false);
});

test('failed writable streams abort without closing and allow the next save', async () => {
  const harness = loadWebRuntimeHarness();
  harness.context.BoardfishWebLimits = { validateBoardPayload() {} };
  harness.context.BoardfishWebBoardContainer = {
    async createBoardContainerBlob() {
      return { blob: new Blob([new Uint8Array([1, 2, 3, 4])]) };
    },
  };
  let attempt = 0;
  let aborts = 0;
  let closes = 0;
  const handle = {
    async createWritable() {
      attempt++;
      const shouldFail = attempt === 1;
      return {
        async write() {
          if (shouldFail) throw new Error('simulated target write failure');
        },
        async close() {
          closes++;
        },
        async abort() {
          aborts++;
        },
      };
    },
  };
  const ref = { kind: 'web-save-handle', handle, name: 'board.bf' };

  await assert.rejects(
    () => harness.context.BoardfishRuntime.saveBoard(ref, { objects: [] }),
    /simulated target write failure/,
  );
  assert.equal(aborts, 1);
  assert.equal(closes, 0);

  await harness.context.BoardfishRuntime.saveBoard(ref, { objects: [] });
  assert.equal(attempt, 2);
  assert.equal(aborts, 1);
  assert.equal(closes, 1);
});

test('a stalled write times out, aborts, and retires the uncertain target', async () => {
  const harness = loadWebRuntimeHarness();
  harness.context.BoardfishWebLimits = { validateBoardPayload() {} };
  harness.context.BoardfishWebBoardContainer = {
    async createBoardContainerBlob() {
      return { blob: new Blob([new Uint8Array([1, 2, 3, 4])]) };
    },
  };
  let aborts = 0;
  const handle = {
    async createWritable() {
      return {
        write() { return new Promise(() => {}); },
        async close() {},
        async abort() { aborts++; },
      };
    },
  };
  const ref = { kind: 'web-save-handle', handle, name: 'stalled-board.bf' };
  const save = harness.context.BoardfishRuntime.saveBoard(ref, { objects: [] });
  await new Promise(setImmediate);
  harness.runTimers();

  await assert.rejects(() => save, /timed out while writing the board file/);
  assert.equal(aborts, 1);
  assert.equal(ref.unusable, true);
  assert.equal(harness.context.BoardfishRuntime.canSaveToExistingTarget(ref), false);
});

test('download refs are not reusable save targets', () => {
  const harness = loadWebRuntimeHarness();
  assert.equal(
    harness.context.BoardfishRuntime.canSaveToExistingTarget({ kind: 'web-download', name: 'board.bf' }),
    false,
  );
  assert.equal(
    harness.context.BoardfishRuntime.canSaveToExistingTarget({ kind: 'web-save-handle', handle: {} }),
    true,
  );
  assert.equal(
    harness.context.BoardfishRuntime.canSaveToExistingTarget({ kind: 'web-save-handle', handle: {}, unusable: true }),
    false,
  );
});

test('failed web board validation revokes decoded image refs', async () => {
  const harness = loadWebRuntimeHarness();
  const imageRef = { web: true, objectUrl: 'blob:image-1' };
  const revoked = [];
  harness.context.BoardfishWebBoardContainer = {
    async readBoardContainer() {
      return {
        board: {
          objects: [],
          imageStore: { 'img-1': imageRef },
        },
        debug: {
          board_json_bytes: 2,
          image_bytes: 4,
        },
        imageEntries: [{ key: 'img-1', byteLength: 4 }],
      };
    },
    revokeImageSource(source) {
      revoked.push(source.objectUrl || '');
      return true;
    },
  };
  harness.context.BoardfishWebLimits = {
    validateBoardPayload() {},
    async validateOpenedImageEntries() {
      throw new Error('image validation failed');
    },
  };

  const ref = harness.context.BoardfishRuntime.fileRefFromFile({ name: 'board.bf', size: 6 });
  await assert.rejects(
    () => harness.context.BoardfishRuntime.readBoard(ref),
    /image validation failed/,
  );
  assert.deepEqual(revoked, ['blob:image-1']);
});
