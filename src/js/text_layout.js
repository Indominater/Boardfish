'use strict';

var FONT_SIZE = 16;
var LINE_H    = 24;
var TEXT_PAD  = 16;
var NEW_TEXT_EDIT_MIN_LINES = 1;
const regular_text = 400;
const TEXT_FONT_STYLE = 'normal';
const TEXT_FONT_FAMILY = "'Geist Sans', system-ui";
const textFontForSize = (size) => `${TEXT_FONT_STYLE} ${regular_text} ${size}px ${TEXT_FONT_FAMILY}`;
var FONT      = textFontForSize(FONT_SIZE);
const TEXT_SCRIPT_FONT_SCALE = Math.SQRT1_2;
const TEXT_SCRIPT_MAX_SIZE_DEPTH = 2;
const TEXT_SCRIPT_SUP_OFFSET = -FONT_SIZE * 0.38;
const TEXT_SCRIPT_SUB_OFFSET = FONT_SIZE * 0.24;
const TEXT_CANVAS_FONT_KERNING = 'none';
const TEXT_CANVAS_CONTEXT_CONFIG_KEY = 'fontKerning:none;letterSpacing:0px;fontStretch:normal;fontVariantCaps:normal;textAlign:left;direction:ltr';
const TEXT_GLYPH_MIN_GAP = 0.5;
const TEXT_GLYPH_MIN_INK_WIDTH = 0.01;
const TEXT_DRAW_BATCH_POSITION_EPSILON = 1e-7;
const TEXT_DRAW_BATCH_MAX_UNITS = 2;
// Only batch pairs exhaustively pixel-verified against per-grapheme Geist
// rendering in Chromium. Keep fallback fonts, other engines, f/F ligatures,
// the contextual "tt" alternate, punctuation, and complex scripts exact.
const TEXT_DRAW_BATCHABLE_ASCII_RE = /^[A-EG-Za-eg-z0-9]$/;
var TEXT_BASELINE_Y_OFFSET = FONT_SIZE;
var _configuredTextCanvasContexts = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
var _textDrawBatchingEngineVerified = null;
var _textDrawBatchingVerifiedFonts = new Set();

function normalizeTextContent(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

const trimWhitespaceOnlyEdgeLines = (value) => {
  const lines = normalizeTextContent(value).split('\n');
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && !/\S/.test(lines[first])) first++;
  while (last >= first && !/\S/.test(lines[last])) last--;
  return first <= last ? lines.slice(first, last + 1).join('\n') : '';
};

const textForClipboard = (value) => trimWhitespaceOnlyEdgeLines(value);
const textSelectionForClipboard = (value) => trimWhitespaceOnlyEdgeLines(value);
const textForTextObjectPaste = (value) => trimWhitespaceOnlyEdgeLines(value);

// Some external plain-text clipboards materialize source visual wraps as newlines.
// Only unwrap high-confidence fixed-width prose; all other paste paths stay literal.
const EXTERNAL_TEXT_SOFT_WRAP_MIN_MEDIAN_CHARS = 56;
const EXTERNAL_TEXT_STRUCTURED_LINE_RE = /^(?:[-*+•‣◦▪▫]\s+|\d{1,4}[.)]\s+|[A-Za-z][.)]\s+|\[[ xX]\]\s+|#{1,6}\s+|>\s*|```|~~~)/;
const EXTERNAL_TEXT_CODE_LINE_RE = /^(?:const|let|var|function|class|import|export|return|if|for|while|switch|case)\b|(?:=>|[{};])\s*$/;

const externalTextLineLooksStructured = (line) => {
  const value = String(line ?? '');
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    /^(?:\t| {2,})/.test(value) ||
    value.includes('\t') ||
    /\S {2,}\S/.test(value) ||
    /(?: {2,}|\\)$/.test(value) ||
    EXTERNAL_TEXT_STRUCTURED_LINE_RE.test(trimmed) ||
    /^(?:From|To|Cc|Bcc|Subject|Date):\s/i.test(trimmed) ||
    /^(?:https?:\/\/|www\.)/i.test(trimmed) ||
    EXTERNAL_TEXT_CODE_LINE_RE.test(trimmed)
  );
};

const externalTextLineStartsLowercase = (line) => {
  const first = String(line ?? '').trimStart().charAt(0);
  return !!first && first.toLocaleLowerCase() === first && first.toLocaleUpperCase() !== first;
};

const externalTextLineStartsUppercase = (line) => {
  const first = String(line ?? '').trimStart().charAt(0);
  return !!first && first.toLocaleUpperCase() === first && first.toLocaleLowerCase() !== first;
};

const externalTextBoundaryLooksContinuous = (previousLine, nextLine) => {
  const previous = String(previousLine ?? '').trimEnd();
  const next = String(nextLine ?? '').trimStart();
  if (!previous || !next) return false;
  return (
    !/[.!?…]["'”’)\]]*$/.test(previous) ||
    externalTextLineStartsLowercase(next) ||
    /[,;:\-‐‑‒–—]$/.test(previous)
  );
};

const externalTextMedian = (values) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const shouldUnwrapExternalTextBlock = (lines) => {
  if (!Array.isArray(lines) || lines.length < 3) return false;
  if (lines.some(externalTextLineLooksStructured)) return false;
  if (lines.filter(externalTextLineStartsUppercase).length / lines.length >= 0.8) return false;
  const pipeTableLines = lines.filter((line) => {
    const trimmed = String(line ?? '').trim();
    return /^\|/.test(trimmed) && /\|$/.test(trimmed);
  }).length;
  if (pipeTableLines >= 2) return false;

  const bodyWidths = lines.slice(0, -1).map((line) => String(line ?? '').trim().length);
  if (!bodyWidths.length) return false;
  const referenceWidth = Math.max(...bodyWidths);
  if (externalTextMedian(bodyWidths) < EXTERNAL_TEXT_SOFT_WRAP_MIN_MEDIAN_CHARS) return false;
  if (bodyWidths.some((width) => width < referenceWidth * 0.55)) return false;
  const clusteredWidths = bodyWidths.filter((width) => width >= referenceWidth * 0.7).length;
  if (clusteredWidths / bodyWidths.length < 0.75) return false;

  let continuousBoundaries = 0;
  for (let index = 1; index < lines.length; index++) {
    if (externalTextBoundaryLooksContinuous(lines[index - 1], lines[index])) continuousBoundaries++;
  }
  return continuousBoundaries / (lines.length - 1) >= 0.5;
};

const unwrapExternalTextBlock = (lines) => {
  let result = String(lines[0] ?? '').trimEnd();
  for (let index = 1; index < lines.length; index++) {
    const next = String(lines[index] ?? '').trimStart();
    const separator = /[-‐‑‒–—]$/.test(result) ? '' : ' ';
    result += separator + next;
  }
  return result;
};

const textForExternalTextObjectPaste = (value) => {
  const text = textForTextObjectPaste(value);
  if (!text.includes('\n')) return text;
  const lines = text.split('\n');
  const output = [];
  let index = 0;
  while (index < lines.length) {
    if (!/\S/.test(lines[index])) {
      output.push(lines[index]);
      index++;
      continue;
    }
    let end = index + 1;
    while (end < lines.length && /\S/.test(lines[end])) end++;
    const block = lines.slice(index, end);
    if (shouldUnwrapExternalTextBlock(block)) output.push(unwrapExternalTextBlock(block));
    else output.push(...block);
    index = end;
  }
  return output.join('\n');
};

function isTextContentEmpty(value) {
  return normalizeTextContent(value).replace(/[\u200B-\u200D\uFEFF]/g, '').trim() === '';
}

function configureTextCanvasContext(context) {
  if (!context) return;
  try {
    if (_configuredTextCanvasContexts?.get(context) === TEXT_CANVAS_CONTEXT_CONFIG_KEY) return;
  } catch (_) {}
  try { context.fontKerning = TEXT_CANVAS_FONT_KERNING; } catch (_) {}
  try { context.letterSpacing = '0px'; } catch (_) {}
  try { context.fontStretch = 'normal'; } catch (_) {}
  try { context.fontVariantCaps = 'normal'; } catch (_) {}
  try { context.textAlign = 'left'; } catch (_) {}
  try { context.direction = 'ltr'; } catch (_) {}
  try { _configuredTextCanvasContexts?.set(context, TEXT_CANVAS_CONTEXT_CONFIG_KEY); } catch (_) {}
}

var _measureCanvas = document.createElement('canvas');
var _measureCtx = _measureCanvas.getContext('2d');
configureTextCanvasContext(_measureCtx);
_measureCtx.font = FONT;
refreshTextMetrics();
const TEXT_MEASURE_CACHE_MAX_ENTRIES = 4096;
const TEXT_PREFIX_CACHE_MAX_ENTRIES = 2048;
const TEXT_LINES_CACHE_MAX_ENTRIES = 2048;
const TEXT_SCRIPT_INDEX_CACHE_MAX_ENTRIES = 256;
const TEXT_GLYPH_METRICS_CACHE_MAX_ENTRIES = 4096;
const TEXT_GLYPH_PAIR_SPACING_CACHE_MAX_ENTRIES = 4096;
const TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES = 4096;
const TEXT_WRAPPED_WIDTH_CACHE_MAX_ENTRIES = 12;
const TEXT_VIEWPORT_LAYOUT_RANGE_CACHE_MAX_ENTRIES = 48;
const TEXT_VIEWPORT_LAYOUT_LINE_CACHE_MAX_ENTRIES = 8192;
const TEXT_EXACT_PREFIX_MAX_CHARS = 384;
const TEXT_TAB_SIZE_SPACES = 8;
const BASE_TEXT_SCRIPT_STATE = Object.freeze({
  depth: 0,
  font: FONT,
  key: '',
  kinds: Object.freeze([]),
  offset: 0,
  scale: 1,
});
var _mwCache = new Map();
var _fontMeasureCaches = new Map();
var _scriptIndexCache = new Map();
var _glyphMetricsCache = new Map();
var _glyphPairSpacingCache = new Map();
var _textGraphemeSegmenter = null;

function forEachTextSpacingUnit(value, callback, start = 0, end = null) {
  const text = String(value ?? '');
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, text.length));
  const to = Math.max(from, Math.min(end == null ? text.length : Math.trunc(Number(end)) || 0, text.length));
  if (from >= to) return;
  const hasGraphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

  let asciiOnly = true;
  for (let index = from; index < to; index++) {
    if (text.charCodeAt(index) > 0x7F) {
      asciiOnly = false;
      break;
    }
  }
  if (asciiOnly) {
    let index = from;
    while (index < to) {
      // Intl.Segmenter treats CRLF as one grapheme; the code-point fallback
      // treats it as two. Preserve the active engine's existing boundaries.
      const next = hasGraphemeSegmenter &&
        text.charCodeAt(index) === 0x0D &&
        index + 1 < to &&
        text.charCodeAt(index + 1) === 0x0A
        ? index + 2
        : index + 1;
      callback(text.slice(index, next), index, next);
      index = next;
    }
    return;
  }

  if (hasGraphemeSegmenter) {
    try {
      if (!_textGraphemeSegmenter) _textGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const sliced = text.slice(from, to);
      for (const segment of _textGraphemeSegmenter.segment(sliced)) {
        const segmentStart = from + segment.index;
        callback(segment.segment, segmentStart, segmentStart + segment.segment.length);
      }
      return;
    } catch (_) {}
  }

  let index = from;
  while (index < to) {
    const codePoint = text.codePointAt(index);
    const size = codePoint > 0xFFFF ? 2 : 1;
    const next = Math.min(to, index + size);
    callback(text.slice(index, next), index, next);
    index = next;
  }
}

const measureTextWithConsistentGlyphSpacing = (text) => {
  const value = String(text ?? '');
  let width = 0;
  let previousUnit = null;
  const font = _measureCtx.font || FONT;
  forEachTextSpacingUnit(value, (unit) => {
    width += textGlyphPairSpacing(previousUnit, unit, font);
    width += measureTextGlyphMetricsWithFont(unit, font).width;
    previousUnit = unit;
  });
  return width;
};

function measureRawTextWWithFont(text, font, cache) {
  const value = String(text ?? '');
  if (cache.has(value)) return cache.get(value);
  if (cache.size >= TEXT_MEASURE_CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  configureTextCanvasContext(_measureCtx);
  const previousFont = _measureCtx.font;
  if (previousFont !== font) _measureCtx.font = font;
  const width = measureTextWithConsistentGlyphSpacing(value);
  if (_measureCtx.font !== previousFont) _measureCtx.font = previousFont;
  cache.set(value, width);
  return width;
}

function measureRawTextW(text) {
  return measureRawTextWWithFont(text, FONT, _mwCache);
}

const textScriptSizeDepthForDepth = (depth) => Math.min(TEXT_SCRIPT_MAX_SIZE_DEPTH, Math.max(0, depth || 0));

const textScriptScaleForDepth = (depth) => Math.pow(TEXT_SCRIPT_FONT_SCALE, textScriptSizeDepthForDepth(depth));

function defaultTextBoxSize() {
  const h = NEW_TEXT_EDIT_MIN_LINES * LINE_H + TEXT_PAD * 2;
  return { w: h * 8, h };
}

const textFontForScriptDepth = (depth) => {
  if (!(depth > 0)) return FONT;
  return textFontForSize(Math.max(1, FONT_SIZE * textScriptScaleForDepth(depth)));
};

function measureRawTextWForDepth(text, depth = 0) {
  if (!(depth > 0)) return measureRawTextW(text);
  const font = textFontForScriptDepth(depth);
  let cache = _fontMeasureCaches.get(font);
  if (!cache) {
    cache = new Map();
    _fontMeasureCaches.set(font, cache);
  }
  return measureRawTextWWithFont(text, font, cache);
}

const textTabStopWidth = () => {
  const width = measureRawTextW(' '.repeat(TEXT_TAB_SIZE_SPACES));
  return width > 0 ? width : FONT_SIZE * 4;
};

const textWidthAfterTab = (currentWidth) => {
  const tabStop = textTabStopWidth();
  return (Math.floor(currentWidth / tabStop) + 1) * tabStop;
};

function measureTextW(text) {
  const value = String(text ?? '');
  if (!value.includes('\t')) return measureRawTextW(value);
  const widths = getPrefixWidths(value);
  return widths[widths.length - 1] || 0;
}

const measureVisibleLineTextW = (text) => {
  return measureTextW(String(text ?? '').replace(/[ \t]+$/g, ''));
};

function refreshTextMetrics() {
  configureTextCanvasContext(_measureCtx);
  _measureCtx.font = FONT;
  _measureCtx.textBaseline = 'alphabetic';
  const metrics = _measureCtx.measureText('Hgjpqy');
  const measuredAscent = metrics.actualBoundingBoxAscent;
  const measuredDescent = metrics.actualBoundingBoxDescent;
  const ascent = Number.isFinite(measuredAscent) && measuredAscent > 0 ? measuredAscent : FONT_SIZE * 0.8;
  const descent = Number.isFinite(measuredDescent) && measuredDescent > 0 ? measuredDescent : FONT_SIZE * 0.2;
  TEXT_BASELINE_Y_OFFSET = (LINE_H - ascent - descent) / 2 + ascent;
}

// External line layout cache: id -> {content, w, lines: [{text, startIndex}]}
// Auto-invalidates on content/width change; never serialized with objects.
var _linesCacheMap = new Map();

// Prefix-width cache: line text -> Float64Array of prefix widths [0, w0, w0+w1, ...]
// Computed once per unique line string; avoids O(n2) slice allocations on every frame.
var _prefixCache = new Map();

const trimMapCache = (map, maxEntries) => {
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
};

const textLayoutDebugNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const textLayoutDebugRound = (value) => Math.round((Number(value) || 0) * 100) / 100;

const clearMeasuredTextWidthCache = () => {
  _mwCache.clear();
  _fontMeasureCaches.clear();
  _glyphMetricsCache.clear();
  _glyphPairSpacingCache.clear();
};

function measureTextGlyphMetricsWithFont(text, font = FONT) {
  const value = String(text ?? '');
  const key = `${font}\n${value}`;
  const hit = _glyphMetricsCache.get(key);
  if (hit) {
    _glyphMetricsCache.delete(key);
    _glyphMetricsCache.set(key, hit);
    return hit;
  }

  configureTextCanvasContext(_measureCtx);
  const previousFont = _measureCtx.font;
  if (previousFont !== font) _measureCtx.font = font;
  const metrics = _measureCtx.measureText(value);
  if (_measureCtx.font !== previousFont) _measureCtx.font = previousFont;

  const measuredWidth = Number(metrics?.width);
  const width = Number.isFinite(measuredWidth) ? measuredWidth : 0;
  const hasLeft = metrics && 'actualBoundingBoxLeft' in metrics;
  const hasRight = metrics && 'actualBoundingBoxRight' in metrics;
  const measuredLeft = Number(metrics?.actualBoundingBoxLeft);
  const measuredRight = Number(metrics?.actualBoundingBoxRight);
  const result = {
    width,
    left: Number.isFinite(measuredLeft) ? measuredLeft : 0,
    right: Number.isFinite(measuredRight) ? measuredRight : width,
    hasInkBounds: hasLeft && hasRight && Number.isFinite(measuredLeft) && Number.isFinite(measuredRight),
  };
  _glyphMetricsCache.set(key, result);
  trimMapCache(_glyphMetricsCache, TEXT_GLYPH_METRICS_CACHE_MAX_ENTRIES);
  return result;
}

const textGlyphMetricsInkWidth = (metrics) => {
  const inkWidth = Number(metrics?.left) + Number(metrics?.right);
  return Number.isFinite(inkWidth) ? Math.max(0, inkWidth) : 0;
};

const textSpacingUnitCanUseInkGap = (unit) => {
  const value = String(unit ?? '');
  return !!value && !/\s/.test(value);
};

const textGlyphPairSpacingCacheKey = (previousUnit, nextUnit, font = FONT) => {
  const previous = String(previousUnit ?? '');
  const next = String(nextUnit ?? '');
  if (
    font === FONT &&
    previous.length === 1 &&
    next.length === 1 &&
    previous.charCodeAt(0) <= 0x7F &&
    next.charCodeAt(0) <= 0x7F
  ) {
    return (previous.charCodeAt(0) << 7) | next.charCodeAt(0);
  }
  const fontValue = String(font);
  return `${fontValue.length}:${fontValue}${previous.length}:${previous}${next}`;
};

function textGlyphPairSpacing(previousUnit, nextUnit, font = FONT) {
  const previous = String(previousUnit ?? '');
  const next = String(nextUnit ?? '');
  const cacheKey = textGlyphPairSpacingCacheKey(previous, next, font);
  const cached = _glyphPairSpacingCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let spacing = 0;
  if (textSpacingUnitCanUseInkGap(previous) && textSpacingUnitCanUseInkGap(next)) {
    const previousMetrics = measureTextGlyphMetricsWithFont(previous, font);
    const nextMetrics = measureTextGlyphMetricsWithFont(next, font);
    if (
      previousMetrics.hasInkBounds &&
      nextMetrics.hasInkBounds &&
      textGlyphMetricsInkWidth(previousMetrics) > TEXT_GLYPH_MIN_INK_WIDTH &&
      textGlyphMetricsInkWidth(nextMetrics) > TEXT_GLYPH_MIN_INK_WIDTH
    ) {
      const naturalGap = previousMetrics.width - nextMetrics.left - previousMetrics.right;
      if (Number.isFinite(naturalGap)) spacing = Math.max(0, TEXT_GLYPH_MIN_GAP - naturalGap);
    }
  }

  _glyphPairSpacingCache.set(cacheKey, spacing);
  trimMapCache(_glyphPairSpacingCache, TEXT_GLYPH_PAIR_SPACING_CACHE_MAX_ENTRIES);
  return spacing;
}

function clearTextObjectLayoutRuntime(obj, options = {}) {
  if (!obj) return;
  delete obj._layoutCache;
  delete obj._layoutCacheContent;
  delete obj._layoutCacheW;
  delete obj._layoutCacheScriptKey;
  delete obj._layoutCacheAlignKey;
  delete obj._layoutCacheY;
  if (options.script !== false) {
    delete obj._textScriptRangesCache;
    delete obj._textScriptRangesCacheContent;
    delete obj._textScriptRangesCacheSourceKey;
    delete obj._textScriptLayoutMetrics;
    delete obj._textScriptLayoutMetricsContent;
    delete obj._textScriptLayoutMetricsScriptKey;
    delete obj._textClipboardCacheContent;
    delete obj._textClipboardCacheScriptKey;
    delete obj._textClipboardCacheValue;
  }
  if (options.minWidth !== false) {
    delete obj._textMinWidthWordSegmentCache;
    delete obj._textMinWidthWordSegmentCacheContent;
    delete obj._textMinWidthWordSegmentCacheScriptKey;
  }
  if (options.prefix !== false) {
    delete obj._textParagraphPrefixCache;
    delete obj._textParagraphPrefixCacheContent;
    delete obj._textParagraphPrefixCacheScriptKey;
  }
  delete obj._textWrappedLineCountCacheContent;
  delete obj._textWrappedLineCountCacheW;
  delete obj._textWrappedLineCountCacheScriptKey;
  delete obj._textWrappedLineCountCacheValue;
  delete obj._textWrappedLineIndexCacheContent;
  delete obj._textWrappedLineIndexCacheW;
  delete obj._textWrappedLineIndexCacheScriptKey;
  delete obj._textWrappedLineIndexCache;
  delete obj._textWrappedLineIndexWidthCacheContent;
  delete obj._textWrappedLineIndexWidthCacheScriptKey;
  delete obj._textWrappedLineIndexWidthCache;
  delete obj._textViewportLayoutRangeCacheContent;
  delete obj._textViewportLayoutRangeCacheW;
  delete obj._textViewportLayoutRangeCacheScriptKey;
  delete obj._textViewportLayoutRangeCacheAlignKey;
  delete obj._textViewportLayoutRangeCacheY;
  delete obj._textViewportLayoutRangeCache;
  delete obj._textViewportLayoutLineCacheContent;
  delete obj._textViewportLayoutLineCacheW;
  delete obj._textViewportLayoutLineCacheScriptKey;
  delete obj._textViewportLayoutLineCacheAlignKey;
  delete obj._textViewportLayoutLineCacheY;
  delete obj._textViewportLayoutLineCacheLineCount;
  delete obj._textViewportLayoutLineCache;
  if (options.lines !== false) _linesCacheMap.delete(obj.id);
}

const cloneTextLayoutRuntimeLine = (line) => {
  const clone = { ...line };
  if (Object.prototype.hasOwnProperty.call(line || {}, '_scriptMetrics')) {
    Object.defineProperty(clone, '_scriptMetrics', {
      configurable: true,
      value: line._scriptMetrics,
    });
  }
  return clone;
};

const cloneTextLayoutScriptRanges = (ranges = []) => {
  const out = new Array(ranges.length);
  for (let i = 0; i < ranges.length; i++) out[i] = { ...ranges[i] };
  return out;
};

const cloneTextWrappedLineIndexEntries = (entries = []) => {
  const out = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) out[i] = { ...entries[i] };
  return out;
};

