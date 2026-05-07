'use strict';

(function initObjectGeometry(root) {
  function createObjectGeometry(deps) {
    const IMAGE_UNIT_EPSILON = 1e-9;

    function imageLocalMetrics(obj, worldPoint) {
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
      return { centerX: obj.x + obj.w / 2, centerY: obj.y + obj.h / 2, drawW, drawH, localX, localY, rotation, transform };
    }

    function worldPointToImageLocalUnit(obj, worldPoint) {
      const metrics = imageLocalMetrics(obj, worldPoint);
      if (!metrics) return null;
      const u = (metrics.localX + metrics.drawW / 2) / metrics.drawW;
      const v = (metrics.localY + metrics.drawH / 2) / metrics.drawH;
      if (u < -IMAGE_UNIT_EPSILON || u > 1 + IMAGE_UNIT_EPSILON || v < -IMAGE_UNIT_EPSILON || v > 1 + IMAGE_UNIT_EPSILON) return null;
      return {
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, v)),
      };
    }

    function imageBoundsDistanceSqToWorldPoint(imageObj, worldPoint) {
      const metrics = imageLocalMetrics(imageObj, worldPoint);
      if (!metrics) return Infinity;

      const u = (metrics.localX + metrics.drawW / 2) / metrics.drawW;
      const v = (metrics.localY + metrics.drawH / 2) / metrics.drawH;
      if (
        u >= -IMAGE_UNIT_EPSILON &&
        u <= 1 + IMAGE_UNIT_EPSILON &&
        v >= -IMAGE_UNIT_EPSILON &&
        v <= 1 + IMAGE_UNIT_EPSILON
      ) {
        return 0;
      }

      const clampedX = Math.max(-metrics.drawW / 2, Math.min(metrics.drawW / 2, metrics.localX));
      const clampedY = Math.max(-metrics.drawH / 2, Math.min(metrics.drawH / 2, metrics.localY));
      const cos = Math.cos(metrics.rotation);
      const sin = Math.sin(metrics.rotation);
      const rotatedX = clampedX * cos - clampedY * sin;
      const rotatedY = clampedX * sin + clampedY * cos;
      const closestX = metrics.centerX + (metrics.transform.flipX ? -rotatedX : rotatedX);
      const closestY = metrics.centerY + (metrics.transform.flipY ? -rotatedY : rotatedY);
      const diffX = worldPoint.x - closestX;
      const diffY = worldPoint.y - closestY;
      return diffX * diffX + diffY * diffY;
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
      imageBoundsDistanceSqToWorldPoint,
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
