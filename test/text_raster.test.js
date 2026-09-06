'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextRasterCache } = require('../src/js/text_raster.js');

const plan = () => [{ text: 'f', x: 0 }, { text: 'tt', x: 7 }, { text: 'g', x: 20 }];
const bounds = { left: -2, right: 30, ascent: 13, descent: 5 };

function fixture(options = {}) {
  const canvases = [];
  const fills = [];
  const blits = [];
  const transforms = [];
  const context = {
    font: "normal 400 16px 'Geist Sans', system-ui",
    fillStyle: '#000000', textBaseline: 'alphabetic', textAlign: 'left', direction: 'ltr',
    fontKerning: 'none', fontStretch: 'normal', fontVariantCaps: 'normal',
    letterSpacing: '0px', wordSpacing: '0px', globalAlpha: 1,
    globalCompositeOperation: 'source-over', filter: 'none',
    shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
    matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    getTransform() { return { ...this.matrix }; },
    drawImage(...args) { blits.push(args); },
    fillText() { assert.fail('The display context must only receive raster blits'); },
  };
  const createCanvas = () => {
    const canvas = { width: 0, height: 0, getContext() { return this.context; } };
    canvas.context = {
      setTransform(...args) { transforms.push(args); },
      fillText(...args) { fills.push(args); },
    };
    canvases.push(canvas);
    return canvas;
  };
  const cache = createTextRasterCache({ createCanvas, ...options });
  return { cache, context, canvases, fills, blits, transforms };
}

test('a warm line blits retained pixels without repainting glyphs', () => {
  const f = fixture();
  const line = plan();
  assert.deepEqual(f.cache.draw(f.context, line, 16, 32, bounds), {
    cacheHit: false, drawCalls: 1, rasterizedDrawCalls: 3,
  });
  assert.deepEqual(f.fills, [['f', 0, 0], ['tt', 7, 0], ['g', 20, 0]]);
  assert.deepEqual(f.cache.draw(f.context, line, 16, 32, bounds), {
    cacheHit: true, drawCalls: 1, rasterizedDrawCalls: 0,
  });
  assert.equal(f.fills.length, 3);
  assert.equal(f.blits.length, 2);
  assert.equal(f.canvases.length, 1);
  assert.equal(f.cache.getStats().hits, 1);
  assert.equal(f.cache.getStats().misses, 1);
});

test('local raster ink bounds include left overhang, ascent, and descenders', () => {
  const f = fixture();
  f.cache.draw(f.context, plan(), 100, 200, bounds);
  const [canvas, sourceX, sourceY, sourceW, sourceH, destX, destY, destW, destH] = f.blits[0];
  assert.equal(canvas.width, 40); // 36 ink/padding pixels plus two tile gutters.
  assert.equal(canvas.height, 22);
  assert.deepEqual([sourceX, sourceY, sourceW, sourceH], [2, 0, 36, 22]);
  assert.deepEqual([destX, destY, destW, destH], [96, 185, 36, 22]);
  assert.deepEqual(f.transforms[0], [1, 0, 0, 1, 6, 15]);
  assert.equal(f.cache.getStats().bytes, 40 * 22 * 4);
});

test('moving objects and panning reuse raster content while changing destination positions', () => {
  const f = fixture();
  const line = plan();
  f.cache.draw(f.context, line, 16, 32, bounds);
  f.context.matrix.e = 400;
  f.context.matrix.f = -100;
  assert.equal(f.cache.draw(f.context, line, 500, 800, bounds).cacheHit, true);
  assert.equal(f.blits[1][5] - f.blits[0][5], 484);
  assert.equal(f.blits[1][6] - f.blits[0][6], 768);
  assert.equal(f.fills.length, 3);
});

