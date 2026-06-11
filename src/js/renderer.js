'use strict';

(function initBoardRenderer(root) {
  function defaultImageBitmapCtor() {
    return typeof ImageBitmap !== 'undefined' ? ImageBitmap : null;
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
      scaledVariantPendingImages: 0,
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
      slowDrawObjects: [],
    };
  }

  function isDrawableImageSource(source, ImageBitmapCtor = defaultImageBitmapCtor()) {
    if (!source) return false;
    if (ImageBitmapCtor && source instanceof ImageBitmapCtor) return true;
    return !!(source.complete && source.naturalWidth > 0);
  }

  function countCulledObject(obj, counters = null) {
    if (!counters) return;
    if (obj.type === 'image') counters.culledImages = (counters.culledImages || 0) + 1;
    else if (obj.type === 'text') counters.culledText = (counters.culledText || 0) + 1;
  }

  function imageDimensions(source) {
    return {
      width: source?.width || source?.naturalWidth || 0,
      height: source?.height || source?.naturalHeight || 0,
    };
  }

  function visibleImageCrop(obj, img, rect) {
    if (!rect || !(obj?.w > 0) || !(obj?.h > 0)) return null;
    const x1 = Math.max(obj.x, rect.x1);
    const y1 = Math.max(obj.y, rect.y1);
    const x2 = Math.min(obj.x + obj.w, rect.x2);
    const y2 = Math.min(obj.y + obj.h, rect.y2);
    if (!(x2 > x1 && y2 > y1)) return { empty: true };
    if (x1 === obj.x && y1 === obj.y && x2 === obj.x + obj.w && y2 === obj.y + obj.h) return null;
    const source = imageDimensions(img);
    if (!(source.width > 0 && source.height > 0)) return null;
    return {
      sx: (x1 - obj.x) / obj.w * source.width,
      sy: (y1 - obj.y) / obj.h * source.height,
      sw: (x2 - x1) / obj.w * source.width,
      sh: (y2 - y1) / obj.h * source.height,
      dx: x1,
      dy: y1,
      dw: x2 - x1,
      dh: y2 - y1,
    };
  }

  function drawImageObj(context, obj, img, deps, options = {}) {
    const transform = deps.imageTransformFromObject(obj);
    if (deps.imageTransformNeedsRendering(transform)) {
      const sideways = deps.isSidewaysRotation(transform.rotation);
      const drawW = sideways ? obj.h : obj.w;
      const drawH = sideways ? obj.w : obj.h;
      context.save();
      context.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
      context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
      if (transform.rotation) context.rotate((transform.rotation * Math.PI) / 180);
      context.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      context.restore();
      return { cropped: false };
    }

    const crop = visibleImageCrop(obj, img, options.viewportRect);
    if (crop?.empty) return { skipped: true };
    if (crop) {
      context.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, crop.dx, crop.dy, crop.dw, crop.dh);
      return { cropped: true };
    }
    context.drawImage(img, obj.x, obj.y, obj.w, obj.h);
    return { cropped: false };
  }

  function resetCanvasToScreen(context) {
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  function configureRendererTextContext(context) {
    if (!context) return;
    try { context.fontKerning = 'none'; } catch (_) {}
    try { context.letterSpacing = '0px'; } catch (_) {}
    try { context.fontStretch = 'normal'; } catch (_) {}
    try { context.fontVariantCaps = 'normal'; } catch (_) {}
    try { context.textAlign = 'left'; } catch (_) {}
    try { context.direction = 'ltr'; } catch (_) {}
  }

  function setWorldCanvasTransform(context, dpr, view, deps) {
    context.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.panX * dpr, view.panY * dpr);
    deps.setCanvasImageQuality(context);
    context.font = deps.font;
    context.textBaseline = 'alphabetic';
    configureRendererTextContext(context);
  }

  function resolveTextBaselineYOffset(deps) {
    return typeof deps.textBaselineYOffset === 'function'
      ? deps.textBaselineYOffset()
      : deps.textBaselineYOffset;
  }

  function textLineIntersectsRect(lineTop, lineHeight, rect) {
    if (!rect) return true;
    const top = Number(lineTop);
    const height = Number(lineHeight);
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return true;
    return top + height >= rect.y1 && top <= rect.y2;
  }

  function countTextLine(counters, field, amount = 1) {
    if (!counters) return;
    const count = Math.max(0, Math.trunc(Number(amount)) || 0);
    if (!count) return;
    counters.textLines = (counters.textLines || 0) + count;
    counters[field] = (counters[field] || 0) + count;
  }

  function drawCounterValue(counters, field) {
    return Number(counters?.[field]) || 0;
  }

  function recordSlowDrawObject(counters, obj, ms, before, drawn, motion = null) {
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
    } else if (obj.type === 'image') {
      row.cropped = drawCounterValue(counters, 'croppedImages') > before.croppedImages;
      row.scaled = drawCounterValue(counters, 'scaledImages') > before.scaledImages;
      row.fullScale = drawCounterValue(counters, 'fullScaleImages') > before.fullScaleImages;
      row.fallbackFull = drawCounterValue(counters, 'scaledFallbackFull') > before.scaledFallbackFull;
    }
    const list = Array.isArray(counters.slowDrawObjects) ? counters.slowDrawObjects : [];
    list.push(row);
    list.sort((a, b) => (b.ms || 0) - (a.ms || 0));
    counters.slowDrawObjects = list.slice(0, 8);
  }

  function createBoardRenderer(deps) {
    function viewDefaults() {
      return {
        zoom: deps.zoom(),
        panX: deps.panX(),
        panY: deps.panY(),
        dpr: deps.dpr(),
      };
    }

    function drawSingleObj(context, obj, counters = null, options = {}) {
      const view = options.view || viewDefaults();
      const imageSourceResolver = options.imageSourceResolver || null;
      if (obj.type === 'text') {
        context.fillStyle = deps.canvasTextColor();
        context.textBaseline = 'alphabetic';
        configureRendererTextContext(context);
        if (typeof deps.getTextLayout === 'function' && typeof deps.drawTextLineRange === 'function') {
          const layoutStart = counters && typeof performance !== 'undefined' ? performance.now() : 0;
          const layout = typeof deps.getTextLayoutForViewport === 'function'
            ? deps.getTextLayoutForViewport(obj, options.viewportRect || null)
            : deps.getTextLayout(obj);
          const totalLayoutLines = Math.max(
            layout.length,
            Math.trunc(Number(layout.totalLines)) || layout.length,
          );
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
          const lineHeight = deps.lineHeight || 0;
          let drawnLineCount = 0;
          for (const line of layout) {
            if (!textLineIntersectsRect(line.y, lineHeight, options.viewportRect || null)) {
              continue;
            }
            drawnLineCount++;
            deps.drawTextLineRange(context, line, obj);
          }
          if (counters) {
            const culledLineCount = Math.max(0, totalLayoutLines - drawnLineCount);
            counters.textLines = (counters.textLines || 0) + totalLayoutLines;
            counters.drawnTextLines = (counters.drawnTextLines || 0) + drawnLineCount;
            counters.culledTextLines = (counters.culledTextLines || 0) + culledLineCount;
          }
          return true;
        }
        const lines = deps.getWrappedLines(obj);
        const textBaselineYOffset = resolveTextBaselineYOffset(deps);
        for (let i = 0; i < lines.length; i++) {
          const lineY = obj.y + deps.textPad + i * deps.lineHeight;
          if (!textLineIntersectsRect(lineY, deps.lineHeight, options.viewportRect || null)) {
            countTextLine(counters, 'culledTextLines');
            continue;
          }
          countTextLine(counters, 'drawnTextLines');
          context.fillText(lines[i].text, obj.x + deps.textPad, lineY + textBaselineYOffset);
        }
        return true;
      }
      if (obj.type !== 'image') return false;

      const key = obj.data.imgKey;
      const bitmap = deps.imageBitmapCache()[key];
      const fullImg = bitmap || deps.imageCache()[key] || null;
      const selected = imageSourceResolver
        ? imageSourceResolver(key, obj, view, counters)
        : fullImg ? deps.selectImageSourceForDraw(key, obj, fullImg, view) : null;
      const img = selected?.source || null;
      if (isDrawableImageSource(img)) {
        if (counters) {
          if (selected?.scale < 1) {
            counters.scaledImages = (counters.scaledImages || 0) + 1;
            counters.scaledImageScaleTotal = (counters.scaledImageScaleTotal || 0) + selected.scale;
            counters.scaledImageTargetScaleTotal = (counters.scaledImageTargetScaleTotal || 0) + selected.targetScale;
          } else if (selected?.targetScale < 1) {
            counters.scaledFallbackFull = (counters.scaledFallbackFull || 0) + 1;
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
          const drawResult = drawImageObj(context, obj, img, deps, { viewportRect: options.viewportRect || null });
          if (drawResult?.skipped) return false;
          if (drawResult?.cropped && counters) counters.croppedImages = (counters.croppedImages || 0) + 1;
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
            : !deps.imageCache()[key] ? 'missing-image-element'
              : !deps.imageCache()[key].complete ? 'not-complete'
                : deps.imageCache()[key].naturalWidth <= 0 ? 'zero-natural-width'
                  : !bitmap ? 'missing-bitmap'
                    : 'unknown';
      }
      return false;
    }

    function drawVisibleObjects(context, counters, options = {}) {
      const skipId = options.skipId || null;
      const viewportRect = options.viewportRect || deps.currentViewportWorldRect();
      const view = options.view || viewDefaults();
      const imageSourceResolver = options.imageSourceResolver || null;
      const skipText = options.skipText === true;
      const objectMotionForDraw = typeof deps.objectMotionForDraw === 'function' ? deps.objectMotionForDraw : null;
      const motionObjectsForDraw = typeof deps.motionObjectsForDraw === 'function' ? deps.motionObjectsForDraw : null;
      const cullingEnabled = deps.viewportCullingEnabled();
      let drawnImages = 0;
      let drawnText = 0;
      const drawObject = (obj, countObject = true) => {
        if (countObject && counters) counters.testedObjects = (counters.testedObjects || 0) + 1;
        if (obj.id === skipId) return;
        if (skipText && obj.type === 'text') return;
        if (cullingEnabled && !deps.objectIntersectsRect(obj, viewportRect)) {
          if (countObject) countCulledObject(obj, counters);
          return;
        }
        if (countObject && counters) counters.visibleObjects = (counters.visibleObjects || 0) + 1;
        const motion = objectMotionForDraw ? objectMotionForDraw(obj, { view, viewportRect }) : null;
        if (motion?.skip) return;
        if (motion && context.save) {
          context.save();
          const opacity = Number.isFinite(motion.opacity) ? Math.max(0, Math.min(1, motion.opacity)) : 1;
          const scale = Number.isFinite(motion.scale) ? Math.max(0.01, motion.scale) : 1;
          const scaleX = Number.isFinite(motion.scaleX) ? Math.max(0.01, motion.scaleX) : scale;
          const scaleY = Number.isFinite(motion.scaleY) ? Math.max(0.01, motion.scaleY) : scale;
          const translateX = Number.isFinite(motion.translateX) ? motion.translateX : 0;
          const translateY = Number.isFinite(motion.translateY) ? motion.translateY : 0;
          context.globalAlpha = (Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1) * opacity;
          if (translateX || translateY) context.translate(translateX, translateY);
          if (scaleX !== 1 || scaleY !== 1) {
            context.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
            context.scale(scaleX, scaleY);
            context.translate(-(obj.x + obj.w / 2), -(obj.y + obj.h / 2));
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
          fullScaleImages: drawCounterValue(counters, 'fullScaleImages'),
          scaledFallbackFull: drawCounterValue(counters, 'scaledFallbackFull'),
        } : null;
        try {
          drawn = drawSingleObj(context, obj, counters, {
            view,
            imageSourceResolver,
            viewportRect,
          });
        } finally {
          if (motion && context.restore) context.restore();
          if (counters && typeof performance !== 'undefined') {
            recordSlowDrawObject(counters, obj, performance.now() - objectDrawStart, before, drawn, motion);
          }
        }
        if (obj.type === 'image' && drawn) {
          drawnImages++;
          if (countObject && typeof deps.noteImageObjectDrawn === 'function') {
            deps.noteImageObjectDrawn(obj, { view, viewportRect });
          }
        } else if (obj.type === 'text') drawnText++;
      };

      for (const obj of deps.objects()) {
        drawObject(obj, true);
      }
      for (const obj of motionObjectsForDraw?.({ view, viewportRect }) || []) {
        drawObject(obj, false);
      }
      return { drawnImages, drawnText };
    }

    return Object.freeze({
      createDrawCounters,
      countCulledObject,
      drawImageObj: (context, obj, img, options = {}) => drawImageObj(context, obj, img, deps, options),
      drawSingleObj,
      drawVisibleObjects,
      isDrawableImageSource,
      resetCanvasToScreen,
      setWorldCanvasTransform: (context, dpr = deps.dpr(), view = viewDefaults()) => setWorldCanvasTransform(context, dpr, view, deps),
    });
  }

  const api = Object.freeze({
    createBoardRenderer,
    createDrawCounters,
    countCulledObject,
    isDrawableImageSource,
    resetCanvasToScreen,
  });

  root.BoardfishRenderer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
