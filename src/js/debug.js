// ─── Clipboard / image debugger ──────────────────────────────────────────────
var ClipDebug = (() => {

  const MAX_EVENTS = 2000;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];

  function sanitize(value) {
    return sanitizeDebugMeta(value);
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish clipboard]', entry);
  }

  function setRustDebug(value) {
    setNativeDebug('set_clipboard_debug', value);
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
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!enabled) return tauriInvoke(command, args);
    const t0 = performance.now();
    step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await tauriInvoke(command, args);
      const nativeTiming = result && typeof result === 'object' && !Array.isArray(result) ? result : null;
      step(ctx, 'invoke:ok', {
        command,
        ms: Math.round((performance.now() - t0) * 100) / 100,
        ...meta,
        ...(nativeTiming ? { nativeTiming } : {}),
      });
      return result;
    } catch (err) {
      step(ctx, 'invoke:error', { command, ms: Math.round((performance.now() - t0) * 100) / 100, error: String(err), ...meta });
      throw err;
    }
  }

  function timing(meta, key) {
    return meta?.nativeTiming?.[key] ?? '';
  }

  function debugRow(e, { includeId = false, includeSkipped = false } = {}) {
    return {
      ...(includeId ? { id: e.id, op: e.op } : {}),
      step: e.step,
      total: e.total,
      dt: e.dt,
      ms: e.meta?.ms ?? '',
      command: e.meta?.command || '',
      path: e.meta?.path || '',
      reason: e.meta?.reason || '',
      selectedCount: e.meta?.selectedCount ?? '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      processed: e.meta?.processed ?? '',
      registeredImages: e.meta?.registeredImages ?? '',
      historyIndex: e.meta?.historyIndex ?? '',
      nativePending: e.meta?.nativePending ?? '',
      queueMs: e.meta?.queueMs ?? '',
      signature: e.meta?.signature || '',
      imgKey: e.meta?.imgKey || '',
      added: e.meta?.added ?? '',
      bitmapReady: e.meta?.bitmapReady ?? '',
      fallbackReady: e.meta?.fallbackReady ?? '',
      dataUrlLen: e.meta?.dataUrlLen ?? '',
      blobSize: e.meta?.blobSize ?? '',
      nativePath: timing(e.meta, 'path'),
      flipped: timing(e.meta, 'flipped'),
      width: timing(e.meta, 'width'),
      height: timing(e.meta, 'height'),
      pixels: timing(e.meta, 'pixels'),
      rgbaMB: timing(e.meta, 'rgbaMb'),
      nativeTotalMs: timing(e.meta, 'totalMs'),
      decodeMs: timing(e.meta, 'decodeMs'),
      base64Ms: timing(e.meta, 'base64Ms'),
      imageDecodeMs: timing(e.meta, 'imageDecodeMs'),
      rgbaConvertMs: timing(e.meta, 'rgbaConvertMs'),
      transformMs: timing(e.meta, 'transformMs'),
      clipboardWriteMs: timing(e.meta, 'clipboardWriteMs'),
      arboardMs: timing(e.meta, 'arboardMs'),
      macosFallbackMs: timing(e.meta, 'macosFallbackMs'),
      textLen: e.meta?.textLen ?? '',
      seq: e.meta?.seq ?? '',
      expected: e.meta?.expected ?? '',
      current: e.meta?.current ?? '',
      ...(includeSkipped ? { skipped: e.meta?.skipped ?? '' } : {}),
      error: e.meta?.error || '',
    };
  }

  function dump() {
    console.table(events);
    return events.slice();
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => debugRow(e, { includeId: true }));
    console.table(rows);
    return rows;
  }

  function phaseSummary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => debugRow(e, { includeSkipped: true }));
    console.table(rows);
    return rows;
  }

  function copyBreakdown() {
    const rows = events
      .filter(e => e.step === 'invoke:ok' && e.meta?.nativeTiming)
      .map(e => ({
        total: e.total,
        command: e.meta?.command || '',
        imgKey: e.meta?.imgKey || '',
        nativePath: timing(e.meta, 'path'),
        flipped: timing(e.meta, 'flipped'),
        width: timing(e.meta, 'width'),
        height: timing(e.meta, 'height'),
        rgbaMB: timing(e.meta, 'rgbaMb'),
        invokeMs: e.meta?.ms ?? '',
        nativeTotalMs: timing(e.meta, 'totalMs'),
        decodeMs: timing(e.meta, 'decodeMs'),
        base64Ms: timing(e.meta, 'base64Ms'),
        imageDecodeMs: timing(e.meta, 'imageDecodeMs'),
        rgbaConvertMs: timing(e.meta, 'rgbaConvertMs'),
        transformMs: timing(e.meta, 'transformMs'),
        clipboardWriteMs: timing(e.meta, 'clipboardWriteMs'),
        arboardMs: timing(e.meta, 'arboardMs'),
        macosFallbackMs: timing(e.meta, 'macosFallbackMs'),
      }));
    console.table(rows);
    return rows;
  }

  function status() {
    const last = events[events.length - 1];
    const latest = (stepName) => [...events].reverse().find(e => e.step === stepName);
    const copyEnd = [...events].reverse().find(e => e.op === 'copySelected' && e.step === 'end');
    const pasteEnd = [...events].reverse().find(e => e.op === 'pasteAtPos' && e.step === 'end');
    const copyProgress = latest('copy:multi-progress');
    const pasteProgress = latest('paste:objects-add-progress') || latest('paste:register-images-progress');
    const nativeStart = latest('native-copy-start');
    const nativeFinish = latest('native-copy-finished');
    const out = {
      lastOp: last?.op || '',
      lastStep: last?.step || '',
      totalMs: last?.total ?? '',
      path: last?.meta?.path || '',
      nativePending: nativeClipboardPendingCount(),
      nativeReady: nativeClipboardPendingCount() === 0,
      nativeQueueMs: nativeStart?.meta?.queueMs ?? '',
      nativeSignature: nativeStart?.meta?.signature || nativeFinish?.meta?.signature || '',
      nativeError: nativeClipboardLastError() || '',
      copyObjects: copyEnd?.meta?.objectCount ?? copyProgress?.meta?.objectCount ?? '',
      copyImages: copyEnd?.meta?.imageCount ?? copyProgress?.meta?.imageCount ?? '',
      pasteObjects: pasteEnd?.meta?.objectCount ?? pasteProgress?.meta?.objectCount ?? '',
      processed: pasteProgress?.meta?.processed ?? copyProgress?.meta?.processed ?? '',
      registeredImages: pasteEnd?.meta?.registeredImages ?? pasteProgress?.meta?.registeredImages ?? '',
      historyIndex: pasteEnd?.meta?.historyIndex ?? '',
      error: last?.meta?.error || '',
    };
    console.table([out]);
    return out;
  }

  function reset() { events.length = 0; }
  const clear = reset;


  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    invoke,
    dump,
    summary,
    phaseSummary,
    copyBreakdown,
    status,
    waitForNative: (timeoutMs) => (
      typeof waitForNativeClipboardIdle === 'function'
        ? waitForNativeClipboardIdle(timeoutMs)
        : Promise.resolve({ ready: true, error: '' })
    ),
    reset,
    clear,
    get events() { return events.slice(); },
  };
})();

exposeDebug({ clipboard: ClipDebug });

