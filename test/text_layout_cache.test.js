'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = (value) => JSON.parse(JSON.stringify(value));

function loadTextLayout({
  measureWidth = (text) => String(text).length,
  measureTextMetrics = null,
  fontStatus = 'loaded',
  fontCheck = () => true,
  userAgent = 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
  trackSegmenter = false,
} = {}) {
  const measured = [];
  const segmented = [];
  const context = {
    document: {
      fonts: {
        status: fontStatus,
        check: fontCheck,
      },
      createElement() {
        return {
          getContext() {
            return {
              font: '',
              textBaseline: '',
              measureText(text) {
                const value = String(text);
                measured.push(value);
                const width = measureWidth.call(this, value);
                const extra = measureTextMetrics
                  ? measureTextMetrics.call(this, value, { width })
                  : {};
                return {
                  width,
                  actualBoundingBoxAscent: 12,
                  actualBoundingBoxDescent: 4,
                  ...extra,
                };
              },
            };
          },
        };
      },
    },
    navigator: { userAgent },
    objects: [],
    TextSelDebug: {
      _logHit() {},
    },
    invalidateOffscreen() {},
    scheduleRender() {},
    syncAllTextAutoHeights() {},
  };
  if (trackSegmenter) {
    const NativeSegmenter = Intl.Segmenter;
    context.Intl = {
      Segmenter: class TrackedSegmenter {
        constructor(...args) {
          this.segmenter = new NativeSegmenter(...args);
        }

        segment(value) {
          segmented.push(String(value));
          return this.segmenter.segment(value);
        }
      },
    };
  }
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'text_layout.js'), 'utf8'),
    context,
    { filename: 'text_layout.js' },
  );
  vm.runInContext(
    `globalThis.__testTextLayout = {
      measureTextW,
      textForExternalTextObjectPaste,
      getTextMinWidth,
      getTextLayout,
      getTextLayoutForViewport,
      getTextLayoutForLineRange,
      getTextAutoHeight,
      getTextRenderedContentWidth,
      syncTextAutoHeight,
      prewarmTextObjectLayoutRuntimeCaches,
      applyTextLineAlignmentRange,
      patchTextObjectLayoutAfterInput,
      clearTextLayoutCaches,
      clearTextObjectLayoutRuntime,
      drawTextLineRange,
      lineCaretXAtOffset,
      lineXAtOffset,
      layoutHitTestCaret,
      spacingUnits(value, start = 0, end = null) {
        const units = [];
        forEachTextSpacingUnit(value, (unit, unitStart, unitEnd) => {
          units.push({ unit, start: unitStart, end: unitEnd });
        }, start, end);
        return units;
      },
      glyphPairSpacing(previous, next, font) {
        return textGlyphPairSpacing(previous, next, font);
      },
      hasGlyphPairSpacing(previous, next, font = FONT) {
        return _glyphPairSpacingCache.has(textGlyphPairSpacingCacheKey(previous, next, font));
      },
      cloneTextObjectRuntimeCaches,
      paragraphPrefixCacheSize(obj) { return obj?._textParagraphPrefixCache?.size || 0; },
      hasObjectLayoutCache(obj) { return Array.isArray(obj?._layoutCache); },
      wrappedLineCountCacheValue(obj) { return obj?._textWrappedLineCountCacheValue || 0; },
      wrappedLineIndexCacheSize(obj) { return obj?._textWrappedLineIndexCache?.entries?.length || 0; },
      wrappedLineIndexWidthCacheSize(obj) { return obj?._textWrappedLineIndexWidthCache?.size || 0; },
      viewportRangeCacheSize(obj) { return obj?._textViewportLayoutRangeCache?.size || 0; },
      viewportLineCacheSize(obj) { return obj?._textViewportLayoutLineCache?.size || 0; },
      get cache() { return _mwCache; },
      get prefixCacheSize() { return _prefixCache.size; },
      get tabStopWidthCache() { return _textTabStopWidth; },
      get glyphPairSpacingCacheSize() { return _glyphPairSpacingCache.size; },
      get glyphPairSpacingCacheMaxEntries() { return TEXT_GLYPH_PAIR_SPACING_CACHE_MAX_ENTRIES; },
      maxEntries: TEXT_MEASURE_CACHE_MAX_ENTRIES,
    };`,
    context,
    { filename: 'text_layout_cache_test_hook.js' },
  );
  return { context, measured, segmented };
}

test('ASCII spacing units bypass Intl.Segmenter without changing grapheme boundaries', () => {
  const { context, segmented } = loadTextLayout({ trackSegmenter: true });
  const units = context.__testTextLayout.spacingUnits('skip\r\nASCII', 4);

  assert.deepEqual(plain(units), [
    { unit: '\r\n', start: 4, end: 6 },
    { unit: 'A', start: 6, end: 7 },
    { unit: 'S', start: 7, end: 8 },
    { unit: 'C', start: 8, end: 9 },
    { unit: 'I', start: 9, end: 10 },
    { unit: 'I', start: 10, end: 11 },
  ]);
  assert.deepEqual(segmented, []);
});

