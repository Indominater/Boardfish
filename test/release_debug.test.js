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
  assert.match(webDevSource, /setDefaultDebugFlag\(globalThis\.__BOARDFISH_WEB_DEV_MODE__ === true\)/);
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

test('web release preview keeps debug tools off and ships PWA assets', () => {
  const manifestSource = readSource('src/js/startup_manifest.mjs');
  const buildSource = readSource('scripts/build-runtime-assets.mjs');
  const serverSource = readSource('scripts/serve-web.mjs');
  const workflowSource = readSource('.github/workflows/web.yml');
  const packageJson = readJson('package.json');

  assert.match(manifestSource, /WEB_PREVIEW_SCRIPTS[\s\S]*'runtime_debug_noop\.js'/);
  assert.doesNotMatch(
    manifestSource.match(/export const WEB_PREVIEW_SCRIPTS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '',
    /'debug(?:_|\.|')|'startup_debug\.js'|'viewport_debug_ui\.js'/,
  );
  assert.match(buildSource, /'web-preview'[\s\S]*scripts: WEB_PREVIEW_SCRIPTS,[\s\S]*bundle: 'assets\/boardfish-web-preview\.min\.js'/);
  assert.match(buildSource, /const bundle = cacheBustedBundlePath\(config\.bundle, result\.code\);/);
  assert.doesNotMatch(buildSource, /cacheBust:/);
  assert.match(buildSource, /includePwa: variantName === 'web-preview'/);
  assert.match(serverSource, /devMode \? 'src' : 'dist-web'/);
  assert.match(workflowSource, /npm run web:build/);
  assert.match(workflowSource, /path: dist-web/);
  assert.equal(packageJson.scripts.web, 'npm run web:preview');
  assert.equal(packageJson.scripts.build, 'npm run web:build');
  assert.equal(packageJson.scripts.check, 'npm run check:js-syntax && npm test && npm run check:static');
});