// ─── History debugger ───────────────────────────────────────────────────────
var HistoryDebug = (() => {
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
    return round2(value);
  }

  function sanitize(value) {
    return sanitizeDebugMeta(value, { redactPattern: null, roundNumbers: true });
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
    console.info('Boardfish history debugger enabled. Use BoardfishDebug.history.pushes(), .summary(), .dump(), .setVerbose(true), or .reset().');
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
      reason: e.meta?.reason ?? '',
      ms: e.meta?.ms ?? '',
    }));
    console.table(rows);
    return rows;
  }

  function pushes() {
    const rows = events.filter(e => e.op === 'pushHistory' && e.step === 'end').map(e => ({
      id: e.id,
      objectCount: e.meta?.objectCount ?? '',
      historyLength: e.meta?.historyLength ?? '',
      historyIndex: e.meta?.historyIndex ?? '',
      cloned: e.meta?.cloned ?? '',
      reused: e.meta?.reused ?? '',
      reason: e.meta?.reason ?? '',
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

  return { enable, disable, setVerbose, start, step, end, count, max, summary, pushes, dump, reset, clear: reset, get events() { return events.slice(); }, get stats() { return { ...stats }; } };
})();

exposeDebug({ history: HistoryDebug });
var ViewportDebug = (() => {
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
    nativeImageAdds: 0,
    imageLoads: 0,
    imageDecodeQueued: 0,
    maxImageDecodeQueueDepth: 0,
    imageDecodes: 0,
    imageDecodeFailures: 0,
    imageBitmaps: 0,
    imageBitmapFailures: 0,
    imagePreviewPrepared: 0,
    imagePreviewFailures: 0,
    imageDrawMissing: 0,
    imageDrawFallback: 0,
    imageDrawErrors: 0,
    culledImages: 0,
    culledText: 0,
    croppedImages: 0,
    maxImageAddMs: 0,
    maxImageLoadMs: 0,
    maxImageDecodeMs: 0,
    maxImageBitmapMs: 0,
    maxImagePreviewMs: 0,
  };
  let lastRafAt = 0;

  function sanitize(value) {
    return sanitizeDebugMeta(value, { roundNumbers: true });
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
    console.info('Boardfish viewport debugger enabled. Events are buffered without per-event console logging. Use BoardfishDebug.viewport.summary(), .drawSummary(), .imageHealth(), .dump(), .setVerbose(true), or .reset().');
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
      { metric: 'perfMode', value: viewportPerfModeSummary().label },
      { metric: 'cullingEnabled', value: viewportCullingEnabled },
      { metric: 'scaling025Enabled', value: viewportImageScalingEnabled },
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
      { metric: 'nativeImageAdds', value: stats.nativeImageAdds },
      { metric: 'imageLoads', value: stats.imageLoads },
      { metric: 'imageDecodeQueued', value: stats.imageDecodeQueued },
      { metric: 'maxImageDecodeQueueDepth', value: stats.maxImageDecodeQueueDepth },
      { metric: 'imageDecodes', value: stats.imageDecodes },
      { metric: 'imageDecodeFailures', value: stats.imageDecodeFailures },
      { metric: 'imageBitmaps', value: stats.imageBitmaps },
      { metric: 'imageBitmapFailures', value: stats.imageBitmapFailures },
      { metric: 'imagePreviewPrepared', value: stats.imagePreviewPrepared },
      { metric: 'imagePreviewFailures', value: stats.imagePreviewFailures },
      { metric: 'imageDrawMissing', value: stats.imageDrawMissing },
      { metric: 'imageDrawFallback', value: stats.imageDrawFallback },
      { metric: 'imageDrawErrors', value: stats.imageDrawErrors },
      { metric: 'culledImages', value: stats.culledImages },
      { metric: 'culledText', value: stats.culledText },
      { metric: 'croppedImages', value: stats.croppedImages },
      { metric: 'maxImageAddMs', value: Math.round(stats.maxImageAddMs * 100) / 100 },
      { metric: 'maxImageLoadMs', value: Math.round(stats.maxImageLoadMs * 100) / 100 },
      { metric: 'maxImageDecodeMs', value: Math.round(stats.maxImageDecodeMs * 100) / 100 },
      { metric: 'maxImageBitmapMs', value: Math.round(stats.maxImageBitmapMs * 100) / 100 },
      { metric: 'maxImagePreviewMs', value: Math.round(stats.maxImagePreviewMs * 100) / 100 },
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
      avgScaledImages: draws.length ? Math.round(sum('scaledImages') / draws.length * 100) / 100 : 0,
      maxScaledImages: max('scaledImages'),
      avgScaledFallbackFull: draws.length ? Math.round(sum('scaledFallbackFull') / draws.length * 100) / 100 : 0,
      avgScaledImageScale: sum('scaledImages') ? Math.round(sum('scaledImageScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgTargetImageScale: sum('scaledImages') ? Math.round(sum('scaledImageTargetScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgMissingImages: draws.length ? Math.round(sum('missingImages') / draws.length * 100) / 100 : 0,
      maxMissingImages: max('missingImages'),
      avgErroredImages: draws.length ? Math.round(sum('erroredImages') / draws.length * 100) / 100 : 0,
      avgCroppedImages: draws.length ? Math.round(sum('croppedImages') / draws.length * 100) / 100 : 0,
      avgDrawnText: draws.length ? Math.round(sum('drawnText') / draws.length * 100) / 100 : 0,
      avgCulledText: draws.length ? Math.round(sum('culledText') / draws.length * 100) / 100 : 0,
    };
    console.table([out]);
    return out;
  }

  function imageHealth(limit = 40) {
    const rows = (typeof objects === 'undefined' ? [] : objects)
      .filter(obj => obj.type === 'image')
      .map(obj => {
        const key = obj.data?.imgKey || '';
        const img = key ? imageCache[key] : null;
        const bitmap = key ? imageBitmapCache[key] : null;
        const src = key ? imageStore[key] : null;
        const assetUrl = key ? imageAssetUrlCache[key] : '';
        const ready = key ? imageReadyPromises.get(key) : null;
        let status = 'ok';
        if (!key) status = 'missing-key';
        else if (!src) status = 'missing-store';
        else if (!assetUrl && isNativeImageRef(src)) status = 'missing-asset-url';
        else if (!img) status = 'missing-image-element';
        else if (imageBitmapFailed.has(key) && img.complete && img.naturalWidth > 0) status = 'fallback-ok';
        else if (imageBitmapFailed.has(key)) status = 'bitmap-failed-no-fallback';
        else if (!bitmap) status = img.complete && img.naturalWidth > 0 ? 'loaded-no-bitmap' : 'not-loaded';
        return {
          id: obj.id,
          key,
          status,
          x: Math.round(obj.x),
          y: Math.round(obj.y),
          w: Math.round(obj.w),
          h: Math.round(obj.h),
          native: !!src?.native,
          bytes: src?.bytes ?? '',
          hasAssetUrl: !!assetUrl,
          hasImg: !!img,
          complete: !!img?.complete,
          naturalW: img?.naturalWidth || 0,
          naturalH: img?.naturalHeight || 0,
          hasBitmap: !!bitmap,
          bitmapFailed: key ? imageBitmapFailed.has(key) : false,
          hasReadyPromise: !!ready,
        };
      });
    const bad = rows.filter(row => row.status !== 'ok' && row.status !== 'fallback-ok');
    console.table((bad.length ? bad : rows).slice(0, limit));
    return { total: rows.length, badCount: bad.length, bad, rows };
  }

  function imageHealthSummary() {
    const health = imageHealth(0);
    const counts = health.rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});
    const out = {
      total: health.total,
      badCount: health.badCount,
      ok: counts.ok || 0,
      missingKey: counts['missing-key'] || 0,
      missingStore: counts['missing-store'] || 0,
      missingAssetUrl: counts['missing-asset-url'] || 0,
      missingImageElement: counts['missing-image-element'] || 0,
      fallbackOk: counts['fallback-ok'] || 0,
      bitmapFailedNoFallback: counts['bitmap-failed-no-fallback'] || 0,
      loadedNoBitmap: counts['loaded-no-bitmap'] || 0,
      notLoaded: counts['not-loaded'] || 0,
    };
    console.table([out]);
    return out;
  }

  function imageScaleCacheSummary() {
    const byScale = {};
    let variantCount = 0;
    for (const map of imageScaledBitmapCache.values()) {
      for (const [scale, entry] of map.entries()) {
        variantCount++;
        if (!byScale[scale]) byScale[scale] = { count: 0, mb: 0 };
        byScale[scale].count++;
        byScale[scale].mb += (entry.bytes || 0) / 1024 / 1024;
      }
    }
    const rows = Object.entries(byScale).map(([scale, row]) => ({
      scale,
      count: row.count,
      mb: Math.round(row.mb * 100) / 100,
    }));
    const out = {
      variants: variantCount,
      cacheMB: Math.round(imageScaledBitmapBytes / 1024 / 1024 * 100) / 100,
      limitMB: Math.round(IMAGE_VARIANT_MEMORY_LIMIT / 1024 / 1024),
      pending: imageScaledBitmapPending.size,
      pendingMB: Math.round(pendingScaledVariantBytes() / 1024 / 1024 * 100) / 100,
      queued: imageScaledVariantQueue.length,
      renderBatchPending: !!imageScaledVariantRenderTimer,
      renderBatchCount: imageScaledVariantRenderCount,
      inputIdleMs: Math.round((performance.now() - lastViewportInputAt) * 10) / 10,
      inputIdleThresholdMs: IMAGE_VARIANT_INPUT_IDLE_MS,
      builds: imageScaledVariantBuildCount,
      avgBuildMs: imageScaledVariantBuildCount ? Math.round(imageScaledVariantBuildTotalMs / imageScaledVariantBuildCount * 10) / 10 : 0,
      maxBuildMs: Math.round(imageScaledVariantBuildMaxMs * 10) / 10,
      resizeBitmapBuilds: imageScaledVariantResizeBitmapCount,
      canvasFallbackBuilds: imageScaledVariantCanvasFallbackCount,
      evictions: imageScaledVariantEvictionCount,
      memorySkips: imageScaledVariantMemorySkipCount,
      levels: IMAGE_SCALE_LEVELS.join(','),
      enabled: viewportImageScalingEnabled,
      qualityBuffer: IMAGE_SCALE_QUALITY_BUFFER,
    };
    console.table([out]);
    if (rows.length) console.table(rows);
    return { ...out, byScale: rows };
  }

  function cullingSummary() {
    const rect = currentViewportWorldRect();
    let visibleImages = 0;
    let visibleText = 0;
    let culledImages = 0;
    let culledText = 0;
    let visibleImagesWithScaledVariant = 0;
    let visibleImagesMissingScaledVariant = 0;
    let visibleScaledVariantMB = 0;
    for (const obj of objects) {
      const visible = objectIntersectsRect(obj, rect);
      if (obj.type === 'image') {
        if (visible) {
          visibleImages++;
          const key = obj.data?.imgKey;
          const bitmap = key ? imageBitmapCache[key] : null;
          const fullSource = bitmap || imageCache[key] || null;
          const targetScale = fullSource ? chooseImageScaleForDraw(obj, fullSource) : 1;
          if (targetScale < 1) {
            const sourceW = fullSource?.width || fullSource?.naturalWidth || 0;
            const sourceH = fullSource?.height || fullSource?.naturalHeight || 0;
            visibleScaledVariantMB += scaledVariantEstimatedBytes(sourceW, sourceH, targetScale) / 1024 / 1024;
            if (imageScaledBitmapCache.get(key)?.has(targetScale)) visibleImagesWithScaledVariant++;
            else visibleImagesMissingScaledVariant++;
          }
        } else culledImages++;
      } else if (obj.type === 'text') {
        if (visible) visibleText++;
        else culledText++;
      }
    }
    const out = {
      paddingPx: VIEWPORT_CULL_PADDING_PX,
      enabled: viewportCullingEnabled,
      zoom: Math.round(zoom * 1000) / 1000,
      padWorld: Math.round((VIEWPORT_CULL_PADDING_PX / Math.max(zoom, 0.001)) * 100) / 100,
      visibleImages,
      culledImages,
      visibleImagesWithScaledVariant,
      visibleImagesMissingScaledVariant,
      visibleScaledVariantMB: Math.round(visibleScaledVariantMB * 100) / 100,
      visibleText,
      culledText,
      rectX1: Math.round(rect.x1),
      rectY1: Math.round(rect.y1),
      rectX2: Math.round(rect.x2),
      rectY2: Math.round(rect.y2),
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
    imageHealth,
    imageHealthSummary,
    imageScaleCacheSummary,
    cullingSummary,
    setPerfMode: (modeKey) => (
      typeof setViewportPerfMode === 'function' ? setViewportPerfMode(modeKey) : null
    ),
    perfMode: (modeKey = null) => (
      typeof viewportPerfModeSummary === 'function' ? viewportPerfModeSummary(modeKey) : null
    ),
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
var SaveDebug = (() => {
  function sanitize(value) {
    return sanitizeDebugMeta(value, { redactPattern: /dataUrl|src|base64|imageStore/i, roundNumbers: true });
  }

  const core = createDebugRecorder({
    maxEvents: 300,
    label: '[Boardfish save]',
    sanitize,
    onEnable: () => setNativeDebug('set_save_debug', true),
    onDisable: () => setNativeDebug('set_save_debug', false),
  });

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish save debugger enabled. Use BoardfishDebug.save.summary(), .dump(), or .reset().');
  }

  function disable() {
    core.disable();
    console.info('Boardfish save debugger disabled.');
  }

  async function invoke(ctx, command, args = {}, meta = {}) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!core.enabled) return tauriInvoke(command, args);
    const t0 = performance.now();
    core.step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await tauriInvoke(command, args);
      core.step(ctx, 'invoke:ok', { command, ms: performance.now() - t0, rust: result || null });
      return result;
    } catch (err) {
      core.step(ctx, 'invoke:error', { command, ms: performance.now() - t0, error: String(err) });
      throw err;
    }
  }

  function dump() {
    const flat = core.events.map(({ meta, ...rest }) => {
      if (!meta) return rest;
      const { rust, ...other } = meta;
      return rust && typeof rust === 'object'
        ? { ...rest, ...other, ...Object.fromEntries(Object.entries(rust).map(([k, v]) => ['rust_' + k, v])) }
        : { ...rest, ...other };
    });
    console.table(flat);
    return core.events;
  }

  function summary() {
    const rows = core.events.filter(e => e.step && e.step !== 'start').map(e => ({
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
    const rows = core.events
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

  return {
    enable,
    disable,
    setVerbose: core.setVerbose,
    start: core.start,
    step: core.step,
    end: core.end,
    invoke,
    dump,
    summary,
    phaseSummary,
    reset: core.reset,
    get enabled() { return core.enabled; },
    get events() { return core.events; },
  };
})();

exposeDebug({ save: SaveDebug });

// ─── Open debugger ───────────────────────────────────────────────────────────
var OpenDebug = (() => {
  const MAX_EVENTS = 5000;
  let enabled = false;
  let verbose = false;
  let hydrationMode = 'all-before-open';
  let hydrationConcurrency = 8;
  let nextOpId = 1;
  const events = [];

  function sanitize(value) {
    return sanitizeDebugMeta(value, { redactPattern: /dataUrl|src|base64|imageStore/i, roundNumbers: true });
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish open]', entry);
  }

  function setRustDebug(value) {
    setNativeDebug('set_open_debug', value);
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
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!enabled) return tauriInvoke(command, args);
    const t0 = performance.now();
    step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await tauriInvoke(command, args);
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

  function status() {
    const last = events[events.length - 1] || null;
    const rows = [{
      lastStep: last?.step || '',
      op: last?.op || '',
      totalMs: last?.total ?? '',
      imageCount: last?.meta?.imageCount ?? last?.meta?.imageObjectCount ?? '',
      objectCount: last?.meta?.objectCount ?? '',
      hydrated: last?.meta?.hydrated ?? '',
      remaining: last?.meta?.remaining ?? '',
      error: last?.meta?.error || '',
      hydrationMode,
      hydrationConcurrency,
    }];
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

  function stepSummary(prefix = '') {
    const rows = events
      .filter(e => !prefix || e.step?.startsWith(prefix))
      .map(e => ({
        step: e.step,
        total: e.total,
        dt: e.dt,
        command: e.meta?.command || '',
        count: e.meta?.count ?? '',
        hydrated: e.meta?.hydrated ?? '',
        pendingNativeImages: e.meta?.pendingNativeImages ?? '',
        nativeRefs: e.meta?.nativeRefs ?? '',
        manifestRefs: e.meta?.manifestRefs ?? '',
        dataUrlRefs: e.meta?.dataUrlRefs ?? '',
        missingStoreRefs: e.meta?.missingStoreRefs ?? '',
        cachedImages: e.meta?.cachedImages ?? '',
        assetUrls: e.meta?.assetUrls ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
        reason: e.meta?.reason || '',
        error: e.meta?.error || '',
      }));
    console.table(rows);
    return rows;
  }

  function imageStoreSummary() {
    const out = getOpenImageRuntimeMetrics();
    console.table([out]);
    return out;
  }

  function imageStoreSample(limit = 20) {
    const rows = getImageStoreOpenDebugSample(limit);
    console.table(rows);
    return rows;
  }

  function hydrationCandidates() {
    const pending = getPendingNativeImageKeys();
    const visible = getVisibleImageKeys();
    const out = {
      pendingNativeCount: pending.length,
      visibleNativeCount: visible.length,
      pendingDebug: getPendingNativeImageKeys.lastDebug,
      visibleDebug: getVisibleImageKeys.lastDebug,
      ...getOpenImageRuntimeMetrics(),
    };
    console.log(out);
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
    status,
    hydrationSummary,
    stepSummary,
    imageStoreSummary,
    imageStoreSample,
    hydrationCandidates,
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
var ExportDebug = (() => {
  const MAX_EVENTS = 2000;
  const MAX_MASSIVE_SAMPLES = 8;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];
  let massive = null;

  function sanitize(value) {
    return sanitizeDebugMeta(value, { roundNumbers: true });
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish export]', entry);
  }

  function setRustDebug(value) {
    setNativeDebug('set_save_debug', value);
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;

    if (options.verbose === true) setVerbose(true);
    setRustDebug(true);
    console.info('Boardfish export debugger enabled. For progress issues use BoardfishDebug.export.progressReport(); for massive boards use .massiveReport(); also available: .status(), .slowImageReport(), .summary(), .dump(), .reset().');
  }

  function disable() {
    enabled = false;

    setRustDebug(false);
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

  function pushTop(list, row, scoreKey, limit = MAX_MASSIVE_SAMPLES) {
    list.push(row);
    list.sort((a, b) => Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0));
    if (list.length > limit) list.length = limit;
  }

  function pushSample(list, row, limit = MAX_MASSIVE_SAMPLES) {
    if (list.length < limit) list.push(row);
  }

  function startMassive(op, imageObjs = []) {
    if (!enabled) return null;
    const seen = new Map();
    const countsBySourceKind = { nativeRef: 0, dataUrl: 0, missing: 0, other: 0 };
    let storedBytes = 0;
    let transformedCount = 0;
    let duplicateObjectCount = 0;
    let missingSourceCount = 0;
    const largestStored = [];
    const duplicateKeys = [];
    const missingSourceSamples = [];

    imageObjs.forEach((obj, index) => {
      const imgKey = obj?.data?.imgKey || '';
      const source = imgKey ? imageStore[imgKey] : null;
      const bytes = imageStoreBytesEstimate(source);
      storedBytes += bytes;
      if (imageNeedsRendering(obj)) transformedCount++;
      if (isNativeImageRef(source)) countsBySourceKind.nativeRef++;
      else if (typeof source === 'string') countsBySourceKind.dataUrl++;
      else if (!source) {
        countsBySourceKind.missing++;
        missingSourceCount++;
        pushSample(missingSourceSamples, { index, objectId: obj?.id || '', imgKey });
      } else countsBySourceKind.other++;

      if (imgKey) {
        const prev = seen.get(imgKey) || 0;
        if (prev === 1) duplicateKeys.push(imgKey);
        if (prev >= 1) duplicateObjectCount++;
        seen.set(imgKey, prev + 1);
      }

      pushTop(largestStored, {
        index,
        objectId: obj?.id || '',
        imgKey,
        storedMB: Math.round(bytes / 1024 / 1024 * 100) / 100,
        needsRender: imageNeedsRendering(obj),
      }, 'storedMB');
    });

    massive = {
      op,
      startedAt: new Date().toISOString(),
      startedPerf: performance.now(),
      totalMs: 0,
      imageCount: imageObjs.length,
      transformedCount,
      passthroughCount: imageObjs.length - transformedCount,
      countsBySourceKind,
      storedPayloadMB: Math.round(storedBytes / 1024 / 1024 * 100) / 100,
      duplicateKeyCount: duplicateKeys.length,
      duplicateObjectCount,
      duplicateKeySamples: duplicateKeys.slice(0, MAX_MASSIVE_SAMPLES),
      missingSourceCount,
      missingSourceSamples,
      resolve: {
        startedAtMs: null,
        completedAtMs: null,
        durationMs: 0,
        processed: 0,
        keyCount: 0,
        tempKeyCount: 0,
        renderedCount: 0,
        nativeTransformCount: 0,
        fallbackRenderCount: 0,
        skippedCount: 0,
        errorCount: 0,
        progressUpdates: 0,
        lastProgressAt: 0,
        lastProcessed: 0,
        lastKeyCount: 0,
        slowest: [],
        errors: [],
      },
      save: {
        startedAtMs: null,
        completedAtMs: null,
        durationMs: 0,
        batchSize: 0,
        lastBatchSize: 0,
        batchCount: 0,
        batchesDone: 0,
        savedCount: 0,
        failedCount: 0,
        missingCount: 0,
        bytesMB: 0,
        slowestBatches: [],
        errors: [],
      },
      progressUi: {
        updates: 0,
        currentText: '',
        firstText: '',
        firstNonZeroText: '',
        firstNonZeroAtMs: null,
        zeroHoldMs: null,
        samples: [],
      },
      largestStored,
      lastStep: 'start',
      lastError: '',
    };
    return massive;
  }

  function massiveStep(stepName, meta = {}) {
    if (!massive) return;
    massive.lastStep = stepName;
    massive.totalMs = Math.round((performance.now() - massive.startedPerf) * 100) / 100;
    if (meta.error) massive.lastError = String(meta.error);
  }

  function massiveElapsedMs() {
    return massive ? Math.round((performance.now() - massive.startedPerf) * 100) / 100 : 0;
  }

  function recordResolveStart(meta = {}) {
    if (!massive) return;
    massive.resolve.startedAtMs = massiveElapsedMs();
    massiveStep('resolve-start', meta);
  }

  function recordResolveProgress(meta = {}) {
    if (!massive) return;
    const r = massive.resolve;
    r.progressUpdates++;
    r.lastProcessed = meta.processed ?? r.lastProcessed;
    r.lastKeyCount = meta.keyCount ?? r.lastKeyCount;
    massiveStep('resolve-progress', meta);
  }

  function recordResolveDone(meta = {}) {
    if (!massive) return;
    const r = massive.resolve;
    r.completedAtMs = massiveElapsedMs();
    r.durationMs = r.startedAtMs == null ? 0 : Math.round((r.completedAtMs - r.startedAtMs) * 100) / 100;
    r.lastProcessed = meta.processed ?? r.processed;
    r.lastKeyCount = meta.keyCount ?? r.keyCount;
    massiveStep('resolve-done', meta);
  }

  function recordResolve(meta = {}) {
    if (!massive) return;
    const r = massive.resolve;
    r.processed++;
    if (meta.key) r.keyCount++;
    if (meta.tempKey) r.tempKeyCount++;
    if (meta.rendered) r.renderedCount++;
    if (meta.nativeTransform) r.nativeTransformCount++;
    if (meta.fallbackRender) r.fallbackRenderCount++;
    if (meta.skipped) r.skippedCount++;
    if (meta.error) {
      r.errorCount++;
      pushSample(r.errors, {
        index: meta.index ?? '',
        objectId: meta.objectId || '',
        imgKey: meta.imgKey || '',
        phase: meta.phase || '',
        error: String(meta.error).slice(0, 240),
      });
      massive.lastError = String(meta.error);
    }
    pushTop(r.slowest, {
      index: meta.index ?? '',
      objectId: meta.objectId || '',
      imgKey: meta.imgKey || '',
      phase: meta.phase || '',
      ms: Math.round((meta.ms || 0) * 100) / 100,
      nativeTransform: !!meta.nativeTransform,
      fallbackRender: !!meta.fallbackRender,
    }, 'ms');
    r.lastProgressAt = performance.now();
    massiveStep('resolve');
  }

  function recordSaveStart(meta = {}) {
    if (!massive) return;
    massive.save.startedAtMs = massiveElapsedMs();
    massive.save.batchCount = meta.batchCount || massive.save.batchCount;
    massive.save.batchSize = meta.batchSize || massive.save.batchSize;
    massiveStep('save-start', meta);
  }

  function recordSaveBatch(meta = {}) {
    if (!massive) return;
    const s = massive.save;
    s.lastBatchSize = meta.batchSize || s.lastBatchSize;
    s.batchCount = meta.batchCount || s.batchCount;
    s.batchesDone++;
    s.savedCount += Number(meta.savedCount) || 0;
    s.failedCount += Number(meta.failedCount) || 0;
    s.missingCount += Number(meta.missingCount) || 0;
    s.bytesMB = Math.round((s.bytesMB + (Number(meta.bytesMB) || 0)) * 100) / 100;
    if (meta.error) {
      pushSample(s.errors, {
        batchIndex: meta.batchIndex ?? '',
        error: String(meta.error).slice(0, 240),
      });
      massive.lastError = String(meta.error);
    }
    pushTop(s.slowestBatches, {
      batchIndex: meta.batchIndex ?? '',
      keyCount: meta.keyCount ?? '',
      savedCount: meta.savedCount ?? '',
      failedCount: meta.failedCount ?? '',
      missingCount: meta.missingCount ?? '',
      ms: Math.round((meta.ms || 0) * 100) / 100,
    }, 'ms');
    massiveStep('save');
  }

  function recordSaveDone(meta = {}) {
    if (!massive) return;
    const s = massive.save;
    s.completedAtMs = massiveElapsedMs();
    s.durationMs = s.startedAtMs == null ? 0 : Math.round((s.completedAtMs - s.startedAtMs) * 100) / 100;
    massiveStep('save-done', meta);
  }

  function recordProgressUi(meta = {}) {
    if (!massive) return;
    const p = massive.progressUi;
    const text = String(meta.text || '');
    const elapsedMs = massiveElapsedMs();
    p.updates++;
    p.currentText = text;
    if (!p.firstText) p.firstText = text;
    const finishedCount = Number(meta.finishedCount) || 0;
    if (finishedCount > 0 && p.firstNonZeroAtMs == null) {
      p.firstNonZeroAtMs = elapsedMs;
      p.zeroHoldMs = elapsedMs;
      p.firstNonZeroText = text;
    }
    pushSample(p.samples, {
      atMs: elapsedMs,
      phase: meta.phase || '',
      text,
      finishedCount,
      preparedCount: meta.preparedCount ?? '',
      totalCount: meta.totalCount ?? '',
      batchIndex: meta.batchIndex ?? '',
      batchCount: meta.batchCount ?? '',
      savedKeyCount: meta.savedKeyCount ?? '',
    });
    massiveStep('ui-progress', meta);
  }

  function massiveReport() {
    const report = massive ? JSON.parse(JSON.stringify(massive)) : null;
    if (!report) {
      console.warn('[Boardfish export] No massive export report yet. Enable export debug, then run an export.');
      return null;
    }
    const headline = {
      op: report.op,
      imageCount: report.imageCount,
      storedPayloadMB: report.storedPayloadMB,
      transformedCount: report.transformedCount,
      passthroughCount: report.passthroughCount,
      nativeRefs: report.countsBySourceKind.nativeRef,
      dataUrls: report.countsBySourceKind.dataUrl,
      missingSources: report.missingSourceCount,
      duplicateKeys: report.duplicateKeyCount,
      lastStep: report.lastStep,
      lastError: report.lastError,
      resolved: report.resolve.keyCount,
      resolveErrors: report.resolve.errorCount,
      saved: report.save.savedCount,
      saveFailed: report.save.failedCount,
      saveMissing: report.save.missingCount,
      batches: `${report.save.batchesDone}/${report.save.batchCount || 0}`,
      writtenMB: report.save.bytesMB,
      resolveDurationMs: report.resolve.durationMs,
      saveDurationMs: report.save.durationMs,
      uiCurrentText: report.progressUi.currentText,
      uiFirstNonZeroAtMs: report.progressUi.firstNonZeroAtMs,
      uiZeroHoldMs: report.progressUi.zeroHoldMs,
    };
    console.group('[Boardfish export] massive report');
    console.table([headline]);
    console.table([report.progressUi]);
    console.table([{
      resolveStartedAtMs: report.resolve.startedAtMs,
      resolveCompletedAtMs: report.resolve.completedAtMs,
      resolveDurationMs: report.resolve.durationMs,
      resolveProgressUpdates: report.resolve.progressUpdates,
      resolveLastProcessed: report.resolve.lastProcessed,
      resolveLastKeyCount: report.resolve.lastKeyCount,
      saveStartedAtMs: report.save.startedAtMs,
      saveCompletedAtMs: report.save.completedAtMs,
      saveDurationMs: report.save.durationMs,
    }]);
    console.table(report.progressUi.samples);
    console.table(report.largestStored);
    console.table(report.resolve.slowest);
    console.table(report.resolve.errors);
    console.table(report.save.slowestBatches);
    console.table(report.save.errors);
    console.groupEnd();
    return { headline, report };
  }

  function progressReport() {
    const report = massive ? JSON.parse(JSON.stringify(massive)) : null;
    if (!report) {
      console.warn('[Boardfish export] No progress report yet. Enable export debug, then run an export.');
      return null;
    }
    const totalMs = Number(report.totalMs) || 0;
    const phaseRows = [
      {
        phase: 'resolve/register',
        startedAtMs: report.resolve.startedAtMs,
        completedAtMs: report.resolve.completedAtMs,
        durationMs: report.resolve.durationMs,
        pctOfTotal: totalMs ? Math.round(report.resolve.durationMs / totalMs * 1000) / 10 : '',
        processed: report.resolve.processed,
        keyCount: report.resolve.keyCount,
        updates: report.resolve.progressUpdates,
      },
      {
        phase: 'save/write',
        startedAtMs: report.save.startedAtMs,
        completedAtMs: report.save.completedAtMs,
        durationMs: report.save.durationMs,
        pctOfTotal: totalMs ? Math.round(report.save.durationMs / totalMs * 1000) / 10 : '',
        processed: report.save.savedCount + report.save.failedCount + report.save.missingCount,
        keyCount: report.imageCount,
        updates: report.progressUi.updates,
      },
    ];
    const uiRows = [{
      firstText: report.progressUi.firstText,
      firstNonZeroText: report.progressUi.firstNonZeroText,
      currentText: report.progressUi.currentText,
      firstNonZeroAtMs: report.progressUi.firstNonZeroAtMs,
      zeroHoldMs: report.progressUi.zeroHoldMs,
      zeroHoldPctOfTotal: totalMs && report.progressUi.zeroHoldMs != null ? Math.round(report.progressUi.zeroHoldMs / totalMs * 1000) / 10 : '',
      uiUpdates: report.progressUi.updates,
      saveStartedAtMs: report.save.startedAtMs,
      saveDurationMs: report.save.durationMs,
    }];
    console.group('[Boardfish export] progress report');
    console.table(phaseRows);
    console.table(uiRows);
    console.table(report.progressUi.samples);
    console.groupEnd();
    return { phaseRows, uiRows, samples: report.progressUi.samples, report };
  }

  function watch(ctx, phase, meta = {}, intervalMs = 2000) {
    if (!enabled || !ctx) return () => {};
    const startedAt = performance.now();
    let tick = 0;
    let expectedAt = startedAt + intervalMs;
    step(ctx, 'watch:start', { phase, ...meta });
    const timer = setInterval(() => {
      const now = performance.now();
      tick++;
      step(ctx, 'watch:tick', {
        phase,
        tick,
        elapsedMs: now - startedAt,
        lagMs: now - expectedAt,
        ...meta,
      });
      expectedAt += intervalMs;
    }, intervalMs);
    return (doneMeta = {}) => {
      clearInterval(timer);
      step(ctx, 'watch:end', {
        phase,
        elapsedMs: performance.now() - startedAt,
        tick,
        ...meta,
        ...doneMeta,
      });
    };
  }

  async function invoke(ctx, command, args = {}, meta = {}) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!enabled) return tauriInvoke(command, args);
    step(ctx, 'invoke:start', { command, ...sanitize(meta) });
    const t0 = performance.now();
    try {
      const result = await tauriInvoke(command, args);
      step(ctx, 'invoke:ok', { command, ...sanitize(meta), ms: Math.round((performance.now() - t0) * 100) / 100, result });
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
      processed: e.meta?.processed ?? '',
      batchIndex: e.meta?.batchIndex ?? '',
      batchCount: e.meta?.batchCount ?? '',
      tempKeyCount: e.meta?.tempKeyCount ?? '',
      renderedCount: e.meta?.renderedCount ?? '',
      savedCount: e.meta?.savedCount ?? '',
      failedCount: e.meta?.failedCount ?? '',
      missingCount: e.meta?.missingCount ?? '',
      bytesMB: e.meta?.bytesMB ?? '',
      cancelled: e.meta?.cancelled ?? '',
      phase: e.meta?.phase || '',
      tick: e.meta?.tick ?? '',
      elapsedMs: e.meta?.elapsedMs ?? '',
      lagMs: e.meta?.lagMs ?? '',
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
        processed: e.meta?.processed ?? '',
        batchIndex: e.meta?.batchIndex ?? '',
        batchCount: e.meta?.batchCount ?? '',
        tempKeyCount: e.meta?.tempKeyCount ?? '',
        renderedCount: e.meta?.renderedCount ?? '',
        dataUrlLen: e.meta?.dataUrlLen ?? '',
        savedCount: e.meta?.savedCount ?? e.meta?.result ?? '',
        failedCount: e.meta?.failedCount ?? '',
        missingCount: e.meta?.missingCount ?? '',
        bytesMB: e.meta?.bytesMB ?? '',
        cancelled: e.meta?.cancelled ?? '',
        phase: e.meta?.phase || '',
        tick: e.meta?.tick ?? '',
        elapsedMs: e.meta?.elapsedMs ?? '',
        lagMs: e.meta?.lagMs ?? '',
        result: e.meta?.result ?? '',
        error: e.meta?.error || '',
      }));
    console.table(rows);
    return rows;
  }

  function slowImageReport() {
    const renderRows = events
      .filter(e => e.step === 'render:done')
      .map(e => ({
        id: e.id,
        op: e.op,
        imgKey: e.meta?.imgKey ?? '',
        objectId: e.meta?.objectId ?? '',
        flipX: e.meta?.flipX ?? '',
        flipY: e.meta?.flipY ?? '',
        rotation: e.meta?.rotation ?? '',
        sourceKind: e.meta?.sourceKind ?? '',
        sourceMs: e.meta?.sourceMs ?? '',
        loadMs: e.meta?.loadMs ?? '',
        drawMs: e.meta?.drawMs ?? '',
        encodeMs: e.meta?.encodeMs ?? '',
        totalRenderMs: e.meta?.totalRenderMs ?? e.meta?.ms ?? '',
        width: e.meta?.width ?? '',
        height: e.meta?.height ?? '',
        megapixels: e.meta?.megapixels ?? '',
        dataUrlMB: e.meta?.dataUrlMB ?? '',
        ok: e.meta?.hasDataUrl ?? e.meta?.ok ?? '',
        error: e.meta?.error || '',
      }))
      .sort((a, b) => Number(b.totalRenderMs || 0) - Number(a.totalRenderMs || 0));

    const registerRows = events
      .filter(e => e.step === 'invoke:ok' && (e.meta?.command === 'register_image_source' || e.meta?.command === 'register_transformed_image_source'))
      .map(e => ({
        id: e.id,
        op: e.op,
        command: e.meta?.command || '',
        imgKey: e.meta?.result?.tempKey ?? e.meta?.result?.imgKey ?? e.meta?.imgKey ?? '',
        registerMs: e.meta?.ms ?? '',
        nativeDecodeMs: e.meta?.result?.decodeMs ?? '',
        nativeTransformMs: e.meta?.result?.transformMs ?? '',
        nativeEncodeMs: e.meta?.result?.encodeMs ?? '',
        bytesMB: e.meta?.result?.bytes ? Math.round(e.meta.result.bytes / 1024 / 1024 * 100) / 100 : '',
        mime: e.meta?.result?.mime ?? '',
        ext: e.meta?.result?.ext ?? '',
      }))
      .sort((a, b) => Number(b.registerMs || 0) - Number(a.registerMs || 0));

    const saveRows = events
      .filter(e => e.step === 'save:batch-result' || (e.step === 'invoke:ok' && e.meta?.command === 'save_images_to_existing_folder_by_keys'))
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        batchIndex: e.meta?.batchIndex ?? '',
        batchCount: e.meta?.batchCount ?? '',
        keyCount: e.meta?.keyCount ?? e.meta?.result?.requestedCount ?? '',
        savedCount: e.meta?.savedCount ?? e.meta?.result?.savedCount ?? '',
        missingCount: e.meta?.missingCount ?? e.meta?.result?.missingCount ?? '',
        failedCount: e.meta?.failedCount ?? e.meta?.result?.failedCount ?? '',
        bytesMB: e.meta?.bytesMB ?? (e.meta?.result?.bytes ? Math.round(e.meta.result.bytes / 1024 / 1024 * 100) / 100 : ''),
        ms: e.meta?.ms ?? e.dt ?? '',
        error: e.meta?.error || '',
      }));

    const totals = {
      renderCount: renderRows.length,
      slowestRenderMs: renderRows[0]?.totalRenderMs ?? '',
      renderMsTotal: Math.round(renderRows.reduce((n, r) => n + (Number(r.totalRenderMs) || 0), 0) * 100) / 100,
      encodeMsTotal: Math.round(renderRows.reduce((n, r) => n + (Number(r.encodeMs) || 0), 0) * 100) / 100,
      registerMsTotal: Math.round(registerRows.reduce((n, r) => n + (Number(r.registerMs) || 0), 0) * 100) / 100,
      nativeTransformMsTotal: Math.round(registerRows.reduce((n, r) => n + (Number(r.nativeTransformMs) || 0), 0) * 100) / 100,
      saveMsTotal: Math.round(saveRows.reduce((n, r) => n + (Number(r.ms) || 0), 0) * 100) / 100,
    };

    console.group('[Boardfish export] slow image report');
    console.table([totals]);
    console.table(renderRows);
    console.table(registerRows);
    console.table(saveRows);
    console.groupEnd();
    return { totals, renderRows, registerRows, saveRows, events: events.slice() };
  }

  function status() {
    const last = events[events.length - 1];
    const batchResults = events.filter(e => e.step === 'save:batch-result');
    const keyReady = [...events].reverse().find(e => e.step === 'keys:ready');
    const done = [...events].reverse().find(e => e.step === 'end');
    const watch = [...events].reverse().find(e => e.step === 'watch:tick' || e.step === 'watch:start' || e.step === 'watch:end');
    const out = {
      lastStep: last?.step || '',
      totalMs: last?.total ?? '',
      watchPhase: watch?.meta?.phase || '',
      watchTick: watch?.meta?.tick ?? '',
      watchElapsedMs: watch?.meta?.elapsedMs ?? '',
      watchLagMs: watch?.meta?.lagMs ?? '',
      keyCount: keyReady?.meta?.keyCount ?? '',
      batchesDone: batchResults.length,
      batchesTotal: batchResults[batchResults.length - 1]?.meta?.batchCount ?? '',
      processed: batchResults[batchResults.length - 1]?.meta?.processed ?? '',
      savedCount: done?.meta?.savedCount ?? batchResults.reduce((n, e) => n + (Number(e.meta?.savedCount) || 0), 0),
      failedCount: done?.meta?.failedCount ?? batchResults.reduce((n, e) => n + (Number(e.meta?.failedCount) || 0), 0),
      missingCount: done?.meta?.missingCount ?? batchResults.reduce((n, e) => n + (Number(e.meta?.missingCount) || 0), 0),
      bytesMB: done?.meta?.bytesMB ?? Math.round(batchResults.reduce((n, e) => n + (Number(e.meta?.bytesMB) || 0), 0) * 100) / 100,
      uiText: massive?.progressUi?.currentText ?? '',
      uiFirstNonZeroAtMs: massive?.progressUi?.firstNonZeroAtMs ?? '',
      resolveProcessed: massive?.resolve?.processed ?? '',
      resolveDurationMs: massive?.resolve?.durationMs ?? '',
      saveDurationMs: massive?.save?.durationMs ?? '',
      error: last?.meta?.error || '',
    };
    console.table([out]);
    return out;
  }

  function reset() { events.length = 0; massive = null; }

  return { enable, disable, setVerbose, start, step, end, watch, invoke, startMassive, recordResolveStart, recordResolveProgress, recordResolveDone, recordResolve, recordSaveStart, recordSaveBatch, recordSaveDone, recordProgressUi, massiveReport, progressReport, dump, summary, phaseSummary, slowImageReport, status, reset, get enabled() { return enabled; }, get events() { return events.slice(); }, get massive() { return massive ? JSON.parse(JSON.stringify(massive)) : null; } };
})();