test('ASCII spacing-unit fast path matches native grapheme segmentation across ranges', () => {
  const { context } = loadTextLayout();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let state = 0x12345678;
  const random = (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
  const alphabet = 'AaZz09 \t\n\r!_^-[]{}';

  for (let sample = 0; sample < 120; sample++) {
    let value = '';
    const length = 1 + random(80);
    for (let i = 0; i < length; i++) value += alphabet[random(alphabet.length)];
    const start = random(value.length + 1);
    const end = start + random(value.length - start + 1);
    const expected = Array.from(segmenter.segment(value.slice(start, end)), (segment) => ({
      unit: segment.segment,
      start: start + segment.index,
      end: start + segment.index + segment.segment.length,
    }));

    assert.deepEqual(plain(context.__testTextLayout.spacingUnits(value, start, end)), expected);
  }
});

test('Unicode spacing units retain Intl grapheme segmentation and callback indices', () => {
  const { context, segmented } = loadTextLayout({ trackSegmenter: true });
  const value = 'xA\u0301👨‍👩‍👧‍👦1\uFE0F\u20E3z';
  const units = context.__testTextLayout.spacingUnits(value, 1, value.length - 1);

  assert.deepEqual(plain(units), [
    { unit: 'A\u0301', start: 1, end: 3 },
    { unit: '👨‍👩‍👧‍👦', start: 3, end: 14 },
    { unit: '1\uFE0F\u20E3', start: 14, end: 17 },
  ]);
  assert.deepEqual(segmented, [value.slice(1, -1)]);
});

test('ASCII fast path preserves exact wrapped layout and auto-height', () => {
  const { context, segmented } = loadTextLayout({ trackSegmenter: true });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'ascii-fast-layout',
    type: 'text',
    x: 10,
    y: 20,
    w: context.TEXT_PAD * 2 + 12,
    h: 1,
    data: { content: 'alpha beta gamma\n1234  5678' },
  };

  const layout = textLayout.getTextLayout(obj);
  const height = textLayout.getTextAutoHeight(obj);

  assert.deepEqual(plain(layout.map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
    logicalLineIndex: line.logicalLineIndex,
    y: line.y,
    textY: line.textY,
    prefixWidths: Array.from(line.prefixWidths),
  }))), [
    { text: 'alpha beta', startIndex: 0, endIndex: 10, caretEndIndex: 11, nextStartIndex: 11, logicalLineIndex: 0, y: 36, textY: 52, prefixWidths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { text: 'gamma', startIndex: 11, endIndex: 16, caretEndIndex: 16, nextStartIndex: 16, logicalLineIndex: 0, y: 60, textY: 76, prefixWidths: [0, 1, 2, 3, 4, 5] },
    { text: '1234  5678', startIndex: 17, endIndex: 27, caretEndIndex: 27, nextStartIndex: 27, logicalLineIndex: 1, y: 84, textY: 100, prefixWidths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ]);
  assert.equal(height, context.TEXT_PAD * 2 + context.LINE_H * 3);
  assert.deepEqual(segmented, []);
});

test('glyph-pair spacing cache preserves exact spacing and reuses measured metrics', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length * 10;
    },
    measureTextMetrics(text, { width }) {
      if (text === 'Y') {
        return { actualBoundingBoxLeft: 0, actualBoundingBoxRight: width };
      }
      return {};
    },
  });
  const textLayout = context.__testTextLayout;
  const before = measured.length;

  const cold = textLayout.glyphPairSpacing('Y', 'Y');
  const afterCold = measured.length;
  const warm = textLayout.glyphPairSpacing('Y', 'Y');

  assert.equal(cold, 0.5);
  assert.equal(warm, cold);
  assert.equal(afterCold, before + 1);
  assert.equal(measured.length, afterCold);
  assert.equal(textLayout.glyphPairSpacingCacheSize, 1);
  assert.equal(textLayout.glyphPairSpacing('', 'Y'), 0);
  assert.equal(textLayout.glyphPairSpacing(' ', 'Y'), 0);
  assert.equal(textLayout.glyphPairSpacingCacheSize, 1);
});

test('ASCII glyph-pair cache keeps default-font numeric keys isolated by font', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length * 10;
    },
    measureTextMetrics(_text, { width }) {
      return {
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: this.font === 'custom-font' ? width - 2 : width,
      };
    },
  });
  const textLayout = context.__testTextLayout;

  assert.equal(textLayout.glyphPairSpacing('Y', 'Y'), 0.5);
  assert.equal(textLayout.glyphPairSpacing('Y', 'Y', 'custom-font'), 0);
  assert.equal(textLayout.hasGlyphPairSpacing('Y', 'Y'), true);
  assert.equal(textLayout.hasGlyphPairSpacing('Y', 'Y', 'custom-font'), true);
  assert.equal(textLayout.glyphPairSpacingCacheSize, 2);
});

test('glyph-pair spacing cache is bounded, evicts oldest entries, and clears with measurements', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const max = textLayout.glyphPairSpacingCacheMaxEntries;

  textLayout.glyphPairSpacing('first', 'pair');
  assert.equal(textLayout.hasGlyphPairSpacing('first', 'pair'), true);
  for (let i = 0; i < max; i++) textLayout.glyphPairSpacing(`left-${i}`, `right-${i}`);

  assert.equal(textLayout.glyphPairSpacingCacheSize, max);
  assert.equal(textLayout.hasGlyphPairSpacing('first', 'pair'), false);
  const sizeBeforeReinsert = textLayout.glyphPairSpacingCacheSize;
  textLayout.glyphPairSpacing('first', 'pair');
  assert.equal(textLayout.glyphPairSpacingCacheSize, sizeBeforeReinsert);
  assert.equal(textLayout.hasGlyphPairSpacing('first', 'pair'), true);

  textLayout.clearTextLayoutCaches({ measurements: true });
  assert.equal(textLayout.glyphPairSpacingCacheSize, 0);
});

test('text measurement cache evicts oldest entry without changing cache size', () => {
  const { context, measured } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const initialMeasures = measured.length;

  assert.equal(textLayout.measureTextW('k0'), 2);
  assert.equal(textLayout.measureTextW('k0'), 2);
  assert.equal(measured.length, initialMeasures + 2);

  for (let i = 1; i < textLayout.maxEntries; i++) {
    textLayout.measureTextW(`k${i}`);
  }
  assert.equal(textLayout.cache.size, textLayout.maxEntries);

  textLayout.measureTextW('overflow');

  assert.equal(textLayout.cache.size, textLayout.maxEntries);
  assert.equal(textLayout.cache.has('k0'), false);
  assert.equal(textLayout.cache.has('k1'), true);
  assert.equal(textLayout.cache.has('overflow'), true);
});

test('text measurement cache clears with other measurement caches', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;

  textLayout.measureTextW('cached');
  assert.equal(textLayout.cache.size, 1);

  textLayout.clearTextLayoutCaches({ measurements: true });

  assert.equal(textLayout.cache.size, 0);
});

