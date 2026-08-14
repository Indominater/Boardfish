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
const TEXT_GLYPH_MIN_GAP = 0.5;
const TEXT_GLYPH_MIN_INK_WIDTH = 0.01;
const TEXT_DRAW_BATCH_POSITION_EPSILON = 1e-7;
const TEXT_DRAW_BATCH_MAX_UNITS = 2;
// Only batch pairs exhaustively pixel-verified against per-grapheme Geist
// rendering in Chromium. Keep fallback fonts, other engines, f/F ligatures,
// the contextual "tt" alternate, punctuation, and complex scripts exact.
const TEXT_DRAW_BATCHABLE_ASCII_RE = /^[A-EG-Za-eg-z0-9]$/;
var TEXT_BASELINE_Y_OFFSET = FONT_SIZE;
var _textDrawBatchingEngineVerified = null;
var _textDrawBatchingVerifiedFonts = new Set();

function normalizeTextContent(value) {
  const text = String(value ?? '');
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

const trimWhitespaceOnlyEdgeLines = (value) => {
  const text = normalizeTextContent(value);
  if (!text.includes('\n')) return /\S/.test(text) ? text : '';
  return /\S/.test(text) ? text.replace(/^(?:[^\S\n]*\n)+|(?:\n[^\S\n]*)+$/g, '') : '';
};

const textForClipboard = trimWhitespaceOnlyEdgeLines;
const textSelectionForClipboard = trimWhitespaceOnlyEdgeLines;
const textForTextObjectPaste = trimWhitespaceOnlyEdgeLines;

const cloneTextScriptRanges = (ranges = []) => {
  const source = Array.isArray(ranges) ? ranges : [];
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i++) {
    const { start, end, kind } = source[i];
    out[i] = { start, end, kind };
  }
  return out;
};

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

const shouldUnwrapExternalTextBlock = (lines) => {
  if (!Array.isArray(lines) || lines.length < 3) return false;
  if (lines.some(externalTextLineLooksStructured)) return false;
  let uppercaseLines = 0;
  let pipeTableLines = 0;
  const bodyWidths = lines.map((line) => {
    const trimmed = String(line ?? '').trim();
    const first = trimmed.charAt(0);
    if (first && first.toLocaleUpperCase() === first && first.toLocaleLowerCase() !== first) uppercaseLines++;
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) pipeTableLines++;
    return trimmed.length;
  });
  bodyWidths.pop();
  if (uppercaseLines / lines.length >= 0.8 || pipeTableLines >= 2) return false;
  bodyWidths.sort((a, b) => a - b);
  const middle = Math.floor(bodyWidths.length / 2);
  const median = bodyWidths.length % 2
    ? bodyWidths[middle]
    : (bodyWidths[middle - 1] + bodyWidths[middle]) / 2;
  const referenceWidth = bodyWidths[bodyWidths.length - 1];
  if (median < EXTERNAL_TEXT_SOFT_WRAP_MIN_MEDIAN_CHARS) return false;
  if (bodyWidths[0] < referenceWidth * 0.55) return false;
  if (bodyWidths[Math.floor(bodyWidths.length * 0.25)] < referenceWidth * 0.7) return false;

  let continuousBoundaries = 0;
  for (let index = 1; index < lines.length; index++) {
    if (externalTextBoundaryLooksContinuous(lines[index - 1], lines[index])) continuousBoundaries++;
  }
  return continuousBoundaries / (lines.length - 1) >= 0.5;
};

