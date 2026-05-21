'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadImageInsertMotionHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');
  const start = source.indexOf('const pendingInsertedImageMotions = new Map();');
  const end = source.indexOf('\nfunction addImageObject', start);
  assert.ok(start >= 0 && end > start, 'inserted image motion helpers are missing');
  const calls = {
    animations: [],
    renders: [],
    rafs: 0,
  };
  const context = {
    console,
    calls,
    objectsMap: new Map(),
    requestAnimationFrame(callback) {
      calls.rafs++;
      callback();
    },
    BoardfishMotion: {
      applyActionAnimation(action, payload = {}) {
        calls.animations.push({
          action,
          ids: (payload.objects || []).map((obj) => obj.id),
        });
      },
    },
    scheduleRender(board, overlay, sourceName) {
      calls.renders.push({ board, overlay, source: sourceName });
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\n` +
      'globalThis.queueImageObjectInsertMotion = queueImageObjectInsertMotion;\n' +
      'globalThis.pendingInsertedMotionCount = () => pendingInsertedImageMotions.size;\n',
    context,
    { filename: 'image_insert.js' },
  );
  return context;
}

function loadEditorStateBoundaryHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/editor_state_boundary.js'), 'utf8');
  const calls = {
    clear: [],
    clearStale: 0,
  };
  const obj1 = { id: 'obj-1', type: 'image', z: 1 };
  const obj2 = { id: 'obj-2', type: 'rect', z: 2 };
  const context = {
    console,
    calls,
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
    BoardfishImageInsertMotion: {
      clear(ids = null) {
        calls.clear.push(ids == null ? null : [...ids]);
      },
      clearStale() {
        calls.clearStale++;
      },
    },
    BoardfishMotion: {
      applyActionAnimation() {},
    },
    BoardfishViewportState: {
      setViewport() {},
    },
    clearTextLayoutCaches() {},
    exitEdit() {
      context.editingId = null;
    },
    isTextContentEmpty(value) {
      return String(value || '').length === 0;
    },
    normalizeTextContent(value) {
      return String(value || '');
    },
    noteEyedropperBoardContentChanged() {},
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

function loadDataUrlPasteFailureHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');
  const start = source.indexOf('function fitImageSize');
  const end = source.indexOf('\nasync function pasteNativeCachedImage', start);
  assert.ok(start >= 0 && end > start, 'data URL image insert helpers are missing');
  const calls = {
    cached: [],
    removedRuntime: [],
    sourceChanged: [],
    shields: [],
  };
  const imageStore = {};
  const imageCache = {};
  const context = {
    console,
    calls,
    imageStore,
    imageCache,
    objects: [],
    _boardOpening: false,
    performance: { now: () => 1 },
    fileInput: { addEventListener() {}, value: '', files: [] },
    eyedropperEnabled: false,
    hasTauri: () => false,
    isWebImageRef: () => false,
    webImageDisplaySrc: (src) => src,
    imageSourceDebugInfo: () => ({ kind: 'data-url' }),
    showInputShield() { calls.shields.push('show'); },
    hideInputShield() { calls.shields.push('hide'); },
    cacheImage(key, src, _dbg, loadedImg) {
      calls.cached.push({ key, src, loaded: !!loadedImg });
      imageCache[key] = loadedImg || { src };
      return Promise.resolve({ cacheReadyStage: 'display' });
    },
    removeImageRuntimeCachesForKey(key, sourceOverride) {
      calls.removedRuntime.push({ key, sourceOverride });
      delete imageCache[key];
    },
    noteEyedropperImageSourceChanged(key, reason) {
      calls.sourceChanged.push({ key, reason });
    },
    BoardfishImageStore: {
      getSource(key) { return imageStore[key]; },
      setSource(key, sourceValue) {
        imageStore[key] = sourceValue;
        return true;
      },
    },
    BoardfishWebLimits: {
      validateDataUrlImage: async () => true,
      canAddObjects: () => true,
      canAcceptAdditionalContentBytes: () => true,
    },
    BoardfishWebBoardContainer: {
      revokeImageSource() {},
    },
    ViewportDebug: {
      start: () => null,
      step() {},
      count() {},
      max() {},
      end() {},
    },
    InsertDebug: {
      start: () => null,
      step() {},
      end() {},
    },
    ClipDebug: {
      step() {},
      end() {},
    },
    Image: function Image() {
      this.naturalWidth = 120;
      this.naturalHeight = 80;
      this.complete = false;
      Object.defineProperty(this, 'src', {
        get: () => this._src || '',
        set: (value) => {
          this._src = value;
          this.currentSrc = value;
          this.complete = true;
          if (this.onload) this.onload();
        },
      });
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\n` +
      'addImageObject = () => null;\n' +
      'globalThis.pasteDataUrlImage = pasteDataUrlImage;\n',
    context,
    { filename: 'image_insert.js' },
  );
  return context;
}

