'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const WebContainer = require('../src/js/web_board_container.js');

function loadWebImageSourceHarness({ boardContainer = null } = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');
  const start = source.indexOf('const webImageExtForFile =');
  const end = source.indexOf('\nconst rollbackImageInsertSource =', start);
  assert.ok(start >= 0 && end > start, 'web image source helpers are missing');
  const calls = [];
  const context = {
    Blob,
    File,
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
      'globalThis.createWebImageSourceFromBlob = createWebImageSourceFromBlob;\n',
    context,
    { filename: 'image_insert.js' },
  );
  context.calls = calls;
  return context;
}

function loadAddImageHarness({ width = 1200, height = 300 } = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');
  const calls = {
    histories: [],
    objects: [],
    renders: [],
    selections: [],
  };
  const imageStore = {};
  const context = {
    Blob,
    File,
    BOARDFISH_PRODUCTION: true,
    _bulkImageInsertAdded: 0,
    _bulkImageInsertDepth: 0,
    editingId: null,
    imageBitmapCache: {
      'img-paste': { width, height },
    },
    imageStore,
    zCounter: 0,
    calls,
    BoardfishEditorState: {
      addObject(obj) {
        calls.objects.push(obj);
      },
      setSelection(ids, options = {}) {
        calls.selections.push({ ids: [...ids], options: { ...options } });
      },
    },
    BoardfishImageStore: {
      getSource(key) {
        return imageStore[key];
      },
      setSource(key, value) {
        imageStore[key] = value;
      },
    },
    cacheImage: async () => true,
    canvas: { addEventListener() {} },
    fileInput: {
      addEventListener() {},
      click() {},
      value: '',
    },
    newId: () => 'obj-paste',
    pushHistory(reason) {
      calls.histories.push(reason);
    },
    scheduleRender(...args) {
      calls.renders.push(args);
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'image_insert.js' });
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

test('inserted image Blob is retained without materializing its bytes', async () => {
  const context = loadWebImageSourceHarness();
  const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  Object.defineProperty(blob, 'arrayBuffer', {
    value() { throw new Error('insert should not materialize Blob bytes'); },
  });

  const source = await context.createWebImageSourceFromBlob(blob, 'img-7');
  const options = context.calls[0];

  assert.equal(source.web, true);
  assert.equal(options.path, 'images/img-7.jpg');
  assert.equal(options.mime, 'image/jpeg');
  assert.equal(options.ext, 'jpg');
  assert.equal(options.bytes, undefined);
  assert.equal(options.blob, blob);
  assert.equal(options.blob.type, 'image/jpeg');
  assert.deepEqual(
    new Uint8Array(await options.blob.slice().arrayBuffer()),
    new Uint8Array([0, 1, 127, 128, 254, 255]),
  );
});

test('inserted File bytes detach from their potentially volatile source', async () => {
  const context = loadWebImageSourceHarness();
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const file = new File([bytes], 'source.png', { type: 'image/png' });
  await context.createWebImageSourceFromBlob(file, 'img-file');
  const stored = context.calls[0].blob;

  assert.notEqual(stored, file);
  assert.equal(stored.type, 'image/png');
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);
});

