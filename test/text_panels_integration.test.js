'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const stripDiagnostics = value => value.replace(/\/\* BOARDFISH_DEV_DIAGNOSTICS_START \*\/[\s\S]*?\/\* BOARDFISH_DEV_DIAGNOSTICS_END \*\//g, '');
const viewport = { x1: 0, y1: 0, x2: 800, y2: 600 };
const text = (id, x = 100, y = 100, w = 300, h = 160) => ({ id, type: 'text', x, y, w, h, data: { content: 'ASCII text' } });
const image = (id, x, y, w, h) => ({ id, type: 'image', x, y, w, h, data: { imgKey: id, rotation: 0 } });
const computedMenuStyle = () => ({
  backgroundColor: 'rgb(66, 65, 77)', borderTopColor: 'rgb(112, 112, 122)', color: 'rgb(251, 251, 254)',
  borderTopLeftRadius: '16px', borderTopWidth: '1px',
  boxShadow: 'rgba(0, 0, 0, 0.1) 0px 8px 24px 0px, rgba(0, 0, 0, 0.3) 0px 0px 0px 1px',
});

function runtime(production, overrides = {}) {
  const context = { console, ...overrides };
  if (production) context.BOARDFISH_PRODUCTION = true;
  vm.createContext(context);
  context.runSource = (name, value = source(name)) => vm.runInContext(production ? stripDiagnostics(value) : value, context, { filename: name });
  for (const name of ['js/object_geometry.js', 'js/text_panels.js', 'js/panel_visibility.js', 'js/renderer.js']) context.runSource(name);
  return context;
}

function fixture(production, objects, options = {}) {
  const events = [], layouts = [], resolves = [];
  const menu = {};
  const runtimeContext = runtime(production, {
    document: { getElementById: id => id === 'ctx-menu' ? menu : null },
    getComputedStyle: () => computedMenuStyle(),
  });
  const sources = Object.fromEntries(objects.filter(obj => obj.type === 'image').map(obj => [obj.id, { id: obj.id, width: 100, height: 100 }]));
  const context = {
    fillStyle: '#000', textAlign: 'left',
    setTransform() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    drawTextPanel(obj, style, drawOptions) { events.push(['panel', obj.id, drawOptions.phase || 'all']);return true; },
    drawTextLayout(layout, obj) { events.push(['glyphs', obj.id, this.fillStyle]);return true; },
    drawImage(img) { events.push(['image', img.id]); },
  };
  const renderer = runtimeContext.BoardfishRenderer.createBoardRenderer({
    objects: () => objects, editingObject: () => options.editing || null,
    currentViewportWorldRect: () => options.viewport || viewport, viewportCullingEnabled: () => true,
    zoom: () => 1, dpr: () => 1, panX: () => 0, panY: () => 0,
    canvasTextColor: () => '#fff', font: '16px Geist',
    getTextLayoutForViewport(obj, rect) { layouts.push(obj.id);return [{ text: obj.data.content, y: obj.y + 16 }]; },
    drawTextLineRange() { throw new Error('unexpected text fallback'); },
    imageBitmapCache: () => sources, imageStore: () => sources,
    selectImageSourceForDraw(key) { resolves.push(key);return { source: sources[key], scale: 1, targetScale: 1 }; },
    objectIntersectsRect: (obj, rect) => !rect || obj.x <= rect.x2 && obj.x + obj.w >= rect.x1 && obj.y <= rect.y2 && obj.y + obj.h >= rect.y1,
  });
  const draw = ({ rect = options.viewport || viewport, resolver = null, skipId = null, onlyText = false } = {}) => {
    const args = [context, rect, resolver, skipId, onlyText];
    if (!production) args.splice(1, 0, null);
    return renderer.drawVisibleObjects(...args);
  };
  return { runtimeContext, context, renderer, events, layouts, resolves, draw };
}

