// ─── Clipboard / image debugger ──────────────────────────────────────────────
var ClipDebug = (() => {

  const MAX_EVENTS = 2000;

  function sanitize(value) {
    return sanitizeDebugMeta(value);
  }

  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish clipboard]',
    sanitize,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish clipboard debugger enabled. Use finishDebug({ clipboard: ["pasteBreakdown", "largePasteReport", "phaseSummary", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish clipboard debugger disabled.');
  }
  const setVerbose = core.setVerbose;
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

  async function wrap(ctx, command, call, meta = {}) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    if (!core.enabled) return call();
    const t0 = performance.now();
    step(ctx, 'invoke:start', { command, ...meta });
    try {
      const result = await call();
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
      displayReady: e.meta?.displayReady ?? '',
      readyStage: e.meta?.readyStage || '',
      bitmapReady: e.meta?.bitmapReady ?? '',
      fallbackReady: e.meta?.fallbackReady ?? '',
      cacheTotalMs: e.meta?.cacheTotalMs ?? '',
      cacheQueueWaitMs: e.meta?.cacheQueueWaitMs ?? '',
      cacheBitmapMs: e.meta?.cacheBitmapMs ?? '',
      objectDelta: e.meta?.objectDelta ?? '',
      dataUrlLen: e.meta?.dataUrlLen ?? '',
      blobSize: e.meta?.blobSize ?? '',
      blobType: e.meta?.blobType || e.meta?.type || '',
      fileName: e.meta?.fileName || '',
      fileSize: e.meta?.fileSize ?? '',
      source: e.meta?.source || '',
      sourceKind: e.meta?.sourceKind || e.meta?.pathKind || e.meta?.assetKind || '',
      sourceLen: e.meta?.sourceLen ?? e.meta?.pathLen ?? e.meta?.assetLen ?? '',
      sourcePrefix: e.meta?.sourcePrefix || e.meta?.pathPrefix || e.meta?.assetPrefix || '',
      bytes: e.meta?.bytes ?? timing(e.meta, 'bytes'),
      assetReady: e.meta?.assetReady ?? '',
      nativePath: timing(e.meta, 'path'),
      flipped: timing(e.meta, 'flipped'),
      width: timing(e.meta, 'width'),
      height: timing(e.meta, 'height'),
      pixels: timing(e.meta, 'pixels'),
      rgbaMB: timing(e.meta, 'rgbaMb'),
      nativeTotalMs: timing(e.meta, 'totalMs'),
      decodeMs: timing(e.meta, 'decodeMs'),
      readMs: timing(e.meta, 'readMs'),
      pngEncodeMs: timing(e.meta, 'pngEncodeMs'),
      cacheInsertMs: timing(e.meta, 'cacheInsertMs'),
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
        bytes: timing(e.meta, 'bytes'),
        rgbaMB: timing(e.meta, 'rgbaMb'),
        invokeMs: e.meta?.ms ?? '',
        nativeTotalMs: timing(e.meta, 'totalMs'),
        decodeMs: timing(e.meta, 'decodeMs'),
        readMs: timing(e.meta, 'readMs'),
        pngEncodeMs: timing(e.meta, 'pngEncodeMs'),
        cacheInsertMs: timing(e.meta, 'cacheInsertMs'),
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

  function memorySnapshotFromEvent(e) {
    const meta = e?.meta || {};
    const bytes = Number(meta.blobSize ?? meta.bytes ?? timing(meta, 'bytes')) || 0;
    const dataUrlLen = Number(meta.dataUrlLen) || 0;
    const width = Number(meta.width ?? timing(meta, 'width')) || 0;
    const height = Number(meta.height ?? timing(meta, 'height')) || 0;
    const pixels = Number(meta.pixels ?? timing(meta, 'pixels')) || (width && height ? width * height : 0);
    return {
      blobMB: bytes ? Math.round(bytes / 1024 / 1024 * 100) / 100 : '',
      dataUrlMB: dataUrlLen ? Math.round(dataUrlLen / 1024 / 1024 * 100) / 100 : '',
      rgbaMB: pixels ? Math.round(pixels * 4 / 1024 / 1024 * 100) / 100 : '',
      width: width || '',
      height: height || '',
      pixels: pixels || '',
    };
  }

  function largePasteReport() {
    const pasteStarts = events.filter(e => e.op === 'pasteAtPos' && e.step === 'start');
    const pasteStart = pasteStarts[pasteStarts.length - 1];
    if (!pasteStart) {
      const empty = { pasteRuns: 0, verdict: 'no pasteAtPos events captured' };
      console.table([empty]);
      return empty;
    }
    const run = events.filter(e => e.id === pasteStart.id);
    const stepNames = new Set(run.map(e => e.step));
    const latest = (stepName) => [...run].reverse().find(e => e.step === stepName);
    const firstError = run.find(e => /(?:error|miss|empty)$/i.test(e.step) || e.meta?.error);
    const blobEvent = latest('event-image-blob') || latest('browser-image-blob');
    const blobReadOk = latest('clipboard-blob-read:ok');
    const nativeRead = latest('native-image-read');
    const nativeReadCommand = typeof TAURI_COMMANDS !== 'undefined'
      ? TAURI_COMMANDS.READ_IMAGE_FROM_CLIPBOARD_CACHED
      : 'read_image_from_clipboard_cached';
    const nativeInvokeOk = run.find(e => e.step === 'invoke:ok' && e.meta?.command === nativeReadCommand);
    const materializeEnd = latest('paste-native-cache:materialize-end');
    const webInsertEnd = latest('web-paste-event:insert-end') || latest('web-paste-browser:insert-end');
    const addObject = latest('paste-native-cache:add-object') || latest('paste-image:add-object') || webInsertEnd;
    const end = latest('end');
    const objectCountBefore = pasteStart?.meta?.objectCountBefore ?? '';
    const objectCountAfter = end?.meta?.objectCountAfter ?? '';
    const objectDelta = typeof objectCountBefore === 'number' && typeof objectCountAfter === 'number'
      ? objectCountAfter - objectCountBefore
      : '';
    const nativeReadAttempted = run.some(e => e.meta?.command === nativeReadCommand);
    const pathDetected = webInsertEnd
      ? end?.meta?.path || 'web-paste-blob'
      : blobReadOk
      ? 'event-or-browser-blob'
      : nativeReadAttempted
        ? 'native-cache'
        : stepNames.has('browser-clipboard-read:start')
          ? 'browser-read'
          : stepNames.has('event-clipboard:inspect')
            ? 'paste-event'
            : 'unknown';
    const checkpoints = [
      ['pasteStarted', true],
      ['eventInspected', stepNames.has('event-clipboard:inspect') || !pasteStart.meta?.clipboardData],
      ['imagePayloadFound', !!blobEvent || nativeReadAttempted],
      ['imagePayloadRead', !!blobReadOk || !!nativeRead || !!nativeInvokeOk || !!webInsertEnd],
      ['nativeMaterialized', pathDetected !== 'native-cache' || !!materializeEnd?.meta?.assetReady],
      ['objectAddStarted', !!addObject],
      ['pasteEndedAdded', end?.meta?.added === true || objectDelta > 0],
    ];
    const failedCheckpoint = checkpoints.find(([, ok]) => !ok);
    const sizeEvent = nativeRead || nativeInvokeOk || blobReadOk || blobEvent;
    const out = {
      pasteRuns: pasteStarts.length,
      totalMs: end?.total ?? run.at(-1)?.total ?? '',
      path: end?.meta?.path || '',
      added: end?.meta?.added ?? '',
      displayReady: end?.meta?.displayReady ?? (webInsertEnd ? true : ''),
      readyStage: end?.meta?.readyStage || '',
      bitmapReady: end?.meta?.bitmapReady ?? '',
      objectCountBefore,
      objectCountAfter,
      objectDelta,
      pathDetected,
      imageSource: blobEvent?.meta?.type || blobReadOk?.meta?.blobType || nativeRead?.meta?.mime || '',
      blobSize: blobEvent?.meta?.blobSize ?? blobReadOk?.meta?.blobSize ?? '',
      bytes: nativeRead?.meta?.bytes ?? timing(nativeInvokeOk?.meta, 'bytes') ?? '',
      dataUrlLen: blobReadOk?.meta?.dataUrlLen ?? '',
      ...memorySnapshotFromEvent(sizeEvent),
      failedCheckpoint: failedCheckpoint ? failedCheckpoint[0] : '',
      firstErrorStep: firstError?.step || '',
      firstError: firstError?.meta?.error || '',
      verdict: failedCheckpoint
        ? `inspect ${failedCheckpoint[0]} and surrounding rows`
        : 'all paste checkpoints reached in captured run',
    };
    console.table([out]);
    console.table(checkpoints.map(([checkpoint, ok]) => ({ checkpoint, ok })));
    return { summary: out, checkpoints: checkpoints.map(([checkpoint, ok]) => ({ checkpoint, ok })), rows: run.map(e => debugRow(e, { includeId: true, includeSkipped: true })) };
  }

  function pasteBreakdown() {
    const pasteStarts = events.filter(e => e.op === 'pasteAtPos' && e.step === 'start');
    const pasteStart = pasteStarts[pasteStarts.length - 1];
    if (!pasteStart) {
      const empty = { pasteRuns: 0, verdict: 'no pasteAtPos events captured' };
      console.table([empty]);
      return empty;
    }
    const run = events.filter(e => e.id === pasteStart.id);
    const latest = (stepName) => [...run].reverse().find(e => e.step === stepName);
    const first = (stepName) => run.find(e => e.step === stepName);
    const nativeReadCommand = typeof TAURI_COMMANDS !== 'undefined'
      ? TAURI_COMMANDS.READ_IMAGE_FROM_CLIPBOARD_CACHED
      : 'read_image_from_clipboard_cached';
    const nativeInvokeOk = run.find(e => e.step === 'invoke:ok' && e.meta?.command === nativeReadCommand);
    const blobEvent = latest('event-image-blob') || latest('browser-image-blob');
    const blobReadOk = latest('clipboard-blob-read:ok');
    const nativeRead = latest('native-image-read');
    const materializeEnd = latest('paste-native-cache:materialize-end');
    const objectAdd = latest('paste-native-cache:add-object') || latest('paste-image:add-object');
    const webInsertEnd = latest('web-paste-event:insert-end') || latest('web-paste-browser:insert-end');
    const readyEnd = latest('paste-image:ready-wait-end');
    const settleEnd = latest('native-clipboard-settle:end');
    const settleSkip = latest('native-clipboard-settle:skip');
    const end = latest('end');
    const imageReadAt = blobReadOk?.total ?? nativeRead?.total ?? nativeInvokeOk?.total ?? webInsertEnd?.total ?? '';
    const objectAt = objectAdd?.total ?? webInsertEnd?.total ?? '';
    const displayAt = readyEnd?.total ?? webInsertEnd?.total ?? '';
    const out = {
      pasteRuns: pasteStarts.length,
      path: end?.meta?.path || '',
      totalMs: end?.total ?? run.at(-1)?.total ?? '',
      nativeSettleMs: settleEnd?.meta?.ms ?? (settleSkip ? 0 : ''),
      imagePayloadAtMs: imageReadAt,
      objectAtMs: objectAt,
      displayReadyAtMs: displayAt,
      objectToDisplayMs: typeof objectAt === 'number' && typeof displayAt === 'number' ? Math.round((displayAt - objectAt) * 100) / 100 : '',
      materializeMs: materializeEnd?.meta?.ms ?? '',
      nativeInvokeMs: nativeInvokeOk?.meta?.ms ?? '',
      nativeReadMs: timing(nativeInvokeOk?.meta, 'readMs') || '',
      nativePngEncodeMs: timing(nativeInvokeOk?.meta, 'pngEncodeMs') || '',
      blobReadMs: blobReadOk?.meta?.ms ?? '',
      blobSize: blobEvent?.meta?.blobSize ?? blobReadOk?.meta?.blobSize ?? '',
      dataUrlLen: blobReadOk?.meta?.dataUrlLen ?? '',
      readyStage: readyEnd?.meta?.readyStage || end?.meta?.readyStage || '',
      cacheTotalMs: readyEnd?.meta?.cacheTotalMs ?? '',
      cacheQueueWaitMs: readyEnd?.meta?.cacheQueueWaitMs ?? '',
      cacheBitmapMs: readyEnd?.meta?.cacheBitmapMs ?? '',
      displayReady: end?.meta?.displayReady ?? (webInsertEnd ? true : ''),
      bitmapReady: end?.meta?.bitmapReady ?? '',
      added: end?.meta?.added ?? '',
      objectDelta: webInsertEnd?.meta?.objectDelta ?? '',
      firstPayloadStep: first('event-image-blob')?.step || first('browser-image-blob')?.step || (nativeInvokeOk ? 'native-image-read' : ''),
      verdict: end?.meta?.added || webInsertEnd?.meta?.added
        ? 'paste produced a drawable object'
        : 'paste did not add an image; inspect rows',
    };
    console.table([out]);
    return { summary: out, rows: run.map(e => debugRow(e, { includeId: true, includeSkipped: true })) };
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
      objectCountBefore: pasteEnd?.meta?.objectCountBefore ?? '',
      objectCountAfter: pasteEnd?.meta?.objectCountAfter ?? '',
      error: last?.meta?.error || '',
    };
    console.table([out]);
    return out;
  }

  function reset() { core.reset(); }
  const clear = reset;


  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    invoke,
    wrap,
    dump,
    summary,
    phaseSummary,
    copyBreakdown,
    largePasteReport,
    pasteBreakdown,
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
  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish history]',
    sanitize,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish history debugger enabled. Use finishDebug({ history: ["pushes", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish history debugger disabled.');
  }
  const setVerbose = core.setVerbose;
  const start = core.start;
  const step = core.step;
  const end = core.end;

  function count(key, amount = 1) {
    if (!core.enabled) return;
    if (!Object.hasOwn(stats, key)) stats[key] = 0;
    stats[key] += amount;
  }

  function max(key, value) {
    if (!core.enabled) return;
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
    core.reset();
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
    frameCount: 0,
    frameTotalMs: 0,
    frameQueueTotalMs: 0,
    inputFrameCount: 0,
    inputAgeTotalMs: 0,
    scheduledFrames: 0,
    coalescedFrames: 0,
    transformFrames: 0,
    boardFrames: 0,
    overlayFrames: 0,
    selectionOverlaySkipped: 0,
    slowFrames: 0,
    maxFrameMs: 0,
    maxQueueMs: 0,
    maxInputAgeMs: 0,
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
    console.info('Boardfish viewport debugger enabled. Use finishDebug({ viewport: ["report", "summary", "frameSummary", "wheelSummary", "drawSummary", "slowFrames", "imageHealth", "dump"] }) to collect results.');
  }

  function disable() {
    enabled = false;
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish viewport debugger disabled.');
  }

  function setVerbose(value) {
    if (!DEBUG_TOOLS_ENABLED) return;
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

  function frameStart(queueMs, extra = {}) {
    if (!enabled) return null;
    const now = performance.now();
    const rafGap = lastRafAt ? now - lastRafAt : 0;
    lastRafAt = now;
    const inputAgeMs = Number(extra.inputAgeMs) || 0;
    stats.lastRafGapMs = rafGap;
    stats.maxRafGapMs = Math.max(stats.maxRafGapMs, rafGap);
    stats.maxQueueMs = Math.max(stats.maxQueueMs, queueMs || 0);
    stats.maxInputAgeMs = Math.max(stats.maxInputAgeMs, inputAgeMs);
    const meta = { queueMs, rafGap, inputAgeMs, inputSource: extra.inputSource || '', panX, panY, zoom };
    const ctx = start('frame', meta);
    if (ctx) ctx.startMeta = meta;
    return ctx;
  }

  function frameEnd(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    const total = performance.now() - ctx.t0;
    const startMeta = ctx.startMeta || {};
    const queueMs = Number(startMeta.queueMs) || 0;
    const inputAgeMs = Number(startMeta.inputAgeMs) || 0;
    const hasInput = !!startMeta.inputSource || inputAgeMs > 0;
    stats.frameCount++;
    stats.frameTotalMs += total;
    stats.frameQueueTotalMs += queueMs;
    if (hasInput) {
      stats.inputFrameCount++;
      stats.inputAgeTotalMs += inputAgeMs;
    }
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
      { metric: 'imageScalingSupported', value: VIEWPORT_IMAGE_SCALING_SUPPORTED },
      { metric: 'imageScalingEnabled', value: viewportImageScalingEnabled },
      { metric: 'imageScaleLevels', value: IMAGE_SCALE_LEVELS.join(',') },
      { metric: 'wheelPan', value: stats.wheelPan },
      { metric: 'wheelZoom', value: stats.wheelZoom },
      { metric: 'mousePanMoves', value: stats.mousePanMoves },
      { metric: 'frames', value: stats.frameCount },
      { metric: 'inputFrames', value: stats.inputFrameCount },
      { metric: 'scheduledFrames', value: stats.scheduledFrames },
      { metric: 'coalescedFrames', value: stats.coalescedFrames },
      { metric: 'transformFrames', value: stats.transformFrames },
      { metric: 'boardFrames', value: stats.boardFrames },
      { metric: 'overlayFrames', value: stats.overlayFrames },
      { metric: 'selectionOverlaySkipped', value: stats.selectionOverlaySkipped },
      { metric: 'slowFramesOver16ms', value: stats.slowFrames },
      { metric: 'maxFrameMs', value: Math.round(stats.maxFrameMs * 100) / 100 },
      { metric: 'maxQueueMs', value: Math.round(stats.maxQueueMs * 100) / 100 },
      { metric: 'maxInputAgeMs', value: Math.round(stats.maxInputAgeMs * 100) / 100 },
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
    const inputFrames = frames.filter(row => row.inputSource || Number(row.inputAgeMs) > 0);
    const max = (field) => frames.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const out = {
      frames: stats.frameCount,
      recentFrames: frames.length,
      inputFrames: stats.inputFrameCount,
      recentInputFrames: inputFrames.length,
      slowFramesOver16ms: stats.slowFrames,
      recentSlowFramesOver16ms: frames.filter(row => row.slow).length,
      avgFrameMs: stats.frameCount ? Math.round(stats.frameTotalMs / stats.frameCount * 100) / 100 : 0,
      maxFrameMs: Math.round(stats.maxFrameMs * 100) / 100,
      recentMaxFrameMs: Math.round(max('frameMs') * 100) / 100,
      avgQueueMs: stats.frameCount ? Math.round(stats.frameQueueTotalMs / stats.frameCount * 100) / 100 : 0,
      maxQueueMs: Math.round(stats.maxQueueMs * 100) / 100,
      avgInputAgeMs: stats.inputFrameCount ? Math.round(stats.inputAgeTotalMs / stats.inputFrameCount * 100) / 100 : 0,
      maxInputAgeMs: Math.round(stats.maxInputAgeMs * 100) / 100,
      recentMaxInputAgeMs: Math.round(max('inputAgeMs') * 100) / 100,
      maxRafGapMs: Math.round(stats.maxRafGapMs * 100) / 100,
      recentMaxRafGapMs: Math.round(max('rafGap') * 100) / 100,
      transformFrames: stats.transformFrames,
      boardFrames: stats.boardFrames,
      overlayFrames: stats.overlayFrames,
    };
    console.table([out]);
    return out;
  }

  function wheelRows() {
    const starts = new Map();
    for (const e of events) {
      if (e.op === 'wheel' && e.step === 'start') starts.set(e.id, { at: e.at, ...(e.meta || {}) });
    }
    return events
      .filter(e => e.op === 'wheel' && e.step === 'end')
      .map(e => ({ ...(starts.get(e.id) || {}), endAt: e.at, ...(e.meta || {}) }))
      .filter(row => row.at != null);
  }

  function wheelSummary() {
    const rows = wheelRows();
    const zoomRows = rows.filter(row => row.mode === 'zoom');
    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push(rows[i].at - rows[i - 1].at);
    const sum = (values) => values.reduce((n, value) => n + (Number(value) || 0), 0);
    const max = (values) => values.reduce((n, value) => Math.max(n, Number(value) || 0), 0);
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const absDeltaY = rows.map(row => Math.abs(Number(row.deltaY) || 0));
    const zoomStepPct = zoomRows.map(row => {
      const before = Number(row.zoom) || 0;
      const after = Number(row.newZoom) || 0;
      return before && after ? Math.abs((after / before) - 1) * 100 : 0;
    });
    let directionChanges = 0;
    let lastDir = 0;
    for (const row of zoomRows) {
      const dy = Number(row.deltaY) || 0;
      const dir = dy === 0 ? 0 : dy > 0 ? 1 : -1;
      if (dir && lastDir && dir !== lastDir) directionChanges++;
      if (dir) lastDir = dir;
    }
    const out = {
      bufferedWheelEvents: rows.length,
      zoomEvents: zoomRows.length,
      panEvents: rows.filter(row => row.mode === 'pan').length,
      avgWheelGapMs: gaps.length ? round(sum(gaps) / gaps.length) : 0,
      maxWheelGapMs: round(max(gaps)),
      gapsOver16ms: gaps.filter(gap => gap > 16.7).length,
      gapsOver32ms: gaps.filter(gap => gap > 32).length,
      gapsOver80ms: gaps.filter(gap => gap > 80).length,
      avgAbsDeltaY: absDeltaY.length ? round(sum(absDeltaY) / absDeltaY.length) : 0,
      maxAbsDeltaY: round(max(absDeltaY)),
      avgZoomStepPct: zoomStepPct.length ? round(sum(zoomStepPct) / zoomStepPct.length) : 0,
      maxZoomStepPct: round(max(zoomStepPct)),
      directionChanges,
      firstAt: rows[0]?.at ?? '',
      lastAt: rows[rows.length - 1]?.at ?? '',
    };
    console.table([out]);
    return out;
  }

  function wheelTimeline(limit = 80) {
    const rows = wheelRows();
    const start = Math.max(0, rows.length - Math.max(1, Number(limit) || 80));
    const recent = rows.slice(start).map((row, idx, list) => ({
      at: row.at,
      gapMs: idx ? Math.round((row.at - list[idx - 1].at) * 100) / 100 : '',
      mode: row.mode || '',
      deltaX: row.deltaX ?? '',
      deltaY: row.deltaY ?? '',
      ctrl: !!row.ctrlKey,
      meta: !!row.metaKey,
      zoom: row.zoom ?? '',
      newZoom: row.newZoom ?? '',
    }));
    console.table(recent);
    return recent;
  }

  function drawSummary() {
    const draws = events
      .filter(e => e.op === 'drawBoard' && e.step === 'end' && !e.meta?.skipped)
      .map(e => ({ ms: e.total, ...(e.meta || {}) }));
    const retainedSlowDraws = slowRecords
      .map(e => ({
        frameMs: e.frameMs,
        drawMs: e.steps?.drawBoard?.ms ?? e.steps?.drawBoard?.meta?.totalMeasuredMs ?? 0,
        objectLoopMs: e.steps?.drawBoard?.meta?.objectLoopMs ?? 0,
        croppedImages: e.steps?.drawBoard?.meta?.croppedImages ?? 0,
      }))
      .filter(row => Number(row.drawMs) > 0);
    const sum = (field) => draws.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => draws.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const slowMax = (field) => retainedSlowDraws.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const recentMaxDrawMs = Math.round(max('ms') * 100) / 100;
    const retainedMaxSlowDrawMs = Math.round(slowMax('drawMs') * 100) / 100;
    const recentMaxObjectLoopMs = Math.round(max('objectLoopMs') * 100) / 100;
    const retainedMaxSlowObjectLoopMs = Math.round(slowMax('objectLoopMs') * 100) / 100;
    const out = {
      draws: draws.length,
      retainedSlowDraws: retainedSlowDraws.length,
      avgDrawMs: draws.length ? Math.round(sum('ms') / draws.length * 100) / 100 : 0,
      maxDrawMs: Math.max(recentMaxDrawMs, retainedMaxSlowDrawMs),
      recentMaxDrawMs,
      retainedMaxSlowDrawMs,
      avgDrawnImages: draws.length ? Math.round(sum('drawnImages') / draws.length * 100) / 100 : 0,
      maxDrawnImages: max('drawnImages'),
      avgTestedObjects: draws.length ? Math.round(sum('testedObjects') / draws.length * 100) / 100 : 0,
      maxTestedObjects: max('testedObjects'),
      avgVisibleObjects: draws.length ? Math.round(sum('visibleObjects') / draws.length * 100) / 100 : 0,
      maxVisibleObjects: max('visibleObjects'),
      avgObjectLoopMs: draws.length ? Math.round(sum('objectLoopMs') / draws.length * 100) / 100 : 0,
      maxObjectLoopMs: Math.max(recentMaxObjectLoopMs, retainedMaxSlowObjectLoopMs),
      recentMaxObjectLoopMs,
      retainedMaxSlowObjectLoopMs,
      avgBackgroundSetupMs: draws.length ? Math.round(sum('backgroundSetupMs') / draws.length * 100) / 100 : 0,
      maxBackgroundSetupMs: Math.round(max('backgroundSetupMs') * 100) / 100,
      avgOffscreenBlitMs: draws.length ? Math.round(sum('offscreenBlitMs') / draws.length * 100) / 100 : 0,
      maxOffscreenBlitMs: Math.round(max('offscreenBlitMs') * 100) / 100,
      avgEditingOverlayMs: draws.length ? Math.round(sum('editingOverlayMs') / draws.length * 100) / 100 : 0,
      maxEditingOverlayMs: Math.round(max('editingOverlayMs') * 100) / 100,
      avgCulledImages: draws.length ? Math.round(sum('culledImages') / draws.length * 100) / 100 : 0,
      maxCulledImages: max('culledImages'),
      avgBitmapImages: draws.length ? Math.round(sum('bitmapImages') / draws.length * 100) / 100 : 0,
      avgElementImages: draws.length ? Math.round(sum('elementImages') / draws.length * 100) / 100 : 0,
      avgScaledImages: draws.length ? Math.round(sum('scaledImages') / draws.length * 100) / 100 : 0,
      maxScaledImages: max('scaledImages'),
      avgScaledFallbackFull: draws.length ? Math.round(sum('scaledFallbackFull') / draws.length * 100) / 100 : 0,
      avgScaledVariantPendingImages: draws.length ? Math.round(sum('scaledVariantPendingImages') / draws.length * 100) / 100 : 0,
      maxScaledVariantPendingImages: max('scaledVariantPendingImages'),
      avgEyedropperWarmedScaledImages: draws.length ? Math.round(sum('eyedropperWarmedScaledImages') / draws.length * 100) / 100 : 0,
      maxEyedropperWarmedScaledImages: max('eyedropperWarmedScaledImages'),
      avgScaledImageScale: sum('scaledImages') ? Math.round(sum('scaledImageScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgTargetImageScale: sum('scaledImages') ? Math.round(sum('scaledImageTargetScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgMissingImages: draws.length ? Math.round(sum('missingImages') / draws.length * 100) / 100 : 0,
      maxMissingImages: max('missingImages'),
      avgErroredImages: draws.length ? Math.round(sum('erroredImages') / draws.length * 100) / 100 : 0,
      avgCroppedImages: draws.length ? Math.round(sum('croppedImages') / draws.length * 100) / 100 : 0,
      maxRetainedSlowCroppedImages: slowMax('croppedImages'),
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
      activeInputQueueDelayMs: IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS,
      builds: imageScaledVariantBuildCount,
      avgBuildMs: imageScaledVariantBuildCount ? Math.round(imageScaledVariantBuildTotalMs / imageScaledVariantBuildCount * 10) / 10 : 0,
      maxBuildMs: Math.round(imageScaledVariantBuildMaxMs * 10) / 10,
      resizeBitmapBuilds: imageScaledVariantResizeBitmapCount,
      canvasFallbackBuilds: imageScaledVariantCanvasFallbackCount,
      evictions: imageScaledVariantEvictionCount,
      memorySkips: imageScaledVariantMemorySkipCount,
      prewarmRuns: imageScaledVariantPrewarmRunCount,
      prewarmCandidates: imageScaledVariantPrewarmCandidateCount,
      prewarmReady: imageScaledVariantPrewarmReadyCount,
      prewarmQueued: imageScaledVariantPrewarmQueuedCount,
      prewarmNoSource: imageScaledVariantPrewarmNoSourceCount,
      prewarmPending: !!imageScaledVariantPrewarmTimer,
      prewarmPadPx: IMAGE_VARIANT_PREWARM_PAD_PX,
      levels: IMAGE_SCALE_LEVELS.join(','),
      supported: VIEWPORT_IMAGE_SCALING_SUPPORTED,
      enabled: viewportImageScalingEnabled,
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
          const scalingActive = typeof isViewportImageScalingActive === 'function'
            ? isViewportImageScalingActive()
            : viewportImageScalingEnabled;
          const targetScale = scalingActive && fullSource ? chooseImageScaleForDraw(obj, fullSource) : 1;
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
        inputAgeMs: e.inputAgeMs ?? '',
        inputSource: e.inputSource ?? '',
        rafGap: e.rafGap ?? '',
        sources: e.sources ?? '',
        doTransform: e.doTransform ?? '',
        doBoard: e.doBoard ?? '',
        doOverlay: e.doOverlay ?? '',
        applyTransformCallMs: e.steps?.applyTransformCall?.ms ?? '',
        drawBoardMs: e.steps?.drawBoard?.ms ?? '',
        objectLoopMs: e.steps?.drawBoard?.meta?.objectLoopMs ?? '',
        backgroundSetupMs: e.steps?.drawBoard?.meta?.backgroundSetupMs ?? '',
        offscreenBlitMs: e.steps?.drawBoard?.meta?.offscreenBlitMs ?? '',
        editingOverlayMs: e.steps?.drawBoard?.meta?.editingOverlayMs ?? '',
        testedObjects: e.steps?.drawBoard?.meta?.testedObjects ?? '',
        visibleObjects: e.steps?.drawBoard?.meta?.visibleObjects ?? '',
        drawnImages: e.steps?.drawBoard?.meta?.drawnImages ?? '',
        drawnText: e.steps?.drawBoard?.meta?.drawnText ?? '',
        bitmapImages: e.steps?.drawBoard?.meta?.bitmapImages ?? '',
        elementImages: e.steps?.drawBoard?.meta?.elementImages ?? '',
        scaledImages: e.steps?.drawBoard?.meta?.scaledImages ?? '',
        scaledFallbackFull: e.steps?.drawBoard?.meta?.scaledFallbackFull ?? '',
        scaledVariantPendingImages: e.steps?.drawBoard?.meta?.scaledVariantPendingImages ?? '',
        eyedropperWarmedScaledImages: e.steps?.drawBoard?.meta?.eyedropperWarmedScaledImages ?? '',
        fullScaleImages: e.steps?.drawBoard?.meta?.fullScaleImages ?? '',
        missingImages: e.steps?.drawBoard?.meta?.missingImages ?? '',
        croppedImages: e.steps?.drawBoard?.meta?.croppedImages ?? '',
        culledImages: e.steps?.drawBoard?.meta?.culledImages ?? '',
        culledText: e.steps?.drawBoard?.meta?.culledText ?? '',
        canvasW: e.steps?.drawBoard?.meta?.canvasW ?? '',
        canvasH: e.steps?.drawBoard?.meta?.canvasH ?? '',
        zoom: e.steps?.drawBoard?.meta?.zoom ?? e.zoom ?? '',
        updateSelectionOverlayMs: e.steps?.updateSelectionOverlay?.ms ?? '',
      }))
      .sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function slowFrameDetails(limit = 5) {
    const rows = slowRecords
      .slice()
      .sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0))
      .slice(0, limit)
      .map(e => ({
        id: e.id,
        frameMs: e.frameMs ?? '',
        queueMs: e.queueMs ?? '',
        inputAgeMs: e.inputAgeMs ?? '',
        inputSource: e.inputSource ?? '',
        rafGap: e.rafGap ?? '',
        sources: e.sources ?? '',
        start: {
          panX: e.panX,
          panY: e.panY,
          zoom: e.zoom,
        },
        flags: {
          doTransform: e.doTransform,
          doBoard: e.doBoard,
          doOverlay: e.doOverlay,
        },
        steps: Object.fromEntries(Object.entries(e.steps || {}).map(([name, step]) => ([
          name,
          {
            ms: Math.round((step.ms || 0) * 100) / 100,
            total: Math.round((step.total || 0) * 100) / 100,
            meta: step.meta || {},
          },
        ]))),
      }));
    console.log(rows);
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
      avgSaveViewportMs: rows.length ? Math.round(sum('saveViewport') / rows.length * 100) / 100 : 0,
      maxSaveViewportMs: Math.round(max('saveViewport') * 100) / 100,
      avgOverlayMs: rows.length ? Math.round(sum('updateSelectionOverlay') / rows.length * 100) / 100 : 0,
      maxOverlayMs: Math.round(max('updateSelectionOverlay') * 100) / 100,
    };
    console.table([out]);
    return out;
  }

  function report(options = {}) {
    const out = {
      summary: summary(),
      frameSummary: frameSummary(),
      wheelSummary: wheelSummary(),
      drawSummary: drawSummary(),
      transformSummary: transformSummary(),
      slowFrames: slowFrames(options.slowFrames ?? options.limit ?? 20),
      imageScaleCache: imageScaleCacheSummary(),
      culling: cullingSummary(),
    };
    if (options.details !== false) out.slowFrameDetails = slowFrameDetails(options.detailLimit ?? 3);
    if (options.log !== false) console.log(out);
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
    report,
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
    wheelSummary,
    wheelTimeline,
    slowFrames,
    slowFrameDetails,
    dump,
    reset,
    isEnabled: () => enabled,
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
  };
})();

exposeDebug({ viewport: ViewportDebug });

// ─── Manual performance debugger ─────────────────────────────────────────────

// ─── Save debugger ───────────────────────────────────────────────────────────

// ─── Open debugger ───────────────────────────────────────────────────────────

// ─── Export debugger ─────────────────────────────────────────────────────────