const unwrapExternalTextBlock = (lines) => {
  let previous = String(lines[0] ?? '').trimEnd();
  const parts = [previous];
  for (let index = 1; index < lines.length; index++) {
    const next = String(lines[index] ?? '').trimStart();
    parts.push(/[-‐‑‒–—]$/.test(previous) ? '' : ' ', next);
    previous = next;
  }
  return parts.join('');
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

function isTextContentEmpty(value) { return !/[^\s\u200B-\u200D\uFEFF]/.test(String(value ?? '')); }

function configureTextCanvasContext(context) {
  if (!context) return;
  try { context.fontKerning = TEXT_CANVAS_FONT_KERNING; } catch (_) {}
  try { context.letterSpacing = '0px'; } catch (_) {}
  try { context.fontStretch = 'normal'; } catch (_) {}
  try { context.fontVariantCaps = 'normal'; } catch (_) {}
  try { context.textAlign = 'left'; } catch (_) {}
  try { context.direction = 'ltr'; } catch (_) {}
}

var _measureCanvas = document.createElement('canvas');
var _measureCtx = _measureCanvas.getContext('2d');
configureTextCanvasContext(_measureCtx);
_measureCtx.font = FONT;
refreshTextMetrics();
const TEXT_MEASURE_CACHE_MAX_ENTRIES = 4096;
const TEXT_PREFIX_CACHE_MAX_ENTRIES = 2048;
const TEXT_SCRIPT_INDEX_CACHE_MAX_ENTRIES = 256;
const TEXT_GLYPH_METRICS_CACHE_MAX_ENTRIES = 4096;
const TEXT_GLYPH_PAIR_SPACING_CACHE_MAX_ENTRIES = 4096;
const TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES = 4096;
const TEXT_WRAPPED_WIDTH_CACHE_MAX_ENTRIES = 12;
const TEXT_VIEWPORT_LAYOUT_RANGE_CACHE_MAX_ENTRIES = 48;
const TEXT_VIEWPORT_LAYOUT_LINE_CACHE_MAX_ENTRIES = 8192;
const TEXT_EXACT_PREFIX_MAX_CHARS = 384;
const BASE_TEXT_SCRIPT_STATE = Object.freeze({
  depth: 0,
  font: FONT,
  key: '',
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

function measureRawTextWWithFont(text, font, cache) {
  const value = String(text ?? '');
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  if (cache.size >= TEXT_MEASURE_CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  let width = 0;
  let previousUnit = null;
  forEachTextSpacingUnit(value, (unit) => {
    width += textGlyphPairSpacing(previousUnit, unit, font);
    width += measureTextGlyphMetricsWithFont(unit, font).width;
    previousUnit = unit;
  });
  cache.set(value, width);
  return width;
}

function measureRawTextW(text) {
  return measureRawTextWWithFont(text, FONT, _mwCache);
}

const textScriptScaleForDepth = (depth) => Math.pow(
  TEXT_SCRIPT_FONT_SCALE,
  Math.min(TEXT_SCRIPT_MAX_SIZE_DEPTH, Math.max(0, depth || 0)),
);

function measureRawTextWWithScriptFont(text, font) {
  let cache = _fontMeasureCaches.get(font);
  if (!cache) _fontMeasureCaches.set(font, cache = new Map());
  return measureRawTextWWithFont(text, font, cache);
}

var _textTabStopWidth;
const textWidthAfterTab = (currentWidth) => {
  const tabStop = (_textTabStopWidth ??= measureRawTextW('        ')) > 0 ? _textTabStopWidth : FONT_SIZE * 4;
  return (Math.floor(currentWidth / tabStop) + 1) * tabStop;
};

function measureTextW(text) {
  const value = String(text ?? '');
  if (!value.includes('\t')) return measureRawTextW(value);
  const widths = getPrefixWidths(value);
  return widths[widths.length - 1] || 0;
}

function refreshTextMetrics() {
  _measureCtx.font = FONT;
  _measureCtx.textBaseline = 'alphabetic';
  const metrics = _measureCtx.measureText('Hgjpqy');
  const measuredAscent = metrics.actualBoundingBoxAscent;
  const measuredDescent = metrics.actualBoundingBoxDescent;
  const ascent = Number.isFinite(measuredAscent) && measuredAscent > 0 ? measuredAscent : FONT_SIZE * 0.8;
  const descent = Number.isFinite(measuredDescent) && measuredDescent > 0 ? measuredDescent : FONT_SIZE * 0.2;
  TEXT_BASELINE_Y_OFFSET = (LINE_H - ascent - descent) / 2 + ascent;
}

// Prefix-width cache: line text -> Float64Array of prefix widths [0, w0, w0+w1, ...]
// Computed once per unique line string; avoids O(n2) slice allocations on every frame.
var _prefixCache = new Map();

const trimMapCache = (map, maxEntries) => {
  while (map.size > maxEntries) map.delete(map.keys().next().value);
};

const textLayoutDebugNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const textLayoutDebugRound = (value) => Math.round((Number(value) || 0) * 100) / 100;

const clearMeasuredTextWidthCache = () => {
  _textTabStopWidth = undefined;
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

  if (_measureCtx.font !== font) _measureCtx.font = font;
  const metrics = _measureCtx.measureText(value);

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

const textGlyphPairSpacingCacheKey = (previous, next, font = FONT) => {
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

function textGlyphPairSpacing(previous, next, font = FONT) {
  if (!previous || !next || /\s/.test(previous) || /\s/.test(next)) return 0;
  const cacheKey = textGlyphPairSpacingCacheKey(previous, next, font);
  const cached = _glyphPairSpacingCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let spacing = 0;
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

  _glyphPairSpacingCache.set(cacheKey, spacing);
  trimMapCache(_glyphPairSpacingCache, TEXT_GLYPH_PAIR_SPACING_CACHE_MAX_ENTRIES);
  return spacing;
}

function clearTextObjectLayoutRuntime(obj, options) {
  if (!obj) return;
  obj._layoutCache = obj._layoutCacheContent = obj._layoutCacheScriptKey =
    obj._layoutCacheAlignKey = null;
  if (options?.script !== false) {
    if (options?.scriptRanges !== false) {
      obj._textScriptRangesCache = obj._textScriptRangesCacheContent =
        obj._textScriptRangesCacheSourceKey = null;
    }
    obj._textScriptLayoutMetrics = obj._textScriptLayoutMetricsContent =
      obj._textScriptLayoutMetricsScriptKey = obj._textClipboardCacheContent =
      obj._textClipboardCacheScriptKey = obj._textClipboardCacheValue = null;
  }
  if (options?.minWidth !== false) {
    obj._textMinWidthCache = obj._textMinWidthCacheContent = obj._textMinWidthCacheScriptKey = null;
  }
  if (options?.prefix !== false) {
    obj._textParagraphPrefixCache = obj._textParagraphPrefixCacheContent =
      obj._textParagraphPrefixCacheScriptKey = null;
  }
  obj._textWrappedLineCountCacheContent = obj._textWrappedLineCountCacheScriptKey =
    obj._textWrappedLineCountCacheValue = obj._textWrappedLineIndexCacheContent =
    obj._textWrappedLineIndexCacheScriptKey = obj._textWrappedLineIndexCache =
    obj._textWrappedLineIndexWidthCacheContent = obj._textWrappedLineIndexWidthCacheScriptKey =
    obj._textWrappedLineIndexWidthCache = obj._textViewportLayoutRangeCacheContent =
    obj._textViewportLayoutRangeCacheScriptKey = obj._textViewportLayoutRangeCacheAlignKey =
    obj._textViewportLayoutRangeCache = obj._textViewportLayoutLineCacheContent =
    obj._textViewportLayoutLineCacheScriptKey = obj._textViewportLayoutLineCacheAlignKey =
    obj._textViewportLayoutLineCache = null;
}

const cloneTextLayoutRuntimeLine = ({ _textDrawPlanCache, ...clone }) => clone;

const cloneTextLayoutRuntimeLines = (lines = []) => {
  const out = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) out[i] = cloneTextLayoutRuntimeLine(lines[i]);
  return out;
};

function cloneTextObjectRuntimeCaches(source, target) {
  if (!source || !target || source.type !== 'text' || target.type !== 'text') return target;
  const content = String(target.data?.content || '');
  const sourceScriptKey = Array.isArray(source.data?.scriptRanges)
    ? JSON.stringify(source.data.scriptRanges)
    : '[]';
  const targetScriptRanges = Array.isArray(target.data?.scriptRanges) ? target.data.scriptRanges : [];
  const targetScriptKey = targetScriptRanges.length ? JSON.stringify(targetScriptRanges) : '[]';
  if (sourceScriptKey !== targetScriptKey) return target;
  if (
    Array.isArray(source._textScriptRangesCache) &&
    source._textScriptRangesCacheContent === content &&
    source._textScriptRangesCacheSourceKey === sourceScriptKey
  ) {
    target._textScriptRangesCache = targetScriptRanges;
    target._textScriptRangesCacheContent = content;
    target._textScriptRangesCacheSourceKey = targetScriptKey;
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
    Number.isFinite(source._textMinWidthCache) &&
    source._textMinWidthCacheContent === content &&
    typeof source._textMinWidthCacheScriptKey === 'string'
  ) {
    target._textMinWidthCache = source._textMinWidthCache;
    target._textMinWidthCacheContent = source._textMinWidthCacheContent;
    target._textMinWidthCacheScriptKey = source._textMinWidthCacheScriptKey;
  }

  if (
    source._textParagraphPrefixCache &&
    typeof source._textParagraphPrefixCache.entries === 'function' &&
    source._textParagraphPrefixCacheContent === content &&
    typeof source._textParagraphPrefixCacheScriptKey === 'string'
  ) {
    target._textParagraphPrefixCache = source._textParagraphPrefixCache;
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
    target._textWrappedLineIndexCache = source._textWrappedLineIndexCache;
  }

  if (!target._layoutCache &&
    Array.isArray(source._layoutCache) &&
    source._layoutCacheContent === content &&
    source._layoutCacheW === target.w &&
    typeof source._layoutCacheScriptKey === 'string' &&
    source._layoutCacheAlignKey === textLayoutAlignKey(source) &&
    String(source.data?.lineAlign) === String(target.data?.lineAlign)
  ) {
    target._layoutCache = cloneTextLayoutRuntimeLines(source._layoutCache);
    target._layoutCacheContent = source._layoutCacheContent;
    target._layoutCacheW = source._layoutCacheW;
    target._layoutCacheScriptKey = source._layoutCacheScriptKey;
    target._layoutCacheAlignKey = textLayoutAlignKey(target);
    target._layoutCacheY = target.y;
    if (source._layoutCacheY !== target.y) syncTextLayoutLinePositions(target, target._layoutCache);
  }

  return target;
}

const clearTextLayoutCaches = (options = {}) => {
  _prefixCache.clear();
  _scriptIndexCache.clear();
  if (options.measurements) clearMeasuredTextWidthCache();
  if (options.objectLayout !== false) {
    for (const obj of objects) clearTextObjectLayoutRuntime(obj);
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

    let previousUnit = null;
    forEachTextSpacingUnit(value, (unit, unitStart, unitEnd) => {
      const spacing = textGlyphPairSpacing(previousUnit, unit, state.font || FONT);
      if (spacing) {
        width += spacing;
        pw[unitStart] = width;
      }
      width += state.depth ? measureRawTextWWithScriptFont(unit, state.font) : measureRawTextW(unit);
      for (let pos = unitStart + 1; pos <= unitEnd; pos++) pw[pos] = width;
      previousUnit = unit;
    }, i, j);
    width = pw[j];
    i = j;
  }

  return pw;
}

function getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, text, start, end, scriptRanges = [], scriptKey = '', scriptMetrics = null) {
  if (
    obj._textParagraphPrefixCacheContent !== text ||
    obj._textParagraphPrefixCacheScriptKey !== scriptKey ||
    !obj._textParagraphPrefixCache ||
    typeof obj._textParagraphPrefixCache.get !== 'function'
  ) {
    obj._textParagraphPrefixCache = new Map();
    obj._textParagraphPrefixCacheContent = text;
    obj._textParagraphPrefixCacheScriptKey = scriptKey;
  }

  const cached = obj._textParagraphPrefixCache.get(start);
  if (cached) {
    if (obj._textParagraphPrefixCache.size >= TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES) {
      obj._textParagraphPrefixCache.delete(start);
      obj._textParagraphPrefixCache.set(start, cached);
    }
    return cached;
  }

  const widths = getTextRangePrefixWidths(text.slice(start, end), start, scriptRanges, text, scriptMetrics);
  obj._textParagraphPrefixCache.set(start, widths);
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
    return obj._textWrappedLineCountCacheValue;
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

function getCachedTextWrappedLineIndex(obj, text, scriptKey) {
  if (!obj || obj.type !== 'text') return null;
  const cache = obj._textWrappedLineIndexCache;
  if (
    cache &&
    Array.isArray(cache.entries) &&
    cache.entries.length &&
    obj._textWrappedLineIndexCacheContent === text &&
    obj._textWrappedLineIndexCacheW === obj.w &&
    obj._textWrappedLineIndexCacheScriptKey === scriptKey &&
    Number.isInteger(cache.lineCount) &&
    cache.lineCount > 0
  ) {
    return cache;
  }
  const widthCache = obj._textWrappedLineIndexWidthCacheContent === text &&
    obj._textWrappedLineIndexWidthCacheScriptKey === scriptKey &&
    typeof obj._textWrappedLineIndexWidthCache?.get === 'function'
      ? obj._textWrappedLineIndexWidthCache
      : null;
  const widthCached = widthCache?.get(obj.w);
  if (
    widthCached &&
    Array.isArray(widthCached.entries) &&
    widthCached.entries.length &&
    Number.isInteger(widthCached.lineCount) &&
    widthCached.lineCount > 0
  ) {
    widthCache.delete(obj.w);
    widthCache.set(obj.w, widthCached);
    obj._textWrappedLineIndexCacheContent = text;
    obj._textWrappedLineIndexCacheW = obj.w;
    obj._textWrappedLineIndexCacheScriptKey = scriptKey;
    obj._textWrappedLineIndexCache = widthCached;
    setCachedTextWrappedLineCount(obj, text, scriptKey, widthCached.lineCount);
    return widthCached;
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
  if (
    obj._textWrappedLineIndexWidthCacheContent !== text ||
    obj._textWrappedLineIndexWidthCacheScriptKey !== scriptKey ||
    typeof obj._textWrappedLineIndexWidthCache?.set !== 'function'
  ) {
    obj._textWrappedLineIndexWidthCacheContent = text;
    obj._textWrappedLineIndexWidthCacheScriptKey = scriptKey;
    obj._textWrappedLineIndexWidthCache = new Map();
  }
  const widthCache = obj._textWrappedLineIndexWidthCache;
  widthCache.delete(obj.w);
  widthCache.set(obj.w, cache);
  trimMapCache(widthCache, TEXT_WRAPPED_WIDTH_CACHE_MAX_ENTRIES);
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
  const entries = cache.entries;
  const lineCount = Math.max(1, Math.trunc(Number(cache.lineCount)) || 1);
  const target = Math.max(0, Math.min(Math.trunc(Number(visualLineIndex)) || 0, lineCount - 1));
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if ((entries[mid]?.visualStart || 0) <= target) lo = mid;
    else hi = mid - 1;
  }
  return { entry: entries[lo], index: lo };
}

function prewarmTextObjectLayoutRuntimeCaches(obj, options = {}) {
  if (!obj || obj.type !== 'text') return { available: false, reason: 'not-text' };
  const startedAt = textLayoutDebugNow();
  const content = normalizeTextContent(obj.data?.content || '');
  const scriptRanges = getTextScriptRanges(obj);
  const scriptKey = obj._textScriptRangesCacheSourceKey || '[]';
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

function measureTextRangeW(text, start, end, scriptRanges = [], scriptMetrics = null) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const widths = getTextRangePrefixWidths(text.slice(from, to), from, scriptRanges, text, scriptMetrics);
  return widths[widths.length - 1] || 0;
}

function textPrefixWidthsSlice(prefixWidths, from, to) {
  const source = prefixWidths;
  const start = Math.max(0, Math.min(Math.trunc(Number(from)) || 0, Math.max(0, (source?.length || 1) - 1)));
  const end = Math.max(start, Math.min(Math.trunc(Number(to)) || start, Math.max(0, (source?.length || 1) - 1)));
  const out = new Float64Array(end - start + 1);
  const base = source[start] || 0;
  for (let index = start; index <= end; index++) out[index - start] = Math.max(0, (source[index] || 0) - base);
  return out;
}

function textRangeIncludes(text, start, end, character = '\t') {
  const index = text.indexOf(character, start);
  return index !== -1 && index < end;
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

function wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, rangeWidth, pushLine) {
  let lineStart = paraStart;
  while (lineStart < paraEnd) {
    let cursor = lineStart;
    let bestEnd = lineStart;
    let bestNext = lineStart;

    while (cursor < paraEnd) {
      const wordStart = nextNonSpaceIndex(content, cursor, paraEnd);
      if (wordStart >= paraEnd) {
        const lineEnd = findTextWrapEndByWidth(rangeWidth, lineStart, paraEnd, maxW);
        pushLine(lineStart, Math.max(lineStart + 1, lineEnd), paraEnd, paraEnd);
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
      pushLine(lineStart, end, nextStart, nextStart);
      lineStart = nextStart;
      break;
    }

    if (lineStart >= paraEnd) continue;
    if (bestEnd > lineStart) {
      pushLine(lineStart, bestEnd, bestNext, bestNext);
      lineStart = bestNext;
    } else {
      const lineEnd = Math.min(lineStart + 1, paraEnd);
      pushLine(lineStart, lineEnd, lineEnd, lineEnd);
      lineStart = lineEnd;
    }
  }
}

function clearTextMeasurementCaches() {
  refreshTextMetrics();
  clearTextLayoutCaches({ measurements: true });
  syncAllTextAutoHeights();
  scheduleRender(true, true);
}

function buildWrappedLines(obj, options = {}, content = String(obj?.data?.content || '')) {
  const scriptRanges = Array.isArray(options.scriptRanges)
    ? options.scriptRanges
    : getTextScriptRanges(obj);
  const scriptKey = options.scriptKey || JSON.stringify(scriptRanges);
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
    : null;
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
      const paragraphHasTab = textRangeIncludes(content, paraStart, paraEnd);
      const paragraphPrefixWidths = paragraphHasTab
        ? null
        : getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, content, paraStart, paraEnd, scriptRanges, scriptKey, scriptMetrics);
      const paragraphRangeWidth = (start, end) => {
        if (!paragraphPrefixWidths) return measureTextRangeW(content, start, end, scriptRanges, scriptMetrics);
        const from = Math.max(0, Math.min(start - paraStart, paragraphPrefixWidths.length - 1));
        const to = Math.max(from, Math.min(end - paraStart, paragraphPrefixWidths.length - 1));
        return Math.max(0, paragraphPrefixWidths[to] - paragraphPrefixWidths[from]);
      };
      const pushParagraphLine = (start, end, nextStart = end, caretEnd = end) => {
        const prefixWidths = collectLines && paragraphPrefixWidths
          ? textPrefixWidthsSlice(paragraphPrefixWidths, start - paraStart, end - paraStart)
          : null;
        pushLine(start, end, nextStart, caretEnd, logicalLineIndex, prefixWidths);
      };
      if (paragraphRangeWidth(paraStart, paraEnd) <= maxW) {
        pushParagraphLine(paraStart, paraEnd, paraEnd, paraEnd);
        if (newlineAt === -1) break;
        paraStart = newlineAt + 1;
        logicalLineIndex++;
        continue;
      }
      if (!scriptRanges.length && !paragraphHasTab && paraEnd - paraStart > TEXT_EXACT_PREFIX_MAX_CHARS) {
        wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, paragraphRangeWidth, pushParagraphLine);
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
          pushParagraphLine(lineStart, lo, lo, lo);
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
            if (isTextWordSeparator(content[i - 1])) {
              breakAt = i - 1;
              break;
            }
          }
          if (breakAt > lineStart) {
            nextStart = breakAt;
            while (nextStart < paraEnd && isTextWordSeparator(content[nextStart])) nextStart++;
            if (nextStart < paraEnd) {
              lineEnd = breakAt;
            }
            caretEnd = nextStart;
          } else if (isTextWordSeparator(content[nextStart])) {
            while (nextStart < paraEnd && isTextWordSeparator(content[nextStart])) nextStart++;
            caretEnd = nextStart;
          }
        }

        if (lineEnd <= lineStart) {
          lineEnd = Math.min(lineStart + 1, paraEnd);
          nextStart = lineEnd;
        }
        pushParagraphLine(lineStart, lineEnd, nextStart, caretEnd);
      lineStart = nextStart;
      }
    }

    if (newlineAt === -1) break;
    paraStart = newlineAt + 1;
    logicalLineIndex++;
  }

  return { lines: result, lineCount: Math.max(1, knownLineCount || visualLineIndex), scriptKey, scriptMetrics, lineIndex };
}

