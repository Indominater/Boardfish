'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shellWord = 'desk' + 'top';
const bridgeWord = 'T' + 'auri';
const titlebarWord = 'title' + 'bar';
const recoveryWord = 're' + 'covery';

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readSource(relativePath));
}

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

function jsSourceFiles() {
  return [
    ...listFiles('src', (file) => /\.(js|mjs|html|css)$/.test(file)),
    ...listFiles('scripts', (file) => /\.(js|mjs)$/.test(file)),
  ];
}

function manifestScripts(name) {
  const source = readSource('src/js/startup_manifest.mjs');
  const match = source.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `${name} is missing`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

test('repository no longer contains the removed app shell', () => {
  for (const relativePath of [
    ['src', 't' + 'auri'].join('-'),
    '.github/workflows/release.yml',
    'scripts/sync-debug-tools.mjs',
    'src/js/' + bridgeWord.toLowerCase() + '_bridge.js',
    `src/js/runtime_${shellWord}.js`,
    'src/js/runtime_web_' + 'n' + 'ative' + '.js',
    `src/js/window_${titlebarWord}.js`,
    `src/js/window_${recoveryWord}.js`,
    `src/js/main.${shellWord}.dev.mjs`,
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} should be removed`);
  }
});

test('package scripts and dependencies are web-only', () => {
  const pkg = readJson('package.json');
  const lock = readSource('package-lock.json');

  assert.equal(pkg.scripts.dev, 'npm run web:dev');
  assert.equal(pkg.scripts.build, 'npm run web:build');
  assert.equal(pkg.scripts['web:build'], 'node scripts/build-runtime-assets.mjs web-preview');
  assert.equal(pkg.devDependencies.esbuild.startsWith('^'), true);
  assert.equal(Object.keys(pkg.devDependencies).length, 1);
  assert.doesNotMatch(JSON.stringify(pkg), new RegExp(bridgeWord, 'i'));
  assert.doesNotMatch(lock, new RegExp(bridgeWord, 'i'));
});

test('startup manifest exposes only web variants', () => {
  const manifest = readSource('src/js/startup_manifest.mjs');
  const webDev = manifestScripts('WEB_DEV_SCRIPTS');
  const webPreview = manifestScripts('WEB_PREVIEW_SCRIPTS');

  assert.doesNotMatch(manifest, /VARIANT_SCRIPTS/);
  assert.doesNotMatch(manifest, new RegExp(shellWord.toUpperCase()));
  assert.equal(webDev[0], 'web_env.js');
  assert.ok(webDev.includes('web_runtime.js'));
  assert.ok(webDev.includes('runtime_utils.js'));
  assert.ok(webDev.includes('startup_debug.js'));
  assert.ok(webPreview.includes('runtime_utils.js'));
  assert.equal(webPreview[0], 'web_env.js');
  assert.equal(webPreview.includes('runtime_debug_noop.js'), false);
  assert.equal(fs.existsSync(path.join(root, 'src/js/runtime_debug_noop.js')), false);
  for (const file of [...webDev, ...webPreview]) {
    assert.doesNotMatch(file, new RegExp(bridgeWord, 'i'));
    assert.doesNotMatch(file, new RegExp(shellWord, 'i'));
    assert.doesNotMatch(file, new RegExp(`${titlebarWord}|${recoveryWord}|runtime_web_${'n' + 'ative'}`));
  }
});

test('frontend source has no removed bridge or window chrome calls', () => {
  const disallowed = [
    'Boardfish' + bridgeWord,
    'has' + bridgeWord,
    bridgeWord.toLowerCase() + 'Invoke',
    bridgeWord.toLowerCase() + 'Listen',
    bridgeWord.toLowerCase() + 'ConvertFileSrc',
    '__' + bridgeWord.toUpperCase() + '__',
    'data-' + bridgeWord.toLowerCase(),
    'app-' + 'window',
    'window_' + titlebarWord,
    'window_' + recoveryWord,
    'image' + 'AssetUrlCache',
    'is' + 'N' + 'ative' + 'ImageRef',
    'n' + 'ative-ref',
  ];

  for (const file of jsSourceFiles()) {
    const source = readSource(file);
    for (const term of disallowed) {
      assert.equal(source.includes(term), false, `${file} still contains ${term}`);
    }
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
  assert.doesNotMatch(types, new RegExp('N' + 'ATIVE'));
  assert.match(imageState, /const revokeWebImageSource = \(src\) =>/);
  assert.match(imageState, /const webImageDisplaySrc = \(src\) =>/);
  assert.match(imageState, /revokeWebImageSource\(imageStore\[key\]\);/);
  assert.match(imageInsert, /createWebImageSourceFromBlob\(file, imgKey\)/);
  assert.match(imageInsert, /file instanceof File[\s\S]*file\.arrayBuffer\(\)/);
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
  assert.doesNotMatch(startupDebug, /writeDebugLogFile/);
});

test('motion policy is copy-only and browser find stays native', () => {
  const motion = readSource('src/js/motion.js');
  const keyboard = readSource('src/js/keyboard.js');

  assert.match(motion, /COPY_JIGGLE_ACTIONS/);
  assert.match(motion, /'copy-selected-objects'/);
  assert.match(motion, /'copy-text-object'/);
  assert.match(motion, /'copy-text-selection'/);
  assert.doesNotMatch(motion, /browser-find-shortcut/);
  assert.doesNotMatch(motion, /appWindow/);
  assert.doesNotMatch(motion, new RegExp('app-' + 'window'));
  assert.match(keyboard, /isBrowserFindShortcut/);
  assert.doesNotMatch(keyboard, /browser-find-shortcut/);
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
  assert.doesNotMatch(clipboardExport, /showInputShield\(\);\s*try \{\s*const imageBlob/);
});

test('dirty tracking treats net-empty boards as clean only against an empty saved baseline', () => {
  const io = readSource('src/js/io_close.js');
  const objectCommands = readSource('src/js/object_commands.js');
  const match = io.match(/function isDirty\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'isDirty function is missing');
  assert.doesNotMatch(io, /function (?:isPersistableBoardObject|hasPersistableBoardObjects)\(/);
  assert.match(io, /function isDefaultEmptyBoardState\(objectList = objects\) \{[\s\S]*for \(const obj of objectList \|\| \[\]\)[\s\S]*return true;\s*\}/);
  assert.match(io, /function isSavedDefaultEmptyBoardState\(\) \{[\s\S]*boardHistory\[savedHistoryIndex\][\s\S]*\}/);
  assert.match(io, /function isCleanDefaultEmptyBoardState\(\) \{\s*return isDefaultEmptyBoardState\(objects\) && isSavedDefaultEmptyBoardState\(\);\s*\}/);
  assert.match(match[1], /return \(historyIndex !== savedHistoryIndex \|\| _dirtyIds\.size > 0\) && !isCleanDefaultEmptyBoardState\(\);/);
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
  assert.match(sw, /event\.waitUntil\(caches\.open\(BOARDFISH_CACHE\)[\s\S]*cache\.put\(request, copy\)/);
  assert.match(sw, /BOARDFISH_CACHE_NAMESPACE[\s\S]*encodeURIComponent\(self\.registration\.scope\)/);
  assert.match(sw, /key\.startsWith\(BOARDFISH_CACHE_NAMESPACE\)/);
  assert.match(sw, /function matchCurrentCache\(request\)[\s\S]*cache\.match\(request\)/);
  assert.doesNotMatch(sw, /caches\.match\(/);
  assert.doesNotMatch(sw, /boardfish-web-v\d/);
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

  assert.match(imageState, /while \(_imageHydrationQueue\.length && \(count === 0 \|\| performance\.now\(\) - batchStart < 6\)\)/);
  assert.match(imageState, /cacheImage\(key, source[\s\S]*?, dbg[\s\S]*?\);/);
  assert.doesNotMatch(imageState, /ensureImageDisplaySrc/);
  assert.doesNotMatch(imageState, /count < 1 && performance\.now\(\) - batchStart < 6/);
});

test('edit offscreen rebuild is synchronous, single-pass, and reuses its backing size', () => {
  const viewport = readSource('src/js/viewport.js');
  const start = viewport.indexOf('function _rebuildOffscreen(dpr, viewportRect)');
  const end = viewport.indexOf('\nfunction', start + 1);
  const source = viewport.slice(start, end > start ? end : undefined);

  assert.notEqual(start, -1);
  assert.doesNotMatch(source, /bitmapPromises/);
  assert.doesNotMatch(source, /ensure-bitmaps/);
  assert.doesNotMatch(source, /scheduleRender/);
  assert.match(source, /if \(_offscreen\.width !== boardCanvas\.width\) _offscreen\.width = boardCanvas\.width;/);
  assert.match(source, /if \(_offscreen\.height !== boardCanvas\.height\) _offscreen\.height = boardCanvas\.height;/);
  assert.match(source, /_offscreenDirty = false;/);
  assert.doesNotMatch(viewport, /_offscreen(?:Rebuilding|Version)/);
});

test('viewport transforms do not schedule an unbounded automatic text prewarm', () => {
  const viewport = readSource('src/js/viewport.js');
  const start = viewport.indexOf('function applyTransform');
  const end = viewport.indexOf('function getLastApplyTransformMeta', start);
  const source = viewport.slice(start, end > start ? end : undefined);

  assert.doesNotMatch(source, /scheduleVisibleTextLayoutPrewarmAfterIdle\(/);
  assert.match(viewport, /function prewarmVisibleTextLayoutCaches\(options = \{\}\)/);
});

test('background open hydration yields while viewport input is active', () => {
  const ioClose = readSource('src/js/io_close.js');
  const start = ioClose.indexOf('async function hydrateRemainingImagesForOpen');
  const end = ioClose.indexOf('\nfunction queueVisibleImageHydration', start);
  const source = ioClose.slice(start, end > start ? end : undefined);

  assert.match(ioClose, /const BACKGROUND_OPEN_HYDRATION_INPUT_IDLE_MS = 180;/);
  assert.match(source, /batchSize = 2/);
  assert.match(source, /performance\.now\(\) - lastViewportInputAt/);
  assert.match(source, /inputIdleMs < BACKGROUND_OPEN_HYDRATION_INPUT_IDLE_MS/);
  assert.match(source, /\.\.\.truthyKeyList\(priorityKeys\)[\s\S]*\.\.\.getPendingHydratableImageKeys\(\)/);
  assert.match(source, /BoardfishImageStore\.hasDisplayImage\(key\)/);
  assert.doesNotMatch(source, /getPendingHydratableImageKeys\(batchSize - keys\.length/);
  assert.match(source, /await new Promise\(\(resolve\) => setTimeout/);
  assert.match(ioClose, /backgroundHydrationPriorityKeys = visibleKeys;/);
  assert.match(ioClose, /hydrateRemainingImagesForOpen\(dbg, 2, backgroundHydrationPriorityKeys\)/);
});

test('save and open validation stay at the authoritative container boundaries', () => {
  const ioClose = readSource('src/js/io_close.js');
  assert.doesNotMatch(ioClose, /validateBoardPayloadFor(?:Save|Open)/);
  assert.doesNotMatch(ioClose, /boardLimitImageBytesForData/);

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
  assert.doesNotMatch(saveDebug, /e\.meta\?\.jsonBytes/);
});

test('failed saves leave a visible failure message in the viewport pill', () => {
  const ioClose = readSource('src/js/io_close.js');
  assert.match(
    ioClose,
    /function showSaveFailurePill\(\) \{\s*showIslandMsg\('Save failed', long_message\);\s*\}/,
  );
  assert.equal((ioClose.match(/showSaveFailurePill\(\);/g) || []).length, 2);
});

test('addText sizes multiline text without spreading all lines into Math.max', () => {
  const objectCommands = readSource('src/js/object_commands.js');
  const match = objectCommands.match(/function addText\([\s\S]*?const obj = \{/);
  assert.ok(match, 'addText function body is missing');

  assert.doesNotMatch(match[0], /Math\.max\(\.\.\.lines\.map/);
  assert.match(match[0], /let maxLineLen = 1;/);
});
