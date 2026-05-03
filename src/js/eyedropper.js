'use strict';

var eyedropperLoupe = document.getElementById('eyedropper-loupe');
var eyedropperPreview = document.getElementById('eyedropper-preview');
var eyedropperCanvas = document.getElementById('eyedropper-canvas');
var eyedropperSwatch = document.getElementById('eyedropper-swatch');
var eyedropperHex = document.getElementById('eyedropper-hex');
var eyedropperHsl = document.getElementById('eyedropper-hsl');
var eyedropperRgb = document.getElementById('eyedropper-rgb');
var eyedropperCtx = eyedropperCanvas?.getContext('2d', { willReadFrequently: true });
var eyedropperRenderedSampleCanvas = document.createElement('canvas');
var eyedropperRenderedSampleCtx = eyedropperRenderedSampleCanvas.getContext('2d', { willReadFrequently: true });
var eyedropperEnabled = false;
var eyedropperSampling = false;
var _eyedropperLastSampleEvent = null;
var _eyedropperPendingSampleEvent = null;
var _eyedropperSampleRaf = null;
var _eyedropperShieldRelease = null;
var eyedropperSafeImageCache = new Map();
var eyedropperSafeImagePromises = new Map();
var eyedropperSafeDisplayReloadPromises = new Map();
var eyedropperSafeScaledBitmapCache = new Map();
var eyedropperSafeScaledBitmapPending = new Set();
var eyedropperSafeScaledBitmapPendingBytes = new Map();
var eyedropperSafeScaledBitmapBytes = 0;
var eyedropperSafeScaledBitmapUseCounter = 1;
var eyedropperSafeDisplayProbeFailures = new Map();
var eyedropperNativeSourceSkipLogged = new Set();
var eyedropperReadbackProbeCanvas = document.createElement('canvas');
var eyedropperReadbackProbeCtx = eyedropperReadbackProbeCanvas.getContext('2d', { willReadFrequently: true });
var _eyedropperPrewarmRaf = null;
var _eyedropperPendingPrewarmEvent = null;
var _eyedropperViewportPrewarmRaf = null;
var _eyedropperViewportPrewarmScheduled = false;
var _eyedropperLoupeHorizontalSide = 'right';
var EYEDROPPER_PREWARM_LIMIT = 16;
var EYEDROPPER_VIEWPORT_PREWARM_LIMIT = Number.POSITIVE_INFINITY;
var EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT = 256 * 1024 * 1024;
var EYEDROPPER_PREWARM_PAD_CSS = 220;
var EYEDROPPER_PREVIEW_ZOOM_SCALE = 3;
var EYEDROPPER_PREVIEW_CSS = 96;
var EYEDROPPER_MENU_CSS_WIDTH = 280;
var EYEDROPPER_MENU_CSS_HEIGHT = 392;

function cssPx(value) {
  const px = Number.parseFloat(value);
  return Number.isFinite(px) ? px : 0;
}

function eyedropperPreviewCssSize() {
  const rect = eyedropperPreview?.getBoundingClientRect();
  if (rect?.width > 0) return rect.width;

  const style = eyedropperLoupe ? getComputedStyle(eyedropperLoupe) : null;
  if (!style) return EYEDROPPER_PREVIEW_CSS;

  const borderX = cssPx(style.borderLeftWidth) + cssPx(style.borderRightWidth);
  const declaredWidth = cssPx(style.width) || EYEDROPPER_MENU_CSS_WIDTH;
  const viewportMax = Math.max(1, window.innerWidth - 24);
  const outerWidth = Math.min(declaredWidth, viewportMax);
  // The preview wrapper has negative horizontal margins that bleed through the
  // loupe padding, so its visible width is the border-box width minus borders.
  const contentWidth = style.boxSizing === 'border-box'
    ? outerWidth - borderX
    : outerWidth;

  return Math.max(1, contentWidth || EYEDROPPER_PREVIEW_CSS);
}

function eyedropperPreviewDrawSize(dpr = window.devicePixelRatio || 1) {
  return Math.max(1, Math.round(eyedropperPreviewCssSize() * dpr));
}

var EyedropperDebug = (() => {
  const core = createDebugRecorder({
    maxEvents: 500,
    label: '[Boardfish eyedropper]',
    sanitize: (value) => sanitizeDebugMeta(value, { roundNumbers: true }),
  });
  const events = core._events;
  let lastSample = null;
  const MAX_SLOW_SAMPLES = 80;
  const SLOW_SAMPLE_MS = 16.7;
  const slowSamples = [];
  const phaseStats = {};
  const perfStats = {
    sampleMoves: 0,
    sampleCommits: 0,
    sampleCoalescedMoves: 0,
    prewarmScheduled: 0,
    prewarmCoalesced: 0,
    prewarmRunsTimed: 0,
    slowSamples: 0,
    maxSampleMs: 0,
    maxPrewarmMs: 0,
  };
  const stats = {
    readbackFailures: 0,
    fallbackSamples: 0,
    unsafeImageSkips: 0,
    safeDisplayImages: 0,
    safeDisplayProbeFailures: 0,
    safeDisplayCorsLoads: 0,
    safeDisplayCorsPending: 0,
    safeDisplayCorsFailures: 0,
    safeDataUrlImages: 0,
    safeDataUrlLoads: 0,
    safeDataUrlPending: 0,
    nativeSourceHydrationSkipped: 0,
    prewarmRuns: 0,
    prewarmCandidates: 0,
    prewarmReady: 0,
    viewportPrewarmRuns: 0,
    viewportPrewarmCandidates: 0,
    viewportPrewarmReady: 0,
    viewportScalePrewarmReady: 0,
    viewportScalePrewarmQueued: 0,
    safeScaledEvictions: 0,
    safeScaledMemorySkips: 0,
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

  function recordSampleTiming(clientX, clientY, previewSample = null, timings = {}) {
    if (!core.enabled) return;
    perfStats.sampleCommits++;
    recordPhases(timings);
    const sampleMs = Number(timings.total || 0);
    perfStats.maxSampleMs = Math.max(perfStats.maxSampleMs, sampleMs);
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
        timings: compactTimings(timings),
      });
      if (slowSamples.length > MAX_SLOW_SAMPLES) slowSamples.shift();
    }
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
    return Math.max(1, Math.min(200, Number(raw) || fallback));
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
      top: e.meta?.topObjectId || '',
      topType: e.meta?.topObjectType || '',
      center: compactPixel(e.meta?.centerPixel),
      drawnImages: e.meta?.drawnImages ?? '',
      missingImages: e.meta?.missingImages ?? '',
      pendingImages: e.meta?.readbackSafePendingImages ?? '',
      safeDisplayImages: e.meta?.safeDisplayImages ?? '',
      safeDisplayCorsImages: e.meta?.safeDisplayCorsImages ?? '',
      safeDataUrlImages: e.meta?.safeDataUrlImages ?? '',
      nativeSkipped: e.meta?.nativeSourceHydrationSkipped ?? '',
      lastMissingKey: e.meta?.lastMissingKey || '',
      lastMissingReason: e.meta?.lastMissingReason || '',
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
      topObjectId: sample.topObjectId,
      topObjectType: sample.topObjectType,
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
      safeDisplayCorsImages: sample.safeDisplayCorsImages,
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
    const readoutSample = displayedBoardPixelSampleInfo(clientX, clientY, { logFailures: false });
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
      readoutPixel: rgbaToHex(readoutSample.pixel),
      readoutRgba: readoutSample.rgbaText,
      readoutCanvasX: readoutSample.sourceX ?? '',
      readoutCanvasY: readoutSample.sourceY ?? '',
      readoutReason: readoutSample.reason || '',
      readoutInBounds: readoutSample.inBounds ?? '',
      readoutCanvasW: readoutSample.canvasW ?? '',
      readoutCanvasH: readoutSample.canvasH ?? '',
      readoutRectW: readoutSample.rectW ?? '',
      readoutRectH: readoutSample.rectH ?? '',
      readoutScaleX: readoutSample.scaleX ?? '',
      readoutScaleY: readoutSample.scaleY ?? '',
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
      safeDisplayCorsImages: counters.safeDisplayCorsImages ?? '',
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

  function count(name, amount = 1) {
    countStat(name, amount);
  }

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish eyedropper debugger enabled. Use BoardfishDebug.eyedropper.report() for compact JSON, plus .timingSummary(), .slowSampleSummary(), .status(), .imageSummary({ limit }), .safeImageCacheSummary(), .prewarmAt(clientX, clientY), .readbackFailures({ limit }), .last(), .summary({ limit }), .sampleAt(clientX, clientY), .textBoundsReport(), or .reset().');
  }

  function disable() {
    core.disable();
    console.info('Boardfish eyedropper debugger disabled.');
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
      safeDisplayCorsImages: e.meta?.safeDisplayCorsImages ?? '',
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
        safeDisplayCorsImages: e.meta?.safeDisplayCorsImages ?? '',
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

  function status() {
    const out = { ...stats, ...perfStats };
    console.table([out]);
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
      nativeSourceSkipsLogged: eyedropperNativeSourceSkipLogged.size,
      ...bySource,
    };
    if (options.table !== false) console.table([out]);
    return out;
  }

  function report(options = {}) {
    const sampleEvents = events.filter(e => e.step === 'sample');
    const failureEvents = events.filter(e => e.step === 'readback-fail' || e.step === 'fallback-sample' || e.step === 'unsafe-image-skip');
    const sampleLimit = debugLimit(options?.samples ?? options, 12);
    const failureLimit = debugLimit(options?.failures ?? options, 12);
    const totals = {
      events: events.length,
      samples: sampleEvents.length,
      failures: failureEvents.length,
      sampleMoves: perfStats.sampleMoves,
      sampleCommits: perfStats.sampleCommits,
      coalescedMoves: perfStats.sampleCoalescedMoves,
      prewarmScheduled: perfStats.prewarmScheduled,
      prewarmCoalesced: perfStats.prewarmCoalesced,
      prewarmRunsTimed: perfStats.prewarmRunsTimed,
      viewportPrewarmRuns: stats.viewportPrewarmRuns,
      viewportPrewarmCandidates: stats.viewportPrewarmCandidates,
      viewportPrewarmReady: stats.viewportPrewarmReady,
      slowSamples: perfStats.slowSamples,
      maxSampleMs: roundMs(perfStats.maxSampleMs),
      maxPrewarmMs: roundMs(perfStats.maxPrewarmMs),
      samplesWithMissingImages: sampleEvents.filter(e => Number(e.meta?.missingImages) > 0).length,
      samplesWithPendingImages: sampleEvents.filter(e => Number(e.meta?.readbackSafePendingImages) > 0).length,
      samplesWithNativeSkips: sampleEvents.filter(e => Number(e.meta?.nativeSourceHydrationSkipped) > 0).length,
      samplesUsingDisplayCache: sampleEvents.filter(e => Number(e.meta?.safeDisplayImages) > 0).length,
      samplesUsingDisplayCorsCache: sampleEvents.filter(e => Number(e.meta?.safeDisplayCorsImages) > 0).length,
      samplesUsingDataUrlCache: sampleEvents.filter(e => Number(e.meta?.safeDataUrlImages) > 0).length,
    };
    const out = {
      stats: { ...stats },
      perf: { ...perfStats },
      timings: timingSummary({ table: false }),
      safeCache: safeImageCacheSummary({ table: false }),
      totals,
      recentSamples: recentRows(sampleEvents.map(sampleRow), sampleLimit, sampleLimit),
      slowSamples: recentRows(slowSamples, options?.slow ?? options, 12),
      recentFailures: recentRows(failureEvents.map(failureRow), failureLimit, failureLimit),
      last: compactLastSample(),
    };
    if (options.log !== false) console.log(out);
    return out;
  }

  function prewarmAt(clientX, clientY, options = {}) {
    const result = prewarmEyedropperSafeImages(Number(clientX), Number(clientY), options);
    console.table([result.summary]);
    if (result.rows.length) console.table(result.rows);
    return result;
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
    slowSamples.length = 0;
  }

  return {
    enable,
    disable,
    setVerbose: core.setVerbose,
    reset,
    summary,
    imageSummary,
    safeImageCacheSummary,
    report,
    timingSummary,
    slowSampleSummary,
    readbackFailures,
    status,
    sampleAt,
    readoutAt,
    prewarmAt,
    textBoundsReport,
    last,
    get enabled() { return core.enabled; },
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
    _logSample: logSample,
    _logReadbackFailure: logReadbackFailure,
    _logFallbackSample: logFallbackSample,
    _logUnsafeImageSkip: logUnsafeImageSkip,
    _count: count,
    _countPerf: countPerf,
    _recordSampleTiming: recordSampleTiming,
    _recordPrewarmTiming: recordPrewarmTiming,
  };
})();

