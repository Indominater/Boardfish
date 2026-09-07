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
    font, integralFont, createCanvas, textTileCache: false, loadImage: url => {
      const description = options.coverageFont?.atlasURL === url ? options.coverageFont : font;
      return { width: description.width, height: description.height };
    },
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

function coverageDescription() {
  return {
    type: 'gaussian-coverage', atlasURL: 'coverage.png', width: 256, height: 96,
    cellSize: 8, columns: 16, emExtent: 2, originX: -1.5, originY: -2.5,
    layerColumns: 2, layerWidth: 128, layerHeight: 48, layers: 4,
    minDeviceEm: 1.6, maxDeviceEm: 12, pixelPadding: 2.5, encoding: 'float16-rg',
  };
}

function textureUploads(f) {
  let unit = f.gl.TEXTURE0;
  const textures = new Map(), uploads = [];
  for (const { name, args } of f.calls) {
    if (name === 'activeTexture') unit = args[0];
    else if (name === 'bindTexture') textures.set(unit, args[1]);
    else if (name === 'texImage2D') uploads.push({ texture: textures.get(unit), args });
  }
  return uploads;
}

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

function submittedGlyphSpans(f) {
  const buffers=new Map(),draws=[];let buffer,offset=0,clip=[-Infinity,Infinity];
  for(const {name,args} of f.calls) {
    if(name==='bindBuffer'&&args[0]===f.gl.ARRAY_BUFFER)buffer=args[1];
    else if(name==='bufferData'&&args[0]===f.gl.ARRAY_BUFFER)buffers.set(buffer,args[1]);
    else if(name==='vertexAttribPointer'&&args[0]===0)offset=args[5]/4;
    else if(name==='uniform2f'&&args[0]==='clipX')clip=args.slice(1).map(Math.fround);
    else if(name==='drawArraysInstanced')draws.push({clip,data:buffers.get(buffer).subarray(offset,offset+args[3]*3)});
  }
  return draws;
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
  const retained=[] , appended=[];
  for(let i=0;i<expanded.length;i+=3) {
    (expanded[i+2]==='J'.charCodeAt(0)?appended:retained).push(...expanded.subarray(i,i+3));
  }
  assert.deepEqual(retained,Array.from(original), 'old glyph positions survive spatial reordering byte for byte');
  assert.equal(expanded.length, 2250 * 3);
  assert.equal(appended.length,250*3);
  assert.equal(appended[0], 0);
  assert.ok(Math.abs(appended[1] - (2 * 24 + 16.392)) < .00001);
  assert.equal(appended.at(-1), 'J'.charCodeAt(0));
  assert.equal(f.context.getStats().bufferUploads, 2);
  assert.equal(f.context.getStats().bufferBytes, 2250 * 12);
  reads.fill(0);
  f.context.beginFrame([obj]);
  assert.equal(f.context.drawTextLayout(rows, obj), true);
  assert.deepEqual(reads, [0, 0, 0]);
  assert.equal(f.context.getStats().frameBufferUploads, 0);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 384, 'submit only the first retained x bin for the narrow viewport');
  f.context.dispose();
});

test('wide retained rows submit spatial batches while preserving every glyph accepted by the original shader clip', async () => {
  const f=fixture();await f.context.ready;f.canvas.width=512;
  const obj=object(),rows=Array.from({length:48},(_,row)=>line('AB C\tD'.repeat(300),row,obj));
  assert.equal(f.context.prepareTextLayout(rows,obj),true);
  const upload=callsNamed(f,'bufferData').at(-1).args[1],bytes=f.context.getStats().bufferBytes;
  const order=(a,b)=>a[1]-b[1]||a[0]-b[0]||a[2]-b[2];
  for(const [scale,pan] of [[1,-5500],[1,-1059.99999],[1,-1060.00001],[-1,6500],[.15,-800]]) {
    const beforeDraws=submittedGlyphSpans(f).length;
    f.context.beginFrame([obj]);f.context.setTransform(scale,0,0,scale,pan,0);
    assert.equal(f.context.drawTextLayout(rows,obj),true);
    const draws=submittedGlyphSpans(f).slice(beforeDraws),actual=[],expected=[];
    assert.ok(draws.length>0&&draws.length<=2,'spatial batches must not become one draw per row');
    const clip=draws[0].clip;
    for(const {data} of draws)for(let i=0;i<data.length;i+=3)if(data[i]>=clip[0]&&data[i]<=clip[1])actual.push(Array.from(data.subarray(i,i+3)));
    for(let i=0;i<upload.length;i+=3)if(upload[i]>=clip[0]&&upload[i]<=clip[1])expected.push(Array.from(upload.subarray(i,i+3)));
    assert.deepEqual(actual.sort(order),expected.sort(order),'bin boundaries, axis flips, and camera motion must neither omit nor duplicate accepted glyphs');
    assert.equal(f.context.getStats().frameBufferUploads,0);
    assert.equal(f.context.getStats().bufferBytes,bytes,'spatial batches share the existing bounded VBO');
    if(scale===1)assert.ok(f.context.getStats().frameGlyphsDrawn<upload.length/3/4,'a narrow viewport must avoid submitting most offscreen columns');
  }
  f.context.dispose();
});

