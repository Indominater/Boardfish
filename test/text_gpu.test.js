'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextGpuRenderer } = require('../src/js/text_gpu.js');

function fixture(options = {}) {
  const calls = { uploads: [], draws: [], copies: [], deleted: [], uniforms: [], sizes: [] };
  let nextId = 1;
  const gl = {};
  for (const key of ['MAX_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'VERTEX_SHADER', 'FRAGMENT_SHADER',
    'COMPILE_STATUS', 'LINK_STATUS', 'TEXTURE0', 'TEXTURE_2D', 'UNPACK_FLIP_Y_WEBGL',
    'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'UNPACK_COLORSPACE_CONVERSION_WEBGL', 'TEXTURE_MIN_FILTER',
    'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE',
    'RGBA', 'UNSIGNED_BYTE', 'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'DEPTH_TEST', 'CULL_FACE',
    'ARRAY_BUFFER', 'STATIC_DRAW', 'COLOR_BUFFER_BIT', 'FLOAT', 'TRIANGLES']) gl[key] = nextId++;
  gl.NONE = gl.NO_ERROR = 0;
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'bindVertexArray',
    'enableVertexAttribArray', 'vertexAttribDivisor', 'activeTexture', 'bindTexture', 'pixelStorei',
    'texParameteri', 'texImage2D', 'useProgram', 'uniform1i', 'uniform1f', 'uniform4fv',
    'enable', 'blendFunc', 'disable', 'clearColor', 'deleteShader', 'deleteTexture',
    'deleteVertexArray', 'deleteProgram', 'vertexAttribPointer', 'clear', 'viewport']) gl[name] = () => {};
  for (const name of ['createShader', 'createProgram', 'createVertexArray', 'createTexture', 'createBuffer']) gl[name] = () => ({ id: nextId++ });
  gl.getParameter = () => options.maxDimension || 2048;
  gl.getShaderParameter = () => !options.shaderFailure;
  gl.getProgramParameter = () => true;
  gl.getShaderInfoLog = () => 'test shader failure';
  gl.getUniformLocation = (_program, name) => name;
  gl.getError = () => 0;
  gl.isContextLost = () => false;
  gl.bindBuffer = (_target, buffer) => { gl.buffer = buffer; };
  gl.bufferData = (_target, data) => calls.uploads.push({ buffer: gl.buffer, data: [...data] });
  gl.deleteBuffer = (buffer) => calls.deleted.push(buffer);
  gl.drawArraysInstanced = (_kind, _start, _vertices, count) => calls.draws.push({ buffer: gl.buffer, count });
  gl.uniform2f = (name, x, y) => calls.uniforms.push({ name, x, y });
  const listeners = new Map();
  let width = 1, height = 1;
  const canvas = {
    get width() { return width; }, set width(value) { width = value; calls.sizes.push(['width', value]); },
    get height() { return height; }, set height(value) { height = value; calls.sizes.push(['height', value]); },
    getContext: () => gl,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  const atlasData = {
    atlas: { width: 128, height: 128, distanceRange: 8, yOrigin: 'bottom' },
    glyphs: Array.from({ length: 95 }, (_, i) => ({ unicode: i + 32, advance: 0.5,
      ...(i ? { planeBounds: { left: -0.1, right: 0.6, top: 0.8, bottom: -0.2 },
        atlasBounds: { left: 0, right: 16, top: 32, bottom: 16 } } : {}),
    })),
  };
  const atlasImage = { width: 128, height: 128 };
  const context = {
    canvas: { width: 800, height: 600 }, fillStyle: '#123456',
    font: "normal 400 16px 'Geist Sans', system-ui",
    matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    getTransform() { return { ...this.matrix }; },
    save() { this.saved = { ...this.matrix }; },
    restore() { this.matrix = this.saved; },
    setTransform(a, b, c, d, e, f) { this.matrix = { a, b, c, d, e, f }; },
    drawImage(...args) { calls.copies.push(args); },
  };
  const renderer = createTextGpuRenderer({ createCanvas: () => canvas, atlasData, atlasImage, ...options });
  return { renderer, calls, gl, canvas, context, listeners };
}

