'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTextLayout() {
  const context = {
    console,
    document: {
      createElement() {
        return {
          getContext() {
            return {
              font: '',
              textBaseline: '',
              measureText(text) {
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
      drawTextLineRange,
      getPrefixWidths,
      lineXAtOffset,
      measureTextW,
    };`,
    context,
    { filename: 'text_tab_layout_test_hook.js' },
  );
  return context.__testTextLayout;
}

test('text tab measurement advances to the next eight-space tab stop', () => {
  const textLayout = loadTextLayout();

  assert.deepEqual(Array.from(textLayout.getPrefixWidths('\tX')), [0, 8, 9]);
  assert.deepEqual(Array.from(textLayout.getPrefixWidths('a\tX')), [0, 1, 8, 9]);
  assert.deepEqual(Array.from(textLayout.getPrefixWidths('abcdefgh\tX')), [0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 17]);
  assert.equal(textLayout.measureTextW('a\tX'), 9);
});

test('text tab drawing leaves tab glyphs invisible and positions later chunks at tab stops', () => {
  const textLayout = loadTextLayout();
  const calls = [];
  const context = {
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
  };
  const obj = { x: 10, y: 0 };
  const line = {
    text: 'a\tbc',
    textY: 20,
    prefixWidths: textLayout.getPrefixWidths('a\tbc'),
  };

  textLayout.drawTextLineRange(context, line, obj);

  assert.deepEqual(calls, [
    { text: 'a', x: 14, y: 20 },
    { text: 'bc', x: 22, y: 20 },
  ]);
});
