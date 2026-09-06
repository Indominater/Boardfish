'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { inflateSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));
const scope = {};
vm.runInNewContext(read('src/fonts/geist-ascii-coverage.js').toString(), scope);
vm.runInNewContext(read('src/fonts/geist-ascii-integral.js').toString(), scope);
const description = scope.BoardfishAsciiCoverageFont;
const integralDescription = scope.BoardfishAsciiIntegralFont;

// Decode the actual checked-in PNG without using the generator or browser's
// color pipeline. Its R/G bytes carry IEEE binary16 bits, not image colors.
function decodeRgbPng(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const compressed = [];
  let width, height;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual(Array.from(data.subarray(8)), [8, 2, 0, 0, 0]);
    } else if (kind === 'IDAT') compressed.push(data);
    offset += length + 12;
    if (kind === 'IEND') break;
  }
  const filtered = inflateSync(Buffer.concat(compressed));
  const stride = width * 3;
  assert.equal(filtered.length, (stride + 1) * height);
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= 3 ? pixels[index - 3] : 0;
      const b = y ? pixels[index - stride] : 0;
      const c = x >= 3 && y ? pixels[index - stride - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1
        : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      pixels[index] = filtered[y * (stride + 1) + x + 1] + predictor;
    }
  }
  return { width, height, pixels };
}

function halfFloat(bits) {
  const fraction = bits & 1023, exponent = bits >> 10 & 31;
  const sign = bits & 32768 ? -1 : 1;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (exponent ? (1 + fraction / 1024) * 2 ** (exponent - 15) : fraction * 2 ** -24);
}

const image = decodeRgbPng(read(`src/${description.atlasURL}`));
const integralImage = decodeRgbPng(read(`src/${integralDescription.atlasURL}`));
const halfValues = Float32Array.from({ length: 15361 }, (_, bits) => halfFloat(bits));
const size = description.cellSize;

function tileOrigin(code, layer) {
  const index = code - 32;
  return [layer % description.layerColumns * description.layerWidth + index % description.columns * size,
    Math.floor(layer / description.layerColumns) * description.layerHeight + Math.floor(index / description.columns) * size];
}

function tileAt(code, layer) {
  const [left, top] = tileOrigin(code, layer), values = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = ((top + y) * image.width + left + x) * 3;
    values[y * size + x] = halfValues[image.pixels[offset] * 256 + image.pixels[offset + 1]];
  }
  return values;
}

function sourceInk(code) {
  const d = integralDescription, index = code - 32;
  const x = index % d.columns * d.cellSize + d.cellSize - 1;
  const y = Math.floor(index / d.columns) * d.cellSize + d.cellSize - 1;
  const offset = (y * integralImage.width + x) * 3;
  const bytes = integralImage.pixels;
  return (bytes[offset] * 65536 + bytes[offset + 1] * 256 + bytes[offset + 2]) / d.coverageScale / d.emSize ** 2;
}

function filteredGlyph(code, deviceEm) {
  const d = description;
  const lod = Math.max(0, Math.min(d.layers - 1, Math.log(deviceEm / d.minDeviceEm)
    / Math.log(d.maxDeviceEm / d.minDeviceEm) * (d.layers - 1)));
  const first = Math.floor(lod), fraction = lod - first;
  const make = layer => {
    const values = tileAt(code, layer);
    const em = d.minDeviceEm * (d.maxDeviceEm / d.minDeviceEm) ** (layer / (d.layers - 1));
    const pad = d.pixelPadding / em, density = size / (d.emExtent + 2 * pad);
    return (x, y) => {
      let qx = (x - d.originX + pad) * density - .5;
      let qy = (y - d.originY + pad) * density - .5;
      if (qx < -.5 || qy < -.5 || qx > size - .5 || qy > size - .5) return 0;
      qx = Math.max(0, Math.min(size - 1, qx)); qy = Math.max(0, Math.min(size - 1, qy));
      const x0 = Math.floor(qx), y0 = Math.floor(qy);
      const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
      const fx = qx - x0, fy = qy - y0;
      return (values[y0 * size + x0] * (1 - fx) + values[y0 * size + x1] * fx) * (1 - fy)
        + (values[y1 * size + x0] * (1 - fx) + values[y1 * size + x1] * fx) * fy;
    };
  };
  const a = make(first), b = make(Math.min(first + 1, d.layers - 1));
  return (x, y) => a(x, y) * (1 - fraction) + b(x, y) * fraction;
}

