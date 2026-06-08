'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const DEFAULT_TEXT_BOX_HEIGHT = 5 * 24 + 4 * 2;
const DEFAULT_TEXT_BOX_WIDTH = DEFAULT_TEXT_BOX_HEIGHT * GOLDEN_RATIO;

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
      applyActionAnimation(action) { context.animations.push(action); },
    },
    flushEditHistoryCheckpoint() { context.flushedHistory = true; return false; },
    invalidateOffscreen() {},
    markDirty(id) { context.dirty.push(id); },
    pushHistory(reason) { context.histories.push(reason); },
    scheduleRender(board, overlay, reason) { context.renders.push({ board, overlay, reason }); },
    syncAllTextAutoHeights() {},
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
      'globalThis.textScriptCaretAffinityForInput = textScriptCaretAffinityForInput;\n' +
      'globalThis.textScriptCaretRangesAfterInput = textScriptCaretRangesAfterInput;\n' +
      'globalThis.setTextScriptCaretAffinityForRanges = setTextScriptCaretAffinityForRanges;\n' +
      'globalThis.textScriptLinearToDeterministicBraces = textScriptLinearToDeterministicBraces;\n' +
      'globalThis.textEditInputReplacement = textEditInputReplacement;\n' +
      'globalThis.normalizeTextEditVisibleCaretIndex = normalizeTextEditVisibleCaretIndex;\n' +
      'globalThis.moveTextEditVisibleCaret = moveTextEditVisibleCaret;\n' +
      'globalThis.moveTextEditCaretScriptLayer = moveTextEditCaretScriptLayer;\n' +
      'globalThis.textEditVisibleSelectionDeleteRange = textEditVisibleSelectionDeleteRange;\n' +
      'globalThis.textEditVisibleDeleteRange = textEditVisibleDeleteRange;\n' +
      'globalThis.textEditScriptMarkerInsertionIndexAt = textEditScriptMarkerInsertionIndexAt;\n' +
      'globalThis.transformTextScriptRangesForInput = transformTextScriptRangesForInput;\n',
    context,
    { filename: 'text_script_editor_helpers.js' },
  );
  return context;
}

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
    _editEl: { remove() { context.removedProxy = true; } },
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
      applyActionAnimation(action) { context.animations.push(action); },
    },
    BoardfishEditorState: {
      removeEmptyTextObjects() {},
    },
    clearInterval(id) { context.clearedIntervals.push(id); },
    clearTimeout(id) { context.clearedTimeouts.push(id); },
    markDirty(id) { context.dirty.push(id); },
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
    addEventListener(type, fn) { this.listeners[type] = fn; },
    dispatchEvent(event) {
      this.listeners[event.type]?.(event);
      return true;
    },
    focus() { context.focusedProxy = true; },
    remove() { context.removedProxy = true; },
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
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      getSelection() { return { removeAllRanges() {} }; },
    },
    BoardfishMotion: {
      applyActionAnimation(action) { context.animations.push(action); },
    },
    BoardfishEditorState: {
      removeEmptyTextObjects() {},
    },
    beginTextEditHistoryAction() {},
    shouldCommitTextEditInputImmediately() { return false; },
    recordTextEditInputHistory() {},
    flushEditHistoryCheckpoint() { return false; },
    markDirty(id) { context.dirty.push(id); },
    pushHistory(reason) { context.histories.push(reason); },
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
      'globalThis.exitEdit = exitEdit;\n',
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

function makeKeyEvent(key) {
  return {
    type: 'keydown',
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
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
  }, { outdent: true });

  assert.equal(result.changed, true);
  assert.equal(result.value, 'one\ntwo\nthree');
  assert.equal(result.start, 0);
  assert.equal(result.end, 13);
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
    data: { content: 'x'.repeat(220) },
    _editStartContent: '',
  };
  assert.equal(syncFreshTextEditWidth(longObj), true);
  assert.equal(longObj.w, 229);

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
  assert.equal(obj.h, 200);
  assert.deepEqual(context.dirty, [obj.id]);
  assert.deepEqual(context.renders.at(-1), { board: true, overlay: true, reason: undefined });
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
  assert.equal(obj.h, 32);
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 10, kind: 'sup' },
    { start: 5, end: 9, kind: 'sup' },
  ]);
});

test('freshly created text stays at five-line height until edit exit', () => {
  const context = loadLiveTextEditResizeHarness();
  const { obj } = context;
  obj.w = DEFAULT_TEXT_BOX_WIDTH;
  obj.h = DEFAULT_TEXT_BOX_HEIGHT;
  obj.data = { content: '' };

  context.enterEdit(obj.id, { history: false });
  assert.equal(obj._editMinLines, 5);

  const event = typeNativeText(context.proxy, 'Hi');

  assert.equal(event.prevented, false);
  assert.equal(obj.data.content, 'Hi');
  assert.equal(obj.h, DEFAULT_TEXT_BOX_HEIGHT);

  context.exitEdit();
  assert.equal(obj.h, 32);

  context.enterEdit(obj.id, { history: false });
  assert.equal(obj._editMinLines, 1);
});

test('exiting a newly created text box keeps default width when content fits', () => {
  const context = loadExitEditHarness();

  context.exitEdit();

  assert.equal(context.obj.w, DEFAULT_TEXT_BOX_WIDTH);
  assert.equal(context.obj.h, 32);
  assert.deepEqual(context.dirty, ['text-1']);
  assert.deepEqual(context.histories, ['text-height-change']);
  assert.deepEqual(context.renders, [{ board: true, overlay: true }]);
});
