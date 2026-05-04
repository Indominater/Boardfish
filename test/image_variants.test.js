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

function loadImageVariantsForPlatform(isMac) {
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

test('mac platform keeps scaled image variants disabled even if a scaling mode is selected', () => {
  const context = loadImageVariantsForPlatform(true);

  assert.equal(context.viewportImageScalingEnabled, false);
  assert.equal(context.isViewportImageScalingActive(), false);
  assert.equal(context.setViewportPerfMode('1').scaling025, false);
  assert.equal(context.isViewportImageScalingActive(), false);

  const fullSource = { width: 100, height: 100 };
  const selected = context.selectImageSourceForDraw(
    'img-1',
    { w: 10, h: 10 },
    fullSource,
    { zoom: 0.1, dpr: 1 },
  );
  assert.equal(selected.source, fullSource);
  assert.equal(selected.scale, 1);
  assert.equal(selected.targetScale, 1);
  assert.equal(selected.disabled, true);
});

test('eyedropper preview does not resolve per-object scaled variants while active', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /paintEyedropperWallpaperPreview\(clientX, clientY, drawSize, options\)/);
  assert.match(source, /eyedropperRenderedSampleCtx\.drawImage\(\s*eyedropperZoomWallpaperCanvas,/);
  assert.match(source, /function renderEyedropperSnapshot\(targetCanvas, targetCtx, scale = 1\)/);
  assert.match(source, /imageSourceResolver: selectEyedropperSafeImageSourceForDraw/);
  assert.match(source, /const scaleVariantsEnabled = typeof isViewportImageScalingActive === 'function'/);
  assert.match(source, /targetScale: scaleVariantsEnabled \? chooseImageScaleForDraw\(obj, source, view\) : 1/);
  assert.match(source, /skipped: 'scaling-disabled'/);
});

test('eyedropper readout samples rendered canvas-visible pixels', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function sampleEyedropperReadoutPixel\(clientX, clientY, previewSample = null\)/);
  assert.match(source, /function renderEyedropperLocalReadoutPixel\(clientX, clientY\)/);
  assert.match(source, /function sampleEyedropperCachedPixelAt\(clientX, clientY\)/);
  assert.match(source, /function sampleEyedropperSafeTileCache\(key, token, source, sourceX, sourceY, options = \{\}\)/);
  assert.match(source, /source: 'pixel-cache'/);
  assert.match(source, /'cached-image-tile'/);
  assert.match(source, /where: 'zoomed-preview-center-readout'/);
  assert.match(source, /source: 'preview-center'/);
  assert.match(source, /reason: 'rendered-preview-center'/);
  assert.match(source, /where: 'eyedropper-local-readout'/);
  assert.match(source, /source: local\.pixel \? 'local-readout' : 'background'/);
  assert.match(source, /reason: local\.pixel \? 'local-rendered-canvas' : 'local-readback-failed'/);
  assert.match(source, /let readoutSample = sampleEyedropperReadoutPixel\(e\.clientX, e\.clientY, previewSample\);/);
  assert.doesNotMatch(source, /function sampleImageObjectSourcePixelForEyedropper/);
  assert.doesNotMatch(source, /function sampleEyedropperReadoutLayer/);
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

test('eyedropper center dot scales to the display density', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function drawEyedropperSampleDot\(drawSize, dpr = window\.devicePixelRatio \|\| 1\)/);
  assert.match(source, /const displayScale = Math\.max\(1, Number\(dpr\) \|\| 1\);/);
  assert.match(source, /const outerRadius = 3 \* displayScale;/);
  assert.match(source, /const innerRadius = 2 \* displayScale;/);
  assert.doesNotMatch(source, /radiusBoost/);
  assert.match(source, /drawEyedropperSampleDot\(drawSize, dpr\);/);
});

