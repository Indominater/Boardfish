'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadImageVariants(options = {}) {
  const context = {
    IS_MAC: false,
    window: { devicePixelRatio: 1 },
    zoom: 1,
    console,
    Map,
    Set,
    Math,
    clearTimeout() {},
    setTimeout() { return 0; },
    performance: { now: () => 0 },
  };
  if (options.navigator) context.navigator = options.navigator;

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'bitmap_cache.js'), 'utf8'),
    context,
    { filename: 'bitmap_cache.js' },
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8'),
    context,
    { filename: 'image_variants.js' },
  );
  return context;
}

function loadImageVariantsForPlatform(isMac, supportsCreateImageBitmap = true) {
  const context = {
    IS_MAC: isMac,
    window: { devicePixelRatio: 1 },
    zoom: 1,
    console,
    Map,
    Set,
    Math,
    clearTimeout() {},
    setTimeout() { return 0; },
    performance: { now: () => 0 },
    _boardOpening: false,
    _imageStoreGeneration: 0,
    imageCache: {},
    imageBitmapCache: {},
    objects: [],
    currentViewportWorldRect() { return null; },
    invalidateOffscreen() {},
    scheduleRender() {},
  };
  if (supportsCreateImageBitmap) {
    context.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  }

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'bitmap_cache.js'), 'utf8'),
    context,
    { filename: 'bitmap_cache.js' },
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8'),
    context,
    { filename: 'image_variants.js' },
  );
  return context;
}

function scaleFor(context, options) {
  return context.chooseImageScaleForDraw(
    { w: options.objW, h: options.objH },
    { width: options.sourceW, height: options.sourceH },
    { zoom: options.zoom, dpr: options.dpr },
  );
}

test('grouped bitmap cache prunes the least recently used variant', () => {
  const context = loadImageVariants();
  const closed = [];
  const evicted = [];
  const store = context.BoardfishBitmapCache.createGroupedLruCache({
    memoryLimit: 10,
    closeEntry: (entry) => closed.push(entry.id),
    entryBytes: (entry) => entry.bytes,
    onEvict: (entry, key, slot) => evicted.push({ id: entry.id, key, slot }),
  });

  store.set('img-a', 0.25, { id: 'a', bytes: 4 });
  store.set('img-b', 0.25, { id: 'b', bytes: 4 });
  store.get('img-a', 0.25);
  store.set('img-c', 0.25, { id: 'c', bytes: 4 });

  assert.equal(store.get('img-a', 0.25).id, 'a');
  assert.equal(store.get('img-b', 0.25), null);
  assert.equal(store.get('img-c', 0.25).id, 'c');
  assert.deepEqual(closed, ['b']);
  assert.deepEqual(evicted, [{ id: 'b', key: 'img-b', slot: 0.25 }]);
  assert.equal(store.bytes, 8);
});

test('grouped bitmap cache keeps a group tracked when replacing its only variant', () => {
  const context = loadImageVariants();
  const closed = [];
  const store = context.BoardfishBitmapCache.createGroupedLruCache({
    memoryLimit: 12,
    closeEntry: (entry) => closed.push(entry.id),
    entryBytes: (entry) => entry.bytes,
  });

  store.set('img-a', 0.25, { id: 'a1', bytes: 4 });
  store.set('img-a', 0.25, { id: 'a2', bytes: 4 });

  assert.equal(store.get('img-a', 0.25).id, 'a2');
  assert.equal(store.groups.get('img-a').get(0.25).id, 'a2');
  assert.deepEqual(closed, ['a1']);
  assert.equal(store.bytes, 4);
});

test('chooses the smallest scaled variant that preserves display-pixel detail', () => {
  const context = loadImageVariants();

  assert.equal(scaleFor(context, { sourceW: 400, sourceH: 200, objW: 100, objH: 50, zoom: 1, dpr: 1 }), 0.25);
  assert.equal(scaleFor(context, { sourceW: 400, sourceH: 200, objW: 100.01, objH: 50, zoom: 1, dpr: 1 }), 1);
  assert.equal(scaleFor(context, { sourceW: 400, sourceH: 200, objW: 100, objH: 50.01, zoom: 1, dpr: 1 }), 1);
  assert.equal(scaleFor(context, { sourceW: 400, sourceH: 200, objW: 200.01, objH: 100, zoom: 1, dpr: 1 }), 1);
});

