'use strict';

(function initViewportStateBoundary(root) {
  function boardMasterBox(objectList = []) {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    let count = 0;

    for (const obj of objectList || []) {
      if (obj?.type !== 'image' && obj?.type !== 'text') continue;
      if (
        !Number.isFinite(obj.x) ||
        !Number.isFinite(obj.y) ||
        !Number.isFinite(obj.w) ||
        !Number.isFinite(obj.h)
      ) {
        continue;
      }
      const objectX2 = obj.x + obj.w;
      const objectY2 = obj.y + obj.h;
      x1 = Math.min(x1, obj.x, objectX2);
      y1 = Math.min(y1, obj.y, objectY2);
      x2 = Math.max(x2, obj.x, objectX2);
      y2 = Math.max(y2, obj.y, objectY2);
      count++;
    }

    return count ? { x1, y1, x2, y2, count } : null;
  }

  function clampPanToBoardMasterBox(viewport = {}, objectList = [], surface = {}) {
    const nextZoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
    const nextPanX = Number.isFinite(viewport.panX) ? viewport.panX : 0;
    const nextPanY = Number.isFinite(viewport.panY) ? viewport.panY : 0;
    const masterBox = boardMasterBox(objectList);
    if (!masterBox) return { panX: nextPanX, panY: nextPanY, zoom: nextZoom };

    const width = Number.isFinite(surface.width) ? Math.max(0, surface.width) : 0;
    const height = Number.isFinite(surface.height) ? Math.max(0, surface.height) : 0;
    const minPanX = -masterBox.x2 * nextZoom;
    const maxPanX = width - masterBox.x1 * nextZoom;
    const minPanY = -masterBox.y2 * nextZoom;
    const maxPanY = height - masterBox.y1 * nextZoom;

    return {
      panX: Math.min(maxPanX, Math.max(minPanX, nextPanX)),
      panY: Math.min(maxPanY, Math.max(minPanY, nextPanY)),
      zoom: nextZoom,
    };
  }

  function currentBoardObjects() {
    return typeof objects !== 'undefined' && Array.isArray(objects) ? objects : [];
  }

  function currentBoardSurfaceSize() {
    if (typeof boardSurfaceCssSize === 'function') return boardSurfaceCssSize();
    return {
      width: Number(root.innerWidth) || 0,
      height: Number(root.innerHeight) || 0,
    };
  }

  function constrainPan(nextPanX = panX, nextPanY = panY, nextZoom = zoom) {
    const constrained = clampPanToBoardMasterBox(
      { panX: nextPanX, panY: nextPanY, zoom: nextZoom },
      currentBoardObjects(),
      currentBoardSurfaceSize(),
    );
    panX = constrained.panX;
    panY = constrained.panY;
    zoom = constrained.zoom;
    return snapshot();
  }

  function snapshot() {
    return { panX, panY, zoom };
  }

  function setViewport(viewport = {}) {
    zoom = Number.isFinite(viewport.zoom) ? viewport.zoom : zoom;
    return constrainPan(
      Number.isFinite(viewport.panX) ? viewport.panX : panX,
      Number.isFinite(viewport.panY) ? viewport.panY : panY,
      zoom,
    );
  }

  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
    return snapshot();
  }

  function panBy(dx = 0, dy = 0) {
    return constrainPan(
      panX + (Number(dx) || 0),
      panY + (Number(dy) || 0),
    );
  }

  function zoomAroundClient(clientX, clientY, nextZoom) {
    const currentZoom = Math.max(zoom || 1, 0.0001);
    const minZoom = typeof ZOOM_MIN === 'number' ? ZOOM_MIN : 0.01;
    const maxZoom = typeof ZOOM_MAX === 'number' ? ZOOM_MAX : 100;
    const normalizedZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    const nextPanX = clientX - (clientX - panX) * (normalizedZoom / currentZoom);
    const nextPanY = clientY - (clientY - panY) * (normalizedZoom / currentZoom);
    zoom = normalizedZoom;
    return constrainPan(nextPanX, nextPanY, zoom);
  }

  function setPan(nextPanX, nextPanY) {
    return constrainPan(
      Number.isFinite(nextPanX) ? nextPanX : panX,
      Number.isFinite(nextPanY) ? nextPanY : panY,
    );
  }

  function setZoomPan(nextZoom, nextPanX, nextPanY) {
    zoom = Number.isFinite(nextZoom) ? nextZoom : zoom;
    return constrainPan(
      Number.isFinite(nextPanX) ? nextPanX : panX,
      Number.isFinite(nextPanY) ? nextPanY : panY,
      zoom,
    );
  }

  const api = Object.freeze({
    boardMasterBox,
    clampPanToBoardMasterBox,
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