exposeDebug({ export: ExportDebug });
var InsertDebug = (() => {
  function sanitize(meta = {}) {
    return sanitizeDebugMeta(meta);
  }

  const recorder = createDebugRecorder({
    maxEvents: 300,
    label: '[Boardfish insert]',
    sanitize,
    onEnable() {
      console.info('Boardfish insert debugger enabled. Use BoardfishDebug.insert.report(), .phaseSummary(), .summary(), .dump(), .setVerbose(true), or .reset().');
    },
    onDisable() {
      console.info('Boardfish insert debugger disabled.');
    },
  });

  function events() {
    return recorder._events;
  }

  function enable(options = {}) {
    recorder.enable(options);
  }
  function disable() {
    recorder.disable();
  }
  function rows(filterStart = false) {
    return events()
      .filter(e => !filterStart || e.step !== 'start')
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        total: e.total,
        dt: e.dt,
        source: e.meta?.source || '',
        fileCount: e.meta?.fileCount ?? '',
        readyCount: e.meta?.readyCount ?? e.meta?.count ?? '',
        droppedFileCount: e.meta?.droppedFileCount ?? '',
        fileName: e.meta?.fileName || '',
        fileSize: e.meta?.fileSize ?? '',
        fileType: e.meta?.fileType || '',
        imgKey: e.meta?.imgKey || '',
        native: e.meta?.native ?? '',
        dataUrlLen: e.meta?.dataUrlLen ?? '',
        added: e.meta?.added ?? '',
        historyAdded: e.meta?.historyAdded ?? '',
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
    const flat = events().map(({ meta, ...rest }) => ({ ...rest, ...(meta || {}) }));
    console.table(flat);
    return events().slice();
  }
  function report() {
    const insertEnds = events().filter(e => e.op === 'insertImages' && e.step === 'end');
    const last = insertEnds[insertEnds.length - 1];
    if (!last) {
      const empty = { runs: 0 };
      console.table([empty]);
      return empty;
    }
    const id = last.id;
    const run = events().filter(e => e.id === id);
    const findStep = (stepName) => run.find(e => e.step === stepName);
    const imageEnds = events().filter(e => e.op === 'insertImage' && e.step === 'end' && e.meta?.source === last.meta?.source);
    const registerEnds = events().filter(e => e.op === 'insertImage' && e.step === 'register:end' && e.meta?.source === last.meta?.source);
    const maxRegisterMs = registerEnds.reduce((n, e) => Math.max(n, Number(e.dt) || 0), 0);
    const maxRegister = registerEnds.find(e => (Number(e.dt) || 0) === maxRegisterMs);
    const readyStart = findStep('ready:wait-start');
    const readyEnd = findStep('ready:wait-end');
    const bulkEnd = findStep('bulk:end');
    const registerMs = readyStart ? readyStart.total : (bulkEnd ? bulkEnd.total : last.total);
    const out = {
      source: last.meta?.source || '',
      added: last.meta?.added ?? imageEnds.filter(e => e.meta?.added).length,
      fileCount: last.meta?.fileCount ?? '',
      droppedFileCount: last.meta?.droppedFileCount ?? '',
      totalMs: last.total ?? '',
      registerMs,
      readyWaitMs: readyStart && readyEnd ? round(readyEnd.total - readyStart.total) : 0,
      readyCount: readyStart?.meta?.readyCount ?? '',
      historyAdded: bulkEnd?.meta?.historyAdded ?? '',
      maxRegisterMs: round(maxRegisterMs),
      maxRegisterFile: maxRegister?.meta?.fileName || '',
      errors: imageEnds.filter(e => e.meta?.error).length,
    };
    console.table([out]);
    return out;
  }

  return {
    enable,
    disable,
    setVerbose: recorder.setVerbose,
    start: recorder.start,
    step: recorder.step,
    end: recorder.end,
    report,
    phaseSummary,
    summary,
    dump,
    reset: recorder.reset,
    get events() { return events().slice(); },
  };
})();

