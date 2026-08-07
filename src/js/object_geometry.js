'use strict';

(function initObjectGeometry(root) {
  function createObjectGeometry(deps) {
    const IMAGE_UNIT_EPSILON = 1e-9;

    function imageContainsWorldPoint(obj, worldPoint) {
      if (!obj || obj.type !== 'image' || !worldPoint || obj.w <= 0 || obj.h <= 0) return false;
      const transform = deps.imageTransformFromObject(obj);
      const rotation = ((transform.rotation || 0) * Math.PI) / 180;
      const sideways = deps.isSidewaysRotation(transform.rotation);
      const drawW = sideways ? obj.h : obj.w;
      const drawH = sideways ? obj.w : obj.h;
      if (drawW <= 0 || drawH <= 0) return false;

      const dx = worldPoint.x - (obj.x + obj.w / 2);
      const dy = worldPoint.y - (obj.y + obj.h / 2);
      const unflippedX = transform.flipX ? -dx : dx;
      const unflippedY = transform.flipY ? -dy : dy;
      const cos = Math.cos(-rotation);
      const sin = Math.sin(-rotation);
      const localX = unflippedX * cos - unflippedY * sin;
      const localY = unflippedX * sin + unflippedY * cos;
      const halfTolerance = 0.5 + IMAGE_UNIT_EPSILON;
      return Math.abs(localX) <= drawW * halfTolerance && Math.abs(localY) <= drawH * halfTolerance;
    }

    function objectContainsWorldPoint(obj, point) {
      if (!obj || !point) return false;
      if (obj.type === 'image') return imageContainsWorldPoint(obj, point);
      return point.x >= obj.x && point.x <= obj.x + obj.w && point.y >= obj.y && point.y <= obj.y + obj.h;
    }

    function topObjectAtWorldPoint(point, objectsList = deps.objects(), predicate = null) {
      for (let i = objectsList.length - 1; i >= 0; i--) {
        const obj = objectsList[i];
        if (predicate && !predicate(obj)) continue;
        if (objectContainsWorldPoint(obj, point)) return obj;
      }
      return null;
    }

    return Object.freeze({
      topObjectAtWorldPoint,
    });
  }

  const api = Object.freeze({ createObjectGeometry });
  root.BoardfishObjectGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
