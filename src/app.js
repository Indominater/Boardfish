'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────

const canvas      = document.getElementById('canvas');
const boardCanvas = document.getElementById('board-canvas');
const ctx         = boardCanvas.getContext('2d');
const ctxMenu     = document.getElementById('ctx-menu');
const fileInput   = document.getElementById('file-input');
const selOverlay  = document.getElementById('sel-overlay');
const multiSelOverlay = document.getElementById('multi-sel-overlay');
const islZoom        = document.getElementById('isl-zoom');
const islMeasure     = document.getElementById('isl-measure');
const openingShield  = document.getElementById('opening-shield');
const objCtxMenu  = document.getElementById('obj-ctx-menu');
const copyBtn           = document.getElementById('obj-btn-copy');
const saveImageBtn      = document.getElementById('obj-btn-save-image');
const saveImagesBtn     = document.getElementById('obj-btn-save-images');
const exportSep         = document.getElementById('obj-sep-export');
const imageActionsSep   = document.getElementById('obj-sep-image-actions');
const flipHorizontalBtn = document.getElementById('obj-btn-flip-horizontal');
const flipVerticalBtn   = document.getElementById('obj-btn-flip-vertical');
const rubberBand       = document.getElementById('rubber-band');
const exportAllImageBtn = document.getElementById('btn-export-all-images');
const exportAllTextBtn  = document.getElementById('btn-export-all-text');
const exportAllSep      = document.getElementById('ctx-sep-export-all');
const IS_WIN = /Win/.test(navigator.platform) || /Win/.test(navigator.userAgent);
const DEBUG_TOOLS_ENABLED = false;

function exposeDebug(tools) {
  if (!DEBUG_TOOLS_ENABLED) return;
  window.BoardfishDebug = Object.assign(window.BoardfishDebug || {}, tools);
}

// ─── Clipboard / image debugger ──────────────────────────────────────────────

const ClipDebug = (() => {

  const MAX_EVENTS = 600;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];

  function sanitize(value) {
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/dataUrl|src|base64/i.test(k) && typeof v === 'string') {
        out[k + 'Len'] = v.length;
        const comma = v.indexOf(',');
        out.mime = comma > 0 ? v.slice(0, comma) : v.slice(0, 48);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish clipboard]', entry);
  }

  function setRustDebug(value) {
    if (!window.__TAURI__) return;
    window.__TAURI__.core.invoke('set_clipboard_debug', { enabled: value }).catch(() => {});
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;

    if (options.verbose === true) setVerbose(true);
    setRustDebug(true);
    console.info('Boardfish clipboard debugger enabled. Events are buffered. Use BoardfishDebug.clipboard.phaseSummary(), .summary(), .dump(), .setVerbose(true), or .reset().');
  }

  function disable() {
    enabled = false;

    setRustDebug(false);
    console.info('Boardfish clipboard debugger disabled.');
  }

  function setVerbose(value) {
    verbose = !!value;
    console.info(`Boardfish clipboard verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    if (!ctx.steps) ctx.steps = {};
    ctx.steps[stepName] = { ms: now - ctx.last, total: now - ctx.t0, meta: sanitize(meta) };
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: Math.round((now - ctx.last) * 100) / 100,
      total: Math.round((now - ctx.t0) * 100) / 100,
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  async function invoke(ctx, command, args = {}, meta = {}) {
    if (!window.__TAURI__) throw new Error('Tauri is unavailable');
    if (!enabled) return window.__TAURI__.core.invoke(command, args);
    const t0 = performance.now();
    step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await window.__TAURI__.core.invoke(command, args);
      step(ctx, 'invoke:ok', { command, ms: Math.round((performance.now() - t0) * 100) / 100 });
      return result;
    } catch (err) {
      step(ctx, 'invoke:error', { command, ms: Math.round((performance.now() - t0) * 100) / 100, error: String(err) });
      throw err;
    }
  }

  function dump() {
    console.table(events);
    return events.slice();
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      id: e.id,
      op: e.op,
      step: e.step,
      dt: e.dt,
      total: e.total,
      command: e.meta?.command || '',
      path: e.meta?.path || '',
      selectedCount: e.meta?.selectedCount ?? '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      imgKey: e.meta?.imgKey || '',
      dataUrlLen: e.meta?.dataUrlLen ?? '',
      blobSize: e.meta?.blobSize ?? '',
      textLen: e.meta?.textLen ?? '',
      seq: e.meta?.seq ?? '',
      expected: e.meta?.expected ?? '',
      current: e.meta?.current ?? '',
      error: e.meta?.error || '',
    }));
    console.table(rows);
    return rows;
  }

  function phaseSummary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      step: e.step,
      total: e.total,
      dt: e.dt,
      command: e.meta?.command || '',
      path: e.meta?.path || '',
      selectedCount: e.meta?.selectedCount ?? '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      imgKey: e.meta?.imgKey || '',
      dataUrlLen: e.meta?.dataUrlLen ?? '',
      blobSize: e.meta?.blobSize ?? '',
      textLen: e.meta?.textLen ?? '',
      seq: e.meta?.seq ?? '',
      expected: e.meta?.expected ?? '',
      current: e.meta?.current ?? '',
      skipped: e.meta?.skipped ?? '',
      error: e.meta?.error || '',
    }));
    console.table(rows);
    return rows;
  }

  function reset() { events.length = 0; }
  const clear = reset;


  return { enable, disable, setVerbose, start, step, end, invoke, dump, summary, phaseSummary, reset, clear, get events() { return events.slice(); } };
})();

exposeDebug({ clipboard: ClipDebug });

// ─── History debugger ───────────────────────────────────────────────────────

const HistoryDebug = (() => {
  const MAX_EVENTS = 500;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];
  const stats = {
    snapshots: 0,
    pushHistory: 0,
    restores: 0,
    undo: 0,
    redo: 0,
    cloneObjectCalls: 0,
    cloneObjectsCalls: 0,
    clonedObjects: 0,
    reusedObjects: 0,
    maxSnapshotMs: 0,
    maxPushHistoryMs: 0,
    maxRestoreMs: 0,
    maxCloneObjectsMs: 0,
  };

  function round(value) {
    return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  }

  function sanitize(value) {
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = round(v);
    return out;
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: round(performance.now()), ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish history]', entry);
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    if (options.verbose === true) setVerbose(true);
    console.info('Boardfish history debugger enabled. Use BoardfishDebug.history.summary(), .dump(), .setVerbose(true), or .reset().');
  }

  function disable() {
    enabled = false;
    console.info('Boardfish history debugger disabled.');
  }

  function setVerbose(value) {
    verbose = !!value;
    console.info(`Boardfish history verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const now = performance.now();
    const ctx = { id: nextOpId++, op, t0: now, last: now };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: round(now - ctx.last),
      total: round(now - ctx.t0),
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  function count(key, amount = 1) {
    if (!enabled) return;
    if (!Object.hasOwn(stats, key)) stats[key] = 0;
    stats[key] += amount;
  }

  function max(key, value) {
    if (!enabled) return;
    if (!Object.hasOwn(stats, key)) stats[key] = 0;
    stats[key] = Math.max(stats[key], value || 0);
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      id: e.id,
      op: e.op,
      step: e.step,
      dt: e.dt,
      total: e.total,
      objectCount: e.meta?.objectCount ?? '',
      historyLength: e.meta?.historyLength ?? '',
      historyIndex: e.meta?.historyIndex ?? '',
      cloned: e.meta?.cloned ?? '',
      reused: e.meta?.reused ?? '',
      dirtyCount: e.meta?.dirtyCount ?? '',
      selectedCount: e.meta?.selectedCount ?? '',
      editState: e.meta?.editState ?? '',
      ms: e.meta?.ms ?? '',
    }));
    console.table(rows);
    return rows;
  }

  function dump() {
    console.table(events);
    return events.slice();
  }

  function reset() {
    events.length = 0;
    for (const key of Object.keys(stats)) stats[key] = 0;
  }

  return { enable, disable, setVerbose, start, step, end, count, max, summary, dump, reset, clear: reset, get events() { return events.slice(); }, get stats() { return { ...stats }; } };
})();

exposeDebug({ history: HistoryDebug });

const ViewportDebug = (() => {
  const MAX_EVENTS = 900;
  const MAX_SLOW_RECORDS = 100;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];
  const slowRecords = [];
  const stats = {
    wheel: 0,
    wheelPan: 0,
    wheelZoom: 0,
    mousePanMoves: 0,
    scheduledFrames: 0,
    coalescedFrames: 0,
    transformFrames: 0,
    boardFrames: 0,
    overlayFrames: 0,
    slowFrames: 0,
    maxFrameMs: 0,
    maxQueueMs: 0,
    lastRafGapMs: 0,
    maxRafGapMs: 0,
    wheelHandlerCount: 0,
    wheelHandlerTotalMs: 0,
    maxWheelHandlerMs: 0,
    mousePanHandlerCount: 0,
    mousePanHandlerTotalMs: 0,
    maxMousePanHandlerMs: 0,
    imageAdds: 0,
    imageLoads: 0,
    imageDecodes: 0,
    imageBitmaps: 0,
    imageBitmapFailures: 0,
    clipboardPrecacheStarts: 0,
    clipboardPrecacheFailures: 0,
    culledImages: 0,
    culledText: 0,
    croppedImages: 0,
    maxImageAddMs: 0,
    maxImageLoadMs: 0,
    maxImageDecodeMs: 0,
    maxImageBitmapMs: 0,
    maxClipboardPrecacheMs: 0,
  };
  let lastRafAt = 0;

  function sanitize(value) {
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/dataUrl|src|base64/i.test(k) && typeof v === 'string') {
        out[k + 'Len'] = v.length;
        const comma = v.indexOf(',');
        out.mime = comma > 0 ? v.slice(0, comma) : v.slice(0, 48);
      } else {
        out[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
      }
    }
    return out;
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish viewport]', entry);
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;

    if (options.verbose === true) setVerbose(true);
    console.info('Boardfish viewport debugger enabled. Events are buffered without per-event console logging. Use BoardfishDebug.viewport.summary(), .dump(), .setVerbose(true), or .reset().');
  }

  function disable() {
    enabled = false;

    console.info('Boardfish viewport debugger disabled.');
  }

  function setVerbose(value) {
    verbose = !!value;

    console.info(`Boardfish viewport verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    if (!ctx.steps) ctx.steps = {};
    ctx.steps[stepName] = {
      ms: meta?.ms ?? (now - ctx.last),
      total: now - ctx.t0,
      meta: sanitize(meta),
    };
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: Math.round((now - ctx.last) * 100) / 100,
      total: Math.round((now - ctx.t0) * 100) / 100,
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  function count(name, amount = 1) {
    if (!enabled) return;
    stats[name] = (stats[name] || 0) + amount;
  }

  function max(name, value) {
    if (!enabled) return;
    stats[name] = Math.max(stats[name] || 0, value || 0);
  }

  function timing(name, value) {
    if (!enabled) return;
    const ms = value || 0;
    stats[`${name}Count`] = (stats[`${name}Count`] || 0) + 1;
    stats[`${name}TotalMs`] = (stats[`${name}TotalMs`] || 0) + ms;
    stats[`max${name[0].toUpperCase()}${name.slice(1)}Ms`] = Math.max(
      stats[`max${name[0].toUpperCase()}${name.slice(1)}Ms`] || 0,
      ms
    );
  }

  function frameStart(queueMs) {
    if (!enabled) return null;
    const now = performance.now();
    const rafGap = lastRafAt ? now - lastRafAt : 0;
    lastRafAt = now;
    stats.lastRafGapMs = rafGap;
    stats.maxRafGapMs = Math.max(stats.maxRafGapMs, rafGap);
    stats.maxQueueMs = Math.max(stats.maxQueueMs, queueMs || 0);
    const meta = { queueMs, rafGap, panX, panY, zoom };
    const ctx = start('frame', meta);
    if (ctx) ctx.startMeta = meta;
    return ctx;
  }

  function frameEnd(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    const total = performance.now() - ctx.t0;
    stats.maxFrameMs = Math.max(stats.maxFrameMs, total);
    if (total > 16.7) {
      stats.slowFrames++;
      slowRecords.push({
        id: ctx.id,
        frameMs: Math.round(total * 100) / 100,
        ...(ctx.startMeta || {}),
        steps: ctx.steps || {},
        ...sanitize(meta),
      });
      if (slowRecords.length > MAX_SLOW_RECORDS) slowRecords.shift();
    }
    end(ctx, { ...meta, frameMs: total, slow: total > 16.7 });
  }

  function summary() {
    const rows = [
      { metric: 'wheel', value: stats.wheel },
      { metric: 'wheelPan', value: stats.wheelPan },
      { metric: 'wheelZoom', value: stats.wheelZoom },
      { metric: 'mousePanMoves', value: stats.mousePanMoves },
      { metric: 'scheduledFrames', value: stats.scheduledFrames },
      { metric: 'coalescedFrames', value: stats.coalescedFrames },
      { metric: 'transformFrames', value: stats.transformFrames },
      { metric: 'boardFrames', value: stats.boardFrames },
      { metric: 'overlayFrames', value: stats.overlayFrames },
      { metric: 'slowFramesOver16ms', value: stats.slowFrames },
      { metric: 'maxFrameMs', value: Math.round(stats.maxFrameMs * 100) / 100 },
      { metric: 'maxQueueMs', value: Math.round(stats.maxQueueMs * 100) / 100 },
      { metric: 'maxRafGapMs', value: Math.round(stats.maxRafGapMs * 100) / 100 },
      { metric: 'avgWheelHandlerMs', value: stats.wheelHandlerCount ? Math.round(stats.wheelHandlerTotalMs / stats.wheelHandlerCount * 100) / 100 : 0 },
      { metric: 'maxWheelHandlerMs', value: Math.round(stats.maxWheelHandlerMs * 100) / 100 },
      { metric: 'avgMousePanHandlerMs', value: stats.mousePanHandlerCount ? Math.round(stats.mousePanHandlerTotalMs / stats.mousePanHandlerCount * 100) / 100 : 0 },
      { metric: 'maxMousePanHandlerMs', value: Math.round(stats.maxMousePanHandlerMs * 100) / 100 },
      { metric: 'imageAdds', value: stats.imageAdds },
      { metric: 'imageLoads', value: stats.imageLoads },
      { metric: 'imageDecodes', value: stats.imageDecodes },
      { metric: 'imageBitmaps', value: stats.imageBitmaps },
      { metric: 'imageBitmapFailures', value: stats.imageBitmapFailures },
      { metric: 'clipboardPrecacheStarts', value: stats.clipboardPrecacheStarts },
      { metric: 'clipboardPrecacheFailures', value: stats.clipboardPrecacheFailures },
      { metric: 'culledImages', value: stats.culledImages },
      { metric: 'culledText', value: stats.culledText },
      { metric: 'croppedImages', value: stats.croppedImages },
      { metric: 'maxImageAddMs', value: Math.round(stats.maxImageAddMs * 100) / 100 },
      { metric: 'maxImageLoadMs', value: Math.round(stats.maxImageLoadMs * 100) / 100 },
      { metric: 'maxImageDecodeMs', value: Math.round(stats.maxImageDecodeMs * 100) / 100 },
      { metric: 'maxImageBitmapMs', value: Math.round(stats.maxImageBitmapMs * 100) / 100 },
      { metric: 'maxClipboardPrecacheMs', value: Math.round(stats.maxClipboardPrecacheMs * 100) / 100 },
    ];
    console.table(rows);
    return rows;
  }

  function frameSummary() {
    const starts = new Map();
    for (const e of events) {
      if (e.op === 'frame' && e.step === 'start') starts.set(e.id, e.meta || {});
    }
    const frames = events
      .filter(e => e.op === 'frame' && e.step === 'end')
      .map(e => ({ ...(starts.get(e.id) || {}), ...(e.meta || {}) }));
    const sum = (field) => frames.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => frames.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const out = {
      frames: frames.length,
      slowFramesOver16ms: frames.filter(row => row.slow).length,
      avgFrameMs: frames.length ? Math.round(sum('frameMs') / frames.length * 100) / 100 : 0,
      maxFrameMs: Math.round(max('frameMs') * 100) / 100,
      avgQueueMs: frames.length ? Math.round(sum('queueMs') / frames.length * 100) / 100 : 0,
      maxQueueMs: Math.round(max('queueMs') * 100) / 100,
      maxRafGapMs: Math.round(max('rafGap') * 100) / 100,
      transformFrames: frames.filter(row => row.doTransform).length,
      boardFrames: frames.filter(row => row.doBoard).length,
      overlayFrames: frames.filter(row => row.doOverlay).length,
    };
    console.table([out]);
    return out;
  }

  function drawSummary() {
    const draws = events
      .filter(e => e.op === 'drawBoard' && e.step === 'end' && !e.meta?.skipped)
      .map(e => ({ ms: e.total, ...(e.meta || {}) }));
    const sum = (field) => draws.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => draws.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const out = {
      draws: draws.length,
      avgDrawMs: draws.length ? Math.round(sum('ms') / draws.length * 100) / 100 : 0,
      maxDrawMs: Math.round(max('ms') * 100) / 100,
      avgDrawnImages: draws.length ? Math.round(sum('drawnImages') / draws.length * 100) / 100 : 0,
      maxDrawnImages: max('drawnImages'),
      avgCulledImages: draws.length ? Math.round(sum('culledImages') / draws.length * 100) / 100 : 0,
      maxCulledImages: max('culledImages'),
      avgBitmapImages: draws.length ? Math.round(sum('bitmapImages') / draws.length * 100) / 100 : 0,
      avgElementImages: draws.length ? Math.round(sum('elementImages') / draws.length * 100) / 100 : 0,
      avgCroppedImages: draws.length ? Math.round(sum('croppedImages') / draws.length * 100) / 100 : 0,
      avgDrawnText: draws.length ? Math.round(sum('drawnText') / draws.length * 100) / 100 : 0,
      avgCulledText: draws.length ? Math.round(sum('culledText') / draws.length * 100) / 100 : 0,
    };
    console.table([out]);
    return out;
  }

  function slowFrames(limit = 20) {
    const rows = slowRecords
      .map(e => ({
        id: e.id,
        frameMs: e.frameMs ?? '',
        queueMs: e.queueMs ?? '',
        rafGap: e.rafGap ?? '',
        sources: e.sources ?? '',
        doTransform: e.doTransform ?? '',
        doBoard: e.doBoard ?? '',
        doOverlay: e.doOverlay ?? '',
        applyTransformCallMs: e.steps?.applyTransformCall?.ms ?? '',
        drawBoardMs: e.steps?.drawBoard?.ms ?? '',
        updateSelectionOverlayMs: e.steps?.updateSelectionOverlay?.ms ?? '',
      }))
      .sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function transformSummary() {
    const stepsById = new Map();
    const starts = new Map();
    for (const e of events) {
      if (e.op !== 'applyTransform') continue;
      if (e.step === 'start') starts.set(e.id, e.meta || {});
      else if (e.step !== 'end') {
        if (!stepsById.has(e.id)) stepsById.set(e.id, {});
        stepsById.get(e.id)[e.step] = e.meta?.ms ?? e.total ?? 0;
      }
    }
    const rows = events
      .filter(e => e.op === 'applyTransform' && e.step === 'end' && !e.meta?.skipped)
      .map(e => ({ ...(starts.get(e.id) || {}), ...(stepsById.get(e.id) || {}), totalMs: e.total }));
    const sum = (field) => rows.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => rows.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const out = {
      transforms: rows.length,
      avgTotalMs: rows.length ? Math.round(sum('totalMs') / rows.length * 100) / 100 : 0,
      maxTotalMs: Math.round(max('totalMs') * 100) / 100,
      avgDrawBoardMs: rows.length ? Math.round(sum('drawBoard') / rows.length * 100) / 100 : 0,
      maxDrawBoardMs: Math.round(max('drawBoard') * 100) / 100,
      avgZoomDisplayMs: rows.length ? Math.round(sum('updateZoomDisplay') / rows.length * 100) / 100 : 0,
      maxZoomDisplayMs: Math.round(max('updateZoomDisplay') * 100) / 100,
      avgSaveViewportMs: rows.length ? Math.round(sum('saveViewport') / rows.length * 100) / 100 : 0,
      maxSaveViewportMs: Math.round(max('saveViewport') * 100) / 100,
      avgOverlayMs: rows.length ? Math.round(sum('updateSelectionOverlay') / rows.length * 100) / 100 : 0,
      maxOverlayMs: Math.round(max('updateSelectionOverlay') * 100) / 100,
    };
    console.table([out]);
    return out;
  }

  function dump() {
    const flat = events.map(({ meta, ...rest }) => {
      if (!meta) return rest;
      const { rust, ...other } = meta;
      return rust && typeof rust === 'object' ? { ...rest, ...other, ...Object.fromEntries(Object.entries(rust).map(([k, v]) => ['rust_' + k, v])) } : { ...rest, ...other };
    });
    console.table(flat);
    return events.slice();
  }

  function reset() {
    events.length = 0;
    slowRecords.length = 0;
    for (const key of Object.keys(stats)) stats[key] = 0;
    lastRafAt = 0;
  }

  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    count,
    max,
    timing,
    frameStart,
    frameEnd,
    summary,
    frameSummary,
    drawSummary,
    transformSummary,
    slowFrames,
    dump,
    reset,
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
  };
})();

exposeDebug({ viewport: ViewportDebug });

// ─── Save debugger ───────────────────────────────────────────────────────────

const SaveDebug = (() => {
  const MAX_EVENTS = 300;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];

  function sanitize(value) {
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/dataUrl|src|base64|imageStore/i.test(k) && typeof v === 'string') {
        out[k + 'Len'] = v.length;
        const comma = v.indexOf(',');
        out.mime = comma > 0 ? v.slice(0, comma) : v.slice(0, 48);
      } else {
        out[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
      }
    }
    return out;
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish save]', entry);
  }

  function setRustDebug(value) {
    if (!window.__TAURI__) return;
    window.__TAURI__.core.invoke('set_save_debug', { enabled: value }).catch(() => {});
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;

    if (options.verbose === true) setVerbose(true);
    setRustDebug(true);
    console.info('Boardfish save debugger enabled. Use BoardfishDebug.save.summary(), .dump(), or .reset().');
  }

  function disable() {
    enabled = false;

    setRustDebug(false);
    console.info('Boardfish save debugger disabled.');
  }

  function setVerbose(value) {
    verbose = !!value;

    console.info(`Boardfish save verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: Math.round((now - ctx.last) * 100) / 100,
      total: Math.round((now - ctx.t0) * 100) / 100,
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  async function invoke(ctx, command, args = {}, meta = {}) {
    if (!window.__TAURI__) throw new Error('Tauri is unavailable');
    if (!enabled) return window.__TAURI__.core.invoke(command, args);
    const t0 = performance.now();
    step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await window.__TAURI__.core.invoke(command, args);
      step(ctx, 'invoke:ok', { command, ms: performance.now() - t0, rust: result || null });
      return result;
    } catch (err) {
      step(ctx, 'invoke:error', { command, ms: performance.now() - t0, error: String(err) });
      throw err;
    }
  }

  function dump() {
    const flat = events.map(({ meta, ...rest }) => {
      if (!meta) return rest;
      const { rust, ...other } = meta;
      return rust && typeof rust === 'object'
        ? { ...rest, ...other, ...Object.fromEntries(Object.entries(rust).map(([k, v]) => ['rust_' + k, v])) }
        : { ...rest, ...other };
    });
    console.table(flat);
    return events.slice();
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      id: e.id,
      op: e.op,
      step: e.step,
      dt: e.dt,
      total: e.total,
      command: e.meta?.command || '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      imageObjectCount: e.meta?.imageObjectCount ?? '',
      imageStoreBytes: e.meta?.imageStoreBytes ?? '',
      rawImageStoreBytes: e.meta?.rawImageStoreBytes ?? '',
      largestImageBytes: e.meta?.largestImageBytes ?? '',
      jsonBytes: e.meta?.jsonBytes ?? '',
      queueMs: e.meta?.queueMs ?? '',
      elapsedMs: e.meta?.elapsedMs ?? '',
      rustSerializeMs: e.meta?.rust?.serialize_ms ?? '',
      rustWriteMs: e.meta?.rust?.write_ms ?? '',
      rustZipMs: e.meta?.rust?.zip_ms ?? '',
      rustImageBytes: e.meta?.rust?.image_bytes ?? '',
      rustImageCount: e.meta?.rust?.image_count ?? '',
      rustTotalMs: e.meta?.rust?.total_ms ?? '',
      error: e.meta?.error || '',
    }));
    console.table(rows);
    return rows;
  }

  function phaseSummary() {
    const rows = events
      .filter(e => (
        e.step === 'boardData' ||
        e.step === 'json-stringify' ||
        e.step.startsWith('await-image-source-cache') ||
        e.step.startsWith('save-frame-probe') ||
        (e.step === 'invoke:ok' && e.meta?.command === 'save_board') ||
        e.step === 'markSaved:end' ||
        e.step === 'end' ||
        e.step === 'invoke:error'
      ))
      .map(e => ({
        step: e.step,
        total: e.total,
        dt: e.dt,
        command: e.meta?.command || '',
        objectCount: e.meta?.objectCount ?? '',
        imageCount: e.meta?.imageCount ?? '',
        imageObjectCount: e.meta?.imageObjectCount ?? '',
        imageStoreBytes: e.meta?.imageStoreBytes ?? '',
        rawImageStoreBytes: e.meta?.rawImageStoreBytes ?? '',
        jsonBytes: e.meta?.jsonBytes ?? e.meta?.rust?.json_bytes ?? '',
        queueMs: e.meta?.queueMs ?? '',
        elapsedMs: e.meta?.elapsedMs ?? '',
        rustSerializeMs: e.meta?.rust?.serialize_ms ?? '',
        rustWriteMs: e.meta?.rust?.write_ms ?? '',
        rustZipMs: e.meta?.rust?.zip_ms ?? '',
        rustImageBytes: e.meta?.rust?.image_bytes ?? '',
        rustImageCount: e.meta?.rust?.image_count ?? '',
        rustTotalMs: e.meta?.rust?.total_ms ?? '',
        error: e.meta?.error || '',
      }));
    console.table(rows);
    return rows;
  }

  function reset() { events.length = 0; }


  return { enable, disable, setVerbose, start, step, end, invoke, dump, summary, phaseSummary, reset, get enabled() { return enabled; }, get events() { return events.slice(); } };
})();

