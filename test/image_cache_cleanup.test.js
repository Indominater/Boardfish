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
  const timers = [];
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
    Blob,
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
    setTimeout(callback, ms = 0) {
      timers.push({ callback, ms });
      return timers.length;
    },
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
      'globalThis.hasOpenInitialImagePreviews = hasOpenInitialImagePreviews;\n' +
      'globalThis.releaseReadyOpenInitialImagePreviewsForOpen = releaseReadyOpenInitialImagePreviewsForOpen;\n' +
      'globalThis.resolveOpenInitialImageSourceForDraw = resolveOpenInitialImageSourceForDraw;\n' +
      'globalThis.requestOpenInitialImagePreviewForDraw = requestOpenInitialImagePreviewForDraw;\n' +
      'globalThis.bitmapSourceFromImageSource = bitmapSourceFromImageSource;\n' +
      'globalThis.ensureImageDataUrl = ensureImageDataUrl;\n' +
      'globalThis.clearImageStore = clearImageStore;\n',
    context,
    { filename: 'image_state.js' },
  );
  return { context, rafs, timers };
}

test('Blob-backed web refs feed exact Blobs to bitmap decode and async data URL conversion', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const blob = new Blob([bytes], { type: 'image/png' });
  const source = { web: true, mime: 'image/png', bytes: bytes.length, __blob: blob };
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  context.BoardfishWebBoardContainer = {
    isWebImageRef: (value) => value?.web === true,
    blobForImageSource: (value) => value?.__blob || null,
    dataUrlForImageSourceAsync: async (value) => {
      const sourceBytes = new Uint8Array(await value.__blob.arrayBuffer());
      return `data:image/png;base64,${Buffer.from(sourceBytes).toString('base64')}`;
    },
  };
  context.imageStore['img-1'] = source;

  assert.equal(await context.bitmapSourceFromImageSource(source, ''), blob);
  assert.equal(await context.ensureImageDataUrl('img-1'), 'data:image/png;base64,AQIDBA==');
});