test('tab-stop width is reused until measurement caches clear', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;

  assert.equal(textLayout.tabStopWidthCache, undefined);
  textLayout.measureTextW('\t');
  textLayout.measureTextW('a\t');
  assert.equal(textLayout.tabStopWidthCache, 8);
  textLayout.clearTextLayoutCaches({ measurements: true });
  assert.equal(textLayout.tabStopWidthCache, undefined);
  textLayout.measureTextW('\t');
  assert.equal(textLayout.tabStopWidthCache, 8);
});

test('text measurement uses single-glyph advances for consistent spacing', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      if (text === 'YY' || text === 'XY' || text === 'XX') return 1;
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const initialMeasures = measured.length;

  assert.equal(textLayout.measureTextW('YY'), 2);
  assert.equal(textLayout.measureTextW('XY'), 2);
  assert.equal(textLayout.measureTextW('XX'), 2);

  assert.ok(!measured.slice(initialMeasures).includes('YY'));
  assert.ok(!measured.slice(initialMeasures).includes('XY'));
  assert.ok(!measured.slice(initialMeasures).includes('XX'));
});

test('text layout adds a small advance when neighboring glyph ink would touch', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length * 10;
    },
    measureTextMetrics(text, { width }) {
      if (text === 'Y') {
        return {
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: width,
        };
      }
      return {};
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'YY' },
  };
  const [line] = textLayout.getTextLayout(obj);
  const calls = [];

  assert.equal(textLayout.measureTextW('YY'), 20.5);
  assert.equal(textLayout.lineXAtOffset(line, obj, 1), 26.5);
  assert.equal(textLayout.lineXAtOffset(line, obj, 2), 36.5);

  textLayout.drawTextLineRange({
    font: '',
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
  }, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['Y', 'Y']);
  assert.deepEqual(calls.map((call) => call.x), [context.TEXT_PAD, context.TEXT_PAD + 10.5]);
});

test('text drawing places each glyph at measured prefix positions', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'a->b c<-d' },
  };
  const [line] = textLayout.getTextLayout(obj);
  const calls = [];

  const stats = textLayout.drawTextLineRange({
    font: '',
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
  }, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['a', '-', '>', 'b', 'c', '<', '-', 'd']);
  assert.deepEqual(
    calls.map((call) => call.x),
    [0, 1, 2, 3, 5, 6, 7, 8].map((offset) => obj.x + context.TEXT_PAD + line.prefixWidths[offset]),
  );
  assert.equal(stats.chars, 9);
  assert.equal(stats.drawnChars, 8);
  assert.equal(stats.drawUnits, 8);
  assert.equal(stats.drawCalls, 8);
  assert.equal(stats.runs, 1);
  assert.equal(stats.skippedTabs, 0);
  assert.equal(stats.skippedSpaces, 1);
  assert.equal(stats.planCacheHits, 0);
  assert.equal(stats.planCacheMisses, 1);

  calls.length = 0;
  const cachedStats = textLayout.drawTextLineRange({
    font: '',
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
  }, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['a', '-', '>', 'b', 'c', '<', '-', 'd']);
  assert.equal(cachedStats.drawUnits, 8);
  assert.equal(cachedStats.drawCalls, 8);
  assert.equal(cachedStats.skippedSpaces, 1);
  assert.equal(cachedStats.planCacheHits, 1);
  assert.equal(cachedStats.planCacheMisses, 0);
});

test('text drawing ignores stale fast requests and preserves measured positions', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-fast-pan',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'a->b c<-d' },
  };
  const [line] = textLayout.getTextLayout(obj);
  const calls = [];

  const stats = textLayout.drawTextLineRange({
    font: '',
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
  }, line, obj, 0, line.text.length, { fast: true });

  assert.deepEqual(calls.map((call) => call.text), ['a', '-', '>', 'b', 'c', '<', '-', 'd']);
  assert.deepEqual(
    calls.map((call) => call.x),
    [0, 1, 2, 3, 5, 6, 7, 8].map((offset) => obj.x + context.TEXT_PAD + line.prefixWidths[offset]),
  );
  assert.equal(stats.drawUnits, 8);
  assert.equal(stats.drawCalls, 8);
  assert.equal(stats.runs, 1);
  assert.equal(stats.skippedSpaces, 1);
});

test('text drawing batches pixel-equivalent plain ASCII spans only', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-batched-ascii',
    type: 'text',
    x: 0,
    y: 0,
    w: 240,
    h: 40,
    data: { content: 'Boardfish 123 café' },
  };
  const [line] = textLayout.getTextLayout(obj);
  const calls = [];

  const stats = textLayout.drawTextLineRange({
    font: '',
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
  }, line, obj);

  assert.deepEqual(calls.map((call) => call.text), ['Bo', 'ar', 'd', 'f', 'is', 'h', '12', '3', 'ca', 'f', 'é']);
  assert.deepEqual(
    calls.map((call) => call.x),
    [0, 2, 4, 5, 6, 8, 10, 12, 14, 16, 17].map((offset) => obj.x + context.TEXT_PAD + line.prefixWidths[offset]),
  );
  assert.equal(stats.drawUnits, 16);
  assert.equal(stats.drawCalls, 11);
});

test('text drawing splits the Geist contextual tt pair', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-tt-ligature',
    type: 'text',
    x: 0,
    y: 0,
    w: 120,
    h: 40,
    data: { content: 'letter' },
  };
  const [line] = textLayout.getTextLayout(obj);
  const calls = [];

  const stats = textLayout.drawTextLineRange({
    font: '',
    fillText(text) {
      calls.push(text);
    },
  }, line, obj);

  assert.deepEqual(calls, ['le', 't', 'te', 'r']);
  assert.equal(stats.drawUnits, 6);
  assert.equal(stats.drawCalls, 4);
});

test('text drawing keeps the exact per-grapheme path for fallback fonts and unverified engines', () => {
  for (const options of [
    { fontStatus: 'loading' },
    { fontCheck: () => false },
    { userAgent: 'Mozilla/5.0 Firefox/142.0' },
  ]) {
    const { context } = loadTextLayout(options);
    const textLayout = context.__testTextLayout;
    const obj = {
      id: 'text-unverified-font',
      type: 'text',
      x: 0,
      y: 0,
      w: 120,
      h: 40,
      data: { content: 'Board' },
    };
    const [line] = textLayout.getTextLayout(obj);
    const calls = [];

    const stats = textLayout.drawTextLineRange({
      font: '',
      fillText(text) { calls.push(text); },
    }, line, obj);

    assert.deepEqual(calls, ['B', 'o', 'a', 'r', 'd']);
    assert.equal(stats.drawCalls, 5);
  }
});

