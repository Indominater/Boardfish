'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────
function requireAppElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing required DOM element #${id}`);
  return element;
}

var canvas      = requireAppElement('canvas');
var boardCanvas = requireAppElement('board-canvas');
var ctx         = boardCanvas.getContext('2d');
if (!ctx) throw new Error('board canvas 2D context is unavailable');
var ctxMenu     = requireAppElement('ctx-menu');
var ctxActions  = document.getElementById('ctx-actions');
var darkModeMenuBtn = requireAppElement('ctx-btn-dark-mode');
var fileInput   = requireAppElement('file-input');
var selOverlay  = requireAppElement('sel-overlay');
var multiSelOverlay = requireAppElement('multi-sel-overlay');
var island       = requireAppElement('island');
var islZoom        = requireAppElement('isl-zoom');
var openingShield  = requireAppElement('opening-shield');
var objCtxMenu  = requireAppElement('obj-ctx-menu');
var textCtxMenu = requireAppElement('text-ctx-menu');
var copyBtn           = requireAppElement('obj-btn-copy');
var moveToBackBtn     = requireAppElement('obj-btn-move-to-back');
var deleteBtn         = requireAppElement('obj-btn-delete');
var saveImageBtn      = requireAppElement('obj-btn-save-image');
var saveImagesBtn     = requireAppElement('obj-btn-save-images');
var exportSep         = requireAppElement('obj-sep-export');
var imageActionsSep   = requireAppElement('obj-sep-image-actions');
var layerActionsSep   = requireAppElement('obj-sep-layer-actions');
var deleteSep         = requireAppElement('obj-sep-delete');
var sortImagesBtn     = requireAppElement('obj-btn-sort-images');
var flipBtn           = requireAppElement('obj-btn-flip');
var rotateBtn         = requireAppElement('obj-btn-rotate');
var rubberBand       = requireAppElement('rubber-band');
var addTextBtn       = requireAppElement('btn-add-text');
var addImageBtn      = requireAppElement('btn-add-image');
var textCopyBtn      = requireAppElement('text-btn-copy');
var textPasteBtn     = requireAppElement('text-btn-paste');
var textDeleteBtn    = requireAppElement('text-btn-delete');
var textDeleteSep    = requireAppElement('text-sep-delete');
var dialogOverlay    = document.getElementById('dialog-overlay');
var unsavedDialog    = document.getElementById('dialog');
var IS_MAC = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
var COMMAND_KEY_LABEL = IS_MAC ? '\u2318' : 'Ctrl';
var SHIFT_KEY_LABEL = IS_MAC ? '\u21e7' : 'Shift';
var MENU_VIEWPORT_EDGE_MARGIN = 12;
var MENU_SHORTCUTS = {
  'new-board': ['N'],
  'add-text': ['T'],
  'add-images': [COMMAND_KEY_LABEL, 'I'],
  paste: [COMMAND_KEY_LABEL, 'V'],
  save: [COMMAND_KEY_LABEL, 'S'],
  'save-as': IS_MAC ? [SHIFT_KEY_LABEL, COMMAND_KEY_LABEL, 'S'] : [COMMAND_KEY_LABEL, SHIFT_KEY_LABEL, 'S'],
  open: [COMMAND_KEY_LABEL, 'O'],
  copy: [COMMAND_KEY_LABEL, 'C'],
  duplicate: [COMMAND_KEY_LABEL, 'D'],
  'move-to-back': [COMMAND_KEY_LABEL, '['],
  'flip-image': [COMMAND_KEY_LABEL, 'F'],
  'rotate-image': [COMMAND_KEY_LABEL, 'R'],
  'export-image': [COMMAND_KEY_LABEL, 'E'],
  'export-images': [COMMAND_KEY_LABEL, 'E'],
  delete: ['Delete'],
};

function formatShortcut(keys) {
  return IS_MAC ? keys.join('') : keys.join('+');
}

function syncPlatformShortcutLabels() {
  for (const item of document.querySelectorAll('[data-shortcut]')) {
    const keys = MENU_SHORTCUTS[item.dataset.shortcut];
    item.textContent = keys ? formatShortcut(keys) : '';
  }
}
syncPlatformShortcutLabels();
var appThemeMeta = document.querySelector('meta[name="theme-color"]');
var DEFAULT_APP_THEME = 'dark';
var appTheme = DEFAULT_APP_THEME;
var APP_THEME_STORAGE_KEY = 'bf_app_theme';
var _canvasThemeColorCache = {
  '--canvas-bg': '#d6d8da',
  '--canvas-text': '#15141A',
  '--selection-highlight': 'rgba(10, 132, 255, 0.3)',
};

/* BOARDFISH_DEV_DIAGNOSTICS_START */
// StartupDebug is initialized by js/startup_debug.js.
function logStartupStep(step, detail = {}) {
  StartupDebug.record(step, detail);
  if (!DEBUG_TOOLS_ENABLED) return;
  try {
    console.info('[Boardfish startup]', step, detail);
  } catch (_) {}
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function normalizeAppTheme(value, fallback = DEFAULT_APP_THEME) {
  const theme = String(value || '').toLowerCase();
  if (theme === 'dark' || theme === 'light') return theme;
  return fallback;
}

function loadStoredAppTheme() {
  try {
    return normalizeAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch (_) {
    return DEFAULT_APP_THEME;
  }
}

function storeAppTheme() {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
  } catch (_) {}
}

function repaintBoardForThemeChange() {
  if (typeof invalidateOffscreen === 'function') invalidateOffscreen();
  if (typeof scheduleRender === 'function') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      scheduleRender(true, false, 'theme-change');
      return 'scheduled-board';
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    scheduleRender(true, false);
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return 'deferred-unavailable';
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
}

function applyAppTheme(theme, {
  dirty = false,
  render = true,
} = {}) {
  const nextTheme = normalizeAppTheme(theme);
  const changed = appTheme !== nextTheme;
  appTheme = nextTheme;
  document.body.dataset.theme = appTheme;
  if (appThemeMeta) appThemeMeta.setAttribute('content', appTheme === 'dark' ? '#1c1b22' : '#eaeaed');
  _canvasThemeColorCache['--canvas-bg'] = appTheme === 'dark' ? '#1c1b22' : 'rgb(234, 234, 237)';
  _canvasThemeColorCache['--canvas-text'] = appTheme === 'dark' ? '#fbfbfe' : '#15141A';
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStartupStep('body-theme-applied', StartupDebug.sample('body-theme-applied'));
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (render && (changed || dirty)) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const repaintMode = repaintBoardForThemeChange();
      logStartupStep('theme-canvas-repaint', { theme: appTheme, mode: repaintMode });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      repaintBoardForThemeChange();
    }
  }
  if (dirty) storeAppTheme();
}

function toggleAppTheme() {
  applyAppTheme(appTheme === 'dark' ? 'light' : 'dark', {
    dirty: true,
  });
}

const startupTheme = loadStoredAppTheme();
/* BOARDFISH_DEV_DIAGNOSTICS_START */
logStartupStep('theme-bootstrap', { theme: startupTheme });
/* BOARDFISH_DEV_DIAGNOSTICS_END */
applyAppTheme(startupTheme, { render: false });

function canvasTextColor() {
  return _canvasThemeColorCache['--canvas-text'];
}

function canvasSelectionHighlightColor() {
  return _canvasThemeColorCache['--selection-highlight'];
}

function fillBoardBackground(context, width, height) {
  context.fillStyle = _canvasThemeColorCache['--canvas-bg'];
  context.fillRect(0, 0, width, height);
}
