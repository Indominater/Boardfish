'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContext } = require('../src/js/gpu_renderer.js');

function fixture(options = {}) {
  let next = 0;
  const calls = [], events = new Map(), rasterDraws = [], rasterSourcesAtDraw = [], rasterReadbacks = [];
  const constants = new Map();
  const gl = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === 'getParameter') return () => options.maxTextureSize || 4096;
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => !options.shaderError;
      if (name === 'getShaderInfoLog') return () => 'synthetic compile failure';
      if (name === 'getUniformLocation') return (_, key) => key;
      if (name === 'getExtension') return extension => {
        calls.push({ name, args: [extension] });
        return options.extensions?.includes(extension) ? {} : null;
      };
      if (name === 'checkFramebufferStatus') return (...args) => {
        calls.push({ name, args });
        return options.framebufferError ? gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT : gl.FRAMEBUFFER_COMPLETE;
      };
      if (/^create/.test(name)) return () => ({ id: ++next });
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!constants.has(name)) constants.set(name, constants.size + 1);
        return constants.get(name);
      }
      return (...args) => { calls.push({ name, args }); };
    },
  });
  const canvas = {
    width: 800, height: 600,
    getContext(kind) { return kind === 'webgl2' ? gl : null; },
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name) { events.delete(name); },
  };
  const glyphs = new Array(128).fill(null);
  for (let code = 33; code < 127; code++) glyphs[code] = {
    planeBounds: { left: -.05, bottom: -.2, right: .7, top: .9 },
    atlasBounds: { left: 0, bottom: 0, right: 24, top: 32 },
  };
  glyphs[32] = { advance: .25 };
  const font = { width: 128, height: 128, distanceRange: 8, glyphs, atlasURL: 'font.png' };
  if (options.withLargeFont) font.largeFont = { ...font, distanceRange: 4, atlasURL: 'large.png' };
  const integralFont = options.withIntegralFont ? {
    type: 'summed-area', width: 128, height: 128, atlasURL: 'integral.png',
    cellSize: 8, columns: 16, emSize: 4, originX: -.5, originY: -1.25,
  } : undefined;
  const createCanvas = () => {
    const value = { width: 0, height: 0 };
    const context = {
      fillStyle: '#000000',
      measureText(text) { return { width: text.length * 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }; },
      setTransform() {}, fillText(...args) { rasterDraws.push(args); },
      drawImage(...args) { rasterDraws.push(args);rasterSourcesAtDraw.push({ source:args[0],width:args[0].width,height:args[0].height }); }, fillRect() {}, clearRect() {},
      getImageData(...args) {
        rasterReadbacks.push(args);
        return { data: options.rasterPixels || new Uint8ClampedArray(args[2] * args[3] * 4).fill(255) };
      },
    };
    value.getContext = () => context;
    return value;
  };
  const errors = [];
  const context = createContext(canvas, {
    font, integralFont, createCanvas, loadImage: () => ({ width: 128, height: 128 }),
    onError: error => errors.push(error), ...options,
  });
  return { context, canvas, gl, calls, events, font, errors, rasterDraws, rasterSourcesAtDraw, rasterReadbacks };
}
function line(text, row, obj, prefix = null) {
  return {
    text, prefixWidths: prefix || Array.from({ length: text.length + 1 }, (_, i) => i * 8),
    y: obj.y + 16 + row * 24, textY: obj.y + 16 + row * 24 + 16.392,
  };
}
const object = () => ({ id: 'obj-1', type: 'text', x: 20, y: 30 });
const callsNamed = (f, name) => f.calls.filter(call => call.name === name);
const quadSize = f => callsNamed(f, 'uniform2f').filter(call => call.args[0] === 'size').at(-1).args.slice(1);

// Reconstruct externally observable GL state at each submission. This catches
// blend/framebuffer leaks into the next object as well as missing mask passes.
function renderStates(f) {
  let framebuffer = null, blend = null, scissor = null, program = null;
  const enabled = new Set(), uniforms = new Map(), states = [];
  for (const { name, args } of f.calls) {
    if (name === 'bindFramebuffer') framebuffer = args[1];
    else if (name === 'blendFunc') blend = args;
    else if (name === 'scissor') scissor = args;
    else if (name === 'enable') enabled.add(args[0]);
    else if (name === 'disable') enabled.delete(args[0]);
    else if (name === 'useProgram') {
      program = args[0];
      if (!uniforms.has(program)) uniforms.set(program, {});
    } else if (name.startsWith('uniform')) {
      uniforms.get(program)[args[0]] = name === 'uniformMatrix3fv' ? args[2] : name.endsWith('fv') ? args[1] : args.slice(1);
    } else if (name === 'drawArrays' || name === 'drawArraysInstanced' || name === 'clear') {
      states.push({ name, args, framebuffer, blend, scissor, enabled: new Set(enabled), uniforms: { ...uniforms.get(program) } });
    }
  }
  return states;
}

test('font initialization resolves failure, and shader failure is a clean nullable factory result', async () => {
  const failed = fixture({ loadImage: () => Promise.reject(new Error('missing atlas')) });
  assert.equal(await failed.context.ready, false);
  assert.equal(failed.context.fontReady, false);
  assert.equal(failed.errors.length, 1);
  assert.equal(failed.context.drawTextLayout([], object()), false);
  failed.context.dispose();
  const shader = fixture({ shaderError: true });
  assert.equal(shader.context, null);
  assert.equal(shader.errors.length, 1);
  assert.equal(shader.events.size, 0);
});

