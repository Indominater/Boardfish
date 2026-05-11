'use strict';

(function initViewportStateBoundary(root) {
  function snapshot() {
    return { panX, panY, zoom };
  }

  function setViewport(viewport = {}) {
    panX = Number.isFinite(viewport.panX) ? viewport.panX : panX;
    panY = Number.isFinite(viewport.panY) ? viewport.panY : panY;
    zoom = Number.isFinite(viewport.zoom) ? viewport.zoom : zoom;
    return snapshot();
  }

  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
    return snapshot();
  }

  function panBy(dx = 0, dy = 0) {
    panX += Number(dx) || 0;
    panY += Number(dy) || 0;
    return snapshot();
  }

  function zoomAroundClient(clientX, clientY, nextZoom) {
    const currentZoom = Math.max(zoom || 1, 0.0001);
    const minZoom = typeof ZOOM_MIN === 'number' ? ZOOM_MIN : 0.001;
    const maxZoom = typeof ZOOM_MAX === 'number' ? ZOOM_MAX : 1000;
    const normalizedZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    panX = clientX - (clientX - panX) * (normalizedZoom / currentZoom);
    panY = clientY - (clientY - panY) * (normalizedZoom / currentZoom);
    zoom = normalizedZoom;
    return snapshot();
  }

  function setPan(nextPanX, nextPanY) {
    panX = Number.isFinite(nextPanX) ? nextPanX : panX;
    panY = Number.isFinite(nextPanY) ? nextPanY : panY;
    return snapshot();
  }

  function setZoomPan(nextZoom, nextPanX, nextPanY) {
    zoom = Number.isFinite(nextZoom) ? nextZoom : zoom;
    panX = Number.isFinite(nextPanX) ? nextPanX : panX;
    panY = Number.isFinite(nextPanY) ? nextPanY : panY;
    return snapshot();
  }

  root.BoardfishViewportState = Object.freeze({
    panBy,
    reset,
    setPan,
    setViewport,
    setZoomPan,
    snapshot,
    zoomAroundClient,
    get panX() { return panX; },
    get panY() { return panY; },
    get zoom() { return zoom; },
  });
})(typeof window !== 'undefined' ? window : globalThis);
