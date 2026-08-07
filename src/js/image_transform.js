'use strict';

(function initImageTransform(root) {
  function normalizeRotation(value) {
    return ((Number(value) || 0) % 360 + 360) % 360;
  }

  function imageTransformFromObject(obj) {
    return obj.data;
  }

  function imageTransformNeedsRendering(transform) {
    return !!(transform?.flipX || transform?.flipY || transform?.rotation);
  }

  function isSidewaysRotation(rotation) {
    return Math.abs(Number(rotation) || 0) % 180 === 90;
  }

  root.normalizeRotation = normalizeRotation;
  root.imageTransformFromObject = imageTransformFromObject;
  root.imageTransformNeedsRendering = imageTransformNeedsRendering;
  root.isSidewaysRotation = isSidewaysRotation;
})(typeof window !== 'undefined' ? window : globalThis);