test('retained chunks survive new viewport arrays, panning, zooming, and object movement without uploads', async () => {
  const f = fixture();await f.context.ready;
  const obj = object(), rows = [line('A B\tC', 3, obj), line('DEF', 4, obj)];
  f.context.beginFrame([obj]);
  assert.equal(f.context.drawTextLayout(rows, obj), true);
  f.context.endFrame();
  const original = f.context.getStats();
  assert.equal(original.bufferUploads, 1);
  assert.equal(original.glyphsDrawn, 6);
  assert.ok(Math.abs(callsNamed(f, 'bufferData')[0].args[1][1] - (3 * 24 + 16.392)) < 1e-5);
  f.context.setTransform(1.31, 0, 0, 1.31, -13.3, 45.7);
  obj.x += 12.125;obj.y -= 40.75;
  for (const row of rows) { row.y -= 40.75;row.textY -= 40.75; }
  f.context.beginFrame([obj]);f.context.drawTextLayout(rows.slice(), obj);f.context.endFrame();
  const warm = f.context.getStats();
  assert.equal(warm.frameBufferUploads, 0);
  assert.equal(warm.bufferUploads, 1);
  assert.equal(warm.atlasUploads, 1);
  assert.equal(warm.frameDrawCalls, 1);
});

test('progressive rows retain absolute chunk alignment and draw only the requested contiguous rows', async () => {
  const f = fixture();await f.context.ready;const obj = object();
  const rows = [line('AB', 62, obj), line('CD', 63, obj), line('EF', 64, obj)];
  f.context.drawTextLayout(rows, obj);
  assert.equal(f.context.getStats().chunkCount, 2);
  const uploads = f.context.getStats().bufferUploads;
  f.context.beginFrame([obj]);f.context.drawTextLayout(rows.slice(1), obj);
  assert.equal(f.context.getStats().bufferUploads, uploads);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 4);
  const next = line('GH', 65, obj);
  f.context.beginFrame([obj]);f.context.drawTextLayout([rows[2], next], obj);
  assert.equal(f.context.getStats().frameBufferUploads, 1);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 4);
});

test('changed text, changed prefix metrics, and reused object IDs invalidate geometry', async () => {
  const f = fixture();await f.context.ready;const obj = object();
  f.context.drawTextLayout([line('AB', 0, obj)], obj);
  const replacement = { ...obj };
  f.context.drawTextLayout([line('AC', 0, replacement, [0, 9, 17])], replacement);
  assert.equal(f.context.getStats().bufferUploads, 2);
  assert.deepEqual(Array.from(callsNamed(f, 'bufferData').at(-1).args[1]).filter((_, i) => i % 3 === 0), [0, 9]);
  assert.equal(f.context.getStats().chunkCount, 1);
  f.context.beginFrame([]);
  assert.equal(f.context.getStats().chunkCount, 0);
  assert.equal(f.context.getStats().bufferBytes, 0);
});

test('preparation creates resources without drawing and the buffer budget evicts old chunks', async () => {
  const f = fixture({ maxBufferBytes: 24 });await f.context.ready;const obj = object();
  assert.equal(f.context.prepareTextLayout([line('AB', 0, obj)], obj), true);
  assert.equal(f.context.getStats().drawCalls, 0);
  f.context.prepareTextLayout([line('CD', 64, obj)], obj);
  assert.equal(f.context.getStats().bufferBytes, 24);
  assert.equal(f.context.getStats().chunkCount, 1);
  assert.equal(f.context.prepareTextLayout([line('ABC', 128, obj)], obj), false);
  f.context.resetResources();
  assert.equal(f.context.getStats().bufferBytes, 0);
});

test('world-origin cancellation happens in CPU doubles for text and image/selection quads', async () => {
  const f = fixture();await f.context.ready;
  const obj = { ...object(), x: 1e10 + .125, y: -1e10 + .25 };
  f.context.setTransform(2, 0, 0, 2, -2e10, 2e10);
  f.context.drawTextLayout([line('A', 0, obj)], obj);
  let matrix = callsNamed(f, 'uniformMatrix3fv').at(-1).args[2];
  assert.equal(matrix[6], 32.25);assert.equal(matrix[7], 32.5);
  f.context.fillRect(obj.x, obj.y, 2, 24);
  matrix = callsNamed(f, 'uniformMatrix3fv').at(-1).args[2];
  assert.equal(matrix[6], .25);assert.equal(matrix[7], .5);
  assert.deepEqual(quadSize(f), [2, 24]);
});

test('images, rectangles, and text preserve submission order and image textures stay resident', async () => {
  const f = fixture();await f.context.ready;const obj = object();
  const image = { width: 200, height: 100 };
  f.context.drawImage(image, 0, 0);
  f.context.fillStyle = '#12345680';f.context.fillRect(1, 2, 3, 4);
  f.context.drawTextLayout([line('A', 0, obj)], obj);
  f.context.drawImage(image, 20, 10, 100, 50, 4, 5, 200, 100);
  assert.deepEqual(f.calls.filter(call => call.name === 'drawArrays' || call.name === 'drawArraysInstanced').map(call => call.name), ['drawArrays', 'drawArrays', 'drawArraysInstanced', 'drawArrays']);
  assert.equal(f.context.getStats().imageUploads, 1);
  const sourceRect = callsNamed(f, 'uniform4fv').filter(call => call.args[0] === 'sourceRect').at(-1).args[1];
  assert.deepEqual(sourceRect, [.1, .1, .5, .5]);
  f.context.save();f.context.translate(3, 4);f.context.scale(-1, 1);f.context.rotate(Math.PI / 2);f.context.restore();
  assert.deepEqual(f.context.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true });
});

test('large images are tiled at native resolution with filtering gutters and a bounded cache', async () => {
  const f = fixture({ maxTextureSize: 256, maxImageBytes: 300000 });await f.context.ready;
  const image = { width: 600, height: 300 };
  f.context.drawImage(image, 0, 0, 1200, 600);
  assert.equal(f.context.getStats().imageDrawCalls, 6);
  assert.ok(f.context.getStats().imageBytes <= 300000);
  const tiles = callsNamed(f, 'texImage2D').slice(2).map(call => call.args.at(-1));
  assert.ok(tiles.every(tile => tile.width <= 256 && tile.height <= 256));
  assert.ok(f.rasterDraws.some(args => args[1] === 253 && args[3] === 256));
});