function getWrappedLineCount(obj, text) {
  if (!obj || obj.type !== 'text') return 1;
  const scriptRanges = getTextScriptRanges(obj);
  const scriptKey = obj._textScriptRangesCacheSourceKey || '[]';
  const cachedCount = getCachedTextWrappedLineCount(obj, text, scriptKey)
    ?? getCachedTextWrappedLineIndex(obj, text, scriptKey)?.lineCount;
  if (cachedCount != null) {
    return Math.max(1, Math.trunc(Number(cachedCount)) || 1);
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

function wrapTextLogicalLineRange(obj, startLine, endLine, options = {}) {
  if (!obj || obj.type !== 'text') return [];
  const content = String(obj.data?.content || '');
  const firstLine = Math.max(0, Math.trunc(Number(startLine)) || 0);
  const lastLine = Math.max(firstLine, Math.trunc(Number(endLine)) || firstLine);
  const maxW = obj.w - TEXT_PAD * 2;
  const scriptRanges = Array.isArray(options.scriptRanges)
    ? options.scriptRanges
    : getTextScriptRanges(obj);
  const metrics = options.scriptMetrics;
  const lineIndexEntries = Array.isArray(options.lineIndexEntries) ? options.lineIndexEntries : null;
  let nextParaStart = Math.max(0, Math.min(Math.trunc(Number(options.startIndex)) || 0, content.length));
  let visualLineOffset = 0;
  const result = [];
  const pushLine = (start, end, nextStart = end, caretEnd = end, logicalLineIndex = 0, prefixWidths = null) => {
    const visualStart = lineIndexEntries?.[logicalLineIndex]?.visualStart;
    const visualOffset = visualLineOffset++;
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
    visualLineOffset = 0;
    const indexedLine = lineIndexEntries?.[logicalLineIndex] || null;
    const paraStart = indexedLine
      ? Math.max(0, Math.min(Math.trunc(Number(indexedLine.startIndex)) || 0, content.length))
      : nextParaStart;
    const newlineAt = indexedLine ? -1 : content.indexOf('\n', paraStart);
    const paraEnd = indexedLine
      ? Math.max(paraStart, Math.min(Math.trunc(Number(indexedLine.endIndex)) || paraStart, content.length))
      : (newlineAt === -1 ? content.length : newlineAt);
    nextParaStart = Math.min(paraEnd + 1, content.length);
    if (paraStart === paraEnd) {
      pushLine(paraStart, paraStart, paraStart, paraStart, logicalLineIndex);
      continue;
    }

    const paragraphHasTab = textRangeIncludes(content, paraStart, paraEnd);
    const paragraphPrefixWidths = paragraphHasTab
      ? null
      : getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, content, paraStart, paraEnd, scriptRanges, obj._textScriptRangesCacheSourceKey || '[]', metrics);
    const paragraphRangeWidth = (start, end) => {
      if (!paragraphPrefixWidths) return measureTextRangeW(content, start, end, scriptRanges, metrics);
      const from = Math.max(0, Math.min(start - paraStart, paragraphPrefixWidths.length - 1));
      const to = Math.max(from, Math.min(end - paraStart, paragraphPrefixWidths.length - 1));
      return Math.max(0, paragraphPrefixWidths[to] - paragraphPrefixWidths[from]);
    };
    const pushParagraphLine = (start, end, nextStart = end, caretEnd = end) => {
      const prefixWidths = paragraphPrefixWidths
        ? textPrefixWidthsSlice(paragraphPrefixWidths, start - paraStart, end - paraStart)
        : null;
      pushLine(start, end, nextStart, caretEnd, logicalLineIndex, prefixWidths);
    };
    if (paragraphRangeWidth(paraStart, paraEnd) <= maxW) {
      pushParagraphLine(paraStart, paraEnd, paraEnd, paraEnd);
      continue;
    }
    if (!scriptRanges.length && !paragraphHasTab && paraEnd - paraStart > TEXT_EXACT_PREFIX_MAX_CHARS) {
      wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, paragraphRangeWidth, pushParagraphLine);
      continue;
    }

    let lineStart = paraStart;
    while (lineStart < paraEnd) {
      let lo = lineStart + 1;
      let hi = paraEnd;
      if (paragraphRangeWidth(lineStart, lo) > maxW) {
        pushParagraphLine(lineStart, lo, lo, lo);
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
          if (isTextWordSeparator(content[i - 1])) {
            breakAt = i - 1;
            break;
          }
        }
        if (breakAt > lineStart) {
          nextStart = breakAt;
          while (nextStart < paraEnd && isTextWordSeparator(content[nextStart])) nextStart++;
          if (nextStart < paraEnd) lineEnd = breakAt;
          caretEnd = nextStart;
        } else if (isTextWordSeparator(content[nextStart])) {
          while (nextStart < paraEnd && isTextWordSeparator(content[nextStart])) nextStart++;
          caretEnd = nextStart;
        }
      }

      if (lineEnd <= lineStart) {
        lineEnd = Math.min(lineStart + 1, paraEnd);
        nextStart = lineEnd;
      }
      pushParagraphLine(lineStart, lineEnd, nextStart, caretEnd);
      lineStart = nextStart;
    }
  }

  return result;
}

