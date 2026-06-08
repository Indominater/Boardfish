'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = source.indexOf(`\n  function `, start + 1);
  assert.notEqual(next, -1, `${name} end could not be found`);
  return source.slice(start, next);
}

test('text edit math perf debugger is passive event recording only', () => {
  const source = readSource('src/js/debug_manual_perf.js');
  const beginSource = functionSource(source, 'textEditMathBegin');
  const reportSource = functionSource(source, 'textEditMathReport');
  const combined = `${beginSource}\n${reportSource}`;

  assert.match(source, /const TEXT_EDIT_MATH_EVENT_TYPES = \[[\s\S]*'wheel'[\s\S]*'pointermove'[\s\S]*'mousemove'[\s\S]*'beforeinput'[\s\S]*'input'[\s\S]*'paste'[\s\S]*'selectionchange'/);
  assert.match(source, /deltaX: event\?\.deltaX/);
  assert.match(source, /clientX: event\?\.clientX/);
  assert.match(source, /textEditMathBegin/);
  assert.match(source, /textEditMathReport/);
  assert.match(source, /textEditMathTimeline/);
  assert.match(combined, /mode: 'passive-event-recording'/);
  assert.match(combined, /BoardfishDebug\.viewport\.enable/);
  assert.match(combined, /BoardfishDebug\.viewport\.reset/);
  assert.match(combined, /setTextEditMathListeners\(true\)/);
  assert.match(combined, /setTextEditMathListeners\(false\)/);

  for (const forbidden of [
    'largeTextSetup',
    'wheelPanTest',
    'wheelZoomTest',
    'mousePanTest',
    'dispatchPanWheel',
    'dispatchPanMouse',
    'measureTextLayoutPass',
    'getTextLayout',
    'clearTextLayoutCaches',
    'textBoardSummary',
    'memorySnapshot',
    'restoreLargeTextOriginalState',
    'BoardfishEditorState',
    'BoardfishViewportState.setViewport',
    'scheduleRender',
    'copyLast()',
  ]) {
    assert.doesNotMatch(combined, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
