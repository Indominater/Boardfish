'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

function loadAddTextHarness({ syncedHeight = null, withTextLayout = false } = {}) {
  const textLayoutSource = withTextLayout ? fs.readFileSync(path.join(root, 'src/js/text_layout.js'), 'utf8') + '\n' : '';
  const source = fs.readFileSync(path.join(root, 'src/js/object_commands.js'), 'utf8');
  let idCounter = 1;
  const context = {
    console,
    TextEncoder,
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
    added: [],
    animations: [],
    editedIds: [],
    histories: [],
    objects: [],
    renders: [],
    selectedIds: [],
    zCounter: 1,
    LINE_H: 24,
    TEXT_PAD: 4,
    NEW_TEXT_EDIT_MIN_LINES: 5,
    BoardfishWebLimits: {
      canAddObjects() { return true; },
      canAcceptAdditionalContentBytes() { return true; },
    },
    BoardfishEditorState: {
      addObject(obj) {
        context.added.push(obj);
        return obj;
      },
    },
    BoardfishMotion: {
      applyActionAnimation(action, payload = {}) {
        context.animations.push({ action, ids: (payload.objects || []).map((obj) => obj.id) });
      },
    },
    normalizeTextContent(value) {
      return String(value ?? '').replace(/\r\n?/g, '\n');
    },
    textForTextObjectPaste(value) {
      const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
      let first = 0;
      let last = lines.length - 1;
      while (first <= last && !/\S/.test(lines[first])) first++;
      while (last >= first && !/\S/.test(lines[last])) last--;
      return first <= last ? lines.slice(first, last + 1).join('\n') : '';
    },
    newId() {
      return `obj-${idCounter++}`;
    },
    syncTextAutoHeight(obj, minLines = 1) {
      const contentLines = String(obj.data?.content || '').split('\n').length;
      obj.h = syncedHeight ?? Math.max(minLines, contentLines) * context.LINE_H + context.TEXT_PAD * 2;
      return true;
    },
    selectObject(id) {
      context.selectedIds.push(id);
    },
    scheduleRender(board, overlay) {
      context.renders.push({ board, overlay });
    },
    pushHistory(reason) {
      context.histories.push(reason);
    },
    enterEdit(id) {
      context.editedIds.push(id);
    },
    invalidateOffscreen() {},
    syncAllTextAutoHeights() {},
  };
  vm.createContext(context);
  vm.runInContext(`${textLayoutSource}${source}\nglobalThis.addText = addText;\n`, context, {
    filename: 'object_commands.js',
  });
  return context;
}

function loadPasteHarness() {
  const source = fs.readFileSync(path.join(root, 'src/js/clipboard_export_init.js'), 'utf8');
  const calls = { addText: [] };
  const context = {
    console,
    Promise,
    calls,
    document: {
      addEventListener() {},
      visibilityState: 'visible',
    },
    window: {
      addEventListener() {},
    },
    objects: [],
    jsClipboard: null,
    _pasteInProgress: false,
    BoardfishClipboardIO: {
      describeClipboardData() { return {}; },
      readClipboardImageFileFromEvent() { return null; },
      readClipboardTextFromEvent(clipboardData) {
        return clipboardData?.getData?.('text/plain') || '';
      },
    },
    ClipDebug: {
      end() {},
      start() { return {}; },
      step() {},
    },
    resizeCanvas() {},
    addText(wx, wy, content, options = {}) {
      calls.addText.push({ wx, wy, content, options });
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.pasteAtPos = pasteAtPos;\n`, context, {
    filename: 'clipboard_export_init.js',
  });
  return context;
}

test('addText can center a text box after auto-height is synced', () => {
  const context = loadAddTextHarness({ syncedHeight: 184 });
  const content = [
    'The Alienware 16X Aurora has been updated this year with new configurations.',
    'The upgrades come at a hefty cost.',
  ].join('\n');

  context.addText(640, 360, content, { anchor: 'center' });

  const obj = context.added[0];
  assert.equal(obj.x + obj.w / 2, 640);
  assert.equal(obj.y + obj.h / 2, 360);
  assert.equal(obj.h, 184);
  assert.deepEqual(context.histories, ['add-text']);
  assert.deepEqual(context.editedIds, []);
});

test('addText keeps top-left placement by default', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48);

  const obj = context.added[0];
  assert.equal(obj.x, 24);
  assert.equal(obj.y, 48);
  assert.equal(obj.h, 128);
  assert.ok(Math.abs(obj.w / obj.h - GOLDEN_RATIO) < 1e-12);
  assert.deepEqual(context.editedIds, [obj.id]);
});

test('addText strips whitespace-only lines at pasted text edges', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, '  \n\t\nfirst line  \nsecond line\n   \n\t');

  const obj = context.added[0];
  assert.equal(obj.data.content, 'first line  \nsecond line');
  assert.deepEqual(context.editedIds, []);
});

test('addText keeps deterministic braced script text editable', () => {
  const context = loadAddTextHarness({ withTextLayout: true });

  context.addText(24, 48, 'e^{x^{2}+1}');

  const obj = context.added[0];
  assert.equal(obj.data.content, 'e^{x^{2}+1}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj.data.scriptRanges)), [
    { start: 2, end: 11, kind: 'sup' },
    { start: 5, end: 8, kind: 'sup' },
  ]);
  assert.deepEqual(context.editedIds, []);
});

test('outside clipboard text is pasted at the same center point as canvas objects', async () => {
  const context = loadPasteHarness();

  await context.pasteAtPos(640, 360, {
    getData(type) {
      return type === 'text/plain' ? 'outside text' : '';
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.addText)), [{
    wx: 640,
    wy: 360,
    content: 'outside text',
    options: { anchor: 'center' },
  }]);
});
