'use strict';

(function initTextRaster(root) {
  const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
  const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;
  const RASTER_PADDING = 2;
  const TILE_GUTTER = 2;
  const MIN_RASTER_SCALE = 1 / 8;
  const RASTER_CONTEXT_DEFAULTS = Object.entries({
    textBaseline: 'alphabetic', textAlign: 'left', direction: 'ltr',
    fontKerning: 'none', fontStretch: 'normal', fontVariantCaps: 'normal',
    letterSpacing: '0px', wordSpacing: '0px', globalAlpha: 1,
    globalCompositeOperation: 'source-over', filter: 'none',
    shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
  });

  const positiveLimit = (value, fallback) => Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;

  function rasterStyle(context) {
    if (!context || typeof context.getTransform !== 'function' || typeof context.drawImage !== 'function') return null;
    if (typeof context.font !== 'string' || !context.font || typeof context.fillStyle !== 'string' || !context.fillStyle) return null;
    for (const [name, value] of RASTER_CONTEXT_DEFAULTS) {
      const actual = context[name];
      if (actual !== undefined && actual !== value) return null;
    }
    if (context.shadowColor !== undefined &&
        !['transparent', 'rgba(0, 0, 0, 0)', '#00000000'].includes(context.shadowColor)) return null;
    let transform;
    try { transform = context.getTransform(); } catch (_) { return null; }
    if (!transform || ![transform.a, transform.b, transform.c, transform.d, transform.e, transform.f].every(Number.isFinite)) return null;
    if (transform.a <= 0 || transform.b !== 0 || transform.c !== 0 ||
        Math.abs(transform.a - transform.d) > transform.a * 1e-10) return null;
    // Round upward so zooming out reuses readable pixels and zooming in never
    // stretches a raster whose density is lower than the destination density.
    const exponent = Math.ceil(Math.log2(transform.a) * 2);
    const bucketScale = exponent % 2 === 0
      ? 2 ** (exponent / 2)
      : Math.SQRT2 * 2 ** Math.floor(exponent / 2);
    const scale = Math.max(MIN_RASTER_SCALE, bucketScale);
    if (!Number.isFinite(scale)) return null;
    return { font: context.font, fillStyle: context.fillStyle, scale };
  }

  function createTextRasterCache(options = {}) {
    const createCanvas = options.createCanvas || (() => {
      if (typeof root.OffscreenCanvas === 'function' &&
          typeof root.OffscreenCanvas.prototype.transferToImageBitmap === 'function') {
        return new root.OffscreenCanvas(1, 1);
      }
      return root.document.createElement('canvas');
    });
    const maxBytes = positiveLimit(options.maxBytes, DEFAULT_MAX_BYTES);
    const maxEntries = positiveLimit(options.maxEntries, 2048);
    const maxLineBytes = positiveLimit(options.maxLineBytes, DEFAULT_MAX_LINE_BYTES);
    const maxDimension = positiveLimit(options.maxDimension, 4096);
    const plans = new WeakMap();
    const entries = new Map();
    let bytes = 0;
    let frame = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const totals = { hits: 0, misses: 0, evictions: 0, fallbacks: 0, drawCalls: 0, rasterizedDrawCalls: 0 };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */

    const disposeCanvas = (canvas) => {
      try { canvas.width = 0; } catch (_) {}
      try { canvas.height = 0; } catch (_) {}
    };

    const disposeTile = (tile) => {
      if (tile.source && tile.source !== tile.canvas) {
        try { tile.source.close(); } catch (_) {}
      }
      if (tile.canvas) disposeCanvas(tile.canvas);
    };

    function removeEntry(entry, evicted = false) {
      entries.delete(entry);
      bytes -= entry.bytes;
      const variants = plans.get(entry.plan);
      variants?.delete(entry.key);
      if (variants && !variants.size) plans.delete(entry.plan);
      for (const tile of entry.tiles) disposeTile(tile);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (evicted) totals.evictions++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }

    function clear() {
      for (const entry of entries.keys()) removeEntry(entry);
    }

    function beginFrame() {
      frame++;
    }

    function draw(context, plan, x, baselineY, bounds) {
      const fallback = () => {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        totals.fallbacks++;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return null;
      };
      if (!Array.isArray(plan) || !plan.length || !Number.isFinite(x) || !Number.isFinite(baselineY)) return fallback();
      const style = rasterStyle(context);
      if (!style || !bounds || ![bounds.left, bounds.right, bounds.ascent, bounds.descent].every(Number.isFinite)) return fallback();
      if (bounds.right <= bounds.left || bounds.ascent < 0 || bounds.descent < 0 || !maxEntries) return fallback();
      const { scale } = style;
      const left = Math.floor(bounds.left * scale) - RASTER_PADDING;
      const right = Math.ceil(bounds.right * scale) + RASTER_PADDING;
      const top = Math.floor(-bounds.ascent * scale) - RASTER_PADDING;
      const bottom = Math.ceil(bounds.descent * scale) + RASTER_PADDING;
      const width = right - left;
      const height = bottom - top;
      const tileCoreWidth = maxDimension - 2 * TILE_GUTTER;
      if (![left, right, top, bottom, width, height].every(Number.isSafeInteger) ||
          width <= 0 || height <= 0 || height > maxDimension || tileCoreWidth <= 0) return fallback();
      const tileCount = Math.ceil(width / tileCoreWidth);
      const entryBytes = (width + tileCount * 2 * TILE_GUTTER) * height * 4;
      if (!Number.isSafeInteger(entryBytes) || entryBytes > maxLineBytes || entryBytes > maxBytes) return fallback();
      const key = JSON.stringify([style.font, style.fillStyle, scale, left, right, top, bottom]);
      let variants = plans.get(plan);
      let entry = variants?.get(key);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const cacheHit = !!entry;
      let rasterizedDrawCalls = 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (entry) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        totals.hits++;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        entry.lastFrame = frame;
        entries.delete(entry);
        entries.set(entry, true);
      } else {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        totals.misses++;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        // Reserve memory before allocating, including all tile gutters.
        while (entries.size && (entries.size >= maxEntries || bytes + entryBytes > maxBytes)) {
          const oldest = entries.keys().next().value;
          // LRU order groups entries touched in this frame at the end. Once
          // the oldest is protected, every remaining entry is protected too.
          // The caller draws this over-budget line directly, retaining useful
          // pixels instead of rebuilding the entire cache on each long scan.
          if (frame && oldest.lastFrame === frame) return fallback();
          removeEntry(oldest, true);
        }
        const tiles = [];
        try {
          for (let offset = 0; offset < width; offset += tileCoreWidth) {
            const coreWidth = Math.min(tileCoreWidth, width - offset);
            const canvas = createCanvas();
            if (!canvas) throw new Error('No text raster canvas');
            const tile = { canvas, source: canvas, offset, coreWidth };
            tiles.push(tile);
            canvas.width = coreWidth + 2 * TILE_GUTTER;
            canvas.height = height;
            // Retain CPU-backed source pixels so readback/export destinations
            // never force an individual GPU readback for every line bitmap.
            const target = canvas.getContext('2d', { willReadFrequently: true });
            if (!target) throw new Error('No text raster context');
            target.font = style.font;
            target.fillStyle = style.fillStyle;
            target.textAlign = 'left';
            target.direction = 'ltr';
            target.fontKerning = 'none';
            target.fontStretch = 'normal';
            target.fontVariantCaps = 'normal';
            target.setTransform(scale, 0, 0, scale, TILE_GUTTER - left - offset, -top);
            // Optional measured ink extents avoid repainting glyphs that cannot
            // touch this tile. This only constructs complete line tiles; it is
            // independent of the viewport. Unmeasured plans remain exact by
            // submitting every glyph and letting the canvas clip the overhangs.
            for (const glyph of plan) {
              if (Number.isFinite(glyph.inkLeft) && Number.isFinite(glyph.inkRight) &&
                  (glyph.inkRight * scale < left + offset - TILE_GUTTER ||
                   glyph.inkLeft * scale > left + offset + coreWidth + TILE_GUTTER)) continue;
              target.fillText(glyph.text, glyph.x, 0);
              /* BOARDFISH_DEV_DIAGNOSTICS_START */
              rasterizedDrawCalls++;
              /* BOARDFISH_DEV_DIAGNOSTICS_END */
            }
            if (typeof canvas.transferToImageBitmap === 'function') {
              const bitmap = canvas.transferToImageBitmap();
              if (!bitmap) throw new Error('No text raster bitmap');
              tile.source = bitmap;
              tile.canvas = null;
              disposeCanvas(canvas);
            }
          }
        } catch (_) {
          for (const tile of tiles) disposeTile(tile);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          totals.rasterizedDrawCalls += rasterizedDrawCalls;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          return fallback();
        }
        entry = { plan, key, tiles, bytes: entryBytes, lastFrame: frame };
        variants = plans.get(plan);
        if (!variants) plans.set(plan, variants = new Map());
        variants.set(key, entry);
        entries.set(entry, true);
        bytes += entryBytes;
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        totals.rasterizedDrawCalls += rasterizedDrawCalls;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }

      const oldSmoothing = context.imageSmoothingEnabled;
      const oldQuality = context.imageSmoothingQuality;
      try {
        context.imageSmoothingEnabled = true;
        // Density is already at least the destination resolution (at most a
        // sqrt(2) reduction). Bilinear sampling suffices for these text tiles;
        // photo-oriented high-quality resampling is costly for many small rows.
        context.imageSmoothingQuality = 'low';
        for (const tile of entry.tiles) {
          context.drawImage(tile.source, TILE_GUTTER, 0, tile.coreWidth, height,
            x + (left + tile.offset) / scale, baselineY + top / scale,
            tile.coreWidth / scale, height / scale);
        }
      } finally {
        context.imageSmoothingEnabled = oldSmoothing;
        context.imageSmoothingQuality = oldQuality;
      }
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') return true;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      totals.drawCalls += entry.tiles.length;
      return { cacheHit, drawCalls: entry.tiles.length, rasterizedDrawCalls };
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }

    const cache = { draw, clear, beginFrame };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      cache.getStats = () => ({ ...totals, bytes, entries: entries.size });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return cache;
  }

  const api = { createTextRasterCache };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BoardfishTextRaster = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
