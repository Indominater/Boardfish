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
    invalidateOffscreen() {},
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
