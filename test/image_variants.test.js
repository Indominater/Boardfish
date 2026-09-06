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
    mapWithConcurrency(items, _limit, worker) { return Promise.all(items.map(worker)); },
  };
  if (options.navigator) context.navigator = options.navigator;

  vm.createContext(context);
  vm.runInContext('globalThis.window = globalThis; window.devicePixelRatio = 1;', context);
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
    mapWithConcurrency(items, _limit, worker) { return Promise.all(items.map(worker)); },
    _boardOpening: false,
    _imageStoreGeneration: 0,
    imageBitmapCache: {},
    objects: [],
    viewportWorldRect() { return null; },
    invalidateOffscreen() {},
    scheduleRender() {},
    queueVisibleImageHydration() {},
  };
  if (supportsCreateImageBitmap) {
    context.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  }

  vm.createContext(context);
  vm.runInContext('globalThis.window = globalThis; window.devicePixelRatio = 1;', context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8'),
    context,
    { filename: 'image_variants.js' },
  );
  return context;
}

function installManualTimers(context) {
  const timers = [];
  let nextId = 1;
  context.setTimeout = (callback, ms = 0) => {
    const timer = { id: nextId++, callback, ms, cleared: false, fired: false };
    timers.push(timer);
    return timer.id;
  };
  context.clearTimeout = (id) => {
    const timer = timers.find((entry) => entry.id === id);
    if (timer) timer.cleared = true;
  };
  return {
    timers,
    pending() {
      return timers.filter((timer) => !timer.cleared && !timer.fired);
    },
    run(timer) {
      assert.ok(timer);
      assert.equal(timer.cleared, false);
      assert.equal(timer.fired, false);
      timer.fired = true;
      timer.callback();
    },
  };
}

function scaleFor(context, options) {
  return context.chooseImageScaleForDraw(
    { w: options.objW, h: options.objH },
    { width: options.sourceW, height: options.sourceH },
    { zoom: options.zoom, dpr: options.dpr },
  );
}

test('scaled bitmap cache evicts the oldest fixed-scale variant', () => {
  const context = loadImageVariants();
  const bitmap = (id) => ({ id, closed: false, close() { this.closed = true; } });
  const a = bitmap('a'), b = bitmap('b'), c = bitmap('c');
  context.IMAGE_VARIANT_MEMORY_LIMIT = 10;

  context.setScaledImageVariant('img-a', { bitmap: a, bytes: 4 });
  context.setScaledImageVariant('img-b', { bitmap: b, bytes: 4 });
  context.imageScaledBitmapCache.get('img-a');
  context.setScaledImageVariant('img-c', { bitmap: c, bytes: 4 });

  assert.equal(context.imageScaledBitmapCache.has('img-a'), false);
  assert.equal(context.imageScaledBitmapCache.get('img-b').bitmap, b);
  assert.equal(context.imageScaledBitmapCache.get('img-c').bitmap, c);
  assert.equal(a.closed, true);
  assert.equal(b.closed, false);
  assert.equal(context.imageScaledBitmapBytes, 8);
  assert.equal(context.imageScaledVariantEvictionCount, 1);
});

test('scaled bitmap cache closes replacements and tracks their bytes', () => {
  const context = loadImageVariants();
  const first = { closed: false, close() { this.closed = true; } };
  const second = { closed: false, close() { this.closed = true; } };

  context.setScaledImageVariant('img-a', { bitmap: first, bytes: 4 });
  context.drawableBitmapWarmupQueue.set(first, { key: 'img-a' });
  context.setScaledImageVariant('img-a', { bitmap: second, bytes: 6 });

  assert.equal(context.imageScaledBitmapCache.get('img-a').bitmap, second);
  assert.equal(context.drawableBitmapWarmupQueue.has(first), false);
  assert.equal(first.closed, true);
  assert.equal(second.closed, false);
  assert.equal(context.imageScaledBitmapBytes, 6);
});