exposeDebug({ save: SaveDebug });

// ─── Open debugger ───────────────────────────────────────────────────────────

const OpenDebug = (() => {
  const MAX_EVENTS = 5000;
  let enabled = false;
  let verbose = false;
  let hydrationMode = 'all-before-open';
  let hydrationConcurrency = 8;
  let nextOpId = 1;
  const events = [];

  function sanitize(value) {
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/dataUrl|src|base64|imageStore/i.test(k) && typeof v === 'string') {
        out[k + 'Len'] = v.length;
        const comma = v.indexOf(',');
        out.mime = comma > 0 ? v.slice(0, comma) : v.slice(0, 48);
      } else {
        out[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
      }
    }
    return out;
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish open]', entry);
  }

  function setRustDebug(value) {
    if (!window.__TAURI__) return;
    window.__TAURI__.core.invoke('set_open_debug', { enabled: value }).catch(() => {});
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;

    if (options.verbose === true) setVerbose(true);
    setRustDebug(true);
    console.info('Boardfish open debugger enabled. Use BoardfishDebug.open.summary(), .dump(), or .reset().');
  }

  function disable() {
    enabled = false;

    setRustDebug(false);
    console.info('Boardfish open debugger disabled.');
  }

  function setVerbose(value) {
    verbose = !!value;

    console.info(`Boardfish open verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function setHydrationMode(mode) {
    const allowed = new Set(['all-before-open', 'visible-first']);
    if (!allowed.has(mode)) {
      console.warn(`[Boardfish open] Unknown hydration mode "${mode}". Use "all-before-open" or "visible-first".`);
      return hydrationMode;
    }
    hydrationMode = mode;
    console.info(`[Boardfish open] hydration mode set to ${hydrationMode}`);
    return hydrationMode;
  }

  function setHydrationConcurrency(value) {
    const n = Math.max(1, Math.min(32, Math.floor(Number(value) || hydrationConcurrency)));
    hydrationConcurrency = n;
    console.info(`[Boardfish open] hydration concurrency set to ${hydrationConcurrency}`);
    return hydrationConcurrency;
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: Math.round((now - ctx.last) * 100) / 100,
      total: Math.round((now - ctx.t0) * 100) / 100,
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  async function invoke(ctx, command, args = {}, meta = {}) {
    if (!window.__TAURI__) throw new Error('Tauri is unavailable');
    if (!enabled) return window.__TAURI__.core.invoke(command, args);
    const t0 = performance.now();
    step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await window.__TAURI__.core.invoke(command, args);
      step(ctx, 'invoke:ok', { command, ms: performance.now() - t0, rust: result?.debug || result || null });
      return result;
    } catch (err) {
      step(ctx, 'invoke:error', { command, ms: performance.now() - t0, error: String(err) });
      throw err;
    }
  }

  function dump() {
    const flat = events.map(({ meta, ...rest }) => {
      if (!meta) return rest;
      const { rust, ...other } = meta;
      return rust && typeof rust === 'object'
        ? { ...rest, ...other, ...Object.fromEntries(Object.entries(rust).map(([k, v]) => ['rust_' + k, v])) }
        : { ...rest, ...other };
    });
    console.table(flat);
    return events.slice();
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      id: e.id,
      op: e.op,
      step: e.step,
      dt: e.dt,
      total: e.total,
      command: e.meta?.command || '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      imageObjectCount: e.meta?.imageObjectCount ?? '',
      imageStoreBytes: e.meta?.imageStoreBytes ?? '',
      fileBytes: e.meta?.rust?.file_bytes ?? '',
      rustReadMs: e.meta?.rust?.read_ms ?? '',
      rustZipOpenMs: e.meta?.rust?.zip_open_ms ?? '',
      rustBoardJsonReadMs: e.meta?.rust?.board_json_read_ms ?? '',
      rustBoardJsonParseMs: e.meta?.rust?.board_json_parse_ms ?? '',
      rustImageReadMs: e.meta?.rust?.image_read_ms ?? '',
      rustCacheInsertMs: e.meta?.rust?.cache_insert_ms ?? '',
      rustBase64Ms: e.meta?.rust?.base64_ms ?? '',
      rustImageBytes: e.meta?.rust?.image_bytes ?? '',
      rustTotalMs: e.meta?.rust?.total_ms ?? '',
      error: e.meta?.error || '',
    }));
    console.table(rows);
    return rows;
  }

  function phaseSummary() {
    const interesting = new Set([
      'read-board-debug',
      'apply-state',
      'hydrate-initial-policy',
      'hydrate-visible:end',
      'hydrate-all:end',
      'hydrate-background:done',
      'initial-applyTransform',
      'end',
    ]);
    const rows = events.filter(e => (
      interesting.has(e.step) ||
      (e.step === 'invoke:ok' && e.meta?.command && e.meta.command !== 'get_cached_image_data_url')
    )).map(e => ({
      step: e.step,
      total: e.total,
      dt: e.dt,
      command: e.meta?.command || '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      count: e.meta?.count ?? '',
      hydrated: e.meta?.hydrated ?? '',
      remaining: e.meta?.remaining ?? '',
      rustTotalMs: e.meta?.rust?.total_ms ?? '',
      rustImageReadMs: e.meta?.rust?.image_read_ms ?? '',
      rustCacheInsertMs: e.meta?.rust?.cache_insert_ms ?? '',
      ms: e.meta?.ms ?? '',
    }));
    console.table(rows);
    return rows;
  }

  function hydrationSummary() {
    const rows = events.filter(e => e.step === 'hydrate-image').map(e => e.meta || {});
    const sum = (field) => rows.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => rows.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const countSource = (source) => rows.filter((row) => row.source === source).length;
    const out = {
      imageCount: rows.length,
      assetImages: countSource('asset'),
      fallbackDataUrlImages: countSource('data-url-fallback'),
      totalDataUrlMB: Math.round(sum('dataUrlLen') / 1024 / 1024 * 100) / 100,
      totalImageHydrateMs: Math.round(sum('ms') * 100) / 100,
      totalFetchMs: Math.round(sum('fetchMs') * 100) / 100,
      totalLoadMs: Math.round(sum('loadMs') * 100) / 100,
      totalBitmapMs: Math.round(sum('bitmapMs') * 100) / 100,
      maxImageMs: Math.round(max('ms') * 100) / 100,
      maxFetchMs: Math.round(max('fetchMs') * 100) / 100,
      concurrency: hydrationConcurrency,
      mode: hydrationMode,
    };
    console.table([out]);
    return out;
  }

  function slowImages(limit = 20) {
    const rows = events
      .filter(e => e.step === 'hydrate-image')
      .map(e => ({
        imgKey: e.meta?.imgKey || '',
        totalMs: e.meta?.ms ?? '',
        fetchMs: e.meta?.fetchMs ?? '',
        loadMs: e.meta?.loadMs ?? '',
        bitmapMs: e.meta?.bitmapMs ?? '',
        dataUrlLen: e.meta?.dataUrlLen ?? '',
        source: e.meta?.source ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
      }))
      .sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function reset() { events.length = 0; }


  return {
    enable,
    disable,
    setVerbose,
    setHydrationMode,
    setHydrationConcurrency,
    start,
    step,
    end,
    invoke,
    dump,
    summary,
    phaseSummary,
    hydrationSummary,
    slowImages,
    reset,
    get enabled() { return enabled; },
    get hydrationMode() { return hydrationMode; },
    get hydrationConcurrency() { return hydrationConcurrency; },
    get events() { return events.slice(); },
  };
})();

exposeDebug({ open: OpenDebug });

// ─── Export debugger ─────────────────────────────────────────────────────────
const ExportDebug = (() => {
  const MAX_EVENTS = 300;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];

  function sanitize(value) {
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/dataUrl|src|base64/i.test(k) && typeof v === 'string') {
        out[k + 'Len'] = v.length;
        const comma = v.indexOf(',');
        out.mime = comma > 0 ? v.slice(0, comma) : v.slice(0, 48);
      } else {
        out[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
      }
    }
    return out;
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish export]', entry);
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;

    if (options.verbose === true) setVerbose(true);
    console.info('Boardfish export debugger enabled. Use BoardfishDebug.export.summary(), .dump(), or .reset().');
  }

  function disable() {
    enabled = false;

    console.info('Boardfish export debugger disabled.');
  }

  function setVerbose(value) {
    verbose = !!value;

    console.info(`Boardfish export verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: Math.round((now - ctx.last) * 100) / 100,
      total: Math.round((now - ctx.t0) * 100) / 100,
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  async function invoke(ctx, command, args = {}, meta = {}) {
    if (!window.__TAURI__) throw new Error('Tauri is unavailable');
    if (!enabled) return window.__TAURI__.core.invoke(command, args);
    step(ctx, 'invoke:start', { command, ...sanitize(meta) });
    const t0 = performance.now();
    try {
      const result = await window.__TAURI__.core.invoke(command, args);
      step(ctx, 'invoke:ok', { command, ms: Math.round((performance.now() - t0) * 100) / 100, result });
      return result;
    } catch (err) {
      step(ctx, 'invoke:error', { command, ms: Math.round((performance.now() - t0) * 100) / 100, error: String(err) });
      throw err;
    }
  }

  function dump() {
    const flat = events.map(({ meta, ...rest }) => ({ ...rest, ...(meta || {}) }));
    console.table(flat);
    return events.slice();
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      id: e.id,
      op: e.op,
      step: e.step,
      dt: e.dt,
      total: e.total,
      imageCount: e.meta?.imageCount ?? '',
      dataUrlCount: e.meta?.dataUrlCount ?? '',
      keyCount: e.meta?.keyCount ?? '',
      tempKeyCount: e.meta?.tempKeyCount ?? '',
      savedCount: e.meta?.savedCount ?? '',
      command: e.meta?.command || '',
      result: e.meta?.result ?? '',
      error: e.meta?.error || '',
    }));
    console.table(rows);
    return rows;
  }

  function phaseSummary() {
    const rows = events
      .filter(e => e.step && e.step !== 'start')
      .map(e => ({
        step: e.step,
        total: e.total,
        dt: e.dt,
        command: e.meta?.command || '',
        imageCount: e.meta?.imageCount ?? '',
        keyCount: e.meta?.keyCount ?? '',
        tempKeyCount: e.meta?.tempKeyCount ?? '',
        dataUrlLen: e.meta?.dataUrlLen ?? '',
        savedCount: e.meta?.savedCount ?? e.meta?.result ?? '',
        result: e.meta?.result ?? '',
        error: e.meta?.error || '',
      }));
    console.table(rows);
    return rows;
  }

  function reset() { events.length = 0; }

  return { enable, disable, setVerbose, start, step, end, invoke, dump, summary, phaseSummary, reset, get enabled() { return enabled; }, get events() { return events.slice(); } };
})();

exposeDebug({ export: ExportDebug });

const InsertDebug = (() => {
  const MAX_EVENTS = 300;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];

  function round(value) { return Math.round((value || 0) * 100) / 100; }
  function sanitize(meta = {}) {
    const out = {};
    for (const [key, value] of Object.entries(meta || {})) {
      if (typeof value === 'string' && /dataUrl|src|base64/i.test(key)) out[`${key}Len`] = value.length;
      else out[key] = value;
    }
    return out;
  }
  function push(evt) {
    if (!enabled) return;
    const entry = { at: round(performance.now()), ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish insert]', entry);
  }
  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    if (options.verbose === true) setVerbose(true);
    console.info('Boardfish insert debugger enabled. Use BoardfishDebug.insert.phaseSummary(), .summary(), .dump(), .setVerbose(true), or .reset().');
  }
  function disable() {
    enabled = false;
    console.info('Boardfish insert debugger disabled.');
  }
  function setVerbose(value) {
    verbose = !!value;
    console.info(`Boardfish insert verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
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
  function rows(filterStart = false) {
    return events
      .filter(e => !filterStart || e.step !== 'start')
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        total: e.total,
        dt: e.dt,
        source: e.meta?.source || '',
        fileCount: e.meta?.fileCount ?? '',
        fileName: e.meta?.fileName || '',
        fileSize: e.meta?.fileSize ?? '',
        fileType: e.meta?.fileType || '',
        dataUrlLen: e.meta?.dataUrlLen ?? '',
        added: e.meta?.added ?? '',
        skipped: e.meta?.skipped ?? '',
        error: e.meta?.error || '',
      }));
  }
  function phaseSummary() {
    const out = rows(true);
    console.table(out);
    return out;
  }
  function summary() {
    const out = rows(false);
    console.table(out);
    return out;
  }
  function dump() {
    const flat = events.map(({ meta, ...rest }) => ({ ...rest, ...(meta || {}) }));
    console.table(flat);
    return events.slice();
  }
  function reset() { events.length = 0; }

  return { enable, disable, setVerbose, start, step, end, phaseSummary, summary, dump, reset, get events() { return events.slice(); } };
})();

exposeDebug({ insert: InsertDebug });

// ─── Export-all diagnostic ────────────────────────────────────────────────────
// Usage (DevTools console):
//   await BoardfishDebug.exportAllDiag.run()
//
// Probes why "Export All Images" silently fails on Windows with many images.
// Suspected cause: Tauri IPC (WebView2 postMessage) has a lower effective payload
// limit than macOS WKWebView. All data URLs are sent in a single invoke() call.
//
// The diagnostic runs in 3 phases without blocking your real board:
//   Phase 1 — renders each image, measures individual + total payload size
//   Phase 2 — JS-side JSON serialization probe (no side-effects, measures limits)
//   Phase 3 — live IPC binary-search: sends doubling batches to save_images_to_folder
//             (opens the folder picker ONCE; cancel to skip phase 3)
const ExportAllDiag = (() => {
  const WARN_MB  = 10;   // yellow warning
  const FATAL_MB = 50;   // likely fatal on Windows WebView2

  let _last = null;

  function mb(bytes) { return Math.round(bytes / 1024 / 1024 * 100) / 100; }
  function ms(t0)    { return Math.round((performance.now() - t0) * 10) / 10; }

  async function run() {
    if (!window.__TAURI__) {
      console.warn('[exportAllDiag] Not inside Tauri — aborting.');
      return null;
    }

    const imageObjs = (typeof objects !== 'undefined')
      ? [...objects].filter(o => o.type === 'image')
      : [];

    if (!imageObjs.length) {
      console.warn('[exportAllDiag] No image objects on this board.');
      return null;
    }

    console.group(`%c[exportAllDiag] Diagnosing export of ${imageObjs.length} image(s) — IS_WIN=${IS_WIN}`,
      'font-weight:bold');

    // ── Phase 1: render + measure ──────────────────────────────────────────────
    console.group('Phase 1: render each image, measure payload size');
    const perImage = [];
    let totalBytes = 0;

    for (let i = 0; i < imageObjs.length; i++) {
      const obj = imageObjs[i];
      const t0 = performance.now();
      let dataUrl = null, renderErr = null;
      try { dataUrl = await getRenderedImageDataUrl(obj); }
      catch (e) { renderErr = String(e); }
      const renderMs = ms(t0);
      const bytes = dataUrl ? dataUrl.length : 0;
      const kb = Math.round(bytes / 1024 * 10) / 10;
      totalBytes += bytes;

      const row = { index: i, imgKey: obj.data?.imgKey ?? '?', renderMs, kb, ok: !!dataUrl && !renderErr, error: renderErr ?? undefined };
      perImage.push({ ...row, dataUrl });
      const style = row.ok ? '' : 'color:red';
      console.log(`%c  [${i}] imgKey=${row.imgKey}  render=${renderMs}ms  ${kb}KB  ok=${row.ok}${renderErr ? '  ERR:'+renderErr : ''}`, style);
    }

    const totalMB = mb(totalBytes);
    const validUrls = perImage.filter(r => r.ok).map(r => r.dataUrl);
    const severity = totalMB > FATAL_MB ? 'FATAL' : totalMB > WARN_MB ? 'WARN' : 'OK';
    const severityStyle = severity === 'FATAL' ? 'color:red;font-weight:bold' : severity === 'WARN' ? 'color:orange;font-weight:bold' : 'color:green';
    console.log(`%cTotal payload: ${totalMB} MB | ${validUrls.length} renderable | severity=${severity}`, severityStyle);
    if (severity === 'FATAL') console.error('[exportAllDiag] Payload almost certainly exceeds Tauri/WebView2 IPC limit on Windows');
    else if (severity === 'WARN') console.warn('[exportAllDiag] Payload is large — may intermittently hit IPC limits on Windows');
    console.groupEnd();

    // ── Phase 2: JS-side JSON serialization probe (no side-effects) ───────────
    // Measures whether stringify itself lags or throws, and confirms the payload
    // sizes that will cross the wire. No Tauri calls, no folder pickers.
    console.group('Phase 2: JS-side serialization probe (no side-effects)');
    const serializeProbe = [];
    let probeSize = 1;
    while (probeSize <= validUrls.length) {
      const batch = validUrls.slice(0, probeSize);
      const batchBytes = batch.reduce((s, u) => s + u.length, 0);
      const batchMB = mb(batchBytes);
      const t0 = performance.now();
      let jsOk = false, serErr = null;
      try { JSON.stringify({ dataUrls: batch }); jsOk = true; }
      catch (e) { serErr = String(e); }
      const serMs = ms(t0);
      serializeProbe.push({ count: probeSize, payloadMB: batchMB, serializeMs: serMs, jsOk, error: serErr ?? '' });
      console.log(`  count=${probeSize}  payload=${batchMB}MB  serialize=${serMs}ms  jsOk=${jsOk}${serErr ? '  ERR:'+serErr : ''}`);
      if (!jsOk) break;
      probeSize = probeSize < validUrls.length ? Math.min(probeSize * 2, validUrls.length) : validUrls.length + 1;
    }
    console.groupEnd();

    // ── Phase 3: live IPC binary-search ───────────────────────────────────────
    // Calls save_images_to_folder with doubling batch sizes to find the exact
    // count at which the IPC call fails. Opens the folder picker once per call.
    // Press Cancel in the folder picker to abort phase 3 early (savedCount = 0
    // on cancel, so we treat cancel as "user aborted" and stop probing).
    console.group('Phase 3: live IPC binary-search (folder picker will open for each batch — cancel to skip)');
    const ipcProbe = [];
    let ipcSize = 1;
    let ipcAborted = false;
    while (!ipcAborted && ipcSize <= validUrls.length) {
      const batch = validUrls.slice(0, ipcSize);
      const batchMB = mb(batch.reduce((s, u) => s + u.length, 0));
      console.log(`  Probing batch size=${ipcSize} (${batchMB} MB) — open folder picker…`);
      const t0 = performance.now();
      let savedCount = null, ipcOk = false, ipcErr = null;
      try {
        savedCount = await window.__TAURI__.core.invoke('save_images_to_folder', { dataUrls: batch });
        ipcOk = true;
        if (savedCount === 0) {
          // User cancelled folder picker
          console.log('  Folder picker cancelled — stopping phase 3.');
          ipcAborted = true;
        }
      } catch (e) {
        ipcErr = String(e);
      }
      const invokeMs = ms(t0);
      const row = { count: ipcSize, payloadMB: batchMB, invokeMs, savedCount: savedCount ?? 0, ipcOk, error: ipcErr ?? '' };
      ipcProbe.push(row);
      const style = ipcOk ? '' : 'color:red;font-weight:bold';
      console.log(`%c  → count=${ipcSize}  ${batchMB}MB  ${invokeMs}ms  savedCount=${savedCount}  ok=${ipcOk}${ipcErr ? '  ERR:'+ipcErr : ''}`, style);
      if (!ipcOk || ipcAborted) break;
      ipcSize = ipcSize < validUrls.length ? Math.min(ipcSize * 2, validUrls.length) : validUrls.length + 1;
    }
    if (!ipcAborted && ipcProbe.length) {
      const lastOk = [...ipcProbe].reverse().find(r => r.ipcOk && r.savedCount > 0);
      const firstFail = ipcProbe.find(r => !r.ipcOk);
      if (firstFail) {
        console.error(`%c[exportAllDiag] IPC FAILED at count=${firstFail.count} (${firstFail.payloadMB}MB): ${firstFail.error}`, 'color:red;font-weight:bold');
        if (lastOk) console.log(`%c  Last successful batch: count=${lastOk.count} (${lastOk.payloadMB}MB)`, 'color:green');
      } else {
        console.log(`%c[exportAllDiag] All ${ipcProbe[ipcProbe.length-1].count} images exported successfully via IPC.`, 'color:green;font-weight:bold');
      }
    }
    console.groupEnd();

    // ── Report ─────────────────────────────────────────────────────────────────
    const report = {
      isWindows: IS_WIN,
      imageCount: imageObjs.length,
      renderableCount: validUrls.length,
      totalPayloadMB: totalMB,
      payloadSeverity: severity,
      perImage: perImage.map(({ dataUrl: _, ...r }) => r),
      serializeProbe,
      ipcProbe,
    };
    console.group('Full report');
    console.table(report.perImage);
    console.table(report.serializeProbe);
    if (ipcProbe.length) console.table(report.ipcProbe);
    console.log('Full report → BoardfishDebug.exportAllDiag.last');
    console.groupEnd();
    console.groupEnd(); // top group

    _last = report;
    return report;
  }

  return {
    run,
    get last() { return _last; },
  };
})();

exposeDebug({ exportAllDiag: ExportAllDiag });

// ─── Text selection debugger ──────────────────────────────────────────────────
// Diagnoses Windows text selection offset bugs.
// Usage:
//   BoardfishDebug.textSel.enable()      — start logging
//   BoardfishDebug.textSel.summary()     — table of hit-test + draw events
//   BoardfishDebug.textSel.report()      — line ranges + selected text with whitespace visible
//   BoardfishDebug.textSel.selectAll()   — force select-all in the active text object
//   BoardfishDebug.textSel.measure()     — measure current editing obj chars
//   BoardfishDebug.textSel.reset()
//   BoardfishDebug.textSel.disable()
let _textSelDebugEnabled = false;
const TextSelDebug = (() => {
  const MAX = 400;
  const events = [];
  let nextId = 1;

  function push(evt) {
    if (!_textSelDebugEnabled) return;
    events.push({ id: nextId++, at: Math.round(performance.now() * 10) / 10, ...evt });
    if (events.length > MAX) events.shift();
  }

  function enable() {
    if (!DEBUG_TOOLS_ENABLED) return;
    _textSelDebugEnabled = true;
    console.info(
      '[textSel] enabled. Double-click a text object to edit it, then drag to select.' +
      '\nUse BoardfishDebug.textSel.report(), .summary(), .measure(), .reset(), .disable()'
    );
  }
  function disable() { _textSelDebugEnabled = false; console.info('[textSel] disabled.'); }

  function summary() {
    const rows = events.map(e => ({
      id: e.id,
      type: e.type,
      wx: e.wx?.toFixed(2) ?? '',
      baseX: e.baseX?.toFixed(2) ?? '',
      wx_minus_baseX: e.wx != null && e.baseX != null ? (e.wx - e.baseX).toFixed(2) : '',
      hitLine: e.hitLine ?? '',
      returnedIdx: e.returnedIdx ?? '',
      selStart: e.selStart ?? '',
      selEnd: e.selEnd ?? '',
      x1: e.x1?.toFixed(2) ?? '',
      x2: e.x2?.toFixed(2) ?? '',
      lineText: e.lineText ? e.lineText.slice(0, 30) : '',
      note: e.note ?? '',
    }));
    console.table(rows);
    return rows;
  }

  function showWhitespace(text) {
    return String(text ?? '')
      .replace(/ /g, '·')
      .replace(/\t/g, '→')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n\n');
  }

  function report() {
    if (typeof editingId === 'undefined' || !editingId) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    const obj = (typeof objectsMap !== 'undefined') && objectsMap.get(editingId);
    if (!obj) { console.warn('[textSel] Editing object not found.'); return null; }
    const value = _editEl?.value ?? obj.data.content ?? '';
    const selStart = _editEl?.selectionStart ?? 0;
    const selEnd = _editEl?.selectionEnd ?? 0;
    const lines = getTextLayout(obj);
    const rows = lines.map((line, i) => {
      const textEnd = line.startIndex + line.text.length;
      const nextStart = line.nextStartIndex ?? textEnd;
      const skipped = value.slice(textEnd, nextStart);
      return {
        line: i,
        start: line.startIndex,
        textEnd,
        nextStart,
        selected: selEnd > line.startIndex && selStart < textEnd,
        text: showWhitespace(line.text),
        skippedAfter: showWhitespace(skipped),
        width: Math.round(line.prefixWidths[line.text.length] * 100) / 100,
      };
    });
    const payload = {
      valueLength: value.length,
      selectionStart: selStart,
      selectionEnd: selEnd,
      selectionDirection: _editEl?.selectionDirection || 'none',
      selectedText: value.slice(selStart, selEnd),
      visibleSelectedText: showWhitespace(value.slice(selStart, selEnd)),
      rows,
    };
    console.group('[textSel] report');
    console.log('selection', {
      start: payload.selectionStart,
      end: payload.selectionEnd,
      direction: payload.selectionDirection,
      selectedText: payload.visibleSelectedText,
    });
    console.table(rows);
    console.groupEnd();
    return payload;
  }

  function selectAll() {
    if (typeof editingId === 'undefined' || !editingId || !_editEl) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    _editEl.focus({ preventScroll: true });
    _editEl.setSelectionRange(0, _editEl.value.length, 'none');
    _caretVisible = true;
    _logSelection('debug-select-all', _editEl);
    scheduleRender(true, false);
    return report();
  }

  // Measure every character in the currently-edited object and report
  // measured prefix widths vs what you'd expect from toWorld(mouse)
  function measure() {
    if (typeof editingId === 'undefined' || !editingId) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    const obj = (typeof objectsMap !== 'undefined') && objectsMap.get(editingId);
    if (!obj) { console.warn('[textSel] Editing object not found.'); return null; }

    const dpr = window.devicePixelRatio || 1;
    const zm  = (typeof zoom !== 'undefined') ? zoom : 1;
    console.group(`[textSel] measure() — obj.id=${obj.id}  dpr=${dpr}  zoom=${zm}`);
    console.log(`obj.x=${obj.x}  obj.y=${obj.y}  obj.w=${obj.w}  TEXT_PAD=${TEXT_PAD}`);
    console.log(`baseX (world) = obj.x + TEXT_PAD = ${obj.x + TEXT_PAD}`);
    console.log(`baseX (screen) = baseX*zoom+panX = ${(obj.x + TEXT_PAD) * zm + (typeof panX !== 'undefined' ? panX : 0)}`);

    const lines = (typeof getWrappedLines !== 'undefined') ? getWrappedLines(obj) : [];
    for (const line of lines) {
      const pw = (typeof getPrefixWidths !== 'undefined') ? getPrefixWidths(line.text) : null;
      console.group(`line: "${line.text.slice(0,40)}${line.text.length>40?'…':''}" startIndex=${line.startIndex}`);
      if (pw) {
        const rows = Array.from({ length: line.text.length }, (_, i) => ({
          char: JSON.stringify(line.text[i]),
          charIndex: line.startIndex + i,
          pw_start: pw[i].toFixed(3),
          pw_end: pw[i+1].toFixed(3),
          char_width: (pw[i+1] - pw[i]).toFixed(3),
          midpoint_world: (obj.x + TEXT_PAD + pw[i] + (pw[i+1]-pw[i])/2).toFixed(3),
          midpoint_screen: ((obj.x + TEXT_PAD + pw[i] + (pw[i+1]-pw[i])/2) * zm + (typeof panX !== 'undefined' ? panX : 0)).toFixed(3),
        }));
        console.table(rows);
        console.log(`Total measured line width: ${pw[line.text.length].toFixed(3)} world px`);
        console.log(`measureText full line: ${(typeof measureTextW !== 'undefined') ? measureTextW(line.text).toFixed(3) : '?'} world px`);
      }
      console.groupEnd();
    }
    console.groupEnd();
    return lines;
  }

  function reset() { events.length = 0; nextId = 1; }

  return { enable, disable, summary, report, selectAll, measure, reset, showWhitespace,
    get enabled() { return _textSelDebugEnabled; },
    get events() { return events.slice(); },
    // Internal: called by layoutHitTest
    _logHit(wx, wy, obj, line, returnedIdx, pw) {
      if (!_textSelDebugEnabled) return;
      const baseX = obj.x + TEXT_PAD;
      push({ type: 'hit', wx, wy, baseX, hitLine: line?.text?.slice(0,30), returnedIdx,
        pw0: pw?.[0], pw1: pw?.[1], pw2: pw?.[2], pw3: pw?.[3],
        note: `wx-baseX=${(wx-baseX).toFixed(2)}` });
    },
    // Internal: called by selection draw
    _logDraw(line, selStart, selEnd, x1, x2) {
      if (!_textSelDebugEnabled) return;
      push({ type: 'draw', lineText: line?.text?.slice(0,30), selStart, selEnd, x1, x2,
        note: `width=${(x2-x1).toFixed(2)}` });
    },
    _logSelection(label, proxy) {
      if (!_textSelDebugEnabled || !proxy) return;
      const selStart = proxy.selectionStart ?? 0;
      const selEnd = proxy.selectionEnd ?? 0;
      push({
        type: 'selection',
        selStart,
        selEnd,
        note: `${label}: "${showWhitespace(proxy.value.slice(selStart, selEnd)).slice(0, 80)}"`,
      });
    },
  };
})();

exposeDebug({ textSel: TextSelDebug });


// ─── Viewport ─────────────────────────────────────────────────────────────────

let panX = 0, panY = 0, zoom = 1;

let _vpSaveTimer = null;
function saveViewport() {
  clearTimeout(_vpSaveTimer);
  _vpSaveTimer = setTimeout(() => {
    localStorage.setItem('bf_vp', JSON.stringify({ panX, panY, zoom }));
  }, 400);
}


// ─── Pill debugger ───────────────────────────────────────────────────────────
const PillDebug = (() => {
  const MAX_EVENTS = 1000;
  let enabled = false;
  let verbose = true;
  const events = [];
  const t0 = performance.now();
  let longTaskObserver = null;

  function round(value) {
    return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  }

  function snapshot() {
    const style = getComputedStyle(islZoom);
    return {
      text: islZoom.textContent,
      styleWidth: islZoom.style.width,
      offsetWidth: islZoom.offsetWidth,
      computedWidth: style.width,
      color: style.color,
      opacity: style.opacity,
      transition: style.transition,
      msgActive: _islMsgActive,
      boardOpening: _boardOpening,
      zoomPct: Math.round(zoom * 100) + '%',
    };
  }

  function push(event, data = {}) {
    if (!enabled) return null;
    const entry = {
      t: round(performance.now() - t0),
      event,
      ...snapshot(),
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, round(v)])),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[pill]', entry);
    return entry;
  }

  function log(event, data = {}) {
    return push(event, data);
  }

  function enable() {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    events.length = 0;
    startLongTaskObserver();
    console.info('Boardfish pill debugger enabled. Use BoardfishDebug.pill.summary(), .timeline(), .diagnose(), .dump(), or .reset().');
  }
  function disable() {
    enabled = false;
    if (longTaskObserver) {
      longTaskObserver.disconnect();
      longTaskObserver = null;
    }
  }
  function setVerbose(value) {
    verbose = !!value;
    console.info(`Boardfish pill verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }
  function reset() { events.length = 0; }
  function dump() {
    console.table(events);
    return events.slice();
  }
  function summary() {
    const rows = events.map(e => ({
      t: e.t,
      event: e.event,
      text: e.text,
      styleWidth: e.styleWidth,
      offsetWidth: e.offsetWidth,
      msgActive: e.msgActive,
      boardOpening: e.boardOpening,
      duration: e.duration ?? '',
      elapsed: e.elapsed ?? '',
      reason: e.reason ?? '',
      longTaskMs: e.longTaskMs ?? '',
      phaseMs: e.phaseMs ?? '',
    }));
    console.table(rows);
    return rows;
  }
  function timeline() {
    const rows = [];
    for (let i = 0; i < events.length; i++) {
      const prev = events[i - 1];
      const e = events[i];
      rows.push({
        dt: prev ? round(e.t - prev.t) : 0,
        t: e.t,
        event: e.event,
        text: e.text,
        width: e.offsetWidth,
        styleWidth: e.styleWidth,
        color: e.color,
        longTaskMs: e.longTaskMs ?? '',
      });
    }
    console.table(rows);
    return rows;
  }
  function diagnose() {
    const longTasks = events.filter(e => e.event === 'longtask');
    const bigLongTasks = longTasks.filter(e => Number(e.longTaskMs) >= 100);
    const restoreStart = events.find(e => e.event === 'restoreIslandZoom:start');
    const restoreWidth = events.find(e => e.event === 'restoreIslandZoom:width-text-set');
    const restoreShown = events.find(e => e.event === 'restoreIslandZoom:shown');
    const forcedTransparent = events.find(e => e.event === 'forceIslandTextTransparent');
    const openingRender = events.find(e => e.event === 'open:initial-applyTransform:end');
    const findings = [];
    const textAlpha = (entry) => {
      const match = String(entry?.color || '').match(/rgba?\(([^)]+)\)/);
      if (!match) return 1;
      const parts = match[1].split(',').map((part) => part.trim());
      return parts.length >= 4 ? Number(parts[3]) || 0 : 1;
    };
    const widthSwapVisible = textAlpha(restoreWidth) > 0.05;

    if (bigLongTasks.length) {
      findings.push(`${bigLongTasks.length} long main-thread task(s) over 100ms occurred while the pill was animating or opening.`);
    }
    if (openingRender && Number(openingRender.phaseMs) >= 100) {
      findings.push(`Initial board render took ${openingRender.phaseMs}ms before the pill restored to zoom.`);
    }
    if (restoreStart && restoreWidth && restoreWidth.t - restoreStart.t > 650 && widthSwapVisible) {
      findings.push(`Restore width/text update was delayed by ${round(restoreWidth.t - restoreStart.t)}ms after restore started.`);
    }
    if (restoreWidth && restoreShown && restoreShown.t - restoreWidth.t < 32 && widthSwapVisible) {
      findings.push('Width/text and visible color were applied too close together for a visible transition.');
    }
    if (forcedTransparent && restoreWidth && !widthSwapVisible) {
      findings.push('Fallback transparency path was used; width/text swap was hidden.');
    }
    if (!findings.length) findings.push('No obvious pill animation stall found in the current buffer.');

    const report = {
      findings,
      eventCount: events.length,
      longTaskCount: longTasks.length,
      maxLongTaskMs: longTasks.reduce((n, e) => Math.max(n, Number(e.longTaskMs) || 0), 0),
    };
    console.table(report.findings.map(finding => ({ finding })));
    return report;
  }

  function startLongTaskObserver() {
    if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          push('longtask', {
            longTaskMs: entry.duration,
            startTime: entry.startTime,
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (_) {
      longTaskObserver = null;
    }
  }

  return { enable, disable, setVerbose, reset, dump, summary, timeline, diagnose, log, get enabled() { return enabled; } };
})();
exposeDebug({ pill: PillDebug });

