'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTextLayout({ scaleMeasureWithFont = false } = {}) {
  const context = {
    console,
    document: {
      createElement() {
        const canvasContext = {
          font: '',
          textBaseline: '',
          measureText(text) {
            const fontSize = Number.parseFloat(String(this.font).match(/([0-9.]+)px/)?.[1] || '16');
            const scale = scaleMeasureWithFont ? fontSize / 16 : 1;
            return {
              width: String(text).length * scale,
              actualBoundingBoxAscent: 12,
              actualBoundingBoxDescent: 4,
            };
          },
        };
        return {
          getContext() {
            return canvasContext;
          },
        };
      },
    },
    objects: [],
    editingId: null,
    TextSelDebug: {
      _logHit() {},
    },
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
      layoutHitTest,
      layoutHitTestCaret,
      lineXAtOffset,
      measureTextW,
      normalizeTextScriptRangesForContent,
      setEditingId(id) { editingId = id; },
      textContentWithCanonicalScriptBraces,
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

test('text script ranges hide the marker and draw following text smaller', () => {
  const textLayout = loadTextLayout();
  const calls = [];
  const context = {
    font: "400 16px 'Geist Sans', system-ui",
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font });
    },
  };
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'a^bc',
      scriptRanges: [{ start: 2, end: 4, kind: 'sup' }],
    },
  };
  const [line] = textLayout.getTextLayout(obj);

  textLayout.drawTextLineRange(context, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['a', 'bc']);
  assert.equal(calls[0].x, 14);
  assert.equal(calls[1].x, 15);
  assert.ok(calls[1].y < calls[0].y);
  assert.match(calls[1].font, /11\.313708498984761px/);
  assert.equal(textLayout.lineXAtOffset(line, obj, 1), textLayout.lineXAtOffset(line, obj, 2));
});

test('text script hit testing skips hidden script marker caret stops', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'a^b',
      scriptRanges: [{ start: 2, end: 3, kind: 'sup' }],
    },
  };
  const [line] = textLayout.getTextLayout(obj);
  const markerX = textLayout.lineXAtOffset(line, obj, 1);

  assert.equal(textLayout.layoutHitTest([line], markerX - 0.01, line.y, obj), 2);
});

test('text caret hit at wrapped line start records the visual line', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 11,
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

  assert.deepEqual(JSON.parse(JSON.stringify(secondLineHit)), { index: 3, affinity: '', lineStartIndex: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(firstLineEndHit)), { index: 3, affinity: '', lineStartIndex: 0 });
});

test('braced text script hit testing keeps the marker-side caret boundary', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'e^{x^{2}}',
    },
  };
  const [line] = textLayout.getTextLayout(obj);
  const innerMarkerX = textLayout.lineXAtOffset(line, obj, 4);

  assert.equal(textLayout.layoutHitTest([line], innerMarkerX - 0.01, line.y + 8, obj), 4);
});

test('braced text script hit testing picks the closest vertical caret layer', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'e^{x^{2}}',
    },
  };
  const [line] = textLayout.getTextLayout(obj);
  const endX = textLayout.lineXAtOffset(line, obj, line.text.length);
  const innerHit = textLayout.layoutHitTestCaret([line], endX, line.y + 4, obj);
  const parentHit = textLayout.layoutHitTestCaret([line], endX, line.y + 8, obj);
  const baseHit = textLayout.layoutHitTestCaret([line], endX, line.y + 14, obj);

  assert.deepEqual(JSON.parse(JSON.stringify(innerHit)), { index: 7, affinity: '', lineStartIndex: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(parentHit)), { index: 8, affinity: 'after', lineStartIndex: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(baseHit)), { index: 9, affinity: 'after', lineStartIndex: 0 });

  const nestedStartX = textLayout.lineXAtOffset(line, obj, 4);
  const nestedParentHit = textLayout.layoutHitTestCaret([line], nestedStartX, line.y + 8, obj);
  const nestedInnerHit = textLayout.layoutHitTestCaret([line], nestedStartX, line.y + 4, obj);

  assert.deepEqual(JSON.parse(JSON.stringify(nestedParentHit)), { index: 4, affinity: '', lineStartIndex: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(nestedInnerHit)), { index: 6, affinity: '', lineStartIndex: 0 });
});