test('text minimum width uses the widest rendered word, not character count', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => {
        if (ch === 'W') return sum + 12;
        if (ch === 'i') return sum + 2;
        if (ch === ' ') return sum + 4;
        return sum + 6;
      }, 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'iiiiiiii WWW' },
  };

  assert.equal(textLayout.getTextMinWidth(obj), 69);
});

test('text minimum width includes leading indentation before the first word', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => sum + (ch === ' ' ? 4 : 6), 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'Boardfish\n    Boardfish indentation example' },
  };

  assert.equal(textLayout.getTextMinWidth(obj), 103);
});

test('text minimum width treats spaces between words as separators', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => sum + (ch === ' ' ? 4 : 6), 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 240,
    h: 40,
    data: { content: 'short      coordinate x\n        pixel y' },
  };

  assert.equal(textLayout.getTextMinWidth(obj), 95);
});

test('text minimum width builds prefix widths once per logical line', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const lines = Array.from({ length: 40 }, (_, index) => `indent ${index} unique-word-${index}`);
  const obj = {
    id: 'text-min-width-prefix-cache',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: lines.join('\n') },
  };

  assert.ok(textLayout.getTextMinWidth(obj) > 0);

  assert.ok(textLayout.prefixCacheSize <= lines.length);
});

test('cloned text runtime caches preserve cached minimum width', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const source = {
    id: 'source',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'alpha beta\n    wideword' },
  };
  const target = {
    id: 'target',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: source.data.content },
  };
  const width = textLayout.getTextMinWidth(source);
  const layout = textLayout.getTextLayout(source);
  layout[0]._textDrawPlanCache = {};
  source._textWrappedLineIndexCacheContent = source.data.content;
  source._textWrappedLineIndexCacheW = source.w;
  source._textWrappedLineIndexCache = { lineCount: 2, entries: [{ start: 0, end: 10 }] };
  const prefixCacheSize = textLayout.prefixCacheSize;

  textLayout.cloneTextObjectRuntimeCaches(source, target);

  assert.equal(target._textMinWidthCache, source._textMinWidthCache);
  assert.equal(target._textWrappedLineIndexCache, source._textWrappedLineIndexCache);
  assert.equal('_textDrawPlanCache' in target._layoutCache[0], false);
  assert.equal(textLayout.getTextMinWidth(target), width);
  assert.equal(textLayout.prefixCacheSize, prefixCacheSize);
});

test('soft wrap after a full-width word consumes separator spaces', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 'indominatoer'.length + context.TEXT_PAD * 2,
    h: 40,
    data: { content: 'indominatoer hi' },
  };

  const lines = textLayout.getTextLayout(obj).map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
  }));

  assert.deepEqual(plain(lines), [
    { text: 'indominatoer', startIndex: 0, endIndex: 12, caretEndIndex: 13, nextStartIndex: 13 },
    { text: 'hi', startIndex: 13, endIndex: 15, caretEndIndex: 15, nextStartIndex: 15 },
  ]);
});

test('caret range stays on the current line for trailing overflow spaces', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 'indominater'.length + context.TEXT_PAD * 2,
    h: 40,
    data: { content: 'indominater    \nhi' },
  };

  const lines = textLayout.getTextLayout(obj).map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
  }));

  assert.deepEqual(plain(lines), [
    { text: 'indominater', startIndex: 0, endIndex: 11, caretEndIndex: 15, nextStartIndex: 15 },
    { text: 'hi', startIndex: 16, endIndex: 18, caretEndIndex: 18, nextStartIndex: 18 },
  ]);
});

test('trailing overflow spaces keep the last fitting spaces on the caret line', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 'hi  '.length + context.TEXT_PAD * 2,
    h: 40,
    data: { content: 'hi     \nnext' },
  };

  const lines = textLayout.getTextLayout(obj).map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
  }));

  assert.deepEqual(plain(lines), [
    { text: 'hi  ', startIndex: 0, endIndex: 4, caretEndIndex: 7, nextStartIndex: 7 },
    { text: 'next', startIndex: 8, endIndex: 12, caretEndIndex: 12, nextStartIndex: 12 },
  ]);
});

test('text rendered content width uses the visible line width', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return [...String(text)].reduce((sum, ch) => sum + (ch === 'H' ? 10 : ch === 'i' ? 3 : 5), 0);
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 80,
    data: { content: 'Hi' },
  };

  assert.equal(textLayout.getTextRenderedContentWidth(obj), 46);
});

test('line alignment offsets caret positions within the text box', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 10,
    y: 0,
    w: 44,
    h: 40,
    data: { content: 'abcd' },
  };

  let [line] = textLayout.getTextLayout(obj);
  assert.equal(textLayout.lineXAtOffset(line, obj, 0), 26);

  assert.equal(textLayout.applyTextLineAlignmentRange(obj, 0, 0, 'right'), true);
  [line] = textLayout.getTextLayout(obj);
  assert.equal(line.align, 'center');
  assert.equal(textLayout.lineXAtOffset(line, obj, 0), 30);

  assert.equal(textLayout.applyTextLineAlignmentRange(obj, 0, 0, 'right'), true);
  [line] = textLayout.getTextLayout(obj);
  assert.equal(line.align, 'right');
  assert.equal(textLayout.lineXAtOffset(line, obj, 0), 34);

  obj.data.lineAlign = ['center'];
  assert.equal(textLayout.getTextLayout(obj)[0].align, 'center');
});

