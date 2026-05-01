'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────
var canvas      = document.getElementById('canvas');
var boardCanvas = document.getElementById('board-canvas');
var ctx         = boardCanvas.getContext('2d');
var ctxMenu     = document.getElementById('ctx-menu');
var fileInput   = document.getElementById('file-input');
var selOverlay  = document.getElementById('sel-overlay');
var multiSelOverlay = document.getElementById('multi-sel-overlay');
var islZoom        = document.getElementById('isl-zoom');
var islMeasure     = document.getElementById('isl-measure');
var openingShield  = document.getElementById('opening-shield');
var objCtxMenu  = document.getElementById('obj-ctx-menu');
var copyBtn           = document.getElementById('obj-btn-copy');
var saveImageBtn      = document.getElementById('obj-btn-save-image');
var saveImagesBtn     = document.getElementById('obj-btn-save-images');
var exportSep         = document.getElementById('obj-sep-export');
var imageActionsSep   = document.getElementById('obj-sep-image-actions');
var flipHorizontalBtn = document.getElementById('obj-btn-flip-horizontal');
var flipVerticalBtn   = document.getElementById('obj-btn-flip-vertical');
var rotateBtn         = document.getElementById('obj-btn-rotate');
var rubberBand       = document.getElementById('rubber-band');
var exportAllImageBtn = document.getElementById('btn-export-all-images');
var exportAllTextBtn  = document.getElementById('btn-export-all-text');
var exportAllSep      = document.getElementById('ctx-sep-export-all');
var IS_WIN = /Win/.test(navigator.platform) || /Win/.test(navigator.userAgent);
var IS_MAC = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
if (IS_MAC) document.body.classList.add('is-macos');
var TRANSPARENT_TEXT_COLOR = 'rgba(255,255,255,0)';
var DEBUG_TOOLS_ENABLED = (() => {
  try {
    const params = new URLSearchParams(window.location?.search || '');
    return localStorage.getItem('bf_debug_tools') === '1' || params.get('bf_debug_tools') === '1';
  } catch (_) {
    return false;
  }
})();

function exposeDebug(tools) {
  if (!DEBUG_TOOLS_ENABLED) return;
  window.BoardfishDebug = Object.assign(window.BoardfishDebug || {}, tools);
}

function hasTauri() {
  return !!window.__TAURI__;
}

function tauriInvoke(command, args = {}) {
  if (!hasTauri()) throw new Error('Tauri is unavailable');
  return window.__TAURI__.core.invoke(command, args);
}

function setNativeDebug(command, enabled) {
  if (!hasTauri()) return;
  tauriInvoke(command, { enabled }).catch(() => {});
}

function round2(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
}

function sanitizeDebugMeta(value, { redactPattern = /dataUrl|src|base64/i, roundNumbers = false } = {}) {
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (redactPattern && redactPattern.test(key) && typeof item === 'string') {
      out[`${key}Len`] = item.length;
      const comma = item.indexOf(',');
      out.mime = comma > 0 ? item.slice(0, comma) : item.slice(0, 48);
    } else {
      out[key] = roundNumbers ? round2(item) : item;
    }
  }
  return out;
}

function createDebugRecorder({
  maxEvents = 300,
  label = 'Boardfish',
  sanitize = (value) => value,
  verboseDefault = false,
  onEnable = null,
  onDisable = null,
} = {}) {
  let enabled = false;
  let verbose = verboseDefault;
  let nextOpId = 1;
  const events = [];
  const round = (value) => Math.round((value || 0) * 100) / 100;

  function push(evt) {
    if (!enabled) return;
    const entry = { at: round(performance.now()), ...evt };
    events.push(entry);
    if (events.length > maxEvents) events.shift();
    if (verbose) console.debug(label, entry);
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    if (options.verbose === true) setVerbose(true);
    if (onEnable) onEnable(options);
  }

  function disable() {
    enabled = false;
    if (onDisable) onDisable();
  }

  function setVerbose(value) {
    verbose = !!value;
    console.info(`${label} verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', total: 0, dt: 0, meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    push({ id: ctx.id, op: ctx.op, step: stepName, total: round(now - ctx.t0), dt: round(now - ctx.last), meta: sanitize(meta) });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    push({ id: ctx.id, op: ctx.op, step: 'end', total: round(now - ctx.t0), dt: round(now - ctx.last), meta: sanitize(meta) });
  }

  function reset() {
    events.length = 0;
    nextOpId = 1;
  }

  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    reset,
    push,
    get enabled() { return enabled; },
    get events() { return events.slice(); },
    _events: events,
  };
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function boardBg() {
  return cssVar('--canvas-bg') || '#d6d8da';
}

function canvasTextColor() {
  return cssVar('--canvas-text') || '#111418';
}

function islandTextColor() {
  return cssVar('--firefox-menu-text') || '#f7f7fb';
}

function islandStatusTextColor() {
  return cssVar('--firefox-menu-text') || '#f7f7fb';
}

function fillBoardBackground(context, width, height) {
  context.fillStyle = boardBg();
  context.fillRect(0, 0, width, height);
}