test('an 8192px image displayed at 2048px stays resident instead of reuploading native tiles on every pan', async () => {
  const f = fixture();await f.context.ready;
  const image = { width: 8192, height: 8192 };
  for (const [index, zoom] of [.25, .24, .2, .25].entries()) {
    const before = f.context.getStats();
    f.context.beginFrame([]);
    f.context.setTransform(zoom, 0, 0, zoom, index * .125, -index * .25);
    f.context.drawImage(image, 0, 0);
    f.context.endFrame();
    const after = f.context.getStats();
    assert.equal(after.imageUploads - before.imageUploads, index === 0 ? 1 : 0);
    assert.equal(after.imageDrawCalls - before.imageDrawCalls, 1);
    assert.equal(after.imageBytes, 2048 * 2048 * 4);
    assert.equal(after.imageEvictions, 0);
  }
  assert.equal(f.context.getStats().imageUploadBytes, 2048 * 2048 * 4);
});

test('quarter and full source transitions reuse retained display resolutions around the zoom boundary', async () => {
  const f = fixture();await f.context.ready;
  const full = { width: 4096, height: 2048 }, quarter = { width: 1024, height: 512 };
  // Representative source selections around the existing active-input cutoff:
  // the quarter bitmap is sufficient below it, and the full bitmap is selected above it.
  for (const [index, zoom] of [.69, .71, .695, .705, .69, .71].entries()) {
    const before = f.context.getStats();
    f.context.setTransform(zoom, 0, 0, zoom, index, -index);
    f.context.drawImage(zoom < .7 ? quarter : full, 0, 0, 1728, 864);
    const after = f.context.getStats();
    assert.equal(after.imageUploads - before.imageUploads, index < 2 ? 1 : 0);
    assert.equal(after.imageDrawCalls - before.imageDrawCalls, 1);
  }
  assert.equal(f.context.getStats().imageBytes, (1024 * 512 + 2048 * 1024) * 4);
  assert.equal(f.context.getStats().imageCount, 2);
  assert.equal(f.context.getStats().imageEvictions, 0);
});

test('cropped image panning reuses a fixed downsampled tile grid and uploads only newly exposed tiles', async () => {
  const f = fixture();await f.context.ready;
  const image = { width: 16384, height: 1024 };
  const drawCrop = start => f.context.drawImage(image, start, 0, 4096, 1024, 10, 20, 1024, 256);
  drawCrop(0);
  assert.equal(f.context.getStats().imageUploads, 1);
  drawCrop(1024);
  assert.equal(f.context.getStats().imageUploads, 1);
  drawCrop(5000);
  assert.equal(f.context.getStats().imageUploads, 2);
  for (const start of [4999, 5001, 0, 1024]) drawCrop(start);
  assert.equal(f.context.getStats().imageUploads, 2);
  assert.equal(f.rasterDraws.length, 2);
  // Both tiles sample the same complete source on one global 4096px grid.
  assert.deepEqual(f.rasterDraws.map(args => args.slice(1).map(value => value + 0)), [
    [0, 0, 16384, 1024, 0, 0, 4096, 256],
    [0, 0, 16384, 1024, -2047, 0, 4096, 256],
  ]);
});

test('odd source dimensions preserve the complete image and crop endpoints after downsampling', async () => {
  const f = fixture();await f.context.ready;
  const image = { width: 1001, height: 501 };
  f.context.drawImage(image, 13, 17, 250.25, 125.25);
  const upload = callsNamed(f, 'texImage2D').at(-1).args.at(-1);
  assert.deepEqual([upload.width, upload.height], [251, 126]);
  const fullUv = callsNamed(f, 'uniform4fv').filter(call => call.args[0] === 'sourceRect').at(-1).args[1];
  assert.ok(fullUv.every((value, index) => Math.abs(value - [0, 0, 1, 1][index]) < 1e-12));
  const fullRect = quadSize(f);
  assert.ok(fullRect.every((value, index) => Math.abs(value - [250.25, 125.25][index]) < 1e-12));
  f.context.drawImage(image, 1, 1, 1000, 500, 23, 29, 250, 125);
  assert.equal(f.context.getStats().imageUploads, 1);
  const uv = callsNamed(f, 'uniform4fv').filter(call => call.args[0] === 'sourceRect').at(-1).args[1];
  assert.ok(Math.abs(uv[0] - 1 / 1001) < 1e-12);
  assert.ok(Math.abs(uv[1] - 1 / 501) < 1e-12);
  assert.ok(Math.abs(uv[0] + uv[2] - 1) < 1e-12);
  assert.ok(Math.abs(uv[1] + uv[3] - 1) < 1e-12);
  const cropRect = quadSize(f);
  assert.ok(cropRect.every((value, index) => Math.abs(value - [250, 125][index]) < 1e-12));
});

test('image resolution follows physical scale through flips, rotation, anisotropy, and shear', async () => {
  const f = fixture();await f.context.ready;
  const image = { width: 1024, height: 512 };
  f.context.setTransform(.25, 0, 0, .25, 0, 0);
  f.context.drawImage(image, 0, 0);
  assert.equal(f.context.getStats().imageBytes, 256 * 128 * 4);
  f.context.setTransform(0, -.25, -.25, 0, 10, -20);
  f.context.drawImage(image, 0, 0);
  assert.equal(f.context.getStats().imageUploads, 1);
  f.context.setTransform(.125, 0, 0, .4, 0, 0);
  f.context.drawImage(image, 0, 0);
  assert.equal(callsNamed(f, 'texImage2D').at(-1).args.at(-1).width, 512);
  // Each column length is below .5, but shear stretches diagonal detail above
  // .5. The renderer must retain native detail rather than choose a half level.
  f.context.setTransform(.4, 0, .25, .4, 0, 0);
  f.context.drawImage(image, 0, 0);
  assert.equal(callsNamed(f, 'texImage2D').at(-1).args.at(-1), image);
  assert.equal(f.context.getStats().imageUploads, 3);
});

