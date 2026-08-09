'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const DEFAULT_TEXT_BOX_MIN_LINES = 1;
const DEFAULT_TEXT_BOX_LINE_H = 24;
const DEFAULT_TEXT_BOX_PAD = 16;
const DEFAULT_TEXT_BOX_HEIGHT = DEFAULT_TEXT_BOX_MIN_LINES * DEFAULT_TEXT_BOX_LINE_H + DEFAULT_TEXT_BOX_PAD * 2;

function loadAddTextHarness({ syncedHeight = null } = {}) {
  const textLayoutSource = fs.readFileSync(path.join(root, 'src/js/text_layout.js'), 'utf8') + '\n';
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
    debugSteps: [],
    editCalls: [],
    editedIds: [],
    histories: [],
    objects: [],
    renders: [],
    selectedIds: [],
    zCounter: 1,
    LINE_H: DEFAULT_TEXT_BOX_LINE_H,
    TEXT_PAD: DEFAULT_TEXT_BOX_PAD,
    NEW_TEXT_EDIT_MIN_LINES: DEFAULT_TEXT_BOX_MIN_LINES,
    BoardfishWebLimits: {
      canAddObjects() { return true; },
      canAcceptAdditionalContentBytes() { return true; },
      textByteLength(text) {
        context.textByteLengthCalls++;
        return String(text ?? '').length;
      },
    },
    BoardfishEditorState: {
      addObject(obj) {
        context.added.push(obj);
        return obj;
      },
    },
    ClipDebug: {
      step(_debug, step, meta) {
        context.debugSteps.push({ step, meta });
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
    testSyncTextAutoHeight(obj, minLines = 1) {
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
    enterEdit(id, options = {}) {
      context.editCalls.push({ id, options });
      context.editedIds.push(id);
      if (options.history !== false) context.pushHistory('text-edit-enter');
    },
    invalidateOffscreen() {},
    syncAllTextAutoHeights() {},
    textByteLengthCalls: 0,
  };
  vm.createContext(context);
  vm.runInContext(`${textLayoutSource}syncTextAutoHeight = testSyncTextAutoHeight;\n${source}\nglobalThis.addText = addText;\n`, context, {
    filename: 'object_commands.js',
  });
  return context;
}

function loadPasteHarness({ browserText = '', normalizeExternalText = (value) => value } = {}) {
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
    navigator: {
      clipboard: {
        readText() {
          return Promise.resolve(browserText);
        },
      },
    },
    objects: [],
    jsClipboard: null,
    _pasteInProgress: false,
    BoardfishClipboardIO: {
      describeClipboardData() { return {}; },
      readClipboardImageFileFromEvent() { return null; },
      readClipboardImageBlobFromBrowser() { return Promise.resolve(null); },
      readClipboardTextFromEvent(clipboardData) {
        return clipboardData?.getData?.('text/plain') || '';
      },
    },
    ClipDebug: {
      end() {},
      start() { return null; },
      step() {},
    },
    resizeCanvas() {},
    acquireInputShield() {
      return () => {};
    },
    addText(wx, wy, content, options = {}) {
      calls.addText.push({ wx, wy, content, options });
    },
    textForExternalTextObjectPaste(value) {
      return normalizeExternalText(value);
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
  assert.equal(context.textByteLengthCalls, 1);
});

test('addText keeps top-left placement by default', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48);

  const obj = context.added[0];
  assert.equal(obj.x, 24);
  assert.equal(obj.y, 48);
  assert.equal(obj.h, DEFAULT_TEXT_BOX_HEIGHT);
  assert.equal(obj.w, DEFAULT_TEXT_BOX_HEIGHT * 8);
  assert.deepEqual(context.editedIds, [obj.id]);
  assert.deepEqual(context.histories, ['text-edit-enter']);
});

test('addText retains full text diagnostics for an active debug capture', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, 'first\nsecond', { debug: {} });

  assert.equal(context.textByteLengthCalls, 8);
  assert.equal(context.debugSteps[0].step, 'addText:start');
  assert.equal(context.debugSteps[0].meta.textLineCount, 2);
});

test('addText strips whitespace-only lines at pasted text edges', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, '  \n\t\nfirst line  \nsecond line\n   \n\t');

  const obj = context.added[0];
  assert.equal(obj.data.content, 'first line  \nsecond line');
  assert.deepEqual(context.editedIds, []);
});

test('addText preserves content that the external-paste path already prepared', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, '  prepared  ', { contentPrepared: true });

  assert.equal(context.added[0].data.content, '  prepared  ');
});

test('addText with pasted content stays in select mode by default', () => {
  const context = loadAddTextHarness();

  context.addText(24, 48, 'pasted text');

  assert.deepEqual(context.editCalls, []);
});

test('addText keeps deterministic braced script text editable', () => {
  const context = loadAddTextHarness();

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
    options: { anchor: 'center', contentPrepared: true },
  }]);
});

test('browser clipboard text paste stays in select mode for the new text box', async () => {
  const context = loadPasteHarness({
    browserText: 'browser\ntext',
    normalizeExternalText(value) {
      return value.replace('\n', ' ');
    },
  });

  await context.pasteAtPos(640, 360, {
    getData() {
      return '';
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(context.calls.addText)), [{
    wx: 640,
    wy: 360,
    content: 'browser text',
    options: { anchor: 'center', contentPrepared: true },
  }]);
});

test('outside clipboard text is normalized before creating a text box', async () => {
  const context = loadPasteHarness({
    normalizeExternalText(value) {
      return value.replace('\n', ' ');
    },
  });

  await context.pasteAtPos(640, 360, {
    getData(type) {
      return type === 'text/plain' ? 'wrapped prose\ncontinues here' : '';
    },
  });

  assert.equal(context.calls.addText[0].content, 'wrapped prose continues here');
});