// ─── Context menu debugger ───────────────────────────────────────────────────
const MenuDebug = (() => {
  const MAX_EVENTS = 500;
  let enabled = false;
  let verbose = false;
  let nextId = 1;
  const events = [];

  function round(value) {
    return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  }

  function elementLabel(el) {
    if (!el) return '';
    if (el === window) return 'window';
    if (el === document) return 'document';
    if (el === document.body) return 'body';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().replace(/\s+/g, '.')
      : '';
    return `${el.tagName?.toLowerCase() || String(el)}${id}${cls}`;
  }

  function menuState() {
    const active = document.activeElement;
    const point = lastPointerEvent
      ? document.elementFromPoint(lastPointerEvent.clientX, lastPointerEvent.clientY)
      : null;
    return {
      ctxVisible: ctxMenu.classList.contains('visible'),
      objVisible: objCtxMenu.classList.contains('visible'),
      ctxDisplay: getComputedStyle(ctxMenu).display,
      objDisplay: getComputedStyle(objCtxMenu).display,
      shieldActive: openingShield.classList.contains('active'),
      pasteShieldCount: _pasteShieldCount,
      boardOpening: _boardOpening,
      active: elementLabel(active),
      elementAtPointer: elementLabel(point),
    };
  }

  let lastPointerEvent = null;

  function push(event, data = {}) {
    if (!enabled) return null;
    const entry = {
      id: nextId++,
      t: round(performance.now()),
      event,
      ...menuState(),
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, round(v)])),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish menu]', entry);
    return entry;
  }

  function enable(options = {}) {
    enabled = true;
    verbose = !!options.verbose;
    events.length = 0;
    nextId = 1;
    console.info('Boardfish menu debugger enabled. Use BoardfishDebug.menu.summary(), .events(), .last(), .setVerbose(true), or .reset().');
  }

  function disable() { enabled = false; }
  function setVerbose(value) {
    verbose = !!value;
    console.info(`Boardfish menu verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }
  function reset() { events.length = 0; nextId = 1; }
  function eventsCopy() { console.table(events); return events.slice(); }
  function last(limit = 30) {
    const rows = events.slice(-limit);
    console.table(rows);
    return rows;
  }
  function summary() {
    const rows = events.map(e => ({
      id: e.id,
      event: e.event,
      type: e.type ?? '',
      phase: e.phase ?? '',
      target: e.target ?? '',
      currentTarget: e.currentTarget ?? '',
      button: e.button ?? '',
      x: e.x ?? '',
      y: e.y ?? '',
      command: e.command ?? '',
      ctxVisible: e.ctxVisible,
      objVisible: e.objVisible,
      shieldActive: e.shieldActive,
      defaultPrevented: e.defaultPrevented ?? '',
      propagationStopped: e.propagationStopped ?? '',
      elementAtPointer: e.elementAtPointer,
    }));
    console.table(rows);
    return rows;
  }

  function log(event, data = {}) { return push(event, data); }

  function logDomEvent(label, event) {
    lastPointerEvent = event;
    push(label, {
      type: event.type,
      phase: event.eventPhase,
      target: elementLabel(event.target),
      currentTarget: elementLabel(event.currentTarget),
      button: event.button,
      x: event.clientX,
      y: event.clientY,
      defaultPrevented: event.defaultPrevented,
    });
  }

  return {
    enable,
    disable,
    setVerbose,
    reset,
    events: eventsCopy,
    last,
    summary,
    log,
    logDomEvent,
    get enabled() { return enabled; },
  };
})();
exposeDebug({ menu: MenuDebug });

function islSetWidth(text) {
  PillDebug.log('islSetWidth:before', { text });
  islMeasure.textContent = text;
  islZoom.style.width = islMeasure.offsetWidth + 'px';
  PillDebug.log('islSetWidth:after', { text, measuredWidth: islMeasure.offsetWidth });
}

let _lastZoomPct = -1;
let _islMsgActive = false;
let _lastZoomDisplayAt = 0;
let _zoomDisplayTimer = null;
function updateZoomDisplay(force = false) {
  if (_islMsgActive) return;
  const pct = Math.round(zoom * 100);
  if (pct === _lastZoomPct) return;
  const now = performance.now();
  if (!force && now - _lastZoomDisplayAt < 80) {
    clearTimeout(_zoomDisplayTimer);
    _zoomDisplayTimer = setTimeout(() => updateZoomDisplay(true), 90);
    return;
  }
  _lastZoomDisplayAt = now;
  _lastZoomPct = pct;
  const text = pct + '%';
  PillDebug.log('updateZoomDisplay:set', { force, text });
  islZoom.textContent = text;
  islSetWidth(text);
}

let _islMsgTimer = null;
let _islFadeTimer = null;
let _islAnimToken = 0;

function islandTextAlpha() {
  const color = getComputedStyle(islZoom).color;
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(',').map((part) => part.trim());
  return parts.length >= 4 ? Number(parts[3]) || 0 : 1;
}

function waitForIslandTransition(propertyName, timeoutMs = 700, isComplete = null) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reason) => {
      if (isComplete && !isComplete(reason)) return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      islZoom.removeEventListener('transitionend', onEnd);
      islZoom.removeEventListener('transitioncancel', onCancel);
      resolve(reason);
    };
    const onEnd = (event) => {
      if (event.target === islZoom && event.propertyName === propertyName) finish('transitionend');
    };
    const onCancel = (event) => {
      if (event.target === islZoom && event.propertyName === propertyName) finish('transitioncancel');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    islZoom.addEventListener('transitionend', onEnd);
    islZoom.addEventListener('transitioncancel', onCancel);
  });
}

function forceIslandTextTransparent() {
  const transition = islZoom.style.transition;
  islZoom.style.transition = 'none';
  islZoom.style.color = 'rgba(255,255,255,0)';
  void islZoom.offsetWidth;
  islZoom.style.transition = transition;
  PillDebug.log('forceIslandTextTransparent');
}

function showIslandMsg(msg, duration = 0, onRestore = null) {
  const token = ++_islAnimToken;
  PillDebug.log('showIslandMsg:start', { msg, duration });
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  _islMsgActive = true;
  islZoom.style.pointerEvents = 'none';
  islZoom.style.cursor = 'default';
  islSetWidth(msg);
  islZoom.style.color = 'rgba(255,255,255,0)';
  PillDebug.log('showIslandMsg:fadeOut', { msg, colorAfter: islZoom.style.color, computedColor: getComputedStyle(islZoom).color, transition: getComputedStyle(islZoom).transition });
  return new Promise(resolve => {
    const timerStart = performance.now();
    _islFadeTimer = setTimeout(() => {
      if (token !== _islAnimToken) { resolve(); return; }
      PillDebug.log('showIslandMsg:fadeIn', { msg, timerActualMs: Math.round(performance.now() - timerStart), computedColorBefore: getComputedStyle(islZoom).color });
      islZoom.textContent = msg;
      islZoom.style.color = 'rgba(255,255,255,0.5)';
      PillDebug.log('showIslandMsg:fadeInSet', { computedColorAfter: getComputedStyle(islZoom).color });
      if (duration > 0) {
        _islMsgTimer = setTimeout(() => { if (onRestore) onRestore(); restoreIslandZoom(); }, duration);
      }
      setTimeout(() => {
        if (token !== _islAnimToken) { resolve(); return; }
        PillDebug.log('showIslandMsg:resolved', { msg, elapsed: performance.now() - timerStart });
        resolve();
      }, 500);
    }, 500);
  });
}

async function restoreIslandZoom() {
  const token = ++_islAnimToken;
  PillDebug.log('restoreIslandZoom:start');
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  PillDebug.log('restoreIslandZoom:fadeOut');
  const fadeOut = waitForIslandTransition('color', 700, (reason) => (
    reason === 'timeout' || islandTextAlpha() <= 0.05
  ));
  islZoom.style.color = 'rgba(255,255,255,0)';
  const fadeReason = await fadeOut;
  if (token !== _islAnimToken) return;
  PillDebug.log('restoreIslandZoom:fadeOutComplete', { reason: fadeReason });
  if (islandTextAlpha() > 0.05) {
    forceIslandTextTransparent();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (token !== _islAnimToken) return;
  }
  const pct = Math.round(zoom * 100) + '%';
  _islMsgActive = false;
  _lastZoomPct = -1;
  islSetWidth(pct);
  islZoom.textContent = pct;
  PillDebug.log('restoreIslandZoom:width-text-set', { pct });
  requestAnimationFrame(() => {
    if (token !== _islAnimToken) return;
    PillDebug.log('restoreIslandZoom:raf1', { pct });
    requestAnimationFrame(() => {
      if (token !== _islAnimToken) return;
      PillDebug.log('restoreIslandZoom:raf2', { pct });
      islZoom.style.color = 'rgba(255,255,255,0.5)';
      islZoom.style.pointerEvents = '';
      islZoom.style.cursor = '';
      PillDebug.log('restoreIslandZoom:shown', { pct });
    });
  });
}

islZoom.addEventListener('transitionstart', (event) => {
  PillDebug.log('transitionstart', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
islZoom.addEventListener('transitionend', (event) => {
  PillDebug.log('transitionend', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
islZoom.addEventListener('transitioncancel', (event) => {
  PillDebug.log('transitioncancel', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});


const FONT_SIZE = 16;
const LINE_H    = 24;
const TEXT_PAD  = 4;
const NEW_TEXT_EDIT_MIN_LINES = 3;
const FONT      = `${FONT_SIZE}px 'Geist', 'Geist Sans', Inter, -apple-system, 'Segoe UI', system-ui, sans-serif`;

function normalizeTextContent(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

const _measureCanvas = document.createElement('canvas');
const _measureCtx = _measureCanvas.getContext('2d');
_measureCtx.font = FONT;
const _mwCache = Object.create(null);
function measureTextW(text) {
  if (text in _mwCache) return _mwCache[text];
  _measureCtx.font = FONT;
  return (_mwCache[text] = _measureCtx.measureText(text).width);
}

function clearTextMeasurementCaches() {
  for (const k of Object.keys(_mwCache)) delete _mwCache[k];
  _linesCacheMap.clear();
  _prefixCache.clear();
  for (const obj of objects) delete obj._layoutCache;
  syncAllTextAutoHeights();
  invalidateOffscreen();
  scheduleRender(true, true);
}

// ─── Offscreen buffer ─────────────────────────────────────────────────────────

const _offscreen = document.createElement('canvas');
const _offCtx    = _offscreen.getContext('2d');
let _offscreenDirty = true;
let _offscreenRebuilding = false;
let _offscreenVersion = 0;
function invalidateOffscreen() {
  _offscreenDirty = true;
  _offscreenVersion++;
}

async function _rebuildOffscreenAsync() {
  if (_offscreenRebuilding) return;
  _offscreenRebuilding = true;
  const snapshotEditingId = editingId;
  const rebuildVersion = _offscreenVersion;
  const dbg = ViewportDebug.start('offscreenRebuild', { objectCount: objects.length, editingId: snapshotEditingId, version: rebuildVersion });

  // Ensure all images have GPU-resident ImageBitmap before drawing
  const bitmapPromises = [];
  for (const obj of objects) {
    if (obj.id === snapshotEditingId || obj.type !== 'image') continue;
    const key = obj.data?.imgKey;
    if (!key || imageBitmapCache[key]) continue;
    const img = imageCache[key];
    if (!img || !img.complete) continue;
    bitmapPromises.push(
      img.decode()
        .then(() => createImageBitmap(img))
        .then(bm => { imageBitmapCache[key] = bm; })
        .catch(() => { imageBitmapFailed.add(key); ViewportDebug.count('imageBitmapFailures'); })
    );
  }
  const bitmapStart = performance.now();
  await Promise.all(bitmapPromises);
  ViewportDebug.step(dbg, 'ensure-bitmaps', { count: bitmapPromises.length, ms: performance.now() - bitmapStart });

  // Bail if edit mode or viewport content changed while we were awaiting.
  if (!editingId || editingId !== snapshotEditingId || rebuildVersion !== _offscreenVersion) {
    _offscreenRebuilding = false;
    ViewportDebug.end(dbg, { stale: true, currentVersion: _offscreenVersion });
    if (editingId && _offscreenDirty) scheduleRender(true, false, 'offscreen-stale');
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  _offscreen.width  = boardCanvas.width;
  _offscreen.height = boardCanvas.height;
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);
  _offCtx.fillStyle = '#232322';
  _offCtx.fillRect(0, 0, _offscreen.width, _offscreen.height);
  _offCtx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
  setCanvasImageQuality(_offCtx);
  _offCtx.font = FONT;
  _offCtx.textBaseline = 'top';
  for (const obj of objects) {
    if (obj.id === editingId) continue;
    drawSingleObj(_offCtx, obj);
  }
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);

  _offscreenRebuilding = false;
  if (rebuildVersion === _offscreenVersion) _offscreenDirty = false;
  // Re-render to display the fresh offscreen (caret/selection on top)
  scheduleRender(true, false, 'offscreen-ready');
  ViewportDebug.end(dbg, { stale: false });
}

// External line layout cache: id -> {content, w, lines: [{text, startIndex}]}
// Auto-invalidates on content/width change; never serialized with objects.
const _linesCacheMap = new Map();

// Prefix-width cache: line text -> Float64Array of prefix widths [0, w0, w0+w1, ...]
// Computed once per unique line string; avoids O(n²) slice allocations on every frame.
const _prefixCache = new Map();
function getPrefixWidths(text) {
  const hit = _prefixCache.get(text);
  if (hit) return hit;
  const pw = new Float64Array(text.length + 1);
  for (let k = 0; k < text.length; k++) {
    pw[k + 1] = measureTextW(text.slice(0, k + 1));
  }
  _prefixCache.set(text, pw);
  return pw;
}

// ─── History delta tracking ───────────────────────────────────────────────────

const _dirtyIds = new Set();
function markDirty(id) { _dirtyIds.add(id); }

// ─── Canvas resize ────────────────────────────────────────────────────────────

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(window.innerWidth * dpr);
  const height = Math.round(window.innerHeight * dpr);
  if (boardCanvas.width === width && boardCanvas.height === height) return;
  boardCanvas.width = width;
  boardCanvas.height = height;
  invalidateOffscreen();
  scheduleRender(true, false);
}

// Wraps obj.data.content into lines with character-index tracking.
// Cached by (id, content, w) — auto-invalidates on any change, never hits JSON.stringify.
// Returns [{text: string, startIndex: number, endIndex: number, nextStartIndex: number}]
function getWrappedLines(obj) {
  const cached = _linesCacheMap.get(obj.id);
  if (cached && cached.content === obj.data.content && cached.w === obj.w) return cached.lines;

  const maxW = obj.w - TEXT_PAD * 2;
  const result = [];

  const isWrapSpace = (ch) => ch === ' ' || ch === '\t';
  const pushLine = (start, end, nextStart = end) => {
    result.push({
      text: obj.data.content.slice(start, end),
      startIndex: start,
      endIndex: end,
      nextStartIndex: nextStart,
    });
  };

  let paraStart = 0;
  while (paraStart <= obj.data.content.length) {
    const newlineAt = obj.data.content.indexOf('\n', paraStart);
    const paraEnd = newlineAt === -1 ? obj.data.content.length : newlineAt;

    if (paraStart === paraEnd) {
      result.push({ text: '', startIndex: paraStart, endIndex: paraStart, nextStartIndex: paraStart });
    } else {
      let lineStart = paraStart;
      while (lineStart < paraEnd) {
        let lo = lineStart + 1;
        let hi = paraEnd;
        if (measureTextW(obj.data.content.slice(lineStart, lo)) > maxW) {
          pushLine(lineStart, lo);
          lineStart = lo;
          continue;
        }
        while (lo < hi) {
          const mid = Math.ceil((lo + hi + 1) / 2);
          if (measureTextW(obj.data.content.slice(lineStart, mid)) <= maxW) lo = mid;
          else hi = mid - 1;
        }

        let lineEnd = lo;
        let nextStart = lineEnd;
        if (lineEnd < paraEnd) {
          let breakAt = -1;
          for (let i = lineEnd; i > lineStart; i--) {
            if (isWrapSpace(obj.data.content[i - 1])) {
              breakAt = i - 1;
              break;
            }
          }
          if (breakAt > lineStart) {
            lineEnd = breakAt;
            nextStart = breakAt;
            while (nextStart < paraEnd && isWrapSpace(obj.data.content[nextStart])) nextStart++;
          }
        }

        if (lineEnd <= lineStart) {
          lineEnd = Math.min(lineStart + 1, paraEnd);
          nextStart = lineEnd;
        }
        pushLine(lineStart, lineEnd, nextStart);
        lineStart = nextStart;
      }
    }

    if (newlineAt === -1) break;
    paraStart = newlineAt + 1;
  }

  _linesCacheMap.set(obj.id, { content: obj.data.content, w: obj.w, lines: result });
  return result;
}

function getTextAutoHeight(obj, minLines = 1) {
  return Math.max(minLines * LINE_H + TEXT_PAD * 2, getWrappedLines(obj).length * LINE_H + TEXT_PAD * 2);
}

function syncTextAutoHeight(obj, minLines = 1) {
  if (!obj || obj.type !== 'text') return false;
  const h = getTextAutoHeight(obj, minLines);
  if (obj.h === h) return false;
  obj.h = h;
  return true;
}

function getTextMinLines(obj) {
  return obj && obj.id === editingId ? (obj._editMinLines || 1) : 1;
}

function syncAllTextAutoHeights() {
  let changed = false;
  for (const obj of objects) {
    if (syncTextAutoHeight(obj)) {
      markDirty(obj.id);
      changed = true;
    }
  }
  return changed;
}

// Per-line layout for the editing object (world coords).
// Prefix widths keep caret positions aligned with rendered glyphs without
// allocating one object per character.
// Each entry: { text, startIndex, endIndex, nextStartIndex, y, prefixWidths }
function calculateTextLayout(obj) {
  const lines = getWrappedLines(obj);
  return lines.map((line, i) => {
    const y = obj.y + TEXT_PAD + i * LINE_H;
    return {
      text: line.text,
      startIndex: line.startIndex,
      endIndex: line.endIndex,
      nextStartIndex: line.nextStartIndex,
      y,
      prefixWidths: getPrefixWidths(line.text),
    };
  });
}

function getTextLayout(obj) {
  if (obj._layoutCache) return obj._layoutCache;
  obj._layoutCache = calculateTextLayout(obj);
  return obj._layoutCache;
}

function lineXAtOffset(line, obj, offset) {
  return obj.x + TEXT_PAD + line.prefixWidths[Math.max(0, Math.min(offset, line.text.length))];
}

function lineEndX(line, obj) {
  return lineXAtOffset(line, obj, line.text.length);
}

function layoutHitTest(layout, wx, wy, obj) {
  if (!layout.length) return 0;
  let line = layout[layout.length - 1];
  for (let i = 0; i < layout.length; i++) {
    if (wy < layout[i].y + LINE_H) { line = layout[i]; break; }
  }
  if (!line.text.length) return line.startIndex;
  const baseX = obj.x + TEXT_PAD;
  const pw = line.prefixWidths;
  for (let j = 0; j < line.text.length; j++) {
    if (wx < baseX + pw[j] + (pw[j + 1] - pw[j]) / 2) {
      TextSelDebug._logHit(wx, wy, obj, line, line.startIndex + j, pw);
      return line.startIndex + j;
    }
  }
  TextSelDebug._logHit(wx, wy, obj, line, line.startIndex + line.text.length, pw);
  return line.startIndex + line.text.length;
}

function drawImageObj(context, obj, img) {
  const flipX = !!obj.data.flipX;
  const flipY = !!obj.data.flipY;
  if (flipX || flipY) {
    context.save();
    context.translate(obj.x + (flipX ? obj.w : 0), obj.y + (flipY ? obj.h : 0));
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    context.drawImage(img, 0, 0, obj.w, obj.h);
    context.restore();
    return;
  }

  context.drawImage(img, obj.x, obj.y, obj.w, obj.h);
}

// Draws a single non-editing object onto any canvas context (world coords).
function drawSingleObj(context, obj, counters = null) {
  if (obj.type === 'text') {
    context.fillStyle = '#ffffff';
    const lines = getWrappedLines(obj);
    for (let i = 0; i < lines.length; i++) {
      context.fillText(lines[i].text, obj.x + TEXT_PAD, obj.y + TEXT_PAD + i * LINE_H);
    }
  } else if (obj.type === 'image') {
    const key = obj.data.imgKey;
    const bitmap = imageBitmapCache[key];
    const img = bitmap || (imageBitmapFailed.has(obj.data.imgKey) ? imageCache[obj.data.imgKey] : null);
    if (img && (bitmap || (img.complete && img.naturalWidth > 0))) {
      if (counters) {
        if (bitmap) counters.bitmapImages++;
        else counters.elementImages++;
      }
      drawImageObj(context, obj, img);
    }
  }
}


function drawBoard() {
  const dbg = ViewportDebug.start('drawBoard', { source: _activeRenderSource, objectCount: objects.length, editing: !!editingId, offscreenDirty: _offscreenDirty });
  if (_boardOpening) {
    ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  let drawnImages = 0;
  let drawnText = 0;
  const counters = { bitmapImages: 0, elementImages: 0, croppedImages: 0 };
  const dpr = window.devicePixelRatio || 1;

  if (editingId) {
    if (_offscreenDirty) {
      // Kick off async rebuild (pre-decodes images to avoid GPU stall).
      // Draw all objects directly this frame while the rebuild is pending.
      _rebuildOffscreenAsync();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#232322';
      ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
      ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
      setCanvasImageQuality(ctx);
      ctx.font = FONT;
      ctx.textBaseline = 'top';
      for (const obj of objects) {
        if (obj.id === editingId) continue;
        drawSingleObj(ctx, obj, counters);
        if (obj.type === 'image') drawnImages++;
        else if (obj.type === 'text') drawnText++;
      }
    } else {
      // Blit cached offscreen (background + all non-editing objects)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(_offscreen, 0, 0);
    }

    // Draw editing object on top
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
    const obj = objectsMap.get(editingId);
    if (obj && obj.type === 'text') {
      ctx.font = FONT;
      ctx.textBaseline = 'top';

      const selStart = _editEl ? _editEl.selectionStart : 0;
      const selEnd   = _editEl ? _editEl.selectionEnd   : 0;
      const layout = getTextLayout(obj);

      // Selection highlight
      if (selStart !== selEnd) {
        ctx.fillStyle = 'rgba(10, 132, 255, 0.3)';
        for (const line of layout) {
          const ls = line.startIndex, textEnd = ls + line.text.length;
          const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
          if (h0 < h1) {
            const o0 = h0 - ls, o1 = h1 - ls;
            const endX = lineEndX(line, obj);
            const x1 = o0 < line.text.length ? lineXAtOffset(line, obj, o0) : endX;
            const x2 = o1 < line.text.length ? lineXAtOffset(line, obj, o1) : endX;
            TextSelDebug._logDraw(line, selStart, selEnd, x1, x2);
            ctx.fillRect(x1, line.y - (IS_WIN ? 5 : 1), x2 - x1, LINE_H);
          }
        }
      }

      // Text
      ctx.fillStyle = '#ffffff';
      for (const line of layout) ctx.fillText(line.text, obj.x + TEXT_PAD, line.y);

      // Caret
      if (selStart === selEnd && _caretVisible) {
        let cx = obj.x + TEXT_PAD, cy = obj.y + TEXT_PAD;
        for (const line of layout) {
          const ls = line.startIndex, le = line.endIndex ?? (ls + line.text.length);
          if (selStart >= ls && selStart <= le) {
            const off = selStart - ls;
            cx = off < line.text.length ? lineXAtOffset(line, obj, off) : lineEndX(line, obj);
            cy = line.y;
            break;
          }
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx, cy - (IS_WIN ? 5 : 1), 2 / zoom, LINE_H);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#232322';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
    setCanvasImageQuality(ctx);
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    for (const obj of objects) {
      drawSingleObj(ctx, obj, counters);
      if (obj.type === 'image') drawnImages++;
      else if (obj.type === 'text') drawnText++;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ViewportDebug.count('croppedImages', counters.croppedImages);
  ViewportDebug.end(dbg, { drawnImages, drawnText, culledImages: 0, culledText: 0, ...counters });
}

function hitTest(wx, wy) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (wx >= obj.x && wx <= obj.x + obj.w && wy >= obj.y && wy <= obj.y + obj.h) return obj;
  }
  return null;
}

function applyTransform(frameDbg = null) {
  const dbg = ViewportDebug.start('applyTransform', { editing: !!editingId, panX, panY, zoom, objectCount: objects.length, selectedCount: selectedIds.size });
  if (_boardOpening) {
    ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  if (editingId) invalidateOffscreen();
  const drawStart = performance.now();
  drawBoard();
  const drawMs = performance.now() - drawStart;
  ViewportDebug.step(dbg, 'drawBoard', { ms: drawMs });
  ViewportDebug.step(frameDbg, 'drawBoard', { ms: drawMs });
  const zoomStart = performance.now();
  updateZoomDisplay();
  const zoomMs = performance.now() - zoomStart;
  ViewportDebug.step(dbg, 'updateZoomDisplay', { ms: zoomMs });
  ViewportDebug.step(frameDbg, 'updateZoomDisplay', { ms: zoomMs });
  const saveStart = performance.now();
  saveViewport();
  const saveMs = performance.now() - saveStart;
  ViewportDebug.step(dbg, 'saveViewport', { ms: saveMs });
  ViewportDebug.step(frameDbg, 'saveViewport', { ms: saveMs });
  const overlayStart = performance.now();
  updateSelectionOverlay();
  const overlayMs = performance.now() - overlayStart;
  ViewportDebug.step(dbg, 'updateSelectionOverlay', { ms: overlayMs });
  ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: overlayMs });
  scheduleVisibleHydrationAfterIdle();
  ViewportDebug.end(dbg);
}

function toWorld(sx, sy) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

let _frameRaf = null;
let _needTransform = false;
let _needBoardRender = false;
let _needOverlayRender = false;
let _frameScheduledAt = 0;
let _frameSources = [];
let _activeRenderSource = 'direct';

function setCanvasImageQuality(context) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
}

function withRenderSource(source, fn) {
  const prev = _activeRenderSource;
  _activeRenderSource = source || prev;
  try {
    return fn();
  } finally {
    _activeRenderSource = prev;
  }
}

function scheduleFrame(source = 'unknown') {
  if (source) _frameSources.push(source);
  if (_frameRaf) {
    ViewportDebug.count('coalescedFrames');
    return;
  }
  _frameScheduledAt = performance.now();
  ViewportDebug.count('scheduledFrames');
  _frameRaf = requestAnimationFrame(() => {
    const sources = [...new Set(_frameSources)];
    _frameSources = [];
    const frameDbg = ViewportDebug.frameStart(performance.now() - _frameScheduledAt);
    ViewportDebug.step(frameDbg, 'sources', { sources: sources.join(',') });
    _frameRaf = null;
    const doTransform = _needTransform;
    const doBoard = _needBoardRender;
    const doOverlay = _needOverlayRender;
    _needTransform = false;
    _needBoardRender = false;
    _needOverlayRender = false;

    if (doTransform) {
      ViewportDebug.count('transformFrames');
      const transformStart = performance.now();
      withRenderSource(sources.join(',') || 'transform', () => applyTransform(frameDbg));
      ViewportDebug.step(frameDbg, 'applyTransformCall', { ms: performance.now() - transformStart });
      ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sources.join(',') });
      return;
    }
    if (doBoard) {
      ViewportDebug.count('boardFrames');
      withRenderSource(sources.join(',') || 'board', () => drawBoard());
    }
    if (doOverlay) {
      const overlayStart = performance.now();
      ViewportDebug.count('overlayFrames');
      updateSelectionOverlay();
      ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: performance.now() - overlayStart });
    }
    ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sources.join(',') });
  });
}

function scheduleTransform(source = 'transform') {
  _needTransform = true;
  scheduleFrame(source);
}

function scheduleRender(board = true, overlay = true, source = 'render') {
  if (board) _needBoardRender = true;
  if (overlay) _needOverlayRender = true;
  scheduleFrame(source);
}



// ─── Object state ─────────────────────────────────────────────────────────────

let zCounter = 1;
let selectedId = null;
const selectedIds = new Set();
let editingId  = null;
let objects    = [];
const objectsMap = new Map();
let idCounter  = 1;
let _boardOpening = false;

function rebuildObjectsMap() {
  objectsMap.clear();
  for (const obj of objects) objectsMap.set(obj.id, obj);
}

function newId() { return 'obj-' + (idCounter++); }

function cloneObject(obj) {
  HistoryDebug.count('cloneObjectCalls');
  const data = obj.type === 'image'
    ? { imgKey: obj.data.imgKey, flipX: !!obj.data.flipX, flipY: !!obj.data.flipY }
    : { content: normalizeTextContent(obj.data.content) };
  return {
    id: obj.id,
    type: obj.type,
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    z: obj.z,
    data,
  };
}

function cloneObjects(list) {
  const dbg = HistoryDebug.start('cloneObjects', { objectCount: list.length });
  const t0 = performance.now();
  HistoryDebug.count('cloneObjectsCalls');
  HistoryDebug.count('clonedObjects', list.length);
  const clones = new Array(list.length);
  for (let i = 0; i < list.length; i++) clones[i] = cloneObject(list[i]);
  const ms = performance.now() - t0;
  HistoryDebug.max('maxCloneObjectsMs', ms);
  HistoryDebug.end(dbg, { objectCount: list.length, ms });
  return clones;
}

function bringObjectToFront(id) {
  const idx = objects.findIndex((o) => o.id === id);
  if (idx < 0 || idx === objects.length - 1) return;
  const [obj] = objects.splice(idx, 1);
  objects.push(obj);
}

function sendSelectedToBack() {
  if (!selectedIds.size) return;
  // Pull out selected objects (preserving their relative order), prepend to front
  const selected = [], rest = [];
  for (const o of objects) (selectedIds.has(o.id) ? selected : rest).push(o);
  objects.length = 0;
  objects.push(...selected, ...rest);
  scheduleRender(true, true);
  pushHistory();
}

function flipSelectedImages(axis) {
  const dbg = ClipDebug.start('flipSelectedImages', { axis, selectedCount: selectedIds.size });
  let flipped = false;
  let imageCount = 0;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'image') continue;
    imageCount++;
    if (axis === 'x') obj.data.flipX = !obj.data.flipX;
    else obj.data.flipY = !obj.data.flipY;
    markDirty(obj.id);
    flipped = true;
  }
  ClipDebug.step(dbg, 'toggle-flags', { imageCount, flipped });
  if (!flipped) { ClipDebug.end(dbg, { skipped: true }); return; }
  invalidateOffscreen();
  scheduleRender(true, true);
  pushHistory();
  ClipDebug.end(dbg, { historyIndex });
}

function isMultiSelected() {
  return selectedIds.size > 1;
}

function hasSelection() {
  return selectedIds.size > 0;
}

function isSelected(id) {
  return selectedIds.has(id);
}

function getFirstSelectedObject() {
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj) return obj;
  }
  return null;
}

// ─── Image store (keeps base64 data OUT of history snapshots) ─────────────────

const imageStore = {};
const imageCache = {}; // key -> HTMLImageElement (for clipboard/metadata operations)
const imageAssetUrlCache = {}; // key -> Tauri asset URL for display-only native images
const imageBitmapCache = {}; // key -> ImageBitmap (GPU-resident, never evicted by WebKit)
const imageBitmapFailed = new Set();
const imageSourceCachePromises = new Map();
const imageClipboardCachePromises = new Map();
const imageHydrationPromises = new Map();
const imageAssetMaterializePromises = new Map();
let imgKeyCounter = 1;
let _skipImageSourceRegistration = false;
let _imageStoreGeneration = 0;

function newImgKey() { return 'img-' + (imgKeyCounter++); }

function isNativeImageRef(src) {
  return !!(src && typeof src === 'object' && src.native);
}

function imageStoreBytesEstimate(src) {
  if (typeof src === 'string') return src.length;
  if (isNativeImageRef(src)) return JSON.stringify(src).length;
  return 0;
}

function cacheImageSourceForSave(key, src, dbg = null) {
  if (!window.__TAURI__ || !src || isNativeImageRef(src)) return Promise.resolve();
  const existing = imageSourceCachePromises.get(key);
  if (existing) return existing;
  const promise = SaveDebug.invoke(dbg, 'register_image_source', { imgKey: key, dataUrl: src }, { imgKey: key, dataUrl: src })
    .finally(() => imageSourceCachePromises.delete(key));
  imageSourceCachePromises.set(key, promise);
  return promise;
}

function cacheImageForClipboard(key, src, dbg = null) {
  if (!window.__TAURI__ || !src || isNativeImageRef(src)) return Promise.resolve();
  const existing = imageClipboardCachePromises.get(key);
  if (existing) return existing;
  const vpDbg = ViewportDebug.start('clipboardPrecache', { key, src });
  const t0 = performance.now();
  ViewportDebug.count('clipboardPrecacheStarts');
  const promise = ClipDebug.invoke(dbg, 'cache_image_for_clipboard', { imgKey: key, dataUrl: src }, { imgKey: key, dataUrl: src })
    .then((result) => {
      const ms = performance.now() - t0;
      ViewportDebug.max('maxClipboardPrecacheMs', ms);
      ViewportDebug.end(vpDbg, { ok: true, ms });
      return result;
    })
    .catch((err) => {
      const ms = performance.now() - t0;
      ViewportDebug.count('clipboardPrecacheFailures');
      ViewportDebug.max('maxClipboardPrecacheMs', ms);
      ViewportDebug.end(vpDbg, { ok: false, ms, error: String(err) });
      throw err;
    })
    .finally(() => imageClipboardCachePromises.delete(key));
  imageClipboardCachePromises.set(key, promise);
  return promise;
}

function storeImage(src) {
  const dbg = ClipDebug.start('storeImage', { src });
  const key = newImgKey();
  imageStore[key] = src;
  cacheImage(key, src, dbg);
  ClipDebug.step(dbg, 'registered-js-image', { key });
  const cachePromise = imageClipboardCachePromises.get(key);
  if (cachePromise) cachePromise.catch(() => {}).finally(() => ClipDebug.end(dbg, { key }));
  else ClipDebug.end(dbg, { key });
  return key;
}

function imageNeedsRendering(obj) {
  return !!(obj?.data?.flipX || obj?.data?.flipY);
}

function renderImageToCanvas(obj, sourceImg = null) {
  const dbg = ClipDebug.start('renderImageToCanvas', {
    id: obj?.id,
    imgKey: obj?.data?.imgKey,
    flipX: !!obj?.data?.flipX,
    flipY: !!obj?.data?.flipY,
  });
  const img = sourceImg || imageCache[obj.data.imgKey];
  if (!img || !img.complete || !img.naturalWidth) {
    ClipDebug.end(dbg, { ready: false });
    return null;
  }
  const tmp = document.createElement('canvas');
  tmp.width = img.naturalWidth;
  tmp.height = img.naturalHeight;
  const tctx = tmp.getContext('2d');
  const flipX = !!obj.data.flipX;
  const flipY = !!obj.data.flipY;
  tctx.save();
  tctx.translate(flipX ? tmp.width : 0, flipY ? tmp.height : 0);
  tctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  tctx.drawImage(img, 0, 0);
  tctx.restore();
  ClipDebug.end(dbg, { ready: true, width: tmp.width, height: tmp.height });
  return tmp;
}

function canvasToPngBlob(canvas) {
  const dbg = ClipDebug.start('canvasToPngBlob', { width: canvas?.width, height: canvas?.height });
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      ClipDebug.end(dbg, { blobSize: blob?.size || 0 });
      resolve(blob);
    }, 'image/png');
  });
}

async function getRenderedImageDataUrl(obj) {
  const src = await ensureImageDataUrl(obj.data.imgKey);
  if (!src || !imageNeedsRendering(obj)) return src;
  let img = imageCache[obj.data.imgKey];
  if (!img || !img.complete || !img.naturalWidth) {
    img = await loadImageElement(src).catch(() => null);
  }
  const canvas = renderImageToCanvas(obj, img);
  return canvas ? canvas.toDataURL('image/png') : '';
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function convertTauriFileSrc(path) {
  if (window.__TAURI__?.core?.convertFileSrc) return window.__TAURI__.core.convertFileSrc(path);
  if (window.__TAURI_INTERNALS__?.convertFileSrc) return window.__TAURI_INTERNALS__.convertFileSrc(path, 'asset');
  return path;
}

async function materializeImageAssets(keys, dbg = null) {
  const pending = keys.filter((key) => isNativeImageRef(imageStore[key]) && !imageAssetUrlCache[key]);
  if (!pending.length || !window.__TAURI__) return 0;
  const promiseKey = pending.slice().sort().join('|');
  const existing = imageAssetMaterializePromises.get(promiseKey);
  if (existing) return existing;
  const generation = _imageStoreGeneration;
  const promise = OpenDebug.invoke(
    dbg,
    'materialize_cached_image_sources',
    { imgKeys: pending },
    { count: pending.length }
  )
    .then((entries) => {
      let count = 0;
      if (generation !== _imageStoreGeneration) return 0;
      for (const entry of entries || []) {
        const key = entry.img_key || entry.imgKey;
        if (!key || !entry.path || !isNativeImageRef(imageStore[key])) continue;
        imageAssetUrlCache[key] = convertTauriFileSrc(entry.path);
        count++;
      }
      OpenDebug.step(dbg, 'materialize-image-assets', { requested: pending.length, count });
      return count;
    })
    .finally(() => imageAssetMaterializePromises.delete(promiseKey));
  imageAssetMaterializePromises.set(promiseKey, promise);
  return promise;
}

async function ensureImageDisplaySrc(key, dbg = null) {
  if (imageAssetUrlCache[key]) return { src: imageAssetUrlCache[key], source: 'asset', dataUrlLen: 0 };
  const stored = imageStore[key];
  if (typeof stored === 'string') return { src: stored, source: 'data-url', dataUrlLen: stored.length };
  if (!isNativeImageRef(stored)) return { src: '', source: 'missing', dataUrlLen: 0 };
  try {
    await materializeImageAssets([key], dbg);
    if (imageAssetUrlCache[key]) return { src: imageAssetUrlCache[key], source: 'asset', dataUrlLen: 0 };
  } catch (err) {
    OpenDebug.step(dbg, 'materialize-image-assets:error', { imgKey: key, error: String(err) });
  }
  const dataUrl = await ensureImageDataUrl(key, dbg);
  return { src: dataUrl, source: 'data-url-fallback', dataUrlLen: dataUrl?.length || 0 };
}

async function ensureImageDataUrl(key, dbg = null) {
  const src = imageStore[key];
  if (typeof src === 'string') return src;
  if (!isNativeImageRef(src) || !window.__TAURI__) return '';
  const existing = imageHydrationPromises.get(key);
  if (existing) return existing;
  const generation = _imageStoreGeneration;
  const promise = OpenDebug.invoke(dbg, 'get_cached_image_data_url', { imgKey: key }, { imgKey: key })
    .then((dataUrl) => {
      if (generation === _imageStoreGeneration && isNativeImageRef(imageStore[key])) imageStore[key] = dataUrl;
      return dataUrl;
    })
    .finally(() => imageHydrationPromises.delete(key));
  imageHydrationPromises.set(key, promise);
  return promise;
}

let _imageHydrationScheduled = false;
const _imageHydrationQueue = [];
const _imageHydrationQueued = new Set();

function queueImageHydration(key, dbg = null) {
  if (!isNativeImageRef(imageStore[key]) || imageCache[key] || _imageHydrationQueued.has(key)) return;
  _imageHydrationQueued.add(key);
  _imageHydrationQueue.push({ key, dbg });
  scheduleImageHydration();
}

function scheduleImageHydration() {
  if (_imageHydrationScheduled) return;
  _imageHydrationScheduled = true;
  requestAnimationFrame(processImageHydrationQueue);
}

function processImageHydrationQueue() {
  _imageHydrationScheduled = false;
  const batchStart = performance.now();
  let count = 0;
  while (_imageHydrationQueue.length && count < 1 && performance.now() - batchStart < 6) {
    const { key, dbg } = _imageHydrationQueue.shift();
    _imageHydrationQueued.delete(key);
    if (!isNativeImageRef(imageStore[key]) || imageCache[key]) continue;
    count++;
    ensureImageDataUrl(key, dbg)
      .then((dataUrl) => {
        if (dataUrl && !imageCache[key]) cacheImage(key, dataUrl, null, false);
      })
      .catch((err) => OpenDebug.step(dbg, 'hydrate-image:error', { imgKey: key, error: String(err) }));
  }
  if (_imageHydrationQueue.length) scheduleImageHydration();
}

function cacheImage(key, src, dbg = null, preCacheClipboard = true, loadedImg = null) {
  if (imageCache[key]) return;
  if (isNativeImageRef(src)) return;
  if (typeof src !== 'string' || !src) return;
  imageBitmapFailed.delete(key);
  const vpDbg = ViewportDebug.start('cacheImage', { key, src, preCacheClipboard, reusedLoadedImage: !!loadedImg });
  const img = loadedImg || new Image();
  // decode() ensures the image is GPU-decoded before the first drawImage call,
  // preventing a synchronous main-thread decode stall (can be 100s of ms for large images).
  // We also defer invalidateOffscreen/scheduleRender until decode completes so that
  // multiple concurrent image loads coalesce into fewer render calls.
  const loadStart = performance.now();
  function finishLoad() {
    const loadMs = performance.now() - loadStart;
    ViewportDebug.count('imageLoads');
    ViewportDebug.max('maxImageLoadMs', loadMs);
    ViewportDebug.step(vpDbg, 'load', { width: img.naturalWidth, height: img.naturalHeight, ms: loadMs });

    const decodeStart = performance.now();
    img.decode()
      .then(() => {
        const decodeMs = performance.now() - decodeStart;
        ViewportDebug.count('imageDecodes');
        ViewportDebug.max('maxImageDecodeMs', decodeMs);
        ViewportDebug.step(vpDbg, 'decode', { ms: decodeMs });
        const bitmapStart = performance.now();
        return createImageBitmap(img).then(bitmap => {
          const bitmapMs = performance.now() - bitmapStart;
          imageBitmapCache[key] = bitmap;
          ViewportDebug.count('imageBitmaps');
          ViewportDebug.max('maxImageBitmapMs', bitmapMs);
          ViewportDebug.step(vpDbg, 'createImageBitmap', { ms: bitmapMs });
          return ensureImagePreviewBitmap(key, img, dbg);
        });
      })
      .catch((err) => {
        imageBitmapFailed.add(key);
        ViewportDebug.count('imageBitmapFailures');
        ViewportDebug.step(vpDbg, 'decode-or-bitmap-error', { error: String(err) });
      })
      .finally(() => {
        invalidateOffscreen();
        scheduleRender(true, false, 'image-load');
        ViewportDebug.end(vpDbg, { key, bitmapReady: !!imageBitmapCache[key] });
      });
  }
  img.onload = finishLoad;
  img.onerror = () => {
    imageBitmapFailed.add(key);
    ViewportDebug.end(vpDbg, { key, error: 'image load failed' });
  };
  imageCache[key] = img;
  if (loadedImg) {
    ViewportDebug.step(vpDbg, 'reuse-loaded-image', { width: img.naturalWidth, height: img.naturalHeight });
    finishLoad();
  } else {
    img.src = src;
    ViewportDebug.step(vpDbg, 'set-src', { src });
  }
  if (!_skipImageSourceRegistration) cacheImageSourceForSave(key, src).catch(() => {});
  if (preCacheClipboard) cacheImageForClipboard(key, src, dbg).catch(() => {});
}

function clearImageStore(clearNativeCaches = true) {
  _imageStoreGeneration++;
  for (const k of Object.keys(imageStore)) delete imageStore[k];
  for (const k of Object.keys(imageCache)) delete imageCache[k];
  for (const k of Object.keys(imageAssetUrlCache)) delete imageAssetUrlCache[k];
  for (const k of Object.keys(imageBitmapCache)) { imageBitmapCache[k].close(); delete imageBitmapCache[k]; }
  imageBitmapFailed.clear();
  imageSourceCachePromises.clear();
  imageClipboardCachePromises.clear();
  imageHydrationPromises.clear();
  imageAssetMaterializePromises.clear();
  _imageHydrationQueue.length = 0;
  _imageHydrationQueued.clear();
  _imageHydrationScheduled = false;
  imgKeyCounter = 1;
  if (clearNativeCaches && window.__TAURI__) {
    window.__TAURI__.core
      .invoke('clear_clipboard_image_cache')
      .catch((err) => console.warn('[clipboard-cache] clear_clipboard_image_cache failed:', err));
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

function trimHistory() {
  if (history.length > MAX_HISTORY) {
    const trim = history.length - MAX_HISTORY;
    history.splice(0, trim);
    historyIndex = Math.max(-1, historyIndex - trim);
    savedHistoryIndex = Math.max(-1, savedHistoryIndex - trim);
  }
}

function snapshot() {
  const dbg = HistoryDebug.start('snapshot', { objectCount: objects.length, historyLength: history.length, historyIndex });
  const t0 = performance.now();
  HistoryDebug.count('snapshots');
  history.length = historyIndex + 1;
  const objectsSnapshot = cloneObjects(objects);
  HistoryDebug.step(dbg, 'cloneObjects', { objectCount: objectsSnapshot.length });
  const editState = captureEditState();
  HistoryDebug.step(dbg, 'captureEditState', { editState: !!editState });
  history.push({
    objects: objectsSnapshot,
    editState,
  });
  historyIndex = history.length - 1;
  _dirtyIds.clear();
  trimHistory();
  const ms = performance.now() - t0;
  HistoryDebug.max('maxSnapshotMs', ms);
  HistoryDebug.end(dbg, { ms, historyLength: history.length, historyIndex });
}

// Delta push: only deep-clones objects that changed since last snapshot.
// Unchanged objects share the previous snapshot's reference (safe since
// restoreSnapshot always deep-clones before mutating).
function pushHistory() {
  const dbg = HistoryDebug.start('pushHistory', {
    objectCount: objects.length,
    dirtyCount: _dirtyIds.size,
    historyLength: history.length,
    historyIndex,
  });
  const t0 = performance.now();
  HistoryDebug.count('pushHistory');
  history.length = historyIndex + 1;
  const prevEntry = historyIndex >= 0 ? history[historyIndex] : [];
  const prevObjects = Array.isArray(prevEntry) ? prevEntry : (prevEntry.objects || []);
  const prevMap = new Map();
  for (const o of prevObjects) prevMap.set(o.id, o);
  HistoryDebug.step(dbg, 'build-prev-map', { objectCount: prevObjects.length });
  let cloned = 0;
  let reused = 0;
  const entry = objects.map(o =>
    (_dirtyIds.has(o.id) || !prevMap.has(o.id))
      ? (cloned++, cloneObject(o))
      : (reused++, prevMap.get(o.id))
  );
  HistoryDebug.count('clonedObjects', cloned);
  HistoryDebug.count('reusedObjects', reused);
  HistoryDebug.step(dbg, 'clone-dirty-objects', { cloned, reused, objectCount: entry.length });
  _dirtyIds.clear();
  const editState = captureEditState();
  HistoryDebug.step(dbg, 'captureEditState', { editState: !!editState });
  history.push({
    objects: entry,
    editState,
  });
  historyIndex++;
  trimHistory();
  updateTitle();
  const ms = performance.now() - t0;
  HistoryDebug.max('maxPushHistoryMs', ms);
  HistoryDebug.end(dbg, { ms, cloned, reused, historyLength: history.length, historyIndex });
}

function restoreSnapshot(s) {
  const snapshotObjects = Array.isArray(s) ? s : (s?.objects || []);
  const editState = Array.isArray(s) ? null : (s?.editState || null);
  const hadEditing = !!editingId;
  const dbg = HistoryDebug.start('restoreSnapshot', {
    objectCount: snapshotObjects.length,
    historyLength: history.length,
    historyIndex,
    selectedCount: selectedIds.size,
    editState: !!editState,
  });
  const t0 = performance.now();
  HistoryDebug.count('restores');
  if (editingId) {
    clearInterval(_caretBlinkInterval);
    _caretBlinkInterval = null;
    clearTimeout(_editHistoryTimer);
    _editHistoryTimer = null;
    _editHistoryLastContent = null;
    if (_selChangeListener) {
      document.removeEventListener('selectionchange', _selChangeListener);
      _selChangeListener = null;
    }
    if (_editEl) _editEl.remove();
    editingId = null;
    _editEl = null;
  }
  HistoryDebug.step(dbg, 'clear-editing', { hadEditing });
  const prevSelectedIds = new Set(selectedIds);
  objects = cloneObjects(snapshotObjects);
  HistoryDebug.step(dbg, 'clone-snapshot', { objectCount: objects.length });
  for (const obj of objects) {
    if (obj?.type === 'text') obj.data.content = normalizeTextContent(obj.data?.content);
  }
  HistoryDebug.step(dbg, 'normalize-text', { objectCount: objects.length });
  _dirtyIds.clear();
  _linesCacheMap.clear();
  _prefixCache.clear();
  rebuildObjectsMap();
  HistoryDebug.step(dbg, 'rebuild-caches', { objectCount: objectsMap.size });
  syncAllTextAutoHeights();
  HistoryDebug.step(dbg, 'sync-text-heights');
  invalidateOffscreen();
  // Preserve selection for objects that still exist in the restored state
  selectedId = null;
  selectedIds.clear();
  for (const id of prevSelectedIds) {
    if (objectsMap.has(id)) { selectedIds.add(id); selectedId = id; }
  }
  renderAll();
  HistoryDebug.step(dbg, 'renderAll', { selectedCount: selectedIds.size });

  if (!editState || !editState.id) {
    const ms = performance.now() - t0;
    HistoryDebug.max('maxRestoreMs', ms);
    HistoryDebug.end(dbg, { ms, objectCount: objects.length, selectedCount: selectedIds.size });
    return;
  }
  const obj = objectsMap.get(editState.id);
  if (!obj || obj.type !== 'text') {
    const ms = performance.now() - t0;
    HistoryDebug.max('maxRestoreMs', ms);
    HistoryDebug.end(dbg, { ms, skippedEditRestore: true });
    return;
  }

  selectedId = obj.id;
  selectedIds.clear();
  selectedIds.add(obj.id);
  enterEdit(obj.id);

  if (!_editEl) return;
  const max = _editEl.value.length;
  const start = Math.max(0, Math.min(editState.selectionStart ?? max, max));
  const end = Math.max(0, Math.min(editState.selectionEnd ?? max, max));
  _editEl.setSelectionRange(start, end, editState.selectionDirection || 'none');
  _caretVisible = true;
  scheduleRender(true, true);
  const ms = performance.now() - t0;
  HistoryDebug.max('maxRestoreMs', ms);
  HistoryDebug.end(dbg, { ms, objectCount: objects.length, selectedCount: selectedIds.size, restoredEdit: true });
}

function captureEditState() {
  if (!editingId) return null;
  if (!_editEl) return { id: editingId, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' };
  return {
    id: editingId,
    selectionStart: _editEl.selectionStart,
    selectionEnd: _editEl.selectionEnd,
    selectionDirection: _editEl.selectionDirection || 'none',
  };
}

function undo() {
  if (historyIndex <= 0) return;
  HistoryDebug.count('undo');
  const dbg = HistoryDebug.start('undo', { historyLength: history.length, historyIndex });
  historyIndex--;
  restoreSnapshot(history[historyIndex]);
  updateTitle();
  HistoryDebug.end(dbg, { historyLength: history.length, historyIndex });
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  HistoryDebug.count('redo');
  const dbg = HistoryDebug.start('redo', { historyLength: history.length, historyIndex });
  historyIndex++;
  restoreSnapshot(history[historyIndex]);
  updateTitle();
  HistoryDebug.end(dbg, { historyLength: history.length, historyIndex });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  scheduleRender(true, true, 'renderAll');
}


// ─── Screen-space selection overlay ──────────────────────────────────────────

const _selOverlayStyleState = { transform: '', width: '', height: '' };
const _multiSelBoxes = [];
const _multiSelStyleState = new WeakMap();
const _rubberBandStyleState = { display: '', left: '', top: '', width: '', height: '' };

function _setStyleIfChanged(el, prop, value, state) {
  if (state[prop] === value) return;
  state[prop] = value;
  el.style[prop] = value;
}

function _setMultiBoxDisplayIfChanged(el, value) {
  let state = _multiSelStyleState.get(el);
  if (!state) {
    state = { display: '', transform: '', width: '', height: '' };
    _multiSelStyleState.set(el, state);
  }
  _setStyleIfChanged(el, 'display', value, state);
  return state;
}

function hideMultiSelectionOverlay() {
  if (!multiSelOverlay) return;
  if (multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.remove('visible');
  for (const box of _multiSelBoxes) _setMultiBoxDisplayIfChanged(box, 'none');
}

function updateMultiSelectionOverlay() {
  if (!multiSelOverlay || !isMultiSelected()) {
    hideMultiSelectionOverlay();
    return;
  }

  while (_multiSelBoxes.length < selectedIds.size) {
    const box = document.createElement('div');
    box.className = 'multi-sel-box';
    _multiSelBoxes.push(box);
    _multiSelStyleState.set(box, { display: '', transform: '', width: '', height: '' });
    multiSelOverlay.appendChild(box);
  }

  let selectedIdx = 0;
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    const box = _multiSelBoxes[selectedIdx++];
    const state = _setMultiBoxDisplayIfChanged(box, 'block');
    _setStyleIfChanged(box, 'transform', `translate(${obj.x * zoom + panX}px,${obj.y * zoom + panY}px)`, state);
    _setStyleIfChanged(box, 'width', (obj.w * zoom) + 'px', state);
    _setStyleIfChanged(box, 'height', (obj.h * zoom) + 'px', state);
  }

  for (let i = selectedIdx; i < _multiSelBoxes.length; i++) {
    _setMultiBoxDisplayIfChanged(_multiSelBoxes[i], 'none');
  }

  if (!multiSelOverlay.classList.contains('visible')) multiSelOverlay.classList.add('visible');
}

function updateSelectionOverlay() {
  if (!hasSelection()) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    return;
  }

  const firstSelectedObj = getFirstSelectedObject();
  if (!firstSelectedObj) {
    if (selOverlay.classList.contains('visible')) selOverlay.classList.remove('visible');
    hideMultiSelectionOverlay();
    selectedId = null;
    selectedIds.clear();
    return;
  }

  // Compute bounding box (works for both single and multi-select)
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (!o) continue;
    bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
    bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
  }

  const sx = bx1 * zoom + panX;
  const sy = by1 * zoom + panY;
  const sw = (bx2 - bx1) * zoom;
  const sh = (by2 - by1) * zoom;

  _setStyleIfChanged(selOverlay, 'transform', `translate(${sx}px,${sy}px)`, _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'width', sw + 'px', _selOverlayStyleState);
  _setStyleIfChanged(selOverlay, 'height', sh + 'px', _selOverlayStyleState);
  if (isMultiSelected()) {
    if (!selOverlay.classList.contains('multi')) selOverlay.classList.add('multi');
  } else {
    if (selOverlay.classList.contains('multi')) selOverlay.classList.remove('multi');
  }
  if (editingId) {
    if (!selOverlay.classList.contains('editing')) selOverlay.classList.add('editing');
  } else {
    if (selOverlay.classList.contains('editing')) selOverlay.classList.remove('editing');
  }
  if (!isMultiSelected() && firstSelectedObj.type === 'text') {
    if (!selOverlay.classList.contains('text-resize')) selOverlay.classList.add('text-resize');
  } else {
    if (selOverlay.classList.contains('text-resize')) selOverlay.classList.remove('text-resize');
  }
  updateMultiSelectionOverlay();
  if (!selOverlay.classList.contains('visible')) selOverlay.classList.add('visible');
}

// Init overlay handle listeners once — they always operate on selectedId / selectedIds
(function initOverlayHandles() {
  for (const handle of selOverlay.querySelectorAll('.s-handle')) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;

      // ── Multi-select: scale non-text objects proportionally within bounding box ──
      if (isMultiSelected()) {
        let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o) continue;
          bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
          bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
        }
        const origBX = bx1, origBY = by1, origBW = bx2 - bx1, origBH = by2 - by1;
        const ratio = origBW / origBH;

        const snapshots = [];
        for (const id of selectedIds) {
          const o = objectsMap.get(id);
          if (!o || o.type === 'text') continue;
          snapshots.push({
            id,
            relX: (o.x - origBX) / origBW, relY: (o.y - origBY) / origBH,
            relW: o.w / origBW, relH: o.h / origBH,
          });
        }
        if (!snapshots.length) return;

        const MIN_B = 20;
        let resizeRaf = null, hasPendingResize = false, pendingState = null;

        function applyMultiResize({ bx, by, bw, bh }) {
          for (const snap of snapshots) {
            const o = objectsMap.get(snap.id);
            if (!o) continue;
            o.x = bx + snap.relX * bw; o.y = by + snap.relY * bh;
            o.w = snap.relW * bw; o.h = snap.relH * bh;
          }
          scheduleRender(true, true);
        }

        function scheduleMultiResizeFrame() {
          if (resizeRaf) return;
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = null;
            if (!hasPendingResize) return;
            hasPendingResize = false;
            applyMultiResize(pendingState);
          });
        }

        function onMultiMove(ev) {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          const useX = Math.abs(dx) >= Math.abs(dy);
          let bw = origBW, bh = origBH, bx = origBX, by = origBY;

          if (dir === 'se') { bw = Math.max(MIN_B, useX ? origBW + dx : (origBH + dy) * ratio); }
          else if (dir === 'sw') { bw = Math.max(MIN_B, useX ? origBW - dx : (origBH + dy) * ratio); }
          else if (dir === 'ne') { bw = Math.max(MIN_B, useX ? origBW + dx : (origBH - dy) * ratio); }
          else if (dir === 'nw') { bw = Math.max(MIN_B, useX ? origBW - dx : (origBH - dy) * ratio); }
          bh = bw / ratio;

          if (dir.includes('w')) bx = origBX + origBW - bw;
          if (dir.includes('n')) by = origBY + origBH - bh;

          pendingState = { bx, by, bw, bh };
          hasPendingResize = true;
          scheduleMultiResizeFrame();
        }

        function onMultiUp() {
          document.removeEventListener('mousemove', onMultiMove);
          document.removeEventListener('mouseup', onMultiUp);
          if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = null; }
          if (hasPendingResize) { hasPendingResize = false; applyMultiResize(pendingState); }
          for (const snap of snapshots) markDirty(snap.id);
          pushHistory();
        }

        document.addEventListener('mousemove', onMultiMove);
        document.addEventListener('mouseup', onMultiUp);
        return;
      }

      // ── Single select ──
      if (!selectedId) return;
      const obj = objectsMap.get(selectedId);
      if (!obj) return;

      const { x: ox, y: oy, w: ow, h: oh } = obj;
      const MIN = 20;
      let resizeRaf = null;
      let hasPendingResize = false;
      let pendingResize = { x: ox, y: oy, w: ow, h: oh };

      function applyResize(state) {
        obj.x = state.x;
        obj.y = state.y;
        obj.w = state.w;
        obj.h = state.h;
        if (obj.type === 'text') {
          delete obj._layoutCache;
          syncTextAutoHeight(obj, getTextMinLines(obj));
        }
        scheduleRender(true, true);
      }

      function scheduleResizeFrame() {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          if (!hasPendingResize) return;
          hasPendingResize = false;
          applyResize(pendingResize);
        });
      }

      function onMove(ev) {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let x = ox, y = oy, w = ow, h = oh;

        if (obj.type === 'image') {
          const ratio = ow / oh;
          const useX = Math.abs(dx) >= Math.abs(dy);
          if (dir.includes('e') && dir.includes('s')) { w = Math.max(MIN, useX ? ow + dx : (oh + dy) * ratio); }
          else if (dir.includes('w') && dir.includes('s')) { w = Math.max(MIN, useX ? ow - dx : (oh + dy) * ratio); }
          else if (dir.includes('e') && dir.includes('n')) { w = Math.max(MIN, useX ? ow + dx : (oh - dy) * ratio); }
          else if (dir.includes('w') && dir.includes('n')) { w = Math.max(MIN, useX ? ow - dx : (oh - dy) * ratio); }
          h = w / ratio;
          if (dir.includes('w')) x = ox + ow - w;
          if (dir.includes('n')) y = oy + oh - h;
        } else {
          if (dir.includes('e')) w = Math.max(MIN, ow + dx);
          h = oh;
          if (dir.includes('w')) { w = Math.max(MIN, ow - dx); x = ox + ow - w; }
        }

        pendingResize = { x, y, w, h };
        hasPendingResize = true;
        scheduleResizeFrame();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (resizeRaf) {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = null;
        }
        if (hasPendingResize) {
          hasPendingResize = false;
          applyResize(pendingResize);
        }
        markDirty(obj.id);
        pushHistory();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
})();


// ─── Selection ────────────────────────────────────────────────────────────────

function selectObject(id) {
  if (editingId && editingId !== id) exitEdit();
  selectedIds.clear();
  selectedIds.add(id);
  selectedId = id;
  const obj = objectsMap.get(id);
  if (obj) {
    bringObjectToFront(id);
    markDirty(id);
    obj.z = ++zCounter;
  }
  scheduleRender(true, true);
}

function deselectAll() {
  if (editingId) exitEdit();
  selectedId = null;
  selectedIds.clear();
  scheduleRender(false, true);
}

function selectAllObjects() {
  if (editingId || !objects.length) return;
  selectedIds.clear();
  for (const obj of objects) selectedIds.add(obj.id);
  selectedId = objects[objects.length - 1].id;
  scheduleRender(false, true);
}

function hideMenus() {
  MenuDebug.log('hideMenus', { reason: 'generic' });
  ctxMenu.classList.remove('visible');
  objCtxMenu.classList.remove('visible');
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

function pushEditHistoryIfChanged(id) {
  const obj = objectsMap.get(id);
  if (!obj) return;
  if (_editHistoryLastContent === null) _editHistoryLastContent = obj.data.content;
  if (obj.data.content === _editHistoryLastContent) return;
  markDirty(id);
  pushHistory();
  _editHistoryLastContent = obj.data.content;
}

function scheduleEditHistoryCheckpoint(id) {
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = setTimeout(() => {
    _editHistoryTimer = null;
    pushEditHistoryIfChanged(id);
  }, EDIT_HISTORY_DEBOUNCE_MS);
}


function enterEdit(id) {
  if (editingId === id) return;
  if (editingId) exitEdit();
  editingId = id;

  const obj = objectsMap.get(id);
  if (!obj) return;
  const normalized = normalizeTextContent(obj.data.content);
  if (normalized !== obj.data.content) {
    obj.data.content = normalized;
    delete obj._layoutCache;
    _linesCacheMap.delete(obj.id);
    markDirty(obj.id);
  }
  obj._editStartContent = obj.data.content;
  obj._editMinLines = obj.data.content ? 1 : NEW_TEXT_EDIT_MIN_LINES;
  syncTextAutoHeight(obj, obj._editMinLines);
  _editHistoryLastContent = obj.data.content;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;

  const proxy = document.createElement('textarea');
  proxy.id = 'editor-proxy';
  proxy.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;';
  proxy.value = obj.data.content;
  document.body.appendChild(proxy);
  _editEl = proxy;

  proxy.addEventListener('input', () => {
    markDirty(id);
    obj.data.content = normalizeTextContent(proxy.value);
    if (proxy.value !== obj.data.content) {
      const start = proxy.selectionStart;
      const end = proxy.selectionEnd;
      const direction = proxy.selectionDirection || 'none';
      proxy.value = obj.data.content;
      proxy.setSelectionRange(start, end, direction);
    }
    delete obj._layoutCache;
    const heightChanged = syncTextAutoHeight(obj, obj._editMinLines || 1);
    scheduleEditHistoryCheckpoint(id);
    scheduleRender(true, heightChanged);
  });
  proxy.addEventListener('keydown', (e) => {
    _caretVisible = true;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      proxy.setSelectionRange(0, proxy.value.length, 'none');
      TextSelDebug._logSelection('select-all', proxy);
      scheduleRender(true, false);
      return;
    }

    // The 1px-wide proxy treats all content as a single column, so the browser's
    // own up/down logic navigates char-by-char instead of line-by-line. Intercept
    // and compute line navigation from the canvas layout instead.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const layout = getTextLayout(obj);
      if (!layout.length) { scheduleRender(true, false); return; }

      const isUp = e.key === 'ArrowUp';

      // Which end of the selection to navigate from
      let refPos;
      if (e.shiftKey) {
        const d = proxy.selectionDirection;
        refPos = d === 'backward' ? proxy.selectionStart : proxy.selectionEnd;
      } else {
        refPos = isUp ? proxy.selectionStart : proxy.selectionEnd;
      }

      // Find the line containing refPos
      let refLineIdx = layout.length - 1;
      for (let i = 0; i < layout.length; i++) {
        const ln = layout[i];
        if (refPos >= ln.startIndex && refPos <= (ln.endIndex ?? (ln.startIndex + ln.text.length))) {
          refLineIdx = i; break;
        }
      }
      const refLine = layout[refLineIdx];

      // Caret world-x in the reference line
      const off = refPos - refLine.startIndex;
      const caretX = lineXAtOffset(refLine, obj, off);

      // Find nearest position in the target line
      const targetIdx = isUp ? refLineIdx - 1 : refLineIdx + 1;
      let newPos;
      if (targetIdx < 0) {
        newPos = 0;
      } else if (targetIdx >= layout.length) {
        newPos = proxy.value.length;
      } else {
        newPos = layoutHitTest([layout[targetIdx]], caretX, layout[targetIdx].y, obj);
      }

      if (e.shiftKey) {
        const d = proxy.selectionDirection;
        const anchorPos = d === 'backward' ? proxy.selectionEnd : proxy.selectionStart;
        proxy.setSelectionRange(
          Math.min(anchorPos, newPos), Math.max(anchorPos, newPos),
          anchorPos <= newPos ? 'forward' : 'backward'
        );
      } else {
        proxy.setSelectionRange(newPos, newPos);
      }

      scheduleRender(true, false);
      return;
    }

    scheduleRender(true, false);
  });

  let _prevSelStart = -1, _prevSelEnd = -1;
  _selChangeListener = () => {
    if (document.activeElement !== proxy) return;
    const s = proxy.selectionStart, e = proxy.selectionEnd;
    if (s === _prevSelStart && e === _prevSelEnd && _caretVisible) return;
    _prevSelStart = s; _prevSelEnd = e;
    TextSelDebug._logSelection('selectionchange', proxy);
    _caretVisible = true;
    scheduleRender(true, false);
  };
  document.addEventListener('selectionchange', _selChangeListener);

  _caretVisible = true;
  _caretBlinkInterval = setInterval(() => {
    if (!editingId) return;
    const hasSelection = proxy.selectionStart !== proxy.selectionEnd;
    if (hasSelection) { _caretVisible = true; return; }
    _caretVisible = !_caretVisible;
    scheduleRender(true, false, 'caret-blink');
  }, 500);

  // Offscreen is now stale: it was built with this object; now we exclude it
  invalidateOffscreen();

  proxy.focus({ preventScroll: true });
  proxy.setSelectionRange(proxy.value.length, proxy.value.length);
  scheduleRender(true, true);
}

function exitEdit() {
  if (!editingId) return;
  const id = editingId;
  const proxy = _editEl;
  editingId = null;
  _editEl = null;

  clearInterval(_caretBlinkInterval);
  _caretBlinkInterval = null;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  if (_selChangeListener) {
    document.removeEventListener('selectionchange', _selChangeListener);
    _selChangeListener = null;
  }

  if (proxy) proxy.remove();

  invalidateOffscreen();

  const obj = objectsMap.get(id);
  if (obj) {
    if (obj.data.content.trim() === '') {
      const idx = objects.findIndex((o) => o.id === id);
      if (idx >= 0) objects.splice(idx, 1);
      objectsMap.delete(id);
      _linesCacheMap.delete(id);
      selectedIds.delete(id);
      selectedId = null;
      delete obj._editStartContent;
      delete obj._editMinLines;
      _editHistoryLastContent = null;
      scheduleRender(true, true);
      pushHistory();
      return;
    }
    delete obj._layoutCache;
    const heightChanged = syncTextAutoHeight(obj);
    if (heightChanged) markDirty(id);
    const contentChanged = obj.data.content !== _editHistoryLastContent;
    pushEditHistoryIfChanged(id);
    if (heightChanged && !contentChanged) pushHistory();
    delete obj._editStartContent;
    delete obj._editMinLines;
  }

  _editHistoryLastContent = null;
  scheduleRender(true, true);
  window.getSelection()?.removeAllRanges();
}

// ─── Add objects ─────────────────────────────────────────────────────────────

function addText(wx, wy, content = '') {
  content = normalizeTextContent(content);
  let w = 200, h = content ? LINE_H + TEXT_PAD * 2 : NEW_TEXT_EDIT_MIN_LINES * LINE_H + TEXT_PAD * 2;
  if (content) {
    const lines = content.split('\n');
    const charW = 9.2, pad = 8;
    const maxLineLen = Math.max(...lines.map(l => l.length), 1);
    w = Math.min(Math.max(Math.round(maxLineLen * charW + pad * 2), 120), 700);
  }

  const obj = { id: newId(), type: 'text', x: wx, y: wy, w, h, z: ++zCounter, data: { content } };
  syncTextAutoHeight(obj, content ? 1 : NEW_TEXT_EDIT_MIN_LINES);
  objects.push(obj);
  objectsMap.set(obj.id, obj);
  selectObject(obj.id);
  scheduleRender(true, false);
  pushHistory();
  if (!content) enterEdit(obj.id);
}

let _pasteShieldCount = 0;
function showPasteShield() {
  _pasteShieldCount++;
  openingShield.classList.add('active');
}
function hidePasteShield() {
  _pasteShieldCount = Math.max(0, _pasteShieldCount - 1);
  if (_pasteShieldCount === 0 && !_boardOpening) openingShield.classList.remove('active');
}

function addImage(src, cx, cy, exactSize = false, existingImgKey = null, preCacheClipboard = true) {
  return new Promise((resolve) => {
    const dbg = ViewportDebug.start('addImage', { src, cx, cy, exactSize, existingImgKey, preCacheClipboard });
    const t0 = performance.now();
    ViewportDebug.count('imageAdds');
    if (!_boardOpening) showPasteShield();
    const img = new Image();
    img.onload = () => {
      ViewportDebug.step(dbg, 'load', { width: img.naturalWidth, height: img.naturalHeight, ms: performance.now() - t0 });
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!exactSize) {
        const MAX = 600;
        if (w > MAX || h > MAX) {
          const scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
      }
      ViewportDebug.step(dbg, 'size-object', { w, h });
      const imgKey = existingImgKey || newImgKey();
      imageStore[imgKey] = src;
      cacheImage(imgKey, src, null, preCacheClipboard, img);
      ViewportDebug.step(dbg, 'cache-registered', { imgKey });
      const obj = { id: newId(), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, z: ++zCounter, data: { imgKey } };
      objects.push(obj);
      objectsMap.set(obj.id, obj);
      selectObject(obj.id);
      scheduleRender(true, false, 'add-image');
      pushHistory();
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { id: obj.id, imgKey, total });
      if (!_boardOpening) hidePasteShield();
      resolve(obj);
    };
    img.onerror = () => {
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { error: 'image load failed', total });
      if (!_boardOpening) hidePasteShield();
      resolve(null);
    };
    img.src = src;
    ViewportDebug.step(dbg, 'set-src', { src });
  });
}

// ─── New board ───────────────────────────────────────────────────────────────

async function newBoard() {
  if (objects.length === 0 && !currentFilePath) return;
  if (isDirty()) {
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') { const saved = await saveBoard(); if (!saved) return; }
  }
  const dbg = OpenDebug.start('newBoard', { objectCount: objects.length });
  _boardOpening = true; openingShield.classList.add('active');
  const openingStart = performance.now();
  await showIslandMsg('Opening');
  if (editingId) exitEdit();
  OpenDebug.step(dbg, 'exitEdit', {});
  selectedId = null;
  selectedIds.clear();
  objects = [];
  objectsMap.clear();
  _linesCacheMap.clear();
  _prefixCache.clear();
  invalidateOffscreen();
  OpenDebug.step(dbg, 'clearState', {});
  currentFilePath = null;
  panX = 0; panY = 0; zoom = 1;
  clearImageStore(true);
  OpenDebug.step(dbg, 'clearImageStore', {});
  history = []; historyIndex = -1;
  idCounter = 1; zCounter = 1;
  snapshot();
  markSaved();
  updateTitle();
  const elapsed = performance.now() - openingStart;
  OpenDebug.step(dbg, 'workDone', { elapsed });
  _boardOpening = false; openingShield.classList.remove('active');
  applyTransform();
  restoreIslandZoom();
  OpenDebug.end(dbg, { totalMs: elapsed });
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

function duplicateSelected() {
  if (!selectedIds.size) return;
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  const cloned = [];
  const imageData = {};
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    const o = cloneObject(obj);
    if (o.type === 'image') {
      const src = imageStore[o.data.imgKey];
      if (src) imageData[o.data.imgKey] = src;
    }
    cloned.push(o);
  }
  if (!cloned.length) return;
  setJsClipboard({ type: 'objects', objects: cloned, imageData });
  pasteAtPos(center.x, center.y);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (!hasSelection() || editingId) return;
  let write = 0;
  for (let read = 0; read < objects.length; read++) {
    const obj = objects[read];
    if (selectedIds.has(obj.id)) {
      objectsMap.delete(obj.id);
      _linesCacheMap.delete(obj.id);
      continue;
    }
    objects[write++] = obj;
  }
  objects.length = write;
  selectedId = null;
  selectedIds.clear();
  scheduleRender(true, true);
  pushHistory();
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.1, ZOOM_MAX = 10;

let _editEl = null;
let _caretVisible = true;
let _caretBlinkInterval = null;
let _selChangeListener = null;
let _editHistoryTimer = null;
let _editHistoryLastContent = null;
const EDIT_HISTORY_DEBOUNCE_MS = 500;


canvas.addEventListener('wheel', (e) => {
  const handlerStart = performance.now();
  const dbg = ViewportDebug.start('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, panX, panY, zoom });
  try {
    ViewportDebug.count('wheel');
    e.preventDefault();
    if (editingId) {
      _caretVisible = true;
    }
  if (e.ctrlKey || e.metaKey) {
      ViewportDebug.count('wheelZoom');
      const factor = Math.abs(e.deltaY) < 30
        ? Math.pow(0.995, e.deltaY)
        : e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      panX = e.clientX - (e.clientX - panX) * (newZoom / zoom);
      panY = e.clientY - (e.clientY - panY) * (newZoom / zoom);
      zoom = newZoom;
      scheduleTransform('wheel-zoom');
      ViewportDebug.end(dbg, { mode: 'zoom', newZoom, panX, panY });
      return;
    }

    ViewportDebug.count('wheelPan');
    panX -= e.deltaX;
    panY -= e.deltaY;
    scheduleTransform('wheel-pan');
    ViewportDebug.end(dbg, { mode: 'pan', panX, panY });
  } finally {
    ViewportDebug.timing('wheelHandler', performance.now() - handlerStart);
  }
}, { passive: false });

// ─── Pan (spacebar + left click) ─────────────────────────────────────────────

let _spaceDown = false;

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !editingId && !e.repeat) {
    e.preventDefault();
    _spaceDown = true;
    canvas.classList.add('panning');
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    _spaceDown = false;
    canvas.classList.remove('panning');
  }
});

canvas.addEventListener('mousedown', (e) => {
  // Spacebar pan
  if (e.button === 0 && _spaceDown) {
    const panDbg = ViewportDebug.start('mousePan', { startX: e.clientX, startY: e.clientY, panX, panY, zoom });
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startPanX = panX, startPanY = panY;
    function onMove(ev) {
      const handlerStart = performance.now();
      try {
        ViewportDebug.count('mousePanMoves');
        panX = startPanX + (ev.clientX - startX);
        panY = startPanY + (ev.clientY - startY);
        scheduleTransform('mouse-pan');
      } finally {
        ViewportDebug.timing('mousePanHandler', performance.now() - handlerStart);
      }
    }
    function onUp(ev) {
      if (ev.button !== 0) return;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ViewportDebug.end(panDbg, { endX: ev.clientX, endY: ev.clientY, panX, panY });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return;
  }

  if (e.button !== 0) return;

  // Don't capture clicks on sel-overlay handles
  if (e.target !== canvas && e.target !== boardCanvas) return;

  e.preventDefault();
  const wp = toWorld(e.clientX, e.clientY);
  const obj = hitTest(wp.x, wp.y);
  const additive = e.metaKey || e.ctrlKey;

  // Multi-select: any click inside the bounding box (object or empty space) → drag group
  if (isMultiSelected() && !additive) {
    let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
    for (const id of selectedIds) {
      const o = objectsMap.get(id);
      if (!o) continue;
      bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
      bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
    }
    if (wp.x >= bx1 && wp.x <= bx2 && wp.y >= by1 && wp.y <= by2) {
      const grpStartX = e.clientX, grpStartY = e.clientY;
      const grpItems = [];
      for (const id of selectedIds) {
        const o = objectsMap.get(id);
        if (o) grpItems.push({ obj: o, startX: o.x, startY: o.y });
      }
      let grpMoved = false;
      const grpThreshold = 9 / (zoom * zoom);
      let grpLastDx = 0, grpLastDy = 0, grpRaf = null;
      function applyGrpDrag(dx, dy) {
        for (const item of grpItems) { item.obj.x = item.startX + dx; item.obj.y = item.startY + dy; }
        withRenderSource('group-drag', () => drawBoard());
        updateSelectionOverlay();
      }
      function onGrpMove(ev) {
        const dx = (ev.clientX - grpStartX) / zoom, dy = (ev.clientY - grpStartY) / zoom;
        if (!grpMoved && dx*dx + dy*dy > grpThreshold) grpMoved = true;
        if (!grpMoved) return;
        grpLastDx = dx; grpLastDy = dy;
        if (grpRaf) return;
        grpRaf = requestAnimationFrame(() => { grpRaf = null; applyGrpDrag(grpLastDx, grpLastDy); });
      }
      function onGrpUp() {
        document.removeEventListener('mousemove', onGrpMove);
        document.removeEventListener('mouseup', onGrpUp);
        if (grpRaf) { cancelAnimationFrame(grpRaf); grpRaf = null; }
        if (grpMoved) { applyGrpDrag(grpLastDx, grpLastDy); for (const item of grpItems) markDirty(item.obj.id); pushHistory(); }
      }
      document.addEventListener('mousemove', onGrpMove);
      document.addEventListener('mouseup', onGrpUp);
      return;
    }
  }

  if (!obj) {
    if (!additive) deselectAll();
    const rbStartX = e.clientX, rbStartY = e.clientY;
    let rbActive = false;
    function onRbMove(ev) {
      const dx = ev.clientX - rbStartX, dy = ev.clientY - rbStartY;
      if (!rbActive && dx*dx + dy*dy > 16) rbActive = true;
      if (!rbActive) return;
      const l = Math.min(rbStartX, ev.clientX), t = Math.min(rbStartY, ev.clientY);
      const w = Math.abs(dx), h = Math.abs(dy);
      _setStyleIfChanged(rubberBand, 'display', 'block', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'left', l + 'px', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'top', t + 'px', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'width', w + 'px', _rubberBandStyleState);
      _setStyleIfChanged(rubberBand, 'height', h + 'px', _rubberBandStyleState);
    }
    function onRbUp(ev) {
      document.removeEventListener('mousemove', onRbMove);
      document.removeEventListener('mouseup', onRbUp);
      _setStyleIfChanged(rubberBand, 'display', 'none', _rubberBandStyleState);
      if (!rbActive) return;
      const x1 = Math.min(rbStartX, ev.clientX), y1 = Math.min(rbStartY, ev.clientY);
      const x2 = Math.max(rbStartX, ev.clientX), y2 = Math.max(rbStartY, ev.clientY);
      const wx1 = (x1 - panX) / zoom, wy1 = (y1 - panY) / zoom;
      const wx2 = (x2 - panX) / zoom, wy2 = (y2 - panY) / zoom;
      if (!additive) selectedIds.clear();
      let hitCount = 0;
      for (const o of objects) {
        if (o.x < wx2 && o.x + o.w > wx1 && o.y < wy2 && o.y + o.h > wy1) {
          selectedIds.add(o.id);
          selectedId = o.id;
          hitCount++;
        }
      }
      if (!hitCount) return;
      scheduleRender(true, true);
    }
    document.addEventListener('mousemove', onRbMove);
    document.addEventListener('mouseup', onRbUp);
    return;
  }

  if (additive) {
    if (isSelected(obj.id)) {
      selectedIds.delete(obj.id);
      if (selectedId === obj.id) {
        selectedId = null;
        for (const id of selectedIds) selectedId = id;
      }
      if (editingId && !isSelected(editingId)) exitEdit();
    } else {
      if (editingId && editingId !== obj.id) exitEdit();
      selectedIds.add(obj.id);
      selectedId = obj.id;
      const addedObj = objectsMap.get(obj.id);
      if (addedObj) {
        bringObjectToFront(obj.id);
        markDirty(obj.id);
        addedObj.z = ++zCounter;
      }
    }
    scheduleRender(true, true);
    return;
  }

  // Click inside the currently edited text object: position caret / start drag-select
  if (editingId && obj.id === editingId && selectedIds.size === 1) {
    const layout = getTextLayout(obj);
    const clickIdx = layoutHitTest(layout, wp.x, wp.y, obj);
    if (_editEl) {
      _editEl.focus({ preventScroll: true });
      _editEl.setSelectionRange(clickIdx, clickIdx);
      TextSelDebug._logSelection('mouse-down', _editEl);
      _caretVisible = true;
      scheduleRender(true, false);
    }
    function onSelMove(ev) {
      const wp2 = toWorld(ev.clientX, ev.clientY);
      const endIdx = layoutHitTest(obj._layoutCache || layout, wp2.x, wp2.y, obj);
      if (_editEl) {
        _editEl.setSelectionRange(Math.min(clickIdx, endIdx), Math.max(clickIdx, endIdx));
        TextSelDebug._logSelection('mouse-drag', _editEl);
        _caretVisible = true;
        scheduleRender(true, false);
      }
    }
    function onSelUp() {
      document.removeEventListener('mousemove', onSelMove);
      document.removeEventListener('mouseup', onSelUp);
    }
    document.addEventListener('mousemove', onSelMove);
    document.addEventListener('mouseup', onSelUp);
    return;
  }

  if (editingId && editingId !== obj.id) exitEdit();

  if (!isSelected(obj.id)) selectObject(obj.id);

  const startX = e.clientX, startY = e.clientY;
  const dragItems = [];
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (o) dragItems.push({ obj: o, startX: o.x, startY: o.y });
  }
  let moved = false;
  const moveThreshold = 9 / (zoom * zoom);
  let lastDx = 0, lastDy = 0;
  let dragRaf = null;

  function applyDrag(dx, dy) {
    for (const item of dragItems) {
      item.obj.x = item.startX + dx;
      item.obj.y = item.startY + dy;
    }
    const dragDbg = ViewportDebug.start('dragFrame', { items: dragItems.length });
    withRenderSource('object-drag', () => drawBoard());
    ViewportDebug.end(dragDbg);
    updateSelectionOverlay();
  }

  function scheduleDragFrame() {
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(() => {
      dragRaf = null;
      applyDrag(lastDx, lastDy);
    });
  }

  function onMove(ev) {
    const dx = (ev.clientX - startX) / zoom;
    const dy = (ev.clientY - startY) / zoom;
    if (!moved && dx*dx + dy*dy > moveThreshold) moved = true;
    if (!moved) return;
    lastDx = dx;
    lastDy = dy;
    scheduleDragFrame();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!moved) {
      if (!isSelected(obj.id)) selectObject(obj.id);
      return;
    }
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = null;
    }
    applyDrag(lastDx, lastDy);
    for (const item of dragItems) markDirty(item.obj.id);
    pushHistory();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

canvas.addEventListener('dblclick', (e) => {
  if (isMultiSelected()) return;
  const wp = toWorld(e.clientX, e.clientY);
  const obj = hitTest(wp.x, wp.y);
  if (obj && obj.type === 'text') { selectObject(obj.id); enterEdit(obj.id); }
});


// ─── Context menu ─────────────────────────────────────────────────────────────

let ctxPos = { x: 0, y: 0 };

for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu']) {
  document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:capture`, e), true);
  document.addEventListener(type, (e) => MenuDebug.logDomEvent(`document:${type}:bubble`, e), false);
  ctxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`ctx-menu:${type}`, e));
  objCtxMenu.addEventListener(type, (e) => MenuDebug.logDomEvent(`obj-ctx-menu:${type}`, e));
}

