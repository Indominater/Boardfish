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
    scheduleRender() {},
    scheduleVisibleImageWorkAfterIdle() {},
    _bulkImageInsertDepth: 0,
    _boardOpening: false,
    _imageReadyLastRender: 0,
    SaveDebug: noopDebugApi(),
    ExportDebug: noopDebugApi(),
    OpenDebug: noopDebugApi(),
    ViewportDebug: noopDebugApi(),
    ClipDebug: noopDebugApi(),
    clearScaledImageVariants() {},
    dropDrawableBitmapWarmup() {},
    scheduleDrawableBitmapWarmup() {},
    queueScaledImageVariantForReadyImage() {},
    isViewportImageScalingActive() { return false; },
    setCanvasImageQuality() {},
    createImageBitmap,
  };

  vm.createContext(context);
  vm.runInContext(
    `${fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8')}\n` +
      'globalThis.removeImageRuntimeCachesForKey = removeImageRuntimeCachesForKey;\n' +
      'globalThis.newImgKey = newImgKey;\n' +
      'globalThis.bitmapSourceFromImageSource = bitmapSourceFromImageSource;\n' +
      'globalThis.scheduleImageReadyRender = scheduleImageReadyRender;\n' +
      'globalThis.clearImageStore = clearImageStore;\n',
    context,
    { filename: 'image_state.js' },
  );
  return { context, rafs, timers };
}

test('image readiness throttles board frames and skips work during board opening', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const renders = [];
  let now = 1000;
  context.performance.now = () => now;
  context.scheduleRender = (...args) => { renders.push(args); };

  context.scheduleImageReadyRender();
  now = 1050;
  context.scheduleImageReadyRender();

  assert.deepEqual(renders, [[true, null, 'image-bitmap-ready']]);

  context._boardOpening = true;
  context.scheduleImageReadyRender();
  assert.equal(renders.length, 1);
});

test('Blob-backed web refs decode directly without a display URL', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const blob = new Blob([bytes], { type: 'image/png' });
  const source = { web: true, mime: 'image/png', bytes: bytes.length, __blob: blob };
  const decoded = [];
  const bitmap = { width: 4, height: 3, close() {} };
  const { context, rafs } = loadImageState(async (value) => {
    decoded.push(value);
    return bitmap;
  });
  context.BoardfishWebBoardContainer = {
    isWebImageRef: (value) => value?.web === true,
    blobForImageSource: (value) => value?.__blob || null,
  };
  context.imageStore['img-1'] = source;

  assert.equal(await context.bitmapSourceFromImageSource(source), blob);
  const ready = context.cacheImage('img-1', source, null);
  assert.equal(rafs.length, 1);
  rafs.shift()();
  await ready;
  assert.equal(decoded[0], blob);
  assert.equal(context.imageBitmapCache['img-1'], bitmap);
});

test('cacheImage shares one in-flight decode promise per image key', async () => {
  let decodes = 0;
  const bitmap = { width: 16, height: 16, close() {} };
  const { context, rafs } = loadImageState(async () => {
    decodes++;
    return bitmap;
  });
  const src = 'data:image/png;base64,boardfish';
  context.imageStore['img-1'] = src;

  const firstReady = context.cacheImage('img-1', src, null);
  const secondReady = context.cacheImage('img-1', src, null);

  assert.equal(secondReady, firstReady);
  assert.equal(rafs.length, 1);
  rafs.shift()();
  await firstReady;
  assert.equal(decodes, 1);
  assert.equal(context.imageBitmapCache['img-1'], bitmap);
});

