'use strict';

(function initPanelVisibility(root) {
  const MAX_RECENT_SHAPES = 32;
  const MAX_GRID_SIDE = 256;
  const MIN_TILE_DEVICE_PX = 8;
  const asciiCache = new WeakMap();

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function isAsciiText(obj) {
    const content = obj.data?.content;
    if (typeof content !== 'string') return false;
    const cached = asciiCache.get(obj);
    if (cached?.content === content) return cached.ascii;
    const ascii = !/[^\x09\x0a\x0d\x20-\x7e]/.test(content);
    asciiCache.set(obj, { content, ascii });
    return ascii;
  }

  function expanded(rect, amount) {
    return { x1: rect.x1 - amount, y1: rect.y1 - amount, x2: rect.x2 + amount, y2: rect.y2 + amount };
  }

  // The p=4 rounded corner is convex. If all four corners of a rectangle
  // belong to the shape, its complete interior belongs to it as well.
  function pointInside(shape, x, y) {
    if (x < shape.x1 || x > shape.x2 || y < shape.y1 || y > shape.y2) return false;
    if (!shape.radius) return true;
    const dx = Math.max(shape.x1 + shape.radius - x, x - (shape.x2 - shape.radius), 0) / shape.radius;
    const dy = Math.max(shape.y1 + shape.radius - y, y - (shape.y2 - shape.radius), 0) / shape.radius;
    const xx = dx * dx, yy = dy * dy;
    return xx * xx + yy * yy <= 1;
  }

  function rectangleInside(shape, rect, inset = 1) {
    // Require a complete one-device-pixel neighborhood inside the contour.
    // The antialiased edge and transparent corner can never hide another item.
    const x1 = rect.x1 - inset, y1 = rect.y1 - inset;
    const x2 = rect.x2 + inset, y2 = rect.y2 + inset;
    return pointInside(shape, x1, y1) && pointInside(shape, x2, y1) &&
      pointInside(shape, x1, y2) && pointInside(shape, x2, y2);
  }

  function sameShape(a, b) {
    return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2 && a.radius === b.radius;
  }

  function createCoverage(width, height) {
    const tileSize = Math.max(MIN_TILE_DEVICE_PX, width / MAX_GRID_SIDE, height / MAX_GRID_SIDE);
    const cols = Math.max(1, Math.ceil(width / tileSize));
    const rows = Math.max(1, Math.ceil(height / tileSize));
    // Disjoint-set successors skip already opaque cells when adding a shape.
    // Repeated large panels do not repeatedly traverse their covered interiors.
    const successors = new Int32Array(cols * rows + 1);
    for (let i = 0; i < successors.length; i++) successors[i] = i;
    const recent = [];

    function nextUncovered(index) {
      let next = index;
      while (successors[next] !== next) next = successors[next];
      while (successors[index] !== index) {
        const previous = index;
        index = successors[index];
        successors[previous] = next;
      }
      return next;
    }

    function clipped(rect) {
      return {
        x1: Math.max(0, rect.x1), y1: Math.max(0, rect.y1),
        x2: Math.min(width, rect.x2), y2: Math.min(height, rect.y2),
      };
    }

    function range(rect) {
      return {
        col1: Math.max(0, Math.floor(rect.x1 / tileSize)),
        row1: Math.max(0, Math.floor(rect.y1 / tileSize)),
        col2: Math.min(cols, Math.ceil(rect.x2 / tileSize)),
        row2: Math.min(rows, Math.ceil(rect.y2 / tileSize)),
      };
    }

    function contains(rect) {
      if (!rect || ![rect.x1, rect.y1, rect.x2, rect.y2].every(Number.isFinite) ||
          rect.x2 < rect.x1 || rect.y2 < rect.y1) return false;
      const visible = clipped(rect);
      if (!(visible.x2 > visible.x1 && visible.y2 > visible.y1)) return true;
      // This exact, bounded path catches identical stacks even below tile size.
      for (let i = recent.length - 1; i >= 0; i--) {
        if (rectangleInside(recent[i], visible)) return true;
      }
      const { col1, row1, col2, row2 } = range(visible);
      for (let row = row1; row < row2; row++) {
        const end = row * cols + col2;
        if (nextUncovered(row * cols + col1) < end) return false;
      }
      return true;
    }

    function add(shape) {
      if (![shape.x1, shape.y1, shape.x2, shape.y2, shape.radius].every(Number.isFinite)) return;
      const visible = clipped(shape);
      if (!(visible.x2 > visible.x1 && visible.y2 > visible.y1)) return;
      if (recent.some(previous => sameShape(previous, shape))) return;
      recent.push(shape);
      if (recent.length > MAX_RECENT_SHAPES) recent.shift();
      const { col1, row1, col2, row2 } = range(visible);
      for (let row = row1; row < row2; row++) {
        const end = row * cols + col2;
        let index = nextUncovered(row * cols + col1);
        while (index < end) {
          const col = index - row * cols;
          const tile = {
            x1: col * tileSize, y1: row * tileSize,
            x2: Math.min(width, (col + 1) * tileSize),
            y2: Math.min(height, (row + 1) * tileSize),
          };
          if (rectangleInside(shape, tile)) {
            successors[index] = nextUncovered(index + 1);
          }
          index = nextUncovered(index + 1);
        }
      }
    }

    return { contains, add };
  }

  /**
   * Plan back-to-front objects using only opacity guaranteed by text panels.
   * All geometry is camera-relative device pixels. Images never occlude: their
   * alpha is unknown. Shadows remain visible until their full draw bounds are
   * covered; coincident translucent shadows must still accumulate normally.
   */
  function createPlan(objects, viewport, style = {}, options = {}) {
    const plan = new Map();
    if (!Array.isArray(objects) || objects.length < 2 || style.opaque === false) return plan;
    let participants = 0, hasOpaquePanel = false;
    for (const obj of objects) {
      if (!obj || obj.id === options.skipId || (options.onlyText && obj.type !== 'text') ||
          (obj.type !== 'text' && obj.type !== 'image')) continue;
      participants++;
      hasOpaquePanel ||= obj.type === 'text' && [obj.x, obj.y, obj.w, obj.h].every(Number.isFinite) &&
        obj.w > 0 && obj.h > 0;
      if (participants > 1 && hasOpaquePanel) break;
    }
    // Image-only boards and single-object passes need no coverage grid. A
    // missing entry means visible to the renderer, just like a disabled plan.
    if (participants < 2 || !hasOpaquePanel) return plan;
    const scale = finite(options.zoom, 1) * finite(options.dpr, 1);
    if (!viewport || !(scale > 0) || !Number.isFinite(scale) ||
        ![viewport.x1, viewport.y1, viewport.x2, viewport.y2].every(Number.isFinite) ||
        !(viewport.x2 > viewport.x1 && viewport.y2 > viewport.y1)) return plan;
    const width = (viewport.x2 - viewport.x1) * scale;
    const height = (viewport.y2 - viewport.y1) * scale;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return plan;
    const coverage = createCoverage(width, height);
    const radius = Math.max(0, finite(style.radius, 16));
    const padding = Math.max(0, finite(style.padding, 16));
    const fontSize = Math.max(0, finite(style.fontSize, 16));
    const shadowReach = Math.max(0, finite(style.shadowBlur, 24)) * 2;
    const shadowX = finite(style.shadowOffsetX, 0);
    const shadowY = finite(style.shadowOffsetY, 8);
    const outline = Math.max(0, finite(style.outlineWidth, 1));
    const toScreen = rect => ({
      x1: (rect.x1 - viewport.x1) * scale,
      y1: (rect.y1 - viewport.y1) * scale,
      x2: (rect.x2 - viewport.x1) * scale,
      y2: (rect.y2 - viewport.y1) * scale,
    });

    for (let index = objects.length - 1; index >= 0; index--) {
      const obj = objects[index];
      if (!obj || obj.id === options.skipId || (options.onlyText && obj.type !== 'text')) continue;
      if (![obj.x, obj.y, obj.w, obj.h].every(Number.isFinite) || !(obj.w > 0 && obj.h > 0)) continue;
      const worldBody = { x1: obj.x, y1: obj.y, x2: obj.x + obj.w, y2: obj.y + obj.h };
      if (![worldBody.x2, worldBody.y2].every(Number.isFinite)) continue;
      const body = toScreen(worldBody);
      if (obj.type === 'image') {
        const rotation = finite(obj.data?.rotation, 0);
        const sideways = Math.abs(rotation) % 180 === 90;
        const drawW = sideways ? obj.h : obj.w, drawH = sideways ? obj.w : obj.h;
        const angle = rotation * Math.PI / 180;
        const cosine = Math.abs(Math.cos(angle)), sine = Math.abs(Math.sin(angle));
        const halfW = (drawW * cosine + drawH * sine) / 2;
        const halfH = (drawW * sine + drawH * cosine) / 2;
        const centerX = obj.x + obj.w / 2, centerY = obj.y + obj.h / 2;
        // The renderer rotates the local one-device-pixel image overdraw too.
        const imageBounds = toScreen({ x1: centerX - halfW, y1: centerY - halfH,
          x2: centerX + halfW, y2: centerY + halfH });
        const hidden = coverage.contains(expanded(imageBounds, cosine + sine));
        plan.set(obj, { hidden, textHidden: false, bodyHidden: hidden, shadowHidden: hidden });
        continue;
      }
      if (obj.type !== 'text') continue;

      const visualBounds = typeof style.bounds === 'function' ? style.bounds(obj) : {
        x1: worldBody.x1 + Math.min(-outline, shadowX - shadowReach),
        y1: worldBody.y1 + Math.min(-outline, shadowY - shadowReach),
        x2: worldBody.x2 + Math.max(outline, shadowX + shadowReach),
        y2: worldBody.y2 + Math.max(outline, shadowY + shadowReach),
      };
      const validVisualBounds = visualBounds && [visualBounds.x1, visualBounds.y1, visualBounds.x2, visualBounds.y2].every(Number.isFinite) &&
        visualBounds.x2 >= visualBounds.x1 && visualBounds.y2 >= visualBounds.y1;
      const shadowHidden = validVisualBounds ? coverage.contains(expanded(toScreen(visualBounds), 2)) : false;
      const bodyHidden = coverage.contains(expanded(body, 2));
      // ASCII's ink fits well within the existing 16px layout padding. Keep
      // half that padding as an overhang guard, and do not infer a glyph bound
      // for very narrow boxes or legacy Unicode fallback fonts.
      let textHidden = false;
      if (obj.w >= padding * 2 + fontSize && obj.h >= padding * 2 + fontSize && isAsciiText(obj)) {
        const inset = padding / 2;
        textHidden = coverage.contains(expanded(toScreen({
          x1: worldBody.x1 + inset, y1: worldBody.y1 + inset,
          x2: worldBody.x2 - inset, y2: worldBody.y2 - inset,
        }), 1));
      }
      plan.set(obj, { hidden: shadowHidden && textHidden, textHidden, bodyHidden, shadowHidden });
      // A body already covered by front panels adds no opaque area. Keeping it
      // out also preserves useful front shapes in the bounded exact cache.
      if (!bodyHidden && style.opaque !== false) {
        coverage.add({ ...body, radius: Math.min(radius, obj.w / 2, obj.h / 2) * scale });
      }
    }
    return plan;
  }

  const api = Object.freeze({ createPlan });
  root.BoardfishPanelVisibility = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
