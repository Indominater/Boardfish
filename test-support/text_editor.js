'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function loadLiveTextEditResizeHarness() {
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
    BoardfishWebLimits: { canReplaceText() { return true; } },
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
    animations: [],
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
    BoardfishMotion: {
      applyCopyFeedback(payload) { context.animations.push(payload); },
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
    invalidateOffscreen() {},
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
  return context;
}

module.exports = { loadLiveTextEditResizeHarness };