test('wide cached tiles append only exposed row spans after spatial geometry is repacked', async () => {
  const f=cacheFixture();await f.context.ready;
  const rows=f.rows.map((entry,index)=>line('H'.repeat(1000),index+50,f.obj));
  f.draw(rows,-350);
  const cold=f.context.getStats();
  assert.equal(cold.textTileRasterizations,1);
  assert.ok(cold.frameGlyphsDrawn<6000*.6,'a cold tile must avoid the unneeded width of long rows');
  assert.ok(cold.frameDrawCalls<10,'tile submission stays batched');
  const next=line('W'.repeat(1000),56,f.obj);
  f.draw([next],-350);
  const appended=f.context.getStats();
  assert.equal(appended.textTileAppends,1);
  assert.ok(appended.frameGlyphsDrawn>0&&appended.frameGlyphsDrawn<600,'append only the new row’s intersecting spatial batches');
  const lastDraw=submittedGlyphSpans(f).at(-1);
  for(let i=2;i<lastDraw.data.length;i+=3)assert.equal(lastDraw.data[i],'W'.charCodeAt(0));
  f.draw(rows,-350);
  assert.equal(f.context.getStats().frameGlyphsDrawn,0);
  const changed=line('I'.repeat(1000),52,f.obj);
  f.draw([changed],-350);
  assert.equal(f.context.getStats().textTileRebuilds,2);
  assert.equal(f.context.getStats().bufferBytes,7000*12);
  f.context.clearTextCache();
  assert.equal(f.context.getStats().bufferBytes,0);
  f.draw([changed],-350);
  assert.equal(f.context.getStats().bufferBytes,1000*12,'cleared indexes cannot retain previous geometry or rows');
  f.context.dispose();
});

test('prefiltered coverage uploads immutable binary16 coverage from PNG red/green bytes with or without float extensions', async () => {
  const coverageFont = coverageDescription();
  const rasterPixels = new Uint8ClampedArray(coverageFont.width * coverageFont.height * 4);
  for (let i = 0; i < rasterPixels.length / 4; i++) {
    const bits = i % 0x3c01;
    rasterPixels.set([bits >> 8, bits & 255, 131, 255], i * 4);
  }
  for (const extensions of [[], ['EXT_color_buffer_float', 'OES_texture_float_linear']]) {
    const f = fixture({ coverageFont, extensions, rasterPixels });
    assert.equal(await f.context.ready, true);
    const uploads = textureUploads(f);
    const atlas = uploads.find(upload => upload.args[2] === f.gl.R16F);
    assert.ok(atlas);
    assert.deepEqual(atlas.args.slice(3, 8), [256, 96, 0, f.gl.RED, f.gl.HALF_FLOAT]);
    assert.ok(atlas.args[8] instanceof Uint16Array);
    assert.equal(atlas.args[8].byteLength, coverageFont.width * coverageFont.height * 2);
    for (const i of [0, 1, 255, 256, 1023, 15360, 24575]) assert.equal(atlas.args[8][i], i % 0x3c01);
    assert.equal(uploads.some(upload => upload.args[2] === f.gl.R32F), false);
    assert.equal(f.context.getStats().atlasUploads, 2);
    assert.equal(f.context.getStats().atlasBytes, 128 * 128 * 4 + 4096 + coverageFont.width * coverageFont.height * 2);
    assert.equal(f.rasterReadbacks.length, 1);
    assert.equal(f.rasterSourcesAtDraw.length, 1);
    const obj = object(), rows = [line('H|i.', 0, obj)];
    f.context.setTransform(.1, 0, 0, .1, 50, 50);
    f.context.drawTextLayout(rows, obj);
    const glyph = renderStates(f).find(state => state.name === 'drawArraysInstanced');
    assert.deepEqual(glyph.uniforms.coverageFiltered, [1]);
    assert.deepEqual(glyph.uniforms.coverageColumns, [16]);
    assert.deepEqual(glyph.uniforms.coverageTile, [8 / 256, 8 / 96, .5 / 256, .5 / 96]);
    assert.deepEqual(glyph.uniforms.coverageOrigins, [0, 0, .5, 0]);
    assert.deepEqual(glyph.uniforms.coverageMix, [0]);
    for (const key of ['coverageTransformA', 'coverageTransformB']) assert.ok(glyph.uniforms[key].every(Number.isFinite));
    const pad = coverageFont.pixelPadding / coverageFont.minDeviceEm;
    const transform = glyph.uniforms.coverageTransformA;
    assert.ok(Math.abs((coverageFont.originX - pad) * transform[0] + transform[2]) < 1e-12);
    assert.ok(Math.abs((coverageFont.originX + coverageFont.emExtent + pad) * transform[0] + transform[2] - 8 / 256) < 1e-12);
    assert.equal(f.rasterReadbacks.length, 1, 'the first draw must not decode another copy of the atlas');
    f.context.dispose();
    assert.equal(callsNamed(f, 'deleteTexture').filter(call => call.args[0] === atlas.texture).length, 1);
  }
});