test('nearest filtering keeps native pixels and mutable image sources refresh retained levels', async () => {
  const f = fixture();await f.context.ready;
  const image = { width: 1024, height: 512 };
  f.context.imageSmoothingEnabled = false;
  f.context.drawImage(image, 0, 0, 256, 128);
  assert.equal(callsNamed(f, 'texImage2D').at(-1).args.at(-1), image);
  f.context.imageSmoothingEnabled = true;
  const dynamic = { width: 1024, height: 512, getContext() {} };
  f.context.drawImage(dynamic, 0, 0, 256, 128);
  const first = f.context.getStats();
  f.context.drawImage(dynamic, 10, 20, 256, 128);
  const second = f.context.getStats();
  assert.equal(second.imageUploads, first.imageUploads + 1);
  assert.equal(second.imageBytes, first.imageBytes);
  assert.equal(second.textureCount, first.textureCount);
  assert.equal(callsNamed(f, 'texImage2D').at(-1).args.at(-1).width, 256);
});

test('image pyramid levels respect the cache budget and reset cleanly after context loss or source replacement', async () => {
  const f = fixture({ maxImageBytes: 400000 });await f.context.ready;
  const image = { width: 1024, height: 1024, src: 'first.png' };
  for (const edge of [64, 128, 256, 512]) {
    f.context.drawImage(image, 0, 0, edge, edge);
    assert.ok(f.context.getStats().imageBytes <= 400000);
  }
  assert.ok(f.context.getStats().imageEvictions > 0);
  f.context.drawImage(image, 0, 0, 64, 64);
  f.context.drawImage(image, 0, 0, 256, 256);
  assert.equal(f.context.getStats().textureCount, 2);
  image.src = 'replacement.png';
  f.context.drawImage(image, 0, 0, 64, 64);
  assert.equal(f.context.getStats().textureCount, 1);
  assert.equal(f.context.getStats().imageBytes, 64 * 64 * 4);
  f.events.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(f.context.getStats().imageBytes, 0);
  assert.equal(f.context.getStats().textureCount, 0);
  f.events.get('webglcontextrestored')();await f.context.ready;
  const before = f.context.getStats().imageUploads;
  f.context.drawImage(image, 0, 0, 64, 64);
  assert.equal(f.context.getStats().imageUploads, before + 1);
  f.context.resetResources();
  assert.equal(f.context.getStats().imageBytes, 0);
  assert.equal(f.context.getStats().textureCount, 0);
  assert.equal(f.context.getStats().imageCount, 0);
});

test('Unicode fallback retains exact-density raster textures and rebuilds only when density changes', async () => {
  const f = fixture();await f.context.ready;const obj = object();
  assert.equal(f.context.drawTextLayout([line('漢', 0, obj)], obj), false);
  f.context.fillText('漢', 20, 30);
  f.context.fillText('漢', 40, 50);
  assert.equal(f.context.getStats().fallbackRasterizations, 1);
  assert.equal(f.context.getStats().imageUploads, 1);
  f.context.setTransform(1.25, 0, 0, 1.25, 0, 0);
  f.context.fillText('漢', 20, 30);
  assert.equal(f.context.getStats().fallbackRasterizations, 2);
});

test('context restoration regenerates atlas and buffers, while disposal removes event handlers', async () => {
  let prevented = false;
  const f = fixture();await f.context.ready;const obj = object();
  f.context.drawTextLayout([line('AB', 0, obj)], obj);
  f.events.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.ok(prevented);assert.equal(f.context.fontReady, false);
  assert.equal(f.context.getStats().bufferBytes, 0);
  assert.equal(f.context.drawTextLayout([line('AB', 0, obj)], obj), false);
  f.events.get('webglcontextrestored')();await f.context.ready;
  assert.equal(f.context.getStats().atlasUploads, 2);
  f.context.drawTextLayout([line('AB', 0, obj)], obj);
  assert.equal(f.context.getStats().bufferUploads, 2);
  f.context.dispose();assert.equal(f.events.size, 0);
  assert.equal(f.context.getStats().bufferBytes, 0);
});

test('overlapping translucent selection rectangles fill their union once', async () => {
  const f = fixture();await f.context.ready;
  f.context.fillStyle = '#fff8';
  f.context.beginPath();f.context.rect(0, 0, 10, 20);f.context.rect(5, 0, 10, 20);f.context.fill();
  assert.equal(f.context.getStats().rectangleDrawCalls, 1);
  assert.deepEqual(quadSize(f), [15, 20]);
});

test('moving a baseline to a distant world origin does not invalidate retained geometry', async () => {
  const f = fixture();await f.context.ready;const obj = object();
  const row = line('H', 0, obj);f.context.drawTextLayout([row], obj);
  const offset = 1e7;obj.x += offset;obj.y += offset;row.y += offset;row.textY += offset;
  f.context.setTransform(1, 0, 0, 1, -offset, -offset);
  f.context.beginFrame([obj]);f.context.drawTextLayout([row], obj);
  assert.equal(f.context.getStats().frameBufferUploads, 0);
});

test('both prebuilt detail levels upload once and zoom changes only the selected font resources', async () => {
  const f = fixture({ withLargeFont: true });await f.context.ready;const obj = object();
  const rows = [line('H', 0, obj)];
  assert.equal(f.context.getStats().atlasUploads, 2);
  f.context.drawTextLayout(rows, obj);
  const near = callsNamed(f, 'uniform2f').filter(call => call.args[0] === 'unitRange').at(-1).args.slice(1);
  f.context.setTransform(100, 0, 0, 100, 0, 0);
  f.context.beginFrame([obj]);f.context.drawTextLayout(rows, obj);
  const far = callsNamed(f, 'uniform2f').filter(call => call.args[0] === 'unitRange').at(-1).args.slice(1);
  assert.deepEqual(near, [8 / 128, 8 / 128]);assert.deepEqual(far, [4 / 128, 4 / 128]);
  assert.equal(f.context.getStats().atlasUploads, 2);
  assert.equal(f.context.getStats().frameBufferUploads, 0);
  assert.equal(f.context.getStats().atlasBytes, 2 * (128 * 128 * 4 + 4096));
});