exposeDebug({ eyedropper: EyedropperDebug });

function setEyedropperEnabled(enabled) {
  eyedropperEnabled = !!enabled;
  if (eyedropperEnabled && !_eyedropperShieldRelease) {
    _eyedropperShieldRelease = acquireInputShield(
      'pointerdown:0',
      'pointermove',
      'pointerup:0',
      'mousedown:0',
      'mousemove',
      'mouseup:0',
      'contextmenu',
      'wheel',
      'key:escape',
      'key:i',
      'key:o',
      'key:s',
      'code:keyo',
      'code:keys',
      'code:space',
      { visual: false, allowBoardNavigation: true },
    );
  } else if (!eyedropperEnabled && _eyedropperShieldRelease) {
    _eyedropperShieldRelease();
    _eyedropperShieldRelease = null;
  }
  if (eyedropperMenuBtn) eyedropperMenuBtn.setAttribute('aria-pressed', eyedropperEnabled ? 'true' : 'false');
  document.body.classList.toggle('eyedropper-enabled', eyedropperEnabled);
  updateEyedropperCommandState();
  if (typeof updateCtxMenuActions === 'function') updateCtxMenuActions();
  if (eyedropperEnabled) {
    scheduleEyedropperViewportPrewarm('enable', { afterFrame: false });
  } else {
    hideEyedropperSample();
  }
  updateSelectionOverlay();
}

function isEyedropperShieldActive() {
  return eyedropperEnabled && !!_eyedropperShieldRelease;
}

function isCommandBlockedByEyedropper(commandId) {
  return eyedropperEnabled && ['btn-add-text', 'btn-add-image', 'btn-paste'].includes(commandId);
}

function updateEyedropperCommandState() {
  const creationGroupTrailingSep = pasteBtn?.nextElementSibling?.classList?.contains('ctx-sep')
    ? pasteBtn.nextElementSibling
    : null;
  for (const button of [addTextBtn, addImageBtn, pasteBtn]) {
    if (!button) continue;
    button.disabled = eyedropperEnabled;
    button.setAttribute('aria-disabled', eyedropperEnabled ? 'true' : 'false');
    button.style.display = eyedropperEnabled ? 'none' : '';
  }
  if (creationGroupTrailingSep) creationGroupTrailingSep.style.display = eyedropperEnabled ? 'none' : '';
}

function positionEyedropperLoupe(clientX, clientY) {
  const margin = 18;
  const gap = 22;
  const rect = eyedropperLoupe.getBoundingClientRect();
  const previewRect = eyedropperPreview?.getBoundingClientRect();
  const width = rect.width || EYEDROPPER_MENU_CSS_WIDTH;
  const height = rect.height || EYEDROPPER_MENU_CSS_HEIGHT;
  const previewHeight = previewRect?.height || width;
  const previewTopOffset = previewRect?.height ? previewRect.top - rect.top : 0;
  const rightSideLeft = clientX + gap;
  const leftSideLeft = clientX - width - gap;
  const unclampedTop = clientY - previewTopOffset - (previewHeight / 2);
  if (_eyedropperLoupeHorizontalSide === 'right') {
    if (rightSideLeft + width + margin > window.innerWidth) {
      _eyedropperLoupeHorizontalSide = 'left';
    }
  } else if (leftSideLeft < margin) {
    _eyedropperLoupeHorizontalSide = 'right';
  }
  let left = _eyedropperLoupeHorizontalSide === 'left' ? leftSideLeft : rightSideLeft;
  left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
  const top = Math.max(margin, Math.min(window.innerHeight - height - margin, unclampedTop));
  eyedropperLoupe.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
}

function rgbaToCss(pixel) {
  if (!pixel) return 'transparent';
  return `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${Math.round((pixel[3] / 255) * 1000) / 1000})`;
}

function colorByteToHex(value) {
  return Number(value || 0).toString(16).padStart(2, '0').toUpperCase();
}

function rgbaToHex(pixel) {
  if (!pixel) return '#000000';
  const hex = `#${colorByteToHex(pixel[0])}${colorByteToHex(pixel[1])}${colorByteToHex(pixel[2])}`;
  return pixel[3] === 255 ? hex : `${hex}${colorByteToHex(pixel[3])}`;
}

function rgbaToRgbText(pixel) {
  if (!pixel) return '0 0 0';
  return `${pixel[0]} ${pixel[1]} ${pixel[2]}`;
}

