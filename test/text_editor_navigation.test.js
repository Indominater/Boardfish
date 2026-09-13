'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const { loadLiveTextEditResizeHarness } = require('../test-support/text_editor.js');

function loadNavigationHarness() {
  const context = loadLiveTextEditResizeHarness();
  const obj = context.obj;
  const viewport = fs.readFileSync(path.join(root, 'src/js/viewport.js'), 'utf8');
  vm.runInContext(viewport.slice(viewport.indexOf('function drawCaret('), viewport.indexOf('function drawEditingTextOverlay(')), context);
  context.press = (key, extra = {}) => {
    const event = { type: 'keydown', key, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    context.proxy.dispatchEvent(event);
    return event;
  };
  context.position = (index, lineStart = null) => {
    context.proxy.setSelectionRange(index, index);
    context.setTextEditCaretIndex(obj, index, lineStart, true);
    context.selectionChange();
  };
  context.drawnCaret = () => {
    let rect;
    const drawn = context.drawCaret({ fillRect(...args) { rect = args; } }, obj, context.getTextLayout(obj), context.proxy.selectionStart, 1);
    assert.equal(drawn, true, 'the caret must belong to a rendered row');
    return rect;
  };
  return context;
}

function startEditor(content, width = 800) {
  const context = loadNavigationHarness();
  context.obj.data.content = content;
  context.obj.w = width;
  context.enterEdit(context.obj.id, { history: false });
  return context;
}

test('option left keeps the caret on the next row after consumed wrap whitespace', () => {
  const context = startEditor('abc def', 62);
  const lines = context.getTextLayout(context.obj);
  assert.equal(lines[1].startIndex, 4);
  context.position(6);
  assert.equal(context.press('ArrowLeft', { altKey: true }).prevented, true);
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 4);
  assert.equal(context.drawnCaret()[1], lines[1].y);
  context.press('ArrowRight', { altKey: true });
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 7);
  assert.equal(context.drawnCaret()[1], lines[1].y);
});

test('shift option arrows preserve the anchor when reversing across wrapped words', () => {
  const context = startEditor('abc def', 62);
  context.position(6);
  for (const [key, start, end, direction] of [
    ['ArrowLeft', 4, 6, 'backward'],
    ['ArrowLeft', 0, 6, 'backward'],
    ['ArrowRight', 3, 6, 'backward'],
    ['ArrowRight', 6, 7, 'forward'],
  ]) {
    context.press(key, { altKey: true, shiftKey: true });
    context.selectionChange();
    assert.deepEqual([context.proxy.selectionStart, context.proxy.selectionEnd, context.proxy.selectionDirection],
      [start, end, direction]);
  }
});

test('option arrows navigate the latest logical value in a large stale proxy', () => {
  const context = startEditor('word '.repeat(5000) + 'alpha beta');
  const end = context.obj.data.content.length;
  context.proxy.value = 'stale';
  context.proxy._boardfishDomValueStale = true;
  context.proxy.selectionStart = end;
  context.proxy.selectionEnd = end;
  context.press('ArrowLeft', { altKey: true });
  context.selectionChange();
  assert.equal(context.proxy.value, context.obj.data.content);
  assert.equal(context.proxy.selectionStart, end - 4);
  context.press('ArrowRight', { altKey: true });
  assert.equal(context.proxy.selectionStart, end);
});
