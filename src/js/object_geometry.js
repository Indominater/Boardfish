'use strict';

(function initObjectGeometry(root) {
  function createObjectGeometry(deps) {
    const IMAGE_UNIT_EPSILON = 1e-9;

    function topObjectAtWorldPoint(point, objectsList = deps.objects()) {
      for (let i = objectsList.length - 1; i >= 0; i--) {
        const obj = objectsList[i];
        if (obj.type !== 'image') {
          if (obj.type === 'text' && root.BoardfishTextPanels) {
            if (root.BoardfishTextPanels.containsPoint(obj, point.x, point.y)) return obj;
            continue;
          }
          if (point.x >= obj.x && point.x <= obj.x + obj.w && point.y >= obj.y && point.y <= obj.y + obj.h) return obj;
          continue;
        }
        const transform = obj.data, rotationDegrees = transform.rotation;
        if (rotationDegrees % 90 === 0) {
          if (point.x >= obj.x - obj.w * IMAGE_UNIT_EPSILON &&
            point.x <= obj.x + obj.w * (1 + IMAGE_UNIT_EPSILON) &&
            point.y >= obj.y - obj.h * IMAGE_UNIT_EPSILON &&
            point.y <= obj.y + obj.h * (1 + IMAGE_UNIT_EPSILON)) return obj;
          continue;
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
        if (Math.abs(localX) <= obj.w * halfTolerance && Math.abs(localY) <= obj.h * halfTolerance) return obj;
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
