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
    if (core.enabled) console.info('Boardfish save debugger enabled. Use finishDebug({ save: ["report", "phaseSummary", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish save debugger disabled.');
  }

  async function wrap(ctx, command, call, meta = {}) {
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
      textObjectCount: e.meta?.textObjectCount ?? '',
      textCharCount: e.meta?.textCharCount ?? '',
      largestTextChars: e.meta?.largestTextChars ?? '',
      runtimeTextCacheObjects: e.meta?.runtimeTextCacheObjects ?? '',
      runtimeTextCacheLines: e.meta?.runtimeTextCacheLines ?? '',
      runtimeTextCacheContentChars: e.meta?.runtimeTextCacheContentChars ?? '',
      runtimeTextCachePrefixEntries: e.meta?.runtimeTextCachePrefixEntries ?? '',
      runtimeTextCacheKeyChars: e.meta?.runtimeTextCacheKeyChars ?? '',
      runtimeTextPrivateFields: e.meta?.runtimeTextPrivateFields ?? '',
      imageStoreBytes: e.meta?.imageStoreBytes ?? '',
      rawImageStoreBytes: e.meta?.rawImageStoreBytes ?? '',
      largestImageBytes: e.meta?.largestImageBytes ?? '',
      jsonBytes: e.meta?.jsonBytes ?? '',
      queueMs: e.meta?.queueMs ?? '',
      elapsedMs: e.meta?.elapsedMs ?? '',
      rustSerializeMs: e.meta?.rust?.serialize_ms ?? '',
      rustValidateMs: e.meta?.rust?.validate_ms ?? '',
      rustSourceLookupMs: e.meta?.rust?.source_lookup_ms ?? '',
      rustWriteMs: e.meta?.rust?.write_ms ?? '',
      rustZipMs: e.meta?.rust?.zip_ms ?? '',
      zipMode: e.meta?.rust?.zip_mode ?? '',
      zipBytes: e.meta?.rust?.zip_bytes ?? '',
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
        (e.step === 'invoke:ok' && /save_board|web_save_board/.test(e.meta?.command || '')) ||
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
        textObjectCount: e.meta?.textObjectCount ?? '',
        textCharCount: e.meta?.textCharCount ?? '',
        largestTextChars: e.meta?.largestTextChars ?? '',
        runtimeTextCacheObjects: e.meta?.runtimeTextCacheObjects ?? '',
        runtimeTextCacheLines: e.meta?.runtimeTextCacheLines ?? '',
        runtimeTextCacheContentChars: e.meta?.runtimeTextCacheContentChars ?? '',
        runtimeTextCachePrefixEntries: e.meta?.runtimeTextCachePrefixEntries ?? '',
        runtimeTextCacheKeyChars: e.meta?.runtimeTextCacheKeyChars ?? '',
        runtimeTextPrivateFields: e.meta?.runtimeTextPrivateFields ?? '',
        imageStoreBytes: e.meta?.imageStoreBytes ?? '',
        rawImageStoreBytes: e.meta?.rawImageStoreBytes ?? '',
        jsonBytes: e.meta?.jsonBytes ?? e.meta?.rust?.json_bytes ?? '',
        queueMs: e.meta?.queueMs ?? '',
        elapsedMs: e.meta?.elapsedMs ?? '',
        rustSerializeMs: e.meta?.rust?.serialize_ms ?? '',
        rustValidateMs: e.meta?.rust?.validate_ms ?? '',
        rustSourceLookupMs: e.meta?.rust?.source_lookup_ms ?? '',
        rustWriteMs: e.meta?.rust?.write_ms ?? '',
        rustZipMs: e.meta?.rust?.zip_ms ?? '',
        zipMode: e.meta?.rust?.zip_mode ?? '',
        zipBytes: e.meta?.rust?.zip_bytes ?? '',
        rustImageBytes: e.meta?.rust?.image_bytes ?? '',
        rustImageCount: e.meta?.rust?.image_count ?? '',
        rustTotalMs: e.meta?.rust?.total_ms ?? '',
        error: e.meta?.error || '',
      }));
    console.table(rows);
    return rows;
  }

  function latestRun() {
    const starts = core.events.filter(e => e.step === 'start' && /^saveBoard/.test(e.op || ''));
    const start = starts[starts.length - 1];
    if (!start) return [];
    return core.events.filter(e => e.id === start.id);
  }

  function report() {
    const run = latestRun();
    if (!run.length) {
      const empty = { saveRuns: 0, verdict: 'no saveBoard events captured' };
      console.table([empty]);
      return empty;
    }
    const find = (step) => run.find(e => e.step === step);
    const findPrefix = (prefix) => run.find(e => e.step?.startsWith(prefix));
    const invokeOk = run.find(e => e.step === 'invoke:ok' && /save_board|web_save_board/.test(e.meta?.command || ''));
    const frame = find('save-frame-probe');
    const pendingFrame = find('save-frame-probe:pending');
    const end = find('end') || run[run.length - 1];
    const rust = invokeOk?.meta?.rust || {};
    const row = {
      saveRuns: 1,
      op: run[0]?.op || '',
      totalMs: end?.total ?? '',
      boardDataMs: find('boardData')?.meta?.ms ?? '',
      jsonStringifyMs: find('json-stringify')?.meta?.ms ?? '',
      imageSourceWaitMs: find('await-image-source-cache:end')?.meta?.ms ?? '',
      invokeMs: invokeOk?.meta?.ms ?? '',
      rustValidateMs: rust.validate_ms ?? '',
      rustSourceLookupMs: rust.source_lookup_ms ?? '',
      rustSerializeMs: rust.serialize_ms ?? '',
      rustWriteMs: rust.write_ms ?? '',
      rustZipMs: rust.zip_ms ?? '',
      zipMode: rust.zip_mode ?? '',
      zipBytes: rust.zip_bytes ?? '',
      rustTotalMs: rust.total_ms ?? '',
      jsonBytes: invokeOk?.meta?.rust?.json_bytes ?? find('json-stringify')?.meta?.jsonBytes ?? '',
      imageBytes: rust.image_bytes ?? '',
      imageCount: rust.image_count ?? find('boardData')?.meta?.imageCount ?? '',
      textObjectCount: find('boardData')?.meta?.textObjectCount ?? '',
      textCharCount: find('boardData')?.meta?.textCharCount ?? '',
      largestTextChars: find('boardData')?.meta?.largestTextChars ?? '',
      runtimeTextCacheObjects: find('boardData')?.meta?.runtimeTextCacheObjects ?? '',
      runtimeTextCacheLines: find('boardData')?.meta?.runtimeTextCacheLines ?? '',
      runtimeTextCacheContentChars: find('boardData')?.meta?.runtimeTextCacheContentChars ?? '',
      runtimeTextCachePrefixEntries: find('boardData')?.meta?.runtimeTextCachePrefixEntries ?? '',
      runtimeTextCacheKeyChars: find('boardData')?.meta?.runtimeTextCacheKeyChars ?? '',
      runtimeTextPrivateFields: find('boardData')?.meta?.runtimeTextPrivateFields ?? '',
      frameProbeQueueMs: frame?.meta?.queueMs ?? '',
      frameProbePendingMs: pendingFrame?.meta?.elapsedMs ?? '',
      frameProbePending: !!pendingFrame,
      coalesced: /coalesced/.test(run[0]?.op || ''),
      error: findPrefix('invoke:error')?.meta?.error || end?.meta?.error || '',
    };
    console.table([row]);
    return row;
  }

  return {
    enable,
    disable,
    setVerbose: core.setVerbose,
    start: core.start,
    step: core.step,
    end: core.end,
    wrap,
    dump,
    summary,
    phaseSummary,
    report,
    reset: core.reset,
    get enabled() { return core.enabled; },
    get events() { return core.events; },
  };
})();

exposeDebug({ save: SaveDebug });
