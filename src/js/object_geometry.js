'use strict';

(function initObjectGeometry(root) {
  function createObjectGeometry(deps) {
    const IMAGE_UNIT_EPSILON = 1e-9;

    function objectContainsWorldPoint(obj, point) {
      if (obj.type !== 'image') {
        return point.x >= obj.x && point.x <= obj.x + obj.w && point.y >= obj.y && point.y <= obj.y + obj.h;
      }
      if (obj.w <= 0 || obj.h <= 0) return false;
      const transform = obj.data || {};
      const rotationDegrees = Number(transform.rotation) || 0;
      if (rotationDegrees % 90 === 0) {
        return point.x >= obj.x - obj.w * IMAGE_UNIT_EPSILON &&
          point.x <= obj.x + obj.w * (1 + IMAGE_UNIT_EPSILON) &&
          point.y >= obj.y - obj.h * IMAGE_UNIT_EPSILON &&
          point.y <= obj.y + obj.h * (1 + IMAGE_UNIT_EPSILON);
      }
      const rotation = (rotationDegrees * Math.PI) / 180;
      const dx = point.x - (obj.x + obj.w / 2);
      const dy = point.y - (obj.y + obj.h / 2);
      const unflippedX = transform.flipX ? -dx : dx;
      const unflippedY = transform.flipY ? -dy : dy;
      const cos = Math.cos(-rotation);
      const sin = Math.sin(-rotation);
      const localX = unflippedX * cos - unflippedY * sin;
      const localY = unflippedX * sin + unflippedY * cos;
      const halfTolerance = 0.5 + IMAGE_UNIT_EPSILON;
      return Math.abs(localX) <= obj.w * halfTolerance && Math.abs(localY) <= obj.h * halfTolerance;
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
