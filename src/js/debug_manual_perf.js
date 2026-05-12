'use strict';

var ManualPerfDebug = (() => {
  let lastReport = null;
  let lastJson = '';
  const markers = [];

  function imageCount() {
    return (typeof objects === 'undefined' ? [] : objects).filter(obj => obj?.type === 'image').length;
  }

  function headline(report) {
    const viewport = report.viewport || {};
    const eyedropper = report.eyedropper?.totals || {};
    return {
      imageCount: report.imageCount,
      viewportFrames: viewport.frameSummary?.frames ?? '',
      viewportSlowFrames: viewport.frameSummary?.slowFramesOver16ms ?? '',
      viewportMaxFrameMs: viewport.frameSummary?.maxFrameMs ?? '',
      wheelBufferedEvents: viewport.wheelSummary?.bufferedWheelEvents ?? '',
      wheelMaxGapMs: viewport.wheelSummary?.maxWheelGapMs ?? '',
      wheelGapsOver32ms: viewport.wheelSummary?.gapsOver32ms ?? '',
      maxZoomStepPct: viewport.wheelSummary?.maxZoomStepPct ?? '',
      viewportMaxDrawMs: viewport.drawSummary?.maxDrawMs ?? '',
      viewportMaxTestedObjects: viewport.drawSummary?.maxTestedObjects ?? '',
      eyedropperSamples: eyedropper.samples ?? '',
      eyedropperSlowSamples: eyedropper.slowSamples ?? '',
      eyedropperMaxSampleMs: eyedropper.maxSampleMs ?? '',
      eyedropperMaxPrewarmMs: eyedropper.maxPrewarmMs ?? '',
      samplesWithPendingImages: eyedropper.samplesWithPendingImages ?? '',
      samplesWithMissingImages: eyedropper.samplesWithMissingImages ?? '',
      eyedropperEnabled: report.eyedropper?.runtime?.enabled ?? '',
      eyedropperSampling: report.eyedropper?.runtime?.sampling ?? '',
      viewportScaleQueueLength: report.eyedropper?.runtime?.viewportScaleQueueLength ?? '',
      viewportScalePending: report.eyedropper?.runtime?.viewportScalePending ?? '',
    };
  }

  function begin(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    BoardfishDebug.viewport.enable({ verbose: false });
    BoardfishDebug.eyedropper.enable({ verbose: false });
    BoardfishDebug.viewport.reset();
    BoardfishDebug.eyedropper.reset();
    markers.length = 0;
    if (typeof setEyedropperPreviewDiagnosticsEnabled === 'function') {
      setEyedropperPreviewDiagnosticsEnabled(options.previewDiagnostics === true);
    }
    const out = {
      startedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: objects.length,
      previewDiagnostics: options.previewDiagnostics === true,
    };
    console.info('[Boardfish perf] Manual session started. Run the interaction, then call finishDebug({ perf: ["report"] }), finishDebug({ perf: ["zoomReport"] }), or finishDebug({ perf: ["panningReport"] }).');
    console.table([out]);
    return out;
  }

  function mark(label = 'marker') {
    const entry = {
      label,
      at: Math.round(performance.now() * 100) / 100,
      eyedropper: BoardfishDebug.eyedropper.state({ table: false }),
      viewportStats: BoardfishDebug.viewport.stats,
    };
    markers.push(entry);
    console.info(`[Boardfish perf] marker: ${label}`);
    console.table([{
      label: entry.label,
      at: entry.at,
      eyedropperEnabled: entry.eyedropper.enabled,
      eyedropperSampling: entry.eyedropper.sampling,
      loupeVisible: entry.eyedropper.loupeVisible,
      wheel: entry.viewportStats.wheel,
      wheelZoom: entry.viewportStats.wheelZoom,
      transformFrames: entry.viewportStats.transformFrames,
    }]);
    return entry;
  }

  function resetPhase(label = 'phase') {
    BoardfishDebug.viewport.reset();
    BoardfishDebug.eyedropper.reset();
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
      eyedropper: BoardfishDebug.eyedropper.state(),
    };
  }

  function colorpickerZoomReport(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const domState = {
      ctxMenuVisible: !!ctxMenu?.classList.contains('visible'),
      objCtxMenuVisible: !!objCtxMenu?.classList.contains('visible'),
      ctxActionsVisible: !!ctxActions?.classList.contains('visible'),
      bodyEyedropperClass: !!document.body?.classList.contains('eyedropper-enabled'),
      activeElement: document.activeElement?.id || document.activeElement?.tagName || '',
      zoom,
      panX,
      panY,
    };
    const out = {
      label: 'colorpicker-menu-zoom',
      reportedAt: new Date().toISOString(),
      domState,
      perfState: state(),
      menu: typeof BoardfishDebug.menu?.summary === 'function' ? BoardfishDebug.menu.summary({ log: false }) : null,
      eyedropper: BoardfishDebug.eyedropper.report({ log: false, samples: 40, slow: 20, interactions: 30 }),
      viewport: BoardfishDebug.viewport.report({ log: false, details: options.details === true, limit: options.limit || 30 }),
    };
    out.headline = headline(out);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] colorpicker menu zoom');
      console.table([domState]);
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    return out;
  }

  function report(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    const eyedropperReport = BoardfishDebug.eyedropper.report({
      log: false,
      samples: options.samples ?? options.sampleLimit ?? 60,
      slow: options.slow ?? options.slowLimit ?? 60,
      failures: options.failures ?? options.failureLimit ?? 20,
    });
    const out = {
      label: 'manual-eyedropper-viewport-perf',
      reportedAt: new Date().toISOString(),
      imageCount: imageCount(),
      objectCount: objects.length,
      viewport: BoardfishDebug.viewport.report({ log: false, details: options.details === true, limit: options.limit || 12 }),
      eyedropper: eyedropperReport,
      markers: markers.slice(),
    };
    out.headline = headline(out);
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    console.group('[Boardfish perf] manual eyedropper + viewport');
    console.table([out.headline]);
    console.log(out);
    console.groupEnd();
    if (options.copy !== false) void copyLast();
    if (options.previewDiagnostics === false && typeof setEyedropperPreviewDiagnosticsEnabled === 'function') {
      setEyedropperPreviewDiagnosticsEnabled(false);
    }
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

  function animationFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function eyedropperTestPoint(options = {}) {
    if (Number.isFinite(options.clientX) && Number.isFinite(options.clientY)) {
      return { x: Number(options.clientX), y: Number(options.clientY) };
    }
    const rect = (boardCanvas || canvas)?.getBoundingClientRect?.();
    if (!rect) return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
    return {
      x: Math.round(rect.left + rect.width * (Number.isFinite(options.xRatio) ? options.xRatio : 0.5)),
      y: Math.round(rect.top + rect.height * (Number.isFinite(options.yRatio) ? options.yRatio : 0.5)),
    };
  }

  function randomEyedropperTestPoint(options = {}) {
    const rect = (boardCanvas || canvas)?.getBoundingClientRect?.();
    if (!rect) return eyedropperTestPoint(options);
    const margin = Math.max(0, Number(options.marginCss) || 24);
    const minX = rect.left + Math.min(margin, rect.width / 2);
    const maxX = rect.right - Math.min(margin, rect.width / 2);
    const minY = rect.top + Math.min(margin, rect.height / 2);
    const maxY = rect.bottom - Math.min(margin, rect.height / 2);
    return {
      x: Math.round(minX + Math.random() * Math.max(0, maxX - minX)),
      y: Math.round(minY + Math.random() * Math.max(0, maxY - minY)),
    };
  }

  function dispatchEyedropperPointer(type, point, options = {}) {
    const target = boardCanvas || canvas || document.body;
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: type === 'pointerup' || type === 'mouseup' ? 0 : 1,
      pointerId: options.pointerId || 9301,
      pointerType: options.pointerType || 'mouse',
      isPrimary: true,
    };
    const EventCtor = window.PointerEvent && type.startsWith('pointer') ? window.PointerEvent : MouseEvent;
    const eventType = window.PointerEvent ? type : type.replace('pointer', 'mouse');
    target.dispatchEvent(new EventCtor(eventType, init));
  }

  async function eyedropperInitialPreviewTest(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    BoardfishDebug.viewport.enable({ verbose: false });
    BoardfishDebug.eyedropper.enable({ verbose: false });
    BoardfishDebug.viewport.reset();
    BoardfishDebug.eyedropper.reset();
    markers.length = 0;
    if (typeof setEyedropperPreviewDiagnosticsEnabled === 'function') {
      setEyedropperPreviewDiagnosticsEnabled(options.previewDiagnostics === true);
    }
    if (!eyedropperEnabled && typeof setEyedropperEnabled === 'function') setEyedropperEnabled(true);
    if (typeof hideEyedropperSample === 'function') hideEyedropperSample();
    await animationFrame();

    const count = Math.max(1, Math.min(50, Number(options.count) || 1));
    const random = options.random === true || count > 1;
    const points = [];
    const startedAt = performance.now();
    for (let index = 0; index < count; index++) {
      if (typeof hideEyedropperSample === 'function') hideEyedropperSample();
      await animationFrame();
      const point = random ? randomEyedropperTestPoint(options) : eyedropperTestPoint(options);
      points.push(point);
      dispatchEyedropperPointer('pointerdown', point, { ...options, pointerId: 9301 + index });
      await animationFrame();
      await animationFrame();
      if (options.release !== false) dispatchEyedropperPointer('pointerup', point, { ...options, pointerId: 9301 + index });
      await animationFrame();
    }

    const eyedropperReport = BoardfishDebug.eyedropper.report({
      log: false,
      samples: options.samples ?? Math.max(10, count * 2),
      first: options.first ?? Math.max(10, count),
      present: options.present ?? Math.max(10, count),
      slow: options.slow ?? Math.max(10, count),
    });
    const out = {
      label: 'eyedropper-initial-preview-test',
      reportedAt: new Date().toISOString(),
      count,
      random,
      testPoints: points,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      eyedropper: eyedropperReport,
      viewport: BoardfishDebug.viewport.report({ log: false, details: false, limit: options.limit || 8 }),
    };
    out.headline = {
      samples: eyedropperReport.totals?.samples ?? '',
      firstSamples: eyedropperReport.totals?.firstSamples ?? '',
      maxFirstSampleMs: eyedropperReport.totals?.maxFirstSampleMs ?? '',
      maxSampleMs: eyedropperReport.totals?.maxSampleMs ?? '',
      maxClickToPreviewVisibleMs: eyedropperReport.perf?.maxClickToPreviewVisibleMs ?? '',
      maxClickToPreviewFrameMs: eyedropperReport.perf?.maxClickToPreviewFrameMs ?? '',
      maxEventToPreviewFrameMs: eyedropperReport.perf?.maxEventToPreviewFrameMs ?? '',
      samplesWithPendingImages: eyedropperReport.totals?.samplesWithPendingImages ?? '',
      samplesWithMissingImages: eyedropperReport.totals?.samplesWithMissingImages ?? '',
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] eyedropper initial preview test');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    if (typeof setEyedropperPreviewDiagnosticsEnabled === 'function') {
      setEyedropperPreviewDiagnosticsEnabled(false);
    }
    return out;
  }

  async function eyedropperContinuousPreviewTest(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish perf] Debug tools are disabled in this build.');
      return null;
    }
    BoardfishDebug.viewport.enable({ verbose: false });
    BoardfishDebug.eyedropper.enable({ verbose: false });
    BoardfishDebug.viewport.reset();
    BoardfishDebug.eyedropper.reset();
    markers.length = 0;
    if (typeof setEyedropperPreviewDiagnosticsEnabled === 'function') {
      setEyedropperPreviewDiagnosticsEnabled(options.previewDiagnostics === true);
    }
    if (!eyedropperEnabled && typeof setEyedropperEnabled === 'function') setEyedropperEnabled(true);
    if (typeof hideEyedropperSample === 'function') hideEyedropperSample();
    await animationFrame();

    const moves = Math.max(1, Math.min(240, Number(options.moves) || 48));
    const pointerId = Number(options.pointerId) || 9401;
    const start = eyedropperTestPoint({
      ...options,
      xRatio: Number.isFinite(options.startXRatio) ? options.startXRatio : 0.35,
      yRatio: Number.isFinite(options.startYRatio) ? options.startYRatio : 0.45,
    });
    const end = eyedropperTestPoint({
      ...options,
      xRatio: Number.isFinite(options.endXRatio) ? options.endXRatio : 0.65,
      yRatio: Number.isFinite(options.endYRatio) ? options.endYRatio : 0.55,
    });
    const points = [];
    const startedAt = performance.now();
    dispatchEyedropperPointer('pointerdown', start, { ...options, pointerId });
    await animationFrame();
    for (let index = 0; index < moves; index++) {
      const t = moves <= 1 ? 1 : index / (moves - 1);
      const wave = Math.sin(t * Math.PI * 2) * (Number(options.waveCss) || 18);
      const point = {
        x: Math.round(start.x + (end.x - start.x) * t),
        y: Math.round(start.y + (end.y - start.y) * t + wave),
      };
      points.push(point);
      dispatchEyedropperPointer('pointermove', point, { ...options, pointerId });
      if (options.framePerMove !== false) await animationFrame();
    }
    await animationFrame();
    if (options.release !== false) dispatchEyedropperPointer('pointerup', points.at(-1) || end, { ...options, pointerId });
    await animationFrame();
    await animationFrame();

    const eyedropperReport = BoardfishDebug.eyedropper.report({
      log: false,
      samples: options.samples ?? Math.max(60, moves + 4),
      first: options.first ?? 12,
      present: options.present ?? Math.max(60, moves + 4),
      slow: options.slow ?? 60,
      timeline: options.timeline ?? Math.max(120, moves * 3),
    });
    const out = {
      label: 'eyedropper-continuous-preview-test',
      reportedAt: new Date().toISOString(),
      moves,
      framePerMove: options.framePerMove !== false,
      start,
      end,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      eyedropper: eyedropperReport,
      viewport: BoardfishDebug.viewport.report({ log: false, details: false, limit: options.limit || 12 }),
    };
    out.headline = {
      samples: eyedropperReport.totals?.samples ?? '',
      firstSamples: eyedropperReport.totals?.firstSamples ?? '',
      slowSamples: eyedropperReport.totals?.slowSamples ?? '',
      maxSampleMs: eyedropperReport.totals?.maxSampleMs ?? '',
      maxClickToPreviewVisibleMs: eyedropperReport.perf?.maxClickToPreviewVisibleMs ?? '',
      maxClickToPreviewFrameMs: eyedropperReport.perf?.maxClickToPreviewFrameMs ?? '',
      maxEventToPreviewFrameMs: eyedropperReport.perf?.maxEventToPreviewFrameMs ?? '',
      coalescedMoves: eyedropperReport.totals?.coalescedMoves ?? '',
      samplesWithPendingImages: eyedropperReport.totals?.samplesWithPendingImages ?? '',
      samplesWithMissingImages: eyedropperReport.totals?.samplesWithMissingImages ?? '',
    };
    lastReport = out;
    lastJson = JSON.stringify(out, null, 2);
    if (options.log !== false) {
      console.group('[Boardfish perf] eyedropper continuous preview test');
      console.table([out.headline]);
      console.log(out);
      console.groupEnd();
    }
    if (typeof setEyedropperPreviewDiagnosticsEnabled === 'function') {
      setEyedropperPreviewDiagnosticsEnabled(false);
    }
    return out;
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
      objectCount: objects.length,
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
      objectCount: objects.length,
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
    eyedropperInitialPreviewTest,
    eyedropperContinuousPreviewTest,
    colorpickerZoomReport,
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
