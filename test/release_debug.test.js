'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readSource(relativePath));
}

function listSourceFiles(dir) {
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['gen', 'target'].includes(entry.name)) continue;
      files.push(...listSourceFiles(relativePath));
    } else if (/\.(js|mjs|rs|json)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

test('debug tools derive from Cargo build mode instead of a manual source flag', () => {
  const startupDebugSource = readSource('src/js/startup_debug.js');
  const contextMenuSource = readSource('src/js/context_menu.js');
  const mainSource = readSource('src-tauri/src/main.rs');
  const buildSource = readSource('src-tauri/build.rs');
  const syncScript = readSource('scripts/sync-debug-tools.mjs');

  assert.doesNotMatch(startupDebugSource, /AGENTS: Flip only this flag/);
  assert.doesNotMatch(startupDebugSource, /\bconst DEBUG_TOOLS_ENABLED = (true|false);/);
  assert.match(startupDebugSource, /Tauri injects this from the Cargo build profile/);
  assert.match(startupDebugSource, /\bconst DEBUG_TOOLS_ENABLED = globalThis\.__BOARDFISH_DEBUG_TOOLS_ENABLED__ === true;/);
  assert.match(startupDebugSource, /var StartupDebug = DEBUG_TOOLS_ENABLED \?/);
  assert.match(startupDebugSource, /createNoopStartupDebug\(\)/);
  assert.match(contextMenuSource, /if \(DEBUG_TOOLS_ENABLED\) \{\s*for \(const type of \[/);
  assert.match(mainSource, /option_env!\("BOARDFISH_DEBUG_TOOLS_ENABLED"\) == Some\("true"\)/);
  assert.match(mainSource, /append_invoke_initialization_script\(debug_tools_initialization_script\(\)\)/);
  assert.match(mainSource, /Object\.defineProperty\(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__'/);
  assert.match(buildSource, /env::var\("PROFILE"\)\.is_ok_and\(\|profile\| profile == "debug"\)/);
  assert.match(buildSource, /cargo:rustc-env=BOARDFISH_DEBUG_TOOLS_ENABLED=\{debug_tools_enabled\}/);
  assert.match(buildSource, /capabilities_path_pattern\(GENERATED_CAPABILITY_GLOB\)/);
  assert.match(buildSource, /target\/generated-capabilities\/default\.json/);
  assert.doesNotMatch(syncScript, /startup_debug\.js/);
});

test('checked-in release capability denies internal devtools toggles', () => {
  const capability = readJson('src-tauri/capabilities/default.json');
  const permissions = capability.permissions || [];

  assert.ok(!permissions.includes('core:default'), 'core:default includes broad debug-capable webview permissions');
  assert.ok(!permissions.includes('core:webview:default'), 'webview default permissions include internal devtools toggles');
  assert.ok(permissions.includes('core:webview:deny-internal-toggle-devtools'));
  assert.ok(!permissions.includes('core:webview:allow-internal-toggle-devtools'));
});

test('release sources do not contain enabled debugger switches', () => {
  const files = [
    ...listSourceFiles('src'),
    ...listSourceFiles('src-tauri/src'),
    'src-tauri/build.rs',
    'src-tauri/capabilities/default.json',
    'src-tauri/tauri.conf.json',
    'scripts/sync-debug-tools.mjs',
  ];

  for (const file of files) {
    const source = readSource(file);
    assert.doesNotMatch(source, /\bDEBUG_TOOLS_ENABLED\s*=\s*true\b/, `${file} enables debug tools`);
    assert.doesNotMatch(source, /\bdebugger\s*;/, `${file} contains a debugger statement`);
    assert.doesNotMatch(source, /\bopen_devtools\s*\(/, `${file} opens devtools`);
    assert.doesNotMatch(source, /\btoggle_devtools\s*\(/, `${file} toggles devtools`);
  }
});
