'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadImageVariants() {
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

test('chooses the smallest scaled variant that preserves display-pixel detail', () => {
  const context = loadImageVariants();

  assert.equal(scaleFor(context, { sourceW: 400, sourceH: 200, objW: 100, objH: 50, zoom: 1, dpr: 1 }), 0.5);
  assert.equal(scaleFor(context, { sourceW: 400, sourceH: 200, objW: 100.01, objH: 50, zoom: 1, dpr: 1 }), 0.5);
  assert.equal(scaleFor(context, { sourceW: 400, sourceH: 200, objW: 100, objH: 50.01, zoom: 1, dpr: 1 }), 0.5);
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
  }), 0.5);
});

test('scaled variants round up so the bitmap is not below the qualifying size', () => {
  const context = loadImageVariants();

  assert.equal(context.scaledVariantEstimatedBytes(101, 17, 0.5), 51 * 9 * 4);
});

test('scaled image variant cache stays bounded with web headroom cap', () => {
  const context = loadImageVariants();

  assert.equal(context.IMAGE_VARIANT_MEMORY_LIMIT, 1024 * 1024 * 1024);
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
  assert.equal(selected.targetScale, 0.5);
  assert.equal(selected.disabled, undefined);
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

  context.queueScaledImageVariant('img-1', { width: 100, height: 100 }, 0.5);
  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.5), true);

  const task = context.imageScaledVariantQueue.shift();
  context._imageStoreGeneration++;
  await task();

  assert.equal(resizeCalls, 0);
  assert.equal(context.isScaledImageVariantPending('img-1', 0.5), false);
  assert.equal(context.hasScaledImageVariant('img-1', 0.5), false);
});

test('clearing scaled variants for one key removes queued work for that key', () => {
  const context = loadImageVariantsForPlatform(false);

  context.queueScaledImageVariant('img-1', { width: 100, height: 100 }, 0.5);
  context.queueScaledImageVariant('img-2', { width: 100, height: 100 }, 0.5);

  assert.equal(context.imageScaledVariantQueue.length, 2);
  context.clearScaledImageVariants('img-1');

  assert.equal(context.imageScaledVariantQueue.length, 1);
  assert.equal(context.imageScaledVariantQueue[0].variantKey, 'img-2');
  assert.equal(context.isScaledImageVariantPending('img-1', 0.5), false);
  assert.equal(context.isScaledImageVariantPending('img-2', 0.5), true);
});

test('scaled image variant skips do not create empty cache groups', () => {
  const context = loadImageVariantsForPlatform(false);

  context.queueScaledImageVariant('img-missing-size', { width: 0, height: 100 }, 0.5);
  assert.equal(context.imageScaledBitmapCache.has('img-missing-size'), false);
  assert.equal(context.isScaledImageVariantPending('img-missing-size', 0.5), false);

  context.queueScaledImageVariant('img-too-large', { width: 100000, height: 100000 }, 0.5);
  assert.equal(context.imageScaledBitmapCache.has('img-too-large'), false);
  assert.equal(context.isScaledImageVariantPending('img-too-large', 0.5), false);
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
  assert.match(historySource, /Object\.keys\(jsClipboard\?\.imageData \|\| \{\}\)/);
  assert.match(historySource, /pruneImageCachesToKeys\(retainedKeys\)/);
});

test('async image cache writes use generation guards', () => {
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(imageStateSource, /const isImageDisplayCacheRequestCurrent = \(key, src, generation\) =>/);
  assert.match(imageStateSource, /if \(!isImageDisplayCacheRequestCurrent\(key, displaySrc, generation\)\)/);
  assert.match(imageStateSource, /if \(isImageDisplayCacheRequestCurrent\(key, displaySrc, generation\)\) imageBitmapFailed\.add\(key\);/);
});

test('low-zoom drawing preserves visibility until scaled variants are ready', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'renderer.js'), 'utf8');

  assert.match(source, /queueScaledImageVariant\(key, fullSource, targetScale\);/);
  assert.match(source, /return \{ source: fullSource, scale: 1, targetScale \};/);
  assert.doesNotMatch(source, /IMAGE_VARIANT_FULL_FALLBACK_IDLE_MS/);
  assert.doesNotMatch(source, /scaledVariantPending: true/);
  assert.match(rendererSource, /scaled-variant-pending-active-input/);
  assert.match(rendererSource, /scaledVariantPendingImages/);
});