test('an over-budget multi-chunk draw falls back before aggregate GPU allocation exceeds its limit', async () => {
  const f = fixture({ maxBufferBytes: 36 });await f.context.ready;const obj = object();
  assert.equal(f.context.drawTextLayout([line('AB', 0, obj), line('CD', 64, obj)], obj), false);
  assert.ok(f.context.getStats().bufferBytes <= 36);
  assert.equal(f.context.getStats().bufferUploads, 1);
  assert.equal(f.context.getStats().drawCalls, 0);
  assert.equal(f.context.drawTextLayout([line('EF', 128, obj)], obj), true);
  assert.equal(f.context.getStats().bufferBytes, 24);
  assert.equal(f.context.getStats().chunkCount, 1);
});

test('empty glyph chunks obey a count limit even when their buffers contain zero bytes', async () => {
  const f = fixture({ maxChunks: 2 });await f.context.ready;const obj = object();
  assert.equal(f.context.prepareTextLayout([line(' ', 0, obj), line('\t', 64, obj), line('', 128, obj)], obj), false);
  assert.equal(f.context.getStats().chunkCount, 2);
  assert.equal(f.context.getStats().bufferBytes, 0);
  assert.equal(f.context.prepareTextLayout([line('', 128, obj)], obj), true);
  assert.equal(f.context.getStats().chunkCount, 2);
});

test('fallback eviction and text cache clearing release source pixels and their associated textures', async () => {
  const f = fixture({ maxFallbackBytes: 1500 });await f.context.ready;
  f.context.fillText('漢', 0, 0);
  const first = callsNamed(f, 'texImage2D').at(-1).args.at(-1);
  assert.ok(first.width > 0);assert.equal(f.context.getStats().imageCount, 1);
  f.context.fillText('字', 20, 0);
  const second = callsNamed(f, 'texImage2D').at(-1).args.at(-1);
  assert.equal(first.width, 0);assert.equal(first.height, 0);
  assert.ok(second.width > 0);
  assert.equal(f.context.getStats().imageCount, 1);
  assert.equal(f.context.getStats().textureCount, 1);
  assert.ok(f.context.getStats().fallbackBytes <= 1500);
  f.context.clearTextCache();
  assert.equal(second.width, 0);assert.equal(second.height, 0);
  assert.equal(f.context.getStats().imageCount, 0);
  assert.equal(f.context.getStats().textureCount, 0);
  assert.equal(f.context.getStats().fallbackBytes, 0);
  assert.equal(f.context.getStats().imageBytes, 0);
});

test('an oversized fallback source stays intact until every native-resolution tile has drawn', async () => {
  const f = fixture({ maxTextureSize: 256, maxFallbackBytes: 64 });await f.context.ready;
  f.context.fillText('漢'.repeat(75), 0, 0);
  assert.equal(f.context.getStats().imageDrawCalls, 3);
  assert.equal(f.rasterSourcesAtDraw.length, 3);
  assert.ok(f.rasterSourcesAtDraw.every(sample => sample.width === 604 && sample.height === 20));
  const source = f.rasterSourcesAtDraw[0].source;
  assert.equal(source.width, 0);assert.equal(source.height, 0);
  assert.equal(f.context.getStats().fallbackBytes, 0);
  assert.equal(f.context.getStats().imageBytes, 0);
  assert.equal(f.context.getStats().imageCount, 0);
  assert.equal(f.context.getStats().textureCount, 0);
});

test('three 100k-character textboxes reuse glyph buffers, integral atlas, and one mask throughout low-zoom panning', async () => {
  const f = fixture({ withIntegralFont: true });await f.context.ready;
  const objects = Array.from({ length: 3 }, (_, i) => ({ ...object(), id: `long-${i}`, x: 20 + i * 1500 }));
  const layouts = objects.map(obj => Array.from({ length: 200 }, (_, row) => line('H'.repeat(500), row, obj)));
  for (const [index, zoom] of [.1, .101, .099, .08, .12, .1].entries()) {
    const before = f.context.getStats();
    f.context.beginFrame(objects);
    f.context.setTransform(zoom, 0, 0, zoom, index * .137, -index * .219);
    for (const [i, obj] of objects.entries()) assert.equal(f.context.drawTextLayout(layouts[i].slice(), obj), true);
    f.context.endFrame();
    const after = f.context.getStats();
    assert.equal(after.frameGlyphsDrawn, 300000);
    assert.equal(after.frameBufferUploads, index === 0 ? 12 : 0);
    assert.equal(after.atlasUploads, 2);
    assert.equal(after.coverageTargetAllocations, 1);
    assert.equal(after.coverageComposites - before.coverageComposites, 3);
    assert.equal(after.frameDrawCalls, 15);
    assert.equal(after.coverageBytes, 800 * 600);
  }
  assert.equal(f.context.getStats().bufferBytes, 300000 * 12);
  assert.equal(f.context.getStats().fallbackRasterizations, 0);
  assert.equal(callsNamed(f, 'texImage2D').filter(call => call.args[2] === f.gl.R8).length, 1);
  f.context.dispose();
});