const cloneTextLayoutRuntimeLines = (lines = []) => {
  const out = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) out[i] = cloneTextLayoutRuntimeLine(lines[i]);
  return out;
};

function replaceArraySegmentInPlace(target, start, deleteCount, inserted = []) {
  if (!Array.isArray(target)) return target;
  const source = Array.isArray(inserted) ? inserted : [];
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, target.length));
  const removeCount = Math.max(0, Math.min(Math.trunc(Number(deleteCount)) || 0, target.length - from));
  const insertCount = source.length;
  const suffixStart = from + removeCount;
  const suffixLength = target.length - suffixStart;
  const newLength = from + insertCount + suffixLength;
  if (insertCount > removeCount) {
    target.length = newLength;
    for (let i = suffixLength - 1; i >= 0; i--) {
      target[from + insertCount + i] = target[suffixStart + i];
    }
  } else if (insertCount < removeCount) {
    for (let i = 0; i < suffixLength; i++) {
      target[from + insertCount + i] = target[suffixStart + i];
    }
    target.length = newLength;
  }
  for (let i = 0; i < insertCount; i++) target[from + i] = source[i];
  return target;
}

function cloneTextObjectRuntimeCaches(source, target) {
  if (!source || !target || source.type !== 'text' || target.type !== 'text') return target;
  const content = normalizeTextContent(target.data?.content || '');
  const sourceScriptKey = Array.isArray(source.data?.scriptRanges)
    ? JSON.stringify(source.data.scriptRanges)
    : '[]';
  if (
    Array.isArray(source._textScriptRangesCache) &&
    source._textScriptRangesCacheContent === content &&
    source._textScriptRangesCacheSourceKey === sourceScriptKey
  ) {
    target._textScriptRangesCache = cloneTextLayoutScriptRanges(source._textScriptRangesCache);
    target._textScriptRangesCacheContent = content;
    target._textScriptRangesCacheSourceKey = JSON.stringify(target._textScriptRangesCache);
  }

  if (
    source._textClipboardCacheContent === content &&
    typeof source._textClipboardCacheScriptKey === 'string' &&
    typeof source._textClipboardCacheValue === 'string'
  ) {
    target._textClipboardCacheContent = source._textClipboardCacheContent;
    target._textClipboardCacheScriptKey = source._textClipboardCacheScriptKey;
    target._textClipboardCacheValue = source._textClipboardCacheValue;
  }

  if (
    source._textScriptLayoutMetrics &&
    source._textScriptLayoutMetricsContent === content &&
    typeof source._textScriptLayoutMetricsScriptKey === 'string'
  ) {
    target._textScriptLayoutMetrics = source._textScriptLayoutMetrics;
    target._textScriptLayoutMetricsContent = source._textScriptLayoutMetricsContent;
    target._textScriptLayoutMetricsScriptKey = source._textScriptLayoutMetricsScriptKey;
  }

  if (
    source._textMinWidthWordSegmentCache &&
    source._textMinWidthWordSegmentCacheContent === content &&
    typeof source._textMinWidthWordSegmentCacheScriptKey === 'string'
  ) {
    target._textMinWidthWordSegmentCache = { ...source._textMinWidthWordSegmentCache };
    target._textMinWidthWordSegmentCacheContent = source._textMinWidthWordSegmentCacheContent;
    target._textMinWidthWordSegmentCacheScriptKey = source._textMinWidthWordSegmentCacheScriptKey;
  }

  if (
    source._textParagraphPrefixCache &&
    typeof source._textParagraphPrefixCache.entries === 'function' &&
    source._textParagraphPrefixCacheContent === content &&
    typeof source._textParagraphPrefixCacheScriptKey === 'string'
  ) {
    target._textParagraphPrefixCache = new Map(source._textParagraphPrefixCache.entries());
    target._textParagraphPrefixCacheContent = source._textParagraphPrefixCacheContent;
    target._textParagraphPrefixCacheScriptKey = source._textParagraphPrefixCacheScriptKey;
  }

  if (
    source._textWrappedLineCountCacheContent === content &&
    source._textWrappedLineCountCacheW === target.w &&
    typeof source._textWrappedLineCountCacheScriptKey === 'string' &&
    Number.isFinite(source._textWrappedLineCountCacheValue)
  ) {
    target._textWrappedLineCountCacheContent = source._textWrappedLineCountCacheContent;
    target._textWrappedLineCountCacheW = source._textWrappedLineCountCacheW;
    target._textWrappedLineCountCacheScriptKey = source._textWrappedLineCountCacheScriptKey;
    target._textWrappedLineCountCacheValue = source._textWrappedLineCountCacheValue;
  }

  if (
    source._textWrappedLineIndexCacheContent === content &&
    source._textWrappedLineIndexCacheW === target.w &&
    typeof source._textWrappedLineIndexCacheScriptKey === 'string' &&
    source._textWrappedLineIndexCache &&
    Array.isArray(source._textWrappedLineIndexCache.entries)
  ) {
    target._textWrappedLineIndexCacheContent = source._textWrappedLineIndexCacheContent;
    target._textWrappedLineIndexCacheW = source._textWrappedLineIndexCacheW;
    target._textWrappedLineIndexCacheScriptKey = source._textWrappedLineIndexCacheScriptKey;
    target._textWrappedLineIndexCache = {
      lineCount: source._textWrappedLineIndexCache.lineCount,
      entries: cloneTextWrappedLineIndexEntries(source._textWrappedLineIndexCache.entries),
    };
  }

  if (
    Array.isArray(source._layoutCache) &&
    source._layoutCacheContent === content &&
    source._layoutCacheW === target.w &&
    typeof source._layoutCacheScriptKey === 'string' &&
    source._layoutCacheAlignKey === textLayoutAlignKey(target, content)
  ) {
    target._layoutCache = cloneTextLayoutRuntimeLines(source._layoutCache);
    target._layoutCacheContent = source._layoutCacheContent;
    target._layoutCacheW = source._layoutCacheW;
    target._layoutCacheScriptKey = source._layoutCacheScriptKey;
    target._layoutCacheAlignKey = source._layoutCacheAlignKey;
    target._layoutCacheY = target.y;
    syncTextLayoutLinePositions(target, target._layoutCache);
  }

  return target;
}

const clearTextLayoutCaches = (options = {}) => {
  _linesCacheMap.clear();
  _prefixCache.clear();
  _scriptIndexCache.clear();
  if (options.measurements) clearMeasuredTextWidthCache();
  if (options.objectLayout !== false) {
    for (const obj of objects) {
      clearTextObjectLayoutRuntime(obj, { lines: false });
    }
  }
};

function getPrefixWidths(text) {
  const value = String(text ?? '');
  const hit = _prefixCache.get(value);
  if (hit) {
    _prefixCache.delete(value);
    _prefixCache.set(value, hit);
    return hit;
  }
  const pw = new Float64Array(value.length + 1);
  let width = 0;
  let k = 0;
  let previousUnit = null;
  while (k < value.length) {
    if (value[k] === '\t') {
      width = textWidthAfterTab(width);
      pw[k + 1] = width;
      k++;
      previousUnit = null;
      continue;
    }
    const runStart = k;
    while (k < value.length && value[k] !== '\t') k++;
    forEachTextSpacingUnit(value, (unit, unitStart, unitEnd) => {
      const spacing = textGlyphPairSpacing(previousUnit, unit, FONT);
      if (spacing) {
        width += spacing;
        pw[unitStart] = width;
      }
      width += measureRawTextW(unit);
      for (let pos = unitStart + 1; pos <= unitEnd; pos++) pw[pos] = width;
      previousUnit = unit;
    }, runStart, k);
  }
  _prefixCache.set(value, pw);
  trimMapCache(_prefixCache, TEXT_PREFIX_CACHE_MAX_ENTRIES);
  return pw;
}

function measureStyledTextW(text, state) {
  return measureRawTextWForDepth(text, state?.depth || 0);
}

function getTextRangePrefixWidths(text, rangeStart = 0, scriptRanges = [], content = '', scriptMetrics = null) {
  const value = String(text ?? '');
  if (!Array.isArray(scriptRanges) || !scriptRanges.length) {
    return getPrefixWidths(value);
  }
  const pw = new Float64Array(value.length + 1);
  let i = 0;
  let width = 0;
  const sourceContent = content || value;
  const metrics = scriptMetrics || getTextScriptLayoutMetrics(sourceContent, scriptRanges);

  while (i < value.length) {
    const globalIndex = rangeStart + i;
    if (textScriptMetricsHiddenAt(metrics, globalIndex)) {
      pw[i + 1] = width;
      i++;
      continue;
    }

    if (value[i] === '\t') {
      width = textWidthAfterTab(width);
      pw[i + 1] = width;
      i++;
      continue;
    }

    const state = textScriptMetricsStateAt(metrics, globalIndex);
    let j = i + 1;
    while (j < value.length) {
      const nextGlobalIndex = rangeStart + j;
      if (value[j] === '\t') break;
      if (textScriptMetricsHiddenAt(metrics, nextGlobalIndex)) break;
      if (textScriptMetricsStateAt(metrics, nextGlobalIndex).key !== state.key) break;
      j++;
    }

    const segment = value.slice(i, j);
    let previousUnit = null;
    forEachTextSpacingUnit(segment, (unit, unitStart, unitEnd) => {
      const spacing = textGlyphPairSpacing(previousUnit, unit, state.font || FONT);
      if (spacing) {
        width += spacing;
        pw[i + unitStart] = width;
      }
      width += measureStyledTextW(unit, state);
      for (let pos = unitStart + 1; pos <= unitEnd; pos++) pw[i + pos] = width;
      previousUnit = unit;
    });
    width = pw[j];
    i = j;
  }

  return pw;
}

function getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, text, paraStart, paraEnd, scriptRanges = [], scriptKey = '', scriptMetrics = null) {
  const start = Math.max(0, Math.min(Math.trunc(Number(paraStart)) || 0, text.length));
  const end = Math.max(start, Math.min(Math.trunc(Number(paraEnd)) || start, text.length));
  if (textRangeIncludesTab(text, start, end) || !obj || obj.type !== 'text') {
    return getTextRangePrefixWidths(text.slice(start, end), start, scriptRanges, text, scriptMetrics);
  }

  const normalizedScriptKey = scriptKey || JSON.stringify(Array.isArray(scriptRanges) ? scriptRanges : []);
  if (
    obj._textParagraphPrefixCacheContent !== text ||
    obj._textParagraphPrefixCacheScriptKey !== normalizedScriptKey ||
    !obj._textParagraphPrefixCache ||
    typeof obj._textParagraphPrefixCache.get !== 'function'
  ) {
    obj._textParagraphPrefixCache = new Map();
    obj._textParagraphPrefixCacheContent = text;
    obj._textParagraphPrefixCacheScriptKey = normalizedScriptKey;
  }

  const cacheKey = `${start}:${end}`;
  const cached = obj._textParagraphPrefixCache.get(cacheKey);
  if (cached) {
    if (obj._textParagraphPrefixCache.size >= TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES) {
      obj._textParagraphPrefixCache.delete(cacheKey);
      obj._textParagraphPrefixCache.set(cacheKey, cached);
    }
    return cached;
  }

  const widths = getTextRangePrefixWidths(text.slice(start, end), start, scriptRanges, text, scriptMetrics);
  obj._textParagraphPrefixCache.set(cacheKey, widths);
  trimMapCache(obj._textParagraphPrefixCache, TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES);
  return widths;
}

function getCachedTextWrappedLineCount(obj, text, scriptKey) {
  if (!obj || obj.type !== 'text') return null;
  if (
    obj._textWrappedLineCountCacheContent === text &&
    obj._textWrappedLineCountCacheW === obj.w &&
    obj._textWrappedLineCountCacheScriptKey === scriptKey &&
    Number.isFinite(obj._textWrappedLineCountCacheValue)
  ) {
    return Math.max(1, Math.trunc(Number(obj._textWrappedLineCountCacheValue)) || 1);
  }
  const cachedIndex = getCachedTextWrappedLineIndex(obj, text, scriptKey);
  if (cachedIndex) {
    return Math.max(1, Math.trunc(Number(cachedIndex.lineCount)) || 1);
  }
  return null;
}

function setCachedTextWrappedLineCount(obj, text, scriptKey, lineCount) {
  if (!obj || obj.type !== 'text') return;
  obj._textWrappedLineCountCacheContent = text;
  obj._textWrappedLineCountCacheW = obj.w;
  obj._textWrappedLineCountCacheScriptKey = scriptKey;
  obj._textWrappedLineCountCacheValue = Math.max(1, Math.trunc(Number(lineCount)) || 1);
}

const textWrappedLineWidthCacheKey = (width) => String(width);

function getTextWrappedLineIndexWidthCache(obj, text, scriptKey) {
  if (!obj || obj.type !== 'text') return null;
  const cache = obj._textWrappedLineIndexWidthCache;
  if (
    obj._textWrappedLineIndexWidthCacheContent === text &&
    obj._textWrappedLineIndexWidthCacheScriptKey === scriptKey &&
    cache &&
    typeof cache.get === 'function'
  ) {
    return cache;
  }
  return null;
}

function ensureTextWrappedLineIndexWidthCache(obj, text, scriptKey) {
  if (!obj || obj.type !== 'text') return null;
  if (
    obj._textWrappedLineIndexWidthCacheContent !== text ||
    obj._textWrappedLineIndexWidthCacheScriptKey !== scriptKey ||
    !obj._textWrappedLineIndexWidthCache ||
    typeof obj._textWrappedLineIndexWidthCache.set !== 'function'
  ) {
    obj._textWrappedLineIndexWidthCacheContent = text;
    obj._textWrappedLineIndexWidthCacheScriptKey = scriptKey;
    obj._textWrappedLineIndexWidthCache = new Map();
  }
  return obj._textWrappedLineIndexWidthCache;
}

function promoteCachedTextWrappedLineIndex(obj, text, scriptKey, width, cache) {
  if (!obj || !cache || !Array.isArray(cache.entries) || !Number.isFinite(cache.lineCount)) return null;
  obj._textWrappedLineIndexCacheContent = text;
  obj._textWrappedLineIndexCacheW = width;
  obj._textWrappedLineIndexCacheScriptKey = scriptKey;
  obj._textWrappedLineIndexCache = cache;
  setCachedTextWrappedLineCount(obj, obj._textWrappedLineIndexCacheContent, scriptKey, cache.lineCount);
  return cache;
}