test('prefiltered glyph quads and mask bounds retain the full 3-pixel footprint across chunks and axis flips', async () => {
  const f = fixture({ coverageFont: coverageDescription() });await f.context.ready;
  const obj = object(), rows = [line('A', 0, obj), line('B', 64, obj)];
  for (const transform of [[.1, 0, 0, .2, 300, 100], [-.1, 0, 0, -.2, 300, 500]]) {
    const start = f.calls.length;
    f.context.setTransform(...transform);
    assert.equal(f.context.drawTextLayout(rows, obj), true);
    const states = renderStates(f);
    const glyphs = states.filter(state => state.name === 'drawArraysInstanced').slice(-2);
    const clear = states.filter(state => state.name === 'clear').at(-1);
    const [left, bottom, width, height] = clear.scissor;
    const top = f.canvas.height - bottom - height;
    assert.equal(callsNamed({ calls: f.calls.slice(start) }, 'clear').length, 1);
    for (const glyph of glyphs) {
      const [px, py] = glyph.uniforms.pixelPadding;
      assert.equal(px * Math.abs(transform[0]) * 16, 3);
      assert.equal(py * Math.abs(transform[3]) * 16, 3);
      assert.equal(glyph.framebuffer, clear.framebuffer);
      assert.deepEqual(glyph.blend, [f.gl.ONE, f.gl.ONE]);
      const plane = f.font.glyphs[65].planeBounds;
      const m = glyph.uniforms.transform;
      const boundsX = [plane.left * 16, plane.right * 16].map(x => m[0] * x + m[6]);
      const boundsY = [-plane.top * 16 + 16.392, -plane.bottom * 16 + 16.392].map(y => m[4] * y + m[7]);
      assert.ok(left <= Math.min(...boundsX) - 3);
      assert.ok(left + width >= Math.max(...boundsX) + 3);
      assert.ok(top <= Math.min(...boundsY) - 3);
      assert.ok(top + height >= Math.max(...boundsY) + 3);
    }
    const composite = states.filter(state => state.name === 'drawArrays').at(-1);
    assert.equal(composite.framebuffer, null);
    assert.deepEqual(composite.uniforms.size, [width, height]);
    assert.deepEqual(composite.uniforms.transform.slice(6, 8), [left, top]);
  }
  f.context.dispose();
});