function textLayoutSpliceRangeForLogicalLines(layout, startLine, endLine) {
  const lines = Array.isArray(layout) ? layout : [];
  let lo = 0, hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].logicalLineIndex || 0) < startLine) lo = mid + 1; else hi = mid;
  }
  const start = lo;
  while (lo < lines.length && (lines[lo].logicalLineIndex || 0) <= endLine) lo++;
  return { start, end: lo };
}

function setTextLayoutLineScriptMetrics(line, metrics) {
  if (!line) return line;
  if (metrics) line._scriptMetrics = metrics;
  else delete line._scriptMetrics;
  return line;
}

function layoutLineFromWrappedLine(obj, line, lineIndex, scriptRanges, scriptMetrics) {
  const y = obj.y + TEXT_PAD + lineIndex * LINE_H;
  const prefixWidths = line.prefixWidths?.length === line.text.length + 1
    ? line.prefixWidths
    : getTextRangePrefixWidths(line.text, line.startIndex, scriptRanges, obj.data.content, scriptMetrics);
  let visibleEnd = line.text.length;
  while (visibleEnd && isTextWordSeparator(line.text[visibleEnd - 1])) visibleEnd--;
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
    visibleWidth: prefixWidths[visibleEnd] || 0,
  };
  return setTextLayoutLineScriptMetrics(layoutLine, scriptMetrics);
}