function line(text, row = 0) {
  const prefixWidths = new Float64Array(text.length + 1);
  for (let i = 1; i < prefixWidths.length; i++) prefixWidths[i] = prefixWidths[i - 1] + (text[i - 1] === '\t' ? 32 : 8);
  return { text, prefixWidths, y: 16 + row * 24, textY: 32 + row * 24 };
}
const object = { x: 0, y: 0, w: 800, data: { content: 'ASCII' } };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test('batches multiple rows and composites exactly once using premultiplied GPU text', async () => {
  const f = fixture();
  assert.equal(await f.renderer.ready, true);
  const stats = f.renderer.draw(f.context, [line('ab'), line('cd', 1)], object);
  assert.equal(stats.drawCalls, 1);
  assert.equal(stats.batches, 1);
  assert.equal(stats.glyphs, 4);
  assert.equal(f.calls.uploads.length, 1);
  assert.equal(f.calls.copies.length, 1);
  assert.deepEqual(f.context.matrix, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
});

test('geometry preserves advances, ink overhang, baseline offsets, and bottom-origin atlas UVs', async () => {
  const f = fixture(); await f.renderer.ready;
  f.renderer.draw(f.context, [line('a\tb'), line('c', 1)], object);
  const data = f.calls.uploads[0].data;
  close(data[0], -1.6); close(data[1], -12.8); close(data[2], 11.2); close(data[3], 16);
  assert.deepEqual(data.slice(4, 8), [0, 0.75, 0.125, 0.875]);
  close(data[8], 38.4); // 8px letter + 32px tab, then the next glyph's overhang.
  close(data[17], 11.2); // Second row baseline is exactly 24px below the first.
  assert.equal(f.calls.draws[0].count, 3);
});

test('warm pan, zoom, object movement, and theme changes retain buffers without scanning characters', async () => {
  const f = fixture(); await f.renderer.ready;
  const rows = [line('abc'), line('def', 1)];
  f.renderer.draw(f.context, rows, object);
  const before = f.calls.uploads.length;
  const previous = String.prototype.charCodeAt;
  let scans = 0;
  String.prototype.charCodeAt = function (...args) { scans++; return previous.apply(this, args); };
  let stats;
  try {
    f.context.matrix = { a: 2, b: 0, c: 0, d: 2, e: 0.25, f: -0.75 };
    const moved = rows.map((row) => ({ ...row, y: row.y + 100, textY: row.textY + 100 }));
    stats = f.renderer.draw(f.context, moved, { ...object, x: 25, y: 100 }, { color: 'rgba(255, 128, 0, 0.5)' });
  } finally { String.prototype.charCodeAt = previous; }
  assert.equal(stats.cacheHits, 1);
  assert.equal(stats.uploadedBytes, 0);
  assert.equal(f.calls.uploads.length, before);
  assert.equal(scans, 0);
});

test('one-row vertical navigation retains complete interior row bands', async () => {
  const f = fixture({ bandLines: 2 }); await f.renderer.ready;
  const rows = Array.from({ length: 6 }, (_, i) => line('abcd', i));
  f.renderer.beginFrame();
  f.renderer.draw(f.context, rows.slice(0, 5), object);
  assert.equal(f.calls.uploads.length, 3);
  f.renderer.beginFrame();
  f.context.matrix.f = -24;
  const stats = f.renderer.draw(f.context, rows.slice(1, 6), object);
  assert.equal(stats.cacheHits, 1);
  assert.equal(stats.cacheMisses, 2);
  assert.equal(f.calls.uploads.length, 5);
});

test('all requested glyphs are submitted even beyond horizontal framebuffer edges', async () => {
  const f = fixture(); await f.renderer.ready;
  f.context.canvas.width = 100;
  const stats = f.renderer.draw(f.context, [line('a'.repeat(200))], object);
  assert.equal(stats.glyphs, 200);
  assert.equal(f.calls.draws[0].count, 200);
  assert.ok(f.canvas.width <= 100);
  assert.equal(f.calls.copies.length, 1);
});

test('scratch framebuffer grows and reuses allocation across different box sizes and fractional pans', async () => {
  const f = fixture(); await f.renderer.ready;
  const rows = [line('a'.repeat(20))];
  f.renderer.draw(f.context, rows, object);
  const allocations = f.calls.sizes.length;
  for (let i = 1; i <= 4; i++) {
    f.context.matrix.e = i / 4;
    f.renderer.draw(f.context, i % 2 ? [line('abc')] : rows, object);
  }
  assert.equal(f.calls.sizes.length, allocations);
});

test('unsupported content and canvas state fall back before any compositing', async () => {
  const f = fixture(); await f.renderer.ready;
  assert.equal(f.renderer.draw(f.context, [line('abc'), line('caf\u00e9', 1)], object), null);
  assert.equal(f.calls.uploads.length, 0);
  f.context.globalAlpha = 0.5;
  assert.equal(f.renderer.draw(f.context, [line('abc')], object), null);
  delete f.context.globalAlpha;
  f.context.fillStyle = { gradient: true };
  assert.equal(f.renderer.draw(f.context, [line('abc')], object), null);
  assert.equal(f.calls.copies.length, 0);
});

test('the entire call falls back when geometry exceeds its byte budget', async () => {
  const f = fixture({ maxBytes: 32 }); await f.renderer.ready;
  assert.equal(f.renderer.draw(f.context, [line('ab')], object), null);
  assert.equal(f.renderer.getStats().bytes, 0);
  assert.equal(f.calls.uploads.length, 0);
  assert.equal(f.calls.copies.length, 0);
});

test('frame protection prevents cross-object cache scan thrash at capacity', async () => {
  const f = fixture({ maxBytes: 64 }); await f.renderer.ready;
  const first = [line('ab')], second = [line('cd')];
  for (let i = 0; i < 3; i++) {
    f.renderer.beginFrame();
    assert.ok(f.renderer.draw(f.context, first, object));
    assert.equal(f.renderer.draw(f.context, second, object), null);
  }
  assert.equal(f.calls.uploads.length, 1);
  assert.equal(f.calls.deleted.length, 0);
  assert.equal(f.renderer.getStats().bytes, 64);
});

test('LRU eviction and explicit clearing release GPU buffer resources', async () => {
  const f = fixture({ maxBytes: 32 }); await f.renderer.ready;
  f.renderer.draw(f.context, [line('a')], object);
  f.renderer.draw(f.context, [line('b')], object);
  assert.equal(f.calls.deleted.length, 1);
  assert.equal(f.renderer.getStats().entries, 1);
  f.renderer.clear();
  assert.equal(f.calls.deleted.length, 2);
  assert.equal(f.renderer.getStats().bytes, 0);
});

test('context loss falls back, restoration rebuilds atlas and buffers, and disposal is final', async () => {
  let readyCalls = 0;
  const f = fixture({ onReady: () => readyCalls++ }); await f.renderer.ready;
  const rows = [line('ab')];
  f.renderer.draw(f.context, rows, object);
  let prevented = false;
  f.listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.renderer.getStats().bytes, 0);
  assert.equal(f.renderer.draw(f.context, rows, object), null);
  f.listeners.get('webglcontextrestored')();
  assert.equal(f.renderer.draw(f.context, rows, object).uploadedBytes, 64);
  assert.equal(readyCalls, 3);
  f.renderer.dispose();
  assert.equal(f.renderer.getStats().disposed, true);
  assert.equal(f.renderer.getStats().bytes, 0);
  assert.equal(f.renderer.getStats().atlasBytes, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.renderer.draw(f.context, rows, object), null);
});