test('continuous coverage scale selection reuses atlas, mask, and glyph buffers through pan and reading-size transitions', async () => {
  const coverageFont = coverageDescription();
  const f = fixture({ coverageFont, withLargeFont: true });await f.context.ready;
  const obj = object(), rows = [line('Thin iii and wide WWW', 0, obj)];
  const boundaryZoom = coverageFont.minDeviceEm * (coverageFont.maxDeviceEm / coverageFont.minDeviceEm) ** (1 / 3) / 16;
  const zooms = [.1, .10001, boundaryZoom - .00001, boundaryZoom, boundaryZoom + .00001, .49999, .5, .74999, .75, 1, 8, .1];
  let atlasTexture;
  for (const [index, zoom] of zooms.entries()) {
    f.context.beginFrame([obj]);
    f.context.setTransform(zoom, 0, 0, zoom, 5 + index * .137, 7 - index * .173);
    assert.equal(f.context.drawTextLayout(rows, obj), true);
    f.context.endFrame();
    const glyph = renderStates(f).filter(state => state.name === 'drawArraysInstanced').at(-1);
    assert.deepEqual(glyph.uniforms.deviceEm, [zoom * 16], 'the device scale must remain continuous across atlas layers');
    assert.deepEqual(glyph.uniforms.fusedReconstruction,[0],'legacy atlas callers retain their original MSDF integration');
    assert.deepEqual(glyph.uniforms.areaFiltered, [zoom < .75 ? 1 : 0]);
    if (zoom < .75) {
      assert.ok(glyph.framebuffer);
      const [x1, y1, x2, y2] = glyph.uniforms.coverageOrigins;
      const layerAt = (x, y) => x * coverageFont.width / coverageFont.layerWidth + y * coverageFont.height / coverageFont.layerHeight * coverageFont.layerColumns;
      const first = layerAt(x1, y1), second = layerAt(x2, y2);
      const mix = glyph.uniforms.coverageMix[0];
      assert.ok(mix >= 0 && mix < 1);
      assert.equal(second, Math.min(coverageFont.layers - 1, first + 1));
      const expected = Math.max(0, Math.min(3, 3 * Math.log(zoom * 16 / 1.6) / Math.log(12 / 1.6)));
      assert.ok(Math.abs(first + mix - expected) < 1e-12, 'layer coordinates and blend weight must preserve continuous log scale');
      for (const key of ['coverageTransformA', 'coverageTransformB']) assert.ok(glyph.uniforms[key].every(Number.isFinite));
    } else {
      assert.equal(glyph.framebuffer, null);
      assert.deepEqual(glyph.uniforms.pixelPadding, [0, 0]);
    }
    assert.equal(f.context.getStats().frameBufferUploads, index === 0 ? 1 : 0);
    assert.equal(f.context.getStats().atlasUploads, 3);
    assert.equal(f.context.getStats().coverageTargetAllocations, 1);
    assert.equal(f.rasterReadbacks.length, 1);
    const atlas = textureUploads(f).filter(upload => upload.args[2] === f.gl.R16F && upload.args[8] instanceof Uint16Array);
    assert.equal(atlas.length, 1);
    if (index === 0) atlasTexture = atlas[0].texture;
    assert.equal(atlas[0].texture, atlasTexture);
  }
  f.context.dispose();
});

test('fused reconstruction atlas keeps continuous zoom in one direct glyph pass without object coverage tile work', async () => {
  const coverageFont={...coverageDescription(),reconstructionKernel:{type:'cubic-bspline',physicalPixelSpacing:.5,fadeStartDeviceEm:10,fadeEndDeviceEm:12}};
  const f=fixture({coverageFont,textTileCache:true,extensions:['EXT_color_buffer_float']});await f.context.ready;
  const obj=object(),rows=Array.from({length:32},(_,row)=>line('H'.repeat(1500),row,obj));
  for(const [index,scale] of [.1,.101,.125,.15,.2,.25,.3125,.375,.5,.500001,.625,.6875,.74999,.75,1,.1].entries()) {
    f.context.beginFrame([obj]);f.context.setTransform(scale,0,0,scale,-700,0);
    assert.equal(f.context.drawTextLayout(rows,obj),true);
    const stats=f.context.getStats();
    assert.equal(stats.frameBufferUploads,index===0?1:0);
    assert.equal(stats.atlasUploads,2);
    assert.equal(stats.textTileRasterizations,0,'crossing scale layers must never rerasterize object textures');
    assert.equal(stats.textTileBytes,0);assert.equal(stats.textTileCount,0);assert.equal(stats.textTileScratchBytes,0);
    assert.ok(stats.frameGlyphsDrawn<=48000,'each retained glyph is submitted at most once per frame');
    const glyph=renderStates(f).filter(state=>state.name==='drawArraysInstanced').at(-1);
    assert.deepEqual(glyph.uniforms.derivativeScale,[1]);
    assert.deepEqual(glyph.uniforms.deviceEm,[scale*16]);
    assert.deepEqual(glyph.uniforms.fusedReconstruction,[scale*16<12?1:0],'fused reconstruction is confined to minification and its transition');
  }
  assert.equal(textureUploads(f).filter(upload=>upload.args[2]===f.gl.R16F&&upload.args[3]===516).length,0);
  f.context.dispose();
});

