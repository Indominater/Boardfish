'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const WebContainer = require('../src/js/web_board_container.js');

function loadWebImageSourceHarness({ BlobImpl = Blob, boardContainer = null } = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');
  const start = source.indexOf('const webImageExtForFile =');
  const end = source.indexOf('\nconst rollbackImageInsertSource =', start);
  assert.ok(start >= 0 && end > start, 'web image source helpers are missing');
  const calls = [];
  const context = {
    Blob: BlobImpl,
    BoardfishWebBoardContainer: boardContainer || {
      createWebImageRef(options) {
        calls.push(options);
        return { web: true, ...options };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\n` +
      'globalThis.createWebImageSourceFromBytes = createWebImageSourceFromBytes;\n',
    context,
    { filename: 'image_insert.js' },
  );
  context.calls = calls;
  return context;
}

function loadEditorStateBoundaryHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/editor_state_boundary.js'), 'utf8');
  const obj1 = { id: 'obj-1', type: 'image', z: 1 };
  const obj2 = { id: 'obj-2', type: 'rect', z: 2 };
  const textLayoutCacheClears = [];
  const context = {
    console,
    editingId: null,
    idCounter: 1,
    zCounter: 3,
    objects: [obj1, obj2],
    objectsMap: new Map([[obj1.id, obj1], [obj2.id, obj2]]),
    selectedId: 'obj-1',
    selectedIds: new Set(['obj-1']),
    _linesCacheMap: new Map([[obj1.id, []]]),
    _prefixCache: new Map(),
    _boardOpening: false,
    textLayoutCacheClears,
    BoardfishViewportState: {
      setViewport() {},
    },
    clearTextLayoutCaches(options = {}) {
      textLayoutCacheClears.push({ ...options });
    },
    exitEdit() {
      context.editingId = null;
    },
    isTextContentEmpty(value) {
      return String(value || '').length === 0;
    },
    normalizeTextContent(value) {
      return String(value || '');
    },
    rebuildObjectsMap() {
      context.objectsMap.clear();
      for (const obj of context.objects) context.objectsMap.set(obj.id, obj);
    },
    syncAllTextAutoHeights() {},
    updateInputShieldVisual() {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'editor_state_boundary.js' });
  return context;
}

test('inserted image bytes become an immutable exact-byte Blob source', async () => {
  const context = loadWebImageSourceHarness();
  const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);

  const source = context.createWebImageSourceFromBytes(
    { type: 'image/jpeg' },
    'img-7',
    bytes,
  );
  const options = context.calls[0];

  assert.equal(source.web, true);
  assert.equal(options.path, 'images/img-7.jpg');
  assert.equal(options.mime, 'image/jpeg');
  assert.equal(options.ext, 'jpg');
  assert.equal(options.bytes, undefined);
  assert.equal(options.blob instanceof Blob, true);
  assert.equal(options.blob.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await options.blob.arrayBuffer()), bytes);

  bytes.fill(42);
  assert.deepEqual(
    new Uint8Array(await options.blob.arrayBuffer()),
    new Uint8Array([0, 1, 127, 128, 254, 255]),
  );
});

test('inserted image source retains byte-backed fallback without Blob', () => {
  const context = loadWebImageSourceHarness({ BlobImpl: null });
  const bytes = new Uint8Array([1, 2, 3, 4]);

  context.createWebImageSourceFromBytes({ type: 'image/png' }, 'img-2', bytes);
  const options = context.calls[0];

  assert.equal(options.path, 'images/img-2.png');
  assert.equal(options.mime, 'image/png');
  assert.equal(options.ext, 'png');
  assert.equal(options.blob, undefined);
  assert.equal(options.bytes, bytes);
});

test('inserted immutable Blob sources reuse CRC without changing saved bytes', async () => {
  const context = loadWebImageSourceHarness({ boardContainer: WebContainer });
  const bytes = new Uint8Array([0, 17, 34, 51, 68, 85, 255]);
  const source = context.createWebImageSourceFromBytes(
    { type: 'image/png' },
    'img-9',
    bytes,
  );
  const board = {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {
      'img-9': { path: 'images/img-9.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-9', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-9' } },
    ],
  };

  assert.equal(source.__blob instanceof Blob, true);
  assert.equal(source.__bytes, undefined);
  const first = await WebContainer.createBoardContainerBlob(board, { 'img-9': source });
  const second = await WebContainer.createBoardContainerBlob(board, { 'img-9': source });

  assert.equal(first.crcComputedEntries, 2);
  assert.equal(first.crcReusedEntries, 0);
  assert.equal(second.crcComputedEntries, 1);
  assert.equal(second.crcReusedEntries, 1);
  const reopened = await WebContainer.readBoardContainer(second.blob);
  assert.deepEqual(WebContainer.bytesForImageSource(reopened.board.imageStore['img-9']), bytes);
});

test('editor selection changes do not allocate motion snapshots', () => {
  const context = loadEditorStateBoundaryHarness();
  let allocations = 0;
  context.Set = class CountingSet extends Set {
    constructor(iterable) {
      super(iterable);
      allocations++;
    }
  };

  context.BoardfishEditorState.setSelection(['obj-2'], {
    primaryId: 'obj-2',
  });
  assert.equal(allocations, 0);

  context.BoardfishEditorState.setSelection(['obj-1'], {
    primaryId: 'obj-1',
  });
  assert.equal(allocations, 0);
});

test('board object replacement clears object layout without clearing reusable measurements', () => {
  const context = loadEditorStateBoundaryHarness();
  context.BoardfishEditorState.replaceBoardObjects([], { normalizeText: false, syncTextHeights: false });
  assert.deepEqual(context.textLayoutCacheClears, [{ objectLayout: true }]);
});

test('failed web image inserts revoke unadopted web image sources', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /const cleanupFailedWebImageInsertSource = \(imgKey, imageSource\) =>/);
  assert.match(source, /if \(!obj\) cleanupFailedWebImageInsertSource\(imgKey, imageSource\);/);
  assert.match(source, /catch \(err\) \{[\s\S]*cleanupFailedWebImageInsertSource\(imgKey, imageSource\);[\s\S]*throw err;/);
  assert.match(source, /BoardfishWebBoardContainer\.revokeImageSource\?\.\(imageSource\);/);
});

test('web image insert rejects a whole supported batch that would exceed object limit', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /const supportedFiles = \[\];/);
  assert.match(source, /supportedFiles\.push\(file\);/);
  assert.match(source, /BoardfishWebLimits\.canAddObjects\(supportedFiles\.length\)/);
  assert.doesNotMatch(source, /accepted\.length >= maxObjects/);
});

test('file picker image insertion freezes the command point before files are chosen', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /var _pendingImageInsertPoint = null;/);
  assert.match(source, /_pendingImageInsertPoint = \{ x, y \};[\s\S]*fileInput\.click\(\);/);
  assert.match(source, /const insertPoint = _pendingImageInsertPoint \|\| ctxPos;/);
  assert.match(source, /insertImageFiles\(files, insertPoint\.x, insertPoint\.y, 'file-input'\)/);
  assert.match(source, /finally \{[\s\S]*_pendingImageInsertPoint = null;[\s\S]*fileInput\.value = '';/);
});
