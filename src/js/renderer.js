'use strict';

(function initBoardRenderer(root) {
  const IMAGE_EDGE_OVERDRAW_DEVICE_PX = 1;
  const IMAGE_EDGE_EPSILON = 1e-9;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const TEXT_DRAW_STATS_DISABLED = Object.freeze({ collectStats: false });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const SLOW_TEXT_LINE_DRAW_THRESHOLD_MS = 0.25;
  const MAX_SLOW_TEXT_LINE_DRAWS = 16;
  const imageSourceDrawnSet = new WeakSet();
  const imageSourceContextDrawnMap = new WeakMap();
  const TEXT_DRAW_STATS_ENABLED = Object.freeze({ collectStats: true });

  function imageSourceDrawnBefore(source) {
    return imageSourceDrawnSet.has(source);
  }

  function imageSourceContextDrawnBefore(source, context) {
    return !!imageSourceContextDrawnMap.get(source)?.has(context);
  }

  function markImageSourceDrawn(source, context) {
    imageSourceDrawnSet.add(source);
    let contexts = imageSourceContextDrawnMap.get(source);
    if (!contexts) {
      contexts = new WeakSet();
      imageSourceContextDrawnMap.set(source, contexts);
    }
    contexts.add(context);
  }

  function createDrawCounters() {
    return {
      testedObjects: 0,
      visibleObjects: 0,
      bitmapImages: 0,
      elementImages: 0,
      fallbackImages: 0,
      missingImages: 0,
      erroredImages: 0,
      croppedImages: 0,
      scaledImages: 0,
      openPreviewImages: 0,
      dynamicOpenPreviewRequests: 0,
      scaledFallbackFull: 0,
      activeInputFullFallbackImages: 0,
      scaledVariantPendingImages: 0,
      motionObjects: 0,
      motionImages: 0,
      motionText: 0,
      motionTranslatedObjects: 0,
      motionScaledObjects: 0,
      lowLatencyImageDraws: 0,
      motionScaledImages: 0,
      motionFullScaleImages: 0,
      motionFullFallbackImages: 0,
      motionActiveInputFullFallbackImages: 0,
      fullScaleImages: 0,
      scaledImageScaleTotal: 0,
      scaledImageTargetScaleTotal: 0,
      culledImages: 0,
      culledText: 0,
      textLines: 0,
      drawnTextLines: 0,
      culledTextLines: 0,
      textLayoutObjects: 0,
      textLayoutMs: 0,
      maxTextLayoutMs: 0,
      textCharCount: 0,
      largestTextChars: 0,
      largestTextLayoutLines: 0,
      richTextChars: 0,
      richTextDrawnChars: 0,
      richTextDrawUnits: 0,
      richTextDrawCalls: 0,
      richTextRuns: 0,
      richTextPlainRuns: 0,
      richTextScriptRuns: 0,
      richTextSkippedTabs: 0,
      richTextSkippedSpaces: 0,
      richTextHiddenChars: 0,
      richTextFontSwitches: 0,
      richTextPlanCacheHits: 0,
      richTextPlanCacheMisses: 0,
      richTextLineDrawMs: 0,
      maxRichTextLineDrawMs: 0,
      slowRichTextLineDraws: 0,
      maxRichTextDrawUnitsPerLine: 0,
      maxRichTextDrawCallsPerLine: 0,
      maxRichTextRunsPerLine: 0,
      richTextDirectDraws: 0,
      imageSourceDraws: 0,
      imageSourceFirstDraws: 0,
      imageSourceWarmDraws: 0,
      imageContextFirstDraws: 0,
      imageContextWarmDraws: 0,
      scaledImageContextFirstDraws: 0,
      fullScaleImageContextFirstDraws: 0,
      openPreviewImageContextFirstDraws: 0,
      slowDrawObjects: [],
      slowTextLineDraws: [],
    };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  function isDrawableImageSource(source) {
    if (!source) return false;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return true;
    return !!(source.complete && source.naturalWidth > 0);
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  function countCulledObject(obj, counters = null) {
    if (!counters) return;
    if (obj.type === 'image') counters.culledImages = (counters.culledImages || 0) + 1;
    else if (obj.type === 'text') counters.culledText = (counters.culledText || 0) + 1;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  function visibleImageCrop(obj, img, rect) {
    if (!rect || !(obj?.w > 0) || !(obj?.h > 0)) return null;
    const x1 = Math.max(obj.x, rect.x1);
    const y1 = Math.max(obj.y, rect.y1);
    const x2 = Math.min(obj.x + obj.w, rect.x2);
    const y2 = Math.min(obj.y + obj.h, rect.y2);
    if (!(x2 > x1 && y2 > y1)) return false;
    if (x1 === obj.x && y1 === obj.y && x2 === obj.x + obj.w && y2 === obj.y + obj.h) return null;
    const sourceWidth = img?.width || img?.naturalWidth || 0;
    const sourceHeight = img?.height || img?.naturalHeight || 0;
    if (!(sourceWidth > 0 && sourceHeight > 0)) return null;
    return {
      sx: (x1 - obj.x) / obj.w * sourceWidth,
      sy: (y1 - obj.y) / obj.h * sourceHeight,
      sw: (x2 - x1) / obj.w * sourceWidth,
      sh: (y2 - y1) / obj.h * sourceHeight,
      dx: x1,
      dy: y1,
      dw: x2 - x1,
      dh: y2 - y1,
    };
  }

  function nearlyEqual(a, b) {
    return Math.abs(a - b) <= IMAGE_EDGE_EPSILON;
  }

  function applyImageCropDestinationOverdraw(crop, obj, edge) {
    if (!(edge > 0)) return;
    const cropRight = crop.dx + crop.dw;
    const cropBottom = crop.dy + crop.dh;
    const objRight = obj.x + obj.w;
    const objBottom = obj.y + obj.h;
    const left = nearlyEqual(crop.dx, obj.x) ? edge : 0;
    const top = nearlyEqual(crop.dy, obj.y) ? edge : 0;
    const right = nearlyEqual(cropRight, objRight) ? edge : 0;
    const bottom = nearlyEqual(cropBottom, objBottom) ? edge : 0;
    if (!(left || top || right || bottom)) return;
    crop.dx -= left;
    crop.dy -= top;
    crop.dw += left + right;
    crop.dh += top + bottom;
  }

  function drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect) {
    const edgeOverdraw = IMAGE_EDGE_OVERDRAW_DEVICE_PX / (view.zoom * view.dpr);
    const transform = obj.data;
    if (transform.flipX || transform.flipY || transform.rotation) {
      const sideways = Math.abs(Number(transform.rotation) || 0) % 180 === 90;
      const drawW = sideways ? obj.h : obj.w;
      const drawH = sideways ? obj.w : obj.h;
      context.save();
      context.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
      context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
      if (transform.rotation) context.rotate((transform.rotation * Math.PI) / 180);
      context.drawImage(
        img,
        -drawW / 2 - edgeOverdraw,
        -drawH / 2 - edgeOverdraw,
        drawW + edgeOverdraw * 2,
        drawH + edgeOverdraw * 2,
      );
      context.restore();
      return false;
    }

    const crop = visibleImageCrop(obj, img, viewportRect);
    if (crop === false) return null;
    if (crop) {
      applyImageCropDestinationOverdraw(crop, obj, edgeOverdraw);
      context.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, crop.dx, crop.dy, crop.dw, crop.dh);
      return true;
    }
    context.drawImage(
      img,
      obj.x - edgeOverdraw,
      obj.y - edgeOverdraw,
      obj.w + edgeOverdraw * 2,
      obj.h + edgeOverdraw * 2,
    );
    return false;
  }

  function drawImageObj(context, obj, img, view, viewportRect, lowLatency) {
    if (!lowLatency) {
      return drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect);
    }
    const previousSmoothingEnabled = context.imageSmoothingEnabled;
    try { context.imageSmoothingEnabled = false; } catch (_) {}
    try {
      return drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect);
    } finally {
      try { context.imageSmoothingEnabled = previousSmoothingEnabled; } catch (_) {}
    }
  }

  function resetCanvasToScreen(context) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

  function configureRendererTextContext(context) {
    if (!context) return;
    // Canvas width/height assignments reset context state. Reapply these values
    // instead of caching by context identity so text remains aligned with the
    // measurements after a resize or DPR change.
    try { context.fontKerning = 'none'; } catch (_) {}
    try { context.letterSpacing = '0px'; } catch (_) {}
    try { context.fontStretch = 'normal'; } catch (_) {}
    try { context.fontVariantCaps = 'normal'; } catch (_) {}
    try { context.textAlign = 'left'; } catch (_) {}
    try { context.direction = 'ltr'; } catch (_) {}
  }

  function setWorldCanvasTransform(context, dpr, deps) {
    const scale = deps.zoom() * dpr;
    context.setTransform(scale, 0, 0, scale, deps.panX() * dpr, deps.panY() * dpr);
    context.imageSmoothingQuality = 'high';
    context.font = deps.font;
    context.fillStyle = deps.canvasTextColor();
    context.textBaseline = 'alphabetic';
    configureRendererTextContext(context);
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  function drawCounterValue(counters, field) {
    return Number(counters?.[field]) || 0;
  }

  function roundDebugMs(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function textLineSample(text, limit = 80) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
  }

  function insertBoundedSlowCounterRow(counters, key, row, limit) {
    const list = Array.isArray(counters[key]) ? counters[key] : [];
    const rowMs = Number(row?.ms) || 0;
    let insertAt = list.length;
    while (insertAt > 0 && rowMs > (Number(list[insertAt - 1]?.ms) || 0)) insertAt--;
    if (insertAt < limit) {
      list.splice(insertAt, 0, row);
      if (list.length > limit) list.pop();
    } else if (list.length > limit) {
      list.length = limit;
    }
    counters[key] = list;
  }

  function addRichTextDrawStats(counters, stats) {
    const add = (field, sourceField = field) => {
      counters[field] = (counters[field] || 0) + (Number(stats[sourceField]) || 0);
    };
    add('richTextChars', 'chars');
    add('richTextDrawnChars', 'drawnChars');
    add('richTextDrawUnits', 'drawUnits');
    add('richTextDrawCalls', 'drawCalls');
    add('richTextRuns', 'runs');
    add('richTextPlainRuns', 'plainRuns');
    add('richTextScriptRuns', 'scriptRuns');
    add('richTextSkippedTabs', 'skippedTabs');
    add('richTextSkippedSpaces', 'skippedSpaces');
    add('richTextHiddenChars', 'hiddenChars');
    add('richTextFontSwitches', 'fontSwitches');
    add('richTextPlanCacheHits', 'planCacheHits');
    add('richTextPlanCacheMisses', 'planCacheMisses');
    counters.maxRichTextDrawUnitsPerLine = Math.max(
      counters.maxRichTextDrawUnitsPerLine || 0,
      Number(stats.drawUnits) || 0,
    );
    counters.maxRichTextDrawCallsPerLine = Math.max(
      counters.maxRichTextDrawCallsPerLine || 0,
      Number(stats.drawCalls) || 0,
    );
    counters.maxRichTextRunsPerLine = Math.max(
      counters.maxRichTextRunsPerLine || 0,
      Number(stats.runs) || 0,
    );
  }

  function recordRichTextLineDraw(counters, obj, line, lineIndex, stats, ms, deps) {
    if (!counters || !Number.isFinite(ms) || ms < 0) return;
    counters.richTextLineDrawMs = (counters.richTextLineDrawMs || 0) + ms;
    counters.maxRichTextLineDrawMs = Math.max(counters.maxRichTextLineDrawMs || 0, ms);
    if (ms < SLOW_TEXT_LINE_DRAW_THRESHOLD_MS) return;
    counters.slowRichTextLineDraws = (counters.slowRichTextLineDraws || 0) + 1;
    const viewZoom = Number(deps?.zoom?.()) || 0;
    const viewDpr = Number(deps?.dpr?.()) || 1;
    const deviceScale = Math.max(viewZoom, 0) * Math.max(viewDpr, 1);
    const row = {
      id: obj?.id || '',
      objectId: obj?.id || '',
      type: 'text-line',
      ms: roundDebugMs(ms),
      lineIndex: Math.max(0, Math.trunc(Number(lineIndex)) || 0),
      logicalLineIndex: Math.max(0, Math.trunc(Number(line?.logicalLineIndex)) || 0),
      startIndex: Math.max(0, Math.trunc(Number(line?.startIndex)) || 0),
      endIndex: Math.max(0, Math.trunc(Number(line?.endIndex)) || 0),
      textLength: String(line?.text ?? '').length,
      sample: textLineSample(line?.text),
      drawUnits: Number(stats?.drawUnits) || 0,
      drawCalls: Number(stats?.drawCalls) || 0,
      runs: Number(stats?.runs) || 0,
      plainRuns: Number(stats?.plainRuns) || 0,
      scriptRuns: Number(stats?.scriptRuns) || 0,
      skippedSpaces: Number(stats?.skippedSpaces) || 0,
      skippedTabs: Number(stats?.skippedTabs) || 0,
      hiddenChars: Number(stats?.hiddenChars) || 0,
      planCacheHits: Number(stats?.planCacheHits) || 0,
      planCacheMisses: Number(stats?.planCacheMisses) || 0,
      y: Number.isFinite(Number(line?.y)) ? roundDebugMs(Number(line.y)) : '',
      textY: Number.isFinite(Number(line?.textY)) ? roundDebugMs(Number(line.textY)) : '',
      lineHeightDevicePx: roundDebugMs((Number(deps?.lineHeight) || 0) * deviceScale),
    };
    insertBoundedSlowCounterRow(counters, 'slowTextLineDraws', row, MAX_SLOW_TEXT_LINE_DRAWS);
  }

  function recordImageDrawWarmStats(counters, selected, firstSourceDraw, firstContextDraw) {
    if (!counters) return;
    counters.imageSourceDraws = (counters.imageSourceDraws || 0) + 1;
    if (firstSourceDraw) counters.imageSourceFirstDraws = (counters.imageSourceFirstDraws || 0) + 1;
    else counters.imageSourceWarmDraws = (counters.imageSourceWarmDraws || 0) + 1;
    if (firstContextDraw) {
      counters.imageContextFirstDraws = (counters.imageContextFirstDraws || 0) + 1;
      if (selected?.scale < 1) {
        counters.scaledImageContextFirstDraws = (counters.scaledImageContextFirstDraws || 0) + 1;
      }
      if (selected?.scale === 1 && selected?.targetScale === 1) {
        counters.fullScaleImageContextFirstDraws = (counters.fullScaleImageContextFirstDraws || 0) + 1;
      }
      if (selected?.openPreview) {
        counters.openPreviewImageContextFirstDraws = (counters.openPreviewImageContextFirstDraws || 0) + 1;
      }
    } else {
      counters.imageContextWarmDraws = (counters.imageContextWarmDraws || 0) + 1;
    }
  }

  function recordSlowDrawObject(counters, obj, ms, before, drawn, motion = null, deps = null) {
    if (!counters || !obj || !Number.isFinite(ms) || ms <= 0) return;
    const row = {
      id: obj.id || '',
      type: obj.type || '',
      ms: Math.round(ms * 100) / 100,
      drawn: !!drawn,
      motion: !!motion,
    };
    if (obj.type === 'text') {
      row.chars = String(obj.data?.content || '').length;
      row.layoutMs = Math.round((drawCounterValue(counters, 'textLayoutMs') - before.textLayoutMs) * 100) / 100;
      row.textLines = drawCounterValue(counters, 'textLines') - before.textLines;
      row.drawnTextLines = drawCounterValue(counters, 'drawnTextLines') - before.drawnTextLines;
      row.culledTextLines = drawCounterValue(counters, 'culledTextLines') - before.culledTextLines;
      row.richTextDrawUnits = drawCounterValue(counters, 'richTextDrawUnits') - before.richTextDrawUnits;
      row.richTextDrawCalls = drawCounterValue(counters, 'richTextDrawCalls') - before.richTextDrawCalls;
      row.richTextRuns = drawCounterValue(counters, 'richTextRuns') - before.richTextRuns;
      row.richTextScriptRuns = drawCounterValue(counters, 'richTextScriptRuns') - before.richTextScriptRuns;
      row.richTextSkippedTabs = drawCounterValue(counters, 'richTextSkippedTabs') - before.richTextSkippedTabs;
      row.richTextSkippedSpaces = drawCounterValue(counters, 'richTextSkippedSpaces') - before.richTextSkippedSpaces;
      row.richTextHiddenChars = drawCounterValue(counters, 'richTextHiddenChars') - before.richTextHiddenChars;
      row.richTextPlanCacheHits = drawCounterValue(counters, 'richTextPlanCacheHits') - before.richTextPlanCacheHits;
      row.richTextPlanCacheMisses = drawCounterValue(counters, 'richTextPlanCacheMisses') - before.richTextPlanCacheMisses;
      row.richTextLineDrawMs = roundDebugMs(drawCounterValue(counters, 'richTextLineDrawMs') - before.richTextLineDrawMs);
      row.slowRichTextLineDraws = drawCounterValue(counters, 'slowRichTextLineDraws') - before.slowRichTextLineDraws;
      row.richTextDirectDraws = drawCounterValue(counters, 'richTextDirectDraws') - before.richTextDirectDraws;
      row.slowTextLineRows = [];
      const slowLineRows = Array.isArray(counters.slowTextLineDraws) ? counters.slowTextLineDraws : [];
      for (const lineRow of slowLineRows) {
        if (lineRow.objectId !== obj.id) continue;
        row.slowTextLineRows.push({ ...lineRow });
        if (row.slowTextLineRows.length >= 6) break;
      }
      row.richTextUnitsPerLine = row.drawnTextLines > 0
        ? Math.round(row.richTextDrawUnits / row.drawnTextLines * 100) / 100
        : 0;
      row.scriptRanges = Array.isArray(obj.data?.scriptRanges) ? obj.data.scriptRanges.length : 0;
      const lineHeightDevicePx = deps
        ? (Number(deps.lineHeight || 0) || 0) *
          Math.max(Number(deps.zoom?.()) || 0, 0) *
          Math.max(Number(deps.dpr?.()) || 1, 1)
        : 0;
      row.lineHeightDevicePx = Math.round(lineHeightDevicePx * 100) / 100;
    } else if (obj.type === 'image') {
      row.imgKey = obj.data?.imgKey || '';
      const fullSource = row.imgKey && deps
        ? (deps.imageBitmapCache?.()?.[row.imgKey] || null)
        : null;
      const scaledDelta = drawCounterValue(counters, 'scaledImages') - before.scaledImages;
      row.objectW = Number(obj.w || 0) || 0;
      row.objectH = Number(obj.h || 0) || 0;
      row.fullSourceW = fullSource?.width || fullSource?.naturalWidth || '';
      row.fullSourceH = fullSource?.height || fullSource?.naturalHeight || '';
      row.drawDeviceW = deps ? Math.round(row.objectW * Math.max(Number(deps.zoom?.()) || 0, 0) * Math.max(Number(deps.dpr?.()) || 1, 1) * 100) / 100 : '';
      row.drawDeviceH = deps ? Math.round(row.objectH * Math.max(Number(deps.zoom?.()) || 0, 0) * Math.max(Number(deps.dpr?.()) || 1, 1) * 100) / 100 : '';
      row.cropped = drawCounterValue(counters, 'croppedImages') > before.croppedImages;
      row.scaled = drawCounterValue(counters, 'scaledImages') > before.scaledImages;
      row.openPreview = drawCounterValue(counters, 'openPreviewImages') > before.openPreviewImages;
      row.dynamicOpenPreviewRequest = drawCounterValue(counters, 'dynamicOpenPreviewRequests') > before.dynamicOpenPreviewRequests;
      row.fullScale = drawCounterValue(counters, 'fullScaleImages') > before.fullScaleImages;
      row.selectedScale = scaledDelta > 0
        ? Math.round((drawCounterValue(counters, 'scaledImageScaleTotal') - before.scaledImageScaleTotal) / scaledDelta * 1000) / 1000
        : row.fullScale ? 1 : '';
      row.targetScale = scaledDelta > 0
        ? Math.round((drawCounterValue(counters, 'scaledImageTargetScaleTotal') - before.scaledImageTargetScaleTotal) / scaledDelta * 1000) / 1000
        : row.fullScale ? 1 : '';
      row.fallbackFull = drawCounterValue(counters, 'scaledFallbackFull') > before.scaledFallbackFull;
      row.activeInputFullFallback = drawCounterValue(counters, 'activeInputFullFallbackImages') > before.activeInputFullFallbackImages;
      row.scaledVariantPending = drawCounterValue(counters, 'scaledVariantPendingImages') > before.scaledVariantPendingImages;
      row.lowLatencyImageDraw = drawCounterValue(counters, 'lowLatencyImageDraws') > before.lowLatencyImageDraws;
      row.motionScaledImage = drawCounterValue(counters, 'motionScaledImages') > before.motionScaledImages;
      row.motionFullScaleImage = drawCounterValue(counters, 'motionFullScaleImages') > before.motionFullScaleImages;
      row.motionFullFallbackImage = drawCounterValue(counters, 'motionFullFallbackImages') > before.motionFullFallbackImages;
      row.motionActiveInputFullFallback = drawCounterValue(counters, 'motionActiveInputFullFallbackImages') > before.motionActiveInputFullFallbackImages;
      row.firstSourceDraw = drawCounterValue(counters, 'imageSourceFirstDraws') > before.imageSourceFirstDraws;
      row.firstContextDraw = drawCounterValue(counters, 'imageContextFirstDraws') > before.imageContextFirstDraws;
      row.warmSourceDraw = drawCounterValue(counters, 'imageSourceWarmDraws') > before.imageSourceWarmDraws;
      row.warmContextDraw = drawCounterValue(counters, 'imageContextWarmDraws') > before.imageContextWarmDraws;
    }
    insertBoundedSlowCounterRow(counters, 'slowDrawObjects', row, 8);
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  function createBoardRenderer(deps) {
    const getTextLayoutForDraw = deps.getTextLayoutForViewport || deps.getTextLayout;

    function viewDefaults() {
      return {
        zoom: deps.zoom(),
        dpr: deps.dpr(),
      };
    }

    function drawSingleObj(context, obj
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , counters = null
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , options = {}
    ) {
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        const viewportRect = options.viewportRect || null;
        if (obj.type === 'text') {
          const layout = getTextLayoutForDraw(obj, viewportRect);
          for (const line of layout) deps.drawTextLineRange(context, line, obj);
          return;
        }
        if (obj.type !== 'image') return;

        const view = options.view || viewDefaults();
        const imageSourceResolver = options.imageSourceResolver || null;
        const key = obj.data.imgKey;
        const lowLatencyImageMotion = !!options.motion;
        const selected = imageSourceResolver
          ? imageSourceResolver(key, obj, view, lowLatencyImageMotion)
          : deps.selectImageSourceForDraw(key, obj, deps.imageBitmapCache()[key], view, lowLatencyImageMotion);
        const img = selected?.source || selected || null;
        if (!isDrawableImageSource(img)) return;
        try {
          drawImageObj(context, obj, img, view, viewportRect,
            selected?.activeInputFullFallback === true || lowLatencyImageMotion);
        } catch (_) {}
      } else {
      const viewportRect = options.viewportRect || null;
      if (obj.type === 'text') {
        const layoutStart = counters && typeof performance !== 'undefined' ? performance.now() : 0;
        const layout = getTextLayoutForDraw(obj, viewportRect);
        const totalLayoutLines = counters
          ? Math.max(layout.length, Math.trunc(Number(layout.totalLines)) || layout.length)
          : 0;
        if (counters) {
          const layoutMs = typeof performance !== 'undefined' ? performance.now() - layoutStart : 0;
          const chars = String(obj.data?.content || '').length;
          counters.textLayoutObjects = (counters.textLayoutObjects || 0) + 1;
          counters.textLayoutMs = (counters.textLayoutMs || 0) + layoutMs;
          counters.maxTextLayoutMs = Math.max(counters.maxTextLayoutMs || 0, layoutMs);
          counters.textCharCount = (counters.textCharCount || 0) + chars;
          counters.largestTextChars = Math.max(counters.largestTextChars || 0, chars);
          counters.largestTextLayoutLines = Math.max(counters.largestTextLayoutLines || 0, totalLayoutLines);
        }
        if (counters) counters.richTextDirectDraws = (counters.richTextDirectDraws || 0) + 1;
        let drawnLineCount = 0;
        let layoutLineIndex = -1;
        for (const line of layout) {
          layoutLineIndex++;
          drawnLineCount++;
          const lineDrawStart = counters && typeof performance !== 'undefined' ? performance.now() : 0;
          const drawStats = deps.drawTextLineRange(
            context,
            line,
            obj,
            0,
            line.text?.length ?? 0,
            counters ? TEXT_DRAW_STATS_ENABLED : TEXT_DRAW_STATS_DISABLED,
          );
          if (counters && drawStats) addRichTextDrawStats(counters, drawStats);
          if (counters && typeof performance !== 'undefined') {
            recordRichTextLineDraw(counters, obj, line, layoutLineIndex, drawStats, performance.now() - lineDrawStart, deps);
          }
        }
        if (counters) {
          const culledLineCount = Math.max(0, totalLayoutLines - drawnLineCount);
          counters.textLines = (counters.textLines || 0) + totalLayoutLines;
          counters.drawnTextLines = (counters.drawnTextLines || 0) + drawnLineCount;
          counters.culledTextLines = (counters.culledTextLines || 0) + culledLineCount;
        }
        return true;
      }
      if (obj.type !== 'image') return false;

      const view = options.view || viewDefaults();
      const imageSourceResolver = options.imageSourceResolver || null;
      const key = obj.data.imgKey;
      const bitmap = deps.imageBitmapCache()[key];
      const lowLatencyImageMotion = !!options.motion;
      const selected = imageSourceResolver
        ? imageSourceResolver(key, obj, view, counters, lowLatencyImageMotion)
        : bitmap ? deps.selectImageSourceForDraw(key, obj, bitmap, view, lowLatencyImageMotion) : null;
      const img = selected?.source || selected || null;
      if (isDrawableImageSource(img)) {
        if (counters) {
          if (selected?.scale < 1) {
            counters.scaledImages = (counters.scaledImages || 0) + 1;
            counters.scaledImageScaleTotal = (counters.scaledImageScaleTotal || 0) + selected.scale;
            counters.scaledImageTargetScaleTotal = (counters.scaledImageTargetScaleTotal || 0) + selected.targetScale;
            if (selected?.openPreview) counters.openPreviewImages = (counters.openPreviewImages || 0) + 1;
            if (lowLatencyImageMotion) counters.motionScaledImages = (counters.motionScaledImages || 0) + 1;
          } else if (selected?.targetScale < 1) {
            counters.scaledFallbackFull = (counters.scaledFallbackFull || 0) + 1;
            if (lowLatencyImageMotion) counters.motionFullFallbackImages = (counters.motionFullFallbackImages || 0) + 1;
            if (selected?.activeInputFullFallback) {
              counters.activeInputFullFallbackImages = (counters.activeInputFullFallbackImages || 0) + 1;
              if (lowLatencyImageMotion) counters.motionActiveInputFullFallbackImages = (counters.motionActiveInputFullFallbackImages || 0) + 1;
            }
          } else if (selected?.scale === 1 && selected?.targetScale === 1) {
            counters.fullScaleImages = (counters.fullScaleImages || 0) + 1;
            if (lowLatencyImageMotion) counters.motionFullScaleImages = (counters.motionFullScaleImages || 0) + 1;
          }
          if (lowLatencyImageMotion) counters.lowLatencyImageDraws = (counters.lowLatencyImageDraws || 0) + 1;
          if (bitmap || selected?.scale < 1) counters.bitmapImages++;
          else {
            counters.elementImages++;
            counters.fallbackImages++;
          }
        }
        try {
          const cropped = drawImageObj(context, obj, img, view, viewportRect,
            selected?.activeInputFullFallback === true || lowLatencyImageMotion);
          if (cropped === null) return false;
          if (counters) {
            recordImageDrawWarmStats(
              counters,
              selected,
              !imageSourceDrawnBefore(img),
              !imageSourceContextDrawnBefore(img, context),
            );
            markImageSourceDrawn(img, context);
            if (cropped) counters.croppedImages = (counters.croppedImages || 0) + 1;
          }
          return true;
        } catch (err) {
          if (counters) {
            counters.erroredImages++;
            counters.lastDrawError = String(err);
            counters.lastDrawErrorKey = key;
            counters.lastDrawErrorId = obj.id;
          }
          return false;
        }
      }

      if (counters) {
        if (selected?.scaledVariantPending) counters.scaledVariantPendingImages = (counters.scaledVariantPendingImages || 0) + 1;
        else counters.missingImages++;
        counters.lastMissingKey = key;
        counters.lastMissingId = obj.id;
        counters.lastMissingReason = selected?.scaledVariantPending ? 'scaled-variant-pending-active-input'
          : imageSourceResolver ? 'resolved-source-pending'
          : !key ? 'missing-key'
          : !deps.imageStore()[key] ? 'missing-store'
            : !bitmap ? 'missing-bitmap'
              : 'unknown';
      }
      return false;
      }
    }

    function drawVisibleObjects(context
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , counters
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , options = {}
    ) {
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        const skipId = options.skipId || null;
        const skipIds = options.skipIds && typeof options.skipIds.has === 'function'
          ? options.skipIds
          : Array.isArray(options.skipIds) ? new Set(options.skipIds) : null;
        const viewportRect = options.viewportRect || deps.currentViewportWorldRect();
        const view = options.view || viewDefaults();
        const imageSourceResolver = options.imageSourceResolver || null;
        const skipText = options.skipText === true;
        const onlyText = options.onlyText === true;
        const motionObjects = typeof deps.motionObjectsForDraw === 'function' ? deps.motionObjectsForDraw() : undefined;
        const objectMotionForDraw = motionObjects === null || typeof deps.objectMotionForDraw !== 'function' ? null : deps.objectMotionForDraw;
        const cullingEnabled = deps.viewportCullingEnabled();
        const drawOptions = { view, imageSourceResolver, motion: null, viewportRect };
        const drawObject = (obj) => {
          if (obj.id === skipId || skipIds?.has(obj.id)) return;
          if (skipText && obj.type === 'text') return;
          if (onlyText && obj.type !== 'text') return;
          const motion = objectMotionForDraw ? objectMotionForDraw(obj, view.zoom) : null;
          if (cullingEnabled && !deps.objectIntersectsRect(obj, viewportRect) && !motion) return;
          if (motion?.skip) return;
          if (motion && context.save) {
            const opacity = Number.isFinite(motion.opacity) ? Math.max(0, Math.min(1, motion.opacity)) : 1;
            const scale = Number.isFinite(motion.scale) ? Math.max(0.01, motion.scale) : 1;
            const scaleX = Number.isFinite(motion.scaleX) ? Math.max(0.01, motion.scaleX) : scale;
            const scaleY = Number.isFinite(motion.scaleY) ? Math.max(0.01, motion.scaleY) : scale;
            const scaleOriginX = Number.isFinite(motion.scaleOriginX)
              ? Math.max(0, Math.min(1, motion.scaleOriginX))
              : 0.5;
            const scaleOriginY = Number.isFinite(motion.scaleOriginY)
              ? Math.max(0, Math.min(1, motion.scaleOriginY))
              : 0.5;
            const translateX = Number.isFinite(motion.translateX) ? motion.translateX : 0;
            const translateY = Number.isFinite(motion.translateY) ? motion.translateY : 0;
            context.save();
            context.globalAlpha = (Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1) * opacity;
            if (translateX || translateY) context.translate(translateX, translateY);
            if (scaleX !== 1 || scaleY !== 1) {
              const scalePivotX = obj.x + obj.w * scaleOriginX;
              const scalePivotY = obj.y + obj.h * scaleOriginY;
              context.translate(scalePivotX, scalePivotY);
              context.scale(scaleX, scaleY);
              context.translate(-scalePivotX, -scalePivotY);
            }
          }
          try {
            drawOptions.motion = motion;
            drawSingleObj(context, obj, drawOptions);
          } finally {
            if (motion && context.restore) context.restore();
          }
        };

        for (const obj of deps.objects()) drawObject(obj);
        for (const obj of motionObjects || []) drawObject(obj);
        return;
      } else {
      const skipId = options.skipId || null;
      const skipIds = options.skipIds && typeof options.skipIds.has === 'function'
        ? options.skipIds
        : Array.isArray(options.skipIds) ? new Set(options.skipIds) : null;
      const viewportRect = options.viewportRect || deps.currentViewportWorldRect();
      const view = options.view || viewDefaults();
      const imageSourceResolver = options.imageSourceResolver || null;
      const skipText = options.skipText === true;
      const onlyText = options.onlyText === true;
      const motionObjects = typeof deps.motionObjectsForDraw === 'function' ? deps.motionObjectsForDraw() : undefined;
      const objectMotionForDraw = motionObjects === null || typeof deps.objectMotionForDraw !== 'function' ? null : deps.objectMotionForDraw;
      const cullingEnabled = deps.viewportCullingEnabled();
      const drawOptions = { view, imageSourceResolver, motion: null, viewportRect };
      let drawnImages = 0;
      let drawnText = 0;
      const drawObject = (obj, countObject = true) => {
        if (countObject && counters) counters.testedObjects = (counters.testedObjects || 0) + 1;
        if (obj.id === skipId || skipIds?.has(obj.id)) return;
        if (skipText && obj.type === 'text') return;
        if (onlyText && obj.type !== 'text') return;
        const motion = objectMotionForDraw ? objectMotionForDraw(obj, view.zoom) : null;
        if (cullingEnabled && !deps.objectIntersectsRect(obj, viewportRect) && !motion) {
          if (countObject) countCulledObject(obj, counters);
          return;
        }
        if (countObject && counters) counters.visibleObjects = (counters.visibleObjects || 0) + 1;
        if (motion?.skip) return;
        if (motion) {
          const opacity = Number.isFinite(motion.opacity) ? Math.max(0, Math.min(1, motion.opacity)) : 1;
          const scale = Number.isFinite(motion.scale) ? Math.max(0.01, motion.scale) : 1;
          const scaleX = Number.isFinite(motion.scaleX) ? Math.max(0.01, motion.scaleX) : scale;
          const scaleY = Number.isFinite(motion.scaleY) ? Math.max(0.01, motion.scaleY) : scale;
          const scaleOriginX = Number.isFinite(motion.scaleOriginX)
            ? Math.max(0, Math.min(1, motion.scaleOriginX))
            : 0.5;
          const scaleOriginY = Number.isFinite(motion.scaleOriginY)
            ? Math.max(0, Math.min(1, motion.scaleOriginY))
            : 0.5;
          const translateX = Number.isFinite(motion.translateX) ? motion.translateX : 0;
          const translateY = Number.isFinite(motion.translateY) ? motion.translateY : 0;
          if (countObject && counters) {
            counters.motionObjects = (counters.motionObjects || 0) + 1;
            if (obj.type === 'image') counters.motionImages = (counters.motionImages || 0) + 1;
            else if (obj.type === 'text') counters.motionText = (counters.motionText || 0) + 1;
            if (translateX || translateY) counters.motionTranslatedObjects = (counters.motionTranslatedObjects || 0) + 1;
            if (scaleX !== 1 || scaleY !== 1) counters.motionScaledObjects = (counters.motionScaledObjects || 0) + 1;
          }
          if (context.save) {
            context.save();
            context.globalAlpha = (Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1) * opacity;
            if (translateX || translateY) context.translate(translateX, translateY);
            if (scaleX !== 1 || scaleY !== 1) {
              const scalePivotX = obj.x + obj.w * scaleOriginX;
              const scalePivotY = obj.y + obj.h * scaleOriginY;
              context.translate(scalePivotX, scalePivotY);
              context.scale(scaleX, scaleY);
              context.translate(-scalePivotX, -scalePivotY);
            }
          }
        }
        let drawn = false;
        const objectDrawStart = counters && typeof performance !== 'undefined' ? performance.now() : 0;
        const before = counters ? {
          textLayoutMs: drawCounterValue(counters, 'textLayoutMs'),
          textLines: drawCounterValue(counters, 'textLines'),
          drawnTextLines: drawCounterValue(counters, 'drawnTextLines'),
          culledTextLines: drawCounterValue(counters, 'culledTextLines'),
          croppedImages: drawCounterValue(counters, 'croppedImages'),
          scaledImages: drawCounterValue(counters, 'scaledImages'),
          openPreviewImages: drawCounterValue(counters, 'openPreviewImages'),
          dynamicOpenPreviewRequests: drawCounterValue(counters, 'dynamicOpenPreviewRequests'),
          fullScaleImages: drawCounterValue(counters, 'fullScaleImages'),
          scaledFallbackFull: drawCounterValue(counters, 'scaledFallbackFull'),
          activeInputFullFallbackImages: drawCounterValue(counters, 'activeInputFullFallbackImages'),
          scaledVariantPendingImages: drawCounterValue(counters, 'scaledVariantPendingImages'),
          motionObjects: drawCounterValue(counters, 'motionObjects'),
          motionImages: drawCounterValue(counters, 'motionImages'),
          motionText: drawCounterValue(counters, 'motionText'),
          motionTranslatedObjects: drawCounterValue(counters, 'motionTranslatedObjects'),
          motionScaledObjects: drawCounterValue(counters, 'motionScaledObjects'),
          lowLatencyImageDraws: drawCounterValue(counters, 'lowLatencyImageDraws'),
          motionScaledImages: drawCounterValue(counters, 'motionScaledImages'),
          motionFullScaleImages: drawCounterValue(counters, 'motionFullScaleImages'),
          motionFullFallbackImages: drawCounterValue(counters, 'motionFullFallbackImages'),
          motionActiveInputFullFallbackImages: drawCounterValue(counters, 'motionActiveInputFullFallbackImages'),
          scaledImageScaleTotal: drawCounterValue(counters, 'scaledImageScaleTotal'),
          scaledImageTargetScaleTotal: drawCounterValue(counters, 'scaledImageTargetScaleTotal'),
          richTextDrawUnits: drawCounterValue(counters, 'richTextDrawUnits'),
          richTextDrawCalls: drawCounterValue(counters, 'richTextDrawCalls'),
          richTextRuns: drawCounterValue(counters, 'richTextRuns'),
          richTextScriptRuns: drawCounterValue(counters, 'richTextScriptRuns'),
          richTextSkippedTabs: drawCounterValue(counters, 'richTextSkippedTabs'),
          richTextSkippedSpaces: drawCounterValue(counters, 'richTextSkippedSpaces'),
          richTextHiddenChars: drawCounterValue(counters, 'richTextHiddenChars'),
          richTextPlanCacheHits: drawCounterValue(counters, 'richTextPlanCacheHits'),
          richTextPlanCacheMisses: drawCounterValue(counters, 'richTextPlanCacheMisses'),
          richTextLineDrawMs: drawCounterValue(counters, 'richTextLineDrawMs'),
          slowRichTextLineDraws: drawCounterValue(counters, 'slowRichTextLineDraws'),
          richTextDirectDraws: drawCounterValue(counters, 'richTextDirectDraws'),
          imageSourceFirstDraws: drawCounterValue(counters, 'imageSourceFirstDraws'),
          imageSourceWarmDraws: drawCounterValue(counters, 'imageSourceWarmDraws'),
          imageContextFirstDraws: drawCounterValue(counters, 'imageContextFirstDraws'),
          imageContextWarmDraws: drawCounterValue(counters, 'imageContextWarmDraws'),
        } : null;
        try {
          drawOptions.motion = motion;
          drawn = drawSingleObj(context, obj, counters, drawOptions);
        } finally {
          if (motion && context.restore) context.restore();
          if (counters && typeof performance !== 'undefined') {
            recordSlowDrawObject(counters, obj, performance.now() - objectDrawStart, before, drawn, motion, deps);
          }
        }
        if (obj.type === 'image' && drawn) drawnImages++;
        else if (obj.type === 'text') drawnText++;
      };

      for (const obj of deps.objects()) {
        drawObject(obj, true);
      }
      for (const obj of motionObjects || []) {
        drawObject(obj, false);
      }
      return { drawnImages, drawnText };
      }
    }

    const renderer = {
      drawSingleObj,
      drawVisibleObjects,
      resetCanvasToScreen,
      setWorldCanvasTransform: (context, dpr = deps.dpr()) => setWorldCanvasTransform(context, dpr, deps),
    };
    if (typeof BOARDFISH_PRODUCTION === 'undefined') renderer.createDrawCounters = createDrawCounters;
    return Object.freeze(renderer);
  }

  const api = Object.freeze({ createBoardRenderer });

  root.BoardfishRenderer = api;
})(typeof window !== 'undefined' ? window : globalThis);
