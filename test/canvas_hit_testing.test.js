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
  const match = source.match(/function hitTest\(wx, wy\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'viewport hitTest function is missing');

  const context = {
    nextObject: null,
    BoardObjectGeometry: {
      topObjectAtWorldPoint(point) {
        context.lastPoint = point;
        return context.nextObject;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${match[0]}\nthis.hitTest = hitTest;`, context);
  return context;
}

test('hitTest returns the top object at the world point', () => {
  const context = loadViewportHitTest();
  const object = { id: 'obj-1' };

  context.nextObject = object;
  assert.equal(context.hitTest(10, 20), object);
  assert.equal(context.lastPoint.x, 10);
  assert.equal(context.lastPoint.y, 20);
});

test('canvas and context menu use regular hit testing', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(contextMenuSource, /hitTest\(wp\.x, wp\.y\)/);
});

test('background context menu clears object selection before opening', () => {
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(contextMenuSource, /if \(obj\) \{[\s\S]*obj-ctx-menu:open[\s\S]*return;[\s\S]*\}\s*if \(selectedIds\.size\) deselectAll\(\);\s*ctxPos = wp;\s*updateCtxMenuActions\(\);\s*openCtxMenuAt\(clientX, clientY\);/);
});