test('GPU rectangular clips share fractional pixel boundaries and constrain masks, glyph batches, and restored drawing',async()=>{
  const f=fixture({coverageFont:{...coverageDescription(),reconstructionKernel:{type:'cubic-bspline'}},extensions:['EXT_color_buffer_float']});await f.context.ready;
  const obj=object(),rows=Array.from({length:20},(_,row)=>line('H'.repeat(1500),row,obj));
  for(const scale of [.1,.101,.625,1]) {
    f.context.setTransform(scale,0,0,scale,.137,.219);f.context.save();
    f.context.clipRect(100,100,333,222);
    const expected=[Math.ceil(100*scale+.137-.5),Math.ceil(100*scale+.219-.5),Math.ceil(433*scale+.137-.5),Math.ceil(322*scale+.219-.5)];
    f.context.fillRect(0,0,1000,1000);
    let draw=renderStates(f).at(-1);
    assert.deepEqual(draw.scissor,[expected[0],600-expected[3],expected[2]-expected[0],expected[3]-expected[1]]);
    assert.ok(draw.enabled.has(f.gl.SCISSOR_TEST));
    f.context.drawTextLayout(rows,obj);
    const text=renderStates(f).filter(state=>state.name==='drawArraysInstanced').at(-1);
    assert.ok(text.scissor[0]>=expected[0]);assert.ok(text.scissor[0]+text.scissor[2]<=expected[2]);
    assert.ok(text.scissor[1]>=600-expected[3]);assert.ok(text.scissor[1]+text.scissor[3]<=600-expected[1]);
    const wholeViewportLeft=-(scale*(obj.x+16)+.137)/scale-32-3/scale;
    assert.ok(text.uniforms.clipX[0]>wholeViewportLeft+90,'the visible rectangle narrows glyph rejection before submission');
    f.context.restore();f.context.fillRect(0,0,20,20);
    draw=renderStates(f).at(-1);assert.equal(draw.enabled.has(f.gl.SCISSOR_TEST),false,'object clipping cannot leak into the next primitive');
  }
  // Adjacent disjoint world regions partition exactly the same pixel interval.
  f.context.setTransform(.137,0,0,.137,.499,.001);
  const scans=[];
  for(const [left,right] of [[10,111.25],[111.25,300]]) {
    f.context.save();f.context.clipRect(left,0,right-left,100);f.context.fillRect(0,0,1000,1000);scans.push(renderStates(f).at(-1).scissor);f.context.restore();
  }
  assert.equal(scans[0][0]+scans[0][2],scans[1][0],'fractional shared boundaries neither overlap nor leave a one-pixel gap');
  f.context.dispose();
});

test('opaque scene occlusion reduces real GPU glyph submissions and never prepares a fully hidden textbox',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),scope={};vm.runInNewContext(fs.readFileSync(require.resolve('../src/js/renderer.js'),'utf8'),scope);
  const f=fixture({coverageFont:{...coverageDescription(),reconstructionKernel:{type:'cubic-bspline'}},extensions:['EXT_color_buffer_float']});await f.context.ready;
  const lower={id:'lower',type:'text',x:0,y:0,w:12000,h:1536,data:{content:'large'}},top={id:'top',type:'text',x:0,y:0,w:6000,h:1536,data:{content:'cover'}};
  const rows=Array.from({length:64},(_,row)=>line('H'.repeat(1500),row,lower)),topRows=[line('Cover',0,top)];let objects=[lower],lowerLayouts=0;
  const renderer=scope.BoardfishRenderer.createBoardRenderer({objects:()=>objects,zoom:()=>.1,dpr:()=>1,viewportCullingEnabled:()=>true,
    canvasBackgroundColor:()=> '#1c1b22',objectIntersectsRect:()=>true,
    getTextLayoutForViewport(obj,rect){if(obj===lower)lowerLayouts++;return(obj===lower?rows:topRows).filter(row=>row.y+24>=rect.y1&&row.y<=rect.y2);},
  });
  const draw=()=>{f.context.beginFrame(objects);f.context.setTransform(.1,0,0,.1,0,0);renderer.drawVisibleObjects(f.context,null,{x1:0,y1:0,x2:8000,y2:6000});return f.context.getStats();};
  const baseline=draw().frameGlyphsDrawn;
  objects=[lower,top];const partial=draw();
  assert.ok(partial.frameGlyphsDrawn<baseline*.5,'covered columns do not keep consuming glyph vertex/fragment work');
  top.w=12000;const before=lowerLayouts,covered=draw();
  assert.equal(lowerLayouts,before,'fully hidden text must not request layout');
  assert.equal(covered.frameGlyphsDrawn,5,'only the top textbox submits glyphs');
  assert.equal(covered.textTileBytes,0,'occlusion retains the fused zoom renderer');
  f.context.dispose();
});

