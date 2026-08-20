'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function withoutDeveloperDiagnostics(source) {
  const start = '/* BOARDFISH_DEV_DIAGNOSTICS_START */';
  const end = '/* BOARDFISH_DEV_DIAGNOSTICS_END */';
  assert.equal(source.split(start).length, source.split(end).length, 'developer diagnostic markers are unbalanced');
  return source.replace(
    /\/\* BOARDFISH_DEV_DIAGNOSTICS_START \*\/[\s\S]*?\/\* BOARDFISH_DEV_DIAGNOSTICS_END \*\//g,
    '',
  );
}

function waitForOpenRenderFrameSource() {
  const source = readSource('src/js/io_close.js');
  const start = source.indexOf('const waitForOpenRenderFrame =');
  const end = source.indexOf('\nfunction queueVisibleImageHydration', start);
  assert.ok(start >= 0 && end > start, 'waitForOpenRenderFrame source is missing');
  return source.slice(start, end);
}

test('developer open diagnostics tune the shared runtime hydration concurrency', () => {
  const messages = [];
  let exposed = null;
  const context = {
    DEBUG_TOOLS_ENABLED: true,
    console: {
      debug() {},
      info(...args) { messages.push(args.join(' ')); },
      table() {},
      warn() {},
    },
    exposeDebug(value) {
      exposed = value;
    },
    performance: {
      now() { return 0; },
    },
  };
  vm.createContext(context);
  vm.runInContext(readSource('src/js/runtime_utils.js'), context, { filename: 'runtime_utils.js' });
  vm.runInContext(readSource('src/js/debug_core.js'), context, { filename: 'debug_core.js' });
  vm.runInContext(readSource('src/js/debug_open.js'), context, { filename: 'debug_open.js' });

  assert.equal(context.getOpenHydrationConcurrency(), 8);
  assert.equal(context.OpenDebug.hydrationConcurrency, 8);
  assert.equal(context.OpenDebug.setHydrationConcurrency(12.8), 12);
  assert.equal(context.getOpenHydrationConcurrency(), 12);
  assert.equal(context.OpenDebug.hydrationConcurrency, 12);
  assert.equal(context.OpenDebug.setHydrationConcurrency(99), 32);
  assert.equal(context.OpenDebug.setHydrationConcurrency(-5), 1);
  assert.equal(context.OpenDebug.setHydrationConcurrency(8), 8);
  assert.equal(exposed.open, context.OpenDebug);
  assert.match(messages.at(-1), /hydration concurrency set to 8/);
});

