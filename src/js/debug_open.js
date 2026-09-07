'use strict';

var OpenDebug = (() => {
  const MAX_EVENTS = 5000;
  let initialRenderDebugDepth = 0;

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
    if (core.enabled) console.info('Boardfish open debugger enabled. Use finishDebug({ open: ["optimizationReport", "report", "phaseSummary", "hydrationSummary", "hydrationBreakdown", "cacheImageBreakdown", "imageStoreSummary", "imageStoreSample", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    initialRenderDebugDepth = 0;
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish open debugger disabled.');
  }
  const setVerbose = core.setVerbose;

  function setHydrationConcurrency(value) {
    const concurrency = setOpenHydrationConcurrency(value);
    console.info(`[Boardfish open] hydration concurrency set to ${concurrency}`);
    return concurrency;
  }

  const start = core.start;
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
      'hydrate-all:end',
      'hydrate-text-draw-caches',
      'settle-open-image-draw-caches',
      'hydrate-initial-policy',
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
      hydrationMode: 'all-before-interaction',
      hydrationConcurrency: getOpenHydrationConcurrency(),
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
      concurrency: getOpenHydrationConcurrency(),
      mode: 'all-before-interaction',
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
        renderScheduleMs: 0,
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
      } else if (event.step === 'cache-image:schedule-render') {
        row.renderScheduleMs = meta.ms ?? row.renderScheduleMs;
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
        cacheRenderScheduleMs: e.meta?.cacheRenderScheduleMs ?? '',
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
        manifestRefs: e.meta?.manifestRefs ?? '',
        dataUrlRefs: e.meta?.dataUrlRefs ?? '',
        deferredInitialCacheImages: e.meta?.deferredInitialCacheImages ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
        readyStage: e.meta?.cacheReadyStage ?? '',
        imgKey: e.meta?.imgKey || e.meta?.key || '',
        ms: e.meta?.ms ?? '',
        totalMeasuredMs: e.meta?.totalMeasuredMs ?? '',
        drawMs: e.meta?.drawMs ?? '',
        overlayMs: e.meta?.overlayMs ?? '',
        drawBoardTotalMs: e.meta?.drawBoardTotalMs ?? '',
        objectLoopMs: e.meta?.objectLoopMs ?? '',
        drawnImages: e.meta?.drawnImages ?? '',
        drawnText: e.meta?.drawnText ?? '',
        visibleObjects: e.meta?.visibleObjects ?? '',
        missingImages: e.meta?.missingImages ?? '',
        bitmapImages: e.meta?.bitmapImages ?? '',
        elementImages: e.meta?.elementImages ?? '',
        scaledImages: e.meta?.scaledImages ?? '',
        scaledFallbackFull: e.meta?.scaledFallbackFull ?? '',
        culledImages: e.meta?.culledImages ?? '',
        queueWaitMs: e.meta?.queueWaitMs ?? '',
        bitmapMs: e.meta?.bitmapMs ?? '',
        skipped: e.meta?.skipped ?? '',
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

  function sumMeta(rows, field) {
    return roundMs(rows
      .reduce((sum, event) => sum + numberValue(event.meta?.[field]), 0));
  }

  function maxMeta(rows, field) {
    return roundMs(rows
      .reduce((max, event) => Math.max(max, numberValue(event.meta?.[field])), 0));
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
    const hydrationEnd = findStep('hydrate-all:end');
    const initialRender = findStep('initial-applyTransform');
    const shieldRemoved = findStep('opening-shield:removed');
    const endEvent = findLastStep('end');
    const decodeQueueStarts = rows.filter(e => e.step === 'cache-image:decode-queue:start');
    const cacheDoneRows = rows.filter(e => e.step === 'cache-image:done');
    const bitmapRows = rows.filter(e => e.step === 'cache-image:createImageBitmap');
    const cacheErrors = rows.filter(e => /cache-image:.*:error$/.test(e.step || ''));
    const summaryRow = {
      mode: initialPolicy?.meta?.mode || 'all-before-interaction',
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
      initialHydratedImages: hydrationEnd?.meta?.hydrated ?? '',
      pendingAfterInitial: initialPolicy?.meta?.pendingImages ?? '',
      initialRenderMs: initialRender?.meta?.ms ?? '',
      initialDrawMs: initialRender?.meta?.drawMs ?? '',
      initialDrawBoardMs: initialRender?.meta?.drawBoardTotalMs ?? '',
      initialObjectLoopMs: initialRender?.meta?.objectLoopMs ?? '',
      initialOverlayMs: initialRender?.meta?.overlayMs ?? '',
      initialVisibleObjects: initialRender?.meta?.visibleObjects ?? '',
      initialDrawnImages: initialRender?.meta?.drawnImages ?? '',
      initialDrawnText: initialRender?.meta?.drawnText ?? '',
      initialBitmapImages: initialRender?.meta?.bitmapImages ?? '',
      initialElementImages: initialRender?.meta?.elementImages ?? '',
      initialScaledImages: initialRender?.meta?.scaledImages ?? '',
      initialScaledFallbackFull: initialRender?.meta?.scaledFallbackFull ?? '',
      initialScaledVariantPendingImages: initialRender?.meta?.scaledVariantPendingImages ?? '',
      decodeCount: bitmapRows.length,
      decodeQueueStarts: decodeQueueStarts.length,
      decodeQueueWaitTotalMs: sumMeta(decodeQueueStarts, 'queueWaitMs'),
      decodeQueueWaitMaxMs: maxMeta(decodeQueueStarts, 'queueWaitMs'),
      bitmapDecodeTotalMs: sumMeta(bitmapRows, 'ms'),
      bitmapDecodeMaxMs: maxMeta(bitmapRows, 'ms'),
      imageCacheTotalMs: sumMeta(cacheDoneRows, 'ms'),
      imageCacheMaxMs: maxMeta(cacheDoneRows, 'ms'),
      imageCacheErrors: cacheErrors.length,
      deferredInitialCacheImages: cacheStartAll?.meta?.deferredInitialCacheImages ?? '',
      timeToOpenEndMs: endEvent?.total ?? '',
    };
    const candidateRows = [
      { phase: 'read board', ms: numberValue(summaryRow.readInvokeMs), detail: 'file read + container decode' },
      { phase: 'rust image read', ms: numberValue(summaryRow.rustImageReadMs), detail: 'image extraction from board file' },
      { phase: 'apply state', ms: numberValue(summaryRow.applyStateMs), detail: 'replace objects and editor state' },
      {
        phase: 'initial hydration',
        ms: numberValue(summaryRow.initialHydrationMs),
        detail: 'image display hydration before interaction',
      },
      { phase: 'initial render', ms: numberValue(summaryRow.initialRenderMs), detail: 'applyTransform wrapper' },
      { phase: 'initial draw board', ms: numberValue(summaryRow.initialDrawBoardMs || summaryRow.initialDrawMs), detail: 'canvas draw' },
      { phase: 'image decode queue wait max', ms: numberValue(summaryRow.decodeQueueWaitMaxMs), detail: 'slowest queued image decode start' },
      { phase: 'bitmap decode max', ms: numberValue(summaryRow.bitmapDecodeMaxMs), detail: 'slowest createImageBitmap' },
    ].filter(row => row.ms > 0).sort((a, b) => b.ms - a.ms);
    const findings = [];
    const top = candidateRows[0];
    if (top) findings.push(`Largest measured critical opening cost: ${top.phase} (${roundMs(top.ms)}ms, ${top.detail}).`);
    if (numberValue(summaryRow.filePickerMs) > 250) {
      findings.push(`File picker/user selection took ${roundMs(summaryRow.filePickerMs)}ms and is separated from appCriticalPathMs (${roundMs(summaryRow.appCriticalPathMs)}ms).`);
    }
    if (numberValue(summaryRow.rustImageReadMs) > 100) findings.push('Board file image extraction is material; compare smaller/compressed images or lazy extraction.');
    if (numberValue(summaryRow.decodeQueueWaitMaxMs) > 50) findings.push('Image decode queue wait is visible; tune open hydration concurrency only after checking bitmap decode time.');
    if (numberValue(summaryRow.bitmapDecodeMaxMs) > 100) findings.push('At least one bitmap decode is slow; inspect the largest images and their dimensions.');
    if (numberValue(summaryRow.initialObjectLoopMs) > 50) findings.push('First draw spends significant time in the object loop; inspect object counts, visible counts, and culling.');
    if (numberValue(summaryRow.initialScaledFallbackFull) || numberValue(summaryRow.initialScaledVariantPendingImages)) findings.push('Scaled image variants were missing during first draw; prewarm timing may be worth testing.');
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
        missingImages: e.meta?.missingImages ?? '',
        imgKey: e.meta?.imgKey || e.meta?.key || '',
        error: e.meta?.error || '',
      }));
    const slowCacheImages = cacheDoneRows
      .map(e => ({
        imgKey: e.meta?.imgKey || '',
        totalMs: e.meta?.ms ?? '',
        queueWaitMs: e.meta?.queueWaitMs ?? '',
        bitmapMs: e.meta?.bitmapMs ?? '',
        renderScheduleMs: e.meta?.renderScheduleMs ?? '',
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
    const hydrationEnd = findStep('hydrate-all:end');
    const initialRender = findStep('initial-applyTransform');
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
    const summaryRow = {
      mode: initialPolicy?.meta?.mode || 'all-before-interaction',
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
      initialHydratedImages: hydrationEnd?.meta?.hydrated ?? '',
      pendingAfterInitial: initialPolicy?.meta?.pendingImages ?? '',
      initialRenderMs: initialRender?.meta?.ms ?? '',
      initialTransformMeasuredMs: initialRender?.meta?.totalMeasuredMs ?? '',
      initialDrawMs: initialRender?.meta?.drawMs ?? '',
      initialOverlayMs: initialRender?.meta?.overlayMs ?? '',
      initialDrawBoardMs: initialRender?.meta?.drawBoardTotalMs ?? '',
      initialObjectLoopMs: initialRender?.meta?.objectLoopMs ?? '',
      initialDrawnImages: initialRender?.meta?.drawnImages ?? '',
      initialBitmapImages: initialRender?.meta?.bitmapImages ?? '',
      initialElementImages: initialRender?.meta?.elementImages ?? '',
      initialScaledImages: initialRender?.meta?.scaledImages ?? '',
      initialScaledFallbackFull: initialRender?.meta?.scaledFallbackFull ?? '',
      initialCulledImages: initialRender?.meta?.culledImages ?? '',
      timeToInitialRenderMs: initialRender?.total ?? '',
      shieldRemoveMs: openingShieldRemoved?.meta?.ms ?? '',
      timeToOpenEndMs: endEvent?.total ?? '',
    };
    const findings = [];
    if (Number(summaryRow.rustImageReadMs) > Number(summaryRow.initialHydrationMs || 0)) {
      findings.push('Board file image extraction is the largest measured open phase.');
    }
    if (numberValue(summaryRow.filePickerMs) > 250) {
      findings.push(`File picker/user selection took ${roundMs(summaryRow.filePickerMs)}ms and is separated from appCriticalPathMs (${roundMs(summaryRow.appCriticalPathMs)}ms).`);
    }
    if (Number(summaryRow.initialRenderMs) > 50) {
      if (Number(summaryRow.initialDrawMs) > 50 || Number(summaryRow.initialDrawBoardMs) > 50) {
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
    initialRenderDebugDepth = 0;
  }


  return {
    enable,
    disable,
    setVerbose,
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
    optimizationReport,
    report,
    reset,
    get enabled() { return core.enabled; },
    get hydrationConcurrency() { return getOpenHydrationConcurrency(); },
    get events() { return events.slice(); },
  };
})();

exposeDebug({ open: OpenDebug });
