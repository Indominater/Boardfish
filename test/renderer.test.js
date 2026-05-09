'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderer() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'renderer.js'), 'utf8'),
    context,
    { filename: 'renderer.js' },
  );
  return context.BoardfishRenderer;
}

test('text renderer uses the latest measured baseline offset', () => {
  const BoardfishRenderer = loadRenderer();
  let baselineOffset = 10;
  const fillTextCalls = [];
  const context = {
    fillStyle: '',
    textBaseline: '',
    fillText(text, x, y) {
      fillTextCalls.push({ text, x, y });
    },
  };
  const obj = { type: 'text', x: 20, y: 30 };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    getWrappedLines: () => [{ text: 'one' }, { text: 'two' }],
    lineHeight: 24,
    dpr: () => 1,
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => baselineOffset,
    textPad: 4,
    zoom: () => 1,
  });

  baselineOffset = 12;
  renderer.drawSingleObj(context, obj);

  assert.deepEqual(fillTextCalls, [
    { text: 'one', x: 24, y: 46 },
    { text: 'two', x: 24, y: 70 },
  ]);
});
