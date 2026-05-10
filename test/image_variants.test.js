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

test('eyedropper readout resolves safe scaled variants independently of the preview', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function renderEyedropperLocalReadoutPixel\(clientX, clientY\)/);
  assert.match(source, /imageSourceResolver: selectEyedropperSafeImageSourceForDraw/);
  assert.match(source, /const scaleVariantsEnabled = typeof isViewportImageScalingActive === 'function'/);
  assert.match(source, /targetScale: scaleVariantsEnabled \? chooseImageScaleForDraw\(obj, source, view\) : 1/);
});

test('eyedropper readout samples rendered canvas-visible pixels', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const decodeWarmersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_decode_warmers.js'), 'utf8');
  const stateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_state.js'), 'utf8');

  assert.match(source, /function sampleEyedropperReadoutPixel\(clientX, clientY, previewSample = null, options = \{\}\)/);
  assert.match(source, /function renderEyedropperLocalReadoutPixel\(clientX, clientY\)/);
  assert.match(source, /function sampleEyedropperCachedPixelAt\(clientX, clientY\)/);
  assert.match(source, /function sampleEyedropperSafeTileCache\(key, token, source, sourceX, sourceY, options = \{\}\)/);
  assert.match(source, /function resolveEyedropperNativePixelTargetAt\(clientX, clientY, timings = null\)/);
  assert.match(source, /function requestEyedropperNativePixel\(\)/);
  assert.match(decodeWarmersSource, /function scheduleEyedropperNativeDecodePrewarm\(reason = 'viewport'\)/);
  assert.match(stateSource, /d1: \{ id: 'd1', mode: 'nearest-pointer'/);
  assert.match(stateSource, /d2: \{ id: 'd2', mode: 'largest-cost'/);
  assert.match(stateSource, /d3: \{ id: 'd3', mode: 'sampler-pointer'/);
  assert.match(decodeWarmersSource, /function findEyedropperBackgroundDecodeCandidate\(decoderId\)/);
  assert.match(decodeWarmersSource, /function findEyedropperSamplerDecodeCandidate\(\)/);
  assert.match(decodeWarmersSource, /return naturalWidth \* naturalHeight \* formatMultiplier;/);
  assert.match(decodeWarmersSource, /BoardfishTauri\.prewarmCachedImagePixels\(key\)/);
  assert.match(source, /native-pixel-wait-decode-prewarm/);
  assert.match(source, /if \(!eyedropperNativeDecodePrewarm\.ready\.has\(target\.key\)\)/);
  assert.match(source, /BoardfishTauri\.sampleCachedImagePixel\(target\.key, target\.sourceX, target\.sourceY\)/);
  assert.match(source, /source: 'pixel-cache'/);
  assert.match(source, /'cached-image-tile'/);
  assert.match(source, /updateEyedropperColorReadout\(pixel\);/);
  assert.match(source, /reason: 'native-pixel-pending'/);
  assert.match(source, /noReadoutUpdate: true/);
  assert.doesNotMatch(source, /matchingEyedropperNativePixel/);
  assert.doesNotMatch(source, /reason: 'native-image-pixel'/);
  assert.match(source, /if \(isNativeImageRef\(imageStore\[key\]\)\) \{[\s\S]*requestEyedropperNativePixel\(\);[\s\S]*cachedPixelImageMissReason = 'native-pixel-pending';[\s\S]*return null;[\s\S]*\}/);
  assert.match(source, /if \(timings\.cachedPixelImageMissReason === 'native-pixel-pending'\) \{[\s\S]*noReadoutUpdate: true,[\s\S]*\}\s*if \(timings\.cachedPixelImageMiss && options\.localImageFallback !== true\) \{[\s\S]*pixel: null,[\s\S]*source: 'pixel-cache',[\s\S]*noReadoutUpdate: true,/);
  assert.doesNotMatch(source, /pixel: previewSample\?\.pixel \|\| boardBackgroundPixel\(\),\s*source: 'background',\s*reason: timings\.cachedPixelImageMissReason/);
  assert.doesNotMatch(source, new RegExp('sampleCachedImage' + 'Tile'));
  assert.doesNotMatch(source, new RegExp('native' + '-tile'));
  assert.match(source, /timings\.previewCenterReadbackSkipped = 1/);
  assert.doesNotMatch(source, /where: 'zoomed-preview-center-readout'/);
  assert.doesNotMatch(source, /source: 'preview-center'/);
  assert.match(source, /where: 'eyedropper-local-readout'/);
  assert.match(source, /\(counters\.previewUnsafeImages \|\| 0\) > 0/);
  assert.match(source, /\(counters\.readbackSafePendingImages \|\| 0\) > 0/);
  assert.match(source, /pendingSafeImage: \(counters\.readbackSafePendingImages \|\| 0\) > 0/);
  assert.match(source, /source: local\.pixel \? 'local-readout' : 'background'/);
  assert.match(source, /reason: local\.pixel \? 'local-rendered-canvas' : 'local-readback-failed'/);
  assert.match(source, /let readoutSample = sampleEyedropperReadoutPixel\(e\.clientX, e\.clientY, previewSample, \{\s*localImageFallback: options\.first === true,\s*\}\);/);
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

test('eyedropper sampler keeps edge gap while Windows titlebar controls layer above it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

  assert.match(styles, /--window-titlebar-z: 99991;/);
  assert.match(styles, /body\.is-windows #windows-titlebar \{[\s\S]*z-index: 9001;/);
  assert.match(styles, /#windows-titlebar-controls \{[\s\S]*position: fixed;[\s\S]*z-index: var\(--window-titlebar-z\);/);
  assert.match(styles, /body\.is-windows #windows-titlebar-controls \{[\s\S]*display: flex;/);
  assert.match(html, /<\/div>\s*<div id="windows-titlebar-controls">/);
  assert.doesNotMatch(source, /eyedropperViewportMinTop/);
  assert.match(source, /top: Math\.round\(Math\.max\(margin,/);
  assert.match(source, /const top = Math\.max\(margin,/);
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

test('eyedropper card previews are transient and keep the center reticle', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const stateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_state.js'), 'utf8');

  assert.match(stateSource, /function drawEyedropperCanvasReticle\(context, width, height = width, dpr = window\.devicePixelRatio \|\| 1\)/);
  assert.match(source, /captureEyedropperCanvasPreview\(card\?\.canvas, 'card-preview-capture', \{\s*reticle: true,/);
  assert.match(source, /captureEyedropperCanvasPreview\(canvas, 'card-preview-rendered-sample', \{\s*reticle: true,/);
  assert.doesNotMatch(source, /rememberEyedropperCardPreviewScene/);
  assert.doesNotMatch(source, /serializeEyedropperCardsForBoard/);
  assert.doesNotMatch(source, /restoreEyedropperCards/);
  assert.doesNotMatch(source, /syncEyedropperCardZOrder/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_card_previews.js')), false);
});

test('eyedropper preview uses viewport-style rendered-board wallpaper while active', () => {
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
  assert.match(source, /drawVisibleObjects\(eyedropperZoomWallpaperCtx, counters, \{\s*viewportRect: geometry\.viewportRect,\s*view: geometry\.view,\s*\}\)/);
  assert.doesNotMatch(source, /function selectEyedropperPreviewImageSourceForDraw/);
  assert.doesNotMatch(source, /imageSourceResolver: selectEyedropperPreviewImageSourceForDraw/);
  assert.doesNotMatch(source, /visualFallback: true/);
  assert.match(source, /eyedropperRenderedSampleCtx\.drawImage\(\s*eyedropperZoomWallpaperCanvas,/);
  assert.doesNotMatch(source, /const sourceScale = EYEDROPPER_PREVIEW_ZOOM_SCALE/);
  assert.doesNotMatch(source, /clippedSrcW \* sourceScale/);
  assert.doesNotMatch(source, /const sourceCropSize = renderSize;/);
  assert.match(source, /reason: 'missing-wallpaper'/);
  assert.doesNotMatch(source, /drawSingleObj\(eyedropperRenderedSampleCtx, obj, counters, \{ view: previewView \}\)/);
  assert.doesNotMatch(source, /function renderEyedropperSnapshot/);
  assert.match(source, /readbackUnsafe: !!wallpaper\.rendered\.counters\?\.previewUnsafeImages/);
  assert.match(source, /pendingSafeImage: !!wallpaper\.rendered\.counters\?\.readbackSafePendingImages/);
  assert.match(source, /timings\.previewReadbackSkipped = 1/);
  assert.doesNotMatch(source, /zoomed-preview-center-fallback/);
  assert.match(source, /viewportImageScalingEnabled = false;/);
  assert.match(source, /restoreEyedropperViewportScaling\(\)/);
});

test('eyedropper legacy sampler image warmup paths are removed', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_debug.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8'),
  ].join('\n');

  assert.doesNotMatch(source, /prewarmAt\(clientX, clientY/);
  assert.doesNotMatch(source, /prewarmEyedropperSafeImages/);
  assert.doesNotMatch(source, /prewarmEyedropperCenterTile/);
  assert.doesNotMatch(source, /scheduleEyedropperHoverTilePrewarm/);
  assert.doesNotMatch(source, /selectEyedropperWarmedScaledImageForViewport/);
  assert.doesNotMatch(source, /EYEDROPPER_PREWARM_/);
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
  assert.match(source, /if \(previewSample\?\.readbackUnsafe \|\| previewSample\?\.pendingSafeImage\) \{/);
  assert.match(source, /preview-readback-unsafe/);
  assert.match(source, /preview-readback-safe-image-pending/);
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
  assert.match(source, /function beginEyedropperHoldSample\(e = null\)/);
  assert.match(source, /const sourceEvent = e\?\.clientX != null && e\?\.clientY != null[\s\S]*: _eyedropperLastMouseEvent;/);
  assert.match(source, /commitEyedropperSample\(sourceEvent, \{ first: true \}\)/);
  assert.match(source, /function toggleReport\(options = \{\}\)/);
  assert.match(source, /function toggleSummary\(options = \{\}\)/);
  assert.match(source, /EyedropperDebug\._logToggle\(toggleMeta\)/);
  assert.match(source, /EyedropperDebug\._logPreviewPresent/);
  assert.match(source, /wallpaperMs: e\.meta\?\.wallpaperMs/);
  assert.doesNotMatch(source, /function cancelEyedropperBackgroundPrewarm\(\)/);
  assert.doesNotMatch(source, /cancelEyedropperBackgroundPrewarm\(\);/);
  assert.doesNotMatch(source, /closed-menu-before-sample/);
  assert.doesNotMatch(source, /logEyedropperInteraction\(e, true, 'closed-menu'\);\s*return true;/);
  assert.doesNotMatch(source, /logEyedropperInteraction\(e, true, 'restart-visible-sample'\);/);
  assert.doesNotMatch(source, /logEyedropperInteraction\(upEvent, true, 'sample-released'\);/);
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

  assert.doesNotMatch(eyedropperSource, /function resolveEyedropperCorsDisplaySource/);
  assert.match(eyedropperSource, /if \(isNativeImageRef\(imageStore\[key\]\)\) return null;/);
  assert.match(eyedropperSource, /if \(imageAssetUrlCache\[key\]\) return null;/);
  assert.match(eyedropperSource, /return resolveEyedropperNativeDataUrlSource\(key, token, counters\);/);
  assert.match(eyedropperSource, /imageAssetUrlCache\[key\]/);
  assert.doesNotMatch(eyedropperSource, /loadImageElement\(assetSrc, \{ crossOrigin: 'anonymous' \}\)/);
  assert.doesNotMatch(eyedropperSource, /sourceKind: 'display-cors'/);
  assert.match(imageStateSource, /img\.crossOrigin = crossOrigin/);
});

test('image cache skips readback probes during normal display hydration', () => {
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(imageStateSource, /function shouldSkipReadbackProbeForNativeDisplaySource\(key, src\)/);
  assert.match(imageStateSource, /if \(!isNativeImageRef\(imageStore\[key\]\)\) return false;/);
  assert.match(imageStateSource, /return !!src && imageAssetUrlCache\[key\] === src;/);
  assert.match(imageStateSource, /const needsReadbackSafe = options\.requireReadbackSafe === true;/);
  assert.match(imageStateSource, /const skipReadbackProbe = !needsReadbackSafe \|\| shouldSkipReadbackProbeForNativeDisplaySource\(key, loadedSrc\);/);
  assert.match(imageStateSource, /skipped: skipReadbackProbe/);
});

test('image bitmap queue does not wait for animation frames during board open', () => {
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(imageStateSource, /if \(typeof _boardOpening !== 'undefined' && _boardOpening\) \{/);
  assert.match(imageStateSource, /setTimeout\(processImageDecodeQueue, 0\);/);
  assert.match(imageStateSource, /requestAnimationFrame\(processImageDecodeQueue\);/);
});

test('eyedropper decode warming uses two background decoders after board open', () => {
  const eyedropperSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const decodeWarmersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper_decode_warmers.js'), 'utf8');
  const ioCloseSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'io_close.js'), 'utf8');

  assert.match(eyedropperSource, /function requestEyedropperSampleSafeImage\(key, counters = null, reason = 'sample'\)/);
  assert.match(eyedropperSource, /return resolveEyedropperSafeImageSource\(key, counters\);/);
  assert.match(eyedropperSource, /requestEyedropperSampleSafeImage\(key, counters, 'readout'\)/);
  assert.doesNotMatch(eyedropperSource, /requestEyedropperSampleSafeImage\(key, counters, 'preview-fallback'\)/);
  assert.doesNotMatch(eyedropperSource, /requestEyedropperSampleSafeImage\(key, null, 'hover-tile'\)/);
  assert.doesNotMatch(eyedropperSource, /schedulePostOpenEyedropperSafeImagePrewarm/);
  assert.doesNotMatch(eyedropperSource, /POST_OPEN_EYEDROPPER_PREWARM/);
  assert.doesNotMatch(eyedropperSource, /scheduleNewImageEyedropperSafePrewarm/);
  assert.doesNotMatch(eyedropperSource, /NEW_IMAGE_EYEDROPPER_PREWARM/);
  assert.match(ioCloseSource, /scheduleEyedropperNativeDecodePrewarm\('board-loaded'\)/);
  assert.match(decodeWarmersSource, /pumpEyedropperDecodeWarmer\('d1', reason\)/);
  assert.match(decodeWarmersSource, /pumpEyedropperDecodeWarmer\('d2', reason\)/);
  assert.doesNotMatch(ioCloseSource, /schedulePostOpenEyedropperSafeImagePrewarm\('open-all-hydrated'\)/);
});

test('undo-history lifecycle prunes image caches to current board, history, and clipboard keys', () => {
  const eyedropperSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const imageInsertSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_insert.js'), 'utf8');
  const historySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'history_state.js'), 'utf8');
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');

  assert.match(eyedropperSource, /function pruneEyedropperSafeImagesToKeys\(retainedKeys = new Set\(\)\)/);
  assert.match(eyedropperSource, /removeEyedropperSafeImageKey\(key\)/);
  assert.doesNotMatch(imageInsertSource, /scheduleNewImageEyedropperSafePrewarm/);
  assert.match(imageStateSource, /const pruneImageCachesToKeys = \(retainedKeys = new Set\(\)\) =>/);
  assert.match(imageStateSource, /BoardfishTauri\.removeCachedImageSources\(removedSourceKeys\)/);
  assert.match(historySource, /function retainedImageKeysForCurrentAndHistory\(\)/);
  assert.match(historySource, /collectImageKeysFromObjects\(objects, keys\)/);
  assert.match(historySource, /for \(const entry of boardHistory\)/);
  assert.match(historySource, /collectImageKeysFromObjects\(jsClipboard\?\.objects, keys\)/);
  assert.match(historySource, /Object\.keys\(jsClipboard\?\.imageData \|\| \{\}\)/);
  assert.match(historySource, /pruneImageCachesToKeys\(retainedKeys\)/);
  assert.match(historySource, /pruneEyedropperSafeImagesToKeys\(retainedKeys\)/);
});

test('async image cache writes use tokens and generation guards', () => {
  const imageStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'tauri_bridge.js'), 'utf8');
  const imageInsertSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_insert.js'), 'utf8');

  assert.match(bridgeSource, /removeCachedImageSources\(imgKeys, sourceTokens = null\)/);
  assert.match(bridgeSource, /registerImageSource\(imgKey, dataUrl, sourceToken = null\)/);
  assert.match(imageStateSource, /const createImageSourceToken = \(key\) =>/);
  assert.match(imageStateSource, /const cleanupNativeImageSourceToken = \(key, sourceToken\) =>/);
  assert.match(imageStateSource, /BoardfishTauri\.removeCachedImageSources\(\[key\], \[sourceToken\]\)/);
  assert.match(imageStateSource, /const isImageDisplayCacheRequestCurrent = \(key, src, generation\) =>/);
  assert.match(imageStateSource, /if \(!isImageDisplayCacheRequestCurrent\(key, loadedSrc, generation\)\)/);
  assert.match(imageInsertSource, /const sourceToken = createImageSourceToken\(imgKey\)/);
  assert.match(imageInsertSource, /cleanupNativeImageSourceToken\(imgKey, sourceToken\)/);
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
  assert.match(source, /sampleEyedropperReadoutPixel\(e\.clientX, e\.clientY, previewSample, \{\s*localImageFallback: options\.first === true,\s*\}\)/);
  assert.match(source, /function renderEyedropperLocalReadoutPixel\(clientX, clientY\)/);
  assert.match(source, /sampleEyedropperSafeTileCache\(key, token, safeEntry\.source, sourceX, sourceY, \{\s*timings,\s*sync: options\.syncTileBuild === true,\s*\}\)/);
  assert.doesNotMatch(source, /sampleCanvasPixel\(eyedropperRenderedSampleCtx, previewSample\.centerX, previewSample\.centerY,/);
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
  assert.doesNotMatch(eyedropperSource, /function isEyedropperNavigationActive\(\)/);
  assert.doesNotMatch(eyedropperSource, /function startEyedropperSample\(/);
  assert.doesNotMatch(eyedropperSource, /beginEyedropperPointerTracking/);
  assert.doesNotMatch(eyedropperSource, /allowBoardNavigation: true/);
  assert.match(eyedropperSource, /function updateEyedropperHoldSample\(e\) \{[\s\S]*if \(!_eyedropperHoldActive \|\| !eyedropperEnabled\) return;[\s\S]*updateEyedropperSample\(e\);[\s\S]*\}/);
  assert.doesNotMatch(eyedropperSource, /function scheduleEyedropperHoverTilePrewarm/);
  assert.match(eyedropperSource, /if \(eyedropperSampling\) hideEyedropperSample\(\);/);
  assert.doesNotMatch(eyedropperSource, /eyedropperSampling \|\| isEyedropperSampleVisible\(\)\) hideEyedropperSample\(\)/);

  assert.match(inputSource, /mode: 'blocked-eyedropper-sampling'/);
  assert.match(inputSource, /function cancelWheelPan\(\)/);
  assert.match(inputSource, /noteEyedropperNavigationActive\('wheel-zoom'\)/);
  assert.match(inputSource, /noteEyedropperNavigationActive\('wheel-pan'\)/);
  assert.match(inputSource, /noteEyedropperNavigationActive\('mouse-pan', 240\)/);
});

test('eyedropper mode keeps selected object outlines visible', () => {
  const eyedropperSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(eyedropperSource, /acquireInputShield\([\s\S]*\{ visual: false, keepSelectionOverlay: true \},[\s\S]*\)/);
  assert.doesNotMatch(styles, /body\.eyedropper-enabled\s+#sel-overlay/);
  assert.doesNotMatch(styles, /body\.eyedropper-enabled\s+#multi-sel-overlay/);
});

test('shift eyedropper shortcut self-heals stale keyboard state', () => {
  const keyboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'keyboard.js'), 'utf8');

  assert.match(keyboardSource, /const activeKeyboardKeys = new Set\(\);/);
  assert.match(keyboardSource, /const activeKeyboardKeyTimes = new Map\(\);/);
  assert.match(keyboardSource, /function pruneActiveKeyboardKeys\(now = performance\.now\(\)\) \{/);
  assert.match(keyboardSource, /function reconcileModifierKeyboardState\(e\) \{/);
  assert.match(keyboardSource, /pruneActiveKeyboardKeys\(keyDownAt\);\s*reconcileModifierKeyboardState\(e\);\s*const hasOtherKeyDown = \[\.\.\.activeKeyboardKeys\]/);
  assert.match(keyboardSource, /if \(isModifierKeyId\(keyId\)\) clearNonModifierActiveKeyboardKeys\(\);/);
  assert.match(keyboardSource, /document\.addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.visibilityState !== 'visible'\) clearActiveKeyboardKeys\(\);/);
  assert.match(keyboardSource, /if \(isShiftOnlyKey\(e\) && !editingId\) \{[\s\S]*setEyedropperEnabled\(true\);[\s\S]*beginEyedropperHoldSample\(e\);/);
});

test('eyedropper mode suppresses context menus instead of reducing them', () => {
  const eyedropperSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');
  const contextMenuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'context_menu.js'), 'utf8');
  const keyboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'keyboard.js'), 'utf8');
  const source = [eyedropperSource, contextMenuSource, keyboardSource].join('\n');

  assert.match(eyedropperSource, /function hideMenusForEyedropperMode\(\) \{[\s\S]*closeOpenMenusExcept\('', 'eyedropper-enabled'\)/);
  assert.match(eyedropperSource, /hideMenusForEyedropperMode\(\);/);
  assert.match(contextMenuSource, /if \(eyedropperEnabled\) \{\s*closeOpenMenusExcept\('', 'canvas-contextmenu:eyedropper'\);[\s\S]*canvas:contextmenu:blocked-eyedropper/);
  assert.doesNotMatch(source, /updateEyedropperCommandState/);
  assert.doesNotMatch(source, /isCommandBlockedByEyedropper/);
  assert.doesNotMatch(source, /_eyedropperPinnedPosition/);
  assert.doesNotMatch(source, /_eyedropperLoupeHorizontalSide/);
  assert.doesNotMatch(source, /EYEDROPPER_MENU_CSS_HEIGHT/);
  assert.doesNotMatch(contextMenuSource, /ctx-menu:open', \{ reason: 'eyedropper'/);
  assert.doesNotMatch(keyboardSource, /updateCtxActionStates\(\);/);
});

test('pinned eyedropper card interaction closes menus without clearing object selection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.match(source, /function activatePinnedEyedropperCardInteraction\(card, reason = 'pinned-card-interaction'\) \{/);
  assert.match(source, /if \(!isPinnedEyedropperCard\(card\) \|\| eyedropperSampling\) return false;/);
  assert.match(source, /activateInteractiveSurface\(\{\s*kind: 'pinned-eyedropper-card',\s*reason,\s*closeMenus: true,\s*clearObjectSelection: false,\s*exitTextEdit: false,/);
  assert.match(source, /activatePinnedEyedropperCardInteraction\(eventCard, 'eyedropper-card:pointerdown'\);/);
  assert.match(source, /activatePinnedEyedropperCardInteraction\(eventCard, 'eyedropper-card:mousedown'\);/);
  assert.match(source, /activatePinnedEyedropperCardInteraction\(eventCard, 'eyedropper-card:contextmenu'\);/);
});

test('context menus close on outside press before release', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'context_menu.js'), 'utf8');

  assert.match(source, /function isContextMenuSurfaceEvent\(e\) \{/);
  assert.match(source, /document\.addEventListener\('pointerdown', \(e\) => \{[\s\S]*closeOpenMenusExcept\('', 'document-pointerdown'\);[\s\S]*\}\);/);
  assert.match(source, /document\.addEventListener\('click', \(e\) => \{[\s\S]*isContextMenuSurfaceEvent\(e\)[\s\S]*closeOpenMenusExcept\('', 'document-click'\);[\s\S]*\}\);/);
});

test('eyedropper zoom wallpaper is lazy after navigation and pinning', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'eyedropper.js'), 'utf8');

  assert.doesNotMatch(source, /function captureEyedropperReadbackWallpaper\(\)/);
  assert.match(source, /function captureEyedropperZoomWallpaper\(geometry, renderSize\)/);
  assert.doesNotMatch(source, /function captureEyedropperWallpaper\(options = \{\}\)/);
  assert.match(source, /eyedropperZoomWallpaperReady = false;/);
  assert.match(source, /const rendered = captureEyedropperZoomWallpaper\(geometry, renderSize\);/);
  assert.match(source, /reason: `snapshot-dirty:\$\{reason\}`/);
  assert.match(source, /markEyedropperSnapshotDirty\(\);/);
});

test('new and opened boards reset eyedropper mode to disabled', () => {
  const openSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'io_close.js'), 'utf8');
  const objectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'object_commands.js'), 'utf8');

  assert.match(openSource, /function applyBoardData\(data, options = \{\}\) \{[\s\S]*setEyedropperEnabled\(false\);[\s\S]*clearJsClipboard\(\);/);
  assert.match(objectSource, /if \(objects\.length === 0 && !currentFilePath\) \{\s*setEyedropperEnabled\(false\);\s*return;\s*\}/);
  assert.match(objectSource, /await startPillTask\(\{ message: 'Opening' \}\);\s*setEyedropperEnabled\(false\);\s*BoardfishEditorState\.resetBoardObjectState\(\);/);
});
