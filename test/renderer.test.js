'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderer() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'renderer.js'), 'utf8'),
    context,
    { filename: 'renderer.js' },
  );
  return context.BoardfishRenderer;
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
    imageBitmapCache: () => ({}),
    imageCache: () => ({ 'img-1': source }),
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

  const result = renderer.drawVisibleObjects(context, counters, {
    viewportRect: { x1: 0, y1: 25, x2: 60, y2: 45 },
  });

  assert.equal(result.drawnImages, 1);
  assert.equal(result.drawnText, 0);
  assert.equal(counters.croppedImages, 1);
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
});
