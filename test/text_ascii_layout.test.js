'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/js/text_layout.js'), 'utf8');
const advance = (code) => code === 32 ? 4 : 4 + (code % 11) / 8;
const left = (code) => code % 3 / 8;
const right = (code) => advance(code) + code % 5 / 8;
const pairGap = (previous, next) => previous <= 32 || next <= 32 ? 0
  : Math.max(0, 0.5 - (advance(previous) - left(next) - right(previous)));

function load({ legacyTabs = false } = {}) {
  const scope = {
    fontScale: 1,
    measured: 0,
    document: {
      fonts: { status: 'loaded', check: () => true },
      createElement: () => ({ getContext: () => ({
        font: '',
        measureText(text) {
          scope.measured++;
          const code = text.charCodeAt(0);
          return {
            width: Array.from(text).reduce((sum, char) => sum + advance(char.charCodeAt(0)), 0) * scope.fontScale,
            actualBoundingBoxLeft: left(code) * scope.fontScale,
            actualBoundingBoxRight: right(code) * scope.fontScale,
            actualBoundingBoxAscent: 12,
            actualBoundingBoxDescent: 4,
          };
        },
      }) }),
    },
    navigator: { userAgent: 'Chrome/140.0.0.0' },
    objects: [],
    TextSelDebug: { _logHit() {} },
    scheduleRender() {},
  };
  vm.createContext(scope);
  vm.runInContext(source, scope);
  if (legacyTabs) {
    // The existing general algorithm is the compatibility oracle for the new
    // linear tab fitter; no copy of the new implementation is used here.
    vm.runInContext(`findAsciiTabWrapEndByWidth = (content, start, end, maxW) =>
      findTextWrapEndByWidth((from, to) => measureTextRangeW(content, from, to), start, end, maxW);`, scope);
  }
  vm.runInContext(`
    let prefixWork = 0;
    let pairLookups = 0;
    const originalPrefixWidths = getPrefixWidths;
    const originalPairSpacing = textGlyphPairSpacing;
    getPrefixWidths = (text) => { prefixWork += text.length; return originalPrefixWidths(text); };
    textGlyphPairSpacing = (...args) => { pairLookups++; return originalPairSpacing(...args); };
    globalThis.api = {
      getPrefixWidths, getTextLayout, getTextLayoutForLineRange, prepareTextLineForDraw,
      clearTextLayoutCaches,
      get prefixWork() { return prefixWork; },
      get pairLookups() { return pairLookups; },
      resetWork() { prefixWork = 0; pairLookups = 0; },
    };
  `, scope);
  return { api: scope.api, scope };
}

const object = (content, innerWidth = 120) => ({
  type: 'text', x: 30, y: 50, w: innerWidth + 32, h: 100, data: { content },
});
const comparable = (lines) => Array.from(lines, (line) => ({
  text: line.text, start: line.startIndex, end: line.endIndex,
  caretEnd: line.caretEndIndex, nextStart: line.nextStartIndex,
  logicalLine: line.logicalLineIndex, y: line.y, textY: line.textY,
  prefix: Array.from(line.prefixWidths),
}));

test('ASCII indexed metrics preserve every printable pair and remain warm beyond the general pair cache capacity', () => {
  const { api, scope } = load();
  const pairs = [];
  for (let previous = 32; previous <= 126; previous++) {
    for (let next = 32; next <= 126; next++) {
      const text = String.fromCharCode(previous, next);
      const spacing = pairGap(previous, next);
      assert.deepEqual(Array.from(api.getPrefixWidths(text)), [
        0, advance(previous) + spacing, advance(previous) + spacing + advance(next),
      ], text);
      pairs.push(text);
    }
  }
  api.getPrefixWidths('\t');
  const before = scope.measured;
  api.resetWork();
  api.getPrefixWidths(pairs.reverse().join('\t'));
  assert.equal(api.pairLookups, 0);
  assert.equal(scope.measured, before);
});

test('ASCII tables are invalidated when font measurements change', () => {
  const { api, scope } = load();
  const before = Array.from(api.getPrefixWidths('AV\tX'));
  scope.fontScale = 2;
  api.clearTextLayoutCaches({ measurements: true });
  const after = Array.from(api.getPrefixWidths('AV\tX'));
  assert.notDeepEqual(after, before);
  assert.equal(after[1], advance(65) * 2 + Math.max(0, 0.5 - (advance(65) - left(86) - right(65)) * 2));
  assert.equal(after[3], 64);
});

test('linear tab wrapping matches the existing general algorithm across whitespace, gaps, and narrow rows', () => {
  const current = load().api;
  const reference = load({ legacyTabs: true }).api;
  const contents = ['\t', '\t\t', 'A\tB', 'AV\tWW\tAV  ', '\tword '.repeat(20), 'word\t' + 'W'.repeat(160)];
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const alphabet = 'AVWYfj.,01   \t';
  for (let example = 0; example < 100; example++) {
    let content = '\t';
    for (let index = 0; index < 20 + random() % 160; index++) content += alphabet[random() % alphabet.length];
    contents.push(content);
  }
  for (const content of contents) {
    for (const width of [0.25, 4, 8.5, 16, 31.875, 32, 64.5, 127]) {
      assert.deepEqual(comparable(current.getTextLayout(object(content, width))),
        comparable(reference.getTextLayout(object(content, width))), `${JSON.stringify(content)} at ${width}`);
    }
  }
});

test('a tab in a large paragraph does not trigger repeated long substring measurement', () => {
  const { api } = load();
  const content = '\t' + 'alpha beta gamma delta '.repeat(900);
  const lines = api.getTextLayout(object(content, 800));
  assert.ok(lines.length > 100);
  assert.ok(api.prefixWork <= content.length * 3,
    `expected linear prefix work, visited ${api.prefixWork} characters for ${content.length} input characters`);
});

test('full editor layout preserves viewport row and draw-plan identities through a move', () => {
  const { api } = load();
  const obj = object('first row\n\nthird row\nfourth row', 120);
  const visible = api.getTextLayoutForLineRange(obj, 1, 2);
  const plan = api.prepareTextLineForDraw(visible[1]);
  obj.y += 99;
  const full = api.getTextLayout(obj);
  assert.equal(full[1], visible[0]);
  assert.equal(full[2], visible[1]);
  assert.equal(api.prepareTextLineForDraw(full[2]), plan);
  assert.equal(full[2].y, obj.y + 16 + 2 * 24);
  obj.data.content = 'changed row\n\nthird row\nfourth row';
  assert.notEqual(api.getTextLayout(obj)[2], visible[1]);
});