function rgbaToHslText(pixel) {
  if (!pixel) return '0 0% 0%';
  const r = pixel[0] / 255;
  const g = pixel[1] / 255;
  const b = pixel[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }

  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function updateEyedropperColorReadout(pixel) {
  const cssColor = rgbaToCss(pixel);
  if (eyedropperSwatch) eyedropperSwatch.style.background = cssColor;
  if (eyedropperHex) eyedropperHex.textContent = rgbaToHex(pixel);
  if (eyedropperHsl) eyedropperHsl.textContent = rgbaToHslText(pixel);
  if (eyedropperRgb) eyedropperRgb.textContent = rgbaToRgbText(pixel);
}

function sampleCanvasPixel(context, sourceX, sourceY, meta = {}) {
  try {
    const data = context.getImageData(sourceX, sourceY, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  } catch (err) {
    if (meta.logFailures !== false) {
      EyedropperDebug._logReadbackFailure(meta.where || 'canvas-pixel', {
        x: sourceX,
        y: sourceY,
        width: context?.canvas?.width ?? '',
        height: context?.canvas?.height ?? '',
        error: String(err),
        ...meta,
      });
    }
    return null;
  }
}

function displayedBoardPixelSampleInfo(clientX, clientY, options = {}) {
  const out = {
    clientX,
    clientY,
    boardCanvasPresent: !!boardCanvas,
    ctxPresent: !!ctx,
    inBounds: false,
    sourceX: '',
    sourceY: '',
    pixel: null,
    hex: '#000000',
    rgbaText: '',
    reason: '',
  };
  if (!boardCanvas || !ctx) {
    out.reason = !boardCanvas ? 'missing-board-canvas' : 'missing-board-context';
    return out;
  }

  const rect = boardCanvas.getBoundingClientRect();
  const scaleX = rect.width ? boardCanvas.width / rect.width : 0;
  const scaleY = rect.height ? boardCanvas.height / rect.height : 0;
  Object.assign(out, {
    canvasW: boardCanvas.width,
    canvasH: boardCanvas.height,
    rectLeft: rect.left,
    rectTop: rect.top,
    rectRight: rect.right,
    rectBottom: rect.bottom,
    rectW: rect.width,
    rectH: rect.height,
    scaleX,
    scaleY,
  });

  if (!rect.width || !rect.height) {
    out.reason = 'empty-board-rect';
    return out;
  }
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
    out.reason = 'outside-board-rect';
    return out;
  }

  out.inBounds = true;
  out.sourceX = Math.max(0, Math.min(
    boardCanvas.width - 1,
    Math.floor((clientX - rect.left) * scaleX),
  ));
  out.sourceY = Math.max(0, Math.min(
    boardCanvas.height - 1,
    Math.floor((clientY - rect.top) * scaleY),
  ));

  out.pixel = sampleCanvasPixel(ctx, out.sourceX, out.sourceY, {
    where: 'displayed-board-pixel',
    source: 'displayedBoardPixelSampleInfo',
    logFailures: options.logFailures !== false,
  });
  out.hex = rgbaToHex(out.pixel);
  out.rgbaText = out.pixel ? out.pixel.join(' ') : '';
  out.reason = out.pixel ? 'ok' : 'readback-failed';
  return out;
}

function sampleDisplayedBoardPixel(clientX, clientY) {
  return displayedBoardPixelSampleInfo(clientX, clientY).pixel;
}

function parseRgbColor(value, fallback = [0, 0, 0, 255]) {
  const match = String(value || '').match(/rgba?\(([^)]+)\)/);
  if (!match) return fallback;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean);
  const alpha = parts[3] == null ? 1 : Number(parts[3]);
  return [
    Math.max(0, Math.min(255, Math.round(Number(parts[0]) || 0))),
    Math.max(0, Math.min(255, Math.round(Number(parts[1]) || 0))),
    Math.max(0, Math.min(255, Math.round(Number(parts[2]) || 0))),
    Math.max(0, Math.min(255, Math.round((Number.isFinite(alpha) ? alpha : 1) * 255))),
  ];
}

function parseHexColor(value, fallback = [0, 0, 0, 255]) {
  const hex = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3,8}$/i.test(hex)) return fallback;
  const full = hex.length === 3 || hex.length === 4
    ? hex.split('').map((part) => part + part).join('')
    : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    full.length >= 8 ? parseInt(full.slice(6, 8), 16) : 255,
  ];
}

function parseCssColor(value, fallback = [0, 0, 0, 255]) {
  return String(value || '').trim().startsWith('#')
    ? parseHexColor(value, fallback)
    : parseRgbColor(value, fallback);
}

function boardBackgroundPixel() {
  return parseCssColor(getComputedStyle(canvas).backgroundColor, [224, 224, 227, 255]);
}

function clientToBoardScreenPoint(clientX, clientY) {
  const rect = boardCanvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function screenToBoardWorldPoint(screenPoint) {
  const safeZoom = Math.max(zoom || 1, 0.0001);
  return { x: (screenPoint.x - panX) / safeZoom, y: (screenPoint.y - panY) / safeZoom };
}

function clientToBoardWorldPoint(clientX, clientY) {
  if (typeof toWorld === 'function') return toWorld(clientX, clientY);
  return screenToBoardWorldPoint(clientToBoardScreenPoint(clientX, clientY));
}

function worldPointToImageLocalUnit(obj, worldPoint) {
  if (!obj || obj.type !== 'image' || !worldPoint || obj.w <= 0 || obj.h <= 0) return null;
  const transform = imageTransformFromObject(obj);
  const rotation = ((transform.rotation || 0) * Math.PI) / 180;
  const sideways = isSidewaysRotation(transform.rotation);
  const drawW = sideways ? obj.h : obj.w;
  const drawH = sideways ? obj.w : obj.h;
  if (drawW <= 0 || drawH <= 0) return null;

  const dx = worldPoint.x - (obj.x + obj.w / 2);
  const dy = worldPoint.y - (obj.y + obj.h / 2);
  const unflippedX = transform.flipX ? -dx : dx;
  const unflippedY = transform.flipY ? -dy : dy;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = unflippedX * cos - unflippedY * sin;
  const localY = unflippedX * sin + unflippedY * cos;
  const u = (localX + drawW / 2) / drawW;
  const v = (localY + drawH / 2) / drawH;
  const epsilon = 1e-9;
  if (u < -epsilon || u > 1 + epsilon || v < -epsilon || v > 1 + epsilon) return null;
  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
  };
}

function objectContainsWorldPoint(obj, point) {
  if (!obj || !point) return false;
  if (obj.type === 'image') return !!worldPointToImageLocalUnit(obj, point);
  return point.x >= obj.x && point.x <= obj.x + obj.w && point.y >= obj.y && point.y <= obj.y + obj.h;
}

function topObjectAtWorldPoint(point) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (objectContainsWorldPoint(obj, point)) return obj;
  }
  return null;
}

function sampleEyedropperReadoutLayer(worldPoint, previewSample = null, startIndex = objects.length - 1, layers = []) {
  for (let i = startIndex; i >= 0; i--) {
    const obj = objects[i];
    if (!objectContainsWorldPoint(obj, worldPoint)) continue;
    const pixel = previewSample?.pixel || boardBackgroundPixel();
    layers.push({ objectId: obj.id, objectType: obj.type, source: 'preview-render', reason: 'visible-canvas' });
    return {
      pixel,
      source: 'preview-render',
      reason: 'visible-canvas',
      objectId: obj.id,
      objectType: obj.type,
      layers,
    };
  }

  return {
    pixel: boardBackgroundPixel(),
    source: 'background',
    reason: 'no-object',
    objectId: '',
    objectType: '',
    layers,
  };
}

function sampleEyedropperReadoutPixel(clientX, clientY, previewSample = null) {
  const worldPoint = clientToBoardWorldPoint(clientX, clientY);
  return sampleEyedropperReadoutLayer(worldPoint, previewSample);
}

function eyedropperSampleDotCanvasPoint(drawSize) {
  const size = Math.max(1, Math.round(drawSize));
  const point = Math.floor(size / 2);
  return {
    x: Math.max(0, Math.min(size - 1, point)),
    y: Math.max(0, Math.min(size - 1, point)),
  };
}

