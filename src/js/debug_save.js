'use strict';

var SaveDebug = (() => {
  function sanitize(value) {
    return sanitizeDebugMeta(value, { redactPattern: /dataUrl|src|base64|imageStore/i, roundNumbers: true });
  }

  const core = createDebugRecorder({
    maxEvents: 300,
    label: '[Boardfish save]',
    sanitize,
  });

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish save debugger enabled. Use BoardfishDebug.save.summary(), .dump(), or .reset().');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish save debugger disabled.');
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

  async function wrap(ctx, command, call, meta = {}) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!core.enabled) return call();
    const t0 = performance.now();
    core.step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await call();
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
        (e.step === 'invoke:ok' && e.meta?.command === TAURI_COMMANDS.SAVE_BOARD) ||
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
    wrap,
    dump,
    summary,
    phaseSummary,
    reset: core.reset,
    get enabled() { return core.enabled; },
    get events() { return core.events; },
  };
})();

exposeDebug({ save: SaveDebug });