test('density buckets rasterize synchronously on zoom-in and reuse pixels within a bucket', () => {
  const f = fixture();
  const line = plan();
  f.context.matrix.a = f.context.matrix.d = 0.01;
  f.cache.draw(f.context, line, 0, 0, bounds);
  assert.equal(f.transforms[0][0], 1 / 8);
  f.context.matrix.a = f.context.matrix.d = 0.1;
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, true);
  f.context.matrix.a = f.context.matrix.d = 1.1;
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, false);
  assert.equal(f.transforms[1][0], Math.SQRT2);
  f.context.matrix.a = f.context.matrix.d = 1.3;
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, true);
  f.context.matrix.a = f.context.matrix.d = 2.1;
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, false);
  assert.ok(f.transforms[2][0] >= 2.1);
  assert.equal(f.fills.length, 9);
});

test('measured glyph extents limit tile construction to overlapping ink while retaining edge overhangs', () => {
  const f = fixture({ maxDimension: 64 });
  const line = [
    { text: 'f', x: 0, inkLeft: -2, inkRight: 8 },
    { text: 't', x: 58, inkLeft: 58, inkRight: 64 },
    { text: 'g', x: 130, inkLeft: 130, inkRight: 140 },
  ];
  const result = f.cache.draw(f.context, line, 0, 0, { ...bounds, right: 140 });
  assert.deepEqual(result, { cacheHit: false, drawCalls: 3, rasterizedDrawCalls: 4 });
  assert.deepEqual(f.fills.map((draw) => draw[0]), ['f', 't', 't', 'g']);
});

test('font, color, plan identity, and ink changes cannot reuse stale pixels', () => {
  const f = fixture();
  const line = plan();
  f.cache.draw(f.context, line, 0, 0, bounds);
  f.context.fillStyle = '#ffffff';
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, false);
  assert.equal(f.canvases[1].context.fillStyle, '#ffffff');
  f.context.font = 'normal 400 20px serif';
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, false);
  assert.equal(f.canvases[2].context.font, 'normal 400 20px serif');
  assert.equal(f.cache.draw(f.context, plan(), 0, 0, bounds).cacheHit, false);
  assert.equal(f.cache.draw(f.context, line, 0, 0, { ...bounds, right: 60 }).cacheHit, false);
  f.cache.clear();
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, false);
});

test('horizontal tiles cover the entire line with contiguous destination rectangles and gutters', () => {
  const f = fixture({ maxDimension: 64 });
  const line = plan();
  const wide = { ...bounds, right: 140 };
  assert.deepEqual(f.cache.draw(f.context, line, 16, 32, wide), {
    cacheHit: false, drawCalls: 3, rasterizedDrawCalls: 9,
  });
  assert.ok(f.canvases.every((canvas) => canvas.width <= 64 && canvas.height <= 64));
  assert.deepEqual(f.blits.map((args) => args[3]), [60, 60, 26]);
  for (let i = 1; i < f.blits.length; i++) {
    assert.equal(f.blits[i][5], f.blits[i - 1][5] + f.blits[i - 1][7]);
  }
  assert.equal(f.cache.getStats().bytes, f.canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0));
  assert.deepEqual(f.cache.draw(f.context, line, 100, 32, wide), {
    cacheHit: true, drawCalls: 3, rasterizedDrawCalls: 0,
  });
  assert.equal(f.fills.length, 9);
});