function drawEyedropperSampleDot(drawSize) {
  const dot = eyedropperSampleDotCanvasPoint(drawSize);
  const cx = dot.x + 0.5;
  const cy = dot.y + 0.5;

  eyedropperCtx.save();
  eyedropperCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperCtx.beginPath();
  eyedropperCtx.arc(cx, cy, 3, 0, Math.PI * 2);
  eyedropperCtx.fillStyle = 'rgba(0,0,0,0.9)';
  eyedropperCtx.fill();
  eyedropperCtx.beginPath();
  eyedropperCtx.arc(cx, cy, 2, 0, Math.PI * 2);
  eyedropperCtx.fillStyle = 'rgba(255,255,255,1)';
  eyedropperCtx.fill();
  eyedropperCtx.restore();
}

function resetEyedropperRenderedSampleSize(width, height) {
  eyedropperRenderedSampleCanvas.width = width;
  eyedropperRenderedSampleCanvas.height = height;
}

function refreshEyedropperAfterSafeImageReady() {
  if (!eyedropperSampling || !_eyedropperLastSampleEvent) return;
  updateEyedropperSample(_eyedropperLastSampleEvent);
}

function refreshEyedropperViewportAfterSafeImageReady() {
  if (!eyedropperEnabled) return;
  scheduleEyedropperViewportPrewarm('safe-image-ready', { afterFrame: true });
}

function eyedropperSafeImageToken(key, dataUrl = null) {
  if (dataUrl) return dataUrl;
  const stored = imageStore[key];
  if (typeof stored === 'string') return stored;
  if (isNativeImageRef(stored)) {
    return [
      'native',
      stored.cache_key || stored.cacheKey || '',
      stored.path || '',
      stored.mtime || '',
      stored.size || '',
    ].join(':');
  }
  return '';
}

function closeEyedropperImageSource(source) {
  try {
    if (source?.close) source.close();
  } catch (_) {}
}

function closeEyedropperSafeImageEntry(entry) {
  if (entry?.owned) closeEyedropperImageSource(entry.source);
}

function closeEyedropperSafeScaledImages(key) {
  const map = eyedropperSafeScaledBitmapCache.get(key);
  if (!map) return;
  for (const entry of map.values()) {
    closeEyedropperImageSource(entry?.bitmap);
    eyedropperSafeScaledBitmapBytes -= entry?.bytes || 0;
  }
  eyedropperSafeScaledBitmapCache.delete(key);
  eyedropperSafeScaledBitmapBytes = Math.max(0, eyedropperSafeScaledBitmapBytes);
}

function clearEyedropperSafeImageCache() {
  for (const entry of eyedropperSafeImageCache.values()) closeEyedropperSafeImageEntry(entry);
  for (const key of eyedropperSafeScaledBitmapCache.keys()) closeEyedropperSafeScaledImages(key);
  eyedropperSafeImageCache.clear();
  eyedropperSafeImagePromises.clear();
  eyedropperSafeDisplayReloadPromises.clear();
  eyedropperSafeScaledBitmapCache.clear();
  eyedropperSafeScaledBitmapPending.clear();
  eyedropperSafeScaledBitmapPendingBytes.clear();
  eyedropperSafeScaledBitmapBytes = 0;
  eyedropperSafeDisplayProbeFailures.clear();
  eyedropperNativeSourceSkipLogged.clear();
}

function storeEyedropperSafeImage(key, token, source, options = {}) {
  const existing = eyedropperSafeImageCache.get(key);
  if (existing && existing.token !== token) {
    closeEyedropperSafeImageEntry(existing);
    closeEyedropperSafeScaledImages(key);
  }
  eyedropperSafeImageCache.set(key, {
    token,
    source,
    owned: options.owned !== false,
    sourceKind: options.sourceKind || 'data-url',
  });
}

function countEyedropperCounter(counters, name, amount = 1) {
  if (counters) counters[name] = (counters[name] || 0) + amount;
  EyedropperDebug._count(name, amount);
}

function eyedropperDisplayProbeFailureKey(key, sourceKind) {
  return `${key}:${sourceKind || 'display'}`;
}

function rememberEyedropperUnsafeDisplaySource(key, token, sourceKind, error) {
  eyedropperSafeDisplayProbeFailures.set(eyedropperDisplayProbeFailureKey(key, sourceKind), token);
  EyedropperDebug._logUnsafeImageSkip({
    where: 'display-readback-probe',
    imgKey: key,
    cacheSource: sourceKind,
    reason: 'display-cache-readback-failed',
    error: String(error),
  });
}

function isEyedropperReadbackSafeDisplaySource(key, token, source, sourceKind, counters = null) {
  if (!isDrawableImageSource(source) || !eyedropperReadbackProbeCtx) return false;
  if (eyedropperSafeDisplayProbeFailures.get(eyedropperDisplayProbeFailureKey(key, sourceKind)) === token) return false;
  try {
    eyedropperReadbackProbeCanvas.width = 1;
    eyedropperReadbackProbeCanvas.height = 1;
    eyedropperReadbackProbeCtx.setTransform(1, 0, 0, 1, 0, 0);
    eyedropperReadbackProbeCtx.clearRect(0, 0, 1, 1);
    eyedropperReadbackProbeCtx.drawImage(source, 0, 0, 1, 1);
    eyedropperReadbackProbeCtx.getImageData(0, 0, 1, 1);
    return true;
  } catch (err) {
    eyedropperReadbackProbeCanvas.width = 1;
    eyedropperReadbackProbeCanvas.height = 1;
    countEyedropperCounter(counters, 'safeDisplayProbeFailures');
    rememberEyedropperUnsafeDisplaySource(key, token, sourceKind, err);
    return false;
  }
}

function resolveEyedropperDisplayCacheSource(key, token, counters = null) {
  const displayImg = imageCache[key];
  if (isDrawableImageSource(displayImg) && isEyedropperReadbackSafeDisplaySource(key, token, displayImg, 'imageCache', counters)) {
    storeEyedropperSafeImage(key, token, displayImg, { owned: false, sourceKind: 'display-cache' });
    countEyedropperCounter(counters, 'safeDisplayImages');
    return displayImg;
  }
  return resolveEyedropperCorsDisplaySource(key, token, counters);
}

function resolveEyedropperCorsDisplaySource(key, token, counters = null) {
  const assetSrc = imageAssetUrlCache[key];
  if (!assetSrc || typeof loadImageElement !== 'function') return null;

  const cached = eyedropperSafeImageCache.get(key);
  if (cached?.token === token && cached.sourceKind === 'display-cors' && isDrawableImageSource(cached.source)) {
    countEyedropperCounter(counters, 'safeDisplayCorsImages');
    return cached.source;
  }

  if (eyedropperSafeDisplayReloadPromises.has(key)) {
    countEyedropperCounter(counters, 'readbackSafePendingImages');
    countEyedropperCounter(counters, 'safeDisplayCorsPending');
    return null;
  }

  const promise = loadImageElement(assetSrc, { crossOrigin: 'anonymous' })
    .then((img) => {
      if (!isEyedropperReadbackSafeDisplaySource(key, token, img, 'display-cors', counters)) {
        countEyedropperCounter(counters, 'safeDisplayCorsFailures');
        return null;
      }
      storeEyedropperSafeImage(key, token, img, { owned: false, sourceKind: 'display-cors' });
      EyedropperDebug._count('safeDisplayCorsLoads');
      refreshEyedropperAfterSafeImageReady();
      refreshEyedropperViewportAfterSafeImageReady();
      return img;
    })
    .catch((err) => {
      countEyedropperCounter(counters, 'safeDisplayCorsFailures');
      EyedropperDebug._logUnsafeImageSkip({
        where: 'display-cors-reload',
        imgKey: key,
        cacheSource: 'display-cors',
        reason: 'display-cors-load-failed',
        error: String(err),
      });
      return null;
    })
    .finally(() => eyedropperSafeDisplayReloadPromises.delete(key));

  eyedropperSafeDisplayReloadPromises.set(key, promise);
  countEyedropperCounter(counters, 'readbackSafePendingImages');
  countEyedropperCounter(counters, 'safeDisplayCorsPending');
  return null;
}

function logEyedropperNativeSourceHydrationSkip(key, counters = null) {
  countEyedropperCounter(counters, 'nativeSourceHydrationSkipped');
  if (eyedropperNativeSourceSkipLogged.has(key)) return;
  eyedropperNativeSourceSkipLogged.add(key);
  EyedropperDebug._logUnsafeImageSkip({
    where: 'safe-image-resolve',
    imgKey: key,
    source: 'native-ref',
    reason: 'native-source-hydration-disabled',
  });
}

function countEyedropperSafeSourceUse(entry, counters = null) {
  if (!entry) return;
  if (entry.sourceKind === 'display-cache') countEyedropperCounter(counters, 'safeDisplayImages');
  else if (entry.sourceKind === 'display-cors') countEyedropperCounter(counters, 'safeDisplayCorsImages');
  else if (entry.sourceKind === 'data-url') countEyedropperCounter(counters, 'safeDataUrlImages');
}