test('coverage atlas survives board resets, regenerates after context loss, and releases live textures exactly once', async () => {
  const coverageFont = coverageDescription();
  const f = fixture({ coverageFont });await f.context.ready;
  const obj = object(), rows = [line('AB', 0, obj)];
  const coverageUploads = () => textureUploads(f).filter(upload => upload.args[2] === f.gl.R16F && upload.args[8] instanceof Uint16Array);
  const original = coverageUploads()[0].texture;
  const draw = () => {
    f.context.setTransform(.1, 0, 0, .1, 0, 0);
    assert.equal(f.context.drawTextLayout(rows, obj), true);
  };
  draw();
  f.context.resetResources();
  assert.equal(f.context.getStats().coverageBytes, 0);
  assert.equal(callsNamed(f, 'deleteTexture').some(call => call.args[0] === original), false);
  draw();
  assert.equal(coverageUploads().length, 1);
  f.events.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(f.context.fontReady, false);
  assert.equal(f.context.getStats().coverageBytes, 0);
  assert.equal(f.context.drawTextLayout(rows, obj), false);
  f.events.get('webglcontextrestored')();
  assert.equal(await f.context.ready, true);
  const restored = coverageUploads()[1].texture;
  assert.notEqual(restored, original);
  assert.equal(coverageUploads().length, 2);
  assert.equal(f.rasterReadbacks.length, 2);
  draw();
  const start = f.calls.length;
  f.context.dispose();
  const deletions = callsNamed({ calls: f.calls.slice(start) }, 'deleteTexture').map(call => call.args[0]);
  assert.equal(deletions.filter(texture => texture === restored).length, 1);
  assert.equal(new Set(deletions).size, deletions.length);
  assert.equal(deletions.length, 4, 'release the live glyph metadata, MSDF atlas, coverage atlas, and mask');
  assert.equal(f.events.size, 0);
  f.context.dispose();
  assert.equal(callsNamed({ calls: f.calls.slice(start) }, 'deleteTexture').length, deletions.length);
});

function cacheFixture(options = {}) {
  const f = fixture({ coverageFont: coverageDescription(), textTileCache: true, extensions: ['EXT_color_buffer_float'], ...options });
  f.canvas.width = f.canvas.height = 100;
  const obj = { id: 'cached-text', type: 'text', x: 0, y: 0 };
  const rows = Array.from({ length: 6 }, (_, index) => line('H'.repeat(200), index + 50, obj));
  const draw = (layout = rows, panX = -100, live = [obj]) => {
    f.context.beginFrame(live);f.context.setTransform(.1, 0, 0, .1, panX, -100);
    assert.equal(f.context.drawTextLayout(layout, obj), true);f.context.endFrame();
  };
  return { ...f, obj, rows, draw };
}

test('warm coverage tiles pan and move with zero glyph submissions, uploads, or readbacks', async () => {
  const f = cacheFixture();await f.context.ready;
  f.draw();
  const initial = f.context.getStats();
  assert.equal(initial.textTileCount, 1);
  assert.equal(initial.textTileRasterizations, 1);
  assert.equal(initial.textTileBytes, 516 * 516 * 2);
  assert.equal(initial.frameGlyphsDrawn, 1200);
  for (const phase of [.125, .25, .5, .75, 1]) {
    f.draw(f.rows, -100 + phase);
    const stats = f.context.getStats();
    assert.equal(stats.frameGlyphsDrawn, 0);
    assert.equal(stats.frameBufferUploads, 0);
    assert.equal(stats.textTileRasterizations, 1);
    assert.equal(stats.textTileCount, 1);
    assert.equal(stats.atlasUploads, initial.atlasUploads);
    assert.equal(f.rasterReadbacks.length, 1);
  }
  f.obj.x += 500;f.draw(f.rows, -150);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 0);
  const sample = renderStates(f).filter(state => state.uniforms?.coverageAccumulation?.[0] === 1 && state.name === 'drawArrays').at(-1);
  assert.deepEqual(sample.uniforms.coverageTextureSize, [516, 516, 1 / 516, 1 / 516]);
  assert.deepEqual(sample.uniforms.sourceRect, [2 / 516, 1 - 2 / 516, 512 / 516, -512 / 516]);
  assert.deepEqual(sample.blend, [f.gl.ONE, f.gl.ONE]);
  f.context.dispose();
});

test('partly populated coverage tiles append newly exposed rows and rebuild only when existing rows change', async () => {
  const f = cacheFixture();await f.context.ready;f.draw();
  const next = line('W'.repeat(200), 56, f.obj);
  const clearCount = callsNamed(f, 'clear').length;
  f.draw([next]);
  assert.equal(f.context.getStats().textTileRasterizations, 2);
  assert.equal(f.context.getStats().textTileAppends, 1);
  assert.equal(f.context.getStats().textTileRebuilds, 1);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 200, 'only the newly exposed row should be submitted');
  assert.equal(callsNamed(f, 'clear').length - clearCount, 1, 'clear the shared mask, but preserve the populated tile');
  f.draw(f.rows);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 0);
  const changed = line('I'.repeat(200), 52, f.obj);
  f.draw([changed]);
  assert.equal(f.context.getStats().textTileRasterizations, 3);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 1400);
  assert.equal(f.context.getStats().textTileRebuilds, 2, 'changing a cached row requires rebuilding all retained rows');
  f.draw([changed]);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 0);
  f.obj.data = { content: 'new document contents' };
  f.draw([changed]);
  assert.equal(f.context.getStats().textTileCount, 1);
  assert.equal(f.context.getStats().frameGlyphsDrawn, 200, 'unrequested rows from the old content version must not enter the new tile');
  f.obj.w = 999;
  f.draw([changed]);
  assert.equal(f.context.getStats().textTileRasterizations, 5);
  f.context.dispose();
});