test('chooses the smallest scaled variant that preserves display-pixel detail', () => {
  const context = loadImageVariants();

  assert.deepEqual(Array.from(context.IMAGE_SCALE_LEVELS), [0.25]);
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
  let clearCalls = 0;
  let smoothingWrites = 0;
  let qualityWrites = 0;
  let warmupCanvas = null;
  context.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      warmupCanvas = {
        width: 0,
        height: 0,
        getContext(type) {
          assert.equal(type, '2d');
          assert.equal(this.width, 1);
          assert.equal(this.height, 1);
          const drawContext = {
            clearRect() { clearCalls++; },
            drawImage(...args) { drawCalls.push(args); },
          };
          Object.defineProperty(drawContext, 'imageSmoothingEnabled', {
            set(value) {
              assert.equal(value, false);
              smoothingWrites++;
            },
          });
          Object.defineProperty(drawContext, 'imageSmoothingQuality', {
            set() { qualityWrites++; },
          });
          return drawContext;
        },
      };
      return warmupCanvas;
    },
  };

  const source = { width: 320, height: 180 };
  const result = context.warmDrawableBitmapForDrawNow(source, { key: 'img-1' });

  assert.equal(result.warmed, true);
  assert.deepEqual(drawCalls[0], [source, 0, 0, 320, 180, 0, 0, 1, 1]);
  assert.deepEqual({ width: warmupCanvas.width, height: warmupCanvas.height }, { width: 1, height: 1 });
  assert.equal(smoothingWrites, 1);
  assert.equal(qualityWrites, 0);
  assert.equal(clearCalls, 0);
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

  const result = context.queueScaledImageVariantForReadyImage('img-1', source);

  assert.equal(result.key, 'img-1');
  assert.equal(result.scale, 0.25);
  assert.equal(result.queued, true);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), true);
  assert.equal(context.imageScaledVariantSourceReadyCandidateCount, 1);
  assert.equal(context.imageScaledVariantSourceReadyQueuedCount, 1);
  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(context.imageScaledVariantQueue[0].key, 'img-1');
});

test('source-ready preview priority promotes an already pending scaled replacement', () => {
  const context = loadImageVariantsForPlatform(false);
  const source = { width: 4000, height: 3000 };
  context.queueScaledImageVariant('img-1', source, 0.25);
  assert.equal(context.imageScaledVariantQueue[0].priority, false);

  const result = context.queueScaledImageVariantForReadyImage('img-1', source, true);

  assert.equal(result.queued, false);
  assert.equal(result.skipped, 'pending');
  assert.equal(result.priorityBoosted, true);
  assert.equal(context.imageScaledVariantQueue[0].priority, true);
});

test('scaled image variant cache stays bounded with web headroom cap', () => {
  const context = loadImageVariants();

  assert.equal(context.IMAGE_VARIANT_MEMORY_LIMIT, 1024 * 1024 * 1024);
});

test('scaled image variant cache uses the same budget on low-memory reported devices', () => {
  const context = loadImageVariants({ navigator: { deviceMemory: 1 } });

  assert.equal(context.IMAGE_VARIANT_MEMORY_LIMIT, 1024 * 1024 * 1024);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8');
  assert.doesNotMatch(source, /deviceMemory|userAgent|\bAndroid\b/);
});

test('open image cache settle drains every scaled task and drawable warmup', async () => {
  const context = loadImageVariants();
  const calls = [];
  context.imageScaledVariantQueue.push(
    async () => calls.push('scaled-a'),
    async () => calls.push('scaled-b'),
  );
  context.drawableBitmapWarmupQueue.set(
    { width: 20, height: 10 },
    { kind: 'full-image', key: 'img-a' },
  );

  const result = await context.settleOpenImageDrawCaches(2);

  assert.deepEqual(calls.sort(), ['scaled-a', 'scaled-b']);
  assert.equal(context.imageScaledVariantQueue.length, 0);
  assert.equal(context.drawableBitmapWarmupQueue.size, 0);
  assert.equal(result.scaledTasks, 2);
  assert.equal(result.drawableWarmups, 1);
  assert.equal(result.pendingScaledVariants, 0);
  assert.equal(result.pendingDrawableWarmups, 0);
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
  const pendingKeys = () => Array.from(context.imageScaledVariantQueue, (task) => task.key);

  context.queueScaledImageVariant('img-1', fullSource, 0.25);
  context.queueScaledImageVariant('img-2', fullSource, 0.25);
  assert.deepEqual(pendingKeys(), ['img-1', 'img-2']);

  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;
  context.selectImageSourceForDraw(
    'img-2',
    { w: 500, h: 500 },
    fullSource,
    { zoom: 0.1, dpr: 1 },
  );

  assert.deepEqual(pendingKeys(), ['img-2', 'img-1']);
  assert.equal(context.imageScaledVariantPriorityBoostCount, 1);
});

test('scaled variant queue defers background work until viewport input is idle', () => {
  const context = loadImageVariantsForPlatform(false);
  const clock = installManualTimers(context);
  let now = 1000;
  let starts = 0;
  context.performance.now = () => now;
  context.lastViewportInputAt = 990;

  context.enqueueScaledVariantTask(async () => { starts++; });

  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 170);
  clock.run(clock.pending()[0]);
  assert.equal(starts, 0);
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 170);

  now = 1170;
  clock.run(clock.pending()[0]);
  assert.equal(starts, 1);
});

