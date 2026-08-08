'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────
var canvas      = BoardfishDOM.canvas;
var boardCanvas = BoardfishDOM.boardCanvas;
var ctx         = BoardfishDOM.ctx;
var ctxMenu     = BoardfishDOM.ctxMenu;
var ctxActions  = document.getElementById('ctx-actions');
var darkModeMenuBtn = BoardfishDOM.darkModeMenuBtn;
var fileInput   = BoardfishDOM.fileInput;
var selOverlay  = BoardfishDOM.selOverlay;
var multiSelOverlay = BoardfishDOM.multiSelOverlay;
var island       = BoardfishDOM.island;
var islZoom        = BoardfishDOM.islZoom;
var openingShield  = BoardfishDOM.openingShield;
var objCtxMenu  = BoardfishDOM.objCtxMenu;
var copyBtn           = BoardfishDOM.copyBtn;
var moveToBackBtn     = BoardfishDOM.moveToBackBtn;
var deleteBtn         = BoardfishDOM.deleteBtn;
var saveImageBtn      = BoardfishDOM.saveImageBtn;
var saveImagesBtn     = BoardfishDOM.saveImagesBtn;
var exportSep         = BoardfishDOM.exportSep;
var imageActionsSep   = BoardfishDOM.imageActionsSep;
var layerActionsSep   = BoardfishDOM.layerActionsSep;
var deleteSep         = BoardfishDOM.deleteSep;
var flipBtn           = BoardfishDOM.flipBtn;
var rotateBtn         = BoardfishDOM.rotateBtn;
var rubberBand       = BoardfishDOM.rubberBand;
var addTextBtn       = BoardfishDOM.addTextBtn;
var addImageBtn      = BoardfishDOM.addImageBtn;
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

function refreshCanvasThemeColorCache() {
  const style = getComputedStyle(document.body);
  _canvasThemeColorCache['--canvas-bg'] = style.getPropertyValue('--canvas-bg').trim() || '#d6d8da';
  _canvasThemeColorCache['--canvas-text'] = style.getPropertyValue('--canvas-text').trim() || '#15141A';
  _canvasThemeColorCache['--selection-highlight'] = style.getPropertyValue('--selection-highlight').trim() || 'rgba(10, 132, 255, 0.3)';
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
  refreshCanvasThemeColorCache();
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
