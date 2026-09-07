'use strict';

(function initViewportStateBoundary(root) {
  function applyViewportState(
    nextPanX = panX,
    nextPanY = panY,
    nextZoom = zoom,
  ) {
    nextZoom = BoardfishBoardTypes.clampZoom(nextZoom, zoom);
    nextPanX = Number.isFinite(nextPanX) ? nextPanX : panX;
    nextPanY = Number.isFinite(nextPanY) ? nextPanY : panY;
    const changed = panX !== nextPanX || panY !== nextPanY || zoom !== nextZoom;
    panX = nextPanX;
    panY = nextPanY;
    zoom = nextZoom;
    return changed;
  }

  function setViewport(viewport = {}) {
    return applyViewportState(viewport.panX, viewport.panY, viewport.zoom);
  }

  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
  }

  function panBy(dx = 0, dy = 0) {
    return applyViewportState(panX + dx, panY + dy, zoom);
  }

  function zoomAroundClient(clientX, clientY, nextZoom) {
    const normalizedZoom = BoardfishBoardTypes.clampZoom(nextZoom, zoom);
    if (normalizedZoom === zoom) return false;
    const scale = normalizedZoom / zoom;
    const nextPanX = clientX - (clientX - panX) * scale;
    const nextPanY = clientY - (clientY - panY) * scale;
    return applyViewportState(nextPanX, nextPanY, normalizedZoom);
  }

  function setZoomPan(nextZoom, nextPanX, nextPanY) {
    return applyViewportState(nextPanX, nextPanY, nextZoom);
  }

  const api = Object.freeze({
    panBy,
    reset,
    setViewport,
    setZoomPan,
    zoomAroundClient,
  });
  root.BoardfishViewportState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
