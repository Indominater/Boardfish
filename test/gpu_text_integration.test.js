'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadRenderer(production = false) {
  const scope = production ? { BOARDFISH_PRODUCTION: true } : {};
  vm.createContext(scope);
  vm.runInContext(read('src/js/renderer.js'), scope);
  return scope.BoardfishRenderer;
}

for (const production of [false, true]) {
  test(`whole-layout GPU submission bypasses line rasterization in ${production ? 'production' : 'development'}`, () => {
    const api = loadRenderer(production);
    const obj = { id: 'ascii', type: 'text', data: { content: 'one\ntwo' } };
    const viewport = { x1: 0, y1: 0, x2: 200, y2: 100 };
    const layout = [{ text: 'one' }, { text: 'two' }];
    layout.totalLines = 20;
    const calls = [];
    const renderer = api.createBoardRenderer({
      fontSize: 16, textPad: 16, lineHeight: 24,
      getTextLayoutForViewport(candidate, rect) {
        assert.strictEqual(candidate, obj); assert.strictEqual(rect, viewport); return layout;
      },
      drawTextLineRange() { assert.fail('handled GPU layouts must never enter line rasterization'); },
    });
    const context = {
      drawTextLayout(candidate, owner, options) { calls.push([candidate, owner, options]); return true; },
      getStats: () => ({ fontReady: true, frameDrawCalls: 1 }),
    };
    if (production) renderer.drawSingleObj(context, obj, null, viewport);
    else {
      const counters = renderer.createDrawCounters();
      renderer.drawSingleObj(context, obj, counters, viewport);
      assert.equal(counters.drawnTextLines, 2);
      assert.equal(counters.culledTextLines, 18);
      assert.equal(counters.textGpuObjects, 1);
      assert.equal(counters.textRasterDrawCalls, 0);
    }
    assert.equal(calls.length, 1);
    assert.strictEqual(calls[0][0], layout);
    assert.strictEqual(calls[0][1], obj);
    assert.deepEqual({ ...calls[0][2] }, { fontSize: 16, padding: 16, lineHeight: 24 });
  });

  test(`unhandled GPU layouts retain every legacy text row in ${production ? 'production' : 'development'}`, () => {
    const api = loadRenderer(production), calls = [];
    const obj = { id: 'legacy', type: 'text', data: { content: 'café\n😀' } };
    const layout = [{ text: 'café' }, { text: '😀' }];
    const renderer = api.createBoardRenderer({
      getTextLayout: () => layout,
      drawTextLineRange(_context, line) { calls.push(line.text); },
    });
    renderer.drawSingleObj({ drawTextLayout: () => false }, obj);
    assert.deepEqual(calls, ['café', '😀']);
    assert.equal(obj.data.content, 'café\n😀');
  });
}

test('GPU text overlay keeps selection behind glyphs and caret above glyphs', () => {
  const source = read('src/js/viewport.js');
  const overlay = source.slice(source.indexOf('function drawTextSelectionHighlight'), source.indexOf('function drawBoard'));
  const obj = { id: 'editing', type: 'text', x: 10, y: 20, w: 180, h: 80 };
  const layout = [{ text: 'hello', startIndex: 0, endIndex: 5, y: 36 }];
  layout.totalLines = 1;
  const calls = [];
  const scope = {
    FONT_SIZE: 16, LINE_H: 24, TEXT_PAD: 16, VIEWPORT_TEXT_DRAW_STATS_DISABLED: {},
    objectsMap: new Map([[obj.id, obj]]), editingId: obj.id,
    _editEl: { selectionStart: 1, selectionEnd: 4 }, _caretVisible: true,
    performance: { now: () => 0 }, TextSelDebug: { _logDraw() {} },
    window: { devicePixelRatio: 2 },
    boardRenderer: loadRenderer().createBoardRenderer({ fontSize: 16,canvasBackgroundColor:()=> '#1c1b22' }),
    getTextLayoutForViewport: () => layout,
    lineXAtOffset: (_line, owner, offset) => owner.x + 16 + offset * 8,
    lineCaretXAtOffset: (_line, owner, offset) => owner.x + 16 + offset * 8,
    drawTextLineRange() { assert.fail('editing text should use the GPU layout once'); },
  };
  vm.createContext(scope); vm.runInContext(overlay, scope);
  const context = {
    fillStyle:'#fbfbfe',globalAlpha:1,
    save() {}, restore() {}, beginPath() {},clipRect(...rect){assert.deepEqual(rect,[10,20,180,80]);},
    rect() { calls.push('selection'); }, fill() {}, fillRect(_x,_y,w,h) {
      if(w===180&&h===80){assert.equal(this.fillStyle,'#1c1b22');assert.equal(this.globalAlpha,1);calls.push('background');}
      else calls.push('caret');
    },
    drawTextLayout(lines, owner, options) {
      assert.strictEqual(lines, layout); assert.strictEqual(owner, obj);
      assert.equal(options.fontSize, 16); calls.push('glyphs'); return true;
    },
  };
  const viewport = { x1: 0, y1: 0, x2: 200, y2: 100 };
  const selected = scope.drawEditingTextOverlay(context, 1, viewport, true);
  assert.deepEqual(calls, ['background', 'selection', 'glyphs']);
  assert.equal(selected.editDrawnTextLines, 1); assert.equal(selected.editCaretDrawn, false);
  calls.length = 0; scope._editEl.selectionStart = 3; scope._editEl.selectionEnd = 3;
  const collapsed = scope.drawEditingTextOverlay(context, 1, viewport, true);
  assert.deepEqual(calls, ['background', 'glyphs', 'caret']);
  assert.equal(collapsed.editCaretDrawn, true);
  scope.getTextLayoutForViewport = (_obj, rect) => {
    assert.deepEqual(JSON.parse(JSON.stringify(rect)), { x1: -21.25, y1: -21.25, x2: 221.25, y2: 121.25 });
    return layout;
  };
  scope.drawEditingTextOverlay(context, .1, viewport, true);
});

