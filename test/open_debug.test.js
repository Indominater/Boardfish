'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../test-support/source.js');
const vm = require('node:vm');


function withoutDeveloperDiagnostics(source) {
  const start = '/* BOARDFISH_DEV_DIAGNOSTICS_START */';
  const end = '/* BOARDFISH_DEV_DIAGNOSTICS_END */';
  assert.equal(source.split(start).length, source.split(end).length, 'developer diagnostic markers are unbalanced');
  return source.replace(
    /\/\* BOARDFISH_DEV_DIAGNOSTICS_START \*\/[\s\S]*?\/\* BOARDFISH_DEV_DIAGNOSTICS_END \*\//g,
    '',
  );
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
    'hydrationBreakdown',
    'cacheImageBreakdown',
    'setHydrationConcurrency',
    'optimizationReport',
    'beginInitialRenderDebug',
    'endInitialRenderDebug',
    'isInitialRenderDebugActive',
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
  assert.match(openIo, /await \(pendingReady \|\| cacheImage\(key, source/);
  assert.match(withoutDeveloperDiagnostics(openIo), /await \(pendingReady \|\| cacheImage\(key, source[\s\S]*?return displayReady;/);
  assert.match(openIo, /source: pendingReady \? 'pending-cache'/);
  assert.match(openIo, /function getPendingHydratableImageKeys\(keys = \[\]\) \{\s*const seen = new Set\(keys\);/);
  assert.match(finishSource, /const visibleKeys = getVisibleImageKeys\(Infinity\);\s*const hydrationKeys = getPendingHydratableImageKeys\(\[\.\.\.visibleKeys\]\);/);
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

test('open-board helpers used by io_close are shared across startup scripts', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const ioClose = readSource('src/js/io_close.js');

  for (const helper of ['confirmDirtyBeforeOpen', 'openBoardFromPath', 'finishFailedOpen']) {
    assert.match(bootstrap, new RegExp(`var ${helper};`), `${helper} should be declared in shared script scope`);
    assert.match(bootstrap, new RegExp(`${helper} = (?:async )?function ${helper}\\(`), `${helper} should be assigned by app_bootstrap`);
    assert.match(ioClose, new RegExp(`\\b${helper}\\(`), `${helper} should remain callable from io_close`);
  }
});

test('debug clipboard fallback reports a failed copy once and keeps both causes', async () => {
  const source = readSource('src/js/startup_debug.js');
  const start = source.indexOf('  async function copyDebugJson(');
  const end = source.indexOf('  async function sampleFrames(', start);
  assert.ok(start >= 0 && end > start);
  for (const outcome of ['api-success', 'fallback-success', 'fallback-false', 'fallback-error']) {
    const warnings = [];
    const apiError = new Error('clipboard permission denied');
    const selectionError = new Error('selection copy unavailable');
    let removed = 0;
    const context = {
      lastJson: '',
      storeResult(value) { context.lastJson = JSON.stringify(value); },
      console: { log() {}, warn(...args) { warnings.push(args); } },
      navigator: { clipboard: { async writeText() { if (outcome !== 'api-success') throw apiError; } } },
      document: {
        body: { appendChild() {} },
        createElement() {
          return { style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() { removed++; } };
        },
        execCommand() {
          if (outcome === 'fallback-error') throw selectionError;
          return outcome === 'fallback-success';
        },
      },
    };
    const copy = vm.runInNewContext(`${source.slice(start, end)}; copyDebugJson`, context);
    const succeeded = outcome.endsWith('success');
    assert.equal(await copy('Test JSON', { sample: 1 }), succeeded);
    assert.equal(removed, Number(outcome !== 'api-success'));
    assert.equal(warnings.length, Number(!succeeded));
    if (!succeeded) {
      assert.equal(warnings[0][0], 'Clipboard Write Failed: Test JSON');
      assert.equal(warnings[0][1].clipboardApiError, apiError);
      assert.equal(warnings[0][1].selectionError, outcome === 'fallback-error' ? selectionError : null);
    }
  }
});

test('open-board failures show a readable pill message', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const styles = readSource('src/styles.css');
  const start = bootstrap.indexOf('  function openFailureIslandMessage(');
  const end = bootstrap.indexOf('  finishFailedOpen =', start);
  assert.ok(start >= 0 && end > start);
  const format = vm.runInNewContext(`${bootstrap.slice(start, end)}; openFailureIslandMessage`);
  for (const [error, expected] of [
    [{ name: 'NotAllowedError' }, 'Open Failed: Permission Denied'],
    [{ name: 'SecurityError' }, 'Open Failed: Permission Denied'],
    [new Error('Permission Denied'), 'Open Failed: Permission Denied'],
    [{ name: 'NotReadableError' }, 'Open Failed: File Unavailable'],
    [{ name: 'NotFoundError' }, 'Open Failed: File Unavailable'],
    [new Error('File Unavailable'), 'Open Failed: File Unavailable'],
    [new Error('No File Selected'), 'Open Failed: File Unavailable'],
    [new Error('Image Read Failed'), 'Open Failed: File Unavailable'],
    [new Error('Unsupported Board Version: 99'), 'Open Failed: Unsupported File'],
    [new Error('Unsupported File Format'), 'Open Failed: Unsupported File'],
    [new Error('Unsupported Compression'), 'Open Failed: Unsupported File'],
    [new Error('Unsupported ZIP Format'), 'Open Failed: Unsupported File'],
    [new Error('Missing File Entry: board.json'), 'Open Failed: Invalid File'],
    [new Error('Missing Image: img-1'), 'Open Failed: Invalid File'],
    [new Error('Invalid Image Source: img-1'), 'Open Failed: Invalid File'],
    [new Error('File Checksum Mismatch: board.json'), 'Open Failed: Invalid File'],
    [new SyntaxError('unexpected browser detail'), 'Open Failed: Invalid File'],
    [new Error('Invalid File Entry: permission-denied/unsupported.png'), 'Open Failed: Invalid File'],
    [new Error('File Entry Too Large: board.json'), 'Open Failed: File Too Large'],
    [{ boardfishLimit: true, boardfishUserMessage: 'Board Limit: 100 Objects' }, 'Board Limit: 100 Objects'],
    [{ boardfishLimit: true }, 'Board Limit Exceeded'],
    [new Error('unrecognized browser detail'), 'Open Failed'],
    [null, 'Open Failed'],
  ]) assert.equal(format(error), expected);
  assert.match(bootstrap, /OpenDebug\.step\(dbg, 'open-failed:message'/);
  assert.match(bootstrap, /finalMsg: message/);
  assert.match(bootstrap, /duration: long_message/);
  assert.match(styles, /#island \{[\s\S]*max-width: calc\(100vw - 32px\);/);
  assert.match(styles, /#isl-zoom \{[\s\S]*white-space: normal;/);
});

test('open failures retain diagnostic details and release the input shield in both builds', async () => {
  for (const development of [false, true]) {
    const messages = [], errors = [], debugCalls = [];
    let releases = 0;
    const error = new Error('Invalid File Entry: images/original.png');
    const dbg = { id: 123 };
    const context = {
      document: {},
      _boardOpening: false,
      startCanvasSizeTracking() {}, resizeCanvas() {}, snapshot() {}, markSaved() {},
      registerDebugCommand() {},
      BoardfishRuntime: { describeFileRef() { return 'board.bf'; } },
      beginOpeningFreeze() {}, startPillTask() {},
      endOpeningFreeze() { releases++; },
      async invokeReadBoard() { throw error; },
      console: { error(...args) { errors.push(args); } },
      OpenDebug: { step(value) { debugCalls.push(value); }, end(value) { debugCalls.push(value); } },
      long_message: 4500,
      finishPillTask({ beforeFinish, finalMsg, duration }) {
        beforeFinish();
        messages.push(finalMsg);
        assert.equal(duration, 4500);
      },
    };
    vm.createContext(context);
    const source = readSource('src/js/app_bootstrap.js');
    vm.runInContext(development ? source : withoutDeveloperDiagnostics(source), context);
    await context.openBoardFromPath({}, ...(development ? [dbg] : []));
    assert.deepEqual(messages, ['Open Failed: Invalid File']);
    assert.equal(context._boardOpening, false);
    assert.equal(releases, 1);
    assert.deepEqual(errors, [['Open Failed:', error]]);
    assert.deepEqual(debugCalls, development ? [dbg, dbg] : []);
  }
});

test('open-board loading does not wait for pill status update before reading the file', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const productionBootstrap = withoutDeveloperDiagnostics(bootstrap);
  const developmentBootstrap = bootstrap.replace(/\/\* BOARDFISH_DEV_DIAGNOSTICS_(?:START|END) \*\//g, '');

  assert.match(developmentBootstrap, /startPillTask\(\{ message: 'Opening' \}\);\s*const data = await invokeReadBoard\(filePath\s*, dbg\s*\);/);
  assert.match(productionBootstrap, /startPillTask\(\{ message: 'Opening' \}\);\s*const data = await invokeReadBoard\(filePath\s*\);/);
  assert.doesNotMatch(bootstrap, /await startPillTask\(\{ message: 'Opening' \}\)/);
});

test('open-board file target updates as soon as board data is applied', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');
  const productionBootstrap = withoutDeveloperDiagnostics(bootstrap);
  const developmentBootstrap = bootstrap.replace(/\/\* BOARDFISH_DEV_DIAGNOSTICS_(?:START|END) \*\//g, '');

  assert.match(
    developmentBootstrap,
    /applyBoardData\(data\s*, dbg\s*\);\s*currentFileRef = filePath;\s*currentFilePath = fileLabel;\s*await finishOpenedBoard\(\s*dbg, data\s*\);/,
  );
  assert.match(
    productionBootstrap,
    /applyBoardData\(data\s*\);\s*currentFileRef = filePath;\s*currentFilePath = fileLabel;\s*await finishOpenedBoard\(\s*\);/,
  );
});

test('open-board completion does not await synchronous pill cleanup', () => {
  const ioClose = readSource('src/js/io_close.js');

  assert.match(ioClose, /const pillFinishReason = finishPillTask\(\{/);
  assert.doesNotMatch(ioClose, /await finishPillTask\(\{/);
});
