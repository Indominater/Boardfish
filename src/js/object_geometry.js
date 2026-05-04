'use strict';

(function initObjectGeometry(root) {
  function createObjectGeometry(deps) {
    function worldPointToImageLocalUnit(obj, worldPoint) {
      if (!obj || obj.type !== 'image' || !worldPoint || obj.w <= 0 || obj.h <= 0) return null;
      const transform = deps.imageTransformFromObject(obj);
      const rotation = ((transform.rotation || 0) * Math.PI) / 180;
      const sideways = deps.isSidewaysRotation(transform.rotation);
      const drawW = sideways ? obj.h : obj.w;
      const drawH = sideways ? obj.w : obj.h;
      if (drawW <= 0 || drawH <= 0) return null;

      const dx = worldPoint.x - (obj.x + obj.w / 2);
      const dy = worldPoint.y - (obj.y + obj.h / 2);
      const unflippedX = transform.flipX ? -dx : dx;
      const unflippedY = transform.flipY ? -dy : dy;
      const cos = Math.cos(-rotation);
      const sin = Math.sin(-rotation);
      const localX = unflippedX * cos - unflippedY * sin;
      const localY = unflippedX * sin + unflippedY * cos;
      const u = (localX + drawW / 2) / drawW;
      const v = (localY + drawH / 2) / drawH;
      const epsilon = 1e-9;
      if (u < -epsilon || u > 1 + epsilon || v < -epsilon || v > 1 + epsilon) return null;
      return {
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, v)),
      };
    }

    function objectContainsWorldPoint(obj, point) {
      if (!obj || !point) return false;
      if (obj.type === 'image') return !!worldPointToImageLocalUnit(obj, point);
      return point.x >= obj.x && point.x <= obj.x + obj.w && point.y >= obj.y && point.y <= obj.y + obj.h;
    }

    function topObjectAtWorldPoint(point, objectsList = deps.objects()) {
      for (let i = objectsList.length - 1; i >= 0; i--) {
        const obj = objectsList[i];
        if (objectContainsWorldPoint(obj, point)) return obj;
      }
      return null;
    }

    return Object.freeze({
      objectContainsWorldPoint,
      topObjectAtWorldPoint,
      worldPointToImageLocalUnit,
    });
  }

  const api = Object.freeze({ createObjectGeometry });
  root.BoardfishObjectGeometry = api;
  if (root !== globalThis) globalThis.BoardfishObjectGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