test('uses the supplied view zoom for alternate draw contexts', () => {
  const context = loadImageVariants();
  context.zoom = 1;

  assert.equal(scaleFor(context, {
    sourceW: 100,
    sourceH: 100,
    objW: 10,
    objH: 10,
    zoom: 3,
    dpr: 2,
  }), 1);
});

test('does not add a one-device-pixel floor to the threshold', () => {
  const context = loadImageVariants();

  assert.equal(scaleFor(context, {
    sourceW: 2,
    sourceH: 2,
    objW: 1,
    objH: 1,
    zoom: 0.1,
    dpr: 1,
  }), 0.25);
});

test('scaled variants round up so the bitmap is not below the qualifying size', () => {
  const context = loadImageVariants();

  assert.equal(context.scaledVariantEstimatedBytes(101, 17, 0.25), 26 * 5 * 4);
});

test('generic bitmap draw warmup samples the full source into a 1px canvas', () => {
  const context = loadImageVariants();
  const drawCalls = [];
  context.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(type) {
          assert.equal(type, '2d');
          return {
            clearRect() {},
            drawImage(...args) { drawCalls.push(args); },
          };
        },
      };
    },
  };

  const source = { width: 320, height: 180 };
  const result = context.warmDrawableBitmapForDrawNow(source, { key: 'img-1' });

  assert.equal(result.warmed, true);
  assert.deepEqual(drawCalls[0], [source, 0, 0, 320, 180, 0, 0, 1, 1]);
  assert.equal(context.drawableBitmapWarmupWarmedByKind.other, 1);
});

test('full image draw warmup uses a bounded real-size sample', () => {
  const context = loadImageVariants();
  const drawCalls = [];
  context.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(type) {
          assert.equal(type, '2d');
          return {
            clearRect() {},
            drawImage(...args) { drawCalls.push(args); },
          };
        },
      };
    },
  };

  const source = { width: 512, height: 256 };
  const result = context.warmDrawableBitmapForDrawNow(source, { kind: 'full-image', key: 'img-1' });

  assert.equal(result.warmed, true);
  assert.equal(result.width, 256);
  assert.equal(result.height, 128);
  assert.deepEqual(drawCalls[0], [source, 0, 0, 512, 256, 0, 0, 256, 128]);
  assert.equal(context.drawableBitmapWarmupWarmedByKind.fullImage, 1);
});

test('scaled bitmap draw warmup uses a bounded real-size sample', () => {
  const context = loadImageVariants();
  const drawCalls = [];
  context.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            clearRect() {},
            drawImage(...args) { drawCalls.push(args); },
          };
        },
      };
    },
  };

  const source = { width: 1024, height: 768 };
  const result = context.warmDrawableBitmapForDrawNow(source, { kind: 'scaled-variant', key: 'img-1' });

  assert.equal(result.warmed, true);
  assert.equal(result.width, 512);
  assert.equal(result.height, 384);
  assert.deepEqual(drawCalls[0], [source, 0, 0, 1024, 768, 0, 0, 512, 384]);
  assert.equal(context.drawableBitmapWarmupMaxPixels, 512 * 384);
});

test('source-ready images queue the low zoom scaled variant before first draw', () => {
  const context = loadImageVariantsForPlatform(false);
  const source = { width: 4000, height: 3000 };

  const result = context.queueScaledImageVariantForReadyImage('img-1', source, { scale: 0.25 });

  assert.equal(result.key, 'img-1');
  assert.equal(result.scale, 0.25);
  assert.equal(result.queued, true);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), true);
  assert.equal(context.imageScaledVariantSourceReadyCandidateCount, 1);
  assert.equal(context.imageScaledVariantSourceReadyQueuedCount, 1);
  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(context.imageScaledVariantQueue[0].pendingKey, 'img-1:0.25');
});