test('priority scaled variants start during input without pulling background work into the batch', () => {
  const context = loadImageVariantsForPlatform(false);
  const clock = installManualTimers(context);
  const starts = [];
  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;

  context.enqueueScaledVariantTask(async () => {
    starts.push('background');
    await new Promise(() => {});
  });
  const backgroundTimer = clock.pending()[0];
  context.enqueueScaledVariantTask(async () => {
    starts.push('priority');
    await new Promise(() => {});
  }, true);

  assert.equal(backgroundTimer.cleared, true);
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 0);
  clock.run(clock.pending()[0]);

  assert.deepEqual(starts, ['priority']);
  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(context.imageScaledVariantQueue[0].priority, false);
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 170);
});

test('promoting the sole pending scaled variant wakes its delayed queue timer', () => {
  const context = loadImageVariantsForPlatform(false);
  const clock = installManualTimers(context);
  let starts = 0;
  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;
  const task = async () => {
    starts++;
    await new Promise(() => {});
  };
  task.key = 'img-1';

  context.enqueueScaledVariantTask(task);
  const backgroundTimer = clock.pending()[0];
  const promoted = context.prioritizeScaledVariantQueue(task.key);

  assert.equal(promoted, true);
  assert.equal(task.priority, true);
  assert.equal(context.imageScaledVariantPriorityBoostCount, 1);
  assert.equal(backgroundTimer.cleared, true);
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 0);
  clock.run(clock.pending()[0]);
  assert.equal(starts, 1);
});

test('active navigation can keep a nearly large enough 0.25x variant instead of full-size draw', async () => {
  const context = loadImageVariantsForPlatform(false);
  const fullSource = { width: 1500, height: 2000 };
  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;

  context.queueScaledImageVariantForReadyImage('img-1', fullSource);
  await context.settleOpenImageDrawCaches();

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

test('visible image idle work shares one timer and waits for the latest input', () => {
  const context = loadImageVariantsForPlatform(false);
  const clock = installManualTimers(context);
  const hydrations = [];
  let now = 1000;
  context.performance.now = () => now;
  context.lastViewportInputAt = now;
  context.viewportWorldRect = () => ({});
  context.queueVisibleImageHydration = (limit) => hydrations.push(limit);

  context.scheduleVisibleImageWorkAfterIdle();
  context._boardOpening = true;
  clock.run(clock.pending()[0]);
  assert.deepEqual(hydrations, []);
  context._boardOpening = false;
  context.scheduleVisibleImageWorkAfterIdle();
  now = context.lastViewportInputAt = 1100;
  context.scheduleVisibleImageWorkAfterIdle();
  assert.equal(clock.pending().length, 1);
  now = 1180;
  clock.run(clock.pending()[0]);
  assert.equal(clock.pending()[0].ms, 100);
  now = 1280;
  clock.run(clock.pending()[0]);
  assert.deepEqual(hydrations, [1]);
  assert.equal(context.imageScaledVariantPrewarmRunCount, 1);
  context.scheduleVisibleImageWorkAfterIdle();
  context.clearScaledImageVariants();
  assert.equal(clock.pending().length, 0);
});

test('visible image idle work hydrates when scaled variants are unavailable', () => {
  const context = loadImageVariantsForPlatform(false, false);
  const clock = installManualTimers(context);
  const hydrations = [];
  context.performance.now = () => 180;
  context.queueVisibleImageHydration = (limit) => hydrations.push(limit);

  context.scheduleVisibleImageWorkAfterIdle();
  clock.run(clock.pending()[0]);

  assert.deepEqual(hydrations, [1]);
  assert.equal(context.imageScaledVariantPrewarmRunCount, 0);
});

test('scaled variant ready render uses input activity at timer fire after input settles', () => {
  const context = loadImageVariantsForPlatform(false);
  const clock = installManualTimers(context);
  const renders = [];
  let now = 1000;
  context.performance.now = () => now;
  context.lastViewportInputAt = 990;
  context.scheduleRender = (...args) => { renders.push(args); };

  context.scheduleScaledVariantReadyRender();
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 170);

  now = 1170;
  clock.run(clock.pending()[0]);

  assert.deepEqual(renders, [[true, null, 'image-scale-variant-batch-1']]);
  assert.equal(clock.pending().length, 0);
});

test('scaled variant ready render defers when input starts before timer fire', () => {
  const context = loadImageVariantsForPlatform(false);
  const clock = installManualTimers(context);
  const renders = [];
  let now = 1000;
  context.performance.now = () => now;
  context.lastViewportInputAt = 0;
  context.scheduleRender = (...args) => { renders.push(args); };

  context.scheduleScaledVariantReadyRender();
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 120);

  context.lastViewportInputAt = 990;
  clock.run(clock.pending()[0]);
  assert.deepEqual(renders, []);
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].ms, 170);

  now = 1170;
  clock.run(clock.pending()[0]);
  assert.deepEqual(renders, [[true, null, 'image-scale-variant-batch-1']]);
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
  assert.equal(context.imageScaledVariantQueue[0].key, 'img-2');
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), false);
  assert.equal(context.isScaledImageVariantPending('img-2', 0.25), true);
});