function getCachedTextWrappedLineIndex(obj, text, scriptKey) {
  if (!obj || obj.type !== 'text') return null;
  const cache = obj._textWrappedLineIndexCache;
  if (
    cache &&
    Array.isArray(cache.entries) &&
    obj._textWrappedLineIndexCacheContent === text &&
    obj._textWrappedLineIndexCacheW === obj.w &&
    obj._textWrappedLineIndexCacheScriptKey === scriptKey &&
    Number.isFinite(cache.lineCount)
  ) {
    return cache;
  }
  const widthCache = getTextWrappedLineIndexWidthCache(obj, text, scriptKey);
  const widthKey = textWrappedLineWidthCacheKey(obj.w);
  const widthCached = widthCache?.get(widthKey);
  if (
    widthCached &&
    Array.isArray(widthCached.entries) &&
    Number.isFinite(widthCached.lineCount)
  ) {
    widthCache.delete(widthKey);
    widthCache.set(widthKey, widthCached);
    return promoteCachedTextWrappedLineIndex(obj, text, scriptKey, obj.w, widthCached);
  }
  return null;
}

function setCachedTextWrappedLineIndex(obj, text, scriptKey, entries, lineCount) {
  if (!obj || obj.type !== 'text' || !Array.isArray(entries)) return;
  const count = Math.max(1, Math.trunc(Number(lineCount)) || 1);
  obj._textWrappedLineIndexCacheContent = text;
  obj._textWrappedLineIndexCacheW = obj.w;
  obj._textWrappedLineIndexCacheScriptKey = scriptKey;
  const cache = {
    lineCount: count,
    entries,
  };
  obj._textWrappedLineIndexCache = cache;
  setCachedTextWrappedLineCount(obj, text, scriptKey, count);
  const widthCache = ensureTextWrappedLineIndexWidthCache(obj, text, scriptKey);
  if (widthCache) {
    const widthKey = textWrappedLineWidthCacheKey(obj.w);
    if (widthCache.has(widthKey)) widthCache.delete(widthKey);
    widthCache.set(widthKey, cache);
    trimMapCache(widthCache, TEXT_WRAPPED_WIDTH_CACHE_MAX_ENTRIES);
  }
}

function ensureCachedTextWrappedLineIndex(obj, content, scriptRanges, scriptKey) {
  const cached = getCachedTextWrappedLineIndex(obj, content, scriptKey);
  if (cached) return cached;
  const wrapped = buildWrappedLines(obj, {
    scriptRanges,
    scriptKey,
    collect: false,
    collectLineIndex: true,
  });
  setCachedTextWrappedLineIndex(obj, content, scriptKey, wrapped.lineIndex || [], wrapped.lineCount);
  return getCachedTextWrappedLineIndex(obj, content, scriptKey);
}

function textWrappedLineIndexEntryForVisual(cache, visualLineIndex) {
  const entries = cache?.entries || [];
  if (!entries.length) return null;
  const lineCount = Math.max(1, Math.trunc(Number(cache.lineCount)) || 1);
  const target = Math.max(0, Math.min(Math.trunc(Number(visualLineIndex)) || 0, lineCount - 1));
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if ((entries[mid]?.visualStart || 0) <= target) lo = mid;
    else hi = mid - 1;
  }
  if (target > (entries[lo]?.visualEnd || 0) && lo + 1 < entries.length) lo++;
  return { entry: entries[lo], index: lo };
}

function prewarmTextObjectLayoutRuntimeCaches(obj, options = {}) {
  if (!obj || obj.type !== 'text') return { available: false, reason: 'not-text' };
  const startedAt = textLayoutDebugNow();
  const content = normalizeTextContent(obj.data?.content || '');
  const scriptRanges = getTextScriptRangesForLayout(obj);
  const scriptKey = JSON.stringify(scriptRanges);
  const beforePrefixEntries = obj._textParagraphPrefixCache?.size || 0;
  const lineIndexCache = ensureCachedTextWrappedLineIndex(obj, content, scriptRanges, scriptKey);
  const entries = lineIndexCache?.entries || [];
  const scriptMetricsWarm = !scriptRanges.length || (
    obj._textScriptLayoutMetrics &&
    obj._textScriptLayoutMetricsContent === content &&
    obj._textScriptLayoutMetricsScriptKey === scriptKey
  );
  const prefixCacheWarm = (
    obj._textParagraphPrefixCacheContent === content &&
    obj._textParagraphPrefixCacheScriptKey === scriptKey &&
    obj._textParagraphPrefixCache &&
    typeof obj._textParagraphPrefixCache.get === 'function' &&
    beforePrefixEntries >= entries.length
  );
  if (prefixCacheWarm && scriptMetricsWarm) {
    return {
      available: true,
      contentChars: content.length,
      scriptRanges: scriptRanges.length,
      logicalLineEntries: entries.length,
      processedLogicalLines: 0,
      processedChars: 0,
      lineCount: lineIndexCache?.lineCount || 0,
      prefixCacheEntriesBefore: beforePrefixEntries,
      prefixCacheEntriesAfter: beforePrefixEntries,
      prefixCacheEntriesAdded: 0,
      wrappedLineIndexEntries: entries.length,
      scriptMetricsCachePresent: !!obj._textScriptLayoutMetrics,
      layoutCachePresent: Array.isArray(obj._layoutCache),
      skipped: 'warm',
      totalMs: textLayoutDebugRound(textLayoutDebugNow() - startedAt),
    };
  }
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
    : null;
  const maxLogicalLines = options.maxLogicalLines == null
    ? Infinity
    : Math.max(0, Math.trunc(Number(options.maxLogicalLines)) || 0);
  let processedLogicalLines = 0;
  let processedChars = 0;
  for (const entry of entries) {
    if (processedLogicalLines >= maxLogicalLines) break;
    const start = Math.max(0, Math.min(Math.trunc(Number(entry?.startIndex)) || 0, content.length));
    const end = Math.max(start, Math.min(Math.trunc(Number(entry?.endIndex)) || start, content.length));
    getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, content, start, end, scriptRanges, scriptKey, scriptMetrics);
    processedLogicalLines++;
    processedChars += Math.max(0, end - start);
  }
  const afterPrefixEntries = obj._textParagraphPrefixCache?.size || 0;
  return {
    available: true,
    contentChars: content.length,
    scriptRanges: scriptRanges.length,
    logicalLineEntries: entries.length,
    processedLogicalLines,
    processedChars,
    lineCount: lineIndexCache?.lineCount || 0,
    prefixCacheEntriesBefore: beforePrefixEntries,
    prefixCacheEntriesAfter: afterPrefixEntries,
    prefixCacheEntriesAdded: Math.max(0, afterPrefixEntries - beforePrefixEntries),
    wrappedLineIndexEntries: entries.length,
    scriptMetricsCachePresent: !!obj._textScriptLayoutMetrics,
    layoutCachePresent: Array.isArray(obj._layoutCache),
    totalMs: textLayoutDebugRound(textLayoutDebugNow() - startedAt),
  };
}

function measureTextRangeW(content, start, end, scriptRanges = []) {
  const text = normalizeTextContent(content);
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const widths = getTextRangePrefixWidths(text.slice(from, to), from, scriptRanges, text);
  return widths[widths.length - 1] || 0;
}

function textPrefixWidthsSlice(prefixWidths, from, to) {
  const source = prefixWidths;
  const start = Math.max(0, Math.min(Math.trunc(Number(from)) || 0, Math.max(0, (source?.length || 1) - 1)));
  const end = Math.max(start, Math.min(Math.trunc(Number(to)) || start, Math.max(0, (source?.length || 1) - 1)));
  const out = new Float64Array(end - start + 1);
  const base = Number(source?.[start]) || 0;
  for (let index = start; index <= end; index++) {
    out[index - start] = Math.max(0, (Number(source?.[index]) || 0) - base);
  }
  return out;
}

function textRangeIncludesTab(text, start, end) {
  for (let index = start; index < end; index++) {
    if (text[index] === '\t') return true;
  }
  return false;
}

const findTextWrapEndByWidth = (rangeWidth, start, end, maxW) => {
  let lo = start + 1;
  let hi = end;
  if (rangeWidth(start, lo) > maxW) return lo;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (rangeWidth(start, mid) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const nextNonSpaceIndex = (content, start, end) => {
  let index = start;
  while (index < end && content[index] === ' ') index++;
  return index;
};

function wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, logicalLineIndex, rangeWidth, pushLine) {
  let lineStart = paraStart;
  while (lineStart < paraEnd) {
    let cursor = lineStart;
    let bestEnd = lineStart;
    let bestNext = lineStart;

    while (cursor < paraEnd) {
      const wordStart = nextNonSpaceIndex(content, cursor, paraEnd);
      if (wordStart >= paraEnd) {
        const lineEnd = findTextWrapEndByWidth(rangeWidth, lineStart, paraEnd, maxW);
        pushLine(lineStart, Math.max(lineStart + 1, lineEnd), paraEnd, paraEnd, logicalLineIndex);
        lineStart = paraEnd;
        break;
      }

      let wordEnd = wordStart + 1;
      while (wordEnd < paraEnd && content[wordEnd] !== ' ') wordEnd++;
      if (rangeWidth(lineStart, wordEnd) <= maxW) {
        bestEnd = wordEnd;
        const afterSpaces = nextNonSpaceIndex(content, wordEnd, paraEnd);
        if (wordEnd < paraEnd && afterSpaces >= paraEnd) {
          bestEnd = findTextWrapEndByWidth(rangeWidth, lineStart, paraEnd, maxW);
          bestNext = paraEnd;
          cursor = paraEnd;
          continue;
        }
        bestNext = afterSpaces;
        cursor = bestNext;
        continue;
      }

      if (bestEnd > lineStart) break;
      const lineEnd = findTextWrapEndByWidth(rangeWidth, lineStart, wordEnd, maxW);
      const end = Math.max(lineStart + 1, lineEnd);
      const nextStart = end < paraEnd && content[end] === ' '
        ? nextNonSpaceIndex(content, end, paraEnd)
        : end;
      pushLine(lineStart, end, nextStart, nextStart, logicalLineIndex);
      lineStart = nextStart;
      break;
    }

    if (lineStart >= paraEnd) continue;
    if (bestEnd > lineStart) {
      pushLine(lineStart, bestEnd, bestNext, bestNext, logicalLineIndex);
      lineStart = bestNext;
    } else {
      const lineEnd = Math.min(lineStart + 1, paraEnd);
      pushLine(lineStart, lineEnd, lineEnd, lineEnd, logicalLineIndex);
      lineStart = lineEnd;
    }
  }
}

function clearTextMeasurementCaches() {
  refreshTextMetrics();
  clearTextLayoutCaches({ measurements: true });
  syncAllTextAutoHeights();
  invalidateOffscreen();
  scheduleRender(true, true);
}

function buildWrappedLines(obj, options = {}) {
  const content = normalizeTextContent(obj?.data?.content || '');
  const scriptRanges = Array.isArray(options.scriptRanges)
    ? options.scriptRanges
    : getTextScriptRangesForLayout(obj);
  const scriptKey = options.scriptKey || JSON.stringify(scriptRanges);
  const firstLineIndex = Math.max(0, Math.trunc(Number(options.firstLineIndex)) || 0);
  const lastLineIndex = options.lastLineIndex == null
    ? Infinity
    : Math.max(firstLineIndex, Math.trunc(Number(options.lastLineIndex)) || firstLineIndex);
  const collectLines = options.collect !== false;
  const collectLineIndex = options.collectLineIndex === true;
  const rangeLimited = firstLineIndex > 0 || Number.isFinite(lastLineIndex);
  const knownLineCount = Math.trunc(Number(options.knownLineCount)) || 0;
  const canStopAfterRange = collectLines && rangeLimited && knownLineCount > 0 && !collectLineIndex;
  const maxW = obj.w - TEXT_PAD * 2;
  const result = [];
  const lineIndex = collectLineIndex ? [] : null;
  let visualLineIndex = 0;

  const isWrapSpace = (ch) => ch === ' ' || ch === '\t';
  const pushLine = (start, end, nextStart = end, caretEnd = end, logicalLineIndex = 0, prefixWidths = null) => {
    if (lineIndex) {
      let entry = lineIndex[lineIndex.length - 1];
      if (!entry || entry.logicalLineIndex !== logicalLineIndex) {
        entry = {
          logicalLineIndex,
          startIndex: start,
          endIndex: end,
          visualStart: visualLineIndex,
          visualEnd: visualLineIndex,
        };
        lineIndex.push(entry);
      } else {
        entry.startIndex = Math.min(entry.startIndex, start);
        entry.endIndex = Math.max(entry.endIndex, end);
        entry.visualEnd = visualLineIndex;
      }
    }
    if (collectLines && visualLineIndex >= firstLineIndex && visualLineIndex <= lastLineIndex) {
      result.push({
        text: content.slice(start, end),
        startIndex: start,
        endIndex: end,
        caretEndIndex: caretEnd,
        nextStartIndex: nextStart,
        logicalLineIndex,
        ...(rangeLimited ? { visualLineIndex } : {}),
        ...(prefixWidths ? { prefixWidths } : {}),
      });
    }
    visualLineIndex++;
  };

  let paraStart = 0;
  let logicalLineIndex = 0;
  while (paraStart <= content.length) {
    if (canStopAfterRange && visualLineIndex > lastLineIndex) break;
    const newlineAt = content.indexOf('\n', paraStart);
    const paraEnd = newlineAt === -1 ? content.length : newlineAt;

    if (paraStart === paraEnd) {
      pushLine(paraStart, paraStart, paraStart, paraStart, logicalLineIndex);
    } else {
      const paragraphHasTab = textRangeIncludesTab(content, paraStart, paraEnd);
      const paragraphPrefixWidths = paragraphHasTab
        ? null
        : getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, content, paraStart, paraEnd, scriptRanges, scriptKey);
      const paragraphRangeWidth = (start, end) => {
        if (!paragraphPrefixWidths) return measureTextRangeW(content, start, end, scriptRanges);
        const from = Math.max(0, Math.min(start - paraStart, paragraphPrefixWidths.length - 1));
        const to = Math.max(from, Math.min(end - paraStart, paragraphPrefixWidths.length - 1));
        return Math.max(0, paragraphPrefixWidths[to] - paragraphPrefixWidths[from]);
      };
      const pushParagraphLine = (start, end, nextStart = end, caretEnd = end, logicalLineIndexForLine = logicalLineIndex) => {
        const prefixWidths = collectLines && paragraphPrefixWidths
          ? textPrefixWidthsSlice(paragraphPrefixWidths, start - paraStart, end - paraStart)
          : null;
        pushLine(start, end, nextStart, caretEnd, logicalLineIndexForLine, prefixWidths);
      };
      if (paragraphRangeWidth(paraStart, paraEnd) <= maxW) {
        pushParagraphLine(paraStart, paraEnd, paraEnd, paraEnd, logicalLineIndex);
        if (newlineAt === -1) break;
        paraStart = newlineAt + 1;
        logicalLineIndex++;
        continue;
      }
      if (!scriptRanges.length && !paragraphHasTab && paraEnd - paraStart > TEXT_EXACT_PREFIX_MAX_CHARS) {
        wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, logicalLineIndex, paragraphRangeWidth, pushParagraphLine);
        if (newlineAt === -1) break;
        paraStart = newlineAt + 1;
        logicalLineIndex++;
        continue;
      }
      let lineStart = paraStart;
      while (lineStart < paraEnd) {
        let lo = lineStart + 1;
        let hi = paraEnd;
        if (paragraphRangeWidth(lineStart, lo) > maxW) {
          pushParagraphLine(lineStart, lo, lo, lo, logicalLineIndex);
          lineStart = lo;
          continue;
        }
        while (lo < hi) {
          const mid = Math.ceil((lo + hi + 1) / 2);
          if (paragraphRangeWidth(lineStart, mid) <= maxW) lo = mid;
          else hi = mid - 1;
        }

        let lineEnd = lo;
        let nextStart = lineEnd;
        let caretEnd = lineEnd;
        if (lineEnd < paraEnd) {
          let breakAt = -1;
          for (let i = lineEnd; i > lineStart; i--) {
            if (isWrapSpace(content[i - 1])) {
              breakAt = i - 1;
              break;
            }
          }
          if (breakAt > lineStart) {
            nextStart = breakAt;
            while (nextStart < paraEnd && isWrapSpace(content[nextStart])) nextStart++;
            if (nextStart < paraEnd) {
              lineEnd = breakAt;
            }
            caretEnd = nextStart;
          } else if (isWrapSpace(content[nextStart])) {
            while (nextStart < paraEnd && isWrapSpace(content[nextStart])) nextStart++;
            caretEnd = nextStart;
          }
        }

        if (lineEnd <= lineStart) {
          lineEnd = Math.min(lineStart + 1, paraEnd);
          nextStart = lineEnd;
        }
        pushParagraphLine(lineStart, lineEnd, nextStart, caretEnd, logicalLineIndex);
      lineStart = nextStart;
      }
    }

    if (newlineAt === -1) break;
    paraStart = newlineAt + 1;
    logicalLineIndex++;
  }

  return { lines: result, lineCount: Math.max(1, knownLineCount || visualLineIndex), scriptKey, lineIndex };
}

function getWrappedLines(obj) {
  const cached = _linesCacheMap.get(obj.id);
  const content = normalizeTextContent(obj.data?.content || '');
  const scriptRanges = getTextScriptRangesForLayout(obj);
  const scriptKey = JSON.stringify(scriptRanges);
  if (
    cached &&
    cached.content === content &&
    cached.w === obj.w &&
    cached.scriptKey === scriptKey
  ) return cached.lines;

  const wrapped = buildWrappedLines(obj, { scriptRanges, scriptKey, collectLineIndex: true });
  const result = wrapped.lines;
  setCachedTextWrappedLineIndex(obj, content, scriptKey, wrapped.lineIndex || [], wrapped.lineCount);
  _linesCacheMap.set(obj.id, { content, w: obj.w, scriptKey, lines: result, lineCount: wrapped.lineCount });
  trimMapCache(_linesCacheMap, TEXT_LINES_CACHE_MAX_ENTRIES);
  return result;
}