function closeCtxMenu(reason) {
  MenuDebug.log('ctx-menu:close', { reason });
  ctxMenu.classList.remove('visible');
}

function closeObjCtxMenu(reason) {
  MenuDebug.log('obj-ctx-menu:close', { reason });
  objCtxMenu.classList.remove('visible');
}

let _menuPointerCommand = null;
let _lastPointerMenuCommandAt = 0;

function menuCommandFromButton(button) {
  switch (button?.id) {
    case 'btn-new': return () => { closeCtxMenu('command:new'); newBoard(); };
    case 'btn-add-text': return () => { closeCtxMenu('command:add-text'); addText(ctxPos.x, ctxPos.y); };
    case 'btn-add-image': return () => { closeCtxMenu('command:add-image'); fileInput.value = ''; fileInput.click(); };
    case 'btn-paste': return () => { closeCtxMenu('command:paste'); pasteAtPos(ctxPos.x, ctxPos.y); };
    case 'btn-save': return () => { closeCtxMenu('command:save'); saveBoard(); };
    case 'btn-save-as': return () => { closeCtxMenu('command:save-as'); saveBoardAs(); };
    case 'btn-open': return () => { closeCtxMenu('command:open'); openBoard(); };
    case 'btn-export-all-images': return () => { closeCtxMenu('command:export-all-images'); showPasteShield(); exportAllImages(); };
    case 'btn-export-all-text': return () => { closeCtxMenu('command:export-all-text'); exportAllText(); };
    case 'obj-btn-copy': return () => { closeObjCtxMenu('command:copy'); copySelected(); };
    case 'obj-btn-delete': return () => { closeObjCtxMenu('command:delete'); deleteSelected(); };
    case 'obj-btn-duplicate': return () => { closeObjCtxMenu('command:duplicate'); duplicateSelected(); };
    case 'obj-btn-move-to-back': return () => { closeObjCtxMenu('command:move-to-back'); sendSelectedToBack(); };
    case 'obj-btn-flip-horizontal': return () => { closeObjCtxMenu('command:flip-horizontal'); flipSelectedImages('x'); };
    case 'obj-btn-flip-vertical': return () => { closeObjCtxMenu('command:flip-vertical'); flipSelectedImages('y'); };
    case 'obj-btn-save-image': return () => { closeObjCtxMenu('command:save-image'); saveSelectedImage(); };
    case 'obj-btn-save-images': return () => { closeObjCtxMenu('command:save-images'); showPasteShield(); saveSelectedImages(); };
    default: return null;
  }
}

