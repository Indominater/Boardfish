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

const seededRandom = (initialSeed) => {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
};

const rowMembershipSignature = (layout) => layout.rows
  .map((row) => row.itemIds.slice().sort().join(','))
  .sort()
  .join('|');

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

test('golden image layout can shuffle rows and images without changing the optimized shape', () => {
  const images = [
    { id: 'a', w: 3, h: 1 },
    { id: 'b', w: 2, h: 1 },
    { id: 'c', w: 1, h: 1 },
    { id: 'd', w: 0.5, h: 1 },
  ];
  const center = { x: 500, y: 700 };
  const canonical = ImageLayout.planGoldenRatioImageLayout(images, center);
  const samples = [0, 0, 0];
  let sampleIndex = 0;

  const shuffled = ImageLayout.planGoldenRatioImageLayout(images, center, {
    shuffleOrder: true,
    random: () => samples[sampleIndex++],
  });

  assert.equal(sampleIndex, 3);
  assert.deepEqual(shuffled.rows.map((row) => row.itemIds), [['c', 'b'], ['d', 'a']]);
  assert.deepEqual(shuffled.rows.map((row) => row.width), [1800, 2100]);
  assert.equal(shuffled.rowCount, canonical.rowCount);
  assert.equal(shuffled.error, canonical.error);
  assert.equal(shuffled.occupiedWidth, canonical.occupiedWidth);
  assert.equal(shuffled.height, canonical.height);
  assert.equal(shuffled.left, canonical.left);
  assert.equal(shuffled.top, canonical.top);

  for (let rowIndex = 0; rowIndex < shuffled.rows.length; rowIndex++) {
    const placements = shuffled.placements
      .filter((placement) => placement.row === rowIndex)
      .sort((a, b) => a.column - b.column);
    assert.equal(placements[0].x, shuffled.left);
    for (let column = 1; column < placements.length; column++) {
      assert.equal(placements[column].x, placements[column - 1].x + placements[column - 1].w);
    }
  }
});

test('golden image layout randomly selects across every tied exact partition', () => {
  const images = Array.from('abcdef', (id) => ({ id, w: 1, h: 1 }));
  const canonical = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );
  const signatures = new Set();

  for (let seed = 1; seed <= 256; seed++) {
    const layout = ImageLayout.planGoldenRatioImageLayout(
      images,
      { x: 0, y: 0 },
      { rowHeight: 1, randomizeTies: true, random: seededRandom(seed) },
    );
    signatures.add(rowMembershipSignature(layout));
    assert.equal(layout.rowCount, 2);
    assert.deepEqual(layout.rows.map((row) => row.width), [3, 3]);
    approximatelyEqual(layout.error, canonical.error);
    assert.deepEqual(
      layout.placements.map((placement) => placement.id).sort(),
      Array.from('abcdef'),
    );
  }

  // Six labeled images split 3-and-3 have ten unordered optimal partitions.
  assert.equal(signatures.size, 10);
});

test('golden image layout randomizes exact unequal-width swaps in exact partitions', () => {
  const widths = [2, 2, 1, 3, 1];
  const images = widths.map((w, index) => ({ id: `image-${index}`, w, h: 1 }));
  const widthById = new Map(images.map((image) => [image.id, image.w]));
  const compositionSignature = (layout) => layout.rows
    .map((row) => row.itemIds.map((id) => widthById.get(id)).sort((a, b) => a - b).join(','))
    .sort()
    .join('|');
  const canonical = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );
  const compositions = new Set();

  for (let seed = 1; seed <= 64; seed++) {
    const layout = ImageLayout.planGoldenRatioImageLayout(
      images,
      { x: 0, y: 0 },
      { rowHeight: 1, randomizeTies: true, random: seededRandom(seed) },
    );
    compositions.add(compositionSignature(layout));
    assert.equal(layout.error, canonical.error);
    assert.equal(
      layout.error,
      layout.rows.reduce((sum, row) => sum + (row.width - layout.idealWidth) ** 2, 0),
    );
  }

  assert.equal(compositions.size, 2);
});

