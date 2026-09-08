'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, readJson } = require('../test-support/source.js');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function listFiles(dir, predicate = () => true) {
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) return [];
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(relativePath, predicate));
    else if (predicate(relativePath)) files.push(relativePath);
  }
  return files;
}

test('browser tab always uses the fixed Boardfish title', () => {
  const html = readSource('src/index.html');
  const runtimeFiles = [
    ...listFiles('src', (file) => /\.(js|mjs)$/.test(file)),
    ...listFiles('scripts', (file) => /\.(js|mjs)$/.test(file)),
  ];

  assert.equal((html.match(/<title\b/gi) || []).length, 1);
  assert.match(html, /<title>Boardfish<\/title>/);
  for (const file of runtimeFiles) {
    const source = readSource(file);
    assert.doesNotMatch(source, /\bdocument\s*\.\s*title\b/, `${file} changes the browser tab title`);
  }
});

test('web runtime owns local board file IO', () => {
  const runtime = readSource('src/js/web_runtime.js');
  const io = readSource('src/js/io_close.js');

  assert.match(runtime, /showOpenFilePicker/);
  assert.match(runtime, /showSaveFilePicker/);
  assert.match(runtime, /downloadBlob\(payload\.blob, fileNameFromRef\(ref, 'board\.bf'\)\)/);
  assert.match(runtime, /root\.BoardfishRuntime = api;/);
  assert.match(io, /BoardfishRuntime\.openFileDialog\(\)/);
  assert.match(io, /BoardfishRuntime\.saveFileDialog\(defaultName\)/);
  assert.match(io, /BoardfishRuntime\.readBoard\(fileRef\)/);
  assert.match(io, /BoardfishRuntime\.saveBoard\(fileRef, data, \{ imageStore, \.\.\.options \}\)/);
  assert.match(io, /invokeSaveBoard\(fileRef[\s\S]*?\{ sourceFileRef: currentFileRef \}/);
});

test('image storage is web-ref and data-url based', () => {
  const types = readSource('src/js/board_types.js');
  const imageState = readSource('src/js/image_state.js');
  const imageInsert = readSource('src/js/image_insert.js');
  const boardContainer = readSource('src/js/web_board_container.js');

  assert.match(types, /MANIFEST: 'manifest'/);
  assert.match(imageState, /blobForImageSource/);
  assert.match(imageInsert, /createWebImageSourceFromBlob\(file, imgKey\)/);
  assert.match(imageInsert, /file instanceof File[\s\S]*new Blob\(\[file\]/);
  assert.doesNotMatch(imageInsert, /readAsArrayBuffer/);
  assert.match(imageInsert, /const WEB_IMAGE_INSERT_CONCURRENCY = 3;/);
  assert.match(boardContainer, /createWebImageRef/);
  assert.match(boardContainer, /web: true/);
});

test('clipboard and debug tooling use browser clipboard paths', () => {
  const clipboardState = readSource('src/js/clipboard_state.js');
  const clipboardExport = readSource('src/js/clipboard_export_init.js');
  const startupDebug = readSource('src/js/startup_debug.js');

  assert.match(clipboardState, /markJsClipboardWebTokenWritten/);
  assert.match(clipboardExport, /copy:web-clipboard-write-start/);
  assert.match(clipboardExport, /copy:web-clipboard-write-end/);
  assert.match(clipboardExport, /web-paste-browser/);
  assert.match(startupDebug, /method: 'browser-download'/);
  assert.match(startupDebug, /await applyAppTheme\(targetTheme[^\n]+\n\s+await new Promise\(\(resolve\) => requestAnimationFrame\(resolve\)\);/);
});

test('text edit entry and shortcuts keep edge-case guards', () => {
  const textEditor = readSource('src/js/text_editor.js');

  assert.match(textEditor, /const obj = objectsMap\.get\(id\);\s*if \(!obj\) return;\s*editingId = id;/);
  assert.match(textEditor, /\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.shiftKey && e\.key\.toLowerCase\(\) === 'c'/);
  assert.match(textEditor, /\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.shiftKey && e\.key\.toLowerCase\(\) === 'x'/);
  assert.match(textEditor, /\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.shiftKey && e\.key\.toLowerCase\(\) === 'a'/);
});

test('text input debug metadata is lazy when logging is disabled', () => {
  const textEditor = readSource('src/js/text_editor.js');

  assert.match(textEditor, /const details = typeof meta === 'function' \? meta\(\) : meta;/);
  assert.match(textEditor, /logInputStep\('start', \(\) => \(\{/);
  assert.match(textEditor, /logInputStep\('auto-height-done', \(\) => \(\{/);
});

test('browser paste fallback owns exactly one input shield token', () => {
  const clipboardExport = readSource('src/js/clipboard_export_init.js');

  assert.match(clipboardExport, /const releaseInputShield = acquireInputShield\(\);/);
  assert.match(clipboardExport, /finally \{\s*releaseInputShield\(\);\s*\}/);
});

test('dirty tracking treats net-empty boards as clean only against an empty saved baseline', () => {
  const io = readSource('src/js/io_close.js');
  const history = readSource('src/js/history_state.js');
  const objectCommands = readSource('src/js/object_commands.js');
  const match = io.match(/function isDirty\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'isDirty function is missing');
  assert.match(io, /function isDefaultEmptyBoardState\(objectList = objects\) \{[\s\S]*for \(const obj of objectList \|\| \[\]\)[\s\S]*return true;\s*\}/);
  assert.match(io, /function isCleanDefaultEmptyBoardState\(\) \{\s*return savedDefaultEmptyBoard && isDefaultEmptyBoardState\(objects\);\s*\}/);
  assert.match(match[1], /revision !== savedHistoryRevision/);
  assert.match(history, /revision: reason === 'text-edit-enter' && !contentChanged \? prevEntry\?\.revision : \+\+_historyRevision/);
  assert.match(objectCommands, /if \(isCleanDefaultEmptyBoardState\(\) && !currentFilePath && !currentFileRef\) \{\s*return;\s*\}/);
});

test('startup marks the initial empty board snapshot clean', () => {
  const bootstrap = readSource('src/js/app_bootstrap.js');

  assert.match(bootstrap, /resizeCanvas\(\);\s*snapshot\(\);\s*markSaved\(\);/);
});

test('dark mode icon is local and offline-safe', () => {
  const html = readSource('src/index.html');
  const styles = readSource('src/styles.css');
  const sw = readSource('src/sw.js');

  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|Material Symbols|material-symbols-outlined/i);
  assert.match(html, /id="ctx-btn-dark-mode"[\s\S]*<svg viewBox="0 0 24 24"/);
  assert.doesNotMatch(styles, /material-symbols-outlined/i);
  assert.doesNotMatch(sw, /fonts\.googleapis\.com|fonts\.gstatic\.com/i);
  assert.match(sw, /if \(isCacheFirstAssetUrl\(url\)\)[\s\S]*\[a-f0-9\]\{12\}[\s\S]*cached\.then\(\(hit\) => hit \|\| fetchAndCacheRequest\(event, request, url\)\)/);
  assert.match(sw, /const update = fetchAndCacheRequest[\s\S]*event\.waitUntil\(update\)/);
  assert.match(sw, /const currentCache = caches\.open\(BOARDFISH_CACHE\);[\s\S]*event\.waitUntil\(currentCache\.then\(\(cache\) => cache\.put\(request, copy\)/);
  assert.match(sw, /BOARDFISH_CACHE_NAMESPACE[\s\S]*encodeURIComponent\(self\.registration\.scope\)/);
  assert.match(sw, /key\.startsWith\(BOARDFISH_CACHE_NAMESPACE\)/);
  assert.match(sw, /function matchCurrentCache\(request\)[\s\S]*currentCache\.then\(\(cache\) => cache\.match\(request\)\)/);
  assert.doesNotMatch(sw, /caches\.match\(/);
  assert.doesNotMatch(sw, /await cache\.put/);
});

test('fresh app sessions default to dark mode', () => {
  const html = readSource('src/index.html');
  const manifest = readJson('src/manifest.webmanifest');
  const app = readSource('src/app.js');

  assert.match(html, /<meta name="theme-color" content="#1c1b22" \/>/);
  assert.match(html, /<body data-theme="dark">/);
  assert.match(html, /id="ctx-btn-dark-mode"[^>]*aria-pressed="true"/);
  assert.equal(manifest.background_color, '#1c1b22');
  assert.equal(manifest.theme_color, '#1c1b22');
  assert.match(app, /var DEFAULT_APP_THEME = 'dark';/);
  assert.match(app, /var appTheme = DEFAULT_APP_THEME;/);
  assert.match(app, /catch \(_\) \{\s*return DEFAULT_APP_THEME;\s*\}/);
  assert.match(app, /function repaintBoardForThemeChange\(\)[\s\S]*scheduleRender\(true, false/);
  assert.doesNotMatch(app.match(/function repaintBoardForThemeChange\(\)[\s\S]*?\n\}/)?.[0] || '', /drawBoard/);
});

test('dev server returns 400 for malformed URL encodings', () => {
  const server = readSource('scripts/serve-web.mjs');

  assert.match(server, /catch \(err\) \{\s*if \(err instanceof URIError\) \{\s*res\.writeHead\(400\)\.end\('Bad Request'\);/);
});

test('image hydration queue processes until its time budget is consumed', () => {
  const imageState = readSource('src/js/image_state.js');

  assert.match(imageState, /var _imageHydrationQueue = new Map\(\);/);
  assert.match(imageState, /if \(count > 0 && performance\.now\(\) - batchStart >= 6\) break;/);
  assert.match(imageState, /cacheImage\(key, source[\s\S]*?, dbg[\s\S]*?\);/);
});

test('edit offscreen rebuild is synchronous, single-pass, and reuses its backing size', () => {
  const viewport = readSource('src/js/viewport.js');
  const start = viewport.indexOf('function _rebuildOffscreen(dpr, viewportRect)');
  const end = viewport.indexOf('\nfunction', start + 1);
  const source = viewport.slice(start, end > start ? end : undefined);

  assert.notEqual(start, -1);
  assert.doesNotMatch(source, /scheduleRender/);
  assert.match(source, /if \(_offscreen\.width !== boardCanvas\.width\) _offscreen\.width = boardCanvas\.width;/);
  assert.match(source, /if \(_offscreen\.height !== boardCanvas\.height\) _offscreen\.height = boardCanvas\.height;/);
  assert.match(source, /_offscreenDirty = false;/);
});

test('save and open validation stay at the authoritative container boundaries', () => {
  const container = readSource('src/js/web_board_container.js');
  const createStart = container.indexOf('async function createBoardContainerBlob');
  const createEnd = container.indexOf('\n  async function readBoardContainer', createStart);
  const createSource = container.slice(createStart, createEnd);
  assert.ok(createStart >= 0 && createEnd > createStart);
  assert.equal((createSource.match(/JSON\.stringify/g) || []).length, 1);
  assert.match(createSource, /validateBoardPayload\(\{/);

  const runtime = readSource('src/js/web_runtime.js');
  const saveStart = runtime.indexOf('async function saveBoard');
  const saveEnd = runtime.indexOf('\n  const api =', saveStart);
  const saveSource = runtime.slice(saveStart, saveEnd);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.ok(saveSource.indexOf('await stabilizeImageSources') >= 0);
  assert.ok(saveSource.indexOf('await stabilizeImageSources') < saveSource.indexOf('createBoardContainerBlob'));
  assert.ok(saveSource.indexOf('await writeBlobToHandle') >= 0);
  assert.doesNotMatch(saveSource, /handle\.getFile|refreshImageSources/);
  assert.match(runtime, /waitForFileOperation\(\(\) => writable\.write\(blob\), stage, timeoutMs\)/);
  assert.match(runtime, /waitForFileOperation\([\s\S]*?\(\) => writable\.abort\(failure\)/);

  const saveDebug = readSource('src/js/debug_save.js');
  assert.match(saveDebug, /jsonBytes: e\.meta\?\.rust\?\.json_bytes \?\? ''/);
});