function patchTextObjectLayoutAfterInput(obj, options = {}) {
  if (!obj || obj.type !== 'text' || !Array.isArray(obj._layoutCache)) return false;
  const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
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

  const oldContent = String(options.oldContent ?? obj._layoutCacheContent ?? '');
  const newContent = String(options.newContent ?? obj.data?.content ?? '');
  if (obj._layoutCacheContent !== oldContent || obj._layoutCacheW !== obj.w) {
    return collectDiagnostics ? fail('stale-layout-cache') : false;
  }
  const start = Math.max(0, Math.min(Math.trunc(Number(options.start)) || 0, oldContent.length));
  const end = Math.max(start, Math.min(Math.trunc(Number(options.end)) || start, oldContent.length));
  const insertedText = String(options.insertedText ?? newContent.slice(start, Math.max(start, newContent.length - (oldContent.length - end))));
  const deltaChars = newContent.length - oldContent.length;
  if (deltaChars !== insertedText.length - (end - start)) {
    return collectDiagnostics ? fail('content-delta-mismatch') : false;
  }

  const layout = obj._layoutCache;
  const insertedLineCount = textNewlineCount(insertedText);
  const removedLineCount = textNewlineCount(oldContent, start, end);
  const endLineProbe = end > start && removedLineCount > 0 ? end : (end > start ? end - 1 : end);
  const oldStartLine = textLayoutLogicalLineIndexAtContentIndex(layout, start);
  const oldEndLine = endLineProbe === start
    ? oldStartLine
    : textLayoutLogicalLineIndexAtContentIndex(layout, endLineProbe);
  const newEndLine = oldStartLine + insertedLineCount;
  const logicalLineDelta = insertedLineCount - removedLineCount;

  const oldScriptKey = obj._layoutCacheScriptKey || '';
  const oldScriptRanges = layout[0]?.scriptRanges || [];
  const oldSplice = textLayoutSpliceRangeForLogicalLines(layout, oldStartLine, oldEndLine);

  const scriptRanges = getTextScriptRanges(obj);
  const scriptKey = obj._textScriptRangesCacheSourceKey || '[]';
  const alignKey = textLayoutAlignKey(obj);

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

  const newWrapped = wrapTextLogicalLineRange(obj, oldStartLine, newEndLine, {
    scriptRanges,
    scriptMetrics,
    startIndex: layout[oldSplice.start].startIndex,
  });

  const insertedLayout = new Array(newWrapped.length);
  for (let i = 0; i < newWrapped.length; i++) {
    insertedLayout[i] = layoutLineFromWrappedLine(obj, newWrapped[i], oldSplice.start + i, scriptRanges, scriptMetrics);
  }

  const removedLayoutCount = oldSplice.end - oldSplice.start;
  const layoutLineDelta = insertedLayout.length - removedLayoutCount;
  obj._lastTextLayoutLineDelta = layoutLineDelta;

  const yChanged = obj._layoutCacheY !== obj.y;
  for (let i = yChanged || oldScriptRanges.length || scriptRanges.length ? 0 : oldSplice.start; i < oldSplice.start; i++) {
    const line = layout[i];
    line.scriptRanges = scriptRanges;
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
  {
    const from = oldSplice.start;
    const insertCount = insertedLayout.length;
    const suffixStart = from + removedLayoutCount;
    const suffixLength = layout.length - suffixStart;
    const newLength = from + insertCount + suffixLength;
    if (insertCount > removedLayoutCount) {
      layout.length = newLength;
      for (let i = suffixLength - 1; i >= 0; i--) {
        layout[from + insertCount + i] = layout[suffixStart + i];
      }
    } else if (insertCount < removedLayoutCount) {
      for (let i = 0; i < suffixLength; i++) {
        layout[from + insertCount + i] = layout[suffixStart + i];
      }
      layout.length = newLength;
    }
    for (let i = 0; i < insertCount; i++) layout[from + i] = insertedLayout[i];
  }

  obj._layoutCacheContent = newContent;
  obj._layoutCacheScriptKey = scriptKey;
  obj._layoutCacheAlignKey = alignKey;
  obj._layoutCacheY = obj.y;

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

function getTextAutoHeight(obj, minLines = 1) {
  const content = String(obj?.data?.content || '');
  const cachedLineCount = obj?.type === 'text' &&
    Array.isArray(obj._layoutCache) &&
    obj._layoutCacheContent === content &&
    obj._layoutCacheW === obj.w &&
    obj._layoutCacheScriptKey === (
      getTextScriptRanges(obj),
      obj._textScriptRangesCacheSourceKey || '[]'
    ) &&
    obj._layoutCacheAlignKey === textLayoutAlignKey(obj)
      ? Math.max(1, obj._layoutCache.length)
      : null;
  const lineCount = cachedLineCount ?? getWrappedLineCount(obj, content);
  return Math.max(minLines, lineCount) * LINE_H + TEXT_PAD * 2;
}

const isTextWordSeparator = (ch) => ch === ' ' || ch === '\t';
const isTextWordOrLineSeparator = (ch) => isTextWordSeparator(ch) || ch === '\n';

const normalizeTextLineAlignValue = (value) => (
  value === 'center' || value === 'right' ? value : 'left'
);

const textNewlineCount = (value, start = 0, end = Infinity) => {
  const text = String(value ?? '');
  const stop = Math.min(end, text.length);
  let count = 0;
  if (stop < text.length && stop - start < 64) {
    for (let i = start; i < stop; i++) if (text[i] === '\n') count++;
    return count;
  }
  const bounded = stop < text.length;
  const range = bounded ? text.slice(start, stop) : text;
  for (let i = range.indexOf('\n', bounded ? 0 : start); i >= 0; i = range.indexOf('\n', i + 1)) count++;
  return count;
};

const textLogicalLineCount = (value) => textNewlineCount(normalizeTextContent(value)) + 1;

const normalizeTextLineAlignForContent = (content, lineAlign = [], lineCount = textLogicalLineCount(content)) => {
  const source = Array.isArray(lineAlign) ? lineAlign : [];
  const result = new Array(Math.min(lineCount, source.length));
  for (let i = 0; i < result.length; i++) result[i] = normalizeTextLineAlignValue(source[i]);
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
  const startLine = textNewlineCount(text, 0, from);
  return { startLine, endLine: startLine + (to > from ? textNewlineCount(text, from, to - 1) : 0) };
};

const cycleTextLineAlignValue = (align, direction) => {
  const current = normalizeTextLineAlignValue(align);
  if (direction === 'left') return current === 'right' ? 'center' : 'left';
  return current === 'left' ? 'center' : 'right';
};

const applyTextLineAlignmentRange = (obj, startLine = 0, endLine = startLine, direction = 'right') => {
  if (!obj || obj.type !== 'text') return false;
  if (!obj.data) obj.data = {};
  const content = normalizeTextContent(obj.data.content);
  const count = textLogicalLineCount(content);
  if (!count) return false;
  const start = Math.max(0, Math.min(Math.trunc(Number(startLine)) || 0, count - 1));
  const end = Math.max(start, Math.min(Math.trunc(Number(endLine)) || start, count - 1));
  const next = normalizeTextLineAlignForContent(content, obj.data.lineAlign, count);
  while (next.length <= end) next.push('left');
  let changed = false;
  for (let i = start; i <= end; i++) {
    const aligned = cycleTextLineAlignValue(next[i], direction);
    if (aligned === next[i]) continue;
    next[i] = aligned;
    changed = true;
  }
  if (!changed) return false;
  while (next.length && next[next.length - 1] === 'left') next.pop();
  if (next.length) obj.data.lineAlign = next;
  else delete obj.data.lineAlign;
  clearTextObjectLayoutRuntime(obj, { script: false });
  return true;
};

const normalizeTextScriptKind = (kind) => kind === 'sup' || kind === 'sub' ? kind : '';
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
    normalized.push(range);
  }
  return normalized;
};

const findBalancedTextScriptEnd = (text, start) => {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
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

const getTextScriptRanges = (obj, content) => {
  if (!obj || obj.type !== 'text') return [];
  if (content == null) content = String(obj.data?.content ?? '');
  const cached = obj._textScriptRangesCache;
  const source = Array.isArray(obj.data?.scriptRanges)
    ? obj.data.scriptRanges
    : Array.isArray(cached) && !cached.length ? cached : [];
  if (obj._textScriptRangesCacheContent === content && source === cached) return cached;
  if (!source.length && !/[\^_]/.test(content)) {
    if (obj.data) delete obj.data.scriptRanges;
    obj._textScriptRangesCacheContent = content;
    obj._textScriptRangesCacheSourceKey = '[]';
    return obj._textScriptRangesCache = [];
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
      obj._textScriptRangesCache = normalized;
      obj._textScriptRangesCacheContent = content;
      obj._textScriptRangesCacheSourceKey = '[]';
    }
    return normalized;
  }
  if (obj.data) delete obj.data.scriptRanges;
  obj._textScriptRangesCacheContent = content;
  obj._textScriptRangesCacheSourceKey = '[]';
  return obj._textScriptRangesCache = [];
};

