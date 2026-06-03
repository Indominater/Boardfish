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

  assert.match(manifest, /export const VARIANT_SCRIPTS = Object\.freeze\(\{\s*'web-dev': WEB_DEV_SCRIPTS,\s*'web-preview': WEB_PREVIEW_SCRIPTS,\s*\}\);/);
  assert.doesNotMatch(manifest, new RegExp(shellWord.toUpperCase()));
  assert.ok(webDev.includes('web_runtime.js'));
  assert.ok(webDev.includes('startup_debug.js'));
  assert.ok(webPreview.includes('runtime_debug_noop.js'));
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
  assert.match(io, /BoardfishRuntime\.saveBoard\(fileRef, data, \{ imageStore \}\)/);
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
  assert.match(imageInsert, /createWebImageSourceFromBytes\(file, imgKey, bytes\)/);
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
  assert.doesNotMatch(startupDebug, /writeDebugLogFile/);
});

test('motion policy reserves browser shortcuts instead of window chrome', () => {
  const motion = readSource('src/js/motion.js');
  const keyboard = readSource('src/js/keyboard.js');

  assert.match(motion, /browserReservedShortcuts/);
  assert.match(motion, /'browser-find-shortcut'/);
  assert.doesNotMatch(motion, /appWindow/);
  assert.doesNotMatch(motion, new RegExp('app-' + 'window'));
  assert.match(keyboard, /isBrowserFindShortcut/);
  assert.match(keyboard, /'browser-find-shortcut'/);
});