function resolveEyedropperSafeImageSource(key, counters = null) {
  if (!key) return null;
  const token = eyedropperSafeImageToken(key);
  const cached = eyedropperSafeImageCache.get(key);
  if (cached?.token === token && isDrawableImageSource(cached.source)) {
    countEyedropperSafeSourceUse(cached, counters);
    return cached.source;
  }
  if (cached && cached.token !== token) {
    closeEyedropperSafeImageEntry(cached);
    closeEyedropperSafeScaledImages(key);
    eyedropperSafeImageCache.delete(key);
  }

  const displaySource = resolveEyedropperDisplayCacheSource(key, token, counters);
  if (displaySource) return displaySource;

  const stored = imageStore[key];
  if (isNativeImageRef(stored)) {
    logEyedropperNativeSourceHydrationSkip(key, counters);
    return null;
  }

  if (eyedropperSafeImagePromises.has(key)) {
    countEyedropperCounter(counters, 'readbackSafePendingImages');
    countEyedropperCounter(counters, 'safeDataUrlPending');
    return null;
  }

  if (typeof stored !== 'string') return null;

  const promise = Promise.resolve(stored)
    .then((dataUrl) => {
      if (!dataUrl) return null;
      const dataToken = eyedropperSafeImageToken(key, dataUrl);
      const latest = eyedropperSafeImageCache.get(key);
      if (latest?.token === dataToken && isDrawableImageSource(latest.source)) return latest.source;
      return loadImageElement(dataUrl)
        .then(async (img) => {
          let source = img;
          if (typeof createImageBitmap === 'function') {
            try {
              source = await createImageBitmap(img);
            } catch (_) {}
          }
          storeEyedropperSafeImage(key, dataToken, source, { owned: source !== img, sourceKind: 'data-url' });
          EyedropperDebug._count('safeDataUrlLoads');
          refreshEyedropperAfterSafeImageReady();
          refreshEyedropperViewportAfterSafeImageReady();
          return source;
        });
    })
    .catch((err) => {
      if (counters) {
        counters.erroredImages = (counters.erroredImages || 0) + 1;
        counters.lastDrawErrorKey = key;
        counters.lastDrawError = String(err);
      }
      return null;
    })
    .finally(() => eyedropperSafeImagePromises.delete(key));

  eyedropperSafeImagePromises.set(key, promise);
  countEyedropperCounter(counters, 'readbackSafePendingImages');
  countEyedropperCounter(counters, 'safeDataUrlPending');
  return null;
}

function eyedropperSafeScaleDecision(obj, source, view) {
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  const viewZoom = Math.max(view?.zoom || zoom || 1, 0.0001);
  const dpr = view?.dpr || window.devicePixelRatio || 1;
  return {
    targetScale: chooseImageScaleForDraw(obj, source, view),
    sourceW,
    sourceH,
    neededW: obj.w * viewZoom * dpr,
    neededH: obj.h * viewZoom * dpr,
    dpr,
    zoom: viewZoom,
  };
}

function getEyedropperSafeScaledMap(key) {
  let map = eyedropperSafeScaledBitmapCache.get(key);
  if (!map) {
    map = new Map();
    eyedropperSafeScaledBitmapCache.set(key, map);
  }
  return map;
}

function eyedropperBitmapByteSize(bitmap) {
  if (typeof bitmapByteSize === 'function') return bitmapByteSize(bitmap);
  return (bitmap?.width || 0) * (bitmap?.height || 0) * 4;
}

function eyedropperScaledVariantEstimatedBytes(sourceW, sourceH, scale) {
  if (typeof scaledVariantEstimatedBytes === 'function') return scaledVariantEstimatedBytes(sourceW, sourceH, scale);
  return Math.max(1, Math.ceil(sourceW * scale)) * Math.max(1, Math.ceil(sourceH * scale)) * 4;
}

function eyedropperSafeScaledPendingBytes() {
  let bytes = 0;
  for (const value of eyedropperSafeScaledBitmapPendingBytes.values()) bytes += value || 0;
  return bytes;
}

function pruneEyedropperSafeScaledImages() {
  if (eyedropperSafeScaledBitmapBytes <= EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT) return;
  const entries = [];
  for (const [key, map] of eyedropperSafeScaledBitmapCache.entries()) {
    for (const [scale, entry] of map.entries()) entries.push({ key, map, scale, entry });
  }
  entries.sort((a, b) => (a.entry.lastUsed || 0) - (b.entry.lastUsed || 0));
  for (const item of entries) {
    if (eyedropperSafeScaledBitmapBytes <= EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT) break;
    closeEyedropperImageSource(item.entry?.bitmap);
    eyedropperSafeScaledBitmapBytes -= item.entry?.bytes || 0;
    item.map.delete(item.scale);
    EyedropperDebug._count('safeScaledEvictions');
    if (!item.map.size) eyedropperSafeScaledBitmapCache.delete(item.key);
  }
  eyedropperSafeScaledBitmapBytes = Math.max(0, eyedropperSafeScaledBitmapBytes);
}

function queueEyedropperSafeScaledImage(key, source, scale) {
  if (!key || !source || scale >= 1 || typeof createImageBitmap !== 'function') return;
  const pendingKey = `${key}:${scale}`;
  const map = getEyedropperSafeScaledMap(key);
  if (map.has(scale) || eyedropperSafeScaledBitmapPending.has(pendingKey)) return;
  const sourceW = source?.width || source?.naturalWidth || 0;
  const sourceH = source?.height || source?.naturalHeight || 0;
  if (!sourceW || !sourceH) return;
  const estimatedBytes = eyedropperScaledVariantEstimatedBytes(sourceW, sourceH, scale);
  if (eyedropperSafeScaledBitmapBytes + eyedropperSafeScaledPendingBytes() + estimatedBytes > EYEDROPPER_SAFE_SCALED_MEMORY_LIMIT) {
    EyedropperDebug._count('safeScaledMemorySkips');
    return;
  }

  eyedropperSafeScaledBitmapPending.add(pendingKey);
  eyedropperSafeScaledBitmapPendingBytes.set(pendingKey, estimatedBytes);
  requestAnimationFrame(() => {
    const w = Math.max(1, Math.ceil(sourceW * scale));
    const h = Math.max(1, Math.ceil(sourceH * scale));
    createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      .then((bitmap) => {
        const latest = getEyedropperSafeScaledMap(key);
        const existing = latest.get(scale);
        if (existing?.bitmap) {
          closeEyedropperImageSource(existing.bitmap);
          eyedropperSafeScaledBitmapBytes -= existing.bytes || 0;
        }
        const bytes = eyedropperBitmapByteSize(bitmap);
        latest.set(scale, { bitmap, bytes, lastUsed: eyedropperSafeScaledBitmapUseCounter++ });
        eyedropperSafeScaledBitmapBytes += bytes;
        pruneEyedropperSafeScaledImages();
        refreshEyedropperAfterSafeImageReady();
      })
      .catch(() => {})
      .finally(() => {
        eyedropperSafeScaledBitmapPending.delete(pendingKey);
        eyedropperSafeScaledBitmapPendingBytes.delete(pendingKey);
      });
  });
}

function selectEyedropperSafeImageSourceForDraw(key, obj, view, counters = null) {
  const fullSource = resolveEyedropperSafeImageSource(key, counters);
  if (!isDrawableImageSource(fullSource)) return null;
  const decision = eyedropperSafeScaleDecision(obj, fullSource, view);
  let source = fullSource;
  let selectedScale = 1;

  if (viewportImageScalingEnabled && decision.targetScale < 1) {
    const map = eyedropperSafeScaledBitmapCache.get(key);
    const scaleLevels = Array.isArray(IMAGE_SCALE_LEVELS) ? IMAGE_SCALE_LEVELS : [];
    const availableScale = scaleLevels
      .filter((scale) => scale >= decision.targetScale && map?.has(scale))
      .reduce((best, scale) => Math.min(best, scale), 1);
    if (availableScale < 1) {
      selectedScale = availableScale;
      const entry = map.get(availableScale);
      entry.lastUsed = eyedropperSafeScaledBitmapUseCounter++;
      source = entry.bitmap;
    } else {
      queueEyedropperSafeScaledImage(key, fullSource, decision.targetScale);
    }
  }

  if (counters) {
    counters.lastImageTargetScale = decision.targetScale;
    counters.lastImageSelectedScale = selectedScale;
    counters.lastImageSourceW = decision.sourceW;
    counters.lastImageSourceH = decision.sourceH;
    counters.lastImageNeededW = decision.neededW;
    counters.lastImageNeededH = decision.neededH;
    counters.lastImageDpr = decision.dpr;
    counters.lastImageZoom = decision.zoom;
    if (selectedScale < 1) counters.readbackSafeScaledImages = (counters.readbackSafeScaledImages || 0) + 1;
  }

  return {
    source,
    scale: selectedScale,
    targetScale: viewportImageScalingEnabled ? decision.targetScale : 1,
    readbackSafe: true,
  };
}

