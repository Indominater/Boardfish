'use strict';

(function initEyedropperGeometry(root) {
  const ObjectGeometry = root.BoardfishObjectGeometry ||
    (typeof require === 'function' ? require('./object_geometry.js') : null);

  function createEyedropperGeometry(deps) {
    const objectGeometry = ObjectGeometry.createObjectGeometry(deps);

    function displayedBoardSourcePoint(clientX, clientY, sourceCanvas = deps.boardCanvas()) {
      const boardCanvas = deps.boardCanvas();
      const rect = boardCanvas?.getBoundingClientRect?.();
      const sourceW = sourceCanvas?.width || 0;
      const sourceH = sourceCanvas?.height || 0;
      if (!rect?.width || !rect?.height || sourceW <= 0 || sourceH <= 0) return null;
      return {
        x: (clientX - rect.left) * (sourceW / rect.width),
        y: (clientY - rect.top) * (sourceH / rect.height),
        sourceW,
        sourceH,
        rect,
      };
    }

    function boardBackgroundPixel() {
      return deps.parseCssColor(deps.canvasBackgroundColor(), [224, 224, 227, 255]);
    }

    function clientToBoardScreenPoint(clientX, clientY) {
      const rect = deps.boardCanvas().getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function screenToBoardWorldPoint(screenPoint) {
      const view = deps.view();
      const safeZoom = Math.max(view.zoom || 1, 0.0001);
      return { x: (screenPoint.x - view.panX) / safeZoom, y: (screenPoint.y - view.panY) / safeZoom };
    }

    function clientToBoardWorldPoint(clientX, clientY) {
      const toWorld = deps.toWorld?.();
      if (typeof toWorld === 'function') return toWorld(clientX, clientY);
      return screenToBoardWorldPoint(clientToBoardScreenPoint(clientX, clientY));
    }

    return Object.freeze({
      boardBackgroundPixel,
      clientToBoardScreenPoint,
      clientToBoardWorldPoint,
      displayedBoardSourcePoint,
      objectContainsWorldPoint: objectGeometry.objectContainsWorldPoint,
      screenToBoardWorldPoint,
      topObjectAtWorldPoint: objectGeometry.topObjectAtWorldPoint,
      worldPointToImageLocalUnit: objectGeometry.worldPointToImageLocalUnit,
    });
  }

  const api = Object.freeze({ createEyedropperGeometry });
  root.BoardfishEyedropperGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
