'use strict';

function objectBounds(items, map = null) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const item of items) {
    const obj = map ? map.get(item) : item;
    if (!obj) continue;
    const right = obj.x + obj.w, bottom = obj.y + obj.h;
    x1 = Math.min(x1, obj.x); y1 = Math.min(y1, obj.y);
    x2 = Math.max(x2, right); y2 = Math.max(y2, bottom);
  }
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

function selectedBounds() {
  return objectBounds(selectedIds, objectsMap);
}

function viewportWorldRect(padScreenPx = 0) {
  const pad = padScreenPx / zoom;
  const { width, height } = boardSurfaceCssSize();
  return {
    x1: -panX / zoom - pad,
    y1: -panY / zoom - pad,
    x2: (width - panX) / zoom + pad,
    y2: (height - panY) / zoom + pad,
  };
}

function rectContainsPoint(rect, point) {
  return !!rect && point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
}

function objectIntersectsRect(obj, rect) {
  return obj.x <= rect.x2 && obj.x + obj.w >= rect.x1 && obj.y <= rect.y2 && obj.y + obj.h >= rect.y1;
}