function selectEyedropperWarmedScaledImageForViewport(key, targetScale) {
  if (!key || !(targetScale < 1)) return null;
  const map = eyedropperSafeScaledBitmapCache.get(key);
  if (!map) return null;
  const scaleLevels = Array.isArray(IMAGE_SCALE_LEVELS) ? IMAGE_SCALE_LEVELS : [];
  const availableScale = scaleLevels
    .filter((scale) => scale >= targetScale && map.has(scale))
    .reduce((best, scale) => Math.min(best, scale), 1);
  if (!(availableScale < 1)) return null;
  const bitmap = map.get(availableScale)?.bitmap;
  if (!isDrawableImageSource(bitmap)) return null;
  const entry = map.get(availableScale);
  entry.lastUsed = eyedropperSafeScaledBitmapUseCounter++;
  return { source: bitmap, scale: availableScale, targetScale, readbackSafe: true, warmedEyedropper: true };
}

function eyedropperPrewarmRect(clientX, clientY, padCss = EYEDROPPER_PREWARM_PAD_CSS) {
  const a = clientToBoardWorldPoint(clientX - padCss, clientY - padCss);
  const b = clientToBoardWorldPoint(clientX + padCss, clientY + padCss);
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  };
}

function distanceSqToObject(point, obj) {
  const cx = Math.max(obj.x, Math.min(obj.x + obj.w, point.x));
  const cy = Math.max(obj.y, Math.min(obj.y + obj.h, point.y));
  const dx = point.x - cx;
  const dy = point.y - cy;
  return dx * dx + dy * dy;
}

function collectEyedropperPrewarmCandidates(point, rect, limit) {
  return objects
    .filter(obj => obj?.type === 'image' && obj.data?.imgKey && objectIntersectsRect(obj, rect))
    .map(obj => ({ obj, distanceSq: distanceSqToObject(point, obj) }))
    .sort((a, b) => a.distanceSq - b.distanceSq)
    .slice(0, limit);
}

function eyedropperPreviewScaleView() {
  const dpr = window.devicePixelRatio || 1;
  return {
    zoom: Math.max(zoom || 1, 0.0001) * EYEDROPPER_PREVIEW_ZOOM_SCALE,
    panX: 0,
    panY: 0,
    dpr,
  };
}

function eyedropperViewportScaleView() {
  const dpr = window.devicePixelRatio || 1;
  return {
    zoom: Math.max(zoom || 1, 0.0001),
    panX,
    panY,
    dpr,
  };
}

function runEyedropperPrewarmCandidates(candidates, view, counters) {
  const rows = [];
  let ready = 0;
  for (const { obj, distanceSq } of candidates) {
    const key = obj.data.imgKey;
    const beforePending = eyedropperSafeImagePromises.has(key) || eyedropperSafeDisplayReloadPromises.has(key);
    const selected = selectEyedropperSafeImageSourceForDraw(key, obj, view, counters);
    const cacheEntry = eyedropperSafeImageCache.get(key);
    const isReady = isDrawableImageSource(selected?.source);
    if (isReady) ready++;
    rows.push({
      objectId: obj.id,
      imgKey: key,
      ready: isReady,
      cacheSource: cacheEntry?.sourceKind || '',
      pendingBefore: beforePending,
      pendingAfter: eyedropperSafeImagePromises.has(key) || eyedropperSafeDisplayReloadPromises.has(key),
      scaledPending: [...eyedropperSafeScaledBitmapPending].some(pendingKey => pendingKey.startsWith(`${key}:`)),
      nativeRef: isNativeImageRef(imageStore[key]),
      distance: Math.round(Math.sqrt(distanceSq || 0)),
    });
  }
  return { rows, ready };
}

function getViewportScaledVariantForEyedropperPrewarm(key, targetScale) {
  if (!key || !(targetScale < 1) || typeof imageScaledBitmapCache === 'undefined') return null;
  const map = imageScaledBitmapCache.get(key);
  if (!map) return null;
  const scaleLevels = Array.isArray(IMAGE_SCALE_LEVELS) ? IMAGE_SCALE_LEVELS : [];
  const selectedScale = scaleLevels
    .filter((scale) => scale >= targetScale && map.has(scale))
    .reduce((best, scale) => Math.min(best, scale), 1);
  return selectedScale < 1 ? map.get(selectedScale) : null;
}

function prewarmViewportScaledVariantForEyedropper(obj, view) {
  const key = obj?.data?.imgKey;
  if (!key || typeof chooseImageScaleForDraw !== 'function') return { ready: false, queued: false };
  const fullSource = imageBitmapCache[key] || imageCache[key] || null;
  if (!isDrawableImageSource(fullSource)) return { ready: false, queued: false };
  const targetScale = chooseImageScaleForDraw(obj, fullSource, view);
  if (!(targetScale < 1)) return { ready: true, queued: false, targetScale };
  if (getViewportScaledVariantForEyedropperPrewarm(key, targetScale)) {
    return { ready: true, queued: false, targetScale };
  }
  if (typeof queueScaledImageVariant === 'function') {
    queueScaledImageVariant(key, fullSource, targetScale);
    return { ready: false, queued: true, targetScale };
  }
  return { ready: false, queued: false, targetScale };
}

function prewarmEyedropperSafeImages(clientX, clientY, options = {}) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return { summary: { skipped: 'invalid-point' }, rows: [] };
  }
  const limit = Math.max(1, Number(options.limit) || EYEDROPPER_PREWARM_LIMIT);
  const point = clientToBoardWorldPoint(clientX, clientY);
  const rect = options.rect || eyedropperPrewarmRect(clientX, clientY, Number(options.padCss) || EYEDROPPER_PREWARM_PAD_CSS);
  const view = eyedropperPreviewScaleView();
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const { rows, ready } = runEyedropperPrewarmCandidates(
    collectEyedropperPrewarmCandidates(point, rect, limit),
    view,
    counters,
  );
  EyedropperDebug._count('prewarmRuns');
  EyedropperDebug._count('prewarmCandidates', rows.length);
  EyedropperDebug._count('prewarmReady', ready);
  return {
    summary: {
      candidates: rows.length,
      ready,
      pending: rows.filter(row => row.pendingAfter).length,
      nativeSkipped: counters.nativeSourceHydrationSkipped || 0,
      displayReused: counters.safeDisplayImages || 0,
      displayCorsReused: counters.safeDisplayCorsImages || 0,
      displayCorsPending: counters.safeDisplayCorsPending || 0,
      dataUrlReady: counters.safeDataUrlImages || 0,
      probeFailures: counters.safeDisplayProbeFailures || 0,
    },
    rows,
  };
}

function collectEyedropperViewportPrewarmCandidates(limit = EYEDROPPER_VIEWPORT_PREWARM_LIMIT) {
  const rect = typeof currentViewportWorldRect === 'function'
    ? currentViewportWorldRect(EYEDROPPER_PREWARM_PAD_CSS)
    : null;
  if (!rect) return { point: null, rect: null, candidates: [] };
  const point = {
    x: (rect.x1 + rect.x2) / 2,
    y: (rect.y1 + rect.y2) / 2,
  };
  const candidates = objects
    .filter(obj => obj?.type === 'image' && obj.data?.imgKey && objectIntersectsRect(obj, rect))
    .map(obj => ({ obj, distanceSq: distanceSqToObject(point, obj) }))
    .sort((a, b) => a.distanceSq - b.distanceSq)
    .slice(0, Math.max(1, Number(limit) || EYEDROPPER_VIEWPORT_PREWARM_LIMIT));
  return { point, rect, candidates };
}

