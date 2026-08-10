'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ImageLayout = require('../src/js/image_layout.js');

const approximatelyEqual = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

const placementMap = (layout) => new Map(layout.placements.map((placement) => [placement.id, placement]));

test('golden image layout uses the shared 600-unit height and current displayed aspect ratio', () => {
  const images = [
    { id: 'wide', w: 600, h: 300 },
    { id: 'tall', w: 300, h: 600 },
  ];
  const before = structuredClone(images);

  const layout = ImageLayout.planGoldenRatioImageLayout(images, { x: 0, y: 0 });
  const placements = placementMap(layout);

  assert.equal(ImageLayout.DEFAULT_IMAGE_MAX_DIMENSION, 600);
  assert.equal(placements.get('wide').h, 600);
  assert.equal(placements.get('wide').w, 1200);
  assert.equal(placements.get('tall').h, 600);
  assert.equal(placements.get('tall').w, 300);
  assert.deepEqual(images, before);
});

test('golden image layout exactly minimizes the squared row-width error for a small selection', () => {
  const images = [
    { id: 'a', w: 3, h: 1 },
    { id: 'b', w: 2, h: 1 },
    { id: 'c', w: 1, h: 1 },
    { id: 'd', w: 0.5, h: 1 },
  ];

  const layout = ImageLayout.planGoldenRatioImageLayout(images, { x: 500, y: 700 });

  assert.equal(layout.rowCount, 2);
  assert.deepEqual(layout.rows.map((row) => row.width), [2100, 1800]);
  assert.deepEqual(layout.rows.map((row) => row.itemIds), [['a', 'd'], ['b', 'c']]);
  approximatelyEqual(layout.idealWidth, ImageLayout.GOLDEN_RATIO * 1200);
  approximatelyEqual(
    layout.error,
    layout.rows.reduce((sum, row) => sum + (row.width - layout.idealWidth) ** 2, 0),
  );

  // The visible occupied rectangle follows paste/duplicate centering behavior.
  assert.equal(layout.occupiedWidth, 2100);
  assert.equal(layout.left, -550);
  assert.equal(layout.top, 100);
  assert.equal(layout.left + layout.occupiedWidth / 2, 500);
  assert.equal(layout.top + layout.height / 2, 700);

  for (const row of layout.rows) {
    const placements = layout.placements
      .filter((placement) => placement.row === layout.rows.indexOf(row))
      .sort((a, b) => a.column - b.column);
    assert.equal(placements[0].x, layout.left);
    for (let i = 1; i < placements.length; i++) {
      assert.equal(placements[i].x, placements[i - 1].x + placements[i - 1].w);
      assert.equal(placements[i].y, placements[i - 1].y);
    }
  }
  assert.equal(layout.rows[1].y - layout.rows[0].y, 600);
});

test('golden image layout row membership and order are independent of selection order', () => {
  const images = [
    { id: 'equal-b', w: 1, h: 1 },
    { id: 'wide', w: 3, h: 1 },
    { id: 'equal-a', w: 1, h: 1 },
    { id: 'narrow', w: 0.5, h: 1 },
    { id: 'medium', w: 2, h: 1 },
  ];
  const center = { x: 123.5, y: -77.25 };

  const forward = ImageLayout.planGoldenRatioImageLayout(images, center);
  const reversed = ImageLayout.planGoldenRatioImageLayout(images.slice().reverse(), center);

  assert.deepEqual(reversed, forward);
});

test('golden image layout finds the exact optimum for a non-greedy 13-image partition', () => {
  const aspects = [0.25, 1.8, 3.25, 4.95, 0.4, 1.5, 2.05, 2.55, 2.4, 2.8, 0.9, 3.7, 2.75];
  const images = aspects.map((aspect, index) => ({ id: `image-${index}`, w: aspect, h: 1 }));

  const layout = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );

  assert.equal(layout.rowCount, 4);
  assert.deepEqual(layout.rows.map((row) => row.width), [7.35, 7.35, 7.300000000000001, 7.3]);
  approximatelyEqual(layout.error, 2.912008317017916);
});

test('golden image layout chooses the best row count for representative shapes', () => {
  const plan = (aspects) => ImageLayout.planGoldenRatioImageLayout(
    aspects.map((aspect, index) => ({ id: `image-${index}`, w: aspect, h: 1 })),
    { x: 0, y: 0 },
  );

  assert.equal(plan([1, 1]).rowCount, 1);
  assert.equal(plan([5, 5]).rowCount, 2);
  assert.equal(plan([1, 1, 1, 1]).rowCount, 2);
  assert.equal(plan(Array(15).fill(1)).rowCount, 3);
});

test('golden image layout remains deterministic and complete at the board object limit', () => {
  const images = Array.from({ length: 100 }, (_, index) => ({
    id: `image-${String(index).padStart(3, '0')}`,
    w: 50 + (index * 7919) % 500,
    h: 50 + (index * 3571) % 450,
  }));

  const first = ImageLayout.planGoldenRatioImageLayout(images, { x: 10, y: 20 });
  const second = ImageLayout.planGoldenRatioImageLayout(images, { x: 10, y: 20 });

  assert.deepEqual(second, first);
  assert.equal(first.placements.length, images.length);
  assert.equal(new Set(first.placements.map((placement) => placement.id)).size, images.length);
  assert.equal(first.rows.every((row) => row.itemIds.length > 0), true);
  assert.equal(first.placements.every((placement) => (
    Number.isFinite(placement.x) && Number.isFinite(placement.y) &&
    Number.isFinite(placement.w) && placement.w > 0 && placement.h === 600
  )), true);
});

test('golden image layout keeps every heuristic row nonempty for extreme finite ratios', () => {
  const images = [
    { id: 'wide', w: 1000, h: 1 },
    ...Array.from({ length: 13 }, (_, index) => ({ id: `tiny-${index}`, w: 1e-16, h: 1 })),
  ];

  const layout = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );

  assert.equal(layout.rowCount, 14);
  assert.equal(layout.rows.every((row) => row.itemIds.length === 1), true);
});

test('golden image layout avoids overflow while scaling large finite dimensions', () => {
  const squareLayout = ImageLayout.planGoldenRatioImageLayout([
    { id: 'square-a', w: 1e308, h: 1e308 },
    { id: 'square-b', w: 1e308, h: 1e308 },
  ]);
  assert.deepEqual(squareLayout.placements.map((placement) => placement.w), [600, 600]);

  const overflowingTotal = ImageLayout.planGoldenRatioImageLayout([
    { id: 'wide-a', w: 1e305, h: 1 },
    { id: 'wide-b', w: 1e305, h: 1 },
    { id: 'wide-c', w: 1e305, h: 1 },
  ]);
  assert.equal(overflowingTotal, null);

  const overflowingSquaredError = ImageLayout.planGoldenRatioImageLayout([
    { id: 'large-a', w: 1e153, h: 1 },
    { id: 'large-b', w: 1e153, h: 1 },
  ]);
  assert.equal(overflowingSquaredError, null);
});