test('scaled image variant cache stays bounded with web headroom cap', () => {
  const context = loadImageVariants();

  assert.equal(context.IMAGE_VARIANT_MEMORY_LIMIT, 1024 * 1024 * 1024);
});

test('scaled image variant cache scales down on low-memory devices', () => {
  const context = loadImageVariants({ navigator: { deviceMemory: 1 } });

  assert.equal(context.IMAGE_VARIANT_MEMORY_LIMIT, 256 * 1024 * 1024);
});

test('scaled image variants are platform-independent when createImageBitmap is available', () => {
  const context = loadImageVariantsForPlatform(true);

  assert.equal(context.VIEWPORT_IMAGE_SCALING_SUPPORTED, true);
  assert.equal(context.viewportImageScalingEnabled, true);
  assert.equal(context.isViewportImageScalingActive(), true);
  assert.equal(context.setViewportPerfMode('1').scalingEnabled, true);

  const fullSource = { width: 100, height: 100 };
  const selected = context.selectImageSourceForDraw(
    'img-1',
    { w: 10, h: 10 },
    fullSource,
    { zoom: 0.1, dpr: 1 },
  );
  assert.equal(selected.source, fullSource);
  assert.equal(selected.scale, 1);
  assert.equal(selected.targetScale, 0.25);
  assert.equal(selected.disabled, undefined);
});

test('active low-zoom navigation preserves full-size fallback while scaled variant is pending', () => {
  const context = loadImageVariantsForPlatform(false);
  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;
  const fullSource = { width: 4000, height: 4000 };

  const selected = context.selectImageSourceForDraw(
    'img-1',
    { w: 500, h: 500 },
    fullSource,
    { zoom: 0.1, dpr: 1 },
  );

  assert.equal(selected.source, fullSource);
  assert.equal(selected.scale, 1);
  assert.equal(selected.targetScale, 0.25);
  assert.equal(selected.scaledVariantPending, true);
  assert.equal(selected.activeInputFullFallback, true);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), true);
  assert.equal(context.imageScaledVariantActiveInputFullFallbackCount, 1);
});

test('active low-zoom navigation prioritizes visible pending scaled variants', () => {
  const context = loadImageVariantsForPlatform(false);
  const fullSource = { width: 4000, height: 4000 };
  const pendingKeys = () => Array.from(context.imageScaledVariantQueue, (task) => task.pendingKey);

  context.queueScaledImageVariant('img-1', fullSource, 0.25);
  context.queueScaledImageVariant('img-2', fullSource, 0.25);
  assert.deepEqual(pendingKeys(), ['img-1:0.25', 'img-2:0.25']);

  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;
  context.selectImageSourceForDraw(
    'img-2',
    { w: 500, h: 500 },
    fullSource,
    { zoom: 0.1, dpr: 1 },
  );

  assert.deepEqual(pendingKeys(), ['img-2:0.25', 'img-1:0.25']);
  assert.equal(context.imageScaledVariantPriorityBoostCount, 1);
});

test('active navigation can keep a nearly large enough 0.25x variant instead of full-size draw', async () => {
  const context = loadImageVariantsForPlatform(false);
  const fullSource = { width: 1500, height: 2000 };
  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;

  await context.buildScaledImageVariantNow('img-1', fullSource, 0.25, {
    scheduleRender: false,
    warmupImmediate: true,
  });

  const active = context.selectImageSourceForDraw(
    'img-1',
    { w: 450, h: 600 },
    fullSource,
    { zoom: 0.42, dpr: 2 },
  );
  assert.equal(active.scale, 0.25);
  assert.equal(active.targetScale, 0.25);

  context.performance.now = () => 2000;
  const idle = context.selectImageSourceForDraw(
    'img-1',
    { w: 450, h: 600 },
    fullSource,
    { zoom: 0.42, dpr: 2 },
  );
  assert.equal(idle.scale, 1);
  assert.equal(idle.targetScale, 1);
});