test('text caret x centers between neighboring glyph ink bounds', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length * 10;
    },
    measureTextMetrics(text, { width }) {
      if (text === 'X') {
        return {
          actualBoundingBoxLeft: -4,
          actualBoundingBoxRight: 9,
        };
      }
      return {
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
      };
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'YX' },
  };

  const [line] = textLayout.getTextLayout(obj);

  assert.equal(textLayout.lineXAtOffset(line, obj, 1), 26);
  assert.equal(textLayout.lineCaretXAtOffset(line, obj, 1), 28);
  assert.equal(textLayout.lineCaretXAtOffset(line, obj, 0), 16);
  assert.equal(textLayout.lineCaretXAtOffset(line, obj, 2), 36);
});

test('text caret x keeps logical positions next to whitespace', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length * 10;
    },
    measureTextMetrics(text, { width }) {
      if (text === 'X') {
        return {
          actualBoundingBoxLeft: -4,
          actualBoundingBoxRight: 9,
        };
      }
      return {
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
      };
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    data: { content: 'Y X' },
  };

  const [line] = textLayout.getTextLayout(obj);

  assert.equal(textLayout.lineCaretXAtOffset(line, obj, 1), textLayout.lineXAtOffset(line, obj, 1));
  assert.equal(textLayout.lineCaretXAtOffset(line, obj, 2), textLayout.lineXAtOffset(line, obj, 2));
});

test('text caret x advances through consumed soft-wrap spaces', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const obj = {
    id: 'text-1',
    type: 'text',
    x: 0,
    y: 0,
    w: 'hi  '.length + context.TEXT_PAD * 2,
    h: 40,
    data: { content: 'hi     \nnext' },
  };

  const [line] = textLayout.getTextLayout(obj);

  assert.equal(line.text, 'hi  ');
  assert.equal(line.caretEndIndex, 7);
  assert.equal(textLayout.lineCaretXAtOffset(line, obj, 5), obj.x + context.TEXT_PAD + 5);
  assert.equal(textLayout.lineCaretXAtOffset(line, obj, 7), obj.x + context.TEXT_PAD + 7);
});

test('large plain text layout uses bounded measurement work', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 3000 }, (_, index) => `word${index}`).join(' ');
  const obj = {
    id: 'large-text',
    type: 'text',
    x: 0,
    y: 0,
    w: 360,
    h: 40,
    data: { content },
  };
  const before = measured.length;

  const layout = textLayout.getTextLayout(obj);
  const coldMeasureCount = measured.length - before;

  assert.ok(layout.length > 50);
  assert.ok(
    coldMeasureCount < content.length / 2,
    `expected bounded measurement work, got ${coldMeasureCount} calls for ${content.length} chars`,
  );
  assert.equal(Object.hasOwn(layout[0], 'content'), false);
});

test('large text insertion patches cached layout instead of rebuilding every line', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const oldContent = Array.from(
    { length: 220 },
    (_, index) => `line ${index} alpha beta gamma delta epsilon zeta eta theta`,
  ).join('\n');
  const obj = {
    id: 'large-incremental-layout',
    type: 'text',
    x: 0,
    y: 0,
    w: 26 + context.TEXT_PAD * 2,
    h: 40,
    data: { content: oldContent },
  };
  textLayout.getTextLayout(obj);
  const beforePatchMeasures = measured.length;
  const insertAt = oldContent.indexOf('gamma', oldContent.indexOf('line 110'));
  const insertedText = 'inserted words\nwith another wrapped line ';
  const newContent = `${oldContent.slice(0, insertAt)}${insertedText}${oldContent.slice(insertAt)}`;
  obj.data.content = newContent;

  assert.equal(textLayout.patchTextObjectLayoutAfterInput(obj, {
    oldContent,
    newContent,
    start: insertAt,
    end: insertAt,
    insertedText,
  }), true);

  const patchedLayout = textLayout.getTextLayout(obj);
  const patchMeasureCount = measured.length - beforePatchMeasures;
  const fresh = {
    id: 'large-incremental-layout-fresh',
    type: 'text',
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    data: { content: newContent },
  };
  const freshLayout = textLayout.getTextLayout(fresh);
  const comparable = (layout) => layout.map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
    logicalLineIndex: line.logicalLineIndex,
    y: line.y,
    textY: line.textY,
    align: line.align,
  }));

  assert.ok(patchedLayout.length > 300);
  assert.deepEqual(comparable(patchedLayout), comparable(freshLayout));
  assert.ok(
    patchMeasureCount < 160,
    `expected incremental patch to measure only affected lines, got ${patchMeasureCount}`,
  );
});

test('blank line deletion patches cached layout to match a fresh layout', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length * 10;
    },
  });
  const textLayout = context.__testTextLayout;
  const oldContent = 'line 1\n  \nline 2';
  const newContent = 'line 1\nline 2';
  const obj = {
    id: 'blank-line-delete-layout',
    type: 'text',
    x: 0,
    y: 0,
    w: 800,
    h: 80,
    data: { content: oldContent },
  };
  textLayout.getTextLayout(obj);
  obj.data.content = newContent;

  assert.equal(textLayout.patchTextObjectLayoutAfterInput(obj, {
    oldContent,
    newContent,
    start: 7,
    end: 10,
    insertedText: '',
  }), true);

  const patchedLayout = textLayout.getTextLayout(obj);
  const fresh = {
    id: 'blank-line-delete-layout-fresh',
    type: 'text',
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    data: { content: newContent },
  };
  const freshLayout = textLayout.getTextLayout(fresh);
  const comparable = (layout) => layout.map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
    logicalLineIndex: line.logicalLineIndex,
    y: line.y,
  }));

  assert.deepEqual(comparable(patchedLayout), comparable(freshLayout));
  assert.deepEqual(plain(comparable(patchedLayout)), [
    { text: 'line 1', startIndex: 0, endIndex: 6, caretEndIndex: 6, nextStartIndex: 6, logicalLineIndex: 0, y: context.TEXT_PAD },
    { text: 'line 2', startIndex: 7, endIndex: 13, caretEndIndex: 13, nextStartIndex: 13, logicalLineIndex: 1, y: context.TEXT_PAD + context.LINE_H },
  ]);
});

