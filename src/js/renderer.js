'use strict';

(function initBoardRenderer(root) {
  const IMAGE_EDGE_OVERDRAW_DEVICE_PX = 1;
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
      textChars: 0,
      textDrawnChars: 0,
      textDrawUnits: 0,
      textDrawCalls: 0,
      textRuns: 0,
      textSkippedTabs: 0,
      textSkippedSpaces: 0,
      textPlanCacheHits: 0,
      textPlanCacheMisses: 0,
      textLineDrawMs: 0,
      maxTextLineDrawMs: 0,
      slowTextLineDrawCount: 0,
      maxTextDrawUnitsPerLine: 0,
      maxTextDrawCallsPerLine: 0,
      maxTextRunsPerLine: 0,
      textDirectDraws: 0,
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

  function applyObjectMotion(context, obj, rect, motion
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , counters = null
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    const { scaleX = 1, scaleY = 1, scaleOriginX = 0.5, scaleOriginY = 0.5, translateX = 0, translateY = 0 } = motion;
    const pivotX = obj.x + obj.w * scaleOriginX;
    const pivotY = obj.y + obj.h * scaleOriginY;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (counters) {
      counters.motionObjects = (counters.motionObjects || 0) + 1;
      if (obj.type === 'image') counters.motionImages = (counters.motionImages || 0) + 1;
      else if (obj.type === 'text') counters.motionText = (counters.motionText || 0) + 1;
      if (translateX || translateY) counters.motionTranslatedObjects = (counters.motionTranslatedObjects || 0) + 1;
      if (scaleX !== 1 || scaleY !== 1) counters.motionScaledObjects = (counters.motionScaledObjects || 0) + 1;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    context.save();
    if (scaleX !== 1 || scaleY !== 1) {
      context.transform(scaleX, 0, 0, scaleY,
        translateX + pivotX * (1 - scaleX), translateY + pivotY * (1 - scaleY));
    } else if (translateX || translateY) context.translate(translateX, translateY);
    if (!rect) return rect;
    // Text layout and image crops are chosen before the canvas motion transform,
    // so map the visible destination back into the object's source coordinates.
    return {
      x1: pivotX + (rect.x1 - translateX - pivotX) / scaleX,
      y1: pivotY + (rect.y1 - translateY - pivotY) / scaleY,
      x2: pivotX + (rect.x2 - translateX - pivotX) / scaleX,
      y2: pivotY + (rect.y2 - translateY - pivotY) / scaleY,
    };
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  function countCulledObject(obj, counters = null) {
    if (!counters) return;
    if (obj.type === 'image') counters.culledImages = (counters.culledImages || 0) + 1;
    else if (obj.type === 'text') counters.culledText = (counters.culledText || 0) + 1;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  function drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect) {
    const edgeOverdraw = IMAGE_EDGE_OVERDRAW_DEVICE_PX / (view.zoom * view.dpr);
    const transform = obj.data;
    if (transform.flipX || transform.flipY || transform.rotation) {
      const sideways = Math.abs(transform.rotation) % 180 === 90;
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

    if (viewportRect && obj.w > 0 && obj.h > 0) {
      const objRight = obj.x + obj.w;
      const objBottom = obj.y + obj.h;
      const x1 = Math.max(obj.x, viewportRect.x1);
      const y1 = Math.max(obj.y, viewportRect.y1);
      const x2 = Math.min(objRight, viewportRect.x2);
      const y2 = Math.min(objBottom, viewportRect.y2);
      if (!(x2 > x1 && y2 > y1)) return null;
      if (x1 !== obj.x || y1 !== obj.y || x2 !== objRight || y2 !== objBottom) {
        const sourceWidth = img.width;
        const sourceHeight = img.height || img.naturalHeight;
        if (sourceHeight > 0) {
          const cropWidth = x2 - x1;
          const cropHeight = y2 - y1;
          const left = x1 === obj.x ? edgeOverdraw : 0;
          const top = y1 === obj.y ? edgeOverdraw : 0;
          const right = x2 === objRight ? edgeOverdraw : 0;
          const bottom = y2 === objBottom ? edgeOverdraw : 0;
          context.drawImage(
            img,
            (x1 - obj.x) / obj.w * sourceWidth,
            (y1 - obj.y) / obj.h * sourceHeight,
            cropWidth / obj.w * sourceWidth,
            cropHeight / obj.h * sourceHeight,
            x1 - left,
            y1 - top,
            cropWidth + (left + right),
            cropHeight + (top + bottom),
          );
          return true;
        }
      }
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

  function drawImageObj(context, obj, img, view, viewportRect, lowLatency, motion) {
    if (!lowLatency) {
      return drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect);
    }
    context.imageSmoothingEnabled = false;
    if (motion) return drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect);
    try {
      return drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect);
    } finally {
      context.imageSmoothingEnabled = true;
    }
  }

  function resetCanvasToScreen(context) {
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  function setWorldCanvasTransform(context, dpr, deps) {
    const scale = deps.zoom() * dpr;
    context.setTransform(scale, 0, 0, scale, deps.panX() * dpr, deps.panY() * dpr);
    context.imageSmoothingQuality = 'high';
    context.font = deps.font;
    context.fillStyle = deps.canvasTextColor();
    if (context.textAlign !== 'left') {
      try { context.fontKerning = 'none'; } catch (_) {}
      try { context.letterSpacing = '0px'; } catch (_) {}
      try { context.fontStretch = 'normal'; } catch (_) {}
      try { context.fontVariantCaps = 'normal'; } catch (_) {}
      try { context.textAlign = 'left'; } catch (_) {}
      try { context.direction = 'ltr'; } catch (_) {}
    }
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

  function addTextDrawStats(counters, stats) {
    const add = (field, sourceField = field) => {
      counters[field] = (counters[field] || 0) + (Number(stats[sourceField]) || 0);
    };
    add('textChars', 'chars');
    add('textDrawnChars', 'drawnChars');
    add('textDrawUnits', 'drawUnits');
    add('textDrawCalls', 'drawCalls');
    add('textRuns', 'runs');
    add('textSkippedTabs', 'skippedTabs');
    add('textSkippedSpaces', 'skippedSpaces');
    add('textPlanCacheHits', 'planCacheHits');
    add('textPlanCacheMisses', 'planCacheMisses');
    counters.maxTextDrawUnitsPerLine = Math.max(
      counters.maxTextDrawUnitsPerLine || 0,
      Number(stats.drawUnits) || 0,
    );
    counters.maxTextDrawCallsPerLine = Math.max(
      counters.maxTextDrawCallsPerLine || 0,
      Number(stats.drawCalls) || 0,
    );
    counters.maxTextRunsPerLine = Math.max(
      counters.maxTextRunsPerLine || 0,
      Number(stats.runs) || 0,
    );
  }

  function recordTextLineDraw(counters, obj, line, lineIndex, stats, ms, deps) {
    if (!counters || !Number.isFinite(ms) || ms < 0) return;
    counters.textLineDrawMs = (counters.textLineDrawMs || 0) + ms;
    counters.maxTextLineDrawMs = Math.max(counters.maxTextLineDrawMs || 0, ms);
    if (ms < SLOW_TEXT_LINE_DRAW_THRESHOLD_MS) return;
    counters.slowTextLineDrawCount = (counters.slowTextLineDrawCount || 0) + 1;
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
      skippedSpaces: Number(stats?.skippedSpaces) || 0,
      skippedTabs: Number(stats?.skippedTabs) || 0,
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
      row.textDrawUnits = drawCounterValue(counters, 'textDrawUnits') - before.textDrawUnits;
      row.textDrawCalls = drawCounterValue(counters, 'textDrawCalls') - before.textDrawCalls;
      row.textRuns = drawCounterValue(counters, 'textRuns') - before.textRuns;
      row.textSkippedTabs = drawCounterValue(counters, 'textSkippedTabs') - before.textSkippedTabs;
      row.textSkippedSpaces = drawCounterValue(counters, 'textSkippedSpaces') - before.textSkippedSpaces;
      row.textPlanCacheHits = drawCounterValue(counters, 'textPlanCacheHits') - before.textPlanCacheHits;
      row.textPlanCacheMisses = drawCounterValue(counters, 'textPlanCacheMisses') - before.textPlanCacheMisses;
      row.textLineDrawMs = roundDebugMs(drawCounterValue(counters, 'textLineDrawMs') - before.textLineDrawMs);
      row.slowTextLineDrawCount = drawCounterValue(counters, 'slowTextLineDrawCount') - before.slowTextLineDrawCount;
      row.textDirectDraws = drawCounterValue(counters, 'textDirectDraws') - before.textDirectDraws;
      row.slowTextLineRows = [];
      const slowLineRows = Array.isArray(counters.slowTextLineDraws) ? counters.slowTextLineDraws : [];
      for (const lineRow of slowLineRows) {
        if (lineRow.objectId !== obj.id) continue;
        row.slowTextLineRows.push({ ...lineRow });
        if (row.slowTextLineRows.length >= 6) break;
      }
      row.textUnitsPerLine = row.drawnTextLines > 0
        ? Math.round(row.textDrawUnits / row.drawnTextLines * 100) / 100
        : 0;
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

    function drawSingleObj(context, obj
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , counters = null
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , viewportRect = null
      , view = null
      , imageSourceResolver = null
      , motion = null
    ) {
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        if (obj.type === 'text') {
          const layout = getTextLayoutForDraw(obj, viewportRect);
          for (const line of layout) deps.drawTextLineRange(context, line, obj);
          return;
        }
        if (obj.type !== 'image') return;

        const key = obj.data.imgKey;
        // Viewport navigation is input-surface agnostic: touch, wheel, and drag
        // all request the same inexpensive image draw while a transform is live.
        const lowLatencyImageDraw = !!motion || view?.activeInput === true;
        const selected = imageSourceResolver
          ? imageSourceResolver(key, obj, view, lowLatencyImageDraw ? true : null)
          : deps.selectImageSourceForDraw(key, obj, deps.imageBitmapCache()[key], view, lowLatencyImageDraw ? true : null);
        const img = selected?.source || selected || null;
        if (!(img?.width > 0)) return;
        try {
          drawImageObj(context, obj, img, view, viewportRect, selected?.activeInputFullFallback === true || lowLatencyImageDraw, motion);
        } catch (_) {}
      } else {
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
        if (counters) counters.textDirectDraws = (counters.textDirectDraws || 0) + 1;
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
          if (counters && drawStats) addTextDrawStats(counters, drawStats);
          if (counters && typeof performance !== 'undefined') {
            recordTextLineDraw(counters, obj, line, layoutLineIndex, drawStats, performance.now() - lineDrawStart, deps);
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

      const key = obj.data.imgKey;
      const bitmap = deps.imageBitmapCache()[key];
      // Do not turn an absent override into `false`: the image selector uses
      // null to retain its shared viewport-activity detection.
      const lowLatencyImageDraw = !!motion || view?.activeInput === true;
      const selected = imageSourceResolver
        ? imageSourceResolver(key, obj, view, counters, lowLatencyImageDraw ? true : null)
        : bitmap ? deps.selectImageSourceForDraw(key, obj, bitmap, view, lowLatencyImageDraw ? true : null) : null;
      const img = selected?.source || selected || null;
      if (img?.width > 0) {
        if (counters) {
          if (selected?.scale < 1) {
            counters.scaledImages = (counters.scaledImages || 0) + 1;
            counters.scaledImageScaleTotal = (counters.scaledImageScaleTotal || 0) + selected.scale;
            counters.scaledImageTargetScaleTotal = (counters.scaledImageTargetScaleTotal || 0) + selected.targetScale;
            if (selected?.openPreview) counters.openPreviewImages = (counters.openPreviewImages || 0) + 1;
            if (motion) counters.motionScaledImages = (counters.motionScaledImages || 0) + 1;
          } else if (selected?.targetScale < 1) {
            counters.scaledFallbackFull = (counters.scaledFallbackFull || 0) + 1;
            if (motion) counters.motionFullFallbackImages = (counters.motionFullFallbackImages || 0) + 1;
            if (selected?.activeInputFullFallback) {
              counters.activeInputFullFallbackImages = (counters.activeInputFullFallbackImages || 0) + 1;
              if (motion) counters.motionActiveInputFullFallbackImages = (counters.motionActiveInputFullFallbackImages || 0) + 1;
            }
          } else if (selected?.scale === 1 && selected?.targetScale === 1) {
            counters.fullScaleImages = (counters.fullScaleImages || 0) + 1;
            if (motion) counters.motionFullScaleImages = (counters.motionFullScaleImages || 0) + 1;
          }
          if (lowLatencyImageDraw) counters.lowLatencyImageDraws = (counters.lowLatencyImageDraws || 0) + 1;
          if (bitmap || selected?.scale < 1) counters.bitmapImages++;
          else {
            counters.elementImages++;
            counters.fallbackImages++;
          }
        }
        try {
          const cropped = drawImageObj(context, obj, img, view, viewportRect, selected?.activeInputFullFallback === true || lowLatencyImageDraw, motion);
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
      , viewportRect = deps.currentViewportWorldRect()
      , skipIds
      , imageSourceResolver = null
      , skipId = null
      , onlyText = false
      , view = {
        zoom: deps.zoom(),
        dpr: deps.dpr(),
        activeInput: deps.isViewportInputActive?.() === true,
      }
    ) {
      const objectMotionForDraw =
        deps.hasObjectMotionsForDraw?.() === false ? null : deps.objectMotionForDraw;
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        for (const obj of deps.objects()) {
          if ((onlyText && obj.type !== 'text') || obj.id === skipId || skipIds?.has(obj.id)) continue;
          const motion = objectMotionForDraw ? objectMotionForDraw(obj, view.zoom) : null;
          if (!motion && !deps.objectIntersectsRect(obj, viewportRect)) continue;
          const objectViewportRect = motion
            ? applyObjectMotion(context, obj, viewportRect, motion)
            : viewportRect;
          try {
            drawSingleObj(context, obj, objectViewportRect, view, imageSourceResolver, motion);
          } finally {
            if (motion) context.restore();
          }
        }
        return;
      } else {
      const cullingEnabled = deps.viewportCullingEnabled();
      let drawnImages = 0;
      let drawnText = 0;
      for (const obj of deps.objects()) {
        if (counters) counters.testedObjects = (counters.testedObjects || 0) + 1;
        if ((onlyText && obj.type !== 'text') || obj.id === skipId || skipIds?.has(obj.id)) continue;
        const motion = objectMotionForDraw ? objectMotionForDraw(obj, view.zoom) : null;
        if (cullingEnabled && !deps.objectIntersectsRect(obj, viewportRect) && !motion) {
          countCulledObject(obj, counters);
          continue;
        }
        if (counters) counters.visibleObjects = (counters.visibleObjects || 0) + 1;
        const objectViewportRect = motion
          ? applyObjectMotion(context, obj, viewportRect, motion, counters)
          : viewportRect;
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
          textDrawUnits: drawCounterValue(counters, 'textDrawUnits'),
          textDrawCalls: drawCounterValue(counters, 'textDrawCalls'),
          textRuns: drawCounterValue(counters, 'textRuns'),
          textSkippedTabs: drawCounterValue(counters, 'textSkippedTabs'),
          textSkippedSpaces: drawCounterValue(counters, 'textSkippedSpaces'),
          textPlanCacheHits: drawCounterValue(counters, 'textPlanCacheHits'),
          textPlanCacheMisses: drawCounterValue(counters, 'textPlanCacheMisses'),
          textLineDrawMs: drawCounterValue(counters, 'textLineDrawMs'),
          slowTextLineDrawCount: drawCounterValue(counters, 'slowTextLineDrawCount'),
          textDirectDraws: drawCounterValue(counters, 'textDirectDraws'),
          imageSourceFirstDraws: drawCounterValue(counters, 'imageSourceFirstDraws'),
          imageSourceWarmDraws: drawCounterValue(counters, 'imageSourceWarmDraws'),
          imageContextFirstDraws: drawCounterValue(counters, 'imageContextFirstDraws'),
          imageContextWarmDraws: drawCounterValue(counters, 'imageContextWarmDraws'),
        } : null;
        try {
          drawn = drawSingleObj(context, obj, counters, objectViewportRect, view, imageSourceResolver, motion);
        } finally {
          if (motion) context.restore();
          if (counters && typeof performance !== 'undefined') {
            recordSlowDrawObject(counters, obj, performance.now() - objectDrawStart, before, drawn, motion, deps);
          }
        }
        if (obj.type === 'image' && drawn) drawnImages++;
        else if (obj.type === 'text') drawnText++;
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