function menuCommandName(button) {
  return button?.id ? button.id.replace(/^(btn|obj-btn)-/, '') : '';
}

function runMenuCommand(button, source) {
  const run = menuCommandFromButton(button);
  if (!run) return false;
  if (source === 'click' && performance.now() - _lastPointerMenuCommandAt < 800) {
    MenuDebug.log('menu:click-command:suppressed', { command: menuCommandName(button) });
    return true;
  }
  MenuDebug.log(button.id.startsWith('obj-') ? 'obj-ctx-menu:command' : 'ctx-menu:command', {
    command: menuCommandName(button),
    source,
  });
  if (source === 'pointerup') _lastPointerMenuCommandAt = performance.now();
  if (source === 'pointerup') {
    setTimeout(run, 0);
  } else {
    run();
  }
  return true;
}

function onMenuPointerDown(e) {
  const button = e.target.closest?.('.ctx-item');
  if (!button || e.button !== 0) return;
  _menuPointerCommand = button;
  MenuDebug.log('menu:pointer-command:start', { command: menuCommandName(button), target: button.id });
}

function onMenuPointerUp(e) {
  if (!_menuPointerCommand || e.button !== 0) return;
  const button = e.target.closest?.('.ctx-item');
  const started = _menuPointerCommand;
  _menuPointerCommand = null;
  if (button !== started) {
    MenuDebug.log('menu:pointer-command:cancel', { started: started.id, ended: button?.id || '' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  runMenuCommand(button, 'pointerup');
}

ctxMenu.addEventListener('pointerdown', onMenuPointerDown);
ctxMenu.addEventListener('pointerup', onMenuPointerUp);
objCtxMenu.addEventListener('pointerdown', onMenuPointerDown);
objCtxMenu.addEventListener('pointerup', onMenuPointerUp);

function updateObjMenuActions() {
  let imageCount = 0;
  for (const id of selectedIds) {
    const o = objectsMap.get(id);
    if (o && o.type === 'image') imageCount++;
  }
  if (copyBtn) copyBtn.style.display = 'block';
  if (imageActionsSep) imageActionsSep.style.display = imageCount >= 1 ? 'block' : 'none';
  if (flipHorizontalBtn) flipHorizontalBtn.style.display = imageCount >= 1 ? 'block' : 'none';
  if (flipVerticalBtn) flipVerticalBtn.style.display = imageCount >= 1 ? 'block' : 'none';
  if (saveImageBtn) saveImageBtn.style.display = imageCount === 1 ? 'block' : 'none';
  if (saveImagesBtn) saveImagesBtn.style.display = imageCount >= 2 ? 'block' : 'none';
  if (exportSep) exportSep.style.display = imageCount >= 1 ? 'block' : 'none';
}

function updateCtxMenuActions() {
  const hasImages = objects.some((o) => o.type === 'image');
  const hasText   = objects.some((o) => o.type === 'text');
  const show = hasImages || hasText;
  if (exportAllTextBtn) exportAllTextBtn.style.display = hasText ? 'block' : 'none';
  if (exportAllImageBtn) exportAllImageBtn.style.display = hasImages ? 'block' : 'none';
  if (exportAllSep) exportAllSep.style.display = show ? 'block' : 'none';
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const wp = toWorld(e.clientX, e.clientY);
  MenuDebug.log('canvas:contextmenu', { x: e.clientX, y: e.clientY, wx: wp.x, wy: wp.y });

  // Multi-select: right-click anywhere inside bounding box shows obj menu
  if (isMultiSelected()) {
    let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
    for (const id of selectedIds) {
      const o = objectsMap.get(id);
      if (!o) continue;
      bx1 = Math.min(bx1, o.x); by1 = Math.min(by1, o.y);
      bx2 = Math.max(bx2, o.x + o.w); by2 = Math.max(by2, o.y + o.h);
    }
    if (wp.x >= bx1 && wp.x <= bx2 && wp.y >= by1 && wp.y <= by2) {
      updateObjMenuActions();
      closeCtxMenu('show-obj-menu:multi');
      objCtxMenu.style.left = e.clientX + 'px';
      objCtxMenu.style.top  = e.clientY + 'px';
      objCtxMenu.classList.add('visible');
      MenuDebug.log('obj-ctx-menu:open', { reason: 'multi', x: e.clientX, y: e.clientY });
      return;
    }
  }

  const obj = hitTest(wp.x, wp.y);
  if (obj) {
    if (!isSelected(obj.id)) selectObject(obj.id);
    updateObjMenuActions();
    closeCtxMenu('show-obj-menu:object');
    objCtxMenu.style.left = e.clientX + 'px';
    objCtxMenu.style.top  = e.clientY + 'px';
    objCtxMenu.classList.add('visible');
    MenuDebug.log('obj-ctx-menu:open', { reason: 'object', objectId: obj.id, objectType: obj.type, x: e.clientX, y: e.clientY });
    return;
  }
  closeObjCtxMenu('show-canvas-menu');
  ctxPos = wp;
  updateCtxMenuActions();
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top  = e.clientY + 'px';
  ctxMenu.classList.add('visible');
  MenuDebug.log('ctx-menu:open', { x: e.clientX, y: e.clientY, wx: wp.x, wy: wp.y });
});

document.getElementById('btn-new').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-new'), 'click');
});

