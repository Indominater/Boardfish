'use strict';

(function initBoardRenderer(root) {
  const IMAGE_EDGE_OVERDRAW_DEVICE_PX = 1;
  // Include the wider neighboring scale layer when blending the tiny-text filter.
  const TEXT_FILTER_RADIUS_DEVICE_PX = 4.25;
  const TEXT_FILTER_MAX_DEVICE_EM = 12;
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
      scaledFallbackFull: 0,
      activeInputFullFallbackImages: 0,
      scaledVariantPendingImages: 0,
      fullScaleImages: 0,
      scaledImageScaleTotal: 0,
      scaledImageTargetScaleTotal: 0,
      culledImages: 0,
      culledText: 0,
      occludedText: 0,
      occludedImages: 0,
      partiallyOccludedObjects: 0,
      visibleObjectRegions: 0,
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
      textRasterCacheHits: 0,
      textRasterCacheMisses: 0,
      textRasterizedDrawCalls: 0,
      textRasterDrawCalls: 0,
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
      slowDrawObjects: [],
      slowTextLineDraws: [],
    };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

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
          const sx = sourceWidth / obj.w;
          const sy = sourceHeight / obj.h;
          const cropWidth = x2 - x1;
          const cropHeight = y2 - y1;
          const left = x1 === obj.x ? edgeOverdraw : 0;
          const top = y1 === obj.y ? edgeOverdraw : 0;
          const right = x2 === objRight ? edgeOverdraw : 0;
          const bottom = y2 === objBottom ? edgeOverdraw : 0;
          context.drawImage(
            img,
            (x1 - obj.x) * sx,
            (y1 - obj.y) * sy,
            cropWidth * sx,
            cropHeight * sy,
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

  function drawImageObj(context, obj, img, view, viewportRect, lowLatency) {
    if (!lowLatency) {
      return drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect);
    }
    context.imageSmoothingEnabled = false;
    try {
      return drawImageObjWithCurrentQuality(context, obj, img, view, viewportRect);
    } finally {
      context.imageSmoothingEnabled = true;
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
    add('textRasterCacheHits', 'rasterCacheHits');
    add('textRasterCacheMisses', 'rasterCacheMisses');
    add('textRasterizedDrawCalls', 'rasterizedDrawCalls');
    add('textRasterDrawCalls', 'rasterDrawCalls');
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
      rasterCacheHits: Number(stats?.rasterCacheHits) || 0,
      rasterCacheMisses: Number(stats?.rasterCacheMisses) || 0,
      rasterizedDrawCalls: Number(stats?.rasterizedDrawCalls) || 0,
      rasterDrawCalls: Number(stats?.rasterDrawCalls) || 0,
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
    } else {
      counters.imageContextWarmDraws = (counters.imageContextWarmDraws || 0) + 1;
    }
  }

  function recordSlowDrawObject(counters, obj, ms, before, drawn, deps = null) {
    if (!counters || !obj || !Number.isFinite(ms) || ms <= 0) return;
    const row = {
      id: obj.id || '',
      type: obj.type || '',
      ms: Math.round(ms * 100) / 100,
      drawn: !!drawn,
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
      row.textRasterCacheHits = drawCounterValue(counters, 'textRasterCacheHits') - before.textRasterCacheHits;
      row.textRasterCacheMisses = drawCounterValue(counters, 'textRasterCacheMisses') - before.textRasterCacheMisses;
      row.textRasterizedDrawCalls = drawCounterValue(counters, 'textRasterizedDrawCalls') - before.textRasterizedDrawCalls;
      row.textRasterDrawCalls = drawCounterValue(counters, 'textRasterDrawCalls') - before.textRasterDrawCalls;
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
    const gpuTextOptions = {
      fontSize: deps.fontSize || 16,
      padding: deps.textPad ?? 16,
      lineHeight: deps.lineHeight || 24,
    };
    const opaqueText = typeof deps.canvasBackgroundColor === 'function';
    const canClip = context => !!(context.save&&context.restore&&(context.clipRect||(context.clip&&context.beginPath&&context.rect)));
    const objectRect = obj => obj && [obj.x,obj.y,obj.w,obj.h].every(Number.isFinite) && obj.w>0 && obj.h>0
      ? {x1:obj.x,y1:obj.y,x2:obj.x+obj.w,y2:obj.y+obj.h} : null;
    const intersect = (a,b) => {
      const rect={x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1),x2:Math.min(a.x2,b.x2),y2:Math.min(a.y2,b.y2)};
      return rect.x2>rect.x1&&rect.y2>rect.y1?rect:null;
    };
    function withRectClip(context,rect,draw) {
      if(!rect||!canClip(context))return draw();
      context.save();
      try {
        if(context.clipRect)context.clipRect(rect.x1,rect.y1,rect.x2-rect.x1,rect.y2-rect.y1);
        else { context.beginPath();context.rect(rect.x1,rect.y1,rect.x2-rect.x1,rect.y2-rect.y1);context.clip(); }
        return draw();
      } finally { context.restore(); }
    }
    function drawRegions(context,rects,draw) {
      if(!rects.length)return false;
      if(context.clipRect||rects.length===1) {
        let drawn=false;for(const rect of rects)drawn=withRectClip(context,rect,()=>draw(rect))||drawn;return drawn;
      }
      // Native Canvas clips the union once. Separate antialiased clip masks
      // along adjoining fragments could otherwise soften their shared edge.
      context.save();
      try {
        context.beginPath();for(const rect of rects)context.rect(rect.x1,rect.y1,rect.x2-rect.x1,rect.y2-rect.y1);context.clip();
        return draw({x1:Math.min(...rects.map(r=>r.x1)),y1:Math.min(...rects.map(r=>r.y1)),x2:Math.max(...rects.map(r=>r.x2)),y2:Math.max(...rects.map(r=>r.y2))});
      } finally { context.restore(); }
    }
    function drawTextBackground(context,obj) {
      if(!opaqueText||!objectRect(obj)||!context.fillRect)return;
      const fill=context.fillStyle,alpha=context.globalAlpha;
      context.fillStyle=deps.canvasBackgroundColor();context.globalAlpha=1;
      context.fillRect(obj.x,obj.y,obj.w,obj.h);
      context.fillStyle=fill;context.globalAlpha=alpha;
    }
    function visibleObjectRegions(objects,viewport,skipId,canClip) {
      const result=new Map();if(!opaqueText||!viewport)return result;
      const covers=[];
      const edited=objects.find(obj=>obj.id===skipId&&obj.type==='text');
      const editedRect=objectRect(edited);if(editedRect) { const rect=intersect(editedRect,viewport);if(rect)covers.push(rect); }
      for(let i=objects.length-1;i>=0;i--) {
        const obj=objects[i];if(obj.id===skipId)continue;
        const bounds=objectRect(obj),base=bounds&&intersect(bounds,viewport);if(!base)continue;
        let regions=[base],changed=false;
        for(const cover of covers) {
          const next=[];let cut=false;
          for(const rect of regions) {
            const overlap=intersect(rect,cover);
            if(!overlap) { next.push(rect);continue; }
            cut=true;
            if(rect.y1<overlap.y1)next.push({x1:rect.x1,y1:rect.y1,x2:rect.x2,y2:overlap.y1});
            if(overlap.y2<rect.y2)next.push({x1:rect.x1,y1:overlap.y2,x2:rect.x2,y2:rect.y2});
            if(rect.x1<overlap.x1)next.push({x1:rect.x1,y1:overlap.y1,x2:overlap.x1,y2:overlap.y2});
            if(overlap.x2<rect.x2)next.push({x1:overlap.x2,y1:overlap.y1,x2:rect.x2,y2:overlap.y2});
          }
          // Bound pathological overlap fragmentation. Retaining earlier cuts
          // draws extra pixels safely; later opaque backgrounds still cover them.
          if(next.length>32)break;
          regions=next;changed||=cut;if(!regions.length)break;
        }
        if(changed&&(!regions.length||canClip))result.set(obj,regions);
        if(obj.type==='text'&&covers.length<128)covers.push(base);
      }
      return result;
    }

    function textViewportRect(viewportRect, view = null) {
      if (!viewportRect) return viewportRect;
      const scale = Math.abs((view?.zoom ?? deps.zoom?.() ?? 1) * (view?.dpr ?? deps.dpr?.() ?? 1));
      if (!(scale > 0) || !Number.isFinite(scale) || gpuTextOptions.fontSize * scale >= TEXT_FILTER_MAX_DEVICE_EM) return viewportRect;
      // Tiny glyph reconstruction reaches beyond the logical line/object box.
      // Include its complete physical-pixel footprint before either level of
      // culling, while retaining the original wrapping and absolute row indices.
      const padding = TEXT_FILTER_RADIUS_DEVICE_PX / scale;
      return {
        x1: viewportRect.x1 - padding, y1: viewportRect.y1 - padding,
        x2: viewportRect.x2 + padding, y2: viewportRect.y2 + padding,
      };
    }

    function setWorldCanvasTransform(context, dpr = deps.dpr()) {
      const scale = deps.zoom() * dpr;
      context.setTransform(scale, 0, 0, scale, deps.panX() * dpr, deps.panY() * dpr);
      context.fillStyle = deps.canvasTextColor();
      if (context.textAlign !== 'left') {
        context.imageSmoothingQuality = 'high';
        context.font = deps.font;
        try { context.fontKerning = 'none'; } catch (_) {}
        try { context.letterSpacing = '0px'; } catch (_) {}
        try { context.fontStretch = 'normal'; } catch (_) {}
        try { context.fontVariantCaps = 'normal'; } catch (_) {}
        try { context.textAlign = 'left'; } catch (_) {}
        try { context.direction = 'ltr'; } catch (_) {}
      }
    }

    function drawObjectContent(context, obj
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , counters = null
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , viewportRect = null
      , view = null
      , imageSourceResolver = null
    ) {
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        if (obj.type === 'text') {
          const layout = getTextLayoutForDraw(obj, textViewportRect(viewportRect, view));
          if (context.drawTextLayout?.(layout, obj, gpuTextOptions)) return;
          for (const line of layout) deps.drawTextLineRange(context, line, obj);
          return;
        }
        if (obj.type !== 'image') return;

        const key = obj.data.imgKey;
        const selected = imageSourceResolver
          ? imageSourceResolver(key, obj, view)
          : deps.selectImageSourceForDraw(key, obj, deps.imageBitmapCache()[key], view);
        const img = selected?.source || selected || null;
        if (!(img?.width > 0)) return;
        try {
          drawImageObj(context, obj, img, view, viewportRect, selected?.activeInputFullFallback === true);
        } catch (_) {}
      } else {
      if (obj.type === 'text') {
        const layoutStart = counters && typeof performance !== 'undefined' ? performance.now() : 0;
        const layout = getTextLayoutForDraw(obj, textViewportRect(viewportRect, view));
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
        if (context.drawTextLayout?.(layout, obj, gpuTextOptions)) {
          if (counters) {
            const gpuAfter = context.getStats?.();
            counters.textLines += totalLayoutLines;
            counters.drawnTextLines += layout.length;
            counters.culledTextLines += Math.max(0, totalLayoutLines - layout.length);
            counters.textGpuObjects = (counters.textGpuObjects || 0) + 1;
            if (gpuAfter) counters.gpu = gpuAfter;
          }
          return true;
        }
        let directlyDrawn = false;
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
          if (counters && drawStats) {
            addTextDrawStats(counters, drawStats);
            directlyDrawn ||= (Number(drawStats.drawCalls) || 0) > (Number(drawStats.rasterDrawCalls) || 0);
          }
          if (counters && typeof performance !== 'undefined') {
            recordTextLineDraw(counters, obj, line, layoutLineIndex, drawStats, performance.now() - lineDrawStart, deps);
          }
        }
        if (counters) {
          if (directlyDrawn) counters.textDirectDraws = (counters.textDirectDraws || 0) + 1;
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
      const selected = imageSourceResolver
        ? imageSourceResolver(key, obj, view, counters)
        : bitmap ? deps.selectImageSourceForDraw(key, obj, bitmap, view) : null;
      const img = selected?.source || selected || null;
      if (img?.width > 0) {
        if (counters) {
          if (selected?.scale < 1) {
            counters.scaledImages = (counters.scaledImages || 0) + 1;
            counters.scaledImageScaleTotal = (counters.scaledImageScaleTotal || 0) + selected.scale;
            counters.scaledImageTargetScaleTotal = (counters.scaledImageTargetScaleTotal || 0) + selected.targetScale;
          } else if (selected?.targetScale < 1) {
            counters.scaledFallbackFull = (counters.scaledFallbackFull || 0) + 1;
            if (selected?.activeInputFullFallback) {
              counters.activeInputFullFallbackImages = (counters.activeInputFullFallbackImages || 0) + 1;
            }
          } else if (selected?.scale === 1 && selected?.targetScale === 1) {
            counters.fullScaleImages = (counters.fullScaleImages || 0) + 1;
          }
          if (bitmap || selected?.scale < 1) counters.bitmapImages++;
          else {
            counters.elementImages++;
            counters.fallbackImages++;
          }
        }
        try {
          const cropped = drawImageObj(context, obj, img, view, viewportRect, selected?.activeInputFullFallback === true);
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

    function drawSingleObj(context,obj
      /* BOARDFISH_DEV_DIAGNOSTICS_START */ ,counters=null /* BOARDFISH_DEV_DIAGNOSTICS_END */
      ,viewportRect=null,view=null,imageSourceResolver=null
    ) {
      const draw=()=> {
        if(obj.type==='text')drawTextBackground(context,obj);
        return drawObjectContent(context,obj
          /* BOARDFISH_DEV_DIAGNOSTICS_START */ ,counters /* BOARDFISH_DEV_DIAGNOSTICS_END */
          ,viewportRect,view,imageSourceResolver);
      };
      return opaqueText&&obj.type==='text'?withRectClip(context,objectRect(obj),draw):draw();
    }

    function drawVisibleObjects(context
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , counters
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , viewportRect = deps.currentViewportWorldRect()
      , imageSourceResolver = null
      , skipId = null
      , view = { zoom: deps.zoom(), dpr: deps.dpr() }
    ) {
      const textRect = textViewportRect(viewportRect, view);
      const objects=deps.objects(),regions=visibleObjectRegions(objects,viewportRect,skipId,canClip(context));
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        for (const obj of objects) {
          if (obj.id === skipId) continue;
          if (!deps.objectIntersectsRect(obj, obj.type === 'text' ? textRect : viewportRect)) continue;
          const visible=regions.get(obj);
          if(visible)drawRegions(context,visible,rect=>drawSingleObj(context,obj
            /* BOARDFISH_DEV_DIAGNOSTICS_START */ ,null /* BOARDFISH_DEV_DIAGNOSTICS_END */
            ,rect,view,imageSourceResolver));
          else drawSingleObj(context, obj
            /* BOARDFISH_DEV_DIAGNOSTICS_START */ ,null /* BOARDFISH_DEV_DIAGNOSTICS_END */
            ,viewportRect, view, imageSourceResolver);
        }
        return;
      } else {
      const cullingEnabled = deps.viewportCullingEnabled();
      let drawnImages = 0;
      let drawnText = 0;
      for (const obj of objects) {
        if (counters) counters.testedObjects = (counters.testedObjects || 0) + 1;
        if (obj.id === skipId) continue;
        if (cullingEnabled && !deps.objectIntersectsRect(obj, obj.type === 'text' ? textRect : viewportRect)) {
          countCulledObject(obj, counters);
          continue;
        }
        const visible=regions.get(obj);
        if(visible&&!visible.length) {
          if(counters) { const key=obj.type==='text'?'occludedText':'occludedImages';counters[key]=(counters[key]||0)+1; }
          continue;
        }
        if(visible&&counters) { counters.partiallyOccludedObjects=(counters.partiallyOccludedObjects||0)+1;counters.visibleObjectRegions=(counters.visibleObjectRegions||0)+visible.length; }
        if (counters) counters.visibleObjects = (counters.visibleObjects || 0) + 1;
        let drawn = false;
        const objectDrawStart = counters && typeof performance !== 'undefined' ? performance.now() : 0;
        const before = counters ? {
          textLayoutMs: drawCounterValue(counters, 'textLayoutMs'),
          textLines: drawCounterValue(counters, 'textLines'),
          drawnTextLines: drawCounterValue(counters, 'drawnTextLines'),
          culledTextLines: drawCounterValue(counters, 'culledTextLines'),
          croppedImages: drawCounterValue(counters, 'croppedImages'),
          scaledImages: drawCounterValue(counters, 'scaledImages'),
          fullScaleImages: drawCounterValue(counters, 'fullScaleImages'),
          scaledFallbackFull: drawCounterValue(counters, 'scaledFallbackFull'),
          activeInputFullFallbackImages: drawCounterValue(counters, 'activeInputFullFallbackImages'),
          scaledVariantPendingImages: drawCounterValue(counters, 'scaledVariantPendingImages'),
          scaledImageScaleTotal: drawCounterValue(counters, 'scaledImageScaleTotal'),
          scaledImageTargetScaleTotal: drawCounterValue(counters, 'scaledImageTargetScaleTotal'),
          textDrawUnits: drawCounterValue(counters, 'textDrawUnits'),
          textDrawCalls: drawCounterValue(counters, 'textDrawCalls'),
          textRuns: drawCounterValue(counters, 'textRuns'),
          textSkippedTabs: drawCounterValue(counters, 'textSkippedTabs'),
          textSkippedSpaces: drawCounterValue(counters, 'textSkippedSpaces'),
          textPlanCacheHits: drawCounterValue(counters, 'textPlanCacheHits'),
          textPlanCacheMisses: drawCounterValue(counters, 'textPlanCacheMisses'),
          textRasterCacheHits: drawCounterValue(counters, 'textRasterCacheHits'),
          textRasterCacheMisses: drawCounterValue(counters, 'textRasterCacheMisses'),
          textRasterizedDrawCalls: drawCounterValue(counters, 'textRasterizedDrawCalls'),
          textRasterDrawCalls: drawCounterValue(counters, 'textRasterDrawCalls'),
          textLineDrawMs: drawCounterValue(counters, 'textLineDrawMs'),
          slowTextLineDrawCount: drawCounterValue(counters, 'slowTextLineDrawCount'),
          textDirectDraws: drawCounterValue(counters, 'textDirectDraws'),
          imageSourceFirstDraws: drawCounterValue(counters, 'imageSourceFirstDraws'),
          imageSourceWarmDraws: drawCounterValue(counters, 'imageSourceWarmDraws'),
          imageContextFirstDraws: drawCounterValue(counters, 'imageContextFirstDraws'),
          imageContextWarmDraws: drawCounterValue(counters, 'imageContextWarmDraws'),
        } : null;
        try {
          if(visible)drawn=drawRegions(context,visible,rect=>drawSingleObj(context,obj,counters,rect,view,imageSourceResolver));
          else drawn = drawSingleObj(context, obj, counters, viewportRect, view, imageSourceResolver);
        } finally {
          if (counters && typeof performance !== 'undefined') {
            recordSlowDrawObject(counters, obj, performance.now() - objectDrawStart, before, drawn, deps);
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
      setWorldCanvasTransform,
      textViewportRect,
      drawTextBackground,
      withTextObjectClip(context,obj,draw) { return opaqueText?withRectClip(context,objectRect(obj),draw):draw(); },
    };
    if (typeof BOARDFISH_PRODUCTION === 'undefined') renderer.createDrawCounters = createDrawCounters;
    return Object.freeze(renderer);
  }

  const api = Object.freeze({ createBoardRenderer });

  root.BoardfishRenderer = api;
})(typeof window !== 'undefined' ? window : globalThis);
