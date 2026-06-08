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

function loadMotion() {
  let currentTime = 0;
  const styleVars = new Map();
  const timers = [];
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
    scheduleRender() {},
    setTimeout(callback, ms) {
      timers.push({ callback, ms });
      return timers.length;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'motion.js'), 'utf8'),
    context,
    { filename: 'motion.js' },
  );
  return {
    context,
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

function classElement(initialClasses = []) {
  const classes = new Set(initialClasses);
  return {
    offsetWidth: 1,
    classList: {
      add(...names) {
        for (const name of names) classes.add(name);
      },
      remove(...names) {
        for (const name of names) classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
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
    imageBitmapCache: () => ({}),
    imageCache: () => ({ 'img-1': source }),
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
    imageBitmapCache: () => ({}),
    imageCache: () => ({ 'img-1': source }),
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

test('text renderer draws visible text at low zoom instead of substituting or hiding it', () => {
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
    dpr: () => 1,
    drawTextLineRange(_context, line) {
      drawnText.push(line.text);
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
    zoom: () => 0.25,
  });

  renderer.drawVisibleObjects(context, counters);

  assert.deepEqual(drawnText, ['tiny']);
  assert.equal(rects.length, 0);
  assert.equal(layoutCalls, 1);
  assert.equal(counters.textLines, 1);
  assert.equal(counters.drawnTextLines, 1);
  assert.equal(counters.culledTextLines, 0);
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
    imageBitmapCache: () => ({}),
    imageCache: () => ({ 'img-1': source }),
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

test('jello settings are adjustable and used by object draw motion', () => {
  const { context, setTime } = loadMotion();
  const settings = context.BoardfishMotion.configureJello({
    amplitude: 0.12,
    duration: 700,
    oscillations: 9,
    rebound: 0.4,
    squish: 0.9,
    staggerMs: 30,
  });

  assert.deepEqual(plain(settings), {
    amplitude: 0.12,
    duration: 700,
    oscillations: 9,
    rebound: 0.4,
    squish: 0.9,
    staggerMs: 30,
  });
  assert.deepEqual(plain(context.BoardfishMotion.getJelloParams()), plain(settings));

  const obj = { id: 'obj-1' };
  context.BoardfishMotion.noteObjectJello(obj);
  setTime(100);
  const motion = context.BoardfishMotion.objectMotionForDraw(obj);

  assert.equal(motion.opacity, 1);
  assert.notEqual(motion.scaleX, 1);
  assert.notEqual(motion.scaleY, 1);
  assert.notEqual(motion.scaleX, motion.scaleY);
});

test('action animation policy partitions user actions and tracks missing assignments', () => {
  const { context, setTime } = loadMotion();
  const motion = context.BoardfishMotion;

  const partition = motion.getActionAnimationPartition();
  const groups = motion.getActionAnimationGroups();
  assert.equal(groups.imageTransform.setName, 'no-animation');
  assert.deepEqual(plain(groups.imageTransform.actions), ['flip-image', 'rotate-image']);
  assert.equal(groups.objectPaste.setName, 'no-animation');
  assert.deepEqual(plain(groups.objectPaste.actions), ['image-object-paste']);
  assert.equal(groups.objectCopy.setName, 'jiggle');
  assert.deepEqual(plain(groups.objectCopy.actions), ['copy-selected-objects', 'copy-text-object', 'copy-text-selection']);
  assert.equal(groups.objectRemoval.setName, 'no-animation');
  assert.ok(groups.objectRemoval.actions.includes('object-delete'));
  assert.equal(groups.floatingSurface.setName, 'no-animation');
  assert.equal(groups.pillSurface.setName, 'no-animation');
  assert.equal(groups.unsavedDialogSurface.setName, 'no-animation');
  assert.ok(partition['no-animation'].includes('text-edit-type'));
  assert.ok(partition['no-animation'].includes('rubber-band-release'));
  assert.ok(partition['no-animation'].includes('text-box-create'));
  assert.ok(partition['no-animation'].includes('object-delete'));
  assert.ok(partition['no-animation'].includes('object-deselect'));
  assert.ok(partition['no-animation'].includes('image-file-dialog-open'));
  assert.deepEqual(plain(partition['smooth-slide']), []);
  assert.ok(partition['no-animation'].includes('menu-open'));
  assert.ok(partition['no-animation'].includes('pill-message-update'));
  assert.ok(partition['no-animation'].includes('unsaved-dialog-open'));
  assert.ok(partition['no-animation'].includes('image-object-create'));
  assert.ok(partition['no-animation'].includes('object-undo-delete'));
  assert.deepEqual(plain(partition.jiggle), ['copy-selected-objects', 'copy-text-object', 'copy-text-selection']);
  assert.ok(partition['not-applicable'].includes('browser-find-shortcut'));
  assert.deepEqual(plain(motion.getActionAnimationPolicyIssues()), {
    duplicateAssignments: [],
    runtimeUnassigned: [],
  });
  assert.equal(motion.actionAnimationSetFor('text-box-resize'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('text-box-create'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('object-delete'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('object-deselect'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('cut-selected-objects'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('object-undo-delete'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('flip-image'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('image-object-paste'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('menu-open'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('pill-message-update'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('unsaved-dialog-open'), 'no-animation');
  assert.equal(motion.actionAnimationSetFor('copy-text-selection'), 'jiggle');
  assert.equal(motion.actionAnimationSetFor('browser-find-shortcut'), 'not-applicable');

  assert.equal(motion.applyActionAnimation('text-edit-type'), false);
  const quietObj = { id: 'quiet-1', type: 'text' };
  context.selectedIds = new Set([quietObj.id]);
  context.objectsMap = new Map([[quietObj.id, quietObj]]);
  assert.equal(motion.applyActionAnimation('text-box-resize', { objects: [quietObj] }), false);
  assert.equal(motion.applyActionAnimation('text-box-create', { objects: [quietObj] }), false);
  assert.equal(motion.applyActionAnimation('object-delete', { removedObjects: [quietObj] }), false);
  assert.equal(motion.applyActionAnimation('browser-find-shortcut'), false);
  assert.equal(motion.objectMotionForDraw(quietObj), null);

  const surface = classElement();
  assert.equal(motion.applyActionAnimation('menu-open', { surface }), false);
  assert.equal(surface.classList.contains('motion-smooth-slide-enter'), false);

  const jiggleObj = { id: 'jiggle-1', type: 'image' };
  context.selectedIds = new Set([jiggleObj.id]);
  context.objectsMap = new Map([[jiggleObj.id, jiggleObj]]);
  assert.equal(motion.applyActionAnimation('object-select'), false);
  assert.equal(motion.objectMotionForDraw(jiggleObj), null);

  const restoredImage = { id: 'restored-image', type: 'image' };
  assert.equal(motion.applyActionAnimation('object-undo-delete', { objects: [restoredImage] }, { includeText: false }), false);
  assert.equal(motion.objectMotionForDraw(restoredImage), null);

  const paramGuardImage = { id: 'param-guard-image', type: 'image' };
  assert.equal(motion.applyActionAnimation('image-object-create', { objects: [paramGuardImage] }, {
    amplitude: 0.2,
    duration: 1200,
  }), false);
  setTime(700);
  assert.equal(motion.objectMotionForDraw(paramGuardImage), null);

  const copiedImage = { id: 'copied-image', type: 'image' };
  assert.equal(motion.applyActionAnimation('copy-selected-objects', { objects: [copiedImage] }), true);
  assert.ok(motion.objectMotionForDraw(copiedImage));

  assert.deepEqual(plain(motion.getUnassignedActionAnimations()), []);
  assert.equal(motion.applyActionAnimation('missing-action-for-test'), false);
  assert.deepEqual(plain(motion.getUnassignedActionAnimations()), ['missing-action-for-test']);
  assert.deepEqual(plain(motion.getActionAnimationPolicyIssues().runtimeUnassigned), ['missing-action-for-test']);

  assert.equal(motion.configureActionAnimationSet('jiggle', { amplitude: 0.12 }).amplitude, 0.12);
  assert.equal(motion.configureActionAnimationSet('smooth-slide', { duration: 260 }).duration, 260);
  assert.equal(motion.configureActionAnimationSet('no-animation', { duration: 999 }).duration, 0);
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
  assert.equal(narrowAtZoom1.scaleX, undefined);
  assert.equal(narrowAtZoom1.scaleY, undefined);
  assert.ok(Math.abs(narrowAtZoom1.translateX - wideAtZoom1.translateX) < 0.000001);
  assert.ok(Math.abs(narrowAtZoom1.translateY - wideAtZoom1.translateY) < 0.000001);
  assert.ok(Math.abs(narrowAtZoom1.translateX - narrowAtZoom2.translateX * 2) < 0.000001);
  assert.ok(Math.abs(narrowAtZoom1.translateY - narrowAtZoom2.translateY * 2) < 0.000001);
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
  assert.equal(shortAtZoom1.scaleX, undefined);
  assert.equal(shortAtZoom1.scaleY, undefined);
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
    assert.equal(frame.scaleX, undefined);
    assert.equal(frame.scaleY, undefined);
  }

  assert.ok(Math.abs(maxX - 5) < 0.000001, `expected max X of 5px, got ${maxX}`);
  assert.ok(Math.abs(maxY - 10.75) < 0.000001, `expected max Y of 10.75px, got ${maxY}`);

  setTime(501);
  assert.equal(motion.objectMotionForDraw(obj, { view: { zoom: 1 } }), null);
});

test('text selection copy feedback uses the jello set', () => {
  const { context, setTime } = loadMotion();
  context.BoardfishMotion.noteTextSelectionJello({
    id: 'text-1',
    start: 2,
    end: 9,
    hasSelection: true,
  }, {
    duration: 700,
    amplitude: 0.12,
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
  context.BoardfishMotion.noteTextSelectionJello({
    id: 'text-1',
    start: 0,
    end: 17,
    hasSelection: true,
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

  context.BoardfishMotion.pulseSelection({ includeText: false });
  setTime(100);

  assert.ok(context.BoardfishMotion.objectMotionForDraw(image));
  assert.equal(context.BoardfishMotion.objectMotionForDraw(text), null);
});

test('added text objects can use smooth slide instead of jello', () => {
  const { context, setTime } = loadMotion();
  const text = { id: 'text-1', type: 'text' };

  context.BoardfishMotion.noteObjectsSmoothSlideAdded([text], {
    duration: 200,
    offsetY: -8,
    settleY: 2,
    startScale: 0.96,
    settleScale: 1.02,
    ease: 'linear',
  });

  let motion = context.BoardfishMotion.objectMotionForDraw(text, { view: { zoom: 2 } });
  assert.deepEqual(plain(motion), { opacity: 0, scale: 0.96, translateY: -4 });

  setTime(100);
  motion = context.BoardfishMotion.objectMotionForDraw(text, { view: { zoom: 2 } });
  assert.ok(motion.opacity > 0 && motion.opacity < 1);
  assert.ok(motion.translateY > -4 && motion.translateY < 1);
  assert.equal(motion.scaleX, undefined);
  assert.equal(motion.scaleY, undefined);

  setTime(220);
  assert.equal(context.BoardfishMotion.objectMotionForDraw(text), null);
});

test('added object feedback skips text objects while jiggling non-text objects', () => {
  const { context, setTime } = loadMotion();
  const image = { id: 'img-1', type: 'image' };
  const text = { id: 'text-1', type: 'text' };

  context.BoardfishMotion.noteObjectsAdded([image, text], {
    textMotion: 'smooth-slide',
    includeText: false,
    duration: 200,
    amplitude: 0.12,
  });

  setTime(100);
  const imageMotion = context.BoardfishMotion.objectMotionForDraw(image);
  const textMotion = context.BoardfishMotion.objectMotionForDraw(text);

  assert.notEqual(imageMotion.scaleX, imageMotion.scaleY);
  assert.equal(textMotion, null);
});

test('smooth slide settings are adjustable and applied to CSS variables', () => {
  const { context, styleVars } = loadMotion();
  const settings = context.BoardfishMotion.configureSmoothSlide({
    duration: 260,
    offsetY: -9,
    settleY: 2,
    startScale: 0.975,
    settleScale: 1.01,
    ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  });

  assert.deepEqual(plain(settings), {
    duration: 260,
    offsetY: -9,
    settleY: 2,
    startScale: 0.975,
    settleScale: 1.01,
    ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  });
  assert.deepEqual(plain(context.BoardfishMotion.getSmoothSlideParams()), plain(settings));
  assert.equal(styleVars.get('--smooth-slide-duration'), '260ms');
  assert.equal(styleVars.get('--smooth-slide-offset-y'), '-9px');
  assert.equal(styleVars.get('--smooth-slide-settle-y'), '2px');
  assert.equal(styleVars.get('--smooth-slide-start-scale'), '0.975');
  assert.equal(styleVars.get('--smooth-slide-settle-scale'), '1.01');
  assert.equal(styleVars.get('--smooth-slide-ease'), 'cubic-bezier(0.2, 0.8, 0.2, 1)');
});

test('smooth slide surface close does not restart while already exiting', () => {
  const { context, timers } = loadMotion();
  const surface = classElement(['visible', 'motion-smooth-slide-enter']);
  const callbacks = [];

  assert.equal(context.BoardfishMotion.noteSmoothSlideClosed(surface, () => callbacks.push('first')), true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 220);
  assert.equal(surface.classList.contains('motion-smooth-slide-enter'), false);
  assert.equal(surface.classList.contains('motion-smooth-slide-exit'), true);

  assert.equal(context.BoardfishMotion.noteSmoothSlideClosed(surface, () => callbacks.push('second')), true);
  assert.equal(timers.length, 1);

  timers[0].callback();

  assert.deepEqual(callbacks, ['first', 'second']);
  assert.equal(surface.classList.contains('motion-smooth-slide-exit'), false);
});

test('object add feedback uses the jello set', () => {
  const { context, setTime } = loadMotion();
  const obj = { id: 'obj-1' };
  context.BoardfishMotion.noteObjectAdded(obj, { duration: 600, amplitude: 0.1 });

  setTime(100);
  const motion = context.BoardfishMotion.objectMotionForDraw(obj);

  assert.equal(motion.opacity, 1);
  assert.ok(Math.abs(motion.scaleX - motion.scaleY) > 0.001);
});

test('object add feedback skips text boxes by default', () => {
  const { context, setTime } = loadMotion();
  const text = { id: 'text-1', type: 'text' };
  context.BoardfishMotion.noteObjectAdded(text, { duration: 600, amplitude: 0.1 });

  setTime(100);

  assert.equal(context.BoardfishMotion.objectMotionForDraw(text), null);
});

test('object jello removal stays drawable until the exit pulse completes', () => {
  const { context, setTime } = loadMotion();
  const obj = { id: 'obj-1' };
  context.BoardfishMotion.noteObjectsJelloRemoved([obj], { duration: 200, amplitude: 0.1 });

  assert.deepEqual(plain(context.BoardfishMotion.motionObjectsForDraw().map((item) => item.id)), ['obj-1']);

  setTime(100);
  const motion = context.BoardfishMotion.objectMotionForDraw(obj);
  assert.ok(motion.opacity > 0 && motion.opacity < 1);
  assert.notEqual(motion.scaleX, motion.scaleY);

  setTime(220);
  assert.deepEqual(plain(context.BoardfishMotion.objectMotionForDraw(obj)), { opacity: 0, scale: 1, skip: true });
  assert.equal(context.BoardfishMotion.motionObjectsForDraw().length, 0);
});

test('explicit smooth-slide removal helper stays drawable until complete', () => {
  const { context, setTime } = loadMotion();
  const first = { id: 'obj-1' };
  const second = { id: 'obj-2' };
  context.BoardfishMotion.noteObjectsRemoved([first, second], {
    duration: 200,
    offsetY: -8,
    startScale: 0.96,
    ease: 'cubic-bezier(0, 0, 1, 1)',
  });

  const exiting = context.BoardfishMotion.motionObjectsForDraw();
  assert.equal(exiting.length, 2);
  assert.equal(exiting[0].id, 'obj-1');
  assert.equal(exiting[1].id, 'obj-2');
  setTime(100);
  const firstMotion = context.BoardfishMotion.objectMotionForDraw(first, { view: { zoom: 2 } });
  const secondMotion = context.BoardfishMotion.objectMotionForDraw(second, { view: { zoom: 2 } });
  assert.ok(Math.abs(firstMotion.opacity - 0.5) < 0.002);
  assert.ok(Math.abs(firstMotion.scale - 0.98) < 0.002);
  assert.ok(Math.abs(firstMotion.translateY + 2) < 0.002);
  assert.deepEqual(plain(secondMotion), plain(firstMotion));

  setTime(220);
  assert.deepEqual(plain(context.BoardfishMotion.objectMotionForDraw(first)), { opacity: 0, scale: 1, translateY: 0, skip: true });
  assert.deepEqual(plain(context.BoardfishMotion.objectMotionForDraw(second)), { opacity: 0, scale: 1, translateY: 0, skip: true });
  assert.equal(context.BoardfishMotion.motionObjectsForDraw().length, 0);
});

test('selection boundary jello skips text objects newly entering selection', () => {
  const calls = [];
  const objects = [
    { id: 'obj-1' },
    { id: 'obj-2' },
    { id: 'obj-3' },
    { id: 'text-1', type: 'text' },
  ];
  const context = {
    console,
    editingId: null,
    objectsMap: new Map(objects.map((obj) => [obj.id, obj])),
    selectedId: 'obj-1',
    selectedIds: new Set(['obj-1']),
    BoardfishMotion: {
      applyActionAnimation(_action, payload = {}) {
        if (payload.objects) calls.push(Array.from(payload.objects, (obj) => obj.id));
      },
      noteObjectsJello(items) {
        calls.push(Array.from(items, (obj) => obj.id));
      },
    },
    exitEdit() {
      context.editingId = null;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'editor_state_boundary.js'), 'utf8'),
    context,
    { filename: 'editor_state_boundary.js' },
  );

  context.BoardfishEditorState.setSelection(['obj-1', 'obj-2'], {
    primaryId: 'obj-2',
    exitEditing: false,
  });
  assert.deepEqual(calls, [['obj-2']]);

  calls.length = 0;
  context.BoardfishEditorState.setSelection(['obj-1', 'obj-2'], {
    primaryId: 'obj-2',
    exitEditing: false,
  });
  assert.deepEqual(calls, []);

  context.BoardfishEditorState.setSelection(['obj-2'], {
    primaryId: 'obj-2',
    exitEditing: false,
  });
  assert.deepEqual(calls, []);

  context.BoardfishEditorState.setSelection(['obj-3'], {
    primaryId: 'obj-3',
    exitEditing: false,
  });
  assert.deepEqual(calls, [['obj-3']]);

  calls.length = 0;
  context.BoardfishEditorState.setSelection(['obj-1'], {
    primaryId: 'obj-1',
    animateSelection: false,
    exitEditing: false,
  });
  assert.deepEqual(calls, []);

  context.BoardfishEditorState.setSelection(['text-1'], {
    primaryId: 'text-1',
    exitEditing: false,
  });
  assert.deepEqual(calls, []);
});