function prewarmEyedropperVisibleImages(options = {}) {
  const { candidates } = collectEyedropperViewportPrewarmCandidates(options.limit);
  const view = eyedropperPreviewScaleView();
  const viewportView = eyedropperViewportScaleView();
  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : {};
  const { rows, ready } = runEyedropperPrewarmCandidates(candidates, view, counters);
  let viewportScaleReady = 0;
  let viewportScaleQueued = 0;
  for (const { obj } of candidates) {
    selectEyedropperSafeImageSourceForDraw(obj.data.imgKey, obj, viewportView, counters);
    const scaleWarm = prewarmViewportScaledVariantForEyedropper(obj, viewportView);
    if (scaleWarm.ready) viewportScaleReady++;
    if (scaleWarm.queued) viewportScaleQueued++;
  }
  EyedropperDebug._count('viewportPrewarmRuns');
  EyedropperDebug._count('viewportPrewarmCandidates', rows.length);
  EyedropperDebug._count('viewportPrewarmReady', ready);
  EyedropperDebug._count('viewportScalePrewarmReady', viewportScaleReady);
  EyedropperDebug._count('viewportScalePrewarmQueued', viewportScaleQueued);
  return {
    summary: {
      candidates: rows.length,
      ready,
      viewportScaleReady,
      viewportScaleQueued,
      pending: rows.filter(row => row.pendingAfter).length,
      scaledPending: rows.filter(row => row.scaledPending).length,
      nativeSkipped: counters.nativeSourceHydrationSkipped || 0,
      displayReused: counters.safeDisplayImages || 0,
      displayCorsReused: counters.safeDisplayCorsImages || 0,
      displayCorsPending: counters.safeDisplayCorsPending || 0,
      dataUrlReady: counters.safeDataUrlImages || 0,
      probeFailures: counters.safeDisplayProbeFailures || 0,
    },
    rows,
  };
}

function scheduleEyedropperViewportPrewarm(reason = 'viewport', options = {}) {
  if (!eyedropperEnabled) return;
  _eyedropperViewportPrewarmScheduled = true;
  const run = () => {
    _eyedropperViewportPrewarmRaf = null;
    if (!eyedropperEnabled || !_eyedropperViewportPrewarmScheduled) return;
    _eyedropperViewportPrewarmScheduled = false;
    const started = performance.now();
    const result = prewarmEyedropperVisibleImages(options);
    EyedropperDebug._recordPrewarmTiming(
      { ...(result?.summary || {}), reason: `viewport:${reason}` },
      performance.now() - started,
    );
  };
  if (_eyedropperViewportPrewarmRaf) return;
  if (options.afterFrame === false) {
    run();
    return;
  }
  _eyedropperViewportPrewarmRaf = requestAnimationFrame(run);
}

function handleEyedropperViewportChanged(reason = 'viewport') {
  if (!eyedropperEnabled) return;
  scheduleEyedropperViewportPrewarm(reason, { afterFrame: true });
  if (eyedropperSampling && isEyedropperSampleVisible() && _eyedropperLastSampleEvent) {
    commitEyedropperSample(_eyedropperLastSampleEvent, { force: true });
  }
}

function scheduleEyedropperSafeImagePrewarm(e) {
  if (!e || e.clientX == null || e.clientY == null) return;
  _eyedropperPendingPrewarmEvent = { clientX: e.clientX, clientY: e.clientY };
  EyedropperDebug._countPerf('prewarmScheduled');
  if (_eyedropperPrewarmRaf) {
    EyedropperDebug._countPerf('prewarmCoalesced');
    return;
  }
  _eyedropperPrewarmRaf = requestAnimationFrame(() => {
    _eyedropperPrewarmRaf = null;
    const event = _eyedropperPendingPrewarmEvent;
    _eyedropperPendingPrewarmEvent = null;
    if (eyedropperSampling && event) {
      const prewarmStart = performance.now();
      const result = prewarmEyedropperSafeImages(event.clientX, event.clientY);
      EyedropperDebug._recordPrewarmTiming(result?.summary, performance.now() - prewarmStart);
    }
  });
}

function paintZoomedBoardPreview(clientX, clientY, drawSize, options = {}) {
  if (!eyedropperRenderedSampleCtx) return { painted: false, pixel: null };

  const timingStart = performance.now();
  const timings = {};
  const dpr = window.devicePixelRatio || 1;
  const renderSize = Math.max(1, Math.round(drawSize));
  const previewCssSize = renderSize / dpr;
  const sampleDot = eyedropperSampleDotCanvasPoint(renderSize);
  const sampleDotCenterX = sampleDot.x + 0.5;
  const sampleDotCenterY = sampleDot.y + 0.5;
  const worldPoint = clientToBoardWorldPoint(clientX, clientY);
  timings.geometry = performance.now() - timingStart;
  const previewZoom = Math.max(zoom || 1, 0.0001) * EYEDROPPER_PREVIEW_ZOOM_SCALE;
  const worldPerCanvasPixel = 1 / (previewZoom * dpr);
  const background = boardBackgroundPixel();
  const previewView = {
    zoom: previewZoom,
    panX: sampleDotCenterX / dpr - worldPoint.x * previewZoom,
    panY: sampleDotCenterY / dpr - worldPoint.y * previewZoom,
    dpr,
  };
  const viewportRect = {
    x1: worldPoint.x - sampleDotCenterX * worldPerCanvasPixel,
    y1: worldPoint.y - sampleDotCenterY * worldPerCanvasPixel,
    x2: worldPoint.x + (renderSize - sampleDotCenterX) * worldPerCanvasPixel,
    y2: worldPoint.y + (renderSize - sampleDotCenterY) * worldPerCanvasPixel,
  };

  const setupStart = performance.now();
  const resizeRenderedStart = performance.now();
  const renderedSizeChanged = eyedropperRenderedSampleCanvas.width !== renderSize ||
    eyedropperRenderedSampleCanvas.height !== renderSize;
  resetEyedropperRenderedSampleSize(renderSize, renderSize);
  timings.resizeRendered = performance.now() - resizeRenderedStart;
  timings.resizeRenderedChanged = renderedSizeChanged ? 1 : 0;
  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperRenderedSampleCtx.imageSmoothingEnabled = true;
  eyedropperRenderedSampleCtx.imageSmoothingQuality = 'high';
  eyedropperRenderedSampleCtx.fillStyle = rgbaToCss(background);
  eyedropperRenderedSampleCtx.fillRect(0, 0, renderSize, renderSize);
  setWorldCanvasTransform(eyedropperRenderedSampleCtx, dpr, previewView);
  timings.paintSetup = performance.now() - setupStart;

  const counters = typeof createDrawCounters === 'function' ? createDrawCounters() : null;
  let drawnImages = 0;
  let drawnText = 0;
  let testedObjects = 0;
  let intersectingObjects = 0;
  const objectLoopStart = performance.now();
  for (const obj of objects) {
    testedObjects++;
    if (!objectIntersectsRect(obj, viewportRect)) continue;
    intersectingObjects++;
    if (obj.id === editingId) continue;
    const drawn = drawSingleObj(eyedropperRenderedSampleCtx, obj, counters, {
      view: previewView,
      imageSourceResolver: selectEyedropperSafeImageSourceForDraw,
    });
    if (obj.type === 'image' && drawn) drawnImages++;
    else if (obj.type === 'text' && drawn) drawnText++;
  }
  if (editingId) drawEditingTextOverlay(eyedropperRenderedSampleCtx);
  timings.objectLoop = performance.now() - objectLoopStart;

  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  let usedFallback = false;
  let pixel = null;
  if (options.sampleCenter !== false) {
    const readbackStart = performance.now();
    pixel = sampleCanvasPixel(eyedropperRenderedSampleCtx, sampleDot.x, sampleDot.y, {
      where: 'zoomed-preview-center',
      source: 'paintZoomedBoardPreview',
    });
    timings.readback = performance.now() - readbackStart;
    if (!pixel) {
      usedFallback = true;
      pixel = background;
      EyedropperDebug._logFallbackSample({
        where: 'zoomed-preview-center',
        reason: 'center-readback-failed-background-only',
        clientX,
        clientY,
      });
    }
  } else {
    timings.readback = 0;
    timings.previewReadbackSkipped = 1;
  }

  try {
    const blitStart = performance.now();
    eyedropperCtx.imageSmoothingEnabled = false;
    eyedropperCtx.drawImage(
      eyedropperRenderedSampleCanvas,
      0,
      0,
      renderSize,
      renderSize,
      0,
      0,
      renderSize,
      renderSize,
    );
    timings.blit = performance.now() - blitStart;
    timings.paintPreview = performance.now() - timingStart;
    return {
      painted: true,
      pixel,
      centerX: sampleDot.x,
      centerY: sampleDot.y,
      usedFallback,
      previewCssSize,
      drawSize: renderSize,
      previewZoom,
      viewportRect,
      counters,
      drawnImages,
      drawnText,
      testedObjects,
      intersectingObjects,
      timings,
    };
  } catch (_) {
    timings.paintPreview = performance.now() - timingStart;
    return {
      painted: false,
      pixel: null,
      centerX: sampleDot.x,
      centerY: sampleDot.y,
      usedFallback,
      previewCssSize,
      drawSize: renderSize,
      previewZoom,
      viewportRect,
      counters,
      drawnImages,
      drawnText,
      testedObjects,
      intersectingObjects,
      timings,
    };
  }
}