test('large plain text wrapping consumes separator spaces between wrapped words', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = `${'alpha '.repeat(90)}omega`;
  const obj = {
    id: 'large-wrap-spaces',
    type: 'text',
    x: 0,
    y: 0,
    w: 'alpha'.length + context.TEXT_PAD * 2,
    h: 40,
    data: { content },
  };

  const layout = textLayout.getTextLayout(obj);

  assert.ok(layout.length > 80);
  assert.equal(layout.at(-1).text, 'omega');
  assert.ok(layout.slice(1).every((line) => !line.text.startsWith(' ')));
  assert.ok(layout.every((line) => line.text.length > 0));
});

test('large plain text wrapping keeps fitting trailing spaces on the caret line', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = 'hi     '.repeat(80);
  const obj = {
    id: 'large-wrap-trailing-spaces',
    type: 'text',
    x: 0,
    y: 0,
    w: 'hi  '.length + context.TEXT_PAD * 2,
    h: 40,
    data: { content },
  };

  const lastLine = textLayout.getTextLayout(obj).at(-1);

  assert.equal(lastLine.text, 'hi  ');
  assert.equal(lastLine.caretEndIndex, content.length);
  assert.equal(lastLine.nextStartIndex, content.length);
});

test('external prose paste is unwrapped before resized layout repacks every line greedily', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const source = [
    'As a Combined Major in Computer Science and Mathematics at UBC, I believe that my',
    'previous internships in QA, along with my development of high-complexity software',
    'such as Rust-backed Boardfish and Python-based automation suites, provide me with',
    'a strong skill set that aligns well with this position. Additionally, as a hobbyist',
    'swimmer who uses prescription goggles, I understand the need for accuracy and',
    'reliability in aquatics products and would love to contribute to developing',
    "FORM's AR technology.",
  ].join('\n');
  const content = textLayout.textForExternalTextObjectPaste(source);
  const obj = {
    id: 'large-wrap-resize',
    type: 'text',
    x: 0,
    y: 0,
    w: context.TEXT_PAD * 2 + 32,
    h: 1,
    data: { content },
  };

  assert.equal(content.includes('\n'), false);
  textLayout.syncTextAutoHeight(obj);
  textLayout.getTextLayoutForViewport(obj, { y1: 0, y2: obj.h });
  obj.w = context.TEXT_PAD * 2 + 78;
  textLayout.syncTextAutoHeight(obj);

  const resized = textLayout.getTextLayoutForViewport(obj, { y1: 0, y2: obj.h });
  const fresh = {
    ...obj,
    id: 'large-wrap-resize-fresh',
    data: { content },
  };
  const expected = textLayout.getTextLayout(fresh);

  assert.deepEqual(
    plain(resized.map((line) => line.text)),
    plain(expected.map((line) => line.text)),
  );
  for (let index = 0; index < resized.length - 1; index++) {
    const nextWord = resized[index + 1].text.match(/^\S+/)?.[0] || '';
    assert.ok(
      `${resized[index].text} ${nextWord}`.length > 78,
      `line ${index} left avoidable room before "${nextWord}"`,
    );
  }

  const hyphenWrapped = [
    'This deliberately long fixed-width prose line carries an intentionally hyphen-',
    'wrapped compound into the next similarly sized source line with enough prose',
    'and finishes with a naturally short tail.',
  ].join('\n');
  assert.match(textLayout.textForExternalTextObjectPaste(hyphenWrapped), /hyphen-wrapped/);
});

test('external text paste preserves paragraphs and structured line breaks', () => {
  const { context } = loadTextLayout();
  const textLayout = context.__testTextLayout;
  const source = [
    'This deliberately long sentence has enough words to look like prose and ends here.',
    'Another sentence starts a separate intentional line.',
    '',
    'Tasks:',
    '- Keep the first item on its own line even when the item itself is deliberately long.',
    '- Keep the second item on its own line.',
    '',
    'Aaron Li',
    '123 Main Street',
    'Vancouver, BC',
    '',
    '    const result = calculateSomething();',
    '    return result;',
    '',
    'THIS LONG VERSE LINE STARTS WITH UPPERCASE AND SHOULD REMAIN VISUALLY DISTINCT',
    'ANOTHER LONG VERSE LINE STARTS WITH UPPERCASE AND SHOULD NOT BE JOINED TO IT',
    'THE FINAL LONG VERSE LINE ALSO STARTS WITH UPPERCASE AND STAYS ON ITS OWN LINE',
    '',
    'Name                 Role                 Location',
    'Aaron Li             Developer            Vancouver',
    'Jordan Smith         Designer             Toronto',
  ].join('\r\n');

  assert.equal(
    textLayout.textForExternalTextObjectPaste(`\r\n${source}\r\n`),
    source.replace(/\r\n/g, '\n'),
  );
});

test('moving a large text object reuses cached layout measurements', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 1200 }, (_, index) => `word${index}`).join(' ');
  const obj = {
    id: 'moving-text',
    type: 'text',
    x: 0,
    y: 0,
    w: 320,
    h: 40,
    data: { content },
  };

  const first = textLayout.getTextLayout(obj);
  const measuredAfterFirst = measured.length;
  const firstLineY = first[0].y;
  obj.y = 240;

  const second = textLayout.getTextLayout(obj);

  assert.equal(second, first);
  assert.equal(measured.length, measuredAfterFirst);
  assert.notEqual(second[0].y, firstLineY);
  assert.equal(second[0].y, obj.y + context.TEXT_PAD);
});

test('text auto-height reuses cached layout after wrapped-line cache is gone', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 1200 }, (_, index) => `word${index}`).join(' ');
  const obj = {
    id: 'auto-height-cache',
    type: 'text',
    x: 0,
    y: 0,
    w: 320,
    h: 1,
    data: { content },
  };
  const layout = textLayout.getTextLayout(obj);
  const measuredAfterLayout = measured.length;
  textLayout.clearTextLayoutCaches({ objectLayout: false });

  assert.equal(textLayout.syncTextAutoHeight(obj), true);

  assert.equal(obj.h, layout.length * context.LINE_H + context.TEXT_PAD * 2);
  assert.equal(measured.length, measuredAfterLayout);
});