function getWrappedLineCount(obj, text) {
  if (!obj || obj.type !== 'text') return 1;
  const cached = _linesCacheMap.get(obj.id);
  const scriptRanges = getTextScriptRangesForLayout(obj);
  const scriptKey = JSON.stringify(scriptRanges);
  if (
    cached &&
    cached.content === text &&
    cached.w === obj.w &&
    cached.scriptKey === scriptKey
  ) {
    return Math.max(1, cached.lineCount || cached.lines?.length || 1);
  }
  const cachedCount = getCachedTextWrappedLineCount(obj, text, scriptKey);
  if (cachedCount != null) {
    return cachedCount;
  }
  const wrapped = buildWrappedLines(obj, { scriptRanges, scriptKey, collect: false, collectLineIndex: true });
  setCachedTextWrappedLineIndex(obj, text, scriptKey, wrapped.lineIndex || [], wrapped.lineCount);
  return wrapped.lineCount;
}

function textLayoutLogicalLineIndexAtContentIndex(layout, index, fallback = 0) {
  const lines = Array.isArray(layout) ? layout : [];
  if (!lines.length) return fallback;
  const pos = Math.max(0, Math.trunc(Number(index)) || 0);
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    const lineStart = Math.max(0, Math.trunc(Number(lines[mid]?.startIndex)) || 0);
    if (lineStart <= pos) lo = mid;
    else hi = mid - 1;
  }
  const line = lines[lo] || lines[0];
  return Math.max(0, Math.trunc(Number(line?.logicalLineIndex)) || 0);
}

function textLogicalLineStartAt(text, lineIndex) {
  const target = Math.max(0, Math.trunc(Number(lineIndex)) || 0);
  if (target <= 0) return 0;
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n') continue;
    line++;
    if (line === target) return i + 1;
  }
  return text.length;
}

function textLogicalLineEndAt(text, start) {
  const newlineAt = text.indexOf('\n', start);
  return newlineAt === -1 ? text.length : newlineAt;
}

function wrapTextLogicalLineRange(obj, startLine, endLine, options = {}) {
  if (!obj || obj.type !== 'text') return [];
  const content = normalizeTextContent(obj.data?.content || '');
  const lineCount = textLogicalLineCount(content);
  const firstLine = Math.max(0, Math.min(Math.trunc(Number(startLine)) || 0, Math.max(0, lineCount - 1)));
  const lastLine = Math.max(firstLine, Math.min(Math.trunc(Number(endLine)) || firstLine, Math.max(0, lineCount - 1)));
  const maxW = obj.w - TEXT_PAD * 2;
  const scriptRanges = Array.isArray(options.scriptRanges)
    ? options.scriptRanges
    : getTextScriptRangesForLayout(obj);
  const scriptMetrics = options.scriptMetrics || null;
  const visualLineStartByLogicalLine = options.visualLineStartByLogicalLine instanceof Map
    ? options.visualLineStartByLogicalLine
    : null;
  const logicalLineEntriesByIndex = options.logicalLineEntriesByIndex instanceof Map
    ? options.logicalLineEntriesByIndex
    : null;
  const visualLineOffsetsByLogicalLine = new Map();
  const result = [];
  const isWrapSpace = (ch) => ch === ' ' || ch === '\t';
  const pushLine = (start, end, nextStart = end, caretEnd = end, logicalLineIndex = 0, prefixWidths = null) => {
    const visualStart = visualLineStartByLogicalLine?.get(logicalLineIndex);
    const visualOffset = visualLineOffsetsByLogicalLine.get(logicalLineIndex) || 0;
    if (visualLineStartByLogicalLine) {
      visualLineOffsetsByLogicalLine.set(logicalLineIndex, visualOffset + 1);
    }
    result.push({
      text: content.slice(start, end),
      startIndex: start,
      endIndex: end,
      caretEndIndex: caretEnd,
      nextStartIndex: nextStart,
      logicalLineIndex,
      ...(Number.isFinite(visualStart) ? { visualLineIndex: visualStart + visualOffset } : {}),
      ...(prefixWidths ? { prefixWidths } : {}),
    });
  };

  for (let logicalLineIndex = firstLine; logicalLineIndex <= lastLine; logicalLineIndex++) {
    const indexedLine = logicalLineEntriesByIndex?.get(logicalLineIndex) || null;
    const paraStart = indexedLine
      ? Math.max(0, Math.min(Math.trunc(Number(indexedLine.startIndex)) || 0, content.length))
      : textLogicalLineStartAt(content, logicalLineIndex);
    const paraEnd = indexedLine
      ? Math.max(paraStart, Math.min(Math.trunc(Number(indexedLine.endIndex)) || paraStart, content.length))
      : textLogicalLineEndAt(content, paraStart);
    if (paraStart === paraEnd) {
      pushLine(paraStart, paraStart, paraStart, paraStart, logicalLineIndex);
      continue;
    }

    const paragraphHasTab = textRangeIncludesTab(content, paraStart, paraEnd);
    const paragraphPrefixWidths = paragraphHasTab
      ? null
      : getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, content, paraStart, paraEnd, scriptRanges, '', scriptMetrics);
    const paragraphRangeWidth = (start, end) => {
      if (!paragraphPrefixWidths) return measureTextRangeW(content, start, end, scriptRanges);
      const from = Math.max(0, Math.min(start - paraStart, paragraphPrefixWidths.length - 1));
      const to = Math.max(from, Math.min(end - paraStart, paragraphPrefixWidths.length - 1));
      return Math.max(0, paragraphPrefixWidths[to] - paragraphPrefixWidths[from]);
    };
    const pushParagraphLine = (start, end, nextStart = end, caretEnd = end, logicalLineIndexForLine = logicalLineIndex) => {
      const prefixWidths = paragraphPrefixWidths
        ? textPrefixWidthsSlice(paragraphPrefixWidths, start - paraStart, end - paraStart)
        : null;
      pushLine(start, end, nextStart, caretEnd, logicalLineIndexForLine, prefixWidths);
    };
    if (paragraphRangeWidth(paraStart, paraEnd) <= maxW) {
      pushParagraphLine(paraStart, paraEnd, paraEnd, paraEnd, logicalLineIndex);
      continue;
    }
    if (!scriptRanges.length && !paragraphHasTab && paraEnd - paraStart > TEXT_EXACT_PREFIX_MAX_CHARS) {
      wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, logicalLineIndex, paragraphRangeWidth, pushParagraphLine);
      continue;
    }

    let lineStart = paraStart;
    while (lineStart < paraEnd) {
      let lo = lineStart + 1;
      let hi = paraEnd;
      if (paragraphRangeWidth(lineStart, lo) > maxW) {
        pushParagraphLine(lineStart, lo, lo, lo, logicalLineIndex);
        lineStart = lo;
        continue;
      }
      while (lo < hi) {
        const mid = Math.ceil((lo + hi + 1) / 2);
        if (paragraphRangeWidth(lineStart, mid) <= maxW) lo = mid;
        else hi = mid - 1;
      }

      let lineEnd = lo;
      let nextStart = lineEnd;
      let caretEnd = lineEnd;
      if (lineEnd < paraEnd) {
        let breakAt = -1;
        for (let i = lineEnd; i > lineStart; i--) {
          if (isWrapSpace(content[i - 1])) {
            breakAt = i - 1;
            break;
          }
        }
        if (breakAt > lineStart) {
          nextStart = breakAt;
          while (nextStart < paraEnd && isWrapSpace(content[nextStart])) nextStart++;
          if (nextStart < paraEnd) lineEnd = breakAt;
          caretEnd = nextStart;
        } else if (isWrapSpace(content[nextStart])) {
          while (nextStart < paraEnd && isWrapSpace(content[nextStart])) nextStart++;
          caretEnd = nextStart;
        }
      }

      if (lineEnd <= lineStart) {
        lineEnd = Math.min(lineStart + 1, paraEnd);
        nextStart = lineEnd;
      }
      pushParagraphLine(lineStart, lineEnd, nextStart, caretEnd, logicalLineIndex);
      lineStart = nextStart;
    }
  }

  return result;
}

function textLayoutSpliceRangeForLogicalLines(layout, startLine, endLine) {
  const lines = Array.isArray(layout) ? layout : [];
  let start = lines.length;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const lineIndex = lines[i].logicalLineIndex || 0;
    if (lineIndex >= startLine && start === lines.length) start = i;
    if (lineIndex > endLine) {
      end = i;
      break;
    }
  }
  if (start === lines.length) start = lines.length;
  if (end < start) end = start;
  return { start, end };
}

function setTextLayoutLineScriptMetrics(line, metrics) {
  if (!line) return line;
  if (metrics) {
    if (Object.prototype.hasOwnProperty.call(line, '_scriptMetrics')) {
      try {
        line._scriptMetrics = metrics;
        if (line._scriptMetrics === metrics) return line;
      } catch (_) {
        // Older cached lines may have a non-writable debug metric property.
      }
    }
    Object.defineProperty(line, '_scriptMetrics', {
      configurable: true,
      writable: true,
      value: metrics,
    });
  } else {
    delete line._scriptMetrics;
  }
  return line;
}

function layoutLineFromWrappedLine(obj, line, lineIndex, scriptRanges, scriptMetrics) {
  const y = obj.y + TEXT_PAD + lineIndex * LINE_H;
  const prefixWidths = (
    line?.prefixWidths &&
    line.prefixWidths.length === String(line.text ?? '').length + 1
  )
    ? line.prefixWidths
    : getTextRangePrefixWidths(line.text, line.startIndex, scriptRanges, obj.data.content, scriptMetrics);
  const layoutLine = {
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
    logicalLineIndex: line.logicalLineIndex || 0,
    align: textLineAlignAt(obj, line.logicalLineIndex || 0),
    scriptRanges,
    y,
    textY: y + TEXT_BASELINE_Y_OFFSET,
    prefixWidths,
  };
  return setTextLayoutLineScriptMetrics(layoutLine, scriptMetrics);
}

function wrappedLineFromLayoutLine(line) {
  return {
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
    logicalLineIndex: line.logicalLineIndex || 0,
    ...(line?.prefixWidths ? { prefixWidths: line.prefixWidths } : {}),
  };
}

function wrappedLinesFromLayout(layout) {
  const lines = new Array(layout.length);
  for (let i = 0; i < layout.length; i++) lines[i] = wrappedLineFromLayoutLine(layout[i]);
  return lines;
}

function wrappedLineIndexFromLayout(layout) {
  const lines = Array.isArray(layout) ? layout : [];
  const entries = [];
  for (let visualLineIndex = 0; visualLineIndex < lines.length; visualLineIndex++) {
    const line = lines[visualLineIndex] || {};
    const logicalLineIndex = Math.max(0, Math.trunc(Number(line.logicalLineIndex)) || 0);
    let entry = entries[entries.length - 1];
    if (!entry || entry.logicalLineIndex !== logicalLineIndex) {
      entry = {
        logicalLineIndex,
        startIndex: Math.max(0, Math.trunc(Number(line.startIndex)) || 0),
        endIndex: Math.max(0, Math.trunc(Number(line.endIndex)) || 0),
        visualStart: visualLineIndex,
        visualEnd: visualLineIndex,
      };
      entries.push(entry);
    } else {
      entry.startIndex = Math.min(entry.startIndex, Math.max(0, Math.trunc(Number(line.startIndex)) || 0));
      entry.endIndex = Math.max(entry.endIndex, Math.max(0, Math.trunc(Number(line.endIndex)) || 0));
      entry.visualEnd = visualLineIndex;
    }
  }
  return entries;
}