test('cacheImage retries after a failed shared decode promise', async () => {
  let decodes = 0;
  const bitmap = { width: 16, height: 16, close() {} };
  const { context, rafs } = loadImageState(async () => {
    decodes++;
    if (decodes === 1) throw new Error('decode failed');
    return bitmap;
  });
  const src = 'data:image/png;base64,boardfish';
  context.imageStore['img-1'] = src;

  const failedReady = context.cacheImage('img-1', src, null);
  assert.equal(context.cacheImage('img-1', src, null), failedReady);
  rafs.shift()();
  assert.equal((await failedReady).cacheReadyStage, 'error');
  assert.equal(context.imageBitmapFailed.has('img-1'), true);

  const retryReady = context.cacheImage('img-1', src, null);
  assert.notEqual(retryReady, failedReady);
  assert.equal(rafs.length, 1);
  rafs.shift()();
  assert.equal((await retryReady).cacheReadyStage, 'bitmap');
  assert.equal(decodes, 2);
  assert.equal(context.imageBitmapFailed.has('img-1'), false);
  assert.equal(context.imageBitmapCache['img-1'], bitmap);
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
  const ready = context.cacheImage('img-1', src, null);
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

test('cacheImage retries a stale in-flight web ref against its replacement source', async () => {
  const firstBitmap = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const secondBitmap = { width: 16, height: 16, closed: false, close() { this.closed = true; } };
  const decodedSources = [];
  const { context, rafs } = loadImageState(async (blob) => {
    decodedSources.push(blob);
    return decodedSources.length === 1 ? firstBitmap : secondBitmap;
  });
  const firstSource = {
    web: true,
    mime: 'image/png',
    bytes: 1,
    __blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
  };
  const secondSource = {
    ...firstSource,
    __blob: new Blob([new Uint8Array([2])], { type: 'image/png' }),
  };
  context.BoardfishWebBoardContainer = {
    isWebImageRef: (value) => value?.web === true,
    blobForImageSource: (value) => value.__blob,
  };
  context.imageStore['img-1'] = firstSource;

  const firstReady = context.cacheImage('img-1', firstSource, null);
  assert.equal(rafs.length, 1);
  rafs.shift()();
  context.imageStore['img-1'] = secondSource;
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

  const ready = context.cacheImage('img-1', src, null);
  assert.equal(rafs.length, 1);
  rafs.shift()();
  await ready;

  assert.equal(warmups.length, 1);
  assert.equal(warmups[0].source, bitmap);
  assert.equal(warmups[0].meta.kind, 'full-image');
  assert.equal(warmups[0].meta.key, 'img-1');
  assert.equal(warmups[0].meta.source, 'cache-image');
});

test('cacheImage queues the exact scaled replacement for a decoded image', async () => {
  const bitmap = { width: 4000, height: 3000, close() {} };
  const queued = [];
  const { context, rafs } = loadImageState(() => Promise.resolve(bitmap));
  const src = 'data:image/png;base64,boardfish';
  context.queueScaledImageVariantForReadyImage = (key, source, priority) => {
    queued.push({ key, source, priority });
    return { key, scale: 0.25, queued: true };
  };
  context.imageStore['img-1'] = src;

  const ready = context.cacheImage('img-1', src, null);
  rafs.shift()();
  await ready;

  assert.equal(queued.length, 1);
  assert.equal(queued[0].key, 'img-1');
  assert.equal(queued[0].source, bitmap);
  assert.equal(queued[0].priority, false);
});

test('removeImageRuntimeCachesForKey clears runtime bitmap state for the removed image only', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  const removedBitmap = { closed: false, close() { this.closed = true; } };
  const keptBitmap = { closed: false, close() { this.closed = true; } };

  context.imageBitmapCache['img-1'] = removedBitmap;
  context.imageBitmapCache['img-2'] = keptBitmap;
  context.imageBitmapFailed.add('img-1');
  context.imageBitmapFailed.add('img-2');

  context.removeImageRuntimeCachesForKey('img-1');

  assert.equal(Object.hasOwn(context.imageBitmapCache, 'img-1'), false);
  assert.equal(context.imageBitmapFailed.has('img-1'), false);
  assert.equal(removedBitmap.closed, true);
  assert.equal(Object.hasOwn(context.imageBitmapCache, 'img-2'), true);
  assert.equal(context.imageBitmapFailed.has('img-2'), true);
  assert.equal(keptBitmap.closed, false);
});

test('clearImageStore clears shared scaled image work', () => {
  const { context } = loadImageState(() => Promise.resolve({ close() {} }));
  let clears = 0;
  context.clearScaledImageVariants = () => { clears++; };

  context.clearImageStore();

  assert.equal(clears, 1);
});

test('clearImageStore keeps in-flight decodes in the concurrency count', async () => {
  const pending = [];
  const { context, rafs } = loadImageState(() => new Promise((resolve) => pending.push(resolve)));
  const queue = (key) => {
    const source = `data:image/png;base64,${key}`;
    context.imageStore[key] = source;
    context.cacheImage(key, source);
  };
  queue('old-1');
  queue('old-2');
  rafs.shift()();
  await Promise.resolve();
  context.clearImageStore();
  queue('new-1');
  rafs.shift()();
  await Promise.resolve();
  assert.equal(pending.length, 2);
  for (const resolve of pending) resolve({ width: 1, height: 1, close() {} });
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
