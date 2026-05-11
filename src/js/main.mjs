'use strict';

import './dom_registry.js';
import './tauri_bridge.js';
import './web_board_container.js';
import './web_limits.js';
import './web_runtime.js';
import './window_titlebar.js';
import './bitmap_cache.js';
import './image_transform.js';
import './object_geometry.js';
import './interaction_utils.js';
import './board_types.js';
import './debug_core.js';
import './renderer.js';
import './board_schema.js';
import './board_document.js';
import './eyedropper_color.js';
import './eyedropper_geometry.js';

const shouldEnableWebDebugTools = () => {
  if (Object.prototype.hasOwnProperty.call(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__')) return null;
  if (globalThis.__TAURI__) return false;
  const params = new URLSearchParams(globalThis.location?.search || '');
  const host = String(globalThis.location?.hostname || '').toLowerCase();
  const localHost = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  const stored = globalThis.localStorage?.getItem?.('bf_debug_tools') === 'true';
  return localHost || stored || params.get('debug') === '1' || params.get('debug') === 'true';
};

const webDebugToolsEnabled = shouldEnableWebDebugTools();
if (webDebugToolsEnabled != null) {
  Object.defineProperty(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__', {
    value: webDebugToolsEnabled,
    writable: false,
    configurable: false,
  });
}

const LEGACY_CONTROLLER_SCRIPTS = [
  'startup_debug.js',
  '../app.js',
  'geometry.js',
  'clipboard_state.js',
  'debug.js',
  'debug_save.js',
  'debug_open.js',
  'debug_export.js',
  'debug_manual_perf.js',
  'debug_insert.js',
  'debug_export_all_diag.js',
  'debug_text_selection.js',
  'clipboard_io.js',
  'export_utils.js',
  'text_layout.js',
  'image_variants.js',
  'viewport_debug_ui.js',
  'viewport.js',
  'viewport_state.js',
  'state.js',
  'image_state.js',
  'image_store_boundary.js',
  'editor_state_boundary.js',
  'history_state.js',
  'selection_input.js',
  'text_editor.js',
  'object_commands.js',
  'eyedropper_debug.js',
  'eyedropper_state.js',
  'eyedropper.js',
  'eyedropper_decode_warmers.js',
  'canvas_input.js',
  'context_menu.js',
  'image_insert.js',
  'io_close.js',
  'window_recovery.js',
  'image_export.js',
  'text_export.js',
  'clipboard_export_init.js',
  'keyboard.js',
  'app_bootstrap.js',
];

function loadLegacyScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.body.appendChild(script);
  });
}

for (const src of LEGACY_CONTROLLER_SCRIPTS) {
  await loadLegacyScript(new URL(src, import.meta.url).href);
}
