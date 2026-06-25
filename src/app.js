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
var APP_THEMES = {
  light: {
    webThemeColor: '#eaeaed',
  },
  dark: {
    webThemeColor: '#1c1b22',
  },
};
var DEFAULT_APP_THEME = 'dark';
var appTheme = DEFAULT_APP_THEME;
var APP_THEME_STORAGE_KEY = 'bf_app_theme';
var CANVAS_THEME_COLOR_FALLBACKS = {
  '--canvas-bg': '#d6d8da',
  '--canvas-text': '#15141A',
  '--selection-highlight': 'rgba(10, 132, 255, 0.3)',
};
var _canvasThemeColorCache = { ...CANVAS_THEME_COLOR_FALLBACKS };

// StartupDebug is initialized by js/startup_debug.js.


function logStartupStep(step, detail = {}) {
  StartupDebug.record(step, detail);
  if (!DEBUG_TOOLS_ENABLED) return;
  try {
    console.info('[Boardfish startup]', step, detail);
  } catch (_) {}
}

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

const syncWebAppThemeColor = (theme = appTheme) => {
  const nextTheme = normalizeAppTheme(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', APP_THEMES[nextTheme].webThemeColor);
};

function readCssVarFromStyle(style, name) {
  return style?.getPropertyValue?.(name)?.trim?.() || '';
}

function refreshCanvasThemeColorCache() {
  const style = getComputedStyle(document.body);
  _canvasThemeColorCache = {
    '--canvas-bg': readCssVarFromStyle(style, '--canvas-bg') || CANVAS_THEME_COLOR_FALLBACKS['--canvas-bg'],
    '--canvas-text': readCssVarFromStyle(style, '--canvas-text') || CANVAS_THEME_COLOR_FALLBACKS['--canvas-text'],
    '--selection-highlight': readCssVarFromStyle(style, '--selection-highlight') || CANVAS_THEME_COLOR_FALLBACKS['--selection-highlight'],
  };
}

function cachedCanvasCssVar(name) {
  return _canvasThemeColorCache?.[name] || '';
}

function repaintBoardForThemeChange() {
  if (typeof invalidateOffscreen === 'function') {
    invalidateOffscreen();
  }

  const boardIsOpening = typeof _boardOpening !== 'undefined' && _boardOpening;
  if (!boardIsOpening && typeof drawBoard === 'function') {
    if (typeof withRenderSource === 'function') {
      withRenderSource('theme-change-sync', drawBoard);
    } else {
      drawBoard();
    }
    return 'sync-board';
  }

  if (typeof scheduleRender === 'function') {
    scheduleRender(true, false, 'theme-change');
    return 'scheduled-board';
  }

  return 'deferred-unavailable';
}

function applyAppTheme(theme, {
  dirty = false,
  render = true,
} = {}) {
  const nextTheme = normalizeAppTheme(theme);
  const changed = appTheme !== nextTheme;
  appTheme = nextTheme;
  document.body.dataset.theme = appTheme;
  syncWebAppThemeColor(appTheme);
  refreshCanvasThemeColorCache();
  logStartupStep('body-theme-applied', StartupDebug.sample('body-theme-applied'));
  if (render && (changed || dirty)) {
    logStartupStep('theme-canvas-repaint', { theme: appTheme, mode: repaintBoardForThemeChange() });
  }
  if (dirty) storeAppTheme();
  return Promise.resolve();
}

function toggleAppTheme() {
  return applyAppTheme(appTheme === 'dark' ? 'light' : 'dark', {
    dirty: true,
  });
}

const startupTheme = loadStoredAppTheme();
logStartupStep('theme-bootstrap', { theme: startupTheme });
applyAppTheme(startupTheme, { render: false });

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function boardBg() {
  return cachedCanvasCssVar('--canvas-bg') || cssVar('--canvas-bg') || CANVAS_THEME_COLOR_FALLBACKS['--canvas-bg'];
}

function canvasTextColor() {
  return cachedCanvasCssVar('--canvas-text') || cssVar('--canvas-text') || CANVAS_THEME_COLOR_FALLBACKS['--canvas-text'];
}

function canvasSelectionHighlightColor() {
  return cachedCanvasCssVar('--selection-highlight') || cssVar('--selection-highlight') || CANVAS_THEME_COLOR_FALLBACKS['--selection-highlight'];
}

function fillBoardBackground(context, width, height) {
  context.fillStyle = boardBg();
  context.fillRect(0, 0, width, height);
}
