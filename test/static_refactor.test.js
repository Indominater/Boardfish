'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function frontendSources() {
  return [
    'src/app.js',
    ...fs.readdirSync(path.join(root, 'src', 'js'))
      .filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))
      .map((name) => `src/js/${name}`),
  ];
}

function tauriCommandValues() {
  const bridgeSource = readSource('src/js/tauri_bridge.js');
  const catalogMatch = bridgeSource.match(/var TAURI_COMMANDS = Object\.freeze\(\{([\s\S]*?)\n\s*\}\);/);
  assert.ok(catalogMatch, 'TAURI_COMMANDS catalog is missing');
  return [...catalogMatch[1].matchAll(/:\s*'([^']+)'/g)].map((match) => match[1]);
}

function registeredRustCommands() {
  const mainSource = readSource('src-tauri/src/main.rs');
  const handlerMatch = mainSource.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
  assert.ok(handlerMatch, 'Tauri generate_handler list is missing');
  return [...handlerMatch[1].matchAll(/\b([a-z][a-z0-9_]*)\b/g)]
    .map((match) => match[1])
    .filter((name) => !['tauri', 'generate_handler'].includes(name));
}

function lineCount(relativePath) {
  return readSource(relativePath).split('\n').length;
}

function scriptOrder() {
  const indexSource = readSource('src/index.html');
  assert.match(indexSource, /<script type="module" src="js\/main\.mjs"><\/script>/);
  const mainSource = readSource('src/js/main.mjs');
  const moduleImports = [...mainSource.matchAll(/^import '\.\/([^']+)';$/gm)].map((item) => item[1]);
  const legacyMatch = mainSource.match(/const LEGACY_CONTROLLER_SCRIPTS = \[([\s\S]*?)\];/);
  assert.ok(legacyMatch, 'LEGACY_CONTROLLER_SCRIPTS is missing');
  const legacyScripts = [...legacyMatch[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  return [...moduleImports, ...legacyScripts];
}

function boardContract() {
  return JSON.parse(readSource('src/shared/board_contract.json'));
}

test('release startup debugger is gated before initialization', () => {
  const startupDebugSource = readSource('src/js/startup_debug.js');
  const order = scriptOrder();
  const gateIndex = startupDebugSource.indexOf('const DEBUG_TOOLS_ENABLED = globalThis.__BOARDFISH_DEBUG_TOOLS_ENABLED__ === true;');
  const startupIndex = startupDebugSource.indexOf('var StartupDebug = DEBUG_TOOLS_ENABLED ?');
  const noopIndex = startupDebugSource.indexOf('function createNoopStartupDebug()');

  assert.ok(gateIndex >= 0, 'debug build-mode gate is missing');
  assert.ok(noopIndex > gateIndex, 'noop startup debugger should be declared after the gate');
  assert.ok(startupIndex > noopIndex, 'StartupDebug should use the noop gate');
  assert.match(startupDebugSource, /Tauri injects this from the Cargo build profile/);
  assert.doesNotMatch(startupDebugSource, /AGENTS: Flip only this flag/);
  assert.ok(order.indexOf('startup_debug.js') < order.indexOf('../app.js'), 'startup debug must load before app startup code');
});

test('frontend invokes Tauri through the shared wrapper and command catalog', () => {
  for (const relativePath of frontendSources()) {
    const source = readSource(relativePath);
    const directInvokeMatches = [...source.matchAll(/(?:window|root)\.__TAURI__\.core\.invoke/g)];
    if (relativePath === 'src/js/tauri_bridge.js') {
      assert.equal(directInvokeMatches.length, 1, `${relativePath} should only invoke Tauri inside tauriInvoke`);
      assert.match(source, /function tauriInvoke\(command, args = \{\}\)/);
      continue;
    }
    assert.equal(directInvokeMatches.length, 0, `${relativePath} should not call core.invoke directly`);
  }
});

test('frontend Tauri event and asset URL access stay behind the shared bridge', () => {
  for (const relativePath of frontendSources()) {
    const source = readSource(relativePath);
    if (relativePath === 'src/js/tauri_bridge.js') {
      assert.match(source, /function tauriListen\(eventName, handler\)/);
      assert.match(source, /function tauriConvertFileSrc\(path\)/);
      continue;
    }
    assert.doesNotMatch(source, /\bwindow\.__TAURI__\b/, `${relativePath} should not access window.__TAURI__ directly`);
    assert.doesNotMatch(source, /\bwindow\.__TAURI_INTERNALS__\b/, `${relativePath} should not access window.__TAURI_INTERNALS__ directly`);
  }
});

test('frontend command catalog covers every Rust command', () => {
  const catalog = new Set(tauriCommandValues());
  const rustCommands = registeredRustCommands();

  for (const command of rustCommands) {
    assert.ok(catalog.has(command), `TAURI_COMMANDS is missing ${command}`);
  }

  for (const command of catalog) {
    assert.ok(rustCommands.includes(command), `${command} is not a registered Rust command`);
  }
});

test('Tauri call sites use command catalog constants', () => {
  for (const relativePath of frontendSources()) {
    const source = readSource(relativePath);
    assert.doesNotMatch(source, /tauriInvoke\('[^']+'/);
    assert.doesNotMatch(source, /Debug\.invoke\([^,]+, '[^']+'/);
  }
});

test('frontend feature code uses typed Tauri facade instead of raw invoke', () => {
  const rawInvokeAllowed = new Set([
    'src/js/debug.js',
    'src/js/debug_export.js',
    'src/js/debug_export_all_diag.js',
    'src/js/debug_open.js',
    'src/js/debug_save.js',
    'src/js/tauri_bridge.js',
  ]);
  for (const relativePath of frontendSources()) {
    if (rawInvokeAllowed.has(relativePath)) continue;
    const source = readSource(relativePath);
    assert.doesNotMatch(source, /\btauriInvoke\(/, `${relativePath} should use BoardfishTauri or a debug wrapper`);
  }
  assert.match(readSource('src/js/tauri_bridge.js'), /var BoardfishTauri = Object\.freeze/);
  assert.match(readSource('src/js/io_close.js'), /BoardfishTauri\.saveBoard/);
  assert.match(readSource('src/js/image_insert.js'), /BoardfishTauri\.registerImageFileSource/);
});

test('typed Tauri facade covers feature command groups', () => {
  const bridge = readSource('src/js/tauri_bridge.js');
  for (const method of [
    'clipboardSequence',
    'copyImageDataUrlToClipboardTransformed',
    'copyTextToClipboard',
    'pickFolder',
    'readImageFromClipboardCached',
    'readTextFromClipboard',
    'registerTransformedImageSource',
    'saveImageFileDialog',
    'saveImagesToExistingFolderByKeys',
    'saveTextFileDialog',
    'writeImageFileByKey',
    'writeTextFile',
  ]) {
    assert.match(bridge, new RegExp(`\\b${method}\\(`), `BoardfishTauri is missing ${method}`);
  }
});

test('frontend abstraction scripts load before their consumers', () => {
  const order = scriptOrder();
  const before = (a, b) => assert.ok(order.indexOf(a) >= 0 && order.indexOf(a) < order.indexOf(b), `${a} must load before ${b}`);

  before('dom_registry.js', '../app.js');
  before('tauri_bridge.js', '../app.js');
  before('bitmap_cache.js', 'image_variants.js');
  before('bitmap_cache.js', 'eyedropper.js');
  before('clipboard_state.js', 'clipboard_io.js');
  before('clipboard_io.js', 'clipboard_export_init.js');
  before('clipboard_io.js', 'eyedropper.js');
  before('clipboard_state.js', 'debug.js');
  before('debug_core.js', 'debug.js');
  before('debug.js', 'debug_save.js');
  before('debug.js', 'debug_open.js');
  before('debug.js', 'debug_export.js');
  before('debug.js', 'debug_export_all_diag.js');
  before('debug.js', 'debug_manual_perf.js');
  before('debug.js', 'debug_insert.js');
  before('debug.js', 'debug_text_selection.js');
  before('debug_core.js', 'eyedropper_debug.js');
  before('clipboard_state.js', 'clipboard_export_init.js');
  before('export_utils.js', 'clipboard_export_init.js');
  before('export_utils.js', 'image_export.js');
  before('image_export.js', 'clipboard_export_init.js');
  before('text_export.js', 'clipboard_export_init.js');
  before('io_close.js', 'app_bootstrap.js');
  before('clipboard_export_init.js', 'app_bootstrap.js');
  before('keyboard.js', 'app_bootstrap.js');
  before('export_utils.js', 'io_close.js');
  before('startup_debug.js', '../app.js');
  before('image_transform.js', '../app.js');
  before('object_geometry.js', 'viewport.js');
  before('object_geometry.js', 'eyedropper_geometry.js');
  before('interaction_utils.js', 'selection_input.js');
  before('interaction_utils.js', 'canvas_input.js');
  before('board_types.js', 'board_schema.js');
  before('board_types.js', 'board_document.js');
  before('renderer.js', 'viewport.js');
  before('viewport_debug_ui.js', 'viewport.js');
  before('viewport_state.js', 'editor_state_boundary.js');
  before('image_store_boundary.js', 'editor_state_boundary.js');
  before('eyedropper_debug.js', 'eyedropper.js');
  before('editor_state_boundary.js', 'history_state.js');
  before('board_schema.js', 'board_document.js');
  before('board_document.js', 'io_close.js');
  before('eyedropper_color.js', 'eyedropper_debug.js');
  before('eyedropper_color.js', 'eyedropper.js');
  before('eyedropper_geometry.js', 'eyedropper_debug.js');
  before('eyedropper_geometry.js', 'eyedropper.js');
  before('eyedropper_debug.js', 'eyedropper_state.js');
  before('eyedropper_state.js', 'eyedropper.js');
  before('eyedropper.js', 'eyedropper_card_previews.js');
  before('eyedropper_card_previews.js', 'io_close.js');
  before('eyedropper.js', 'eyedropper_decode_warmers.js');
  before('eyedropper_decode_warmers.js', 'canvas_input.js');
});

test('large frontend units stay split behind explicit boundary files', () => {
  assert.ok(lineCount('src/app.js') < 700, 'app.js should stay below the startup/orchestration split ceiling');
  assert.ok(lineCount('src/js/viewport.js') < 900, 'viewport.js should keep debug UI split out');
  assert.ok(lineCount('src/js/eyedropper.js') < 2700, 'eyedropper.js should keep diagnostics split out');
  assert.match(readSource('src/js/startup_debug.js'), /exposeDebug\(\{ startup: StartupDebug \}\)/);
  assert.match(readSource('src/js/viewport_debug_ui.js'), /exposeDebug\(\{ pill: PillDebug \}\)/);
  assert.match(readSource('src/js/eyedropper_debug.js'), /exposeDebug\(\{ eyedropper: EyedropperDebug \}\)/);
});

test('shared abstractions own DOM lookup, Tauri invoke, rendering helpers, bitmap LRU, and editor state access', () => {
  assert.match(readSource('src/js/dom_registry.js'), /function createDomRegistry\(\)/);
  assert.match(readSource('src/app.js'), /var canvas\s+= BoardfishDOM\.canvas;/);
  assert.match(readSource('src/js/interaction_utils.js'), /BoardfishInteraction/);
  assert.doesNotMatch(readSource('src/app.js'), /^function createRafCommitter/gm);
  assert.doesNotMatch(readSource('src/app.js'), /^function beginDocumentDrag/gm);
  assert.match(readSource('src/js/tauri_bridge.js'), /function tauriInvoke\(command, args = \{\}\)/);
  assert.match(readSource('src/js/tauri_bridge.js'), /function tauriListen\(eventName, handler\)/);
  assert.match(readSource('src/js/tauri_bridge.js'), /function tauriConvertFileSrc\(path\)/);
  assert.match(readSource('src/js/debug_core.js'), /BoardfishDebugCore/);
  assert.match(readSource('src/js/startup_debug.js'), /async function beginDebug\(spec = \{\}\)/);
  assert.match(readSource('src/js/startup_debug.js'), /async function finishDebug\(spec = \{\}\)/);
  assert.match(readSource('src/js/app_bootstrap.js'), /registerDebugCommand\('openFilePath', openFilePath\)/);
  assert.doesNotMatch(readSource('src/app.js'), /^function createDebugRecorder/gm);
  assert.doesNotMatch(readSource('src/app.js'), /^async function mapWithConcurrency/gm);
  assert.match(readSource('src/js/debug_save.js'), /var SaveDebug = \(\(\) =>/);
  assert.match(readSource('src/js/debug_open.js'), /var OpenDebug = \(\(\) =>/);
  assert.match(readSource('src/js/debug_export.js'), /var ExportDebug = \(\(\) =>/);
  assert.match(readSource('src/js/debug_export_all_diag.js'), /var ExportAllDiag = \(\(\) =>/);
  assert.match(readSource('src/js/debug_manual_perf.js'), /var ManualPerfDebug = \(\(\) =>/);
  assert.match(readSource('src/js/debug_insert.js'), /var InsertDebug = \(\(\) =>/);
  assert.match(readSource('src/js/debug_text_selection.js'), /var TextSelDebug = \(\(\) =>/);
  assert.doesNotMatch(readSource('src/js/debug.js'), /^var SaveDebug/gm);
  assert.doesNotMatch(readSource('src/js/debug.js'), /^var OpenDebug/gm);
  assert.doesNotMatch(readSource('src/js/debug.js'), /^var ExportDebug/gm);
  assert.doesNotMatch(readSource('src/js/debug.js'), /^var ExportAllDiag/gm);
  assert.doesNotMatch(readSource('src/js/debug.js'), /^var ManualPerfDebug/gm);
  assert.doesNotMatch(readSource('src/js/debug.js'), /^var InsertDebug/gm);
  assert.doesNotMatch(readSource('src/js/debug.js'), /^var TextSelDebug/gm);
  assert.match(readSource('src/js/image_transform.js'), /function imageTransformFromObject\(obj\)/);
  assert.doesNotMatch(readSource('src/app.js'), /function imageTransformFromObject\(obj\)/);
  assert.match(readSource('src/js/board_types.js'), /BoardfishBoardTypes/);
  assert.match(readSource('src/js/board_schema.js'), /BoardfishBoardTypes/);
  assert.match(readSource('src/js/board_document.js'), /BoardfishBoardTypes/);
  assert.match(readSource('src/js/renderer.js'), /function createBoardRenderer\(deps\)/);
  assert.match(readSource('src/js/viewport.js'), /BoardfishRenderer\.createBoardRenderer/);
  assert.match(readSource('src/js/bitmap_cache.js'), /function createGroupedLruCache/);
  assert.match(readSource('src/js/image_variants.js'), /BoardfishBitmapCache\.createGroupedLruCache/);
  assert.match(readSource('src/js/eyedropper_state.js'), /BoardfishBitmapCache\.createGroupedLruCache/);
  assert.match(readSource('src/js/clipboard_io.js'), /BoardfishClipboardIO/);
  assert.match(readSource('src/js/clipboard_export_init.js'), /BoardfishClipboardIO\.readClipboardImageDataUrlFromEvent/);
  assert.doesNotMatch(readSource('src/js/clipboard_export_init.js'), /^function readClipboardImageDataUrlFromEvent/gm);
  assert.match(readSource('src/js/export_utils.js'), /BoardfishExportUtils/);
  assert.match(readSource('src/js/image_export.js'), /BoardfishExportUtils\.createProgressUpdater/);
  assert.doesNotMatch(readSource('src/js/clipboard_export_init.js'), /^async function saveSelectedImage/gm);
  assert.doesNotMatch(readSource('src/js/clipboard_export_init.js'), /^async function exportAllText/gm);
  assert.doesNotMatch(readSource('src/js/clipboard_export_init.js'), /^function createExportProgressUpdater/gm);
  assert.match(readSource('src/js/app_bootstrap.js'), /async function openFilePath\(filePath\)/);
  assert.doesNotMatch(readSource('src/js/clipboard_export_init.js'), /^async function openFilePath/gm);
  assert.match(readSource('src/js/eyedropper_color.js'), /BoardfishEyedropperColor/);
  assert.doesNotMatch(readSource('src/js/eyedropper.js'), /^function rgbaToHex/gm);
  assert.doesNotMatch(readSource('src/js/eyedropper.js'), /^function parseCssColor/gm);
  assert.match(readSource('src/js/object_geometry.js'), /function createObjectGeometry\(deps\)/);
  assert.match(readSource('src/js/viewport.js'), /BoardfishObjectGeometry\.createObjectGeometry/);
  assert.match(readSource('src/js/viewport.js'), /BoardObjectGeometry\.topObjectAtWorldPoint/);
  assert.match(readSource('src/js/eyedropper_geometry.js'), /function createEyedropperGeometry\(deps\)/);
  assert.match(readSource('src/js/eyedropper_state.js'), /var eyedropperSafeImageCache = new Map\(\)/);
  assert.match(readSource('src/js/eyedropper.js'), /BoardfishEyedropperGeometry\.createEyedropperGeometry/);
  assert.doesNotMatch(readSource('src/js/eyedropper.js'), /^var eyedropperSafeImageCache/gm);
  assert.match(readSource('src/js/eyedropper.js'), /globalThis\.clientToBoardWorldPoint = EyedropperGeometry\.clientToBoardWorldPoint/);
  assert.doesNotMatch(readSource('src/js/eyedropper.js'), /^function clientToBoardWorldPoint/gm);
  assert.doesNotMatch(readSource('src/js/viewport.js'), /wx >= obj\.x && wx <= obj\.x \+ obj\.w/);
  assert.doesNotMatch(readSource('src/js/eyedropper.js'), /const dx = worldPoint\.x - \(obj\.x \+ obj\.w \/ 2\)/);
  assert.match(readSource('src/js/editor_state_boundary.js'), /BoardfishEditorState/);
  assert.match(readSource('src/js/viewport_state.js'), /BoardfishViewportState/);
  assert.match(readSource('src/js/image_store_boundary.js'), /BoardfishImageStore/);
  assert.match(readSource('src/js/editor_state_boundary.js'), /function addObject/);
  assert.match(readSource('src/js/editor_state_boundary.js'), /function commitMutation/);
  assert.match(readSource('src/js/state.js'), /BoardfishEditorState\.commitMutation/);
  assert.match(readSource('src/js/editor_state_boundary.js'), /function removeSelectedObjects/);
  assert.match(readSource('src/js/image_insert.js'), /BoardfishEditorState\.addObject/);
  assert.match(readSource('src/js/clipboard_state.js'), /function jsClipboardStillCurrent/);
  assert.doesNotMatch(readSource('src/js/clipboard_export_init.js'), /^var _nativeClipboardWriteQueue/gm);
  assert.match(readSource('src/js/editor_state_boundary.js'), /function replaceBoardObjects/);
  assert.match(readSource('src/js/io_close.js'), /BoardfishEditorState\.replaceBoardObjects/);
  assert.match(readSource('src/js/object_commands.js'), /BoardfishEditorState\.resetBoardObjectState/);
  assert.match(readSource('src/js/board_document.js'), /BoardfishBoardDocument/);
  assert.match(readSource('src/js/io_close.js'), /BoardfishBoardDocument\.createBoardDataForSave/);
});

test('large clipboard paste diagnostics are available through beginDebug finishDebug', () => {
  const debugSource = readSource('src/js/debug.js');
  const clipboardIoSource = readSource('src/js/clipboard_io.js');
  const pasteSource = readSource('src/js/clipboard_export_init.js');
  const insertSource = readSource('src/js/image_insert.js');
  const imageStateSource = readSource('src/js/image_state.js');

  assert.match(debugSource, /function largePasteReport\(\)/);
  assert.match(debugSource, /largePasteReport,/);
  assert.match(debugSource, /failedCheckpoint/);
  assert.match(clipboardIoSource, /function readClipboardBlobAsDataUrlDebug/);
  assert.match(clipboardIoSource, /clipboard-blob-read:start/);
  assert.match(clipboardIoSource, /clipboard-blob-read:ok/);
  assert.match(clipboardIoSource, /clipboard-blob-read:error/);
  assert.match(clipboardIoSource, /event-clipboard:inspect/);
  assert.match(pasteSource, /objectCountBefore: objects\.length/);
  assert.match(insertSource, /objectCountBefore,\s*\n\s*objectCountAfter: objects\.length/);
  assert.match(insertSource, /cacheImage\(imgKey, imageAssetUrlCache\[imgKey\], dbg, null, \{ skipSourceRegistration: true \}\)/);
  assert.match(insertSource, /NATIVE_DATA_URL_IMAGE_CACHE_THRESHOLD/);
  assert.match(insertSource, /function shouldUseNativeDataUrlImageCache\(src\)/);
  assert.match(insertSource, /addDataUrlImageViaNativeCache\(src, cx, cy, exactSize, existingImgKey, options\)/);
  assert.match(insertSource, /BoardfishTauri\.registerImageSource\(imgKey, src, sourceToken\)/);
  assert.match(insertSource, /materializeImageAssets\(\[imgKey\], dbg\)/);
  assert.match(imageStateSource, /function imageSourceDebugInfo\(src\)/);
  assert.match(imageStateSource, /convertTauriFileSrc received data URL/);
  assert.match(imageStateSource, /return path;\s*\}\s*return tauriConvertFileSrc\(path\);/);
  assert.match(imageStateSource, /materialize-image-assets:entry/);
  assert.match(imageStateSource, /cache-image:source/);
  assert.match(debugSource, /sourceKind/);
});

test('shared board contract matches frontend schema constants', () => {
  const contract = boardContract();
  const boardTypes = readSource('src/js/board_types.js');
  const indexSource = readSource('src/index.html');
  const embeddedMatch = indexSource.match(/<script type="application\/json" id="boardfish-board-contract">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(embeddedMatch, 'index.html is missing the embedded board contract');
  assert.deepEqual(JSON.parse(embeddedMatch[1]), contract);

  assert.match(boardTypes, /const BOARD_CONTRACT = Object\.freeze\(loadBoardContract\(\)\)/);
  assert.match(boardTypes, /const BOARD_FORMAT = BOARD_CONTRACT\.format/);
  assert.match(boardTypes, /const BOARD_VERSION_LEGACY = BOARD_CONTRACT\.versions\.legacy/);
  assert.match(boardTypes, /const BOARD_VERSION_CONTAINER = BOARD_CONTRACT\.versions\.container/);
  assert.match(boardTypes, /IMAGE: BOARD_CONTRACT\.objectTypes\[0\]/);
  assert.match(boardTypes, /TEXT: BOARD_CONTRACT\.objectTypes\[1\]/);
  assert.match(boardTypes, /MIN_ZOOM: BOARD_CONTRACT\.viewport\.minZoom/);
  assert.match(boardTypes, /MAX_ZOOM: BOARD_CONTRACT\.viewport\.maxZoom/);
});

test('viewport and image-store mutations stay behind boundary modules', () => {
  const viewportMutationAllowed = new Set([
    'src/js/debug.js',
    'src/js/viewport.js',
    'src/js/viewport_state.js',
  ]);
  const imageStoreMutationAllowed = new Set([
    'src/js/image_state.js',
    'src/js/image_store_boundary.js',
  ]);

  for (const relativePath of frontendSources()) {
    const source = readSource(relativePath);
    if (!viewportMutationAllowed.has(relativePath)) {
      assert.doesNotMatch(source, /\bpanX\s=/, `${relativePath} should not assign panX directly`);
      assert.doesNotMatch(source, /\bpanY\s=/, `${relativePath} should not assign panY directly`);
      if (relativePath !== 'src/js/board_types.js') {
        assert.doesNotMatch(source, /\bzoom\s=/, `${relativePath} should not assign zoom directly`);
      }
    }
    if (!imageStoreMutationAllowed.has(relativePath)) {
      assert.doesNotMatch(source, /\bimageStore\[[^\]]+\]\s=(?!=)/, `${relativePath} should not assign imageStore entries directly`);
      assert.doesNotMatch(source, /Object\.assign\(imageStore/, `${relativePath} should not bulk-assign imageStore directly`);
    }
  }
});

test('legacy frontend global surface has an explicit abstraction budget', () => {
  const source = frontendSources()
    .map((relativePath) => readSource(relativePath))
    .join('\n');
  const topLevelVars = [...source.matchAll(/^var /gm)].length;
  const topLevelFunctions = [...source.matchAll(/^function /gm)].length;

  assert.ok(topLevelVars <= 281, `top-level var budget exceeded: ${topLevelVars}`);
  assert.ok(topLevelFunctions <= 384, `top-level function budget exceeded: ${topLevelFunctions}`);
});

test('Rust image source responsibilities stay split', () => {
  const imageSources = readSource('src-tauri/src/image_sources.rs');

  assert.match(readSource('src-tauri/src/main.rs'), /mod image_data_url;/);
  assert.match(readSource('src-tauri/src/main.rs'), /mod image_source_cache;/);
  assert.match(readSource('src-tauri/src/main.rs'), /mod image_source_files;/);
  assert.match(readSource('src-tauri/src/main.rs'), /mod image_transform;/);
  assert.match(readSource('src-tauri/src/image_source_cache.rs'), /DECODED_IMAGE_CACHE_MAX_BYTES/);
  assert.match(readSource('src-tauri/src/image_source_cache.rs'), /source_token: Option<String>/);
  assert.match(readSource('src-tauri/src/image_source_cache.rs'), /fn prune_decoded_cache_locked/);
  assert.match(imageSources, /use crate::image_source_files::/);
  assert.match(imageSources, /use crate::image_data_url::cached_source_from_data_url;/);
  assert.match(imageSources, /use crate::image_transform::transform_dynamic_image;/);
  assert.match(imageSources, /struct ImageSourceResponse \{[\s\S]*width: u32,[\s\S]*height: u32,/);
  assert.match(imageSources, /fn image_dimensions_from_bytes\(bytes: &\[u8\]\)/);
  assert.match(imageSources, /register_image_source[\s\S]*image_dimensions_from_bytes\(&source\.bytes\)/);
  assert.ok(lineCount('src-tauri/src/image_sources.rs') < 680, 'image_sources.rs should keep filesystem helper responsibilities split out');
  assert.ok(lineCount('src-tauri/src/image_source_cache.rs') < 340, 'image_source_cache.rs should stay focused on native cache state');
  assert.ok(lineCount('src-tauri/src/image_source_files.rs') < 220, 'image_source_files.rs should stay focused on temp-file lifecycle helpers');
});

test('Rust app lifecycle responsibilities stay out of main', () => {
  assert.match(readSource('src-tauri/src/main.rs'), /mod app_lifecycle;/);
  assert.match(readSource('src-tauri/src/main.rs'), /\.on_window_event\(handle_window_event\)/);
  assert.match(readSource('src-tauri/src/main.rs'), /\.run\(handle_run_event\)/);
  assert.match(readSource('src-tauri/src/app_lifecycle.rs'), /pub\(crate\) fn handle_window_event/);
  assert.match(readSource('src-tauri/src/app_lifecycle.rs'), /pub\(crate\) fn handle_run_event/);
  assert.ok(lineCount('src-tauri/src/main.rs') < 180, 'main.rs should stay as composition root');
});
