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
      readbackSafeImages: 0,
      readbackSafePendingImages: 0,
      readbackSafeScaledImages: 0,
      eyedropperWarmedScaledImages: 0,
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

  function drawImageObj(context, obj, img, deps) {
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
      return;
    }

    context.drawImage(img, obj.x, obj.y, obj.w, obj.h);
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
        const lines = deps.getWrappedLines(obj);
        for (let i = 0; i < lines.length; i++) {
          context.fillText(lines[i].text, obj.x + deps.textPad, obj.y + deps.textPad + deps.textBaselineYOffset + i * deps.lineHeight);
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
          if (selected?.readbackSafe) counters.readbackSafeImages = (counters.readbackSafeImages || 0) + 1;
          if (selected?.warmedEyedropper) counters.eyedropperWarmedScaledImages = (counters.eyedropperWarmedScaledImages || 0) + 1;
          if (bitmap || selected?.scale < 1 || selected?.readbackSafe) counters.bitmapImages++;
          else {
            counters.elementImages++;
            counters.fallbackImages++;
          }
        }
        try {
          drawImageObj(context, obj, img, deps);
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
          : imageSourceResolver ? 'readback-safe-source-pending'
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
      let drawnImages = 0;
      let drawnText = 0;
      for (const obj of deps.objects()) {
        if (counters) counters.testedObjects = (counters.testedObjects || 0) + 1;
        if (obj.id === skipId) continue;
        if (deps.viewportCullingEnabled() && !deps.objectIntersectsRect(obj, viewportRect)) {
          countCulledObject(obj, counters);
          continue;
        }
        if (counters) counters.visibleObjects = (counters.visibleObjects || 0) + 1;
        const drawn = drawSingleObj(context, obj, counters, { view, imageSourceResolver });
        if (obj.type === 'image' && drawn) drawnImages++;
        else if (obj.type === 'text') drawnText++;
      }
      return { drawnImages, drawnText };
    }

    return Object.freeze({
      createDrawCounters,
      countCulledObject,
      drawImageObj: (context, obj, img) => drawImageObj(context, obj, img, deps),
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
