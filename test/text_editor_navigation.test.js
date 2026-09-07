'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function loadNavigationHarness() {
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 800,
    h: 160,
    z: 1,
    data: { content: 'example text' },
  };
  const makeProxy = (context) => ({
    id: '',
    style: {},
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: 'none',
    listeners: {},
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] ?? null; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    dispatchEvent(event) {
      this.listeners[event.type]?.(event);
      return true;
    },
    focus() { context.focusedProxy = true; },
    remove() { context.removedProxy = true; },
    setSelectionRange(start, end, direction = 'none') {
      const max = String(this.value ?? '').length;
      const normalizedStart = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, max));
      const normalizedEnd = Math.max(normalizedStart, Math.min(Math.trunc(Number(end)) || normalizedStart, max));
      this.selectionStart = normalizedStart;
      this.selectionEnd = normalizedEnd;
      this.selectionDirection = direction;
    },
    setRangeText(text, start, end, selectionMode = 'preserve') {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      if (selectionMode === 'start') {
        this.setSelectionRange(start, start, 'none');
      } else if (selectionMode === 'end') {
        const pos = start + text.length;
        this.setSelectionRange(pos, pos, 'none');
      }
    },
  });
  const context = {
    console,
    objects: [obj],
    obj,
    objectsMap: new Map([[obj.id, obj]]),
    editingId: null,
    _editEl: null,
    _caretBlinkInterval: null,
    _selChangeListener: null,
    _editHistoryTimer: null,
    _editHistoryLastContent: null,
    _editHistoryActionStartState: null,
    _textInputSelectionHistorySuppress: null,
    _caretVisible: false,
    dirty: [],
    histories: [],
    renders: [],
    flushes: 0,
    TextSelDebug: { _logSelection() {}, _logHit() {}, _logDraw() {} },
    document: {
      activeElement: null,
      body: { appendChild(node) { context.document.activeElement = node; } },
      createElement(tag) {
        if (tag === 'canvas') {
          return {
            getContext() {
              return {
                font: '',
                textBaseline: '',
                measureText(text) {
                  return {
                    width: String(text).length * 10,
                    actualBoundingBoxAscent: 12,
                    actualBoundingBoxDescent: 4,
                  };
                },
              };
            },
          };
        }
        const proxy = makeProxy(context);
        context.proxy = proxy;
        return proxy;
      },
      createEvent() {
        return { initEvent(type) { this.type = type; } };
      },
      addEventListener(type, fn) { if (type === 'selectionchange') context.selectionChange = fn; },
      removeEventListener() {},
    },
    window: {
      getSelection() { return { removeAllRanges() {} }; },
    },
    BoardfishEditorState: {
      removeObjectsById() {},
    },
    beginTextEditHistoryAction() {},
    shouldCommitTextEditInputImmediately() { return false; },
    recordTextEditInputHistory() {},
    flushEditHistoryCheckpoint() { context.flushes++; return false; },
    markDirty(obj) { context.dirty.push(obj.id); },
    pushHistory(reason, dirty) { if (dirty) context.dirty.push(...dirty); context.histories.push(reason); },
    pushEditHistoryIfChanged() { return false; },
    scheduleRender(board, overlay, reason) { context.renders.push({ board, overlay, reason }); },
    setInterval() { return 5; },
    clearInterval() {},
    clearTimeout() {},
  };
  context.BoardfishBoardTypes = require('../src/js/board_types.js');
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/js/text_layout.js'), 'utf8') +
      '\n' +
      fs.readFileSync(path.join(root, 'src/js/text_editor.js'), 'utf8') +
      '\nglobalThis.enterEdit = enterEdit;\n' +
      'globalThis.exitEdit = exitEdit;\n' +
      'globalThis.getTextLayout = getTextLayout;\n' +
      'globalThis.setTextEditCaretIndex = setTextEditCaretIndex;\n',
    context,
    { filename: 'live_text_edit_resize_harness.js' },
  );
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

test('vertical movement retains the target visual row at a shared wrap index', () => {
  const context = startEditor('abcdefghi', 62);
  const lines = context.getTextLayout(context.obj);
  assert.ok(lines.length >= 3);
  context.position(0);
  context.press('ArrowDown');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, lines[1].startIndex);
  assert.equal(context.drawnCaret()[1], lines[1].y);
  context.press('ArrowDown');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, lines[2].startIndex);
  assert.equal(context.drawnCaret()[1], lines[2].y);
  context.press('ArrowUp');
  context.selectionChange();
  assert.equal(context.drawnCaret()[1], lines[1].y);
});

test('native horizontal movement renders a shared wrap index on the approached row', () => {
  const context = startEditor('abcdefghi', 62);
  const lines = context.getTextLayout(context.obj);
  const boundary = lines[1].startIndex;
  for (const [key, from, expectedLine] of [
    ['ArrowLeft', boundary + 1, 1],
    ['ArrowRight', boundary - 1, 0],
  ]) {
    context.position(from);
    assert.equal(context.press(key).prevented, false);
    // Apply the browser's native caret change, then its selectionchange event.
    context.proxy.setSelectionRange(boundary, boundary);
    context.selectionChange();
    context.proxy.dispatchEvent({ type: 'keyup', key });
    assert.equal(context.drawnCaret()[1], lines[expectedLine].y);
  }
});

