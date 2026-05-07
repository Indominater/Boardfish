'use strict';

var OpenDebug = (() => {
  const MAX_EVENTS = 5000;
  let hydrationMode = 'all-before-open';
  let hydrationConcurrency = 8;

  function sanitize(value) {
    return sanitizeDebugMeta(value, { redactPattern: /dataUrl|src|base64|imageStore/i, roundNumbers: true });
  }

  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish open]',
    sanitize,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish open debugger enabled. Use finishDebug({ open: ["summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish open debugger disabled.');
  }
  const setVerbose = core.setVerbose;

  function setHydrationMode(mode) {
    const allowed = new Set(['all-before-open', 'visible-first']);
    if (!allowed.has(mode)) {
      console.warn(`[Boardfish open] Unknown hydration mode "${mode}". Use "all-before-open" or "visible-first".`);
      return hydrationMode;
    }
    hydrationMode = mode;
    if (typeof setOpenHydrationMode === 'function') setOpenHydrationMode(mode);
    console.info(`[Boardfish open] hydration mode set to ${hydrationMode}`);
    return hydrationMode;
  }

  function setHydrationConcurrency(value) {
    const n = Math.max(1, Math.min(32, Math.floor(Number(value) || hydrationConcurrency)));
    hydrationConcurrency = n;
    console.info(`[Boardfish open] hydration concurrency set to ${hydrationConcurrency}`);
    return hydrationConcurrency;
  }

  const start = core.start;
  const step = core.step;
  const end = core.end;

  async function invoke(ctx, command, args = {}, meta = {}) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!core.enabled) return tauriInvoke(command, args);
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

  async function wrap(ctx, command, call, meta = {}) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!core.enabled) return call();
    const t0 = performance.now();
    step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await call();
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
      (e.step === 'invoke:ok' && e.meta?.command && e.meta.command !== TAURI_COMMANDS.GET_CACHED_IMAGE_DATA_URL)
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

  function cacheImageBreakdown(limit = 50) {
    const totals = new Map();
    for (const event of events) {
      const key = event.meta?.imgKey || event.meta?.key;
      if (!key || !event.step?.startsWith('cache-image:')) continue;
      if (!totals.has(key)) totals.set(key, {
        imgKey: key,
        totalMs: 0,
        queueWaitMs: 0,
        bitmapMs: 0,
        previewMs: 0,
        renderScheduleMs: 0,
        loadMs: 0,
        readbackProbeMs: 0,
        bitmapReady: '',
        bitmapFailed: '',
        readbackSafe: '',
        skippedReadbackProbe: '',
        requiredReadbackSafe: '',
        error: '',
      });
      const row = totals.get(key);
      const meta = event.meta || {};
      if (event.step === 'cache-image:done') {
        row.totalMs = meta.ms ?? row.totalMs;
        row.bitmapReady = meta.bitmapReady ?? row.bitmapReady;
        row.bitmapFailed = meta.bitmapFailed ?? row.bitmapFailed;
        row.readbackSafe = meta.readbackSafe ?? row.readbackSafe;
      } else if (event.step === 'cache-image:decode-queue:start') {
        row.queueWaitMs = meta.queueWaitMs ?? row.queueWaitMs;
      } else if (event.step === 'cache-image:createImageBitmap') {
        row.bitmapMs = meta.ms ?? row.bitmapMs;
      } else if (event.step === 'cache-image:previewBitmap') {
        row.previewMs = meta.ms ?? row.previewMs;
      } else if (event.step === 'cache-image:schedule-render') {
        row.renderScheduleMs = meta.ms ?? row.renderScheduleMs;
      } else if (event.step === 'cache-image:load') {
        row.loadMs = meta.ms ?? row.loadMs;
      } else if (event.step === 'cache-image:readback-probe') {
        row.readbackProbeMs = meta.ms ?? row.readbackProbeMs;
        row.skippedReadbackProbe = meta.skipped ?? '';
        row.requiredReadbackSafe = meta.required ?? '';
      } else if (event.step.endsWith(':error')) {
        row.error = meta.error || row.error;
      }
    }
    const rows = [...totals.values()]
      .sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function hydrationBreakdown(limit = 50) {
    const rows = events
      .filter(e => e.step === 'hydrate-image')
      .map(e => ({
        imgKey: e.meta?.imgKey || '',
        totalMs: e.meta?.ms ?? '',
        fetchMs: e.meta?.fetchMs ?? '',
        loadMs: e.meta?.loadMs ?? '',
        readyMs: e.meta?.readyMs ?? '',
        cacheTotalMs: e.meta?.cacheTotalMs ?? '',
        cacheQueueWaitMs: e.meta?.cacheQueueWaitMs ?? '',
        cacheBitmapMs: e.meta?.cacheBitmapMs ?? '',
        cachePreviewMs: e.meta?.cachePreviewMs ?? '',
        cacheRenderScheduleMs: e.meta?.cacheRenderScheduleMs ?? '',
        cacheReadbackProbeMs: e.meta?.cacheReadbackProbeMs ?? '',
        skippedReadbackProbe: e.meta?.skippedReadbackProbe ?? '',
        source: e.meta?.source ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
        displayReady: e.meta?.displayReady ?? '',
      }))
      .sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function stepSummary(prefix = '') {
    const rows = events
      .filter(e => !prefix || e.step?.startsWith(prefix))
      .map(e => ({
        step: e.step,
        total: e.total,
        dt: e.dt,
        command: e.meta?.command || '',
        eyedropperCardCount: e.meta?.eyedropperCardCount ?? '',
        eyedropperCardPreviewCount: e.meta?.eyedropperCardPreviewCount ?? '',
        eyedropperCardPreviewBytes: e.meta?.eyedropperCardPreviewBytes ?? '',
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
        imgKey: e.meta?.imgKey || e.meta?.key || '',
        ms: e.meta?.ms ?? '',
        queueWaitMs: e.meta?.queueWaitMs ?? '',
        bitmapMs: e.meta?.bitmapMs ?? '',
        previewMs: e.meta?.previewMs ?? '',
        skipped: e.meta?.skipped ?? '',
        required: e.meta?.required ?? '',
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

  function reset() { core.reset(); }


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
    wrap,
    dump,
    summary,
    phaseSummary,
    status,
    hydrationSummary,
    hydrationBreakdown,
    cacheImageBreakdown,
    stepSummary,
    imageStoreSummary,
    imageStoreSample,
    hydrationCandidates,
    slowImages,
    reset,
    get enabled() { return core.enabled; },
    get hydrationMode() { return hydrationMode; },
    get hydrationConcurrency() { return hydrationConcurrency; },
    get events() { return events.slice(); },
  };
})();

exposeDebug({ open: OpenDebug });
