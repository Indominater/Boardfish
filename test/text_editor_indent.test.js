'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const TEST_LINE_H = 24;
const TEST_TEXT_PAD = 16;
const TEST_NEW_TEXT_EDIT_MIN_LINES = 1;
const SINGLE_LINE_TEXT_BOX_HEIGHT = TEST_LINE_H + TEST_TEXT_PAD * 2;
const DEFAULT_TEXT_BOX_HEIGHT = TEST_NEW_TEXT_EDIT_MIN_LINES * TEST_LINE_H + TEST_TEXT_PAD * 2;
const DEFAULT_TEXT_BOX_WIDTH = DEFAULT_TEXT_BOX_HEIGHT * 6;

function loadTextEditorHelpers() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/js/text_editor.js'), 'utf8') +
      '\nglobalThis.applyTextEditLineIndent = applyTextEditLineIndent;\n' +
      'globalThis.applyTextEditLineBreakIndent = applyTextEditLineBreakIndent;\n',
    context,
    { filename: 'text_editor.js' },
  );
  return context;
}

function loadTextScriptEditorHelpers() {
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
    dirty: [],
    histories: [],
    renders: [],
    animations: [],
    _caretVisible: false,
    BoardfishMotion: {
      applyCopyFeedback(payload) { context.animations.push(payload); },
    },
    shouldCommitTextEditInputImmediately() { return false; },
    flushEditHistoryCheckpoint() { context.flushedHistory = true; return false; },
    invalidateOffscreen() {},
    markDirty(obj) { context.dirty.push(obj.id); },
    pushHistory(reason) { context.histories.push(reason); },
    scheduleRender(board, overlay, reason) { context.renders.push({ board, overlay, reason }); },
    syncAllTextAutoHeights() {},
    Event,
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/js/text_layout.js'), 'utf8') +
      '\n' +
      fs.readFileSync(path.join(root, 'src/js/text_editor.js'), 'utf8') +
      '\nglobalThis.exitTextScriptForLineBreak = exitTextScriptForLineBreak;\n' +
      'globalThis.createTextSelectionClipboardPayload = createTextSelectionClipboardPayload;\n' +
      'globalThis.textSelectionPayloadFromBoardfishClipboardValue = textSelectionPayloadFromBoardfishClipboardValue;\n' +
      'globalThis.syncFreshTextEditWidth = syncFreshTextEditWidth;\n' +
      'globalThis.textScriptCaretRangesAfterInput = textScriptCaretRangesAfterInput;\n' +
      'globalThis.setTextScriptCaretAffinityForRanges = setTextScriptCaretAffinityForRanges;\n' +
      'globalThis.textScriptLinearToDeterministicBraces = textScriptLinearToDeterministicBraces;\n' +
      'globalThis.textEditInputReplacement = textEditInputReplacement;\n' +
      'globalThis.normalizeTextEditVisibleCaretIndex = normalizeTextEditVisibleCaretIndex;\n' +
      'globalThis.moveTextEditVisibleCaret = moveTextEditVisibleCaret;\n' +
      'globalThis.moveTextEditCaretScriptLayer = moveTextEditCaretScriptLayer;\n' +
      'globalThis.textEditVisibleSelectionDeleteRange = textEditVisibleSelectionDeleteRange;\n' +
      'globalThis.textEditVisibleDeleteRange = textEditVisibleDeleteRange;\n' +
      'globalThis.textEditBlankLineDeleteRange = textEditBlankLineDeleteRange;\n' +
      'globalThis.textNewlineCount = textNewlineCount;\n' +
      'globalThis.textLogicalLineRangeForSelection = textLogicalLineRangeForSelection;\n' +
      'globalThis.textEditScriptMarkerInsertionIndexAt = textEditScriptMarkerInsertionIndexAt;\n' +
      'globalThis.transformTextScriptRangesForInput = transformTextScriptRangesForInput;\n' +
      'globalThis.updateTextLineAlignForInput = updateTextLineAlignForInput;\n' +
      'globalThis.replaceTextEditProxyRange = replaceTextEditProxyRange;\n' +
      'globalThis.replaceTextEditSelectionWithPayload = replaceTextEditSelectionWithPayload;\n' +
      'globalThis.tryNativeBoardfishTextSelectionPaste = tryNativeBoardfishTextSelectionPaste;\n',
    context,
    { filename: 'text_script_editor_helpers.js' },
  );
  return context;
}