test('golden image layout never trades score for randomized tie-breaking', () => {
  const images = [3, 2, 1, 0.5].map((w, index) => ({
    id: String.fromCharCode(97 + index),
    w,
    h: 1,
  }));
  const canonical = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );

  for (let seed = 1; seed <= 32; seed++) {
    const randomized = ImageLayout.planGoldenRatioImageLayout(
      images,
      { x: 0, y: 0 },
      { rowHeight: 1, randomizeTies: true, random: seededRandom(seed) },
    );
    assert.equal(rowMembershipSignature(randomized), rowMembershipSignature(canonical));
    assert.equal(randomized.error, canonical.error);
  }
});

test('golden image layout excludes tolerance-close scores from exact tie randomization', () => {
  const images = [1 + 5e-7, 1 - 5e-7, 1, 1, 1, 1].map((w, index) => ({
    id: `image-${index}`,
    w,
    h: 1,
  }));
  const canonical = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );

  for (let seed = 1; seed <= 32; seed++) {
    const randomized = ImageLayout.planGoldenRatioImageLayout(
      images,
      { x: 0, y: 0 },
      { rowHeight: 1, randomizeTies: true, random: seededRandom(seed) },
    );
    assert.equal(randomized.error, canonical.error);
  }
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

test('golden image layout randomizes equal-score memberships in the large-selection heuristic', () => {
  const images = Array.from({ length: 15 }, (_, index) => ({
    id: `image-${index}`,
    w: 1,
    h: 1,
  }));
  const canonical = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );
  const signatures = new Set();

  for (let seed = 1; seed <= 32; seed++) {
    const layout = ImageLayout.planGoldenRatioImageLayout(
      images,
      { x: 0, y: 0 },
      { rowHeight: 1, randomizeTies: true, random: seededRandom(seed) },
    );
    signatures.add(rowMembershipSignature(layout));
    assert.equal(layout.rowCount, canonical.rowCount);
    assert.deepEqual(layout.rows.map((row) => row.width), [5, 5, 5]);
    assert.equal(layout.error, canonical.error);
  }

  assert.ok(signatures.size > 1);
});

test('golden image layout randomizes exact unequal-width heuristic swaps only', () => {
  const widths = [
    0.6, 0.3, 0.6, 1.2, 0.9, 0.3, 0.5, 0.9, 0.8,
    0.1, 0.5, 0.1, 0.2, 1.3, 1.1, 1.1, 0.1,
  ];
  const images = widths.map((w, index) => ({ id: `image-${index}`, w, h: 1 }));
  const widthById = new Map(images.map((image) => [image.id, image.w]));
  const compositionSignature = (layout) => layout.rows
    .map((row) => row.itemIds.map((id) => widthById.get(id)).sort((a, b) => a - b).join(','))
    .sort()
    .join('|');
  const canonical = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );
  const compositions = new Set();

  for (let seed = 1; seed <= 64; seed++) {
    const layout = ImageLayout.planGoldenRatioImageLayout(
      images,
      { x: 0, y: 0 },
      { rowHeight: 1, randomizeTies: true, random: seededRandom(seed) },
    );
    compositions.add(compositionSignature(layout));
    assert.equal(layout.error, canonical.error);
  }

  assert.ok(compositions.size > 1);
});

test('golden image layout excludes tolerance-close scores from heuristic tie randomization', () => {
  const widths = [1 + 1e-6, 1 - 1e-6, ...Array(13).fill(1)];
  const images = widths.map((w, index) => ({ id: `image-${index}`, w, h: 1 }));
  const canonical = ImageLayout.planGoldenRatioImageLayout(
    images,
    { x: 0, y: 0 },
    { rowHeight: 1 },
  );

  for (let seed = 1; seed <= 32; seed++) {
    const randomized = ImageLayout.planGoldenRatioImageLayout(
      images,
      { x: 0, y: 0 },
      { rowHeight: 1, randomizeTies: true, random: seededRandom(seed) },
    );
    assert.equal(randomized.error, canonical.error);
  }
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
