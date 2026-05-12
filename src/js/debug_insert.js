'use strict';

var InsertDebug = (() => {
  const MAX_EVENTS = 5000;
  const BREAKDOWN_LIMIT = 200;

  function round(value) {
    return round2(value);
  }

  function sanitize(meta = {}) {
    return sanitizeDebugMeta(meta);
  }

  const recorder = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish insert]',
    sanitize,
    onEnable() {
      console.info('Boardfish insert debugger enabled. Use finishDebug({ insert: ["report", "imageBreakdown", "nativeBreakdown", "phaseSummary", "summary", "dump"] }) to collect results.');
    },
    onDisable() {
      if (DEBUG_TOOLS_ENABLED) console.info('Boardfish insert debugger disabled.');
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
        bytes: e.meta?.bytes ?? '',
        readMode: e.meta?.readMode || '',
        sourceKind: e.meta?.sourceKind || '',
        imgKey: e.meta?.imgKey || '',
        native: e.meta?.native ?? '',
        dataUrlLen: e.meta?.dataUrlLen ?? '',
        width: e.meta?.width ?? '',
        height: e.meta?.height ?? '',
        materializeMs: e.step === 'materialize:end' ? e.meta?.ms ?? e.dt : '',
        cacheReadyStage: e.meta?.cacheReadyStage || '',
        cacheTotalMs: e.meta?.cacheTotalMs ?? '',
        cacheQueueWaitMs: e.meta?.cacheQueueWaitMs ?? '',
        cacheBitmapMs: e.meta?.cacheBitmapMs ?? '',
        bitmapReady: e.meta?.bitmapReady ?? '',
        concurrency: e.meta?.concurrency ?? '',
        acceptedFileCount: e.meta?.acceptedFileCount ?? '',
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
  function eventsForId(id) {
    return events().filter(e => e.id === id);
  }
  function lastStep(run, stepName) {
    return [...run].reverse().find(e => e.step === stepName);
  }
  function firstStepAfter(at, stepName, op = 'insertImage') {
    return events().find(e => e.op === op && e.step === stepName && e.at >= at);
  }
  function sumStepMs(source, stepName) {
    return events()
      .filter(e => e.step === stepName && (!source || e.meta?.source === source))
      .reduce((n, e) => n + (Number(e.meta?.ms ?? e.dt) || 0), 0);
  }
  function imageBreakdownRows(limit = BREAKDOWN_LIMIT) {
    return events()
      .filter(e => e.op === 'insertImage' && e.step === 'end')
      .map((end) => {
        const run = eventsForId(end.id);
        const start = run.find(e => e.step === 'start');
        const nativeRegister = lastStep(run, 'native-register:end');
        const readEnd = lastStep(run, 'read:end');
        const materialize = lastStep(run, 'materialize:end');
        const objectAdd = lastStep(run, 'object:add');
        const ready = lastStep(run, 'ready');
        const cacheQueued = lastStep(run, 'cache:queued');
        const webRef = lastStep(run, 'web-ref:create');
        return {
          id: end.id,
          source: end.meta?.source || start?.meta?.source || '',
          fileName: end.meta?.fileName || start?.meta?.fileName || '',
          totalMs: end.total ?? '',
          readMs: readEnd?.dt ?? '',
          readMode: readEnd?.meta?.readMode || '',
          nativeRegisterMs: nativeRegister?.dt ?? '',
          materializeMs: materialize?.meta?.ms ?? materialize?.dt ?? '',
          objectAtMs: objectAdd?.total ?? '',
          readyAtMs: ready?.total ?? '',
          readyStage: ready?.meta?.cacheReadyStage || '',
          cacheTotalMs: ready?.meta?.cacheTotalMs ?? '',
          cacheQueueWaitMs: ready?.meta?.cacheQueueWaitMs ?? '',
          cacheBitmapMs: ready?.meta?.cacheBitmapMs ?? '',
          bitmapReady: ready?.meta?.bitmapReady ?? '',
          resolveOnLoad: cacheQueued?.meta?.resolveOnLoad ?? '',
          sourceKind: webRef?.meta?.sourceKind || cacheQueued?.meta?.sourceKind || end.meta?.sourceKind || '',
          width: nativeRegister?.meta?.width ?? '',
          height: nativeRegister?.meta?.height ?? '',
          bytes: webRef?.meta?.bytes ?? nativeRegister?.meta?.fileSize ?? end.meta?.bytes ?? end.meta?.fileSize ?? '',
          added: end.meta?.added ?? '',
          error: end.meta?.error || '',
        };
      })
      .slice(-Math.max(1, Number(limit) || BREAKDOWN_LIMIT));
  }
  function imageBreakdown(limit = BREAKDOWN_LIMIT) {
    const rows = imageBreakdownRows(limit);
    console.table(rows);
    return rows;
  }
  function nativeBreakdown(limit = BREAKDOWN_LIMIT) {
    const rows = imageBreakdownRows(limit).filter(row => row.source === 'file-picker-native' || row.source === 'native-drop');
    console.table(rows);
    return rows;
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
    const start = findStep('start');
    const imageEnds = events().filter(e => e.op === 'insertImage' && e.step === 'end' && e.meta?.source === last.meta?.source);
    const readEnds = events().filter(e => e.op === 'insertImage' && e.step === 'read:end' && e.meta?.source === last.meta?.source);
    const registerEnds = events().filter(e => e.op === 'insertImage' && e.step === 'register:end' && e.meta?.source === last.meta?.source);
    const nativeRegisterEnds = events().filter(e => e.step === 'native-register:end' && e.meta?.source === last.meta?.source);
    const objectAdd = start ? firstStepAfter(start.at, 'object:add') : null;
    const displayReady = start ? firstStepAfter(start.at, 'ready') : null;
    const pickerEnd = [...events()].reverse().find(e => e.op === 'pickImages' && e.step === 'end');
    const concurrencyStep = findStep('native:concurrency') || findStep('bulk:start');
    const registerSource = nativeRegisterEnds.length ? nativeRegisterEnds : registerEnds;
    const maxRegisterMs = registerSource.reduce((n, e) => Math.max(n, Number(e.dt) || 0), 0);
    const maxRegister = registerSource.find(e => (Number(e.dt) || 0) === maxRegisterMs);
    const maxReadMs = readEnds.reduce((n, e) => Math.max(n, Number(e.dt) || 0), 0);
    const maxRead = readEnds.find(e => (Number(e.dt) || 0) === maxReadMs);
    const readyStart = findStep('ready:wait-start');
    const readyEnd = findStep('ready:wait-end');
    const bulkEnd = findStep('bulk:end');
    const registerMs = readyStart ? readyStart.total : (bulkEnd ? bulkEnd.total : last.total);
    const out = {
      source: last.meta?.source || '',
      added: last.meta?.added ?? imageEnds.filter(e => e.meta?.added).length,
      fileCount: last.meta?.fileCount ?? '',
      acceptedFileCount: last.meta?.acceptedFileCount ?? '',
      droppedFileCount: last.meta?.droppedFileCount ?? '',
      totalMs: last.total ?? '',
      pickerMs: pickerEnd?.meta?.source === last.meta?.source ? pickerEnd.total : '',
      concurrency: concurrencyStep?.meta?.concurrency ?? '',
      timeToFirstObjectMs: start && objectAdd ? round(objectAdd.at - start.at) : '',
      timeToFirstDisplayMs: start && displayReady ? round(displayReady.at - start.at) : '',
      readMsTotal: round(sumStepMs(last.meta?.source, 'read:end')),
      maxReadMs: round(maxReadMs),
      maxReadFile: maxRead?.meta?.fileName || '',
      registerMs,
      materializeMsTotal: round(sumStepMs(last.meta?.source, 'materialize:end')),
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
    imageBreakdown,
    nativeBreakdown,
    phaseSummary,
    summary,
    dump,
    reset: recorder.reset,
    get events() { return events().slice(); },
  };
})();

exposeDebug({ insert: InsertDebug });
