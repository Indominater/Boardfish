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

test('web release preview keeps debug tools off on localhost', () => {
  const webDevSource = readSource('src/js/main.web.dev.mjs');
  const manifestSource = readSource('src/js/startup_manifest.mjs');
  const buildSource = readSource('scripts/build-runtime-assets.mjs');
  const webEnvSource = readSource('src/js/web_env.js');
  const serverSource = readSource('scripts/serve-web.mjs');
  const workflowSource = readSource('.github/workflows/web.yml');
  const packageJson = readJson('package.json');

  assert.match(webDevSource, /loadScripts\(\['web_env\.js'\]\)/);
  assert.match(webDevSource, /setDefaultDebugFlag\(globalThis\.__BOARDFISH_WEB_DEV_MODE__ === true\)/);
  assert.doesNotMatch(webDevSource, /bf_debug_tools/);
  assert.doesNotMatch(webDevSource, /params\.get\('debug'\)/);
  assert.doesNotMatch(webDevSource, /localHost \|\|/);

  assert.match(manifestSource, /WEB_PREVIEW_SCRIPTS[\s\S]*'runtime_debug_noop\.js'/);
  assert.doesNotMatch(
    manifestSource.match(/export const WEB_PREVIEW_SCRIPTS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '',
    /'debug(?:_|\.|')|'startup_debug\.js'|'viewport_debug_ui\.js'|'eyedropper_debug\.js'/,
  );
  assert.match(buildSource, /'web-preview'[\s\S]*bundle: 'assets\/boardfish-web-preview\.min\.js'[\s\S]*cacheBust: true/);
  assert.match(buildSource, /import \{ createHash \} from 'node:crypto';/);
  assert.match(buildSource, /function cacheBustedBundlePath\(bundle, code\)/);
  assert.match(buildSource, /createHash\('sha256'\)\.update\(code\)\.digest\('hex'\)\.slice\(0, 12\)/);
  assert.match(buildSource, /const bundle = config\.cacheBust \? cacheBustedBundlePath\(config\.bundle, result\.code\) : config\.bundle;/);
  assert.match(
    buildSource,
    /writeIndex\(config\.outDir, `<script src="\$\{bundle\}"><\/script>`, \{\s*includePwa: variantName === 'web-preview',\s*\}\)/,
  );

  assert.match(webEnvSource, /'__BOARDFISH_WEB_DEV_MODE__'/);
  assert.match(webEnvSource, /value: false/);

  assert.match(serverSource, /const devMode = args\.has\('--dev'\);/);
  assert.match(serverSource, /devMode \? 'src' : 'dist-web'/);
  assert.match(serverSource, /devMode \? 5173 : 4173/);
  assert.match(serverSource, /value: \$\{devMode \? 'true' : 'false'\}/);

  assert.match(workflowSource, /npm run web:build/);
  assert.match(workflowSource, /path: dist-web/);

  assert.equal(packageJson.scripts.web, 'npm run web:preview');
  assert.equal(packageJson.scripts['web:preview'], 'npm run web:build && node scripts/serve-web.mjs --preview');
  assert.equal(packageJson.scripts['web:dev'], 'node scripts/serve-web.mjs --dev');
  assert.equal(packageJson.scripts['web:build'], 'node scripts/build-runtime-assets.mjs web-preview');
});

test('release no-op debug shim covers web preview runtime hooks', () => {
  const noopSource = readSource('src/js/runtime_debug_noop.js');
  const manifestSource = readSource('src/js/startup_manifest.mjs');
  const previewScripts = [
    ...(manifestSource.match(/export const WEB_PREVIEW_SCRIPTS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '')
      .matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);
  const runtimeSource = previewScripts
    .map((script) => readSource(path.join('src/js', script)))
    .join('\n');
  const baseDebugApi = noopSource.match(/const createNoopDebugApi[\s\S]*?return \{([\s\S]*?)\s+\.\.\.extra,/)[1];
  const baseHooks = new Set([
    ...[...baseDebugApi.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)].map((match) => match[1]),
    ...[...baseDebugApi.matchAll(/\bget\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((match) => match[1]),
  ]);
  const debugCalls = [
    ...runtimeSource.matchAll(/\b([A-Za-z][A-Za-z0-9]*Debug)\.([A-Za-z_$][A-Za-z0-9_$]*)/g),
  ].map((match) => ({ api: match[1], hook: match[2] }));

  const apiHooks = (api) => {
    const hooks = new Set();
    if (new RegExp(`const ${api} = createNoopDebugApi\\(`).test(noopSource)) {
      for (const hook of baseHooks) hooks.add(hook);
    }
    const createMatch = noopSource.match(new RegExp(`const ${api} = createNoopDebugApi\\(\\{([\\s\\S]*?)\\}\\);`));
    const objectMatch = noopSource.match(new RegExp(`const ${api} = \\{([\\s\\S]*?)\\n\\};`));
    const body = createMatch?.[1] || objectMatch?.[1] || '';
    for (const match of body.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)) hooks.add(match[1]);
    for (const match of body.matchAll(/\bget\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) hooks.add(match[1]);
    return hooks;
  };

  const missing = debugCalls.filter(({ api, hook }) => !apiHooks(api).has(hook));
  assert.deepEqual(
    missing,
    [],
    `runtime_debug_noop.js is missing release hooks: ${
      missing.map(({ api, hook }) => `${api}.${hook}`).join(', ')
    }`,
  );
});
