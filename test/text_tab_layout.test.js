'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTextLayout() {
  const context = {
    console,
    navigator: { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' },
    document: {
      fonts: {
        status: 'loaded',
        check: () => true,
      },
      createElement() {
        const canvasContext = {
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
        return { getContext: () => canvasContext };
      },
    },
    objects: [],
    editingId: null,
    TextSelDebug: { _logHit() {} },
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
      getTextLayout,
      layoutHitTestCaret,
      lineXAtOffset,
      measureTextW,
      get textPad() { return TEXT_PAD; },
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

test('text caret hit at wrapped line start records the visual line', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 3 + textLayout.textPad * 2,
    h: 48,
    data: { content: 'abcdef' },
  };
  const layout = textLayout.getTextLayout(obj);
  const [firstLine, secondLine] = layout;

  assert.equal(firstLine.text, 'abc');
  assert.equal(secondLine.text, 'def');

  const secondLineHit = textLayout.layoutHitTestCaret(
    layout,
    textLayout.lineXAtOffset(secondLine, obj, 0),
    secondLine.y,
    obj,
  );
  const firstLineEndHit = textLayout.layoutHitTestCaret(
    layout,
    textLayout.lineXAtOffset(firstLine, obj, firstLine.text.length),
    firstLine.y,
    obj,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(secondLineHit)), { index: 3, lineStartIndex: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(firstLineEndHit)), { index: 3, lineStartIndex: 0 });
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
    { text: 'a', x: obj.x + textLayout.textPad, y: 20 },
    { text: 'bc', x: obj.x + textLayout.textPad + 8, y: 20 },
  ]);
});