test('eyedropper preview uses only the rendered-board wallpaper while active', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function prepareEyedropperWallpaper\(\)/);
  assert.match(source, /paintEyedropperWallpaperPreview\(clientX, clientY, drawSize, options\)/);
  assert.match(source, /function eyedropperZoomedWallpaperGeometry\(clientX, clientY, renderSize, dpr = window\.devicePixelRatio \|\| 1\)/);
  assert.match(source, /function captureEyedropperZoomedWallpaper\(clientX, clientY, renderSize, options = \{\}\)/);
  assert.match(source, /zoom: previewZoom,/);
  assert.match(source, /panX: sampleDotCenterX \/ dpr - worldPoint\.x \* previewZoom/);
  assert.match(source, /panY: sampleDotCenterY \/ dpr - worldPoint\.y \* previewZoom/);
  assert.match(source, /const wallpaper = captureEyedropperZoomedWallpaper\(clientX, clientY, renderSize, \{ geometry \}\)/);
  assert.match(source, /function captureEyedropperZoomWallpaper\(geometry, renderSize\)/);
  assert.match(source, /viewportRect: geometry\.viewportRect/);
  assert.match(source, /view: geometry\.view/);
  assert.match(source, /selectEyedropperPreviewImageSourceForDraw/);
  assert.match(source, /visualFallback: true/);
  assert.match(source, /eyedropperRenderedSampleCtx\.drawImage\(\s*eyedropperZoomWallpaperCanvas,/);
  assert.doesNotMatch(source, /const sourceScale = EYEDROPPER_PREVIEW_ZOOM_SCALE/);
  assert.doesNotMatch(source, /clippedSrcW \* sourceScale/);
  assert.doesNotMatch(source, /const sourceCropSize = renderSize;/);
  assert.match(source, /reason: 'missing-wallpaper'/);
  assert.doesNotMatch(source, /drawSingleObj\(eyedropperRenderedSampleCtx, obj, counters, \{ view: previewView \}\)/);
  assert.doesNotMatch(source, /drawVisibleObjects\(eyedropperWallpaperCtx/);
  assert.doesNotMatch(source, /renderEyedropperSnapshot\(eyedropperZoomWallpaperCanvas, eyedropperZoomWallpaperCtx, EYEDROPPER_PREVIEW_ZOOM_SCALE\)/);
  assert.match(source, /readbackUnsafe: !!wallpaper\.rendered\.counters\?\.previewUnsafeImages/);
  assert.match(source, /!previewSample\.readbackUnsafe && \(!centerPixel \|\| readoutSample\?\.source === 'preview-render'\)/);
  assert.doesNotMatch(source, /eyedropperWallpaperCanRead === false\) scheduleEyedropperSafeImagePrewarm/);
  assert.match(source, /viewportImageScalingEnabled = false;/);
  assert.match(source, /restoreEyedropperViewportScaling\(\)/);
});

test('eyedropper hover preview does not hydrate native references while active', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_debug.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8'),
  ].join('\n');

  assert.match(source, /if \(eyedropperEnabled\) \{\s*return \{ summary: \{ skipped: 'eyedropper-snapshot-only' \}, rows: \[\] \};\s*\}/);
  assert.match(source, /if \(eyedropperEnabled\) return;/);
  assert.doesNotMatch(source, /previewSample\?\.readbackUnsafe && readoutSample\?\.source === 'preview-render'[\s\S]*?scheduleEyedropperSafeImagePrewarm/);
  assert.match(source, /prewarmAt\(clientX, clientY/);
});

