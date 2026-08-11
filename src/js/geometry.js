'use strict';

function selectedBounds() {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;

  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (!obj) continue;
    x1 = Math.min(x1, obj.x);
    y1 = Math.min(y1, obj.y);
    x2 = Math.max(x2, obj.x + obj.w);
    y2 = Math.max(y2, obj.y + obj.h);
  }

  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

function viewportWorldRect(padScreenPx = 0) {
  const z = Math.max(zoom, 0.001);
  const pad = padScreenPx / z;
  const { width, height } = boardSurfaceCssSize();
  return {
    x1: -panX / z - pad,
    y1: -panY / z - pad,
    x2: (width - panX) / z + pad,
    y2: (height - panY) / z + pad,
  };
}

function rectContainsPoint(rect, point) {
  return !!rect && point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
}

function objectIntersectsRect(obj, rect) {
  return obj.x <= rect.x2 && obj.x + obj.w >= rect.x1 && obj.y <= rect.y2 && obj.y + obj.h >= rect.y1;
}
