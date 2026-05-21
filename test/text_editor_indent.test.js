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
      '\nglobalThis.applyTextEditLineIndent = applyTextEditLineIndent;\n',
    context,
    { filename: 'text_editor.js' },
  );
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