test('low-zoom glyphs add coverage across chunks before each textbox is composited once with its color and alpha', async () => {
  const f = fixture({ withIntegralFont: true });await f.context.ready;
  const obj = object(), other = { ...object(), id: 'other', x: 40 };
  f.context.setTransform(.1, 0, 0, .1, 0, 0);
  f.context.fillStyle = '#4080c080';f.context.globalAlpha = .5;
  f.context.drawTextLayout([line('AB', 0, obj), line('CD', 64, obj)], obj);
  f.context.drawTextLayout([line('EF', 0, other)], other);
  f.context.fillRect(0, 0, 2, 3);
  f.context.drawImage({ width: 16, height: 16 }, 0, 0);
  const states = renderStates(f);
  assert.deepEqual(states.map(state => state.name), [
    'clear', 'drawArraysInstanced', 'drawArraysInstanced', 'drawArrays',
    'clear', 'drawArraysInstanced', 'drawArrays', 'drawArrays', 'drawArrays',
  ]);
  const glyphs = states.filter(state => state.name === 'drawArraysInstanced');
  assert.ok(glyphs.every(state => state.framebuffer && state.enabled.has(f.gl.SCISSOR_TEST)));
  assert.ok(glyphs.every(state => state.enabled.has(f.gl.BLEND)));
  for (const glyph of glyphs) {
    assert.deepEqual(glyph.blend, [f.gl.ONE, f.gl.ONE]);
    assert.deepEqual(glyph.uniforms.color, [1, 1, 1, 1]);
    assert.deepEqual(glyph.uniforms.areaFiltered, [1]);
    assert.deepEqual(glyph.uniforms.pixelPadding, [.3125, .3125]);
  }
  const quads = states.filter(state => state.name === 'drawArrays');
  for (const quad of quads) {
    assert.equal(quad.framebuffer, null);
    assert.equal(quad.enabled.has(f.gl.SCISSOR_TEST), false);
    assert.deepEqual(quad.blend, [f.gl.ONE, f.gl.ONE_MINUS_SRC_ALPHA]);
  }
  for (const composite of quads.slice(0, 2)) {
    assert.deepEqual(composite.uniforms.coverageMask, [1]);
    assert.deepEqual(composite.uniforms.color, [64 / 255, 128 / 255, 192 / 255, 64 / 255]);
  }
  assert.ok(quads.slice(2).every(state => state.uniforms.coverageMask[0] === 0));
  assert.equal(f.context.getStats().coverageComposites, 2);
  f.context.dispose();
});

test('mask clears and composites are clipped to the textbox and never sample stale coverage outside the clear', async () => {
  const f = fixture({ withIntegralFont: true });await f.context.ready;
  const obj = object();
  f.context.setTransform(.1, 0, 0, .1, -4, -4);
  f.context.drawTextLayout([line('ABCD', 0, obj)], obj);
  const states = renderStates(f), clear = states.find(state => state.name === 'clear');
  const composite = states.find(state => state.name === 'drawArrays');
  assert.ok(clear.enabled.has(f.gl.SCISSOR_TEST));
  const [x, y, w, h] = clear.scissor;
  assert.equal(x, 0);
  assert.equal(y + h, f.canvas.height);
  assert.ok(w > 0 && h > 0 && w * h < 100);
  assert.deepEqual(composite.uniforms.size, [w, h]);
  assert.deepEqual(composite.uniforms.transform.slice(6, 8), [x, f.canvas.height - y - h]);
  assert.deepEqual(composite.uniforms.sourceRect, [x / 800, (y + h) / 600, w / 800, -h / 600]);
  assert.deepEqual(callsNamed(f, 'clearColor').at(-1).args, [0, 0, 0, 0]);
  const draws = f.context.getStats().drawCalls;
  f.context.setTransform(.1, 0, 0, .1, -10000, -10000);
  assert.equal(f.context.drawTextLayout([line('ABCD', 0, obj)], obj), true);
  assert.equal(f.context.getStats().drawCalls, draws);
  assert.equal(callsNamed(f, 'clear').length, 1);
  f.context.dispose();
});

test('the viewport-sized coverage target is replaced on resize and released on reset, context loss, and disposal', async () => {
  const f = fixture({ withIntegralFont: true });await f.context.ready;
  const obj = object(), rows = [line('AB', 0, obj)];
  f.context.setTransform(.1, 0, 0, .1, 0, 0);
  const draw = () => assert.equal(f.context.drawTextLayout(rows, obj), true);
  draw();draw();
  assert.equal(f.context.getStats().coverageTargetAllocations, 1);
  f.canvas.width = 1000;f.canvas.height = 700;
  draw();
  assert.equal(f.context.getStats().coverageTargetAllocations, 2);
  assert.equal(f.context.getStats().coverageBytes, 700000);
  assert.equal(callsNamed(f, 'deleteFramebuffer').length, 1);
  f.context.resetResources();
  assert.equal(f.context.getStats().coverageBytes, 0);
  assert.equal(callsNamed(f, 'deleteFramebuffer').length, 2);
  draw();
  f.events.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(f.context.getStats().coverageBytes, 0);
  assert.equal(callsNamed(f, 'deleteFramebuffer').length, 2);
  assert.equal(f.context.drawTextLayout(rows, obj), false);
  f.events.get('webglcontextrestored')();assert.equal(await f.context.ready, true);
  draw();
  assert.equal(f.context.getStats().coverageTargetAllocations, 4);
  assert.equal(f.context.getStats().atlasUploads, 4);
  f.context.dispose();
  assert.equal(f.context.getStats().coverageBytes, 0);
  assert.equal(callsNamed(f, 'deleteFramebuffer').length, 3);
  assert.equal(f.events.size, 0);
  f.context.dispose();
  assert.equal(callsNamed(f, 'deleteFramebuffer').length, 3);
});

