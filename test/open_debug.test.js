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

function waitForOpenRenderFrameSource() {
  const source = readSource('src/js/io_close.js');
  const start = source.indexOf('const waitForOpenRenderFrame =');
  const end = source.indexOf('\nvar _backgroundOpenHydrationRunning', start);
  assert.ok(start >= 0 && end > start, 'waitForOpenRenderFrame source is missing');
  return source.slice(start, end);
}

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
  const imageState = readSource('src/js/image_state.js');
  const viewport = readSource('src/js/viewport.js');

  for (const method of [
    'phaseSummary',
    'hydrationSummary',
    'stepSummary',
    'imageStoreSummary',
    'hydrationCandidates',
    'slowImages',
    'hydrationBreakdown',
    'cacheImageBreakdown',
    'setHydrationMode',
    'setHydrationConcurrency',
    'report',
  ]) {
    assert.match(openDebug, new RegExp(`\\b${method}\\b`), `OpenDebug is missing ${method}`);
  }
  assert.match(openDebug, /let hydrationMode = 'visible-first';/);
  assert.match(openIo, /var openHydrationMode = 'visible-first';/);
  assert.match(openIo, /function getOpenHydrationMode\(\)/);
  assert.match(openIo, /const hydrationMode = getOpenHydrationMode\(\);/);
  assert.match(openIo, /const visibleFirstOpen = deferRender &&/);
  assert.match(openIo, /deferredInitialCacheImages\+\+;/);
  assert.match(openIo, /const isOpenHydratableImageSource = \(source\) => \{/);
  assert.match(openIo, /typeof source === 'string' \|\| isNativeImageRef\(source\) \|\| isWebImageRef\(source\)/);
  assert.match(openIo, /function getReferencedHydratableImageKeys\(limit = Infinity, exclude = new Set\(\)\)/);
  assert.match(openIo, /const keys = getReferencedHydratableImageKeys\(\);/);
  assert.match(openIo, /pendingImages: getPendingHydratableImageKeys\(\)\.length/);
  assert.doesNotMatch(openIo, /pendingNativeImages: getPendingNativeImageKeys\(\)\.length/);
  assert.match(openIo, /const pendingReady = imageReadyPromises\.get\(key\);\s*if \(pendingReady\) \{\s*const t0 = performance\.now\(\);\s*const cacheMetrics = await pendingReady;/);
  assert.match(openIo, /source: 'pending-cache'/);
  assert.match(openIo, /async function settleVisibleImageBitmapsForOpen/);
  assert.match(openIo, /while \(state\.settled < count\)/);
  assert.doesNotMatch(openIo, /const maxMs = Number\.isFinite\(options\.maxMs\)/);
  assert.match(openIo, /hydrate-visible:bitmap-settle/);
  assert.match(openDebug, /visibleBitmapSettleMs/);
  assert.match(openDebug, /visibleBitmapsFailed/);
  assert.match(imageState, /var MAX_IMAGE_DECODE_ACTIVE = 2;/);
  assert.match(imageState, /const MAX_OPEN_IMAGE_DECODE_ACTIVE = 8;/);
  assert.match(imageState, /_boardOpening[\s\S]*MAX_OPEN_IMAGE_DECODE_ACTIVE[\s\S]*MAX_IMAGE_DECODE_ACTIVE/);
  assert.match(viewport, /function getLastApplyTransformMeta\(\)/);
  assert.match(openIo, /const renderBreakdown = typeof getLastApplyTransformMeta === 'function'/);
  assert.match(openIo, /drawBoardTotalMs: drawBreakdown\?\.totalMeasuredMs/);
  assert.match(openDebug, /initialDrawMs: initialRender\?\.meta\?\.drawMs/);

  for (const phase of [
    'read-board-debug',
    'read-board-shape',
    'applyBoardData:start',
    'prune-unreferenced-images',
    'clearImageStore',
    'cacheImage:start-all',
    'replaceBoardObjects',
    'apply-state',
    'restore-counters-viewport',
    'hydrate-initial-policy',
    'hydrate-visible:candidates',
    'hydrate-all:candidates',
    'hydrate-background:done',
    'initial-applyTransform',
  ]) {
    assert.match(openIo, new RegExp(phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `open flow is missing ${phase}`);
  }

  for (const phase of [
    'cache-image:load',
    'cache-image:readback-probe',
    'cache-image:display-ready',
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
  assert.match(startupDebug, /writeDebugLogFile/);
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
  assert.match(styles, /#isl-zoom \{[\s\S]*white-space: normal;/);
});

test('open-board loading does not wait for pill status update before reading the file', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');

  assert.match(bootstrap, /startPillTask\(\{ message: 'Opening' \}\);\s*const data = await invokeReadBoard/);
  assert.doesNotMatch(bootstrap, /await startPillTask\(\{ message: 'Opening' \}\);\s*const data = await invokeReadBoard/);
});

test('open-board title target updates as soon as board data is applied', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');

  assert.match(
    bootstrap,
    /applyBoardData\(data,[\s\S]*?\);\s*currentFileRef = filePath;\s*currentFilePath = fileLabel;\s*updateTitle\(\);\s*await finishOpenedBoard\(dbg, data\);/,
  );
});
