'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderer(overrides = {}) {
  const context = { console, ...overrides };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'renderer.js'), 'utf8'),
    context,
    { filename: 'renderer.js' },
  );
  const api = context.BoardfishRenderer;
  const helpers = api.createBoardRenderer({});
  return {
    createBoardRenderer: api.createBoardRenderer,
    createDrawCounters: helpers.createDrawCounters,
    resetCanvasToScreen: helpers.resetCanvasToScreen,
  };
}

function loadMotion(overrides = {}) {
  let currentTime = 0;
  const styleVars = new Map();
  const timers = [];
  const renderCalls = [];
  const context = {
    console: { ...console, warn() {} },
    document: {
      documentElement: {
        style: {
          setProperty(name, value) {
            styleVars.set(name, value);
          },
        },
      },
    },
    matchMedia: () => ({ matches: false }),
    performance: { now: () => currentTime },
    requestAnimationFrame: () => 0,
    scheduleRender(board, overlay, source) {
      renderCalls.push({ board, overlay, source });
    },
    setTimeout(callback, ms) {
      timers.push({ callback, ms });
      return timers.length;
    },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'motion.js'), 'utf8'),
    context,
    { filename: 'motion.js' },
  );
  return {
    context,
    renderCalls,
    styleVars,
    timers,
    setTime(ms) {
      currentTime = ms;
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertClose(actual, expected, epsilon = 1e-7, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message || `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function motionRestDistance(motion) {
  if (!motion) return 0;
  return Math.hypot(
    motion.translateX || 0,
    motion.translateY || 0,
    (motion.scaleX ?? 1) - 1,
    (motion.scaleY ?? 1) - 1,
  );
}

test('text renderer uses the latest measured baseline offset', () => {
  const BoardfishRenderer = loadRenderer();
  let baselineOffset = 10;
  const fillTextCalls = [];
  const context = {
    fillStyle: '',
    textBaseline: '',
    fillText(text, x, y) {
      fillTextCalls.push({ text, x, y });
    },
  };
  const obj = { type: 'text', x: 20, y: 30 };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    getWrappedLines: () => [{ text: 'one' }, { text: 'two' }],
    lineHeight: 24,
    dpr: () => 1,
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => baselineOffset,
    textPad: 4,
    zoom: () => 1,
  });

  baselineOffset = 12;
  renderer.drawSingleObj(context, obj);

  assert.deepEqual(fillTextCalls, [
    { text: 'one', x: 24, y: 46 },
    { text: 'two', x: 24, y: 70 },
  ]);
});

test('screen canvas reset restores full-opacity source-over drawing', () => {
  const BoardfishRenderer = loadRenderer();
  const calls = [];
  const context = {
    globalAlpha: 0.42,
    globalCompositeOperation: 'multiply',
    setTransform(...args) {
      calls.push(args);
    },
  };

  BoardfishRenderer.resetCanvasToScreen(context);

  assert.deepEqual(calls, [[1, 0, 0, 1, 0, 0]]);
  assert.equal(context.globalAlpha, 1);
  assert.equal(context.globalCompositeOperation, 'source-over');
});

test('image renderer crops untransformed images to the visible viewport', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
  };
  const counters = BoardfishRenderer.createDrawCounters();
  const source = {
    complete: true,
    naturalWidth: 200,
    naturalHeight: 100,
    width: 200,
    height: 100,
  };
  const obj = { type: 'image', x: -10, y: 20, w: 100, h: 50, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 25, x2: 60, y2: 45 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({}),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, null, {
    viewportRect: { x1: 0, y1: 25, x2: 60, y2: 45 },
  });
  drawImageCalls.length = 0;
  const result = renderer.drawVisibleObjects(context, counters, {
    viewportRect: { x1: 0, y1: 25, x2: 60, y2: 45 },
  });

  assert.equal(result.drawnImages, 1);
  assert.equal(result.drawnText, 0);
  assert.equal(counters.croppedImages, 1);
  assert.equal(counters.imageSourceDraws, 1);
  assert.equal(counters.imageSourceFirstDraws, 1);
  assert.equal(counters.imageSourceWarmDraws, 0);
  assert.equal(counters.imageContextFirstDraws, 1);
  assert.equal(counters.imageContextWarmDraws, 0);
  assert.equal(counters.fullScaleImageContextFirstDraws, 1);
  assert.deepEqual(drawImageCalls, [[
    source,
    20,
    10,
    120,
    40,
    0,
    25,
    60,
    20,
  ]]);

  drawImageCalls.length = 0;
  const warmCounters = BoardfishRenderer.createDrawCounters();
  renderer.drawVisibleObjects(context, warmCounters, {
    viewportRect: { x1: 0, y1: 25, x2: 60, y2: 45 },
  });

  assert.equal(warmCounters.imageSourceFirstDraws, 0);
  assert.equal(warmCounters.imageSourceWarmDraws, 1);
  assert.equal(warmCounters.imageContextFirstDraws, 0);
  assert.equal(warmCounters.imageContextWarmDraws, 1);

  const nextContextCounters = BoardfishRenderer.createDrawCounters();
  renderer.drawVisibleObjects({
    drawImage() {},
  }, nextContextCounters, {
    viewportRect: { x1: 0, y1: 25, x2: 60, y2: 45 },
  });

  assert.equal(nextContextCounters.imageSourceFirstDraws, 0);
  assert.equal(nextContextCounters.imageSourceWarmDraws, 1);
  assert.equal(nextContextCounters.imageContextFirstDraws, 1);
  assert.equal(nextContextCounters.imageContextWarmDraws, 0);
  assert.equal(nextContextCounters.fullScaleImageContextFirstDraws, 1);
});

test('image renderer overdraws image edges by one device pixel at the current view scale', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
  };
  const source = {
    complete: true,
    naturalWidth: 80,
    naturalHeight: 60,
    width: 80,
    height: 60,
  };
  const obj = { type: 'image', x: 10, y: 20, w: 40, h: 30, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 100, y2: 100 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, BoardfishRenderer.createDrawCounters(), {
    viewportRect: { x1: 0, y1: 0, x2: 100, y2: 100 },
    view: { zoom: 2, dpr: 2, panX: 0, panY: 0 },
  });

  assert.deepEqual(drawImageCalls, [[source, 9.75, 19.75, 40.5, 30.5]]);
});

test('image renderer keeps active full fallback visible with temporary low smoothing', () => {
  const BoardfishRenderer = loadRenderer();
  const drawQualities = [];
  const drawSmoothingEnabled = [];
  const context = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    drawImage() {
      drawSmoothingEnabled.push(this.imageSmoothingEnabled);
      drawQualities.push(this.imageSmoothingQuality);
    },
  };
  const source = {
    complete: true,
    naturalWidth: 4000,
    naturalHeight: 4000,
    width: 4000,
    height: 4000,
  };
  const obj = { type: 'image', x: 10, y: 20, w: 500, h: 500, data: { imgKey: 'img-1' } };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 1000, y2: 1000 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({
      source,
      scale: 1,
      targetScale: 0.25,
      scaledVariantPending: true,
      activeInputFullFallback: true,
    }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 0.1,
  });

  const result = renderer.drawVisibleObjects(context, counters);

  assert.equal(result.drawnImages, 1);
  assert.deepEqual(drawSmoothingEnabled, [false]);
  assert.equal(context.imageSmoothingEnabled, true);
  assert.deepEqual(drawQualities, ['low']);
  assert.equal(context.imageSmoothingQuality, 'high');
  assert.equal(counters.scaledFallbackFull, 1);
  assert.equal(counters.activeInputFullFallbackImages, 1);
});

test('animated image motion bypasses static culling and uses low-latency variant selection', () => {
  const BoardfishRenderer = loadRenderer();
  const drawSmoothingEnabled = [];
  const drawQualities = [];
  const selectCalls = [];
  const context = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    drawImage() {
      drawSmoothingEnabled.push(this.imageSmoothingEnabled);
      drawQualities.push(this.imageSmoothingQuality);
    },
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    scale() {},
  };
  const source = {
    complete: true,
    naturalWidth: 4000,
    naturalHeight: 4000,
    width: 4000,
    height: 4000,
  };
  const obj = { id: 'img-motion', type: 'image', x: 10, y: 20, w: 500, h: 500, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 1000, y2: 1000 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => false,
    objectMotionForDraw: () => ({ opacity: 1, translateY: -3 }),
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw(key, selectedObj, fullSource, view, options) {
      selectCalls.push({ key, selectedObj, fullSource, view, options });
      return { source, scale: 1, targetScale: 1 };
    },
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const counters = BoardfishRenderer.createDrawCounters();
  const result = renderer.drawVisibleObjects(context, counters);

  assert.equal(result.drawnImages, 1);
  assert.deepEqual(plain(selectCalls.map((call) => call.options)), [{ activeInput: true }]);
  assert.deepEqual(drawSmoothingEnabled, [false]);
  assert.equal(context.imageSmoothingEnabled, true);
  assert.deepEqual(drawQualities, ['low']);
  assert.equal(context.imageSmoothingQuality, 'high');
  assert.equal(counters.motionObjects, 1);
  assert.equal(counters.motionImages, 1);
  assert.equal(counters.motionTranslatedObjects, 1);
  assert.equal(counters.lowLatencyImageDraws, 1);
  assert.equal(counters.motionFullScaleImages, 1);
});

test('renderer does not redraw finished exit-motion objects', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
  };
  const source = {
    complete: true,
    naturalWidth: 20,
    naturalHeight: 20,
    width: 20,
    height: 20,
  };
  const removedObj = { id: 'removed-1', type: 'image', x: 0, y: 0, w: 20, h: 20, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: -10, y1: -10, x2: 40, y2: 40 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    motionObjectsForDraw: () => [removedObj],
    objectIntersectsRect: () => true,
    objectMotionForDraw: () => ({ opacity: 0, scale: 0.92, skip: true }),
    objects: () => [],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects(context, BoardfishRenderer.createDrawCounters());

  assert.equal(result.drawnImages, 0);
  assert.deepEqual(drawImageCalls, []);
});

test('renderer can skip text while drawing visible objects', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const fillTextCalls = [];
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
    fillText(...args) {
      fillTextCalls.push(args);
    },
  };
  const source = {
    complete: true,
    naturalWidth: 20,
    naturalHeight: 20,
    width: 20,
    height: 20,
  };
  const image = { id: 'img-1', type: 'image', x: 0, y: 0, w: 20, h: 20, data: { imgKey: 'img-1' } };
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 20, h: 20 };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 30, y2: 30 }),
    dpr: () => 1,
    getWrappedLines: () => [{ text: 'hidden' }],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [image, text],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects(context, BoardfishRenderer.createDrawCounters(), { skipText: true });

  assert.equal(result.drawnImages, 1);
  assert.equal(result.drawnText, 0);
  assert.equal(drawImageCalls.length, 1);
  assert.deepEqual(fillTextCalls, []);
});

test('renderer can draw only text while drawing visible objects', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const drawnText = [];
  const source = {
    width: 20,
    height: 20,
  };
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
    fillText(text) {
      drawnText.push(text);
    },
    setTransform() {},
    translate() {},
    rotate() {},
    scale() {},
    save() {},
    restore() {},
  };
  const image = { id: 'img-1', type: 'image', x: 0, y: 0, w: 20, h: 20, data: { imgKey: 'img-1' } };
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 20, h: 20 };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 30, y2: 30 }),
    dpr: () => 1,
    getWrappedLines: () => [{ text: 'drawn' }],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [image, text],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects(context, BoardfishRenderer.createDrawCounters(), { onlyText: true });

  assert.equal(result.drawnImages, 0);
  assert.equal(result.drawnText, 1);
  assert.deepEqual(drawImageCalls, []);
  assert.deepEqual(drawnText, ['drawn']);
});

test('renderer can skip arbitrary object ids while drawing visible objects', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnText = [];
  const textA = { id: 'text-a', type: 'text', x: 0, y: 0, w: 80, h: 24, data: { content: 'skip' } };
  const textB = { id: 'text-b', type: 'text', x: 0, y: 30, w: 80, h: 24, data: { content: 'draw' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 120, y2: 80 }),
    dpr: () => 1,
    drawTextLineRange(_context, line) {
      drawnText.push(line.text);
    },
    getTextLayout: (obj) => [{ text: obj.data.content, y: obj.y }],
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [textA, textB],
    panX: () => 0,
    panY: () => 0,
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects({}, BoardfishRenderer.createDrawCounters(), {
    skipIds: new Set(['text-a']),
  });

  assert.equal(result.drawnText, 1);
  assert.deepEqual(drawnText, ['draw']);
});

test('text renderer skips layout lines outside the visible viewport', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnLines = [];
  const context = {
    fillStyle: '',
    textBaseline: '',
  };
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 96 };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 200, y2: 47 }),
    dpr: () => 1,
    drawTextLineRange(_context, line) {
      drawnLines.push(line.text);
    },
    getTextLayout: () => [
      { text: 'above', y: -48 },
      { text: 'visible', y: 0 },
      { text: 'below', y: 48 },
    ],
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects(context, counters);

  assert.equal(result.drawnText, 1);
  assert.deepEqual(drawnLines, ['visible']);
  assert.equal(counters.textLines, 3);
  assert.equal(counters.drawnTextLines, 1);
  assert.equal(counters.culledTextLines, 2);
});

test('production text drawing skips debug stats allocation', () => {
  const BoardfishRenderer = loadRenderer();
  const collectStatsOptions = [];
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 24, data: { content: 'plain' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 200, y2: 40 }),
    dpr: () => 1,
    drawTextLineRange(_context, _line, _obj, _start, _end, options) {
      collectStatsOptions.push(options.collectStats);
      return null;
    },
    getTextLayout: () => [{ text: 'plain', y: 0 }],
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects({ fillStyle: '', textBaseline: '' }, null);

  assert.deepEqual(collectStatsOptions, [false]);
});

test('text context configuration is reapplied after canvas state resets', () => {
  const BoardfishRenderer = loadRenderer();
  let configurationWrites = 0;
  const context = { fillStyle: '', textBaseline: '' };
  const configuredValues = new Map();
  for (const property of ['fontKerning', 'letterSpacing', 'fontStretch', 'fontVariantCaps', 'textAlign', 'direction']) {
    Object.defineProperty(context, property, {
      configurable: true,
      get() {
        return configuredValues.get(property);
      },
      set(value) {
        configurationWrites++;
        configuredValues.set(property, value);
      },
    });
  }
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 24, data: { content: 'plain' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    dpr: () => 1,
    drawTextLineRange() {},
    getTextLayout: () => [{ text: 'plain', y: 0 }],
    getWrappedLines: () => [],
    lineHeight: 24,
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    zoom: () => 1,
  });

  renderer.drawSingleObj(context, text);
  configuredValues.clear();
  renderer.drawSingleObj(context, text);

  assert.equal(configurationWrites, 12);
  assert.deepEqual(Object.fromEntries(configuredValues), {
    direction: 'ltr',
    fontKerning: 'none',
    fontStretch: 'normal',
    fontVariantCaps: 'normal',
    letterSpacing: '0px',
    textAlign: 'left',
  });
});

test('text renderer keeps rich text drawing at low zoom instead of switching to fast text', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnText = [];
  const rects = [];
  let layoutCalls = 0;
  const context = {
    fillStyle: '',
    textBaseline: '',
    fillRect(...args) {
      rects.push(args);
    },
  };
  const text = { id: 'text-1', type: 'text', x: 10, y: 20, w: 200, h: 32 };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 300, y2: 100 }),
    dpr: () => 2,
    drawTextLineRange(_context, line, _obj, _start, _end, options = {}) {
      drawnText.push(line.text);
      assert.equal(options.fast, undefined);
      return {
        chars: line.text.length,
        drawnChars: line.text.length,
        drawUnits: line.text.length,
        drawCalls: 2,
        runs: 1,
        plainRuns: 1,
        scriptRuns: 0,
        skippedTabs: 0,
        hiddenChars: 0,
        fontSwitches: 0,
      };
    },
    getTextLayout() {
      layoutCalls++;
      return [{ text: 'tiny', y: 20, prefixWidths: [0, 12, 24, 36, 48] }];
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 0.2,
  });

  renderer.drawVisibleObjects(context, counters);

  assert.deepEqual(drawnText, ['tiny']);
  assert.equal(rects.length, 0);
  assert.equal(layoutCalls, 1);
  assert.equal(counters.textLines, 1);
  assert.equal(counters.drawnTextLines, 1);
  assert.equal(counters.culledTextLines, 0);
  assert.equal(counters.richTextChars, 4);
  assert.equal(counters.richTextDrawUnits, 4);
  assert.equal(counters.richTextDrawCalls, 2);
  assert.equal(counters.richTextRuns, 1);
  assert.equal(counters.richTextPlainRuns, 1);
  assert.equal(counters.richTextScriptRuns, 0);
  assert.equal(counters.maxRichTextDrawUnitsPerLine, 4);
  assert.equal(counters.maxRichTextDrawCallsPerLine, 2);
});

test('text renderer keeps direct rich rendering', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const drawnLines = [];
  const context = {
    fillStyle: '',
    textBaseline: '',
    drawImage(...args) {
      drawImageCalls.push(args);
    },
  };
  const text = { id: 'text-1', type: 'text', x: 10, y: 20, w: 200, h: 80, data: { content: 'cached' } };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 300, y2: 160 }),
    dpr: () => 2,
    drawTextLineRange(_context, line) {
      drawnLines.push(line.text);
      return {
        chars: line.text.length,
        drawnChars: line.text.length,
        drawUnits: line.text.length,
        runs: 1,
        plainRuns: 1,
        scriptRuns: 0,
      };
    },
    getTextLayout() {
      return [
        { text: 'cached one', y: 20, textY: 36 },
        { text: 'cached two', y: 44, textY: 60 },
      ];
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, counters, {
    viewportRect: { x1: 0, y1: 0, x2: 300, y2: 160 },
    view: { zoom: 1, panX: 0, panY: 0, dpr: 2 },
  });

  assert.deepEqual(drawnLines, ['cached one', 'cached two']);
  assert.deepEqual(drawImageCalls, []);
  assert.equal(counters.textLines, 2);
  assert.equal(counters.drawnTextLines, 2);
  assert.equal(counters.richTextDirectDraws, 1);
});

test('animated text keeps direct rich rendering', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnLines = [];
  const context = {
    fillStyle: '',
    globalAlpha: 1,
    save() {},
    restore() {},
    textBaseline: '',
    translate() {},
    scale() {},
  };
  const text = { id: 'text-1', type: 'text', x: 10, y: 20, w: 200, h: 80, data: { content: 'moving' } };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 300, y2: 160 }),
    dpr: () => 2,
    drawTextLineRange(_context, line) {
      drawnLines.push(line.text);
      return {
        chars: line.text.length,
        drawnChars: line.text.length,
        drawUnits: line.text.length,
        runs: 1,
        plainRuns: 1,
        scriptRuns: 0,
      };
    },
    getTextLayout() {
      return [{ text: 'moving rich text', y: 20, textY: 36 }];
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objectMotionForDraw: () => ({ opacity: 1, translateX: 1, scale: 1 }),
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, counters);

  assert.deepEqual(drawnLines, ['moving rich text']);
  assert.equal(counters.richTextDirectDraws, 1);
});

test('text renderer records slow rich text line timing rows for debug captures', () => {
  let now = 0;
  const BoardfishRenderer = loadRenderer({
    performance: {
      now() {
        now += 1;
        return now;
      },
    },
  });
  const text = { id: 'text-1', type: 'text', x: 10, y: 20, w: 200, h: 80, data: { content: 'first line\nsecond line' } };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 300, y2: 160 }),
    dpr: () => 2,
    drawTextLineRange(_context, line) {
      return {
        chars: line.text.length,
        drawnChars: line.text.length,
        drawUnits: line.text.length,
        runs: 1,
        plainRuns: 1,
        scriptRuns: 0,
        skippedTabs: 0,
        skippedSpaces: 1,
        hiddenChars: 0,
        fontSwitches: 0,
        planCacheHits: 1,
        planCacheMisses: 0,
      };
    },
    getTextLayout() {
      return [
        { text: 'first line', y: 20, textY: 36, startIndex: 0, endIndex: 10, logicalLineIndex: 0 },
        { text: 'second line', y: 44, textY: 60, startIndex: 11, endIndex: 22, logicalLineIndex: 1 },
      ];
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 0.1,
  });

  renderer.drawVisibleObjects({ fillStyle: '', textBaseline: '' }, counters);

  assert.equal(counters.richTextLineDrawMs, 2);
  assert.equal(counters.maxRichTextLineDrawMs, 1);
  assert.equal(counters.slowRichTextLineDraws, 2);
  assert.equal(counters.slowTextLineDraws.length, 2);
  const lineRows = counters.slowTextLineDraws.slice().sort((a, b) => a.lineIndex - b.lineIndex);
  assert.equal(lineRows[0].objectId, 'text-1');
  assert.equal(lineRows[0].logicalLineIndex, 0);
  assert.equal(lineRows[0].sample, 'first line');
  assert.equal(lineRows[0].drawUnits, 10);
  assert.equal(lineRows[1].logicalLineIndex, 1);
  assert.equal(lineRows[1].sample, 'second line');
  assert.equal(counters.slowDrawObjects[0].richTextLineDrawMs, 2);
  assert.equal(counters.slowDrawObjects[0].slowRichTextLineDraws, 2);
  assert.equal(counters.slowDrawObjects[0].slowTextLineRows.length, 2);
});

test('renderer applies object motion translation and non-uniform scaling around object center', () => {
  const BoardfishRenderer = loadRenderer();
  const calls = [];
  const context = {
    globalAlpha: 1,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(x, y) { calls.push(['translate', x, y]); },
    scale(x, y) { calls.push(['scale', x, y]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
  };
  const source = {
    complete: true,
    naturalWidth: 20,
    naturalHeight: 20,
    width: 20,
    height: 20,
  };
  const obj = { id: 'obj-1', type: 'image', x: 10, y: 20, w: 40, h: 30, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 100, y2: 100 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objectMotionForDraw: () => ({ opacity: 1, translateY: -3, scaleX: 1.08, scaleY: 0.94 }),
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, BoardfishRenderer.createDrawCounters());

  assert.deepEqual(calls.slice(0, 5), [
    ['save'],
    ['translate', 0, -3],
    ['translate', 30, 35],
    ['scale', 1.08, 0.94],
    ['translate', -30, -35],
  ]);
  assert.deepEqual(calls.at(-1), ['restore']);
});

test('renderer applies motion scaling around the requested fractional object origin', () => {
  const BoardfishRenderer = loadRenderer();
  const calls = [];
  const context = {
    globalAlpha: 1,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(x, y) { calls.push(['translate', x, y]); },
    scale(x, y) { calls.push(['scale', x, y]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
  };
  const source = {
    complete: true,
    naturalWidth: 20,
    naturalHeight: 20,
    width: 20,
    height: 20,
  };
  const obj = { id: 'obj-1', type: 'image', x: 10, y: 20, w: 40, h: 30, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 100, y2: 100 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    imageTransformFromObject: () => ({ flipX: false, flipY: false, rotation: 0 }),
    imageTransformNeedsRendering: () => false,
    isSidewaysRotation: () => false,
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objectMotionForDraw: () => ({
      opacity: 1,
      scaleX: 1.05,
      scaleY: 1 / 1.05,
      scaleOriginX: 0.5,
      scaleOriginY: 0.12,
    }),
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, BoardfishRenderer.createDrawCounters());

  const originX = obj.x + obj.w * 0.5;
  const originY = obj.y + obj.h * 0.12;
  assert.deepEqual(calls.slice(0, 4), [
    ['save'],
    ['translate', originX, originY],
    ['scale', 1.05, 1 / 1.05],
    ['translate', -originX, -originY],
  ]);
  assert.deepEqual(calls.at(-1), ['restore']);
});

test('preconfigured jello settings are used by object draw motion', () => {
  const { context, setTime } = loadMotion({
    BoardfishJelloParams: {
      amplitude: 0.12,
      duration: 700,
      oscillations: 9,
      rebound: 0.4,
      squish: 0.9,
      staggerMs: 30,
    },
  });

  const obj = { id: 'obj-1' };
  context.BoardfishMotion.applyActionAnimation('copy-selected-objects', { objects: [obj] }, {
    translateXPx: 0,
    translateYPx: 0,
  });
  setTime(100);
  const motion = context.BoardfishMotion.objectMotionForDraw(obj);

  assert.equal(motion.opacity, 1);
  assert.notEqual(motion.scaleX, 1);
  assert.notEqual(motion.scaleY, 1);
  assert.notEqual(motion.scaleX, motion.scaleY);
});

test('action animation policy keeps quiet actions inert and animates copy actions', () => {
  const { context } = loadMotion();
  const motion = context.BoardfishMotion;
  assert.equal(motion.applyActionAnimation('text-edit-type'), false);
  const quietObj = { id: 'quiet-1', type: 'text' };
  assert.equal(motion.applyActionAnimation('text-box-resize', { objects: [quietObj] }), false);
  assert.equal(motion.applyActionAnimation('object-delete', { removedObjects: [quietObj] }), false);
  assert.equal(motion.applyActionAnimation('browser-find-shortcut'), false);
  assert.equal(motion.objectMotionForDraw(quietObj), null);

  const copiedImage = { id: 'copied-image', type: 'image' };
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [copiedImage] }), true);
  assert.ok(motion.objectMotionForDraw(copiedImage));
  assert.equal(motion.applyActionAnimation('missing-action-for-test'), false);
});

test('text duplicate action is no-animation and empty image duplicate payloads stay inert', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const text = { id: 'text-1', type: 'text' };
  context.selectedIds = new Set([text.id]);
  context.objectsMap = new Map([[text.id, text]]);

  assert.equal(motion.applyActionAnimation('text-box-duplicate', { objects: [text] }), false);
  assert.equal(motion.applyActionAnimation('image-object-duplicate', { objects: [] }), false);

  setTime(100);
  const activeMotion = motion.objectMotionForDraw(text, { view: { zoom: 1 } });
  assert.equal(activeMotion, null);

  setTime(260);
  assert.equal(motion.objectMotionForDraw(text), null);
});

test('copy object jiggle uses fixed screen-distance translation independent of object width', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const narrow = { id: 'narrow-text', type: 'text', w: 80, h: 32 };
  const wide = { id: 'wide-text', type: 'text', w: 800, h: 32 };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-text-object', { objects: [narrow] }), true);
  setTime(100);
  const narrowAtZoom1 = motion.objectMotionForDraw(narrow, { view: { zoom: 1 } });
  const narrowAtZoom2 = motion.objectMotionForDraw(narrow, { view: { zoom: 2 } });
  setTime(420);
  const narrowLate = motion.objectMotionForDraw(narrow, { view: { zoom: 1 } });

  setTime(1000);
  assert.equal(motion.applyActionAnimation('copy-text-object', { objects: [wide] }), true);
  setTime(1100);
  const wideAtZoom1 = motion.objectMotionForDraw(wide, { view: { zoom: 1 } });

  assert.notEqual(narrowAtZoom1.translateX, 0);
  assert.notEqual(narrowAtZoom1.translateY, 0);
  assert.ok(narrowLate);
  assert.ok(Number.isFinite(narrowAtZoom1.scaleX));
  assert.ok(Number.isFinite(narrowAtZoom1.scaleY));
  assertClose(narrowAtZoom1.scaleX * narrowAtZoom1.scaleY, 1, 0.0025);
  assert.ok(Math.abs(narrowAtZoom1.translateX - wideAtZoom1.translateX) < 0.000001);
  assert.ok(Math.abs(narrowAtZoom1.translateY - wideAtZoom1.translateY) < 0.000001);
  assert.ok(Math.abs(narrowAtZoom1.translateX - narrowAtZoom2.translateX * 2) < 0.000001);
  assert.ok(Math.abs(narrowAtZoom1.translateY - narrowAtZoom2.translateY * 2) < 0.000001);
});

test('object motion exposes the exact transform most recently used for drawing', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const text = { id: 'copied-text', type: 'text' };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-text-object', { objects: [text] }), true);
  setTime(100);
  const drawnMotion = motion.objectMotionForDraw(text, { view: { zoom: 1 } });

  assert.strictEqual(motion.getLastDrawnObjectMotion(text), drawnMotion);

  setTime(501);
  assert.equal(motion.objectMotionForDraw(text, { view: { zoom: 1 } }), null);
  assert.equal(motion.getLastDrawnObjectMotion(text), null);
});

test('motion cleanup preserves the last rendered transform until the next object draw', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const image = { id: 'late-frame-image', type: 'image', x: 10, y: 20, w: 100, h: 80 };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [image] }), true);
  setTime(100);
  const lastRendered = motion.objectMotionForDraw(image, { view: { zoom: 1 } });
  assert.strictEqual(motion.getLastDrawnObjectMotion(image), lastRendered);

  setTime(700);
  motion.afterViewportRenderFrame({ source: 'late-board-frame' });
  assert.strictEqual(motion.getLastDrawnObjectMotion(image), lastRendered);

  assert.equal(motion.objectMotionForDraw(image, { view: { zoom: 1 } }), null);
  assert.equal(motion.getLastDrawnObjectMotion(image), null);
});

test('starting a new motion does not discard the transform still on screen', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const image = { id: 'restarted-image', type: 'image', x: 10, y: 20, w: 100, h: 80 };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [image] }), true);
  setTime(100);
  const lastRendered = motion.objectMotionForDraw(image, { view: { zoom: 1 } });

  setTime(600);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [image] }), true);
  assert.strictEqual(motion.getLastDrawnObjectMotion(image), lastRendered);

  const nextRendered = motion.objectMotionForDraw(image, { view: { zoom: 1 } });
  assert.ok(nextRendered);
  assert.strictEqual(motion.getLastDrawnObjectMotion(image), nextRendered);
});

test('copy text selection jiggle uses fixed screen-distance translation independent of selection length', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-text-selection', {
    textSelection: { id: 'text-1', start: 2, end: 9, hasSelection: true },
  }), true);
  setTime(100);
  const shortAtZoom1 = motion.textSelectionMotionForDraw('text-1', 2, 9, { view: { zoom: 1 } });
  const shortAtZoom2 = motion.textSelectionMotionForDraw('text-1', 2, 9, { view: { zoom: 2 } });
  setTime(420);
  const shortLate = motion.textSelectionMotionForDraw('text-1', 2, 9, { view: { zoom: 1 } });

  setTime(1000);
  assert.equal(motion.applyActionAnimation('copy-text-selection', {
    textSelection: { id: 'text-1', start: 2, end: 40, hasSelection: true },
  }), true);
  setTime(1100);
  const longAtZoom1 = motion.textSelectionMotionForDraw('text-1', 2, 40, { view: { zoom: 1 } });

  assert.notEqual(shortAtZoom1.translateX, 0);
  assert.notEqual(shortAtZoom1.translateY, 0);
  assert.ok(shortLate);
  assert.ok(Number.isFinite(shortAtZoom1.scaleX));
  assert.ok(Number.isFinite(shortAtZoom1.scaleY));
  assertClose(shortAtZoom1.scaleX * shortAtZoom1.scaleY, 1, 0.0025);
  assert.ok(Math.abs(shortAtZoom1.translateX - longAtZoom1.translateX) < 0.000001);
  assert.ok(Math.abs(shortAtZoom1.translateY - longAtZoom1.translateY) < 0.000001);
  assert.ok(Math.abs(shortAtZoom1.translateX - shortAtZoom2.translateX * 2) < 0.000001);
  assert.ok(Math.abs(shortAtZoom1.translateY - shortAtZoom2.translateY * 2) < 0.000001);
});

test('copy jiggle normalizes per-axis waveform to configured screen-pixel distance', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const obj = { id: 'copied-text', type: 'text' };
  let maxX = 0;
  let maxY = 0;

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-text-object', { objects: [obj] }), true);
  for (let i = 0; i < 192; i += 1) {
    setTime(i * 500 / 192);
    const frame = motion.objectMotionForDraw(obj, { view: { zoom: 1 } });
    if (!frame) continue;
    maxX = Math.max(maxX, Math.abs(frame.translateX || 0));
    maxY = Math.max(maxY, Math.abs(frame.translateY || 0));
    assert.ok(Number.isFinite(frame.scaleX));
    assert.ok(Number.isFinite(frame.scaleY));
    assertClose(frame.scaleX * frame.scaleY, 1, 0.0025);
  }

  assert.ok(Math.abs(maxX - 5) < 0.000001, `expected max X of 5px, got ${maxX}`);
  assert.ok(Math.abs(maxY - 10.75) < 0.000001, `expected max Y of 10.75px, got ${maxY}`);

  setTime(501);
  assert.equal(motion.objectMotionForDraw(obj, { view: { zoom: 1 } }), null);
});

test('grouped copy jiggle is geometry-ordered with shared vertical and mirrored lateral motion', () => {
  const left = { id: 'left', type: 'image', x: 20, y: 30, w: 80, h: 90 };
  const right = { id: 'right', type: 'image', x: 140, y: 30, w: 80, h: 90 };
  const capture = (objects) => {
    const { context, setTime } = loadMotion();
    const motion = context.BoardfishMotion;
    setTime(0);
    assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects }), true);
    setTime(100);
    return new Map(objects.map((obj) => [
      obj.id,
      plain(motion.objectMotionForDraw(obj, { view: { zoom: 1 } })),
    ]));
  };

  const forward = capture([left, right]);
  const reversed = capture([right, left]);
  const forwardLeft = forward.get(left.id);
  const forwardRight = forward.get(right.id);

  assert.deepEqual(forward.get(left.id), reversed.get(left.id));
  assert.deepEqual(forward.get(right.id), reversed.get(right.id));
  assert.notEqual(forwardLeft.translateX, 0);
  assertClose(forwardLeft.translateX, -forwardRight.translateX);
  assert.ok(
    Math.abs(forwardLeft.translateY - forwardRight.translateY) <=
      Math.max(Math.abs(forwardLeft.translateY), Math.abs(forwardRight.translateY)) * 0.04,
    'paired vertical motion diverged by more than the intended subtle asymmetry',
  );
  assert.ok(Math.abs(forwardLeft.translateX) < Math.abs(forwardLeft.translateY));
});

test('copy jiggle retrigger continues from the transform currently on screen', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const obj = { id: 'retriggered-image', type: 'image', x: 20, y: 30, w: 80, h: 90 };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }), true);
  setTime(117);
  const before = plain(motion.objectMotionForDraw(obj, { view: { zoom: 1 } }));

  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }), true);
  const after = plain(motion.objectMotionForDraw(obj, { view: { zoom: 1 } }));

  for (const field of ['translateX', 'translateY', 'scaleX', 'scaleY']) {
    assertClose(after[field], before[field], 1e-7, `${field} jumped when jiggle was retriggered`);
  }
  assert.equal(after.scaleOriginX, before.scaleOriginX);
  assert.equal(after.scaleOriginY, before.scaleOriginY);

  setTime(618);
  assert.equal(motion.objectMotionForDraw(obj, { view: { zoom: 1 } }), null);
});

test('rapid and repeated copy retriggers stay within the configured motion envelope', () => {
  const scan = (triggerTimes) => {
    const { context, setTime } = loadMotion();
    const motion = context.BoardfishMotion;
    const obj = { id: 'bounded-retrigger', type: 'image', x: 20, y: 30, w: 80, h: 90 };
    const triggers = new Set(triggerTimes);
    let maxX = 0;
    let maxY = 0;
    let maxStrain = 0;
    const end = Math.max(...triggerTimes) + 500;
    for (let time = 0; time < end; time += 1) {
      setTime(time);
      if (triggers.has(time)) {
        assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }), true);
      }
      const frame = motion.objectMotionForDraw(obj, { view: { zoom: 1 } });
      if (!frame) continue;
      maxX = Math.max(maxX, Math.abs(frame.translateX || 0));
      maxY = Math.max(maxY, Math.abs(frame.translateY || 0));
      const scaleX = Math.max(0.01, frame.scaleX ?? 1);
      const scaleY = Math.max(0.01, frame.scaleY ?? 1);
      maxStrain = Math.max(maxStrain, Math.abs(0.5 * (Math.log(scaleY) - Math.log(scaleX))));
    }
    return { maxX, maxY, maxStrain };
  };

  for (const triggerTimes of [
    [0, 16],
    [0, 30],
    [0, 60],
    Array.from({ length: 10 }, (_, index) => index * 18),
    Array.from({ length: 10 }, (_, index) => index * 32),
  ]) {
    const result = scan(triggerTimes);
    assert.ok(result.maxX <= 5.05, `X overshot after triggers ${triggerTimes}: ${result.maxX}`);
    assert.ok(result.maxY <= 10.8, `Y overshot after triggers ${triggerTimes}: ${result.maxY}`);
    assert.ok(result.maxStrain <= 0.0281, `strain overshot after triggers ${triggerTimes}: ${result.maxStrain}`);
  }
});

test('copy jiggle transform is invariant to intermediate sampling cadence', () => {
  const captureAt333Ms = (cadenceHz) => {
    const { context, setTime } = loadMotion();
    const motion = context.BoardfishMotion;
    const obj = { id: 'cadence-image', type: 'image', x: 20, y: 30, w: 80, h: 90 };

    setTime(0);
    assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }), true);
    if (cadenceHz) {
      const stepMs = 1000 / cadenceHz;
      for (let time = stepMs; time < 333; time += stepMs) {
        setTime(time);
        assert.ok(motion.objectMotionForDraw(obj, { view: { zoom: 1 } }));
      }
    }
    setTime(333);
    return plain(motion.objectMotionForDraw(obj, { view: { zoom: 1 } }));
  };

  const unsampled = captureAt333Ms(0);
  assert.deepEqual(captureAt333Ms(30), unsampled);
  assert.deepEqual(captureAt333Ms(60), unsampled);
  assert.deepEqual(captureAt333Ms(120), unsampled);
});

test('short retrigger stays active for its longer carry and preserves area through exact rest', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const obj = { id: 'long-carry-image', type: 'image', x: 20, y: 30, w: 80, h: 90 };
  const options = { duration: 180, carryDurationMs: 320 };
  const at = (time) => {
    setTime(time);
    return motion.objectMotionForDraw(obj, { view: { zoom: 1 } });
  };
  const velocity = (from, to, durationMs, fields) => fields.map((field) => (
    (to[field] - from[field]) / durationMs
  ));
  const norm = (values) => Math.hypot(...values);

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }, options), true);
  const beforePrevious = plain(at(89.75));
  const before = plain(at(90));

  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }, options), true);
  const after = plain(at(90));
  for (const field of ['translateX', 'translateY', 'scaleX', 'scaleY']) {
    assertClose(after[field], before[field], 1e-7, `${field} jumped on long-carry retrigger`);
  }

  const afterNext = plain(at(90.25));
  const assertVelocityContinuity = (fields, label) => {
    const beforeVelocity = velocity(beforePrevious, before, 0.25, fields);
    const afterVelocity = velocity(after, afterNext, 0.25, fields);
    const discontinuity = norm(afterVelocity.map((value, index) => value - beforeVelocity[index]));
    const reference = Math.max(norm(beforeVelocity), norm(afterVelocity), 1e-9);
    assert.ok(discontinuity <= reference * 0.05, `${label} velocity changed discontinuously at retrigger`);
  };
  assertVelocityContinuity(['translateX', 'translateY'], 'translation');
  assertVelocityContinuity(['scaleX', 'scaleY'], 'deformation');

  for (const time of [91, 120, 180, 250, 270, 271, 320, 400, 409.9]) {
    const frame = at(time);
    assert.ok(frame, `motion ended before carry rest at ${time}ms`);
    assertClose(frame.scaleX * frame.scaleY, 1, 1e-7, `carry changed deformation area at ${time}ms`);
  }
  assert.ok(motionRestDistance(at(409.9)) < 1e-7, 'carry did not approach exact terminal rest');

  assert.equal(at(410), null);
  assert.equal(motion.getLastDrawnObjectMotion(obj), null);
});

test('copy jiggle has cubic-rest boundaries, decaying extrema, and exact terminal rest', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const obj = { id: 'settling-image', type: 'image', x: 20, y: 30, w: 80, h: 90 };
  const at = (time) => {
    setTime(time);
    return motion.objectMotionForDraw(obj, { view: { zoom: 1 } });
  };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }), true);

  const startFrame = at(0);
  const startHalfMs = motionRestDistance(at(0.5));
  const oneMsFrame = at(1);
  const startOneMs = motionRestDistance(oneMsFrame);
  assert.ok(startHalfMs < startOneMs * 0.18, 'attack does not approach rest with a cubic-or-smoother boundary');

  const samples = [Math.abs(startFrame?.translateY || 0), Math.abs(oneMsFrame?.translateY || 0)];
  let peakDistance = Math.max(motionRestDistance(startFrame), motionRestDistance(oneMsFrame));
  let endOneMs = 0;
  for (let time = 2; time < 500; time += 1) {
    const frame = at(time);
    const y = frame?.translateY || 0;
    peakDistance = Math.max(peakDistance, motionRestDistance(frame));
    samples.push(Math.abs(y));
    if (time === 499) endOneMs = motionRestDistance(frame);
  }
  const endHalfMs = motionRestDistance(at(499.5));
  assert.ok(endHalfMs < endOneMs * 0.18, 'settle does not approach rest with a cubic-or-smoother boundary');

  const extrema = [];
  for (let index = 1; index < samples.length - 1; index += 1) {
    if (samples[index] >= samples[index - 1] && samples[index] > samples[index + 1]) {
      extrema.push(samples[index]);
    }
  }
  assert.ok(extrema.length >= 3, `expected at least three vertical extrema, got ${extrema.length}`);
  for (let index = 1; index < extrema.length; index += 1) {
    assert.ok(
      extrema[index] <= extrema[index - 1] * 1.01,
      `vertical rebound grew from ${extrema[index - 1]} to ${extrema[index]}`,
    );
  }
  assert.ok(endOneMs < peakDistance * 1e-5, 'one-millisecond terminal residual is too large');

  assert.equal(at(500), null);
  assert.equal(motion.getLastDrawnObjectMotion(obj), null);
});

test('copy jiggle deformation preserves area and exposes a stable upper anchor', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const obj = { id: 'deforming-image', type: 'image', x: 20, y: 30, w: 80, h: 90 };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }), true);
  let deformedSamples = 0;
  for (const time of [40, 80, 120, 180, 240]) {
    setTime(time);
    const frame = motion.objectMotionForDraw(obj, { view: { zoom: 1 } });
    assert.ok(Number.isFinite(frame.scaleX));
    assert.ok(Number.isFinite(frame.scaleY));
    assertClose(frame.scaleX * frame.scaleY, 1, 0.0025, `deformation changed area at ${time}ms`);
    assert.equal(frame.scaleOriginX, 0.5);
    assert.equal(frame.scaleOriginY, 0.12);
    if (Math.abs(frame.scaleX - 1) > 0.0001 || Math.abs(frame.scaleY - 1) > 0.0001) deformedSamples++;
  }
  assert.ok(deformedSamples >= 3, 'deformation is not visibly active across the primary response');
});

test('copy jiggle drives frames through the viewport scheduler', () => {
  const { context, renderCalls, setTime } = loadMotion();
  const motion = context.BoardfishMotion;
  const obj = { id: 'copied-image', type: 'image' };

  setTime(0);
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [obj] }), true);
  assert.deepEqual(renderCalls, [{ board: true, overlay: true, source: 'motion' }]);

  setTime(16);
  const frame = motion.objectMotionForDraw(obj, { view: { zoom: 1 } });
  assert.ok(frame);
  motion.afterViewportRenderFrame({ source: 'motion' });

  assert.equal(renderCalls.length, 2);
  assert.deepEqual(renderCalls[1], { board: true, overlay: true, source: 'motion' });
});

test('text selection copy feedback uses the jello set', () => {
  const { context, setTime } = loadMotion();
  context.BoardfishMotion.applyActionAnimation('copy-text-selection', {
    textSelection: { id: 'text-1', start: 2, end: 9, hasSelection: true },
  }, {
    duration: 700,
    amplitude: 0.12,
    translateXPx: 0,
    translateYPx: 0,
  });

  setTime(100);
  const motion = context.BoardfishMotion.textSelectionMotionForDraw('text-1', 2, 9);

  assert.equal(motion.opacity, 1);
  assert.notEqual(motion.scaleX, 1);
  assert.notEqual(motion.scaleY, 1);
  assert.notEqual(motion.scaleX, motion.scaleY);
});

test('text selection jello exposes active full-range draw specs', () => {
  const { context, setTime } = loadMotion();
  context.BoardfishMotion.applyActionAnimation('copy-text-selection', {
    textSelection: { id: 'text-1', start: 0, end: 17, hasSelection: true },
  }, {
    duration: 200,
  });

  assert.deepEqual(plain(context.BoardfishMotion.textSelectionJelloSpecsForDraw()), [
    { id: 'text-1', start: 0, end: 17 },
  ]);

  setTime(260);
  assert.deepEqual(plain(context.BoardfishMotion.textSelectionJelloSpecsForDraw()), []);
});

test('selection movement pulses can exclude text objects', () => {
  const { context, setTime } = loadMotion();
  const image = { id: 'img-1', type: 'image' };
  const text = { id: 'text-1', type: 'text' };
  context.selectedIds = new Set([image.id, text.id]);
  context.objectsMap = new Map([
    [image.id, image],
    [text.id, text],
  ]);

  context.BoardfishMotion.applyActionAnimation('copy-selected-objects', { selection: true }, { includeText: false });
  setTime(100);

  assert.ok(context.BoardfishMotion.objectMotionForDraw(image));
  assert.equal(context.BoardfishMotion.objectMotionForDraw(text), null);
});

test('preconfigured transition timing is applied to CSS variables', () => {
  const { styleVars } = loadMotion({
    BoardfishSmoothSlideParams: {
      duration: 260,
      ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    },
  });
  assert.equal(styleVars.get('--smooth-slide-duration'), '260ms');
  assert.equal(styleVars.get('--smooth-slide-ease'), 'cubic-bezier(0.2, 0.8, 0.2, 1)');
});

test('object jello removal stays drawable until the exit pulse completes', () => {
  const { context, setTime } = loadMotion();
  const obj = { id: 'obj-1' };
  context.BoardfishMotion.applyActionAnimation('copy-selected-objects', { removedObjects: [obj] }, {
    duration: 200,
    amplitude: 0.1,
    translateXPx: 0,
    translateYPx: 0,
  });

  assert.deepEqual(plain(context.BoardfishMotion.motionObjectsForDraw().map((item) => item.id)), ['obj-1']);

  setTime(100);
  const motion = context.BoardfishMotion.objectMotionForDraw(obj);
  assert.ok(motion.opacity > 0 && motion.opacity < 1);
  assert.notEqual(motion.scaleX, motion.scaleY);

  setTime(220);
  assert.deepEqual(plain(context.BoardfishMotion.objectMotionForDraw(obj)), { opacity: 0, scale: 1, skip: true });
  assert.equal(context.BoardfishMotion.motionObjectsForDraw().length, 0);
});
