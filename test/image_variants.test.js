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

test('chooses 0.25 only at the exact display-pixel threshold', () => {
  const context = loadImageVariants();

  assert.equal(scaleFor(context, {
    sourceW: 400,
    sourceH: 200,
    objW: 100,
    objH: 50,
    zoom: 1,
    dpr: 1,
  }), 0.25);

  assert.equal(scaleFor(context, {
    sourceW: 400,
    sourceH: 200,
    objW: 100.01,
    objH: 50,
    zoom: 1,
    dpr: 1,
  }), 1);

  assert.equal(scaleFor(context, {
    sourceW: 400,
    sourceH: 200,
    objW: 100,
    objH: 50.01,
    zoom: 1,
    dpr: 1,
  }), 1);
});

test('uses the supplied view zoom, including the eyedropper preview zoom', () => {
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

test('eyedropper preview is wired through the shared scale chooser with preview zoom', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /const previewView = \{[\s\S]*?zoom: previewZoom,/);
  assert.match(source, /drawSingleObj\([\s\S]*?view: previewView,[\s\S]*?imageSourceResolver: selectEyedropperSafeImageSourceForDraw,/);
  assert.match(source, /targetScale: chooseImageScaleForDraw\(obj, source, view\)/);
});

test('eyedropper readout samples rendered canvas-visible pixels', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function sampleEyedropperReadoutPixel\(clientX, clientY, previewSample = null\)/);
  assert.match(source, /function sampleEyedropperReadoutLayer\(worldPoint, previewSample = null, startIndex = objects\.length - 1, layers = \[\]\)/);
  assert.match(source, /source: 'preview-render'/);
  assert.match(source, /reason: 'visible-canvas'/);
  assert.match(source, /let readoutSample = sampleEyedropperReadoutPixel\(e\.clientX, e\.clientY, previewSample\);/);
  assert.doesNotMatch(source, /sampleImageSourcePixelForReadout/);
  assert.doesNotMatch(source, /image-source-direct/);
  assert.doesNotMatch(source, /const centerPixel = sampleDisplayedBoardPixel\(e\.clientX, e\.clientY\);/);
});

test('eyedropper preview uses the final CSS size before the loupe is visible', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function eyedropperPreviewCssSize\(\) \{/);
  assert.match(source, /getComputedStyle\(eyedropperLoupe\)/);
  assert.match(source, /outerWidth - borderX/);
  assert.doesNotMatch(source, /outerWidth - paddingX - borderX/);
  assert.match(source, /function eyedropperPreviewDrawSize\(dpr = window\.devicePixelRatio \|\| 1\)/);
  assert.match(source, /const drawSize = eyedropperPreviewDrawSize\(dpr\);/);
  assert.doesNotMatch(source, /const previewSize = previewRect\.width \|\| EYEDROPPER_PREVIEW_CSS/);
});

test('eyedropper hover preview does not hydrate native reference sources', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.doesNotMatch(source, /ensureImageDataUrl/);
  assert.match(source, /resolveEyedropperDisplayCacheSource/);
  assert.match(source, /native-source-hydration-disabled/);
  assert.match(source, /prewarmAt\(clientX, clientY/);
});

test('eyedropper debugger exposes compact reports for JSON copying', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function report\(options = \{\}\)/);
  assert.match(source, /recentSamples:/);
  assert.match(source, /recentFailures:/);
  assert.match(source, /canvasReadoutMs/);
  assert.match(source, /safeImageCacheSummary\(\{ table: false \}\)/);
  assert.match(source, /imageSummary\(options = \{\}\)/);
  assert.match(source, /readbackFailures\(options = \{\}\)/);
});

test('eyedropper retries tainted native display images through CORS display URL only', () => {
  const eyedropperSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(eyedropperSource, /function resolveEyedropperCorsDisplaySource/);
  assert.match(eyedropperSource, /imageAssetUrlCache\[key\]/);
  assert.match(eyedropperSource, /loadImageElement\(assetSrc, \{ crossOrigin: 'anonymous' \}\)/);
  assert.match(eyedropperSource, /sourceKind: 'display-cors'/);
  assert.match(imageStateSource, /img\.crossOrigin = crossOrigin/);
});

test('low-zoom drawing preserves visibility until scaled variants are ready', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_variants.js'), 'utf8');
  const viewportSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'viewport.js'), 'utf8');

  assert.match(source, /queueScaledImageVariant\(key, fullSource, targetScale\);/);
  assert.match(source, /return \{ source: fullSource, scale: 1, targetScale \};/);
  assert.doesNotMatch(source, /IMAGE_VARIANT_FULL_FALLBACK_IDLE_MS/);
  assert.doesNotMatch(source, /scaledVariantPending: true/);
  assert.match(viewportSource, /scaled-variant-pending-active-input/);
  assert.match(viewportSource, /scaledVariantPendingImages/);
});

test('eyedropper hover readout does not synchronously build large source canvases', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const keyboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'keyboard.js'), 'utf8');

  assert.match(source, /paintZoomedBoardPreview\(e\.clientX, e\.clientY, drawSize, \{ sampleCenter: false \}\)/);
  assert.match(source, /sampleEyedropperReadoutPixel\(e\.clientX, e\.clientY, previewSample\)/);
  assert.match(source, /reason: 'visible-canvas'/);
  assert.doesNotMatch(source, /sourceCanvasEntryForEyedropper/);
  assert.doesNotMatch(source, /sampleImageSourcePixelDirectForReadout/);
  assert.doesNotMatch(source, /image-source-direct-readout/);
  assert.doesNotMatch(source, /EYEDROPPER_SYNC_SOURCE_CANVAS_MAX_BYTES/);
  assert.match(source, /previewReadbackMs/);
  assert.doesNotMatch(keyboardSource, /toggleEyedropperReadoutMode/);
  assert.doesNotMatch(keyboardSource, /isDigitShortcut/);
});
