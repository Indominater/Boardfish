'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const WEB_DEV_DIAGNOSTIC_SCRIPTS = Object.freeze([
  'debug_core.js',
  'startup_debug.js',
  'debug.js',
  'debug_save.js',
  'debug_open.js',
  'debug_export.js',
  'debug_manual_perf.js',
  'debug_insert.js',
  'debug_text_selection.js',
  'viewport_debug_ui.js',
]);

const RELEASE_FORBIDDEN_DIAGNOSTIC_HELPERS = Object.freeze([
  'textEditorTextStats',
  'objectCommandTextStats',
  'textClipboardStats',
  'clipboardTextStats',
  'clipboardTextMetricsForObjects',
  'selectionResizeTextObjectStats',
  'prewarmVisibleTextLayoutCaches',
  'warmTextLayoutDrawLines',
  'createTextDrawWarmupAggregate',
  'addTextDrawWarmupAggregate',
  'getLastVisibleTextLayoutPrewarm',
  'getVisibleTextLayoutPrewarmHistory',
  'getBestVisibleTextLayoutPrewarm',
]);

const RELEASE_FORBIDDEN_DIAGNOSTIC_MARKERS = Object.freeze([
  'event-clipboard:inspect',
  'history-push',
  'visibleTextLayoutPrewarm',
  'board-warmup-snapshot-unavailable',
  'read-board-debug',
  'web-export:pill-start',
  'selection-drag-move-hit',
  'canvas-mousedown-route',
  'blob-parts+materialized-small',
  'copy:web-text-clipboard-write-end',
  'dom-current',
  'keydown-delete-replacement-ready',
  'menu-replace-textarea-mutated',
  'missing-proxy',
  'selection-fits-dom',
  'stale-dom',
  'sync-skipped',
  'text-edit-input:',
]);

const RELEASE_FORBIDDEN_DIAGNOSTIC_METADATA = Object.freeze([
  'autoHeightMs',
  'blobImageBytes',
  'byteArrayImageBytes',
  'caretApplyMs',
  'clearLayoutMs',
  'clickToEditTotalMs',
  'crcMs',
  'crcComputedBytes',
  'crcComputedEntries',
  'crcReusedEntries',
  'deleteRangeMs',
  'dispatchStartedAt',
  'domSyncedBeforeNativeInput',
  'drawCalls',
  'drawUnits',
  'enterEditMs',
  'fontSwitches',
  'imageEntriesMs',
  'keydownDeleteSetupMs',
  'jsonEncodeMs',
  'jsonStringifyMs',
  'layoutMs',
  'mutationStartedAt',
  'plainRuns',
  'planCacheHits',
  'planCacheMisses',
  'renderScheduleMs',
  'replacementBuildMs',
  'scheduledDelayMs',
  'scriptRuns',
  'skippedSpaces',
  'skippedTabs',
  'textareaMutationMs',
  'validationMs',
  'worldPointMs',
  'zipMs',
  'zipMode',
]);

const RELEASE_OPERATIONAL_CONSOLE_MESSAGES = Object.freeze([
  ['warn', '[Boardfish] service worker registration failed:'],
  ['warn', '[export] save picker failed; falling back to browser download.'],
  ['error', 'Save failed:'],
  ['error', '[copy] clipboard.write FAILED:'],
]);

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readSource(relativePath));
}

function manifestScripts(name) {
  const source = readSource('src/js/startup_manifest.mjs');
  const match = source.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `${name} is missing`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

let builtWebPreviewBundle = null;
let builtReadableWebPreviewBundle = null;

function readCurrentWebPreviewBundle() {
  const html = readSource('dist-web/index.html');
  const match = html.match(/<script\s+src="(assets\/boardfish-web-preview\.[a-f0-9]{12}\.min\.js)"><\/script>/);
  assert.ok(match, 'web preview index is missing its cache-busted runtime bundle');
  assert.ok(readSource('dist-web/sw.js').includes(`'./${match[1]}',`), 'service worker is missing its cache-busted runtime bundle');
  return readSource(path.join('dist-web', match[1]));
}

function buildAndReadWebPreviewBundle() {
  if (builtWebPreviewBundle !== null) return builtWebPreviewBundle;
  execFileSync(process.execPath, [path.join(root, 'scripts/build-runtime-assets.mjs'), 'web-preview'], {
    cwd: root,
    encoding: 'utf8',
  });
  builtWebPreviewBundle = readCurrentWebPreviewBundle();
  return builtWebPreviewBundle;
}

function buildAndReadReadableWebPreviewBundle() {
  if (builtReadableWebPreviewBundle !== null) return builtReadableWebPreviewBundle;
  const buildScript = path.join(root, 'scripts/build-runtime-assets.mjs');
  execFileSync(process.execPath, [buildScript, 'web-preview'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BOARDFISH_BUILD_READABLE: '1' },
  });
  builtReadableWebPreviewBundle = readCurrentWebPreviewBundle();

  // Leave dist-web in its normal minified production form after the audit.
  execFileSync(process.execPath, [buildScript, 'web-preview'], {
    cwd: root,
    encoding: 'utf8',
  });
  builtWebPreviewBundle = readCurrentWebPreviewBundle();
  return builtReadableWebPreviewBundle;
}

