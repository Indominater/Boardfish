'use strict';

var OpenDebug = (() => {
  const MAX_EVENTS = 5000;
  let hydrationMode = 'visible-first';
  let hydrationConcurrency = 8;
  let initialRenderDebugDepth = 0;
  let latestOpenContext = null;

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
    if (core.enabled) console.info('Boardfish open debugger enabled. Use finishDebug({ open: ["optimizationReport", "report", "phaseSummary", "openPreviewBreakdown", "hydrationSummary", "hydrationBreakdown", "cacheImageBreakdown", "imageStoreSummary", "imageStoreSample", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    latestOpenContext = null;
    initialRenderDebugDepth = 0;
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

  function start(op, meta = {}) {
    const ctx = core.start(op, meta);
    if (ctx && /^open/.test(op || '')) latestOpenContext = ctx;
    return ctx;
  }
  const step = core.step;
  const end = core.end;

  function beginInitialRenderDebug() {
    if (!core.enabled) return false;
    initialRenderDebugDepth++;
    return true;
  }

  function endInitialRenderDebug() {
    if (initialRenderDebugDepth > 0) initialRenderDebugDepth--;
    return initialRenderDebugDepth;
  }

  function isInitialRenderDebugActive() {
    return core.enabled && initialRenderDebugDepth > 0;
  }

  function recordPreviewFallbackDraw(meta = {}) {
    const ctx = latestOpenContext || start('open-runtime-preview', { source: 'open-preview-fallback-draw' });
    if (!ctx) return;
    step(ctx, 'open-preview-fallback-draw', meta);
  }

  function recordPreviewHeldRender(meta = {}) {
    const ctx = latestOpenContext || start('open-runtime-preview', { source: 'open-preview-render-held' });
    if (!ctx) return;
    step(ctx, 'open-preview-render-held', meta);
  }

  function recordDynamicPreview(meta = {}) {
    const ctx = latestOpenContext || start('open-runtime-preview', { source: 'open-preview-dynamic' });
    if (!ctx) return;
    step(ctx, 'open-preview-dynamic', meta);
  }

  async function wrap(ctx, command, call, meta = {}) {
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
      textObjectCount: e.meta?.textObjectCount ?? '',
      textCharCount: e.meta?.textCharCount ?? '',
      largestTextChars: e.meta?.largestTextChars ?? '',
      imageStoreBytes: e.meta?.imageStoreBytes ?? '',
      fileBytes: e.meta?.rust?.file_bytes ?? '',
      rustReadMs: e.meta?.rust?.read_ms ?? '',
      rustZipOpenMs: e.meta?.rust?.zip_open_ms ?? '',
      rustBoardJsonReadMs: e.meta?.rust?.board_json_read_ms ?? '',
      rustBoardJsonParseMs: e.meta?.rust?.board_json_parse_ms ?? '',
      rustImageReadMs: e.meta?.rust?.image_read_ms ?? '',
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
      'open-preview-visible:start',
      'open-preview-visible:end',
      'open-preview-release',
      'open-preview-fallback-draw',
      'open-preview-render-held',
      'open-preview-dynamic',
      'hydrate-visible:bitmap-settle',
      'hydrate-initial-policy',
      'prewarm-visible-scaled-variants',
      'hydrate-visible:end',
      'hydrate-all:end',
      'hydrate-background:done',
      'initial-applyTransform',
      'end',
    ]);
    const rows = events.filter(e => (
      interesting.has(e.step) ||
      (e.step === 'invoke:ok' && e.meta?.command)
    )).map(e => ({
      step: e.step,
      total: e.total,
      dt: e.dt,
      command: e.meta?.command || '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      textObjectCount: e.meta?.textObjectCount ?? '',
      textCharCount: e.meta?.textCharCount ?? '',
      count: e.meta?.count ?? '',
      selected: e.meta?.selected ?? '',
      ready: e.meta?.ready ?? '',
      hydrated: e.meta?.hydrated ?? '',
      remaining: e.meta?.remaining ?? '',
      visibleBitmapsReady: e.meta?.visibleBitmapsReady ?? e.meta?.after ?? '',
      visibleBitmapsFailed: e.meta?.visibleBitmapsFailed ?? e.meta?.failed ?? '',
      visibleBitmapsMissing: e.meta?.visibleBitmapsMissing ?? e.meta?.missing ?? '',
      openPreviewBuilt: e.step === 'open-preview-visible:end' ? e.meta?.built ?? '' : e.meta?.previewBuilt ?? '',
      openPreviewReady: e.step === 'open-preview-visible:end' ? e.meta?.ready ?? '' : e.meta?.previewReady ?? '',
      openPreviewPendingReady: e.step === 'open-preview-visible:end' ? e.meta?.pendingReady ?? '' : e.meta?.previewPendingReady ?? '',
      openPreviewMB: e.step === 'open-preview-visible:end' ? e.meta?.mb ?? '' : e.meta?.previewMB ?? '',
      openPreviewMaxMs: e.step === 'open-preview-visible:end' ? e.meta?.maxMs ?? '' : e.meta?.previewMaxMs ?? '',
      openPreviewMaxKey: e.step === 'open-preview-visible:end' ? e.meta?.maxKey ?? '' : e.meta?.previewMaxKey ?? '',
      openPreviewPending: e.step === 'open-preview-release' ? e.meta?.pending ?? '' : '',
      openPreviewReleased: e.step === 'open-preview-release' ? e.meta?.released ?? '' : '',
      openPreviewRemaining: e.step === 'open-preview-release' ? e.meta?.remaining ?? '' : '',
      openPreviewHeldSource: e.step === 'open-preview-render-held' ? e.meta?.source ?? '' : '',
      openPreviewHeldPendingReadyVariants: e.step === 'open-preview-render-held' ? e.meta?.pendingReadyVariants ?? '' : '',
      openPreviewDynamicReady: e.step === 'open-preview-dynamic' ? e.meta?.ready ?? '' : '',
      openPreviewDynamicSkipped: e.step === 'open-preview-dynamic' ? e.meta?.skipped ?? '' : '',
      openPreviewDynamicKey: e.step === 'open-preview-dynamic' ? e.meta?.imgKey ?? '' : '',
      scaledPrewarmBuilt: e.step === 'prewarm-visible-scaled-variants' ? e.meta?.built ?? '' : '',
      scaledPrewarmReady: e.step === 'prewarm-visible-scaled-variants' ? e.meta?.alreadyReady ?? '' : '',
      scaledPrewarmCandidates: e.step === 'prewarm-visible-scaled-variants' ? e.meta?.candidates ?? '' : '',
      rustTotalMs: e.meta?.rust?.total_ms ?? '',
      rustImageReadMs: e.meta?.rust?.image_read_ms ?? '',
      rustImageReadMaxMs: e.meta?.rust?.image_read_max_ms ?? '',
      rustImageReadMaxKey: e.meta?.rust?.image_read_max_key ?? '',
      rustLazyImageRefs: e.meta?.rust?.lazy_image_refs ?? '',
      rustImageCrcMs: e.meta?.rust?.image_crc_ms ?? '',
      ms: e.meta?.ms ?? '',
      skipped: e.meta?.skipped ?? '',
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
    const out = {
      imageCount: rows.length,
      totalDataUrlMB: Math.round(sum('dataUrlLen') / 1024 / 1024 * 100) / 100,
      totalImageHydrateMs: Math.round(sum('ms') * 100) / 100,
      totalFetchMs: Math.round(sum('fetchMs') * 100) / 100,
      totalBitmapMs: Math.round(sum('cacheBitmapMs') * 100) / 100,
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
        renderSkipped: '',
        bitmapReady: '',
        bitmapFailed: '',
        error: '',
      });
      const row = totals.get(key);
      const meta = event.meta || {};
      if (event.step === 'cache-image:done') {
        row.totalMs = meta.ms ?? row.totalMs;
        row.bitmapReady = meta.bitmapReady ?? row.bitmapReady;
        row.bitmapFailed = meta.bitmapFailed ?? row.bitmapFailed;
      } else if (event.step === 'cache-image:decode-queue:start') {
        row.queueWaitMs = meta.queueWaitMs ?? row.queueWaitMs;
      } else if (event.step === 'cache-image:createImageBitmap') {
        row.bitmapMs = meta.ms ?? row.bitmapMs;
      } else if (event.step === 'cache-image:previewBitmap') {
        row.previewMs = meta.ms ?? row.previewMs;
      } else if (event.step === 'cache-image:schedule-render') {
        row.renderScheduleMs = meta.ms ?? row.renderScheduleMs;
        row.renderSkipped = meta.skipped || row.renderSkipped;
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
        readyMs: e.meta?.readyMs ?? '',
        cacheReadyStage: e.meta?.cacheReadyStage ?? '',
        cacheTotalMs: e.meta?.cacheTotalMs ?? '',
        cacheQueueWaitMs: e.meta?.cacheQueueWaitMs ?? '',
        cacheBitmapMs: e.meta?.cacheBitmapMs ?? '',
        cachePreviewMs: e.meta?.cachePreviewMs ?? '',
        cacheRenderScheduleMs: e.meta?.cacheRenderScheduleMs ?? '',
        cacheRenderSkipped: e.meta?.cacheRenderSkipped ?? '',
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
        count: e.meta?.count ?? '',
        selected: e.meta?.selected ?? '',
        ready: e.meta?.ready ?? '',
        built: e.meta?.built ?? '',
        failed: e.meta?.failed ?? '',
        hydrated: e.meta?.hydrated ?? '',
        released: e.meta?.released ?? '',
        remaining: e.meta?.remaining ?? '',
        pendingImages: e.meta?.pendingImages ?? '',
        visibleBitmapsReady: e.meta?.visibleBitmapsReady ?? e.meta?.after ?? '',
        visibleBitmapsFailed: e.meta?.visibleBitmapsFailed ?? e.meta?.failed ?? '',
        visibleBitmapsMissing: e.meta?.visibleBitmapsMissing ?? e.meta?.missing ?? '',
        visibleBitmapSettleMs: e.meta?.visibleBitmapSettleMs ?? '',
        manifestRefs: e.meta?.manifestRefs ?? '',
        dataUrlRefs: e.meta?.dataUrlRefs ?? '',
        deferredInitialCacheImages: e.meta?.deferredInitialCacheImages ?? '',
        visibleFirstOpen: e.meta?.visibleFirstOpen ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
        readyStage: e.meta?.cacheReadyStage ?? '',
        imgKey: e.meta?.imgKey || e.meta?.key || '',
        ms: e.meta?.ms ?? '',
        totalMeasuredMs: e.meta?.totalMeasuredMs ?? '',
        drawMs: e.meta?.drawMs ?? '',
        saveViewportMs: e.meta?.saveViewportMs ?? '',
        overlayMs: e.meta?.overlayMs ?? '',
        drawBoardTotalMs: e.meta?.drawBoardTotalMs ?? '',
        objectLoopMs: e.meta?.objectLoopMs ?? '',
        drawnImages: e.meta?.drawnImages ?? '',
        drawnText: e.meta?.drawnText ?? '',
        visibleObjects: e.meta?.visibleObjects ?? '',
        missingImages: e.meta?.missingImages ?? '',
        openPreviewFallback: e.meta?.openPreviewFallback ?? '',
        openPreviewImages: e.meta?.openPreviewImages ?? '',
        bitmapImages: e.meta?.bitmapImages ?? '',
        elementImages: e.meta?.elementImages ?? '',
        scaledImages: e.meta?.scaledImages ?? '',
        scaledFallbackFull: e.meta?.scaledFallbackFull ?? '',
        culledImages: e.meta?.culledImages ?? '',
        queueWaitMs: e.meta?.queueWaitMs ?? '',
        bitmapMs: e.meta?.bitmapMs ?? '',
        previewMs: e.meta?.previewMs ?? '',
        previewReady: e.meta?.previewReady ?? '',
        previewPendingReady: e.meta?.previewPendingReady ?? '',
        previewBuilt: e.meta?.previewBuilt ?? '',
        previewMB: e.meta?.previewMB ?? e.meta?.mb ?? '',
        previewMaxMs: e.meta?.previewMaxMs ?? e.meta?.maxMs ?? '',
        previewMaxKey: e.meta?.previewMaxKey ?? e.meta?.maxKey ?? '',
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
    const pending = getPendingHydratableImageKeys();
    const visible = getVisibleImageKeys();
    const out = {
      pendingImageCount: pending.length,
      visibleImageCount: visible.length,
      pendingDebug: getPendingHydratableImageKeys.lastDebug,
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
        cacheReadyStage: e.meta?.cacheReadyStage ?? '',
        bitmapMs: e.meta?.cacheBitmapMs ?? '',
        dataUrlLen: e.meta?.dataUrlLen ?? '',
        source: e.meta?.source ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
      }))
      .sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function openPreviewBreakdown(limit = 24) {
    const maxRows = Math.max(1, Math.min(200, Math.floor(Number(limit) || 24)));
    const rows = latestOpenEvents();
    const preview = [...rows].reverse().find(e => e.step === 'open-preview-visible:end');
    const sourceRows = Array.isArray(preview?.meta?.slowResults)
      ? preview.meta.slowResults
      : Array.isArray(preview?.meta?.results)
        ? preview.meta.results
        : [];
    const out = sourceRows
      .map((row) => ({
        imgKey: row?.key || '',
        ms: row?.ms ?? '',
        width: row?.width ?? '',
        height: row?.height ?? '',
        ready: row?.ready ?? '',
        skipped: row?.skipped || '',
        error: row?.error || '',
      }))
      .sort((a, b) => numberValue(b.ms) - numberValue(a.ms))
      .slice(0, maxRows);
    console.table(out);
    return out;
  }

  function latestOpenEvents() {
    const starts = events.filter(e => e.step === 'start' && /^open/.test(e.op || ''));
    const lastStart = starts[starts.length - 1];
    if (!lastStart) return [];
    return events.filter(e => e.id === lastStart.id);
  }

  function numberValue(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function roundMs(value) {
    return Math.round(numberValue(value) * 100) / 100;
  }

  function sumMeta(rows, step, field) {
    return roundMs(rows
      .filter(e => e.step === step)
      .reduce((sum, event) => sum + numberValue(event.meta?.[field]), 0));
  }

  function maxMeta(rows, step, field) {
    return roundMs(rows
      .filter(e => e.step === step)
      .reduce((max, event) => Math.max(max, numberValue(event.meta?.[field])), 0));
  }

  function openPreviewRuntimeStats(rows) {
    const fallbackRows = rows.filter(e => e.step === 'open-preview-fallback-draw');
    const heldRenderRows = rows.filter(e => e.step === 'open-preview-render-held');
	    const dynamicRows = rows.filter(e => e.step === 'open-preview-dynamic');
	    const dynamicQueuedRows = dynamicRows.filter(e => e.meta?.queued === true);
	    const dynamicCompletionRows = dynamicRows.filter(e => e.meta?.queued !== true);
    const releaseRows = rows.filter(e => e.step === 'open-preview-release');
    const scheduleRows = rows.filter(e => e.step === 'cache-image:schedule-render');
    const heldScheduleRows = scheduleRows.filter(e => e.meta?.skipped === 'open-preview-held');
    const firstFallback = fallbackRows[0] || null;
    const lastFallback = fallbackRows[fallbackRows.length - 1] || null;
    const lastRelease = releaseRows[releaseRows.length - 1] || null;
    const maxFallbackMissing = fallbackRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.missingImages)), 0);
    const maxFallbackDrawMs = fallbackRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.totalMeasuredMs)), 0);
    return {
      openPreviewFallbackDrawCount: fallbackRows.length,
      openPreviewFallbackMaxDrawMs: fallbackRows.length ? roundMs(maxFallbackDrawMs) : '',
      openPreviewFallbackMissingMax: fallbackRows.length ? maxFallbackMissing : '',
      openPreviewFallbackFirstImages: firstFallback?.meta?.openPreviewImages ?? '',
      openPreviewFallbackLastImages: lastFallback?.meta?.openPreviewImages ?? '',
      openPreviewFallbackFirstMissing: firstFallback?.meta?.missingImages ?? '',
      openPreviewFallbackLastMissing: lastFallback?.meta?.missingImages ?? '',
      openPreviewFallbackLastSource: lastFallback?.meta?.source || '',
      openPreviewReleaseCount: releaseRows.length,
      openPreviewReleaseReady: lastRelease?.meta?.ready ?? '',
      openPreviewReleasePending: lastRelease?.meta?.pending ?? '',
      openPreviewReleaseFailed: lastRelease?.meta?.failed ?? '',
      openPreviewReleaseReleased: lastRelease?.meta?.released ?? '',
	      openPreviewReleaseRemaining: lastRelease?.meta?.remaining ?? '',
	      openPreviewHeldRenderSkips: heldScheduleRows.length,
	      openPreviewHeldVariantRenderSkips: heldRenderRows.filter(e => e.meta?.source === 'image-scale-variant').length,
	      openPreviewHeldRenderCount: heldRenderRows.length,
	      openPreviewDynamicRequests: dynamicQueuedRows.length || dynamicRows.length,
	      openPreviewDynamicCompletions: dynamicCompletionRows.length,
	      openPreviewDynamicReady: dynamicCompletionRows.filter(e => e.meta?.ready === true).length,
	      openPreviewDynamicSkipped: dynamicCompletionRows.filter(e => e.meta?.skipped).length,
	      openPreviewDynamicConcurrency: dynamicRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.concurrency)), 0) || '',
	      openPreviewDynamicMaxActive: dynamicRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.active)), 0) || '',
	      openPreviewDynamicMaxQueued: dynamicRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.queuedCount)), 0) || '',
	      openPreviewDynamicMaxQueuedMs: dynamicCompletionRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.waitMs ?? event.meta?.queuedMs)), 0) || '',
	      openPreviewDynamicMaxBuildMs: dynamicCompletionRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.buildMs ?? event.meta?.ms)), 0) || '',
	      openPreviewDynamicMaxTotalMs: dynamicCompletionRows.reduce((max, event) => Math.max(max, numberValue(event.meta?.totalMs ?? event.meta?.ms)), 0) || '',
	      openPreviewRenderScheduleEvents: scheduleRows.length,
      openPreviewRenderScheduleNonHeld: scheduleRows.length - heldScheduleRows.length,
    };
  }

  function optimizationReport(options = {}) {
    const limit = Math.max(1, Math.min(200, Math.floor(Number(options.limit) || 40)));
    const rows = latestOpenEvents();
    const findStep = (step) => rows.find(e => e.step === step) || null;
    const findLastStep = (step) => [...rows].reverse().find(e => e.step === step) || null;
    const fileDialog = rows.find(e => e.step === 'invoke:ok' && /web_open_file_dialog/.test(e.meta?.command || '')) || null;
    const readStart = rows.find(e => e.step === 'invoke:start' && /web_read_board/.test(e.meta?.command || '')) || null;
    const read = rows.find(e => e.step === 'invoke:ok' && /web_read_board/.test(e.meta?.command || '')) || null;
    const shape = findStep('read-board-shape');
    const cacheStartAll = findStep('cacheImage:start-all');
    const applyState = findStep('apply-state');
    const replaceObjects = findStep('replaceBoardObjects');
    const restoreViewport = findStep('restore-counters-viewport');
    const historyReset = findStep('reset-boardHistory-markSaved');
    const initialPolicy = findStep('hydrate-initial-policy');
    const visibleHydrate = findStep('hydrate-visible:end');
    const allHydrate = findStep('hydrate-all:end');
    const bitmapSettle = findStep('hydrate-visible:bitmap-settle');
    const initialRender = findStep('initial-applyTransform');
    const openPreview = findStep('open-preview-visible:end');
    const scaledPrewarm = findStep('prewarm-visible-scaled-variants');
    const shieldRemoved = findStep('opening-shield:removed');
    const backgroundDone = findLastStep('hydrate-background:done');
    const endEvent = findLastStep('end');
    const hydrationEnd = visibleHydrate || allHydrate;
    const previewFirstPaintReady = visibleHydrate?.meta?.skipped === 'open-preview-ready' ||
      (
        numberValue(openPreview?.meta?.ready) > 0 &&
        numberValue(openPreview?.meta?.ready) >= numberValue(openPreview?.meta?.selected || openPreview?.meta?.count)
      ) ||
      numberValue(initialRender?.meta?.openPreviewImages) > 0;
    const decodeQueueStarts = rows.filter(e => e.step === 'cache-image:decode-queue:start');
    const cacheDoneRows = rows.filter(e => e.step === 'cache-image:done');
    const bitmapRows = rows.filter(e => e.step === 'cache-image:createImageBitmap');
    const cacheErrors = rows.filter(e => /cache-image:.*:error$/.test(e.step || ''));
    const previewStats = openPreviewRuntimeStats(rows);
    const summaryRow = {
      mode: initialPolicy?.meta?.mode || hydrationMode,
      objectCount: shape?.meta?.objectCount ?? endEvent?.meta?.objectCount ?? '',
      imageCount: shape?.meta?.imageCount ?? endEvent?.meta?.imageCount ?? '',
      imageObjectCount: shape?.meta?.imageObjectCount ?? '',
      textObjectCount: shape?.meta?.textObjectCount ?? '',
      textCharCount: shape?.meta?.textCharCount ?? '',
      largestTextChars: shape?.meta?.largestTextChars ?? '',
      imageStoreMB: shape?.meta?.imageStoreBytes ? Math.round(numberValue(shape.meta.imageStoreBytes) / 1024 / 1024 * 100) / 100 : '',
      criticalPathMs: shieldRemoved?.total ?? initialRender?.total ?? endEvent?.total ?? '',
      filePickerMs: fileDialog?.meta?.ms ?? fileDialog?.dt ?? '',
      timeToFileSelectedMs: fileDialog?.total ?? '',
      appCriticalPathMs: readStart && (shieldRemoved || initialRender || endEvent)
        ? roundMs(numberValue((shieldRemoved || initialRender || endEvent)?.total) - numberValue(readStart.total))
        : '',
      postReadCriticalPathMs: read && (shieldRemoved || initialRender || endEvent)
        ? roundMs(numberValue((shieldRemoved || initialRender || endEvent)?.total) - numberValue(read.total))
        : '',
      timeToInitialRenderMs: initialRender?.total ?? '',
      readInvokeMs: read?.meta?.ms ?? read?.dt ?? '',
      rustTotalMs: read?.meta?.rust?.total_ms ?? '',
      rustReadMs: read?.meta?.rust?.read_ms ?? '',
      rustZipOpenMs: read?.meta?.rust?.zip_open_ms ?? '',
      rustBoardJsonReadMs: read?.meta?.rust?.board_json_read_ms ?? '',
      rustBoardJsonParseMs: read?.meta?.rust?.board_json_parse_ms ?? '',
      rustImageReadMs: read?.meta?.rust?.image_read_ms ?? '',
      rustImageReadMaxMs: read?.meta?.rust?.image_read_max_ms ?? '',
      rustImageReadMaxKey: read?.meta?.rust?.image_read_max_key ?? '',
      rustImageRefMs: read?.meta?.rust?.image_ref_ms ?? '',
      rustImageCrcMs: read?.meta?.rust?.image_crc_ms ?? '',
      rustLazyImageRefs: read?.meta?.rust?.lazy_image_refs ?? '',
      rustEagerImageRefs: read?.meta?.rust?.eager_image_refs ?? '',
      rustZipEntryCount: read?.meta?.rust?.zip_entry_count ?? '',
      applyStateMs: applyState?.meta?.ms ?? '',
      replaceObjectsMs: replaceObjects?.meta?.ms ?? '',
      restoreViewportMs: restoreViewport?.meta?.ms ?? '',
      historyResetMs: historyReset?.meta?.ms ?? '',
      initialHydrationMs: hydrationEnd?.meta?.ms ?? '',
      initialHydrationSkipped: hydrationEnd?.meta?.skipped ?? '',
      initialHydratedImages: hydrationEnd?.meta?.hydrated ?? '',
      initialHydrationPreviewReady: hydrationEnd?.meta?.previewReady ?? '',
      initialHydrationPreviewPendingReady: hydrationEnd?.meta?.previewPendingReady ?? '',
      initialHydrationPreviewBuilt: hydrationEnd?.meta?.previewBuilt ?? '',
      initialHydrationPreviewMB: hydrationEnd?.meta?.previewMB ?? '',
      initialHydrationPreviewMaxMs: hydrationEnd?.meta?.previewMaxMs ?? '',
      initialHydrationPreviewMaxKey: hydrationEnd?.meta?.previewMaxKey ?? '',
      openPreviewMs: openPreview?.meta?.ms ?? '',
      openPreviewSelected: openPreview?.meta?.selected ?? '',
      openPreviewReady: openPreview?.meta?.ready ?? '',
      openPreviewPendingReady: openPreview?.meta?.pendingReady ?? '',
      openPreviewBuilt: openPreview?.meta?.built ?? '',
      openPreviewFailed: openPreview?.meta?.failed ?? '',
      openPreviewSkipped: openPreview?.meta?.skipped ?? '',
      openPreviewMB: openPreview?.meta?.mb ?? '',
      openPreviewMaxMs: openPreview?.meta?.maxMs ?? '',
      openPreviewMaxKey: openPreview?.meta?.maxKey ?? '',
      openPreviewMaxWidth: openPreview?.meta?.maxWidth ?? '',
      openPreviewMaxHeight: openPreview?.meta?.maxHeight ?? '',
      openPreviewConcurrency: openPreview?.meta?.concurrency ?? '',
      ...previewStats,
      visibleBitmapSettleMs: bitmapSettle?.meta?.ms ?? '',
      visibleBitmapsReady: bitmapSettle?.meta?.after ?? '',
      visibleBitmapsFailed: bitmapSettle?.meta?.failed ?? '',
      pendingAfterInitial: initialPolicy?.meta?.pendingImages ?? '',
      scaledPrewarmMs: scaledPrewarm?.meta?.ms ?? '',
      scaledPrewarmSkipped: scaledPrewarm?.meta?.skipped ?? '',
      scaledPrewarmCandidates: scaledPrewarm?.meta?.candidates ?? '',
      scaledPrewarmBuilt: scaledPrewarm?.meta?.built ?? '',
      scaledPrewarmReady: scaledPrewarm?.meta?.alreadyReady ?? '',
      scaledPrewarmMB: scaledPrewarm?.meta?.mb ?? '',
      initialRenderMs: initialRender?.meta?.ms ?? '',
      initialDrawMs: initialRender?.meta?.drawMs ?? '',
      initialDrawBoardMs: initialRender?.meta?.drawBoardTotalMs ?? '',
      initialObjectLoopMs: initialRender?.meta?.objectLoopMs ?? '',
      initialSaveViewportMs: initialRender?.meta?.saveViewportMs ?? '',
      initialOverlayMs: initialRender?.meta?.overlayMs ?? '',
      initialVisibleObjects: initialRender?.meta?.visibleObjects ?? '',
      initialDrawnImages: initialRender?.meta?.drawnImages ?? '',
      initialDrawnText: initialRender?.meta?.drawnText ?? '',
      initialOpenPreviewImages: initialRender?.meta?.openPreviewImages ?? '',
      initialBitmapImages: initialRender?.meta?.bitmapImages ?? '',
      initialElementImages: initialRender?.meta?.elementImages ?? '',
      initialScaledImages: initialRender?.meta?.scaledImages ?? '',
      initialScaledFallbackFull: initialRender?.meta?.scaledFallbackFull ?? '',
      initialScaledVariantPendingImages: initialRender?.meta?.scaledVariantPendingImages ?? '',
      decodeCount: bitmapRows.length,
      decodeQueueStarts: decodeQueueStarts.length,
      decodeQueueWaitTotalMs: sumMeta(rows, 'cache-image:decode-queue:start', 'queueWaitMs'),
      decodeQueueWaitMaxMs: maxMeta(rows, 'cache-image:decode-queue:start', 'queueWaitMs'),
      bitmapDecodeTotalMs: sumMeta(rows, 'cache-image:createImageBitmap', 'ms'),
      bitmapDecodeMaxMs: maxMeta(rows, 'cache-image:createImageBitmap', 'ms'),
      imageCacheTotalMs: sumMeta(rows, 'cache-image:done', 'ms'),
      imageCacheMaxMs: maxMeta(rows, 'cache-image:done', 'ms'),
      imageCacheErrors: cacheErrors.length,
      backgroundHydrationMs: backgroundDone?.meta?.ms ?? '',
      backgroundHydratedImages: backgroundDone?.meta?.hydrated ?? '',
      backgroundRemainingImages: backgroundDone?.meta?.remaining ?? '',
      deferredInitialCacheImages: cacheStartAll?.meta?.deferredInitialCacheImages ?? '',
      timeToOpenEndMs: endEvent?.total ?? '',
    };
    const candidateRows = [
      { phase: 'read board', ms: numberValue(summaryRow.readInvokeMs), detail: 'file read + container decode' },
      { phase: 'rust image read', ms: numberValue(summaryRow.rustImageReadMs), detail: 'image extraction from board file' },
      { phase: 'apply state', ms: numberValue(summaryRow.applyStateMs), detail: 'replace objects and editor state' },
      { phase: 'open preview build', ms: numberValue(summaryRow.openPreviewMs), detail: 'visible preview bitmap build for first draw' },
      {
        phase: 'initial hydration',
        ms: previewFirstPaintReady ? 0 : numberValue(summaryRow.initialHydrationMs),
        detail: 'visible/all image display hydration',
      },
      { phase: 'scaled variant prewarm', ms: numberValue(summaryRow.scaledPrewarmMs), detail: 'visible low-resolution image variant build' },
      { phase: 'visible bitmap settle', ms: numberValue(summaryRow.visibleBitmapSettleMs), detail: 'wait for first visible bitmaps' },
      { phase: 'initial render', ms: numberValue(summaryRow.initialRenderMs), detail: 'applyTransform wrapper' },
      { phase: 'initial draw board', ms: numberValue(summaryRow.initialDrawBoardMs || summaryRow.initialDrawMs), detail: 'canvas draw' },
      { phase: 'background image decode queue wait max', ms: numberValue(summaryRow.decodeQueueWaitMaxMs), detail: 'slowest queued image decode start', background: true },
      { phase: 'background bitmap decode max', ms: numberValue(summaryRow.bitmapDecodeMaxMs), detail: 'slowest createImageBitmap', background: true },
    ].filter(row => row.ms > 0).sort((a, b) => (
      a.background === b.background ? b.ms - a.ms : (a.background ? 1 : -1)
    ));
    const findings = [];
    const top = candidateRows[0];
    if (top) findings.push(`Largest measured critical opening cost: ${top.phase} (${roundMs(top.ms)}ms, ${top.detail}).`);
    if (numberValue(summaryRow.filePickerMs) > 250) {
      findings.push(`File picker/user selection took ${roundMs(summaryRow.filePickerMs)}ms and is separated from appCriticalPathMs (${roundMs(summaryRow.appCriticalPathMs)}ms).`);
    }
    if (numberValue(summaryRow.rustImageReadMs) > 100) findings.push('Board file image extraction is material; compare smaller/compressed images or lazy extraction.');
    if (previewFirstPaintReady) {
      findings.push(`Opening previews covered the first draw (${summaryRow.openPreviewReady || summaryRow.initialOpenPreviewImages}/${summaryRow.openPreviewSelected || summaryRow.initialDrawnImages} previews, ${roundMs(summaryRow.openPreviewMs)}ms, ${summaryRow.openPreviewMB || summaryRow.initialHydrationPreviewMB || 0}MB); full bitmap hydration is background work.`);
    } else if (numberValue(summaryRow.openPreviewMs) > 100) {
      findings.push('Opening preview build is material but did not fully cover first draw; inspect openPreviewBreakdown for skipped or failed keys.');
    }
    if (numberValue(summaryRow.openPreviewFallbackDrawCount) > 0) {
      if (numberValue(summaryRow.openPreviewFallbackMissingMax) > 0) {
        findings.push(`Preview fallback draws reported missing images (max ${summaryRow.openPreviewFallbackMissingMax}); this can cause visible blanking while full bitmaps hydrate.`);
      } else {
        findings.push(`Preview fallback stayed populated across ${summaryRow.openPreviewFallbackDrawCount} draw(s); no missing-image blanking was recorded.`);
      }
      if (numberValue(summaryRow.openPreviewFallbackDrawCount) > 5 && numberValue(summaryRow.openPreviewHeldRenderSkips) === 0) {
        findings.push('Preview fallback redrew repeatedly while waiting for final release; image-ready renders were not held in this capture.');
      }
    }
    if (numberValue(summaryRow.openPreviewHeldRenderSkips) > 0) {
      findings.push(`${summaryRow.openPreviewHeldRenderSkips} image-ready redraw(s) were held while opening previews were active.`);
    }
    if (numberValue(summaryRow.openPreviewHeldVariantRenderSkips) > 0) {
      findings.push(`${summaryRow.openPreviewHeldVariantRenderSkips} scaled-variant redraw(s) were held while opening previews were active.`);
    }
    if (numberValue(summaryRow.openPreviewReleaseCount) > 0) {
      if (numberValue(summaryRow.openPreviewReleaseRemaining) === 0 && numberValue(summaryRow.openPreviewReleaseReleased) > 0) {
        findings.push(`Opening previews were released together after full visible bitmaps were ready (${summaryRow.openPreviewReleaseReleased} released).`);
      } else if (numberValue(summaryRow.openPreviewReleasePending) > 0) {
        findings.push(`Opening previews were still holding release at capture time (${summaryRow.openPreviewReleasePending} pending).`);
      }
    }
    if (numberValue(summaryRow.visibleBitmapSettleMs) > 100) findings.push('Initial open waits on visible bitmap readiness; inspect slowImages/cacheImageBreakdown for the visible image keys.');
    if (numberValue(summaryRow.decodeQueueWaitMaxMs) > 50) findings.push(previewFirstPaintReady ? 'Post-open image decode queue wait is visible during background hydration; tune only if after-open readiness matters.' : 'Image decode queue wait is visible; tune open hydration concurrency only after checking bitmap decode time.');
    if (numberValue(summaryRow.bitmapDecodeMaxMs) > 100) findings.push(previewFirstPaintReady ? 'At least one background bitmap decode is slow; inspect the largest images if full-board readiness matters.' : 'At least one bitmap decode is slow; inspect the largest images and their dimensions.');
    if (numberValue(summaryRow.initialObjectLoopMs) > 50) findings.push('First draw spends significant time in the object loop; inspect object counts, visible counts, and culling.');
    if (numberValue(summaryRow.initialSaveViewportMs) > 50) findings.push('Viewport persistence is contributing to first render time.');
    if (numberValue(summaryRow.initialScaledFallbackFull) || numberValue(summaryRow.initialScaledVariantPendingImages)) findings.push('Scaled image variants were missing during first draw; prewarm timing may be worth testing.');
    if (numberValue(summaryRow.scaledPrewarmBuilt) > 0 && numberValue(summaryRow.initialScaledFallbackFull) === 0) findings.push('Initial scaled variant prewarm covered the first draw.');
    if (summaryRow.scaledPrewarmSkipped === 'open-preview-ready') findings.push('Scaled variant prewarm was skipped because opening previews were ready for first draw.');
    if (numberValue(summaryRow.backgroundRemainingImages) > 0) findings.push('Background hydration did not finish by capture end; wait longer before finishDebug if full-board readiness matters.');
    if (!findings.length) findings.push('No measured opening phase clearly dominates this capture.');
    const timeline = rows
      .filter(e => e.step !== 'cache-image:source' && e.step !== 'cache-image:set-src')
      .map(e => ({
        step: e.step,
        total: e.total,
        dt: e.dt,
        ms: e.meta?.ms ?? e.meta?.queueWaitMs ?? '',
        count: e.meta?.count ?? '',
        hydrated: e.meta?.hydrated ?? '',
        pending: e.meta?.pendingImages ?? e.meta?.pending ?? '',
        released: e.meta?.released ?? '',
        remaining: e.meta?.remaining ?? '',
        selected: e.meta?.selected ?? '',
        ready: e.meta?.ready ?? '',
        built: e.meta?.built ?? '',
        skipped: e.meta?.skipped ?? '',
        openPreviewFallback: e.meta?.openPreviewFallback ?? '',
        openPreviewImages: e.meta?.openPreviewImages ?? '',
        missingImages: e.meta?.missingImages ?? '',
        previewReady: e.meta?.previewReady ?? '',
        previewPendingReady: e.meta?.previewPendingReady ?? '',
        previewBuilt: e.meta?.previewBuilt ?? '',
        previewMB: e.meta?.previewMB ?? e.meta?.mb ?? '',
        previewMaxMs: e.meta?.previewMaxMs ?? e.meta?.maxMs ?? '',
        previewMaxKey: e.meta?.previewMaxKey ?? e.meta?.maxKey ?? '',
        imgKey: e.meta?.imgKey || e.meta?.key || '',
        error: e.meta?.error || '',
      }));
    const slowCacheImages = cacheDoneRows
      .map(e => ({
        imgKey: e.meta?.imgKey || '',
        totalMs: e.meta?.ms ?? '',
        queueWaitMs: e.meta?.queueWaitMs ?? '',
        bitmapMs: e.meta?.bitmapMs ?? '',
        previewMs: e.meta?.previewMs ?? '',
        renderScheduleMs: e.meta?.renderScheduleMs ?? '',
        renderSkipped: e.meta?.cacheRenderSkipped ?? e.meta?.renderSkipped ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
        bitmapFailed: e.meta?.bitmapFailed ?? '',
      }))
      .sort((a, b) => numberValue(b.totalMs) - numberValue(a.totalMs))
      .slice(0, limit);
    console.table([summaryRow]);
    console.table(candidateRows.slice(0, 12));
    console.table(findings.map(finding => ({ finding })));
    console.table(slowCacheImages);
    console.table(timeline.slice(-limit));
    return {
      summary: summaryRow,
      bottlenecks: candidateRows,
      findings,
      slowCacheImages,
      timeline,
      events: rows,
    };
  }

  function report() {
    const rows = latestOpenEvents();
    const findStep = (step) => rows.find(e => e.step === step) || null;
    const findLastStep = (step) => [...rows].reverse().find(e => e.step === step) || null;
    const initialPolicy = findStep('hydrate-initial-policy');
    const visibleHydrate = findStep('hydrate-visible:end');
    const allHydrate = findStep('hydrate-all:end');
    const bitmapSettle = findStep('hydrate-visible:bitmap-settle');
    const backgroundDone = findLastStep('hydrate-background:done');
    const initialRender = findStep('initial-applyTransform');
    const openPreview = findStep('open-preview-visible:end');
    const scaledPrewarm = findStep('prewarm-visible-scaled-variants');
    const endEvent = findLastStep('end');
    const fileDialog = rows.find(e => e.step === 'invoke:ok' && /web_open_file_dialog/.test(e.meta?.command || '')) ||
      null;
    const readStart = rows.find(e => e.step === 'invoke:start' && /web_read_board/.test(e.meta?.command || '')) ||
      null;
    const read = rows.find(e => e.step === 'invoke:ok' && /web_read_board/.test(e.meta?.command || '')) ||
      null;
    const shape = findStep('read-board-shape');
    const applyState = findStep('apply-state');
    const cacheStartAll = findStep('cacheImage:start-all');
    const openingShieldRemoved = findStep('opening-shield:removed');
    const hydrationEnd = visibleHydrate || allHydrate;
    const previewFirstPaintReady = visibleHydrate?.meta?.skipped === 'open-preview-ready' ||
      (
        numberValue(openPreview?.meta?.ready) > 0 &&
        numberValue(openPreview?.meta?.ready) >= numberValue(openPreview?.meta?.selected || openPreview?.meta?.count)
      ) ||
      numberValue(initialRender?.meta?.openPreviewImages) > 0;
    const previewStats = openPreviewRuntimeStats(rows);
    const summaryRow = {
      mode: initialPolicy?.meta?.mode || hydrationMode,
      objectCount: shape?.meta?.objectCount ?? endEvent?.meta?.objectCount ?? '',
      imageCount: shape?.meta?.imageCount ?? endEvent?.meta?.imageCount ?? '',
      filePickerMs: fileDialog?.meta?.ms ?? fileDialog?.dt ?? '',
      timeToFileSelectedMs: fileDialog?.total ?? '',
      appCriticalPathMs: readStart && (openingShieldRemoved || initialRender || endEvent)
        ? roundMs(numberValue((openingShieldRemoved || initialRender || endEvent)?.total) - numberValue(readStart.total))
        : '',
      postReadCriticalPathMs: read && (openingShieldRemoved || initialRender || endEvent)
        ? roundMs(numberValue((openingShieldRemoved || initialRender || endEvent)?.total) - numberValue(read.total))
        : '',
      readInvokeMs: read?.meta?.ms ?? read?.dt ?? '',
      rustTotalMs: read?.meta?.rust?.total_ms ?? '',
      rustImageReadMs: read?.meta?.rust?.image_read_ms ?? '',
      applyStateMs: applyState?.meta?.ms ?? '',
      cacheStartAllMs: cacheStartAll?.meta?.ms ?? '',
      deferredInitialCacheImages: cacheStartAll?.meta?.deferredInitialCacheImages ?? '',
      initialHydrationMs: hydrationEnd?.meta?.ms ?? '',
      initialHydrationSkipped: hydrationEnd?.meta?.skipped ?? '',
      initialHydratedImages: hydrationEnd?.meta?.hydrated ?? '',
      openPreviewMs: openPreview?.meta?.ms ?? '',
      openPreviewSelected: openPreview?.meta?.selected ?? '',
      openPreviewReady: openPreview?.meta?.ready ?? '',
      openPreviewBuilt: openPreview?.meta?.built ?? '',
      openPreviewMB: openPreview?.meta?.mb ?? '',
      openPreviewMaxMs: openPreview?.meta?.maxMs ?? '',
      openPreviewMaxKey: openPreview?.meta?.maxKey ?? '',
      ...previewStats,
      visibleBitmapSettleMs: bitmapSettle?.meta?.ms ?? '',
      scaledPrewarmMs: scaledPrewarm?.meta?.ms ?? '',
      scaledPrewarmSkipped: scaledPrewarm?.meta?.skipped ?? '',
      scaledPrewarmBuilt: scaledPrewarm?.meta?.built ?? '',
      scaledPrewarmCandidates: scaledPrewarm?.meta?.candidates ?? '',
      visibleBitmapsBeforeSettle: bitmapSettle?.meta?.before ?? '',
      visibleBitmapsAfterSettle: bitmapSettle?.meta?.after ?? '',
      visibleBitmapsFailedAfterSettle: bitmapSettle?.meta?.failed ?? '',
      visibleBitmapsMissingAfterSettle: bitmapSettle?.meta?.missing ?? '',
      pendingAfterInitial: initialPolicy?.meta?.pendingImages ?? '',
      initialRenderMs: initialRender?.meta?.ms ?? '',
      initialTransformMeasuredMs: initialRender?.meta?.totalMeasuredMs ?? '',
      initialDrawMs: initialRender?.meta?.drawMs ?? '',
      initialSaveViewportMs: initialRender?.meta?.saveViewportMs ?? '',
      initialOverlayMs: initialRender?.meta?.overlayMs ?? '',
      initialDrawBoardMs: initialRender?.meta?.drawBoardTotalMs ?? '',
      initialObjectLoopMs: initialRender?.meta?.objectLoopMs ?? '',
      initialDrawnImages: initialRender?.meta?.drawnImages ?? '',
      initialOpenPreviewImages: initialRender?.meta?.openPreviewImages ?? '',
      initialBitmapImages: initialRender?.meta?.bitmapImages ?? '',
      initialElementImages: initialRender?.meta?.elementImages ?? '',
      initialScaledImages: initialRender?.meta?.scaledImages ?? '',
      initialScaledFallbackFull: initialRender?.meta?.scaledFallbackFull ?? '',
      initialCulledImages: initialRender?.meta?.culledImages ?? '',
      timeToInitialRenderMs: initialRender?.total ?? '',
      shieldRemoveMs: openingShieldRemoved?.meta?.ms ?? '',
      timeToOpenEndMs: endEvent?.total ?? '',
      backgroundHydrationMs: backgroundDone?.meta?.ms ?? '',
      backgroundHydratedImages: backgroundDone?.meta?.hydrated ?? '',
      backgroundRemainingImages: backgroundDone?.meta?.remaining ?? '',
    };
    const findings = [];
    if (summaryRow.mode === 'all-before-open' && Number(summaryRow.imageCount) > Number(summaryRow.initialHydratedImages || 0)) {
      findings.push('The open waited for non-visible image hydration; visible-first avoids that critical-path work.');
    }
    if (Number(summaryRow.rustImageReadMs) > Number(summaryRow.initialHydrationMs || 0)) {
      findings.push('Board file image extraction is the largest measured open phase.');
    }
    if (numberValue(summaryRow.filePickerMs) > 250) {
      findings.push(`File picker/user selection took ${roundMs(summaryRow.filePickerMs)}ms and is separated from appCriticalPathMs (${roundMs(summaryRow.appCriticalPathMs)}ms).`);
    }
    if (previewFirstPaintReady) {
      findings.push(`Opening previews covered the first draw (${summaryRow.openPreviewReady || summaryRow.initialOpenPreviewImages}/${summaryRow.openPreviewSelected || summaryRow.initialDrawnImages} previews, ${roundMs(summaryRow.openPreviewMs)}ms).`);
    } else if (Number(summaryRow.openPreviewMs) > 100) {
      findings.push('Opening preview build is material but did not fully cover first draw.');
    }
    if (numberValue(summaryRow.openPreviewFallbackMissingMax) > 0) {
      findings.push(`Preview fallback draws reported missing images (max ${summaryRow.openPreviewFallbackMissingMax}).`);
    } else if (numberValue(summaryRow.openPreviewFallbackDrawCount) > 0) {
      findings.push(`Preview fallback stayed populated across ${summaryRow.openPreviewFallbackDrawCount} draw(s).`);
    }
    if (numberValue(summaryRow.openPreviewHeldRenderSkips) > 0) {
      findings.push(`${summaryRow.openPreviewHeldRenderSkips} image-ready redraw(s) were held while opening previews were active.`);
    }
    if (numberValue(summaryRow.openPreviewHeldVariantRenderSkips) > 0) {
      findings.push(`${summaryRow.openPreviewHeldVariantRenderSkips} scaled-variant redraw(s) were held while opening previews were active.`);
    }
    if (numberValue(summaryRow.openPreviewReleaseRemaining) === 0 && numberValue(summaryRow.openPreviewReleaseReleased) > 0) {
      findings.push(`Opening previews were released together after full visible bitmaps were ready (${summaryRow.openPreviewReleaseReleased} released).`);
    }
    if (Number(summaryRow.initialRenderMs) > 50) {
      if (Number(summaryRow.initialSaveViewportMs) > 50 && Number(summaryRow.initialSaveViewportMs) > Number(summaryRow.initialDrawMs || 0)) {
        findings.push('Initial render is over budget due mostly to viewport persistence.');
      } else if (Number(summaryRow.initialDrawMs) > 50 || Number(summaryRow.initialDrawBoardMs) > 50) {
        findings.push('Initial render is over budget due mostly to first canvas draw.');
      } else {
        findings.push('Initial render is over budget; inspect initial applyTransform breakdown fields.');
      }
    }
    if (!findings.length) findings.push('No single open phase dominates the current capture.');
    console.table([summaryRow]);
    console.table(findings.map(finding => ({ finding })));
    return { summary: summaryRow, findings, events: rows };
  }

  function reset() {
    core.reset();
    latestOpenContext = null;
    initialRenderDebugDepth = 0;
  }


  return {
    enable,
    disable,
    setVerbose,
    setHydrationMode,
    setHydrationConcurrency,
    start,
    step,
    end,
    beginInitialRenderDebug,
    endInitialRenderDebug,
    isInitialRenderDebugActive,
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
      openPreviewBreakdown,
      optimizationReport,
      recordPreviewFallbackDraw,
      recordPreviewHeldRender,
      recordDynamicPreview,
      report,
      reset,
    get enabled() { return core.enabled; },
    get hydrationMode() { return hydrationMode; },
    get hydrationConcurrency() { return hydrationConcurrency; },
    get events() { return events.slice(); },
  };
})();

exposeDebug({ open: OpenDebug });