test('right arrow crosses consumed wrap whitespace onto the next visual row', () => {
  const context = startEditor('abc def', 62);
  const lines = context.getTextLayout(context.obj);
  assert.equal(lines[0].text, 'abc');
  assert.equal(lines[1].text, 'def');
  assert.equal(lines[0].endIndex, 3);
  assert.equal(lines[1].startIndex, 4);
  context.position(3);
  context.press('ArrowRight');
  context.proxy.setSelectionRange(4, 4);
  context.selectionChange();
  assert.equal(context.drawnCaret()[1], lines[1].y);
  context.press('ArrowDown');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 7);
});

test('native navigation sees the current value following a deferred large deletion', () => {
  const context = startEditor('filler '.repeat(3000) + 'XYZ');
  context.proxy.setSelectionRange(21000, 21003);
  context.press('Backspace');
  assert.equal(context.obj.data.content.length, 21000);
  assert.equal(context.proxy._boardfishDomValueStale, true);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown']) {
    context.proxy.value = context.obj.data.content + 'XYZ';
    context.proxy._boardfishDomValueStale = true;
    context.proxy.setSelectionRange(21000, 21000);
    assert.equal(context.press(key).prevented, false);
    assert.equal(context.proxy.value, context.obj.data.content);
    assert.equal(context.proxy._boardfishDomValueStale, false);
    assert.equal(context.proxy.selectionStart, 21000);
  }
});

test('command horizontal arrows use the visual row boundaries and preserve shift anchors', () => {
  const context = startEditor('alpha beta gamma delta epsilon', 152);
  const lines = context.getTextLayout(context.obj);
  assert.ok(lines.length >= 3);
  const firstEnd = lines[0].caretEndIndex;
  context.position(3);
  assert.equal(context.press('ArrowRight', { metaKey: true }).prevented, true);
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, firstEnd);
  assert.equal(context.drawnCaret()[1], lines[0].y);
  context.position(lines[1].startIndex + 1);
  context.press('ArrowLeft', { metaKey: true });
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, lines[1].startIndex);
  assert.equal(context.drawnCaret()[1], lines[1].y);
  context.position(3);
  context.press('ArrowRight', { metaKey: true, shiftKey: true });
  context.selectionChange();
  assert.deepEqual([context.proxy.selectionStart, context.proxy.selectionEnd], [3, firstEnd]);
  context.press('ArrowLeft', { metaKey: true, shiftKey: true });
  assert.deepEqual([context.proxy.selectionStart, context.proxy.selectionEnd], [0, 3]);
  assert.equal(context.proxy.selectionDirection, 'backward');
});

test('command vertical arrows navigate to document boundaries with shift extension', () => {
  const context = startEditor('aaa\nbbb\nccc\nddd');
  for (const [key, shiftKey, start, end] of [
    ['ArrowDown', false, 15, 15],
    ['ArrowUp', false, 0, 0],
    ['ArrowDown', true, 5, 15],
    ['ArrowUp', true, 0, 5],
  ]) {
    context.position(5);
    context.press(key, { metaKey: true, shiftKey });
    context.selectionChange();
    assert.deepEqual([context.proxy.selectionStart, context.proxy.selectionEnd], [start, end]);
  }
});

test('vertical arrows restore the desired column beyond a short intermediate line', () => {
  const context = startEditor('abcdefghij\nx\nabcdefghij');
  context.position(8);
  for (const [key, expected] of [
    ['ArrowDown', 12], ['ArrowDown', 21], ['ArrowUp', 12], ['ArrowUp', 8],
  ]) {
    context.press(key);
    context.selectionChange();
    assert.equal(context.proxy.selectionStart, expected);
  }
});

test('shift vertical arrows retain the desired column and the original selection anchor', () => {
  const context = startEditor('abcdefghij\nx\nabcdefghij');
  context.position(8);
  context.press('ArrowDown', { shiftKey: true });
  context.selectionChange();
  context.press('ArrowDown', { shiftKey: true });
  context.selectionChange();
  assert.deepEqual([context.proxy.selectionStart, context.proxy.selectionEnd], [8, 21]);
  context.press('ArrowUp', { shiftKey: true });
  context.selectionChange();
  context.press('ArrowUp', { shiftKey: true });
  context.selectionChange();
  assert.deepEqual([context.proxy.selectionStart, context.proxy.selectionEnd], [8, 8]);
});

test('mouse placement and horizontal movement reset the desired vertical column', () => {
  const context = startEditor('abcdefghij\nx\nabcdefghij');
  context.position(8);
  context.press('ArrowDown');
  context.selectionChange();
  context.position(11, 11);
  context.press('ArrowDown');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 13);
  context.position(8);
  context.press('ArrowDown');
  context.selectionChange();
  context.press('ArrowLeft');
  context.proxy.setSelectionRange(11, 11);
  context.selectionChange();
  context.press('ArrowDown');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 13);
});

test('clicking the current caret position resets the preferred vertical column', () => {
  const context = startEditor('abcdefghij\nx\nabcdefghij');
  context.position(8);
  context.press('ArrowDown');
  context.selectionChange();
  context.position(12, 11);
  context.press('ArrowDown');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 14);
});

test('typing after a short-line move starts a new preferred vertical column', () => {
  const context = startEditor('abcdefghij\nx\nabcdefghij');
  context.position(8);
  context.press('ArrowDown');
  context.selectionChange();
  context.proxy.dispatchEvent({ type: 'beforeinput', inputType: 'insertText', data: 'z' });
  context.proxy.value = 'abcdefghij\nxz\nabcdefghij';
  context.proxy.setSelectionRange(13, 13);
  context.proxy.dispatchEvent({ type: 'input', inputType: 'insertText', data: 'z' });
  context.selectionChange();
  context.press('ArrowDown');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 16);
});
