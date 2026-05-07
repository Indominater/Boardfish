'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadViewportHitTest() {
  const source = readSource('src/js/viewport.js');
  const match = source.match(/function hitTest\(wx, wy, \{ includeLocked = false \} = \{\}\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'viewport hitTest function is missing');

  const context = {
    nextObject: null,
    BoardObjectGeometry: {
      topObjectAtWorldPoint(point) {
        context.lastPoint = point;
        return context.nextObject;
      },
    },
    isObjectLocked(obj) {
      return obj?.locked === true;
    },
  };
  vm.createContext(context);
  vm.runInContext(`${match[0]}\nthis.hitTest = hitTest;`, context);
  return context;
}

test('locked topmost objects behave like board background for normal hits', () => {
  const context = loadViewportHitTest();
  const lockedObject = { id: 'locked', locked: true };
  const unlockedObject = { id: 'unlocked', locked: false };

  context.nextObject = lockedObject;
  assert.equal(context.hitTest(10, 20), null);
  assert.equal(context.hitTest(10, 20, { includeLocked: true }), lockedObject);

  context.nextObject = unlockedObject;
  assert.equal(context.hitTest(10, 20), unlockedObject);
  assert.equal(context.lastPoint.x, 10);
  assert.equal(context.lastPoint.y, 20);
});

test('only the context menu opts normal canvas interaction into locked hits', () => {
  const inputSource = readSource('src/js/canvas_input.js');
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.doesNotMatch(inputSource, /includeLocked:\s*true/);
  assert.doesNotMatch(inputSource, /lockedHit/);
  assert.match(contextMenuSource, /hitTest\(wp\.x, wp\.y, \{ includeLocked: true \}\)/);
});
