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
var IS_WIN = /Win/.test(navigator.platform) || /Win/.test(navigator.userAgent);
var IS_MAC = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
if (IS_MAC && typeof hasTauri === 'function' && hasTauri()) document.body.classList.add('is-macos');
var COMMAND_KEY_LABEL = IS_MAC ? '\u2318' : 'Ctrl';
var SHIFT_KEY_LABEL = IS_MAC ? '\u21e7' : 'Shift';
var MENU_VIEWPORT_EDGE_MARGIN = 12;
var MENU_SHORTCUTS = {
  'new-board': [COMMAND_KEY_LABEL, 'N'],
  'add-text': ['T'],
  'add-images': [COMMAND_KEY_LABEL, 'I'],
  paste: [COMMAND_KEY_LABEL, 'V'],
  save: [COMMAND_KEY_LABEL, 'S'],
  'save-as': IS_MAC ? [SHIFT_KEY_LABEL, COMMAND_KEY_LABEL, 'S'] : [COMMAND_KEY_LABEL, SHIFT_KEY_LABEL, 'S'],
  open: [COMMAND_KEY_LABEL, 'O'],
  copy: [COMMAND_KEY_LABEL, 'C'],
  cut: [COMMAND_KEY_LABEL, 'X'],
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
    native: 'Light',
    webThemeColor: '#eaeaed',
  },
  dark: {
    native: 'Dark',
    webThemeColor: '#1c1b22',
  },
};
var appTheme = 'light';
var APP_THEME_STORAGE_KEY = 'bf_app_theme';

// StartupDebug is initialized by js/startup_debug.js.


function logStartupStep(step, detail = {}) {
  StartupDebug.record(step, detail);
  if (!DEBUG_TOOLS_ENABLED) return;
  try {
    console.info('[Boardfish startup]', step, detail);
  } catch (_) {}
}

function logStartupError(step, error) {
  StartupDebug.record(step, { error: String(error) });
  if (!DEBUG_TOOLS_ENABLED) return;
  try {
    console.error('[Boardfish startup]', step, error);
  } catch (_) {}
}

function normalizeAppTheme(value) {
  return String(value || '').toLowerCase() === 'dark' ? 'dark' : 'light';
}

function loadStoredAppTheme() {
  try {
    return normalizeAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch (_) {
    return 'light';
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

function applyNativeAppTheme(theme = appTheme) {
  if (!hasTauri()) return Promise.resolve();
  const nextTheme = normalizeAppTheme(theme);
  const nativeTheme = APP_THEMES[nextTheme].native;
  logStartupStep('apply-native-theme:start', { theme: nextTheme, nativeTheme });
  return BoardfishTauri.setAppTheme(nativeTheme)
    .then((native) => logStartupStep('apply-native-theme:done', {
      theme: nextTheme,
      nativeTheme: native?.theme || nativeTheme,
      nativeColor: native?.color || '',
      nativeMs: native?.ms ?? '',
    }))
    .catch((err) => {
      logStartupError('apply-native-theme:failed', err);
    });
}

function showAppWindow() {
  if (!hasTauri()) return Promise.resolve();
  logStartupStep('show-window:start', { theme: appTheme });
  return BoardfishTauri.showAppWindow()
    .then(() => logStartupStep('show-window:done', { theme: appTheme }))
    .catch((err) => {
      logStartupError('show-window:failed', err);
    });
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

async function waitForNativeThemeSettle({ frames = 0, ms = 0, theme = appTheme } = {}) {
  if (frames <= 0 && ms <= 0) return;
  const start = performance.now();
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  for (let frame = 0; frame < frames; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  logStartupStep('native-theme-settle', {
    theme,
    frames,
    ms,
    actualMs: Math.round((performance.now() - start) * 100) / 100,
  });
}

function applyAppTheme(theme, {
  dirty = false,
  native = true,
  render = true,
  nativeFirst = false,
  nativeParallel = false,
  nativeParallelDomMs = 0,
  nativeSettleFrames = 0,
  nativeSettleMs = 0,
} = {}) {
  const nextTheme = normalizeAppTheme(theme);
  const applyDomTheme = () => {
    const changed = appTheme !== nextTheme;
    appTheme = nextTheme;
    document.body.dataset.theme = appTheme;
    syncWebAppThemeColor(appTheme);
    logStartupStep('body-theme-applied', StartupDebug.sample('body-theme-applied'));
    if (render && (changed || dirty)) {
      logStartupStep('theme-canvas-repaint', { theme: appTheme, mode: repaintBoardForThemeChange() });
    }
    if (dirty) {
      storeAppTheme();
    }
  };

  if (native && nativeParallel) {
    const nativePromise = applyNativeAppTheme(nextTheme);
    return waitForNativeThemeSettle({
      ms: nativeParallelDomMs,
      theme: nextTheme,
    })
      .then(applyDomTheme)
      .then(() => nativePromise);
  }

  if (native && nativeFirst) {
    return applyNativeAppTheme(nextTheme)
      .then(() => waitForNativeThemeSettle({
        frames: nativeSettleFrames,
        ms: nativeSettleMs,
        theme: nextTheme,
      }))
      .then(applyDomTheme);
  }

  applyDomTheme();
  return native ? applyNativeAppTheme(nextTheme) : Promise.resolve();
}

function toggleAppTheme() {
  return applyAppTheme(appTheme === 'dark' ? 'light' : 'dark', {
    dirty: true,
    native: true,
  });
}

const startupTheme = loadStoredAppTheme();
logStartupStep('theme-bootstrap', { theme: startupTheme, hasTauri: hasTauri() });
applyAppTheme(startupTheme, { render: false }).finally(showAppWindow);

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function boardBg() {
  return cssVar('--canvas-bg') || '#d6d8da';
}

function canvasTextColor() {
  return cssVar('--canvas-text') || '#15141A';
}

function fillBoardBackground(context, width, height) {
  context.fillStyle = boardBg();
  context.fillRect(0, 0, width, height);
}
