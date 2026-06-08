'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = (value) => JSON.parse(JSON.stringify(value));

function loadTextLayout({ measureWidth = (text) => String(text).length } = {}) {
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
                  width: measureWidth(String(text)),
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
      getTextMinWidthWordSegment,
      getTextMinWidth,
      getTextLayout,
      getTextRenderedContentWidth,
      fitTextObjectWidthToRenderedContent,
      applyTextLineAlignmentRange,
      clearTextLayoutCaches,
      drawTextLineRange,
      lineXAtOffset,
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

test('text measurement keeps ASCII arrow pairs out of font ligatures', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      if (text === 'a->b' || text === 'x<-y') return 1;
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const initialMeasures = measured.length;

  assert.equal(textLayout.measureTextW('a->b'), 4);
  assert.equal(textLayout.measureTextW('x<-y'), 4);

  assert.deepEqual(measured.slice(initialMeasures), ['a-', '>b', 'x<', '-y']);
});

test('text drawing splits ASCII arrow pairs before fillText', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'a->b c<-d' },
  };
  const [line] = textLayout.getTextLayout(obj);
  const calls = [];

  textLayout.drawTextLineRange({
    font: '',
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
  }, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['a-', '>b c<', '-d']);
});

test('text minimum width uses the widest rendered word, not character count', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => {
        if (ch === 'W') return sum + 12;
        if (ch === 'i') return sum + 2;
        if (ch === ' ') return sum + 4;
        return sum + 6;
      }, 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'iiiiiiii WWW' },
  };

  assert.equal(textLayout.getTextMinWidth(obj), 45);
});

test('text minimum width includes leading indentation before the first word', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => sum + (ch === ' ' ? 4 : 6), 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'Boardfish\n    Boardfish indentation example' },
  };

  assert.equal(textLayout.getTextMinWidth(obj), 79);
  assert.deepEqual(plain(textLayout.getTextMinWidthWordSegment(obj)), {
    text: '    Boardfish',
    word: 'Boardfish',
    width: 70,
    lineIndex: 1,
    startOffset: 10,
    endOffset: 23,
  });
});

test('text minimum width treats spaces between words as separators', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => sum + (ch === ' ' ? 4 : 6), 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 240,
    h: 40,
    data: { content: 'short      coordinate x\n        pixel y' },
  };

  assert.equal(textLayout.getTextMinWidth(obj), 71);
  assert.deepEqual(plain(textLayout.getTextMinWidthWordSegment(obj)), {
    text: '        pixel',
    word: 'pixel',
    width: 62,
    lineIndex: 1,
    startOffset: 24,
    endOffset: 37,
  });
});

test('soft wrap after a full-width word consumes separator spaces', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 'indominatoer'.length + 8,
    h: 40,
    data: { content: 'indominatoer hi' },
  };

  const lines = textLayout.getTextLayout(obj).map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
  }));

  assert.deepEqual(plain(lines), [
    { text: 'indominatoer', startIndex: 0, endIndex: 12, caretEndIndex: 13, nextStartIndex: 13 },
    { text: 'hi', startIndex: 13, endIndex: 15, caretEndIndex: 15, nextStartIndex: 15 },
  ]);
});

test('caret range stays on the current line for trailing overflow spaces', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 'indominater'.length + 8,
    h: 40,
    data: { content: 'indominater    \nhi' },
  };

  const lines = textLayout.getTextLayout(obj).map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
  }));

  assert.deepEqual(plain(lines), [
    { text: 'indominater', startIndex: 0, endIndex: 11, caretEndIndex: 15, nextStartIndex: 15 },
    { text: 'hi', startIndex: 16, endIndex: 18, caretEndIndex: 18, nextStartIndex: 18 },
  ]);
});

test('trailing overflow spaces keep the last fitting spaces on the caret line', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 'hi  '.length + 8,
    h: 40,
    data: { content: 'hi     \nnext' },
  };

  const lines = textLayout.getTextLayout(obj).map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
  }));

  assert.deepEqual(plain(lines), [
    { text: 'hi  ', startIndex: 0, endIndex: 4, caretEndIndex: 7, nextStartIndex: 7 },
    { text: 'next', startIndex: 8, endIndex: 12, caretEndIndex: 12, nextStartIndex: 12 },
  ]);
});

test('text object width can fit the rendered visible line width', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => sum + (ch === 'H' ? 10 : ch === 'i' ? 3 : 5), 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 80,
    data: { content: 'Hi' },
  };

  assert.equal(textLayout.getTextRenderedContentWidth(obj), 22);
  assert.equal(textLayout.fitTextObjectWidthToRenderedContent(obj), true);
  assert.equal(obj.w, 22);
  assert.equal(textLayout.fitTextObjectWidthToRenderedContent(obj), false);
});

test('line alignment offsets caret positions within the text box', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 20,
    h: 40,
    data: { content: 'abcd' },
  };

  let [line] = textLayout.getTextLayout(obj);
  assert.equal(textLayout.lineXAtOffset(line, obj, 0), 14);

  assert.equal(textLayout.applyTextLineAlignmentRange(obj, 0, 0, 'right'), true);
  [line] = textLayout.getTextLayout(obj);
  assert.equal(line.align, 'center');
  assert.equal(textLayout.lineXAtOffset(line, obj, 0), 18);

  assert.equal(textLayout.applyTextLineAlignmentRange(obj, 0, 0, 'right'), true);
  [line] = textLayout.getTextLayout(obj);
  assert.equal(line.align, 'right');
  assert.equal(textLayout.lineXAtOffset(line, obj, 0), 22);
});

test('script-heavy text layout reuses paragraph prefix widths while wrapping', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => sum + (ch === ' ' ? 4 : 8), 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const proofLine = [
    'By FTA, let n_{k}=p_{1}^{a_{1}} p_{2}^{a_{2}}',
    'and q_{i}^{b_{i}} divides n^{m};',
    'therefore x_{i}^{2}+y_{i}^{2}=z_{i}^{2}.',
  ].join(' ');
  const content = Array.from({ length: 18 }, (_, i) => `${i + 1}. ${proofLine} Case ${i + 1}`).join('\n');
  const obj = {
    id: 'proof',
    type: 'text',
    x: 0,
    y: 0,
    w: 360,
    h: 40,
    data: { content },
  };
  const before = measured.length;

  const layout = textLayout.getTextLayout(obj);
  const coldMeasureCount = measured.length - before;

  assert.ok((obj.data.scriptRanges || []).length >= 100);
  assert.ok(layout.length > 18);
  assert.ok(
    coldMeasureCount < content.length * 4,
    `expected bounded measurement work, got ${coldMeasureCount} calls for ${content.length} chars`,
  );

  const warmBefore = measured.length;
  textLayout.getTextLayout(obj);

  assert.equal(measured.length, warmBefore);
});
