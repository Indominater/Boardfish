'use strict';

var ManualPerfDebug = (() => {
  let lastReport = null;
  let lastJson = '';
  let sessionStartMemory = null;
  let largeTextPanningSession = null;
  let nextLargeTextPanningSessionId = 1;
  let textEditSession = null;
  let nextTextEditMathSessionId = 1;
  let textEditEventsActive = false;
  let textEditLastEventAt = 0;
  let textEditInputStepLastAt = 0;
  let textResizeSession = null;
  let nextTextResizeSessionId = 1;
  let nextTextResizeDragId = 1;
  let textResizeLastEventAt = 0;
  const markers = [];
  const textEditEvents = [];
  const textEditInputSteps = [];
  const textResizeEvents = [];
  const TEXT_EDIT_MAX_EVENTS = 10000;
  const TEXT_EDIT_INPUT_MAX_STEPS = 5000;
  const TEXT_RESIZE_MAX_EVENTS = 5000;
  const TEXT_EDIT_EVENT_TYPES = [
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
    'copy',
    'cut',
    'focus',
    'blur',
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
    const bitmapCache = typeof imageBitmapCache === 'undefined' ? {} : imageBitmapCache;
    const keys = new Set([
      ...safeObjectKeys(store),
      ...safeObjectKeys(bitmapCache),
    ]);
    const rows = [];
    let sourceBytes = 0;
    let bitmapBytes = 0;
    let bitmapCount = 0;
    let dataUrls = 0;

    for (const key of keys) {
      const source = store[key];
      const bitmap = bitmapCache[key];
      const sourceBytesForKey = sourceApproxBytes(source);
      const bitmapBytesForKey = drawableRgbaBytes(bitmap);
      const kind = sourceKind(source);
      sourceBytes += sourceBytesForKey;
      bitmapBytes += bitmapBytesForKey;
      if (bitmapBytesForKey > 0) bitmapCount++;
      if (kind === 'data-url') dataUrls++;
      rows.push({
        key,
        kind,
        sourceMB: mb(sourceBytesForKey),
        bitmapMB: mb(bitmapBytesForKey),
        totalEstimateMB: mb(sourceBytesForKey + bitmapBytesForKey),
        imageW: bitmap?.width || 0,
        imageH: bitmap?.height || 0,
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
      bitmapCount,
      sourceMB: mb(sourceBytes),
      bitmapEstimateMB: mb(bitmapBytes),
      displayDecodedEstimateMB: mb(bitmapBytes),
      totalLogicalEstimateMB: mb(sourceBytes + bitmapBytes),
      topImages: rows.slice(0, rowLimit),
    };
    if (options.table !== false) {
      console.table([{
        imageStoreKeys: out.imageStoreKeys,
        sourceMB: out.sourceMB,
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
    const panZoom = viewport.panZoomSummary || report.panZoom?.summary || {};
    return {
      imageCount: report.imageCount,
      boardSourceMB: mem.boardSourceMB,
      viewportScaleCacheMB: mem.viewportScaleCacheMB,
      jsHeapUsedMB: mem.jsHeapUsedMB,
      panZoomEvents: panZoom.events ?? '',
      panEvents: panZoom.panEvents ?? '',
      zoomEvents: panZoom.zoomEvents ?? '',
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
    const scaledImagePrewarmOptions = options.prewarmScaledImages && typeof options.prewarmScaledImages === 'object'
      ? options.prewarmScaledImages
      : {};
    const scaledImagePrewarm = options.prewarmScaledImages && typeof prewarmVisibleScaledImageVariants === 'function'
      ? prewarmVisibleScaledImageVariants(scaledImagePrewarmOptions)
      : null;
    const textLayoutPrewarmOptions = options.prewarmTextLayout && typeof options.prewarmTextLayout === 'object'
      ? options.prewarmTextLayout
      : {};
    const textLayoutPrewarm = options.prewarmTextLayout && typeof prewarmVisibleTextLayoutCaches === 'function'
      ? prewarmVisibleTextLayoutCaches({
          source: 'perf-begin',
          ...textLayoutPrewarmOptions,
        })
      : null;
    sessionStartMemory = options.memory === false ? null : await memorySnapshot('begin', { ...options, table: false });
    const out = {
      startedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: boardObjects().length,
      rawInput: options.rawInput !== false,
      scaledImagePrewarm,
      textLayoutPrewarm,
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
      largeTextPanningSession: largeTextPanningSession
        ? {
            id: largeTextPanningSession.id,
            active: true,
            startedAt: largeTextPanningSession.startedAt,
            mode: largeTextPanningSession.mode,
            objectId: largeTextPanningSession.objectId || '',
            startSnapshot: largeTextPanningSession.startSnapshot || null,
          }
        : null,
      textEditSession: textEditSession
        ? {
            id: textEditSession.id,
            active: textEditEventsActive,
            startedAt: textEditSession.startedAt,
            events: textEditEvents.length,
            inputSteps: textEditInputSteps.length,
            startSnapshot: textEditSession.startSnapshot,
          }
        : null,
      textResizeSession: textResizeSession
        ? {
            id: textResizeSession.id,
            active: true,
            startedAt: textResizeSession.startedAt,
            resizeEvents: textResizeEvents.length,
            textEditEvents: textEditEvents.length,
            inputSteps: textEditInputSteps.length,
            startSnapshot: textResizeSession.startSnapshot,
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
    const panZoom = viewportReport.panZoomSummary || {};
    return {
      panZoomEvents: panZoom.events ?? '',
      panEvents: panZoom.panEvents ?? '',
      zoomEvents: panZoom.zoomEvents ?? '',
      blockedEvents: panZoom.blockedEvents ?? '',
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
      maxPanDistancePx: panZoom.maxPanDistancePx ?? '',
      maxZoomDeltaPct: panZoom.maxZoomDeltaPct ?? '',
      avgDrawMs: draw.avgDrawMs ?? '',
      maxDrawMs: draw.maxDrawMs ?? '',
      maxObjectLoopMs: draw.maxObjectLoopMs ?? '',
      avgTransformMs: transform.avgTotalMs ?? '',
      maxTransformMs: transform.maxTotalMs ?? '',
    };
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
    out.headline = viewportNavigationHeadline(viewport);
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
    out.headline = viewportNavigationHeadline(out.viewport);
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
    out.headline = viewportNavigationHeadline(viewport);
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

  async function panZoomReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const memoryEnd = options.memory === false ? null : await memorySnapshot('pan-zoom-finish', { ...options, table: false });
    const panZoom = BoardfishDebug.viewport.panZoomReport({
      details: options.details === true,
      limit: options.limit || 240,
      timelineLimit: options.timelineLimit ?? options.limit ?? 300,
      rawInputLimit: options.rawInputLimit ?? options.limit ?? 300,
      eventLoopLimit: options.eventLoopLimit ?? options.limit ?? 160,
      frameScheduleLimit: options.frameScheduleLimit ?? options.limit ?? 160,
      slowFrames: options.slowFrames ?? 80,
      cacheTable: options.cacheTable === true,
      log: false,
    });
    const out = {
      label: options.label || 'viewport-pan-zoom-optimization',
      reportedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: boardObjects().length,
      zoom,
      panX,
      panY,
      panZoom,
      viewport: {
        panZoomSummary: panZoom.summary,
        panZoomTimeline: panZoom.panZoomTimeline,
        wheelSummary: panZoom.wheelSummary,
        frameSummary: panZoom.frameSummary,
        frameScheduleTimeline: panZoom.frameScheduleTimeline,
        transformSummary: panZoom.transformSummary,
        drawSummary: panZoom.drawSummary,
        slowFrames: panZoom.slowFrames,
        eventLoopTimeline: panZoom.eventLoopTimeline,
        rawInputTimeline: panZoom.rawInputTimeline,
        imageScaleCache: panZoom.imageScaleCache,
        culling: panZoom.culling,
      },
      memoryStart: sessionStartMemory,
      memoryEnd,
      memoryDelta: memoryDelta(sessionStartMemory, memoryEnd),
      markers: markers.slice(),
      notes: [
        'Pan/zoom report is passive: it records user-driven input, scheduling, frame, transform, draw, cache, and event-loop evidence without mutating board content.',
        'Use panZoomTimeline to correlate input gaps, RAF coalescing, transform cost, draw cost, and visible image/text workload.',
      ],
    };
    out.headline = {
      ...viewportNavigationHeadline(out.viewport),
      ...(out.memoryDelta || {}),
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] viewport pan/zoom optimization');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    if (options.copy === true) void copyLast();
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
    out.headline = viewportNavigationHeadline(out.viewport);
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
    out.headline = viewportNavigationHeadline(out.viewport);
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

  function countTextLines(content) {
    const value = normalizeTextContent(content);
    return value ? value.split('\n').length : 0;
  }

  function textEditCap(prefix, name) {
    return prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
  }

  function textEditLineHeight() {
    return Number(typeof LINE_H !== 'undefined' ? LINE_H : 24) || 24;
  }

  function textEditPad() {
    return Number(typeof TEXT_PAD !== 'undefined' ? TEXT_PAD : 16) || 16;
  }

  function textEditHeightLines(height) {
    const lines = (Number(height) - textEditPad() * 2) / textEditLineHeight();
    if (!Number.isFinite(lines) || lines <= 0) return '';
    const rounded = Math.round(lines);
    return Math.abs(lines - rounded) < 1e-6 ? Math.max(1, rounded) : '';
  }

  function textEditCachedLineInfo(obj, content = '') {
    if (!obj || obj.type !== 'text') return { lines: '', source: '' };
    const text = normalizeTextContent(content);
    const layoutCacheValid = Array.isArray(obj._layoutCache) &&
      obj._layoutCacheContent === text &&
      obj._layoutCacheW === obj.w;
    if (layoutCacheValid) return { lines: Math.max(1, obj._layoutCache.length), source: 'layout-cache' };
    const wrappedIndex = obj._textWrappedLineIndexCache;
    const wrappedIndexValid = wrappedIndex &&
      Array.isArray(wrappedIndex.entries) &&
      obj._textWrappedLineIndexCacheContent === text &&
      obj._textWrappedLineIndexCacheW === obj.w &&
      Number.isFinite(wrappedIndex.lineCount);
    if (wrappedIndexValid) {
      return {
        lines: Math.max(1, Math.trunc(Number(wrappedIndex.lineCount)) || 1),
        source: 'wrapped-index-cache',
      };
    }
    const wrappedCountValid = obj._textWrappedLineCountCacheContent === text &&
      obj._textWrappedLineCountCacheW === obj.w &&
      Number.isFinite(obj._textWrappedLineCountCacheValue);
    if (wrappedCountValid) {
      return {
        lines: Math.max(1, Math.trunc(Number(obj._textWrappedLineCountCacheValue)) || 1),
        source: 'wrapped-count-cache',
      };
    }
    const widthCache = obj._textWrappedLineIndexWidthCache;
    const widthCached = widthCache &&
      obj._textWrappedLineIndexWidthCacheContent === text &&
      typeof widthCache.get === 'function'
      ? widthCache.get(obj.w)
      : null;
    if (widthCached && Array.isArray(widthCached.entries) && Number.isFinite(widthCached.lineCount)) {
      return {
        lines: Math.max(1, Math.trunc(Number(widthCached.lineCount)) || 1),
        source: 'wrapped-width-cache',
      };
    }
    return { lines: '', source: '' };
  }

  function textEditSizeSnapshot(obj, content = '', prefix = '', { eventPayload = false } = {}) {
    const key = (name) => textEditCap(prefix, name);
    if (!obj || obj.type !== 'text') return {};
    const text = normalizeTextContent(content);
    const lineH = textEditLineHeight();
    const pad = textEditPad();
    const logicalLines = Math.max(1, countTextLines(text));
    const minLines = obj.id === (typeof editingId !== 'undefined' ? editingId : '')
      ? Math.max(1, Math.trunc(Number(obj._editMinLines)) || 1)
      : 1;
    const cached = textEditCachedLineInfo(obj, text);
    const expectedLogicalHeight = Math.max(minLines, logicalLines) * lineH + pad * 2;
    const expectedCachedHeight = cached.lines === ''
      ? ''
      : Math.max(minLines, Number(cached.lines) || 1) * lineH + pad * 2;
    return {
      [key('logicalLines')]: logicalLines,
      [key('cachedLines')]: cached.lines,
      [key('cachedLineSource')]: cached.source,
      ...(eventPayload ? {} : { [key('objectHeight')]: obj.h ?? '' }),
      [key('heightLines')]: textEditHeightLines(obj.h),
      ...(eventPayload ? {} : { [key('editMinLines')]: minLines }),
      [key('expectedLogicalHeight')]: expectedLogicalHeight,
      [key('expectedCachedHeight')]: expectedCachedHeight,
      [key('heightDeltaFromLogical')]: Number(obj.h) - expectedLogicalHeight,
      [key('heightDeltaFromCached')]: expectedCachedHeight === '' ? '' : Number(obj.h) - expectedCachedHeight,
      ...(eventPayload ? {} : {
        [key('lineHeight')]: lineH,
        [key('textPad')]: pad,
      }),
    };
  }

  function textEditProxySizeSnapshot(proxy = _editEl, { eventPayload = false } = {}) {
    if (!proxy) return {};
    return {
      proxyScrollHeight: proxy.scrollHeight ?? '',
      proxyClientHeight: proxy.clientHeight ?? '',
      ...(eventPayload ? {} : {
        proxyOffsetHeight: proxy.offsetHeight ?? '',
        proxyStyleHeight: proxy.style?.height || '',
      }),
    };
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

  function textEditShortcutFromEvent(event = null) {
    const type = event?.type || '';
    if (type !== 'keydown' && type !== 'keyup') return '';
    const key = String(event?.key || '').toLowerCase();
    const code = String(event?.code || '');
    const commandModifier = event.ctrlKey !== event.metaKey && !event.altKey;
    if (commandModifier && !event.shiftKey && (key === 'z' || code === 'KeyZ')) return 'undo';
    if (commandModifier && event.shiftKey && (key === 'z' || code === 'KeyZ')) return 'redo';
    if (commandModifier && !event.shiftKey && (key === 'y' || code === 'KeyY')) return 'redo';
    return '';
  }

  function sanitizePerfMeta(value) {
    return typeof sanitizeDebugMeta === 'function'
      ? sanitizeDebugMeta(value, { roundNumbers: true })
      : value;
  }

  function textEditSnapshot() {
    const id = typeof editingId !== 'undefined' ? (editingId || '') : '';
    const obj = id && typeof objectsMap !== 'undefined' ? objectsMap.get(id) : null;
    const domProxyValue = typeof _editEl?.value === 'string' ? _editEl.value : null;
    const logicalProxyValue = typeof textEditProxyValue === 'function' && _editEl
      ? textEditProxyValue(_editEl)
      : domProxyValue;
    const content = logicalProxyValue ?? (typeof obj?.data?.content === 'string' ? obj.data.content : '');
    return sanitizePerfMeta({
      editingId: id,
      hasEditProxy: !!_editEl,
      objectFound: !!obj,
      valueLength: content.length,
      logicalValueLength: typeof logicalProxyValue === 'string' ? logicalProxyValue.length : '',
      domValueLength: typeof domProxyValue === 'string' ? domProxyValue.length : '',
      domValueStale: !!_editEl?._boardfishDomValueStale,
      contentLength: typeof obj?.data?.content === 'string' ? obj.data.content.length : '',
      selectionStart: _editEl?.selectionStart ?? '',
      selectionEnd: _editEl?.selectionEnd ?? '',
      selectionDirection: _editEl?.selectionDirection || '',
      objectW: obj?.w ?? '',
      objectH: obj?.h ?? '',
      editStartChars: typeof obj?._editStartContent === 'string' ? obj._editStartContent.length : '',
      pendingSizeSync: !!obj?._textEditPendingSizeSync,
      ...textEditSizeSnapshot(obj, content),
      ...textEditProxySizeSnapshot(_editEl),
      layoutCachePresent: !!obj?._layoutCache,
      layoutCacheLines: Array.isArray(obj?._layoutCache) ? obj._layoutCache.length : '',
      historyLength: typeof boardHistory !== 'undefined' && Array.isArray(boardHistory) ? boardHistory.length : '',
      historyIndex: typeof historyIndex !== 'undefined' ? historyIndex : '',
      zoom: typeof zoom !== 'undefined' ? zoom : '',
      panX: typeof panX !== 'undefined' ? panX : '',
      panY: typeof panY !== 'undefined' ? panY : '',
    });
  }

  function textEditEventMeta(event) {
    const eventAt = eventTimestampMs(event);
    const now = performance.now();
    const id = typeof editingId !== 'undefined' ? (editingId || '') : '';
    const obj = id && typeof objectsMap !== 'undefined' ? objectsMap.get(id) : null;
    const selectionStart = _editEl?.selectionStart ?? '';
    const selectionEnd = _editEl?.selectionEnd ?? '';
    const domValueLength = typeof _editEl?.value === 'string' ? _editEl.value.length : '';
    const logicalValueLength = typeof textEditProxyValue === 'function' && _editEl
      ? textEditProxyValue(_editEl).length
      : domValueLength;
    const meta = {
      at: round(now),
      gapMs: textEditLastEventAt ? now - textEditLastEventAt : '',
      eventType: event?.type || '',
      eventAgeMs: Math.max(0, now - eventAt),
      inputType: event?.inputType || '',
      shortcut: textEditShortcutFromEvent(event),
      dataLength: typeof event?.data === 'string' ? event.data.length : '',
      key: event?.key || '',
      code: event?.code || '',
      repeat: !!event?.repeat,
      deltaX: event?.deltaX ?? '',
      deltaY: event?.deltaY ?? '',
      clientX: event?.clientX ?? '',
      clientY: event?.clientY ?? '',
      buttons: event?.buttons ?? '',
      ctrlKey: !!event?.ctrlKey,
      metaKey: !!event?.metaKey,
      defaultPrevented: !!event?.defaultPrevented,
      target: eventTargetLabel(event?.target),
      valueLength: logicalValueLength,
      domValueLength,
      domValueStale: !!_editEl?._boardfishDomValueStale,
      objectContentLength: typeof obj?.data?.content === 'string' ? obj.data.content.length : '',
      objectW: obj?.w ?? '',
      objectH: obj?.h ?? '',
      editStartChars: typeof obj?._editStartContent === 'string' ? obj._editStartContent.length : '',
      pendingSizeSync: !!obj?._textEditPendingSizeSync,
      ...textEditSizeSnapshot(
        obj,
        typeof _editEl?._boardfishLogicalValue === 'string'
          ? _editEl._boardfishLogicalValue
          : (typeof obj?.data?.content === 'string' ? obj.data.content : ''),
        '',
        { eventPayload: true },
      ),
      ...textEditProxySizeSnapshot(_editEl, { eventPayload: true }),
      layoutCachePresent: !!obj?._layoutCache,
      layoutCacheLines: Array.isArray(obj?._layoutCache) ? obj._layoutCache.length : '',
      historyLength: typeof boardHistory !== 'undefined' && Array.isArray(boardHistory) ? boardHistory.length : '',
      historyIndex: typeof historyIndex !== 'undefined' ? historyIndex : '',
      selectionStart,
      selectionEnd,
      selectionLength: Number.isFinite(selectionStart) && Number.isFinite(selectionEnd)
        ? Math.abs(selectionEnd - selectionStart)
        : '',
    };
    textEditLastEventAt = now;
    return sanitizePerfMeta(meta);
  }

  function recordTextEditMathEvent(event) {
    if (!textEditEventsActive) return;
    textEditEvents.push(textEditEventMeta(event));
    if (textEditEvents.length > TEXT_EDIT_MAX_EVENTS) textEditEvents.shift();
  }

  function textResizeSelectedTextObject(objectId = '') {
    const id = objectId || (typeof selectedId !== 'undefined' ? selectedId : '');
    if (id && typeof objectsMap !== 'undefined') {
      const obj = objectsMap.get(id);
      if (obj?.type === 'text') return obj;
    }
    if (typeof selectedIds !== 'undefined' && typeof objectsMap !== 'undefined') {
      for (const selected of selectedIds) {
        const obj = objectsMap.get(selected);
        if (obj?.type === 'text') return obj;
      }
    }
    return null;
  }

  function textResizeSnapshot(options = {}) {
    const obj = textResizeSelectedTextObject(options.objectId || '');
    const content = typeof obj?.data?.content === 'string' ? obj.data.content : '';
    const includeContent = options.includeContent !== false;
    return sanitizePerfMeta({
      selectedId: typeof selectedId !== 'undefined' ? (selectedId || '') : '',
      selectedCount: typeof selectedIds !== 'undefined' ? selectedIds.size : '',
      objectId: obj?.id || '',
      objectFound: !!obj,
      objectType: obj?.type || '',
      x: obj?.x ?? '',
      y: obj?.y ?? '',
      w: obj?.w ?? '',
      h: obj?.h ?? '',
      contentChars: includeContent ? content.length : '',
      logicalLines: includeContent ? countTextLines(content) : '',
      layoutCachePresent: !!obj?._layoutCache,
      layoutCacheLines: Array.isArray(obj?._layoutCache) ? obj._layoutCache.length : '',
      minWidthCachePresent: Number.isFinite(obj?._textMinWidthCache),
      paragraphPrefixCacheEntries: obj?._textParagraphPrefixCache?.size || 0,
      wrappedLineCountCachePresent: Number.isFinite(obj?._textWrappedLineCountCacheValue),
      wrappedLineCountCacheW: Number.isFinite(obj?._textWrappedLineCountCacheW) ? obj._textWrappedLineCountCacheW : '',
      wrappedLineIndexCacheEntries: obj?._textWrappedLineIndexCache?.entries?.length ?? '',
      wrappedLineIndexCacheLines: obj?._textWrappedLineIndexCache?.lineCount ?? '',
      wrappedLineIndexWidthCacheSize: obj?._textWrappedLineIndexWidthCache?.size ?? '',
      pendingSizeSync: !!obj?._textEditPendingSizeSync,
      zoom: typeof zoom !== 'undefined' ? zoom : '',
      panX: typeof panX !== 'undefined' ? panX : '',
      panY: typeof panY !== 'undefined' ? panY : '',
      editingId: typeof editingId !== 'undefined' ? (editingId || '') : '',
    });
  }

  function isTextResizeTraceActive() {
    return !!textResizeSession;
  }

  function recordTextResizeStep(step, meta = {}) {
    if (!isTextResizeTraceActive()) return;
    const now = performance.now();
    const entry = sanitizePerfMeta({
      at: round(now),
      sinceStartMs: now - textResizeSession.startedAtMs,
      gapMs: textResizeLastEventAt ? now - textResizeLastEventAt : '',
      step,
      ...meta,
    });
    textResizeLastEventAt = now;
    textResizeEvents.push(entry);
    if (textResizeEvents.length > TEXT_RESIZE_MAX_EVENTS) textResizeEvents.shift();
  }

  function startTextResizeDrag(meta = {}) {
    if (!isTextResizeTraceActive()) return null;
    const dragId = `text-resize-drag-${nextTextResizeDragId++}`;
    textResizeSession.currentDragId = dragId;
    recordTextResizeStep('start', { dragId, ...meta });
    return dragId;
  }

  function finishTextResizeDrag(dragId = '', meta = {}) {
    if (!isTextResizeTraceActive()) return;
    const id = dragId || textResizeSession?.currentDragId || '';
    recordTextResizeStep('end', { dragId: id, ...meta });
    if (textResizeSession?.currentDragId === id) textResizeSession.currentDragId = '';
  }

  function textResizeSummary(events = textResizeEvents) {
    const counts = {};
    const dragIds = new Set();
    const max = (field) => events.reduce((value, row) => Math.max(value, Number(row[field]) || 0), 0);
    let maxGapMs = 0;
    let gapsOver16ms = 0;
    let gapsOver32ms = 0;
    let gapsOver80ms = 0;
    let maxW = 0;
    let maxH = 0;
    let maxContentChars = 0;
    let maxLogicalLines = 0;
    let maxWrappedLineIndexCacheEntries = 0;
    let maxWrappedLineIndexWidthCacheSize = 0;
    let worstStep = null;
    let worstStepMs = 0;
    let liveAutoHeightCommits = 0;
    let liveBoardRenderCommits = 0;
    let cacheKeyedAutoHeightCommits = 0;
    for (const row of events) {
      const step = row.step || '';
      if (step) counts[step] = (counts[step] || 0) + 1;
      if (row.dragId) dragIds.add(row.dragId);
      if (step === 'apply-end' && row.autoHeightReason) liveAutoHeightCommits++;
      if (step === 'apply-end' && row.renderBoard === true) liveBoardRenderCommits++;
      if (step === 'apply-end' && row.layoutInvalidationMethod === 'cache-keyed') cacheKeyedAutoHeightCommits++;
      const gap = Number(row.gapMs) || 0;
      maxGapMs = Math.max(maxGapMs, gap);
      if (gap > 16.7) gapsOver16ms++;
      if (gap > 32) gapsOver32ms++;
      if (gap > 80) gapsOver80ms++;
      maxW = Math.max(maxW, Number(row.w) || Number(row.afterW) || Number(row.startW) || 0);
      maxH = Math.max(maxH, Number(row.h) || Number(row.afterH) || Number(row.startH) || 0);
      maxContentChars = Math.max(maxContentChars, Number(row.contentChars) || 0);
      maxLogicalLines = Math.max(maxLogicalLines, Number(row.logicalLines) || 0);
      maxWrappedLineIndexCacheEntries = Math.max(
        maxWrappedLineIndexCacheEntries,
        Number(row.wrappedLineIndexCacheEntries) || 0,
      );
      maxWrappedLineIndexWidthCacheSize = Math.max(
        maxWrappedLineIndexWidthCacheSize,
        Number(row.wrappedLineIndexWidthCacheSize) || 0,
      );
      const stepMs = Math.max(
        Number(row.ms) || 0,
        Number(row.moveMs) || 0,
        Number(row.applyMs) || 0,
        Number(row.autoHeightMs) || 0,
        Number(row.clearLayoutMs) || 0,
        Number(row.scheduleRenderMs) || 0,
        Number(row.flushMs) || 0,
        Number(row.historyMs) || 0,
      );
      if (stepMs > worstStepMs) {
        worstStepMs = stepMs;
        worstStep = row;
      }
    }
    return {
      events: events.length,
      dragCount: dragIds.size,
      moves: counts.move || 0,
      applyCommits: counts['apply-end'] || 0,
      liveAutoHeightCommits,
      liveBoardRenderCommits,
      cacheKeyedAutoHeightCommits,
      firstAt: events[0]?.at ?? '',
      lastAt: events[events.length - 1]?.at ?? '',
      durationMs: events.length > 1 ? round((Number(events[events.length - 1].at) || 0) - (Number(events[0].at) || 0)) : 0,
      maxGapMs: round(maxGapMs),
      gapsOver16ms,
      gapsOver32ms,
      gapsOver80ms,
      maxEventAgeMs: round(max('eventAgeMs')),
      maxMoveMs: round(max('moveMs')),
      maxMinWidthMs: round(max('minWidthMs')),
      maxApplyMs: round(max('applyMs')),
      maxClearLayoutMs: round(max('clearLayoutMs')),
      maxAutoHeightMs: round(max('autoHeightMs')),
      maxScheduleRenderMs: round(max('scheduleRenderMs')),
      maxFlushMs: round(max('flushMs')),
      maxHistoryMs: round(max('historyMs')),
      maxW: round(maxW),
      maxH: round(maxH),
      maxContentChars,
      maxLogicalLines,
      maxWrappedLineIndexCacheEntries,
      maxWrappedLineIndexWidthCacheSize,
      worstStep: worstStep
        ? {
            step: worstStep.step || '',
            dragId: worstStep.dragId || '',
            ms: round(worstStepMs),
            objectId: worstStep.objectId || '',
            w: worstStep.w ?? worstStep.afterW ?? '',
            h: worstStep.h ?? worstStep.afterH ?? '',
          }
        : null,
      counts,
    };
  }

  function textResizeTimeline(options = {}) {
    const limit = Math.max(1, Math.min(TEXT_RESIZE_MAX_EVENTS, Number(options.limit) || 500));
    const rows = textResizeEvents.slice(-limit).map(event => ({
      at: event.at,
      sinceStartMs: event.sinceStartMs,
      gapMs: event.gapMs,
      dragId: event.dragId,
      step: event.step,
      eventType: event.eventType,
      eventAgeMs: event.eventAgeMs,
      dir: event.dir,
      objectId: event.objectId,
      clientX: event.clientX,
      clientY: event.clientY,
      dx: event.dx,
      dy: event.dy,
      zoom: event.zoom,
      startX: event.startX,
      startY: event.startY,
      startW: event.startW,
      startH: event.startH,
      x: event.x,
      y: event.y,
      w: event.w,
      h: event.h,
      beforeW: event.beforeW,
      beforeH: event.beforeH,
      afterW: event.afterW,
      afterH: event.afterH,
      minTextW: event.minTextW,
      contentChars: event.contentChars,
      logicalLines: event.logicalLines,
      layoutCacheHadValue: event.layoutCacheHadValue,
      layoutCacheLinesBefore: event.layoutCacheLinesBefore,
      layoutCachePresent: event.layoutCachePresent,
      layoutCacheLines: event.layoutCacheLines,
      minWidthCachePresent: event.minWidthCachePresent,
      paragraphPrefixCacheEntries: event.paragraphPrefixCacheEntries,
      wrappedLineCountCachePresent: event.wrappedLineCountCachePresent,
      wrappedLineCountCacheW: event.wrappedLineCountCacheW,
      wrappedLineIndexCacheEntries: event.wrappedLineIndexCacheEntries,
      wrappedLineIndexCacheLines: event.wrappedLineIndexCacheLines,
      wrappedLineIndexWidthCacheSize: event.wrappedLineIndexWidthCacheSize,
      clearLayoutMs: event.clearLayoutMs,
      autoHeightMs: event.autoHeightMs,
      autoHeightChanged: event.autoHeightChanged,
      autoHeightReason: event.autoHeightReason,
      layoutInvalidationMethod: event.layoutInvalidationMethod,
      pendingSizeSync: event.pendingSizeSync,
      renderBoard: event.renderBoard,
      renderOverlay: event.renderOverlay,
      scheduleRenderMs: event.scheduleRenderMs,
      applyMs: event.applyMs,
      moveMs: event.moveMs,
      minWidthMs: event.minWidthMs,
      flushMs: event.flushMs,
      markDirtyMs: event.markDirtyMs,
      historyMs: event.historyMs,
      historyReason: event.historyReason,
    }));
    if (options.table !== false) console.table(rows);
    return rows;
  }

  function textResizeHeadline(report = {}) {
    const resize = report.resizeSummary || {};
    const events = report.eventSummary || {};
    const input = report.inputStepSummary || {};
    const frame = report.viewport?.frameSummary || {};
    const draw = report.viewport?.drawSummary || {};
    const historySummary = report.history?.textUndoRedo?.summary || {};
    return {
      resizeEvents: resize.events ?? '',
      resizeDrags: resize.dragCount ?? '',
      resizeMoves: resize.moves ?? '',
      resizeCommits: resize.applyCommits ?? '',
      liveAutoHeightCommits: resize.liveAutoHeightCommits ?? '',
      liveBoardRenderCommits: resize.liveBoardRenderCommits ?? '',
      cacheKeyedAutoHeightCommits: resize.cacheKeyedAutoHeightCommits ?? '',
      maxResizeGapMs: resize.maxGapMs ?? '',
      resizeGapsOver32ms: resize.gapsOver32ms ?? '',
      maxResizeEventAgeMs: resize.maxEventAgeMs ?? '',
      maxResizeApplyMs: resize.maxApplyMs ?? '',
      maxResizeAutoHeightMs: resize.maxAutoHeightMs ?? '',
      maxResizeClearLayoutMs: resize.maxClearLayoutMs ?? '',
      maxResizeScheduleRenderMs: resize.maxScheduleRenderMs ?? '',
      maxResizeFlushMs: resize.maxFlushMs ?? '',
      maxResizeHistoryMs: resize.maxHistoryMs ?? '',
      resizedContentChars: report.startSnapshot?.contentChars ?? resize.maxContentChars ?? '',
      resizedLogicalLines: report.startSnapshot?.logicalLines ?? resize.maxLogicalLines ?? '',
      startW: report.startSnapshot?.w ?? '',
      startH: report.startSnapshot?.h ?? '',
      endW: report.endSnapshot?.w ?? '',
      endH: report.endSnapshot?.h ?? '',
      startMinWidthCachePresent: report.startSnapshot?.minWidthCachePresent ?? '',
      endMinWidthCachePresent: report.endSnapshot?.minWidthCachePresent ?? '',
      startParagraphPrefixCacheEntries: report.startSnapshot?.paragraphPrefixCacheEntries ?? '',
      endParagraphPrefixCacheEntries: report.endSnapshot?.paragraphPrefixCacheEntries ?? '',
      startWrappedLineCountCachePresent: report.startSnapshot?.wrappedLineCountCachePresent ?? '',
      endWrappedLineCountCachePresent: report.endSnapshot?.wrappedLineCountCachePresent ?? '',
      endWrappedLineCountCacheW: report.endSnapshot?.wrappedLineCountCacheW ?? '',
      startWrappedLineIndexCacheEntries: report.startSnapshot?.wrappedLineIndexCacheEntries ?? '',
      endWrappedLineIndexCacheEntries: report.endSnapshot?.wrappedLineIndexCacheEntries ?? '',
      maxWrappedLineIndexCacheEntries: resize.maxWrappedLineIndexCacheEntries ?? '',
      endWrappedLineIndexWidthCacheSize: report.endSnapshot?.wrappedLineIndexWidthCacheSize ?? '',
      maxWrappedLineIndexWidthCacheSize: resize.maxWrappedLineIndexWidthCacheSize ?? '',
      domEvents: events.events ?? '',
      pointermove: events.pointermove ?? '',
      mousemove: events.mousemove ?? '',
      beforeinput: events.beforeinput ?? '',
      input: events.input ?? '',
      maxDomEventGapMs: events.maxGapMs ?? '',
      inputRuns: input.inputRuns ?? '',
      maxInputHandlerMs: input.maxInputTotalMs ?? '',
      maxInputStepMs: input.maxStepMs ?? '',
      worstInputStep: input.worstStep?.step ?? '',
      maxTextareaMutationMs: input.maxTextareaMutationMs ?? '',
      frames: frame.frames ?? '',
      slowFramesOver16ms: frame.slowFramesOver16ms ?? '',
      maxFrameMs: frame.maxFrameMs ?? '',
      maxInputAgeMs: frame.maxInputAgeMs ?? '',
      maxDrawMs: draw.maxDrawMs ?? '',
      maxEditLayoutMs: draw.maxEditLayoutMs ?? '',
      historyMaxEnterEditMs: historySummary.maxEnterEditMs ?? '',
      historyMaxFocusMs: historySummary.maxFocusMs ?? '',
      historyMaxProxyValueSetMs: historySummary.maxProxyValueSetMs ?? '',
    };
  }

  function setTextEditMathListeners(active) {
    if (typeof document === 'undefined' || textEditEventsActive === active) return;
    for (const type of TEXT_EDIT_EVENT_TYPES) {
      document[active ? 'addEventListener' : 'removeEventListener'](type, recordTextEditMathEvent, { capture: true, passive: true });
    }
    textEditEventsActive = active;
  }

  function textEditEventSummary(events = textEditEvents) {
    const counts = {};
    const inputTypes = {};
    const shortcuts = {};
    let maxGapMs = 0;
    let gapsOver16ms = 0;
    let gapsOver32ms = 0;
    let gapsOver80ms = 0;
    let maxEventAgeMs = 0;
    let maxSelectionLength = 0;
    let maxValueLength = 0;
    let maxDomValueLength = 0;
    let maxObjectContentLength = 0;
    for (const event of events) {
      const eventType = event.eventType || '';
      if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
      const inputType = event.inputType || '';
      if (inputType) inputTypes[inputType] = (inputTypes[inputType] || 0) + 1;
      const shortcut = event.shortcut || '';
      if (shortcut) shortcuts[shortcut] = (shortcuts[shortcut] || 0) + 1;
      const gap = Number(event.gapMs) || 0;
      maxGapMs = Math.max(maxGapMs, gap);
      if (gap > 16.7) gapsOver16ms++;
      if (gap > 32) gapsOver32ms++;
      if (gap > 80) gapsOver80ms++;
      maxEventAgeMs = Math.max(maxEventAgeMs, Number(event.eventAgeMs) || 0);
      maxSelectionLength = Math.max(maxSelectionLength, Number(event.selectionLength) || 0);
      maxValueLength = Math.max(maxValueLength, Number(event.valueLength) || 0);
      maxDomValueLength = Math.max(maxDomValueLength, Number(event.domValueLength) || 0);
      maxObjectContentLength = Math.max(maxObjectContentLength, Number(event.objectContentLength) || 0);
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
      maxValueLength,
      maxDomValueLength,
      maxObjectContentLength,
      counts,
      inputTypes,
      shortcuts,
    };
  }

  function isDeleteLikeTextInput(inputType = '') {
    const value = String(inputType || '').toLowerCase();
    return value.startsWith('delete') || value.includes('cut');
  }

  function isTextEditInputTraceActive(inputType = '') {
    if (!textEditEventsActive || !textEditSession?.traceTextInput) return false;
    const options = textEditSession.traceTextInput;
    if (options.allInputs) return true;
    const value = String(inputType || '').toLowerCase();
    if (options.deleteInputs !== false && isDeleteLikeTextInput(value)) return true;
    if (options.pasteInputs === true && value.includes('paste')) return true;
    return false;
  }

  function recordTextEditInputStep(step, meta = {}) {
    if (!isTextEditInputTraceActive(meta?.inputType)) return;
    const now = performance.now();
    const entry = sanitizePerfMeta({
      at: round(now),
      gapMs: textEditInputStepLastAt ? now - textEditInputStepLastAt : '',
      step,
      ...meta,
    });
    textEditInputStepLastAt = now;
    textEditInputSteps.push(entry);
    if (textEditInputSteps.length > TEXT_EDIT_INPUT_MAX_STEPS) textEditInputSteps.shift();
  }

  function textEditInputStepSummary(steps = textEditInputSteps) {
    const counts = {};
    const inputTypes = {};
    const max = (field) => steps.reduce((value, row) => Math.max(value, Number(row[field]) || 0), 0);
    let maxGapMs = 0;
    let gapsOver16ms = 0;
    let gapsOver32ms = 0;
    let maxStepMs = 0;
    let maxInputTotalMs = 0;
    let maxRemovedChars = 0;
    let maxInsertedChars = 0;
    let maxSelectedChars = 0;
    let maxHeightDeltaFromLogical = 0;
    let maxHeightDeltaFromCached = 0;
    let maxOldChars = 0;
    let maxNextChars = 0;
    let deleteInputRuns = new Set();
    let worstStep = null;
    for (const row of steps) {
      const step = row.step || '';
      if (step) counts[step] = (counts[step] || 0) + 1;
      const inputType = row.inputType || '';
      if (inputType) inputTypes[inputType] = (inputTypes[inputType] || 0) + 1;
      if (isDeleteLikeTextInput(inputType) && row.seq !== '' && row.seq != null) deleteInputRuns.add(row.seq);
      const gap = Number(row.gapMs) || 0;
      maxGapMs = Math.max(maxGapMs, gap);
      if (gap > 16.7) gapsOver16ms++;
      if (gap > 32) gapsOver32ms++;
      const stepMs = Number(row.ms) || 0;
      if (stepMs > maxStepMs) {
        maxStepMs = stepMs;
        worstStep = row;
      }
      maxInputTotalMs = Math.max(maxInputTotalMs, Number(row.totalMs) || 0);
      maxRemovedChars = Math.max(maxRemovedChars, Number(row.removedChars) || 0);
      maxInsertedChars = Math.max(maxInsertedChars, Number(row.insertedChars) || 0);
      maxSelectedChars = Math.max(maxSelectedChars, Number(row.selectedChars) || 0);
      maxHeightDeltaFromLogical = Math.max(
        maxHeightDeltaFromLogical,
        Math.abs(Number(row.afterAutoHeightHeightDeltaFromLogical ?? row.inputEndHeightDeltaFromLogical ?? row.heightDeltaFromLogical) || 0),
      );
      maxHeightDeltaFromCached = Math.max(
        maxHeightDeltaFromCached,
        Math.abs(Number(row.afterAutoHeightHeightDeltaFromCached ?? row.inputEndHeightDeltaFromCached ?? row.heightDeltaFromCached) || 0),
      );
      maxOldChars = Math.max(maxOldChars, Number(row.oldChars) || Number(row.proxyChars) || 0);
      maxNextChars = Math.max(maxNextChars, Number(row.nextChars) || Number(row.proxyChars) || 0);
    }
    return {
      steps: steps.length,
      inputRuns: new Set(steps.map(row => row.seq).filter(value => value !== '' && value != null)).size,
      deleteInputRuns: deleteInputRuns.size,
      maxGapMs: round(maxGapMs),
      gapsOver16ms,
      gapsOver32ms,
      maxStepMs: round(maxStepMs),
      worstStep: worstStep
        ? {
            step: worstStep.step || '',
            inputType: worstStep.inputType || '',
            seq: worstStep.seq ?? '',
            ms: worstStep.ms ?? '',
            totalMs: worstStep.totalMs ?? '',
            removedChars: worstStep.removedChars ?? '',
            selectedChars: worstStep.selectedChars ?? '',
          }
        : null,
      maxInputTotalMs: round(maxInputTotalMs),
      maxEventAgeMs: round(max('eventAgeMs')),
      maxSelectedChars,
      maxRemovedChars,
      maxInsertedChars,
      maxHeightDeltaFromLogical: round(maxHeightDeltaFromLogical),
      maxHeightDeltaFromCached: round(maxHeightDeltaFromCached),
      maxOldChars,
      maxNextChars,
      maxRenderScheduleMs: round(max('renderScheduleMs')),
      maxTextareaMutationMs: round(max('textareaMutationMs')),
      maxSetRangeTextMs: round(max('setRangeTextMs')),
      maxValueAssignMs: round(max('valueAssignMs')),
      maxValueBuildMs: round(max('valueBuildMs')),
      maxValueSetMs: round(max('valueSetMs')),
      maxLogicalSetMs: round(max('logicalSetMs')),
      maxSelectionSetMs: round(max('selectionSetMs')),
      counts,
      inputTypes,
    };
  }

  function textEditInputStepTimeline(options = {}) {
    const limit = Math.max(1, Math.min(TEXT_EDIT_INPUT_MAX_STEPS, Number(options.limit) || 400));
    const rows = textEditInputSteps.slice(-limit).map(step => ({
      at: step.at,
      gapMs: step.gapMs,
      seq: step.seq,
      step: step.step,
      inputType: step.inputType,
      key: step.key,
      eventType: step.eventType,
      eventAgeMs: step.eventAgeMs,
      ms: step.ms,
      totalMs: step.totalMs,
      objectId: step.objectId,
      proxyChars: step.proxyChars,
      domProxyChars: step.domProxyChars,
      domValueStale: step.domValueStale,
      oldChars: step.oldChars,
      nextChars: step.nextChars,
      insertedChars: step.insertedChars,
      removedChars: step.removedChars,
      replacementStart: step.replacementStart,
      replacementEnd: step.replacementEnd,
      selectionStart: step.selectionStart,
      selectionEnd: step.selectionEnd,
      selectedChars: step.selectedChars,
      selectionDirection: step.selectionDirection,
      layoutPatched: step.layoutPatched,
      layoutPatchOldLines: step.layoutPatchOldLines,
      layoutPatchNewLines: step.layoutPatchNewLines,
      layoutPatchRemovedLines: step.layoutPatchRemovedLines,
      layoutPatchInsertedLines: step.layoutPatchInsertedLines,
      layoutPatchLineDelta: step.layoutPatchLineDelta,
      layoutPatchLogicalLineDelta: step.layoutPatchLogicalLineDelta,
      layoutPatchReason: step.layoutPatchReason,
      autoHeightDeferred: step.autoHeightDeferred,
      autoHeightForceSync: step.autoHeightForceSync,
      autoHeightForceReason: step.autoHeightForceReason,
      restoredMinLinesReset: step.restoredMinLinesReset,
      restoredPreviousMinLines: step.restoredPreviousMinLines,
      restoredPreservedMinLines: step.restoredPreservedMinLines,
      restoredNextMinLines: step.restoredNextMinLines,
      pendingSizeSyncBeforeAutoHeight: step.pendingSizeSyncBeforeAutoHeight,
      pendingSizeSync: step.pendingSizeSync,
      inputStateObjectHeight: step.inputStateObjectHeight,
      inputStateLogicalLines: step.inputStateLogicalLines,
      inputStateCachedLines: step.inputStateCachedLines,
      inputStateCachedLineSource: step.inputStateCachedLineSource,
      inputStateExpectedLogicalHeight: step.inputStateExpectedLogicalHeight,
      inputStateExpectedCachedHeight: step.inputStateExpectedCachedHeight,
      inputStateHeightDeltaFromLogical: step.inputStateHeightDeltaFromLogical,
      inputStateHeightDeltaFromCached: step.inputStateHeightDeltaFromCached,
      updatedObjectHeight: step.updatedObjectHeight,
      updatedLogicalLines: step.updatedLogicalLines,
      updatedCachedLines: step.updatedCachedLines,
      updatedCachedLineSource: step.updatedCachedLineSource,
      updatedExpectedLogicalHeight: step.updatedExpectedLogicalHeight,
      updatedExpectedCachedHeight: step.updatedExpectedCachedHeight,
      updatedHeightDeltaFromLogical: step.updatedHeightDeltaFromLogical,
      updatedHeightDeltaFromCached: step.updatedHeightDeltaFromCached,
      beforeAutoHeightObjectHeight: step.beforeAutoHeightObjectHeight,
      beforeAutoHeightLogicalLines: step.beforeAutoHeightLogicalLines,
      beforeAutoHeightCachedLines: step.beforeAutoHeightCachedLines,
      beforeAutoHeightCachedLineSource: step.beforeAutoHeightCachedLineSource,
      beforeAutoHeightExpectedLogicalHeight: step.beforeAutoHeightExpectedLogicalHeight,
      beforeAutoHeightExpectedCachedHeight: step.beforeAutoHeightExpectedCachedHeight,
      beforeAutoHeightHeightDeltaFromLogical: step.beforeAutoHeightHeightDeltaFromLogical,
      beforeAutoHeightHeightDeltaFromCached: step.beforeAutoHeightHeightDeltaFromCached,
      afterAutoHeightObjectHeight: step.afterAutoHeightObjectHeight,
      afterAutoHeightLogicalLines: step.afterAutoHeightLogicalLines,
      afterAutoHeightCachedLines: step.afterAutoHeightCachedLines,
      afterAutoHeightCachedLineSource: step.afterAutoHeightCachedLineSource,
      afterAutoHeightExpectedLogicalHeight: step.afterAutoHeightExpectedLogicalHeight,
      afterAutoHeightExpectedCachedHeight: step.afterAutoHeightExpectedCachedHeight,
      afterAutoHeightHeightDeltaFromLogical: step.afterAutoHeightHeightDeltaFromLogical,
      afterAutoHeightHeightDeltaFromCached: step.afterAutoHeightHeightDeltaFromCached,
      inputEndObjectHeight: step.inputEndObjectHeight,
      inputEndLogicalLines: step.inputEndLogicalLines,
      inputEndCachedLines: step.inputEndCachedLines,
      inputEndCachedLineSource: step.inputEndCachedLineSource,
      inputEndExpectedLogicalHeight: step.inputEndExpectedLogicalHeight,
      inputEndExpectedCachedHeight: step.inputEndExpectedCachedHeight,
      inputEndHeightDeltaFromLogical: step.inputEndHeightDeltaFromLogical,
      inputEndHeightDeltaFromCached: step.inputEndHeightDeltaFromCached,
      proxyScrollHeight: step.proxyScrollHeight,
      proxyClientHeight: step.proxyClientHeight,
      historyPushed: step.historyPushed,
      renderScheduleMs: step.renderScheduleMs,
      textareaMutationMs: step.textareaMutationMs,
      textareaMutationMethod: step.textareaMutationMethod,
      setRangeTextMs: step.setRangeTextMs,
      valueAssignMs: step.valueAssignMs,
      valueBuildMs: step.valueBuildMs,
      valueSetMs: step.valueSetMs,
      logicalSetMs: step.logicalSetMs,
      selectionSetMs: step.selectionSetMs,
    }));
    if (options.table !== false) console.table(rows);
    return rows;
  }

  function textEditTimeline(options = {}) {
    const limit = Math.max(1, Math.min(TEXT_EDIT_MAX_EVENTS, Number(options.limit) || 200));
    const rows = textEditEvents.slice(-limit).map(event => ({
      at: event.at,
      gapMs: event.gapMs,
      eventType: event.eventType,
      inputType: event.inputType,
      shortcut: event.shortcut,
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
      domValueLength: event.domValueLength,
      domValueStale: event.domValueStale,
      objectContentLength: event.objectContentLength,
      objectW: event.objectW,
      objectH: event.objectH,
      logicalLines: event.logicalLines,
      cachedLines: event.cachedLines,
      cachedLineSource: event.cachedLineSource,
      heightLines: event.heightLines,
      expectedLogicalHeight: event.expectedLogicalHeight,
      expectedCachedHeight: event.expectedCachedHeight,
      heightDeltaFromLogical: event.heightDeltaFromLogical,
      heightDeltaFromCached: event.heightDeltaFromCached,
      proxyScrollHeight: event.proxyScrollHeight,
      proxyClientHeight: event.proxyClientHeight,
      editStartChars: event.editStartChars,
      pendingSizeSync: event.pendingSizeSync,
      layoutCachePresent: event.layoutCachePresent,
      layoutCacheLines: event.layoutCacheLines,
      historyLength: event.historyLength,
      historyIndex: event.historyIndex,
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

  function historyTextUndoRedoReport(options = {}) {
    const historyApi = BoardfishDebug.history;
    if (!historyApi?.textUndoRedoReport) {
      return { available: false, reason: 'history text undo/redo report unavailable' };
    }
    return {
      available: true,
      textUndoRedo: historyApi.textUndoRedoReport({
        table: options.historyTable === true,
        limit: options.historyLimit ?? options.limit ?? 240,
      }),
      stats: historyApi.stats || null,
    };
  }

  function textEditHeadline(report = {}) {
    const eventSummary = report.eventSummary || {};
    const inputStepSummary = report.inputStepSummary || {};
    const frame = report.viewport?.frameSummary || {};
    const draw = report.viewport?.drawSummary || {};
    const historySummary = report.history?.textUndoRedo?.summary || {};
    return {
      events: eventSummary.events ?? '',
      beforeinput: eventSummary.beforeinput ?? '',
      input: eventSummary.input ?? '',
      paste: eventSummary.paste ?? '',
      undoShortcuts: eventSummary.shortcuts?.undo ?? '',
      redoShortcuts: eventSummary.shortcuts?.redo ?? '',
      wheel: eventSummary.wheel ?? '',
      pointermove: eventSummary.pointermove ?? '',
      mousemove: eventSummary.mousemove ?? '',
      selectionchange: eventSummary.selectionchange ?? '',
      maxEventGapMs: eventSummary.maxGapMs ?? '',
      gapsOver32ms: eventSummary.gapsOver32ms ?? '',
      inputRuns: inputStepSummary.inputRuns ?? '',
      deleteInputRuns: inputStepSummary.deleteInputRuns ?? '',
      maxInputHandlerMs: inputStepSummary.maxInputTotalMs ?? '',
      maxInputStepMs: inputStepSummary.maxStepMs ?? '',
      worstInputStep: inputStepSummary.worstStep?.step ?? '',
      maxRemovedChars: inputStepSummary.maxRemovedChars ?? '',
      maxSelectedCharsInInput: inputStepSummary.maxSelectedChars ?? '',
      maxHeightDeltaFromLogical: inputStepSummary.maxHeightDeltaFromLogical ?? '',
      maxHeightDeltaFromCached: inputStepSummary.maxHeightDeltaFromCached ?? '',
      maxTextareaMutationMs: inputStepSummary.maxTextareaMutationMs ?? '',
      maxRenderScheduleMs: inputStepSummary.maxRenderScheduleMs ?? '',
      valueLengthStart: report.startSnapshot?.valueLength ?? '',
      valueLengthEnd: report.endSnapshot?.valueLength ?? '',
      maxValueLength: eventSummary.maxValueLength ?? '',
      domValueLengthStart: report.startSnapshot?.domValueLength ?? '',
      domValueLengthEnd: report.endSnapshot?.domValueLength ?? '',
      domValueStaleEnd: report.endSnapshot?.domValueStale ?? '',
      maxDomValueLength: eventSummary.maxDomValueLength ?? '',
      contentLengthStart: report.startSnapshot?.contentLength ?? '',
      contentLengthEnd: report.endSnapshot?.contentLength ?? '',
      maxObjectContentLength: eventSummary.maxObjectContentLength ?? '',
      editStartChars: report.startSnapshot?.editStartChars ?? '',
      pendingSizeSyncEnd: report.endSnapshot?.pendingSizeSync ?? '',
      objectHeightEnd: report.endSnapshot?.objectH ?? '',
      expectedLogicalHeightEnd: report.endSnapshot?.expectedLogicalHeight ?? '',
      expectedCachedHeightEnd: report.endSnapshot?.expectedCachedHeight ?? '',
      heightDeltaFromLogicalEnd: report.endSnapshot?.heightDeltaFromLogical ?? '',
      heightDeltaFromCachedEnd: report.endSnapshot?.heightDeltaFromCached ?? '',
      layoutCacheLinesEnd: report.endSnapshot?.layoutCacheLines ?? '',
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
      historyUndoCount: historySummary.undoCount ?? '',
      historyRedoCount: historySummary.redoCount ?? '',
      historyMaxUndoMs: historySummary.maxUndoMs ?? '',
      historyMaxRedoMs: historySummary.maxRedoMs ?? '',
      historyMaxRestoreMs: historySummary.maxRestoreMs ?? '',
      historyMaxOuterRestoreMs: historySummary.maxOuterRestoreMs ?? '',
      historyMaxFlushMs: historySummary.maxFlushMs ?? '',
      historyMaxCloneObjectsMs: historySummary.maxCloneObjectsMs ?? '',
      historyHydratedTextRuntimeCaches: historySummary.hydratedTextRuntimeCaches ?? '',
      historyHydratedTextLayoutCaches: historySummary.hydratedTextLayoutCaches ?? '',
      historyMaxReplaceBoardObjectsMs: historySummary.maxReplaceBoardObjectsMs ?? '',
      historyMaxEnterEditMs: historySummary.maxEnterEditMs ?? '',
      historyMaxProxyValueSetMs: historySummary.maxProxyValueSetMs ?? '',
      historyMaxProxyValueDiffMs: historySummary.maxProxyValueDiffMs ?? '',
      historyMaxProxyValueMutationMs: historySummary.maxProxyValueMutationMs ?? '',
      historyMaxProxyValueAssignMs: historySummary.maxProxyValueAssignMs ?? '',
      historyMaxSetSelectionRangeMs: historySummary.maxSetSelectionRangeMs ?? '',
      historyMaxFocusMs: historySummary.maxFocusMs ?? '',
    };
  }

  function textEditBegin(options = {}) {
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
    if (options.history !== false && BoardfishDebug.history?.enable && BoardfishDebug.history?.reset) {
      BoardfishDebug.history.enable({ verbose: false });
      BoardfishDebug.history.reset();
    }
    markers.length = 0;
    textEditEvents.length = 0;
    textEditInputSteps.length = 0;
    textEditLastEventAt = 0;
    textEditInputStepLastAt = 0;
    const id = `text-edit-${nextTextEditMathSessionId++}`;
    const traceTextInput = options.traceTextInput !== false;
    textEditSession = {
      id,
      startedAt: new Date().toISOString(),
      startedAtMs: performance.now(),
      startSnapshot: textEditSnapshot(),
      traceTextInput: traceTextInput
        ? {
            allInputs: options.traceAllTextInputs === true,
            deleteInputs: options.traceDeleteInputs !== false,
            pasteInputs: options.tracePasteInputs === true,
          }
        : null,
      options: sanitizePerfMeta({
        rawInput: options.rawInput !== false,
        eventLoopGapThresholdMs: options.eventLoopGapThresholdMs ?? '',
        history: options.history !== false,
        traceTextInput,
        traceAllTextInputs: options.traceAllTextInputs === true,
        traceDeleteInputs: options.traceDeleteInputs !== false,
        tracePasteInputs: options.tracePasteInputs === true,
      }),
    };
    setTextEditMathListeners(true);
    const out = {
      sessionId: id,
      startedAt: textEditSession.startedAt,
      mode: 'passive-event-recording',
      startSnapshot: textEditSession.startSnapshot,
      recordedEventTypes: TEXT_EDIT_EVENT_TYPES.slice(),
      historyRecording: options.history !== false,
      textInputStepTracing: textEditSession.traceTextInput,
      next: 'Do the edit/delete interaction manually, then run finishDebug({ label: "text-box-shrink-after-undo", perf: [["textEditReport", { limit: 1200, eventLimit: 1200, inputStepLimit: 1200 }]], history: ["textUndoRedoReport", "largeTextReport"], clipboard: ["textClipboardReport"], textSel: ["performanceSummary", "clipboardReport", "editLifecycleReport"] }).',
    };
    if (options.log !== false) {
      console.group('[Boardfish perf] text edit passive recorder');
      console.table([{ sessionId: id, mode: out.mode, editingId: out.startSnapshot.editingId, valueLength: out.startSnapshot.valueLength }]);
      console.info(out.next);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function textEditReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    if (options.stop !== false) setTextEditMathListeners(false);
    const session = textEditSession;
    const events = textEditEvents.slice();
    const inputSteps = textEditInputSteps.slice();
    const endSnapshot = textEditSnapshot();
    const out = {
      label: options.label || 'text-edit-passive-events',
      reportedAt: new Date().toISOString(),
      sessionId: session?.id || null,
      mode: 'passive-event-recording',
      startSnapshot: session?.startSnapshot || null,
      endSnapshot,
      eventSummary: textEditEventSummary(events),
      eventTimeline: textEditTimeline({ table: false, limit: options.eventLimit ?? options.limit ?? 400 }),
      inputStepSummary: textEditInputStepSummary(inputSteps),
      inputStepTimeline: textEditInputStepTimeline({ table: false, limit: options.inputStepLimit ?? options.limit ?? 400 }),
      viewport: viewportEventReport(options),
      history: historyTextUndoRedoReport(options),
      markers: markers.slice(),
      notes: [
        'Passive report only: no board mutation, synthetic input, board viewport change, text layout measurement, cache clearing, memory snapshot, restore, or clipboard copy.',
      ],
    };
    out.headline = textEditHeadline(out);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.clear !== false) {
      textEditSession = null;
      textEditLastEventAt = 0;
      textEditInputStepLastAt = 0;
    }
    if (options.log !== false) {
      console.group('[Boardfish perf] text edit passive report');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function textResizeBegin(options = {}) {
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
    if (options.history !== false && BoardfishDebug.history?.enable && BoardfishDebug.history?.reset) {
      BoardfishDebug.history.enable({ verbose: false });
      BoardfishDebug.history.reset();
    }
    if (options.textSelection !== false && typeof TextSelDebug !== 'undefined') {
      TextSelDebug.enable?.({ verbose: false });
      TextSelDebug.reset?.();
    }
    markers.length = 0;
    textResizeEvents.length = 0;
    textEditEvents.length = 0;
    textEditInputSteps.length = 0;
    textResizeLastEventAt = 0;
    textEditLastEventAt = 0;
    textEditInputStepLastAt = 0;
    const id = `text-resize-${nextTextResizeSessionId++}`;
    const startedAt = new Date().toISOString();
    const startedAtMs = performance.now();
    const traceTextInput = options.traceTextInput !== false;
    const traceConfig = traceTextInput
      ? {
          allInputs: options.traceAllTextInputs !== false,
          deleteInputs: options.traceDeleteInputs !== false,
          pasteInputs: options.tracePasteInputs !== false,
        }
      : null;
    textEditSession = {
      id: `${id}:text-input`,
      startedAt,
      startedAtMs,
      startSnapshot: textEditSnapshot(),
      traceTextInput: traceConfig,
      options: sanitizePerfMeta({
        owner: id,
        rawInput: options.rawInput !== false,
        eventLoopGapThresholdMs: options.eventLoopGapThresholdMs ?? '',
        history: options.history !== false,
        traceTextInput,
        traceAllTextInputs: options.traceAllTextInputs !== false,
        traceDeleteInputs: options.traceDeleteInputs !== false,
        tracePasteInputs: options.tracePasteInputs !== false,
      }),
    };
    textResizeSession = {
      id,
      startedAt,
      startedAtMs,
      startSnapshot: textResizeSnapshot({ includeContent: true }),
      textEditStartSnapshot: textEditSession.startSnapshot,
      traceTextInput: traceConfig,
      options: textEditSession.options,
      currentDragId: '',
    };
    setTextEditMathListeners(true);
    const out = {
      sessionId: id,
      startedAt,
      mode: 'passive-text-resize-and-input-recording',
      startSnapshot: textResizeSession.startSnapshot,
      textEditStartSnapshot: textResizeSession.textEditStartSnapshot,
      recordedEventTypes: TEXT_EDIT_EVENT_TYPES.slice(),
      historyRecording: options.history !== false,
      textSelectionRecording: options.textSelection !== false,
      textInputStepTracing: traceConfig,
      next: 'Resize the large text box, then perform the delayed input action and run finishDebug({ label: "large-text-resize-input-delay", perf: [["textResizeReport", { limit: 800, eventLimit: 1200, inputStepLimit: 1200 }]], viewport: ["report"], history: ["textUndoRedoReport"], textSel: ["performanceSummary", "enterEditReport", "editLifecycleReport"] }).',
    };
    if (options.log !== false) {
      console.group('[Boardfish perf] text resize passive recorder');
      console.table([{
        sessionId: id,
        objectId: out.startSnapshot.objectId,
        contentChars: out.startSnapshot.contentChars,
        logicalLines: out.startSnapshot.logicalLines,
        w: out.startSnapshot.w,
        h: out.startSnapshot.h,
      }]);
      console.info(out.next);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function textResizeReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    if (options.stop !== false) setTextEditMathListeners(false);
    const session = textResizeSession;
    const events = textResizeEvents.slice();
    const domEvents = textEditEvents.slice();
    const inputSteps = textEditInputSteps.slice();
    const out = {
      label: options.label || 'large-text-resize-input-delay',
      reportedAt: new Date().toISOString(),
      sessionId: session?.id || null,
      mode: 'passive-text-resize-and-input-recording',
      startSnapshot: session?.startSnapshot || null,
      endSnapshot: textResizeSnapshot({ includeContent: true }),
      textEditStartSnapshot: session?.textEditStartSnapshot || null,
      textEditEndSnapshot: textEditSnapshot(),
      resizeSummary: textResizeSummary(events),
      resizeTimeline: textResizeTimeline({ table: false, limit: options.resizeLimit ?? options.limit ?? 800 }),
      eventSummary: textEditEventSummary(domEvents),
      eventTimeline: textEditTimeline({ table: false, limit: options.eventLimit ?? options.limit ?? 800 }),
      inputStepSummary: textEditInputStepSummary(inputSteps),
      inputStepTimeline: textEditInputStepTimeline({ table: false, limit: options.inputStepLimit ?? options.limit ?? 800 }),
      viewport: viewportEventReport(options),
      history: historyTextUndoRedoReport(options),
      markers: markers.slice(),
      notes: [
        'Passive report only: no board mutation, synthetic input, board viewport change, text layout measurement, cache clearing, memory snapshot, restore, or clipboard copy.',
        'Resize timeline records requested moves separately from rAF-applied resize work so pointer backlog and layout/render cost can be distinguished.',
        'Text resize frames keep auto-height and board redraw live; liveAutoHeightCommits and cacheKeyedAutoHeightCommits show the optimized path.',
      ],
    };
    out.headline = textResizeHeadline(out);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.clear !== false) {
      textResizeSession = null;
      textEditSession = null;
      textResizeLastEventAt = 0;
      textEditLastEventAt = 0;
      textEditInputStepLastAt = 0;
    }
    if (options.log !== false) {
      console.group('[Boardfish perf] text resize/input passive report');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function textBoardSummary(options = {}) {
    const includeLayout = options.layout === true;
    const viewportRect = typeof viewportWorldRect === 'function' ? viewportWorldRect(0) : null;
    const rows = [];
    let totalChars = 0;
    let totalLogicalLines = 0;
    let totalRenderedLines = 0;
    let visibleTextObjects = 0;
    let maxChars = 0;
    let maxLogicalLines = 0;
    let maxRenderedLines = 0;

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
      if (visible) visibleTextObjects++;
      totalChars += chars;
      totalLogicalLines += logicalLines;
      maxChars = Math.max(maxChars, chars);
      maxLogicalLines = Math.max(maxLogicalLines, logicalLines);
      rows.push({
        id: obj.id,
        chars,
        logicalLines,
        renderedLines,
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

    const viewportRect = typeof viewportWorldRect === 'function' ? viewportWorldRect(0) : null;
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

  function normalizeLargeTextPanningMode(value = 'manual-sequence') {
    const mode = String(value || 'manual-sequence').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (
      mode === 'manual' ||
      mode === 'manual-sequence' ||
      mode === 'sequence' ||
      mode === 'all' ||
      mode === 'all-variants' ||
      mode === 'current-board'
    ) return 'manual-sequence';
    if (
      mode === 'plain' ||
      mode === 'view' ||
      mode === 'screen' ||
      mode === 'large-text' ||
      mode === 'large-text-on-screen'
    ) return 'plain';
    if (
      mode === 'select' ||
      mode === 'selected' ||
      mode === 'selection' ||
      mode === 'select-mode' ||
      mode === 'selection-mode' ||
      mode === 'object-selection' ||
      mode === 'large-text-select-mode'
    ) return 'select';
    if (
      mode === 'edit' ||
      mode === 'editing' ||
      mode === 'edit-mode' ||
      mode === 'edti-mode' ||
      mode === 'large-text-edit-mode'
    ) return 'edit';
    if (
      mode === 'highlight' ||
      mode === 'text-highlight' ||
      mode === 'edit-highlight' ||
      mode === 'edit-mode-highlight' ||
      mode === 'editing-highlight' ||
      mode === 'large-text-edit-mode-highlight'
    ) return 'edit-highlight';
    if (mode.includes('highlight')) return 'edit-highlight';
    if (mode.includes('edit') || mode.includes('edti')) return 'edit';
    if (mode.includes('select')) return 'select';
    return 'plain';
  }

  function largeTextPanningLabelForMode(mode) {
    if (mode === 'manual-sequence') return 'large-text-pan-manual-sequence';
    if (mode === 'select') return 'large-text-pan-select-mode';
    if (mode === 'edit') return 'large-text-pan-edit-mode';
    if (mode === 'edit-highlight') return 'large-text-pan-edit-highlight';
    return 'large-text-pan-plain';
  }

  function largeTextPrimaryObject(options = {}) {
    const objectId = options.objectId || largeTextPanningSession?.objectId || '';
    if (objectId && typeof objectsMap !== 'undefined') {
      const requested = objectsMap.get(objectId);
      if (requested?.type === 'text') return requested;
    }
    const texts = textObjectList();
    if (!texts.length) return null;
    if (options.objectIndex == null) {
      return texts.slice().sort((a, b) => (
        normalizeTextContent(b?.data?.content || '').length -
        normalizeTextContent(a?.data?.content || '').length
      ))[0];
    }
    const index = Math.max(0, Math.min(texts.length - 1, Math.trunc(Number(options.objectIndex) || 0)));
    return texts[index];
  }

  function textIndexAtLine(content, targetLine) {
    const line = Math.max(0, Math.trunc(Number(targetLine) || 0));
    if (!line) return 0;
    let currentLine = 0;
    for (let index = 0; index < content.length; index++) {
      if (content[index] !== '\n') continue;
      currentLine++;
      if (currentLine >= line) return index + 1;
    }
    return content.length;
  }

  function largeTextSelectionRangeForObject(obj, options = {}) {
    const content = normalizeTextContent(obj?.data?.content || '');
    const length = content.length;
    const line = clampInteger(options.selectionStartLine ?? options.highlightStartLine ?? options.caretLine, 5, 0, 100000);
    const lines = clampInteger(options.selectionLines ?? options.highlightLines, 20, 1, 2000);
    const explicitStart = Number(options.selectionStart ?? options.highlightStart);
    const start = Math.max(0, Math.min(length, Number.isFinite(explicitStart)
      ? Math.trunc(explicitStart)
      : textIndexAtLine(content, line)));
    const explicitEnd = Number(options.selectionEnd ?? options.highlightEnd);
    const explicitChars = Number(options.selectionChars ?? options.highlightChars);
    let end = Number.isFinite(explicitEnd)
      ? Math.trunc(explicitEnd)
      : Number.isFinite(explicitChars)
        ? start + Math.max(1, Math.trunc(explicitChars))
        : textIndexAtLine(content, line + lines);
    end = Math.max(start, Math.min(length, end));
    if (end <= start && length > start) end = Math.min(length, start + Math.min(2000, length - start));
    return { start, end, selectedChars: Math.max(0, end - start), direction: 'forward' };
  }

  function largeTextInteractionSnapshot(options = {}) {
    const obj = largeTextPrimaryObject(options);
    const content = normalizeTextContent(
      typeof textEditProxyValue === 'function' && _editEl
        ? textEditProxyValue(_editEl)
        : (obj?.data?.content || '')
    );
    const selectionStart = _editEl?.selectionStart ?? '';
    const selectionEnd = _editEl?.selectionEnd ?? '';
    const selectedChars = Number.isFinite(selectionStart) && Number.isFinite(selectionEnd)
      ? Math.abs(selectionEnd - selectionStart)
      : '';
    const viewportRect = typeof viewportWorldRect === 'function' ? viewportWorldRect(0) : null;
    return sanitizePerfMeta({
      mode: options.mode || largeTextPanningSession?.mode || '',
      objectId: obj?.id || '',
      objectFound: !!obj,
      selectedId: typeof selectedId !== 'undefined' ? (selectedId || '') : '',
      selectedCount: typeof selectedIds !== 'undefined' ? selectedIds.size : '',
      selectedIds: typeof selectedIds !== 'undefined' ? [...selectedIds].slice(0, 20).join(',') : '',
      editingId: typeof editingId !== 'undefined' ? (editingId || '') : '',
      hasEditProxy: !!_editEl,
      activeElementIsProxy: typeof document !== 'undefined' ? document.activeElement === _editEl : '',
      proxyChars: typeof _editEl?.value === 'string' ? _editEl.value.length : '',
      logicalProxyChars: typeof textEditProxyValue === 'function' && _editEl ? textEditProxyValue(_editEl).length : '',
      domValueStale: !!_editEl?._boardfishDomValueStale,
      selectionStart,
      selectionEnd,
      selectionDirection: _editEl?.selectionDirection || '',
      selectedChars,
      contentChars: content.length,
      logicalLines: countTextLines(content),
      layoutCachePresent: !!obj?._layoutCache,
      layoutCacheLines: Array.isArray(obj?._layoutCache) ? obj._layoutCache.length : '',
      wrappedLineIndexPresent: !!obj?._textWrappedLineIndexCache,
      wrappedLineIndexEntries: obj?._textWrappedLineIndexCache?.entries?.length ?? '',
      wrappedLineIndexLines: obj?._textWrappedLineIndexCache?.lineCount ?? '',
      wrappedLineCountCachePresent: Number.isFinite(obj?._textWrappedLineCountCacheValue),
      paragraphPrefixCacheEntries: obj?._textParagraphPrefixCache?.size ?? '',
      x: obj?.x ?? '',
      y: obj?.y ?? '',
      w: obj?.w ?? '',
      h: obj?.h ?? '',
      zoom: typeof zoom !== 'undefined' ? zoom : '',
      panX: typeof panX !== 'undefined' ? panX : '',
      panY: typeof panY !== 'undefined' ? panY : '',
      viewportX1: viewportRect?.x1 ?? '',
      viewportY1: viewportRect?.y1 ?? '',
      viewportX2: viewportRect?.x2 ?? '',
      viewportY2: viewportRect?.y2 ?? '',
    });
  }

  function setLargeTextEditSelection(obj, range, highlight) {
    if (!_editEl || !obj) return false;
    const value = typeof textEditProxyValue === 'function'
      ? textEditProxyValue(_editEl)
      : String(_editEl.value ?? '');
    if (highlight) {
      if (typeof setTextEditProxySelectionRange === 'function') {
        setTextEditProxySelectionRange(_editEl, range.start, range.end, range.direction || 'forward', value);
      } else {
        _editEl.setSelectionRange(range.start, range.end, range.direction || 'forward');
      }
      if (typeof clearTextEditCaretIndex === 'function') clearTextEditCaretIndex(obj);
      else {
        delete obj._textEditCaretIndex;
        delete obj._textEditCaretLineStartIndex;
      }
    } else {
      if (typeof setTextEditProxySelectionRange === 'function') {
        setTextEditProxySelectionRange(_editEl, range.start, range.start, 'none', value);
      } else {
        _editEl.setSelectionRange(range.start, range.start, 'none');
      }
      if (typeof setTextEditCaretIndex === 'function') setTextEditCaretIndex(obj, range.start, null, true);
      else obj._textEditCaretIndex = range.start;
    }
    _caretVisible = true;
    if (typeof focusTextEditProxyNow === 'function') {
      focusTextEditProxyNow(_editEl, obj, 'large-text-panning-focus', {
        phase: 'large-text-panning-state',
        highlight,
        selectionStart: _editEl.selectionStart ?? '',
        selectionEnd: _editEl.selectionEnd ?? '',
      });
    } else {
      _editEl.focus?.({ preventScroll: true });
    }
    if (typeof TextSelDebug !== 'undefined') {
      TextSelDebug._logSelection?.('large-text-panning-state', _editEl, obj);
    }
    scheduleRender(true, false, 'large-text-panning-edit-selection');
    return true;
  }

  function applyLargeTextPanningState(mode, options = {}) {
    const normalizedMode = normalizeLargeTextPanningMode(mode);
    const obj = largeTextPrimaryObject(options);
    if (!obj) return { skipped: true, reason: 'no-text-object', mode: normalizedMode };

    if (normalizedMode === 'plain') {
      if (editingId && typeof exitEdit === 'function') exitEdit();
      BoardfishEditorState.clearSelection();
      scheduleRender(true, true, 'large-text-panning-plain');
      return { mode: normalizedMode, objectId: obj.id, startSnapshot: largeTextInteractionSnapshot({ objectId: obj.id, mode: normalizedMode }) };
    }

    if (editingId && editingId !== obj.id && typeof exitEdit === 'function') exitEdit();
    BoardfishEditorState.setSelection([obj.id], {
      primaryId: obj.id,
      exitEditing: false,
    });

    if (normalizedMode === 'select') {
      if (editingId && typeof exitEdit === 'function') exitEdit();
      scheduleRender(true, true, 'large-text-panning-select');
      return { mode: normalizedMode, objectId: obj.id, startSnapshot: largeTextInteractionSnapshot({ objectId: obj.id, mode: normalizedMode }) };
    }

    if (typeof enterEdit !== 'function') {
      return { skipped: true, reason: 'enterEdit-unavailable', mode: normalizedMode, objectId: obj.id };
    }

    enterEdit(obj.id, {
      history: false,
      preserveSize: true,
      placeInitialCaret: false,
    });
    const range = largeTextSelectionRangeForObject(obj, options);
    const highlighted = normalizedMode === 'edit-highlight';
    setLargeTextEditSelection(obj, range, highlighted);
    return {
      mode: normalizedMode,
      objectId: obj.id,
      editSelection: range,
      highlighted,
      startSnapshot: largeTextInteractionSnapshot({ objectId: obj.id, mode: normalizedMode }),
    };
  }

  function currentLargeTextPanningState(mode, options = {}) {
    const obj = largeTextPrimaryObject(options);
    return {
      mode,
      objectId: obj?.id || '',
      manual: true,
      startSnapshot: largeTextInteractionSnapshot({ objectId: obj?.id || '', mode }),
    };
  }

  function resetLargeTextPanningRecorders(options = {}) {
    BoardfishDebug.viewport.enable({
      verbose: false,
      rawInput: options.rawInput !== false,
      eventLoopGapThresholdMs: options.eventLoopGapThresholdMs,
    });
    BoardfishDebug.viewport.reset();
    if (options.history !== false && BoardfishDebug.history?.enable && BoardfishDebug.history?.reset) {
      BoardfishDebug.history.enable({ verbose: false });
      BoardfishDebug.history.reset();
    }
    if (options.textSelection !== false && typeof TextSelDebug !== 'undefined') {
      TextSelDebug.enable?.({ verbose: false });
      TextSelDebug.reset?.();
    }
    markers.length = 0;
    textEditEvents.length = 0;
    textEditInputSteps.length = 0;
    textEditLastEventAt = 0;
    textEditInputStepLastAt = 0;
  }

  async function largeTextPanningBegin(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    setTextEditMathListeners(false);
    largeTextPanningSession = null;
    const mode = normalizeLargeTextPanningMode(options.mode ?? options.scenario ?? options.state);
    const state = options.applyState === true && mode !== 'manual-sequence'
      ? applyLargeTextPanningState(mode, options)
      : currentLargeTextPanningState(mode, options);
    if (state?.skipped) {
      console.warn(`[Boardfish perf] Large text panning state skipped: ${state.reason}`);
      return state;
    }

    await animationFrame();
    await animationFrame();
    resetLargeTextPanningRecorders(options);

    const layoutPrewarm = options.prewarmLayout === false || typeof prewarmVisibleTextLayoutCaches !== 'function'
      ? null
      : prewarmVisibleTextLayoutCaches({
          source: 'large-text-panning-begin',
          padScreenPx: options.prewarmPadScreenPx ?? 1024,
          minChars: options.prewarmMinChars ?? 1024,
          maxObjects: options.prewarmMaxObjects ?? 100,
          fullLineCache: options.prewarmFullLineCache === true,
          fullLineCacheMaxLines: options.prewarmFullLineCacheMaxLines ?? 8192,
          limit: options.prewarmLimit ?? 8,
        });

    const id = `large-text-pan-${nextLargeTextPanningSessionId++}`;
    const startedAt = new Date().toISOString();
    const startedAtMs = performance.now();
    const startSnapshot = largeTextInteractionSnapshot({ objectId: state.objectId, mode });
    const traceConfig = options.traceTextInput === true
      ? {
          allInputs: options.traceAllTextInputs === true,
          deleteInputs: options.traceDeleteInputs !== false,
          pasteInputs: options.tracePasteInputs === true,
        }
      : null;
    largeTextPanningSession = {
      id,
      startedAt,
      startedAtMs,
      mode,
      objectId: state.objectId,
      startSnapshot,
      layoutPrewarm,
      editSelection: state.editSelection || null,
      options: sanitizePerfMeta({
        applyState: options.applyState === true,
        prewarmLayout: options.prewarmLayout !== false,
        prewarmPadScreenPx: options.prewarmPadScreenPx ?? 1024,
        prewarmMinChars: options.prewarmMinChars ?? 1024,
        rawInput: options.rawInput !== false,
        history: options.history !== false,
        textSelection: options.textSelection !== false,
        eventLoopGapThresholdMs: options.eventLoopGapThresholdMs ?? '',
      }),
    };
    textEditSession = {
      id: `${id}:dom-events`,
      startedAt,
      startedAtMs,
      startSnapshot: textEditSnapshot(),
      traceTextInput: traceConfig,
      options: sanitizePerfMeta({
        owner: id,
        mode,
        rawInput: options.rawInput !== false,
        traceTextInput: !!traceConfig,
      }),
    };
    setTextEditMathListeners(true);
    sessionStartMemory = options.memory === false ? null : await memorySnapshot('large-text-panning-begin', { ...options, table: false });
    largeTextPanningSession.memoryStart = sessionStartMemory;
    const out = {
      sessionId: id,
      startedAt,
      mode,
      startSnapshot,
      layoutPrewarm,
      memoryStart: sessionStartMemory,
      recordedEventTypes: TEXT_EDIT_EVENT_TYPES.slice(),
      next: `Pan the already-open board through the four variants, then run finishDebug({ label: "${largeTextPanningLabelForMode(mode)}", perf: [["largeTextPanningReport"]] }).`,
    };
    if (options.log !== false) {
      console.group('[Boardfish perf] large text panning recorder');
      console.table([{
        sessionId: id,
        mode,
        objectId: startSnapshot.objectId,
        contentChars: startSnapshot.contentChars,
        logicalLines: startSnapshot.logicalLines,
        selectedChars: startSnapshot.selectedChars,
        editingId: startSnapshot.editingId,
        zoom: startSnapshot.zoom,
        prewarmMs: layoutPrewarm?.totalMs ?? '',
        prewarmObjects: layoutPrewarm?.warmedTextObjects ?? '',
      }]);
      console.info(out.next);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function largeTextSelectionDebugReport(options = {}) {
    if (options.textSelection === false) return { available: false, reason: 'disabled' };
    if (typeof TextSelDebug === 'undefined') return { available: false, reason: 'TextSelDebug unavailable' };
    const out = {
      available: true,
      performanceSummary: TextSelDebug.performanceSummary?.() || null,
      selectionReport: editingId ? TextSelDebug.selectionReport?.({
        neighborLines: options.neighborLines ?? 3,
      }) : null,
      editLifecycleReport: TextSelDebug.editLifecycleReport?.() || null,
    };
    if (options.includeTextSelectionEvents !== false) out.events = TextSelDebug.events || [];
    return out;
  }

  function largeTextPanningHeadline(report = {}) {
    const eventSummary = report.eventSummary || {};
    const frame = report.viewport?.frameSummary || {};
    const wheel = report.viewport?.wheelSummary || {};
    const draw = report.viewport?.drawSummary || {};
    const transform = report.viewport?.transformSummary || {};
    const prewarm = report.layoutPrewarm || {};
    return {
      mode: report.mode || '',
      contentChars: report.startSnapshot?.contentChars ?? '',
      logicalLines: report.startSnapshot?.logicalLines ?? '',
      selectedCharsStart: report.startSnapshot?.selectedChars ?? '',
      selectedCharsEnd: report.endSnapshot?.selectedChars ?? '',
      prewarmTextObjects: prewarm.warmedTextObjects ?? '',
      prewarmTotalMs: prewarm.totalMs ?? '',
      prewarmMaxObjectMs: prewarm.maxObjectMs ?? '',
      prewarmVisibleLines: prewarm.warmedVisibleLines ?? '',
      prewarmTotalLines: prewarm.warmedTotalLines ?? '',
      domEvents: eventSummary.events ?? '',
      wheel: eventSummary.wheel ?? '',
      pointermove: eventSummary.pointermove ?? '',
      mousemove: eventSummary.mousemove ?? '',
      maxDomEventGapMs: eventSummary.maxGapMs ?? '',
      domGapsOver32ms: eventSummary.gapsOver32ms ?? '',
      frames: frame.frames ?? '',
      inputFrames: frame.inputFrames ?? '',
      slowFramesOver16ms: frame.slowFramesOver16ms ?? '',
      maxFrameMs: frame.maxFrameMs ?? '',
      maxInputAgeMs: frame.maxInputAgeMs ?? '',
      maxQueueMs: frame.maxQueueMs ?? '',
      rawInputEvents: frame.rawInputEvents ?? '',
      wheelPanEvents: wheel.panEvents ?? '',
      maxWheelGapMs: wheel.maxWheelGapMs ?? '',
      avgDrawMs: draw.avgDrawMs ?? '',
      maxDrawMs: draw.maxDrawMs ?? '',
      maxObjectLoopMs: draw.maxObjectLoopMs ?? '',
      maxEditingOverlayMs: draw.maxEditingOverlayMs ?? '',
      maxEditLayoutMs: draw.maxEditLayoutMs ?? '',
      maxEditTextDrawMs: draw.maxEditTextDrawMs ?? '',
      maxEditSelectionMs: draw.maxEditSelectionMs ?? '',
      maxEditSelectedChars: draw.maxEditSelectedChars ?? '',
      maxEditSelectionLines: draw.maxEditSelectionLines ?? '',
      maxEditSelectionVisibleLines: draw.maxEditSelectionVisibleLines ?? '',
      avgTransformMs: transform.avgTotalMs ?? '',
      maxTransformMs: transform.maxTotalMs ?? '',
      viewportEvents: Array.isArray(report.viewportEvents) ? report.viewportEvents.length : '',
    };
  }

  async function largeTextPanningReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    if (options.stop !== false) setTextEditMathListeners(false);
    const session = largeTextPanningSession;
    const events = textEditEvents.slice();
    const mode = session?.mode || normalizeLargeTextPanningMode(options.mode ?? options.scenario ?? options.state);
    const endSnapshot = largeTextInteractionSnapshot({ objectId: session?.objectId || options.objectId || '', mode });
    const memoryEnd = options.memory === false ? null : await memorySnapshot('large-text-panning-finish', { ...options, table: false });
    const viewport = BoardfishDebug.viewport.report({
      log: false,
      details: options.details !== false,
      limit: options.limit || 80,
      eventLoopLimit: options.eventLoopLimit ?? options.limit ?? 10000,
      rawInputLimit: options.rawInputLimit ?? options.limit ?? 10000,
      slowFrames: options.slowFrames ?? options.limit ?? 200,
    });
    const viewportEvents = options.includeViewportEvents === false
      ? null
      : (BoardfishDebug.viewport.events || []);
    const out = {
      label: options.label || largeTextPanningLabelForMode(mode),
      reportedAt: new Date().toISOString(),
      sessionId: session?.id || null,
      mode,
      startSnapshot: session?.startSnapshot || null,
      endSnapshot,
      editSelection: session?.editSelection || null,
      layoutPrewarm: session?.layoutPrewarm || null,
      latestLayoutPrewarm: typeof getLastVisibleTextLayoutPrewarm === 'function'
        ? getLastVisibleTextLayoutPrewarm()
        : null,
      textSummary: textBoardSummary({
        table: false,
        layout: options.layout === true,
        limit: options.textLimit ?? options.limit ?? 20,
      }),
      eventSummary: textEditEventSummary(events),
      eventTimeline: textEditTimeline({ table: false, limit: options.eventLimit ?? options.limit ?? TEXT_EDIT_MAX_EVENTS }),
      viewport,
      viewportEvents,
      textSelection: largeTextSelectionDebugReport(options),
      history: options.history === false ? null : historyTextUndoRedoReport(options),
      memoryStart: session?.memoryStart || sessionStartMemory,
      memoryEnd,
      memoryDelta: memoryDelta(session?.memoryStart || sessionStartMemory, memoryEnd),
      markers: markers.slice(),
      notes: [
        'Panning report is passive: no synthetic board, pan, zoom, cache clearing, or board content mutation is performed while measuring.',
        'Begin can optionally prewarm runtime text layout caches for the already-open visible board; pass prewarmLayout: false to disable that warmup.',
        'viewportEvents contains the retained raw viewport event buffer, including raw move/wheel input, frame timings, draw timings, event-loop gaps, and long tasks.',
      ],
    };
    out.headline = {
      ...largeTextPanningHeadline(out),
      ...(out.memoryDelta || {}),
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.clear !== false) {
      largeTextPanningSession = null;
      textEditSession = null;
      textEditLastEventAt = 0;
      textEditInputStepLastAt = 0;
    }
    if (options.log !== false) {
      console.group('[Boardfish perf] large text panning report');
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
    panZoomReport,
    panningReport,
    wheelPanTest,
    mousePanTest,
    zoomReport,
    wheelZoomTest,
    textBoardSummary,
    measureTextLayoutPass,
    textEditBegin,
    textEditReport,
    textEditTimeline,
    textEditInputStepTimeline,
    isTextEditInputTraceActive,
    recordTextEditInputStep,
    textResizeBegin,
    textResizeReport,
    textResizeTimeline,
    isTextResizeTraceActive,
    startTextResizeDrag,
    recordTextResizeStep,
    finishTextResizeDrag,
    largeTextPanningBegin,
    largeTextPanningReport,
    state,
    json,
    copyLast,
    get last() { return lastReport; },
    get lastJson() { return lastJson; },
  };
})();

exposeDebug({ perf: ManualPerfDebug });
