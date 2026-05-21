'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTextLayout() {
  const measured = [];
  const context = {
    document: {
      createElement() {
        return {
          getContext() {
            return {
              font: '',
              textBaseline: '',
              measureText(text) {
                measured.push(String(text));
                return {
                  width: String(text).length,
                  actualBoundingBoxAscent: 12,
                  actualBoundingBoxDescent: 4,
                };
              },
            };
          },
        };
      },
    },
    objects: [],
    invalidateOffscreen() {},
    scheduleRender() {},
    syncAllTextAutoHeights() {},
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'text_layout.js'), 'utf8'),
    context,
    { filename: 'text_layout.js' },
  );
  vm.runInContext(
    `globalThis.__testTextLayout = {
      measureTextW,
      clearTextLayoutCaches,
      get cache() { return _mwCache; },
      maxEntries: TEXT_MEASURE_CACHE_MAX_ENTRIES,
    };`,
    context,
    { filename: 'text_layout_cache_test_hook.js' },
  );
  return { context, measured };
}

test('text measurement cache evicts oldest entry without changing cache size', () => {
  const { context, measured } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const initialMeasures = measured.length;

  assert.equal(textLayout.measureTextW('k0'), 2);
  assert.equal(textLayout.measureTextW('k0'), 2);
  assert.equal(measured.length, initialMeasures + 1);

  for (let i = 1; i < textLayout.maxEntries; i++) {
    textLayout.measureTextW(`k${i}`);
  }
  assert.equal(textLayout.cache.size, textLayout.maxEntries);

  textLayout.measureTextW('overflow');

  assert.equal(textLayout.cache.size, textLayout.maxEntries);
  assert.equal(textLayout.cache.has('k0'), false);
  assert.equal(textLayout.cache.has('k1'), true);
  assert.equal(textLayout.cache.has('overflow'), true);
});

test('text measurement cache clears with other measurement caches', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;

  textLayout.measureTextW('cached');
  assert.equal(textLayout.cache.size, 1);

  textLayout.clearTextLayoutCaches({ measurements: true });

  assert.equal(textLayout.cache.size, 0);
});