document.getElementById('btn-add-text').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-add-text'), 'click');
});

document.getElementById('btn-add-image').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-add-image'), 'click');
});

document.getElementById('btn-paste').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-paste'), 'click');
});

document.getElementById('btn-save').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-save'), 'click');
});

document.getElementById('btn-save-as').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-save-as'), 'click');
});

document.getElementById('btn-open').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-open'), 'click');
});


fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  await insertImageFiles(files, ctxPos.x, ctxPos.y, 'file-input');
});

async function insertDataUrlImage(dataUrl, x, y, dbg, options = {}) {
  const addPromise = addImage(dataUrl, x, y, false, null, options.preCacheClipboard ?? true);
  hidePasteShield();
  const obj = await addPromise;
  showPasteShield();
  InsertDebug.end(dbg, { added: !!obj, ...(options.endMeta || {}) });
  return obj;
}

async function insertImageFiles(files, x, y, source = 'file-input') {
  const dbg = InsertDebug.start('insertImages', { source, fileCount: files.length });
  if (!files.length) { InsertDebug.end(dbg, { source, skipped: 'no-files' }); return; }
  let added = 0;
  showPasteShield();
  try {
    for (const file of files) {
      if (file.type !== 'image/png' && file.type !== 'image/jpeg') continue;
      const fileDbg = InsertDebug.start('insertImage', { source, fileName: file.name, fileSize: file.size, fileType: file.type });
      try {
        InsertDebug.step(fileDbg, 'read:start', { source, fileName: file.name, fileSize: file.size, fileType: file.type });
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.onerror = () => reject(reader.error || new Error('failed to read image file'));
          reader.readAsDataURL(file);
        });
        InsertDebug.step(fileDbg, 'read:end', { source, dataUrl });
        const obj = await insertDataUrlImage(dataUrl, x, y, fileDbg, { endMeta: { source } });
        if (obj) added++;
      } catch (err) {
        InsertDebug.end(fileDbg, { source, error: String(err) });
      }
    }
    InsertDebug.end(dbg, { source, fileCount: files.length, added });
  } finally {
    hidePasteShield();
  }
}

document.addEventListener('click', (e) => {
  if (ctxMenu.contains(e.target) || objCtxMenu.contains(e.target)) {
    MenuDebug.log('document-click:inside-menu');
    return;
  }
  closeCtxMenu('document-click');
  closeObjCtxMenu('document-click');
});

document.getElementById('obj-btn-copy').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-copy'), 'click');
});

document.getElementById('obj-btn-delete').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-delete'), 'click');
});

document.getElementById('obj-btn-duplicate').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-duplicate'), 'click');
});

document.getElementById('obj-btn-move-to-back').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-move-to-back'), 'click');
});

document.getElementById('obj-btn-flip-horizontal').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-flip-horizontal'), 'click');
});

document.getElementById('obj-btn-flip-vertical').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-flip-vertical'), 'click');
});

document.getElementById('obj-btn-save-image').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-save-image'), 'click');
});

document.getElementById('obj-btn-save-images').addEventListener('click', () => {
  runMenuCommand(document.getElementById('obj-btn-save-images'), 'click');
});

document.getElementById('btn-export-all-images').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-export-all-images'), 'click');
});

document.getElementById('btn-export-all-text').addEventListener('click', () => {
  runMenuCommand(document.getElementById('btn-export-all-text'), 'click');
});