test('scaled variant queue starts a small concurrent batch per tick', async () => {
  const context = loadImageVariantsForPlatform(false);
  const timers = [];
  const resolvers = [];
  let activeBuilds = 0;
  let maxActiveBuilds = 0;
  context.setTimeout = (callback, ms = 0) => {
    timers.push({ callback, ms });
    return timers.length;
  };
  context.createImageBitmap = () => new Promise((resolve) => {
    activeBuilds++;
    maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
    resolvers.push(() => {
      activeBuilds--;
      resolve({ width: 25, height: 25, close() {} });
    });
  });

  for (let i = 0; i < 5; i++) {
    context.queueScaledImageVariant(`img-${i}`, { width: 100, height: 100 }, 0.25);
  }

  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 0);
  timers.shift().callback();
  assert.equal(context.imageScaledVariantQueueActive, 4);
  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(maxActiveBuilds, 4);

  resolvers.splice(0).forEach((resolve) => resolve());
  await new Promise((resolve) => setImmediate(resolve));

  const queueTimerIndex = timers.findIndex((timer) => timer.ms === 0);
  assert.notEqual(queueTimerIndex, -1);
  timers.splice(queueTimerIndex, 1)[0].callback();
  assert.equal(context.imageScaledVariantQueueActive, 1);
  assert.equal(context.imageScaledVariantQueue.length, 0);

  resolvers.splice(0).forEach((resolve) => resolve());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.imageScaledVariantQueueActive, 0);
  assert.equal(context.imageScaledVariantBuildCount, 5);
});

test('idle low-zoom drawing preserves full-size fallback until scaled variants are ready', () => {
  const context = loadImageVariantsForPlatform(false);
  context.performance.now = () => 1000;
  context.lastViewportInputAt = 0;
  const fullSource = { width: 4000, height: 4000 };

  const selected = context.selectImageSourceForDraw(
    'img-1',
    { w: 500, h: 500 },
    fullSource,
    { zoom: 0.1, dpr: 1 },
  );

  assert.equal(selected.source, fullSource);
  assert.equal(selected.scale, 1);
  assert.equal(selected.targetScale, 0.25);
  assert.equal(selected.scaledVariantPending, undefined);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), true);
});

test('open prewarm builds visible scaled variants before first render', async () => {
  const context = loadImageVariantsForPlatform(false);
  const resizeOptions = [];
  context.zoom = 0.2;
  context.window.devicePixelRatio = 2;
  context._boardOpening = true;
  context.currentViewportWorldRect = () => ({ x1: -10, y1: -10, x2: 1000, y2: 1000 });
  context.objectIntersectsRect = (obj, rect) => (
    obj.x < rect.x2 && obj.x + obj.w > rect.x1 &&
    obj.y < rect.y2 && obj.y + obj.h > rect.y1
  );
  context.createImageBitmap = async (_source, options = {}) => {
    resizeOptions.push(options);
    return { width: options.resizeWidth || 1, height: options.resizeHeight || 1, close() {} };
  };
  context.imageBitmapCache['img-1'] = { width: 4000, height: 4000, close() {} };
  context.imageBitmapCache['img-2'] = { width: 4000, height: 4000, close() {} };
  context.objects = [
    { id: 'obj-1', type: 'image', x: 0, y: 0, w: 500, h: 500, data: { imgKey: 'img-1' } },
    { id: 'obj-2', type: 'image', x: 5000, y: 5000, w: 500, h: 500, data: { imgKey: 'img-2' } },
  ];

  const result = await context.prewarmVisibleScaledImageVariantsForOpen({ concurrency: 2 });

  assert.equal(result.candidates, 1);
  assert.equal(result.built, 1);
  assert.equal(result.noSource, 0);
  assert.equal(context.hasScaledImageVariant('img-1', 0.25), true);
  assert.equal(context.hasScaledImageVariant('img-2', 0.25), false);
  assert.equal(resizeOptions[0].resizeWidth, 1000);
  assert.equal(resizeOptions[0].resizeHeight, 1000);
  assert.equal(resizeOptions[0].resizeQuality, 'high');
});

