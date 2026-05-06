'use strict';

var InsertDebug = (() => {
  function sanitize(meta = {}) {
    return sanitizeDebugMeta(meta);
  }

  const recorder = createDebugRecorder({
    maxEvents: 300,
    label: '[Boardfish insert]',
    sanitize,
    onEnable() {
      console.info('Boardfish insert debugger enabled. Use finishDebug({ insert: ["report", "phaseSummary", "summary", "dump"] }) to collect results.');
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