islZoom.addEventListener('mousedown', e => e.preventDefault());
islZoom.addEventListener('click', () => {
  const dbg = ViewportDebug.start('zoomReset', { panX, panY, zoom, objectCount: objects.length });
  deselectAll();
  const vw = window.innerWidth, vh = window.innerHeight;
  const anyVisible = objects.some(o => {
    const sx = o.x * zoom + panX, sy = o.y * zoom + panY;
    return sx + o.w * zoom > 0 && sx < vw && sy + o.h * zoom > 0 && sy < vh;
  });
  const targetZoom = 1;
  let targetPanX, targetPanY;
  if (!anyVisible && objects.length) {
    const cx = (vw / 2 - panX) / zoom, cy = (vh / 2 - panY) / zoom;
    let nearest = null, nearestDist = Infinity;
    for (const o of objects) {
      const d = (o.x + o.w / 2 - cx) ** 2 + (o.y + o.h / 2 - cy) ** 2;
      if (d < nearestDist) { nearestDist = d; nearest = o; }
    }
    targetPanX = vw / 2 - (nearest.x + nearest.w / 2) * targetZoom;
    targetPanY = vh / 2 - (nearest.y + nearest.h / 2) * targetZoom;
  } else {
    targetPanX = vw / 2 - (vw / 2 - panX) * (targetZoom / zoom);
    targetPanY = vh / 2 - (vh / 2 - panY) * (targetZoom / zoom);
  }
  const startPanX = panX, startPanY = panY, startZoom = zoom;
  const startTime = performance.now();
  const duration = 350;
  function animate(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const e = 1 - Math.pow(1 - t, 3);
    zoom = startZoom + (targetZoom - startZoom) * e;
    panX = startPanX + (targetPanX - startPanX) * e;
    panY = startPanY + (targetPanY - startPanY) * e;
    ViewportDebug.step(dbg, 'animate', { t, panX, panY, zoom });
    applyTransform();
    if (t < 1) requestAnimationFrame(animate);
    else ViewportDebug.end(dbg, { panX, panY, zoom });
  }
  requestAnimationFrame(animate);
});

// ─── Drag and drop images ─────────────────────────────────────────────────────

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

// HTML5 drop — works for images dragged from a browser
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const pos = toWorld(e.clientX, e.clientY);
  insertImageFiles([...e.dataTransfer.files], pos.x, pos.y, 'browser-drop');
});

// Tauri native drop — place at center of visible canvas (Rust drop position unreliable)
if (window.__TAURI__) {
  window.__TAURI__.event.listen('boardfish://file-drop', async (event) => {
    const { paths } = event.payload;
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    const dbg = InsertDebug.start('insertImages', { source: 'native-drop', fileCount: paths.length });
    let added = 0;
    showPasteShield();
    for (const path of paths) {
      if (!/\.(png|jpe?g)$/i.test(path)) continue;
      const fileDbg = InsertDebug.start('insertImage', { source: 'native-drop', fileName: path });
      try {
        InsertDebug.step(fileDbg, 'read:start', { source: 'native-drop', fileName: path });
        const b64 = await window.__TAURI__.core.invoke('read_binary_file_base64', { path });
        const ext = path.split('.').pop().toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
        const dataUrl = 'data:' + mime + ';base64,' + b64;
        InsertDebug.step(fileDbg, 'read:end', { source: 'native-drop', dataUrl });
        const obj = await insertDataUrlImage(dataUrl, center.x, center.y, fileDbg, { endMeta: { source: 'native-drop' } });
        if (obj) added++;
      } catch (err) {
        InsertDebug.end(fileDbg, { source: 'native-drop', error: String(err) });
        console.error('Failed to load dropped file:', err);
      }
    }
    hidePasteShield();
    InsertDebug.end(dbg, { source: 'native-drop', fileCount: paths.length, added });
  });
}


// ─── Dirty tracking ───────────────────────────────────────────────────────────

// historyIndex at last save (or open). -1 means never saved.
let savedHistoryIndex = -1;
let currentFilePath = null;

function isDirty() {
  return objects.length > 0 && historyIndex !== savedHistoryIndex;
}

function markSaved() {
  savedHistoryIndex = historyIndex;
  updateTitle();
}

function updateTitle() {
  if (!window.__TAURI__) return;
  const name = currentFilePath
    ? currentFilePath.split(/[\\/]/).pop().replace(/\.bf$/i, '')
    : 'Untitled';
  window.__TAURI__.core.invoke('set_title', { title: `Boardfish — ${name}` });
}


// ─── Unsaved changes dialog ───────────────────────────────────────────────────

const dialogOverlay = document.getElementById('dialog-overlay');
let _dialogResolve = null;

function _dialogClose(result) {
  dialogOverlay.classList.remove('show');
  const r = _dialogResolve;
  _dialogResolve = null;
  if (r) r(result);
}

document.getElementById('dlg-save').addEventListener('click', () => _dialogClose('save'));
document.getElementById('dlg-discard').addEventListener('click', () => _dialogClose('discard'));
document.getElementById('dlg-cancel').addEventListener('click', () => _dialogClose('cancel'));

// Returns 'save' | 'discard' | 'cancel'
function showUnsavedDialog() {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    dialogOverlay.classList.add('show');
  });
}

// ─── Save / Open ─────────────────────────────────────────────────────────────

function boardData() {
  return { version: 2, viewport: { panX, panY, zoom }, imageStore, objects };
}

function getImageMetaForBoardFile(imgKey, src = '') {
  if (isNativeImageRef(src)) return { path: src.path, mime: src.mime, ext: src.ext };
  const comma = typeof src === 'string' ? src.indexOf(',') : -1;
  const header = comma > 0 ? src.slice(0, comma) : '';
  const ext = guessImageExtFromDataUrl(src);
  const mime = header.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
  return { path: `images/${imgKey}.${ext}`, mime, ext };
}

function boardDataForSave() {
  const imageManifest = {};
  for (const [key, src] of Object.entries(imageStore)) {
    imageManifest[key] = getImageMetaForBoardFile(key, src);
  }
  return {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX, panY, zoom },
    imageStore: imageManifest,
    objects,
  };
}

function getBoardSaveMetrics(data) {
  let imageCount = 0;
  let imageStoreBytes = 0;
  let largestImageKey = '';
  let largestImageBytes = 0;
  for (const [key, src] of Object.entries(data.imageStore || {})) {
    imageCount++;
    const bytes = imageStoreBytesEstimate(src);
    imageStoreBytes += bytes;
    if (bytes > largestImageBytes) {
      largestImageBytes = bytes;
      largestImageKey = key;
    }
  }
  return {
    objectCount: data.objects?.length || 0,
    imageCount,
    imageObjectCount: (data.objects || []).filter((o) => o.type === 'image').length,
    textObjectCount: (data.objects || []).filter((o) => o.type === 'text').length,
    imageStoreBytes,
    rawImageStoreBytes: Object.values(imageStore).reduce((sum, src) => sum + imageStoreBytesEstimate(src), 0),
    largestImageKey,
    largestImageBytes,
    historyLength: history.length,
    historyIndex,
    dirty: isDirty(),
  };
}

function getBoardOpenMetrics(data) {
  let imageCount = 0;
  let imageStoreBytes = 0;
  let largestImageKey = '';
  let largestImageBytes = 0;
  for (const [key, src] of Object.entries(data?.imageStore || {})) {
    imageCount++;
    const bytes = imageStoreBytesEstimate(src);
    imageStoreBytes += bytes;
    if (bytes > largestImageBytes) {
      largestImageBytes = bytes;
      largestImageKey = key;
    }
  }
  return {
    objectCount: data?.objects?.length || 0,
    imageCount,
    imageObjectCount: (data?.objects || []).filter((o) => o.type === 'image').length,
    textObjectCount: (data?.objects || []).filter((o) => o.type === 'text').length,
    imageStoreBytes,
    largestImageKey,
    largestImageBytes,
  };
}

function measureBoardJsonForSaveDebug(dbg, data) {
  if (!SaveDebug.enabled) return;
  const t0 = performance.now();
  try {
    const json = JSON.stringify(data);
    SaveDebug.step(dbg, 'json-stringify', {
      ms: performance.now() - t0,
      jsonBytes: json.length,
    });
  } catch (err) {
    SaveDebug.step(dbg, 'json-stringify:error', { error: String(err) });
  }
}

function scheduleSaveFrameProbe(dbg, label) {
  if (!SaveDebug.enabled) return null;
  const scheduledAt = performance.now();
  let done = false;
  requestAnimationFrame(() => {
    done = true;
    SaveDebug.step(dbg, label, { queueMs: performance.now() - scheduledAt });
  });
  return () => {
    if (!done) SaveDebug.step(dbg, `${label}:pending`, { elapsedMs: performance.now() - scheduledAt });
  };
}

async function invokeSaveBoard(path, dbg) {
  const dataStart = performance.now();
  const data = window.__TAURI__ ? boardDataForSave() : boardData();
  SaveDebug.step(dbg, 'boardData', { ms: performance.now() - dataStart, path, ...getBoardSaveMetrics(data) });
  measureBoardJsonForSaveDebug(dbg, data);
  if (window.__TAURI__) {
    const pendingSources = Object.keys(data.imageStore || {})
      .map((key) => imageSourceCachePromises.get(key))
      .filter(Boolean);
    if (pendingSources.length) {
      const sourceStart = performance.now();
      SaveDebug.step(dbg, 'await-image-source-cache:start', { count: pendingSources.length });
      await Promise.allSettled(pendingSources);
      SaveDebug.step(dbg, 'await-image-source-cache:end', { count: pendingSources.length, ms: performance.now() - sourceStart });
    }
  }
  const frameProbe = scheduleSaveFrameProbe(dbg, 'save-frame-probe');
  const result = await SaveDebug.invoke(dbg, 'save_board', { path, board: data }, { path, ...getBoardSaveMetrics(data) });
  if (frameProbe) frameProbe();
  return result;
}

async function invokeReadBoard(path, dbg) {
  const frameProbe = scheduleOpenFrameProbe(dbg, 'open-frame-probe');
  const result = await OpenDebug.invoke(dbg, 'read_board', { path }, { path });
  if (frameProbe) frameProbe();
  if (result && result.debug) OpenDebug.step(dbg, 'read-board-debug', { rust: result.debug });
  return result?.board || result;
}

function scheduleOpenFrameProbe(dbg, label) {
  if (!OpenDebug.enabled) return null;
  const scheduledAt = performance.now();
  let done = false;
  requestAnimationFrame(() => {
    done = true;
    OpenDebug.step(dbg, label, { queueMs: performance.now() - scheduledAt });
  });
  return () => {
    if (!done) OpenDebug.step(dbg, `${label}:pending`, { elapsedMs: performance.now() - scheduledAt });
  };
}

function getVisibleWorldBounds() {
  return {
    x1: -panX / zoom,
    y1: -panY / zoom,
    x2: (window.innerWidth - panX) / zoom,
    y2: (window.innerHeight - panY) / zoom,
  };
}

function objIntersectsBounds(obj, b) {
  return obj.x < b.x2 && obj.x + obj.w > b.x1 && obj.y < b.y2 && obj.y + obj.h > b.y1;
}

function getVisibleImageKeys(limit = Infinity) {
  const b = getVisibleWorldBounds();
  const keys = [];
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type !== 'image') continue;
    if (!objIntersectsBounds(obj, b)) continue;
    const key = obj.data.imgKey;
    if (!isNativeImageRef(imageStore[key]) || imageCache[key]) continue;
    keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}

function getPendingNativeImageKeys(limit = Infinity, exclude = new Set()) {
  const keys = [];
  for (const key of Object.keys(imageStore)) {
    if (exclude.has(key)) continue;
    if (!isNativeImageRef(imageStore[key]) || imageCache[key]) continue;
    keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}

async function hydrateImageForDisplay(key, dbg = null) {
  if (imageCache[key] || !isNativeImageRef(imageStore[key])) return false;
  const t0 = performance.now();
  const fetchStart = performance.now();
  const display = await ensureImageDisplaySrc(key, dbg);
  const fetchMs = performance.now() - fetchStart;
  if (!display.src) return false;
  const loadStart = performance.now();
  const img = await loadImageElement(display.src);
  const loadMs = performance.now() - loadStart;
  imageCache[key] = img;
  let bitmapMs = 0;
  let bitmapReady = false;
  try {
    const bitmapStart = performance.now();
    imageBitmapCache[key] = await createImageBitmap(img);
    bitmapMs = performance.now() - bitmapStart;
    bitmapReady = true;
  } catch {
    imageBitmapFailed.add(key);
  }
  OpenDebug.step(dbg, 'hydrate-image', {
    imgKey: key,
    ms: performance.now() - t0,
    fetchMs,
    loadMs,
    bitmapMs,
    dataUrlLen: display.dataUrlLen,
    source: display.source,
    bitmapReady,
  });
  return true;
}

async function hydrateImageKeysWithLimit(keys, dbg, label, concurrency = OpenDebug.hydrationConcurrency) {
  OpenDebug.step(dbg, `${label}:start`, { count: keys.length, concurrency });
  const t0 = performance.now();
  await materializeImageAssets(keys, dbg).catch((err) => {
    OpenDebug.step(dbg, `${label}:materialize-error`, { error: String(err) });
  });
  let cursor = 0;
  let hydrated = 0;
  async function worker() {
    while (cursor < keys.length) {
      const key = keys[cursor++];
      try {
        if (await hydrateImageForDisplay(key, dbg)) hydrated++;
      } catch (err) {
        OpenDebug.step(dbg, `${label}:error`, { imgKey: key, error: String(err) });
      }
    }
  }
  const workerCount = Math.min(concurrency, keys.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  OpenDebug.step(dbg, `${label}:end`, { count: keys.length, hydrated, concurrency, ms: performance.now() - t0 });
  if (hydrated) invalidateOffscreen();
  return hydrated;
}

async function hydrateVisibleImagesForOpen(dbg = null) {
  const keys = getVisibleImageKeys();
  await hydrateImageKeysWithLimit(keys, dbg, 'hydrate-visible', OpenDebug.hydrationConcurrency);
  return keys;
}

async function hydrateImageBatchForOpen(keys, dbg = null, label = 'hydrate-batch') {
  return hydrateImageKeysWithLimit(keys, dbg, label, OpenDebug.hydrationConcurrency);
}

async function hydrateAllImagesForOpen(dbg = null) {
  const keys = getPendingNativeImageKeys();
  return hydrateImageBatchForOpen(keys, dbg, 'hydrate-all');
}

let _backgroundOpenHydrationRunning = false;
async function hydrateRemainingImagesForOpen(dbg = null, batchSize = 4) {
  if (_backgroundOpenHydrationRunning) return;
  _backgroundOpenHydrationRunning = true;
  const generation = _imageStoreGeneration;
  const totalStart = performance.now();
  let batchCount = 0;
  let hydratedTotal = 0;
  try {
    while (!_boardOpening && generation === _imageStoreGeneration) {
      const keys = getPendingNativeImageKeys(batchSize);
      if (!keys.length) break;
      batchCount++;
      hydratedTotal += await hydrateImageBatchForOpen(keys, dbg, 'hydrate-background');
      scheduleRender(true, false, 'open-background-hydration');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    _backgroundOpenHydrationRunning = false;
    OpenDebug.step(dbg, 'hydrate-background:done', {
      batchCount,
      hydrated: hydratedTotal,
      remaining: getPendingNativeImageKeys().length,
      stale: generation !== _imageStoreGeneration,
      ms: performance.now() - totalStart,
    });
  }
}

function queueVisibleImageHydration(limit = 3, dbg = null) {
  for (const key of getVisibleImageKeys(limit)) queueImageHydration(key, dbg);
}

let _visibleHydrationTimer = null;
function scheduleVisibleHydrationAfterIdle() {
  if (!window.__TAURI__ || _boardOpening) return;
  clearTimeout(_visibleHydrationTimer);
  _visibleHydrationTimer = setTimeout(() => queueVisibleImageHydration(1), 180);
}

async function finishOpenedBoard(dbg, data) {
  PillDebug.log('open:finishOpenedBoard:start', getBoardOpenMetrics(data));
  if (OpenDebug.hydrationMode === 'visible-first') {
    const hydrateStart = performance.now();
    const visibleKeys = await hydrateVisibleImagesForOpen(dbg);
    PillDebug.log('open:hydrate-visible:end', { phaseMs: performance.now() - hydrateStart, visibleCount: visibleKeys?.length || 0 });
    OpenDebug.step(dbg, 'hydrate-initial-policy', {
      mode: 'visible-first',
      visibleCount: visibleKeys?.length || 0,
      pendingNativeImages: getPendingNativeImageKeys().length,
    });
  } else {
    OpenDebug.step(dbg, 'hydrate-initial-policy', {
      mode: 'all-before-open',
      pendingNativeImages: getPendingNativeImageKeys().length,
    });
    const hydrateStart = performance.now();
    await hydrateAllImagesForOpen(dbg);
    PillDebug.log('open:hydrate-all:end', { phaseMs: performance.now() - hydrateStart, pendingNativeImages: getPendingNativeImageKeys().length });
  }
  _boardOpening = false;
  const renderStart = performance.now();
  PillDebug.log('open:initial-applyTransform:start');
  applyTransform();
  const renderMs = performance.now() - renderStart;
  PillDebug.log('open:initial-applyTransform:end', { phaseMs: renderMs });
  OpenDebug.step(dbg, 'initial-applyTransform', { ms: renderMs });
  openingShield.classList.remove('active');
  PillDebug.log('open:openingShield:removed');
  restoreIslandZoom();
  OpenDebug.end(dbg, { opened: true, ...getBoardOpenMetrics(data) });
  if (OpenDebug.hydrationMode === 'visible-first') {
    setTimeout(() => hydrateRemainingImagesForOpen(dbg).catch((err) => {
      OpenDebug.step(dbg, 'hydrate-background:error', { error: String(err) });
    }), 80);
  }
}

function applyBoardData(data, options = {}) {
  const dbg = options.dbg || null;
  const sourcesCached = !!options.sourcesCached;
  const deferRender = !!options.deferRender;
  const endDebug = options.endDebug !== false;
  PillDebug.log('open:applyBoardData:start', getBoardOpenMetrics(data));
  OpenDebug.step(dbg, 'applyBoardData:start', getBoardOpenMetrics(data));
  const t0 = performance.now();
  clearImageStore(!sourcesCached);
  OpenDebug.step(dbg, 'clearImageStore', { ms: performance.now() - t0 });

  const imageStart = performance.now();
  Object.assign(imageStore, data.imageStore || {});
  _skipImageSourceRegistration = sourcesCached;
  try {
    for (const k of Object.keys(imageStore)) {
      const n = parseInt(k.split('-')[1]);
      if (!isNaN(n) && n >= imgKeyCounter) imgKeyCounter = n + 1;
      if (!sourcesCached || !isNativeImageRef(imageStore[k])) cacheImage(k, imageStore[k], null, !sourcesCached);
    }
  } finally {
    _skipImageSourceRegistration = false;
  }
  OpenDebug.step(dbg, 'cacheImage:start-all', { ms: performance.now() - imageStart, sourcesCached, imageCount: Object.keys(imageStore).length });

  const stateStart = performance.now();
  if (editingId) exitEdit();
  selectedId = null;
  selectedIds.clear();
  objects = data.objects || [];
  const normalizeStart = performance.now();
  for (const obj of objects) {
    if (obj?.type === 'text') obj.data.content = normalizeTextContent(obj.data?.content);
  }
  OpenDebug.step(dbg, 'normalize-text', { ms: performance.now() - normalizeStart });
  const mapStart = performance.now();
  rebuildObjectsMap();
  OpenDebug.step(dbg, 'rebuildObjectsMap', { ms: performance.now() - mapStart, objectCount: objects.length });
  const heightStart = performance.now();
  syncAllTextAutoHeights();
  OpenDebug.step(dbg, 'syncTextAutoHeights', { ms: performance.now() - heightStart });
  invalidateOffscreen();
  OpenDebug.step(dbg, 'apply-state', { ms: performance.now() - stateStart, objectCount: objects.length });

  const countersStart = performance.now();
  for (const obj of objects) {
    const n = parseInt(obj.id.split('-')[1]);
    if (!isNaN(n) && n >= idCounter) idCounter = n + 1;
    if (obj.z >= zCounter) zCounter = obj.z + 1;
  }
  if (data.viewport) { panX = data.viewport.panX; panY = data.viewport.panY; zoom = data.viewport.zoom; }
  OpenDebug.step(dbg, 'restore-counters-viewport', { ms: performance.now() - countersStart, panX, panY, zoom });

  if (!deferRender) {
    const renderStart = performance.now();
    applyTransform();
    OpenDebug.step(dbg, 'applyTransform', { ms: performance.now() - renderStart });
  }

  const historyStart = performance.now();
  history = []; historyIndex = -1; snapshot();
  markSaved();
  OpenDebug.step(dbg, 'reset-history-markSaved', { ms: performance.now() - historyStart, historyLength: history.length, historyIndex });
  PillDebug.log('open:applyBoardData:end', getBoardOpenMetrics(data));
  if (endDebug) OpenDebug.end(dbg, { opened: true, ...getBoardOpenMetrics(data) });
}

async function saveBoardAs() {
  if (!window.__TAURI__) { alert('Save requires the desktop app.'); return false; }
  const dbg = SaveDebug.start('saveBoardAs', { currentFilePath, objectCount: objects.length });
  try {
    const defaultName = currentFilePath
      ? currentFilePath.split(/[\\/]/).pop()
      : 'board.bf';
    const filePath = await SaveDebug.invoke(dbg, 'save_file_dialog', { defaultName }, { defaultName });
    if (!filePath) { SaveDebug.end(dbg, { cancelled: true }); return false; }
    await invokeSaveBoard(filePath, dbg);
    currentFilePath = filePath;
    SaveDebug.step(dbg, 'markSaved:start');
    markSaved();
    SaveDebug.step(dbg, 'markSaved:end');
    showIslandMsg('Saved', 1500);
    SaveDebug.end(dbg, { saved: true, path: filePath });
    return true;
  } catch (err) {
    console.error('Save failed:', err);
    SaveDebug.end(dbg, { saved: false, error: String(err) });
    return false;
  }
}

async function saveBoard() {
  if (currentFilePath) {
    if (!window.__TAURI__) return false;
    const dbg = SaveDebug.start('saveBoard', { path: currentFilePath, objectCount: objects.length });
    try {
      await invokeSaveBoard(currentFilePath, dbg);
      SaveDebug.step(dbg, 'markSaved:start');
      markSaved();
      SaveDebug.step(dbg, 'markSaved:end');
      showIslandMsg('Saved', 1500);
      SaveDebug.end(dbg, { saved: true, path: currentFilePath });
      return true;
    } catch (err) {
      console.error('Save failed:', err);
      SaveDebug.end(dbg, { saved: false, error: String(err) });
      return false;
    }
  }
  return saveBoardAs();
}


async function openBoard() {
  if (!window.__TAURI__) { alert('Open requires the desktop app.'); return; }
  const dbg = OpenDebug.start('openBoard', { currentFilePath, objectCount: objects.length });

  if (isDirty()) {
    OpenDebug.step(dbg, 'dirty-dialog:start');
    const choice = await showUnsavedDialog();
    OpenDebug.step(dbg, 'dirty-dialog:end', { choice });
    if (choice === 'cancel') { OpenDebug.end(dbg, { cancelled: true }); return; }
    if (choice === 'save') {
      const saved = await saveBoard();
      OpenDebug.step(dbg, 'dirty-dialog:save-result', { saved });
      if (!saved) { OpenDebug.end(dbg, { cancelled: true, reason: 'save-failed' }); return; }
    }
  }

  try {
    const filePath = await OpenDebug.invoke(dbg, 'open_file_dialog');
    if (!filePath) { OpenDebug.end(dbg, { cancelled: true }); return; }
    _boardOpening = true; openingShield.classList.add('active');

    await showIslandMsg('Opening');
    const data = await invokeReadBoard(filePath, dbg);
    applyBoardData(data, { dbg, sourcesCached: true, deferRender: true, endDebug: false });
    await finishOpenedBoard(dbg, data);
    currentFilePath = filePath;
    updateTitle();
  } catch (err) {
    console.error('Open failed:', err);
    _boardOpening = false; openingShield.classList.remove('active');
    restoreIslandZoom();
    OpenDebug.end(dbg, { opened: false, error: String(err) });
  }
}

// ─── Close guard ─────────────────────────────────────────────────────────────

let _closeGuardRunning = false;

async function requestAppClose(event = null) {
  if (!window.__TAURI__) return;
  const seq = Number(event?.payload || 0);
  if (seq) window.__TAURI__.core.invoke('acknowledge_close_request', { seq }).catch(() => {});
  if (_closeGuardRunning) return;
  _closeGuardRunning = true;
  try {
    recoverWindowPaint('close-request', false);
    if (isDirty()) {
      const choice = await showUnsavedDialog();
      if (choice === 'cancel') {
        window.__TAURI__.core.invoke('cancel_pending_termination').catch(() => {});
        return;
      }
      if (choice === 'save') {
        const saved = await saveBoard();
        if (!saved) {
          window.__TAURI__.core.invoke('cancel_pending_termination').catch(() => {});
          return;
        }
      }
    }
    // Use process.exit instead of appWindow.close() to avoid re-triggering
    // the CloseRequested event in Rust (which would cause an infinite loop)
    await window.__TAURI__.core.invoke('exit_app');
  } finally {
    _closeGuardRunning = false;
  }
}

if (window.__TAURI__) {
  window.__TAURI__.event.listen('boardfish://close-requested', requestAppClose);
  window.__TAURI__.event.listen('boardfish://app-resumed', () => {
    recoverWindowPaint('app-resumed');
    setTimeout(() => recoverBlankUi('app-resumed-followup'), 250);
  });
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

let jsClipboard = null;
let _jsClipboardSetAt = 0;
let _jsClipboardSequence = null;
let _jsClipboardSequencePromise = null;
let _jsClipboardNativeWritePending = false;
let _jsClipboardToken = 0;
let _pasteInProgress = false;

async function getNativeClipboardSequence(dbg = null) {
  if (!window.__TAURI__) return null;
  try {
    return await ClipDebug.invoke(dbg, 'clipboard_sequence');
  } catch {
    return null;
  }
}

function markJsClipboardSequence(token = _jsClipboardToken, dbg = null) {
  const promise = (async () => {
    const seq = await getNativeClipboardSequence(dbg);
    if (seq !== null && jsClipboard && token === _jsClipboardToken) _jsClipboardSequence = seq;
    ClipDebug.step(dbg, 'mark-js-clipboard-sequence', { seq, token, currentToken: _jsClipboardToken, accepted: seq !== null && token === _jsClipboardToken });
    return seq;
  })();
  if (token === _jsClipboardToken) _jsClipboardSequencePromise = promise;
  return promise;
}

function finishNativeClipboardWrite(token, dbg = null) {
  return markJsClipboardSequence(token, dbg).finally(() => {
    if (token === _jsClipboardToken) _jsClipboardNativeWritePending = false;
  });
}

function setJsClipboard(value, trackNative = false, nativeWritePending = false) {
  jsClipboard = value;
  _jsClipboardSetAt = Date.now();
  _jsClipboardSequence = null;
  _jsClipboardSequencePromise = null;
  _jsClipboardNativeWritePending = nativeWritePending;
  const token = ++_jsClipboardToken;
  if (trackNative) markJsClipboardSequence(token);
  return token;
}

function clearJsClipboard() {
  jsClipboard = null;
  _jsClipboardSequence = null;
  _jsClipboardSequencePromise = null;
  _jsClipboardNativeWritePending = false;
  _jsClipboardToken++;
}

async function jsClipboardStillCurrent(dbg = null) {
  if (!jsClipboard) return false;
  if (_jsClipboardSequence === null && _jsClipboardSequencePromise) {
    await _jsClipboardSequencePromise.catch(() => null);
  }
  if (_jsClipboardSequence === null) {
    const age = Date.now() - _jsClipboardSetAt;
    const current = !window.__TAURI__ || _jsClipboardNativeWritePending || age < 750;
    ClipDebug.step(dbg, 'validate-js-clipboard-untracked', { current, nativeWritePending: _jsClipboardNativeWritePending, age });
    return current;
  }
  const seq = await getNativeClipboardSequence(dbg);
  const current = seq === null || seq === _jsClipboardSequence;
  ClipDebug.step(dbg, 'validate-js-clipboard', { seq, expected: _jsClipboardSequence, current });
  return current;
}

function readClipboardImageDataUrlFromEvent(clipboardData, dbg = null) {
  if (!clipboardData) return null;
  const items = [...(clipboardData.items || [])];
  const files = [...(clipboardData.files || [])];
  const isSupportedImageType = (type) => type === 'image/png' || type === 'image/jpeg';
  const imageItem = items.find((item) => item.kind === 'file' && isSupportedImageType(item.type));
  const imageFile = imageItem?.getAsFile?.() || files.find((file) => isSupportedImageType(file.type));
  if (!imageFile) return null;
  ClipDebug.step(dbg, 'event-image-blob', { type: imageFile.type, blobSize: imageFile.size });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = () => reject(reader.error || new Error('failed to read clipboard image'));
    reader.readAsDataURL(imageFile);
  });
}

function readClipboardTextFromEvent(clipboardData) {
  if (!clipboardData) return '';
  return clipboardData.getData?.('text/plain') || clipboardData.getData?.('text') || '';
}

function describeClipboardData(clipboardData) {
  if (!clipboardData) return null;
  return {
    itemTypes: [...(clipboardData.items || [])].map((item) => item.type || item.kind || ''),
    fileTypes: [...(clipboardData.files || [])].map((file) => file.type || ''),
    types: [...(clipboardData.types || [])],
  };
}

async function readClipboardImageDataUrlFromBrowser(dbg = null) {
  if (!navigator.clipboard?.read) return null;
  ClipDebug.step(dbg, 'browser-clipboard-read:start');
  const items = await navigator.clipboard.read();
  ClipDebug.step(dbg, 'browser-clipboard-read:ok', { itemCount: items.length });
  for (const item of items) {
    for (const type of item.types) {
      if (type !== 'image/png' && type !== 'image/jpeg') continue;
      const blob = await item.getType(type);
      ClipDebug.step(dbg, 'browser-image-blob', { type, blobSize: blob.size });
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => reject(reader.error || new Error('failed to read browser clipboard image'));
        reader.readAsDataURL(blob);
      });
    }
  }
  return null;
}