test('frame-wide coverage tile budget preserves warm text and streams the same pixel pipeline for another textbox', async () => {
  const bytes = 516 * 516 * 2;
  const f = cacheFixture({ maxTextTileBytes: bytes });await f.context.ready;
  const other = { ...f.obj, id: 'second-text' };
  const otherRows = f.rows.map((entry, i) => line(entry.text, 50 + i, other));
  for (let frame = 0; frame < 4; frame++) {
    f.context.beginFrame([f.obj, other]);f.context.setTransform(.1, 0, 0, .1, -100, -100);
    f.context.drawTextLayout(f.rows, f.obj);f.context.drawTextLayout(otherRows, other);f.context.endFrame();
    const stats = f.context.getStats();
    assert.equal(stats.textTileBytes, bytes);
    assert.equal(stats.textTileCount, 1);
    assert.equal(stats.textTileRasterizations, frame + 2);
    assert.equal(stats.textTileScratchUses, frame + 1);
    assert.equal(stats.textTileScratchBytes, bytes);
    assert.equal(stats.textTileEvictions, 0);
    assert.equal(stats.textTileBypasses, frame + 1);
    assert.equal(stats.frameGlyphsDrawn, frame === 0 ? 2400 : 1200);
    const glyph = renderStates(f).filter(state => state.name === 'drawArraysInstanced').at(-1);
    assert.deepEqual(glyph.uniforms.derivativeScale, [2], 'budget pressure must render through the same supersampled field');
  }
  assert.equal(textureUploads(f).filter(upload => upload.args[2] === f.gl.R16F && upload.args[3] === 516).length, 2);
  const pressured = renderStates(f).filter(state => state.name === 'drawArrays' && state.uniforms.coverageAccumulation?.[0] === 1).at(-1);
  f.context.beginFrame([other]);
  assert.equal(f.context.getStats().textTileBytes, 0, 'removed objects must release their tiles at frame start');
  f.context.drawTextLayout(otherRows, other);
  assert.equal(f.context.getStats().textTileCount, 1);
  const retained = renderStates(f).filter(state => state.name === 'drawArrays' && state.uniforms.coverageAccumulation?.[0] === 1).at(-1);
  for (const key of ['transform', 'size', 'sourceRect', 'coverageTextureSize', 'color']) assert.deepEqual(retained.uniforms[key], pressured.uniforms[key]);
  f.context.dispose();
});

test('coverage tile LRU remains bounded as the camera visits new world tiles and portable rendering bypasses the cache', async () => {
  const bytes = 516 * 516 * 2;
  const f = cacheFixture({ maxTextTileBytes: bytes });await f.context.ready;
  const wide = f.rows.map((entry, i) => line('H'.repeat(800), i + 50, f.obj));
  for (const [index, pan] of [-100, -400, -100].entries()) {
    f.draw(wide, pan);
    assert.equal(f.context.getStats().textTileBytes, bytes);
    assert.equal(f.context.getStats().textTileCount, 1);
    assert.equal(f.context.getStats().textTileRasterizations, index + 1);
    assert.equal(f.context.getStats().textTileEvictions, index);
    assert.equal(f.context.getStats().textTileReuses, index);
    assert.equal(textureUploads(f).filter(upload => upload.args[2] === f.gl.R16F && upload.args[3] === 516).length, 1, 'evicted slots reuse their texture/FBO allocation');
  }
  f.context.dispose();
  for (const options of [{ extensions: [] }, { textTileCache: false }]) {
    const portable = cacheFixture(options);await portable.context.ready;portable.draw();portable.draw();
    assert.equal(portable.context.getStats().textTileBytes, 0);
    assert.equal(portable.context.getStats().textTileRasterizations, 0);
    assert.equal(portable.context.getStats().frameGlyphsDrawn, 1200);
    portable.context.dispose();
  }
});

