'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlan } = require('../src/js/panel_visibility.js');

const viewport = { x1: 0, y1: 0, x2: 800, y2: 600 };
const text = (id, x = 100, y = 100, w = 300, h = 160, content = 'Text') =>
  ({ id, type: 'text', x, y, w, h, data: { content } });
const image = (id, x, y, w, h) => ({ id, type: 'image', x, y, w, h, data: {} });

test('identical stacked panels hide lower glyphs while preserving accumulated shadows and corner antialiasing', () => {
  const bottom = text('bottom'), top = text('top');
  const plan = createPlan([bottom, top], viewport);
  assert.deepEqual(plan.get(top), { hidden: false, textHidden: false, bodyHidden: false, shadowHidden: false });
  assert.deepEqual(plan.get(bottom), { hidden: false, textHidden: true, bodyHidden: false, shadowHidden: false });
});

test('a larger opaque panel can hide another panel including its full four-sigma shadow', () => {
  const lower = text('lower', 150, 150, 100, 100);
  const upper = text('upper', 80, 80, 240, 250);
  const plan = createPlan([lower, upper], viewport);
  assert.deepEqual(plan.get(lower), { hidden: true, textHidden: true, bodyHidden: true, shadowHidden: true });
  upper.h = 200;
  const tailVisible = createPlan([lower, upper], viewport).get(lower);
  assert.equal(tailVisible.bodyHidden, true);
  assert.equal(tailVisible.textHidden, true);
  assert.equal(tailVisible.shadowHidden, false);
  assert.equal(tailVisible.hidden, false);
});

test('images are hidden only inside opaque squircle interiors, including their one-pixel overdraw', () => {
  const corner = image('corner', 100, 100, 4, 4);
  const interior = image('interior', 130, 130, 10, 10);
  const fringe = image('fringe', 100.5, 145, 1, 10);
  const top = text('top');
  const plan = createPlan([corner, interior, fringe, top], viewport);
  assert.equal(plan.get(corner).hidden, false);
  assert.equal(plan.get(interior).hidden, true);
  assert.equal(plan.get(fringe).hidden, false);
});

test('image transparency is never assumed opaque and translucent panels do not occlude', () => {
  const lower = text('lower'), upper = image('upper', 0, 0, 800, 600);
  assert.equal(createPlan([lower, upper], viewport).get(lower).textHidden, false);
  assert.equal(createPlan([lower, text('top')], viewport, { opaque: false }).size, 0);
});

test('rotated image corners and their rotated edge overdraw remain visible outside an occluder', () => {
  const rotated = image('rotated', 100, 100, 100, 100);
  rotated.data.rotation = 45;
  const upper = text('upper', 90, 90, 120, 120);
  assert.equal(createPlan([rotated, upper], viewport).get(rotated).hidden, false);
  rotated.data.rotation = 0;
  assert.equal(createPlan([rotated, upper], viewport).get(rotated).hidden, true);
  rotated.data.rotation = 90;
  rotated.w = 100;
  rotated.h = 40;
  assert.equal(createPlan([rotated, upper], viewport).get(rotated).hidden, true);
  rotated.data.rotation = 45;
  rotated.data.flipX = true;
  assert.equal(createPlan([rotated, upper], viewport).get(rotated).hidden, false);
});

test('the tile union combines several occluders without treating gaps as covered', () => {
  const lower = image('lower', 40, 40, 160, 160);
  const left = text('left', 0, 0, 130, 256);
  const right = text('right', 110, 0, 146, 256);
  const smallViewport = { x1: 0, y1: 0, x2: 256, y2: 256 };
  assert.equal(createPlan([lower, left, right], smallViewport).get(lower).hidden, true);
  left.w = 100;
  assert.equal(createPlan([lower, left, right], smallViewport).get(lower).hidden, false);
});

test('only the portion inside the viewport needs to be occluded', () => {
  const lower = image('lower', -200, 40, 400, 160);
  const upper = text('upper', -20, 0, 260, 256);
  assert.equal(createPlan([lower, upper], { x1: 0, y1: 0, x2: 256, y2: 256 }).get(lower).hidden, true);
});

test('painter order, skipped editing objects, and only-text passes determine the occluders', () => {
  const lower = text('lower'), upper = text('upper');
  const img = image('image', 130, 130, 10, 10);
  const skipped = createPlan([lower, upper], viewport, {}, { skipId: 'upper' });
  assert.equal(skipped.has(upper), false);
  assert.equal(skipped.size, 0);
  assert.equal(createPlan([upper, lower], viewport).get(upper).textHidden, true);
  const textOnly = createPlan([lower, img, upper], viewport, {}, { onlyText: true });
  assert.equal(textOnly.has(img), false);
  assert.equal(textOnly.get(lower).textHidden, true);
});