for (const production of [false, true]) {
  const label = production ? 'stripped production' : 'development';

  test(`${label}: each text panel and glyph run retain painter order with intervening images`, () => {
    const a = text('a', 20, 20, 100, 100), img = image('image', 160, 20, 100, 100), b = text('b', 320, 20, 100, 100);
    const f = fixture(production, [a, img, b]);f.draw();
    assert.deepEqual(f.events, [
      ['panel', 'a', 'all'], ['glyphs', 'a', 'rgb(251, 251, 254)'],
      ['image', 'image'], ['panel', 'b', 'all'], ['glyphs', 'b', 'rgb(251, 251, 254)'],
    ]);
    assert.deepEqual(f.layouts, ['a', 'b']);
    assert.deepEqual(f.resolves, ['image']);
  });

  test(`${label}: fully covered text and images do not lay out, resolve sources, or submit draws`, () => {
    const lower = text('lower', 150, 150, 100, 100), img = image('image', 150, 150, 100, 100);
    const upper = text('upper', 80, 80, 240, 250);
    const f = fixture(production, [lower, img, upper]);f.draw();
    assert.deepEqual(f.events.map(value => value.slice(0, 2)), [['panel', 'upper'], ['glyphs', 'upper']]);
    assert.deepEqual(f.layouts, ['upper']);assert.deepEqual(f.resolves, []);
    const calls = [];
    f.draw({ resolver: key => { calls.push(key);throw new Error('covered image source was requested'); } });
    assert.deepEqual(calls, []);
  });

  test(`${label}: identical stacks skip lower glyph layouts while preserving panel shadows`, () => {
    const lower = text('lower'), upper = text('upper');
    const f = fixture(production, [lower, upper]);f.draw();
    assert.deepEqual(f.events.map(value => value.slice(0, 2)), [['panel', 'lower'], ['panel', 'upper'], ['glyphs', 'upper']]);
    assert.deepEqual(f.layouts, ['upper']);
  });

  test(`${label}: a covered body with an exposed shadow tail submits only the shadow phase`, () => {
    const lower = text('lower', 150, 150, 100, 100), upper = text('upper', 80, 80, 240, 200);
    const f = fixture(production, [lower, upper]);f.draw();
    assert.deepEqual(f.events[0], ['panel', 'lower', 'shadow']);
    assert.deepEqual(f.layouts, ['upper']);
  });

  test(`${label}: a panel is retained when only its shadow intersects the viewport`, () => {
    const obj = text('shadow-only', 100, -80, 100, 50);
    const f = fixture(production, [obj]);f.draw();
    assert.equal(f.events[0][0], 'panel');assert.equal(f.events[0][1], 'shadow-only');
  });

  test(`${label}: the editing panel occludes the main pass and is then painted before selection, glyphs, and caret`, () => {
    const editing = text('editing', 60, 60, 350, 350);
    const lower = text('lower', 150, 150, 100, 100), img = image('image', 160, 160, 50, 50);
    const f = fixture(production, [editing, lower, img], { editing });
    f.draw({ skipId: editing.id });
    assert.deepEqual(f.events, []);assert.deepEqual(f.layouts, []);assert.deepEqual(f.resolves, []);
    Object.assign(f.runtimeContext, {
      objectsMap: new Map([[editing.id, editing]]), editingId: editing.id,
      _editEl: { selectionStart: 0, selectionEnd: 1 }, _caretVisible: true,
      FONT_SIZE: 16, TEXT_PAD: 16, LINE_H: 24,
      getTextLayoutForViewport: obj => [{ text: obj.data.content }],
      drawTextSelectionHighlight: () => { f.events.push(['selection']);return {}; },
      drawCaret: () => { f.events.push(['caret']);return true; },
    });
    const viewportSource = source('js/viewport.js');
    const begin = viewportSource.indexOf('function drawEditingTextOverlay('), end = viewportSource.indexOf('\nfunction drawBoard(', begin);
    assert.ok(begin >= 0 && end > begin);
    f.runtimeContext.runSource('editing-overlay.js', viewportSource.slice(begin, end));
    f.runtimeContext.drawEditingTextOverlay(f.context, 1, viewport);
    assert.deepEqual(f.events.map(value => value.slice(0, 2)), [['panel', 'editing'], ['selection'], ['glyphs', 'editing']]);
    f.events.length = 0;f.runtimeContext._editEl.selectionEnd = 0;
    f.runtimeContext.drawEditingTextOverlay(f.context, 1, viewport);
    assert.deepEqual(f.events.map(value => value.slice(0, 2)), [['panel', 'editing'], ['glyphs', 'editing'], ['caret']]);
  });

  test(`${label}: null viewport metadata cannot hide existing content`, () => {
    const lower = text('lower'), upper = text('upper');
    const f = fixture(production, [lower, upper]);f.draw({ rect: null });
    assert.deepEqual(f.layouts, ['lower', 'upper']);
  });
}