test('coverage atlas transports bounded half-float data for every padded glyph and scale', () => {
  assert.equal(description.encoding, 'float16-rg');
  assert.equal(image.width, description.width); assert.equal(image.height, description.height);
  assert.equal(description.layerWidth, description.columns * size);
  assert.equal(description.layerHeight / size * description.columns, 96);
  assert.equal(image.width, description.layerColumns * description.layerWidth);
  assert.equal(image.height / description.layerHeight * description.layerColumns, description.layers);
  assert.ok(image.width <= 4096 && image.height <= 4096, 'Fit baseline desktop texture limits');
  assert.ok(image.width * image.height * 2 <= 12 * 1024 * 1024, 'Bound shared R16F GPU memory');
  let nonzeroSubnormal = false;
  for (let layer = 0; layer < description.layers; layer++) for (let code = 32; code < 128; code++) {
    const [left, top] = tileOrigin(code, layer);
    let ink = 0, invalid = 0, edgeInk = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = ((top + y) * image.width + left + x) * 3;
      const bits = image.pixels[offset] * 256 + image.pixels[offset + 1];
      if (bits > 15360 || image.pixels[offset + 2]) invalid++;
      const alpha = halfValues[bits];
      ink += alpha;
      if (!x || !y || x === size - 1 || y === size - 1) edgeInk += alpha;
      if (bits > 0 && bits < 1024) nonzeroSubnormal = true;
    }
    assert.equal(invalid, 0, `ASCII ${code}, layer ${layer}: finite coverage in [0,1]`);
    assert.equal(edgeInk, 0, `ASCII ${code}, layer ${layer}: independent transparent border`);
    if (code === 32 || code === 127) assert.equal(ink, 0);
    else assert.ok(ink > 0, `ASCII ${code}, layer ${layer}: retains ink`);
  }
  assert.ok(nonzeroSubnormal, 'Transport preserves faint tails below the normal half-float range');
});

test('coverage scale range matches the font source and includes the app minimum zoom', () => {
  for (const [name, expected] of [
    ['geist-ascii-msdf.png', description.sourceAtlasSHA256],
    ['geist-ascii-msdf.js', description.sourceMetricsSHA256],
  ]) assert.equal(createHash('sha256').update(read(`src/fonts/${name}`)).digest('hex'), expected);
  const minZoom = Number(read('src/js/board_types.js').toString().match(/const MIN_ZOOM = ([\d.]+)/)[1]);
  const fontSize = Number(read('src/js/text_layout.js').toString().match(/var FONT_SIZE = ([\d.]+)/)[1]);
  assert.ok(description.minDeviceEm <= minZoom * fontSize, 'Lowest scale covers the supported DPR 1 viewport');
  assert.ok(description.maxDeviceEm >= 12, 'Coverage overlaps the entire MSDF transition');
  assert.ok(description.layers >= 12 && description.sigma >= .6);
  assert.equal(description.adaptiveGrid, true);
  assert.equal(description.yOrigin, 'top');
});

test('actual atlas bilinear samples retain punctuation and glyph mass while panning between scale layers', () => {
  for (const code of [46, 95, 72]) for (const em of [1.6, 3.2, 8]) {
    const sample = filteredGlyph(code, em), expected = sourceInk(code) * em ** 2;
    const masses = [], end = Math.ceil(em * 3) + 3;
    for (let axis = 0; axis < 2; axis++) for (let phase = 0; phase < 16; phase++) {
      let mass = 0;
      const dx = axis === 0 ? phase / 16 : .375, dy = axis === 1 ? phase / 16 : .375;
      for (let y = -end; y <= end; y++) for (let x = -end; x <= end; x++) {
        mass += sample((x + dx) / em, (y + dy) / em);
      }
      masses.push(mass);
    }
    const mean = masses.reduce((sum, mass) => sum + mass, 0) / masses.length;
    const variation = (Math.max(...masses) - Math.min(...masses)) / mean;
    assert.ok(Math.min(...masses) > 0, `ASCII ${code}, ${em}px/em: never disappears`);
    assert.ok(Math.abs(mean / expected - 1) < .005, `ASCII ${code}, ${em}px/em: ink bias ${mean / expected - 1}`);
    assert.ok(variation < .008, `ASCII ${code}, ${em}px/em: phase variation ${variation}`);
  }
});

test('coverage metadata and image participate in startup and offline loading', async () => {
  const manifest = await import(pathToFileURL(path.join(root, 'src/js/startup_manifest.mjs')).href);
  for (const scripts of [manifest.WEB_DEV_SCRIPTS, manifest.WEB_PREVIEW_SCRIPTS]) {
    const atlas = scripts.indexOf('../fonts/geist-ascii-coverage.js');
    assert.ok(atlas >= 0 && atlas < scripts.indexOf('gpu_renderer.js'));
  }
  const worker = {
    URL, caches: { open: () => Promise.resolve({}) },
    self: { registration: { scope: 'https://boardfish.test/board/' },
      location: new URL('https://boardfish.test/board/sw.js'), addEventListener() {} },
  };
  vm.runInNewContext(read('src/sw.js').toString(), worker);
  const asset = new URL(description.atlasURL, 'https://boardfish.test/board/');
  assert.equal(worker.isAppShellUrl(asset), true);
  assert.equal(worker.isCacheFirstAssetUrl(asset), true);
});
