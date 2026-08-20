'use strict';

(function initViewportStateBoundary(root) {
  const PAN_BOUNDARY_EPSILON = 0.000001;

  function constrainPan(
    nextPanX = panX,
    nextPanY = panY,
    nextZoom = zoom,
    lockAtBoundary = false,
  ) {
    nextZoom = Number.isFinite(nextZoom) ? (nextZoom > 0 ? nextZoom : 1) : zoom;
    nextPanX = Number.isFinite(nextPanX) ? nextPanX : panX;
    nextPanY = Number.isFinite(nextPanY) ? nextPanY : panY;
    const bounds = _masterBounds ||= objectBounds(objects, null, true);
    if (bounds) {
      const { x1, y1, x2, y2 } = bounds;
      const { width, height } = boardSurfaceCssSize();
      const minPanX = -x2 * nextZoom;
      const maxPanX = width - x1 * nextZoom;
      const minPanY = -y2 * nextZoom;
      const maxPanY = height - y1 * nextZoom;

      if (lockAtBoundary) {
        const viewportIsLeftOfMasterBox = panX >= maxPanX - PAN_BOUNDARY_EPSILON;
        const viewportIsRightOfMasterBox = panX <= minPanX + PAN_BOUNDARY_EPSILON;
        const viewportIsAboveMasterBox = panY >= maxPanY - PAN_BOUNDARY_EPSILON;
        const viewportIsBelowMasterBox = panY <= minPanY + PAN_BOUNDARY_EPSILON;
        if (viewportIsLeftOfMasterBox || viewportIsRightOfMasterBox ||
            viewportIsAboveMasterBox || viewportIsBelowMasterBox) {
          const recoverFromHorizontalEdge = viewportIsLeftOfMasterBox !== viewportIsRightOfMasterBox &&
            (viewportIsLeftOfMasterBox ? nextPanX < panX : nextPanX > panX);
          const recoverFromVerticalEdge = viewportIsAboveMasterBox !== viewportIsBelowMasterBox &&
            (viewportIsAboveMasterBox ? nextPanY < panY : nextPanY > panY);
          if (!recoverFromHorizontalEdge) nextPanX = panX;
          if (!recoverFromVerticalEdge) nextPanY = panY;
        }
      }
      nextPanX = Math.min(maxPanX, Math.max(minPanX, nextPanX));
      nextPanY = Math.min(maxPanY, Math.max(minPanY, nextPanY));
    }
    const changed = panX !== nextPanX || panY !== nextPanY || zoom !== nextZoom;
    panX = nextPanX;
    panY = nextPanY;
    zoom = nextZoom;
    return changed;
  }

  function setViewport(viewport = {}) {
    return constrainPan(viewport.panX, viewport.panY, viewport.zoom);
  }

  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
  }

  function panBy(dx = 0, dy = 0) {
    return constrainPan(panX + dx, panY + dy, zoom, true);
  }

  function zoomAroundClient(clientX, clientY, nextZoom) {
    const minZoom = typeof ZOOM_MIN === 'number' ? ZOOM_MIN : 0.01;
    const maxZoom = typeof ZOOM_MAX === 'number' ? ZOOM_MAX : 100;
    const normalizedZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    const scale = normalizedZoom / zoom;
    const nextPanX = clientX - (clientX - panX) * scale;
    const nextPanY = clientY - (clientY - panY) * scale;
    return constrainPan(nextPanX, nextPanY, normalizedZoom);
  }

  function setPan(nextPanX, nextPanY) {
    return constrainPan(nextPanX, nextPanY, zoom, true);
  }

  function setZoomPan(nextZoom, nextPanX, nextPanY) {
    return constrainPan(nextPanX, nextPanY, nextZoom);
  }

  function screenTransformBetween(from = {}, to = {}) {
    const fromZoom = Number(from.zoom);
    const toZoom = Number(to.zoom);
    if (!(fromZoom > 0) || !(toZoom > 0)) {
      return { scale: 1, translateX: 0, translateY: 0 };
    }
    const scale = toZoom / fromZoom;
    const fromPanX = Number.isFinite(Number(from.panX)) ? Number(from.panX) : 0;
    const fromPanY = Number.isFinite(Number(from.panY)) ? Number(from.panY) : 0;
    const toPanX = Number.isFinite(Number(to.panX)) ? Number(to.panX) : fromPanX;
    const toPanY = Number.isFinite(Number(to.panY)) ? Number(to.panY) : fromPanY;
    return {
      scale,
      translateX: toPanX - fromPanX * scale,
      translateY: toPanY - fromPanY * scale,
    };
  }

  const api = Object.freeze({
    constrainPan,
    panBy,
    reset,
    screenTransformBetween,
    setPan,
    setViewport,
    setZoomPan,
    zoomAroundClient,
  });
  root.BoardfishViewportState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