const textContentWithCanonicalScriptBraces = (content, scriptRanges = [], options = {}) => {
  const text = normalizeTextContent(content);
  let ranges = [];
  if (options.normalized === true) {
    ranges = Array.isArray(scriptRanges) ? scriptRanges : [];
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

const textScriptLinearToDeterministicBraces = textContentWithCanonicalScriptBraces;

const textObjectContentForClipboard = (obj) => {
  if (!obj || obj.type !== 'text') return '';
  const content = normalizeTextContent(obj.data?.content || '');
  const ranges = getTextScriptRanges(obj);
  const scriptKey = obj._textScriptRangesCacheSourceKey || '[]';
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

const activeTextScriptRangesAt = (ranges, index, includeEnd = false, affinity = '') => {
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

const textScriptStateFromRanges = (activeRanges) => {
  const ranges = activeRanges || [];
  if (!ranges.length) return BASE_TEXT_SCRIPT_STATE;
  let depth = 0;
  let key = '';
  let offset = 0;
  for (let i = 0; i < ranges.length; i++) {
    const kind = normalizeTextScriptKind(ranges[i]?.kind);
    if (!kind) continue;
    key += (depth++ ? '/' : '') + kind;
    offset += (kind === 'sub' ? TEXT_SCRIPT_SUB_OFFSET : TEXT_SCRIPT_SUP_OFFSET) * textScriptScaleForDepth(i);
  }
  const scale = textScriptScaleForDepth(depth);
  return {
    depth,
    font: depth > 0 ? textFontForSize(Math.max(1, FONT_SIZE * scale)) : FONT,
    key,
    offset,
    scale,
  };
};

const textScriptStateAt = (ranges, index) => {
  return textScriptStateFromRanges(activeTextScriptRangesAt(ranges, index));
};

function textScriptMetricsStateAt(metrics, index) {
  return metrics?.states?.[index] || BASE_TEXT_SCRIPT_STATE;
}

function textScriptMetricsCaretStateAt(metrics, index, affinity = '') {
  if (!metrics) return BASE_TEXT_SCRIPT_STATE;
  const max = Math.max(0, (metrics.caretStates?.length || 1) - 1);
  const pos = Math.max(0, Math.min(Math.trunc(Number(index)) || 0, max));
  if (affinity === 'after') return textScriptMetricsStateAt(metrics, pos);
  return metrics.caretStates?.[pos] || textScriptMetricsStateAt(metrics, pos);
}

function textScriptMetricsHiddenAt(metrics, index) {
  return !!metrics?.hidden?.[index];
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
  const oldContent = String(options.oldContent || '');
  const newContent = String(options.newContent || '');
  const insertedText = String(options.insertedText || '');
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
      bracedEnds: deleteTextMetricPositionByteArray(oldMetrics.bracedEnds, start, end, newContent.length + 1),
      linearEnds: deleteTextMetricPositionByteArray(oldMetrics.linearEnds, start, end, newContent.length + 1),
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

  let localMetrics;
  if (insertedRanges.length) {
    localMetrics = getTextScriptLayoutMetrics(insertedText, insertedRanges);
  } else {
    const states = new Array(insertedText.length).fill(BASE_TEXT_SCRIPT_STATE);
    const caretStates = new Array(insertedText.length + 1).fill(BASE_TEXT_SCRIPT_STATE);
    localMetrics = {
      hidden: new Uint8Array(insertedText.length),
      states,
      caretStates,
      bracedStarts: new Uint8Array(insertedText.length + 1),
      bracedEnds: new Uint8Array(insertedText.length + 1),
      linearEnds: new Uint8Array(insertedText.length + 1),
    };
  }
  const metrics = {
    hidden: spliceTextMetricByteArray(oldMetrics.hidden, start, localMetrics.hidden, newContent.length),
    states: spliceTextMetricStateArray(oldMetrics.states, start, localMetrics.states),
    caretStates: spliceTextMetricCaretStateArray(oldMetrics.caretStates, start, localMetrics.caretStates),
    bracedStarts: spliceTextMetricPositionByteArray(oldMetrics.bracedStarts, start, localMetrics.bracedStarts, newContent.length + 1),
    bracedEnds: spliceTextMetricPositionByteArray(oldMetrics.bracedEnds, start, localMetrics.bracedEnds, newContent.length + 1),
    linearEnds: spliceTextMetricPositionByteArray(oldMetrics.linearEnds, start, localMetrics.linearEnds, newContent.length + 1),
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

function getTextScriptLayoutMetrics(content, scriptRanges = [], scriptKey = '') {
  const text = normalizeTextContent(content);
  const ranges = Array.isArray(scriptRanges) ? scriptRanges : [];
  const cacheKey = `${text}\n${scriptKey || JSON.stringify(ranges)}`;
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
  const bracedEnds = new Uint8Array(text.length + 1);
  const linearEnds = new Uint8Array(text.length + 1);
  const starts = new Map();
  const ends = new Map();
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
    addEvent(starts, start, range);
    addEvent(ends, end, range);
    const markerIndex = start - 1;
    if (markerIndex >= 0 && markerIndex < hidden.length) hidden[markerIndex] = 1;
    if (isTextScriptBracedRange(text, range)) {
      bracedStarts[start] = 1;
      bracedEnds[end] = 1;
      if (start >= 0 && start < hidden.length) hidden[start] = 1;
      if (end - 1 >= 0 && end - 1 < hidden.length) {
        hidden[end - 1] = 1;
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
    bracedEnds,
    linearEnds,
  };
  _scriptIndexCache.set(cacheKey, result);
  trimMapCache(_scriptIndexCache, TEXT_SCRIPT_INDEX_CACHE_MAX_ENTRIES);
  return result;
}

function getTextScriptLayoutMetricsForObject(obj, content, scriptRanges = [], scriptKey = '') {
  const text = String(content ?? '');
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
  const metrics = getTextScriptLayoutMetrics(text, ranges, scriptKey);
  if (obj) {
    obj._textScriptLayoutMetrics = metrics;
    obj._textScriptLayoutMetricsContent = text;
    obj._textScriptLayoutMetricsScriptKey = key;
  }
  return metrics;
}

const getTextMinWidth = (obj) => {
  const paddedMinimum = TEXT_PAD * 2 + 1;
  if (!obj || obj.type !== 'text') return paddedMinimum;
  const content = normalizeTextContent(obj.data?.content || '');
  const scriptRanges = getTextScriptRanges(obj);
  const scriptKey = obj._textScriptRangesCacheSourceKey || '[]';
  if (
    obj._textMinWidthCacheContent === content &&
    obj._textMinWidthCacheScriptKey === scriptKey &&
    Number.isFinite(obj._textMinWidthCache)
  ) {
    return obj._textMinWidthCache;
  }
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
    : null;
  let bestWidth = 0;
  let contentOffset = 0;
  for (const line of content.split('\n')) {
    const prefixWidths = getTextObjectParagraphPrefixWidthsForNormalizedContent(
      obj,
      content,
      contentOffset,
      contentOffset + line.length,
      scriptRanges,
      scriptKey,
      scriptMetrics,
    );
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
      const segmentStart = isFirstWord ? 0 : wordStart;
      const width = Math.max(0, prefixWidths[i] - prefixWidths[segmentStart]);
      if (width > bestWidth) bestWidth = width;
      isFirstWord = false;
    }
    contentOffset += line.length + 1;
  }
  obj._textMinWidthCacheContent = content;
  obj._textMinWidthCacheScriptKey = scriptKey;
  return obj._textMinWidthCache = Math.ceil(bestWidth + paddedMinimum);
};

const getTextRenderedContentWidth = (obj) => {
  if (!obj || obj.type !== 'text') return TEXT_PAD * 2 + 1;
  let maxLineW = 0;
  for (const line of getTextLayout(obj)) {
    maxLineW = Math.max(maxLineW, line.visibleWidth);
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
      markDirty(obj);
      changed = true;
    }
  }
  return changed;
}

function textLayoutAlignKey(obj) {
  return obj?.data?.lineAlign?.length ? obj.data.lineAlign : '';
}

function syncTextLayoutLinePositions(obj, layout, first = 0) {
  for (let i = 0; i < layout.length; i++) {
    const y = obj.y + TEXT_PAD + (first + i) * LINE_H;
    layout[i].y = y;
    layout[i].textY = y + TEXT_BASELINE_Y_OFFSET;
  }
}

function setTextLayoutTotalLines(layout, totalLines) {
  layout.totalLines = Math.max(layout.length, Math.trunc(Number(totalLines)) || layout.length);
  return layout;
}

function getCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last) {
  const cache = obj._textViewportLayoutRangeCache;
  if (
    !cache ||
    typeof cache.get !== 'function' ||
    obj._textViewportLayoutRangeCacheContent !== content ||
    obj._textViewportLayoutRangeCacheW !== obj.w ||
    obj._textViewportLayoutRangeCacheScriptKey !== scriptKey ||
    obj._textViewportLayoutRangeCacheAlignKey !== alignKey ||
    obj._textViewportY !== obj.y
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

function ensureTextViewportLayoutLineCache(obj, content, scriptKey, alignKey, totalLines = 0) {
  if (
    obj._textViewportLayoutLineCacheContent !== content ||
    obj._textViewportLayoutLineCacheW !== obj.w ||
    obj._textViewportLayoutLineCacheScriptKey !== scriptKey ||
    obj._textViewportLayoutLineCacheAlignKey !== alignKey ||
    !obj._textViewportLayoutLineCache ||
    typeof obj._textViewportLayoutLineCache.set !== 'function'
  ) {
    obj._textViewportLayoutLineCacheContent = content;
    obj._textViewportLayoutLineCacheW = obj.w;
    obj._textViewportLayoutLineCacheScriptKey = scriptKey;
    obj._textViewportLayoutLineCacheAlignKey = alignKey;
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
  const totalLines = Math.trunc(Number(obj._textViewportLayoutLineCacheLineCount)) || 0;
  if (totalLines <= 0 || first >= totalLines) return null;
  const actualLast = Math.min(last, totalLines - 1);
  const layout = [];
  for (let index = first; index <= actualLast; index++) {
    const line = cache.get(index);
    if (!line) return null;
    layout.push(line);
  }
  syncTextLayoutLinePositions(obj, layout, first);
  return setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, layout, totalLines);
}

function setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, layout, totalLines) {
  if (
    obj._textViewportLayoutRangeCacheContent !== content ||
    obj._textViewportLayoutRangeCacheW !== obj.w ||
    obj._textViewportLayoutRangeCacheScriptKey !== scriptKey ||
    obj._textViewportLayoutRangeCacheAlignKey !== alignKey ||
    obj._textViewportY !== obj.y ||
    !obj._textViewportLayoutRangeCache ||
    typeof obj._textViewportLayoutRangeCache.set !== 'function'
  ) {
    obj._textViewportLayoutRangeCacheContent = content;
    obj._textViewportLayoutRangeCacheW = obj.w;
    obj._textViewportLayoutRangeCacheScriptKey = scriptKey;
    obj._textViewportLayoutRangeCacheAlignKey = alignKey;
    obj._textViewportY = obj.y;
    obj._textViewportLayoutRangeCache = new Map();
  }
  const out = setTextLayoutTotalLines(layout, totalLines);
  const lineCache = ensureTextViewportLayoutLineCache(obj, content, scriptKey, alignKey, totalLines);
  for (let i = 0; i < out.length; i++) lineCache.set(first + i, out[i]);
  trimMapCache(lineCache, TEXT_VIEWPORT_LAYOUT_LINE_CACHE_MAX_ENTRIES);
  obj._textViewportLayoutRangeCache.set(`${first}:${last}`, out);
  trimMapCache(obj._textViewportLayoutRangeCache, TEXT_VIEWPORT_LAYOUT_RANGE_CACHE_MAX_ENTRIES);
  return out;
}

function textViewportLayoutLineCacheMissingSpans(obj, content, scriptKey, alignKey, first, last, totalLines) {
  const cache = ensureTextViewportLayoutLineCache(obj, content, scriptKey, alignKey, totalLines);
  if (first >= totalLines) return [];
  const actualLast = Math.min(last, totalLines - 1);
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
  const totalLines = lineIndexCache.lineCount;
  if (first >= totalLines) {
    return setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, [], totalLines);
  }
  const actualLast = Math.min(last, totalLines - 1);
  const firstEntry = textWrappedLineIndexEntryForVisual(lineIndexCache, first);
  const lastEntry = textWrappedLineIndexEntryForVisual(lineIndexCache, actualLast);
  const scriptMetrics = scriptRanges.length
    ? getTextScriptLayoutMetricsForObject(obj, content, scriptRanges, scriptKey)
    : null;
  const wrappedSourceLines = wrapTextLogicalLineRange(obj, firstEntry.entry.logicalLineIndex, lastEntry.entry.logicalLineIndex, {
    scriptRanges,
    scriptMetrics,
    lineIndexEntries: lineIndexCache.entries,
  });
  const layout = [];
  for (const line of wrappedSourceLines) {
    if (
      Number.isFinite(line?.visualLineIndex) &&
      line.visualLineIndex >= first &&
      line.visualLineIndex <= actualLast
    ) {
      layout.push(layoutLineFromWrappedLine(
        obj,
        line,
        line.visualLineIndex,
        scriptRanges,
        scriptMetrics,
      ));
    }
  }
  return setCachedTextViewportLayoutRange(obj, content, scriptKey, alignKey, first, last, layout, totalLines);
}

function getTextLayout(obj) {
  const content = String(obj.data?.content || '');
  const scriptRanges = getTextScriptRanges(obj, content);
  const scriptKey = obj._textScriptRangesCacheSourceKey || '[]';
  const alignKey = textLayoutAlignKey(obj);
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
  const wrapped = buildWrappedLines(obj, { scriptRanges, scriptKey, collectLineIndex: true }, content);
  setCachedTextWrappedLineIndex(obj, content, scriptKey, wrapped.lineIndex || [], wrapped.lineCount);
  const lines = wrapped.lines;
  const { scriptMetrics } = wrapped;
  const layout = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    layout[i] = layoutLineFromWrappedLine(obj, lines[i], i, scriptRanges, scriptMetrics);
  }
  obj._layoutCache = layout;
  return obj._layoutCache;
}

function getTextLayoutForLineRange(obj, first = 0, last = first) {
  const content = String(obj.data?.content || '');
  const scriptRanges = getTextScriptRanges(obj);
  const scriptKey = obj._textScriptRangesCacheSourceKey || '[]';
  const alignKey = textLayoutAlignKey(obj);
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

  const lineIndexCache = getCachedTextWrappedLineIndex(obj, content, scriptKey);
  if (!lineIndexCache) {
    const knownLineCount = getCachedTextWrappedLineCount(obj, content, scriptKey);
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
    const { scriptMetrics } = wrapped;
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
  const totalLineCount = lineIndexCache.lineCount;
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
  return buildTextViewportLayoutRangeFromLineIndex(
    obj,
    content,
    scriptRanges,
    scriptKey,
    alignKey,
    first,
    last,
    lineIndexCache,
  );
}

function getTextLayoutForViewport(obj, viewportRect) {
  const baseY = obj.y + TEXT_PAD;
  const first = Math.max(0, Math.ceil((viewportRect.y1 - baseY - LINE_H) / LINE_H));
  const last = Math.floor((viewportRect.y2 - baseY) / LINE_H);
  if (last < first) return [];
  return getTextLayoutForLineRange(obj, first, last);
}

function lineBaseX(line, obj) {
  const base = obj.x + TEXT_PAD;
  if (line?.align !== 'right' && line?.align !== 'center') return base;
  const extra = Math.max(0, obj.w - TEXT_PAD * 2 - line.visibleWidth);
  return base + (line.align === 'right' ? extra : extra / 2);
}

function lineXAtOffset(line, obj, offset) {
  return lineBaseX(line, obj) + line.prefixWidths[Math.max(0, Math.min(offset, line.text.length))];
}

function lineHitOffsetForX(line, wx, obj, nearest = false) {
  const textLength = line.text.length;
  const pw = line.prefixWidths;
  const target = wx - lineBaseX(line, obj);
  let lo = 0, hi = textLength;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nearest ? pw[mid] < target : target >= pw[mid] + (pw[mid + 1] - pw[mid]) / 2) lo = mid + 1;
    else hi = mid;
  }
  if (!nearest) return lo;
  const left = Math.max(0, lo - 1);
  let offset = Math.abs(target - pw[left]) <= Math.abs(target - pw[lo]) ? left : lo;
  const x = pw[offset];
  while (offset > 0 && Math.abs(pw[offset - 1] - x) <= 1e-7) offset--;
  return offset;
}

function lineCaretXAtOffset(line, obj, offset) {
  const text = String(line?.text ?? '');
  const lineStart = Math.max(0, Math.trunc(Number(line?.startIndex)) || 0);
  const content = String(obj?.data?.content ?? line?.content ?? text);
  const caretEnd = Number.isFinite(line?.caretEndIndex)
    ? Math.max(lineStart, Math.min(Math.trunc(Number(line.caretEndIndex)) || lineStart, content.length))
    : lineStart + text.length;
  const maxOffset = Math.max(text.length, caretEnd - lineStart);
  const clamped = Math.max(0, Math.min(Math.trunc(Number(offset)) || 0, maxOffset));
  const baseX = lineBaseX(line, obj);
  const logicalX = baseX + (clamped <= text.length
    ? line.prefixWidths[clamped]
    : getTextRangePrefixWidths(
        content.slice(lineStart, lineStart + clamped),
        lineStart,
        line?.scriptRanges || [],
        content,
        line?._scriptMetrics || null,
      )[clamped] || 0);
  if (clamped <= 0 || clamped >= text.length) return logicalX;

  const previousChar = text[clamped - 1];
  const nextChar = text[clamped];
  if (!previousChar || !nextChar) return logicalX;
  if (/\s/.test(previousChar) || /\s/.test(nextChar)) return logicalX;

  const ranges = line?.scriptRanges || [];
  let previousState = BASE_TEXT_SCRIPT_STATE;
  let nextState = BASE_TEXT_SCRIPT_STATE;
  if (ranges.length) {
    const scriptMetrics = line._scriptMetrics;
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

  const previousInkRight = baseX + line.prefixWidths[clamped - 1] + previousMetrics.right;
  const nextInkLeft = logicalX - nextMetrics.left;
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
      if (unit === ' ' || unit === '\u00a0') {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          stats.skippedSpaces += Math.max(0, unitEnd - unitStart);
        }
        return;
      }
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        stats.drawUnits++;
        stats.drawnChars += Math.max(0, unitEnd - unitStart);
      }
      const x = line.prefixWidths[unitStart];
      const batchable = batchingFontReady === true && TEXT_DRAW_BATCHABLE_ASCII_RE.test(unit);
      const previous = run.draws[run.draws.length - 1] || null;
      if (
        batchable &&
        previous?.text.length < TEXT_DRAW_BATCH_MAX_UNITS &&
        !(previous.text.endsWith('t') && unit === 't') &&
        Math.abs(x - previous.nextX) <= TEXT_DRAW_BATCH_POSITION_EPSILON
      ) {
        previous.text += unit;
        return;
      }
      run.draws.push({
        text: unit,
        x,
        nextX: batchable ? x + (state.depth ? measureRawTextWWithScriptFont(unit, drawFont) : measureRawTextW(unit)) : NaN,
      });
    }, i, j);
    if (run.draws.length) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') stats.drawCalls += run.draws.length;
      runs.push(run);
    }
    i = j;
  }
  if (typeof BOARDFISH_PRODUCTION === 'undefined') runs.stats = stats;
  return runs;
}

