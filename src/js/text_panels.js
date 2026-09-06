'use strict';

(function initTextPanels(root) {
  const DEFAULT_STYLE = Object.freeze({
    radius: 16, borderWidth: 1, fill: '#42414d', border: '#70707a', text: '#fbfbfe',
    shadowColor: 'rgba(0,0,0,0.1)', shadowBlur: 24, shadowOffsetX: 0, shadowOffsetY: 8,
    outlineColor: 'rgba(0,0,0,0.3)', outlineWidth: 1, padding: 16, fontSize: 16,
  });
  let currentStyle = null;
  const length = (value, fallback) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;

  function shadowParts(value) {
    return String(value || '').split(/,(?![^()]*\))/).map(part => {
      const color = part.match(/rgba?\([^)]*\)|#[\da-f]+|transparent/i)?.[0];
      const values = part.replace(color || '', '').match(/-?(?:\d*\.)?\d+(?:px)?/g)?.map(Number.parseFloat) || [];
      return { color, x: values[0] || 0, y: values[1] || 0, blur: values[2] || 0, spread: values[3] || 0 };
    });
  }

  function refreshStyle() {
    const menu = root.document?.getElementById?.('ctx-menu');
    const css = menu && typeof root.getComputedStyle === 'function' ? root.getComputedStyle(menu) : null;
    if (!css) return currentStyle = DEFAULT_STYLE;
    const shadows = shadowParts(css.boxShadow), shadow = shadows.find(value => value.blur > 0);
    const outline = shadows.find(value => !value.blur && !value.x && !value.y && value.spread > 0);
    currentStyle = Object.freeze({
      ...DEFAULT_STYLE,
      radius: Math.max(0, length(css.borderTopLeftRadius, DEFAULT_STYLE.radius)),
      borderWidth: Math.max(0, length(css.borderTopWidth, DEFAULT_STYLE.borderWidth)),
      fill: css.backgroundColor || DEFAULT_STYLE.fill, border: css.borderTopColor || DEFAULT_STYLE.border,
      text: css.color || DEFAULT_STYLE.text,
      shadowColor: shadow?.color || 'transparent', shadowBlur: shadow?.blur || 0,
      shadowOffsetX: shadow?.x || 0, shadowOffsetY: shadow?.y || 0,
      outlineColor: outline?.color || 'transparent', outlineWidth: outline?.spread || 0,
    });
    return currentStyle;
  }
  function getStyle() { return currentStyle || refreshStyle(); }
  function valid(obj) { return obj && [obj.x, obj.y, obj.w, obj.h].every(Number.isFinite) && obj.w > 0 && obj.h > 0; }
  function radius(obj, style) { return Math.max(0, Math.min(style.radius, obj.w / 2, obj.h / 2)); }

  function visualBounds(obj, style = getStyle()) {
    const blur = style.shadowBlur * 2, outline = style.outlineWidth;
    return {
      x1: obj.x + Math.min(-outline, style.shadowOffsetX - blur),
      y1: obj.y + Math.min(-outline, style.shadowOffsetY - blur),
      x2: obj.x + obj.w + Math.max(outline, style.shadowOffsetX + blur),
      y2: obj.y + obj.h + Math.max(outline, style.shadowOffsetY + blur),
    };
  }
  function intersectsViewport(obj, viewport, style = getStyle()) {
    if (!viewport) return true;
    const bounds = visualBounds(obj, style);
    return bounds.x1 <= viewport.x2 && bounds.x2 >= viewport.x1 && bounds.y1 <= viewport.y2 && bounds.y2 >= viewport.y1;
  }
  function containsPoint(obj, x, y, style = getStyle()) {
    if (!valid(obj) || x < obj.x || x > obj.x + obj.w || y < obj.y || y > obj.y + obj.h) return false;
    const r = radius(obj, style);
    if (!r) return true;
    const qx = Math.max(0, Math.abs(x - obj.x - obj.w / 2) - (obj.w / 2 - r)) / r;
    const qy = Math.max(0, Math.abs(y - obj.y - obj.h / 2) - (obj.h / 2 - r)) / r;
    return qx ** 4 + qy ** 4 <= 1;
  }

  function path(context, x, y, w, h, cornerRadius, density = 1) {
    const r = Math.max(0, Math.min(cornerRadius, w / 2, h / 2));
    context.beginPath();
    if (!r) { context.rect(x, y, w, h); return; }
    // The fallback traces the same fourth-power superellipse as the GPU.
    // Subdivision follows screen density, without rasterizing the text itself.
    const steps = Math.min(512, Math.max(16, Math.ceil(Math.sqrt(r * density) * 4)));
    context.moveTo(x + w - r, y);
    const corners = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0],
      [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
    for (const [cx, cy, start] of corners) for (let i = 0; i <= steps; i++) {
      const angle = start + Math.PI / 2 * i / steps, c = Math.cos(angle), s = Math.sin(angle);
      context.lineTo(cx + r * Math.sign(c) * Math.sqrt(Math.abs(c)), cy + r * Math.sign(s) * Math.sqrt(Math.abs(s)));
    }
    context.closePath();
  }

  function draw(context, obj, style = getStyle(), options = {}) {
    if (!valid(obj)) return false;
    if (context.drawTextPanel) return context.drawTextPanel(obj, style, options);
    if (!context.beginPath || !context.lineTo || !context.fill || !context.save) return false;
    const phase = options.phase || 'all', transform = context.getTransform?.();
    const density = transform ? Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d)) : 1;
    const r = radius(obj, style), border = Math.min(style.borderWidth, obj.w / 2, obj.h / 2);
    context.save();
    try {
      if (phase !== 'body') {
        // Canvas shadows ignore the transform for offsets/blur, unlike the
        // object geometry, so convert those lengths to device pixels here.
        context.shadowColor = style.shadowColor; context.shadowBlur = style.shadowBlur * density;
        context.shadowOffsetX = style.shadowOffsetX * density; context.shadowOffsetY = style.shadowOffsetY * density;
        path(context, obj.x, obj.y, obj.w, obj.h, r, density);
        context.fillStyle = style.fill; context.fill();
        context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetX = context.shadowOffsetY = 0;
        const spread = style.outlineWidth;
        if (spread > 0) {
          path(context, obj.x - spread, obj.y - spread, obj.w + spread * 2, obj.h + spread * 2, r + spread, density);
          context.fillStyle = style.outlineColor; context.fill();
        }
      }
      if (phase !== 'shadow') {
        path(context, obj.x, obj.y, obj.w, obj.h, r, density);
        context.fillStyle = style.border; context.fill();
        if (obj.w > border * 2 && obj.h > border * 2) {
          path(context, obj.x + border, obj.y + border, obj.w - border * 2, obj.h - border * 2, Math.max(0, r - border), density);
          context.fillStyle = style.fill; context.fill();
        }
      }
    } finally { context.restore(); }
    return true;
  }

  const api = Object.freeze({ DEFAULT_STYLE, getStyle, refreshStyle, visualBounds, intersectsViewport, containsPoint, draw });
  root.BoardfishTextPanels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
