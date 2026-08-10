'use strict';

(function initViewportStateBoundary(root) {
  const PAN_BOUNDARY_EPSILON = 0.000001;

  function constrainPan(
    nextPanX = panX,
    nextPanY = panY,
    nextZoom = zoom,
    lockAtBoundary = false,
  ) {
    nextZoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : 1;
    nextPanX = Number.isFinite(nextPanX) ? nextPanX : 0;
    nextPanY = Number.isFinite(nextPanY) ? nextPanY : 0;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (obj?.type !== 'image' && obj?.type !== 'text') continue;
      if (
        !Number.isFinite(obj.x) ||
        !Number.isFinite(obj.y) ||
        !Number.isFinite(obj.w) ||
        !Number.isFinite(obj.h)
      ) {
        continue;
      }
      const right = obj.x + obj.w;
      const bottom = obj.y + obj.h;
      if (obj.x < x1) x1 = obj.x;
      if (obj.y < y1) y1 = obj.y;
      if (right > x2) x2 = right;
      if (bottom > y2) y2 = bottom;
    }
    if (x1 !== Infinity) {
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
    panX = nextPanX;
    panY = nextPanY;
    zoom = nextZoom;
  }

  function setViewport(viewport = {}) {
    constrainPan(
      Number.isFinite(viewport.panX) ? viewport.panX : panX,
      Number.isFinite(viewport.panY) ? viewport.panY : panY,
      Number.isFinite(viewport.zoom) ? viewport.zoom : zoom,
    );
  }

  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
  }

  function panBy(dx = 0, dy = 0) {
    constrainPan(
      panX + (Number(dx) || 0),
      panY + (Number(dy) || 0),
      zoom,
      true,
    );
  }

  function zoomAroundClient(clientX, clientY, nextZoom) {
    const minZoom = typeof ZOOM_MIN === 'number' ? ZOOM_MIN : 0.01;
    const maxZoom = typeof ZOOM_MAX === 'number' ? ZOOM_MAX : 100;
    const normalizedZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    const scale = normalizedZoom / zoom;
    const nextPanX = clientX - (clientX - panX) * scale;
    const nextPanY = clientY - (clientY - panY) * scale;
    constrainPan(nextPanX, nextPanY, normalizedZoom);
  }

  function setPan(nextPanX, nextPanY) {
    constrainPan(
      Number.isFinite(nextPanX) ? nextPanX : panX,
      Number.isFinite(nextPanY) ? nextPanY : panY,
      zoom,
      true,
    );
  }

  function setZoomPan(nextZoom, nextPanX, nextPanY) {
    constrainPan(
      Number.isFinite(nextPanX) ? nextPanX : panX,
      Number.isFinite(nextPanY) ? nextPanY : panY,
      Number.isFinite(nextZoom) ? nextZoom : zoom,
    );
  }

  const api = Object.freeze({
    constrainPan,
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
