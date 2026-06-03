'use strict';

var ManualPerfDebug = (() => {
  let lastReport = null;
  let lastJson = '';
  let sessionStartMemory = null;
  const markers = [];

  function boardObjects() {
    return typeof objects === 'undefined' ? [] : objects;
  }

  function imageCount() {
    return boardObjects().filter(obj => obj?.type === 'image').length;
  }

  function round(value, places = 2) {
    const factor = 10 ** places;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function mb(bytes) {
    return round((Number(bytes) || 0) / 1024 / 1024);
  }

  function estimateDataUrlBytes(value) {
    if (typeof value !== 'string') return 0;
    const comma = value.indexOf(',');
    if (comma < 0) return value.length;
    const header = value.slice(0, comma).toLowerCase();
    const payload = value.slice(comma + 1);
    if (!header.includes(';base64')) return payload.length;
    const compact = payload.replace(/\s+/g, '');
    const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
  }

  function sourceKind(source) {
    if (typeof source === 'string') return source.startsWith('data:') ? 'data-url' : 'string';
    if (typeof isWebImageRef === 'function' && isWebImageRef(source)) return 'web-ref';
    if (source && typeof source === 'object') return 'object-ref';
    return 'missing';
  }

  function sourceApproxBytes(source) {
    if (typeof source === 'string') return estimateDataUrlBytes(source);
    if (!source || typeof source !== 'object') return 0;
    return Number(source.bytes ?? source.size ?? source.fileSize ?? 0) || 0;
  }

  function drawableRgbaBytes(source) {
    const width = Number(source?.width || source?.naturalWidth || 0);
    const height = Number(source?.height || source?.naturalHeight || 0);
    return width > 0 && height > 0 ? width * height * 4 : 0;
  }

  function safeObjectKeys(value) {
    return value && typeof value === 'object' ? Object.keys(value) : [];
  }

  function boardImageMemorySummary(options = {}) {
    const store = typeof imageStore === 'undefined' ? {} : imageStore;
    const imgCache = typeof imageCache === 'undefined' ? {} : imageCache;
    const metadataCache = typeof imageMetadataCache === 'undefined' ? {} : imageMetadataCache;
    const bitmapCache = typeof imageBitmapCache === 'undefined' ? {} : imageBitmapCache;
    const keys = new Set([
      ...safeObjectKeys(store),
      ...safeObjectKeys(imgCache),
      ...safeObjectKeys(metadataCache),
      ...safeObjectKeys(bitmapCache),
    ]);
    const rows = [];
    let sourceBytes = 0;
    let imageElementBytes = 0;
    let bitmapBytes = 0;
    let loadedImageElements = 0;
    let bitmapCount = 0;
    let dataUrls = 0;

    for (const key of keys) {
      const source = store[key];
      const image = imgCache[key];
      const metadata = metadataCache[key];
      const bitmap = bitmapCache[key];
      const sourceBytesForKey = sourceApproxBytes(source);
      const imageElementBytesForKey = drawableRgbaBytes(image);
      const bitmapBytesForKey = drawableRgbaBytes(bitmap);
      const kind = sourceKind(source);
      sourceBytes += sourceBytesForKey;
      imageElementBytes += imageElementBytesForKey;
      bitmapBytes += bitmapBytesForKey;
      if (imageElementBytesForKey > 0) loadedImageElements++;
      if (bitmapBytesForKey > 0) bitmapCount++;
      if (kind === 'data-url') dataUrls++;
      rows.push({
        key,
        kind,
        sourceMB: mb(sourceBytesForKey),
        imageElementMB: mb(imageElementBytesForKey),
        bitmapMB: mb(bitmapBytesForKey),
        totalEstimateMB: mb(sourceBytesForKey + imageElementBytesForKey + bitmapBytesForKey),
        imageW: image?.naturalWidth || image?.width || metadata?.naturalWidth || metadata?.width || 0,
        imageH: image?.naturalHeight || image?.height || metadata?.naturalHeight || metadata?.height || 0,
        bitmapW: bitmap?.width || 0,
        bitmapH: bitmap?.height || 0,
      });
    }

    rows.sort((a, b) => b.totalEstimateMB - a.totalEstimateMB || b.sourceMB - a.sourceMB);
    const rowLimit = Math.max(0, Math.min(200, Number(options.rowLimit ?? options.limit ?? 20)));
    const out = {
      imageObjectCount: imageCount(),
      imageStoreKeys: safeObjectKeys(store).length,
      cacheKeys: keys.size,
      dataUrls,
      loadedImageElements,
      bitmapCount,
      sourceMB: mb(sourceBytes),
      imageElementDecodedEstimateMB: mb(imageElementBytes),
      bitmapEstimateMB: mb(bitmapBytes),
      displayDecodedEstimateMB: mb(imageElementBytes + bitmapBytes),
      totalLogicalEstimateMB: mb(sourceBytes + imageElementBytes + bitmapBytes),
      topImages: rows.slice(0, rowLimit),
    };
    if (options.table !== false) {
      console.table([{
        imageStoreKeys: out.imageStoreKeys,
        sourceMB: out.sourceMB,
        imageElementDecodedEstimateMB: out.imageElementDecodedEstimateMB,
        bitmapEstimateMB: out.bitmapEstimateMB,
        totalLogicalEstimateMB: out.totalLogicalEstimateMB,
      }]);
      if (out.topImages.length) console.table(out.topImages);
    }
    return out;
  }

  function jsHeapSnapshot() {
    const memory = performance?.memory;
    if (!memory) return { available: false, reason: 'performance.memory unavailable in this runtime' };
    return {
      available: true,
      usedJSHeapMB: mb(memory.usedJSHeapSize),
      totalJSHeapMB: mb(memory.totalJSHeapSize),
      jsHeapLimitMB: mb(memory.jsHeapSizeLimit),
    };
  }

  function diffMB(after, before) {
    const a = Number(after);
    const b = Number(before);
    return Number.isFinite(a) && Number.isFinite(b) ? round(a - b) : '';
  }

  function memoryDelta(start, end) {
    if (!start || !end) return null;
    return {
      jsHeapUsedDeltaMB: diffMB(end.jsHeap?.usedJSHeapMB, start.jsHeap?.usedJSHeapMB),
      viewportScaleDeltaMB: diffMB(end.viewportScaleCache?.cacheMB, start.viewportScaleCache?.cacheMB),
      boardSourceDeltaMB: diffMB(end.boardImages?.sourceMB, start.boardImages?.sourceMB),
      displayDecodedEstimateDeltaMB: diffMB(end.boardImages?.displayDecodedEstimateMB, start.boardImages?.displayDecodedEstimateMB),
    };
  }

  function memoryHeadline(snapshot = {}) {
    return {
      imageStoreKeys: snapshot.boardImages?.imageStoreKeys ?? '',
      boardSourceMB: snapshot.boardImages?.sourceMB ?? '',
      displayDecodedEstimateMB: snapshot.boardImages?.displayDecodedEstimateMB ?? '',
      jsHeapUsedMB: snapshot.jsHeap?.usedJSHeapMB ?? '',
      viewportScaleCacheMB: snapshot.viewportScaleCache?.cacheMB ?? '',
      viewportScaleVariants: snapshot.viewportScaleCache?.variants ?? '',
    };
  }

  async function memorySnapshot(label = 'memory', options = {}) {
    const viewportScaleCache = BoardfishDebug.viewport?.imageScaleCacheSummary
      ? BoardfishDebug.viewport.imageScaleCacheSummary({ table: false })
      : null;
    const out = {
      label,
      at: new Date().toISOString(),
      t: round(performance.now()),
      objectCount: boardObjects().length,
      imageCount: imageCount(),
      textCount: boardObjects().filter(obj => obj?.type === 'text').length,
      zoom: typeof zoom !== 'undefined' ? round(zoom, 4) : '',
      panX: typeof panX !== 'undefined' ? round(panX) : '',
      panY: typeof panY !== 'undefined' ? round(panY) : '',
      jsHeap: jsHeapSnapshot(),
      boardImages: boardImageMemorySummary({ ...options, table: false }),
      viewportScaleCache,
      viewportPerfMode: BoardfishDebug.viewport?.perfMode ? BoardfishDebug.viewport.perfMode() : null,
    };
    out.headline = memoryHeadline(out);
    if (options.table !== false) {
      console.group(`[Boardfish perf] memory ${label}`);
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function headline(report) {
    const viewport = report.viewport || {};
    const memory = report.memoryEnd || report.memory || {};
    const mem = memoryHeadline(memory);
    return {
      imageCount: report.imageCount,
      boardSourceMB: mem.boardSourceMB,
      viewportScaleCacheMB: mem.viewportScaleCacheMB,
      jsHeapUsedMB: mem.jsHeapUsedMB,
      viewportFrames: viewport.frameSummary?.frames ?? '',
      viewportSlowFrames: viewport.frameSummary?.slowFramesOver16ms ?? '',
      viewportMaxFrameMs: viewport.frameSummary?.maxFrameMs ?? '',
      wheelBufferedEvents: viewport.wheelSummary?.bufferedWheelEvents ?? '',
      wheelMaxGapMs: viewport.wheelSummary?.maxWheelGapMs ?? '',
      wheelGapsOver32ms: viewport.wheelSummary?.gapsOver32ms ?? '',
      maxZoomStepPct: viewport.wheelSummary?.maxZoomStepPct ?? '',
      viewportMaxDrawMs: viewport.drawSummary?.maxDrawMs ?? '',
      viewportMaxTestedObjects: viewport.drawSummary?.maxTestedObjects ?? '',
    };
  }

  async function begin(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    BoardfishDebug.viewport.enable({
      verbose: false,
      rawInput: options.rawInput !== false,
      eventLoopGapThresholdMs: options.eventLoopGapThresholdMs,
    });
    BoardfishDebug.viewport.reset();
    markers.length = 0;
    sessionStartMemory = options.memory === false ? null : await memorySnapshot('begin', { ...options, table: false });
    const out = {
      startedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: boardObjects().length,
      rawInput: options.rawInput !== false,
      memoryStart: sessionStartMemory,
    };
    console.info('[Boardfish perf] Manual session started. Run the interaction, then call finishDebug({ perf: ["benchmarkReport"] }) or finishDebug({ perf: ["memoryReport"] }).');
    console.table([{ ...out, memoryStart: sessionStartMemory ? 'captured' : 'disabled' }]);
    return out;
  }

  function mark(label = 'marker') {
    const entry = {
      label,
      at: Math.round(performance.now() * 100) / 100,
      viewportStats: BoardfishDebug.viewport.stats,
    };
    markers.push(entry);
    console.info(`[Boardfish perf] marker: ${label}`);
    console.table([{
      label: entry.label,
      at: entry.at,
      wheel: entry.viewportStats.wheel,
      wheelZoom: entry.viewportStats.wheelZoom,
      transformFrames: entry.viewportStats.transformFrames,
    }]);
    return entry;
  }

  function resetPhase(label = 'phase') {
    BoardfishDebug.viewport.reset();
    markers.length = 0;
    return mark(label);
  }

  function state() {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    return {
      viewport: BoardfishDebug.viewport.perfMode(),
    };
  }

  function report(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const out = {
      label: 'manual-viewport-perf',
      reportedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: boardObjects().length,
      viewport: BoardfishDebug.viewport.report({ log: false, details: options.details === true, limit: options.limit || 12 }),
      markers: markers.slice(),
    };
    out.headline = headline(out);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    console.group('[Boardfish perf] manual viewport');
    console.table([out.headline]);
    console.log(out);
    console.groupEnd();
    if (options.copy !== false) void copyLast();
    return out;
  }

  function json() {
    if (!lastReport) {
      console.warn('[Boardfish perf] No report yet. Run finishDebug({ perf: ["report"] }) first.');
      return '';
    }
    lastJson = JSON.stringify(lastReport, null, 2);
    console.log(lastJson);
    return lastJson;
  }

  async function copyLast() {
    if (!lastReport) {
      console.warn('[Boardfish perf] No report yet. Run finishDebug({ perf: ["report"] }) first.');
      return false;
    }
    const text = json();
    try {
      await navigator.clipboard.writeText(text);
      console.info(`[Boardfish perf] Copied ${text.length} chars to clipboard.`);
      return true;
    } catch (err) {
      console.warn('[Boardfish perf] Clipboard copy failed. JSON was printed above and finishDebug() will include perf.lastJson.', err);
      return text;
    }
  }

  async function memoryReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const memory = await memorySnapshot(options.label || 'memory-report', options);
    const out = {
      label: options.label || 'manual-memory-report',
      reportedAt: new Date().toISOString(),
      memoryStart: sessionStartMemory,
      memoryEnd: memory,
      memoryDelta: memoryDelta(sessionStartMemory, memory),
    };
    out.headline = {
      ...memory.headline,
      ...(out.memoryDelta || {}),
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] memory report');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    if (options.copy === true) void copyLast();
    return out;
  }

  async function benchmarkReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const memoryEnd = await memorySnapshot('finish', { ...options, table: false });
    const viewport = BoardfishDebug.viewport.report({
      log: false,
      details: options.details === true,
      limit: options.limit || 30,
      eventLoopLimit: options.eventLoopLimit ?? 120,
      rawInputLimit: options.rawInputLimit ?? 180,
      slowFrames: options.slowFrames ?? 40,
    });
    const out = {
      label: options.label || 'current-pan-zoom-benchmark',
      reportedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: boardObjects().length,
      viewport,
      memoryStart: sessionStartMemory,
      memoryEnd,
      memoryDelta: memoryDelta(sessionStartMemory, memoryEnd),
      markers: markers.slice(),
    };
    out.headline = {
      ...headline(out),
      ...(out.memoryDelta || {}),
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] current pan/zoom benchmark');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    if (options.copy !== false) void copyLast();
    return out;
  }

  function animationFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function viewportNavigationHeadline(viewportReport = {}) {
    const frame = viewportReport.frameSummary || {};
    const wheel = viewportReport.wheelSummary || {};
    const draw = viewportReport.drawSummary || {};
    const transform = viewportReport.transformSummary || {};
    return {
      frames: frame.frames ?? '',
      inputFrames: frame.inputFrames ?? '',
      transformFrames: frame.transformFrames ?? '',
      slowFramesOver16ms: frame.slowFramesOver16ms ?? '',
      maxFrameMs: frame.maxFrameMs ?? '',
      avgInputAgeMs: frame.avgInputAgeMs ?? '',
      maxInputAgeMs: frame.maxInputAgeMs ?? '',
      maxQueueMs: frame.maxQueueMs ?? '',
      wheelEvents: wheel.bufferedWheelEvents ?? '',
      wheelPanEvents: wheel.panEvents ?? '',
      wheelZoomEvents: wheel.zoomEvents ?? '',
      maxWheelGapMs: wheel.maxWheelGapMs ?? '',
      avgZoomStepPct: wheel.avgZoomStepPct ?? '',
      maxZoomStepPct: wheel.maxZoomStepPct ?? '',
      avgDrawMs: draw.avgDrawMs ?? '',
      maxDrawMs: draw.maxDrawMs ?? '',
      maxObjectLoopMs: draw.maxObjectLoopMs ?? '',
      avgTransformMs: transform.avgTotalMs ?? '',
      maxTransformMs: transform.maxTotalMs ?? '',
    };
  }

  function panningHeadline(viewportReport = {}) {
    return viewportNavigationHeadline(viewportReport);
  }

  function zoomingHeadline(viewportReport = {}) {
    return viewportNavigationHeadline(viewportReport);
  }

  function panningReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const viewport = BoardfishDebug.viewport.report({
      log: false,
      details: options.details === true,
      limit: options.limit || 20,
    });
    const out = {
      label: options.label || 'viewport-panning-perf',
      reportedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: boardObjects().length,
      viewport,
      markers: markers.slice(),
    };
    out.headline = panningHeadline(viewport);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] viewport panning');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function panningTestPoint(options = {}) {
    const rect = (boardCanvas || canvas)?.getBoundingClientRect?.();
    if (!rect) return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
    return {
      x: Math.round(rect.left + rect.width * (Number.isFinite(options.xRatio) ? options.xRatio : 0.5)),
      y: Math.round(rect.top + rect.height * (Number.isFinite(options.yRatio) ? options.yRatio : 0.5)),
    };
  }

  function dispatchPanWheel(point, deltaX, deltaY, options = {}) {
    const target = boardCanvas || canvas || document.body;
    const EventCtor = window.WheelEvent || MouseEvent;
    target.dispatchEvent(new EventCtor('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      deltaX,
      deltaY,
      deltaMode: options.deltaMode || 0,
      ctrlKey: !!options.ctrlKey,
      metaKey: !!options.metaKey,
    }));
  }

  async function wheelPanTest(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    BoardfishDebug.viewport.enable({ verbose: false });
    BoardfishDebug.viewport.reset();
    markers.length = 0;
    const events = Math.max(1, Math.min(360, Number(options.events) || 90));
    const deltaX = Number.isFinite(options.deltaX) ? options.deltaX : 4;
    const deltaY = Number.isFinite(options.deltaY) ? options.deltaY : 7;
    const point = panningTestPoint(options);
    const startedAt = performance.now();
    await animationFrame();
    for (let index = 0; index < events; index++) {
      const wave = Math.sin(index / Math.max(1, events - 1) * Math.PI * 2);
      dispatchPanWheel(point, deltaX + wave * (Number(options.waveX) || 0), deltaY + wave * (Number(options.waveY) || 0), options);
      if (options.framePerWheel !== false) await animationFrame();
    }
    await animationFrame();
    await animationFrame();
    const out = panningReport({ ...options, label: 'synthetic-wheel-pan', log: false });
    out.events = events;
    out.deltaX = deltaX;
    out.deltaY = deltaY;
    out.elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    out.testPoint = point;
    out.headline = panningHeadline(out.viewport);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] synthetic wheel pan');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function zoomReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const viewport = BoardfishDebug.viewport.report({
      log: false,
      details: options.details === true,
      limit: options.limit || 20,
    });
    const out = {
      label: options.label || 'viewport-zoom-perf',
      reportedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: boardObjects().length,
      zoom,
      panX,
      panY,
      viewport,
      markers: markers.slice(),
    };
    out.headline = zoomingHeadline(viewport);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] viewport zoom');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  async function wheelZoomTest(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    BoardfishDebug.viewport.enable({ verbose: false });
    BoardfishDebug.viewport.reset();
    markers.length = 0;
    const events = Math.max(1, Math.min(360, Number(options.events) || 90));
    const deltaY = Number.isFinite(options.deltaY) ? options.deltaY : -4;
    const point = panningTestPoint(options);
    const startedAt = performance.now();
    await animationFrame();
    for (let index = 0; index < events; index++) {
      const wave = Math.sin(index / Math.max(1, events - 1) * Math.PI * 2);
      dispatchPanWheel(point, 0, deltaY + wave * (Number(options.waveY) || 0), {
        ...options,
        ctrlKey: options.metaKey !== true,
        metaKey: options.metaKey === true,
      });
      if (options.framePerWheel !== false) await animationFrame();
    }
    await animationFrame();
    await animationFrame();
    const out = zoomReport({ ...options, label: 'synthetic-wheel-zoom', log: false });
    out.events = events;
    out.deltaY = deltaY;
    out.elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    out.testPoint = point;
    out.headline = zoomingHeadline(out.viewport);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] synthetic wheel zoom');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function dispatchPanKey(type) {
    document.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: ' ',
      code: 'Space',
      keyCode: 32,
      which: 32,
    }));
  }

  function dispatchPanMouse(type, point, options = {}) {
    const target = type === 'mousedown' ? (boardCanvas || canvas || document.body) : document;
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      shiftKey: !!options.shiftKey,
    }));
  }

  async function mousePanTest(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    BoardfishDebug.viewport.enable({ verbose: false });
    BoardfishDebug.viewport.reset();
    markers.length = 0;
    const moves = Math.max(1, Math.min(360, Number(options.moves) || 90));
    const start = panningTestPoint({
      ...options,
      xRatio: Number.isFinite(options.startXRatio) ? options.startXRatio : 0.35,
      yRatio: Number.isFinite(options.startYRatio) ? options.startYRatio : 0.45,
    });
    const end = panningTestPoint({
      ...options,
      xRatio: Number.isFinite(options.endXRatio) ? options.endXRatio : 0.65,
      yRatio: Number.isFinite(options.endYRatio) ? options.endYRatio : 0.55,
    });
    const startedAt = performance.now();
    dispatchPanKey('keydown');
    dispatchPanMouse('mousedown', start, options);
    await animationFrame();
    for (let index = 0; index < moves; index++) {
      const t = moves <= 1 ? 1 : index / (moves - 1);
      const wave = Math.sin(t * Math.PI * 2) * (Number(options.waveCss) || 18);
      const point = {
        x: Math.round(start.x + (end.x - start.x) * t),
        y: Math.round(start.y + (end.y - start.y) * t + wave),
      };
      dispatchPanMouse('mousemove', point, options);
      if (options.framePerMove !== false) await animationFrame();
    }
    dispatchPanMouse('mouseup', end, options);
    dispatchPanKey('keyup');
    await animationFrame();
    await animationFrame();
    const out = panningReport({ ...options, label: 'synthetic-mouse-pan', log: false });
    out.moves = moves;
    out.elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    out.start = start;
    out.end = end;
    out.headline = panningHeadline(out.viewport);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] synthetic mouse pan');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  return {
    begin,
    mark,
    resetPhase,
    report,
    benchmarkReport,
    memorySnapshot,
    memoryReport,
    boardImageMemorySummary,
    panningReport,
    wheelPanTest,
    mousePanTest,
    zoomReport,
    wheelZoomTest,
    state,
    json,
    copyLast,
    get last() { return lastReport; },
    get lastJson() { return lastJson; },
  };
})();

exposeDebug({ perf: ManualPerfDebug });