test('eyedropper debugger exposes compact reports for JSON copying', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_debug.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8'),
  ].join('\n');

  assert.match(source, /function report\(options = \{\}\)/);
  assert.match(source, /function firstSampleSummary\(options = \{\}\)/);
  assert.match(source, /function previewPresentSummary\(options = \{\}\)/);
  assert.match(source, /function slowPreviewPresentSummary\(options = \{\}\)/);
  assert.match(source, /function previewMismatchSummary\(options = \{\}\)/);
  assert.match(source, /function longTaskSummary\(options = \{\}\)/);
  assert.match(source, /function frameGapSummary\(options = \{\}\)/);
  assert.match(source, /function coldReset\(\)/);
  assert.match(source, /clearEyedropperSafeImageCache\(\)/);
  assert.match(source, /function analyzeEyedropperPreviewSurface\(previewSample = null, expectedPixel = null\)/);
  assert.match(source, /if \(previewSample\?\.readbackUnsafe\) \{/);
  assert.match(source, /preview-readback-unsafe/);
  assert.match(source, /function inputEventAgeMs\(e, now = performance\.now\(\)\)/);
  assert.match(source, /function eyedropperPointerDebugEvent\(e, receivedAt = performance\.now\(\)\)/);
  assert.match(source, /firstSamples:/);
  assert.match(source, /longTasks:/);
  assert.match(source, /frameGaps:/);
  assert.match(source, /maxInputAgeMs/);
  assert.match(source, /maxQueueDelayMs/);
  assert.match(source, /maxPointerDeltaPx/);
  assert.match(source, /frameCoalescedMoves/);
  assert.match(source, /maxClickToPreviewVisibleMs/);
  assert.match(source, /maxClickToPreviewFrameMs/);
  assert.match(source, /maxFrameGapMs/);
  assert.match(source, /previewPresent:/);
  assert.match(source, /slowPreviewPresent:/);
  assert.match(source, /previewMismatches:/);
  assert.match(source, /previewReadableSamples/);
  assert.match(source, /previewBlankSamples/);
  assert.match(source, /previewCenterMatches/);
  assert.match(source, /maxFirstSampleMs/);
  assert.match(source, /const pointerEvent = eyedropperPointerDebugEvent\(e\);/);
  assert.match(source, /commitEyedropperSample\(pointerEvent, \{ first: true \}\)/);
  assert.match(source, /function toggleReport\(options = \{\}\)/);
  assert.match(source, /function toggleSummary\(options = \{\}\)/);
  assert.match(source, /EyedropperDebug\._logToggle\(toggleMeta\)/);
  assert.match(source, /EyedropperDebug\._logPreviewPresent/);
  assert.match(source, /wallpaperMs: e\.meta\?\.wallpaperMs/);
  assert.match(source, /function cancelEyedropperBackgroundPrewarm\(\)/);
  assert.match(source, /cancelEyedropperBackgroundPrewarm\(\);/);
  assert.match(source, /prewarmDeferredDuringSampling/);
  assert.match(source, /closed-menu-before-sample/);
  assert.doesNotMatch(source, /logEyedropperInteraction\(e, true, 'closed-menu'\);\s*return true;/);
  assert.match(source, /logEyedropperInteraction\(e, true, 'restart-visible-sample'\);/);
  assert.match(source, /logEyedropperInteraction\(upEvent, true, 'sample-released'\);/);
  assert.doesNotMatch(source, /logEyedropperInteraction\(e, true, 'hide-visible-sample'\);/);
  assert.match(source, /recentSamples:/);
  assert.match(source, /recentFailures:/);
  assert.match(source, /canvasReadoutMs/);
  assert.match(source, /safeImageCacheSummary\(\{ table: false \}\)/);
  assert.match(source, /imageSummary\(options = \{\}\)/);
  assert.match(source, /readbackFailures\(options = \{\}\)/);
});

test('eyedropper avoids asset display probes for readback-safe sampling', () => {
  const eyedropperSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(eyedropperSource, /function resolveEyedropperCorsDisplaySource/);
  assert.match(eyedropperSource, /if \(isNativeImageRef\(imageStore\[key\]\)\) return null;/);
  assert.match(eyedropperSource, /if \(imageAssetUrlCache\[key\]\) return null;/);
  assert.match(eyedropperSource, /return resolveEyedropperNativeDataUrlSource\(key, token, counters\);/);
  assert.match(eyedropperSource, /imageAssetUrlCache\[key\]/);
  assert.match(eyedropperSource, /loadImageElement\(assetSrc, \{ crossOrigin: 'anonymous' \}\)/);
  assert.match(eyedropperSource, /sourceKind: 'display-cors'/);
  assert.match(imageStateSource, /img\.crossOrigin = crossOrigin/);
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

test('eyedropper hover readout does not use image or object references', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_debug.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8'),
  ].join('\n');
  const keyboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'keyboard.js'), 'utf8');

  assert.match(source, /paintZoomedBoardPreview\(e\.clientX, e\.clientY, drawSize, \{ sampleCenter: false \}\)/);
  assert.match(source, /sampleEyedropperReadoutPixel\(e\.clientX, e\.clientY, previewSample\)/);
  assert.match(source, /function renderEyedropperLocalReadoutPixel\(clientX, clientY\)/);
  assert.match(source, /sampleEyedropperSafeTileCache\(key, token, safeEntry\.source, sourceX, sourceY\)/);
  assert.match(source, /sampleCanvasPixel\(eyedropperRenderedSampleCtx, previewSample\.centerX, previewSample\.centerY,/);
  assert.match(source, /sampleCanvasPixel\(eyedropperReadoutCtx, 0, 0,/);
  assert.doesNotMatch(source, /function sampleImageSourcePixelForEyedropper/);
  assert.doesNotMatch(source, /function sampleImageObjectSourcePixelForEyedropper/);
  assert.doesNotMatch(source, /function sampleEyedropperReadoutLayer/);
  assert.match(source, /reason: local\.pixel \? 'local-rendered-canvas' : 'local-readback-failed'/);
  assert.doesNotMatch(source, /sourceCanvasEntryForEyedropper/);
  assert.doesNotMatch(source, /sampleImageSourcePixelDirectForReadout/);
  assert.doesNotMatch(source, /image-source-direct-readout/);
  assert.doesNotMatch(source, /EYEDROPPER_SYNC_SOURCE_CANVAS_MAX_BYTES/);
  assert.match(source, /previewReadbackMs/);
  assert.doesNotMatch(keyboardSource, /toggleEyedropperReadoutMode/);
  assert.doesNotMatch(keyboardSource, /isDigitShortcut/);
});