test('clearing the final queued scaled variant cancels its delayed timer', () => {
  const context = loadImageVariantsForPlatform(false);
  const clock = installManualTimers(context);
  context.performance.now = () => 1000;
  context.lastViewportInputAt = 990;

  context.queueScaledImageVariant('img-1', { width: 100, height: 100 }, 0.25);
  const delayedTimer = clock.pending()[0];
  context.clearScaledImageVariants('img-1');

  assert.equal(delayedTimer.cleared, true);
  assert.equal(context.imageScaledVariantQueue.length, 0);
  assert.equal(context.imageScaledVariantQueueTimer, null);
  assert.equal(context.imageScaledVariantQueueTimer, null);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.25), false);
});

test('scaled image variant skips do not create empty cache groups', () => {
  const context = loadImageVariantsForPlatform(false);

  const missing = context.queueScaledImageVariant('img-missing-size', { width: 0, height: 100 }, 0.25);
  assert.equal(missing.queued, false);
  assert.equal(missing.skipped, 'missing-size');
  assert.equal(context.imageScaledBitmapCache.has('img-missing-size'), false);
  assert.equal(context.isScaledImageVariantPending('img-missing-size', 0.25), false);

  const tooLarge = context.queueScaledImageVariantForReadyImage(
    'img-too-large',
    { width: 100000, height: 100000 },
  );
  assert.equal(tooLarge.queued, false);
  assert.equal(tooLarge.skipped, 'memory-limit');
  assert.equal(context.imageScaledVariantSourceReadyQueuedCount, 0);
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
  assert.match(imageStateSource, /delete imageStore\[key\];/);
  assert.match(historySource, /function retainedImageKeysForCurrentAndHistory\(\)/);
  assert.doesNotMatch(historySource, /collectImageKeysFromObjects\(objects, keys\)/);
  assert.match(historySource, /for \(const entry of boardHistory\)/);
  assert.match(historySource, /collectImageKeysFromObjects\(jsClipboard\?\.objects, keys\)/);
  assert.doesNotMatch(historySource, /jsClipboard\?\.imageData/);
  assert.match(historySource, /out\.add\(key\)/);
  assert.match(historySource, /pruneImageCachesToKeys\(retainedKeys\)/);
});

test('async image cache writes use generation guards', () => {
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(imageStateSource, /generation === _imageStoreGeneration && imageStore\[key\] === source/);
  assert.match(imageStateSource, /same = isImageDisplayCacheRequestCurrent\(key, src, generation\);/);
  assert.match(imageStateSource, /if \(same\) imageBitmapFailed\.add\(key\);/);
});

test('low-zoom active navigation records visible full-size fallbacks until scaled variants are ready', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'renderer.js'), 'utf8');

  assert.match(source, /IMAGE_VARIANT_ACTIVE_INPUT_PRIORITY_MS/);
  assert.match(source, /IMAGE_VARIANT_ACTIVE_OVERSCALE_LIMIT/);
  assert.match(source, /chooseImageScaleForDraw\(obj, fullSource, view, activeInput\)/);
  assert.match(source, /if \(targetScale < 1\) \{[\s\S]*queueScaledImageVariant\(key, fullSource, targetScale, activeInput\);/);
  assert.match(source, /scaledVariantPending: true/);
  assert.match(source, /activeInputFullFallback: true/);
  assert.doesNotMatch(source, /source: null/);
  assert.match(rendererSource, /scaledVariantPending = drawCounterValue/);
  assert.match(rendererSource, /activeInputFullFallbackImages/);
  assert.match(rendererSource, /scaled-variant-pending-active-input/);
  assert.match(rendererSource, /scaledVariantPendingImages/);
});