test('shader initialization failures resolve readiness false and preserve direct fallback', async () => {
  const f = fixture({ shaderFailure: true });
  assert.equal(await f.renderer.ready, false);
  assert.match(f.renderer.getStats().error, /shader failure/);
  assert.equal(f.renderer.draw(f.context, [line('a')], object), null);
  assert.equal(f.calls.copies.length, 0);
});

test('a framebuffer larger than device limits falls back instead of dropping pixels', async () => {
  const f = fixture({ maxDimension: 128 }); await f.renderer.ready;
  assert.equal(f.renderer.draw(f.context, [line('a'.repeat(50))], object), null);
  assert.equal(f.calls.copies.length, 0);
});

test('scratch surface byte limit constrains bucket growth and clear releases its backing store', async () => {
  const f = fixture({ maxSurfaceBytes: 4000 }); await f.renderer.ready;
  assert.ok(f.renderer.draw(f.context, [line('a'.repeat(5))], object));
  assert.ok(f.renderer.getStats().surfaceBytes <= 4000);
  assert.ok(f.renderer.getStats().surfaceBytes > 4);
  f.renderer.clear();
  assert.equal(f.renderer.getStats().surfaceBytes, 4);
  assert.equal(f.renderer.getStats().bytes, 0);
  assert.equal(f.renderer.isReady(), true);
});

test('active rectangles exceeding scratch byte limit fall back without compositing', async () => {
  const f = fixture({ maxSurfaceBytes: 64 }); await f.renderer.ready;
  assert.equal(f.renderer.draw(f.context, [line('abc')], object), null);
  assert.equal(f.calls.copies.length, 0);
  assert.ok(f.renderer.getStats().surfaceBytes <= 64);
});

test('atlas load failure closes an owned image even when metadata fails first', async () => {
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  let closed = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('.json')) throw new Error('metadata missing');
    return { ok: true, blob: async () => ({}) };
  };
  globalThis.createImageBitmap = async () => ({ width: 128, height: 128, close() { closed++; } });
  try {
    const f = fixture({ atlasData: null, atlasImage: null, assetBase: 'https://example.com/fonts/' });
    assert.equal(await f.renderer.ready, false);
    assert.match(f.renderer.getStats().error, /metadata missing/);
    assert.equal(closed, 1);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('cold allocation validates GL once for all batches and warm draws never synchronize on getError', async () => {
  const f = fixture({ chunkGlyphs: 2 }); await f.renderer.ready;
  let errorChecks = 0;
  f.gl.getError = () => { errorChecks++; return 0; };
  const rows = [line('abcdef')];
  assert.equal(f.renderer.draw(f.context, rows, object).batches, 3);
  assert.equal(errorChecks, 1);
  f.renderer.draw(f.context, rows, object);
  assert.equal(errorChecks, 1);
});

test('failed cold GPU allocations release all new buffers before falling back', async () => {
  const f = fixture({ chunkGlyphs: 2 }); await f.renderer.ready;
  f.gl.getError = () => 1285; // OUT_OF_MEMORY can be reported after bufferData returns.
  assert.equal(f.renderer.draw(f.context, [line('abcdef')], object), null);
  assert.equal(f.calls.deleted.length, 3);
  assert.equal(f.renderer.getStats().bytes, 0);
  assert.equal(f.calls.copies.length, 0);
});