exposeDebug({ insert: InsertDebug });

// ─── Export-all diagnostic ────────────────────────────────────────────────────
// Usage (DevTools console):
//   await BoardfishDebug.exportAllDiag.run()
//
// Probes the Windows-safe Export All Images flow.
// The expected order is:
//   1) pick_folder opens before image rendering/cache registration
//   2) images are resolved to native cache keys sequentially
//   3) save_images_to_existing_folder_by_keys writes those keys to the picked folder
//
var ExportAllDiag = (() => {
  const WARN_MB  = 10;   // yellow warning
  const FATAL_MB = 50;   // likely fatal on Windows WebView2

  let _last = null;

  function mb(bytes) { return Math.round(bytes / 1024 / 1024 * 100) / 100; }
  function ms(t0)    { return Math.round((performance.now() - t0) * 10) / 10; }
  function pushTop(list, row, scoreKey, limit) {
    list.push(row);
    list.sort((a, b) => Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0));
    if (list.length > limit) list.length = limit;
  }
  function pushSample(list, row, limit) {
    if (list.length < limit) list.push(row);
  }

  async function run(options = {}) {
    const sampleLimit = Math.max(1, Math.min(25, Number(options.sampleLimit) || 8));
    const full = options.full === true;
    if (!hasTauri()) {
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

    console.group('Phase 1: classify images without rendering');
    const perImage = full ? [] : undefined;
    const largestStored = [];
    const missingSources = [];
    const duplicateKeys = [];
    const seenKeys = new Map();
    let nativeRefCount = 0;
    let dataUrlCount = 0;
    let needsRenderCount = 0;
    let totalBytes = 0;

    for (let i = 0; i < imageObjs.length; i++) {
      const obj = imageObjs[i];
      const imgKey = obj.data?.imgKey ?? '?';
      const needsRender = imageNeedsRendering(obj);
      const bytes = imageStoreBytesEstimate(imageStore[obj.data?.imgKey]);
      const kb = Math.round(bytes / 1024 * 10) / 10;
      totalBytes += bytes;
      if (needsRender) needsRenderCount++;
      if (isNativeImageRef(imageStore[obj.data?.imgKey])) nativeRefCount++;
      else if (typeof imageStore[obj.data?.imgKey] === 'string') dataUrlCount++;
      else pushSample(missingSources, { index: i, objectId: obj.id, imgKey }, sampleLimit);
      if (imgKey) {
        const prev = seenKeys.get(imgKey) || 0;
        if (prev === 1) pushSample(duplicateKeys, imgKey, sampleLimit);
        seenKeys.set(imgKey, prev + 1);
      }

      const row = { index: i, imgKey, needsRender, renderMs: 0, kb, ok: true, error: undefined };
      if (full) perImage.push(row);
      pushTop(largestStored, { index: i, objectId: obj.id, imgKey, needsRender, storedMB: mb(bytes) }, 'storedMB', sampleLimit);
    }

    const totalMB = mb(totalBytes);
    const severity = totalMB > FATAL_MB ? 'FATAL' : totalMB > WARN_MB ? 'WARN' : 'OK';
    const severityStyle = severity === 'FATAL' ? 'color:red;font-weight:bold' : severity === 'WARN' ? 'color:orange;font-weight:bold' : 'color:green';
    console.log(`%cEstimated stored payload: ${totalMB} MB | severity=${severity}`, severityStyle);
    if (severity === 'FATAL') console.error('[exportAllDiag] Payload almost certainly exceeds Tauri/WebView2 IPC limit on Windows');
    else if (severity === 'WARN') console.warn('[exportAllDiag] Payload is large — may intermittently hit IPC limits on Windows');
    console.table([{
      imageCount: imageObjs.length,
      needsRenderCount,
      passthroughCount: imageObjs.length - needsRenderCount,
      nativeRefCount,
      dataUrlCount,
      missingSourceSamples: missingSources.length,
      duplicateKeySamples: duplicateKeys.length,
      totalMB,
      severity,
    }]);
    console.table(largestStored);
    console.groupEnd();

    console.group('Phase 2: pick folder first');
    const pickStart = performance.now();
    let folder = null, pickOk = false, pickErr = null;
    try {
      folder = await tauriInvoke('pick_folder');
      pickOk = true;
    } catch (e) {
      pickErr = String(e);
    }
    const pickMs = ms(pickStart);
    console.log(`  pick_folder completed in ${pickMs}ms  ok=${pickOk}  picked=${!!folder}${pickErr ? '  ERR:'+pickErr : ''}`);
    console.groupEnd();

    const keyProbe = full ? [] : undefined;
    const keyProbeSlowest = [];
    const keyProbeErrors = [];
    const tempKeys = [];
    let renderedCount = 0;
    let saveProbe = null;
    if (pickOk && folder) {
      console.group('Phase 3: sequential key resolution');
      const keys = [];
      for (let i = 0; i < imageObjs.length; i++) {
        const obj = imageObjs[i];
        const imgKey = obj.data?.imgKey;
        const needsRender = imageNeedsRendering(obj);
        const t0 = performance.now();
        let key = null, ok = false, err = null;
        try {
          if (needsRender) {
            const dataUrl = await getRenderedImageDataUrl(obj, null);
            if (dataUrl) {
              key = `__export_diag_tmp_${obj.id}`;
              tempKeys.push(key);
              renderedCount++;
              await tauriInvoke('register_image_source', { imgKey: key, dataUrl });
            }
          } else {
            await cacheImageSourceForSave(imgKey, imageStore[imgKey]);
            key = imgKey;
          }
          ok = !!key;
          if (key) keys.push(key);
        } catch (e) {
          err = String(e);
        }
        const row = { index: i, imgKey, key, needsRender, ms: ms(t0), ok, error: err ?? '' };
        if (full) keyProbe.push(row);
        pushTop(keyProbeSlowest, row, 'ms', sampleLimit);
        if (err || !ok) pushSample(keyProbeErrors, row, sampleLimit);
        if ((i + 1) % 50 === 0 || i === imageObjs.length - 1) {
          console.log(`  resolved ${i + 1}/${imageObjs.length}; keys=${keys.length}; rendered=${renderedCount}; errors=${keyProbeErrors.length}`);
        }
      }
      console.table(keyProbeSlowest);
      if (keyProbeErrors.length) console.table(keyProbeErrors);
      console.groupEnd();

      console.group('Phase 4: save picked folder by keys');
      const saveStart = performance.now();
      let savedCount = 0, saveOk = false, saveErr = null;
      try {
        savedCount = await tauriInvoke('save_images_to_existing_folder_by_keys', { folder, imgKeys: keys });
        saveOk = true;
      } catch (e) {
        saveErr = String(e);
      } finally {
        cleanupExportTempKeys(tempKeys);
      }
      saveProbe = { keyCount: keys.length, savedCount, saveMs: ms(saveStart), saveOk, error: saveErr ?? '' };
      console.log(`  save_images_to_existing_folder_by_keys keyCount=${keys.length} saved=${savedCount} ${saveProbe.saveMs}ms ok=${saveOk}${saveErr ? ' ERR:'+saveErr : ''}`);
      console.groupEnd();
    } else {
      console.warn('[exportAllDiag] Folder picker was cancelled or failed; skipped key resolution and saving.');
    }

    const report = {
      mode: 'keyed-folder-first',
      isWindows: IS_WIN,
      imageCount: imageObjs.length,
      totalStoredPayloadMB: totalMB,
      payloadSeverity: severity,
      compact: !full,
      folderPickedBeforeKeyResolution: !!folder,
      pickProbe: { pickMs, pickOk, picked: !!folder, error: pickErr ?? '' },
      keyProbe,
      keyProbeSlowest,
      keyProbeErrors,
      renderedCount,
      tempKeyCount: tempKeys.length,
      saveProbe,
      perImage,
      largestStored,
      missingSources,
      duplicateKeys,
    };
    console.group('Full report');
    if (full) {
      console.table(report.perImage);
      console.table(report.keyProbe);
    } else {
      console.table(report.largestStored);
      console.table(report.keyProbeSlowest);
      if (report.keyProbeErrors.length) console.table(report.keyProbeErrors);
    }
    if (report.saveProbe) console.table([report.saveProbe]);
    console.log('Full report → BoardfishDebug.exportAllDiag.last');
    console.groupEnd();
    console.groupEnd();

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
var _textSelDebugEnabled = false;
var TextSelDebug = (() => {
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