test('text layout reuses prefix widths created while wrapping for auto-height', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');
  const obj = {
    id: 'layout-prefix-reuse',
    type: 'text',
    x: 0,
    y: 0,
    w: 120,
    h: 1,
    data: { content },
  };

  assert.equal(textLayout.syncTextAutoHeight(obj), true);
  const prefixCacheSizeAfterHeight = textLayout.prefixCacheSize;
  const layout = textLayout.getTextLayout(obj);

  assert.ok(layout.length > 1);
  assert.equal(textLayout.prefixCacheSize, prefixCacheSizeAfterHeight);
});

test('paragraph prefix cache survives layout clear during resize auto-height', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 40 }, (_, index) => `word token${index} tail`).join('\n');
  const obj = {
    id: 'prefix-clear',
    type: 'text',
    x: 0,
    y: 0,
    w: 96,
    h: 1,
    data: { content },
  };

  textLayout.getTextLayout(obj);
  const measuredAfterLayout = measured.length;
  const paragraphCacheSizeAfterLayout = textLayout.paragraphPrefixCacheSize(obj);
  obj.w = 104;
  textLayout.clearTextObjectLayoutRuntime(obj, { minWidth: false, prefix: false });

  assert.equal(textLayout.syncTextAutoHeight(obj), true);
  assert.equal(textLayout.paragraphPrefixCacheSize(obj), paragraphCacheSizeAfterLayout);
  assert.equal(measured.length, measuredAfterLayout);
});

test('auto-height keeps unwrapped logical lines exact without full layout cache', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 160 }, (_, index) => `line ${index} token${index} tail`).join('\n');
  const obj = {
    id: 'unwrapped-auto-height-count',
    type: 'text',
    x: 0,
    y: 0,
    w: 120,
    h: 1,
    data: { content },
  };

  assert.equal(textLayout.syncTextAutoHeight(obj), true);
  const count = textLayout.wrappedLineCountCacheValue(obj);
  const viewportLayout = textLayout.getTextLayoutForViewport(obj, { y1: 0, y2: context.LINE_H * 5 });

  assert.equal(count, 160);
  assert.equal(obj.h, 160 * context.LINE_H + context.TEXT_PAD * 2);
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
  assert.equal(viewportLayout.totalLines, 160);
  assert.deepEqual(plain(viewportLayout.slice(0, 3).map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    logicalLineIndex: line.logicalLineIndex,
    y: line.y,
  }))), [
    { text: 'line 0 token0 tail', startIndex: 0, logicalLineIndex: 0, y: context.TEXT_PAD },
    { text: 'line 1 token1 tail', startIndex: 19, logicalLineIndex: 1, y: context.TEXT_PAD + context.LINE_H },
    { text: 'line 2 token2 tail', startIndex: 38, logicalLineIndex: 2, y: context.TEXT_PAD + context.LINE_H * 2 },
  ]);
});

test('viewport text layout exactly matches inclusive visible-line boundaries', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 80 }, (_, index) => `line ${index} alpha beta gamma`).join('\n');
  const obj = {
    id: 'visible-layout',
    type: 'text',
    x: 0,
    y: -120,
    w: 36,
    h: 1,
    data: { content },
  };
  const full = textLayout.getTextLayout(obj);
  const viewportRect = { y1: 120, y2: 240 };
  const expected = full.filter((line) => line.y + context.LINE_H >= viewportRect.y1 && line.y <= viewportRect.y2);
  textLayout.clearTextObjectLayoutRuntime(obj, { minWidth: false, prefix: false });
  textLayout.syncTextAutoHeight(obj);

  const visible = textLayout.getTextLayoutForViewport(obj, viewportRect);

  assert.equal(visible.totalLines, full.length);
  assert.deepEqual(plain(visible.map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    y: line.y,
    prefixWidths: Array.from(line.prefixWidths || []),
  }))), plain(expected.map((line) => ({
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    y: line.y,
    prefixWidths: Array.from(line.prefixWidths || []),
  }))));
  const baseY = obj.y + context.TEXT_PAD;
  const epsilon = 0.001;
  for (const [y, lineYs] of [
    [baseY - epsilon, []],
    [baseY + context.LINE_H, [baseY, baseY + context.LINE_H]],
    [baseY + context.LINE_H + epsilon, [baseY + context.LINE_H]],
  ]) {
    const actual = textLayout.getTextLayoutForViewport(obj, { y1: y, y2: y });
    assert.deepEqual(plain(actual.map((line) => line.y)), lineYs);
  }
});

test('auto-height count cache also stores line index for viewport reuse', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 120 }, (_, index) => `word token${index} tail`).join('\n');
  const obj = {
    id: 'visible-layout-cache',
    type: 'text',
    x: 0,
    y: -400,
    w: 34 + context.TEXT_PAD * 2,
    h: 1,
    data: { content },
  };

  assert.equal(textLayout.syncTextAutoHeight(obj), true);
  const count = textLayout.wrappedLineCountCacheValue(obj);
  const indexEntriesBeforeViewport = textLayout.wrappedLineIndexCacheSize(obj);
  const visible = textLayout.getTextLayoutForViewport(obj, { y1: 0, y2: 120 });

  assert.ok(count > visible.length);
  assert.equal(indexEntriesBeforeViewport, 120);
  assert.equal(textLayout.wrappedLineIndexCacheSize(obj), 120);
  assert.equal(visible.totalLines, count);
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
  assert.ok(visible.length > 0);
});

test('auto-height reuses exact wrapped line index when resize revisits a width', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 120 }, (_, index) => `word token${index} tail`).join('\n');
  const obj = {
    id: 'revisited-width-auto-height',
    type: 'text',
    x: 0,
    y: 0,
    w: 34 + context.TEXT_PAD * 2,
    h: 1,
    data: { content },
  };

  assert.equal(textLayout.syncTextAutoHeight(obj), true);
  const firstHeight = obj.h;
  const firstLineCount = textLayout.wrappedLineCountCacheValue(obj);
  const measuredAfterFirst = measured.length;

  obj.w = 50 + context.TEXT_PAD * 2;
  textLayout.syncTextAutoHeight(obj);
  assert.equal(textLayout.wrappedLineIndexWidthCacheSize(obj), 2);
  assert.ok(measured.length >= measuredAfterFirst);

  obj.w = 34 + context.TEXT_PAD * 2;
  obj.h = 1;
  const measuredBeforeRevisit = measured.length;
  assert.equal(textLayout.syncTextAutoHeight(obj), true);

  assert.equal(obj.h, firstHeight);
  assert.equal(textLayout.wrappedLineCountCacheValue(obj), firstLineCount);
  assert.equal(textLayout.wrappedLineIndexWidthCacheSize(obj), 2);
  assert.equal(measured.length, measuredBeforeRevisit);
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
});

