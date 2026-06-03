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

  function setWorldCanvasTransform(context, dpr, view, deps) {
    context.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.panX * dpr, view.panY * dpr);
    deps.setCanvasImageQuality(context);
    context.font = deps.font;
    context.textBaseline = 'alphabetic';
  }

  function resolveTextBaselineYOffset(deps) {
    return typeof deps.textBaselineYOffset === 'function'
      ? deps.textBaselineYOffset()
      : deps.textBaselineYOffset;
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
        if (typeof deps.getTextLayout === 'function' && typeof deps.drawTextLineRange === 'function') {
          for (const line of deps.getTextLayout(obj)) deps.drawTextLineRange(context, line, obj);
          return true;
        }
        const lines = deps.getWrappedLines(obj);
        const textBaselineYOffset = resolveTextBaselineYOffset(deps);
        for (let i = 0; i < lines.length; i++) {
          context.fillText(lines[i].text, obj.x + deps.textPad, obj.y + deps.textPad + textBaselineYOffset + i * deps.lineHeight);
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
        try {
          drawn = drawSingleObj(context, obj, counters, {
            view,
            imageSourceResolver,
            viewportRect,
          });
        } finally {
          if (motion && context.restore) context.restore();
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