test('entry and byte limits evict least recently used lines and release canvas backing stores', () => {
  const f = fixture({ maxEntries: 2, maxBytes: 7040 });
  const first = plan(), second = plan(), third = plan();
  f.cache.draw(f.context, first, 0, 0, bounds);
  f.cache.draw(f.context, second, 0, 0, bounds);
  f.cache.draw(f.context, first, 0, 0, bounds);
  f.cache.draw(f.context, third, 0, 0, bounds);
  assert.equal(f.canvases[1].width, 0);
  assert.equal(f.canvases[1].height, 0);
  assert.notEqual(f.canvases[0].width, 0);
  assert.equal(f.cache.getStats().entries, 2);
  assert.equal(f.cache.getStats().bytes, 7040);
  assert.equal(f.cache.getStats().evictions, 1);
  assert.equal(f.cache.draw(f.context, second, 0, 0, bounds).cacheHit, false);
  f.cache.clear();
  assert.equal(f.cache.getStats().entries, 0);
  assert.equal(f.cache.getStats().bytes, 0);
  assert.ok(f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test('frame protection retains a useful subset across repeated scans larger than cache capacity', () => {
  for (const options of [{ maxEntries: 2 }, { maxBytes: 7040 }]) {
    const f = fixture(options);
    const lines = [plan(), plan(), plan()];
    f.cache.beginFrame();
    const first = lines.map((line) => f.cache.draw(f.context, line, 0, 0, bounds));
    assert.deepEqual(first.map((result) => result?.cacheHit ?? null), [false, false, null]);
    assert.equal(f.fills.length, 6);
    f.cache.beginFrame();
    const second = lines.map((line) => f.cache.draw(f.context, line, 0, 0, bounds));
    assert.deepEqual(second.map((result) => result?.cacheHit ?? null), [true, true, null]);
    assert.equal(f.fills.length, 6);
    assert.equal(f.canvases.length, 2);
    assert.equal(f.cache.getStats().evictions, 0);
    assert.equal(f.cache.getStats().entries, 2);
  }
});

test('frame protection allows stale lines to be evicted when the visible working set changes', () => {
  const f = fixture({ maxEntries: 2 });
  const first = plan(), second = plan(), third = plan();
  f.cache.beginFrame();
  f.cache.draw(f.context, first, 0, 0, bounds);
  f.cache.draw(f.context, second, 0, 0, bounds);
  f.cache.beginFrame();
  assert.equal(f.cache.draw(f.context, second, 0, 0, bounds).cacheHit, true);
  assert.equal(f.cache.draw(f.context, third, 0, 0, bounds).cacheHit, false);
  assert.equal(f.canvases[0].width, 0);
  assert.notEqual(f.canvases[1].width, 0);
  assert.equal(f.cache.getStats().evictions, 1);
  assert.equal(f.cache.draw(f.context, first, 0, 0, bounds), null);
  f.cache.beginFrame();
  assert.equal(f.cache.draw(f.context, first, 0, 0, bounds).cacheHit, false);
});

test('per-line budgets, excessive heights, and disabled caches fall back before allocating', () => {
  for (const [options, ink] of [
    [{ maxLineBytes: 1000 }, bounds],
    [{ maxBytes: 1000 }, bounds],
    [{ maxEntries: 0 }, bounds],
    [{ maxDimension: 16 }, bounds],
    [{}, { ...bounds, right: Number.MAX_SAFE_INTEGER }],
  ]) {
    const f = fixture(options);
    assert.equal(f.cache.draw(f.context, plan(), 0, 0, ink), null);
    assert.equal(f.canvases.length, 0);
    assert.equal(f.blits.length, 0);
    assert.equal(f.cache.getStats().bytes, 0);
  }
});

test('unsupported canvas transforms and paint states preserve the direct-draw fallback', () => {
  const mutations = [
    (c) => { c.matrix.b = 0.1; },
    (c) => { c.matrix.d = 2; },
    (c) => { c.matrix.a = c.matrix.d = -1; },
    (c) => { c.matrix.a = c.matrix.d = Infinity; },
    (c) => { c.textBaseline = 'top'; },
    (c) => { c.textAlign = 'center'; },
    (c) => { c.direction = 'rtl'; },
    (c) => { c.fillStyle = {}; },
    (c) => { c.fontKerning = 'normal'; },
    (c) => { c.letterSpacing = '1px'; },
    (c) => { c.globalAlpha = 0.5; },
    (c) => { c.globalCompositeOperation = 'copy'; },
    (c) => { c.filter = 'blur(2px)'; },
    (c) => { c.shadowColor = '#000000'; },
    (c) => { c.getTransform = undefined; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.context);
    assert.equal(f.cache.draw(f.context, plan(), 0, 0, bounds), null);
    assert.equal(f.canvases.length, 0);
    assert.equal(f.blits.length, 0);
  }
});

test('failed allocation or painting disposes partial tiles and leaves no stale cache entries', () => {
  for (const failAt of ['create', 'context', 'paint']) {
    let calls = 0;
    const allocated = [];
    const f = fixture({ maxDimension: 64, createCanvas() {
      calls++;
      if (calls === 2 && failAt === 'create') throw new Error('allocation failed');
      const canvas = { width: 0, height: 0, getContext() {
        if (calls === 2 && failAt === 'context') return null;
        return { setTransform() {}, fillText() {
          if (calls === 2 && failAt === 'paint') throw new Error('painting failed');
        } };
      } };
      allocated.push(canvas);
      return canvas;
    } });
    assert.equal(f.cache.draw(f.context, plan(), 0, 0, { ...bounds, right: 140 }), null);
    assert.equal(f.blits.length, 0);
    assert.equal(f.cache.getStats().bytes, 0);
    assert.equal(f.cache.getStats().entries, 0);
    assert.ok(allocated.every((canvas) => canvas.width === 0 && canvas.height === 0));
  }
});

test('raster blits restore canvas smoothing settings even when the destination throws', () => {
  const f = fixture();
  const before = { ...f.context };
  f.cache.draw(f.context, plan(), 0, 0, bounds);
  assert.deepEqual(f.context, before);
  f.context.drawImage = () => { throw new Error('destination lost'); };
  assert.throws(() => f.cache.draw(f.context, plan(), 0, 0, bounds), /destination lost/);
  assert.equal(f.context.imageSmoothingEnabled, false);
  assert.equal(f.context.imageSmoothingQuality, 'low');
});

test('synchronous bitmap transfer retains immutable tile sources and releases staging canvases', () => {
  const staging = [];
  const bitmaps = [];
  let paints = 0;
  const f = fixture({ maxEntries: 1, createCanvas() {
    const canvas = {
      width: 0, height: 0,
      getContext(type, options) {
        assert.equal(type, '2d');
        assert.deepEqual(options, { willReadFrequently: true });
        return { setTransform() {}, fillText() { paints++; } };
      },
      transferToImageBitmap() {
        const bitmap = { width: this.width, height: this.height, closed: false, close() { this.closed = true; } };
        bitmaps.push(bitmap);
        return bitmap;
      },
    };
    staging.push(canvas);
    return canvas;
  } });
  const line = plan();
  assert.equal(f.cache.draw(f.context, line, 0, 0, bounds).cacheHit, false);
  assert.equal(staging[0].width, 0);
  assert.equal(staging[0].height, 0);
  assert.equal(f.blits[0][0], bitmaps[0]);
  assert.equal(f.cache.getStats().bytes, bitmaps[0].width * bitmaps[0].height * 4);
  assert.equal(f.cache.draw(f.context, line, 100, 200, bounds).cacheHit, true);
  assert.equal(f.blits[1][0], bitmaps[0]);
  assert.equal(paints, 3);
  f.cache.draw(f.context, plan(), 0, 0, bounds);
  assert.equal(bitmaps[0].closed, true);
  assert.equal(bitmaps[1].closed, false);
  f.cache.clear();
  assert.equal(bitmaps[1].closed, true);
  assert.equal(f.cache.getStats().bytes, 0);
});

test('failed bitmap transfer cleans up completed bitmaps and remaining staging canvases', () => {
  const staging = [];
  const bitmaps = [];
  const f = fixture({ maxDimension: 64, createCanvas() {
    const canvas = {
      width: 0, height: 0,
      getContext() { return { setTransform() {}, fillText() {} }; },
      transferToImageBitmap() {
        if (staging.length === 2) throw new Error('transfer failed');
        const bitmap = { closed: false, close() { this.closed = true; } };
        bitmaps.push(bitmap);
        return bitmap;
      },
    };
    staging.push(canvas);
    return canvas;
  } });
  assert.equal(f.cache.draw(f.context, plan(), 0, 0, { ...bounds, right: 140 }), null);
  assert.equal(bitmaps.length, 1);
  assert.equal(bitmaps[0].closed, true);
  assert.ok(staging.every((canvas) => canvas.width === 0 && canvas.height === 0));
  assert.equal(f.blits.length, 0);
  assert.equal(f.cache.getStats().entries, 0);
  assert.equal(f.cache.getStats().bytes, 0);
});