const drawTextLineRange = (context, line, obj, start = 0, end = line.text.length
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , options = {}
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  const text = line.text;
  const cacheable = start === 0 && end === text.length;
  let plan = cacheable ? line._textDrawPlanCache : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const cacheHit = !!plan;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!plan) {
    const hasScriptRanges = line.scriptRanges?.length > 0;
    plan = createTextDrawPlan(line, text, start, end, hasScriptRanges, line._scriptMetrics);
    if (cacheable) line._textDrawPlanCache = plan;
  }
  const baseX = lineBaseX(line, obj);
  for (const run of plan) {
    if (run.font) context.font = run.font;
    const y = line.textY + run.offset;
    for (const draw of run.draws) {
      context.fillText(draw.text, baseX + draw.x, y);
    }
    if (run.font) context.font = FONT;
  }
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') return null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return options.collectStats === false ? null : cloneTextDrawStats(plan.stats, cacheHit);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

const normalizeTextLayoutHitCaretIndex = (line, index, direction = 'forward', obj = null) => {
  const text = normalizeTextContent(obj?.data?.content ?? line?.content ?? line?.text ?? '');
  const ranges = line?.scriptRanges || [];
  let pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  if (!ranges.length) return pos;
  const step = direction === 'backward' ? -1 : 1;
  let guard = text.length + 1;
  while (guard-- > 0 && pos >= 0 && pos <= text.length && ranges.some((range) => (
    isTextScriptBracedRange(text, range) ? range.start === pos : range.start === pos + 1
  ))) {
    pos += step;
    if (pos < 0) return 0;
    if (pos > text.length) return text.length;
  }
  return pos;
};

