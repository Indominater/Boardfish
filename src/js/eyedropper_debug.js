'use strict';

var EyedropperDebug = (() => {
  const core = createDebugRecorder({
    maxEvents: 2500,
    label: '[Boardfish eyedropper]',
    sanitize: (value) => sanitizeDebugMeta(value, { roundNumbers: true }),
  });
  const events = core._events;
  let lastSample = null;
  const MAX_SLOW_SAMPLES = 80;
  const MAX_FIRST_SAMPLES = 40;
  const SLOW_SAMPLE_MS = 16.7;
  const MAX_PREVIEW_MISMATCH_SAMPLES = 80;
  const MAX_PREVIEW_PRESENT_SAMPLES = 80;
  const MAX_LONG_TASKS = 80;
  const MAX_FRAME_GAPS = 80;
  const STUTTER_FRAME_GAP_MS = 120;
  const slowSamples = [];
  const firstSamples = [];
  const previewMismatchSamples = [];
  const previewPresentSamples = [];
  const slowPreviewPresentSamples = [];
  const longTasks = [];
  const frameGaps = [];
  let longTaskObserver = null;
  let frameProbeRaf = null;
  let lastFrameProbeAt = 0;
  let lastSamplingEvent = null;
  const phaseStats = {};
  const perfStats = {
    sampleMoves: 0,
    sampleCommits: 0,
    firstSamples: 0,
    sampleCoalescedMoves: 0,
    prewarmRunsTimed: 0,
    slowSamples: 0,
    maxSampleMs: 0,
    maxFirstSampleMs: 0,
    maxPrewarmMs: 0,
    maxInputAgeMs: 0,
    maxQueueDelayMs: 0,
    maxPointerDeltaPx: 0,
    maxFrameCoalescedMoves: 0,
    maxClickToPreviewVisibleMs: 0,
    maxEventToPreviewVisibleMs: 0,
    maxClickToPreviewFrameMs: 0,
    maxEventToPreviewFrameMs: 0,
    previewReadableSamples: 0,
    previewUnreadableSamples: 0,
    previewBlankSamples: 0,
    previewColorMismatches: 0,
    longTasks: 0,
    maxLongTaskMs: 0,
    frameGaps: 0,
    maxFrameGapMs: 0,
    stuttersOver120ms: 0,
    stuttersOver200ms: 0,
    stuttersOver300ms: 0,
  };
  const stats = {
    interactionEvents: 0,
    interactionStarts: 0,
    interactionBlocks: 0,
    readbackFailures: 0,
    fallbackSamples: 0,
    unsafeImageSkips: 0,
    safeDisplayImages: 0,
    safeDisplayProbeFailures: 0,
    safeDataUrlImages: 0,
    safeDataUrlLoads: 0,
    safeDataUrlPending: 0,
    nativeSourceHydrationSkipped: 0,
    safeScaledEvictions: 0,
    safeScaledMemorySkips: 0,
    nativePixelRequests: 0,
    nativePixelReady: 0,
    nativePixelResolveMisses: 0,
    nativePixelBusySkips: 0,
    nativePixelReadoutPending: 0,
  };

  function statKey(where) {
    return String(where || 'unknown').replace(/[^a-z0-9]+(.)?/gi, (_, ch) => ch ? ch.toUpperCase() : '');
  }

  function countStat(key, amount = 1) {
    if (!core.enabled) return;
    stats[key] = (stats[key] || 0) + amount;
  }

  function roundMs(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function recordPhase(name, ms) {
    if (!core.enabled || !name) return;
    const value = Number(ms) || 0;
    const stat = phaseStats[name] || { count: 0, totalMs: 0, maxMs: 0 };
    stat.count++;
    stat.totalMs += value;
    stat.maxMs = Math.max(stat.maxMs, value);
    phaseStats[name] = stat;
  }

  function recordPhases(timings = {}) {
    if (!core.enabled) return;
    for (const [name, ms] of Object.entries(timings)) {
      if (name.endsWith('Changed')) continue;
      recordPhase(name, ms);
    }
  }

  function compactTimings(timings = {}) {
    const out = {};
    for (const [name, ms] of Object.entries(timings)) out[name] = roundMs(ms);
    return out;
  }

  function compactPreviewDiagnostics(diag = null) {
    if (!diag) return {};
    return {
      previewReadable: diag.readable ?? '',
      previewReadError: diag.readError || '',
      previewCenterHex: diag.centerHex || '',
      expectedCenterHex: diag.expectedHex || '',
      previewCenterMatches: diag.centerMatches ?? '',
      previewSuspectedBlank: diag.suspectedBlank ?? '',
      previewUniform: diag.uniform ?? '',
      previewOpaqueSamples: diag.opaqueSamples ?? '',
      previewUniqueColors: diag.uniqueColors ?? '',
      loupeVisibleAtPaint: diag.loupeVisible ?? '',
      previewCanvasW: diag.canvasW ?? '',
      previewCanvasH: diag.canvasH ?? '',
      previewRectW: diag.rectW ?? '',
      previewRectH: diag.rectH ?? '',
    };
  }

  function recordSampleTiming(clientX, clientY, previewSample = null, timings = {}) {
    if (!core.enabled) return;
    perfStats.sampleCommits++;
    recordPhases(timings);
    const sampleMs = Number(timings.total || 0);
    const isFirstSample = !!previewSample?.firstSample;
    const latency = previewSample?.latency || {};
    const previewDiag = previewSample?.previewDiagnostics || null;
    perfStats.maxInputAgeMs = Math.max(perfStats.maxInputAgeMs, Number(latency.inputAgeAtCommitMs) || 0);
    perfStats.maxQueueDelayMs = Math.max(perfStats.maxQueueDelayMs, Number(latency.queueDelayMs) || 0);
    perfStats.maxPointerDeltaPx = Math.max(perfStats.maxPointerDeltaPx, Number(latency.pointerDeltaPx) || 0);
    perfStats.maxFrameCoalescedMoves = Math.max(perfStats.maxFrameCoalescedMoves, Number(latency.frameCoalescedMoves) || 0);
    perfStats.maxClickToPreviewVisibleMs = Math.max(perfStats.maxClickToPreviewVisibleMs, Number(latency.clickToPreviewVisibleMs) || 0);
    perfStats.maxEventToPreviewVisibleMs = Math.max(perfStats.maxEventToPreviewVisibleMs, Number(latency.eventToPreviewVisibleMs) || 0);
    perfStats.maxClickToPreviewFrameMs = Math.max(perfStats.maxClickToPreviewFrameMs, Number(latency.clickToPreviewFrameMs) || 0);
    perfStats.maxEventToPreviewFrameMs = Math.max(perfStats.maxEventToPreviewFrameMs, Number(latency.eventToPreviewFrameMs) || 0);
    if (previewDiag?.readable === true) perfStats.previewReadableSamples++;
    else if (previewDiag?.readable === false) perfStats.previewUnreadableSamples++;
    if (previewDiag?.suspectedBlank) perfStats.previewBlankSamples++;
    if (previewDiag?.centerMatches === false) perfStats.previewColorMismatches++;
    perfStats.maxSampleMs = Math.max(perfStats.maxSampleMs, sampleMs);
    if (isFirstSample) {
      perfStats.firstSamples++;
      perfStats.maxFirstSampleMs = Math.max(perfStats.maxFirstSampleMs, sampleMs);
      firstSamples.push({
        at: roundMs(performance.now()),
        clientX,
        clientY,
        sampleMs: roundMs(sampleMs),
        topObjectId: previewSample?.topObjectId || '',
        drawnImages: previewSample?.drawnImages ?? '',
        drawnText: previewSample?.drawnText ?? '',
        testedObjects: previewSample?.testedObjects ?? '',
        intersectingObjects: previewSample?.intersectingObjects ?? '',
        missingImages: previewSample?.counters?.missingImages ?? '',
        pendingImages: previewSample?.counters?.readbackSafePendingImages ?? '',
        safeDisplayImages: previewSample?.counters?.safeDisplayImages ?? '',
        safeDataUrlImages: previewSample?.counters?.safeDataUrlImages ?? '',
        latency,
        preview: compactPreviewDiagnostics(previewDiag),
        timings: compactTimings(timings),
      });
      if (firstSamples.length > MAX_FIRST_SAMPLES) firstSamples.shift();
    }
    if (previewDiag?.suspectedBlank || previewDiag?.centerMatches === false) {
      previewMismatchSamples.push({
        at: roundMs(performance.now()),
        clientX,
        clientY,
        sampleMs: roundMs(sampleMs),
        topObjectId: previewSample?.topObjectId || '',
        drawnImages: previewSample?.drawnImages ?? '',
        drawnText: previewSample?.drawnText ?? '',
        missingImages: previewSample?.counters?.missingImages ?? '',
        pendingImages: previewSample?.counters?.readbackSafePendingImages ?? '',
        latency,
        preview: compactPreviewDiagnostics(previewDiag),
        timings: compactTimings(timings),
      });
      if (previewMismatchSamples.length > MAX_PREVIEW_MISMATCH_SAMPLES) previewMismatchSamples.shift();
    }
    if (sampleMs > SLOW_SAMPLE_MS) {
      perfStats.slowSamples++;
      slowSamples.push({
        at: roundMs(performance.now()),
        clientX,
        clientY,
        sampleMs: roundMs(sampleMs),
        topObjectId: previewSample?.topObjectId || '',
        drawnImages: previewSample?.drawnImages ?? '',
        drawnText: previewSample?.drawnText ?? '',
        testedObjects: previewSample?.testedObjects ?? '',
        intersectingObjects: previewSample?.intersectingObjects ?? '',
        missingImages: previewSample?.counters?.missingImages ?? '',
        pendingImages: previewSample?.counters?.readbackSafePendingImages ?? '',
        latency,
        preview: compactPreviewDiagnostics(previewDiag),
        timings: compactTimings(timings),
      });
      if (slowSamples.length > MAX_SLOW_SAMPLES) slowSamples.shift();
    }
  }

  function logSamplingEvent(event, meta = {}) {
    if (!core.enabled) return;
    lastSamplingEvent = {
      at: roundMs(performance.now()),
      event,
      clientX: meta.clientX ?? '',
      clientY: meta.clientY ?? '',
      sampleMs: roundMs(meta.sampleMs),
      inputAgeMs: meta.inputAgeAtReceiveMs ?? meta.inputAgeAtCommitMs ?? '',
      queueDelayMs: meta.queueDelayMs ?? '',
      coalescedMoves: meta.coalescedMoves ?? meta.frameCoalescedMoves ?? '',
      pendingCoalescedMoves: meta.pendingCoalescedMoves ?? '',
    };
    core.push({ step: 'sample-event', meta: { event, ...meta } });
  }

  function recordPrewarmTiming(summary = {}, ms = 0) {
    if (!core.enabled) return;
    perfStats.prewarmRunsTimed++;
    perfStats.maxPrewarmMs = Math.max(perfStats.maxPrewarmMs, Number(ms) || 0);
    recordPhase('prewarm', ms);
    if (ms > SLOW_SAMPLE_MS) {
      slowSamples.push({
        at: roundMs(performance.now()),
        kind: 'prewarm',
        sampleMs: roundMs(ms),
        candidates: summary?.candidates ?? '',
        ready: summary?.ready ?? '',
        pending: summary?.pending ?? '',
        displayReused: summary?.displayReused ?? '',
        dataUrlReady: summary?.dataUrlReady ?? '',
      });
      if (slowSamples.length > MAX_SLOW_SAMPLES) slowSamples.shift();
    }
  }

  function countPerf(name, amount = 1) {
    if (!core.enabled) return;
    perfStats[name] = (perfStats[name] || 0) + amount;
  }

  function debugLimit(options = {}, fallback = 25) {
    const raw = typeof options === 'number' ? options : options?.limit;
    return Math.max(1, Math.min(1000, Number(raw) || fallback));
  }

  function recentRows(rows, options = {}, fallback = 25) {
    const limit = debugLimit(options, fallback);
    return rows.slice(Math.max(0, rows.length - limit));
  }

  function compactPixel(value) {
    return value || '';
  }

  function sampleRow(e) {
    return {
      at: e.at,
      x: e.meta?.clientX ?? '',
      y: e.meta?.clientY ?? '',
      zoom: e.meta?.zoom ?? '',
      previewZoom: e.meta?.previewZoom ?? '',
      previewCssSize: e.meta?.previewCssSize ?? '',
      previewRectWidth: e.meta?.previewRectWidth ?? '',
      previewDrawSize: e.meta?.previewDrawSize ?? '',
      inputAgeMs: e.meta?.inputAgeAtCommitMs ?? '',
      queueDelayMs: e.meta?.queueDelayMs ?? '',
      pointerDeltaPx: e.meta?.pointerDeltaPx ?? '',
      frameCoalescedMoves: e.meta?.frameCoalescedMoves ?? '',
      clickToPreviewVisibleMs: e.meta?.clickToPreviewVisibleMs ?? '',
      eventToPreviewVisibleMs: e.meta?.eventToPreviewVisibleMs ?? '',
      clickToPreviewFrameMs: e.meta?.clickToPreviewFrameMs ?? '',
      eventToPreviewFrameMs: e.meta?.eventToPreviewFrameMs ?? '',
      previewReadable: e.meta?.previewReadable ?? '',
      previewCenterHex: e.meta?.previewCenterHex || '',
      expectedCenterHex: e.meta?.expectedCenterHex || '',
      previewCenterMatches: e.meta?.previewCenterMatches ?? '',
      previewSuspectedBlank: e.meta?.previewSuspectedBlank ?? '',
      top: e.meta?.topObjectId || '',
      topType: e.meta?.topObjectType || '',
      first: e.meta?.firstSample ?? '',
      center: compactPixel(e.meta?.centerPixel),
      drawnImages: e.meta?.drawnImages ?? '',
      missingImages: e.meta?.missingImages ?? '',
      pendingImages: e.meta?.readbackSafePendingImages ?? '',
      safeDisplayImages: e.meta?.safeDisplayImages ?? '',
      safeDataUrlImages: e.meta?.safeDataUrlImages ?? '',
      nativeSkipped: e.meta?.nativeSourceHydrationSkipped ?? '',
      lastMissingKey: e.meta?.lastMissingKey || '',
      lastMissingReason: e.meta?.lastMissingReason || '',
    };
  }

  function sampleEventRow(e) {
    return {
      at: e.at,
      event: e.meta?.event || e.step || '',
      first: e.meta?.firstSample ?? '',
      x: e.meta?.clientX ?? '',
      y: e.meta?.clientY ?? '',
      imgKey: e.meta?.imgKey ?? '',
      sourceKind: e.meta?.sourceKind ?? '',
      sourceX: e.meta?.sourceX ?? '',
      sourceY: e.meta?.sourceY ?? '',
      durationMs: e.meta?.durationMs ?? '',
      stageMs: e.meta?.stageMs ?? '',
      inputAgeMs: e.meta?.inputAgeAtReceiveMs ?? e.meta?.inputAgeAtCommitMs ?? '',
      queueDelayMs: e.meta?.queueDelayMs ?? '',
      coalescedMoves: e.meta?.coalescedMoves ?? e.meta?.frameCoalescedMoves ?? '',
      pendingCoalescedMoves: e.meta?.pendingCoalescedMoves ?? '',
      sampleRafActive: e.meta?.sampleRafActive ?? '',
      sampleMs: e.meta?.sampleMs ?? '',
      paintMs: e.meta?.paintMs ?? '',
      readoutMs: e.meta?.readoutMs ?? '',
      positionMs: e.meta?.positionMs ?? '',
      previewPainted: e.meta?.previewPainted ?? '',
      drawnImages: e.meta?.drawnImages ?? '',
      pendingImages: e.meta?.readbackSafePendingImages ?? '',
      safeImagePending: e.meta?.safeImagePending ?? '',
      missingImages: e.meta?.missingImages ?? '',
      inFlight: e.meta?.inFlight ?? '',
      hasPointer: e.meta?.hasPointer ?? '',
      latestX: e.meta?.latestClientX ?? '',
      latestY: e.meta?.latestClientY ?? '',
      latestAgeMs: e.meta?.latestPointerAgeMs ?? '',
      objectId: e.meta?.objectId ?? e.meta?.topObjectId ?? '',
      objectType: e.meta?.objectType ?? e.meta?.topObjectType ?? '',
      reason: e.meta?.reason ?? '',
      targetKey: e.meta?.targetKey ?? '',
      targetX: e.meta?.targetSourceX ?? '',
      targetY: e.meta?.targetSourceY ?? '',
      lastKey: e.meta?.lastKey ?? '',
      lastX: e.meta?.lastSourceX ?? '',
      lastY: e.meta?.lastSourceY ?? '',
      clickToPreviewVisibleMs: e.meta?.clickToPreviewVisibleMs ?? '',
      eventToPreviewVisibleMs: e.meta?.eventToPreviewVisibleMs ?? '',
      clickToPreviewFrameMs: e.meta?.clickToPreviewFrameMs ?? '',
      eventToPreviewFrameMs: e.meta?.eventToPreviewFrameMs ?? '',
    };
  }

  function failureRow(e) {
    return {
      at: e.at,
      step: e.step,
      where: e.meta?.where || '',
      objectId: e.meta?.objectId || '',
      imgKey: e.meta?.imgKey || '',
      source: e.meta?.source || '',
      cacheSource: e.meta?.cacheSource || '',
      reason: e.meta?.reason || '',
      error: e.meta?.error || '',
    };
  }

  function compactLastSample(sample = lastSample) {
    if (!sample) return null;
    return {
      clientX: sample.clientX,
      clientY: sample.clientY,
      worldX: sample.worldX,
      worldY: sample.worldY,
      zoom: sample.zoom,
      previewZoom: sample.previewZoom,
      previewCssSize: sample.previewCssSize,
      previewRectWidth: sample.previewRectWidth,
      previewDrawSize: sample.previewDrawSize,
      inputAgeAtReceiveMs: sample.inputAgeAtReceiveMs,
      inputAgeAtCommitMs: sample.inputAgeAtCommitMs,
      queueDelayMs: sample.queueDelayMs,
      pointerDeltaPx: sample.pointerDeltaPx,
      frameCoalescedMoves: sample.frameCoalescedMoves,
      clickToPreviewVisibleMs: sample.clickToPreviewVisibleMs,
      eventToPreviewVisibleMs: sample.eventToPreviewVisibleMs,
      clickToPreviewFrameMs: sample.clickToPreviewFrameMs,
      eventToPreviewFrameMs: sample.eventToPreviewFrameMs,
      previewReadable: sample.previewReadable,
      previewReadError: sample.previewReadError,
      previewCenterHex: sample.previewCenterHex,
      expectedCenterHex: sample.expectedCenterHex,
      previewCenterMatches: sample.previewCenterMatches,
      previewSuspectedBlank: sample.previewSuspectedBlank,
      previewUniform: sample.previewUniform,
      previewOpaqueSamples: sample.previewOpaqueSamples,
      previewUniqueColors: sample.previewUniqueColors,
      loupeVisibleAtPaint: sample.loupeVisibleAtPaint,
      previewCanvasW: sample.previewCanvasW,
      previewCanvasH: sample.previewCanvasH,
      previewRectW: sample.previewRectW,
      previewRectH: sample.previewRectH,
      topObjectId: sample.topObjectId,
      topObjectType: sample.topObjectType,
      firstSample: sample.firstSample,
      centerPixel: sample.centerPixel,
      previewPixel: sample.previewPixel,
      readoutSource: sample.readoutSource,
      readoutReason: sample.readoutReason,
      readoutObjectId: sample.readoutObjectId,
      readoutObjectType: sample.readoutObjectType,
      readoutSourcePixel: sample.readoutSourcePixel,
      readoutSourceRgba: sample.readoutSourceRgba,
      readoutSourceX: sample.readoutSourceX,
      readoutSourceY: sample.readoutSourceY,
      readoutSourceW: sample.readoutSourceW,
      readoutSourceH: sample.readoutSourceH,
      readoutLayers: sample.readoutLayers,
      drawnImages: sample.drawnImages,
      drawnText: sample.drawnText,
      missingImages: sample.missingImages,
      readbackSafePendingImages: sample.readbackSafePendingImages,
      safeDisplayImages: sample.safeDisplayImages,
      safeDataUrlImages: sample.safeDataUrlImages,
      nativeSourceHydrationSkipped: sample.nativeSourceHydrationSkipped,
      lastMissingKey: sample.lastMissingKey,
      lastMissingReason: sample.lastMissingReason,
      textHits: Array.isArray(sample.textHits) ? sample.textHits.length : sample.textHits,
    };
  }

  function rectRow(rect, prefix) {
    if (!rect) return {};
    return {
      [`${prefix}X1`]: rect.x1,
      [`${prefix}Y1`]: rect.y1,
      [`${prefix}X2`]: rect.x2,
      [`${prefix}Y2`]: rect.y2,
      [`${prefix}W`]: rect.x2 - rect.x1,
      [`${prefix}H`]: rect.y2 - rect.y1,
    };
  }

  function textInkBounds(obj) {
    if (!obj || obj.type !== 'text') return null;
    const lines = getWrappedLines(obj);
    let x2 = obj.x + TEXT_PAD;
    for (const line of lines) x2 = Math.max(x2, obj.x + TEXT_PAD + measureTextW(line.text));
    return {
      x1: obj.x + TEXT_PAD,
      y1: obj.y + TEXT_PAD,
      x2,
      y2: obj.y + TEXT_PAD + Math.max(lines.length, 1) * LINE_H,
      lines: lines.length,
      maxLineW: x2 - obj.x - TEXT_PAD,
    };
  }

  function textLineAtPoint(obj, point) {
    const lines = getWrappedLines(obj);
    const localX = point.x - obj.x;
    const localY = point.y - obj.y;
    let activeLine = null;
    let lineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const y1 = TEXT_PAD + i * LINE_H;
      const y2 = y1 + LINE_H;
      if (localY >= y1 && localY <= y2) {
        activeLine = lines[i];
        lineIndex = i;
        break;
      }
    }
    if (!activeLine && lines.length) {
      lineIndex = localY < TEXT_PAD ? 0 : lines.length - 1;
      activeLine = lines[lineIndex];
    }
    const lineText = activeLine?.text || '';
    const lineW = measureTextW(lineText);
    const lineX = localX - TEXT_PAD;
    const lineY = localY - (TEXT_PAD + Math.max(0, lineIndex) * LINE_H);
    return {
      centerLocalX: localX,
      centerLocalY: localY,
      lineIndex,
      lineText: lineText.slice(0, 60),
      lineX,
      lineY,
      lineW,
      lineH: LINE_H,
      lineBaselineY: TEXT_BASELINE_Y_OFFSET,
      insideLineTextWidth: lineX >= 0 && lineX <= lineW,
      insideLineBox: lineY >= 0 && lineY <= LINE_H,
    };
  }

  function textNearPoint(point, padWorld = 2) {
    const rows = [];
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj?.type !== 'text') continue;
      const saved = { x1: obj.x, y1: obj.y, x2: obj.x + obj.w, y2: obj.y + obj.h };
      const ink = textInkBounds(obj);
      const inSaved = rectContainsPoint(saved, point);
      const inInk = rectContainsPoint({
        x1: ink.x1 - padWorld,
        y1: ink.y1 - padWorld,
        x2: ink.x2 + padWorld,
        y2: ink.y2 + padWorld,
      }, point);
      if (!inSaved && !inInk) continue;
      rows.push({
        id: obj.id,
        z: obj.z,
        inSaved,
        inInk,
        content: String(obj.data?.content || '').slice(0, 60),
        savedW: obj.w,
        savedH: obj.h,
        inkW: ink.maxLineW,
        inkH: ink.y2 - ink.y1,
        overflowRight: Math.max(0, ink.x2 - saved.x2),
        overflowBottom: Math.max(0, ink.y2 - saved.y2),
        lines: ink.lines,
        ...textLineAtPoint(obj, point),
        ...rectRow(saved, 'saved'),
        ...rectRow(ink, 'ink'),
      });
    }
    return rows;
  }

  function sampleSnapshot(clientX, clientY, previewSample = null, centerPixel = null, readoutSampleInfo = null) {
    const point = clientToBoardWorldPoint(clientX, clientY);
    const topObject = topObjectAtWorldPoint(point);
    const dpr = window.devicePixelRatio || 1;
    const previewRect = eyedropperCanvas?.getBoundingClientRect();
    const drawSize = previewSample?.drawSize || eyedropperPreviewDrawSize(dpr);
    const previewCssSize = previewSample?.previewCssSize || (drawSize / dpr);
    const previewZoom = Math.max(zoom || 1, 0.0001) * EYEDROPPER_PREVIEW_ZOOM_SCALE;
    const renderCssSize = drawSize / dpr;
    const halfWorld = renderCssSize / (2 * previewZoom);
    const previewWorldRect = previewSample?.viewportRect || {
      x1: point.x - halfWorld,
      y1: point.y - halfWorld,
      x2: point.x + halfWorld,
      y2: point.y + halfWorld,
    };
    const counters = previewSample?.counters || {};
    return {
      clientX,
      clientY,
      worldX: point.x,
      worldY: point.y,
      zoom,
      dpr,
      previewCssSize,
      previewRectWidth: previewRect?.width || '',
      previewDrawSize: drawSize,
      previewZoom: previewSample?.previewZoom ?? previewZoom,
      topObjectId: topObject?.id || '',
      topObjectType: topObject?.type || '',
      previewPainted: !!previewSample?.painted,
      previewFallback: !!previewSample?.usedFallback,
      firstSample: !!previewSample?.firstSample,
      inputAgeAtReceiveMs: previewSample?.latency?.inputAgeAtReceiveMs ?? '',
      inputAgeAtCommitMs: previewSample?.latency?.inputAgeAtCommitMs ?? '',
      queueDelayMs: previewSample?.latency?.queueDelayMs ?? '',
      pointerDeltaPx: previewSample?.latency?.pointerDeltaPx ?? '',
      frameCoalescedMoves: previewSample?.latency?.frameCoalescedMoves ?? '',
      clickToPreviewVisibleMs: previewSample?.latency?.clickToPreviewVisibleMs ?? '',
      eventToPreviewVisibleMs: previewSample?.latency?.eventToPreviewVisibleMs ?? '',
      clickToPreviewFrameMs: previewSample?.latency?.clickToPreviewFrameMs ?? '',
      eventToPreviewFrameMs: previewSample?.latency?.eventToPreviewFrameMs ?? '',
      previewReadable: previewSample?.previewDiagnostics?.readable ?? '',
      previewReadError: previewSample?.previewDiagnostics?.readError || '',
      previewCenterHex: previewSample?.previewDiagnostics?.centerHex || '',
      expectedCenterHex: previewSample?.previewDiagnostics?.expectedHex || '',
      previewCenterMatches: previewSample?.previewDiagnostics?.centerMatches ?? '',
      previewSuspectedBlank: previewSample?.previewDiagnostics?.suspectedBlank ?? '',
      previewUniform: previewSample?.previewDiagnostics?.uniform ?? '',
      previewOpaqueSamples: previewSample?.previewDiagnostics?.opaqueSamples ?? '',
      previewUniqueColors: previewSample?.previewDiagnostics?.uniqueColors ?? '',
      loupeVisibleAtPaint: previewSample?.previewDiagnostics?.loupeVisible ?? '',
      previewCanvasW: previewSample?.previewDiagnostics?.canvasW ?? '',
      previewCanvasH: previewSample?.previewDiagnostics?.canvasH ?? '',
      previewRectW: previewSample?.previewDiagnostics?.rectW ?? '',
      previewRectH: previewSample?.previewDiagnostics?.rectH ?? '',
      exactCenterCanvasX: previewSample?.centerX ?? '',
      exactCenterCanvasY: previewSample?.centerY ?? '',
      previewPixel: rgbaToHex(previewSample?.pixel),
      centerPixel: rgbaToHex(centerPixel),
      readoutSource: readoutSampleInfo?.source || '',
      readoutReason: readoutSampleInfo?.reason || '',
      readoutObjectId: readoutSampleInfo?.objectId || '',
      readoutObjectType: readoutSampleInfo?.objectType || '',
      readoutSourcePixel: rgbaToHex(readoutSampleInfo?.sourcePixel),
      readoutSourceRgba: readoutSampleInfo?.sourcePixel ? readoutSampleInfo.sourcePixel.join(' ') : '',
      readoutSourceX: readoutSampleInfo?.sourceX ?? '',
      readoutSourceY: readoutSampleInfo?.sourceY ?? '',
      readoutSourceW: readoutSampleInfo?.sourceW ?? '',
      readoutSourceH: readoutSampleInfo?.sourceH ?? '',
      readoutLayers: readoutSampleInfo?.layers?.length ?? '',
      readoutPixel: rgbaToHex(readoutSampleInfo?.pixel),
      readoutRgba: readoutSampleInfo?.pixel ? readoutSampleInfo.pixel.join(' ') : '',
      readoutCanvasX: readoutSampleInfo?.sourceX ?? '',
      readoutCanvasY: readoutSampleInfo?.sourceY ?? '',
      readoutInBounds: readoutSampleInfo?.inBounds ?? '',
      readoutCanvasW: '',
      readoutCanvasH: '',
      readoutRectW: '',
      readoutRectH: '',
      readoutScaleX: '',
      readoutScaleY: '',
      displayedHex: eyedropperHex?.textContent || '',
      displayedRgb: eyedropperRgb?.textContent || '',
      drawnImages: previewSample?.drawnImages ?? '',
      drawnText: previewSample?.drawnText ?? '',
      testedObjects: previewSample?.testedObjects ?? '',
      intersectingObjects: previewSample?.intersectingObjects ?? '',
      sampleMs: previewSample?.timings?.total ?? '',
      paintMs: previewSample?.timings?.paintPreview ?? '',
      objectLoopMs: previewSample?.timings?.objectLoop ?? '',
      readbackMs: previewSample?.timings?.readback ?? '',
      previewReadbackMs: previewSample?.timings?.previewReadback ?? '',
      canvasReadoutMs: previewSample?.timings?.canvasReadout ?? '',
      blitMs: previewSample?.timings?.blit ?? '',
      sizeMs: previewSample?.timings?.drawSize ?? '',
      resizeMs: previewSample?.timings?.resizeVisible ?? '',
      dotMs: previewSample?.timings?.dot ?? '',
      readoutMs: previewSample?.timings?.readout ?? '',
      positionMs: previewSample?.timings?.position ?? '',
      bitmapImages: counters.bitmapImages ?? '',
      elementImages: counters.elementImages ?? '',
      fallbackImages: counters.fallbackImages ?? '',
      safeDisplayImages: counters.safeDisplayImages ?? '',
      safeDataUrlImages: counters.safeDataUrlImages ?? '',
      nativeSourceHydrationSkipped: counters.nativeSourceHydrationSkipped ?? '',
      readbackSafeImages: counters.readbackSafeImages ?? '',
      readbackSafePendingImages: counters.readbackSafePendingImages ?? '',
      readbackSafeScaledImages: counters.readbackSafeScaledImages ?? '',
      missingImages: counters.missingImages ?? '',
      erroredImages: counters.erroredImages ?? '',
      scaledImages: counters.scaledImages ?? '',
      scaledFallbackFull: counters.scaledFallbackFull ?? '',
      fullScaleImages: counters.fullScaleImages ?? '',
      culledImages: counters.culledImages ?? '',
      culledText: counters.culledText ?? '',
      avgScale: counters.scaledImages ? counters.scaledImageScaleTotal / counters.scaledImages : '',
      avgTargetScale: counters.scaledImages ? counters.scaledImageTargetScaleTotal / counters.scaledImages : '',
      lastImageTargetScale: counters.lastImageTargetScale ?? '',
      lastImageSelectedScale: counters.lastImageSelectedScale ?? '',
      lastImageSourceW: counters.lastImageSourceW ?? '',
      lastImageSourceH: counters.lastImageSourceH ?? '',
      lastImageNeededW: counters.lastImageNeededW ?? '',
      lastImageNeededH: counters.lastImageNeededH ?? '',
      lastImageDpr: counters.lastImageDpr ?? '',
      lastImageZoom: counters.lastImageZoom ?? '',
      lastMissingKey: counters.lastMissingKey || '',
      lastMissingId: counters.lastMissingId || '',
      lastMissingReason: counters.lastMissingReason || '',
      lastDrawErrorKey: counters.lastDrawErrorKey || '',
      lastDrawErrorId: counters.lastDrawErrorId || '',
      lastDrawError: counters.lastDrawError || '',
      textHits: textNearPoint(point),
      ...rectRow(previewWorldRect, 'preview'),
    };
  }

  function logSample(clientX, clientY, previewSample = null, centerPixel = null, readoutSampleInfo = null) {
    if (!core.enabled) return;
    lastSample = sampleSnapshot(clientX, clientY, previewSample, centerPixel, readoutSampleInfo);
    core.push({
      step: 'sample',
      meta: {
        ...lastSample,
        textHits: lastSample.textHits.length,
        textHitIds: lastSample.textHits.map(row => `${row.id}:${row.inSaved ? 'saved' : 'ink-only'}`).join(','),
      },
    });
  }

  function logReadbackFailure(where, meta = {}) {
    if (!core.enabled) return;
    countStat('readbackFailures');
    countStat(`${statKey(where)}ReadbackFailures`);
    core.push({
      step: 'readback-fail',
      meta: { where, ...meta },
    });
  }

  function logFallbackSample(meta = {}) {
    if (!core.enabled) return;
    countStat('fallbackSamples');
    core.push({ step: 'fallback-sample', meta });
  }

  function logUnsafeImageSkip(meta = {}) {
    if (!core.enabled) return;
    countStat('unsafeImageSkips');
    core.push({ step: 'unsafe-image-skip', meta });
  }

  function logInteraction(meta = {}) {
    if (!core.enabled) return;
    countStat('interactionEvents');
    if (meta.allowed) countStat('interactionStarts');
    else countStat('interactionBlocks');
    core.push({ step: 'interaction', meta });
  }

  function logToggle(meta = {}) {
    if (!core.enabled) return;
    core.push({ step: 'toggle', meta });
  }

  function count(name, amount = 1) {
    countStat(name, amount);
  }

  function observeLongTasks() {
    if (longTaskObserver || typeof PerformanceObserver !== 'function') return;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        if (!core.enabled) return;
        for (const entry of list.getEntries()) {
          const duration = roundMs(entry.duration || 0);
          perfStats.longTasks++;
          perfStats.maxLongTaskMs = Math.max(perfStats.maxLongTaskMs, duration);
          longTasks.push({
            at: roundMs(entry.startTime || performance.now()),
            durationMs: duration,
            name: entry.name || '',
            sampleActive: eyedropperSampling,
            enabled: eyedropperEnabled,
            safeImagePending: eyedropperSafeImagePromises.size,
          });
          if (longTasks.length > MAX_LONG_TASKS) longTasks.shift();
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (_) {
      longTaskObserver = null;
    }
  }

  function recordFrameGap(frameAt, previousFrameAt) {
    const gapMs = frameAt - previousFrameAt;
    if (gapMs <= STUTTER_FRAME_GAP_MS) return;
    perfStats.frameGaps++;
    perfStats.stuttersOver120ms++;
    if (gapMs > 200) perfStats.stuttersOver200ms++;
    if (gapMs > 300) perfStats.stuttersOver300ms++;
    perfStats.maxFrameGapMs = Math.max(perfStats.maxFrameGapMs, gapMs);
    frameGaps.push({
      at: roundMs(frameAt),
      gapMs: roundMs(gapMs),
      severity: gapMs > 300 ? 'major' : gapMs > 200 ? 'visible' : 'minor',
      thresholdMs: STUTTER_FRAME_GAP_MS,
      enabled: eyedropperEnabled,
      sampling: eyedropperSampling,
      loupeVisible: isEyedropperSampleVisible(),
      sampleRafActive: !!_eyedropperSampleRaf,
      pendingSampleEvent: !!_eyedropperPendingSampleEvent,
      pendingCoalescedMoves: _eyedropperPendingSampleCoalesced,
      latestPointerAgeMs: _eyedropperLatestPointerEvent?.receivedAt
        ? roundMs(Math.max(0, performance.now() - _eyedropperLatestPointerEvent.receivedAt))
        : '',
      safeImagePending: eyedropperSafeImagePromises.size,
      safeScaledPending: eyedropperSafeScaledBitmapPending.size,
      tileCachePending: eyedropperSafeTileCachePending.size,
      tileCacheSize: eyedropperSafeTileCache.size,
      lastSamplingEvent,
      visibility: document.visibilityState || '',
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : '',
    });
    if (frameGaps.length > MAX_FRAME_GAPS) frameGaps.shift();
  }

  function runFrameProbe(timestamp) {
    if (!core.enabled || !eyedropperEnabled) {
      frameProbeRaf = null;
      lastFrameProbeAt = 0;
      return;
    }
    const frameAt = Number.isFinite(Number(timestamp)) ? Number(timestamp) : performance.now();
    if (lastFrameProbeAt > 0) recordFrameGap(frameAt, lastFrameProbeAt);
    lastFrameProbeAt = frameAt;
    frameProbeRaf = requestAnimationFrame(runFrameProbe);
  }

  function startFrameProbe() {
    if (!core.enabled || frameProbeRaf || !eyedropperEnabled) return;
    lastFrameProbeAt = performance.now();
    frameProbeRaf = requestAnimationFrame(runFrameProbe);
  }

  function stopFrameProbe() {
    if (frameProbeRaf) cancelAnimationFrame(frameProbeRaf);
    frameProbeRaf = null;
    lastFrameProbeAt = 0;
  }

  function enable(options = {}) {
    core.enable(options);
    observeLongTasks();
    startFrameProbe();
    if (core.enabled) console.info('Boardfish eyedropper debugger enabled. Use finishDebug({ eyedropper: ["report", "summary", "status"] }) to collect compact results.');
  }

  function disable() {
    core.disable();
    stopFrameProbe();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish eyedropper debugger disabled.');
  }

  function summary(options = {}) {
    const rows = recentRows(events.map((e) => ({
      at: e.at,
      step: e.step,
      where: e.meta?.where || '',
      x: e.meta?.clientX ?? '',
      y: e.meta?.clientY ?? '',
      wx: e.meta?.worldX ?? '',
      wy: e.meta?.worldY ?? '',
      zoom: e.meta?.zoom ?? '',
      top: e.meta?.topObjectId || '',
      topType: e.meta?.topObjectType || '',
      first: e.meta?.firstSample ?? '',
      center: e.meta?.centerPixel || '',
      readoutSource: e.meta?.readoutSource || '',
      readoutReason: e.meta?.readoutReason || '',
      readoutObjectId: e.meta?.readoutObjectId || '',
      readoutSourcePixel: e.meta?.readoutSourcePixel || '',
      fallback: e.meta?.previewFallback ?? '',
      previewZoom: e.meta?.previewZoom ?? '',
      previewCssSize: e.meta?.previewCssSize ?? '',
      previewRectWidth: e.meta?.previewRectWidth ?? '',
      previewDrawSize: e.meta?.previewDrawSize ?? '',
      drawnImages: e.meta?.drawnImages ?? '',
      drawnText: e.meta?.drawnText ?? '',
      testedObjects: e.meta?.testedObjects ?? '',
      intersectingObjects: e.meta?.intersectingObjects ?? '',
      sampleMs: e.meta?.sampleMs ?? '',
      paintMs: e.meta?.paintMs ?? '',
      objectLoopMs: e.meta?.objectLoopMs ?? '',
      readbackMs: e.meta?.readbackMs ?? '',
      previewReadbackMs: e.meta?.previewReadbackMs ?? '',
      canvasReadoutMs: e.meta?.canvasReadoutMs ?? '',
      blitMs: e.meta?.blitMs ?? '',
      missingImages: e.meta?.missingImages ?? '',
      erroredImages: e.meta?.erroredImages ?? '',
      scaledImages: e.meta?.scaledImages ?? '',
      scaledFallbackFull: e.meta?.scaledFallbackFull ?? '',
      fullScaleImages: e.meta?.fullScaleImages ?? '',
      safeDisplayImages: e.meta?.safeDisplayImages ?? '',
      safeDataUrlImages: e.meta?.safeDataUrlImages ?? '',
      nativeSourceHydrationSkipped: e.meta?.nativeSourceHydrationSkipped ?? '',
      readbackSafeImages: e.meta?.readbackSafeImages ?? '',
      readbackSafePendingImages: e.meta?.readbackSafePendingImages ?? '',
      readbackSafeScaledImages: e.meta?.readbackSafeScaledImages ?? '',
      centerCanvasX: e.meta?.exactCenterCanvasX ?? '',
      centerCanvasY: e.meta?.exactCenterCanvasY ?? '',
      textHits: e.meta?.textHits ?? '',
      textHitIds: e.meta?.textHitIds || '',
      objectId: e.meta?.objectId || '',
      imgKey: e.meta?.imgKey || '',
      reason: e.meta?.reason || '',
      error: e.meta?.error || '',
    })), options, 30);
    console.table(rows);
    return rows;
  }

  function imageSummary(options = {}) {
    const rows = recentRows(events
      .filter(e => e.step === 'sample')
      .map(e => ({
        at: e.at,
        x: e.meta?.clientX ?? '',
        y: e.meta?.clientY ?? '',
        zoom: e.meta?.zoom ?? '',
        previewZoom: e.meta?.previewZoom ?? '',
        previewCssSize: e.meta?.previewCssSize ?? '',
        previewRectWidth: e.meta?.previewRectWidth ?? '',
        previewDrawSize: e.meta?.previewDrawSize ?? '',
        top: e.meta?.topObjectId || '',
        topType: e.meta?.topObjectType || '',
        first: e.meta?.firstSample ?? '',
        center: e.meta?.centerPixel || '',
        readback: e.meta?.previewFallback ? 'fallback' : 'ok',
        drawnImages: e.meta?.drawnImages ?? '',
        drawnText: e.meta?.drawnText ?? '',
        testedObjects: e.meta?.testedObjects ?? '',
        intersectingObjects: e.meta?.intersectingObjects ?? '',
        sampleMs: e.meta?.sampleMs ?? '',
        paintMs: e.meta?.paintMs ?? '',
        objectLoopMs: e.meta?.objectLoopMs ?? '',
        readbackMs: e.meta?.readbackMs ?? '',
        previewReadbackMs: e.meta?.previewReadbackMs ?? '',
        canvasReadoutMs: e.meta?.canvasReadoutMs ?? '',
        blitMs: e.meta?.blitMs ?? '',
        bitmapImages: e.meta?.bitmapImages ?? '',
        elementImages: e.meta?.elementImages ?? '',
        fallbackImages: e.meta?.fallbackImages ?? '',
        safeDisplayImages: e.meta?.safeDisplayImages ?? '',
        safeDataUrlImages: e.meta?.safeDataUrlImages ?? '',
        nativeSourceHydrationSkipped: e.meta?.nativeSourceHydrationSkipped ?? '',
        readbackSafeImages: e.meta?.readbackSafeImages ?? '',
        readbackSafePendingImages: e.meta?.readbackSafePendingImages ?? '',
        readbackSafeScaledImages: e.meta?.readbackSafeScaledImages ?? '',
        scaledImages: e.meta?.scaledImages ?? '',
        scaledFallbackFull: e.meta?.scaledFallbackFull ?? '',
        fullScaleImages: e.meta?.fullScaleImages ?? '',
        avgScale: e.meta?.avgScale ?? '',
        avgTargetScale: e.meta?.avgTargetScale ?? '',
        lastImageTargetScale: e.meta?.lastImageTargetScale ?? '',
        lastImageSelectedScale: e.meta?.lastImageSelectedScale ?? '',
        lastImageSourceW: e.meta?.lastImageSourceW ?? '',
        lastImageSourceH: e.meta?.lastImageSourceH ?? '',
        lastImageNeededW: e.meta?.lastImageNeededW ?? '',
        lastImageNeededH: e.meta?.lastImageNeededH ?? '',
        lastImageDpr: e.meta?.lastImageDpr ?? '',
        lastImageZoom: e.meta?.lastImageZoom ?? '',
        missingImages: e.meta?.missingImages ?? '',
        erroredImages: e.meta?.erroredImages ?? '',
        lastMissingKey: e.meta?.lastMissingKey || '',
        lastMissingReason: e.meta?.lastMissingReason || '',
        lastDrawErrorKey: e.meta?.lastDrawErrorKey || '',
        lastDrawError: e.meta?.lastDrawError || '',
      })), options, 30);
    console.table(rows);
    return rows;
  }

  function readbackFailures(options = {}) {
    const rows = recentRows(events
      .filter(e => e.step === 'readback-fail' || e.step === 'fallback-sample' || e.step === 'unsafe-image-skip')
      .map(e => ({
        at: e.at,
        step: e.step,
        where: e.meta?.where || '',
        objectId: e.meta?.objectId || '',
        objectType: e.meta?.objectType || '',
        imgKey: e.meta?.imgKey || '',
        source: e.meta?.source || '',
        cacheSource: e.meta?.cacheSource || '',
        x: e.meta?.sourceX ?? e.meta?.x ?? '',
        y: e.meta?.sourceY ?? e.meta?.y ?? '',
        w: e.meta?.width ?? '',
        h: e.meta?.height ?? '',
        reason: e.meta?.reason || '',
        error: e.meta?.error || '',
      })), options, 25);
    console.table(rows);
    return rows;
  }

  function interactionSummary(options = {}) {
    const rows = recentRows(events
      .filter(e => e.step === 'interaction')
      .map(e => ({
        at: e.at,
        event: e.meta?.eventType || '',
        pointerType: e.meta?.pointerType || '',
        pointerId: e.meta?.pointerId ?? '',
        button: e.meta?.button ?? '',
        buttons: e.meta?.buttons ?? '',
        allowed: e.meta?.allowed ?? '',
        reason: e.meta?.reason || '',
        target: e.meta?.target || '',
        x: e.meta?.clientX ?? '',
        y: e.meta?.clientY ?? '',
        enabled: e.meta?.enabled ?? '',
        sampling: e.meta?.sampling ?? '',
        activePointerId: e.meta?.activePointerId ?? '',
        shieldActive: e.meta?.shieldActive ?? '',
      })), options, 30);
    console.table(rows);
    return rows;
  }

  function toggleRows(options = {}) {
    return recentRows(events
      .filter(e => e.step === 'toggle' || e.step === 'toggle-frame')
      .map(e => ({
        at: e.at,
        step: e.step,
        requested: e.meta?.requested ?? '',
        before: e.meta?.before ?? '',
        after: e.meta?.after ?? '',
        totalMs: e.meta?.totalMs ?? '',
        assignMs: e.meta?.assignMs ?? '',
        wallpaperMs: e.meta?.wallpaperMs ?? '',
        shieldMs: e.meta?.shieldMs ?? '',
        bodyClassMs: e.meta?.bodyClassMs ?? '',
        hideMenusMs: e.meta?.hideMenusMs ?? '',
        prewarmScheduleMs: e.meta?.prewarmScheduleMs ?? '',
        hideSampleMs: e.meta?.hideSampleMs ?? '',
        selectionOverlayMs: e.meta?.selectionOverlayMs ?? '',
        nextFrameMs: e.meta?.nextFrameMs ?? '',
        shieldActive: e.meta?.shieldActive ?? '',
        loupeVisible: e.meta?.loupeVisible ?? '',
        safeImagePending: e.meta?.safeImagePending ?? '',
        viewportScaleQueueLength: e.meta?.viewportScaleQueueLength ?? '',
      })), options, 20);
  }

  function toggleSummary(options = {}) {
    const rows = toggleRows(options);
    if (options.table !== false) console.table(rows);
    return rows;
  }

  function toggleReport(options = {}) {
    const rows = toggleRows(options);
    const toggles = rows.filter(row => row.step === 'toggle');
    const maxTotalMs = toggles.reduce((max, row) => Math.max(max, Number(row.totalMs) || 0), 0);
    const out = {
      label: 'eyedropper-toggle-perf',
      reportedAt: new Date().toISOString(),
      runtime: runtimeState({ table: false }),
      safeCache: safeImageCacheSummary({ table: false }),
      recentToggles: rows,
      maxTotalMs,
    };
    if (options.log !== false) {
      console.table([{ maxTotalMs, toggles: toggles.length }]);
      if (rows.length) console.table(rows);
    }
    return out;
  }

  function status() {
    const out = { ...runtimeState(), ...stats, ...perfStats };
    console.table([out]);
    return out;
  }

  function runtimeState(options = {}) {
    const now = performance.now();
    const out = {
      enabled: eyedropperEnabled,
      sampling: eyedropperSampling,
      shieldActive: isEyedropperShieldActive(),
      loupeVisible: isEyedropperSampleVisible(),
      bodyClassEnabled: !!document.body?.classList.contains('eyedropper-enabled'),
      sampleRafActive: !!_eyedropperSampleRaf,
      pendingSampleEvent: !!_eyedropperPendingSampleEvent,
      safeImagePending: eyedropperSafeImagePromises.size,
      safeDisplayReloadPending: eyedropperSafeDisplayReloadPromises.size,
      safeScaledPending: eyedropperSafeScaledBitmapPending.size,
      safeImageCacheEntries: eyedropperSafeImageCache.size,
      safeScaledCacheEntries: eyedropperSafeScaledBitmapCache.size,
      viewportScaleQueueLength: typeof imageScaledVariantQueue !== 'undefined' ? imageScaledVariantQueue.length : '',
      viewportScaleQueueScheduled: typeof imageScaledVariantQueueScheduled !== 'undefined' ? !!imageScaledVariantQueueScheduled : '',
      viewportScalePending: typeof imageScaledBitmapPending !== 'undefined' ? imageScaledBitmapPending.size : '',
      viewportScalePrewarmTimerActive: typeof imageScaledVariantPrewarmTimer !== 'undefined' ? !!imageScaledVariantPrewarmTimer : '',
      viewportScaleRenderTimerActive: typeof imageScaledVariantRenderTimer !== 'undefined' ? !!imageScaledVariantRenderTimer : '',
      viewportImageScalingEnabled: typeof viewportImageScalingEnabled !== 'undefined' ? !!viewportImageScalingEnabled : '',
      previousImageScalingEnabled: eyedropperPreviousImageScalingEnabled ?? '',
      lastViewportInputAgeMs: typeof lastViewportInputAt !== 'undefined' && lastViewportInputAt ? Math.round(now - lastViewportInputAt) : '',
    };
    if (options.table !== false) console.table([out]);
    return out;
  }

  function timingSummary(options = {}) {
    const rows = Object.entries(phaseStats)
      .map(([phase, stat]) => ({
        phase,
        count: stat.count,
        avgMs: stat.count ? roundMs(stat.totalMs / stat.count) : 0,
        maxMs: roundMs(stat.maxMs),
        totalMs: roundMs(stat.totalMs),
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
    if (options.table !== false) console.table(rows);
    return rows;
  }

  function slowSampleSummary(options = {}) {
    const rows = recentRows(slowSamples, options, 25);
    console.table(rows);
    return rows;
  }

  function firstSampleSummary(options = {}) {
    const rows = recentRows(firstSamples, options, 20);
    console.table(rows);
    return rows;
  }

  function previewPresentSummary(options = {}) {
    const rows = recentRows(previewPresentSamples, options, 25);
    console.table(rows);
    return rows;
  }

  function logPreviewPresent(meta = {}) {
    if (!core.enabled) return;
    const row = {
      at: roundMs(performance.now()),
      clientX: meta.clientX ?? '',
      clientY: meta.clientY ?? '',
      firstSample: !!meta.firstSample,
      clickToPreviewVisibleMs: roundMs(meta.clickToPreviewVisibleMs),
      eventToPreviewVisibleMs: roundMs(meta.eventToPreviewVisibleMs),
      clickToPreviewFrameMs: roundMs(meta.clickToPreviewFrameMs),
      eventToPreviewFrameMs: roundMs(meta.eventToPreviewFrameMs),
      sampleMs: roundMs(meta.sampleMs),
      inputAgeAtReceiveMs: roundMs(meta.inputAgeAtReceiveMs),
      inputAgeAtCommitMs: roundMs(meta.inputAgeAtCommitMs),
      queueDelayMs: roundMs(meta.queueDelayMs),
      previewPainted: !!meta.previewPainted,
      drawnImages: meta.drawnImages ?? '',
      drawnText: meta.drawnText ?? '',
      previewReadable: meta.previewReadable ?? '',
      previewSuspectedBlank: meta.previewSuspectedBlank ?? '',
      loupeVisible: isEyedropperSampleVisible(),
    };
    perfStats.maxClickToPreviewFrameMs = Math.max(perfStats.maxClickToPreviewFrameMs, Number(row.clickToPreviewFrameMs) || 0);
    perfStats.maxEventToPreviewFrameMs = Math.max(perfStats.maxEventToPreviewFrameMs, Number(row.eventToPreviewFrameMs) || 0);
    previewPresentSamples.push(row);
    if (previewPresentSamples.length > MAX_PREVIEW_PRESENT_SAMPLES) previewPresentSamples.shift();
    if ((Number(row.clickToPreviewFrameMs) || 0) > 250 || (Number(row.eventToPreviewFrameMs) || 0) > 250) {
      slowPreviewPresentSamples.push(row);
      if (slowPreviewPresentSamples.length > MAX_PREVIEW_PRESENT_SAMPLES) slowPreviewPresentSamples.shift();
    }
    core.push({ step: 'preview-present', meta: row });
  }

  function slowPreviewPresentSummary(options = {}) {
    const rows = recentRows(slowPreviewPresentSamples, options, 25);
    console.table(rows);
    return rows;
  }

  function previewMismatchSummary(options = {}) {
    const rows = recentRows(previewMismatchSamples, options, 25);
    console.table(rows);
    return rows;
  }

  function longTaskSummary(options = {}) {
    const rows = recentRows(longTasks, options, 25);
    console.table(rows);
    return rows;
  }

  function frameGapSummary(options = {}) {
    const rows = recentRows(frameGaps, options, 25);
    console.table(rows);
    return rows;
  }

  function stutterSummary(options = {}) {
    const rows = recentRows(frameGaps.map(row => ({
      at: row.at,
      gapMs: row.gapMs,
      severity: row.severity,
      sampling: row.sampling,
      loupeVisible: row.loupeVisible,
      sampleRafActive: row.sampleRafActive,
      pendingSampleEvent: row.pendingSampleEvent,
      pendingCoalescedMoves: row.pendingCoalescedMoves,
      latestPointerAgeMs: row.latestPointerAgeMs,
      safeImagePending: row.safeImagePending,
      safeScaledPending: row.safeScaledPending,
      tileCachePending: row.tileCachePending,
      tileCacheSize: row.tileCacheSize,
      lastEvent: row.lastSamplingEvent?.event || '',
      lastEventAgeMs: row.lastSamplingEvent?.at ? roundMs(row.at - row.lastSamplingEvent.at) : '',
      lastEventSampleMs: row.lastSamplingEvent?.sampleMs ?? '',
      lastEventQueueDelayMs: row.lastSamplingEvent?.queueDelayMs ?? '',
      visibility: row.visibility,
      hasFocus: row.hasFocus,
    })), options, 40);
    console.table(rows);
    return rows;
  }

  function eventTimeline(options = {}) {
    const rows = recentRows(events
      .filter(e => e.step === 'sample-event' || e.step === 'preview-present')
      .map(sampleEventRow), options, 80);
    console.table(rows);
    return rows;
  }

  function safeImageTimeline(options = {}) {
    const rows = recentRows(events
      .filter(e => e.step === 'sample-event' && String(e.meta?.event || '').startsWith('safe-image'))
      .map(sampleEventRow), options, 80);
    console.table(rows);
    return rows;
  }

  function nativePixelTimeline(options = {}) {
    const rows = recentRows(events
      .filter(e => e.step === 'sample-event' && String(e.meta?.event || '').startsWith('native-pixel'))
      .map(sampleEventRow), options, 120);
    console.table(rows);
    return rows;
  }

  function nativePixelSummary(options = {}) {
    const nativeEvents = events.filter(e => e.step === 'sample-event' && String(e.meta?.event || '').startsWith('native-pixel'));
    const byEvent = {};
    const byReason = {};
    for (const entry of nativeEvents) {
      const event = entry.meta?.event || '';
      const reason = entry.meta?.reason || '';
      byEvent[event] = (byEvent[event] || 0) + 1;
      if (reason) byReason[reason] = (byReason[reason] || 0) + 1;
    }
    const out = {
      totals: {
        events: nativeEvents.length,
        requests: byEvent['native-pixel-request-start'] || 0,
        ready: byEvent['native-pixel-ready'] || 0,
        resolveMisses: byEvent['native-pixel-resolve-miss'] || 0,
        busySkips: byEvent['native-pixel-queue-busy'] || 0,
        readoutPending: byEvent['native-pixel-readout-pending'] || 0,
        discarded: byEvent['native-pixel-discarded'] || 0,
      },
      byEvent,
      byReason,
      recent: recentRows(nativeEvents.map(sampleEventRow), options, 40),
    };
    if (options.table !== false) {
      console.table([out.totals]);
      console.table(out.recent);
    }
    return out;
  }

  function hexEqual(a, b) {
    return String(a || '').toUpperCase() === String(b || '').toUpperCase();
  }

  function backgroundReadoutRow(e, backgroundHex) {
    const displayedIsBackground = hexEqual(e.meta?.displayedHex, backgroundHex);
    const readoutIsBackground = hexEqual(e.meta?.readoutPixel, backgroundHex);
    const centerIsBackground = hexEqual(e.meta?.centerPixel, backgroundHex);
    const previewIsBackground = hexEqual(e.meta?.previewPixel, backgroundHex);
    return {
      at: e.at,
      x: e.meta?.clientX ?? '',
      y: e.meta?.clientY ?? '',
      top: e.meta?.topObjectId || '',
      topType: e.meta?.topObjectType || '',
      source: e.meta?.readoutSource || '',
      reason: e.meta?.readoutReason || '',
      displayedHex: e.meta?.displayedHex || '',
      readoutPixel: e.meta?.readoutPixel || '',
      centerPixel: e.meta?.centerPixel || '',
      previewPixel: e.meta?.previewPixel || '',
      displayedIsBackground,
      readoutIsBackground,
      centerIsBackground,
      previewIsBackground,
      pendingImages: e.meta?.readbackSafePendingImages ?? '',
      missingImages: e.meta?.missingImages ?? '',
      nativeSkipped: e.meta?.nativeSourceHydrationSkipped ?? '',
      lastMissingReason: e.meta?.lastMissingReason || '',
      sampleMs: e.meta?.sampleMs ?? '',
      inputAgeMs: e.meta?.inputAgeAtCommitMs ?? '',
      queueDelayMs: e.meta?.queueDelayMs ?? '',
      frameCoalescedMoves: e.meta?.frameCoalescedMoves ?? '',
    };
  }

  function backgroundReadoutReport(options = {}) {
    const backgroundHex = rgbaToHex(boardBackgroundPixel());
    const sampleEvents = events.filter(e => e.step === 'sample');
    const imageSamples = sampleEvents.filter(e => e.meta?.topObjectType === 'image');
    const rows = imageSamples
      .map(e => backgroundReadoutRow(e, backgroundHex))
      .filter(row => row.displayedIsBackground || row.readoutIsBackground || row.centerIsBackground || row.previewIsBackground);
    const displayedRows = rows.filter(row => row.displayedIsBackground);
    const readoutRows = rows.filter(row => row.readoutIsBackground || row.centerIsBackground);
    const byReason = {};
    const bySource = {};
    for (const row of rows) {
      const reason = row.reason || 'unknown';
      const source = row.source || 'unknown';
      byReason[reason] = (byReason[reason] || 0) + 1;
      bySource[source] = (bySource[source] || 0) + 1;
    }
    const out = {
      backgroundHex,
      totals: {
        samples: sampleEvents.length,
        imageSamples: imageSamples.length,
        imageSamplesWithAnyBackground: rows.length,
        imageSamplesDisplayingBackground: displayedRows.length,
        imageSamplesReadoutBackground: readoutRows.length,
      },
      byReason,
      bySource,
      recent: recentRows(rows, options, 80),
      recentDisplayedBackground: recentRows(displayedRows, options?.displayed ?? options, 40),
      recentReadoutBackground: recentRows(readoutRows, options?.readout ?? options, 40),
      nativePixel: nativePixelSummary({ table: false, limit: debugLimit(options?.nativePixel ?? options, 80) }),
    };
    if (options.table !== false) {
      console.table([out.totals]);
      console.table(out.recent);
    }
    return out;
  }

  function sampleAt(clientX, clientY) {
    const x = Number(clientX);
    const y = Number(clientY);
    const dpr = window.devicePixelRatio || 1;
    const drawSize = eyedropperPreviewDrawSize(dpr);
    if (eyedropperCanvas && drawSize > 0) {
      if (eyedropperCanvas.width !== drawSize) eyedropperCanvas.width = drawSize;
      if (eyedropperCanvas.height !== drawSize) eyedropperCanvas.height = drawSize;
    }
    const previewSample = paintZoomedBoardPreview(x, y, drawSize);
    const readoutSample = sampleEyedropperReadoutPixel(x, y, previewSample);
    const centerPixel = readoutSample?.pixel;
    const snapshot = sampleSnapshot(x, y, previewSample, centerPixel, readoutSample);
    if (core.enabled) logSample(x, y, previewSample, centerPixel, readoutSample);
    console.log(snapshot);
    if (snapshot.textHits.length) console.table(snapshot.textHits);
    return snapshot;
  }

  function readoutAt(clientX, clientY) {
    const x = Number(clientX);
    const y = Number(clientY);
    const out = displayedBoardPixelSampleInfo(x, y, { logFailures: true });
    console.table([out]);
    return out;
  }

  function textBoundsReport() {
    const rows = objects
      .filter(obj => obj?.type === 'text')
      .map((obj) => {
        const ink = textInkBounds(obj);
        return {
          id: obj.id,
          z: obj.z,
          content: String(obj.data?.content || '').slice(0, 60),
          savedW: obj.w,
          savedH: obj.h,
          inkW: ink.maxLineW,
          inkH: ink.y2 - ink.y1,
          overflowRight: Math.max(0, ink.x2 - (obj.x + obj.w)),
          overflowBottom: Math.max(0, ink.y2 - (obj.y + obj.h)),
          lines: ink.lines,
        };
      })
      .sort((a, b) => (b.overflowRight + b.overflowBottom) - (a.overflowRight + a.overflowBottom));
    console.table(rows);
    return rows;
  }

  function safeImageCacheSummary(options = {}) {
    const bySource = {};
    for (const entry of eyedropperSafeImageCache.values()) {
      const source = entry?.sourceKind || 'unknown';
      bySource[source] = (bySource[source] || 0) + 1;
    }
    let scaledCount = 0;
    let scaledBytes = 0;
    for (const map of eyedropperSafeScaledBitmapCache.values()) {
      for (const entry of map.values()) {
        scaledCount++;
        scaledBytes += entry?.bytes || 0;
      }
    }
    let scaledPendingBytes = 0;
    for (const bytes of eyedropperSafeScaledBitmapPendingBytes.values()) scaledPendingBytes += bytes || 0;
    const out = {
      cached: eyedropperSafeImageCache.size,
      pendingLoads: eyedropperSafeImagePromises.size,
      scaledCaches: eyedropperSafeScaledBitmapCache.size,
      scaledVariants: scaledCount,
      scaledMB: roundMs(scaledBytes / 1024 / 1024),
      scaledLimitMB: roundMs(EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT / 1024 / 1024),
      scaledPending: eyedropperSafeScaledBitmapPending.size,
      scaledPendingMB: roundMs(scaledPendingBytes / 1024 / 1024),
      scaledEvictions: stats.safeScaledEvictions,
      scaledMemorySkips: stats.safeScaledMemorySkips,
      displayProbeFailures: eyedropperSafeDisplayProbeFailures.size,
      displayReloadPending: eyedropperSafeDisplayReloadPromises.size,
      tileCaches: eyedropperSafeTileCache.size,
      tileCachePending: eyedropperSafeTileCachePending.size,
      tileCacheMB: roundMs(eyedropperSafeTileCacheBytes / 1024 / 1024),
      tileCacheLimitMB: roundMs(EYEDROPPER_SAFE_TILE_MEMORY_LIMIT / 1024 / 1024),
      nativeSourceSkipsLogged: eyedropperNativeSourceSkipLogged.size,
      ...bySource,
    };
    if (options.table !== false) console.table([out]);
    return out;
  }

  function report(options = {}) {
    const sampleEvents = events.filter(e => e.step === 'sample');
    const failureEvents = events.filter(e => e.step === 'readback-fail' || e.step === 'fallback-sample' || e.step === 'unsafe-image-skip');
    const timelineEvents = events.filter(e => e.step === 'sample-event' || e.step === 'preview-present');
    const sampleLimit = debugLimit(options?.samples ?? options, 12);
    const failureLimit = debugLimit(options?.failures ?? options, 12);
    const totals = {
      events: events.length,
      samples: sampleEvents.length,
      failures: failureEvents.length,
      sampleMoves: perfStats.sampleMoves,
      sampleCommits: perfStats.sampleCommits,
      firstSamples: perfStats.firstSamples,
      coalescedMoves: perfStats.sampleCoalescedMoves,
      prewarmRunsTimed: perfStats.prewarmRunsTimed,
      slowSamples: perfStats.slowSamples,
      maxSampleMs: roundMs(perfStats.maxSampleMs),
      maxFirstSampleMs: roundMs(perfStats.maxFirstSampleMs),
      maxPrewarmMs: roundMs(perfStats.maxPrewarmMs),
      samplesWithMissingImages: sampleEvents.filter(e => Number(e.meta?.missingImages) > 0).length,
      samplesWithPendingImages: sampleEvents.filter(e => Number(e.meta?.readbackSafePendingImages) > 0).length,
      samplesWithNativeSkips: sampleEvents.filter(e => Number(e.meta?.nativeSourceHydrationSkipped) > 0).length,
      samplesUsingDisplayCache: sampleEvents.filter(e => Number(e.meta?.safeDisplayImages) > 0).length,
      samplesUsingDataUrlCache: sampleEvents.filter(e => Number(e.meta?.safeDataUrlImages) > 0).length,
    };
    const out = {
      stats: { ...stats },
      perf: { ...perfStats },
      timings: timingSummary({ table: false }),
      safeCache: safeImageCacheSummary({ table: false }),
      totals,
      recentSamples: recentRows(sampleEvents.map(sampleRow), sampleLimit, sampleLimit),
      firstSamples: recentRows(firstSamples, options?.first ?? options, 12),
      slowSamples: recentRows(slowSamples, options?.slow ?? options, 12),
      previewPresent: recentRows(previewPresentSamples, options?.present ?? options, 12),
      slowPreviewPresent: recentRows(slowPreviewPresentSamples, options?.slowPresent ?? options, 12),
      previewMismatches: recentRows(previewMismatchSamples, options?.preview ?? options, 12),
      eventTimeline: recentRows(timelineEvents.map(sampleEventRow), options?.timeline ?? options, 30),
      safeImageTimeline: safeImageTimeline({ table: false, limit: debugLimit(options?.safeImages ?? options, 80) }),
      nativePixel: nativePixelSummary({ table: false, limit: debugLimit(options?.nativePixel ?? options, 40) }),
      longTasks: recentRows(longTasks, options?.longTasks ?? options, 12),
      frameGaps: recentRows(frameGaps, options?.frameGaps ?? options, 12),
      stutters: stutterSummary({ table: false, limit: debugLimit(options?.stutters ?? options, 12) }),
      recentFailures: recentRows(failureEvents.map(failureRow), failureLimit, failureLimit),
      recentInteractions: recentRows(events.filter(e => e.step === 'interaction').map(e => ({
        at: e.at,
        event: e.meta?.eventType || '',
        pointerType: e.meta?.pointerType || '',
        allowed: e.meta?.allowed ?? '',
        reason: e.meta?.reason || '',
        target: e.meta?.target || '',
        x: e.meta?.clientX ?? '',
        y: e.meta?.clientY ?? '',
      })), options?.interactions ?? options, 12),
      runtime: runtimeState({ table: false }),
      last: compactLastSample(),
    };
    if (options.log !== false) console.log(out);
    return out;
  }

  function last(options = {}) {
    const compact = options?.compact !== false;
    const out = compact ? compactLastSample() : lastSample;
    console.log(out);
    if (!compact && lastSample?.textHits?.length) console.table(lastSample.textHits);
    return out;
  }

  function reset() {
    core.reset();
    lastSample = null;
    for (const key of Object.keys(stats)) stats[key] = 0;
    for (const key of Object.keys(perfStats)) perfStats[key] = 0;
    for (const key of Object.keys(phaseStats)) delete phaseStats[key];
    lastSamplingEvent = null;
    slowSamples.length = 0;
    firstSamples.length = 0;
    previewPresentSamples.length = 0;
    slowPreviewPresentSamples.length = 0;
    previewMismatchSamples.length = 0;
    longTasks.length = 0;
    frameGaps.length = 0;
  }

  function clearCaches() {
    clearEyedropperSafeImageCache();
    return safeImageCacheSummary();
  }

  function coldReset() {
    reset();
    clearEyedropperSafeImageCache();
    return status();
  }

  return {
    enable,
    disable,
    setVerbose: core.setVerbose,
    reset,
    coldReset,
    clearCaches,
    summary,
    imageSummary,
    interactionSummary,
    toggleSummary,
    toggleReport,
    safeImageCacheSummary,
    report,
    timingSummary,
    firstSampleSummary,
    previewPresentSummary,
    slowPreviewPresentSummary,
    previewMismatchSummary,
    longTaskSummary,
    frameGapSummary,
    stutterSummary,
    eventTimeline,
    safeImageTimeline,
    nativePixelTimeline,
    nativePixelSummary,
    backgroundReadoutReport,
    slowSampleSummary,
    readbackFailures,
    status,
    state: runtimeState,
    sampleAt,
    readoutAt,
    textBoundsReport,
    last,
    get enabled() { return core.enabled; },
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
    _logSample: logSample,
    _logReadbackFailure: logReadbackFailure,
    _logFallbackSample: logFallbackSample,
    _logUnsafeImageSkip: logUnsafeImageSkip,
    _logInteraction: logInteraction,
    _logToggle: logToggle,
    _logSamplingEvent: logSamplingEvent,
    _logPreviewPresent: logPreviewPresent,
    _startFrameProbe: startFrameProbe,
    _stopFrameProbe: stopFrameProbe,
    _count: count,
    _countPerf: countPerf,
    _recordSampleTiming: recordSampleTiming,
    _recordPrewarmTiming: recordPrewarmTiming,
  };
})();

exposeDebug({ eyedropper: EyedropperDebug });
