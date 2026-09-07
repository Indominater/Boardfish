'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const BoardTypes = require('../src/js/board_types.js');
const BoardSchema = require('../src/js/board_schema.js');
const BoardDocument = require('../src/js/board_document.js');
const WebContainer = require('../src/js/web_board_container.js');
const { normalizeTextContent } = BoardTypes;

test('text content preserves every printable ASCII character, tabs, and canonical newlines', () => {
  const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join('');
  assert.equal(normalizeTextContent(printable + '\t\n'), printable + '\t\n');
  assert.equal(normalizeTextContent('A\r\nB\rC\n\tD'), 'A\nB\nC\n\tD');
  const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join('') + '\x7F';
  assert.equal(normalizeTextContent(controls), '\t\n\n');
});

test('text content skips Unicode code points without transliteration or replacement spaces', () => {
  const mixed = 'café e\u0301 𝒂 Ａ ﬁ 😀中文\u00A0\u200B\u200D\uFEFF\u2028\u2029\uD800\uDC00';
  assert.equal(normalizeTextContent(mixed), 'caf e    ');
  assert.equal(normalizeTextContent('😀\r😀\r\n😀\nZ'), '\n\n\nZ');
  assert.equal(normalizeTextContent('\r😀\r😀'), '\n\n');
  assert.equal(normalizeTextContent(normalizeTextContent(mixed)), normalizeTextContent(mixed));
  assert.equal(normalizeTextContent(null), '');
});

test('schema filters unsupported imported content, drops empty textboxes, and retains plain formatting only', () => {
  const input = { objects: [
    { id: 'mixed', type: 'text', w: 300, h: 100, data: { content: 'entertainment 🌟🥰\r\n\tplain', font: 'serif', weight: 700 } },
    { id: 'empty', type: 'text', data: { content: '🌟🥰中文\u00A0\t\r\n' } },
  ] };
  const normalized = BoardSchema.normalizeBoardData(input);
  assert.deepEqual(normalized.objects.map((obj) => obj.id), ['mixed']);
  assert.deepEqual(normalized.objects[0].data, { content: 'entertainment \n\tplain' });
  assert.equal(input.objects[0].data.content, 'entertainment 🌟🥰\r\n\tplain');
  assert.equal(input.objects.length, 2, 'normalizing an opened board does not mutate the source document');
});

test('opening and saving legacy text through the board container uses the same ASCII representation', async () => {
  const original = { version: 3, format: 'boardfish-container', imageStore: {}, objects: [
    { id: 'legacy', type: 'text', w: 300, h: 100, data: { content: 'A😀B\r\nCéD\tE' } },
  ] };
  const fixture = await WebContainer.createBoardContainerBlob(original, {});
  const bytesBefore = new Uint8Array(await fixture.blob.arrayBuffer());
  const loaded = BoardSchema.normalizeBoardData((await WebContainer.readBoardContainer(fixture.blob)).board);
  assert.equal(loaded.objects[0].data.content, 'AB\nCD\tE');
  const saved = BoardDocument.createBoardDataForSave(loaded, { schema: BoardSchema });
  assert.equal(saved.objects[0].data.content, 'AB\nCD\tE');
  assert.deepEqual(new Uint8Array(await fixture.blob.arrayBuffer()), bytesBefore);
});

test('state insertion and replacement preserve objects normalized at board ingress', () => {
  const canonical = BoardSchema.normalizeBoardData({ objects: [
    { id: 'mixed', type: 'text', h: 80, data: { content: 'A😀\rB' } },
    { id: 'plain', type: 'text', h: 20, data: { content: 'AB' } },
  ] }).objects;
  const [mixed, plain] = canonical;
  assert.equal(mixed.data.content, 'A\nB');
  const layout = mixed._layoutCache = [];
  const scope = {
    objects: [], objectsMap: new Map(),
    normalizeTextContent() { assert.fail('canonical text does not need normalization'); },
    syncAllTextAutoHeights() { assert.fail('history dimensions must be preserved'); },
  };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(require.resolve('../src/js/editor_state_boundary.js'), 'utf8'), scope);
  assert.equal(scope.BoardfishEditorState.addObject(mixed), mixed);
  assert.equal(scope.objectsMap.get(mixed.id), mixed);
  scope.BoardfishEditorState.replaceBoardObjects([plain, mixed], { syncTextHeights: false });
  assert.deepEqual(scope.objects, [plain, mixed]);
  assert.equal(scope.objectsMap.get(plain.id), plain);
  assert.equal(scope.objectsMap.get(mixed.id), mixed);
  assert.equal(mixed._layoutCache, layout);
  assert.deepEqual(canonical.map(({ h }) => h), [80, 20]);
});