test('normal-size and large MSDF text keep their detail levels with an additional integral atlas', async () => {
  for (const withLargeFont of [false, true]) {
    const f = fixture({ withIntegralFont: true, withLargeFont });await f.context.ready;
    const obj = object(), rows = [line('A', 0, obj)];
    for (const zoom of [.749, .75, 1, 100]) {
      const before = f.context.getStats();
      f.context.beginFrame([obj]);
      f.context.setTransform(zoom, 0, 0, zoom, 0, 0);
      assert.equal(f.context.drawTextLayout(rows, obj), true);
      const after = f.context.getStats();
      assert.equal(after.coverageComposites - before.coverageComposites, zoom < .75 ? 1 : 0);
      assert.equal(after.frameBufferUploads, zoom === .749 ? 1 : 0);
      const draw = renderStates(f).filter(state => state.name === 'drawArraysInstanced').at(-1);
      assert.deepEqual(draw.uniforms.unitRange, new Array(2).fill((withLargeFont && zoom === 100 ? 4 : 8) / 128));
      if (zoom >= .75) {
        assert.equal(draw.framebuffer, null);
        assert.deepEqual(draw.uniforms.areaFiltered, [0]);
        assert.deepEqual(draw.uniforms.pixelPadding, [0, 0]);
      }
    }
    assert.equal(f.context.getStats().atlasUploads, withLargeFont ? 3 : 2);
    assert.equal(f.context.getStats().atlasBytes, (withLargeFont ? 2 : 1) * (128 * 128 * 4 + 4096) + 128 * 128 * 4);
    f.context.dispose();
  }
});

test('incomplete or oversized coverage framebuffers fall back to drawable MSDF and leave the default framebuffer bound', async () => {
  for (const options of [{ framebufferError: true }, { maxTextureSize: 256 }]) {
    const f = fixture({ withIntegralFont: true, ...options });await f.context.ready;
    const obj = object(), rows = [line('ABC', 0, obj)];
    f.context.setTransform(.1, 0, 0, .1, 0, 0);
    assert.equal(f.context.drawTextLayout(rows, obj), true);
    const text = renderStates(f).filter(state => state.name === 'drawArraysInstanced');
    assert.equal(text.length, 1);
    assert.equal(text[0].args.at(-1), 3);
    assert.equal(text[0].framebuffer, null);
    assert.deepEqual(text[0].uniforms.areaFiltered, [0]);
    assert.deepEqual(text[0].blend, [f.gl.ONE, f.gl.ONE_MINUS_SRC_ALPHA]);
    assert.equal(f.context.getStats().coverageBytes, 0);
    assert.equal(f.context.getStats().coverageComposites, 0);
    assert.equal(f.context.getStats().frameGlyphsDrawn, 3);
    assert.equal(callsNamed(f, 'clear').length, 0);
    assert.equal(callsNamed(f, 'deleteFramebuffer').length, options.framebufferError ? 1 : 0);
    if (options.framebufferError) assert.equal(callsNamed(f, 'bindFramebuffer').at(-1).args[1], null);
    f.context.fillRect(0, 0, 10, 10);
    const rectangle = renderStates(f).at(-1);
    assert.equal(rectangle.framebuffer, null);
    assert.equal(rectangle.enabled.has(f.gl.SCISSOR_TEST), false);
    f.context.dispose();
  }
});

test('low-zoom distant origins and axis flips retain coverage while rotated or sheared text uses MSDF', async () => {
  const f = fixture({ withIntegralFont: true });await f.context.ready;
  const obj = { ...object(), x: 1e10 + .125, y: -1e10 + .25 }, rows = [line('AB', 0, obj)];
  const transforms = [
    [.1, 0, 0, .1, -1e9 + 30, 1e9 + 30],
    [-.1, 0, 0, -.2, 1e9 + 30, -2e9 + 30],
    [0, .1, -.1, 0, -1e9 + 30, -1e9 + 30],
    [.1, 0, .02, .1, -8e8 + 30, 1e9 + 30],
  ];
  for (const [index, transform] of transforms.entries()) {
    f.context.beginFrame([obj]);f.context.setTransform(...transform);
    const before = f.context.getStats();
    assert.equal(f.context.drawTextLayout(rows, obj), true);
    const after = f.context.getStats();
    assert.equal(after.coverageComposites - before.coverageComposites, index < 2 ? 1 : 0);
    assert.equal(after.frameBufferUploads, index === 0 ? 1 : 0);
    const draw = renderStates(f).filter(state => state.name === 'drawArraysInstanced').at(-1);
    assert.ok(draw.uniforms.transform.slice(6, 8).every(value => Number.isFinite(value) && Math.abs(value) < 100));
    if (index < 2) assert.ok(draw.uniforms.pixelPadding.every(value => value > 0));
  }
  f.context.dispose();
});

test('optional float extensions select precise coverage and integral resources independently without warm readbacks', async () => {
  const rasterPixels = new Uint8ClampedArray(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i++) {
    const value = i * 17;
    rasterPixels.set([value >> 16, (value >> 8) & 255, value & 255, 255], i * 4);
  }
  for (const extensions of [
    ['EXT_color_buffer_float'], ['OES_texture_float_linear'], ['EXT_color_buffer_float', 'OES_texture_float_linear'],
  ]) {
    const f = fixture({ withIntegralFont: true, extensions, rasterPixels });
    assert.equal(await f.context.ready, true);
    const floatingMask = extensions.includes('EXT_color_buffer_float');
    const floatingIntegral = extensions.includes('OES_texture_float_linear');
    const atlas = callsNamed(f, 'texImage2D').find(call => call.args[2] === f.gl.R32F);
    assert.equal(!!atlas, floatingIntegral);
    if (atlas) {
      assert.deepEqual(atlas.args.slice(3, 8), [128, 128, 0, f.gl.RED, f.gl.FLOAT]);
      assert.ok(atlas.args[8] instanceof Float32Array);
      for (const index of [0, 1, 1023, 16383]) assert.ok(Math.abs(atlas.args[8][index] - index * 17 / 255) < .0001);
    }
    const obj = object(), rows = [line('AB', 0, obj)];
    for (const [index, zoom] of [.1, .101, .3, .749].entries()) {
      f.context.beginFrame([obj]);
      f.context.setTransform(zoom, 0, 0, zoom, .123 * index, -.234 * index);
      f.context.drawTextLayout(rows, obj);
      assert.equal(f.context.getStats().frameBufferUploads, index === 0 ? 1 : 0);
      assert.equal(f.context.getStats().atlasUploads, 2);
    }
    const mask = callsNamed(f, 'texImage2D').find(call => call.args[2] === (floatingMask ? f.gl.R16F : f.gl.R8));
    assert.deepEqual(mask.args.slice(3), [800, 600, 0, f.gl.RED, floatingMask ? f.gl.HALF_FLOAT : f.gl.UNSIGNED_BYTE, null]);
    assert.equal(f.context.getStats().coverageBytes, 800 * 600 * (floatingMask ? 2 : 1));
    assert.equal(f.context.getStats().coverageTargetAllocations, 1);
    assert.equal(f.rasterReadbacks.length, floatingIntegral ? 1 : 0);
    const draw = renderStates(f).filter(state => state.name === 'drawArraysInstanced').at(-1);
    assert.deepEqual(draw.uniforms.integralFloat, [floatingIntegral ? 1 : 0]);
    f.context.dispose();
  }
});

