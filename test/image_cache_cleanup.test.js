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
    hasTauri: () => false,
    tauriConvertFileSrc: (value) => value,
    SaveDebug: noopDebugApi(),
    ExportDebug: noopDebugApi(),
    OpenDebug: noopDebugApi(),
    ViewportDebug: noopDebugApi(),
    ClipDebug: noopDebugApi(),
    BoardfishTauri: {},
    TAURI_COMMANDS: {
      REGISTER_IMAGE_SOURCE: 'register_image_source',
      GET_CACHED_IMAGE_DATA_URL: 'get_cached_image_data_url',
    },
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
      'globalThis.imageReadbackProbeKey = imageReadbackProbeKey;\n',
    context,
    { filename: 'image_state.js' },
  );
  return { context, rafs };
}

test('cacheImage keeps an existing current bitmap and closes a racing duplicate', async () => {
  let resolveBitmap;
  const duplicate = { closed: false, close() { this.closed = true; } };
  const existing = { closed: false, close() { this.closed = true; } };
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
  context.imageBitmapCache['img-1'] = existing;
  resolveBitmap(duplicate);

  const metrics = await ready;
  assert.equal(metrics.cacheReadyStage, 'bitmap');
  assert.equal(context.imageBitmapCache['img-1'], existing);
  assert.equal(existing.closed, false);
  assert.equal(duplicate.closed, true);
});

test('removeImageRuntimeCachesForKey clears readback probe entries for the removed image only', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const removedSrc = 'data:image/png;base64,removed';
  const unrelatedSrc = 'data:image/png;base64,unrelated';
  const sharedSrc = 'data:image/png;base64,shared';

  context.imageStore['img-1'] = removedSrc;
  context.imageStore['img-2'] = unrelatedSrc;
  context.imageStore['img-3'] = sharedSrc;
  context.imageStore['img-4'] = sharedSrc;
  context.imageReadbackSafeSourceCache.set(context.imageReadbackProbeKey(removedSrc), true);
  context.imageReadbackSafeSourceCache.set(context.imageReadbackProbeKey(unrelatedSrc), true);
  context.imageReadbackSafeSourceCache.set(context.imageReadbackProbeKey(sharedSrc), true);

  context.removeImageRuntimeCachesForKey('img-1');
  assert.equal(context.imageReadbackSafeSourceCache.has(context.imageReadbackProbeKey(removedSrc)), false);
  assert.equal(context.imageReadbackSafeSourceCache.has(context.imageReadbackProbeKey(unrelatedSrc)), true);

  context.removeImageRuntimeCachesForKey('img-3');
  assert.equal(context.imageReadbackSafeSourceCache.has(context.imageReadbackProbeKey(sharedSrc)), true);
});

test('clearImageStore clears any pending visible hydration timer hook', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  let clears = 0;
  context.clearVisibleHydrationTimer = () => { clears++; };

  context.clearImageStore(false);

  assert.equal(clears, 1);
});

test('queued native image hydration skips duplicate source registration', async () => {
  const { context, rafs } = loadImageState(() => Promise.resolve({ close() {} }));
  const dataUrl = 'data:image/png;base64,native-cache';
  let registerCalls = 0;
  context.hasTauri = () => true;
  context.BoardfishTauri.getCachedImageDataUrl = async (key) => {
    assert.equal(key, 'img-1');
    return dataUrl;
  };
  context.BoardfishTauri.registerImageSource = async () => {
    registerCalls++;
    return { bytes: 12, mime: 'image/png', ext: 'png', width: 1, height: 1 };
  };

  context.imageStore['img-1'] = { native: true, bytes: 12, mime: 'image/png', ext: 'png' };
  context.queueImageHydration('img-1');
  assert.equal(rafs.length, 1);

  rafs.shift()();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.imageReadyPromises.has('img-1'), true);
  assert.equal(registerCalls, 0);
});
