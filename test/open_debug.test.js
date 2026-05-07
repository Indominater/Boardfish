'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('open-board debugger covers the slow open phases developers need to inspect', () => {
  const openDebug = readSource('src/js/debug_open.js');
  const openIo = readSource('src/js/io_close.js');

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
  ]) {
    assert.match(openDebug, new RegExp(`\\b${method}\\b`), `OpenDebug is missing ${method}`);
  }
  assert.match(openDebug, /let hydrationMode = 'all-before-open';/);
  assert.match(openIo, /var openHydrationMode = 'all-before-open';/);
  assert.match(openIo, /function getOpenHydrationMode\(\)/);
  assert.match(openIo, /const hydrationMode = getOpenHydrationMode\(\);/);
  assert.match(openIo, /function getReferencedNativeImageKeys\(limit = Infinity, exclude = new Set\(\)\)/);
  assert.match(openIo, /const keys = getReferencedNativeImageKeys\(\);/);
  assert.match(openIo, /pendingNativeImages: getPendingNativeImageKeys\(\)\.length/);

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

  const imageState = readSource('src/js/image_state.js');
  for (const phase of [
    'cache-image:load',
    'cache-image:readback-probe',
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

test('open-board loading does not wait for pill status update before reading the file', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');

  assert.match(bootstrap, /startPillTask\(\{ message: 'Opening' \}\);\s*const data = await invokeReadBoard/);
  assert.doesNotMatch(bootstrap, /await startPillTask\(\{ message: 'Opening' \}\);\s*const data = await invokeReadBoard/);
});