test('eyedropper sampling and navigation are mutually exclusive', () => {
  const eyedropperSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const inputSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'canvas_input.js'), 'utf8');

  assert.match(eyedropperSource, /function noteEyedropperNavigationActive\(reason = 'viewport', durationMs = 180\)/);
  assert.match(eyedropperSource, /function isEyedropperNavigationActive\(\)/);
  assert.match(eyedropperSource, /logEyedropperInteraction\(e, false, 'navigation-active'\)/);
  assert.match(eyedropperSource, /if \(eyedropperSampling\) hideEyedropperSample\(\);/);
  assert.doesNotMatch(eyedropperSource, /eyedropperSampling \|\| isEyedropperSampleVisible\(\)\) hideEyedropperSample\(\)/);

  assert.match(inputSource, /mode: 'blocked-eyedropper-sampling'/);
  assert.match(inputSource, /function cancelWheelPan\(\)/);
  assert.match(inputSource, /noteEyedropperNavigationActive\('wheel-zoom'\)/);
  assert.match(inputSource, /noteEyedropperNavigationActive\('wheel-pan'\)/);
  assert.match(inputSource, /noteEyedropperNavigationActive\('mouse-pan', 240\)/);
});

test('eyedropper snapshots are lazy after navigation and pinning', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function captureEyedropperReadbackWallpaper\(\)/);
  assert.match(source, /function captureEyedropperZoomWallpaper\(geometry, renderSize\)/);
  assert.match(source, /function captureEyedropperWallpaper\(options = \{\}\)/);
  assert.match(source, /if \(options\.includeZoom === true\) return false;/);
  assert.match(source, /eyedropperZoomWallpaperReady = false;/);
  assert.match(source, /const rendered = captureEyedropperZoomWallpaper\(geometry, renderSize\);/);
  assert.match(source, /reason: `snapshot-dirty:\$\{reason\}`/);
  assert.doesNotMatch(source, /const ready = captureEyedropperWallpaper\(\);/);
  assert.match(source, /markEyedropperSnapshotDirty\(\);/);
});

test('new and opened boards reset eyedropper mode to disabled', () => {
  const openSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'io_close.js'), 'utf8');
  const objectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'object_commands.js'), 'utf8');

  assert.match(openSource, /function applyBoardData\(data, options = \{\}\) \{[\s\S]*setEyedropperEnabled\(false\);[\s\S]*clearJsClipboard\(\);/);
  assert.match(objectSource, /if \(objects\.length === 0 && !currentFilePath\) \{\s*setEyedropperEnabled\(false\);\s*return;\s*\}/);
  assert.match(objectSource, /await startPillTask\(\{ message: 'Opening' \}\);\s*setEyedropperEnabled\(false\);\s*BoardfishEditorState\.resetBoardObjectState\(\);/);
});
