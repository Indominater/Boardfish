'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const readSource = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadSortCommandHarness(sourceObjects, selectedIds) {
  const calls = {
    commits: [],
    dirty: [],
    histories: [],
    invalidations: 0,
    renders: 0,
  };
  const context = {
    console,
    calls,
    performance: { now: () => 0 },
    HistoryDebug: {
      count() {},
      end() {},
      max() {},
      start() { return {}; },
    },
    normalizeTextContent: (value) => String(value ?? ''),
    normalizeTextLineAlignForContent: () => [],
    normalizeTextScriptRangesForContent: () => [],
    cloneTextScriptRanges: (ranges) => ranges.map((range) => ({ ...range })),
    cloneTextObjectRuntimeCaches() {},
  };
  vm.createContext(context);
  vm.runInContext(readSource('src/js/image_layout.js'), context, { filename: 'image_layout.js' });
  vm.runInContext(
    `${readSource('src/js/state.js')}\nglobalThis.sortSelectedImages = sortSelectedImages;\n`,
    context,
    { filename: 'state.js' },
  );
  context.objects = sourceObjects;
  context.objectsMap = new Map(sourceObjects.map((obj) => [obj.id, obj]));
  context.selectedIds = new Set(selectedIds);
  context.markDirty = (id) => calls.dirty.push(id);
  context.invalidateOffscreen = () => { calls.invalidations++; };
  context.scheduleRender = () => { calls.renders++; };
  context.pushHistory = (reason) => calls.histories.push(reason);
  context.BoardfishEditorState = {
    commitMutation(reason, mutate, options = {}) {
      calls.commits.push({ reason, options });
      const result = mutate();
      if (!result) return result;
      if (options.invalidate) context.invalidateOffscreen();
      context.scheduleRender();
      context.pushHistory(reason);
      return result;
    },
  };
  return context;
}

test('sortSelectedImages resizes and packs only selected images in one undoable mutation', () => {
  const imageDataA = { imgKey: 'key-a', flipX: true, flipY: false, rotation: 90 };
  const imageDataB = { imgKey: 'key-b', flipX: false, flipY: true, rotation: 0 };
  const objects = [
    { id: 'image-b', type: 'image', x: 20, y: 30, w: 100, h: 100, z: 4, data: imageDataB },
    { id: 'text-a', type: 'text', x: 40, y: 50, w: 200, h: 80, z: 5, data: { content: 'keep me' } },
    { id: 'image-a', type: 'image', x: -20, y: -30, w: 200, h: 200, z: 6, data: imageDataA },
    { id: 'image-unselected', type: 'image', x: 70, y: 80, w: 90, h: 30, z: 7, data: { imgKey: 'key-c' } },
  ];
  const textBefore = structuredClone(objects[1]);
  const unselectedBefore = structuredClone(objects[3]);
  const selection = ['text-a', 'image-b', 'image-a'];
  const context = loadSortCommandHarness(objects, selection);

  assert.equal(context.sortSelectedImages({ x: 1000, y: 1000 }), true);

  const imageA = objects[2];
  const imageB = objects[0];
  assert.deepEqual(
    [imageA.x, imageA.y, imageA.w, imageA.h],
    [400, 700, 600, 600],
  );
  assert.deepEqual(
    [imageB.x, imageB.y, imageB.w, imageB.h],
    [1000, 700, 600, 600],
  );
  assert.equal(imageA.x + imageA.w, imageB.x);
  assert.equal(imageA.data, imageDataA);
  assert.equal(imageB.data, imageDataB);
  assert.equal(imageA.z, 6);
  assert.equal(imageB.z, 4);
  assert.deepEqual(objects[1], textBefore);
  assert.deepEqual(objects[3], unselectedBefore);
  assert.deepEqual([...context.selectedIds], selection);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.commits)),
    [{ reason: 'sort-images', options: { invalidate: true } }],
  );
  assert.deepEqual(context.calls.dirty.sort(), ['image-a', 'image-b']);
  assert.deepEqual(context.calls.histories, ['sort-images']);
  assert.equal(context.calls.invalidations, 1);
  assert.equal(context.calls.renders, 1);

  assert.equal(context.sortSelectedImages({ x: 1000, y: 1000 }), false);
  assert.equal(context.calls.commits.length, 1);
  assert.deepEqual(context.calls.histories, ['sort-images']);
});

test('sortSelectedImages rechecks that at least two valid images are selected', () => {
  const objects = [
    { id: 'image-a', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: {} },
    { id: 'text-a', type: 'text', x: 0, y: 0, w: 100, h: 100, z: 2, data: { content: '' } },
  ];
  const context = loadSortCommandHarness(objects, ['image-a', 'text-a', 'stale-image-id']);

  assert.equal(context.sortSelectedImages({ x: 20, y: 30 }), false);
  assert.deepEqual(context.calls.commits, []);
  assert.deepEqual(context.calls.histories, []);
});

test('sortSelectedImages does not add a floating-point-only history entry on repeat', () => {
  const objects = [
    { id: 'image-a', type: 'image', x: 0, y: 0, w: 100, h: 122, z: 1, data: {} },
    { id: 'image-b', type: 'image', x: 0, y: 0, w: 137, h: 293, z: 2, data: {} },
    { id: 'image-c', type: 'image', x: 0, y: 0, w: 599, h: 487, z: 3, data: {} },
  ];
  const context = loadSortCommandHarness(objects, objects.map((obj) => obj.id));

  assert.equal(context.sortSelectedImages({ x: 100, y: 200 }), true);
  assert.equal(context.sortSelectedImages({ x: 100, y: 200 }), false);
  assert.equal(context.calls.commits.length, 1);
  assert.deepEqual(context.calls.histories, ['sort-images']);
});

