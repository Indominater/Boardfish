'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const readSource = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadSortCommandHarness(sourceObjects, selectedIds, randomValues = [0.999999]) {
  const calls = {
    commits: [],
    dirty: [],
    histories: [],
    invalidations: 0,
    renders: 0,
  };
  let randomIndex = 0;
  const testMath = Object.create(Math);
  testMath.random = () => {
    if (typeof randomValues === 'function') return randomValues();
    const index = Math.min(randomIndex++, randomValues.length - 1);
    return randomValues[index] ?? 0.999999;
  };
  const context = {
    console,
    calls,
    Math: testMath,
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
  context.selectedBounds = () => {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const id of context.selectedIds) {
      const obj = context.objectsMap.get(id);
      if (!obj) continue;
      x1 = Math.min(x1, obj.x);
      y1 = Math.min(y1, obj.y);
      x2 = Math.max(x2, obj.x + obj.w);
      y2 = Math.max(y2, obj.y + obj.h);
    }
    return x1 === Infinity ? null : { x1, y1, x2, y2 };
  };
  context.markDirty = (obj) => calls.dirty.push(obj.id);
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

test('sortSelectedImages centers the new rectangle on the whole selection box', () => {
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

  assert.equal(context.sortSelectedImages(), true);

  const imageA = objects[2];
  const imageB = objects[0];
  assert.deepEqual(
    [imageA.x, imageA.y, imageA.w, imageA.h],
    [-490, -230, 600, 600],
  );
  assert.deepEqual(
    [imageB.x, imageB.y, imageB.w, imageB.h],
    [110, -230, 600, 600],
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

  assert.equal(context.sortSelectedImages(), false);
  assert.equal(context.calls.commits.length, 1);
  assert.deepEqual(context.calls.histories, ['sort-images']);
});

test('sortSelectedImages shuffles optimized rows and images before placing them', () => {
  const objects = [
    { id: 'a', type: 'image', x: 0, y: 0, w: 3, h: 1, z: 1, data: {} },
    { id: 'b', type: 'image', x: 0, y: 0, w: 2, h: 1, z: 2, data: {} },
    { id: 'c', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 3, data: {} },
    { id: 'd', type: 'image', x: 0, y: 0, w: 0.5, h: 1, z: 4, data: {} },
  ];
  const context = loadSortCommandHarness(
    objects,
    objects.map((obj) => obj.id),
    [0, 0, 0],
  );

  assert.equal(context.sortSelectedImages(), true);

  const geometry = Object.fromEntries(objects.map((obj) => [
    obj.id,
    [obj.x, obj.y, obj.w, obj.h],
  ]));
  assert.deepEqual(geometry, {
    a: [-748.5, 0.5, 1800, 600],
    b: [-448.5, -599.5, 1200, 600],
    c: [-1048.5, -599.5, 600, 600],
    d: [-1048.5, 0.5, 300, 600],
  });
  assert.equal(geometry.c[0] + geometry.c[2], geometry.b[0]);
  assert.equal(geometry.d[0] + geometry.d[2], geometry.a[0]);
  assert.deepEqual(context.calls.histories, ['sort-images']);
});

test('sortSelectedImages samples a fresh presentation order on each invocation', () => {
  const objects = [
    { id: 'a', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, data: {} },
    { id: 'b', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 2, data: {} },
  ];
  const context = loadSortCommandHarness(objects, ['a', 'b'], [0.999999, 0]);

  assert.equal(context.sortSelectedImages(), true);
  assert.deepEqual(objects.map((obj) => [obj.id, obj.x]), [['a', 0.5], ['b', -599.5]]);

  assert.equal(context.sortSelectedImages(), true);
  assert.deepEqual(objects.map((obj) => [obj.id, obj.x]), [['a', -599.5], ['b', 0.5]]);
  assert.equal(context.calls.commits.length, 2);
  assert.deepEqual(context.calls.histories, ['sort-images', 'sort-images']);
});

test('sortSelectedImages samples fresh row membership when optimal partitions tie', () => {
  const objects = Array.from('abcdef', (id, index) => ({
    id,
    type: 'image',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    z: index,
    data: {},
  }));
  let seed = 1;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const context = loadSortCommandHarness(objects, objects.map((obj) => obj.id), random);
  const membership = () => {
    const rows = new Map();
    for (const obj of objects) {
      if (!rows.has(obj.y)) rows.set(obj.y, []);
      rows.get(obj.y).push(obj.id);
    }
    return [...rows.values()]
      .map((ids) => ids.sort().join(''))
      .sort()
      .join('|');
  };

  assert.equal(context.sortSelectedImages(), true);
  const firstMembership = membership();
  assert.equal(context.sortSelectedImages(), true);

  assert.notEqual(membership(), firstMembership);
  assert.equal(new Set(objects.map((obj) => obj.y)).size, 2);
  assert.deepEqual(context.calls.histories, ['sort-images', 'sort-images']);
});

test('sortSelectedImages rechecks that at least two valid images are selected', () => {
  const objects = [
    { id: 'image-a', type: 'image', x: 0, y: 0, w: 100, h: 100, z: 1, data: {} },
    { id: 'text-a', type: 'text', x: 0, y: 0, w: 100, h: 100, z: 2, data: { content: '' } },
  ];
  const context = loadSortCommandHarness(objects, ['image-a', 'text-a', 'stale-image-id']);

  assert.equal(context.sortSelectedImages(), false);
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

  assert.equal(context.sortSelectedImages(), true);
  assert.equal(context.sortSelectedImages(), false);
  assert.equal(context.calls.commits.length, 1);
  assert.deepEqual(context.calls.histories, ['sort-images']);
});

test('paste sizing keeps extreme-aspect images positive while using the shared cap', () => {
  const source = readSource('src/js/image_insert.js');
  const start = source.indexOf('    let w = naturalW, h = naturalH;');
  const end = source.indexOf("\n    if (typeof BOARDFISH_PRODUCTION === 'undefined')", start);
  assert.ok(start >= 0 && end > start, 'inline image sizing is missing');
  const context = {
    BoardfishImageLayout: { DEFAULT_IMAGE_MAX_DIMENSION: 600 },
  };
  vm.createContext(context);
  vm.runInContext(
    `globalThis.fitImageSize = (naturalW, naturalH) => {${source.slice(start, end)}; return { w, h };};\n`,
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
  const end = source.indexOf('\nconst showTextEditContextMenuAt', start);
  assert.ok(start >= 0 && end > start, 'object menu action updater is missing');
  const element = () => ({ style: {} });
  const context = {
    selectedIds: new Set(),
    objectsMap: new Map(),
    copyBtn: element(),
    objectActionsSep: element(),
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

test('object menu shows Arrange only when at least two selected objects are images', () => {
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

  visibleFor(['text-a']);
  assert.equal(context.objectActionsSep.style.display, 'none');
  assert.equal(context.layerActionsSep.style.display, 'block');
  visibleFor(['image-a', 'image-b']);
  assert.equal(context.objectActionsSep.style.display, 'block');
  assert.equal(context.layerActionsSep.style.display, 'block');
});

test('Arrange menu integration is selection-centered and uses the shared paste size', () => {
  const indexSource = readSource('src/index.html');
  const appSource = readSource('src/app.js');
  const contextMenuSource = readSource('src/js/context_menu.js');
  const imageInsertSource = readSource('src/js/image_insert.js');
  const stateSource = readSource('src/js/state.js');
  const manifestSource = readSource('src/js/startup_manifest.mjs');

  assert.match(
    indexSource,
    /id="obj-btn-arrange-images"[^>]*><span class="ctx-label">Arrange<\/span><span class="ctx-shortcut" data-shortcut="arrange-images">/,
  );
  assert.doesNotMatch(indexSource, />Arrange Images</);
  const objectSeparatorIndex = indexSource.indexOf('id="obj-sep-object-actions"');
  const flipIndex = indexSource.indexOf('id="obj-btn-flip"');
  const rotateIndex = indexSource.indexOf('id="obj-btn-rotate"');
  const arrangeIndex = indexSource.indexOf('id="obj-btn-arrange-images"');
  const layerSeparatorIndex = indexSource.indexOf('id="obj-sep-layer-actions"');
  const moveToBackIndex = indexSource.indexOf('id="obj-btn-move-to-back"');
  assert.ok(objectSeparatorIndex < flipIndex);
  assert.ok(flipIndex < rotateIndex);
  assert.ok(rotateIndex < arrangeIndex);
  assert.ok(arrangeIndex < layerSeparatorIndex);
  assert.ok(layerSeparatorIndex < moveToBackIndex);
  assert.match(appSource, /arrangeImagesBtn\s*= requireAppElement\('obj-btn-arrange-images'\)/);
  assert.match(appSource, /objectActionsSep\s*= requireAppElement\('obj-sep-object-actions'\)/);
  assert.match(appSource, /layerActionsSep\s*= requireAppElement\('obj-sep-layer-actions'\)/);
  assert.match(
    appSource,
    /'arrange-images': COMMAND_KEY_LABEL \+ 'J'/,
  );
  assert.match(
    contextMenuSource,
    /'obj-btn-arrange-images': \(\) => \{\s*closeObjCtxMenu\('command:arrange-images'\);\s*sortSelectedImages\(\);\s*\}/,
  );
  assert.match(contextMenuSource, /'arrange-images': \[\['obj-ctx-menu', 'obj-btn-arrange-images'\]\]/);
  assert.match(contextMenuSource, /objectActionsSep\.style\.display = showImageActions \? 'block' : 'none';/);
  assert.match(contextMenuSource, /layerActionsSep\.style\.display = showLayerActions \? 'block' : 'none';/);
  assert.match(contextMenuSource, /arrangeImagesBtn\.style\.display = imageCount >= 2 \? '' : 'none';/);
  assert.match(stateSource, /\{ shuffleOrder: true, randomizeTies: true \}/);
  assert.match(imageInsertSource, /const maxDimension = BoardfishImageLayout\.DEFAULT_IMAGE_MAX_DIMENSION;/);
  assert.match(imageInsertSource, /w = Math\.max\(1, Math\.round\(w \* scale\)\);/);
  assert.match(imageInsertSource, /h = Math\.max\(1, Math\.round\(h \* scale\)\);/);
  assert.equal((manifestSource.match(/'image_layout\.js'/g) || []).length, 2);
});
