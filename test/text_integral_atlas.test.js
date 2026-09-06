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
vm.runInNewContext(read('src/fonts/geist-ascii-integral.js').toString(), scope);
const description = scope.BoardfishAsciiIntegralFont;

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
      assert.deepEqual(Array.from(data.subarray(8)), [8, 2, 0, 0, 0], 'Expected noninterlaced RGB8 data');
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
    assert.ok(filter <= 4, `Unsupported PNG filter ${filter}`);
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

const image = decodeRgbPng(read(`src/${description.atlasURL}`));
const size = description.cellSize;
const cells = size - 1;

function packedAt(code, x, y) {
  const tile = code - 32;
  const pixel = ((Math.floor(tile / description.columns) * size + y) * image.width
    + tile % description.columns * size + x) * 3;
  return image.pixels.subarray(pixel, pixel + 3);
}

function prefixAt(code, x, y) {
  const bytes = packedAt(code, x, y);
  return bytes[0] * 65536 + bytes[1] * 256 + bytes[2];
}

function integral(code, x, y, packedFiltering = false) {
  x = Math.max(0, Math.min(cells, x)); y = Math.max(0, Math.min(cells, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(cells, x0 + 1), y1 = Math.min(cells, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  if (!packedFiltering) return points.reduce((sum, [px, py], i) => sum + prefixAt(code, px, py) * weights[i], 0);
  const rgb = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const bytes = packedAt(code, ...points[i]);
    for (let channel = 0; channel < 3; channel++) rgb[channel] += bytes[channel] / 255 * weights[i];
  }
  return (rgb[0] * 65536 + rgb[1] * 256 + rgb[2]) * description.coverageScale;
}

test('integral atlas metadata matches the actual PNG and its source font artifacts', () => {
  assert.equal(description.type, 'summed-area');
  assert.equal(image.width, description.width); assert.equal(image.height, description.height);
  assert.equal(image.width, description.columns * size);
  assert.equal(image.height / size * description.columns, 96);
  assert.equal(description.yOrigin, 'top');
  assert.equal(description.emSize, 32); assert.equal(size, 65);
  assert.equal(description.originX, -.5); assert.equal(description.originY, -1.25);
  assert.equal(description.coverageScale, 255);
  for (const [name, expected] of [
    ['geist-ascii-msdf.png', description.sourceAtlasSHA256],
    ['geist-ascii-msdf.js', description.sourceMetricsSHA256],
  ]) assert.equal(createHash('sha256').update(read(`src/fonts/${name}`)).digest('hex'), expected, name);
});

test('startup and offline asset loading include the integral atlas before the GPU renderer', async () => {
  const manifest = await import(pathToFileURL(path.join(root, 'src/js/startup_manifest.mjs')).href);
  for (const scripts of [manifest.WEB_DEV_SCRIPTS, manifest.WEB_PREVIEW_SCRIPTS]) {
    const atlas = scripts.indexOf('../fonts/geist-ascii-integral.js');
    assert.ok(atlas >= 0 && atlas < scripts.indexOf('gpu_renderer.js'));
  }
  const serviceWorker = {
    URL, caches: { open: () => Promise.resolve({}) },
    self: { registration: { scope: 'https://boardfish.test/board/' },
      location: new URL('https://boardfish.test/board/sw.js'), addEventListener() {} },
  };
  vm.runInNewContext(read('src/sw.js').toString(), serviceWorker);
  const asset = new URL(description.atlasURL, 'https://boardfish.test/board/');
  assert.equal(serviceWorker.isAppShellUrl(asset), true);
  assert.equal(serviceWorker.isCacheFirstAssetUrl(asset), true);
});

test('every glyph tile is a valid independently padded summed-area table', () => {
  let maximum = 0;
  for (let code = 32; code < 128; code++) {
    let mass = 0;
    for (let y = 0; y < size; y++) {
      assert.equal(prefixAt(code, 0, y), 0, `ASCII ${code} first column`);
      assert.equal(prefixAt(code, y, 0), 0, `ASCII ${code} first row`);
    }
    for (let y = 1; y < size; y++) for (let x = 1; x < size; x++) {
      const value = prefixAt(code, x, y);
      assert.ok(value >= prefixAt(code, x - 1, y) && value >= prefixAt(code, x, y - 1));
      const alpha = value - prefixAt(code, x - 1, y) - prefixAt(code, x, y - 1) + prefixAt(code, x - 1, y - 1);
      assert.ok(alpha >= 0 && alpha <= 255, `ASCII ${code} cell (${x},${y}) is a coverage byte`);
      if (x === 1 || x === cells || y === 1 || y === cells) assert.equal(alpha, 0, `ASCII ${code} transparent border`);
      mass += alpha;
    }
    assert.equal(mass, prefixAt(code, cells, cells));
    if (code === 32 || code === 127) assert.equal(mass, 0, 'Space and DEL must be blank');
    else assert.ok(mass > 0, `ASCII ${code} must retain visible ink`);
    maximum = Math.max(maximum, mass);
  }
  assert.equal(maximum, description.maxValue);
  assert.ok(maximum < 2 ** 24);
});

test('packed prefix interpolation preserves fractional area across byte carries and tile edges', () => {
  for (let code = 33; code < 127; code++) for (let i = 0; i < 64; i++) {
    const x = (i * 23.173 + code * .113) % 80 - 8;
    const y = (i * 31.271 + code * .317) % 80 - 8;
    assert.ok(Math.abs(integral(code, x, y, true) - integral(code, x, y)) < 1e-8);
  }
});

test('complete pixel footprints conserve every glyph ink mass throughout fractional panning', () => {
  const phases = [[0, 0], [.125, .9], [.375, .2], [.5, .5], [.875, .125]];
  for (let code = 33; code < 127; code++) for (const deviceEm of [1.6, 3.2, 6.4, 10]) {
    const footprint = description.emSize / deviceEm;
    const area = footprint ** 2 * description.coverageScale;
    const expected = prefixAt(code, cells, cells) / area;
    for (const [phaseX, phaseY] of phases) {
      let actual = 0;
      const end = Math.ceil(cells / footprint) + 2;
      for (let py = -2; py <= end; py++) for (let px = -2; px <= end; px++) {
        const left = (px - phaseX) * footprint, right = left + footprint;
        const top = (py - phaseY) * footprint, bottom = top + footprint;
        const coverage = (integral(code, right, bottom) - integral(code, left, bottom)
          - integral(code, right, top) + integral(code, left, top)) / area;
        assert.ok(coverage >= -1e-10 && coverage <= 1 + 1e-10, 'Per-pixel coverage must stay physical');
        actual += coverage;
      }
      assert.ok(Math.abs(actual - expected) < 1e-9,
        `ASCII ${code}, ${deviceEm}px/em, phase (${phaseX},${phaseY}) changed ink ${expected} -> ${actual}`);
    }
  }
});