test('paste sizing keeps extreme-aspect images positive while using the shared cap', () => {
  const source = readSource('src/js/image_insert.js');
  const start = source.indexOf('function fitImageSize(naturalW, naturalH) {');
  const end = source.indexOf('\nconst isWebInsertImageFile', start);
  assert.ok(start >= 0 && end > start, 'image fit helper is missing');
  const context = {
    BoardfishImageLayout: { DEFAULT_IMAGE_MAX_DIMENSION: 600 },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.fitImageSize = fitImageSize;\n`,
    context,
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.fitImageSize(10000, 1))),
    { w: 600, h: 1 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.fitImageSize(1, 10000))),
    { w: 1, h: 600 },
  );
});

function loadObjectMenuVisibilityHarness() {
  const source = readSource('src/js/context_menu.js');
  const start = source.indexOf('function updateObjMenuActions() {');
  const end = source.indexOf('\nconst updateTextEditMenuActions', start);
  assert.ok(start >= 0 && end > start, 'object menu action updater is missing');
  const element = () => ({ style: {} });
  const context = {
    selectedIds: new Set(),
    objectsMap: new Map(),
    copyBtn: element(),
    imageActionsSep: element(),
    arrangeImagesBtn: element(),
    flipBtn: element(),
    rotateBtn: element(),
    layerActionsSep: element(),
    moveToBackBtn: element(),
    saveImageBtn: element(),
    saveImagesBtn: { style: {}, firstElementChild: { textContent: '' } },
    exportSep: element(),
    deleteSep: element(),
    deleteBtn: element(),
  };
  context.isMultiSelected = () => context.selectedIds.size > 1;
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.updateObjMenuActions = updateObjMenuActions;\n`,
    context,
  );
  return context;
}

test('object menu shows Arrange Images only when at least two selected objects are images', () => {
  const context = loadObjectMenuVisibilityHarness();
  const imageA = { id: 'image-a', type: 'image' };
  const imageB = { id: 'image-b', type: 'image' };
  const textA = { id: 'text-a', type: 'text' };
  context.objectsMap = new Map([imageA, imageB, textA].map((obj) => [obj.id, obj]));

  const visibleFor = (ids) => {
    context.selectedIds = new Set(ids);
    context.updateObjMenuActions();
    return context.arrangeImagesBtn.style.display !== 'none';
  };

  assert.equal(visibleFor(['image-a']), false);
  assert.equal(visibleFor(['image-a', 'text-a']), false);
  assert.equal(visibleFor(['image-a', 'image-b']), true);
  assert.equal(visibleFor(['image-a', 'image-b', 'text-a']), true);
  assert.equal(visibleFor(['text-a']), false);
  assert.equal(visibleFor(['image-a', 'stale-image-id']), false);
});

test('Arrange Images menu integration uses the activation pointer and shared paste size', () => {
  const indexSource = readSource('src/index.html');
  const appSource = readSource('src/app.js');
  const contextMenuSource = readSource('src/js/context_menu.js');
  const imageInsertSource = readSource('src/js/image_insert.js');
  const manifestSource = readSource('src/js/startup_manifest.mjs');

  assert.match(
    indexSource,
    /id="obj-btn-arrange-images"[^>]*>[\s\S]*?Arrange Images[\s\S]*?data-shortcut="arrange-images"/,
  );
  const rotateIndex = indexSource.indexOf('id="obj-btn-rotate"');
  const layerSeparatorIndex = indexSource.indexOf('id="obj-sep-layer-actions"');
  const arrangeIndex = indexSource.indexOf('id="obj-btn-arrange-images"');
  const moveToBackIndex = indexSource.indexOf('id="obj-btn-move-to-back"');
  assert.ok(rotateIndex < layerSeparatorIndex);
  assert.ok(layerSeparatorIndex < arrangeIndex);
  assert.ok(arrangeIndex < moveToBackIndex);
  assert.match(appSource, /arrangeImagesBtn\s*= requireAppElement\('obj-btn-arrange-images'\)/);
  assert.match(appSource, /var OPTION_KEY_LABEL = IS_MAC \? '\\u2325' : 'Alt';/);
  assert.match(
    appSource,
    /'arrange-images': IS_MAC\s*\? \[OPTION_KEY_LABEL, COMMAND_KEY_LABEL, 'A'\]\s*: \[COMMAND_KEY_LABEL, OPTION_KEY_LABEL, 'A'\]/,
  );
  assert.match(
    contextMenuSource,
    /'obj-btn-arrange-images': \(event\) => \{\s*const point = menuCommandWorldPoint\(event\);\s*closeObjCtxMenu\('command:arrange-images'\);\s*sortSelectedImages\(point\);\s*\}/,
  );
  assert.match(contextMenuSource, /'arrange-images': \[\['obj-ctx-menu', 'obj-btn-arrange-images'\]\]/);
  assert.match(contextMenuSource, /arrangeImagesBtn\.style\.display = imageCount >= 2 \? '' : 'none';/);
  assert.match(imageInsertSource, /const MAX = BoardfishImageLayout\.DEFAULT_IMAGE_MAX_DIMENSION;/);
  assert.match(imageInsertSource, /w = Math\.max\(1, Math\.round\(w \* scale\)\);/);
  assert.match(imageInsertSource, /h = Math\.max\(1, Math\.round\(h \* scale\)\);/);
  assert.equal((manifestSource.match(/'image_layout\.js'/g) || []).length, 2);
});