for(const gpu of [false,true])test(`opaque text editing preserves ordered scene composition with ${gpu?'GPU':'Canvas2D'} rendering`, () => {
  const source = read('src/js/viewport.js');
  const drawBoard = source.slice(source.indexOf('function drawBoard'), source.indexOf('function applyTransform'));
  const calls = [], objects = [{ id: 'a', type: 'text' }, { id: 'b', type: 'image' }, { id: 'editing', type: 'text' }];
  const context = {
    isBoardfishGpuContext: gpu,
    beginFrame(current) { assert.strictEqual(current, objects); calls.push('begin'); },
    endFrame() { calls.push('end'); }, resetTransform() {},
    drawImage() { assert.fail('GPU editing must not flatten the image-only cache above or below all text'); },
  };
  const scope = {
    ctx: context, objects, editingId: 'editing', _boardOpening: false, _offscreenDirty: true,
    boardRenderer:{opaqueTextBackgrounds:true},
    ViewportDebug: { isEnabled: () => false }, OpenDebug: {},
    window: { devicePixelRatio: 2 }, boardCanvas: { width: 400, height: 256 }, zoom: 1,
    syncBoardCanvasBackingStore() {},
    viewportWorldRect: () => ({ x1: 0, y1: 0, x2: 200, y2: 128 }),
    _rebuildOffscreen() { assert.fail('GPU scene resources already retain images'); },
    fillBoardBackground() { calls.push('background'); }, setWorldCanvasTransform() {},
    drawVisibleObjects(_context, _counters, _viewport, _resolver, omitted, onlyText) {
      assert.equal(omitted, 'editing'); assert.equal(onlyText, undefined);
      calls.push('scene text', 'scene image'); return { drawnText: 1, drawnImages: 1 };
    },
    drawEditingTextOverlay() { calls.push('editing overlay'); },
  };
  vm.createContext(scope); vm.runInContext(drawBoard, scope); scope.drawBoard();
  assert.deepEqual(calls, ['begin', 'background', 'scene text', 'scene image', 'editing overlay', 'end']);
});

test('new board disposes GPU resources and board replacement maps reused IDs to new objects', () => {
  const old = { id: 'obj-1', type: 'text', data: { content: 'old' } };
  const replacement = { id: 'obj-1', type: 'text', data: { content: 'new' } };
  const resets = [];
  const scope = {
    objects: [old], objectsMap: new Map([[old.id, old]]),
    selectedId: old.id, selectedIds: new Set([old.id]), editingId: null,
    idCounter: 40, zCounter: 40,
    ctx: { resetResources() { resets.push(scope.objects.slice()); } },
    normalizeTextContent: (text) => String(text), syncAllTextAutoHeights() {},
    clearTextLayoutCaches() {},
  };
  vm.createContext(scope); vm.runInContext(read('src/js/editor_state_boundary.js'), scope);
  scope.BoardfishEditorState.replaceBoardObjects([replacement]);
  assert.strictEqual(scope.objectsMap.get('obj-1'), replacement);
  assert.strictEqual(scope.objects[0], replacement);
  scope.BoardfishEditorState.resetBoardObjectState();
  assert.equal(resets.length, 1); assert.equal(scope.objects.length, 0);
  assert.equal(scope.idCounter, 1); assert.equal(scope.zCounter, 1);
});