function patchTextObjectLayoutAfterInput(obj, options = {}) {
  if (!obj || obj.type !== 'text' || !Array.isArray(obj._layoutCache)) return false;
  const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
  obj._lastTextLayoutLineDelta = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const debug = collectDiagnostics ? {
    ok: false,
    reason: '',
    oldLayoutLines: Array.isArray(obj._layoutCache) ? obj._layoutCache.length : 0,
  } : null;
  const fail = (reason) => {
    if (collectDiagnostics) {
      debug.reason = reason;
      obj._lastTextLayoutPatchDebug = debug;
    }
    return false;
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  const oldContent = normalizeTextContent(options.oldContent ?? obj._layoutCacheContent ?? '');
  const newContent = normalizeTextContent(options.newContent ?? obj.data?.content ?? '');
  if (obj._layoutCacheContent !== oldContent || obj._layoutCacheW !== obj.w) {
    return collectDiagnostics ? fail('stale-layout-cache') : false;
  }
  const start = Math.max(0, Math.min(Math.trunc(Number(options.start)) || 0, oldContent.length));
  const end = Math.max(start, Math.min(Math.trunc(Number(options.end)) || start, oldContent.length));
  const insertedText = normalizeTextContent(options.insertedText ?? newContent.slice(start, Math.max(start, newContent.length - (oldContent.length - end))));
  const deltaChars = newContent.length - oldContent.length;
  if (deltaChars !== insertedText.length - (end - start)) {
    return collectDiagnostics ? fail('content-delta-mismatch') : false;
  }

  const layout = obj._layoutCache;
  const insertedLineCount = textNewlineCount(insertedText);
  const removedLineCount = textNewlineCount(oldContent.slice(start, end));
  const endLineProbe = end > start && removedLineCount > 0 ? end : (end > start ? end - 1 : end);
  const oldRange = {
    startLine: textLayoutLogicalLineIndexAtContentIndex(layout, start),
    endLine: textLayoutLogicalLineIndexAtContentIndex(layout, endLineProbe),
  };
  const newRange = {
    startLine: oldRange.startLine,
    endLine: oldRange.startLine + insertedLineCount,
  };
  const logicalLineDelta = insertedLineCount - removedLineCount;

  const oldScriptKey = obj._layoutCacheScriptKey || '';
  let oldScriptRanges = [];
  for (const line of layout) {
    if (!Array.isArray(line?.scriptRanges)) continue;
    oldScriptRanges = line.scriptRanges;
    break;
  }
  const oldSplice = textLayoutSpliceRangeForLogicalLines(layout, oldRange.startLine, oldRange.endLine);

  const scriptRanges = getTextScriptRangesForLayout(obj);
  const scriptKey = JSON.stringify(scriptRanges);
  const alignKey = textLayoutAlignKey(obj, newContent);

  const patchedScriptMetrics = scriptRanges.length
    ? patchTextScriptLayoutMetricsForObjectAfterInput(obj, {
      oldContent,
      newContent,
      start,
      end,
      insertedText,
      oldScriptRanges,
      newScriptRanges: scriptRanges,
      oldScriptKey,
      newScriptKey: scriptKey,
    })
    : null;
  const scriptMetrics = scriptRanges.length
    ? (patchedScriptMetrics || getTextScriptLayoutMetricsForObject(obj, newContent, scriptRanges, scriptKey))
    : null;
  if (collectDiagnostics) {
    const scriptMetricsPatchDebug = obj._lastTextScriptMetricsPatchDebug || {};
    debug.scriptMetricsPatched = !!patchedScriptMetrics;
    debug.scriptMetricsPatchReason = scriptMetricsPatchDebug.reason || '';
    debug.scriptMetricsInsertedRangeCount = scriptMetricsPatchDebug.insertedScriptRangeCount ?? '';
    debug.scriptMetricsDeletedRangeCount = scriptMetricsPatchDebug.deletedScriptRangeCount ?? '';
    debug.scriptMetricsOperation = scriptMetricsPatchDebug.operation || '';
  }

  const newWrapped = wrapTextLogicalLineRange(obj, newRange.startLine, newRange.endLine, {
    scriptRanges,
    scriptMetrics,
  });

  const insertedLayout = new Array(newWrapped.length);
  for (let i = 0; i < newWrapped.length; i++) {
    insertedLayout[i] = layoutLineFromWrappedLine(obj, newWrapped[i], oldSplice.start + i, scriptRanges, scriptMetrics);
  }

  const removedLayoutCount = oldSplice.end - oldSplice.start;
  const layoutLineDelta = insertedLayout.length - removedLayoutCount;
  obj._lastTextLayoutLineDelta = layoutLineDelta;

  const yChanged = obj._layoutCacheY !== obj.y;
  for (let i = 0; i < oldSplice.start; i++) {
    const line = layout[i];
    line.scriptRanges = scriptRanges;
    line.align = textLineAlignAt(obj, line.logicalLineIndex || 0);
    if (yChanged) {
      line.y = obj.y + TEXT_PAD + i * LINE_H;
      line.textY = line.y + TEXT_BASELINE_Y_OFFSET;
    }
    setTextLayoutLineScriptMetrics(line, scriptMetrics);
  }
  for (let i = oldSplice.end; i < layout.length; i++) {
    const line = layout[i];
    const lineIndex = i + layoutLineDelta;
    line.startIndex += deltaChars;
    line.endIndex += deltaChars;
    if (Number.isFinite(line.caretEndIndex)) line.caretEndIndex += deltaChars;
    if (Number.isFinite(line.nextStartIndex)) line.nextStartIndex += deltaChars;
    line.logicalLineIndex = (line.logicalLineIndex || 0) + logicalLineDelta;
    line.align = textLineAlignAt(obj, line.logicalLineIndex || 0);
    line.scriptRanges = scriptRanges;
    line.y = obj.y + TEXT_PAD + lineIndex * LINE_H;
    line.textY = line.y + TEXT_BASELINE_Y_OFFSET;
    setTextLayoutLineScriptMetrics(line, scriptMetrics);
  }
  replaceArraySegmentInPlace(layout, oldSplice.start, removedLayoutCount, insertedLayout);

  obj._layoutCacheContent = newContent;
  obj._layoutCacheW = obj.w;
  obj._layoutCacheScriptKey = scriptKey;
  obj._layoutCacheAlignKey = alignKey;
  obj._layoutCacheY = obj.y;
  obj._layoutCache = layout;

  const cachedWrapped = _linesCacheMap.get(obj.id);
  if (
    cachedWrapped &&
    cachedWrapped.content === oldContent &&
    cachedWrapped.w === obj.w &&
    cachedWrapped.scriptKey === oldScriptKey &&
    Array.isArray(cachedWrapped.lines)
  ) {
    for (let i = oldSplice.end; i < cachedWrapped.lines.length; i++) {
      const line = cachedWrapped.lines[i];
      line.startIndex += deltaChars;
      line.endIndex += deltaChars;
      if (Number.isFinite(line.caretEndIndex)) line.caretEndIndex += deltaChars;
      if (Number.isFinite(line.nextStartIndex)) line.nextStartIndex += deltaChars;
      line.logicalLineIndex = (line.logicalLineIndex || 0) + logicalLineDelta;
    }
    replaceArraySegmentInPlace(cachedWrapped.lines, oldSplice.start, removedLayoutCount, newWrapped);
    cachedWrapped.content = newContent;
    cachedWrapped.w = obj.w;
    cachedWrapped.scriptKey = scriptKey;
    cachedWrapped.lineCount = Math.max(1, layout.length);
  } else {
    _linesCacheMap.set(obj.id, {
      content: newContent,
      w: obj.w,
      scriptKey,
      lines: wrappedLinesFromLayout(layout),
      lineCount: Math.max(1, layout.length),
    });
  }
  trimMapCache(_linesCacheMap, TEXT_LINES_CACHE_MAX_ENTRIES);
  setCachedTextWrappedLineIndex(obj, newContent, scriptKey, wrappedLineIndexFromLayout(layout), layout.length);

  if (collectDiagnostics) {
    debug.ok = true;
    debug.newLayoutLines = layout.length;
    debug.removedLayoutLines = removedLayoutCount;
    debug.insertedLayoutLines = insertedLayout.length;
    debug.layoutLineDelta = layoutLineDelta;
    debug.logicalLineDelta = logicalLineDelta;
    debug.deltaChars = deltaChars;
    debug.scriptRangeCount = scriptRanges.length;
    obj._lastTextLayoutPatchDebug = debug;
  }
  return true;
}

function getCachedTextLayoutLineCount(obj, text) {
  if (!obj || obj.type !== 'text' || !Array.isArray(obj._layoutCache)) return null;
  if (obj._layoutCacheContent !== text || obj._layoutCacheW !== obj.w) return null;
  const scriptKey = JSON.stringify(getTextScriptRangesForLayout(obj));
  const alignKey = textLayoutAlignKey(obj, text);
  if (obj._layoutCacheScriptKey !== scriptKey || obj._layoutCacheAlignKey !== alignKey) return null;
  return Math.max(1, obj._layoutCache.length);
}

function getTextAutoHeight(obj, minLines = 1) {
  const content = normalizeTextContent(obj?.data?.content || '');
  const lineCount = getCachedTextLayoutLineCount(obj, content) ?? getWrappedLineCount(obj, content);
  return Math.max(minLines, lineCount) * LINE_H + TEXT_PAD * 2;
}

const isTextWordSeparator = (ch) => ch === ' ' || ch === '\t';
const isTextLineSeparator = (ch) => ch === '\n';
const isTextWordOrLineSeparator = (ch) => isTextWordSeparator(ch) || isTextLineSeparator(ch);
const TEXT_LINE_ALIGN_VALUES = Object.freeze(['left', 'center', 'right']);
const TEXT_SCRIPT_KINDS = Object.freeze(['sup', 'sub']);

const normalizeTextLineAlignValue = (value) => TEXT_LINE_ALIGN_VALUES.includes(value) ? value : 'left';

const textNewlineCount = (value) => {
  const text = normalizeTextContent(value);
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
};

const textLogicalLineCount = (value) => textNewlineCount(value) + 1;

const normalizeTextLineAlignForContent = (content, lineAlign = []) => {
  const count = textLogicalLineCount(content);
  const source = Array.isArray(lineAlign) ? lineAlign : [];
  const result = new Array(count);
  for (let i = 0; i < count; i++) result[i] = normalizeTextLineAlignValue(source[i]);
  while (result.length && result[result.length - 1] === 'left') result.pop();
  return result;
};

const textLineAlignAt = (obj, logicalLineIndex = 0) => {
  const align = obj?.data?.lineAlign?.[logicalLineIndex];
  return normalizeTextLineAlignValue(align);
};

const textLogicalLineRangeForSelection = (value, selection = {}) => {
  const text = normalizeTextContent(value);
  const start = Math.max(0, Math.min(selection.start ?? 0, text.length));
  const end = Math.max(0, Math.min(selection.end ?? start, text.length));
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const lastIndex = to > from ? to - 1 : from;
  let startLine = 0;
  let endLine = 0;
  for (let i = 0; i < lastIndex; i++) {
    if (text[i] !== '\n') continue;
    endLine++;
    if (i < from) startLine++;
  }
  return { startLine, endLine };
};

const cycleTextLineAlignValue = (align, direction) => {
  const current = normalizeTextLineAlignValue(align);
  const index = TEXT_LINE_ALIGN_VALUES.indexOf(current);
  const delta = direction === 'left' ? -1 : 1;
  const nextIndex = Math.max(0, Math.min(TEXT_LINE_ALIGN_VALUES.length - 1, index + delta));
  return TEXT_LINE_ALIGN_VALUES[nextIndex];
};

const applyTextLineAlignmentRange = (obj, startLine = 0, endLine = startLine, direction = 'right') => {
  if (!obj || obj.type !== 'text') return false;
  if (!obj.data) obj.data = {};
  const content = normalizeTextContent(obj.data.content);
  const count = textLogicalLineCount(content);
  if (!count) return false;
  const start = Math.max(0, Math.min(Math.trunc(Number(startLine)) || 0, count - 1));
  const end = Math.max(start, Math.min(Math.trunc(Number(endLine)) || start, count - 1));
  const next = normalizeTextLineAlignForContent(content, obj.data.lineAlign);
  while (next.length < count) next.push('left');
  let changed = false;
  for (let i = start; i <= end; i++) {
    const aligned = cycleTextLineAlignValue(next[i], direction);
    if (aligned === next[i]) continue;
    next[i] = aligned;
    changed = true;
  }
  if (!changed) return false;
  const normalized = normalizeTextLineAlignForContent(content, next);
  if (normalized.length) obj.data.lineAlign = normalized;
  else delete obj.data.lineAlign;
  clearTextObjectLayoutRuntime(obj, { script: false });
  return true;
};

const normalizeTextScriptKind = (kind) => TEXT_SCRIPT_KINDS.includes(kind) ? kind : '';
const textScriptMarkerForKind = (kind) => kind === 'sub' ? '_' : '^';
const textScriptKindForMarker = (marker) => marker === '^' ? 'sup' : marker === '_' ? 'sub' : '';
const isTextScriptBracedRange = (text, range) => {
  if (!range || range.start <= 0 || range.end <= range.start + 1 || range.end > text.length) return false;
  return text[range.start] === '{' &&
    text[range.end - 1] === '}' &&
    text[range.start - 1] === textScriptMarkerForKind(range.kind);
};

const canOpenTextScriptAt = (text, markerIndex) => {
  if (markerIndex <= 0 || markerIndex >= text.length - 1) return false;
  const kind = textScriptKindForMarker(text[markerIndex]);
  if (!kind) return false;
  if (isTextWordOrLineSeparator(text[markerIndex - 1])) return false;
  const operand = text[markerIndex + 1];
  return !!operand && !isTextWordOrLineSeparator(operand) && !textScriptKindForMarker(operand);
};

const normalizeTextScriptRangesForContent = (content, scriptRanges = []) => {
  const text = normalizeTextContent(content);
  const source = Array.isArray(scriptRanges) ? scriptRanges : [];
  const ranges = [];
  for (const range of source) {
    const kind = normalizeTextScriptKind(range?.kind);
    if (!kind) continue;
    const rawStart = Math.trunc(Number(range?.start));
    const rawEnd = Math.trunc(Number(range?.end));
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const start = Math.max(0, Math.min(rawStart, text.length));
    let end = Math.max(start, Math.min(rawEnd, text.length));
    if (text[start] === '{') {
      const balancedEnd = findBalancedTextScriptEnd(text, start);
      if (balancedEnd === -1) continue;
      end = balancedEnd;
      if (end <= start + 2) continue;
    } else {
      for (let i = start; i < end; i++) {
        if (isTextWordOrLineSeparator(text[i])) {
          end = i;
          break;
        }
      }
    }
    if (end <= start) continue;
    const markerIndex = start - 1;
    if (markerIndex < 0 || text[markerIndex] !== textScriptMarkerForKind(kind)) continue;
    if (!canOpenTextScriptAt(text, markerIndex)) continue;
    ranges.push({ start, end, kind });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const normalized = [];
  const seen = new Set();
  for (const range of ranges) {
    const key = `${range.start}:${range.end}:${range.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ...range });
  }
  return normalized;
};

const findBalancedTextScriptEnd = (content, start) => {
  const text = normalizeTextContent(content);
  const open = text[start];
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const close = pairs[open];
  if (!close) return -1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    if (text[i] === '\n') return -1;
  }
  return -1;
};

const deriveBracedTextScriptRangesFromContent = (content) => {
  const text = normalizeTextContent(content);
  const ranges = [];
  for (let i = 1; i < text.length - 2; i++) {
    const kind = textScriptKindForMarker(text[i]);
    if (!kind || text[i + 1] !== '{') continue;
    if (!canOpenTextScriptAt(text, i)) continue;
    const end = findBalancedTextScriptEnd(text, i + 1);
    if (end === -1 || end <= i + 3) continue;
    ranges.push({ start: i + 1, end, kind });
  }
  return ranges;
};

const getTextScriptRanges = (obj) => {
  if (!obj || obj.type !== 'text') return [];
  const content = normalizeTextContent(obj.data?.content);
  const source = Array.isArray(obj.data?.scriptRanges) ? obj.data.scriptRanges : [];
  const sourceKey = JSON.stringify(source);
  if (
    obj._textScriptRangesCacheContent === content &&
    obj._textScriptRangesCacheSourceKey === sourceKey &&
    Array.isArray(obj._textScriptRangesCache)
  ) {
    return obj._textScriptRangesCache;
  }
  if (!source.length && !/[\^_]/.test(content)) {
    if (obj.data) delete obj.data.scriptRanges;
    obj._textScriptRangesCache = [];
    obj._textScriptRangesCacheContent = content;
    obj._textScriptRangesCacheSourceKey = '[]';
    return [];
  }
  const bracedRanges = deriveBracedTextScriptRangesFromContent(content);
  const combined = new Array(source.length + bracedRanges.length);
  for (let i = 0; i < source.length; i++) combined[i] = source[i];
  for (let i = 0; i < bracedRanges.length; i++) combined[source.length + i] = bracedRanges[i];
  if (combined.length) {
    const normalized = normalizeTextScriptRangesForContent(content, combined);
    if (normalized.length) {
      obj.data.scriptRanges = normalized;
      obj._textScriptRangesCache = normalized;
      obj._textScriptRangesCacheContent = content;
      obj._textScriptRangesCacheSourceKey = JSON.stringify(normalized);
    } else {
      delete obj.data.scriptRanges;
      obj._textScriptRangesCache = [];
      obj._textScriptRangesCacheContent = content;
      obj._textScriptRangesCacheSourceKey = '[]';
    }
    return normalized;
  }
  if (obj.data) delete obj.data.scriptRanges;
  obj._textScriptRangesCache = [];
  obj._textScriptRangesCacheContent = content;
  obj._textScriptRangesCacheSourceKey = '[]';
  return [];
};

const getTextScriptRangesForLayout = (obj) => getTextScriptRanges(obj);

const textContentWithCanonicalScriptBraces = (content, scriptRanges = [], options = {}) => {
  const text = normalizeTextContent(content);
  let ranges = [];
  if (options.normalized === true) {
    ranges = cloneTextLayoutScriptRanges(Array.isArray(scriptRanges) ? scriptRanges : []);
  } else {
    const sourceRanges = Array.isArray(scriptRanges) ? scriptRanges : [];
    const bracedRanges = deriveBracedTextScriptRangesFromContent(text);
    const combinedRanges = new Array(sourceRanges.length + bracedRanges.length);
    for (let i = 0; i < sourceRanges.length; i++) combinedRanges[i] = sourceRanges[i];
    for (let i = 0; i < bracedRanges.length; i++) combinedRanges[sourceRanges.length + i] = bracedRanges[i];
    ranges = normalizeTextScriptRangesForContent(text, combinedRanges);
  }
  if (!ranges.length) return text;

  const rangesByMarkerIndex = new Map();
  for (const range of ranges) {
    const markerIndex = range.start - 1;
    if (markerIndex < 0) continue;
    const existing = rangesByMarkerIndex.get(markerIndex);
    if (!existing || range.end > existing.end) rangesByMarkerIndex.set(markerIndex, range);
  }
  const markerIndices = [];
  for (const markerIndex of rangesByMarkerIndex.keys()) markerIndices.push(markerIndex);
  markerIndices.sort((a, b) => a - b);
  const nextMarkerAtOrAfter = (index) => {
    let lo = 0;
    let hi = markerIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (markerIndices[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    return markerIndices[lo] ?? Infinity;
  };

  const writeSegment = (start, end, out) => {
    let i = start;
    while (i < end) {
      const range = rangesByMarkerIndex.get(i);
      if (range && range.start === i + 1 && range.end <= end) {
        const marker = textScriptMarkerForKind(range.kind);
        out.push(marker, '{');
        if (isTextScriptBracedRange(text, range)) {
          writeSegment(range.start + 1, range.end - 1, out);
        } else {
          writeSegment(range.start, range.end, out);
        }
        out.push('}');
        i = range.end;
        continue;
      }
      const nextMarker = nextMarkerAtOrAfter(i + 1);
      const segmentEnd = Math.min(end, nextMarker);
      if (segmentEnd > i) {
        out.push(text.slice(i, segmentEnd));
        i = segmentEnd;
      } else {
        out.push(text[i] || '');
        i++;
      }
    }
  };

  const out = [];
  writeSegment(0, text.length, out);
  return out.join('');
};

const textScriptLinearToDeterministicBraces = (content, scriptRanges = [], options = {}) => (
  textContentWithCanonicalScriptBraces(content, scriptRanges, options)
);

const textObjectContentForClipboard = (obj) => {
  if (!obj || obj.type !== 'text') return '';
  const content = normalizeTextContent(obj.data?.content || '');
  const ranges = getTextScriptRanges(obj);
  const scriptKey = JSON.stringify(ranges);
  if (
    obj._textClipboardCacheContent === content &&
    obj._textClipboardCacheScriptKey === scriptKey &&
    typeof obj._textClipboardCacheValue === 'string'
  ) {
    return obj._textClipboardCacheValue;
  }
  const value = textForClipboard(textScriptLinearToDeterministicBraces(content, ranges, { normalized: true }));
  obj._textClipboardCacheContent = content;
  obj._textClipboardCacheScriptKey = scriptKey;
  obj._textClipboardCacheValue = value;
  return value;
};

const isTextScriptMarkerHiddenAt = (ranges, index, content = '') => {
  for (const range of ranges || []) {
    if (range.start === index + 1) return true;
    if (content && isTextScriptBracedRange(content, range) && (index === range.start || index === range.end - 1)) {
      return true;
    }
  }
  return false;
};

const activeTextScriptRangesAt = (ranges, index, { includeEnd = false, affinity = '' } = {}) => {
  const active = [];
  for (const range of ranges || []) {
    if (index < range.start || index > range.end) continue;
    if (index === range.end) {
      if (!includeEnd) continue;
      if (affinity === 'after') continue;
    }
    active.push(range);
  }
  if (active.length > 1) active.sort((a, b) => a.start - b.start || b.end - a.end || a.kind.localeCompare(b.kind));
  return active;
};

const textScriptOffsetForKind = (kind) => kind === 'sub' ? TEXT_SCRIPT_SUB_OFFSET : TEXT_SCRIPT_SUP_OFFSET;

const textScriptStateFromRanges = (activeRanges) => {
  const ranges = activeRanges || [];
  if (!ranges.length) return BASE_TEXT_SCRIPT_STATE;
  let offset = 0;
  const kinds = [];
  for (let i = 0; i < ranges.length; i++) {
    const kind = normalizeTextScriptKind(ranges[i]?.kind);
    if (!kind) continue;
    kinds.push(kind);
    offset += textScriptOffsetForKind(kind) * textScriptScaleForDepth(i);
  }
  const depth = kinds.length;
  return {
    depth,
    font: textFontForScriptDepth(depth),
    key: depth ? kinds.join('/') : '',
    kinds,
    offset,
    scale: textScriptScaleForDepth(depth),
  };
};

const textScriptStateAt = (ranges, index) => {
  return textScriptStateFromRanges(activeTextScriptRangesAt(ranges, index));
};

function textScriptMetricsStateAt(metrics, index) {
  const pos = Math.max(0, Math.trunc(Number(index)) || 0);
  return metrics?.states?.[pos] || BASE_TEXT_SCRIPT_STATE;
}

function textScriptMetricsCaretStateAt(metrics, index, affinity = '') {
  if (!metrics) return BASE_TEXT_SCRIPT_STATE;
  const max = Math.max(0, (metrics.caretStates?.length || 1) - 1);
  const pos = Math.max(0, Math.min(Math.trunc(Number(index)) || 0, max));
  if (affinity === 'after') return textScriptMetricsStateAt(metrics, pos);
  return metrics.caretStates?.[pos] || textScriptMetricsStateAt(metrics, pos);
}

function textScriptMetricsHiddenAt(metrics, index) {
  const pos = Math.trunc(Number(index));
  return Number.isFinite(pos) && !!metrics?.hidden?.[pos];
}

function createBaseTextScriptLayoutMetricsForLength(length) {
  const count = Math.max(0, Math.trunc(Number(length)) || 0);
  const states = new Array(count);
  const caretStates = new Array(count + 1);
  states.fill(BASE_TEXT_SCRIPT_STATE);
  caretStates.fill(BASE_TEXT_SCRIPT_STATE);
  return {
    hidden: new Uint8Array(count),
    states,
    caretStates,
    bracedStarts: new Uint8Array(count + 1),
    bracedClosings: new Uint8Array(count + 1),
    bracedEnds: new Uint8Array(count + 1),
    linearEnds: new Uint8Array(count + 1),
    anyEnds: new Uint8Array(count + 1),
  };
}

function spliceTextMetricByteArray(oldArray, start, insertedArray, newLength) {
  const oldBytes = oldArray || new Uint8Array(0);
  const inserted = insertedArray || new Uint8Array(0);
  const out = new Uint8Array(newLength);
  const prefixEnd = Math.max(0, Math.min(start, oldBytes.length));
  out.set(oldBytes.subarray(0, prefixEnd), 0);
  out.set(inserted, prefixEnd);
  out.set(oldBytes.subarray(prefixEnd), prefixEnd + inserted.length);
  return out;
}

function spliceTextMetricPositionByteArray(oldArray, start, insertedArray, newLength) {
  const oldBytes = oldArray || new Uint8Array(0);
  const inserted = insertedArray || new Uint8Array(0);
  const out = new Uint8Array(newLength);
  const boundary = Math.max(0, Math.min(start, Math.max(0, oldBytes.length - 1)));
  out.set(oldBytes.subarray(0, boundary + 1), 0);
  for (let i = 0; i < inserted.length; i++) {
    if (inserted[i]) out[boundary + i] = 1;
  }
  out.set(oldBytes.subarray(boundary + 1), boundary + inserted.length);
  return out;
}

function spliceTextMetricStateArray(oldArray, start, insertedArray) {
  const oldStates = Array.isArray(oldArray) ? oldArray : [];
  const inserted = Array.isArray(insertedArray) ? insertedArray : [];
  const boundary = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, oldStates.length));
  const out = new Array(oldStates.length + inserted.length);
  for (let i = 0; i < boundary; i++) out[i] = oldStates[i];
  for (let i = 0; i < inserted.length; i++) out[boundary + i] = inserted[i];
  for (let i = boundary; i < oldStates.length; i++) out[inserted.length + i] = oldStates[i];
  return out;
}

function spliceTextMetricCaretStateArray(oldArray, start, insertedArray) {
  const oldStates = Array.isArray(oldArray) ? oldArray : [];
  const inserted = Array.isArray(insertedArray) ? insertedArray : [];
  const startIndex = Math.trunc(Number(start)) || 0;
  const boundary = Math.max(0, Math.min(startIndex, Math.max(0, oldStates.length - 1)));
  const insertedSuffixLength = Math.max(0, inserted.length - 1);
  const prefixLength = Math.min(boundary + 1, oldStates.length);
  const out = new Array(oldStates.length + insertedSuffixLength);
  for (let i = 0; i < prefixLength; i++) out[i] = oldStates[i];
  for (let i = 1; i < inserted.length; i++) out[prefixLength + i - 1] = inserted[i];
  for (let i = prefixLength; i < oldStates.length; i++) out[insertedSuffixLength + i] = oldStates[i];
  return out;
}

function deleteTextMetricByteArray(oldArray, start, end, newLength) {
  const oldBytes = oldArray || new Uint8Array(0);
  const out = new Uint8Array(newLength);
  const prefixEnd = Math.max(0, Math.min(start, oldBytes.length));
  const suffixStart = Math.max(prefixEnd, Math.min(end, oldBytes.length));
  out.set(oldBytes.subarray(0, prefixEnd), 0);
  out.set(oldBytes.subarray(suffixStart), prefixEnd);
  return out;
}

function deleteTextMetricPositionByteArray(oldArray, start, end, newLength) {
  const oldBytes = oldArray || new Uint8Array(0);
  const out = new Uint8Array(newLength);
  const boundary = Math.max(0, Math.min(start, Math.max(0, oldBytes.length - 1)));
  const suffixStart = Math.max(boundary + 1, Math.min(end + 1, oldBytes.length));
  out.set(oldBytes.subarray(0, boundary + 1), 0);
  out.set(oldBytes.subarray(suffixStart), boundary + 1);
  return out;
}

function deleteTextMetricStateArray(oldArray, start, end) {
  const oldStates = Array.isArray(oldArray) ? oldArray : [];
  const prefixEnd = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, oldStates.length));
  const suffixStart = Math.max(prefixEnd, Math.min(Math.trunc(Number(end)) || 0, oldStates.length));
  const out = new Array(prefixEnd + oldStates.length - suffixStart);
  for (let i = 0; i < prefixEnd; i++) out[i] = oldStates[i];
  for (let i = suffixStart; i < oldStates.length; i++) out[prefixEnd + i - suffixStart] = oldStates[i];
  return out;
}

function deleteTextMetricCaretStateArray(oldArray, start, end) {
  const oldStates = Array.isArray(oldArray) ? oldArray : [];
  const startIndex = Math.trunc(Number(start)) || 0;
  const endIndex = Math.trunc(Number(end)) || 0;
  const boundary = Math.max(0, Math.min(startIndex, Math.max(0, oldStates.length - 1)));
  const suffixStart = Math.max(boundary + 1, Math.min(endIndex + 1, oldStates.length));
  const prefixLength = Math.min(boundary + 1, oldStates.length);
  const out = new Array(prefixLength + oldStates.length - suffixStart);
  for (let i = 0; i < prefixLength; i++) out[i] = oldStates[i];
  for (let i = suffixStart; i < oldStates.length; i++) out[prefixLength + i - suffixStart] = oldStates[i];
  return out;
}

function textScriptRangeKey(range) {
  return `${Math.trunc(Number(range?.start)) || 0}:${Math.trunc(Number(range?.end)) || 0}:${normalizeTextScriptKind(range?.kind)}`;
}

function shiftedTextScriptRangeKey(range, delta) {
  return `${(Math.trunc(Number(range?.start)) || 0) + delta}:${(Math.trunc(Number(range?.end)) || 0) + delta}:${normalizeTextScriptKind(range?.kind)}`;
}

function deletedTextScriptRangeKey(range, start, end, content) {
  const kind = normalizeTextScriptKind(range?.kind);
  const rangeStart = Math.trunc(Number(range?.start));
  const rangeEnd = Math.trunc(Number(range?.end));
  if (!kind || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return null;
  if (rangeEnd <= start) return `${rangeStart}:${rangeEnd}:${kind}`;
  const removedLength = Math.max(0, end - start);
  if (rangeStart >= end) return `${rangeStart - removedLength}:${rangeEnd - removedLength}:${kind}`;
  if (rangeStart <= start && rangeEnd > end) {
    const normalizedRange = { start: rangeStart, end: rangeEnd, kind };
    const isBraced = isTextScriptBracedRange(content, normalizedRange);
    if (isBraced && (start <= rangeStart || end > rangeEnd - 1)) return null;
    const nextEnd = rangeEnd - removedLength;
    if (nextEnd <= rangeStart) return null;
    return `${rangeStart}:${nextEnd}:${kind}`;
  }
  if (rangeStart - 1 >= start && rangeEnd <= end) return '';
  return null;
}

function patchTextScriptLayoutMetricsForObjectAfterInput(obj, options = {}) {
  const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const debug = collectDiagnostics ? { ok: false, reason: '' } : null;
  const fail = (reason) => {
    if (collectDiagnostics) {
      debug.reason = reason;
      obj._lastTextScriptMetricsPatchDebug = debug;
    }
    return null;
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const oldContent = normalizeTextContent(options.oldContent || '');
  const newContent = normalizeTextContent(options.newContent || '');
  const insertedText = normalizeTextContent(options.insertedText || '');
  const start = Math.max(0, Math.min(Math.trunc(Number(options.start)) || 0, oldContent.length));
  const end = Math.max(start, Math.min(Math.trunc(Number(options.end)) || start, oldContent.length));
  const removedLength = end - start;
  if (removedLength && insertedText.length) {
    return collectDiagnostics ? fail('replacement-not-supported') : null;
  }
  if (newContent.length !== oldContent.length + insertedText.length - removedLength) {
    return collectDiagnostics ? fail('length-mismatch') : null;
  }

  const oldMetrics = obj?._textScriptLayoutMetrics;
  const oldScriptRanges = Array.isArray(options.oldScriptRanges) ? options.oldScriptRanges : [];
  const newScriptRanges = Array.isArray(options.newScriptRanges) ? options.newScriptRanges : [];
  const oldScriptKey = options.oldScriptKey || JSON.stringify(oldScriptRanges);
  const newScriptKey = options.newScriptKey || JSON.stringify(newScriptRanges);
  if (!oldMetrics) return collectDiagnostics ? fail('missing-old-metrics') : null;
  if (obj._textScriptLayoutMetricsContent !== oldContent) {
    return collectDiagnostics ? fail('old-content-mismatch') : null;
  }
  if (obj._textScriptLayoutMetricsScriptKey !== oldScriptKey) {
    return collectDiagnostics ? fail('old-script-key-mismatch') : null;
  }

  const expectedNewKeys = new Set();
  const isDeletion = removedLength > 0 && insertedText.length === 0;
  if (isDeletion) {
    for (const range of oldScriptRanges) {
      const key = deletedTextScriptRangeKey(range, start, end, oldContent);
      if (key === null) return collectDiagnostics ? fail('range-crosses-delete') : null;
      if (key) expectedNewKeys.add(key);
    }
  } else {
    if (start !== end) return collectDiagnostics ? fail('replacement-not-supported') : null;
    if (activeTextScriptRangesAt(oldScriptRanges, start).length) {
      return collectDiagnostics ? fail('inside-existing-script') : null;
    }
    for (const range of oldScriptRanges) {
      if (range.end <= start) {
        expectedNewKeys.add(textScriptRangeKey(range));
      } else if (range.start >= start) {
        expectedNewKeys.add(shiftedTextScriptRangeKey(range, insertedText.length));
      } else {
        return collectDiagnostics ? fail('range-crosses-edit') : null;
      }
    }
  }

  const insertedRanges = [];
  for (const range of newScriptRanges) {
    const key = textScriptRangeKey(range);
    if (expectedNewKeys.has(key)) {
      expectedNewKeys.delete(key);
      continue;
    }
    if (range.start >= start && range.end <= start + insertedText.length) {
      insertedRanges.push({
        start: range.start - start,
        end: range.end - start,
        kind: range.kind,
      });
      continue;
    }
    return collectDiagnostics ? fail('unexpected-new-range') : null;
  }
  if (expectedNewKeys.size) return collectDiagnostics ? fail('missing-shifted-range') : null;

  if (isDeletion) {
    const metrics = {
      hidden: deleteTextMetricByteArray(oldMetrics.hidden, start, end, newContent.length),
      states: deleteTextMetricStateArray(oldMetrics.states, start, end),
      caretStates: deleteTextMetricCaretStateArray(oldMetrics.caretStates, start, end),
      bracedStarts: deleteTextMetricPositionByteArray(oldMetrics.bracedStarts, start, end, newContent.length + 1),
      bracedClosings: deleteTextMetricPositionByteArray(oldMetrics.bracedClosings, start, end, newContent.length + 1),
      bracedEnds: deleteTextMetricPositionByteArray(oldMetrics.bracedEnds, start, end, newContent.length + 1),
      linearEnds: deleteTextMetricPositionByteArray(oldMetrics.linearEnds, start, end, newContent.length + 1),
      anyEnds: deleteTextMetricPositionByteArray(oldMetrics.anyEnds, start, end, newContent.length + 1),
    };
    obj._textScriptLayoutMetrics = metrics;
    obj._textScriptLayoutMetricsContent = newContent;
    obj._textScriptLayoutMetricsScriptKey = newScriptKey;
    if (collectDiagnostics) {
      debug.ok = true;
      debug.reason = '';
      debug.insertedScriptRangeCount = 0;
      debug.deletedScriptRangeCount = Math.max(0, oldScriptRanges.length - newScriptRanges.length);
      debug.operation = 'delete';
      obj._lastTextScriptMetricsPatchDebug = debug;
    }
    return metrics;
  }

  const localMetrics = insertedRanges.length
    ? getTextScriptLayoutMetrics(insertedText, insertedRanges)
    : createBaseTextScriptLayoutMetricsForLength(insertedText.length);
  const metrics = {
    hidden: spliceTextMetricByteArray(oldMetrics.hidden, start, localMetrics.hidden, newContent.length),
    states: spliceTextMetricStateArray(oldMetrics.states, start, localMetrics.states),
    caretStates: spliceTextMetricCaretStateArray(oldMetrics.caretStates, start, localMetrics.caretStates),
    bracedStarts: spliceTextMetricPositionByteArray(oldMetrics.bracedStarts, start, localMetrics.bracedStarts, newContent.length + 1),
    bracedClosings: spliceTextMetricPositionByteArray(oldMetrics.bracedClosings, start, localMetrics.bracedClosings, newContent.length + 1),
    bracedEnds: spliceTextMetricPositionByteArray(oldMetrics.bracedEnds, start, localMetrics.bracedEnds, newContent.length + 1),
    linearEnds: spliceTextMetricPositionByteArray(oldMetrics.linearEnds, start, localMetrics.linearEnds, newContent.length + 1),
    anyEnds: spliceTextMetricPositionByteArray(oldMetrics.anyEnds, start, localMetrics.anyEnds, newContent.length + 1),
  };
  obj._textScriptLayoutMetrics = metrics;
  obj._textScriptLayoutMetricsContent = newContent;
  obj._textScriptLayoutMetricsScriptKey = newScriptKey;
  if (collectDiagnostics) {
    debug.ok = true;
    debug.reason = '';
    debug.insertedScriptRangeCount = insertedRanges.length;
    debug.deletedScriptRangeCount = 0;
    debug.operation = 'insert';
    obj._lastTextScriptMetricsPatchDebug = debug;
  }
  return metrics;
}

function getTextScriptLayoutMetrics(content, scriptRanges = []) {
  const text = normalizeTextContent(content);
  const ranges = Array.isArray(scriptRanges) ? scriptRanges : [];
  const cacheKey = `${text}\n${JSON.stringify(ranges)}`;
  const hit = _scriptIndexCache.get(cacheKey);
  if (hit) {
    _scriptIndexCache.delete(cacheKey);
    _scriptIndexCache.set(cacheKey, hit);
    return hit;
  }

  const hidden = new Uint8Array(text.length);
  const states = new Array(text.length);
  const caretStates = new Array(text.length + 1);
  const bracedStarts = new Uint8Array(text.length + 1);
  const bracedClosings = new Uint8Array(text.length + 1);
  const bracedEnds = new Uint8Array(text.length + 1);
  const linearEnds = new Uint8Array(text.length + 1);
  const anyEnds = new Uint8Array(text.length + 1);
  const starts = new Map();
  const ends = new Map();
  const indexedRanges = [];
  const addEvent = (map, index, range) => {
    const list = map.get(index);
    if (list) list.push(range);
    else map.set(index, [range]);
  };

  for (const sourceRange of ranges) {
    const kind = normalizeTextScriptKind(sourceRange?.kind);
    const rawStart = Math.trunc(Number(sourceRange?.start));
    const rawEnd = Math.trunc(Number(sourceRange?.end));
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const start = Math.max(0, Math.min(rawStart, text.length));
    const end = Math.max(start, Math.min(rawEnd, text.length));
    if (!kind || end <= start) continue;
    const range = { start, end, kind };
    indexedRanges.push(range);
    addEvent(starts, start, range);
    addEvent(ends, end, range);
    anyEnds[end] = 1;
    const markerIndex = start - 1;
    if (markerIndex >= 0 && markerIndex < hidden.length) hidden[markerIndex] = 1;
    if (isTextScriptBracedRange(text, range)) {
      bracedStarts[start] = 1;
      bracedEnds[end] = 1;
      if (start >= 0 && start < hidden.length) hidden[start] = 1;
      if (end - 1 >= 0 && end - 1 < hidden.length) {
        hidden[end - 1] = 1;
        bracedClosings[end - 1] = 1;
      }
    } else {
      linearEnds[end] = 1;
    }
  }

  let active = [];
  let state = BASE_TEXT_SCRIPT_STATE;
  const refreshState = () => {
    if (!active.length) {
      state = BASE_TEXT_SCRIPT_STATE;
      return;
    }
    if (active.length === 1) {
      state = textScriptStateFromRanges(active);
      return;
    }
    const sorted = new Array(active.length);
    for (let i = 0; i < active.length; i++) sorted[i] = active[i];
    sorted.sort((a, b) => a.start - b.start || b.end - a.end || a.kind.localeCompare(b.kind));
    state = textScriptStateFromRanges(sorted);
  };

  for (let index = 0; index <= text.length; index++) {
    let changed = false;
    const starting = starts.get(index);
    if (starting) {
      for (const range of starting) active.push(range);
      changed = true;
    }
    if (changed) refreshState();
    caretStates[index] = state;

    const ending = ends.get(index);
    if (ending) {
      let write = 0;
      for (let read = 0; read < active.length; read++) {
        const range = active[read];
        let remove = false;
        for (const endedRange of ending) {
          if (range === endedRange) {
            remove = true;
            break;
          }
        }
        if (!remove) active[write++] = range;
      }
      active.length = write;
      refreshState();
    }
    if (index < text.length) states[index] = state;
  }

  const result = {
    hidden,
    states,
    caretStates,
    bracedStarts,
    bracedClosings,
    bracedEnds,
    linearEnds,
    anyEnds,
  };
  _scriptIndexCache.set(cacheKey, result);
  trimMapCache(_scriptIndexCache, TEXT_SCRIPT_INDEX_CACHE_MAX_ENTRIES);
  return result;
}

function getTextScriptLayoutMetricsForObject(obj, content, scriptRanges = [], scriptKey = '') {
  const text = normalizeTextContent(content);
  const ranges = Array.isArray(scriptRanges) ? scriptRanges : [];
  if (!ranges.length) return null;
  const key = scriptKey || obj?._layoutCacheScriptKey || JSON.stringify(ranges);
  if (
    obj?._textScriptLayoutMetrics &&
    obj._textScriptLayoutMetricsContent === text &&
    obj._textScriptLayoutMetricsScriptKey === key
  ) {
    return obj._textScriptLayoutMetrics;
  }
  const metrics = getTextScriptLayoutMetrics(text, ranges);
  if (obj) {
    obj._textScriptLayoutMetrics = metrics;
    obj._textScriptLayoutMetricsContent = text;
    obj._textScriptLayoutMetricsScriptKey = key;
  }
  return metrics;
}

const textScriptCaretStateAt = (obj, index) => {
  const ranges = getTextScriptRanges(obj);
  const affinity = obj?._textScriptCaretIndex === index ? obj._textScriptCaretAffinity : '';
  return textScriptStateFromRanges(activeTextScriptRangesAt(ranges, index, { includeEnd: true, affinity }));
};

const textScriptCaretStateForHit = (obj, index, affinity = '') => (
  textScriptStateFromRanges(activeTextScriptRangesAt(getTextScriptRanges(obj), index, { includeEnd: true, affinity }))
);

const getTextMinWidthWordSegment = (obj) => {
  const empty = { text: '', word: '', width: 0, lineIndex: -1, startOffset: 0, endOffset: 0 };
  if (!obj || obj.type !== 'text') return empty;

  const content = normalizeTextContent(obj.data?.content || '');
  const scriptRanges = getTextScriptRangesForLayout(obj);
  const scriptKey = JSON.stringify(scriptRanges);
  if (
    obj._textMinWidthWordSegmentCacheContent === content &&
    obj._textMinWidthWordSegmentCacheScriptKey === scriptKey &&
    obj._textMinWidthWordSegmentCache
  ) {
    return obj._textMinWidthWordSegmentCache;
  }
  const lines = content.split('\n');
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
    : null;
  let best = empty;
  let contentOffset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const prefixWidths = getTextObjectParagraphPrefixWidthsForNormalizedContent(
      obj,
      content,
      contentOffset,
      contentOffset + line.length,
      scriptRanges,
      scriptKey,
      scriptMetrics,
    );
    const segmentWidth = (start, end) => {
      const from = Math.max(0, Math.min(start, prefixWidths.length - 1));
      const to = Math.max(from, Math.min(end, prefixWidths.length - 1));
      return Math.max(0, prefixWidths[to] - prefixWidths[from]);
    };
    let i = 0;
    while (i < line.length && isTextWordSeparator(line[i])) i++;

    let isFirstWord = true;
    while (i < line.length) {
      if (!isFirstWord) {
        while (i < line.length && isTextWordSeparator(line[i])) i++;
        if (i >= line.length) break;
      }

      const wordStart = i;
      while (i < line.length && !isTextWordSeparator(line[i])) i++;
      const wordEnd = i;
      const segmentStart = isFirstWord ? 0 : wordStart;
      const text = line.slice(segmentStart, wordEnd);
      const width = segmentWidth(segmentStart, wordEnd);

      if (width > best.width) {
        best = {
          text,
          word: line.slice(wordStart, wordEnd),
          width,
          lineIndex,
          startOffset: contentOffset + segmentStart,
          endOffset: contentOffset + wordEnd,
        };
      }
      isFirstWord = false;
    }

    contentOffset += line.length + 1;
  }

  obj._textMinWidthWordSegmentCacheContent = content;
  obj._textMinWidthWordSegmentCacheScriptKey = scriptKey;
  obj._textMinWidthWordSegmentCache = best;
  return best;
};

const getTextMinWidth = (obj) => {
  if (!obj || obj.type !== 'text') return TEXT_PAD * 2 + 1;
  return Math.ceil(getTextMinWidthWordSegment(obj).width + TEXT_PAD * 2 + 1);
};

const getTextRenderedContentWidth = (obj) => {
  if (!obj || obj.type !== 'text') return TEXT_PAD * 2 + 1;
  let maxLineW = 0;
  for (const line of getTextLayout(obj)) {
    maxLineW = Math.max(maxLineW, lineVisibleWidth(line));
  }
  return Math.max(getTextMinWidth(obj), Math.ceil(maxLineW + TEXT_PAD * 2 + 1));
};

function syncTextAutoHeight(obj, minLines = 1) {
  if (!obj || obj.type !== 'text') return false;
  const h = getTextAutoHeight(obj, minLines);
  if (obj.h === h) return false;
  obj.h = h;
  return true;
}

function getTextMinLines(obj) {
  return obj && obj.id === editingId ? (obj._editMinLines || 1) : 1;
}

function syncAllTextAutoHeights() {
  let changed = false;
  for (const obj of objects) {
    if (syncTextAutoHeight(obj)) {
      markDirty(obj.id);
      changed = true;
    }
  }
  return changed;
}

function calculateTextLayout(obj) {
  const lines = getWrappedLines(obj);
  const scriptRanges = getTextScriptRangesForLayout(obj);
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, obj.data.content, scriptRanges)
    : null;
  const layout = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    layout[i] = layoutLineFromWrappedLine(obj, lines[i], i, scriptRanges, scriptMetrics);
  }
  return layout;
}

function textLayoutAlignKey(obj, content) {
  if (!Array.isArray(obj?.data?.lineAlign) || !obj.data.lineAlign.length) return '';
  return JSON.stringify(normalizeTextLineAlignForContent(content, obj.data.lineAlign));
}

function syncTextLayoutLinePositions(obj, layout) {
  if (!Array.isArray(layout)) return;
  for (let i = 0; i < layout.length; i++) {
    const y = obj.y + TEXT_PAD + i * LINE_H;
    layout[i].y = y;
    layout[i].textY = y + TEXT_BASELINE_Y_OFFSET;
  }
}

function setTextLayoutTotalLines(layout, totalLines) {
  if (!Array.isArray(layout)) return layout;
  layout.totalLines = Math.max(layout.length, Math.trunc(Number(totalLines)) || layout.length);
  return layout;
}

function getCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last) {
  if (!obj || obj.type !== 'text') return null;
  const cache = obj._textViewportLayoutRangeCache;
  if (
    !cache ||
    typeof cache.get !== 'function' ||
    obj._textViewportLayoutRangeCacheContent !== content ||
    obj._textViewportLayoutRangeCacheW !== obj.w ||
    obj._textViewportLayoutRangeCacheScriptKey !== scriptKey ||
    obj._textViewportLayoutRangeCacheAlignKey !== alignKey ||
    obj._textViewportLayoutRangeCacheY !== obj.y
  ) {
    return null;
  }
  const key = `${first}:${last}`;
  const layout = cache.get(key);
  if (!layout) return null;
  cache.delete(key);
  cache.set(key, layout);
  return layout;
}

function textViewportLineIndexFromLayoutLine(obj, line) {
  const y = Number(line?.y);
  if (!Number.isFinite(y)) return null;
  const index = Math.round((y - obj.y - TEXT_PAD) / LINE_H);
  return Number.isFinite(index) && index >= 0 ? index : null;
}

function ensureTextViewportLayoutLineCache(obj, content, scriptKey, alignKey, totalLines = 0) {
  if (!obj || obj.type !== 'text') return null;
  if (
    obj._textViewportLayoutLineCacheContent !== content ||
    obj._textViewportLayoutLineCacheW !== obj.w ||
    obj._textViewportLayoutLineCacheScriptKey !== scriptKey ||
    obj._textViewportLayoutLineCacheAlignKey !== alignKey ||
    obj._textViewportLayoutLineCacheY !== obj.y ||
    !obj._textViewportLayoutLineCache ||
    typeof obj._textViewportLayoutLineCache.set !== 'function'
  ) {
    obj._textViewportLayoutLineCacheContent = content;
    obj._textViewportLayoutLineCacheW = obj.w;
    obj._textViewportLayoutLineCacheScriptKey = scriptKey;
    obj._textViewportLayoutLineCacheAlignKey = alignKey;
    obj._textViewportLayoutLineCacheY = obj.y;
    obj._textViewportLayoutLineCacheLineCount = Math.max(0, Math.trunc(Number(totalLines)) || 0);
    obj._textViewportLayoutLineCache = new Map();
  } else if (totalLines > 0) {
    obj._textViewportLayoutLineCacheLineCount = Math.max(
      Math.trunc(Number(obj._textViewportLayoutLineCacheLineCount)) || 0,
      Math.trunc(Number(totalLines)) || 0,
    );
  }
  return obj._textViewportLayoutLineCache;
}

function getCachedTextViewportLayoutLines(obj, content, scriptKey, alignKey, first, last) {
  const cache = ensureTextViewportLayoutLineCache(obj, content, scriptKey, alignKey);
  const totalLines = Math.trunc(Number(obj?._textViewportLayoutLineCacheLineCount)) || 0;
  if (!cache || totalLines <= 0 || first >= totalLines) return null;
  const actualLast = Math.min(last, totalLines - 1);
  const layout = [];
  for (let index = first; index <= actualLast; index++) {
    const line = cache.get(index);
    if (!line) return null;
    layout.push(line);
  }
  return setTextLayoutTotalLines(layout, totalLines);
}

function setCachedTextViewportLayoutLines(obj, content, scriptKey, alignKey, layout, totalLines) {
  const cache = ensureTextViewportLayoutLineCache(obj, content, scriptKey, alignKey, totalLines);
  if (!cache || !Array.isArray(layout)) return;
  for (const line of layout) {
    const index = textViewportLineIndexFromLayoutLine(obj, line);
    if (index == null) continue;
    cache.set(index, line);
  }
  trimMapCache(cache, TEXT_VIEWPORT_LAYOUT_LINE_CACHE_MAX_ENTRIES);
}

function setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, layout, totalLines) {
  if (!obj || obj.type !== 'text' || !Array.isArray(layout)) return layout;
  if (
    obj._textViewportLayoutRangeCacheContent !== content ||
    obj._textViewportLayoutRangeCacheW !== obj.w ||
    obj._textViewportLayoutRangeCacheScriptKey !== scriptKey ||
    obj._textViewportLayoutRangeCacheAlignKey !== alignKey ||
    obj._textViewportLayoutRangeCacheY !== obj.y ||
    !obj._textViewportLayoutRangeCache ||
    typeof obj._textViewportLayoutRangeCache.set !== 'function'
  ) {
    obj._textViewportLayoutRangeCacheContent = content;
    obj._textViewportLayoutRangeCacheW = obj.w;
    obj._textViewportLayoutRangeCacheScriptKey = scriptKey;
    obj._textViewportLayoutRangeCacheAlignKey = alignKey;
    obj._textViewportLayoutRangeCacheY = obj.y;
    obj._textViewportLayoutRangeCache = new Map();
  }
  const out = setTextLayoutTotalLines(layout, totalLines);
  setCachedTextViewportLayoutLines(obj, content, scriptKey, alignKey, out, totalLines);
  obj._textViewportLayoutRangeCache.set(`${first}:${last}`, out);
  trimMapCache(obj._textViewportLayoutRangeCache, TEXT_VIEWPORT_LAYOUT_RANGE_CACHE_MAX_ENTRIES);
  return out;
}

function textViewportLayoutLineCacheMissingSpans(obj, content, scriptKey, alignKey, first, last, totalLines) {
  const cache = ensureTextViewportLayoutLineCache(obj, content, scriptKey, alignKey, totalLines);
  const count = Math.max(0, Math.trunc(Number(totalLines)) || 0);
  if (!cache || count <= 0 || first >= count) return [];
  const actualLast = Math.min(last, count - 1);
  const spans = [];
  let spanStart = null;
  for (let index = first; index <= actualLast; index++) {
    if (!cache.has(index)) {
      if (spanStart == null) spanStart = index;
    } else if (spanStart != null) {
      spans.push({ first: spanStart, last: index - 1 });
      spanStart = null;
    }
  }
  if (spanStart != null) spans.push({ first: spanStart, last: actualLast });
  return spans;
}

function buildTextViewportLayoutRangeFromLineIndex(obj, content, scriptRanges, scriptKey, alignKey, first, last, lineIndexCache) {
  const totalLines = Math.max(1, Math.trunc(Number(lineIndexCache?.lineCount)) || 1);
  if (first >= totalLines) {
    return setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, [], totalLines);
  }
  const actualLast = Math.min(last, totalLines - 1);
  const firstEntry = textWrappedLineIndexEntryForVisual(lineIndexCache, first);
  const lastEntry = textWrappedLineIndexEntryForVisual(lineIndexCache, actualLast);
  if (!firstEntry || !lastEntry) return null;
  const visualLineStartByLogicalLine = new Map();
  const logicalLineEntriesByIndex = new Map();
  for (let i = firstEntry.index; i <= lastEntry.index; i++) {
    const entry = lineIndexCache.entries[i];
    if (entry) {
      visualLineStartByLogicalLine.set(entry.logicalLineIndex, entry.visualStart);
      logicalLineEntriesByIndex.set(entry.logicalLineIndex, entry);
    }
  }
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
    : null;
  const wrappedSourceLines = wrapTextLogicalLineRange(obj, firstEntry.entry.logicalLineIndex, lastEntry.entry.logicalLineIndex, {
    scriptRanges,
    scriptMetrics,
    visualLineStartByLogicalLine,
    logicalLineEntriesByIndex,
  });
  const wrappedLines = [];
  for (const line of wrappedSourceLines) {
    if (
      Number.isFinite(line?.visualLineIndex) &&
      line.visualLineIndex >= first &&
      line.visualLineIndex <= actualLast
    ) {
      wrappedLines.push(line);
    }
  }
  const layout = new Array(wrappedLines.length);
  for (let i = 0; i < wrappedLines.length; i++) {
    const line = wrappedLines[i];
    layout[i] = layoutLineFromWrappedLine(
      obj,
      line,
      line.visualLineIndex,
      scriptRanges,
      scriptMetrics,
    );
  }
  return setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, layout, totalLines);
}

function getTextLayout(obj) {
  const content = normalizeTextContent(obj.data?.content || '');
  const scriptKey = JSON.stringify(getTextScriptRangesForLayout(obj));
  const alignKey = textLayoutAlignKey(obj, content);
  if (
    obj._layoutCache &&
    obj._layoutCacheContent === content &&
    obj._layoutCacheW === obj.w &&
    obj._layoutCacheScriptKey === scriptKey &&
    obj._layoutCacheAlignKey === alignKey
  ) {
    if (obj._layoutCacheY !== obj.y) {
      syncTextLayoutLinePositions(obj, obj._layoutCache);
      obj._layoutCacheY = obj.y;
    }
    return obj._layoutCache;
  }
  obj._layoutCacheContent = content;
  obj._layoutCacheW = obj.w;
  obj._layoutCacheScriptKey = scriptKey;
  obj._layoutCacheAlignKey = alignKey;
  obj._layoutCacheY = obj.y;
  obj._layoutCache = calculateTextLayout(obj);
  return obj._layoutCache;
}

function getTextLayoutForLineRange(obj, firstLineIndex = 0, lastLineIndex = firstLineIndex) {
  if (!obj || obj.type !== 'text') return [];
  const first = Math.max(0, Math.trunc(Number(firstLineIndex)) || 0);
  const last = Math.max(first, Math.trunc(Number(lastLineIndex)) || first);
  const content = normalizeTextContent(obj.data?.content || '');
  const scriptRanges = getTextScriptRangesForLayout(obj);
  const scriptKey = JSON.stringify(scriptRanges);
  const alignKey = textLayoutAlignKey(obj, content);
  const cachedRangeLayout = getCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last);
  if (cachedRangeLayout) return cachedRangeLayout;
  const cachedLineLayout = getCachedTextViewportLayoutLines(obj, content, scriptKey, alignKey, first, last);
  if (cachedLineLayout) return cachedLineLayout;
  if (
    obj._layoutCache &&
    obj._layoutCacheContent === content &&
    obj._layoutCacheW === obj.w &&
    obj._layoutCacheScriptKey === scriptKey &&
    obj._layoutCacheAlignKey === alignKey
  ) {
    if (obj._layoutCacheY !== obj.y) {
      syncTextLayoutLinePositions(obj, obj._layoutCache);
      obj._layoutCacheY = obj.y;
    }
    return setTextLayoutTotalLines(obj._layoutCache.slice(first, last + 1), obj._layoutCache.length);
  }

  const knownLineCount = getCachedTextWrappedLineCount(obj, content, scriptKey);
  const lineIndexCache = getCachedTextWrappedLineIndex(obj, content, scriptKey);
  if (!lineIndexCache) {
    const wrapped = buildWrappedLines(obj, {
      scriptRanges,
      scriptKey,
      firstLineIndex: first,
      lastLineIndex: last,
      knownLineCount,
      collectLineIndex: knownLineCount == null,
    });
    if (wrapped.lineIndex) {
      setCachedTextWrappedLineIndex(obj, content, scriptKey, wrapped.lineIndex || [], wrapped.lineCount);
    } else {
      setCachedTextWrappedLineCount(obj, content, scriptKey, wrapped.lineCount);
    }
    const scriptMetrics = scriptRanges.length
      ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
      : null;
    const layout = new Array(wrapped.lines.length);
    for (let i = 0; i < wrapped.lines.length; i++) {
      const line = wrapped.lines[i];
      layout[i] = layoutLineFromWrappedLine(
        obj,
        line,
        Number.isFinite(line?.visualLineIndex) ? line.visualLineIndex : first + i,
        scriptRanges,
        scriptMetrics,
      );
    }
    return setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, layout, wrapped.lineCount);
  }
  const totalLineCount = Math.max(1, Math.trunc(Number(lineIndexCache?.lineCount)) || 1);
  const missingSpans = textViewportLayoutLineCacheMissingSpans(obj, content, scriptKey, alignKey, first, last, totalLineCount);
  if (missingSpans.length) {
    const actualLast = Math.min(last, totalLineCount - 1);
    const requestedLineCount = first <= actualLast ? actualLast - first + 1 : 0;
    let missingLineCount = 0;
    for (const span of missingSpans) missingLineCount += span.last - span.first + 1;
    if (requestedLineCount > 0 && missingLineCount < requestedLineCount) {
      for (const span of missingSpans) {
        buildTextViewportLayoutRangeFromLineIndex(obj, content, scriptRanges, scriptKey, alignKey, span.first, span.last, lineIndexCache);
      }
      const assembled = getCachedTextViewportLayoutLines(obj, content, scriptKey, alignKey, first, last);
      if (assembled) return assembled;
    }
  }
  const indexedLayout = buildTextViewportLayoutRangeFromLineIndex(
    obj,
    content,
    scriptRanges,
    scriptKey,
    alignKey,
    first,
    last,
    lineIndexCache,
  );
  if (indexedLayout) {
    return indexedLayout;
  }

  const wrapped = buildWrappedLines(obj, {
    scriptRanges,
    scriptKey,
    firstLineIndex: first,
    lastLineIndex: last,
    knownLineCount,
  });
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
    : null;
  const layout = new Array(wrapped.lines.length);
  for (let i = 0; i < wrapped.lines.length; i++) {
    const line = wrapped.lines[i];
    layout[i] = layoutLineFromWrappedLine(
      obj,
      line,
      Number.isFinite(line?.visualLineIndex) ? line.visualLineIndex : first + i,
      scriptRanges,
      scriptMetrics,
    );
  }
  return setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, layout, wrapped.lineCount);
}

function getTextLayoutForViewport(obj, viewportRect = null) {
  if (!viewportRect || !obj || obj.type !== 'text') return getTextLayout(obj);
  const y1 = Number(viewportRect.y1);
  const y2 = Number(viewportRect.y2);
  if (!Number.isFinite(y1) || !Number.isFinite(y2)) return getTextLayout(obj);
  const baseY = obj.y + TEXT_PAD;
  const first = Math.max(0, Math.ceil((Math.min(y1, y2) - baseY - LINE_H) / LINE_H));
  const last = Math.floor((Math.max(y1, y2) - baseY) / LINE_H);
  if (last < first) return [];
  return getTextLayoutForLineRange(obj, first, last);
}

const textLineVisibleEndOffset = (line) => {
  const text = String(line?.text ?? '');
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return end;
};

function lineVisibleWidth(line) {
  if (!line?.prefixWidths) return measureVisibleLineTextW(line?.text || '');
  return line.prefixWidths[textLineVisibleEndOffset(line)] || 0;
}

function lineBaseX(line, obj) {
  const base = obj.x + TEXT_PAD;
  const maxW = Math.max(0, obj.w - TEXT_PAD * 2);
  const extra = Math.max(0, maxW - lineVisibleWidth(line));
  if (line?.align === 'right') return base + extra;
  if (line?.align === 'center') return base + extra / 2;
  return base;
}

function lineXAtOffset(line, obj, offset) {
  return lineBaseX(line, obj) + line.prefixWidths[Math.max(0, Math.min(offset, line.text.length))];
}

function lineHitOffsetForX(line, wx, obj) {
  const textLength = String(line?.text ?? '').length;
  const pw = line?.prefixWidths;
  if (!pw || pw.length < textLength + 1) return 0;
  const target = wx - lineBaseX(line, obj);
  let lo = 0;
  let hi = textLength;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const threshold = pw[mid] + (pw[mid + 1] - pw[mid]) / 2;
    if (target < threshold) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function lineNearestCaretOffsetsForX(line, wx, obj) {
  const textLength = String(line?.text ?? '').length;
  const pw = line?.prefixWidths;
  if (!pw || pw.length < textLength + 1) return [0];
  const target = wx - lineBaseX(line, obj);
  let lo = 0;
  let hi = textLength;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pw[mid] < target) lo = mid + 1;
    else hi = mid;
  }

  const right = lo;
  const left = Math.max(0, right - 1);
  const bestOffset = Math.abs(target - pw[left]) <= Math.abs(target - pw[right]) ? left : right;
  const bestX = pw[bestOffset];
  const epsilon = 1e-7;
  let first = bestOffset;
  while (first > 0 && Math.abs(pw[first - 1] - bestX) <= epsilon) first--;
  let last = bestOffset;
  while (last < textLength && Math.abs(pw[last + 1] - bestX) <= epsilon) last++;
  const offsets = [];
  for (let offset = first; offset <= last; offset++) offsets.push(offset);
  return offsets;
}

function lineCaretXAtOffset(line, obj, offset) {
  const text = String(line?.text ?? '');
  const lineStart = Math.max(0, Math.trunc(Number(line?.startIndex)) || 0);
  const content = normalizeTextContent(obj?.data?.content ?? line?.content ?? text);
  const caretEnd = Number.isFinite(line?.caretEndIndex)
    ? Math.max(lineStart, Math.min(Math.trunc(Number(line.caretEndIndex)) || lineStart, content.length))
    : lineStart + text.length;
  const maxOffset = Math.max(text.length, caretEnd - lineStart);
  const clamped = Math.max(0, Math.min(Math.trunc(Number(offset)) || 0, maxOffset));
  const logicalX = clamped <= text.length
    ? lineXAtOffset(line, obj, clamped)
    : lineBaseX(line, obj) + (
      getTextRangePrefixWidths(
        content.slice(lineStart, lineStart + clamped),
        lineStart,
        line?.scriptRanges || [],
        content,
        line?._scriptMetrics || null,
      )[clamped] || 0
    );
  if (clamped <= 0 || clamped >= text.length) return logicalX;

  const previousChar = text[clamped - 1];
  const nextChar = text[clamped];
  if (!previousChar || !nextChar) return logicalX;
  if (/\s/.test(previousChar) || /\s/.test(nextChar)) return logicalX;

  const ranges = line?.scriptRanges || [];
  const hasScriptRanges = ranges.length > 0;
  let previousState = BASE_TEXT_SCRIPT_STATE;
  let nextState = BASE_TEXT_SCRIPT_STATE;
  if (hasScriptRanges) {
    const scriptMetrics = line._scriptMetrics || getTextScriptLayoutMetricsForObject(obj, content, ranges);
    const previousIndex = (line.startIndex || 0) + clamped - 1;
    const nextIndex = (line.startIndex || 0) + clamped;
    if (
      textScriptMetricsHiddenAt(scriptMetrics, previousIndex) ||
      textScriptMetricsHiddenAt(scriptMetrics, nextIndex)
    ) {
      return logicalX;
    }
    previousState = textScriptMetricsStateAt(scriptMetrics, previousIndex);
    nextState = textScriptMetricsStateAt(scriptMetrics, nextIndex);
    if (previousState.key !== nextState.key) return logicalX;
  }

  const previousMetrics = measureTextGlyphMetricsWithFont(previousChar, previousState.font || FONT);
  const nextMetrics = measureTextGlyphMetricsWithFont(nextChar, nextState.font || FONT);
  if (
    !previousMetrics.hasInkBounds ||
    !nextMetrics.hasInkBounds ||
    textGlyphMetricsInkWidth(previousMetrics) <= TEXT_GLYPH_MIN_INK_WIDTH ||
    textGlyphMetricsInkWidth(nextMetrics) <= TEXT_GLYPH_MIN_INK_WIDTH
  ) {
    return logicalX;
  }

  const previousInkRight = lineXAtOffset(line, obj, clamped - 1) + previousMetrics.right;
  const nextInkLeft = lineXAtOffset(line, obj, clamped) - nextMetrics.left;
  if (!Number.isFinite(previousInkRight) || !Number.isFinite(nextInkLeft)) return logicalX;
  return (previousInkRight + nextInkLeft) / 2;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function createTextDrawStats() {
  return {
    chars: 0,
    drawnChars: 0,
    drawUnits: 0,
    drawCalls: 0,
    runs: 0,
    plainRuns: 0,
    scriptRuns: 0,
    skippedTabs: 0,
    skippedSpaces: 0,
    hiddenChars: 0,
    fontSwitches: 0,
    planCacheHits: 0,
    planCacheMisses: 0,
  };
}

function cloneTextDrawStats(stats, cacheHit = false) {
  return {
    ...stats,
    planCacheHits: cacheHit ? 1 : 0,
    planCacheMisses: cacheHit ? 0 : 1,
  };
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function isTextDrawBlankUnit(unit) {
  return unit === ' ' || unit === '\u00a0';
}

function isTextDrawBatchingFontReady(font) {
  if (_textDrawBatchingEngineVerified == null) {
    const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    _textDrawBatchingEngineVerified = /\b(?:Chrome|Chromium)\/\d+/.test(userAgent);
  }
  if (!_textDrawBatchingEngineVerified) return false;
  const requestedFont = font || FONT;
  if (_textDrawBatchingVerifiedFonts.has(requestedFont)) return true;
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (!fontSet || fontSet.status !== 'loaded' || typeof fontSet.check !== 'function') return false;
  try {
    const ready = fontSet.check(requestedFont, 'Boardfish');
    if (ready) _textDrawBatchingVerifiedFonts.add(requestedFont);
    return ready;
  } catch (_) {
    return false;
  }
}

function isTextDrawBatchableAsciiUnit(unit, batchingFontReady) {
  return batchingFontReady === true && TEXT_DRAW_BATCHABLE_ASCII_RE.test(String(unit ?? ''));
}

function isTextDrawUnsafeAsciiPair(previousText, nextText) {
  return previousText.endsWith('t') && nextText === 't';
}

function appendTextDrawUnit(draws, unit, font, batchingFontReady) {
  const batchable = isTextDrawBatchableAsciiUnit(unit.text, batchingFontReady);
  const unitWidth = batchable
    ? measureTextGlyphMetricsWithFont(unit.text, font).width
    : 0;
  const previous = draws[draws.length - 1] || null;
  if (
    batchable &&
    previous?.batchable === true &&
    previous.unitCount < TEXT_DRAW_BATCH_MAX_UNITS &&
    !isTextDrawUnsafeAsciiPair(previous.text, unit.text) &&
    Number.isFinite(unit.x) &&
    Number.isFinite(previous.nextX) &&
    Math.abs(unit.x - previous.nextX) <= TEXT_DRAW_BATCH_POSITION_EPSILON
  ) {
    previous.text += unit.text;
    previous.nextX = unit.x + unitWidth;
    previous.unitCount++;
    return;
  }
  draws.push({
    ...unit,
    batchable,
    nextX: batchable && Number.isFinite(unit.x) ? unit.x + unitWidth : NaN,
    unitCount: 1,
  });
}

function textDrawPlanCacheMatches(plan, line, text, start, end, scriptMetrics) {
  return !!plan &&
    plan.text === text &&
    plan.start === start &&
    plan.end === end &&
    plan.startIndex === line.startIndex &&
    plan.prefixWidths === line.prefixWidths &&
    plan.scriptRanges === line.scriptRanges &&
    plan.scriptMetrics === scriptMetrics &&
    plan.font === FONT;
}

function setTextDrawPlanCache(line, plan) {
  try {
    Object.defineProperty(line, '_textDrawPlanCache', {
      value: plan,
      configurable: true,
      writable: true,
    });
  } catch (_) {
    line._textDrawPlanCache = plan;
  }
}

function createTextDrawPlan(line, text, start, end, hasScriptRanges, scriptMetrics) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let stats = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    stats = createTextDrawStats();
    stats.chars = end - start;
  }
  const runs = [];
  let i = start;
  while (i < end) {
    const globalIndex = line.startIndex + i;
    if (text[i] === '\t' || (hasScriptRanges && textScriptMetricsHiddenAt(scriptMetrics, globalIndex))) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        if (text[i] === '\t') stats.skippedTabs++;
        else stats.hiddenChars++;
      }
      i++;
      continue;
    }
    const state = hasScriptRanges ? textScriptMetricsStateAt(scriptMetrics, globalIndex) : BASE_TEXT_SCRIPT_STATE;
    let j = i + 1;
    while (j < end) {
      const nextGlobalIndex = line.startIndex + j;
      if (text[j] === '\t') break;
      if (hasScriptRanges && textScriptMetricsHiddenAt(scriptMetrics, nextGlobalIndex)) break;
      if (hasScriptRanges && textScriptMetricsStateAt(scriptMetrics, nextGlobalIndex).key !== state.key) break;
      j++;
    }
    const run = {
      font: state.depth > 0 ? state.font : '',
      offset: state.offset,
      draws: [],
    };
    const drawFont = state.font || FONT;
    const batchingFontReady = isTextDrawBatchingFontReady(drawFont);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      stats.runs++;
      if (state.depth > 0) {
        stats.scriptRuns++;
        stats.fontSwitches++;
      } else {
        stats.plainRuns++;
      }
    }
    forEachTextSpacingUnit(text, (unit, unitStart, unitEnd) => {
      if (isTextDrawBlankUnit(unit)) {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          stats.skippedSpaces += Math.max(0, unitEnd - unitStart);
        }
        return;
      }
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        stats.drawUnits++;
        stats.drawnChars += Math.max(0, unitEnd - unitStart);
      }
      appendTextDrawUnit(run.draws, {
        text: unit,
        offset: unitStart,
        x: line.prefixWidths?.[unitStart],
      }, drawFont, batchingFontReady);
    }, i, j);
    if (run.draws.length) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') stats.drawCalls += run.draws.length;
      runs.push(run);
    }
    i = j;
  }
  const plan = {
    text,
    start,
    end,
    startIndex: line.startIndex,
    prefixWidths: line.prefixWidths,
    scriptRanges: line.scriptRanges,
    scriptMetrics,
    font: FONT,
    runs,
  };
  if (typeof BOARDFISH_PRODUCTION === 'undefined') plan.stats = stats;
  return plan;
}

function drawTextPlan(context, line, obj, plan) {
  const baseX = lineBaseX(line, obj);
  const previousFont = context.font;
  for (const run of plan.runs) {
    if (run.font) context.font = run.font;
    const y = line.textY + run.offset;
    for (const draw of run.draws) {
      const x = Number.isFinite(draw.x) ? baseX + draw.x : lineXAtOffset(line, obj, draw.offset);
      context.fillText(draw.text, x, y);
    }
    if (run.font && context.font !== previousFont) context.font = previousFont;
  }
}

const drawTextLineRange = (context, line, obj, startOffset = 0, endOffset = line?.text?.length ?? 0
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , options = {}
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  if (!context || !line || !obj) {
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return null;
    return createTextDrawStats();
  }
  configureTextCanvasContext(context);
  const text = String(line.text ?? '');
  const start = Math.max(0, Math.min(startOffset, text.length));
  const end = Math.max(start, Math.min(endOffset, text.length));
  const ranges = line.scriptRanges || [];
  const hasScriptRanges = ranges.length > 0;
  let scriptMetrics = null;
  if (hasScriptRanges) {
    scriptMetrics = line._scriptMetrics || null;
    if (!scriptMetrics) {
      const content = normalizeTextContent(obj.data?.content ?? line.content ?? text);
      scriptMetrics = getTextScriptLayoutMetricsForObject(obj, content, ranges);
    }
  }
  const cacheable = start === 0 && end === text.length && !!line.prefixWidths;
  let plan = cacheable && textDrawPlanCacheMatches(line._textDrawPlanCache, line, text, start, end, scriptMetrics)
    ? line._textDrawPlanCache
    : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const cacheHit = !!plan;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!plan) {
    plan = createTextDrawPlan(line, text, start, end, hasScriptRanges, scriptMetrics);
    if (cacheable) setTextDrawPlanCache(line, plan);
  }
  drawTextPlan(context, line, obj, plan);
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') return null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return options.collectStats === false ? null : cloneTextDrawStats(plan.stats, cacheHit);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

function lineEndX(line, obj) {
  return lineXAtOffset(line, obj, line.text.length);
}

const normalizeTextLayoutHitCaretIndex = (line, index, direction = 'forward', obj = null) => {
  const text = normalizeTextContent(obj?.data?.content ?? line?.content ?? line?.text ?? '');
  const ranges = line?.scriptRanges || [];
  let pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  const step = direction === 'backward' ? -1 : 1;
  const shouldSkip = () => {
    for (const range of ranges) {
      if (isTextScriptBracedRange(text, range)) {
        if (range.start === pos) return true;
      } else if (range.start === pos + 1) {
        return true;
      }
    }
    return false;
  };
  let guard = text.length + 1;
  while (guard-- > 0 && pos >= 0 && pos <= text.length && shouldSkip()) {
    pos += step;
    if (pos < 0) return 0;
    if (pos > text.length) return text.length;
  }
  return pos;
};

const textLayoutLineForHit = (layout, wy) => {
  if (!layout.length) return null;
  let lo = 0;
  let hi = layout.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wy < layout[mid].y + LINE_H) hi = mid;
    else lo = mid + 1;
  }
  return layout[lo] || layout[layout.length - 1];
};

const textLayoutContentForHit = (line, obj) => {
  if (typeof obj?._layoutCacheContent === 'string') return obj._layoutCacheContent;
  if (typeof line?.content === 'string') return line.content;
  return normalizeTextContent(obj?.data?.content ?? line?.text ?? '');
};

const textLayoutCaretCenterYForHit = (line, obj, index, affinity = '', metrics = null) => {
  const state = metrics
    ? textScriptMetricsCaretStateAt(metrics, index, affinity)
    : textScriptCaretStateForHit(obj, index, affinity);
  if (state?.depth > 0) {
    const scale = Number.isFinite(state.scale) && state.scale > 0 ? state.scale : 1;
    const textY = Number.isFinite(line.textY) ? line.textY : line.y + TEXT_BASELINE_Y_OFFSET;
    const y = textY + state.offset - (TEXT_BASELINE_Y_OFFSET * scale);
    return y + (LINE_H * scale) / 2;
  }
  return line.y + LINE_H / 2;
};

const textLayoutCaretHitCandidates = (line, wx, obj) => {
  const content = textLayoutContentForHit(line, obj);
  const ranges = line?.scriptRanges || [];
  const metrics = ranges.length
    ? line._scriptMetrics || getTextScriptLayoutMetricsForObject(obj, content, ranges)
    : null;
  const candidates = [];
  const seen = new Set();
  const addCandidate = (index, affinity = '') => {
    const caretIndex = Math.max(0, Math.min(Math.trunc(index ?? 0), content.length));
    const key = `${caretIndex}:${affinity}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      index: caretIndex,
      affinity,
      centerY: textLayoutCaretCenterYForHit(line, obj, caretIndex, affinity, metrics),
    });
  };

  for (const offset of lineNearestCaretOffsetsForX(line, wx, obj)) {
    const rawIndex = Math.max(0, Math.min(line.startIndex + offset, content.length));
    const bracedOpeningGap = !!metrics?.bracedStarts?.[rawIndex];
    if (bracedOpeningGap) continue;

    const bracedRangeAtClosing = !!metrics?.bracedClosings?.[rawIndex];
    const bracedRangeEnding = !!metrics?.bracedEnds?.[rawIndex];
    const linearRangeEnding = !!metrics?.linearEnds?.[rawIndex];

    if (bracedRangeEnding) addCandidate(rawIndex, 'after');
    if (linearRangeEnding) {
      addCandidate(rawIndex, '');
      addCandidate(rawIndex, 'after');
    }
    if (bracedRangeAtClosing && !bracedRangeEnding) {
      addCandidate(rawIndex, metrics?.anyEnds?.[rawIndex] ? 'after' : '');
    }
    if (!bracedRangeEnding && !linearRangeEnding && !bracedRangeAtClosing) {
      addCandidate(rawIndex, metrics?.anyEnds?.[rawIndex] ? 'after' : '');
    }
  }

  return candidates;
};