test('viewport layout still supports count-only auto-height cache without full line index', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 90 }, (_, index) => `line ${index} alpha beta`).join('\n');
  const obj = {
    id: 'count-only-visible-layout-cache',
    type: 'text',
    x: 0,
    y: -240,
    w: 34 + context.TEXT_PAD * 2,
    h: 90 * context.LINE_H + context.TEXT_PAD * 2,
    data: { content },
    _textWrappedLineCountCacheContent: content,
    _textWrappedLineCountCacheW: 34 + context.TEXT_PAD * 2,
    _textWrappedLineCountCacheValue: 90,
  };

  assert.equal(textLayout.wrappedLineIndexCacheSize(obj), 0);
  assert.equal(textLayout.syncTextAutoHeight(obj), false);
  assert.equal(textLayout.wrappedLineIndexCacheSize(obj), 0);
  const visible = textLayout.getTextLayoutForViewport(obj, { y1: 0, y2: 120 });
  assert.equal(visible.totalLines, 90);
  assert.ok(visible.length > 0);
  assert.equal(textLayout.wrappedLineIndexCacheSize(obj), 0);
  assert.ok(textLayout.viewportLineCacheSize(obj) >= visible.length);
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
});

test('runtime prewarm fills paragraph prefixes without full layout cache', () => {
  const { context, measured } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 90 }, (_, index) => `line ${index} alpha beta gamma`).join('\n');
  const obj = {
    id: 'runtime-prefix-prewarm',
    type: 'text',
    x: 0,
    y: -900,
    w: 34 + context.TEXT_PAD * 2,
    h: 90 * context.LINE_H + context.TEXT_PAD * 2,
    data: { content },
  };

  const prewarm = textLayout.prewarmTextObjectLayoutRuntimeCaches(obj);
  const secondPrewarm = textLayout.prewarmTextObjectLayoutRuntimeCaches(obj);
  const measuredAfterPrewarm = measured.length;
  const visible = textLayout.getTextLayoutForViewport(obj, { y1: 0, y2: 120 });

  assert.equal(prewarm.available, true);
  assert.equal(prewarm.logicalLineEntries, 90);
  assert.equal(secondPrewarm.skipped, 'warm');
  assert.equal(secondPrewarm.processedLogicalLines, 0);
  assert.equal(textLayout.paragraphPrefixCacheSize(obj), 90);
  assert.equal(textLayout.wrappedLineIndexCacheSize(obj), 90);
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
  assert.equal(visible.totalLines, 90);
  assert.ok(visible.length > 0);
  assert.equal(measured.length, measuredAfterPrewarm);
});

test('viewport line range layout is cached for repeated panning draws', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 100 }, (_, index) => `line ${index} alpha beta gamma`).join('\n');
  const obj = {
    id: 'viewport-range-cache',
    type: 'text',
    x: 0,
    y: -360,
    w: 34 + context.TEXT_PAD * 2,
    h: 100 * context.LINE_H + context.TEXT_PAD * 2,
    data: { content },
  };
  const viewportRect = { y1: 0, y2: 120 };

  const first = textLayout.getTextLayoutForViewport(obj, viewportRect);
  const second = textLayout.getTextLayoutForViewport(obj, viewportRect);

  assert.equal(textLayout.viewportRangeCacheSize(obj), 1);
  assert.equal(second, first);
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
  assert.ok(second.length > 0);
});

test('viewport line cache reuses prewarmed lines for shifted panning ranges', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 620 }, (_, index) => `line ${index} alpha beta gamma`).join('\n');
  const obj = {
    id: 'viewport-shifted-range-cache',
    type: 'text',
    x: 0,
    y: -4800,
    w: 34 + context.TEXT_PAD * 2,
    h: 620 * context.LINE_H + context.TEXT_PAD * 2,
    data: { content },
  };
  const paddedRect = { y1: -240, y2: 9600 };
  const shiftedRect = { y1: 0, y2: 120 };

  const padded = textLayout.getTextLayoutForViewport(obj, paddedRect);
  const shifted = textLayout.getTextLayoutForViewport(obj, shiftedRect);

  assert.ok(textLayout.viewportLineCacheSize(obj) >= padded.length);
  assert.ok(shifted.length > 0);
  assert.ok(shifted.every((line) => padded.includes(line)));
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
});

test('viewport line cache keeps blank lines during full range prewarm', () => {
  const { context } = loadTextLayout({
    measureWidth(text) {
      return String(text).length;
    },
  });
  const textLayout = context.__testTextLayout;
  const content = Array.from({ length: 120 }, (_, index) => (
    index % 5 === 0 ? '' : `line ${index} alpha beta`
  )).join('\n');
  const obj = {
    id: 'viewport-full-range-blank-lines',
    type: 'text',
    x: 0,
    y: 0,
    w: 240,
    h: 120 * context.LINE_H + context.TEXT_PAD * 2,
    data: { content },
  };

  textLayout.prewarmTextObjectLayoutRuntimeCaches(obj);
  const full = textLayout.getTextLayoutForLineRange(obj, 0, 119);

  assert.equal(full.totalLines, 120);
  assert.equal(full.length, 120);
  assert.equal(textLayout.viewportLineCacheSize(obj), 120);
  assert.equal(full.filter((line) => line.text === '').length, 24);
  for (let i = 1; i < full.length; i++) {
    assert.equal(full[i].y - full[i - 1].y, context.LINE_H);
  }
  assert.equal(textLayout.hasObjectLayoutCache(obj), false);
});