test('coverage bounds follow actual baselines and font-size changes without rebuilding retained glyph positions', async () => {
  const f = fixture({ withIntegralFont: true });await f.context.ready;
  const obj = object(), row = line('A', 0, obj);
  row.textY = row.y + 316.392;
  f.context.setTransform(.1, 0, 0, .1, 0, 0);
  for (const fontSize of [16, 48]) {
    f.context.beginFrame([obj]);
    assert.equal(f.context.drawTextLayout([row], obj, { fontSize }), true);
    assert.equal(f.context.getStats().frameBufferUploads, fontSize === 16 ? 1 : 0);
    const clear = renderStates(f).filter(state => state.name === 'clear').at(-1);
    const [left, bottom, width, height] = clear.scissor;
    const top = f.canvas.height - bottom - height, right = left + width;
    const plane = f.font.glyphs[65].planeBounds;
    assert.ok(left <= (obj.x + 16 + plane.left * fontSize) * .1 - .5);
    assert.ok(right >= (obj.x + 16 + plane.right * fontSize) * .1 + .5);
    assert.ok(top <= (row.textY - plane.top * fontSize) * .1 - .5);
    assert.ok(top + height >= (row.textY - plane.bottom * fontSize) * .1 + .5);
  }
  f.context.dispose();
});

test('Unicode anywhere in a textbox keeps its rendering backend stable as different rows enter the viewport', async () => {
  const f = fixture({ withIntegralFont: true });await f.context.ready;
  const obj = { ...object(), data: { content: 'ABC\n漢' } };
  const asciiRow = line('ABC', 0, obj), unicodeRow = line('漢', 1, obj);
  f.context.setTransform(.1, 0, 0, .1, 0, 0);
  assert.equal(f.context.drawTextLayout([asciiRow], obj), false);
  assert.equal(f.context.drawTextLayout([unicodeRow], obj), false);
  assert.equal(f.context.drawTextLayout([asciiRow, unicodeRow], obj), false);
  assert.equal(f.context.getStats().bufferUploads, 0);
  assert.equal(f.context.getStats().drawCalls, 0);
  obj.data.content = 'ABC\nDEF';
  assert.equal(f.context.drawTextLayout([asciiRow], obj), true);
  assert.equal(f.context.getStats().bufferUploads, 1);
  assert.equal(f.context.drawTextLayout([line('DEF', 1, obj)], obj), true);
  assert.equal(f.context.getStats().bufferUploads, 2);
  obj.data.content = 'ABC\n漢';
  const draws = f.context.getStats().drawCalls;
  assert.equal(f.context.drawTextLayout([asciiRow], obj), false);
  assert.equal(f.context.getStats().drawCalls, draws);
  f.context.dispose();
});

test('appending a visible row copies retained glyph positions without rereading every old prefix width', async () => {
  const f = fixture();await f.context.ready;const obj = object();
  const reads = [0, 0, 0];
  const trackedRow = (text, row) => line(text, row, obj, new Proxy(
    Array.from({ length: text.length + 1 }, (_, index) => index * 8), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads[row]++;
        return Reflect.get(target, key, receiver);
      },
    },
  ));
  const rows = [trackedRow('H'.repeat(1000), 0), trackedRow('I'.repeat(1000), 1), trackedRow('J'.repeat(250), 2)];
  assert.equal(f.context.prepareTextLayout(rows.slice(0, 2), obj), true);
  const original = callsNamed(f, 'bufferData').at(-1).args[1];
  assert.ok(reads[0] >= 1000 && reads[1] >= 1000);
  reads.fill(0);
  assert.equal(f.context.prepareTextLayout([rows[2]], obj), true);
  const expanded = callsNamed(f, 'bufferData').at(-1).args[1];
  // Old rows may reread their two outer bounds, but no individual glyph widths.
  assert.ok(reads[0] <= 2 && reads[1] <= 2, `retained row width reads: ${reads.slice(0, 2)}`);
  assert.ok(reads[2] >= 250);
  assert.deepEqual(expanded.subarray(0, original.length), original);
  assert.equal(expanded.length, 2250 * 3);
  assert.equal(expanded[original.length], 0);
  assert.ok(Math.abs(expanded[original.length + 1] - (2 * 24 + 16.392)) < .00001);
  assert.equal(expanded.at(-1), 'J'.charCodeAt(0));
  assert.equal(f.context.getStats().bufferUploads, 2);
  assert.equal(f.context.getStats().bufferBytes, 2250 * 12);
  reads.fill(0);
  f.context.beginFrame([obj]);
  assert.equal(f.context.drawTextLayout(rows, obj), true);
  assert.deepEqual(reads, [0, 0, 0]);
  assert.equal(f.context.getStats().frameBufferUploads, 0);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 2250);
  f.context.dispose();
});