function layoutHitTestCaret(layout, wx, wy, obj) {
  if (!layout.length) return { index: 0, affinity: '' };
  const line = textLayoutLineForHit(layout, wy);
  if (!line.text.length) return { index: line.startIndex, affinity: '', lineStartIndex: line.startIndex };
  const candidates = textLayoutCaretHitCandidates(line, wx, obj);
  if (candidates.length) {
    let hit = candidates[0];
    let hitDistance = Math.abs(hit.centerY - wy);
    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i];
      const candidateDistance = Math.abs(candidate.centerY - wy);
      if (
        candidateDistance < hitDistance ||
        (candidateDistance === hitDistance && candidate.index < hit.index) ||
        (
          candidateDistance === hitDistance &&
          candidate.index === hit.index &&
          String(candidate.affinity).localeCompare(String(hit.affinity)) < 0
        )
      ) {
        hit = candidate;
        hitDistance = candidateDistance;
      }
    }
    TextSelDebug._logHit(wx, wy, obj, line, hit.index, line.prefixWidths);
    return { index: hit.index, affinity: hit.affinity || '', lineStartIndex: line.startIndex };
  }

  const pw = line.prefixWidths;
  const offset = lineHitOffsetForX(line, wx, obj);
  const direction = offset < line.text.length ? 'forward' : 'backward';
  const hitIndex = normalizeTextLayoutHitCaretIndex(line, line.startIndex + offset, direction, obj);
  TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
  return { index: hitIndex, affinity: '', lineStartIndex: line.startIndex };
}

function layoutHitTest(layout, wx, wy, obj) {
  if (!layout.length) return 0;
  const line = textLayoutLineForHit(layout, wy);
  if (!line.text.length) return line.startIndex;
  const pw = line.prefixWidths;
  const offset = lineHitOffsetForX(line, wx, obj);
  const direction = offset < line.text.length ? 'forward' : 'backward';
  const hitIndex = normalizeTextLayoutHitCaretIndex(line, line.startIndex + offset, direction, obj);
  TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
  return hitIndex;
}