test('inserted immutable Blob sources reuse CRC without changing saved bytes', async () => {
  const context = loadWebImageSourceHarness({ boardContainer: WebContainer });
  const bytes = new Uint8Array([0, 17, 34, 51, 68, 85, 255]);
  const blob = new Blob([bytes], { type: 'image/png' });
  const source = await context.createWebImageSourceFromBlob(blob, 'img-9');
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
  assert.equal(source.__blob, blob);
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

test('decoded image insertion owns its size cap after image layout removal', async () => {
  const context = loadAddImageHarness();
  const imageSource = { web: true, mime: 'image/png' };

  const obj = await context.addImage(imageSource, 500, 400, 'img-paste');

  assert.ok(obj);
  assert.equal(obj.w, 600);
  assert.equal(obj.h, 150);
  assert.equal(obj.x, 200);
  assert.equal(obj.y, 325);
  assert.equal(context.imageStore['img-paste'], imageSource);
  assert.equal(context.calls.objects[0], obj);
  assert.deepEqual(context.calls.selections, [{
    ids: ['obj-paste'],
    options: { primaryId: 'obj-paste', exitEditing: false },
  }]);
  assert.deepEqual(context.calls.renders, [[true, true]]);
  assert.deepEqual(context.calls.histories, ['add-image']);
  assert.equal('BoardfishImageLayout' in context, false);
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

test('editor selection accepts sets without disrupting a retained live edit', () => {
  const context = loadEditorStateBoundaryHarness();
  const retainedIds = vm.runInContext("new Set(['obj-1', 'obj-2'])", context);
  const replacementIds = vm.runInContext("new Set(['obj-2'])", context);
  let exits = 0;
  context.editingId = 'obj-1';
  context.exitEdit = () => {
    exits++;
    context.editingId = null;
  };

  context.BoardfishEditorState.setSelection(retainedIds, { primaryId: 'obj-2' });

  assert.equal(exits, 0);
  assert.deepEqual([...context.selectedIds], ['obj-1', 'obj-2']);
  assert.equal(context.selectedId, 'obj-2');

  context.BoardfishEditorState.setSelection(replacementIds, { primaryId: 'obj-2' });

  assert.equal(exits, 1);
  assert.deepEqual([...context.selectedIds], ['obj-2']);
  assert.equal(context.selectedId, 'obj-2');
});

test('board object replacement retains content-keyed caches while reset clears them', () => {
  const context = loadEditorStateBoundaryHarness();
  context.BoardfishEditorState.replaceBoardObjects([], { normalizeText: false, syncTextHeights: false });
  assert.deepEqual(context.textLayoutCacheClears, []);

  context.BoardfishEditorState.resetBoardObjectState();
  assert.deepEqual(context.textLayoutCacheClears, [{}]);
});

test('failed web image inserts roll back their adopted source once', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /const rollbackImageInsertSource = \(imgKey, source, hadPreviousSource = false, previousSource\) =>/);
  assert.match(source, /if \(!\(naturalW > 0 && naturalH > 0\)\) \{\s*rollbackSource\(\);/);
  assert.match(source, /catch \(err\) \{\s*rollbackSource\(\);/);
  assert.doesNotMatch(source, /cleanupFailedWebImageInsertSource|revokeImageSource/);
});

test('web image insert rejects a whole supported batch that would exceed object limit', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /const supportedFiles = \[\];/);
  assert.match(source, /supportedFiles\.push\(file\);/);
  assert.match(source, /BoardfishWebLimits\.canAddObjects\(supportedFiles\.length\)/);
  assert.doesNotMatch(source, /accepted\.length >= maxObjects/);
  assert.equal((source.match(/BoardfishWebLimits\.canAddObjects\(/g) || []).length, 2);
  assert.match(source, /const imgKey = newImgKey\(\);\s*const insertOptions = \{\s*z:/);
  assert.doesNotMatch(source, /\baddImageObject\b|insertOptions\.imgKey/);
});

test('file picker image insertion freezes the command point before files are chosen', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /var _pendingImageInsertPoint = null;/);
  assert.match(source, /_pendingImageInsertPoint = \{ x, y \};[\s\S]*fileInput\.click\(\);/);
  assert.match(source, /const insertPoint = _pendingImageInsertPoint;/);
  assert.doesNotMatch(source, /\bctxPos\b/);
  assert.match(source, /insertImageFiles\(files, insertPoint\.x, insertPoint\.y, 'file-input'\)/);
  assert.match(source, /finally \{[\s\S]*_pendingImageInsertPoint = null;[\s\S]*fileInput\.value = '';/);
});