test('inserted image motion clear drops deleted objects before first draw', () => {
  const context = loadImageInsertMotionHarness();
  const obj = { id: 'image-1', type: 'image' };
  context.objectsMap.set(obj.id, obj);

  context.queueImageObjectInsertMotion(obj);
  assert.equal(context.pendingInsertedMotionCount(), 1);

  assert.equal(context.BoardfishImageInsertMotion.clear([obj.id]), 1);
  assert.equal(context.pendingInsertedMotionCount(), 0);

  context.BoardfishImageInsertMotion.noteDrawn(obj);
  assert.equal(context.calls.animations.length, 0);
  assert.equal(context.calls.renders.length, 0);
});

test('inserted image stale motion cleanup keeps current objects animating', () => {
  const context = loadImageInsertMotionHarness();
  const stale = { id: 'image-1', type: 'image' };
  const current = { id: 'image-2', type: 'image' };
  const replacement = { id: stale.id, type: 'image' };
  context.objectsMap.set(stale.id, replacement);
  context.objectsMap.set(current.id, current);

  context.queueImageObjectInsertMotion(stale);
  context.queueImageObjectInsertMotion(current, { insertMotionAction: 'bulk-image-create' });

  assert.equal(context.BoardfishImageInsertMotion.clearStale(), 1);
  assert.equal(context.pendingInsertedMotionCount(), 1);

  context.BoardfishImageInsertMotion.noteDrawn(current);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.animations)), [{
    action: 'bulk-image-create',
    ids: ['image-2'],
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.renders)), [{
    board: true,
    overlay: true,
    source: 'image-insert-jello',
  }]);
});

test('editor object removal, replacement, and reset clear pending inserted-image motions', () => {
  const context = loadEditorStateBoundaryHarness();

  assert.equal(context.BoardfishEditorState.removeObjectsById(['obj-1', 'missing']), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.clear)), [['obj-1', 'missing']]);

  const replacement = { id: 'obj-3', type: 'image', z: 3 };
  context.BoardfishEditorState.replaceBoardObjects([replacement], { syncTextHeights: false });
  assert.equal(context.calls.clearStale, 1);

  context.BoardfishEditorState.resetBoardObjectState();
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.clear)), [['obj-1', 'missing'], null]);
});

test('editor selection snapshots are allocated only for animated selection changes', () => {
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
    animateSelection: false,
  });
  assert.equal(allocations, 0);

  context.BoardfishEditorState.setSelection(['obj-1'], {
    primaryId: 'obj-1',
    animateSelection: true,
  });
  assert.equal(allocations, 1);
});

test('failed web image inserts revoke unadopted web image sources', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /const cleanupFailedWebImageInsertSource = \(imgKey, imageSource\) =>/);
  assert.match(source, /if \(!obj\) cleanupFailedWebImageInsertSource\(imgKey, imageSource\);/);
  assert.match(source, /catch \(err\) \{[\s\S]*cleanupFailedWebImageInsertSource\(imgKey, imageSource\);[\s\S]*throw err;/);
  assert.match(source, /BoardfishWebBoardContainer\.revokeImageSource\?\.\(imageSource\);/);
});

test('failed native image inserts roll back unadopted JS image sources', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/image_insert.js'), 'utf8');

  assert.match(source, /rollbackSource = createImageInsertSourceRollback\(imgKey, imageSource\);\s*BoardfishImageStore\.setSource\(imgKey, imageSource\);/);
  assert.match(source, /if \(!obj\) \{\s*rollbackSource\(\);\s*cleanupNativeImageSourceToken\(imgKey, sourceToken\);/);
  assert.match(source, /catch \(err\) \{\s*if \(registeredNativeSource\) cleanupNativeImageSourceToken\(imgKey, sourceToken\);\s*if \(rollbackSource\) rollbackSource\(\);/);
  assert.match(source, /catch \(err\) \{\s*if \(rollbackSource\) rollbackSource\(\);\s*cleanupNativeImageSourceToken\(imgKey, sourceToken\);\s*throw err;/);
});

test('failed generic data URL paste rolls back the orphan image source and runtime cache', async () => {
  const context = loadDataUrlPasteFailureHarness();
  const dataUrl = 'data:image/png;base64,boardfish';

  const obj = await context.pasteDataUrlImage(dataUrl, 10, 20, 'img-1', 'event-image', null);

  assert.equal(obj, null);
  assert.equal(Object.hasOwn(context.imageStore, 'img-1'), false);
  assert.equal(Object.hasOwn(context.imageCache, 'img-1'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.cached)), [{
    key: 'img-1',
    src: dataUrl,
    loaded: true,
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.removedRuntime)), [{
    key: 'img-1',
    sourceOverride: dataUrl,
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.sourceChanged)), [{
    key: 'img-1',
    reason: 'image-source-removed',
  }]);
});