test('cacheImage keeps an existing current bitmap and closes a racing duplicate', async () => {
  let resolveBitmap;
  const duplicate = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const existing = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const { context, rafs } = loadImageState(() => new Promise((resolve) => {
    resolveBitmap = resolve;
  }));
  const src = 'data:image/png;base64,boardfish';
  context.imageStore['img-1'] = src;
  const ready = context.cacheImage('img-1', src, null, { skipSourceRegistration: true });
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

test('cacheImage retries a stale in-flight web ref against its refreshed source', async () => {
  const firstBitmap = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const secondBitmap = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const decodedSources = [];
  const { context, rafs } = loadImageState(async (blob) => {
    decodedSources.push(blob);
    return decodedSources.length === 1 ? firstBitmap : secondBitmap;
  });
  const source = {
    web: true,
    mime: 'image/png',
    bytes: 1,
    displaySrc: 'blob:before-save',
    blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
  };
  context.BoardfishWebBoardContainer = {
    isWebImageRef: (value) => value?.web === true,
    displaySrcForImageSource: (value) => value.displaySrc,
    blobForImageSource: (value) => value.blob,
  };
  context.imageStore['img-1'] = source;

  const firstReady = context.cacheImage('img-1', source, null, { skipSourceRegistration: true });
  assert.equal(rafs.length, 1);
  rafs.shift()();
  source.displaySrc = 'blob:after-save';
  source.blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
  assert.equal((await firstReady).cacheReadyStage, 'stale');
  assert.equal(firstBitmap.closed, true);
  assert.equal(context.imageBitmapCache['img-1'], undefined);

  assert.equal(rafs.length, 1);
  rafs.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(rafs.length, 1);
  rafs.shift()();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(decodedSources.length, 2);
  assert.equal(context.imageBitmapCache['img-1'], secondBitmap);
  assert.equal(secondBitmap.closed, false);
});

test('cacheImage queues full bitmap draw warmup for active-fallback safety', async () => {
  const bitmap = { width: 32, height: 24, closed: false, close() { this.closed = true; } };
  const warmups = [];
  const { context, rafs } = loadImageState(() => Promise.resolve(bitmap));
  const src = 'data:image/png;base64,boardfish';
  context.scheduleDrawableBitmapWarmup = (source, meta) => {
    warmups.push({ source, meta });
    return true;
  };
  context.imageStore['img-1'] = src;

  const ready = context.cacheImage('img-1', src, null, { skipSourceRegistration: true });
  assert.equal(rafs.length, 1);
  rafs.shift()();
  await ready;

  assert.equal(warmups.length, 1);
  assert.equal(warmups[0].source, bitmap);
  assert.equal(warmups[0].meta.kind, 'full-image');
  assert.equal(warmups[0].meta.key, 'img-1');
  assert.equal(warmups[0].meta.source, 'cache-image');
});

test('cacheImage prioritizes the exact scaled replacement for an active open preview', async () => {
  const bitmap = { width: 4000, height: 3000, close() {} };
  const queued = [];
  const { context, rafs } = loadImageState(() => Promise.resolve(bitmap));
  const src = 'data:image/png;base64,boardfish';
  context.queueScaledImageVariantForReadyImage = (key, source, options) => {
    queued.push({ key, source, options });
    return { key, scale: 0.25, queued: true };
  };
  context.imageOpenPreviewBitmapCache.set('img-1', {
    generation: context._imageStoreGeneration,
    bitmap: { width: 100, height: 75, close() {} },
  });
  context.imageStore['img-1'] = src;

  const ready = context.cacheImage('img-1', src, null, { skipSourceRegistration: true });
  rafs.shift()();
  await ready;

  assert.equal(queued.length, 1);
  assert.equal(queued[0].key, 'img-1');
  assert.equal(queued[0].source, bitmap);
  assert.equal(queued[0].options.priority, true);
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

test('ready open previews release independently while other previews remain pending', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const previewOne = { closed: false, close() { this.closed = true; } };
  const previewTwo = { closed: false, close() { this.closed = true; } };

  context.imageOpenPreviewBitmapCache.set('img-1', {
    generation: context._imageStoreGeneration,
    bitmap: previewOne,
  });
  context.imageOpenPreviewBitmapCache.set('img-2', {
    generation: context._imageStoreGeneration,
    bitmap: previewTwo,
  });
  context.imageBitmapCache['img-1'] = { width: 10, height: 10, close() {} };

  assert.equal(context.hasOpenInitialImagePreviews(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.releaseReadyOpenInitialImagePreviewsForOpen())), {
    total: 2,
    ready: 1,
    pending: 1,
    failed: 0,
    stale: 0,
    released: 1,
    remaining: 1,
  });
  assert.equal(context.imageOpenPreviewBitmapCache.has('img-1'), false);
  assert.equal(context.imageOpenPreviewBitmapCache.has('img-2'), true);
  assert.equal(previewOne.closed, true);
  assert.equal(previewTwo.closed, false);

  context.imageBitmapCache['img-2'] = { width: 10, height: 10, close() {} };
  assert.deepEqual(JSON.parse(JSON.stringify(context.releaseReadyOpenInitialImagePreviewsForOpen())), {
    total: 1,
    ready: 1,
    pending: 0,
    failed: 0,
    stale: 0,
    released: 1,
    remaining: 0,
  });
  assert.equal(context.hasOpenInitialImagePreviews(), false);
  assert.equal(previewOne.closed, true);
  assert.equal(previewTwo.closed, true);
});

test('open previews wait for scaled variants before releasing full bitmap handoff', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const preview = { closed: false, close() { this.closed = true; } };
  let variantReady = false;
  context.isViewportImageScalingActive = () => true;
  context.chooseImageScaleForDraw = () => 0.25;
  context.hasScaledImageVariant = () => variantReady;
  context.imageOpenPreviewBitmapCache.set('img-1', {
    generation: context._imageStoreGeneration,
    bitmap: preview,
    objectW: 500,
    objectH: 500,
    viewZoom: 0.1,
    viewDpr: 1,
  });
  context.imageBitmapCache['img-1'] = { width: 4000, height: 4000, close() {} };

  assert.deepEqual(JSON.parse(JSON.stringify(context.releaseReadyOpenInitialImagePreviewsForOpen())), {
    total: 1,
    ready: 0,
    pending: 1,
    failed: 0,
    stale: 0,
    released: 0,
    remaining: 1,
  });
  assert.equal(context.imageOpenPreviewBitmapCache.has('img-1'), true);
  assert.equal(preview.closed, false);

  variantReady = true;
  assert.deepEqual(JSON.parse(JSON.stringify(context.releaseReadyOpenInitialImagePreviewsForOpen())), {
    total: 1,
    ready: 1,
    pending: 0,
    failed: 0,
    stale: 0,
    released: 1,
    remaining: 0,
  });
  assert.equal(context.imageOpenPreviewBitmapCache.has('img-1'), false);
  assert.equal(preview.closed, true);
});

test('open preview falls back to the exact full bitmap after a terminal scaled variant failure', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const preview = { closed: false, close() { this.closed = true; } };
  const full = { width: 4000, height: 4000, close() {} };
  context.isViewportImageScalingActive = () => true;
  context.chooseImageScaleForDraw = () => 0.25;
  context.hasScaledImageVariant = () => false;
  context.hasScaledImageVariantFailure = () => true;
  context.selectImageSourceForDraw = (_key, _obj, source) => ({ source, scale: 1, targetScale: 0.25 });
  context.imageOpenPreviewBitmapCache.set('img-1', {
    generation: context._imageStoreGeneration,
    bitmap: preview,
    objectW: 500,
    objectH: 500,
    viewZoom: 0.1,
    viewDpr: 1,
  });
  context.imageBitmapCache['img-1'] = full;

  const release = context.releaseReadyOpenInitialImagePreviewsForOpen();

  assert.equal(release.released, 1);
  assert.equal(release.remaining, 0);
  assert.equal(preview.closed, true);
  assert.equal(context.resolveOpenInitialImageSourceForDraw(
    'img-1',
    { id: 'obj-1', type: 'image', w: 500, h: 500 },
    { zoom: 0.1, dpr: 2 },
  ).source, full);
});