test('fractional zoom and distant board coordinates retain the same coverage decisions', () => {
  const objects = [text('lower'), image('image', 130, 130, 10, 10), text('upper')];
  const settings = { zoom: 0.7137, dpr: 2 };
  const expected = [...createPlan(objects, viewport, {}, settings).values()];
  const offset = 10_000_000;
  const distant = objects.map(obj => ({ ...obj, x: obj.x + offset, y: obj.y - offset }));
  const distantViewport = { x1: offset, y1: -offset, x2: offset + 800, y2: -offset + 600 };
  assert.deepEqual([...createPlan(distant, distantViewport, {}, settings).values()], expected);
});

test('narrow text and legacy Unicode never infer unsupported glyph bounds, and edits invalidate the ASCII decision', () => {
  const lower = text('lower'), upper = text('upper');
  assert.equal(createPlan([lower, upper], viewport).get(lower).textHidden, true);
  lower.data.content = 'Text 👩‍💻';
  assert.equal(createPlan([lower, upper], viewport).get(lower).textHidden, false);
  lower.data.content = 'ASCII\t\n';
  assert.equal(createPlan([lower, upper], viewport).get(lower).textHidden, true);
  lower.w = 32;
  assert.equal(createPlan([lower, upper], viewport).get(lower).textHidden, false);
});

test('offscreen shapes, tiny panels, zero-sized and invalid inputs stay conservative', () => {
  const lower = text('lower'), top = text('top', 2000, 2000);
  assert.equal(createPlan([lower, top], viewport).get(lower).textHidden, false);
  assert.equal(createPlan([lower], viewport, {}, { zoom: 0 }).size, 0);
  assert.equal(createPlan([lower], { ...viewport, x1: NaN }).size, 0);
  const empty = text('empty', 0, 0, 0, 0);
  assert.equal(createPlan([lower, empty], viewport).has(empty), false);
  const tiny = text('tiny', 100, 100, 1, 1);
  assert.equal(createPlan([lower, tiny], viewport).get(lower).hidden, false);
});

test('thousands of identical boxes retain only the front glyph layout without suppressing shadows', () => {
  const boxes = Array.from({ length: 4000 }, (_, index) => text(`text-${index}`));
  const plan = createPlan(boxes, viewport);
  assert.equal(plan.size, boxes.length);
  assert.equal([...plan.values()].filter(value => !value.textHidden).length, 1);
  assert.equal([...plan.values()].filter(value => !value.shadowHidden).length, boxes.length);
});

test('custom shadow bounds are honored independently from the body', () => {
  const lower = text('lower', 150, 150, 100, 100), upper = text('upper', 100, 100, 200, 200);
  const compact = createPlan([lower, upper], viewport, { bounds: obj => ({ x1: obj.x - 1, y1: obj.y - 1, x2: obj.x + obj.w + 1, y2: obj.y + obj.h + 1 }) });
  assert.equal(compact.get(lower).hidden, true);
});

test('invalid external shadow bounds and overflowing object metadata cannot prove occlusion', () => {
  const lower = text('lower'), upper = text('upper', 0, 0, 800, 600);
  for (const bounds of [null, { x1: NaN, y1: 0, x2: 1, y2: 1 }, { x1: 5, y1: 0, x2: 1, y2: 1 }]) {
    const flags = createPlan([lower, upper], viewport, { bounds: () => bounds }).get(lower);
    assert.equal(flags.hidden, false);
    assert.equal(flags.shadowHidden, false);
  }
  const overflow = text('overflow', Number.MAX_VALUE, 0, Number.MAX_VALUE, 100);
  assert.equal(createPlan([lower, overflow], viewport).has(overflow), false);
});

test('single objects, image-only boards, and passes with no participating text need no coverage plan', () => {
  assert.equal(createPlan([text('only')], viewport).size, 0);
  const images = Array.from({ length: 2000 }, (_, index) => image(`image-${index}`, 0, 0, 100, 100));
  assert.equal(createPlan(images, viewport).size, 0);
  assert.equal(createPlan([...images, text('skipped')], viewport, {}, { skipId: 'skipped' }).size, 0);
  assert.equal(createPlan([...images, text('only')], viewport, {}, { onlyText: true }).size, 0);
});