function commitEyedropperSample(e, options = {}) {
  if ((!eyedropperSampling && !options.force) || !eyedropperLoupe || !eyedropperCanvas || !eyedropperCtx) return;
  _eyedropperLastSampleEvent = { clientX: e.clientX, clientY: e.clientY };

  const totalStart = performance.now();
  const timings = {};
  const dpr = window.devicePixelRatio || 1;
  const drawSizeStart = performance.now();
  const drawSize = eyedropperPreviewDrawSize(dpr);
  timings.drawSize = performance.now() - drawSizeStart;

  const resizeStart = performance.now();
  if (eyedropperCanvas.width !== drawSize || eyedropperCanvas.height !== drawSize) {
    eyedropperCanvas.width = drawSize;
    eyedropperCanvas.height = drawSize;
    timings.resizeVisibleChanged = 1;
  }
  timings.resizeVisible = performance.now() - resizeStart;

  const clearStart = performance.now();
  eyedropperCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperCtx.imageSmoothingEnabled = false;
  eyedropperCtx.clearRect(0, 0, drawSize, drawSize);
  timings.clearVisible = performance.now() - clearStart;

  const previewSample = paintZoomedBoardPreview(e.clientX, e.clientY, drawSize, { sampleCenter: false });
  Object.assign(timings, previewSample?.timings || {});
  const canvasReadoutStart = performance.now();
  let readoutSample = sampleEyedropperReadoutPixel(e.clientX, e.clientY, previewSample);
  timings.canvasReadout = performance.now() - canvasReadoutStart;
  let centerPixel = readoutSample?.pixel;
  timings.previewReadback = 0;
  if (previewSample?.painted && previewSample.centerX != null && previewSample.centerY != null &&
    (!centerPixel || readoutSample?.source === 'preview-render')) {
    const previewReadbackStart = performance.now();
    const previewPixel = sampleCanvasPixel(eyedropperRenderedSampleCtx, previewSample.centerX, previewSample.centerY, {
      where: 'zoomed-preview-center-fallback',
      source: 'commitEyedropperSample',
    });
    timings.previewReadback = performance.now() - previewReadbackStart;
    if (previewPixel) {
      centerPixel = previewPixel;
      previewSample.pixel = previewPixel;
      readoutSample = {
        ...(readoutSample || {}),
        pixel: previewPixel,
        source: 'preview-render',
        reason: readoutSample?.reason || 'preview-readback-fallback',
      };
    }
  }
  timings.totalBeforeReadout = performance.now() - totalStart;
  timings.total = timings.totalBeforeReadout;
  if (previewSample) previewSample.timings = timings;
  const dotStart = performance.now();
  drawEyedropperSampleDot(drawSize);
  timings.dot = performance.now() - dotStart;
  const readoutStart = performance.now();
  if (centerPixel) updateEyedropperColorReadout(centerPixel);
  timings.readout = performance.now() - readoutStart;
  const visibleStart = performance.now();
  if (!eyedropperLoupe.classList.contains('visible')) eyedropperLoupe.classList.add('visible');
  timings.showLoupe = performance.now() - visibleStart;
  const positionStart = performance.now();
  positionEyedropperLoupe(e.clientX, e.clientY);
  timings.position = performance.now() - positionStart;
  timings.total = performance.now() - totalStart;
  if (previewSample) previewSample.timings = timings;
  EyedropperDebug._logSample(e.clientX, e.clientY, previewSample, centerPixel, readoutSample);
  EyedropperDebug._recordSampleTiming(e.clientX, e.clientY, previewSample, timings);
}

function updateEyedropperSample(e) {
  if (!eyedropperSampling || !e) return;
  EyedropperDebug._countPerf('sampleMoves');
  _eyedropperPendingSampleEvent = { clientX: e.clientX, clientY: e.clientY };
  _eyedropperLastSampleEvent = _eyedropperPendingSampleEvent;
  scheduleEyedropperSafeImagePrewarm(e);
  if (_eyedropperSampleRaf) {
    EyedropperDebug._countPerf('sampleCoalescedMoves');
    return;
  }
  _eyedropperSampleRaf = requestAnimationFrame(() => {
    _eyedropperSampleRaf = null;
    const sampleEvent = _eyedropperPendingSampleEvent;
    _eyedropperPendingSampleEvent = null;
    if (sampleEvent) commitEyedropperSample(sampleEvent);
  });
}

function cancelPendingEyedropperSample() {
  if (_eyedropperSampleRaf) cancelAnimationFrame(_eyedropperSampleRaf);
  if (_eyedropperPrewarmRaf) cancelAnimationFrame(_eyedropperPrewarmRaf);
  if (_eyedropperViewportPrewarmRaf) cancelAnimationFrame(_eyedropperViewportPrewarmRaf);
  _eyedropperSampleRaf = null;
  _eyedropperPrewarmRaf = null;
  _eyedropperViewportPrewarmRaf = null;
  _eyedropperPendingSampleEvent = null;
  _eyedropperPendingPrewarmEvent = null;
  _eyedropperViewportPrewarmScheduled = false;
}

function endEyedropperSample(e = null) {
  if (eyedropperSampling && e?.clientX != null && e?.clientY != null) {
    cancelPendingEyedropperSample();
    commitEyedropperSample({ clientX: e.clientX, clientY: e.clientY });
  } else {
    cancelPendingEyedropperSample();
  }
  eyedropperSampling = false;
}

function isEyedropperSampleVisible() {
  return !!eyedropperLoupe?.classList.contains('visible');
}

function hideEyedropperSample() {
  endEyedropperSample();
  _eyedropperLastSampleEvent = null;
  _eyedropperLoupeHorizontalSide = 'right';
  if (eyedropperLoupe) eyedropperLoupe.classList.remove('visible');
}

function isPointInsideVisibleEyedropperLoupe(clientX, clientY) {
  if (!isEyedropperSampleVisible()) return false;
  const rect = eyedropperLoupe.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function isEventInsideVisibleEyedropperLoupe(e) {
  return !!(isEyedropperSampleVisible() && e.target instanceof Node && eyedropperLoupe?.contains(e.target));
}

function showEyedropperCopiedMessage() {
  if (typeof finishPillTransition === 'function') finishPillTransition({ finalMsg: 'Copied' });
}

async function copyEyedropperValue(targetId) {
  const value = document.getElementById(targetId)?.textContent || '';
  if (!value) return;
  try {
    await copyTextToClipboard(value);
    showEyedropperCopiedMessage();
  } catch (_) {}
}

eyedropperLoupe?.addEventListener('pointerdown', (e) => e.stopPropagation());
eyedropperLoupe?.addEventListener('mousedown', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
eyedropperLoupe?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const target = e.target.closest?.('.eyedropper-copy-icon');
  if (target) copyEyedropperValue(target.dataset.copyTarget);
});
eyedropperLoupe?.addEventListener('keydown', (e) => {
  const target = e.target.closest?.('.eyedropper-copy-icon');
  if (!target || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  e.stopPropagation();
  copyEyedropperValue(target.dataset.copyTarget);
});

function startEyedropperSample(e) {
  if (!eyedropperEnabled || e.button !== 0) return false;
  if (typeof _spaceDown !== 'undefined' && _spaceDown) return false;
  if (_boardOpening || (isBoardInputBlocked() && !isEyedropperShieldActive())) return false;
  if (isPointInsideVisibleEyedropperLoupe(e.clientX, e.clientY)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  if (!(e.target instanceof Node) || !canvas.contains(e.target)) return false;
  if (isEventInsideVisibleContextMenu(e)) return false;
  if (ctxMenu.classList.contains('visible') || objCtxMenu.classList.contains('visible') || ctxActions?.classList.contains('visible')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    hideMenus();
    return true;
  }
  if (!eyedropperSampling && isEyedropperSampleVisible()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    hideEyedropperSample();
    return true;
  }

  e.preventDefault();
  e.stopImmediatePropagation();
  hideMenus();
  eyedropperSampling = true;
  commitEyedropperSample(e);
  beginDocumentDrag({
    move: updateEyedropperSample,
    up: endEyedropperSample,
  });
  return true;
}

canvas.addEventListener('mousedown', startEyedropperSample, true);