test('existing scripts stay rich after a pending base marker is inserted before them', () => {
  const textLayout = loadTextLayout();
  const calls = [];
  const context = {
    font: "400 16px 'Geist Sans', system-ui",
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font });
    },
  };
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'e_^2',
      scriptRanges: [{ start: 3, end: 4, kind: 'sup' }],
    },
  };
  const [line] = textLayout.getTextLayout(obj);

  textLayout.drawTextLineRange(context, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['e_', '2']);
  assert.ok(calls[1].y < calls[0].y);
});

test('braced text script ranges hide marker and braces while copying canonical text', () => {
  const textLayout = loadTextLayout();
  const calls = [];
  const context = {
    font: "400 16px 'Geist Sans', system-ui",
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font });
    },
  };
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'a_{i}+b^{2}',
    },
  };
  const [line] = textLayout.getTextLayout(obj);

  textLayout.drawTextLineRange(context, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['a', 'i', '+b', '2']);
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 5, kind: 'sub' },
    { start: 8, end: 11, kind: 'sup' },
  ]);
  assert.equal(textLayout.lineXAtOffset(line, obj, 1), textLayout.lineXAtOffset(line, obj, 3));
  assert.equal(textLayout.lineXAtOffset(line, obj, 7), textLayout.lineXAtOffset(line, obj, 9));
  assert.equal(
    textLayout.textContentWithCanonicalScriptBraces('a_i+b^2', [
      { start: 2, end: 3, kind: 'sub' },
      { start: 6, end: 7, kind: 'sup' },
    ]),
    'a_{i}+b^{2}',
  );
});

test('braced compound script stays rich while the caret is inside the compound', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'e^{x^{2}+1}',
    },
  };

  const drawTextsAtCaret = (caret, { editing = true } = {}) => {
    const calls = [];
    const context = {
      font: "400 16px 'Geist Sans', system-ui",
      fillText(text) { calls.push(text); },
    };
    obj._textEditCaretIndex = caret;
    textLayout.setEditingId(editing ? 'text-1' : null);
    const [line] = textLayout.getTextLayout(obj);
    textLayout.drawTextLineRange(context, line, obj);
    return calls;
  };

  assert.deepEqual(drawTextsAtCaret(0), ['e', 'x', '2', '+1']);
  assert.deepEqual(drawTextsAtCaret(6), ['e', 'x', '2', '+1']);
  assert.deepEqual(drawTextsAtCaret(obj.data.content.length), ['e', 'x', '2', '+1']);

  assert.deepEqual(drawTextsAtCaret(6, { editing: false }), ['e', 'x', '2', '+1']);
});

test('rich script layout stays stable while editing inside it', () => {
  const textLayout = loadTextLayout();
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 36,
    h: 40,
    data: {
      content: 'By FTA, let a = p_1^u_1 * p',
      scriptRanges: [
        { start: 18, end: 19, kind: 'sub' },
        { start: 20, end: 23, kind: 'sup' },
        { start: 22, end: 23, kind: 'sub' },
      ],
    },
  };

  textLayout.setEditingId(null);
  assert.deepEqual(JSON.parse(JSON.stringify(textLayout.getTextLayout(obj).map((line) => line.text))), [
    'By FTA, let a = p_1^u_1 * p',
  ]);

  obj._textEditCaretIndex = obj.data.content.indexOf('u');
  textLayout.setEditingId(obj.id);
  assert.deepEqual(JSON.parse(JSON.stringify(textLayout.getTextLayout(obj).map((line) => line.text))), [
    'By FTA, let a = p_1^u_1 * p',
  ]);
});

