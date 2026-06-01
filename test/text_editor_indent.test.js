'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

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

function loadExitEditHarness() {
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 80,
    z: 1,
    data: { content: 'Hi' },
    _editMinLines: 3,
    _editStartContent: '',
  };
  const context = {
    console,
    objects: [obj],
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

test('exiting a newly created text box fits width to rendered content', () => {
  const context = loadExitEditHarness();

  context.exitEdit();

  assert.equal(context.obj.w, 22);
  assert.equal(context.obj.h, 32);
  assert.deepEqual(context.dirty, ['text-1']);
  assert.deepEqual(context.histories, ['text-height-change']);
  assert.deepEqual(context.renders, [{ board: true, overlay: true }]);
});
