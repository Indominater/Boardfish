'use strict';

var ManualPerfDebug = (() => {
  let lastReport = null;
  let lastJson = '';
  let sessionStartMemory = null;
  let largeTextSession = null;
  let nextLargeTextSessionId = 1;
  let textEditMathSession = null;
  let nextTextEditMathSessionId = 1;
  let textEditMathEventsActive = false;
  let textEditMathLastEventAt = 0;
  const markers = [];
  const textEditMathEvents = [];
  const TEXT_EDIT_MATH_MAX_EVENTS = 5000;
  const TEXT_EDIT_MATH_EVENT_TYPES = [
    'wheel',
    'pointerdown',
    'pointermove',
    'pointerup',
    'mousedown',
    'mousemove',
    'mouseup',
    'keydown',
    'keyup',
    'beforeinput',
    'input',
    'paste',
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'selectionchange',
  ];

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

  function clampInteger(value, fallback, min, max) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
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
      largeTextSession: largeTextSession
        ? {
            id: largeTextSession.id,
            active: true,
            startedAt: largeTextSession.startedAt,
            scenario: largeTextSession.scenario?.summary || null,
          }
        : null,
      textEditMathSession: textEditMathSession
        ? {
            id: textEditMathSession.id,
            active: textEditMathEventsActive,
            startedAt: textEditMathSession.startedAt,
            events: textEditMathEvents.length,
            startSnapshot: textEditMathSession.startSnapshot,
          }
        : null,
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

  function textObjectList() {
    return boardObjects().filter(obj => obj?.type === 'text');
  }

  function textObjectScriptRangeCount(obj) {
    return Array.isArray(obj?.data?.scriptRanges) ? obj.data.scriptRanges.length : 0;
  }

  function countTextLines(content) {
    const value = normalizeTextContent(content);
    return value ? value.split('\n').length : 0;
  }

  function eventTimestampMs(event = null) {
    const timestamp = Number(event?.timeStamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return performance.now();
    return timestamp > performance.timeOrigin ? timestamp - performance.timeOrigin : timestamp;
  }

  function eventTargetLabel(target) {
    if (!target) return '';
    const id = target.id ? `#${target.id}` : '';
    const className = typeof target.className === 'string'
      ? target.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(name => `.${name}`).join('')
      : '';
    return `${String(target.tagName || target.nodeName || '').toLowerCase()}${id}${className}`;
  }

  function sanitizePerfMeta(value) {
    return typeof sanitizeDebugMeta === 'function'
      ? sanitizeDebugMeta(value, { roundNumbers: true })
      : value;
  }

  function textEditMathSnapshot() {
    const id = typeof editingId !== 'undefined' ? (editingId || '') : '';
    const obj = id && typeof objectsMap !== 'undefined' ? objectsMap.get(id) : null;
    const proxyValue = typeof _editEl?.value === 'string' ? _editEl.value : null;
    const content = proxyValue ?? (typeof obj?.data?.content === 'string' ? obj.data.content : '');
    return sanitizePerfMeta({
      editingId: id,
      hasEditProxy: !!_editEl,
      objectFound: !!obj,
      valueLength: content.length,
      contentLength: typeof obj?.data?.content === 'string' ? obj.data.content.length : '',
      selectionStart: _editEl?.selectionStart ?? '',
      selectionEnd: _editEl?.selectionEnd ?? '',
      selectionDirection: _editEl?.selectionDirection || '',
      scriptRanges: textObjectScriptRangeCount(obj),
      scriptCaretAffinity: obj?._textScriptCaretAffinity || '',
      objectW: obj?.w ?? '',
      objectH: obj?.h ?? '',
      zoom: typeof zoom !== 'undefined' ? zoom : '',
      panX: typeof panX !== 'undefined' ? panX : '',
      panY: typeof panY !== 'undefined' ? panY : '',
    });
  }

  function textEditMathEventMeta(event) {
    const eventAt = eventTimestampMs(event);
    const now = performance.now();
    const selectionStart = _editEl?.selectionStart ?? '';
    const selectionEnd = _editEl?.selectionEnd ?? '';
    const valueLength = typeof _editEl?.value === 'string' ? _editEl.value.length : '';
    const clipboardTypes = event?.clipboardData?.types ? Array.from(event.clipboardData.types) : [];
    const meta = {
      at: round(now),
      sinceStartMs: textEditMathSession ? now - textEditMathSession.startedAtMs : '',
      gapMs: textEditMathLastEventAt ? now - textEditMathLastEventAt : '',
      eventType: event?.type || '',
      eventAt,
      eventAgeMs: Math.max(0, now - eventAt),
      inputType: event?.inputType || '',
      dataLength: typeof event?.data === 'string' ? event.data.length : '',
      key: event?.key || '',
      code: event?.code || '',
      repeat: !!event?.repeat,
      deltaX: event?.deltaX ?? '',
      deltaY: event?.deltaY ?? '',
      clientX: event?.clientX ?? '',
      clientY: event?.clientY ?? '',
      button: event?.button ?? '',
      buttons: event?.buttons ?? '',
      isComposing: !!event?.isComposing,
      ctrlKey: !!event?.ctrlKey,
      metaKey: !!event?.metaKey,
      shiftKey: !!event?.shiftKey,
      altKey: !!event?.altKey,
      defaultPrevented: !!event?.defaultPrevented,
      cancelable: !!event?.cancelable,
      target: eventTargetLabel(event?.target),
      editingId: typeof editingId !== 'undefined' ? (editingId || '') : '',
      hasEditProxy: !!_editEl,
      valueLength,
      selectionStart,
      selectionEnd,
      selectionLength: Number.isFinite(selectionStart) && Number.isFinite(selectionEnd)
        ? Math.abs(selectionEnd - selectionStart)
        : '',
      selectionDirection: _editEl?.selectionDirection || '',
      clipboardTypes,
    };
    textEditMathLastEventAt = now;
    return sanitizePerfMeta(meta);
  }

  function recordTextEditMathEvent(event) {
    if (!textEditMathEventsActive) return;
    textEditMathEvents.push(textEditMathEventMeta(event));
    if (textEditMathEvents.length > TEXT_EDIT_MATH_MAX_EVENTS) textEditMathEvents.shift();
  }

  function setTextEditMathListeners(active) {
    if (typeof document === 'undefined' || textEditMathEventsActive === active) return;
    for (const type of TEXT_EDIT_MATH_EVENT_TYPES) {
      document[active ? 'addEventListener' : 'removeEventListener'](type, recordTextEditMathEvent, { capture: true, passive: true });
    }
    textEditMathEventsActive = active;
  }

  function textEditMathEventSummary(events = textEditMathEvents) {
    const counts = {};
    const inputTypes = {};
    let maxGapMs = 0;
    let gapsOver16ms = 0;
    let gapsOver32ms = 0;
    let gapsOver80ms = 0;
    let maxEventAgeMs = 0;
    let maxSelectionLength = 0;
    for (const event of events) {
      const eventType = event.eventType || '';
      if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
      const inputType = event.inputType || '';
      if (inputType) inputTypes[inputType] = (inputTypes[inputType] || 0) + 1;
      const gap = Number(event.gapMs) || 0;
      maxGapMs = Math.max(maxGapMs, gap);
      if (gap > 16.7) gapsOver16ms++;
      if (gap > 32) gapsOver32ms++;
      if (gap > 80) gapsOver80ms++;
      maxEventAgeMs = Math.max(maxEventAgeMs, Number(event.eventAgeMs) || 0);
      maxSelectionLength = Math.max(maxSelectionLength, Number(event.selectionLength) || 0);
    }
    const first = events[0] || null;
    const last = events[events.length - 1] || null;
    return {
      events: events.length,
      firstAt: first?.at ?? '',
      lastAt: last?.at ?? '',
      durationMs: first && last ? round((Number(last.at) || 0) - (Number(first.at) || 0)) : 0,
      beforeinput: counts.beforeinput || 0,
      input: counts.input || 0,
      paste: counts.paste || 0,
      wheel: counts.wheel || 0,
      pointermove: counts.pointermove || 0,
      mousemove: counts.mousemove || 0,
      keydown: counts.keydown || 0,
      keyup: counts.keyup || 0,
      selectionchange: counts.selectionchange || 0,
      compositionEvents: (counts.compositionstart || 0) + (counts.compositionupdate || 0) + (counts.compositionend || 0),
      maxGapMs: round(maxGapMs),
      gapsOver16ms,
      gapsOver32ms,
      gapsOver80ms,
      maxEventAgeMs: round(maxEventAgeMs),
      maxSelectionLength,
      counts,
      inputTypes,
    };
  }

  function textEditMathTimeline(options = {}) {
    const limit = Math.max(1, Math.min(TEXT_EDIT_MATH_MAX_EVENTS, Number(options.limit) || 200));
    const rows = textEditMathEvents.slice(-limit).map(event => ({
      at: event.at,
      gapMs: event.gapMs,
      eventType: event.eventType,
      inputType: event.inputType,
      dataLength: event.dataLength,
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      clientX: event.clientX,
      clientY: event.clientY,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      valueLength: event.valueLength,
      selectionStart: event.selectionStart,
      selectionEnd: event.selectionEnd,
      selectionLength: event.selectionLength,
      target: event.target,
      defaultPrevented: event.defaultPrevented,
    }));
    if (options.table !== false) console.table(rows);
    return rows;
  }

  function viewportEventReport(options = {}) {
    const viewportApi = BoardfishDebug.viewport;
    return {
      frameSummary: viewportApi.frameSummary(),
      wheelSummary: viewportApi.wheelSummary(),
      drawSummary: viewportApi.drawSummary(),
      transformSummary: viewportApi.transformSummary(),
      eventLoopTimeline: viewportApi.eventLoopTimeline(options.eventLoopLimit ?? 120),
      rawInputTimeline: viewportApi.rawInputTimeline(options.rawInputLimit ?? 180),
      slowFrames: viewportApi.slowFrames(options.slowFrames ?? options.limit ?? 40),
    };
  }

  function textEditMathHeadline(report = {}) {
    const eventSummary = report.eventSummary || {};
    const frame = report.viewport?.frameSummary || {};
    const draw = report.viewport?.drawSummary || {};
    return {
      events: eventSummary.events ?? '',
      beforeinput: eventSummary.beforeinput ?? '',
      input: eventSummary.input ?? '',
      paste: eventSummary.paste ?? '',
      wheel: eventSummary.wheel ?? '',
      pointermove: eventSummary.pointermove ?? '',
      mousemove: eventSummary.mousemove ?? '',
      selectionchange: eventSummary.selectionchange ?? '',
      maxEventGapMs: eventSummary.maxGapMs ?? '',
      gapsOver32ms: eventSummary.gapsOver32ms ?? '',
      valueLengthStart: report.startSnapshot?.valueLength ?? '',
      valueLengthEnd: report.endSnapshot?.valueLength ?? '',
      scriptRangesEnd: report.endSnapshot?.scriptRanges ?? '',
      frames: frame.frames ?? '',
      slowFramesOver16ms: frame.slowFramesOver16ms ?? '',
      maxFrameMs: frame.maxFrameMs ?? '',
      maxInputAgeMs: frame.maxInputAgeMs ?? '',
      maxDrawMs: draw.maxDrawMs ?? '',
      maxEditingOverlayMs: draw.maxEditingOverlayMs ?? '',
      maxEditLayoutMs: draw.maxEditLayoutMs ?? '',
      maxEditTextDrawMs: draw.maxEditTextDrawMs ?? '',
      maxEditSelectionMs: draw.maxEditSelectionMs ?? '',
      maxEditCaretMs: draw.maxEditCaretMs ?? '',
      maxEditVisibleLines: draw.maxEditVisibleLines ?? '',
      maxEditCulledLines: draw.maxEditCulledLines ?? '',
    };
  }

  function textEditMathBegin(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    setTextEditMathListeners(false);
    BoardfishDebug.viewport.enable({
      verbose: false,
      rawInput: options.rawInput !== false,
      eventLoopGapThresholdMs: options.eventLoopGapThresholdMs,
    });
    BoardfishDebug.viewport.reset();
    markers.length = 0;
    textEditMathEvents.length = 0;
    textEditMathLastEventAt = 0;
    const id = `text-edit-math-${nextTextEditMathSessionId++}`;
    textEditMathSession = {
      id,
      startedAt: new Date().toISOString(),
      startedAtMs: performance.now(),
      startSnapshot: textEditMathSnapshot(),
      options: sanitizePerfMeta({
        rawInput: options.rawInput !== false,
        eventLoopGapThresholdMs: options.eventLoopGapThresholdMs ?? '',
      }),
    };
    setTextEditMathListeners(true);
    const out = {
      sessionId: id,
      startedAt: textEditMathSession.startedAt,
      mode: 'passive-event-recording',
      startSnapshot: textEditMathSession.startSnapshot,
      recordedEventTypes: TEXT_EDIT_MATH_EVENT_TYPES.slice(),
      next: 'Do the paste/edit/pan/zoom manually, then run finishDebug({ label: "text-edit-math", perf: ["textEditMathReport"] }).',
    };
    if (options.log !== false) {
      console.group('[Boardfish perf] text edit math passive recorder');
      console.table([{ sessionId: id, mode: out.mode, editingId: out.startSnapshot.editingId, valueLength: out.startSnapshot.valueLength }]);
      console.info(out.next);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function textEditMathReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    if (options.stop !== false) setTextEditMathListeners(false);
    const session = textEditMathSession;
    const events = textEditMathEvents.slice();
    const endSnapshot = textEditMathSnapshot();
    const out = {
      label: options.label || 'text-edit-math-passive-events',
      reportedAt: new Date().toISOString(),
      sessionId: session?.id || null,
      mode: 'passive-event-recording',
      startSnapshot: session?.startSnapshot || null,
      endSnapshot,
      eventSummary: textEditMathEventSummary(events),
      eventTimeline: textEditMathTimeline({ table: false, limit: options.eventLimit ?? options.limit ?? 400 }),
      viewport: viewportEventReport(options),
      markers: markers.slice(),
      notes: [
        'Passive report only: no board mutation, synthetic input, board viewport change, text layout measurement, cache clearing, memory snapshot, restore, or clipboard copy.',
      ],
    };
    out.headline = textEditMathHeadline(out);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.clear !== false) {
      textEditMathSession = null;
      textEditMathLastEventAt = 0;
    }
    if (options.log !== false) {
      console.group('[Boardfish perf] text edit math passive report');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function textBoardSummary(options = {}) {
    const includeLayout = options.layout === true;
    const viewportRect = typeof currentViewportWorldRect === 'function' ? currentViewportWorldRect(0) : null;
    const rows = [];
    let totalChars = 0;
    let totalLogicalLines = 0;
    let totalRenderedLines = 0;
    let visibleTextObjects = 0;
    let maxChars = 0;
    let maxLogicalLines = 0;
    let maxRenderedLines = 0;
    let totalScriptRanges = 0;
    let maxScriptRanges = 0;

    for (const obj of textObjectList()) {
      const content = normalizeTextContent(obj.data?.content || '');
      const chars = content.length;
      const logicalLines = countTextLines(content);
      const visible = !viewportRect || typeof objectIntersectsRect !== 'function'
        ? true
        : objectIntersectsRect(obj, viewportRect);
      let renderedLines = '';
      if (includeLayout && typeof getTextLayout === 'function') {
        renderedLines = getTextLayout(obj).length;
        totalRenderedLines += renderedLines;
        maxRenderedLines = Math.max(maxRenderedLines, renderedLines);
      }
      const scriptRanges = textObjectScriptRangeCount(obj);
      if (visible) visibleTextObjects++;
      totalChars += chars;
      totalLogicalLines += logicalLines;
      maxChars = Math.max(maxChars, chars);
      maxLogicalLines = Math.max(maxLogicalLines, logicalLines);
      totalScriptRanges += scriptRanges;
      maxScriptRanges = Math.max(maxScriptRanges, scriptRanges);
      rows.push({
        id: obj.id,
        chars,
        logicalLines,
        renderedLines,
        scriptRanges,
        visible,
        x: round(obj.x),
        y: round(obj.y),
        w: round(obj.w),
        h: round(obj.h),
      });
    }

    rows.sort((a, b) => b.chars - a.chars || b.logicalLines - a.logicalLines);
    const rowLimit = Math.max(0, Math.min(100, Number(options.limit ?? 20)));
    const out = {
      textObjectCount: rows.length,
      visibleTextObjects,
      totalChars,
      totalLogicalLines,
      totalRenderedLines: includeLayout ? totalRenderedLines : '',
      maxChars,
      maxLogicalLines,
      maxRenderedLines: includeLayout ? maxRenderedLines : '',
      totalScriptRanges,
      maxScriptRanges,
      avgCharsPerTextObject: rows.length ? round(totalChars / rows.length) : 0,
      avgLogicalLinesPerTextObject: rows.length ? round(totalLogicalLines / rows.length) : 0,
      topTextObjects: rows.slice(0, rowLimit),
    };
    if (options.table !== false) {
      console.table([{
        textObjectCount: out.textObjectCount,
        visibleTextObjects: out.visibleTextObjects,
        totalChars: out.totalChars,
        totalLogicalLines: out.totalLogicalLines,
        totalRenderedLines: out.totalRenderedLines,
        maxChars: out.maxChars,
        maxLogicalLines: out.maxLogicalLines,
        maxRenderedLines: out.maxRenderedLines,
        totalScriptRanges: out.totalScriptRanges,
        maxScriptRanges: out.maxScriptRanges,
      }]);
      if (out.topTextObjects.length) console.table(out.topTextObjects);
    }
    return out;
  }

  function measureTextLayoutPass(options = {}) {
    if (typeof getTextLayout !== 'function') {
      return { available: false, reason: 'getTextLayout unavailable' };
    }
    if (options.clearLayout === true && typeof clearTextLayoutCaches === 'function') {
      clearTextLayoutCaches({
        measurements: options.clearMeasurements === true,
        objectLayout: true,
      });
    }

    const viewportRect = typeof currentViewportWorldRect === 'function' ? currentViewportWorldRect(0) : null;
    const visibleOnly = options.visibleOnly === true;
    const rows = [];
    const startedAt = performance.now();
    let objectCount = 0;
    let renderedLines = 0;
    let chars = 0;
    let logicalLines = 0;
    let maxObjectMs = 0;

    for (const obj of textObjectList()) {
      const visible = !viewportRect || typeof objectIntersectsRect !== 'function'
        ? true
        : objectIntersectsRect(obj, viewportRect);
      if (visibleOnly && !visible) continue;
      const content = normalizeTextContent(obj.data?.content || '');
      const t0 = performance.now();
      const layout = getTextLayout(obj);
      const ms = performance.now() - t0;
      const scriptRanges = textObjectScriptRangeCount(obj);
      objectCount++;
      renderedLines += layout.length;
      chars += content.length;
      logicalLines += countTextLines(content);
      maxObjectMs = Math.max(maxObjectMs, ms);
      rows.push({
        id: obj.id,
        ms: round(ms),
        chars: content.length,
        logicalLines: countTextLines(content),
        renderedLines: layout.length,
        scriptRanges,
        visible,
      });
    }

    const totalMs = performance.now() - startedAt;
    rows.sort((a, b) => b.ms - a.ms || b.renderedLines - a.renderedLines);
    const out = {
      label: options.label || (options.clearLayout ? 'cold-text-layout' : 'warm-text-layout'),
      clearLayout: options.clearLayout === true,
      clearMeasurements: options.clearMeasurements === true,
      visibleOnly,
      objectCount,
      chars,
      logicalLines,
      renderedLines,
      totalMs: round(totalMs),
      avgObjectMs: objectCount ? round(totalMs / objectCount) : 0,
      maxObjectMs: round(maxObjectMs),
      topObjects: rows.slice(0, Math.max(0, Math.min(100, Number(options.limit ?? 20)))),
    };
    if (options.table !== false) {
      console.table([{
        label: out.label,
        objectCount: out.objectCount,
        chars: out.chars,
        logicalLines: out.logicalLines,
        renderedLines: out.renderedLines,
        totalMs: out.totalMs,
        avgObjectMs: out.avgObjectMs,
        maxObjectMs: out.maxObjectMs,
      }]);
      if (out.topObjects.length) console.table(out.topObjects);
    }
    return out;
  }

  function largeTextLine(objectIndex, lineIndex, charsPerLine) {
    const seed = `obj ${objectIndex + 1} line ${lineIndex + 1} Boardfish large text navigation performance sample `;
    let out = seed;
    let token = 0;
    while (out.length < charsPerLine) {
      out += `${(objectIndex + 17) * (lineIndex + 31) + token} `;
      token++;
    }
    return out.slice(0, charsPerLine);
  }

  function largeTextContent(objectIndex, lineCount, charsPerLine) {
    const lines = [];
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      lines.push(largeTextLine(objectIndex, lineIndex, charsPerLine));
    }
    return lines.join('\n');
  }

  function createLargeTextScenario(options = {}) {
    const objectCount = clampInteger(options.objectCount ?? options.objects, 32, 1, 250);
    const linesPerObject = clampInteger(options.linesPerObject ?? options.lines, 160, 1, 2000);
    const charsPerLine = clampInteger(options.charsPerLine ?? options.chars, 96, 8, 240);
    const cols = clampInteger(options.cols, Math.ceil(Math.sqrt(objectCount)), 1, objectCount);
    const gap = clampInteger(options.gap, 80, 0, 2000);
    const objectW = Math.max(160, Number(options.objectWidth) || Math.ceil(charsPerLine * 9.2 + TEXT_PAD * 2));
    const objectH = linesPerObject * LINE_H + TEXT_PAD * 2;
    const objectsOut = [];

    for (let index = 0; index < objectCount; index++) {
      const col = index % cols;
      const row = Math.floor(index / cols);
      objectsOut.push({
        id: `debug-text-${index + 1}`,
        type: 'text',
        x: col * (objectW + gap),
        y: row * (objectH + gap),
        w: objectW,
        h: objectH,
        z: index + 1,
        data: {
          content: largeTextContent(index, linesPerObject, charsPerLine),
        },
      });
    }

    const rows = Math.ceil(objectCount / cols);
    const boardW = cols * objectW + Math.max(0, cols - 1) * gap;
    const boardH = rows * objectH + Math.max(0, rows - 1) * gap;
    const viewW = window.innerWidth || 1200;
    const viewH = window.innerHeight || 800;
    const zoomValue = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : 0.22;
    const viewport = {
      zoom: zoomValue,
      panX: Number.isFinite(Number(options.panX)) ? Number(options.panX) : Math.round(viewW * 0.12),
      panY: Number.isFinite(Number(options.panY)) ? Number(options.panY) : Math.round(viewH * 0.1),
    };
    return {
      objects: objectsOut,
      viewport,
      summary: {
        objectCount,
        linesPerObject,
        charsPerLine,
        cols,
        rows,
        objectW,
        objectH,
        boardW,
        boardH,
        totalLogicalLines: objectCount * linesPerObject,
        totalChars: objectsOut.reduce((sum, obj) => sum + obj.data.content.length, 0),
        viewport,
      },
    };
  }

  function captureLargeTextOriginalState() {
    return {
      objects: cloneObjects(boardObjects()),
      viewport: { panX, panY, zoom },
      selectedId,
      selectedIds: [...selectedIds],
      dirtyIds: [..._dirtyIds],
      idCounter,
      zCounter,
      boardHistory: boardHistory.slice(),
      historyIndex,
      savedHistoryIndex,
      currentFilePath,
      currentFileRef,
      title: document.title,
    };
  }

  function restoreLargeTextOriginalState(session = largeTextSession, options = {}) {
    if (!session?.original) return { restored: false, reason: 'no-large-text-session' };
    const original = session.original;
    if (editingId && typeof exitEdit === 'function') exitEdit();
    BoardfishEditorState.replaceBoardObjects(cloneObjects(original.objects), {
      normalizeText: false,
      syncTextHeights: false,
      restoreCounters: false,
    });
    idCounter = original.idCounter;
    zCounter = original.zCounter;
    BoardfishViewportState.setViewport(original.viewport);
    selectedIds.clear();
    for (const id of original.selectedIds) {
      if (objectsMap.has(id)) selectedIds.add(id);
    }
    selectedId = selectedIds.has(original.selectedId)
      ? original.selectedId
      : ([...selectedIds].pop() || null);
    _dirtyIds.clear();
    for (const id of original.dirtyIds) _dirtyIds.add(id);
    boardHistory = original.boardHistory.slice();
    historyIndex = original.historyIndex;
    savedHistoryIndex = original.savedHistoryIndex;
    currentFilePath = original.currentFilePath;
    currentFileRef = original.currentFileRef;
    invalidateOffscreen();
    scheduleRender(true, true, 'large-text-perf-restore');
    if (typeof updateTitle === 'function') updateTitle();
    else document.title = original.title;
    if (largeTextSession?.id === session.id) largeTextSession = null;
    const out = {
      restored: true,
      sessionId: session.id,
      objectCount: objects.length,
      historyLength: boardHistory.length,
      historyIndex,
      savedHistoryIndex,
    };
    if (options.log !== false) {
      console.info(`[Boardfish perf] Restored board after large text evaluation (${session.id}).`);
      console.table([out]);
    }
    return out;
  }

  function applyLargeTextScenario(scenario) {
    if (editingId) {
      throw new Error('[Boardfish perf] Exit text editing before running the large text evaluation.');
    }
    BoardfishEditorState.replaceBoardObjects(cloneObjects(scenario.objects), {
      normalizeText: false,
      syncTextHeights: false,
      restoreCounters: true,
    });
    BoardfishEditorState.clearSelection();
    BoardfishViewportState.setViewport(scenario.viewport);
    _dirtyIds.clear();
    invalidateOffscreen();
    scheduleRender(true, true, 'large-text-perf-setup');
  }

  async function largeTextSetup(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    if (editingId && options.force !== true) {
      const skipped = { skipped: true, reason: 'editing-active' };
      console.warn('[Boardfish perf] Exit text editing before running the large text evaluation, or pass { force: true }.');
      return skipped;
    }
    if (editingId && options.force === true && typeof exitEdit === 'function') exitEdit();
    if (largeTextSession) restoreLargeTextOriginalState(largeTextSession, { log: false });

    const original = captureLargeTextOriginalState();
    const scenario = createLargeTextScenario(options);
    const id = `large-text-${nextLargeTextSessionId++}`;
    applyLargeTextScenario(scenario);
    BoardfishDebug.viewport.enable({
      verbose: false,
      rawInput: options.rawInput !== false,
      eventLoopGapThresholdMs: options.eventLoopGapThresholdMs,
    });
    BoardfishDebug.viewport.reset();
    markers.length = 0;
    sessionStartMemory = options.memory === false ? null : await memorySnapshot('large-text-begin', { ...options, table: false });
    await animationFrame();
    largeTextSession = {
      id,
      startedAt: new Date().toISOString(),
      original,
      scenario,
      memoryStart: sessionStartMemory,
    };
    const textSummary = textBoardSummary({ table: false, layout: false });
    const out = {
      sessionId: id,
      startedAt: largeTextSession.startedAt,
      scenario: scenario.summary,
      textSummary,
      viewport: { panX, panY, zoom },
      next: 'Pan and zoom the board, then run finishDebug({ label: "large-text-perf", perf: [["largeTextReport", { restore: true }]] }).',
    };
    if (options.log !== false) {
      console.group('[Boardfish perf] large text setup');
      console.table([{
        sessionId: id,
        textObjects: textSummary.textObjectCount,
        totalChars: textSummary.totalChars,
        totalLogicalLines: textSummary.totalLogicalLines,
        zoom,
      }]);
      console.info(out.next);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function viewportPhaseHeadline(report = {}) {
    const viewport = report.viewport || {};
    return viewportNavigationHeadline(viewport);
  }

  function largeTextHeadline(report = {}) {
    const text = report.textSummary || {};
    const cold = report.layoutCold || {};
    const warm = report.layoutWarm || {};
    const viewport = report.viewport || {};
    const frame = viewport.frameSummary || {};
    const draw = viewport.drawSummary || {};
    const pan = report.pan?.viewport || {};
    const zoomPhase = report.zoomPhase?.viewport || {};
    return {
      textObjects: text.textObjectCount ?? '',
      visibleTextObjects: text.visibleTextObjects ?? '',
      totalChars: text.totalChars ?? '',
      totalLogicalLines: text.totalLogicalLines ?? '',
      totalRenderedLines: text.totalRenderedLines ?? '',
      totalScriptRanges: text.totalScriptRanges ?? '',
      maxScriptRanges: text.maxScriptRanges ?? '',
      coldLayoutMs: cold.totalMs ?? '',
      warmLayoutMs: warm.totalMs ?? '',
      slowFramesOver16ms: frame.slowFramesOver16ms ?? '',
      maxFrameMs: frame.maxFrameMs ?? '',
      maxDrawMs: draw.maxDrawMs ?? '',
      maxObjectLoopMs: draw.maxObjectLoopMs ?? '',
      avgDrawnTextLines: draw.avgDrawnTextLines ?? '',
      maxDrawnTextLines: draw.maxDrawnTextLines ?? '',
      avgCulledTextLines: draw.avgCulledTextLines ?? '',
      maxCulledTextLines: draw.maxCulledTextLines ?? '',
      maxEditingOverlayMs: draw.maxEditingOverlayMs ?? '',
      maxEditLayoutMs: draw.maxEditLayoutMs ?? '',
      maxEditTextDrawMs: draw.maxEditTextDrawMs ?? '',
      maxEditSelectionMs: draw.maxEditSelectionMs ?? '',
      maxEditCaretMs: draw.maxEditCaretMs ?? '',
      maxEditVisibleLines: draw.maxEditVisibleLines ?? '',
      maxEditCulledLines: draw.maxEditCulledLines ?? '',
      panMaxFrameMs: pan.frameSummary?.maxFrameMs ?? '',
      panMaxDrawMs: pan.drawSummary?.maxDrawMs ?? '',
      zoomMaxFrameMs: zoomPhase.frameSummary?.maxFrameMs ?? '',
      zoomMaxDrawMs: zoomPhase.drawSummary?.maxDrawMs ?? '',
      restored: report.restore?.restored ?? false,
    };
  }

  async function largeTextReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const memoryEnd = options.memory === false ? null : await memorySnapshot('large-text-finish', { ...options, table: false });
    const textSummary = textBoardSummary({ table: false, layout: true, limit: options.limit || 20 });
    const layoutCold = measureTextLayoutPass({
      label: 'large-text-cold-layout',
      clearLayout: true,
      clearMeasurements: options.clearMeasurements === true,
      visibleOnly: options.visibleOnly === true,
      table: false,
      limit: options.limit || 20,
    });
    const layoutWarm = measureTextLayoutPass({
      label: 'large-text-warm-layout',
      visibleOnly: options.visibleOnly === true,
      table: false,
      limit: options.limit || 20,
    });
    const viewport = BoardfishDebug.viewport.report({
      log: false,
      details: options.details === true,
      limit: options.limit || 30,
      eventLoopLimit: options.eventLoopLimit ?? 120,
      rawInputLimit: options.rawInputLimit ?? 180,
      slowFrames: options.slowFrames ?? 40,
    });
    const session = largeTextSession;
    const out = {
      label: options.label || 'large-text-performance',
      reportedAt: new Date().toISOString(),
      sessionId: session?.id || null,
      scenario: session?.scenario?.summary || null,
      textSummary,
      layoutCold,
      layoutWarm,
      viewport,
      memoryStart: session?.memoryStart || sessionStartMemory,
      memoryEnd,
      memoryDelta: memoryDelta(session?.memoryStart || sessionStartMemory, memoryEnd),
      markers: markers.slice(),
      restore: null,
    };
    if (options.restore !== false && session) {
      out.restore = restoreLargeTextOriginalState(session, { log: false });
    }
    out.headline = {
      ...largeTextHeadline(out),
      ...(out.memoryDelta || {}),
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] large text report');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    if (options.copy === true) void copyLast();
    return out;
  }

  async function largeTextEvaluation(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const setup = await largeTextSetup({ ...options, log: false });
    if (!setup || setup.skipped) return setup;
    const session = largeTextSession;
    const panEvents = clampInteger(options.panEvents, 90, 1, 360);
    const zoomEvents = clampInteger(options.zoomEvents, 90, 1, 360);
    const pan = await wheelPanTest({
      events: panEvents,
      deltaX: Number.isFinite(Number(options.panDeltaX)) ? Number(options.panDeltaX) : 10,
      deltaY: Number.isFinite(Number(options.panDeltaY)) ? Number(options.panDeltaY) : 14,
      waveX: Number.isFinite(Number(options.panWaveX)) ? Number(options.panWaveX) : 3,
      waveY: Number.isFinite(Number(options.panWaveY)) ? Number(options.panWaveY) : 5,
      framePerWheel: options.framePerWheel !== false,
      log: false,
      details: options.details === true,
    });
    if (session?.scenario?.viewport) {
      BoardfishViewportState.setViewport(session.scenario.viewport);
      scheduleRender(true, true, 'large-text-perf-reset-zoom-phase');
      await animationFrame();
    }
    const zoomPhase = await wheelZoomTest({
      events: zoomEvents,
      deltaY: Number.isFinite(Number(options.zoomDeltaY)) ? Number(options.zoomDeltaY) : -5,
      waveY: Number.isFinite(Number(options.zoomWaveY)) ? Number(options.zoomWaveY) : 1.5,
      framePerWheel: options.framePerWheel !== false,
      log: false,
      details: options.details === true,
    });
    const memoryEnd = options.memory === false ? null : await memorySnapshot('large-text-evaluation-finish', { ...options, table: false });
    const textSummary = textBoardSummary({ table: false, layout: true, limit: options.limit || 20 });
    const layoutCold = measureTextLayoutPass({
      label: 'large-text-evaluation-cold-layout',
      clearLayout: true,
      clearMeasurements: options.clearMeasurements === true,
      visibleOnly: options.visibleOnly === true,
      table: false,
      limit: options.limit || 20,
    });
    const layoutWarm = measureTextLayoutPass({
      label: 'large-text-evaluation-warm-layout',
      visibleOnly: options.visibleOnly === true,
      table: false,
      limit: options.limit || 20,
    });
    const out = {
      label: options.label || 'large-text-automatic-evaluation',
      reportedAt: new Date().toISOString(),
      sessionId: session?.id || null,
      setup,
      scenario: session?.scenario?.summary || null,
      textSummary,
      layoutCold,
      layoutWarm,
      pan,
      zoomPhase,
      memoryStart: session?.memoryStart || sessionStartMemory,
      memoryEnd,
      memoryDelta: memoryDelta(session?.memoryStart || sessionStartMemory, memoryEnd),
      restore: null,
    };
    if (options.restore !== false && session) {
      out.restore = restoreLargeTextOriginalState(session, { log: false });
    }
    out.headline = {
      ...largeTextHeadline(out),
      panMaxFrameMs: viewportPhaseHeadline(pan).maxFrameMs,
      panMaxDrawMs: pan?.viewport?.drawSummary?.maxDrawMs ?? '',
      panMaxObjectLoopMs: pan?.viewport?.drawSummary?.maxObjectLoopMs ?? '',
      zoomMaxFrameMs: viewportPhaseHeadline(zoomPhase).maxFrameMs,
      zoomMaxDrawMs: zoomPhase?.viewport?.drawSummary?.maxDrawMs ?? '',
      zoomMaxObjectLoopMs: zoomPhase?.viewport?.drawSummary?.maxObjectLoopMs ?? '',
      ...(out.memoryDelta || {}),
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] large text automatic evaluation');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    if (options.copy === true) void copyLast();
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
    textBoardSummary,
    measureTextLayoutPass,
    textEditMathBegin,
    textEditMathReport,
    textEditMathTimeline,
    largeTextSetup,
    largeTextReport,
    largeTextEvaluation,
    restoreLargeTextOriginalState,
    state,
    json,
    copyLast,
    get last() { return lastReport; },
    get lastJson() { return lastJson; },
  };
})();

exposeDebug({ perf: ManualPerfDebug });
