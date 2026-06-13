'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function noopDebugApi() {
  return {
    start: () => null,
    step() {},
    end() {},
    count() {},
    max() {},
    wrap: async (_ctx, _command, call) => call(),
  };
}

function loadImageState(createImageBitmap) {
  const rafs = [];
  let now = 0;
  const context = {
    console,
    Map,
    Set,
    Promise,
    Date,
    Error,
    Object,
    Number,
    Math,
    String,
    performance: { now: () => ++now },
    window: {},
    document: {
      createElement(name) {
        if (name !== 'canvas') return {};
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage() {},
              getImageData() { return { data: [0, 0, 0, 0] }; },
              save() {},
              translate() {},
              scale() {},
              rotate() {},
            };
          },
        };
      },
    },
    Image: function Image() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.complete = false;
    },
    clearTimeout() {},
    setTimeout() { return 0; },
    requestAnimationFrame(cb) {
      rafs.push(cb);
      return rafs.length;
    },
    invalidateOffscreen() {},
    scheduleRender() {},
    scheduleVisibleScaledVariantPrewarmAfterIdle() {},
    _bulkImageInsertDepth: 0,
    _boardOpening: false,
    _imageReadyLastRender: 0,
    SaveDebug: noopDebugApi(),
    ExportDebug: noopDebugApi(),
    OpenDebug: noopDebugApi(),
    ViewportDebug: noopDebugApi(),
    ClipDebug: noopDebugApi(),
    clearScaledImageVariants() {},
    isSidewaysRotation: () => false,
    imageTransformFromObject: () => ({ rotation: 0, flipX: false, flipY: false }),
    setCanvasImageQuality() {},
    createImageBitmap,
  };

  vm.createContext(context);
  vm.runInContext(
    `${fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8')}\n` +
      'globalThis.removeImageRuntimeCachesForKey = removeImageRuntimeCachesForKey;\n' +
      'globalThis.pruneImageCachesToKeys = pruneImageCachesToKeys;\n' +
      'globalThis.newImgKey = newImgKey;\n' +
      'globalThis.clearImageStore = clearImageStore;\n',
    context,
    { filename: 'image_state.js' },
  );
  return { context, rafs };
}

test('cacheImage keeps an existing current bitmap and closes a racing duplicate', async () => {
  let resolveBitmap;
  const duplicate = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const existing = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const { context, rafs } = loadImageState(() => new Promise((resolve) => {
    resolveBitmap = resolve;
  }));
  const src = 'data:image/png;base64,boardfish';
  const loadedImg = {
    naturalWidth: 16,
    naturalHeight: 16,
    currentSrc: src,
    src,
    complete: true,
  };

  context.imageStore['img-1'] = src;
  const ready = context.cacheImage('img-1', src, null, loadedImg, { skipSourceRegistration: true });
  assert.equal(rafs.length, 1);

  rafs.shift()();
  await Promise.resolve();
  context.imageBitmapCache['img-1'] = existing;
  resolveBitmap(duplicate);

  const metrics = await ready;
  assert.equal(metrics.cacheReadyStage, 'bitmap');
  assert.equal(context.imageBitmapCache['img-1'], existing);
  assert.equal(existing.closed, false);
  assert.equal(duplicate.closed, true);
});

test('removeImageRuntimeCachesForKey clears runtime display state for the removed image only', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const removedBitmap = { closed: false, close() { this.closed = true; } };
  const keptBitmap = { closed: false, close() { this.closed = true; } };

  context.imageMetadataCache['img-1'] = { width: 10 };
  context.imageMetadataCache['img-2'] = { width: 20 };
  context.imageBitmapCache['img-1'] = removedBitmap;
  context.imageBitmapCache['img-2'] = keptBitmap;
  context.imageBitmapFailed.add('img-1');
  context.imageBitmapFailed.add('img-2');

  context.removeImageRuntimeCachesForKey('img-1');

  assert.equal(Object.hasOwn(context.imageMetadataCache, 'img-1'), false);
  assert.equal(Object.hasOwn(context.imageBitmapCache, 'img-1'), false);
  assert.equal(context.imageBitmapFailed.has('img-1'), false);
  assert.equal(removedBitmap.closed, true);
  assert.equal(Object.hasOwn(context.imageMetadataCache, 'img-2'), true);
  assert.equal(Object.hasOwn(context.imageBitmapCache, 'img-2'), true);
  assert.equal(context.imageBitmapFailed.has('img-2'), true);
  assert.equal(keptBitmap.closed, false);
});

test('clearImageStore clears any pending visible hydration timer hook', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  let clears = 0;
  context.clearVisibleHydrationTimer = () => { clears++; };

  context.clearImageStore(false);

  assert.equal(clears, 1);
});

test('newImgKey skips keys already present in the live image store', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));

  context.imageStore['img-1'] = 'data:image/png;base64,AQ==';

  assert.equal(context.newImgKey(), 'img-2');
});

test('clearImageStore continues after an ImageBitmap close throws', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  let keptClosed = false;
  context.imageBitmapCache['img-1'] = {
    close() {
      throw new Error('already closed');
    },
  };
  context.imageBitmapCache['img-2'] = {
    close() {
      keptClosed = true;
    },
  };

  assert.doesNotThrow(() => context.clearImageStore());

  assert.equal(keptClosed, true);
  assert.deepEqual(Object.keys(context.imageBitmapCache), []);
});
