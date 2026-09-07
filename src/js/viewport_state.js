'use strict';

const ZOOM_MIN = 0.01, ZOOM_MAX = 100;

(function initViewportStateBoundary(root) {
  function applyViewportState(
    nextPanX = panX,
    nextPanY = panY,
    nextZoom = zoom,
  ) {
    nextZoom = Number.isFinite(nextZoom) ? (nextZoom > 0 ? nextZoom : 1) : zoom;
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
    const normalizedZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom));
    const scale = normalizedZoom / zoom;
    const nextPanX = clientX - (clientX - panX) * scale;
    const nextPanY = clientY - (clientY - panY) * scale;
    return applyViewportState(nextPanX, nextPanY, normalizedZoom);
  }

  function setPan(nextPanX, nextPanY) {
    return applyViewportState(nextPanX, nextPanY, zoom);
  }

  function setZoomPan(nextZoom, nextPanX, nextPanY) {
    return applyViewportState(nextPanX, nextPanY, nextZoom);
  }

  const api = Object.freeze({
    panBy,
    reset,
    setPan,
    setViewport,
    setZoomPan,
    zoomAroundClient,
  });
  root.BoardfishViewportState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