test('zero retained tile budget preserves cubic reconstruction and layer weights using one reusable scratch tile', async () => {
  const retained = cacheFixture(), streamed = cacheFixture({ maxTextTileBytes: 0 });
  await Promise.all([retained.context.ready, streamed.context.ready]);
  for (const zoom of [.1, .101, .11, .1]) {
    const samples=[];
    for (const f of [retained, streamed]) {
      const start = f.calls.length;
      f.context.beginFrame([f.obj]);f.context.setTransform(zoom, 0, 0, zoom, -100, -100);
      f.context.drawTextLayout(f.rows, f.obj);f.context.endFrame();
      samples.push(renderStates({ ...f, calls: f.calls.slice(start) }).filter(state => state.name === 'drawArrays' && state.uniforms.coverageAccumulation?.[0] === 1));
    }
    assert.equal(samples[0].length, samples[1].length);
    for (let i = 0; i < samples[0].length; i++) {
      for (const key of ['transform', 'size', 'sourceRect', 'coverageTextureSize', 'color']) assert.deepEqual(samples[0][i].uniforms[key], samples[1][i].uniforms[key]);
    }
    assert.equal(streamed.context.getStats().textTileBytes, 0);
    assert.equal(streamed.context.getStats().textTileCount, 0);
    assert.equal(streamed.context.getStats().textTileScratchBytes, 516 * 516 * 2);
  }
  const scratch = textureUploads(streamed).filter(upload => upload.args[2] === streamed.gl.R16F && upload.args[3] === 516);
  assert.equal(scratch.length, 1, 'all tiles and levels must reuse one scratch allocation');
  streamed.context.clearTextCache();
  assert.equal(streamed.context.getStats().textTileScratchBytes, 0);
  assert.equal(callsNamed(streamed, 'deleteTexture').filter(call => call.args[0] === scratch[0].texture).length, 1);
  retained.context.dispose();streamed.context.dispose();
});

test('coverage tile reset, context restoration, and disposal release bounded framebuffer resources', async () => {
  const f = cacheFixture();await f.context.ready;f.draw();
  const uploads = () => textureUploads(f).filter(upload => upload.args[2] === f.gl.R16F && upload.args[3] === 516);
  const first = uploads()[0].texture;
  f.context.clearTextCache();
  assert.equal(f.context.getStats().textTileCount, 0);
  assert.equal(f.context.getStats().textTileBytes, 0);
  assert.equal(callsNamed(f, 'deleteTexture').filter(call => call.args[0] === first).length, 1);
  f.draw();
  f.events.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(f.context.getStats().textTileBytes, 0);
  f.events.get('webglcontextrestored')();await f.context.ready;f.draw();
  const restored = uploads().at(-1).texture;
  f.context.dispose();
  assert.equal(f.context.getStats().textTileCount, 0);
  assert.equal(f.context.getStats().textTileBytes, 0);
  assert.equal(callsNamed(f, 'deleteTexture').filter(call => call.args[0] === restored).length, 1);
  f.context.dispose();
  assert.equal(callsNamed(f, 'deleteTexture').filter(call => call.args[0] === restored).length, 1);
});

test('coverage tiles keep fixed layer filtering and fade continuously into the direct reading renderer', async () => {
  const f = cacheFixture();await f.context.ready;
  const rows = [line('Reading', 0, f.obj)];
  f.context.beginFrame([f.obj]);f.context.setTransform(11 / 16, 0, 0, 11 / 16, 30, 30);
  f.context.drawTextLayout(rows, f.obj);
  const glyphs = renderStates(f).filter(state => state.name === 'drawArraysInstanced');
  const direct = glyphs.at(-1);
  assert.deepEqual(direct.uniforms.derivativeScale, [1]);
  assert.deepEqual(direct.uniforms.deviceEm, [11]);
  assert.deepEqual(direct.uniforms.color, [1, 1, 1, .5]);
  assert.ok(glyphs.slice(0, -1).every(state => state.uniforms.derivativeScale[0] === 2));
  assert.ok(glyphs.slice(0, -1).every(state => state.uniforms.coverageMix[0] === 0));
  const before = f.context.getStats().textTileDrawCalls;
  f.context.beginFrame([f.obj]);f.context.setTransform(.75, 0, 0, .75, 30, 30);f.context.drawTextLayout(rows, f.obj);
  const reading = renderStates(f).filter(state => state.name === 'drawArraysInstanced').at(-1);
  assert.equal(reading.framebuffer, null);
  assert.deepEqual(reading.uniforms.areaFiltered, [0]);
  assert.deepEqual(reading.uniforms.pixelPadding, [0, 0]);
  assert.equal(f.context.getStats().textTileDrawCalls, before);
  f.context.dispose();
});
