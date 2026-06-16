'use strict';

(function initTextEditRectangleGutter(root) {
  const DEFAULT_CARET_HEIGHT_PX = 24;
  const DEFAULT_MARGIN_PX = 4;
  const DEFAULT_STROKE_CENTER_INSET_PX = 0.5;
  const MIN_SIZE_PX = 1;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finiteOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const fmt = (value) => {
    const rounded = Math.round((Number(value) || 0) * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  };

  function createGeometry({
    widthPx,
    heightPx,
    centerX,
    centerY,
    caretHeightPx = DEFAULT_CARET_HEIGHT_PX,
    marginPx = DEFAULT_MARGIN_PX,
  } = {}) {
    const width = Math.max(0, finiteOr(widthPx, 0));
    const height = Math.max(0, finiteOr(heightPx, 0));
    const caretHeight = Math.max(MIN_SIZE_PX, finiteOr(caretHeightPx, DEFAULT_CARET_HEIGHT_PX));
    const margin = Math.max(0, finiteOr(marginPx, DEFAULT_MARGIN_PX));
    const sideLength = Math.max(MIN_SIZE_PX, caretHeight * 3);
    const halfSide = sideLength / 2;
    const centerFallbackX = width > 0 ? width / 2 : halfSide;
    const centerFallbackY = height > 0 ? height / 2 : halfSide;
    const requestedCenterX = finiteOr(centerX, centerFallbackX);
    const requestedCenterY = finiteOr(centerY, centerFallbackY);
    const resolvedCenterX = width > 0 ? clamp(requestedCenterX, 0, width) : requestedCenterX;
    const resolvedCenterY = height > 0 ? clamp(requestedCenterY, 0, height) : requestedCenterY;
    const leftX = resolvedCenterX - halfSide;
    const rightX = resolvedCenterX + halfSide;
    const topY = resolvedCenterY - halfSide;
    const bottomY = resolvedCenterY + halfSide;
    const svgLeft = Math.min(0, leftX);
    const svgTop = Math.min(0, topY);
    const svgRight = Math.max(width, rightX);
    const svgBottom = Math.max(height, bottomY);

    return Object.freeze({
      widthPx: width,
      heightPx: height,
      centerX: resolvedCenterX,
      centerY: resolvedCenterY,
      caretHeightPx: caretHeight,
      marginPx: margin,
      sideLengthPx: sideLength,
      halfSideLengthPx: halfSide,
      verticalHeightPx: sideLength,
      horizontalDepthPx: halfSide,
      halfVerticalHeightPx: halfSide,
      leftX,
      rightX,
      topY,
      bottomY,
      edgeSvgX: 0,
      svgLeftPx: svgLeft,
      svgRightPx: svgRight,
      svgTopPx: svgTop,
      svgBottomPx: svgBottom,
      svgWidthPx: Math.max(MIN_SIZE_PX, svgRight - svgLeft),
      svgHeightPx: Math.max(MIN_SIZE_PX, svgBottom - svgTop),
    });
  }

  function depthAtY(localY, geometry) {
    if (!geometry) return 0;
    const y = finiteOr(localY, NaN);
    const depth = Math.max(0, -Math.min(0, Number(geometry.leftX) || 0));
    if (!Number.isFinite(y) || y < geometry.topY || y > geometry.bottomY || depth <= 0) return 0;
    return depth;
  }

  function pointInRect(x, y, rect, tolerance = 0) {
    return x >= rect.x1 - tolerance && x <= rect.x2 + tolerance &&
      y >= rect.y1 - tolerance && y <= rect.y2 + tolerance;
  }

  function hitTestLocal(localX, localY, geometry, tolerancePx = 0.75) {
    if (!geometry) return false;
    const x = finiteOr(localX, NaN);
    const y = finiteOr(localY, NaN);
    const tolerance = Math.max(0, finiteOr(tolerancePx, 0));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const box = {
      x1: geometry.leftX,
      y1: geometry.topY,
      x2: geometry.rightX,
      y2: geometry.bottomY,
    };
    const textBox = {
      x1: 0,
      y1: 0,
      x2: geometry.widthPx,
      y2: geometry.heightPx,
    };
    if (!pointInRect(x, y, box, tolerance)) return false;
    return !pointInRect(x, y, textBox, -tolerance);
  }

  function curvePoints(geometry) {
    if (!geometry) return [];
    return Object.freeze([
      Object.freeze({ x: geometry.leftX, y: geometry.topY }),
      Object.freeze({ x: geometry.rightX, y: geometry.topY }),
      Object.freeze({ x: geometry.rightX, y: geometry.bottomY }),
      Object.freeze({ x: geometry.leftX, y: geometry.bottomY }),
    ]);
  }

  function rectContainsCellCenter(rect, x, y) {
    return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
  }

  function keyForPoint(x, y) {
    return `${fmt(x)},${fmt(y)}`;
  }

  function mergeCollinear(points) {
    if (points.length <= 2) return points;
    const merged = [];
    for (const point of points) {
      merged.push(point);
      while (merged.length >= 3) {
        const a = merged[merged.length - 3];
        const b = merged[merged.length - 2];
        const c = merged[merged.length - 1];
        const sameX = Math.abs(a.x - b.x) < 1e-9 && Math.abs(b.x - c.x) < 1e-9;
        const sameY = Math.abs(a.y - b.y) < 1e-9 && Math.abs(b.y - c.y) < 1e-9;
        if (!sameX && !sameY) break;
        merged.splice(merged.length - 2, 1);
      }
    }
    if (merged.length >= 3) {
      const a = merged[merged.length - 2];
      const b = merged[merged.length - 1];
      const c = merged[0];
      const sameX = Math.abs(a.x - b.x) < 1e-9 && Math.abs(b.x - c.x) < 1e-9;
      const sameY = Math.abs(a.y - b.y) < 1e-9 && Math.abs(b.y - c.y) < 1e-9;
      if (sameX || sameY) merged.pop();
    }
    return merged;
  }

  function unionBoundaryPoints(rects) {
    const xs = Array.from(new Set(rects.flatMap((rect) => [rect.x1, rect.x2]))).sort((a, b) => a - b);
    const ys = Array.from(new Set(rects.flatMap((rect) => [rect.y1, rect.y2]))).sort((a, b) => a - b);
    const occupied = new Set();
    for (let yi = 0; yi < ys.length - 1; yi++) {
      for (let xi = 0; xi < xs.length - 1; xi++) {
        const x1 = xs[xi], x2 = xs[xi + 1], y1 = ys[yi], y2 = ys[yi + 1];
        if (x2 <= x1 || y2 <= y1) continue;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        if (rects.some((rect) => rectContainsCellCenter(rect, cx, cy))) occupied.add(`${xi},${yi}`);
      }
    }
    const hasCell = (xi, yi) => occupied.has(`${xi},${yi}`);
    const edges = [];
    for (const cellKey of occupied) {
      const [xi, yi] = cellKey.split(',').map(Number);
      const x1 = xs[xi], x2 = xs[xi + 1], y1 = ys[yi], y2 = ys[yi + 1];
      if (!hasCell(xi, yi - 1)) edges.push([{ x: x1, y: y1 }, { x: x2, y: y1 }]);
      if (!hasCell(xi + 1, yi)) edges.push([{ x: x2, y: y1 }, { x: x2, y: y2 }]);
      if (!hasCell(xi, yi + 1)) edges.push([{ x: x2, y: y2 }, { x: x1, y: y2 }]);
      if (!hasCell(xi - 1, yi)) edges.push([{ x: x1, y: y2 }, { x: x1, y: y1 }]);
    }
    if (!edges.length) return [];

    const byStart = new Map();
    for (const edge of edges) {
      const key = keyForPoint(edge[0].x, edge[0].y);
      if (!byStart.has(key)) byStart.set(key, []);
      byStart.get(key).push(edge);
    }
    let startEdge = edges[0];
    for (const edge of edges) {
      if (edge[0].y < startEdge[0].y || (edge[0].y === startEdge[0].y && edge[0].x < startEdge[0].x)) {
        startEdge = edge;
      }
    }
    const points = [startEdge[0], startEdge[1]];
    const used = new Set([`${keyForPoint(startEdge[0].x, startEdge[0].y)}>${keyForPoint(startEdge[1].x, startEdge[1].y)}`]);
    let current = startEdge[1];
    for (let guard = 0; guard < edges.length + 2; guard++) {
      const currentKey = keyForPoint(current.x, current.y);
      if (currentKey === keyForPoint(points[0].x, points[0].y)) break;
      const nextEdge = (byStart.get(currentKey) || []).find((edge) => {
        const edgeKey = `${keyForPoint(edge[0].x, edge[0].y)}>${keyForPoint(edge[1].x, edge[1].y)}`;
        return !used.has(edgeKey);
      });
      if (!nextEdge) break;
      used.add(`${keyForPoint(nextEdge[0].x, nextEdge[0].y)}>${keyForPoint(nextEdge[1].x, nextEdge[1].y)}`);
      current = nextEdge[1];
      points.push(current);
    }
    if (points.length > 1 && keyForPoint(points.at(-1).x, points.at(-1).y) === keyForPoint(points[0].x, points[0].y)) {
      points.pop();
    }
    return mergeCollinear(points);
  }

  function pathData(geometry, strokeCenterInsetPx = DEFAULT_STROKE_CENTER_INSET_PX) {
    if (!geometry) return '';
    const height = Math.max(0, geometry.heightPx);
    const width = Math.max(0, Number(geometry.widthPx) || 0);
    const inset = width > 0 && height > 0
      ? Math.min(width / 2, height / 2, Math.max(0, finiteOr(strokeCenterInsetPx, DEFAULT_STROKE_CENTER_INSET_PX)))
      : 0;
    const outlineLeftX = inset;
    const outlineTopY = inset;
    const outlineRightX = Math.max(outlineLeftX, width - inset);
    const outlineBottomY = Math.max(outlineTopY, height - inset);
    const points = unionBoundaryPoints([
      { x1: outlineLeftX, y1: outlineTopY, x2: outlineRightX, y2: outlineBottomY },
      { x1: geometry.leftX, y1: geometry.topY, x2: geometry.rightX, y2: geometry.bottomY },
    ]);
    if (!points.length) return '';
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${fmt(point.x)} ${fmt(point.y)}`)
      .join(' ') + ' Z';
  }

  const api = Object.freeze({
    DEFAULT_CARET_HEIGHT_PX,
    DEFAULT_MARGIN_PX,
    DEFAULT_STROKE_CENTER_INSET_PX,
    createGeometry,
    curvePoints,
    depthAtY,
    hitTestLocal,
    pathData,
  });

  root.BoardfishTextEditRectangleGutter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