function loadTextClipboardFreshnessHarness({ maybeStale = false } = {}) {
  const source = fs.readFileSync(path.join(root, 'src/js/text_editor.js'), 'utf8');
  const start = source.indexOf('const boardfishTextClipboardStillCurrent');
  const end = source.indexOf('const readBoardfishTextClipboardPayloadForPaste', start);
  assert.ok(start >= 0 && end > start, 'Boardfish text clipboard freshness helper is missing');

  const calls = {
    browserTokenReads: 0,
    currentOptions: null,
  };
  const context = {
    Promise,
    calls,
    jsClipboard: { type: 'text-selection', text: 'copied text', scriptRanges: [] },
    _jsClipboardWebMaybeStale: maybeStale,
    BoardfishClipboardIO: {
      readBoardfishClipboardTokenFromBrowser() {
        calls.browserTokenReads++;
        return Promise.resolve({ checked: true, token: 'bf-token' });
      },
    },
    jsClipboardStillCurrent(_dbg, options) {
      calls.currentOptions = options;
      return true;
    },
    textEditorDebugNow() {
      return 0;
    },
    textEditorClipStep() {},
  };

  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\n` +
      'this.boardfishTextClipboardStillCurrent = boardfishTextClipboardStillCurrent;\n',
    context,
  );
  return context;
}

test('fresh in-app text clipboard skips browser token authorization', async () => {
  const context = loadTextClipboardFreshnessHarness({ maybeStale: false });

  assert.equal(await context.boardfishTextClipboardStillCurrent(), true);
  assert.equal(context.calls.browserTokenReads, 0);
  assert.equal(context.calls.currentOptions.webClipboardTokenChecked, false);
  assert.equal(context.calls.currentOptions.webClipboardToken, '');
});

test('newline-free input preserves the existing line-alignment array', () => {
  const context = loadTextScriptEditorHelpers();
  const lineAlign = ['center', 'right'];
  const obj = { data: { lineAlign } };

  context.updateTextLineAlignForInput(obj, 'one\ntwo', 1, 2, 'X');

  assert.equal(obj.data.lineAlign, lineAlign);
});

test('newline insertion inherits alignment without expanding trailing left entries', () => {
  const context = loadTextScriptEditorHelpers();
  const obj = { data: { lineAlign: ['center'] } };

  context.updateTextLineAlignForInput(obj, 'one\ntwo', 3, 3, '\n');

  assert.deepEqual([...obj.data.lineAlign], ['center', 'center']);
  const longText = `${'x'.repeat(80)}\nsecond\nthird`;
  assert.equal(context.textNewlineCount(longText, 0, longText.length - 1), 2);
  assert.deepEqual({ ...context.textLogicalLineRangeForSelection(longText, { start: 81, end: longText.length }) }, { startLine: 1, endLine: 2 });
});

function loadExitEditHarness() {
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: DEFAULT_TEXT_BOX_WIDTH,
    h: DEFAULT_TEXT_BOX_HEIGHT,
    z: 1,
    data: { content: 'Hi' },
    _editMinLines: 5,
    _editStartContent: '',
  };
  const context = {
    console,
    objects: [obj],
    obj,
    objectsMap: new Map([[obj.id, obj]]),
    editingId: obj.id,
    _editEl: { value: '', remove() { context.removedProxy = true; } },
    _caretBlinkInterval: 7,
    _selChangeListener: null,
    _editHistoryTimer: null,
    _editHistoryLastContent: 'Hi',
    _editHistoryActionStartState: null,
    _textInputSelectionHistorySuppress: null,
    dirty: [],
    histories: [],
    editHistoryPushes: [],
    animations: [],
    renders: [],
    clearedIntervals: [],
    clearedTimeouts: [],
    document: {
      createElement() {
        return {
          getContext() {
            return {
              font: '',
              textBaseline: '',
              measureText(text) {
                return {
                  width: [...String(text)].reduce((sum, ch) => sum + (ch === 'H' ? 10 : ch === 'i' ? 3 : 5), 0),
                  actualBoundingBoxAscent: 12,
                  actualBoundingBoxDescent: 4,
                };
              },
            };
          },
        };
      },
      removeEventListener() {},
    },
    window: {
      getSelection() {
        return { removeAllRanges() { context.removedRanges = true; } };
      },
    },
    BoardfishMotion: {
      applyCopyFeedback(payload) { context.animations.push(payload); },
    },
    BoardfishEditorState: {
      removeObjectsById() {},
    },
    clearInterval(id) { context.clearedIntervals.push(id); },
    clearTimeout(id) { context.clearedTimeouts.push(id); },
    markDirty(obj) { context.dirty.push(obj.id); },
    pushEditHistoryIfChanged(id) { context.editHistoryPushes.push(id); return false; },
    pushHistory(reason) { context.histories.push(reason); },
    scheduleRender(board, overlay) { context.renders.push({ board, overlay }); },
    invalidateOffscreen() { context.invalidated = true; },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/js/text_layout.js'), 'utf8') +
      '\n' +
      fs.readFileSync(path.join(root, 'src/js/text_editor.js'), 'utf8') +
      '\nglobalThis.exitEdit = exitEdit;\n',
    context,
    { filename: 'text_editor_exit_harness.js' },
  );
  context.obj = obj;
  return context;
}

function loadLiveTextEditResizeHarness() {
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 800,
    h: 160,
    z: 1,
    data: {
      content: 'e^x^2+1',
      scriptRanges: [
        { start: 2, end: 7, kind: 'sup' },
        { start: 4, end: 5, kind: 'sup' },
      ],
    },
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
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/js/text_layout.js'), 'utf8') +
      '\n' +
      fs.readFileSync(path.join(root, 'src/js/text_editor.js'), 'utf8') +
      '\nglobalThis.enterEdit = enterEdit;\n' +
      'globalThis.exitEdit = exitEdit;\n' +
      'globalThis.getTextLayout = getTextLayout;\n',
    context,
    { filename: 'live_text_edit_resize_harness.js' },
  );
  return context;
}

function makeBeforeInputEvent(inputType, data = '') {
  return {
    type: 'beforeinput',
    inputType,
    data,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

test('entering edit preserves an already canonical line-alignment cache key', () => {
  const context = loadLiveTextEditResizeHarness();
  context.obj.data = { content: 'a\nb', lineAlign: ['center'] };
  const lineAlign = context.obj.data.lineAlign;
  const layout = context.getTextLayout(context.obj);

  context.enterEdit(context.obj.id, { history: false });

  assert.equal(context.obj.data.lineAlign, lineAlign);
  assert.equal(context.getTextLayout(context.obj), layout);
});

function makeKeyEvent(key, overrides = {}) {
  return {
    type: 'keydown',
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
}

function typeNativeText(proxy, text) {
  const before = makeBeforeInputEvent('insertText', text);
  proxy.dispatchEvent(before);
  if (before.prevented) return before;
  const start = proxy.selectionStart;
  const end = proxy.selectionEnd;
  proxy.setRangeText(text, start, end, 'end');
  proxy.dispatchEvent({ type: 'input', inputType: 'insertText', data: text });
  return before;
}

test('cmd+x copies highlighted text without copy feedback before deleting it', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const copiedTexts = [];
  const cutOperations = [];
  obj.data = { content: 'alpha beta gamma' };
  context.BoardfishClipboardIO = {
    copyTextToClipboard(text) {
      copiedTexts.push(text);
      cutOperations.push(['copy', text]);
      return Promise.resolve({});
    },
  };
  context.BoardfishMotion.cancelTextSelectionMotion = (id) => {
    cutOperations.push(['cancel', id]);
  };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(6, 10, 'forward');

  const copy = makeKeyEvent('c', { metaKey: true });
  context.proxy.dispatchEvent(copy);
  assert.equal(copy.prevented, true);
  assert.deepEqual(copiedTexts, ['beta']);
  assert.equal(context.animations.length, 1);
  assert.equal(context.animations[0].textSelection.id, obj.id);

  context.animations.length = 0;
  cutOperations.length = 0;
  const cut = makeKeyEvent('x', { metaKey: true });
  context.proxy.dispatchEvent(cut);

  assert.equal(cut.prevented, true);
  assert.deepEqual(copiedTexts, ['beta', 'beta']);
  assert.deepEqual(context.animations, []);
  assert.deepEqual(cutOperations, [['cancel', obj.id], ['copy', 'beta']]);
  assert.equal(context.proxy.value, 'alpha  gamma');
  assert.equal(context.proxy.selectionStart, 6);
  assert.equal(context.proxy.selectionEnd, 6);
  assert.equal(obj.data.content, 'alpha  gamma');
});

test('typing a script marker auto-opens braces and closing brace completes the range', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'c' };

  context.enterEdit(obj.id, { history: false });
  assert.equal(context.proxy.value, 'c');

  const markerEvent = typeNativeText(context.proxy, '_');
  assert.equal(markerEvent.prevented, true);
  assert.equal(context.proxy.value, 'c_{');
  assert.equal(context.proxy.selectionStart, 3);
  assert.equal(obj.data.content, 'c_{');
  assert.equal(obj.data.scriptRanges, undefined);

  const contentEvent = typeNativeText(context.proxy, 'i');
  assert.equal(contentEvent.prevented, false);
  assert.equal(context.proxy.value, 'c_{i');
  assert.equal(obj.data.scriptRanges, undefined);

  const closeEvent = typeNativeText(context.proxy, '}');
  assert.equal(closeEvent.prevented, false);
  assert.equal(context.proxy.value, 'c_{i}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 5, kind: 'sub' },
  ]);
  assert.equal(obj._textScriptCaretIndex, 5);
  assert.equal(obj._textScriptCaretAffinity, 'after');

  const afterCloseEvent = typeNativeText(context.proxy, 'f');
  assert.equal(afterCloseEvent.prevented, false);
  assert.equal(context.proxy.value, 'c_{i}f');
  assert.equal(obj.data.content, 'c_{i}f');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 5, kind: 'sub' },
  ]);
  const renderCount = context.renders.length;
  context.selectionChange();
  assert.equal(context.renders.length, renderCount);
  assert.equal(context.flushes, 0);
  assert.equal(context._caretVisible, true);
  context._textInputSelectionHistorySuppress = { start: 2, end: 2 };
  context.proxy.setSelectionRange(2, 2, 'none');
  context.selectionChange();
  assert.equal(context.proxy.selectionStart, 3);
  assert.equal(context.flushes, 1);
});

test('deleting an auto-opened script brace leaves an unrendered marker', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'c' };

  context.enterEdit(obj.id, { history: false });
  typeNativeText(context.proxy, '_');

  const key = makeKeyEvent('Backspace');
  context.proxy.dispatchEvent(key);
  assert.equal(key.prevented, true);
  assert.equal(context.proxy.value, 'c_');
  assert.equal(obj.data.content, 'c_');
  assert.equal(obj.data.scriptRanges, undefined);
});

test('left arrow from a nested braced script end enters the parent layer first', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  const key = makeKeyEvent('ArrowLeft');
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(context.proxy.selectionStart, 8);
  assert.equal(context.proxy.selectionEnd, 8);
  assert.equal(obj._textScriptCaretIndex, 8);
  assert.equal(obj._textScriptCaretAffinity, 'after');
});

test('left arrow skips the hidden marker-brace gap before a nested braced script', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(6, 6, 'none');
  const key = makeKeyEvent('ArrowLeft');
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(context.proxy.selectionStart, 4);
  assert.equal(context.proxy.selectionEnd, 4);
  assert.equal(obj._textEditCaretIndex, 4);
  assert.equal(obj._textScriptCaretAffinity, undefined);
});

test('right arrow from a nested braced script end exits to the parent layer', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(7, 7, 'none');
  const key = makeKeyEvent('ArrowRight');
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(context.proxy.selectionStart, 8);
  assert.equal(context.proxy.selectionEnd, 8);
  assert.equal(obj._textScriptCaretIndex, 8);
  assert.equal(obj._textScriptCaretAffinity, 'after');

  const event = typeNativeText(context.proxy, 'f');
  assert.equal(event.prevented, false);
  assert.equal(context.proxy.value, 'e^{x^{2}f}');
  assert.equal(obj.data.content, 'e^{x^{2}f}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 10, kind: 'sup' },
    { start: 5, end: 8, kind: 'sup' },
  ]);
});

test('cmd+right while editing aligns the current caret line', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'one\ntwo\nthree' };

  context.enterEdit(obj.id, { history: false });
  context.dirty.length = 0;
  context.histories.length = 0;
  context.renders.length = 0;
  context.animations.length = 0;
  context.proxy.setSelectionRange(5, 5, 'none');
  const key = makeKeyEvent('ArrowRight', { metaKey: true });
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.deepEqual([...obj.data.lineAlign], ['left', 'center']);
  assert.equal(context.proxy.selectionStart, 5);
  assert.equal(context.proxy.selectionEnd, 5);
  assert.deepEqual(context.dirty, [obj.id]);
  assert.deepEqual(context.histories, ['text-align']);
  assert.deepEqual(context.renders, [{ board: true, overlay: true, reason: 'text-align' }]);
  assert.deepEqual(context.animations, []);
});

test('cmd+left while editing aligns the current caret line leftward', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'one\ntwo\nthree', lineAlign: ['left', 'right', 'right'] };

  context.enterEdit(obj.id, { history: false });
  context.dirty.length = 0;
  context.histories.length = 0;
  context.renders.length = 0;
  context.animations.length = 0;
  context.proxy.setSelectionRange(5, 5, 'none');
  const key = makeKeyEvent('ArrowLeft', { metaKey: true });
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.deepEqual([...obj.data.lineAlign], ['left', 'center', 'right']);
  assert.equal(context.proxy.selectionStart, 5);
  assert.equal(context.proxy.selectionEnd, 5);
  assert.deepEqual(context.dirty, [obj.id]);
  assert.deepEqual(context.histories, ['text-align']);
  assert.deepEqual(context.renders, [{ board: true, overlay: true, reason: 'text-align' }]);
  assert.deepEqual(context.animations, []);
});

test('cmd+right while editing highlighted text aligns the highlighted lines', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'one\ntwo\nthree' };

  context.enterEdit(obj.id, { history: false });
  context.dirty.length = 0;
  context.histories.length = 0;
  context.renders.length = 0;
  context.animations.length = 0;
  context.proxy.setSelectionRange(4, obj.data.content.length, 'forward');
  const key = makeKeyEvent('ArrowRight', { metaKey: true });
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.deepEqual([...obj.data.lineAlign], ['left', 'center', 'center']);
  assert.equal(context.proxy.selectionStart, 4);
  assert.equal(context.proxy.selectionEnd, obj.data.content.length);
  assert.deepEqual(context.dirty, [obj.id]);
  assert.deepEqual(context.histories, ['text-align']);
  assert.deepEqual(context.renders, [{ board: true, overlay: true, reason: 'text-align' }]);
  assert.deepEqual(context.animations, []);
});

test('typing over a visible braced compound selection removes hidden closing braces', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(0, 7, 'forward');
  const event = typeNativeText(context.proxy, 'x');

  assert.equal(event.prevented, true);
  assert.equal(context.proxy.value, 'x');
  assert.equal(obj.data.content, 'x');
  assert.equal(obj.data.scriptRanges, undefined);
  assert.equal(context.proxy.selectionStart, 1);
  assert.equal(context.proxy.selectionEnd, 1);
});

test('deleting a selected braced opening also removes the paired closing brace', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(5, 6, 'forward');
  const key = makeKeyEvent('Delete');
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(context.proxy.value, 'e^{x^2}');
  assert.equal(obj.data.content, 'e^{x^2}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 7, kind: 'sup' },
    { start: 5, end: 6, kind: 'sup' },
  ]);
});

test('typing over selected braced layer contents preserves the containing layer', () => {
  for (const [start, end] of [[2, 8], [3, 8], [2, 7]]) {
    const context = loadLiveTextEditResizeHarness();
    const { obj } = context;
    obj.data = { content: 'e^{x^{2}}' };

    context.enterEdit(obj.id, { history: false });
    context.proxy.setSelectionRange(start, end, 'forward');
    const event = typeNativeText(context.proxy, 'z');

    assert.equal(event.prevented, true);
    assert.equal(context.proxy.value, 'e^{z}');
    assert.equal(obj.data.content, 'e^{z}');
    assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
      { start: 2, end: 5, kind: 'sup' },
    ]);
    assert.equal(context.proxy.selectionStart, 4);
    assert.equal(context.proxy.selectionEnd, 4);
  }
});

test('typing at a visually active braced script end stays inside that script layer', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  const event = typeNativeText(context.proxy, 'f');

  assert.equal(event.prevented, true);
  assert.equal(context.proxy.value, 'e^{x^{2}f}');
  assert.equal(obj.data.content, 'e^{x^{2}f}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 10, kind: 'sup' },
    { start: 5, end: 8, kind: 'sup' },
  ]);
  assert.equal(context.proxy.selectionStart, 9);
  assert.equal(obj._textScriptCaretIndex, 9);
});

test('typing at the parent nested script boundary stays inside that script layer', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  context.proxy.dispatchEvent(makeKeyEvent('ArrowLeft'));
  const event = typeNativeText(context.proxy, 'f');

  assert.equal(event.prevented, false);
  assert.equal(context.proxy.value, 'e^{x^{2}f}');
  assert.equal(obj.data.content, 'e^{x^{2}f}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 10, kind: 'sup' },
    { start: 5, end: 8, kind: 'sup' },
  ]);
  assert.equal(context.proxy.selectionStart, 9);
  assert.equal(obj._textScriptCaretIndex, 9);
});

test('left arrows step through visible characters after closing a braced script', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'e^{x^{2}+1}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  obj._textScriptCaretIndex = context.proxy.value.length;
  obj._textScriptCaretAffinity = 'after';
  obj._textEditCaretIndex = context.proxy.value.length;

  const firstLeft = makeKeyEvent('ArrowLeft');
  context.proxy.dispatchEvent(firstLeft);
  assert.equal(firstLeft.prevented, true);
  assert.equal(context.proxy.selectionStart, 10);
  assert.equal(obj._textScriptCaretIndex, 10);
  assert.equal(obj._textScriptCaretAffinity, 'after');

  const firstInsert = typeNativeText(context.proxy, 'a');
  assert.equal(firstInsert.prevented, false);
  assert.equal(context.proxy.value, 'e^{x^{2}+1a}');
  assert.equal(obj.data.content, 'e^{x^{2}+1a}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 12, kind: 'sup' },
    { start: 5, end: 8, kind: 'sup' },
  ]);

  obj.data = { content: 'e^{x^{2}+1}' };
  context.proxy.value = obj.data.content;
  context.proxy._boardfishSetLogicalValue(obj.data.content);
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  obj._textScriptCaretIndex = context.proxy.value.length;
  obj._textScriptCaretAffinity = 'after';
  obj._textEditCaretIndex = context.proxy.value.length;

  context.proxy.dispatchEvent(makeKeyEvent('ArrowLeft'));
  context.proxy.dispatchEvent(makeKeyEvent('ArrowLeft'));
  assert.equal(context.proxy.selectionStart, 9);
  assert.equal(obj._textScriptCaretAffinity, undefined);

  const secondInsert = typeNativeText(context.proxy, 'a');
  assert.equal(secondInsert.prevented, false);
  assert.equal(context.proxy.value, 'e^{x^{2}+a1}');
  assert.equal(obj.data.content, 'e^{x^{2}+a1}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 12, kind: 'sup' },
    { start: 5, end: 8, kind: 'sup' },
  ]);
});

test('script input waits for a real operand before creating a range', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();

  const markerOnly = transformTextScriptRangesForInput([], {
    oldValue: 'a',
    newValue: 'a^',
    start: 1,
    end: 1,
    insertedText: '^',
  });
  assert.deepEqual(Array.from(markerOnly.ranges), []);
  assert.equal(markerOnly.active, null);

  const afterMarker = transformTextScriptRangesForInput(markerOnly.ranges, {
    oldValue: 'a^',
    newValue: 'a^b',
    start: 2,
    end: 2,
    insertedText: 'b',
  });
  assert.deepEqual(Array.from(afterMarker.ranges), []);
  assert.equal(afterMarker.active, null);

  const beforeExistingCharacter = transformTextScriptRangesForInput([], {
    oldValue: 'ab',
    newValue: 'a^b',
    start: 1,
    end: 1,
    insertedText: '^',
  });
  assert.deepEqual(Array.from(beforeExistingCharacter.ranges), []);

  const beforeSpace = transformTextScriptRangesForInput([], {
    oldValue: 'a b',
    newValue: 'a^ b',
    start: 1,
    end: 1,
    insertedText: '^',
  });
  assert.deepEqual(Array.from(beforeSpace.ranges), []);
  assert.equal(beforeSpace.active, null);
});

test('space inserts at the visible script caret without closing it', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'a^{b}' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  const event = typeNativeText(context.proxy, ' ');

  assert.equal(event.prevented, true);
  assert.equal(context.proxy.value, 'a^{b }');
  assert.equal(obj.data.content, 'a^{b }');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 6, kind: 'sup' },
  ]);
});

test('Boardfish text selection clipboard payload keeps script ranges relative to copied text', () => {
  const { createTextSelectionClipboardPayload, textSelectionPayloadFromBoardfishClipboardValue } = loadTextScriptEditorHelpers();
  const source = {
    id: 'text-1',
    type: 'text',
    data: {
      content: '  \nConsider b^3/a^2\n  ',
      scriptRanges: [
        { start: 14, end: 15, kind: 'sup' },
        { start: 18, end: 19, kind: 'sup' },
      ],
    },
  };

  const payload = createTextSelectionClipboardPayload(source, {
    start: 0,
    end: source.data.content.length,
    direction: 'none',
  });

  assert.equal(payload.text, 'Consider b^{3}/a^{2}');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.scriptRanges)), [
    { start: 11, end: 14, kind: 'sup' },
    { start: 17, end: 20, kind: 'sup' },
  ]);

  const objectPayload = textSelectionPayloadFromBoardfishClipboardValue({
    type: 'objects',
    objects: [source],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(objectPayload)), JSON.parse(JSON.stringify(payload)));
});

test('Boardfish text selection clipboard normalizes hidden braced script boundaries', () => {
  const { createTextSelectionClipboardPayload } = loadTextScriptEditorHelpers();
  const source = {
    id: 'text-1',
    type: 'text',
    data: {
      content: 'p_{1}^{u_{1}} * p',
    },
  };

  for (const end of [11, 12, 13]) {
    const payload = createTextSelectionClipboardPayload(source, {
      start: 0,
      end,
      direction: 'forward',
    });
    assert.equal(payload.text, 'p_{1}^{u_{1}}');
  }

  for (const end of [5, 6, 7]) {
    const payload = createTextSelectionClipboardPayload(source, {
      start: 0,
      end,
      direction: 'forward',
    });
    assert.equal(payload.text, 'p_{1}');
  }

  for (const start of [5, 6, 7]) {
    for (const end of [11, 12, 13]) {
      const payload = createTextSelectionClipboardPayload(source, {
        start,
        end,
        direction: 'forward',
      });
      assert.equal(payload.text, 'u_{1}');
    }
  }

  const exponentSource = {
    id: 'text-2',
    type: 'text',
    data: {
      content: 'e^{x^{2}+1}',
    },
  };
  for (const end of [7, 8]) {
    const payload = createTextSelectionClipboardPayload(exponentSource, {
      start: 0,
      end,
      direction: 'forward',
    });
    assert.equal(payload.text, 'e^{x^{2}}');
  }

  const compoundSource = {
    id: 'text-3',
    type: 'text',
    data: {
      content: 'p_{1}^{u_{1}}',
    },
  };
  for (const end of [8, 9, 10]) {
    const payload = createTextSelectionClipboardPayload(compoundSource, {
      start: 0,
      end,
      direction: 'forward',
    });
    assert.equal(payload.text, 'p_{1}^{u}');
  }
});

test('Boardfish text selection paste shifts copied script ranges into destination text', () => {
  const { createTextSelectionClipboardPayload, transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const source = {
    id: 'text-1',
    type: 'text',
    data: {
      content: 'b^3/a^2',
      scriptRanges: [
        { start: 2, end: 3, kind: 'sup' },
        { start: 6, end: 7, kind: 'sup' },
      ],
    },
  };
  const payload = createTextSelectionClipboardPayload(source, {
    start: 0,
    end: source.data.content.length,
    direction: 'none',
  });

  const result = transformTextScriptRangesForInput([], {
    oldValue: 'try ',
    newValue: `try ${payload.text}`,
    start: 4,
    end: 4,
    insertedText: payload.text,
    insertedScriptRanges: payload.scriptRanges,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: 6, end: 9, kind: 'sup' },
    { start: 12, end: 15, kind: 'sup' },
  ]);
});

test('plain text paste outside existing script ranges avoids whole-text script normalization', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const prefix = 'alpha '.repeat(1200);
  const suffix = ' omega'.repeat(800);
  const markerIndex = prefix.length + 1;
  const oldValue = `${prefix}x^{abc}${suffix}`;
  const insertedText = 'external text\nwithout script ranges ';
  const result = transformTextScriptRangesForInput([
    { start: markerIndex + 1, end: markerIndex + 6, kind: 'sup' },
  ], {
    oldValue,
    newValue: `${oldValue.slice(0, 100)}${insertedText}${oldValue.slice(100)}`,
    start: 100,
    end: 100,
    insertedText,
    insertedScriptRanges: [],
  });

  assert.equal(result.fastPath, 'plain-outside-script-ranges');
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    {
      start: markerIndex + 1 + insertedText.length,
      end: markerIndex + 6 + insertedText.length,
      kind: 'sup',
    },
  ]);
});

test('plain text paste after script end avoids whole-text script normalization', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const oldValue = `x^{abc}${' tail'.repeat(1200)}`;
  const insertedText = ' external text\nwithout script ranges ';
  const result = transformTextScriptRangesForInput([
    { start: 2, end: 7, kind: 'sup' },
  ], {
    oldValue,
    newValue: `${oldValue.slice(0, 7)}${insertedText}${oldValue.slice(7)}`,
    start: 7,
    end: 7,
    insertedText,
    insertedScriptRanges: [],
    caretAffinity: 'after',
  });

  assert.equal(result.fastPath, 'plain-outside-script-ranges');
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: 2, end: 7, kind: 'sup' },
  ]);
});

test('plain text paste before script marker avoids whole-text script normalization', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const oldValue = `x^{abc}${' tail'.repeat(1200)}`;
  const insertedText = 'external text ';
  const result = transformTextScriptRangesForInput([
    { start: 2, end: 7, kind: 'sup' },
  ], {
    oldValue,
    newValue: `${oldValue.slice(0, 1)}${insertedText}${oldValue.slice(1)}`,
    start: 1,
    end: 1,
    insertedText,
    insertedScriptRanges: [],
  });

  assert.equal(result.fastPath, 'plain-outside-script-ranges');
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: 2 + insertedText.length, end: 7 + insertedText.length, kind: 'sup' },
  ]);
});

test('external paste with script marker characters derives local ranges without whole-text normalization', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const prefix = 'alpha '.repeat(1200);
  const suffix = ' omega'.repeat(800);
  const oldRangeStart = prefix.length + 2;
  const oldRangeEnd = prefix.length + 7;
  const oldValue = `${prefix}x^{abc}${suffix}`;
  const insertedText = 'plain z^{2} and q_{n} text';
  const start = 100;
  const result = transformTextScriptRangesForInput([
    { start: oldRangeStart, end: oldRangeEnd, kind: 'sup' },
  ], {
    oldValue,
    newValue: `${oldValue.slice(0, start)}${insertedText}${oldValue.slice(start)}`,
    start,
    end: start,
    insertedText,
    insertedScriptRanges: [],
  });
  const insertedSupStart = start + insertedText.indexOf('^{') + 1;
  const insertedSubStart = start + insertedText.indexOf('_{') + 1;

  assert.equal(result.fastPath, 'plain-local-script-ranges');
  assert.equal(result.insertedMayCreateScriptRange, true);
  assert.equal(result.localDerivedRangeCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: insertedSupStart, end: insertedSupStart + 3, kind: 'sup' },
    { start: insertedSubStart, end: insertedSubStart + 3, kind: 'sub' },
    {
      start: oldRangeStart + insertedText.length,
      end: oldRangeEnd + insertedText.length,
      kind: 'sup',
    },
  ]);
});

test('external paste can create script range across paste boundary using local scan', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const oldValue = `${'alpha '.repeat(400)}x`;
  const insertedText = '^{2}';
  const result = transformTextScriptRangesForInput([], {
    oldValue,
    newValue: `${oldValue}${insertedText}`,
    start: oldValue.length,
    end: oldValue.length,
    insertedText,
    insertedScriptRanges: [],
  });

  assert.equal(result.fastPath, 'plain-local-script-ranges');
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: oldValue.length + 1, end: oldValue.length + 4, kind: 'sup' },
  ]);
});

test('large text paste proxy replacement assigns value directly instead of setRangeText', () => {
  const { replaceTextEditProxyRange } = loadTextScriptEditorHelpers();
  let setRangeTextCalled = false;
  const largePrefix = 'a'.repeat(25000);
  const proxy = {
    value: `${largePrefix}tail`,
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    setRangeText() {
      setRangeTextCalled = true;
    },
  };
  const result = replaceTextEditProxyRange(proxy, 'PASTE', largePrefix.length, largePrefix.length, 'end');

  assert.equal(setRangeTextCalled, false);
  assert.equal(result.method, 'value');
  assert.equal(proxy.value, `${largePrefix}PASTEtail`);
  assert.equal(proxy.selectionStart, largePrefix.length + 'PASTE'.length);
  assert.equal(proxy.selectionEnd, largePrefix.length + 'PASTE'.length);
});

test('shared large selection deletion defers the textarea DOM value', () => {
  const context = loadTextScriptEditorHelpers();
  let setRangeTextCalled = false;
  let pendingState = null;
  const largeText = `${'a'.repeat(25000)}tail`;
  const obj = { id: 'text-1', type: 'text', data: { content: largeText } };
  const proxy = {
    value: largeText,
    selectionStart: 10,
    selectionEnd: 30,
    selectionDirection: 'none',
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    setRangeText() {
      setRangeTextCalled = true;
    },
    dispatchEvent() {},
    _boardfishSetPendingInputState(state) { pendingState = state; },
  };
  context.objectsMap = new Map([[obj.id, obj]]);
  context.beginTextEditHistoryAction = () => {};

  const replaced = context.replaceTextEditSelectionWithPayload(obj.id, proxy, {
    text: '', scriptRanges: [],
  }, {
    selection: { start: 10, end: 30, direction: 'none', hasSelection: true },
    inputType: 'deleteContentBackward',
  });

  assert.equal(replaced, true);
  assert.equal(setRangeTextCalled, false);
  assert.equal(proxy.value, largeText);
  assert.equal(proxy._boardfishLogicalValue, `${largeText.slice(0, 10)}${largeText.slice(30)}`);
  assert.equal(proxy._boardfishDomValueStale, true);
  assert.equal(proxy.selectionStart, 10);
  assert.equal(proxy.selectionEnd, 10);
  assert.equal(pendingState.replacement.insertedText, '');
});

test('small proxy replacement starts from logical text when DOM value is stale', () => {
  const { replaceTextEditProxyRange } = loadTextScriptEditorHelpers();
  const proxy = {
    value: 'aXbc',
    _boardfishLogicalValue: 'abc',
    _boardfishDomValueStale: true,
    selectionStart: 1,
    selectionEnd: 1,
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    setRangeText(text, start, end, selectionMode = 'preserve') {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      if (selectionMode === 'end') {
        const pos = start + text.length;
        this.setSelectionRange(pos, pos, 'none');
      }
    },
  };

  const result = replaceTextEditProxyRange(proxy, 'X', 1, 1, 'end');

  assert.equal(result.method, 'setRangeText');
  assert.equal(result.domSyncedBeforeMutation, true);
  assert.equal(proxy.value, 'aXbc');
  assert.equal(proxy._boardfishLogicalValue, 'aXbc');
  assert.equal(proxy._boardfishDomValueStale, false);
  assert.equal(proxy.selectionStart, 2);
  assert.equal(proxy.selectionEnd, 2);
});

test('verified Boardfish text selection paste can use native textarea insertion', () => {
  const context = loadTextScriptEditorHelpers();
  const { tryNativeBoardfishTextSelectionPaste } = context;
  const obj = {
    id: 'text-1',
    type: 'text',
    data: { content: 'hello ' },
  };
  context.objectsMap = new Map([[obj.id, obj]]);
  context.getJsClipboardWebToken = () => 'bf-token';
  context.BoardfishClipboardIO = {
    readBoardfishClipboardTokenFromEvent() {
      return 'bf-token';
    },
  };
  let historyAction = null;
  context.beginTextEditHistoryAction = (id, state, options) => {
    historyAction = { id, state, options };
  };
  let pendingState = null;
  const proxy = {
    value: 'hello ',
    selectionStart: 6,
    selectionEnd: 6,
    selectionDirection: 'none',
    _boardfishSetPendingInputState(state) {
      pendingState = state;
    },
  };

  const result = tryNativeBoardfishTextSelectionPaste(obj.id, proxy, {
    type: 'text-selection',
    text: 'PASTE',
    scriptRanges: [],
  }, {
    event: { clipboardData: {} },
    selection: { start: 6, end: 6, direction: 'none', hasSelection: false },
    fallbackText: 'PASTE',
    inputType: 'insertFromPaste',
    debug: { id: 1 },
  });

  assert.equal(result.text, 'PASTE');
  assert.deepEqual(Array.from(result.scriptRanges), []);
  assert.equal(proxy.value, 'hello ');
  assert.equal(pendingState.replacement.start, 6);
  assert.equal(pendingState.replacement.end, 6);
  assert.equal(pendingState.replacement.insertedText, 'PASTE');
  assert.equal(pendingState.nativePasteEndMeta.path, 'jsClipboard-text-selection-native');
  assert.equal(historyAction.id, obj.id);
});

test('native Boardfish paste keeps pending state through beforeinput', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const clipEvents = [];
  context.ClipDebug = {
    start(op, meta) {
      const dbg = { id: clipEvents.length + 1, op };
      clipEvents.push({ op, step: 'start', meta });
      return dbg;
    },
    step(dbg, step, meta) {
      clipEvents.push({ op: dbg.op, step, meta });
    },
    end(dbg, meta) {
      clipEvents.push({ op: dbg.op, step: 'end', meta });
    },
  };
  context.BoardfishClipboardIO = {
    describeClipboardData() { return {}; },
    readBoardfishClipboardTokenFromEvent() { return 'bf-token'; },
    readClipboardTextFromEvent() { return 'P^{Q}'; },
  };
  context.getJsClipboardWebToken = () => 'bf-token';
  context.jsClipboard = {
    type: 'text-selection',
    text: 'P^{Q}',
    scriptRanges: [{ start: 2, end: 5, kind: 'sup' }],
  };
  obj.data = { content: 'hello ' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(6, 6, 'none');
  const paste = {
    type: 'paste',
    clipboardData: {},
    cancelable: true,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  context.proxy.dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, false);

  const before = makeBeforeInputEvent('insertFromPaste', 'P^{Q}');
  context.proxy.dispatchEvent(before);
  assert.equal(before.prevented, false);
  context.proxy.value = 'hello P^{Q}';
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'insertFromPaste', data: 'P^{Q}' });

  assert.equal(obj.data.content, 'hello P^{Q}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 8, end: 11, kind: 'sup' },
  ]);
  assert.ok(clipEvents.some((event) => event.step === 'text-edit-input:end'));
  assert.ok(clipEvents.some((event) => event.step === 'end' && event.meta?.path === 'jsClipboard-text-selection-native'));
  assert.equal(clipEvents.some((event) => event.step === 'paste:text-edit-range-text-set'), false);
});

test('external paste with stale Boardfish clipboard can use native textarea insertion', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const clipEvents = [];
  context.ClipDebug = {
    start(op, meta) {
      const dbg = { id: clipEvents.length + 1, op };
      clipEvents.push({ op, step: 'start', meta });
      return dbg;
    },
    step(dbg, step, meta) {
      clipEvents.push({ op: dbg.op, step, meta });
    },
    end(dbg, meta) {
      clipEvents.push({ op: dbg.op, step: 'end', meta });
    },
  };
  context.BoardfishClipboardIO = {
    describeClipboardData() { return {}; },
    readBoardfishClipboardTokenFromEvent() { return ''; },
    readClipboardTextFromEvent() { return 'outside text'; },
  };
  context.getJsClipboardWebToken = () => 'old-token';
  context.jsClipboard = {
    type: 'text-selection',
    text: 'stale^{Boardfish}',
    scriptRanges: [{ start: 6, end: 17, kind: 'sup' }],
  };
  obj.data = { content: 'hello ' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(6, 6, 'none');
  const paste = {
    type: 'paste',
    clipboardData: {},
    cancelable: true,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  context.proxy.dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, false);

  const before = makeBeforeInputEvent('insertFromPaste', 'outside text');
  context.proxy.dispatchEvent(before);
  assert.equal(before.prevented, false);
  context.proxy.value = 'hello outside text';
  context.proxy.setSelectionRange(context.proxy.value.length, context.proxy.value.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'insertFromPaste', data: 'outside text' });

  assert.equal(obj.data.content, 'hello outside text');
  assert.equal(obj.data.scriptRanges, undefined);
  assert.ok(clipEvents.some((event) => event.step === 'paste:text-edit-native-textarea-skipped'));
  assert.ok(clipEvents.some((event) => event.step === 'paste:text-edit-native-event-text-allowed'));
  assert.ok(clipEvents.some((event) => event.step === 'end' && event.meta?.path === 'fallback-event-text-native'));
  assert.equal(clipEvents.some((event) => event.step === 'paste:text-edit-range-text-set'), false);
});

test('paste after stale proxy restore uses logical text before copy', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const copiedTexts = [];
  const jsClipboardWrites = [];
  context.BoardfishClipboardIO = {
    describeClipboardData() { return {}; },
    readClipboardTextFromEvent() { return 'X'; },
    copyTextToClipboard(text) {
      copiedTexts.push(text);
      return Promise.resolve({});
    },
  };
  context.setJsClipboard = (value) => { jsClipboardWrites.push(value); };
  obj.data = { content: 'hello removed' };

  context.enterEdit(obj.id, { history: false });
  obj.data.content = 'hello ';
  context.proxy._boardfishSetLogicalValue('hello ', false);
  context.proxy.setSelectionRange(6, 6, 'none');

  const paste = {
    type: 'paste',
    clipboardData: {},
    cancelable: true,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  context.proxy.dispatchEvent(paste);

  assert.equal(paste.defaultPrevented, true);
  assert.equal(obj.data.content, 'hello X');
  assert.equal(context.proxy.value, 'hello X');
  assert.equal(context.proxy._boardfishLogicalValue, 'hello X');
  assert.equal(context.proxy._boardfishDomValueStale, false);

  context.proxy.setSelectionRange(0, context.proxy._boardfishLogicalValue.length, 'none');
  const copy = makeKeyEvent('c');
  copy.metaKey = true;
  context.proxy.dispatchEvent(copy);

  assert.equal(copy.prevented, true);
  assert.deepEqual(copiedTexts, ['hello X']);
  assert.equal(jsClipboardWrites.length, 1);
  assert.equal(jsClipboardWrites[0].text, 'hello X');
});

test('external edit paste trims whitespace-only edge lines before insertion', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const rawPasteText = '\nline 1\n\nline 2\n';
  context.BoardfishClipboardIO = {
    describeClipboardData() { return {}; },
    readBoardfishClipboardTokenFromEvent() { return ''; },
    readClipboardTextFromEvent() { return rawPasteText; },
  };
  obj.data = { content: 'existing line 1\nexisting line 2\n\nexisting line 3' };

  context.enterEdit(obj.id, { history: false });
  const caret = obj.data.content.indexOf('\n\nexisting line 3') + 1;
  context.proxy.setSelectionRange(caret, caret, 'none');
  const paste = {
    type: 'paste',
    clipboardData: {},
    cancelable: true,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  context.proxy.dispatchEvent(paste);

  assert.equal(paste.defaultPrevented, true);
  assert.equal(
    obj.data.content,
    'existing line 1\nexisting line 2\nline 1\n\nline 2\nexisting line 3',
  );
  assert.equal(context.proxy.value, obj.data.content);
  assert.equal(context.proxy.selectionStart, 'existing line 1\nexisting line 2\nline 1\n\nline 2'.length);
});

test('enter inside an existing script starts the new line at normal size', () => {
  const { exitTextScriptForLineBreak, transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const scriptRanges = [{ start: 2, end: 4, kind: 'sup' }];
  const obj = {
    id: 'text-1',
    type: 'text',
    data: {
      content: 'a^bc',
      scriptRanges,
    },
  };
  const proxy = {
    selectionStart: 3,
    selectionEnd: 3,
    selectionDirection: 'none',
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
  };

  assert.equal(exitTextScriptForLineBreak(obj, proxy), true);
  assert.equal(proxy.selectionStart, 4);
  assert.equal(proxy.selectionEnd, 4);
  assert.equal(obj._textScriptCaretIndex, 4);
  assert.equal(obj._textScriptCaretAffinity, 'after');

  const result = transformTextScriptRangesForInput(scriptRanges, {
    oldValue: 'a^bc',
    newValue: 'a^bc\n',
    start: proxy.selectionStart,
    end: proxy.selectionEnd,
    insertedText: '\n',
    caretAffinity: obj._textScriptCaretAffinity,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), scriptRanges);
  assert.equal(result.active, null);
});

test('backspace before formatted text shifts script ranges instead of dropping them', () => {
  const { textEditInputReplacement, transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const oldValue = 'lewt a = p_1^u_1';
  const nextValue = 'lew a = p_1^u_1';
  const oldCaret = 4;
  const ranges = [
    { start: 11, end: 16, kind: 'sub' },
    { start: 13, end: 16, kind: 'sup' },
    { start: 15, end: 16, kind: 'sub' },
  ];

  const replacement = textEditInputReplacement(oldValue, nextValue, {
    start: oldCaret,
    end: oldCaret,
    inputType: 'deleteContentBackward',
  }, 'deleteContentBackward');
  assert.deepEqual(JSON.parse(JSON.stringify(replacement)), { start: 3, end: 4, insertedText: '' });

  const result = transformTextScriptRangesForInput(ranges, {
    oldValue,
    newValue: nextValue,
    start: replacement.start,
    end: replacement.end,
    insertedText: replacement.insertedText,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: 10, end: 15, kind: 'sub' },
    { start: 12, end: 15, kind: 'sup' },
    { start: 14, end: 15, kind: 'sub' },
  ]);
});

test('collapsed delete preserves the caret script layer after ranges shift', () => {
  const {
    textEditInputReplacement,
    transformTextScriptRangesForInput,
    textScriptCaretRangesAfterInput,
    setTextScriptCaretAffinityForRanges,
  } = loadTextScriptEditorHelpers();

  let oldValue = 'u_id';
  let newValue = 'u_i';
  let inputState = {
    start: 4,
    end: 4,
    hasSelection: false,
    inputType: 'deleteContentBackward',
    scriptRanges: [{ start: 2, end: 3, kind: 'sub' }],
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
  };
  let replacement = textEditInputReplacement(oldValue, newValue, inputState, inputState.inputType);
  let scriptResult = transformTextScriptRangesForInput(inputState.scriptRanges, {
    oldValue,
    newValue,
    start: replacement.start,
    end: replacement.end,
    insertedText: replacement.insertedText,
    caretAffinity: inputState.scriptCaretAffinity,
  });
  let obj = {
    id: 'text-1',
    type: 'text',
    data: { content: newValue, scriptRanges: scriptResult.ranges },
  };
  let preserved = textScriptCaretRangesAfterInput(inputState, {
    oldValue,
    newValue,
    replacement,
    inputType: inputState.inputType,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(preserved)), []);
  setTextScriptCaretAffinityForRanges(obj, 3, preserved);
  assert.equal(obj._textScriptCaretIndex, 3);
  assert.equal(obj._textScriptCaretAffinity, 'after');

  oldValue = 'u_id';
  newValue = 'u_i';
  inputState = {
    start: 4,
    end: 4,
    hasSelection: false,
    inputType: 'deleteContentBackward',
    scriptRanges: [{ start: 2, end: 4, kind: 'sub' }],
    scriptCaretAffinity: 'inside',
    scriptCaretRanges: [{ start: 2, end: 4, kind: 'sub' }],
  };
  replacement = textEditInputReplacement(oldValue, newValue, inputState, inputState.inputType);
  scriptResult = transformTextScriptRangesForInput(inputState.scriptRanges, {
    oldValue,
    newValue,
    start: replacement.start,
    end: replacement.end,
    insertedText: replacement.insertedText,
    caretAffinity: inputState.scriptCaretAffinity,
  });
  obj = {
    id: 'text-1',
    type: 'text',
    data: { content: newValue, scriptRanges: scriptResult.ranges },
  };
  preserved = textScriptCaretRangesAfterInput(inputState, {
    oldValue,
    newValue,
    replacement,
    inputType: inputState.inputType,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(preserved)), [{ start: 2, end: 3, kind: 'sub' }]);
  setTextScriptCaretAffinityForRanges(obj, 3, preserved);
  assert.equal(obj._textScriptCaretAffinity, undefined);
});

test('rich script caret navigation includes script layer boundary stops', () => {
  const {
    normalizeTextEditVisibleCaretIndex,
    moveTextEditVisibleCaret,
    moveTextEditCaretScriptLayer,
    textEditVisibleSelectionDeleteRange,
    textEditVisibleDeleteRange,
    textEditBlankLineDeleteRange,
    transformTextScriptRangesForInput,
  } = loadTextScriptEditorHelpers();
  const simpleObj = {
    id: 'text-1',
    type: 'text',
    data: { content: 'a^b', scriptRanges: [{ start: 2, end: 3, kind: 'sup' }] },
  };

  assert.equal(normalizeTextEditVisibleCaretIndex(simpleObj, 1, 'forward'), 1);
  assert.equal(normalizeTextEditVisibleCaretIndex(simpleObj, 1, 'backward'), 1);
  assert.equal(moveTextEditVisibleCaret(simpleObj, 0, 'forward'), 1);
  assert.equal(moveTextEditVisibleCaret(simpleObj, 1, 'forward'), 2);
  assert.equal(moveTextEditVisibleCaret(simpleObj, 2, 'forward'), 3);
  assert.equal(moveTextEditVisibleCaret(simpleObj, 3, 'backward'), 2);
  assert.equal(moveTextEditVisibleCaret(simpleObj, 2, 'backward'), 1);
  assert.equal(moveTextEditVisibleCaret(simpleObj, 1, 'backward'), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(simpleObj, 2, 'Delete'))), { start: 1, end: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(simpleObj, 3, 'Backspace'))), { start: 1, end: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleSelectionDeleteRange(simpleObj, { start: 2, end: 3 }))), { start: 1, end: 3 });
  const multiCharObj = {
    id: 'text-1b',
    type: 'text',
    data: { content: 'a^bc', scriptRanges: [{ start: 2, end: 4, kind: 'sup' }] },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleSelectionDeleteRange(multiCharObj, { start: 2, end: 3 }))), { start: 2, end: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleSelectionDeleteRange(multiCharObj, { start: 2, end: 4 }))), { start: 1, end: 4 });

  const blankLineText = 'line 1\n  \nline 2';
  assert.deepEqual(JSON.parse(JSON.stringify(textEditBlankLineDeleteRange(blankLineText, 7, 'Delete'))), {
    start: 7,
    end: 10,
    insertedText: '',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditBlankLineDeleteRange(blankLineText, 7, 'Backspace'))), {
    start: 6,
    end: 9,
    insertedText: '',
  });
  assert.equal(textEditBlankLineDeleteRange(blankLineText, 9, 'Backspace'), null);
  const blankLineObj = {
    id: 'text-blank',
    type: 'text',
    data: { content: blankLineText },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(blankLineObj, 9, 'Backspace'))), {
    start: 8,
    end: 9,
  });

  let oldValue = 'a^b';
  let newValue = 'a';
  let replacement = { ...textEditVisibleDeleteRange(simpleObj, 3, 'Backspace'), insertedText: '' };
  let result = transformTextScriptRangesForInput(simpleObj.data.scriptRanges, {
    oldValue,
    newValue,
    start: replacement.start,
    end: replacement.end,
    insertedText: replacement.insertedText,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), []);

  const compoundObj = {
    id: 'text-2',
    type: 'text',
    data: {
      content: 'p_1^u_1',
      scriptRanges: [
        { start: 2, end: 3, kind: 'sub' },
        { start: 4, end: 7, kind: 'sup' },
        { start: 6, end: 7, kind: 'sub' },
      ],
    },
  };
  const visibleStops = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 0; i < visibleStops.length - 1; i++) {
    assert.equal(moveTextEditVisibleCaret(compoundObj, visibleStops[i], 'forward'), visibleStops[i + 1]);
    assert.equal(moveTextEditVisibleCaret(compoundObj, visibleStops[i + 1], 'backward'), visibleStops[i]);
  }
  const nestedObj = {
    id: 'text-3',
    type: 'text',
    data: {
      content: 'e^x^2+1',
      scriptRanges: [
        { start: 2, end: 7, kind: 'sup' },
        { start: 4, end: 5, kind: 'sup' },
      ],
    },
  };
  const nestedOnlyObj = {
    id: 'text-4',
    type: 'text',
    data: {
      content: 'e^x^2',
      scriptRanges: [
        { start: 2, end: 5, kind: 'sup' },
        { start: 4, end: 5, kind: 'sup' },
      ],
    },
  };
  const nestedStops = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 0; i < nestedStops.length - 1; i++) {
    assert.equal(moveTextEditVisibleCaret(nestedObj, nestedStops[i], 'forward'), nestedStops[i + 1]);
    assert.equal(moveTextEditVisibleCaret(nestedObj, nestedStops[i + 1], 'backward'), nestedStops[i]);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(moveTextEditCaretScriptLayer(nestedObj, 7, 'forward'))), { index: 7, affinity: 'after' });
  nestedObj._textScriptCaretIndex = 7;
  nestedObj._textScriptCaretAffinity = 'after';
  assert.deepEqual(JSON.parse(JSON.stringify(moveTextEditCaretScriptLayer(nestedObj, 7, 'forward'))), { index: 7, affinity: 'after' });
  assert.deepEqual(JSON.parse(JSON.stringify(moveTextEditCaretScriptLayer(nestedObj, 7, 'backward'))), { index: 7, affinity: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(nestedObj, 7, 'Delete'))), { start: 0, end: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(nestedObj, 7, 'Backspace'))), { start: 0, end: 7 });
  delete nestedObj._textScriptCaretIndex;
  delete nestedObj._textScriptCaretAffinity;
  assert.deepEqual(JSON.parse(JSON.stringify(moveTextEditCaretScriptLayer(nestedObj, 5, 'forward'))), { index: 5, affinity: 'after' });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(compoundObj, 4, 'Delete'))), { start: 3, end: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(compoundObj, 6, 'Delete'))), { start: 5, end: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(simpleObj, 0, 'Delete'))), { start: 0, end: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(simpleObj, 1, 'Backspace'))), { start: 0, end: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(compoundObj, 0, 'Delete'))), { start: 0, end: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(nestedObj, 0, 'Delete'))), { start: 0, end: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(nestedObj, 2, 'Delete'))), { start: 2, end: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(nestedOnlyObj, 2, 'Delete'))), { start: 1, end: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleDeleteRange(nestedOnlyObj, 3, 'Backspace'))), { start: 1, end: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleSelectionDeleteRange(compoundObj, { start: 0, end: 1 }))), { start: 0, end: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleSelectionDeleteRange(compoundObj, { start: 2, end: 3 }))), { start: 1, end: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(textEditVisibleSelectionDeleteRange(compoundObj, { start: 6, end: 7 }))), { start: 5, end: 7 });

  oldValue = 'e^x^2';
  newValue = 'e';
  replacement = { ...textEditVisibleDeleteRange(nestedOnlyObj, 3, 'Backspace'), insertedText: '' };
  result = transformTextScriptRangesForInput([
    { start: 2, end: 5, kind: 'sup' },
    { start: 4, end: 5, kind: 'sup' },
  ], {
    oldValue,
    newValue,
    start: replacement.start,
    end: replacement.end,
    insertedText: replacement.insertedText,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), []);

  oldValue = 'p_1^u_1';
  newValue = 'p_1^u';
  replacement = { ...textEditVisibleDeleteRange(compoundObj, 7, 'Backspace'), insertedText: '' };
  result = transformTextScriptRangesForInput([
      { start: 2, end: 3, kind: 'sub' },
      { start: 4, end: 7, kind: 'sup' },
      { start: 6, end: 7, kind: 'sub' },
  ], {
    oldValue,
    newValue,
    start: replacement.start,
    end: replacement.end,
    insertedText: replacement.insertedText,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: 2, end: 3, kind: 'sub' },
    { start: 4, end: 5, kind: 'sup' },
  ]);
});

test('typing a script marker at a base boundary inserts before existing scripts', () => {
  const {
    normalizeTextEditVisibleCaretIndex,
    textEditScriptMarkerInsertionIndexAt,
    transformTextScriptRangesForInput,
  } = loadTextScriptEditorHelpers();

  const simpleObj = {
    id: 'text-1',
    type: 'text',
    data: {
      content: 'e^2',
      scriptRanges: [{ start: 2, end: 3, kind: 'sup' }],
    },
  };
  assert.equal(textEditScriptMarkerInsertionIndexAt(simpleObj, 2), 1);

  let result = transformTextScriptRangesForInput(simpleObj.data.scriptRanges, {
    oldValue: 'e^2',
    newValue: 'e_^2',
    start: 1,
    end: 1,
    insertedText: '_',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [{ start: 3, end: 4, kind: 'sup' }]);

  const pendingMarkerObj = {
    id: 'text-1',
    type: 'text',
    data: {
      content: 'e_^2',
      scriptRanges: [{ start: 3, end: 4, kind: 'sup' }],
    },
  };
  assert.equal(normalizeTextEditVisibleCaretIndex(pendingMarkerObj, 2, 'forward'), 2);
  assert.equal(normalizeTextEditVisibleCaretIndex(pendingMarkerObj, 2, 'backward'), 2);

  const siblingScriptsObj = {
    id: 'text-2',
    type: 'text',
    data: {
      content: 'p_1^u',
      scriptRanges: [
        { start: 2, end: 3, kind: 'sub' },
        { start: 4, end: 5, kind: 'sup' },
      ],
    },
  };
  assert.equal(textEditScriptMarkerInsertionIndexAt(siblingScriptsObj, 4), 1);

  const nestedScriptsObj = {
    id: 'text-3',
    type: 'text',
    data: {
      content: 'e^x^2+1',
      scriptRanges: [
        { start: 2, end: 7, kind: 'sup' },
        { start: 4, end: 5, kind: 'sup' },
      ],
    },
  };
  assert.equal(textEditScriptMarkerInsertionIndexAt(nestedScriptsObj, 4), 3);
});

test('linear script text can be converted to canonical braces', () => {
  const {
    textScriptLinearToDeterministicBraces,
    transformTextScriptRangesForInput,
  } = loadTextScriptEditorHelpers();
  assert.equal(textScriptLinearToDeterministicBraces('e^x^2+1', [
    { start: 2, end: 7, kind: 'sup' },
    { start: 4, end: 5, kind: 'sup' },
  ]), 'e^{x^{2}+1}');
  assert.equal(textScriptLinearToDeterministicBraces('p_1^u_1', [
    { start: 2, end: 3, kind: 'sub' },
    { start: 4, end: 7, kind: 'sup' },
    { start: 6, end: 7, kind: 'sub' },
  ]), 'p_{1}^{u_{1}}');

  const result = transformTextScriptRangesForInput([{ start: 2, end: 3, kind: 'sub' }], {
    oldValue: 'a_i',
    newValue: 'a_',
    start: 2,
    end: 3,
    insertedText: '',
    inputType: 'deleteContentBackward',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), []);
});

test('plain delete inside script text avoids whole-text script normalization', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const prefix = 'alpha '.repeat(1200);
  const suffix = ' omega'.repeat(800);
  const target = 'x^{abcdefghij}';
  const oldValue = `${prefix}${target}${suffix}`;
  const rangeStart = prefix.length + 2;
  const rangeEnd = prefix.length + target.length;
  const deleteStart = prefix.length + 5;
  const deleteEnd = prefix.length + 8;
  const newValue = `${oldValue.slice(0, deleteStart)}${oldValue.slice(deleteEnd)}`;
  const result = transformTextScriptRangesForInput([
    { start: rangeStart, end: rangeEnd, kind: 'sup' },
  ], {
    oldValue,
    newValue,
    start: deleteStart,
    end: deleteEnd,
    insertedText: '',
  });

  assert.equal(result.fastPath, 'plain-delete-script-ranges');
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges)), [
    { start: rangeStart, end: rangeEnd - (deleteEnd - deleteStart), kind: 'sup' },
  ]);
});

test('large plain delete before many script ranges stays on the outside fast path', () => {
  const { transformTextScriptRangesForInput } = loadTextScriptEditorHelpers();
  const prefix = 'alpha '.repeat(1200);
  const removed = 'remove '.repeat(40);
  let tail = '';
  const ranges = [];
  for (let i = 0; i < 1500; i++) {
    const token = ` item${i}^{x}`;
    const base = prefix.length + removed.length + tail.length;
    ranges.push({
      start: base + token.indexOf('{'),
      end: base + token.length,
      kind: 'sup',
    });
    tail += token;
  }
  const oldValue = `${prefix}${removed}${tail}`;
  const newValue = `${prefix}${tail}`;
  const result = transformTextScriptRangesForInput(ranges, {
    oldValue,
    newValue,
    start: prefix.length,
    end: prefix.length + removed.length,
    insertedText: '',
  });

  assert.equal(result.fastPath, 'plain-outside-script-ranges');
  assert.equal(result.ranges.length, ranges.length);
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges[0])), {
    start: ranges[0].start - removed.length,
    end: ranges[0].end - removed.length,
    kind: 'sup',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.ranges.at(-1))), {
    start: ranges.at(-1).start - removed.length,
    end: ranges.at(-1).end - removed.length,
    kind: 'sup',
  });
});

test('tab indents the current text edit line', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const result = applyTextEditLineIndent('one\ntwo', {
    start: 5,
    end: 5,
    direction: 'none',
  });

  assert.equal(result.changed, true);
  assert.equal(result.value, 'one\n\ttwo');
  assert.equal(result.start, 6);
  assert.equal(result.end, 6);
});

test('tab at the start of a blank first line indents that line', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const result = applyTextEditLineIndent('\none', {
    start: 0,
    end: 0,
    direction: 'none',
  });

  assert.equal(result.value, '\t\none');
  assert.equal(result.start, 1);
  assert.equal(result.end, 1);
});

test('tab indents every selected text edit line without including a trailing caret-only line', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const multiline = applyTextEditLineIndent('one\ntwo\nthree', {
    start: 1,
    end: 7,
    direction: 'forward',
  });
  assert.equal(multiline.value, '\tone\n\ttwo\nthree');
  assert.equal(multiline.start, 2);
  assert.equal(multiline.end, 9);
  assert.equal(multiline.direction, 'forward');

  const trailingLineStart = applyTextEditLineIndent('one\ntwo', {
    start: 0,
    end: 4,
    direction: 'forward',
  });
  assert.equal(trailingLineStart.value, '\tone\ntwo');
  assert.equal(trailingLineStart.start, 1);
  assert.equal(trailingLineStart.end, 5);
});

test('shift tab outdents selected text edit lines', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();

  const result = applyTextEditLineIndent('    one\n\ttwo\n  three', {
    start: 4,
    end: 20,
    direction: 'forward',
  }, true);

  assert.equal(result.changed, true);
  assert.equal(result.value, 'one\ntwo\nthree');
  assert.equal(result.start, 0);
  assert.equal(result.end, 13);
});

test('line indentation treats only LF as a line boundary', () => {
  const { applyTextEditLineIndent } = loadTextEditorHelpers();
  const value = 'alpha\u2028beta\ngamma\u2029delta';

  const result = applyTextEditLineIndent(value, {
    start: 0,
    end: value.length,
    direction: 'forward',
  });

  assert.equal(result.value, '\talpha\u2028beta\n\tgamma\u2029delta');
  assert.equal(result.start, 1);
  assert.equal(result.end, value.length + 2);
});

test('enter inserts a line break with the current line indentation', () => {
  const { applyTextEditLineBreakIndent } = loadTextEditorHelpers();
  const value = 'for each image\n    for each pixel';

  const result = applyTextEditLineBreakIndent(value, {
    start: value.length,
    end: value.length,
    direction: 'none',
  });

  assert.equal(result.value, 'for each image\n    for each pixel\n    ');
  assert.equal(result.start, result.value.length);
  assert.equal(result.end, result.value.length);
});

test('enter preserves mixed tab and space indentation', () => {
  const { applyTextEditLineBreakIndent } = loadTextEditorHelpers();
  const value = '\t  save rgba';

  const result = applyTextEditLineBreakIndent(value, {
    start: value.length,
    end: value.length,
    direction: 'none',
  });

  assert.equal(result.value, '\t  save rgba\n\t  ');
});

test('enter replaces selected text using the first selected line indentation', () => {
  const { applyTextEditLineBreakIndent } = loadTextEditorHelpers();
  const value = '    second line';

  const result = applyTextEditLineBreakIndent(value, {
    start: 4,
    end: value.length,
    direction: 'forward',
  });

  assert.equal(result.value, '    \n    ');
  assert.equal(result.start, result.value.length);
  assert.equal(result.end, result.value.length);
});

test('fresh text edit width only grows past the default width', () => {
  const { syncFreshTextEditWidth } = loadTextScriptEditorHelpers();
  const shortObj = {
    id: 'text-1',
    type: 'text',
    w: DEFAULT_TEXT_BOX_WIDTH,
    data: { content: 'short' },
    _editStartContent: '',
  };
  assert.equal(syncFreshTextEditWidth(shortObj), false);
  assert.equal(shortObj.w, DEFAULT_TEXT_BOX_WIDTH);

  const longObj = {
    id: 'text-1',
    type: 'text',
    w: DEFAULT_TEXT_BOX_WIDTH,
    data: { content: 'x'.repeat(500) },
    _editStartContent: '',
  };
  assert.equal(syncFreshTextEditWidth(longObj), true);
  assert.equal(longObj.w, 500 + TEST_TEXT_PAD * 2 + 1);

  const existingObj = {
    id: 'text-1',
    type: 'text',
    w: DEFAULT_TEXT_BOX_WIDTH,
    data: { content: 'x'.repeat(220) },
    _editStartContent: 'existing',
  };
  assert.equal(syncFreshTextEditWidth(existingObj), false);
  assert.equal(existingObj.w, DEFAULT_TEXT_BOX_WIDTH);
});

test('text edit input resizes the textbox height in update mode', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;

  context.enterEdit(obj.id, { history: false });
  assert.equal(obj.w, 800);
  assert.equal(obj.h, 160);

  context.renders = [];
  context.dirty = [];
  const oldValue = context.proxy.value;
  const nextValue = [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
  ].join('\n');
  context.proxy._boardfishSetPendingInputState({
    start: 0,
    end: oldValue.length,
    direction: 'none',
    hasSelection: true,
    value: oldValue,
    scriptRanges: obj.data.scriptRanges.map((range) => ({ ...range })),
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
    inputType: 'insertFromPaste',
    replacement: { start: 0, end: oldValue.length, insertedText: nextValue },
  });
  context.proxy.value = nextValue;
  context.proxy.setSelectionRange(nextValue.length, nextValue.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'insertFromPaste' });

  assert.equal(obj.data.content, nextValue);
  assert.equal(obj.w, 800);
  assert.equal(obj.h, 8 * TEST_LINE_H + TEST_TEXT_PAD * 2);
  assert.deepEqual(context.dirty, [obj.id]);
  assert.deepEqual(context.renders.at(-1), { board: true, overlay: true, reason: undefined });
});

test('typing after history restore uses logical text when proxy DOM value is stale', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'hello removed' };

  context.enterEdit(obj.id, { history: false });
  obj.data.content = 'hello ';
  context.proxy._boardfishSetLogicalValue('hello ', false);
  context.proxy.setSelectionRange(6, 6, 'none');

  typeNativeText(context.proxy, 'X');

  assert.equal(obj.data.content, 'hello X');
  assert.equal(context.proxy.value, 'hello X');
  assert.equal(context.proxy._boardfishLogicalValue, 'hello X');
  assert.equal(context.proxy._boardfishDomValueStale, false);
});

test('delete input without beforeinput uses logical text when proxy DOM value is stale', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'abc' };

  context.enterEdit(obj.id, { history: false });
  obj.data.content = 'abc';
  context.proxy.value = 'aXXbc';
  context.proxy._boardfishSetLogicalValue('abc', false);
  context.proxy.setSelectionRange(1, 1, 'none');

  context.proxy.value = 'aXbc';
  context.proxy.dispatchEvent({ type: 'input', inputType: 'deleteContentForward' });

  assert.equal(obj.data.content, 'ac');
  assert.equal(context.proxy.value, 'ac');
  assert.equal(context.proxy._boardfishLogicalValue, 'ac');
  assert.equal(context.proxy._boardfishDomValueStale, false);
  assert.equal(context.proxy.selectionStart, 1);
  assert.equal(context.proxy.selectionEnd, 1);
});

test('cmd+a syncs a stale short edit proxy before selecting the full logical text', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'old' };

  context.enterEdit(obj.id, { history: false });
  const logicalValue = `${'x'.repeat(25_000)}tail`;
  obj.data.content = logicalValue;
  context.proxy.value = 'old';
  context.proxy._boardfishSetLogicalValue(logicalValue, false);
  context.proxy.setSelectionRange(3, 3, 'none');

  const key = makeKeyEvent('a', { metaKey: true });
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(context.proxy.value, logicalValue);
  assert.equal(context.proxy._boardfishLogicalValue, logicalValue);
  assert.equal(context.proxy._boardfishDomValueStale, false);
  assert.equal(context.proxy.selectionStart, 0);
  assert.equal(context.proxy.selectionEnd, logicalValue.length);
});

test('delete removes an indented blank line in one keypress', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'line 1\n  \nline 2' };

  context.enterEdit(obj.id, { history: false });
  const blankLineStart = obj.data.content.indexOf('\n') + 1;
  context.proxy.setSelectionRange(blankLineStart, blankLineStart, 'none');
  obj._textEditCaretIndex = blankLineStart;
  obj._textEditCaretLineStartIndex = blankLineStart;
  const key = makeKeyEvent('Delete');

  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(obj.data.content, 'line 1\nline 2');
  assert.equal(context.proxy.value, 'line 1\nline 2');
  assert.equal(context.proxy.selectionStart, blankLineStart);
  assert.equal(context.proxy.selectionEnd, blankLineStart);
  assert.equal(obj._textEditCaretIndex, blankLineStart);
  assert.equal(obj._textEditCaretLineStartIndex, undefined);
});

test('backspace after a tab on a blank line removes only the tab', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.data = { content: 'Case n = k:\n\t' };

  context.enterEdit(obj.id, { history: false });
  const lineStart = obj.data.content.indexOf('\n') + 1;
  const caretAfterTab = obj.data.content.length;
  context.proxy.setSelectionRange(caretAfterTab, caretAfterTab, 'none');
  obj._textEditCaretIndex = caretAfterTab;
  obj._textEditCaretLineStartIndex = lineStart;
  const key = makeKeyEvent('Backspace');

  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(obj.data.content, 'Case n = k:\n');
  assert.equal(context.proxy.value, 'Case n = k:\n');
  assert.equal(context.proxy.selectionStart, lineStart);
  assert.equal(context.proxy.selectionEnd, lineStart);
  assert.equal(obj._textEditCaretIndex, lineStart);
  assert.equal(obj._textEditCaretLineStartIndex, undefined);
});

test('large existing text edit defers auto-height until exit', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const largeText = `${'word '.repeat(4100)}tail`;
  obj.data = { content: largeText };
  obj.w = 800;
  obj.h = 160;

  context.enterEdit(obj.id, { history: false });
  context.renders = [];
  context.dirty = [];

  const insertedText = ' pasted';
  const nextValue = largeText + insertedText;
  context.proxy._boardfishSetPendingInputState({
    start: largeText.length,
    end: largeText.length,
    direction: 'none',
    hasSelection: false,
    value: largeText,
    scriptRanges: [],
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
    inputType: 'insertFromPaste',
    replacement: { start: largeText.length, end: largeText.length, insertedText },
  });
  context.proxy.value = nextValue;
  context.proxy.setSelectionRange(nextValue.length, nextValue.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'insertFromPaste' });

  assert.equal(obj.data.content, nextValue);
  assert.equal(obj.h, 160);
  assert.equal(obj._textEditPendingSizeSync, true);
  assert.deepEqual(context.renders.at(-1), { board: true, overlay: false, reason: undefined });

  context.exitEdit();
  assert.notEqual(obj.h, 160);
  assert.equal(obj._textEditPendingSizeSync, undefined);
});

test('large pasted text shrinks after a cached line-removing delete', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const line = 'x'.repeat(3000);
  const initialValue = Array.from({ length: 50 }, () => line).join('\n');
  obj.data = { content: initialValue };
  obj.w = 1_000_000;
  obj.h = 50 * TEST_LINE_H + TEST_TEXT_PAD * 2;

  context.enterEdit(obj.id, { history: false });

  const pastedText = `\n${line}`;
  const pastedValue = initialValue + pastedText;
  context.proxy._boardfishSetPendingInputState({
    start: initialValue.length,
    end: initialValue.length,
    direction: 'none',
    hasSelection: false,
    value: initialValue,
    scriptRanges: [],
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
    inputType: 'insertFromPaste',
    replacement: { start: initialValue.length, end: initialValue.length, insertedText: pastedText },
  });
  context.proxy.value = pastedValue;
  context.proxy.setSelectionRange(pastedValue.length, pastedValue.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'insertFromPaste' });

  assert.equal(obj.data.content, pastedValue);
  assert.equal(obj.h, 50 * TEST_LINE_H + TEST_TEXT_PAD * 2);
  assert.equal(obj._textEditPendingSizeSync, true);

  context.getTextLayout(obj);
  const nextValue = pastedValue.split('\n').slice(0, 10).join('\n');
  context.proxy._boardfishSetPendingInputState({
    start: nextValue.length,
    end: pastedValue.length,
    direction: 'forward',
    hasSelection: true,
    value: pastedValue,
    scriptRanges: [],
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
    inputType: 'deleteContentBackward',
    replacement: { start: nextValue.length, end: pastedValue.length, insertedText: '' },
  });
  context.proxy.value = nextValue;
  context.proxy.setSelectionRange(nextValue.length, nextValue.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'deleteContentBackward' });

  assert.equal(obj.data.content, nextValue);
  assert.equal(obj.data.content.length >= 20000, true);
  assert.equal(obj.h, 10 * TEST_LINE_H + TEST_TEXT_PAD * 2);
  assert.equal(obj._textEditPendingSizeSync, undefined);
  assert.deepEqual(context.renders.at(-1), { board: true, overlay: true, reason: undefined });
});

test('large pasted text shrinks after line-removing delete before layout cache exists', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const line = 'x'.repeat(3000);
  const initialValue = Array.from({ length: 50 }, () => line).join('\n');
  obj.data = { content: initialValue };
  obj.w = 1_000_000;
  obj.h = 50 * TEST_LINE_H + TEST_TEXT_PAD * 2;

  context.enterEdit(obj.id, { history: false });

  const pastedText = `\n${line}`;
  const pastedValue = initialValue + pastedText;
  context.proxy._boardfishSetPendingInputState({
    start: initialValue.length,
    end: initialValue.length,
    direction: 'none',
    hasSelection: false,
    value: initialValue,
    scriptRanges: [],
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
    inputType: 'insertFromPaste',
    replacement: { start: initialValue.length, end: initialValue.length, insertedText: pastedText },
  });
  context.proxy.value = pastedValue;
  context.proxy.setSelectionRange(pastedValue.length, pastedValue.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'insertFromPaste' });

  assert.equal(obj.data.content, pastedValue);
  assert.equal(obj.h, 50 * TEST_LINE_H + TEST_TEXT_PAD * 2);
  assert.equal(obj._textEditPendingSizeSync, true);
  delete obj._layoutCache;
  delete obj._layoutCacheContent;
  delete obj._layoutCacheW;

  const nextValue = pastedValue.split('\n').slice(0, 10).join('\n');
  context.proxy._boardfishSetPendingInputState({
    start: nextValue.length,
    end: pastedValue.length,
    direction: 'forward',
    hasSelection: true,
    value: pastedValue,
    scriptRanges: [],
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
    inputType: 'deleteContentBackward',
    replacement: { start: nextValue.length, end: pastedValue.length, insertedText: '' },
  });
  context.proxy.value = nextValue;
  context.proxy.setSelectionRange(nextValue.length, nextValue.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'deleteContentBackward' });

  assert.equal(obj.data.content, nextValue);
  assert.equal(obj.data.content.length >= 20000, true);
  assert.equal(obj.h, 10 * TEST_LINE_H + TEST_TEXT_PAD * 2);
  assert.equal(obj._textEditPendingSizeSync, undefined);
  assert.deepEqual(context.renders.at(-1), { board: true, overlay: true, reason: undefined });
});

test('undo-restored large pasted text shrinks on the next selected delete', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const line = 'x'.repeat(3000);
  const restoredValue = Array.from({ length: 51 }, () => line).join('\n');
  obj.data = { content: restoredValue };
  obj.w = 1_000_000;
  obj.h = 51 * TEST_LINE_H + TEST_TEXT_PAD * 2;

  context.enterEdit(obj.id, { history: false });
  obj._editMinLines = 51;
  obj._textEditPreservedMinLines = 51;
  delete obj._textEditPendingSizeSync;
  delete obj._layoutCache;
  delete obj._layoutCacheContent;
  delete obj._layoutCacheW;

  const nextValue = restoredValue.split('\n').slice(0, 10).join('\n');
  context.proxy._boardfishSetPendingInputState({
    start: nextValue.length,
    end: restoredValue.length,
    direction: 'forward',
    hasSelection: true,
    value: restoredValue,
    scriptRanges: [],
    scriptCaretAffinity: '',
    scriptCaretRanges: [],
    inputType: 'deleteContentBackward',
    replacement: { start: nextValue.length, end: restoredValue.length, insertedText: '' },
  });
  context.proxy.value = nextValue;
  context.proxy.setSelectionRange(nextValue.length, nextValue.length, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'deleteContentBackward' });

  assert.equal(obj.data.content, nextValue);
  assert.equal(obj.data.content.length >= 20000, true);
  assert.equal(obj.h, 10 * TEST_LINE_H + TEST_TEXT_PAD * 2);
  assert.equal(obj._editMinLines, 1);
  assert.equal(obj._textEditPreservedMinLines, undefined);
  assert.equal(obj._textEditPendingSizeSync, undefined);
  assert.deepEqual(context.renders.at(-1), { board: true, overlay: true, reason: undefined });
});

test('perf text input trace records selected-content delete phases', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const steps = [];
  context.ManualPerfDebug = {
    isTextEditInputTraceActive(inputType) {
      return String(inputType || '').startsWith('delete');
    },
    recordTextEditInputStep(step, meta) {
      steps.push({ step, meta });
    },
  };
  obj.data = { content: 'alpha beta gamma' };

  context.enterEdit(obj.id, { history: false });
  context.proxy.setSelectionRange(6, 10, 'forward');
  const before = makeBeforeInputEvent('deleteContentBackward');
  context.proxy.dispatchEvent(before);
  assert.equal(before.prevented, false);

  context.proxy.value = 'alpha gamma';
  context.proxy.setSelectionRange(6, 6, 'none');
  context.proxy.dispatchEvent({ type: 'input', inputType: 'deleteContentBackward' });

  assert.equal(obj.data.content, 'alpha gamma');
  assert.ok(steps.some((event) => event.step === 'beforeinput-state-ready'));
  assert.ok(steps.some((event) => event.step === 'replacement-ready' && event.meta.removedChars === 4));
  assert.ok(steps.some((event) => event.step === 'script-ranges-transformed'));
  assert.ok(steps.some((event) => event.step === 'layout-patched' || event.step === 'layout-invalidated'));
  assert.ok(steps.some((event) => event.step === 'history-recorded'));
  assert.ok(steps.some((event) => event.step === 'render-scheduled'));
  assert.ok(steps.some((event) => event.step === 'end'));
  assert.deepEqual([...new Set(steps.map((event) => event.meta.seq).filter(Boolean))], [1]);
});

test('large keyboard structural delete avoids textarea setRangeText', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  const largeText = `${'word '.repeat(5000)}tail`;
  const steps = [];
  context.ManualPerfDebug = {
    isTextEditInputTraceActive(inputType) {
      return String(inputType || '').startsWith('delete');
    },
    recordTextEditInputStep(step, meta) {
      steps.push({ step, meta });
    },
  };
  obj.data = { content: largeText };

  context.enterEdit(obj.id, { history: false });
  let setRangeTextCalls = 0;
  const originalSetRangeText = context.proxy.setRangeText.bind(context.proxy);
  context.proxy.setRangeText = (...args) => {
    setRangeTextCalls++;
    return originalSetRangeText(...args);
  };
  context.proxy.setSelectionRange(10, 30, 'forward');
  const key = makeKeyEvent('Backspace');
  context.proxy.dispatchEvent(key);

  assert.equal(key.prevented, true);
  assert.equal(setRangeTextCalls, 0);
  assert.equal(obj.data.content, `${largeText.slice(0, 10)}${largeText.slice(30)}`);
  assert.equal(context.proxy.value, largeText);
  assert.equal(context.proxy._boardfishLogicalValue, obj.data.content);
  assert.equal(context.proxy._boardfishDomValueStale, true);
  assert.equal(context.proxy.selectionStart, 10);
  assert.equal(context.proxy.selectionEnd, 10);
  const mutationStep = steps.find((event) => event.step === 'keydown-delete-textarea-mutated');
  assert.equal(mutationStep.meta.textareaMutationMethod, 'logical');
  assert.equal(mutationStep.meta.domProxyChars, largeText.length);
  assert.equal(mutationStep.meta.proxyChars, obj.data.content.length);
  assert.equal(mutationStep.meta.nextChars, obj.data.content.length);
});

test('editing existing default-height text can shrink below the default new textbox height', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.w = DEFAULT_TEXT_BOX_WIDTH;
  obj.h = DEFAULT_TEXT_BOX_HEIGHT;
  obj.data = { content: 'e^{x^{2}}' };

  context.enterEdit(obj.id, { history: false });
  assert.equal(obj.h, DEFAULT_TEXT_BOX_HEIGHT);
  assert.equal(obj._editMinLines, 1);

  context.proxy.setSelectionRange(7, 7, 'none');
  const event = typeNativeText(context.proxy, '3');

  assert.equal(event.prevented, false);
  assert.equal(obj.data.content, 'e^{x^{23}}');
  assert.equal(obj.h, SINGLE_LINE_TEXT_BOX_HEIGHT);
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 10, kind: 'sup' },
    { start: 5, end: 9, kind: 'sup' },
  ]);
});

test('freshly created text stays at default height until edit exit', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.w = DEFAULT_TEXT_BOX_WIDTH;
  obj.h = DEFAULT_TEXT_BOX_HEIGHT;
  obj.data = { content: '' };

  context.enterEdit(obj.id, { history: false });
  assert.equal(obj._editMinLines, TEST_NEW_TEXT_EDIT_MIN_LINES);

  const event = typeNativeText(context.proxy, 'Hi');

  assert.equal(event.prevented, false);
  assert.equal(obj.data.content, 'Hi');
  assert.equal(obj.h, DEFAULT_TEXT_BOX_HEIGHT);

  context.exitEdit();
  assert.equal(obj.h, SINGLE_LINE_TEXT_BOX_HEIGHT);

  context.enterEdit(obj.id, { history: false });
  assert.equal(obj._editMinLines, 1);
});

test('exiting a newly created one-line text box keeps default size when content fits', () => {
  const context = loadExitEditHarness();

  context.exitEdit();

  assert.equal(context.obj.w, DEFAULT_TEXT_BOX_WIDTH);
  assert.equal(context.obj.h, SINGLE_LINE_TEXT_BOX_HEIGHT);
  assert.deepEqual(context.dirty, []);
  assert.deepEqual(context.histories, []);
  assert.deepEqual(context.renders, [{ board: true, overlay: true }]);
});

test('exiting unchanged existing text keeps cached layout and skips size history', () => {
  const context = loadExitEditHarness();
  const cachedLayout = [{ text: 'Hi', startIndex: 0, endIndex: 2, nextStartIndex: 2 }];
  Object.assign(context.obj, {
    h: SINGLE_LINE_TEXT_BOX_HEIGHT,
    _editMinLines: 5,
    _editStartContent: 'Hi',
    _layoutCache: cachedLayout,
    _layoutCacheContent: 'Hi',
    _layoutCacheW: context.obj.w,
    _layoutCacheScriptKey: '[]',
    _layoutCacheAlignKey: '',
    _layoutCacheY: context.obj.y,
  });
  context._editHistoryLastContent = 'Hi';

  context.exitEdit();

  assert.equal(context.obj._layoutCache, cachedLayout);
  assert.deepEqual(context.dirty, []);
  assert.deepEqual(context.histories, []);
  assert.deepEqual(context.editHistoryPushes, ['text-1']);
  assert.deepEqual(context.renders, [{ board: true, overlay: true }]);
});