test('open preview remains drawable when the exact full bitmap decode fails', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const preview = { width: 50, height: 50, closed: false, close() { this.closed = true; } };
  context.imageOpenPreviewBitmapCache.set('img-1', {
    generation: context._imageStoreGeneration,
    bitmap: preview,
  });
  context.imageBitmapFailed.add('img-1');

  const selected = context.resolveOpenInitialImageSourceForDraw(
    'img-1',
    { id: 'obj-1', type: 'image', w: 500, h: 500 },
    { zoom: 0.1, dpr: 2 },
  );

  assert.equal(selected.source, preview);
  assert.equal(selected.openPreview, true);
  assert.equal(context.imageOpenPreviewBitmapCache.has('img-1'), true);
  assert.equal(preview.closed, false);
});

test('open preview draw queues scaled variant while keeping preview visible', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const preview = { width: 50, height: 50, close() {} };
  const full = { width: 4000, height: 4000, close() {} };
  const queued = [];
  context.queueScaledImageVariantForDraw = (key, obj, source, view, options) => {
    queued.push({ key, objectId: obj.id, source, view, priority: options?.priority === true });
    return 0.25;
  };
  context.isViewportImageScalingActive = () => true;
  context.chooseImageScaleForDraw = () => 0.25;
  context.hasScaledImageVariant = () => false;
  context.imageOpenPreviewBitmapCache.set('img-1', {
    generation: context._imageStoreGeneration,
    bitmap: preview,
  });
  context.imageBitmapCache['img-1'] = full;

  const selected = context.resolveOpenInitialImageSourceForDraw(
    'img-1',
    { id: 'obj-1', type: 'image', w: 500, h: 500 },
    { zoom: 0.1, dpr: 2 },
  );

  assert.equal(selected.source, preview);
  assert.equal(selected.openPreview, true);
  assert.equal(selected.targetScale, 0.25);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].key, 'img-1');
  assert.equal(queued[0].objectId, 'obj-1');
  assert.equal(queued[0].source, full);
  assert.equal(queued[0].view.zoom, 0.1);
  assert.equal(queued[0].view.dpr, 2);
  assert.equal(queued[0].priority, true);
});

test('open preview fallback queues dynamic previews for active low-zoom fallback images', async () => {
  const previewBitmap = { width: 40, height: 30, closed: false, close() { this.closed = true; } };
  const bitmapSources = [];
  const { context, timers } = loadImageState(async (source, options = {}) => {
    bitmapSources.push(source);
    return {
      ...previewBitmap,
      width: options.resizeWidth,
      height: options.resizeHeight,
    };
  });
  const src = 'data:image/png;base64,boardfish';
  const full = { width: 4000, height: 3000, close() {} };
  const existingPreview = { width: 12, height: 12, closed: false, close() { this.closed = true; } };
  const renderSources = [];
  context.imageStore['img-1'] = src;
  context.imageBitmapCache['img-1'] = full;
  context.imageOpenPreviewBitmapCache.set('img-open', {
    generation: context._imageStoreGeneration,
    bitmap: existingPreview,
  });
  context.selectImageSourceForDraw = () => ({
    source: full,
    scale: 1,
    targetScale: 0.25,
    scaledVariantPending: true,
    activeInputFullFallback: true,
  });
  context.scheduleRender = (_board, _overlay, source) => {
    renderSources.push(source);
  };

  const counters = {};
  const selected = context.resolveOpenInitialImageSourceForDraw(
    'img-1',
    { id: 'obj-1', type: 'image', data: { imgKey: 'img-1' }, w: 200, h: 150 },
    { zoom: 0.1, dpr: 2 },
    counters,
  );

  assert.equal(selected.activeInputFullFallback, true);
  assert.equal(counters.dynamicOpenPreviewRequests, 1);
  assert.equal(timers.length, 1);

  timers.shift().callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.imageOpenPreviewBitmapCache.get('img-1').width, 40);
  assert.equal(bitmapSources[0], full);
  assert.deepEqual(renderSources, ['open-preview-dynamic-ready']);
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