test('text script ranges can nest with cumulative scale and offsets', () => {
  const textLayout = loadTextLayout();
  const calls = [];
  const context = {
    font: "400 16px 'Geist Sans', system-ui",
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font });
    },
  };
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'a^b_c',
      scriptRanges: [
        { start: 2, end: 5, kind: 'sup' },
        { start: 4, end: 5, kind: 'sub' },
      ],
    },
  };
  const [line] = textLayout.getTextLayout(obj);

  textLayout.drawTextLineRange(context, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['a', 'b', 'c']);
  assert.match(calls[1].font, /11\.313708498984761px/);
  assert.match(calls[2].font, /8\.000000000000002px/);
  assert.ok(calls[1].y < calls[0].y);
  assert.ok(calls[2].y > calls[1].y);
  assert.equal(textLayout.lineXAtOffset(line, obj, 1), textLayout.lineXAtOffset(line, obj, 2));
  assert.equal(textLayout.lineXAtOffset(line, obj, 3), textLayout.lineXAtOffset(line, obj, 4));
  assert.equal(textLayout.lineXAtOffset(line, obj, 5), 17);
});

test('text script nesting keeps third layer at second layer size', () => {
  const textLayout = loadTextLayout();
  const calls = [];
  const context = {
    font: "400 16px 'Geist Sans', system-ui",
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font });
    },
  };
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'a^b_c^d',
      scriptRanges: [
        { start: 2, end: 7, kind: 'sup' },
        { start: 4, end: 7, kind: 'sub' },
        { start: 6, end: 7, kind: 'sup' },
      ],
    },
  };
  const [line] = textLayout.getTextLayout(obj);

  textLayout.drawTextLineRange(context, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['a', 'b', 'c', 'd']);
  assert.match(calls[1].font, /11\.313708498984761px/);
  assert.match(calls[2].font, /8\.000000000000002px/);
  assert.match(calls[3].font, /8\.000000000000002px/);
  assert.notEqual(calls[2].y, calls[3].y);
});

test('text script markers require a following non-space character', () => {
  const textLayout = loadTextLayout();
  const calls = [];
  const context = {
    font: "400 16px 'Geist Sans', system-ui",
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font });
    },
  };
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'a^ b',
    },
  };
  const [line] = textLayout.getTextLayout(obj);

  textLayout.drawTextLineRange(context, line, obj);

  assert.deepEqual(Array.from(textLayout.normalizeTextScriptRangesForContent('a^', [{ start: 2, end: 2, kind: 'sup' }])), []);
  assert.deepEqual(Array.from(textLayout.normalizeTextScriptRangesForContent('a^ b', [{ start: 2, end: 4, kind: 'sup' }])), []);
  assert.deepEqual(calls.map((call) => call.text), ['a^ b']);
  assert.equal(calls[0].font, "400 16px 'Geist Sans', system-ui");
});

test('space after a script exit uses normal text spacing', () => {
  const textLayout = loadTextLayout({ scaleMeasureWithFont: true });
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 200,
    h: 40,
    data: {
      content: 'a^b c d',
      scriptRanges: [{ start: 2, end: 3, kind: 'sup' }],
    },
  };
  const [line] = textLayout.getTextLayout(obj);

  const scriptSpaceWidth = textLayout.lineXAtOffset(line, obj, 4) - textLayout.lineXAtOffset(line, obj, 3);
  const regularSpaceWidth = textLayout.lineXAtOffset(line, obj, 6) - textLayout.lineXAtOffset(line, obj, 5);

  assert.ok(Math.abs(scriptSpaceWidth - regularSpaceWidth) < 1e-9);
  assert.deepEqual(
    JSON.parse(JSON.stringify(textLayout.normalizeTextScriptRangesForContent('a^b c', [{ start: 2, end: 5, kind: 'sup' }]))),
    [{ start: 2, end: 3, kind: 'sup' }],
  );
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
