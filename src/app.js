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
var ctxActions  = requireAppElement('ctx-actions');
var darkModeMenuBtn = requireAppElement('ctx-btn-dark-mode');
var fileInput   = requireAppElement('file-input');
var selOverlay  = requireAppElement('sel-overlay');
var multiSelOverlay = requireAppElement('multi-sel-overlay');
var island       = requireAppElement('island');
var islZoom        = requireAppElement('isl-zoom');
var openingShield  = requireAppElement('opening-shield');
var objCtxMenu  = requireAppElement('obj-ctx-menu');
var textCtxMenu = requireAppElement('text-ctx-menu');
var saveImageBtn      = requireAppElement('obj-btn-save-image');
var saveImagesBtn     = requireAppElement('obj-btn-save-images');
var exportSep         = requireAppElement('obj-sep-export');
var objectActionsSep  = requireAppElement('obj-sep-object-actions');
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
var MENU_VIEWPORT_EDGE_MARGIN = 12;
if (/Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent)) {
  for (const item of document.querySelectorAll('[data-mac-shortcut]')) item.textContent = item.dataset.macShortcut;
}
var appThemeMeta = document.querySelector('meta[name="theme-color"]');
var DEFAULT_APP_THEME = 'dark';
var appTheme = DEFAULT_APP_THEME;
var APP_THEME_STORAGE_KEY = 'bf_app_theme';
var _canvasBackgroundColor;
var _canvasTextColor;

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
  const previousTextColor = _canvasTextColor;
  appTheme = nextTheme;
  document.body.dataset.theme = appTheme;
  if (appThemeMeta) appThemeMeta.setAttribute('content', appTheme === 'dark' ? '#1c1b22' : '#eaeaed');
  _canvasBackgroundColor = appTheme === 'dark' ? '#1c1b22' : 'rgb(234, 234, 237)';
  _canvasTextColor = appTheme === 'dark' ? '#fbfbfe' : '#15141A';
  if (previousTextColor !== _canvasTextColor && typeof clearTextRasterCache === 'function') {
    clearTextRasterCache();
  }
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
  return _canvasTextColor;
}

function fillBoardBackground(context, width, height) {
  context.fillStyle = _canvasBackgroundColor;
  context.fillRect(0, 0, width, height);
}