test('failed GPU initialization reacquires Canvas2D on a replacement canvas when GL claimed the original', () => {
  const source = read('src/app.js');
  const initSource = source.slice(0, source.indexOf('var ctxMenu'));
  const calls = [], canvas2d = {};
  const replacement = { getContext(type) { calls.push(`replacement:${type}`); return canvas2d; } };
  const original = {
    getContext(type) { calls.push(`original:${type}`); return null; },
    cloneNode(deep) { assert.equal(deep, false); return replacement; },
    replaceWith(next) { assert.strictEqual(next, replacement); calls.push('replace'); },
  };
  const font = {};
  const scope = {
    document: { getElementById: (id) => id === 'board-canvas' ? original : {} },
    BoardfishAsciiFont: font,
    BoardfishGpuRenderer: { createContext(canvas, options) {
      assert.strictEqual(canvas, original); assert.strictEqual(options.font, font);
      calls.push('GPU attempt'); throw new Error('shader compilation failed');
    } },
  };
  vm.createContext(scope); vm.runInContext(initSource, scope);
  assert.strictEqual(scope.ctx, canvas2d); assert.strictEqual(scope.boardCanvas, replacement);
  assert.deepEqual(calls, ['GPU attempt', 'original:2d', 'replace', 'replacement:2d']);
});

test('dev and production load the bundled ASCII font and GPU backend before claiming the app canvas', async () => {
  const manifest = await import(pathToFileURL(path.join(root, 'src/js/startup_manifest.mjs')).href);
  for (const scripts of [manifest.WEB_DEV_SCRIPTS, manifest.WEB_PREVIEW_SCRIPTS]) {
    const font = scripts.indexOf('../fonts/geist-ascii-msdf.js');
    const backend = scripts.indexOf('gpu_renderer.js'), app = scripts.indexOf('../app.js');
    assert.ok(font >= 0 && font < backend && backend < app);
    assert.equal(scripts.filter((script) => script === 'gpu_renderer.js').length, 1);
  }
  const serviceWorker = read('src/sw.js');
  assert.match(serviceWorker, /['"]\.\/fonts\/geist-ascii-msdf\.png['"]/);
  const scope = { self: { registration: { scope: 'https://example.test/board/' }, location: { href: 'https://example.test/board/sw.js' } }, caches: { open() {} }, URL };
  vm.createContext(scope);
  vm.runInContext(serviceWorker.slice(0, serviceWorker.indexOf('function matchCurrentCache')), scope);
  vm.runInContext(read('src/fonts/geist-ascii-coverage.js'),scope);
  for (const atlas of ['fonts/geist-ascii-msdf.png', 'fonts/geist-ascii-large-msdf.png',scope.BoardfishAsciiCoverageFont.atlasURL]) {
    const atlasUrl = new URL(atlas,'https://example.test/board/');
    assert.equal(scope.isAppShellUrl(atlasUrl), true);
    assert.equal(scope.isCacheFirstAssetUrl(atlasUrl), true);
    assert.equal(scope.shouldCacheRequest({ mode: 'cors' }, atlasUrl), true);
  }
});

test('bundled ASCII atlas metadata covers every printable glyph and matches PNG dimensions', () => {
  const scope = {}; vm.createContext(scope); vm.runInContext(read('src/fonts/geist-ascii-msdf.js'), scope);
  const primary = scope.BoardfishAsciiFont;
  assert.ok(primary.largeFont, 'large-zoom distance data must be bundled before runtime');
  for (const font of [primary, primary.largeFont]) {
    assert.equal(font.type, 'msdf'); assert.equal(font.glyphs.length, 128);
    assert.ok(font.glyphs[32].advance > 0); assert.equal(font.glyphs[32].planeBounds, undefined);
    for (let code = 33; code <= 126; code++) {
      const glyph = font.glyphs[code];
      assert.ok(glyph, `ASCII ${code} must exist`);
      const plane = glyph.planeBounds, atlas = glyph.atlasBounds;
      assert.ok(plane.right > plane.left && plane.top > plane.bottom);
      assert.ok(atlas.left >= 0 && atlas.right <= font.width && atlas.bottom >= 0 && atlas.top <= font.height);
      assert.ok(Math.abs((plane.right - plane.left) * font.emSize - (atlas.right - atlas.left)) < 1e-5);
      assert.ok(Math.abs((plane.top - plane.bottom) * font.emSize - (atlas.top - atlas.bottom)) < 1e-5);
      assert.equal(glyph.advance, primary.glyphs[code].advance, 'zoom must preserve the same font metrics');
    }
    const png = fs.readFileSync(path.join(root, 'src', font.atlasURL));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), font.width); assert.equal(png.readUInt32BE(20), font.height);
  }
});