function frozenStringArray(source, name) {
  const match = source.match(new RegExp(`const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `${name} is missing from the production compiler`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function listSourceFiles(dir) {
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relativePath));
    } else if (/\.(js|mjs|json|yml|md)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

test('web debug tools are controlled by the web dev flag', () => {
  const startupDebugSource = readSource('src/js/startup_debug.js');
  const webDevSource = readSource('src/js/main.web.dev.mjs');
  const webEnvSource = readSource('src/js/web_env.js');

  assert.doesNotMatch(startupDebugSource, /AGENTS: Flip only this flag/);
  assert.doesNotMatch(startupDebugSource, /\bconst DEBUG_TOOLS_ENABLED = (true|false);/);
  assert.match(startupDebugSource, /\bconst DEBUG_TOOLS_ENABLED = globalThis\.__BOARDFISH_DEBUG_TOOLS_ENABLED__ === true;/);
  assert.match(startupDebugSource, /var StartupDebug = DEBUG_TOOLS_ENABLED \?/);
  assert.match(startupDebugSource, /createNoopStartupDebug\(\)/);
  assert.match(
    webDevSource,
    /const \[webEnvScript, \.\.\.remainingScripts\] = WEB_DEV_SCRIPTS;[\s\S]*await loadScripts\(\[webEnvScript\]\);[\s\S]*setDefaultDebugFlag\(globalThis\.__BOARDFISH_WEB_DEV_MODE__ === true\);[\s\S]*await loadScripts\(remainingScripts\);/,
  );
  assert.match(webEnvSource, /'__BOARDFISH_WEB_DEV_MODE__'/);
  assert.match(webEnvSource, /value: false/);
});

test('release sources do not contain enabled debugger switches', () => {
  const files = [
    ...listSourceFiles('src'),
    ...listSourceFiles('scripts'),
    ...listSourceFiles('.github'),
    'package.json',
  ];

  for (const file of files) {
    const source = readSource(file);
    assert.doesNotMatch(source, /\bDEBUG_TOOLS_ENABLED\s*=\s*true\b/, `${file} enables debug tools`);
    assert.doesNotMatch(source, /\bdebugger\s*;/, `${file} contains a debugger statement`);
  }
});

test('web manifests preserve developer diagnostics and exclude them from release', () => {
  const webDevScripts = manifestScripts('WEB_DEV_SCRIPTS');
  const webPreviewScripts = manifestScripts('WEB_PREVIEW_SCRIPTS');
  const diagnosticScripts = webDevScripts.filter((script) => WEB_DEV_DIAGNOSTIC_SCRIPTS.includes(script));

  assert.equal(webDevScripts[0], 'web_env.js', 'developer mode bootstrap must load before diagnostics');
  assert.equal(webPreviewScripts[0], 'web_env.js', 'service worker bootstrap must load in release');
  assert.deepEqual(diagnosticScripts, WEB_DEV_DIAGNOSTIC_SCRIPTS);
  for (const script of WEB_DEV_DIAGNOSTIC_SCRIPTS) {
    assert.equal(fs.existsSync(path.join(root, 'src/js', script)), true, `${script} is missing`);
    assert.equal(webPreviewScripts.includes(script), false, `${script} ships in the release manifest`);
  }
  assert.equal(webPreviewScripts.includes('runtime_debug_noop.js'), false);
  assert.deepEqual(
    webDevScripts.filter((script) => !WEB_DEV_DIAGNOSTIC_SCRIPTS.includes(script)),
    webPreviewScripts,
    'developer and release manifests must use the same shared runtime scripts in the same order',
  );
});

test('web release preview strips developer diagnostics from the emitted artifact', { timeout: 120_000 }, () => {
  const bundle = buildAndReadWebPreviewBundle();
  const readableBundle = buildAndReadReadableWebPreviewBundle();
  const buildSource = readSource('scripts/build-runtime-assets.mjs');
  const diagnosticApis = frozenStringArray(buildSource, 'DIAGNOSTIC_APIS');
  const diagnosticCalls = frozenStringArray(buildSource, 'DIAGNOSTIC_CALLS');

  assert.equal(bundle.toLowerCase().includes('debug'), false, 'release bundle still contains developer diagnostic code or data');
  const survivingApis = diagnosticApis.filter((api) => new RegExp(`\\b${api}\\b`).test(readableBundle));
  assert.deepEqual(survivingApis, [], `release bundle still contains diagnostic APIs: ${survivingApis.join(', ')}`);
  const diagnosticHelpers = [...new Set([...diagnosticCalls, ...RELEASE_FORBIDDEN_DIAGNOSTIC_HELPERS])];
  const survivingHelpers = diagnosticHelpers.filter((helper) => new RegExp(`\\b${helper}\\b`).test(readableBundle));
  assert.deepEqual(survivingHelpers, [], `release bundle still contains diagnostic helpers: ${survivingHelpers.join(', ')}`);
  for (const marker of RELEASE_FORBIDDEN_DIAGNOSTIC_MARKERS) {
    assert.equal(readableBundle.includes(marker), false, `release bundle still contains diagnostic marker ${marker}`);
  }
  for (const field of RELEASE_FORBIDDEN_DIAGNOSTIC_METADATA) {
    assert.equal(readableBundle.includes(field), false, `release bundle still contains diagnostic metadata ${field}`);
  }
  assert.equal(readableBundle.includes('BOARDFISH_DEV_DIAGNOSTICS'), false, 'release bundle still contains diagnostic build markers');
  assert.equal(readableBundle.includes('__BOARDFISH_DROP_DIAGNOSTIC_'), false, 'release bundle still contains its diagnostic drop sentinel');
});

test('web release preview preserves operational console warnings and errors', { timeout: 120_000 }, () => {
  const bundle = buildAndReadWebPreviewBundle();

  for (const [method, message] of RELEASE_OPERATIONAL_CONSOLE_MESSAGES) {
    const messageOffset = bundle.indexOf(message);
    const consoleOffset = bundle.lastIndexOf(`console.${method}(`, messageOffset);
    assert.notEqual(messageOffset, -1, `release bundle lost operational ${method} message: ${message}`);
    assert.ok(
      consoleOffset >= 0 && messageOffset - consoleOffset < 256,
      `release bundle no longer emits operational ${method} message: ${message}`,
    );
  }
});

test('web release preview keeps dirty-state history helpers used by board commands', { timeout: 120_000 }, () => {
  const readableBundle = buildAndReadReadableWebPreviewBundle();

  assert.match(
    readableBundle,
    /function historyEntryObjects\(entry\) \{\s*return Array\.isArray\(entry\?\.objects\) \? entry\.objects : \[\];\s*\}/,
    'release bundle dropped historyEntryObjects even though dirty tracking uses it',
  );
  assert.match(
    readableBundle,
    /isDefaultEmptyBoardState\(historyEntryObjects\(boardHistory\[savedHistoryIndex\]\)\)/,
    'release dirty tracking no longer reads the saved history entry safely',
  );
});

test('web release preview ships minified PWA assets', () => {
  const manifestSource = readSource('src/js/startup_manifest.mjs');
  const buildSource = readSource('scripts/build-runtime-assets.mjs');
  const serverSource = readSource('scripts/serve-web.mjs');
  const workflowSource = readSource('.github/workflows/web.yml');
  const packageJson = readJson('package.json');

  assert.doesNotMatch(manifestSource, /WEB_PREVIEW_SCRIPTS[\s\S]*'runtime_debug_noop\.js'/);
  assert.doesNotMatch(
    manifestSource.match(/export const WEB_PREVIEW_SCRIPTS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '',
    /'debug(?:_|\.|')|'startup_debug\.js'|'viewport_debug_ui\.js'/,
  );
  assert.match(buildSource, /'web-preview'[\s\S]*scripts: WEB_PREVIEW_SCRIPTS,[\s\S]*bundle: 'assets\/boardfish-web-preview\.min\.js'/);
  assert.match(buildSource, /const bundle = cacheBustedBundlePath\(config\.bundle, result\.code\);/);
  assert.doesNotMatch(buildSource, /cacheBust:/);
  assert.match(buildSource, /copyFile\(path\.join\(srcRoot, 'manifest\.webmanifest'\)/);
  assert.match(buildSource, /writeServiceWorker\(config\.outDir, \[bundle\]\)/);
  assert.match(serverSource, /devMode \? 'src' : 'dist-web'/);
  assert.match(workflowSource, /npm run web:build/);
  assert.match(workflowSource, /path: dist-web/);
  assert.equal(packageJson.scripts.web, 'npm run web:preview');
  assert.equal(packageJson.scripts.build, 'npm run web:build');
  assert.equal(packageJson.scripts.check, 'npm run check:js-syntax && npm test && npm run check:static');
});
