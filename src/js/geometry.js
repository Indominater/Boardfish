'use strict';

function objectsBounds(objectsList) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let count = 0;

  for (const obj of objectsList || []) {
    if (!obj) continue;
    x1 = Math.min(x1, obj.x);
    y1 = Math.min(y1, obj.y);
    x2 = Math.max(x2, obj.x + obj.w);
    y2 = Math.max(y2, obj.y + obj.h);
    count++;
  }

  return count ? { x1, y1, x2, y2, count } : null;
}

function selectedObjectsList() {
  const list = [];
  for (const id of selectedIds) {
    const obj = objectsMap.get(id);
    if (obj) list.push(obj);
  }
  return list;
}

function selectedBounds() {
  return objectsBounds(selectedObjectsList());
}

function viewportWorldRect(padScreenPx = 0, view = { panX, panY, zoom }) {
  const z = Math.max(view.zoom, 0.001);
  const pad = padScreenPx / z;
  return {
    x1: -view.panX / z - pad,
    y1: -view.panY / z - pad,
    x2: (window.innerWidth - view.panX) / z + pad,
    y2: (window.innerHeight - view.panY) / z + pad,
  };
}

function rectContainsPoint(rect, point) {
  return !!rect && point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
}

function objectIntersectsRect(obj, rect) {
  return !!obj && !!rect && obj.x <= rect.x2 && obj.x + obj.w >= rect.x1 && obj.y <= rect.y2 && obj.y + obj.h >= rect.y1;
}