test('computed menu CSS parses comma-separated rgba shadows, caches reads, and refreshes coherently', () => {
  let reads = 0, css = computedMenuStyle();
  const menu = {}, context = runtime(false, {
    document: { getElementById: id => id === 'ctx-menu' ? menu : null },
    getComputedStyle: element => { assert.equal(element, menu);reads++;return css; },
  });
  const panels = context.BoardfishTextPanels, style = panels.getStyle();
  assert.equal(style.fill, 'rgb(66, 65, 77)');assert.equal(style.border, 'rgb(112, 112, 122)');
  assert.equal(style.radius, 16);assert.equal(style.borderWidth, 1);assert.equal(style.text, 'rgb(251, 251, 254)');
  assert.equal(style.shadowColor, 'rgba(0, 0, 0, 0.1)');assert.equal(style.shadowBlur, 24);
  assert.equal(style.shadowOffsetX, 0);assert.equal(style.shadowOffsetY, 8);
  assert.equal(style.outlineColor, 'rgba(0, 0, 0, 0.3)');assert.equal(style.outlineWidth, 1);
  for (let i = 0; i < 50; i++) assert.equal(panels.getStyle(), style);
  assert.equal(reads, 1);
  css = { ...css, borderTopLeftRadius: '20px', boxShadow: 'none' };
  const changed = panels.refreshStyle();assert.equal(reads, 2);assert.equal(changed.radius, 20);
  assert.equal(changed.shadowBlur, 0);assert.equal(changed.outlineWidth, 0);
  assert.equal(panels.getStyle(), changed);assert.equal(reads, 2);
});

test('theme changes refresh panel colors before rendering and keep text legible on dark panels in light mode', () => {
  let reads = 0, repaints = 0;
  const context = runtime(true, {
    document: { body: { dataset: {} }, getElementById: () => ({}) },
    getComputedStyle: () => { reads++;return computedMenuStyle(); },
    appTheme: 'dark', appThemeMeta: null, _canvasTextColor: '#fbfbfe',
    normalizeAppTheme: value => value, repaintBoardForThemeChange: () => { repaints++; },
  });
  const appSource = source('app.js'), start = appSource.indexOf('function applyAppTheme('), end = appSource.indexOf('\nfunction toggleAppTheme(', start);
  assert.ok(start >= 0 && end > start);
  context.runSource('apply-theme.js', appSource.slice(start, end));
  context.applyAppTheme('light');
  assert.equal(context.document.body.dataset.theme, 'light');
  assert.equal(context._canvasTextColor, 'rgb(251, 251, 254)');
  assert.equal(context.BoardfishTextPanels.getStyle().fill, 'rgb(66, 65, 77)');
  assert.equal(reads, 1);assert.equal(repaints, 1);
  context.applyAppTheme('dark');assert.equal(reads, 2);assert.equal(repaints, 2);
});

test('hit testing follows opaque squircle geometry and passes through transparent corners and shadows', () => {
  const context = runtime(false), lower = image('lower', 0, 0, 600, 400), upper = text('upper');
  const geometry = context.BoardfishObjectGeometry.createObjectGeometry({ objects: () => [lower, upper] });
  assert.equal(geometry.topObjectAtWorldPoint({ x: 100, y: 100 }), lower);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 150, y: 280 }), lower);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 108, y: 108 }), upper);
  assert.equal(geometry.topObjectAtWorldPoint({ x: 150, y: 150 }), upper);
});