test('scaled variant ready render is held while opening previews are active', () => {
  const context = loadImageVariantsForPlatform(false);
  const renders = [];
  const heldRenders = [];
  let invalidated = 0;
  const timers = [];
  context._frameRaf = false;
  context._needTransform = false;
  context._needBoardRender = false;
  context.invalidateOffscreen = () => { invalidated++; };
  context.scheduleRender = (...args) => { renders.push(args); };
  context.setTimeout = (callback) => {
    timers.push(callback);
    return timers.length;
  };
  context.OpenDebug = {
    recordPreviewHeldRender(meta) {
      heldRenders.push(meta);
    },
  };
  context.hasOpenInitialImagePreviews = () => true;

  context.scheduleScaledVariantReadyRender();

  assert.equal(invalidated, 1);
  assert.equal(renders.length, 0);
  assert.equal(timers.length, 0);
  assert.equal(context.imageScaledVariantRenderCount, 1);
  assert.equal(heldRenders.length, 1);
  assert.equal(heldRenders[0].source, 'image-scale-variant');
  assert.equal(heldRenders[0].pendingReadyVariants, 1);

  context.hasOpenInitialImagePreviews = () => false;
  context.performance.now = () => 1000;
  context.scheduleScaledVariantReadyRender(false);
  assert.equal(timers.length, 1);
  timers[0]();

  assert.deepEqual(renders, [[true, false, 'image-scale-variant-batch-1']]);
  assert.equal(context.imageScaledVariantRenderCount, 0);
});

test('failed open previews do not hold scaled variant ready renders', () => {
  const context = loadImageVariantsForPlatform(false);
  const renders = [];
  const heldRenders = [];
  const timers = [];
  context._frameRaf = false;
  context._needTransform = false;
  context._needBoardRender = false;
  context.lastViewportInputAt = 0;
  context.performance.now = () => 1000;
  context.scheduleRender = (...args) => { renders.push(args); };
  context.setTimeout = (callback) => {
    timers.push(callback);
    return timers.length;
  };
  context.OpenDebug = {
    step() {},
    recordPreviewHeldRender(meta) {
      heldRenders.push(meta);
    },
  };
  context.hasOpenInitialImagePreviews = () => true;
  context.releaseReadyOpenInitialImagePreviewsForOpen = () => ({
    total: 1,
    ready: 0,
    pending: 0,
    failed: 1,
    stale: 0,
    released: 0,
    remaining: 1,
  });

  context.scheduleScaledVariantReadyRender();

  assert.equal(heldRenders.length, 0);
  assert.equal(timers.length, 1);
  timers[0]();
  assert.deepEqual(renders, [[true, false, 'image-scale-variant-batch-1']]);
  assert.equal(context.imageScaledVariantRenderCount, 0);
});

test('scaled image variants stay disabled when createImageBitmap is unavailable', () => {
  const context = loadImageVariantsForPlatform(false, false);

  assert.equal(context.VIEWPORT_IMAGE_SCALING_SUPPORTED, false);
  assert.equal(context.viewportImageScalingEnabled, false);
  assert.equal(context.isViewportImageScalingActive(), false);
  assert.equal(context.setViewportPerfMode('1').scalingEnabled, false);
});

test('stale scaled image variant tasks skip resize work', async () => {
  const context = loadImageVariantsForPlatform(false);
  let resizeCalls = 0;
  context.createImageBitmap = async () => {
    resizeCalls++;
    return { width: 50, height: 50, close() {} };
  };

  context.queueScaledImageVariant('img-1', { width: 100, height: 100 }, 0.25);
  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), true);

  const task = context.imageScaledVariantQueue.shift();
  context._imageStoreGeneration++;
  await task();

  assert.equal(resizeCalls, 0);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), false);
  assert.equal(context.hasScaledImageVariant('img-1', 0.25), false);
});

