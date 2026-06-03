'use strict';

var ExportDebug = (() => {
  const MAX_EVENTS = 2000;
  const MAX_MASSIVE_SAMPLES = 8;
  let massive = null;

  function sanitize(value) {
    return sanitizeDebugMeta(value, { roundNumbers: true });
  }

  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish export]',
    sanitize,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish export debugger enabled. Use finishDebug({ export: ["progressReport", "massiveReport", "smoothnessReport", "status", "slowImageReport", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish export debugger disabled.');
  }
  const setVerbose = core.setVerbose;
  const start = core.start;
  const step = core.step;
  const end = core.end;

  function pushTop(list, row, scoreKey, limit = MAX_MASSIVE_SAMPLES) {
    list.push(row);
    list.sort((a, b) => Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0));
    if (list.length > limit) list.length = limit;
  }

  function pushSample(list, row, limit = MAX_MASSIVE_SAMPLES) {
    if (list.length < limit) list.push(row);
  }

  function startMassive(op, imageObjs = []) {
    if (!core.enabled) return null;
    const seen = new Map();
    const countsBySourceKind = { webRef: 0, dataUrl: 0, missing: 0, other: 0 };
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
      if (typeof isWebImageRef === 'function' && isWebImageRef(source)) countsBySourceKind.webRef++;
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
        fallbackRenderCount: 0,
        dedupedCount: 0,
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
      smoothness: {
        eventLoopYields: 0,
        paintWaits: 0,
        totalYieldMs: 0,
        maxYieldMs: 0,
        slowYieldCount: 0,
        slowestYields: [],
      },
      progressUi: {
        updates: 0,
        currentText: '',
        firstText: '',
        firstTextAtMs: null,
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
    if (meta.tempKey && !meta.reusedTempKey) r.tempKeyCount++;
    if (meta.rendered) r.renderedCount++;
    if (meta.fallbackRender) r.fallbackRenderCount++;
    if (meta.deduped) r.dedupedCount++;
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
      fallbackRender: !!meta.fallbackRender,
      deduped: !!meta.deduped,
      sourceKind: meta.sourceKind || '',
      bytesMB: meta.bytesMB ?? '',
    }, 'ms');
    r.lastProgressAt = performance.now();
    massiveStep('resolve');
  }

  function recordEventLoopYield(meta = {}) {
    if (!massive) return;
    const s = massive.smoothness;
    const ms = Number(meta.ms) || 0;
    s.eventLoopYields++;
    if (meta.kind === 'paint-wait') s.paintWaits++;
    s.totalYieldMs += ms;
    s.maxYieldMs = Math.max(s.maxYieldMs, ms);
    if (ms > 50) s.slowYieldCount++;
    pushTop(s.slowestYields, {
      atMs: massiveElapsedMs(),
      phase: meta.phase || '',
      kind: meta.kind || 'timer',
      ms: Math.round(ms * 100) / 100,
      processed: meta.processed ?? '',
      imageCount: meta.imageCount ?? '',
      entryCount: meta.entryCount ?? '',
    }, 'ms');
    massiveStep('event-loop-yield', meta);
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
      method: meta.method || '',
      writeConcurrency: meta.writeConcurrency ?? '',
      writeMs: meta.writeMs ?? '',
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
    if (!p.firstText) {
      p.firstText = text;
      p.firstTextAtMs = elapsedMs;
    }
    const finishedCount = Number(meta.finishedCount) || 0;
    if (finishedCount > 0 && p.firstNonZeroAtMs == null) {
      p.firstNonZeroAtMs = elapsedMs;
      p.zeroHoldMs = Math.round((elapsedMs - (p.firstTextAtMs ?? elapsedMs)) * 100) / 100;
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
      webRefs: report.countsBySourceKind.webRef,
      dataUrls: report.countsBySourceKind.dataUrl,
      missingSources: report.missingSourceCount,
      duplicateKeys: report.duplicateKeyCount,
      lastStep: report.lastStep,
      lastError: report.lastError,
      resolved: report.resolve.keyCount,
      resolveErrors: report.resolve.errorCount,
      deduped: report.resolve.dedupedCount,
      saved: report.save.savedCount,
      saveFailed: report.save.failedCount,
      saveMissing: report.save.missingCount,
      batches: `${report.save.batchesDone}/${report.save.batchCount || 0}`,
      writtenMB: report.save.bytesMB,
      resolveDurationMs: report.resolve.durationMs,
      saveDurationMs: report.save.durationMs,
      eventLoopYields: report.smoothness.eventLoopYields,
      maxYieldMs: report.smoothness.maxYieldMs,
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
      resolveDeduped: report.resolve.dedupedCount,
      saveStartedAtMs: report.save.startedAtMs,
      saveCompletedAtMs: report.save.completedAtMs,
      saveDurationMs: report.save.durationMs,
      eventLoopYields: report.smoothness.eventLoopYields,
      maxYieldMs: report.smoothness.maxYieldMs,
      slowYieldCount: report.smoothness.slowYieldCount,
    }]);
    console.table([report.smoothness]);
    console.table(report.smoothness.slowestYields);
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
        deduped: report.resolve.dedupedCount,
        skipped: report.resolve.skippedCount,
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
      firstTextAtMs: report.progressUi.firstTextAtMs,
      firstNonZeroText: report.progressUi.firstNonZeroText,
      currentText: report.progressUi.currentText,
      firstNonZeroAtMs: report.progressUi.firstNonZeroAtMs,
      zeroHoldMs: report.progressUi.zeroHoldMs,
      zeroHoldPctOfTotal: totalMs && report.progressUi.zeroHoldMs != null ? Math.round(report.progressUi.zeroHoldMs / totalMs * 1000) / 10 : '',
      uiUpdates: report.progressUi.updates,
      saveStartedAtMs: report.save.startedAtMs,
      saveDurationMs: report.save.durationMs,
      eventLoopYields: report.smoothness.eventLoopYields,
      maxYieldMs: Math.round(report.smoothness.maxYieldMs * 100) / 100,
      slowYieldCount: report.smoothness.slowYieldCount,
    }];
    console.group('[Boardfish export] progress report');
    console.table(phaseRows);
    console.table(uiRows);
    console.table(report.progressUi.samples);
    console.groupEnd();
    return { phaseRows, uiRows, samples: report.progressUi.samples, report };
  }

  function smoothnessReport() {
    const report = massive ? JSON.parse(JSON.stringify(massive)) : null;
    if (!report) {
      console.warn('[Boardfish export] No smoothness report yet. Enable export debug, then run an export.');
      return null;
    }
    const out = {
      eventLoopYields: report.smoothness.eventLoopYields,
      paintWaits: report.smoothness.paintWaits,
      avgYieldMs: report.smoothness.eventLoopYields ? Math.round(report.smoothness.totalYieldMs / report.smoothness.eventLoopYields * 100) / 100 : 0,
      maxYieldMs: Math.round(report.smoothness.maxYieldMs * 100) / 100,
      slowYieldCount: report.smoothness.slowYieldCount,
      progressUiUpdates: report.progressUi.updates,
      firstText: report.progressUi.firstText,
      firstTextAtMs: report.progressUi.firstTextAtMs,
      firstNonZeroText: report.progressUi.firstNonZeroText,
      firstNonZeroAtMs: report.progressUi.firstNonZeroAtMs,
      zeroHoldMs: report.progressUi.zeroHoldMs,
      resolveDeduped: report.resolve.dedupedCount,
      resolveDurationMs: report.resolve.durationMs,
      saveDurationMs: report.save.durationMs,
    };
    console.group('[Boardfish export] smoothness report');
    console.table([out]);
    console.table(report.smoothness.slowestYields);
    console.table(report.progressUi.samples);
    console.groupEnd();
    return { summary: out, slowestYields: report.smoothness.slowestYields, progressSamples: report.progressUi.samples, report };
  }

  function watch(ctx, phase, meta = {}, intervalMs = 2000) {
    if (!core.enabled || !ctx) return () => {};
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
      deduped: e.meta?.deduped ?? '',
      savedCount: e.meta?.savedCount ?? '',
      failedCount: e.meta?.failedCount ?? '',
      missingCount: e.meta?.missingCount ?? '',
      bytesMB: e.meta?.bytesMB ?? '',
      method: e.meta?.method || '',
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
        method: e.meta?.method || '',
        deduped: e.meta?.deduped ?? '',
        sourceKind: e.meta?.sourceKind || '',
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
      .filter(e => e.step === 'render:done' || e.step === 'web-export:rendered-blob')
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        imgKey: e.meta?.imgKey ?? '',
        objectId: e.meta?.objectId ?? '',
        flipX: e.meta?.flipX ?? '',
        flipY: e.meta?.flipY ?? '',
        rotation: e.meta?.rotation ?? '',
        sourceKind: e.meta?.sourceKind ?? '',
        deduped: e.meta?.deduped ?? '',
        sourceMs: e.meta?.sourceMs ?? '',
        loadMs: e.meta?.loadMs ?? '',
        drawMs: e.meta?.drawMs ?? '',
        encodeMs: e.meta?.encodeMs ?? '',
        totalRenderMs: e.meta?.totalRenderMs ?? e.meta?.ms ?? e.dt ?? '',
        width: e.meta?.width ?? '',
        height: e.meta?.height ?? '',
        megapixels: e.meta?.megapixels ?? '',
        dataUrlMB: e.meta?.dataUrlMB ?? (e.meta?.bytes ? Math.round(e.meta.bytes / 1024 / 1024 * 100) / 100 : ''),
        ok: e.meta?.hasDataUrl ?? e.meta?.ok ?? '',
        error: e.meta?.error || '',
      }))
      .sort((a, b) => Number(b.totalRenderMs || 0) - Number(a.totalRenderMs || 0));

    const saveRows = events
      .filter(e => e.step === 'save:batch-result' || e.step === 'web-export:folder-write' || e.step === 'web-export:zip-done')
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
        bytesMB: e.meta?.bytesMB ?? (e.meta?.bytes ? Math.round(e.meta.bytes / 1024 / 1024 * 100) / 100 : (e.meta?.result?.bytes ? Math.round(e.meta.result.bytes / 1024 / 1024 * 100) / 100 : '')),
        method: e.meta?.method || '',
        writeConcurrency: e.meta?.writeConcurrency ?? e.meta?.result?.writeConcurrency ?? '',
        writeMs: e.meta?.writeMs ?? e.meta?.result?.writeMs ?? '',
        ms: e.meta?.ms ?? e.dt ?? '',
        error: e.meta?.error || '',
      }));

    const totals = {
      renderCount: renderRows.length,
      slowestRenderMs: renderRows[0]?.totalRenderMs ?? '',
      renderMsTotal: Math.round(renderRows.reduce((n, r) => n + (Number(r.totalRenderMs) || 0), 0) * 100) / 100,
      encodeMsTotal: Math.round(renderRows.reduce((n, r) => n + (Number(r.encodeMs) || 0), 0) * 100) / 100,
      saveMsTotal: Math.round(saveRows.reduce((n, r) => n + (Number(r.ms) || 0), 0) * 100) / 100,
    };

    console.group('[Boardfish export] slow image report');
    console.table([totals]);
    console.table(renderRows);
    console.table(saveRows);
    console.groupEnd();
    return { totals, renderRows, saveRows, events: events.slice() };
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
      resolveDeduped: massive?.resolve?.dedupedCount ?? '',
      saveDurationMs: massive?.save?.durationMs ?? '',
      eventLoopYields: massive?.smoothness?.eventLoopYields ?? '',
      maxYieldMs: massive?.smoothness?.maxYieldMs ?? '',
      error: last?.meta?.error || '',
    };
    console.table([out]);
    return out;
  }

  function reset() { core.reset(); massive = null; }

  return { enable, disable, setVerbose, start, step, end, watch, startMassive, recordResolveStart, recordResolveProgress, recordResolveDone, recordResolve, recordSaveStart, recordSaveBatch, recordSaveDone, recordProgressUi, recordEventLoopYield, massiveReport, progressReport, smoothnessReport, dump, summary, phaseSummary, slowImageReport, status, reset, get enabled() { return core.enabled; }, get events() { return events.slice(); }, get massive() { return massive ? JSON.parse(JSON.stringify(massive)) : null; } };
})();

exposeDebug({ export: ExportDebug });
