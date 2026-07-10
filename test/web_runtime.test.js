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
  const persistedBlob = new Blob([new Uint8Array([1, 2, 3])]);
  const rawImageStore = { 'img-1': 'source' };
  harness.context.BoardfishWebLimits = {
    validateBoardPayload(payload) {
      validations.push({ ...payload });
    },
  };
  harness.context.BoardfishWebBoardContainer = {
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
    async refreshBlobBackedImageRefsFromContainer(board, imageStore, container) {
      events.push('refresh-saved-file');
      assert.equal(board.objects.length, 1);
      assert.equal(imageStore, rawImageStore);
      assert.equal(container.blob, persistedBlob);
      return { refreshed: 1, bytes: 4, skipped: '' };
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
    async getFile() {
      events.push('get-file');
      return persistedBlob;
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
  assert.equal(result.image_source_refresh_backing, 'saved-file');
  assert.equal(result.image_source_refresh_error, '');
  assert.deepEqual(events, [
    'create-container',
    'create-writable',
    'write',
    'close',
    'get-file',
    'refresh-saved-file',
  ]);
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