test('open render frame wait clears timeout after RAF settles', async () => {
  const activeTimers = new Set();
  const steps = [];
  let nextTimerId = 0;
  const context = {
    clearTimeout(id) {
      activeTimers.delete(id);
    },
    OpenDebug: {
      step(_dbg, phase, detail) {
        steps.push({ phase, detail });
      },
    },
    performance: {
      now() {
        return 100;
      },
    },
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout() {
      nextTimerId++;
      activeTimers.add(nextTimerId);
      return nextTimerId;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${waitForOpenRenderFrameSource()}\n` +
      'globalThis.waitForOpenRenderFrame = waitForOpenRenderFrame;\n',
    context,
    { filename: 'io_close_wait_frame.js' },
  );

  await context.waitForOpenRenderFrame(null, 'test-render');

  assert.equal(activeTimers.size, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(steps)), [{
    phase: 'open-render-frame:settled',
    detail: { reason: 'test-render', source: 'raf', ms: 0 },
  }]);
});

test('open-board debugger covers the slow open phases developers need to inspect', () => {
  const openDebug = readSource('src/js/debug_open.js');
  const openIo = readSource('src/js/io_close.js');
  const productionOpenIo = withoutDeveloperDiagnostics(openIo);
  const imageState = readSource('src/js/image_state.js');
  const imageVariants = readSource('src/js/image_variants.js');
  const viewport = readSource('src/js/viewport.js');

  for (const method of [
    'phaseSummary',
    'hydrationSummary',
    'stepSummary',
    'imageStoreSummary',
    'hydrationCandidates',
    'slowImages',
    'openPreviewBreakdown',
    'hydrationBreakdown',
    'cacheImageBreakdown',
    'setHydrationConcurrency',
    'optimizationReport',
    'beginInitialRenderDebug',
    'endInitialRenderDebug',
    'isInitialRenderDebugActive',
    'recordPreviewFallbackDraw',
    'recordPreviewHeldRender',
    'recordDynamicPreview',
    'report',
  ]) {
    assert.match(openDebug, new RegExp(`\\b${method}\\b`), `OpenDebug is missing ${method}`);
  }
  const finishStart = openIo.indexOf('async function finishOpenedBoard');
  const finishEnd = openIo.indexOf('\nfunction applyBoardData', finishStart);
  const finishSource = openIo.slice(finishStart, finishEnd);
  const productionFinishSource = productionOpenIo.slice(
    productionOpenIo.indexOf('async function finishOpenedBoard'),
    productionOpenIo.indexOf('\nfunction applyBoardData'),
  );

  assert.match(openIo, /allContentBeforeInteraction: true,/);
  assert.match(openIo, /const isOpenHydratableImageSource = \(source\) => \{/);
  assert.match(openIo, /typeof source === 'string' \|\| isWebImageRef\(source\)/);
  assert.match(openIo, /const pendingReady = imageReadyPromises\.get\(key\);[\s\S]*?if \(typeof BOARDFISH_PRODUCTION === 'undefined'\) \{\s*if \(pendingReady\) \{\s*const t0 = performance\.now\(\);\s*const cacheMetrics = await pendingReady;/);
  assert.match(withoutDeveloperDiagnostics(openIo), /const pendingReady = imageReadyPromises\.get\(key\);\s*if \(pendingReady\) \{\s*await pendingReady;\s*return BoardfishImageStore\.hasDisplayImage\(key\);/);
  assert.match(openIo, /source: 'pending-cache'/);
  assert.match(finishSource, /const hydrationKeys = \[\.\.\.new Set\(\[[\s\S]*\.\.\.visibleKeys,[\s\S]*\.\.\.getPendingHydratableImageKeys\(\)/);
  assert.match(finishSource, /hydrateImageKeysWithLimit\([\s\S]*hydrationKeys,[\s\S]*dbg,[\s\S]*'hydrate-all'/);
  assert.match(productionFinishSource, /hydrateImageKeysWithLimit\(\s*hydrationKeys,\s*getOpenHydrationConcurrency\(\),\s*\)/);
  assert.match(finishSource, /hydrateTextDrawCachesForOpen/);
  assert.match(finishSource, /await Promise\.all\(\[[\s\S]*imageHydrationPromise,[\s\S]*textHydrationPromise/);
  assert.match(finishSource, /await settleOpenImageDrawCaches\(getOpenHydrationConcurrency\(\)\);/);
  assert.ok(finishSource.indexOf('settleOpenImageDrawCaches') < finishSource.indexOf('_boardOpening = false;'));
  assert.match(finishSource, /mode: 'all-before-interaction'/);
  assert.doesNotMatch(finishSource, /buildVisibleImagePreviewsForOpen|hydrateRemainingImagesForOpen|setTimeout\(/);
  assert.doesNotMatch(openIo, /hydrateRemainingImagesForOpen|BACKGROUND_OPEN_HYDRATION_INPUT_IDLE_MS/);
  assert.match(openIo, /async function hydrateTextDrawCachesForOpen/);
  assert.match(openIo, /const layout = getTextLayout\(obj\);[\s\S]*prepareTextLineForDraw\(line\);[\s\S]*warmOpenTextLineForDraw/);
  assert.match(imageVariants, /async function settleOpenImageDrawCaches/);
  assert.match(imageVariants, /while \(imageScaledVariantQueue\.length\)/);
  assert.match(imageVariants, /for \(const \[source, meta\] of drawableBitmapWarmupQueue\)/);
  assert.match(imageState, /var MAX_IMAGE_DECODE_ACTIVE = 2;/);
  assert.match(imageState, /const MAX_OPEN_IMAGE_DECODE_ACTIVE = 8;/);
  assert.match(imageState, /_boardOpening[\s\S]*MAX_OPEN_IMAGE_DECODE_ACTIVE[\s\S]*MAX_IMAGE_DECODE_ACTIVE/);
  assert.match(viewport, /function getLastApplyTransformMeta\(\)/);
  assert.match(openIo, /const renderBreakdown = typeof getLastApplyTransformMeta === 'function'/);
  assert.match(openIo, /OpenDebug\.beginInitialRenderDebug\?\.\(\)/);
  assert.match(openIo, /OpenDebug\.endInitialRenderDebug\?\.\(\)/);
  assert.match(viewport, /OpenDebug\.isInitialRenderDebugActive\?\.\(\) === true/);
  assert.match(openIo, /drawBoardTotalMs: drawBreakdown\?\.totalMeasuredMs/);
  assert.match(openDebug, /initialDrawMs: initialRender\?\.meta\?\.drawMs/);
  assert.match(openIo, /openPreviewImages: drawBreakdown\?\.openPreviewImages/);
  assert.match(openDebug, /decodeQueueWaitMaxMs/);
  assert.match(openDebug, /bitmapDecodeMaxMs/);
  assert.match(openDebug, /rustBoardJsonReadMs/);
  assert.match(openDebug, /rustImageReadMaxMs/);
  assert.match(openDebug, /rustImageRefMs/);
  assert.match(openDebug, /rustLazyImageRefs/);
  assert.match(openDebug, /rustImageCrcMs/);
  assert.match(openDebug, /slowCacheImages/);
  assert.match(openDebug, /filePickerMs/);
  assert.match(openDebug, /appCriticalPathMs/);
  assert.match(openDebug, /postReadCriticalPathMs/);
  for (const phase of [
    'read-board-debug',
    'read-board-shape',
    'applyBoardData:start',
    'clearImageStore',
    'cacheImage:start-all',
    'replaceBoardObjects',
    'apply-state',
    'restore-counters-viewport',
    'hydrate-initial-policy',
    'hydrate-all:candidates',
    'hydrate-text-draw-caches',
    'settle-open-image-draw-caches',
    'open:hydrate-all:end',
    'initial-applyTransform',
  ]) {
    assert.match(openIo, new RegExp(phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `open flow is missing ${phase}`);
  }

  for (const phase of [
    'cache-image:decode',
    'cache-image:set-src',
    'cache-image:decode-queue:queued',
    'cache-image:decode-queue:start',
    'cache-image:createImageBitmap',
    'cache-image:previewBitmap',
    'cache-image:schedule-render',
    'cache-image:done',
  ]) {
    assert.match(imageState, new RegExp(phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `image cache debug is missing ${phase}`);
  }
});

test('open-board debug workflow stays capturable through beginDebug and finishDebug', () => {
  const startupDebug = readSource('src/js/startup_debug.js');
  const bootstrap = readSource('src/js/app_bootstrap.js');

  assert.match(startupDebug, /async function beginDebug\(spec = \{\}\)/);
  assert.match(startupDebug, /async function finishDebug\(spec = \{\}\)/);
  assert.match(startupDebug, /startConsoleCapture\(id\)/);
  assert.match(startupDebug, /finishCalls = calls\.length \? calls : defaultFinishCalls\(\)/);
  assert.match(startupDebug, /method: 'browser-download'/);
  assert.match(startupDebug, /debugGlobalNames = \{/);
  assert.match(startupDebug, /open: 'OpenDebug'/);
  assert.match(bootstrap, /registerDebugCommand\('openFilePath', openFilePath\)/);
});

test('open-board helpers used by io_close are shared across legacy scripts', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const ioClose = readSource('src/js/io_close.js');

  for (const helper of ['confirmDirtyBeforeOpen', 'openBoardFromPath', 'finishFailedOpen']) {
    assert.match(bootstrap, new RegExp(`var ${helper};`), `${helper} should be declared in shared script scope`);
    assert.match(bootstrap, new RegExp(`${helper} = (?:async )?function ${helper}\\(`), `${helper} should be assigned by app_bootstrap`);
    assert.match(ioClose, new RegExp(`\\b${helper}\\(`), `${helper} should remain callable from io_close`);
  }
});

test('open-board failures show a readable pill message', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const styles = readSource('src/styles.css');

  assert.match(bootstrap, /function openFailureIslandMessage\(errorLabel, err\)/);
  assert.match(bootstrap, /function openFailureUserDetail\(detail, err\)/);
  assert.match(bootstrap, /Permission was not granted/);
  assert.match(bootstrap, /Unsupported Boardfish file/);
  assert.match(bootstrap, /Boardfish file is missing board data/);
  assert.match(bootstrap, /Boardfish file is missing image data/);
  assert.match(bootstrap, /Boardfish file is invalid/);
  assert.match(bootstrap, /This browser cannot open compressed Boardfish files/);
  assert.match(bootstrap, /one image is/);
  assert.match(bootstrap, /OpenDebug\.step\(dbg, 'open-failed:message'/);
  assert.match(bootstrap, /finalMsg: message/);
  assert.match(bootstrap, /duration: long_message/);
  assert.doesNotMatch(bootstrap, /Failed to open file:/);
  assert.match(styles, /#island \{[\s\S]*max-width: calc\(100vw - 32px\);/);
  assert.match(styles, /#isl-zoom,\s*\.opening-shield-pill-text \{[\s\S]*white-space: normal;/);
});

test('open-board loading does not wait for pill status update before reading the file', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const productionBootstrap = withoutDeveloperDiagnostics(bootstrap);

  assert.match(bootstrap, /startPillTask\(\{ message: 'Opening' \}\);[\s\S]*?data = await invokeReadBoard\(filePath, dbg\);/);
  assert.match(productionBootstrap, /startPillTask\(\{ message: 'Opening' \}\);\s*let data;\s*data = await invokeReadBoard\(filePath\);/);
  assert.doesNotMatch(bootstrap, /await startPillTask\(\{ message: 'Opening' \}\)/);
});

test('open-board title target updates as soon as board data is applied', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const productionBootstrap = withoutDeveloperDiagnostics(bootstrap);

  assert.match(
    bootstrap,
    /applyBoardData\(data[\s\S]*?, dbg[\s\S]*?\);\s*currentFileRef = filePath;\s*currentFilePath = fileLabel;\s*updateTitle\(\);[\s\S]*?await finishOpenedBoard\(dbg, data\);/,
  );
  assert.match(
    productionBootstrap,
    /applyBoardData\(data\s*\);\s*currentFileRef = filePath;\s*currentFilePath = fileLabel;\s*updateTitle\(\);\s*await finishOpenedBoard\(\);/,
  );
});

test('open-board completion does not await synchronous pill cleanup', () => {
  const ioClose = readSource('src/js/io_close.js');

  assert.match(ioClose, /const pillFinishReason = finishPillTask\(\{/);
  assert.doesNotMatch(ioClose, /await finishPillTask\(\{/);
});