const textLayoutCaretHit = (line, wx, wy, obj) => {
  const content = typeof obj?._layoutCacheContent === 'string'
    ? obj._layoutCacheContent
    : typeof line.content === 'string'
      ? line.content
      : normalizeTextContent(obj?.data?.content ?? line.text ?? '');
  const metrics = line._scriptMetrics;
  let hitIndex = null;
  let hitAffinity = '';
  let hitDistance = Infinity;

  const pw = line.prefixWidths;
  const first = lineHitOffsetForX(line, wx, obj, true);
  const bestX = pw[first];
  let last = first;
  while (last < line.text.length && Math.abs(pw[last + 1] - bestX) <= 1e-7) last++;
  for (let offset = first; offset <= last; offset++) {
    const rawIndex = Math.max(0, Math.min(line.startIndex + offset, content.length));
    if (metrics?.bracedStarts?.[rawIndex]) continue;

    const bracedRangeEnding = !!metrics?.bracedEnds?.[rawIndex];
    const linearRangeEnding = !!metrics?.linearEnds?.[rawIndex];

    const candidateCount = linearRangeEnding ? 2 : 1;
    for (let candidate = 0; candidate < candidateCount; candidate++) {
      const affinity = candidate
        ? (bracedRangeEnding ? '' : 'after')
        : (bracedRangeEnding ? 'after' : '');
      const state = metrics
        ? textScriptMetricsCaretStateAt(metrics, rawIndex, affinity)
        : BASE_TEXT_SCRIPT_STATE;
      let centerY = line.y + LINE_H / 2;
      if (state?.depth > 0) {
        const scale = Number.isFinite(state.scale) && state.scale > 0 ? state.scale : 1;
        const textY = Number.isFinite(line.textY) ? line.textY : line.y + TEXT_BASELINE_Y_OFFSET;
        centerY = textY + state.offset - (TEXT_BASELINE_Y_OFFSET * scale) + (LINE_H * scale) / 2;
      }
      const distance = Math.abs(centerY - wy);
      if (
        hitIndex === null ||
        distance < hitDistance ||
        (distance === hitDistance && rawIndex < hitIndex) ||
        (
          distance === hitDistance &&
          rawIndex === hitIndex &&
          affinity < hitAffinity
        )
      ) {
        hitIndex = rawIndex;
        hitAffinity = affinity;
        hitDistance = distance;
      }
    }
  }

  return hitIndex === null
    ? null
    : { index: hitIndex, affinity: hitAffinity, lineStartIndex: line.startIndex };
};

function layoutHitTestCaret(layout, wx, wy, obj, legacyScalar = false) {
  if (!layout.length) return { index: 0, affinity: '' };
  let lo = 0;
  let hi = layout.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wy < layout[mid].y + LINE_H) hi = mid;
    else lo = mid + 1;
  }
  const line = layout[lo];
  if (!line.text.length) return { index: line.startIndex, affinity: '', lineStartIndex: line.startIndex };
  if (!legacyScalar && !line.scriptRanges?.length) {
    const hitIndex = line.startIndex + lineHitOffsetForX(line, wx, obj, true);
    TextSelDebug._logHit(wx, wy, obj, line, hitIndex, line.prefixWidths);
    return { index: hitIndex, affinity: '', lineStartIndex: line.startIndex };
  }
  const hit = legacyScalar ? null : textLayoutCaretHit(line, wx, wy, obj);
  if (hit) {
    TextSelDebug._logHit(wx, wy, obj, line, hit.index, line.prefixWidths);
    return hit;
  }

  const pw = line.prefixWidths;
  const offset = lineHitOffsetForX(line, wx, obj);
  const direction = offset < line.text.length ? 'forward' : 'backward';
  const hitIndex = normalizeTextLayoutHitCaretIndex(line, line.startIndex + offset, direction, obj);
  TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
  return { index: hitIndex, affinity: '', lineStartIndex: line.startIndex };
}