async function copySelected() {
  const dbg = ClipDebug.start('copySelected', { selectedCount: selectedIds.size });
  if (!selectedIds.size) { ClipDebug.end(dbg, { skipped: 'empty-selection' }); return; }

  if (selectedIds.size > 1) {
    const clonedObjs = [];
    const imageData = {};
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (!obj) continue;
      const cloned = cloneObject(obj);
      if (cloned.type === 'image') {
        const src = imageStore[cloned.data.imgKey];
        if (src) imageData[cloned.data.imgKey] = src;
      }
      clonedObjs.push(cloned);
    }
    if (!clonedObjs.length) { ClipDebug.end(dbg, { skipped: 'no-clones' }); return; }
    setJsClipboard({ type: 'objects', objects: clonedObjs, imageData }, true);
    ClipDebug.end(dbg, { path: 'multi-jsClipboard', objectCount: clonedObjs.length, imageCount: Object.keys(imageData).length });
    return;
  }

  const obj = getFirstSelectedObject();
  if (!obj) { ClipDebug.end(dbg, { skipped: 'missing-object' }); return; }

  const cloned = cloneObject(obj);
  const imgData = {};
  if (obj.type === 'image') {
    const src = imageStore[obj.data.imgKey];
    if (src) imgData[obj.data.imgKey] = src;
  }
  const isTauri = !!window.__TAURI__;

  const clipboardToken = setJsClipboard({ type: 'objects', objects: [cloned], imageData: imgData }, false, isTauri);
  ClipDebug.step(dbg, 'set-jsClipboard', { type: obj.type, isTauri, imgKey: obj.data?.imgKey, imageNeedsRendering: obj.type === 'image' ? imageNeedsRendering(obj) : false });

  if (obj.type === 'text') {
    if (isTauri) {
      ClipDebug.invoke(dbg, 'copy_text_to_clipboard', { text: obj.data.content }, { textLen: obj.data.content.length })
        .catch(err => console.error('[copy] copy_text_to_clipboard FAILED:', err))
        .finally(() => finishNativeClipboardWrite(clipboardToken, dbg))
        .finally(() => ClipDebug.end(dbg, { path: 'text-tauri' }));
    } else {
      navigator.clipboard.writeText(obj.data.content)
        .catch(err => console.error('[copy] writeText FAILED:', err))
        .finally(() => ClipDebug.end(dbg, { path: 'text-web' }));
    }
    return;
  }

  if (obj.type === 'image') {
    if (isTauri) {
      const imgKey = obj.data.imgKey;
      const flipX = !!obj.data.flipX;
      const flipY = !!obj.data.flipY;
      const copyCached = () => ClipDebug.invoke(
        dbg,
        'copy_cached_image_to_clipboard_transformed',
        { imgKey, flipX, flipY },
        { imgKey, flipX, flipY }
      );
      copyCached()
        .catch(async (err) => {
          ClipDebug.step(dbg, 'cache-miss-fallback', { imgKey, flipX, flipY, error: String(err) });
          const src = await ensureImageDataUrl(obj.data.imgKey, dbg);
          if (!src) return;
          const pendingCache = imageClipboardCachePromises.get(imgKey);
          if (pendingCache) {
            ClipDebug.step(dbg, 'await-existing-cache', { imgKey });
            await pendingCache.catch(() => {});
            return copyCached();
          }
          return ClipDebug.invoke(
            dbg,
            'copy_image_data_url_to_clipboard_transformed',
            { dataUrl: src, flipX, flipY },
            { imgKey, flipX, flipY, dataUrl: src }
          )
            .then(() => {
              // Populate cache so subsequent copies use the fast path
              cacheImageForClipboard(imgKey, src, dbg).catch(() => {});
            })
            .catch(err => console.error('[copy] fallback copy_image_data_url_to_clipboard_transformed FAILED:', err));
        })
        .finally(() => finishNativeClipboardWrite(clipboardToken, dbg))
        .finally(() => ClipDebug.end(dbg, { path: 'image-tauri-cached-transform', flipX, flipY }));
    } else {
      const canvas = renderImageToCanvas(obj);
      if (!canvas) { ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'image-not-ready' }); return; }
      const pngBlob = await canvasToPngBlob(canvas);
      if (!pngBlob) { ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'blob-null' }); return; }
      navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
        .catch(err => console.error('[copy] clipboard.write FAILED:', err))
        .finally(() => ClipDebug.end(dbg, { path: 'image-web-rendered', blobSize: pngBlob.size }));
    }
  }
}

function guessImageExtFromDataUrl(dataUrl) {
  if (dataUrl.startsWith('data:image/jpeg')) return 'jpg';
  return 'png';
}

async function saveSelectedImage() {
  const dbg = ExportDebug.start('exportImage', { selectedCount: selectedIds.size });
  const imageObjs = [...selectedIds].map(id => objectsMap.get(id)).filter(o => o && o.type === 'image');
  if (imageObjs.length !== 1) { ExportDebug.end(dbg, { skipped: true, imageCount: imageObjs.length }); return; }
  const obj = imageObjs[0];

  ExportDebug.step(dbg, 'render:start');
  const src = await getRenderedImageDataUrl(obj);
  ExportDebug.step(dbg, 'render:done', { hasDataUrl: !!src });
  if (!src) { ExportDebug.end(dbg, { skipped: true, reason: 'no-dataurl' }); return; }

  const ext = guessImageExtFromDataUrl(src);
  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  const defaultName = `image_${hex}.${ext}`;

  if (window.__TAURI__) {
    try {
      const saved = await ExportDebug.invoke(dbg, 'save_image_as', { dataUrl: src, defaultName }, { defaultName });
      ExportDebug.end(dbg, { saved });
      if (saved) showIslandMsg(selectedIds.size > 1 ? '1 Image Exported' : 'Image Exported', 1500);
    } catch (err) {
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Save image failed:', err);
    }
    return;
  }

  const a = document.createElement('a');
  a.href = src;
  a.download = defaultName;
  a.click();
  ExportDebug.end(dbg, { saved: true, method: 'download' });
}

// Resolves a list of image objects to img_keys for save_images_to_folder_by_keys.
// Flipped images are rendered to a data URL, registered in the Rust image cache
// under a temp key, and that temp key is used instead — keeping IPC payload tiny.
async function resolveExportKeys(imageObjs, dbg) {
  const tempKeys = [];
  let renderedCount = 0;
  const keys = await Promise.all(imageObjs.map(async (obj) => {
    if (!imageNeedsRendering(obj)) return obj.data.imgKey;
    const dataUrl = await getRenderedImageDataUrl(obj);
    if (!dataUrl) return null;
    const tempKey = `__export_tmp_${obj.id}`;
    tempKeys.push(tempKey);
    renderedCount++;
    await ExportDebug.invoke(dbg, 'register_image_source', { imgKey: tempKey, dataUrl }, { imgKey: tempKey });
    return tempKey;
  }));
  return { keys: keys.filter(Boolean), tempKeys, renderedCount };
}

function cleanupExportTempKeys(tempKeys) {
  if (!tempKeys?.length || !window.__TAURI__) return;
  window.__TAURI__.core
    .invoke('remove_cached_image_sources', { imgKeys: tempKeys })
    .catch((err) => console.warn('[export] remove_cached_image_sources failed:', err));
}

async function saveSelectedImages() {
  const dbg = ExportDebug.start('exportImages', { selectedCount: selectedIds.size });
  const selectedObjs = [];
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj || obj.type !== 'image') continue;
    selectedObjs.push(obj);
  }
  if (selectedObjs.length < 2) { ExportDebug.end(dbg, { skipped: true, imageCount: selectedObjs.length }); hidePasteShield(); return; }
  ExportDebug.step(dbg, 'render:start', { imageCount: selectedObjs.length });

  if (window.__TAURI__) {
    let tempKeys = [];
    try {
      const resolved = await resolveExportKeys(selectedObjs, dbg);
      const keys = resolved.keys;
      tempKeys = resolved.tempKeys;
      ExportDebug.step(dbg, 'render:done', { keyCount: keys.length, tempKeyCount: tempKeys.length, renderedCount: resolved.renderedCount });
      if (keys.length < 2) { hidePasteShield(); ExportDebug.end(dbg, { skipped: true, reason: 'too-few-keys' }); return; }
      const savedCount = await ExportDebug.invoke(dbg, 'save_images_to_folder_by_keys', { imgKeys: keys }, { keyCount: keys.length });
      ExportDebug.end(dbg, { savedCount });
      if (savedCount > 0) showIslandMsg(savedCount === 1 ? '1 Image Exported' : `${savedCount} Images Exported`, 1500, hidePasteShield);
      else hidePasteShield();
    } catch (err) {
      hidePasteShield();
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Save images failed:', err);
    } finally {
      cleanupExportTempKeys(tempKeys);
    }
    return;
  }

  for (let i = 0; i < selectedObjs.length; i++) {
    const src = await getRenderedImageDataUrl(selectedObjs[i]);
    if (!src) continue;
    const ext = guessImageExtFromDataUrl(src);
    const a = document.createElement('a');
    a.href = src;
    a.download = `image_${i + 1}.${ext}`;
    a.click();
  }
  ExportDebug.end(dbg, { saved: true, method: 'download', imageCount: selectedObjs.length });
}

async function exportAllImages() {
  const dbg = ExportDebug.start('exportAllImages', { objectCount: objects.length });
  const imageObjs = [...objects].sort((a, b) => b.z - a.z).filter((o) => o.type === 'image');
  if (!imageObjs.length) { ExportDebug.end(dbg, { skipped: true, reason: 'no-images' }); hidePasteShield(); return; }
  ExportDebug.step(dbg, 'render:start', { imageCount: imageObjs.length });

  if (window.__TAURI__) {
    let tempKeys = [];
    try {
      const resolved = await resolveExportKeys(imageObjs, dbg);
      const keys = resolved.keys;
      tempKeys = resolved.tempKeys;
      ExportDebug.step(dbg, 'render:done', { keyCount: keys.length, tempKeyCount: tempKeys.length, renderedCount: resolved.renderedCount });
      if (!keys.length) { hidePasteShield(); ExportDebug.end(dbg, { skipped: true, reason: 'no-keys' }); return; }
      const savedCount = await ExportDebug.invoke(dbg, 'save_images_to_folder_by_keys', { imgKeys: keys }, { keyCount: keys.length });
      ExportDebug.end(dbg, { savedCount });
      if (savedCount > 0) showIslandMsg(savedCount === 1 ? '1 Image Exported' : `${savedCount} Images Exported`, 1500, hidePasteShield);
      else hidePasteShield();
    } catch (err) {
      hidePasteShield();
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Export all images failed:', err);
    } finally {
      cleanupExportTempKeys(tempKeys);
    }
    return;
  }

  for (let i = 0; i < imageObjs.length; i++) {
    const src = await getRenderedImageDataUrl(imageObjs[i]);
    if (!src) continue;
    const ext = guessImageExtFromDataUrl(src);
    const a = document.createElement('a');
    a.href = src;
    a.download = `image_${i + 1}.${ext}`;
    a.click();
  }
  ExportDebug.end(dbg, { saved: true, method: 'download', imageCount: imageObjs.length });
}

async function exportAllText() {
  const dbg = ExportDebug.start('exportAllText', { objectCount: objects.length });
  const textObjs = [...objects].sort((a, b) => b.z - a.z).filter((o) => o.type === 'text');
  if (!textObjs.length) { ExportDebug.end(dbg, { skipped: true, reason: 'no-text' }); return; }

  const combined = textObjs.map((o) => o.data.content).join('\n\n');
  ExportDebug.step(dbg, 'combined', { textCount: textObjs.length, combinedLen: combined.length });

  if (window.__TAURI__) {
    try {
      const saved = await ExportDebug.invoke(dbg, 'save_text_as', { text: combined }, { textCount: textObjs.length });
      ExportDebug.end(dbg, { saved });
      if (saved) showIslandMsg('Text Exported', 1500);
    } catch (err) {
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Export all text failed:', err);
    }
    return;
  }

  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  const blob = new Blob([combined], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `text_${hex}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  ExportDebug.end(dbg, { saved: true, method: 'download', textCount: textObjs.length });
}

async function pasteAtPos(wx, wy, clipboardData = null) {
  const dbg = ClipDebug.start('pasteAtPos', {
    wx,
    wy,
    hasJsClipboard: !!jsClipboard,
    jsClipboardType: jsClipboard?.type,
    clipboardData: describeClipboardData(clipboardData),
  });
  if (_pasteInProgress) {
    ClipDebug.end(dbg, { path: 'paste-busy', skipped: 'paste-in-progress' });
    return;
  }
  _pasteInProgress = true;
  try {
    if (jsClipboard && !(await jsClipboardStillCurrent(dbg))) {
      ClipDebug.step(dbg, 'clear-stale-jsClipboard', { expectedSequence: _jsClipboardSequence });
      clearJsClipboard();
    }
    if (jsClipboard) {
      if (jsClipboard.type === 'objects') {
        const clones = cloneObjects(jsClipboard.objects || []);
        if (!clones.length) { ClipDebug.end(dbg, { skipped: 'empty-jsClipboard' }); return; }
        // Re-register image data in case we're on a different board
        const imgData = jsClipboard.imageData || {};
        let registeredImages = 0;
        for (const [key, src] of Object.entries(imgData)) {
          if (!imageStore[key]) { imageStore[key] = src; cacheImage(key, src); registeredImages++; }
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const o of clones) {
          minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
          maxX = Math.max(maxX, o.x + o.w); maxY = Math.max(maxY, o.y + o.h);
        }
        const dx = wx - (minX + maxX) / 2, dy = wy - (minY + maxY) / 2;
        selectedIds.clear();
        for (const o of clones) {
          o.id = newId(); o.x += dx; o.y += dy; o.z = ++zCounter;
          objects.push(o); objectsMap.set(o.id, o); selectedIds.add(o.id);
        }
        selectedId = clones[clones.length - 1].id;
        scheduleRender(true, true); pushHistory();
        ClipDebug.end(dbg, { path: 'jsClipboard', objectCount: clones.length, registeredImages, historyIndex });
        return;
      }
    }
    const eventImage = readClipboardImageDataUrlFromEvent(clipboardData, dbg);
    if (eventImage) {
      try {
        const imgKey = newImgKey();
        showPasteShield();
        const dataUrl = await eventImage;
        ClipDebug.step(dbg, 'event-image-read', { dataUrl });
        const addPromise = addImage(dataUrl, wx, wy, false, imgKey);
        hidePasteShield();
        await addPromise;
        ClipDebug.end(dbg, { path: 'event-image' });
        return;
      } catch (err) {
        hidePasteShield();
        ClipDebug.step(dbg, 'event-image-miss', { error: String(err) });
      }
    }
    const eventText = readClipboardTextFromEvent(clipboardData);
    if (eventText && eventText.trim()) {
      addText(wx - 100, wy - 40, eventText);
      ClipDebug.end(dbg, { path: 'event-text', textLen: eventText.length });
      return;
    }
    if (!window.__TAURI__) {
      try {
        const imgKey = newImgKey();
        const dataUrl = await readClipboardImageDataUrlFromBrowser(dbg);
        if (dataUrl) {
          ClipDebug.step(dbg, 'browser-image-read', { dataUrl });
          await addImage(dataUrl, wx, wy, false, imgKey);
          ClipDebug.end(dbg, { path: 'browser-image' });
          return;
        }
      } catch (err) {
        ClipDebug.step(dbg, 'browser-image-miss', { error: String(err) });
      }
    }
    if (window.__TAURI__) {
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        const imgKey = newImgKey();
        showPasteShield();
        const dataUrl = await ClipDebug.invoke(dbg, 'read_image_from_clipboard_cached', { imgKey }, { imgKey });
        ClipDebug.step(dbg, 'native-image-read', { dataUrl });
        const addPromise = addImage(dataUrl, wx, wy, false, imgKey, false);
        hidePasteShield();
        await addPromise;
        ClipDebug.end(dbg, { path: 'native-image' });
        return;
      } catch (err) {
        hidePasteShield();
        ClipDebug.step(dbg, 'native-image-miss', { error: String(err) });
        try {
          const text = await ClipDebug.invoke(dbg, 'read_text_from_clipboard');
          if (text && text.trim()) addText(wx - 100, wy - 40, text);
          ClipDebug.end(dbg, { path: 'native-text', textLen: text?.length || 0 });
          return;
        } catch (textErr) {
          ClipDebug.end(dbg, { path: 'native-empty', error: String(textErr) });
        }
        return;
      }
    }
    showPasteShield();
    try {
      const dataUrl = await readClipboardImageDataUrlFromBrowser(dbg);
      hidePasteShield();
      if (dataUrl) {
        await addImage(dataUrl, wx, wy);
        ClipDebug.end(dbg, { path: 'web-image', dataUrlLen: dataUrl.length });
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) addText(wx - 100, wy - 40, text);
      ClipDebug.end(dbg, { path: 'web-text', textLen: text?.length || 0 });
    } catch (err) {
      hidePasteShield();
      ClipDebug.end(dbg, { path: 'web-empty', error: String(err) });
    }
  } finally {
    _pasteInProgress = false;
  }
}

document.addEventListener('paste', (e) => {
  if (editingId) return;
  e.preventDefault();
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  pasteAtPos(center.x, center.y, e.clipboardData);
});


// ─── Keyboard ────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    if (!editingId) {
      e.preventDefault();
      selectAllObjects();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'w')) {
    if (window.__TAURI__) {
      e.preventDefault();
      requestAppClose();
    }
    return;
  }

  if (e.key === 'Escape') {
    hideMenus();
    if (editingId) {
      exitEdit();
      selectedId = null;
      selectedIds.clear();
      scheduleRender(false, true);
      return;
    }
    deselectAll();
    return;
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && hasSelection() && !editingId) {
    e.preventDefault(); deleteSelected(); return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !editingId) {
    e.preventDefault();
    newBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !editingId) {
    e.preventDefault();
    openBoard();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveBoardAs();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBoard(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingId) { e.preventDefault(); copySelected(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && !editingId) {
    e.preventDefault();
    (async () => {
      await copySelected();
      deleteSelected();
    })();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) { e.preventDefault(); redo(); return; }

  if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !editingId) { e.preventDefault(); duplicateSelected(); return; }
});

// ─── Reload guard ────────────────────────────────────────────────────────────

// Prevent native WebKit context menu (which contains "Reload Page") on any
// element not already handled by the canvas contextmenu handler.
document.addEventListener('contextmenu', (e) => {
  if (!e.defaultPrevented) e.preventDefault();
});

// Native unload handlers cannot wait for the custom async save dialog.
window.addEventListener('beforeunload', (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});

function recoverWindowPaint(reason = 'resume', hardRepaint = false) {
  document.documentElement.style.display = '';
  document.documentElement.style.visibility = '';
  document.documentElement.style.opacity = '';
  document.body.style.display = '';
  document.body.style.visibility = '';
  document.body.style.opacity = '';
  canvas.style.display = '';
  boardCanvas.style.display = '';
  islZoom.style.display = '';
  if (!_boardOpening && _pasteShieldCount === 0) openingShield.classList.remove('active');
  if (dialogOverlay.classList.contains('show') && !_dialogResolve) dialogOverlay.classList.remove('show');
  if (!ctxMenu.classList.contains('visible') && !objCtxMenu.classList.contains('visible')) {
    hideMenus();
  } else {
    MenuDebug.log('recoverWindowPaint:keep-open-menu', { reason });
  }
  if (hardRepaint) {
    document.body.style.display = 'none';
    void document.body.offsetHeight;
    document.body.style.display = '';
  }
  requestAnimationFrame(() => {
    resizeCanvas();
    updateZoomDisplay(true);
    scheduleRender(true, true, reason);
    requestAnimationFrame(() => {
      applyTransform();
      updateSelectionOverlay();
    });
  });
}

function recoverBlankUi(reason = 'watchdog') {
  if (document.hidden) return;
  const bodyStyle = getComputedStyle(document.body);
  const canvasStyle = getComputedStyle(boardCanvas);
  const islandStyle = getComputedStyle(islZoom);
  const canvasMissing = boardCanvas.width === 0 || boardCanvas.height === 0;
  const hidden =
    bodyStyle.display === 'none' ||
    bodyStyle.visibility === 'hidden' ||
    bodyStyle.opacity === '0' ||
    canvasStyle.display === 'none' ||
    canvasStyle.visibility === 'hidden' ||
    islandStyle.display === 'none' ||
    islandStyle.visibility === 'hidden';

  if (!hidden && !canvasMissing) return;
  recoverWindowPaint(`blank-ui:${reason}`, hidden);
}

window.addEventListener('pageshow', (event) => recoverWindowPaint('pageshow', event.persisted));
window.addEventListener('focus', () => recoverWindowPaint('focus'));
window.addEventListener('blur', () => setTimeout(() => recoverBlankUi('blur-followup'), 250));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    recoverWindowPaint('visibility');
    setTimeout(() => recoverBlankUi('visibility-followup'), 250);
  }
});
setInterval(() => recoverBlankUi('interval'), 2000);
boardCanvas.addEventListener('contextlost', (event) => {
  event.preventDefault();
});
boardCanvas.addEventListener('contextrestored', () => recoverWindowPaint('canvas-contextrestored', true));

// ─── Init ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);
document.fonts?.ready.then(clearTextMeasurementCaches).catch(() => {});
resizeCanvas();
snapshot();
islSetWidth('100%');
updateZoomDisplay(true);
updateTitle();


// Open a .bf file by path — used for startup file and macOS open events
async function openFilePath(filePath) {
  const dbg = OpenDebug.start('openFilePath', { path: filePath, currentFilePath, objectCount: objects.length });
  if (isDirty()) {
    OpenDebug.step(dbg, 'dirty-dialog:start');
    const choice = await showUnsavedDialog();
    OpenDebug.step(dbg, 'dirty-dialog:end', { choice });
    if (choice === 'cancel') { OpenDebug.end(dbg, { cancelled: true }); return; }
    if (choice === 'save') {
      const saved = await saveBoard();
      OpenDebug.step(dbg, 'dirty-dialog:save-result', { saved });
      if (!saved) { OpenDebug.end(dbg, { cancelled: true, reason: 'save-failed' }); return; }
    }
  }
  try {
    _boardOpening = true; openingShield.classList.add('active');

    await showIslandMsg('Opening');
    const data = await invokeReadBoard(filePath, dbg);
    applyBoardData(data, { dbg, sourcesCached: true, deferRender: true, endDebug: false });
    await finishOpenedBoard(dbg, data);
    currentFilePath = filePath;
    updateTitle();
  } catch (err) {
    console.error('Failed to open file:', err);
    _boardOpening = false; openingShield.classList.remove('active');
    restoreIslandZoom();
    OpenDebug.end(dbg, { opened: false, error: String(err) });
  }
}

if (window.__TAURI__) {
  // macOS double-click (app already running): Rust emits this event
  window.__TAURI__.event.listen('boardfish://open-file', (event) => {
    openFilePath(event.payload);
  });

  // Cold launch: check if Rust stored a file path before JS was ready
  window.__TAURI__.core.invoke('get_startup_file').then((filePath) => {
    if (filePath) openFilePath(filePath);
  });
}
