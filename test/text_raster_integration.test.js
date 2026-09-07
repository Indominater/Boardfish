'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const surfaces = [];
  function makeContext() {
    return {
      font: "normal 400 16px 'Geist Sans', system-ui", fillStyle: '#fff',
      textBaseline: 'alphabetic', textAlign: 'left', direction: 'ltr',
      fontKerning: 'none', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      glyphs: [], images: [],
      getTransform() { return this.transform; },
      setTransform(a, b, c, d, e, f) { this.transform = { a, b, c, d, e, f }; },
      fillText(...args) { this.glyphs.push(args); },
      drawImage(...args) { this.images.push(args); },
      measureText(text) {
        return { width: text.length * 8, actualBoundingBoxLeft: 1,
          actualBoundingBoxRight: text.length * 8 + 1,
          actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 };
      },
    };
  }
  const scope = {
    BoardfishBoardTypes: require('../src/js/board_types.js'),
    document: {
      fonts: { status: 'loaded', check: () => true },
      createElement() {
        const context = makeContext();
        const canvas = { width: 0, height: 0, getContext: () => context, context };
        surfaces.push(canvas);
        return canvas;
      },
    },
    navigator: { userAgent: 'Chrome/140.0.0.0' },
    objects: [], TextSelDebug: { _logHit() {} },
    scheduleRender() {}, markDirty() {},
  };
  vm.createContext(scope);
  for (const file of ['text_raster.js', 'text_layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js', file), 'utf8'), scope);
  }
  vm.runInContext('globalThis.api = { getTextLayout, drawTextLineRange, patchTextObjectLayoutAfterInput, clearTextMeasurementCaches, clearTextLayoutCaches, getTextRasterCacheStats, cloneTextObjectRuntimeCaches };', scope);
  const obj = { type: 'text', x: 10, y: 20, w: 800, h: 100, data: { content: 'ASCII f/tt + symbols {}\nsecond\tline\nlast row' } };
  scope.objects.push(obj);
  return { ...scope.api, obj, surfaces, context: makeContext() };
}

test('ASCII rows retain pixels across repaints and object moves without changing caret geometry', () => {
  const api = load();
  const lines = api.getTextLayout(api.obj);
  const widths = lines.map((line) => [...line.prefixWidths]);
  for (const line of lines) api.drawTextLineRange(api.context, line, api.obj);
  assert.equal(api.context.glyphs.length, 0);
  assert.equal(api.context.images.length, lines.length);
  const sources = api.context.images.map((args) => args[0]);
  const coldCalls = api.getTextRasterCacheStats().rasterizedDrawCalls;
  assert.ok(coldCalls > lines.length);
  api.obj.x += 47;
  api.obj.y += 13;
  const moved = api.getTextLayout(api.obj);
  api.context.images.length = 0;
  for (const line of moved) {
    const stats = api.drawTextLineRange(api.context, line, api.obj);
    assert.equal(stats.rasterCacheHits, 1);
    assert.equal(stats.drawCalls, 1);
    assert.equal(stats.rasterizedDrawCalls, 0);
  }
  assert.deepEqual(moved.map((line) => [...line.prefixWidths]), widths);
  assert.deepEqual(api.context.images.map((args) => args[0]), sources);
  assert.equal(api.getTextRasterCacheStats().rasterizedDrawCalls, coldCalls);
});

test('editing one logical line rebuilds its pixels and reuses unchanged rows', () => {
  const api = load();
  const before = api.getTextLayout(api.obj);
  for (const line of before) api.drawTextLineRange(api.context, line, api.obj);
  const oldContent = api.obj.data.content;
  api.obj.data.content = 'X' + oldContent;
  assert.equal(api.patchTextObjectLayoutAfterInput(api.obj, {
    oldContent, newContent: api.obj.data.content, start: 0, end: 0, insertedText: 'X',
  }), true);
  const after = api.getTextLayout(api.obj);
  assert.equal(api.drawTextLineRange(api.context, after[0], api.obj).rasterCacheMisses, 1);
  assert.equal(api.drawTextLineRange(api.context, after[1], api.obj).rasterCacheHits, 1);
  assert.equal(api.drawTextLineRange(api.context, after[2], api.obj).rasterCacheHits, 1);
});

test('font readiness and board layout reset dispose retained surfaces', () => {
  const api = load();
  const draw = () => api.getTextLayout(api.obj).forEach((line) => api.drawTextLineRange(api.context, line, api.obj));
  draw();
  const sources = api.context.images.map((args) => args[0]);
  api.clearTextMeasurementCaches();
  assert.equal(api.getTextRasterCacheStats().bytes, 0);
  assert.ok(sources.every((canvas) => canvas.width === 0 && canvas.height === 0));
  draw();
  assert.ok(api.getTextRasterCacheStats().bytes > 0);
  api.clearTextLayoutCaches({ objectLayout: false });
  assert.equal(api.getTextRasterCacheStats().entries, 0);
});

test('legacy Unicode and partial text ranges retain direct rendering and content', () => {
  const api = load();
  api.obj.data.content = 'Hello café 😀';
  const [line] = api.getTextLayout(api.obj);
  api.drawTextLineRange(api.context, line, api.obj);
  assert.ok(api.context.glyphs.length > 0);
  assert.equal(api.context.images.length, 0);
  assert.equal(api.obj.data.content, 'Hello café 😀');
  api.obj.data.content = 'plain ASCII';
  const [ascii] = api.getTextLayout(api.obj);
  api.context.glyphs.length = 0;
  api.drawTextLineRange(api.context, ascii, api.obj, 0, 3);
  assert.equal(api.context.glyphs.map(([text]) => text).join(''), 'pla');
  assert.equal(api.context.images.length, 0);
});

test('runtime clones share retained pixels while serialized content stays plain', () => {
  const api = load();
  for (const line of api.getTextLayout(api.obj)) api.drawTextLineRange(api.context, line, api.obj);
  const clone = { ...api.obj, x: 300, y: 400, data: { ...api.obj.data } };
  delete clone._layoutCache;
  api.cloneTextObjectRuntimeCaches(api.obj, clone);
  for (const line of api.getTextLayout(clone)) {
    assert.equal(api.drawTextLineRange(api.context, line, clone).rasterCacheHits, 1);
  }
  assert.deepEqual(Object.keys(clone.data), ['content']);
});