test('clearing scaled variants for one key removes queued work for that key', () => {
  const context = loadImageVariantsForPlatform(false);

  context.queueScaledImageVariant('img-1', { width: 100, height: 100 }, 0.25);
  context.queueScaledImageVariant('img-2', { width: 100, height: 100 }, 0.25);

  assert.equal(context.imageScaledVariantQueue.length, 2);
  context.clearScaledImageVariants('img-1');

  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(context.imageScaledVariantQueue[0].variantKey, 'img-2');
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), false);
  assert.equal(context.isScaledImageVariantPending('img-2', 0.25), true);
});

test('scaled image variant skips do not create empty cache groups', () => {
  const context = loadImageVariantsForPlatform(false);

  context.queueScaledImageVariant('img-missing-size', { width: 0, height: 100 }, 0.25);
  assert.equal(context.imageScaledBitmapCache.has('img-missing-size'), false);
  assert.equal(context.isScaledImageVariantPending('img-missing-size', 0.25), false);

  context.queueScaledImageVariant('img-too-large', { width: 100000, height: 100000 }, 0.25);
  assert.equal(context.imageScaledBitmapCache.has('img-too-large'), false);
  assert.equal(context.isScaledImageVariantPending('img-too-large', 0.25), false);
});

test('image bitmap queue does not wait for animation frames during board open', () => {
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(imageStateSource, /if \(typeof _boardOpening !== 'undefined' && _boardOpening\) \{/);
  assert.match(imageStateSource, /setTimeout\(processImageDecodeQueue, 0\);/);
  assert.match(imageStateSource, /requestAnimationFrame\(processImageDecodeQueue\);/);
});

test('undo-history lifecycle prunes image caches to current board, history, and clipboard keys', () => {
  const historySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'history_state.js'), 'utf8');
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(imageStateSource, /const pruneImageCachesToKeys = \(retainedKeys = new Set\(\)\) =>/);
  assert.match(imageStateSource, /revokeWebImageSource\(imageStore\[key\]\);/);
  assert.match(imageStateSource, /delete imageStore\[key\];/);
  assert.match(historySource, /function retainedImageKeysForCurrentAndHistory\(\)/);
  assert.match(historySource, /collectImageKeysFromObjects\(objects, keys\)/);
  assert.match(historySource, /for \(const entry of boardHistory\)/);
  assert.match(historySource, /collectImageKeysFromObjects\(jsClipboard\?\.objects, keys\)/);
  assert.match(historySource, /const clipboardImageData = jsClipboard\?\.imageData \|\| \{\};/);
  assert.match(historySource, /for \(const key in clipboardImageData\)/);
  assert.match(historySource, /keys\.add\(key\)/);
  assert.match(historySource, /pruneImageCachesToKeys\(retainedKeys\)/);
});

test('async image cache writes use generation guards', () => {
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(imageStateSource, /const isImageDisplayCacheRequestCurrent = \(key, src, generation\) =>/);
  assert.match(imageStateSource, /if \(!isImageDisplayCacheRequestCurrent\(key, displaySrc, generation\)\)/);
  assert.match(imageStateSource, /if \(isImageDisplayCacheRequestCurrent\(key, displaySrc, generation\)\) imageBitmapFailed\.add\(key\);/);
});

test('low-zoom active navigation records visible full-size fallbacks until scaled variants are ready', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'renderer.js'), 'utf8');

  assert.match(source, /IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS/);
  assert.match(source, /IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT/);
  assert.match(source, /chooseImageScaleForDraw\(obj, fullSource, view, \{ activeOverscale: activeInput \}\)/);
  assert.match(source, /queueScaledImageVariantForDraw\(key, obj, fullSource, view, \{ priority: activeInput, activeOverscale: activeInput \}\);/);
  assert.match(source, /scaledVariantPending: true/);
  assert.match(source, /activeInputFullFallback: true/);
  assert.doesNotMatch(source, /source: null/);
  assert.match(rendererSource, /scaledVariantPending = drawCounterValue/);
  assert.match(rendererSource, /activeInputFullFallbackImages/);
  assert.match(rendererSource, /scaled-variant-pending-active-input/);
  assert.match(rendererSource, /scaledVariantPendingImages/);
});
