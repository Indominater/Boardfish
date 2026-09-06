'use strict';

var FONT_SIZE = 16;
var LINE_H    = 24;
var TEXT_PAD  = 16;
const regular_text = 400;
const TEXT_FONT_STYLE = 'normal';
const TEXT_FONT_FAMILY = "'Geist Sans', system-ui";
const textFontForSize = (size) => `${TEXT_FONT_STYLE} ${regular_text} ${size}px ${TEXT_FONT_FAMILY}`;
var FONT      = textFontForSize(FONT_SIZE);
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
var _textRasterCache = null;

function clearTextRasterCache() {
  _textRasterCache?.clear();
}

function beginTextRasterFrame() {
  _textGpuRenderer?.beginFrame?.();
  if (typeof BoardfishTextRaster === 'undefined') return;
  _textRasterCache ??= BoardfishTextRaster.createTextRasterCache();
  _textRasterCache.beginFrame();
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function getTextRasterCacheStats() {
  return _textRasterCache?.getStats() || { bytes: 0, entries: 0 };
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function normalizeTextContent(value) {
  const text = String(value ?? '');
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

const trimWhitespaceOnlyEdgeLines = (value) => {
  const text = normalizeTextContent(value);
  return /\S/.test(text) ? (text.includes('\n') ? text.replace(/^(?:[^\S\n]*\n)+|(?:\n[^\S\n]*)+$/g, '') : text) : '';
};

const textForClipboard = trimWhitespaceOnlyEdgeLines;
const textSelectionForClipboard = trimWhitespaceOnlyEdgeLines;
const textForTextObjectPaste = trimWhitespaceOnlyEdgeLines;

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
const TEXT_GLYPH_METRICS_CACHE_MAX_ENTRIES = 4096;
const TEXT_GLYPH_PAIR_SPACING_CACHE_MAX_ENTRIES = 4096;
const TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES = 4096;
const TEXT_WRAPPED_WIDTH_CACHE_MAX_ENTRIES = 12;
const TEXT_VIEWPORT_LAYOUT_RANGE_CACHE_MAX_ENTRIES = 48;
const TEXT_VIEWPORT_LAYOUT_LINE_CACHE_MAX_ENTRIES = 8192;
const TEXT_EXACT_PREFIX_MAX_CHARS = 384;
var _mwCache = new Map();
var _glyphMetricsCache = new Map();
var _glyphPairSpacingCache = new Map();
var _textGraphemeSegmenter = null;
var _asciiTextMetrics = null;

function forEachTextSpacingUnit(text, callback, start = 0, end = null) {
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, text.length));
  const to = Math.max(from, Math.min(end == null ? text.length : Math.trunc(Number(end)) || 0, text.length));
  if (from >= to) return;
  const hasGraphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

  if (!/[^\x00-\x7F]/.test(text.slice(from, to))) {
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
    let next = Math.min(to, index + (codePoint > 0xFFFF ? 2 : 1));
    // Keep common extended graphemes intact even in engines without Segmenter.
    // In particular, never expose surrogate, accent, emoji modifier, flag or
    // joined-emoji interiors as wrapping or caret boundaries.
    if (codePoint >= 0x1F1E6 && codePoint <= 0x1F1FF && next < to) {
      const second = text.codePointAt(next);
      if (second >= 0x1F1E6 && second <= 0x1F1FF) next = Math.min(to, next + 2);
    }
    while (next < to) {
      const following = text.codePointAt(next);
      const size = following > 0xFFFF ? 2 : 1;
      if (/\p{Grapheme_Extend}/u.test(String.fromCodePoint(following)) ||
          (following >= 0x1F3FB && following <= 0x1F3FF)) {
        next = Math.min(to, next + size);
      } else if (following === 0x200D && next + 1 < to) {
        const joined = text.codePointAt(next + 1);
        next = Math.min(to, next + 1 + (joined > 0xFFFF ? 2 : 1));
      } else {
        break;
      }
    }
    callback(text.slice(index, next), index, next);
    index = next;
  }
}

function measureRawTextW(text) {
  const value = String(text ?? '');
  const cached = _mwCache.get(value);
  if (cached !== undefined) return cached;
  if (_mwCache.size >= TEXT_MEASURE_CACHE_MAX_ENTRIES) {
    _mwCache.delete(_mwCache.keys().next().value);
  }
  let width = 0;
  let previousUnit = null;
  forEachTextSpacingUnit(value, (unit) => {
    width += textGlyphPairSpacing(previousUnit, unit);
    width += measureTextGlyphMetricsWithFont(unit).width;
    previousUnit = unit;
  });
  _mwCache.set(value, width);
  return width;
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
  _asciiTextMetrics = null;
  _mwCache.clear();
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
    ascent: Number.isFinite(metrics?.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : FONT_SIZE,
    descent: Number.isFinite(metrics?.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : LINE_H - FONT_SIZE,
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

// ASCII has a finite alphabet. Keep advances and pair adjustments in indexed
// storage so building a new paragraph does not run a regex, construct font keys,
// or maintain an LRU cache for each character. The general path remains available
// for existing content containing other scripts or control characters.
function getAsciiTextMetrics() {
  if (!_asciiTextMetrics || _asciiTextMetrics.font !== FONT) {
    _asciiTextMetrics = {
      font: FONT,
      widths: new Float64Array(128).fill(NaN),
      pairs: new Float64Array(128 * 128).fill(NaN),
    };
  }
  return _asciiTextMetrics;
}

function asciiTextGlyphWidth(metrics, code) {
  let width = metrics.widths[code];
  if (width !== width) {
    width = measureTextGlyphMetricsWithFont(String.fromCharCode(code), metrics.font).width;
    metrics.widths[code] = width;
  }
  return width;
}

function asciiTextPairSpacing(metrics, previous, next) {
  if (previous <= 32 || next <= 32) return 0;
  const key = (previous << 7) | next;
  let spacing = metrics.pairs[key];
  if (spacing !== spacing) {
    spacing = textGlyphPairSpacing(String.fromCharCode(previous), String.fromCharCode(next), metrics.font);
    metrics.pairs[key] = spacing;
  }
  return spacing;
}

function getAsciiPrefixWidths(value) {
  const metrics = getAsciiTextMetrics();
  const pw = new Float64Array(value.length + 1);
  let boundarySpacing = null;
  let width = 0;
  let previous = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 9) {
      width = textWidthAfterTab(width);
      previous = 0;
    } else {
      const spacing = asciiTextPairSpacing(metrics, previous, code);
      if (spacing) {
        width += spacing;
        pw[index] = width;
        if (!boundarySpacing) boundarySpacing = new Float64Array(value.length + 1);
        boundarySpacing[index] = spacing;
      }
      width += asciiTextGlyphWidth(metrics, code);
      previous = code;
    }
    pw[index + 1] = width;
  }
  if (boundarySpacing) pw.boundarySpacing = boundarySpacing;
  return pw;
}

function clearTextObjectLayoutRuntime(obj, options) {
  if (!obj) return;
  obj._layoutCache = obj._layoutCacheContent = null;
  if (options?.minWidth !== false) {
    obj._textMinWidthCache = obj._textMinWidthCacheContent = null;
  }
  if (options?.prefix !== false) {
    obj._textParagraphPrefixCache = obj._textParagraphPrefixCacheContent = null;
  }
  obj._textWrappedLineCountCacheContent = obj._textWrappedLineCountCacheValue =
    obj._textWrappedLineIndexCacheContent = obj._textWrappedLineIndexCache =
    obj._textWrappedLineIndexWidthCacheContent = obj._textWrappedLineIndexWidthCache =
    obj._textViewportLayoutRangeCacheContent = obj._textViewportLayoutRangeCache =
    obj._textViewportLayoutLineCacheContent = obj._textViewportLayoutLineCache = null;
}

const cloneTextLayoutRuntimeLine = ({ _textDrawPlanCache, ...clone }) => clone;

function cloneTextObjectRuntimeCaches(source, target, preserveDrawPlans = true) {
  if (!source || !target || source.type !== 'text' || target.type !== 'text') return target;
  const content = target.data.content;
  if (
    Number.isFinite(source._textMinWidthCache) &&
    source._textMinWidthCacheContent === content
  ) {
    target._textMinWidthCache = source._textMinWidthCache;
    target._textMinWidthCacheContent = source._textMinWidthCacheContent;
  }

  if (
    source._textParagraphPrefixCache &&
    typeof source._textParagraphPrefixCache.entries === 'function' &&
    source._textParagraphPrefixCacheContent === content
  ) {
    target._textParagraphPrefixCache = source._textParagraphPrefixCache;
    target._textParagraphPrefixCacheContent = source._textParagraphPrefixCacheContent;
  }

  if (
    source._textWrappedLineCountCacheContent === content &&
    source._textWrappedLineCountCacheW === target.w &&
    Number.isFinite(source._textWrappedLineCountCacheValue)
  ) {
    target._textWrappedLineCountCacheContent = source._textWrappedLineCountCacheContent;
    target._textWrappedLineCountCacheW = source._textWrappedLineCountCacheW;
    target._textWrappedLineCountCacheValue = source._textWrappedLineCountCacheValue;
  }

  if (
    source._textWrappedLineIndexCacheContent === content &&
    source._textWrappedLineIndexCacheW === target.w &&
    source._textWrappedLineIndexCache &&
    Array.isArray(source._textWrappedLineIndexCache.entries)
  ) {
    target._textWrappedLineIndexCacheContent = source._textWrappedLineIndexCacheContent;
    target._textWrappedLineIndexCacheW = source._textWrappedLineIndexCacheW;
    target._textWrappedLineIndexCache = source._textWrappedLineIndexCache;
  }

  if (!target._layoutCache &&
    Array.isArray(source._layoutCache) &&
    source._layoutCacheContent === content &&
    source._layoutCacheW === target.w
  ) {
    target._layoutCache = source._layoutCache.map(
      preserveDrawPlans ? (line) => ({ ...line }) : cloneTextLayoutRuntimeLine,
    );
    target._layoutCacheContent = source._layoutCacheContent;
    target._layoutCacheW = source._layoutCacheW;
    target._layoutCacheY = target.y;
    if (source._layoutCacheY !== target.y) syncTextLayoutLinePositions(target, target._layoutCache);
  }

  return target;
}

const clearTextLayoutCaches = (options = {}) => {
  clearTextRasterCache();
  if (typeof clearTextGpuCache === 'function') clearTextGpuCache();
  _prefixCache.clear();
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
  if (/^[\x20-\x7e\t]*$/.test(value)) {
    const widths = getAsciiPrefixWidths(value);
    _prefixCache.set(value, widths);
    trimMapCache(_prefixCache, TEXT_PREFIX_CACHE_MAX_ENTRIES);
    return widths;
  }
  const pw = new Float64Array(value.length + 1);
  let boundarySpacing = null;
  let graphemeBoundaries = null;
  let width = 0;
  let k = 0;
  let previousUnit = null;
  while (k < value.length) {
    if (value[k] === '\t') {
      width = textWidthAfterTab(width);
      pw[k + 1] = width;
      k++;
      if (graphemeBoundaries) graphemeBoundaries.push(k);
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
        if (!boundarySpacing) boundarySpacing = new Float64Array(value.length + 1);
        boundarySpacing[unitStart] = spacing;
      }
      width += measureRawTextW(unit);
      for (let pos = unitStart + 1; pos <= unitEnd; pos++) pw[pos] = width;
      if (!graphemeBoundaries && unitEnd - unitStart > 1) {
        graphemeBoundaries = Array.from({ length: unitStart + 1 }, (_, index) => index);
      }
      if (graphemeBoundaries) graphemeBoundaries.push(unitEnd);
      previousUnit = unit;
    }, runStart, k);
  }
  if (boundarySpacing) pw.boundarySpacing = boundarySpacing;
  if (graphemeBoundaries) pw.graphemeBoundaries = graphemeBoundaries;
  _prefixCache.set(value, pw);
  trimMapCache(_prefixCache, TEXT_PREFIX_CACHE_MAX_ENTRIES);
  return pw;
}

function getTextRangePrefixWidths(text) {
  return getPrefixWidths(String(text ?? ''));
}

function getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, text, start, end) {
  if (
    obj._textParagraphPrefixCacheContent !== text ||
    !obj._textParagraphPrefixCache ||
    typeof obj._textParagraphPrefixCache.get !== 'function'
  ) {
    obj._textParagraphPrefixCache = new Map();
    obj._textParagraphPrefixCacheContent = text;
  }

  const cached = obj._textParagraphPrefixCache.get(start);
  if (cached) {
    if (obj._textParagraphPrefixCache.size >= TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES) {
      obj._textParagraphPrefixCache.delete(start);
      obj._textParagraphPrefixCache.set(start, cached);
    }
    return cached;
  }

  const widths = getPrefixWidths(text.slice(start, end));
  obj._textParagraphPrefixCache.set(start, widths);
  trimMapCache(obj._textParagraphPrefixCache, TEXT_PARAGRAPH_PREFIX_CACHE_MAX_ENTRIES);
  return widths;
}

function getCachedTextWrappedLineCount(obj, text) {
  if (!obj || obj.type !== 'text') return null;
  if (
    obj._textWrappedLineCountCacheContent === text &&
    obj._textWrappedLineCountCacheW === obj.w &&
    Number.isFinite(obj._textWrappedLineCountCacheValue)
  ) {
    return obj._textWrappedLineCountCacheValue;
  }
  return null;
}

function setCachedTextWrappedLineCount(obj, text, lineCount) {
  if (!obj || obj.type !== 'text') return;
  obj._textWrappedLineCountCacheContent = text;
  obj._textWrappedLineCountCacheW = obj.w;
  obj._textWrappedLineCountCacheValue = Math.max(1, Math.trunc(Number(lineCount)) || 1);
}

function getCachedTextWrappedLineIndex(obj, text) {
  if (!obj || obj.type !== 'text') return null;
  const cache = obj._textWrappedLineIndexCache;
  if (
    cache &&
    Array.isArray(cache.entries) &&
    cache.entries.length &&
    obj._textWrappedLineIndexCacheContent === text &&
    obj._textWrappedLineIndexCacheW === obj.w &&
    Number.isInteger(cache.lineCount) &&
    cache.lineCount > 0
  ) {
    return cache;
  }
  const widthCache = obj._textWrappedLineIndexWidthCacheContent === text &&
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
    obj._textWrappedLineIndexCache = widthCached;
    setCachedTextWrappedLineCount(obj, text, widthCached.lineCount);
    return widthCached;
  }
  return null;
}

function setCachedTextWrappedLineIndex(obj, text, entries, lineCount) {
  if (!obj || obj.type !== 'text' || !Array.isArray(entries)) return;
  const count = Math.max(1, Math.trunc(Number(lineCount)) || 1);
  obj._textWrappedLineIndexCacheContent = text;
  obj._textWrappedLineIndexCacheW = obj.w;
  const cache = {
    lineCount: count,
    entries,
  };
  obj._textWrappedLineIndexCache = cache;
  setCachedTextWrappedLineCount(obj, text, count);
  if (
    obj._textWrappedLineIndexWidthCacheContent !== text ||
    typeof obj._textWrappedLineIndexWidthCache?.set !== 'function'
  ) {
    obj._textWrappedLineIndexWidthCacheContent = text;
    obj._textWrappedLineIndexWidthCache = new Map();
  }
  const widthCache = obj._textWrappedLineIndexWidthCache;
  widthCache.delete(obj.w);
  widthCache.set(obj.w, cache);
  trimMapCache(widthCache, TEXT_WRAPPED_WIDTH_CACHE_MAX_ENTRIES);
}

function ensureCachedTextWrappedLineIndex(obj, content) {
  const cached = getCachedTextWrappedLineIndex(obj, content);
  if (cached) return cached;
  const wrapped = buildWrappedLines(obj, { collect: false, collectLineIndex: true });
  setCachedTextWrappedLineIndex(obj, content, wrapped.lineIndex || [], wrapped.lineCount);
  return getCachedTextWrappedLineIndex(obj, content);
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
  const content = obj.data?.content || '';
  const beforePrefixEntries = obj._textParagraphPrefixCache?.size || 0;
  const lineIndexCache = ensureCachedTextWrappedLineIndex(obj, content);
  const entries = lineIndexCache?.entries || [];
  const prefixCacheWarm = (
    obj._textParagraphPrefixCacheContent === content &&
    obj._textParagraphPrefixCache &&
    typeof obj._textParagraphPrefixCache.get === 'function' &&
    beforePrefixEntries >= entries.length
  );
  if (prefixCacheWarm) {
    return {
      available: true,
      contentChars: content.length,
      logicalLineEntries: entries.length,
      processedLogicalLines: 0,
      processedChars: 0,
      lineCount: lineIndexCache?.lineCount || 0,
      prefixCacheEntriesBefore: beforePrefixEntries,
      prefixCacheEntriesAfter: beforePrefixEntries,
      prefixCacheEntriesAdded: 0,
      wrappedLineIndexEntries: entries.length,
      layoutCachePresent: Array.isArray(obj._layoutCache),
      skipped: 'warm',
      totalMs: textLayoutDebugRound(textLayoutDebugNow() - startedAt),
    };
  }
  const maxLogicalLines = options.maxLogicalLines == null
    ? Infinity
    : Math.max(0, Math.trunc(Number(options.maxLogicalLines)) || 0);
  let processedLogicalLines = 0;
  let processedChars = 0;
  for (const entry of entries) {
    if (processedLogicalLines >= maxLogicalLines) break;
    const start = Math.max(0, Math.min(Math.trunc(Number(entry?.startIndex)) || 0, content.length));
    const end = Math.max(start, Math.min(Math.trunc(Number(entry?.endIndex)) || start, content.length));
    getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, content, start, end);
    processedLogicalLines++;
    processedChars += Math.max(0, end - start);
  }
  const afterPrefixEntries = obj._textParagraphPrefixCache?.size || 0;
  return {
    available: true,
    contentChars: content.length,
    logicalLineEntries: entries.length,
    processedLogicalLines,
    processedChars,
    lineCount: lineIndexCache?.lineCount || 0,
    prefixCacheEntriesBefore: beforePrefixEntries,
    prefixCacheEntriesAfter: afterPrefixEntries,
    prefixCacheEntriesAdded: Math.max(0, afterPrefixEntries - beforePrefixEntries),
    wrappedLineIndexEntries: entries.length,
    layoutCachePresent: Array.isArray(obj._layoutCache),
    totalMs: textLayoutDebugRound(textLayoutDebugNow() - startedAt),
  };
}

function measureTextRangeW(text, start, end) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const widths = getPrefixWidths(text.slice(from, to));
  return widths[widths.length - 1] || 0;
}

function textPrefixWidthsSlice(prefixWidths, from, to) {
  const source = prefixWidths;
  const start = Math.max(0, Math.min(Math.trunc(Number(from)) || 0, Math.max(0, (source?.length || 1) - 1)));
  const end = Math.max(start, Math.min(Math.trunc(Number(to)) || start, Math.max(0, (source?.length || 1) - 1)));
  const out = new Float64Array(end - start + 1);
  const base = source[start] || 0;
  for (let index = start; index <= end; index++) out[index - start] = Math.max(0, (source[index] || 0) - base);
  // Prefix positions point to glyph starts, including the gap before that
  // glyph. The final position must exclude the next, unrendered glyph's gap.
  out[end - start] = textPrefixRangeWidth(source, start, end);
  if (source.graphemeBoundaries) {
    const first = textGraphemeBoundaryIndex(source, start);
    const last = textGraphemeBoundaryIndex(source, end);
    out.graphemeBoundaries = source.graphemeBoundaries.slice(first, last + 1).map((offset) => offset - start);
  }
  return out;
}

function textPrefixRangeWidth(prefixWidths, start, end) {
  if (end <= start) return 0;
  return Math.max(0, prefixWidths[end] - (prefixWidths.boundarySpacing?.[end] || 0) - prefixWidths[start]);
}

function textGraphemeBoundaryIndex(prefixWidths, offset) {
  const boundaries = prefixWidths.graphemeBoundaries;
  if (!boundaries) return offset;
  let lo = 0, hi = boundaries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boundaries[mid] < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function textGraphemeOffset(prefixWidths, offset, forward = false) {
  const bounded = Math.max(0, Math.min(offset, prefixWidths.length - 1));
  const boundaries = prefixWidths.graphemeBoundaries;
  if (!boundaries) return bounded;
  const index = textGraphemeBoundaryIndex(prefixWidths, bounded);
  return boundaries[!forward && boundaries[index] > bounded ? Math.max(0, index - 1) : index];
}

function textRangeIncludes(text, start, end, character = '\t') {
  const index = text.indexOf(character, start);
  return index !== -1 && index < end;
}

const findTextWrapEndByWidth = (rangeWidth, start, end, maxW, boundaryAt = (index) => index) => {
  let lo = boundaryAt(start + 1, true);
  let hi = end;
  if (rangeWidth(start, lo) > maxW) return lo;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (rangeWidth(start, mid) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return boundaryAt(lo);
};

const nextNonSpaceIndex = (content, start, end) => {
  let index = start;
  while (index < end && content[index] === ' ') index++;
  return index;
};

function wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, rangeWidth, pushLine, boundaryAt) {
  let lineStart = paraStart;
  let wordEnd = paraStart;
  while (lineStart < paraEnd) {
    const previousLineStart = lineStart;
    let cursor = lineStart;
    let bestEnd = lineStart;
    let bestNext = lineStart;

    while (cursor < paraEnd) {
      const wordStart = nextNonSpaceIndex(content, cursor, paraEnd);
      if (wordStart >= paraEnd) {
        const lineEnd = findTextWrapEndByWidth(rangeWidth, lineStart, paraEnd, maxW, boundaryAt);
        pushLine(lineStart, lineEnd, paraEnd, paraEnd);
        lineStart = paraEnd;
        break;
      }

      wordEnd = Math.max(wordEnd, wordStart + 1);
      while (wordEnd < paraEnd && content[wordEnd] !== ' ') wordEnd++;
      if (rangeWidth(lineStart, wordEnd) <= maxW) {
        bestEnd = wordEnd;
        const afterSpaces = nextNonSpaceIndex(content, wordEnd, paraEnd);
        if (wordEnd < paraEnd && afterSpaces >= paraEnd) {
          bestEnd = findTextWrapEndByWidth(rangeWidth, lineStart, paraEnd, maxW, boundaryAt);
          bestNext = paraEnd;
          cursor = paraEnd;
          continue;
        }
        bestNext = afterSpaces;
        cursor = bestNext;
        continue;
      }

      if (bestEnd > lineStart) break;
      const end = findTextWrapEndByWidth(rangeWidth, lineStart, wordEnd, maxW, boundaryAt);
      const nextStart = end < paraEnd && content[end] === ' '
        ? nextNonSpaceIndex(content, end, paraEnd)
        : end;
      pushLine(lineStart, end, nextStart, nextStart);
      lineStart = nextStart;
      break;
    }

    // A long word or trailing spaces already emitted this row above.
    if (lineStart !== previousLineStart) continue;
    if (bestEnd > lineStart) {
      pushLine(lineStart, bestEnd, bestNext, bestNext);
      lineStart = bestNext;
    } else {
      const lineEnd = boundaryAt(lineStart + 1, true);
      pushLine(lineStart, lineEnd, lineEnd, lineEnd);
      lineStart = lineEnd;
    }
  }
}

function findAsciiTabWrapEndByWidth(content, start, end, maxW, metrics) {
  let width = 0;
  let previous = 0;
  let index = start;
  while (index < end) {
    const code = content.charCodeAt(index);
    let nextWidth = width;
    if (code === 9) {
      nextWidth = textWidthAfterTab(width);
    } else {
      nextWidth += asciiTextPairSpacing(metrics, previous, code);
      nextWidth += asciiTextGlyphWidth(metrics, code);
    }
    // Every row consumes at least one character even when its first tab or
    // glyph is wider than the box, matching the general wrapping path.
    if (nextWidth > maxW) return index === start ? index + 1 : index;
    width = nextWidth;
    previous = code === 9 ? 0 : code;
    index++;
  }
  return end;
}

function wrapTextParagraph(obj, content, paraStart, paraEnd, maxW, pushLine, collectPrefixWidths = true) {
  const paragraphHasTab = textRangeIncludes(content, paraStart, paraEnd);
  const asciiTabMetrics = paragraphHasTab && /^[\x20-\x7e\t]*$/.test(content.slice(paraStart, paraEnd))
    ? getAsciiTextMetrics()
    : null;
  const paragraphPrefixWidths = getTextObjectParagraphPrefixWidthsForNormalizedContent(obj, content, paraStart, paraEnd);
  const boundaryAt = (index, forward = false) => paraStart + textGraphemeOffset(paragraphPrefixWidths, index - paraStart, forward);
  const rangeWidth = (start, end) => paragraphHasTab
    ? measureTextRangeW(content, start, end)
    : textPrefixRangeWidth(paragraphPrefixWidths, start - paraStart, end - paraStart);
  const pushParagraphLine = (start, end, nextStart = end, caretEnd = end) => {
    const prefixWidths = collectPrefixWidths && !paragraphHasTab
      ? textPrefixWidthsSlice(paragraphPrefixWidths, start - paraStart, end - paraStart)
      : null;
    pushLine(start, end, nextStart, caretEnd, prefixWidths);
  };
  if (rangeWidth(paraStart, paraEnd) <= maxW) {
    pushParagraphLine(paraStart, paraEnd, paraEnd, paraEnd);
    return;
  }
  if (!paragraphHasTab && paraEnd - paraStart > TEXT_EXACT_PREFIX_MAX_CHARS) {
    wrapPlainLargeParagraph(content, paraStart, paraEnd, maxW, rangeWidth, pushParagraphLine, boundaryAt);
    return;
  }
  let lineStart = paraStart;
  while (lineStart < paraEnd) {
    // Tab stops restart at each visual row. Scanning that row once avoids the
    // repeated substring-prefix construction used by binary width searches.
    let lineEnd = asciiTabMetrics
      ? findAsciiTabWrapEndByWidth(content, lineStart, paraEnd, maxW, asciiTabMetrics)
      : findTextWrapEndByWidth(rangeWidth, lineStart, paraEnd, maxW, boundaryAt);
    let nextStart = lineEnd;
    let caretEnd = lineEnd;
    if (lineEnd < paraEnd) {
      // First check the fitted endpoint: it may already be a complete word.
      let breakAt = isTextWordSeparator(content[lineEnd]) ? lineEnd : -1;
      if (breakAt < 0) {
        for (let index = lineEnd; index > lineStart; index--) {
          if (isTextWordSeparator(content[index - 1])) {
            breakAt = index - 1;
            break;
          }
        }
      }
      while (breakAt > lineStart && isTextWordSeparator(content[breakAt - 1])) breakAt--;
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
    pushParagraphLine(lineStart, lineEnd, nextStart, caretEnd);
    lineStart = nextStart;
  }
}

function clearTextMeasurementCaches() {
  refreshTextMetrics();
  clearTextLayoutCaches({ measurements: true });
  syncAllTextAutoHeights();
  scheduleRender(true, true);
}

function buildWrappedLines(obj, options = {}, content = obj.data.content) {
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
          endIndex: Math.max(end, nextStart, caretEnd),
          visualStart: visualLineIndex,
          visualEnd: visualLineIndex,
        };
        lineIndex.push(entry);
      } else {
        entry.startIndex = Math.min(entry.startIndex, start);
        entry.endIndex = Math.max(entry.endIndex, end, nextStart, caretEnd);
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
      wrapTextParagraph(obj, content, paraStart, paraEnd, maxW,
        (start, end, nextStart, caretEnd, prefixWidths) => {
          pushLine(start, end, nextStart, caretEnd, logicalLineIndex, prefixWidths);
        }, collectLines);
    }

    if (newlineAt === -1) break;
    paraStart = newlineAt + 1;
    logicalLineIndex++;
  }

  return { lines: result, lineCount: Math.max(1, knownLineCount || visualLineIndex), lineIndex };
}

function getWrappedLineCount(obj, text) {
  if (!obj || obj.type !== 'text') return 1;
  const cachedCount = getCachedTextWrappedLineCount(obj, text)
    ?? getCachedTextWrappedLineIndex(obj, text)?.lineCount;
  if (cachedCount != null) {
    return Math.max(1, Math.trunc(Number(cachedCount)) || 1);
  }
  const wrapped = buildWrappedLines(obj, { collect: false, collectLineIndex: true });
  setCachedTextWrappedLineIndex(obj, text, wrapped.lineIndex || [], wrapped.lineCount);
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
  const content = obj.data.content;
  const firstLine = Math.max(0, Math.trunc(Number(startLine)) || 0);
  const lastLine = Math.max(firstLine, Math.trunc(Number(endLine)) || firstLine);
  const maxW = obj.w - TEXT_PAD * 2;
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

    wrapTextParagraph(obj, content, paraStart, paraEnd, maxW,
      (start, end, nextStart, caretEnd, prefixWidths) => {
        pushLine(start, end, nextStart, caretEnd, logicalLineIndex, prefixWidths);
      });
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

function layoutLineFromWrappedLine(obj, line, lineIndex) {
  const y = obj.y + TEXT_PAD + lineIndex * LINE_H;
  const prefixWidths = line.prefixWidths?.length === line.text.length + 1
    ? line.prefixWidths
    : getPrefixWidths(line.text);
  let visibleEnd = line.text.length;
  while (visibleEnd && isTextWordSeparator(line.text[visibleEnd - 1])) visibleEnd--;
  const layoutLine = {
    text: line.text,
    startIndex: line.startIndex,
    endIndex: line.endIndex,
    caretEndIndex: line.caretEndIndex,
    nextStartIndex: line.nextStartIndex,
    logicalLineIndex: line.logicalLineIndex || 0,
    y,
    textY: y + TEXT_BASELINE_Y_OFFSET,
    prefixWidths,
    visibleWidth: prefixWidths[visibleEnd] || 0,
  };
  return layoutLine;
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

  const oldSplice = textLayoutSpliceRangeForLogicalLines(layout, oldStartLine, oldEndLine);

  const newWrapped = wrapTextLogicalLineRange(obj, oldStartLine, newEndLine, {
    startIndex: layout[oldSplice.start].startIndex,
  });

  const insertedLayout = new Array(newWrapped.length);
  for (let i = 0; i < newWrapped.length; i++) {
    insertedLayout[i] = layoutLineFromWrappedLine(obj, newWrapped[i], oldSplice.start + i);
  }

  const removedLayoutCount = oldSplice.end - oldSplice.start;
  const layoutLineDelta = insertedLayout.length - removedLayoutCount;
  obj._lastTextLayoutLineDelta = layoutLineDelta;

  const yChanged = obj._layoutCacheY !== obj.y;
  if (yChanged) for (let i = 0; i < oldSplice.start; i++) {
    layout[i].y = obj.y + TEXT_PAD + i * LINE_H;
    layout[i].textY = layout[i].y + TEXT_BASELINE_Y_OFFSET;
  }
  for (let i = oldSplice.end; i < layout.length; i++) {
    const line = layout[i];
    const lineIndex = i + layoutLineDelta;
    line.startIndex += deltaChars;
    line.endIndex += deltaChars;
    if (Number.isFinite(line.caretEndIndex)) line.caretEndIndex += deltaChars;
    if (Number.isFinite(line.nextStartIndex)) line.nextStartIndex += deltaChars;
    line.logicalLineIndex = (line.logicalLineIndex || 0) + logicalLineDelta;
    line.y = obj.y + TEXT_PAD + lineIndex * LINE_H;
    line.textY = line.y + TEXT_BASELINE_Y_OFFSET;
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
  obj._layoutCacheY = obj.y;

  if (collectDiagnostics) {
    debug.ok = true;
    debug.newLayoutLines = layout.length;
    debug.removedLayoutLines = removedLayoutCount;
    debug.insertedLayoutLines = insertedLayout.length;
    debug.layoutLineDelta = layoutLineDelta;
    debug.logicalLineDelta = logicalLineDelta;
    debug.deltaChars = deltaChars;
    obj._lastTextLayoutPatchDebug = debug;
  }
  return true;
}

function getTextAutoHeight(obj, minLines = 1) {
  const content = obj.data.content;
  const cachedLineCount = obj?.type === 'text' &&
    Array.isArray(obj._layoutCache) &&
    obj._layoutCacheContent === content &&
    obj._layoutCacheW === obj.w
      ? Math.max(1, obj._layoutCache.length)
      : null;
  const lineCount = cachedLineCount ?? getWrappedLineCount(obj, content);
  return Math.max(minLines, lineCount) * LINE_H + TEXT_PAD * 2;
}

const isTextWordSeparator = (ch) => ch === ' ' || ch === '\t';
const isTextWordOrLineSeparator = (ch) => isTextWordSeparator(ch) || ch === '\n';

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

const getTextMinWidth = (obj) => {
  const paddedMinimum = TEXT_PAD * 2 + 1;
  if (!obj || obj.type !== 'text') return paddedMinimum;
  const content = obj.data?.content || '';
  if (
    obj._textMinWidthCacheContent === content &&
    Number.isFinite(obj._textMinWidthCache)
  ) {
    return obj._textMinWidthCache;
  }
  let bestWidth = 0;
  let contentOffset = 0;
  for (const line of content.split('\n')) {
    const prefixWidths = getTextObjectParagraphPrefixWidthsForNormalizedContent(
      obj,
      content,
      contentOffset,
      contentOffset + line.length,
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

function getCachedTextViewportLayoutRange(obj, content, first, last) {
  const cache = obj._textViewportLayoutRangeCache;
  if (
    !cache ||
    typeof cache.get !== 'function' ||
    obj._textViewportLayoutRangeCacheContent !== content ||
    obj._textViewportLayoutRangeCacheW !== obj.w ||
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

function ensureTextViewportLayoutLineCache(obj, content, totalLines = 0) {
  if (
    obj._textViewportLayoutLineCacheContent !== content ||
    obj._textViewportLayoutLineCacheW !== obj.w ||
    !obj._textViewportLayoutLineCache ||
    typeof obj._textViewportLayoutLineCache.set !== 'function'
  ) {
    obj._textViewportLayoutLineCacheContent = content;
    obj._textViewportLayoutLineCacheW = obj.w;
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

function getCachedTextViewportLayoutLines(obj, content, first, last) {
  const cache = ensureTextViewportLayoutLineCache(obj, content);
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
  return setCachedTextViewportLayoutRange(obj, content, first, last, layout, totalLines);
}

function setCachedTextViewportLayoutRange(obj, content, first, last, layout, totalLines) {
  if (
    obj._textViewportLayoutRangeCacheContent !== content ||
    obj._textViewportLayoutRangeCacheW !== obj.w ||
    obj._textViewportY !== obj.y ||
    !obj._textViewportLayoutRangeCache ||
    typeof obj._textViewportLayoutRangeCache.set !== 'function'
  ) {
    obj._textViewportLayoutRangeCacheContent = content;
    obj._textViewportLayoutRangeCacheW = obj.w;
    obj._textViewportY = obj.y;
    obj._textViewportLayoutRangeCache = new Map();
  }
  const out = setTextLayoutTotalLines(layout, totalLines);
  const lineCache = ensureTextViewportLayoutLineCache(obj, content, totalLines);
  for (let i = 0; i < out.length; i++) lineCache.set(first + i, out[i]);
  trimMapCache(lineCache, TEXT_VIEWPORT_LAYOUT_LINE_CACHE_MAX_ENTRIES);
  obj._textViewportLayoutRangeCache.set(`${first}:${last}`, out);
  trimMapCache(obj._textViewportLayoutRangeCache, TEXT_VIEWPORT_LAYOUT_RANGE_CACHE_MAX_ENTRIES);
  return out;
}

function textViewportLayoutLineCacheMissingSpans(obj, content, first, last, totalLines) {
  const cache = ensureTextViewportLayoutLineCache(obj, content, totalLines);
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

function buildTextViewportLayoutRangeFromLineIndex(obj, content, first, last, lineIndexCache) {
  const totalLines = lineIndexCache.lineCount;
  if (first >= totalLines) {
    return setCachedTextViewportLayoutRange(obj, content, first, last, [], totalLines);
  }
  const actualLast = Math.min(last, totalLines - 1);
  const firstEntry = textWrappedLineIndexEntryForVisual(lineIndexCache, first);
  const lastEntry = textWrappedLineIndexEntryForVisual(lineIndexCache, actualLast);
  const wrappedSourceLines = wrapTextLogicalLineRange(obj, firstEntry.entry.logicalLineIndex, lastEntry.entry.logicalLineIndex, {
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
      ));
    }
  }
  return setCachedTextViewportLayoutRange(obj, content, first, last, layout, totalLines);
}

function getTextLayout(obj) {
  const content = obj.data.content;
  if (
    obj._layoutCache &&
    obj._layoutCacheContent === content &&
    obj._layoutCacheW === obj.w
  ) {
    if (obj._layoutCacheY !== obj.y) {
      syncTextLayoutLinePositions(obj, obj._layoutCache);
      obj._layoutCacheY = obj.y;
    }
    return obj._layoutCache;
  }
  obj._layoutCacheContent = content;
  obj._layoutCacheW = obj.w;
  obj._layoutCacheY = obj.y;
  const wrapped = buildWrappedLines(obj, { collectLineIndex: true }, content);
  setCachedTextWrappedLineIndex(obj, content, wrapped.lineIndex || [], wrapped.lineCount);
  const lines = wrapped.lines;
  const layout = new Array(lines.length);
  const cachedLines = obj._textViewportLayoutLineCacheContent === content &&
    obj._textViewportLayoutLineCacheW === obj.w &&
    typeof obj._textViewportLayoutLineCache?.get === 'function'
      ? obj._textViewportLayoutLineCache
      : null;
  for (let i = 0; i < lines.length; i++) {
    const cached = cachedLines?.get(i);
    if (cached) {
      // Entering the full editor layout must retain the visible row's render
      // resource identity. Its content and wrapping already match this cache.
      cached.y = obj.y + TEXT_PAD + i * LINE_H;
      cached.textY = cached.y + TEXT_BASELINE_Y_OFFSET;
      layout[i] = cached;
    } else {
      layout[i] = layoutLineFromWrappedLine(obj, lines[i], i);
    }
  }
  obj._layoutCache = layout;
  return obj._layoutCache;
}

function getTextLayoutForLineRange(obj, first = 0, last = first) {
  const content = obj.data.content;
  const cachedRangeLayout = getCachedTextViewportLayoutRange(obj, content, first, last);
  if (cachedRangeLayout) return cachedRangeLayout;
  const cachedLineLayout = getCachedTextViewportLayoutLines(obj, content, first, last);
  if (cachedLineLayout) return cachedLineLayout;
  if (
    obj._layoutCache &&
    obj._layoutCacheContent === content &&
    obj._layoutCacheW === obj.w
  ) {
    if (obj._layoutCacheY !== obj.y) {
      syncTextLayoutLinePositions(obj, obj._layoutCache);
      obj._layoutCacheY = obj.y;
    }
    return setTextLayoutTotalLines(obj._layoutCache.slice(first, last + 1), obj._layoutCache.length);
  }

  const lineIndexCache = getCachedTextWrappedLineIndex(obj, content);
  if (!lineIndexCache) {
    const knownLineCount = getCachedTextWrappedLineCount(obj, content);
    const wrapped = buildWrappedLines(obj, {
      firstLineIndex: first,
      lastLineIndex: last,
      knownLineCount,
      collectLineIndex: knownLineCount == null,
    });
    if (wrapped.lineIndex) {
      setCachedTextWrappedLineIndex(obj, content, wrapped.lineIndex || [], wrapped.lineCount);
    } else {
      setCachedTextWrappedLineCount(obj, content, wrapped.lineCount);
    }
    const layout = new Array(wrapped.lines.length);
    for (let i = 0; i < wrapped.lines.length; i++) {
      const line = wrapped.lines[i];
      layout[i] = layoutLineFromWrappedLine(
        obj,
        line,
        Number.isFinite(line?.visualLineIndex) ? line.visualLineIndex : first + i,
      );
    }
    return setCachedTextViewportLayoutRange(obj, content, first, last, layout, wrapped.lineCount);
  }
  const totalLineCount = lineIndexCache.lineCount;
  const missingSpans = textViewportLayoutLineCacheMissingSpans(obj, content, first, last, totalLineCount);
  if (missingSpans.length) {
    const actualLast = Math.min(last, totalLineCount - 1);
    const requestedLineCount = first <= actualLast ? actualLast - first + 1 : 0;
    let missingLineCount = 0;
    for (const span of missingSpans) missingLineCount += span.last - span.first + 1;
    if (requestedLineCount > 0 && missingLineCount < requestedLineCount) {
      for (const span of missingSpans) {
        buildTextViewportLayoutRangeFromLineIndex(obj, content, span.first, span.last, lineIndexCache);
      }
      const assembled = getCachedTextViewportLayoutLines(obj, content, first, last);
      if (assembled) return assembled;
    }
  }
  return buildTextViewportLayoutRangeFromLineIndex(
    obj,
    content,
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

function lineBaseX(obj) {
  return obj.x + TEXT_PAD;
}

function lineXAtOffset(line, obj, offset) {
  return lineBaseX(obj) + line.prefixWidths[Math.max(0, Math.min(offset, line.text.length))];
}

function lineHitOffsetForX(line, wx, obj, nearest = false) {
  const textLength = line.text.length;
  const pw = line.prefixWidths;
  const boundaries = pw.graphemeBoundaries;
  const offsetAt = (index) => boundaries ? boundaries[index] : index;
  const target = wx - lineBaseX(obj);
  let lo = 0, hi = boundaries ? boundaries.length - 1 : textLength;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = pw[offsetAt(mid)];
    const nextX = pw[offsetAt(mid + 1)];
    if (nearest ? x < target : target >= x + (nextX - x) / 2) lo = mid + 1;
    else hi = mid;
  }
  if (!nearest) return offsetAt(lo);
  const left = Math.max(0, lo - 1);
  let offset = Math.abs(target - pw[offsetAt(left)]) <= Math.abs(target - pw[offsetAt(lo)]) ? left : lo;
  const x = pw[offsetAt(offset)];
  while (offset > 0 && Math.abs(pw[offsetAt(offset - 1)] - x) <= 1e-7) offset--;
  return offsetAt(offset);
}

function lineCaretXAtOffset(line, obj, offset) {
  const text = String(line?.text ?? '');
  const lineStart = Math.max(0, Math.trunc(Number(line?.startIndex)) || 0);
  const content = String(obj?.data?.content ?? line?.content ?? text);
  const caretEnd = Number.isFinite(line?.caretEndIndex)
    ? Math.max(lineStart, Math.min(Math.trunc(Number(line.caretEndIndex)) || lineStart, content.length))
    : lineStart + text.length;
  const maxOffset = Math.max(text.length, caretEnd - lineStart);
  const requestedOffset = Math.max(0, Math.min(Math.trunc(Number(offset)) || 0, maxOffset));
  const clamped = requestedOffset < text.length
    ? textGraphemeOffset(line.prefixWidths, requestedOffset, true)
    : requestedOffset;
  const baseX = lineBaseX(obj);
  const logicalX = baseX + (clamped <= text.length
    ? line.prefixWidths[clamped]
    : getPrefixWidths(content.slice(lineStart, lineStart + clamped))[clamped] || 0);
  if (clamped <= 0 || clamped >= text.length) return logicalX;

  const previousStart = textGraphemeOffset(line.prefixWidths, clamped - 1);
  const nextEnd = textGraphemeOffset(line.prefixWidths, clamped + 1, true);
  const previousChar = text.slice(previousStart, clamped);
  const nextChar = text.slice(clamped, nextEnd);
  if (!previousChar || !nextChar) return logicalX;
  if (/\s/.test(previousChar) || /\s/.test(nextChar)) return logicalX;

  const previousMetrics = measureTextGlyphMetricsWithFont(previousChar, FONT);
  const nextMetrics = measureTextGlyphMetricsWithFont(nextChar, FONT);
  if (
    !previousMetrics.hasInkBounds ||
    !nextMetrics.hasInkBounds ||
    textGlyphMetricsInkWidth(previousMetrics) <= TEXT_GLYPH_MIN_INK_WIDTH ||
    textGlyphMetricsInkWidth(nextMetrics) <= TEXT_GLYPH_MIN_INK_WIDTH
  ) {
    return logicalX;
  }

  const previousInkRight = baseX + line.prefixWidths[previousStart] + previousMetrics.right;
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
    skippedTabs: 0,
    skippedSpaces: 0,
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

function createTextDrawPlan(line, text, start, end) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let stats = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    stats = createTextDrawStats();
    stats.chars = end - start;
  }
  const draws = [];
  let batchingFontReady;
  let i = start;
  while (i < end) {
    if (text[i] === '\t') {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        stats.skippedTabs++;
      }
      i++;
      continue;
    }
    let j = i + 1;
    while (j < end) {
      if (text[j] === '\t') break;
      j++;
    }
    const runStart = draws.length;
    batchingFontReady ??= isTextDrawBatchingFontReady(FONT);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      stats.runs++;
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
      const previous = draws.length > runStart ? draws[draws.length - 1] : null;
      if (
        batchable &&
        previous?.text.length < TEXT_DRAW_BATCH_MAX_UNITS &&
        !(previous.text.endsWith('t') && unit === 't') &&
        Math.abs(x - previous.nextX) <= TEXT_DRAW_BATCH_POSITION_EPSILON
      ) {
        previous.text += unit;
        return;
      }
      draws.push({
        text: unit,
        x,
        nextX: batchable ? x + measureRawTextW(unit) : NaN,
      });
    }, i, j);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') stats.drawCalls += draws.length - runStart;
    i = j;
  }
  if (typeof BOARDFISH_PRODUCTION === 'undefined') draws.stats = stats;
  return draws;
}

function prepareTextLineForDraw(line) {
  if (!line) return null;
  const text = String(line.text ?? '');
  if (!line._textDrawPlanCache) {
    line._textDrawPlanCache = createTextDrawPlan(line, text, 0, text.length);
    // ASCII uses retained pixels. Existing boards can still display other scripts
    // through the original direct path without modifying their stored content.
    line._textDrawPlanCache.rasterEligible = /^[\x20-\x7e\t]*$/.test(text);
  }
  return line._textDrawPlanCache;
}

function prepareTextLayoutForDraw(layout) {
  if (!Array.isArray(layout)) return 0;
  let prepared = 0;
  for (const line of layout) {
    if (!line) continue;
    prepareTextLineForDraw(line);
    prepared++;
  }
  return prepared;
}

// The atlas and GPU buffers are runtime resources, never part of text objects,
// clipboard data, or history snapshots. The line renderer remains available for
// unsupported browsers, fonts, context state, and legacy non-ASCII content.
var _textGpuRenderer = null;

function getTextGpuRenderer() {
  if (!_textGpuRenderer && typeof BoardfishTextGpu !== 'undefined') {
    _textGpuRenderer = BoardfishTextGpu.createTextGpuRenderer({
      fontSize: FONT_SIZE,
      onReady: () => {
        if (typeof scheduleRender === 'function') scheduleRender(true);
      },
    });
  }
  return _textGpuRenderer;
}

function clearTextGpuCache() {
  _textGpuRenderer?.clear();
}

function drawTextLayoutGpu(context, layout, obj) {
  // Browsers canonicalize Canvas2D.font (for example, dropping "normal 400").
  // Compare against the browser's canonical value used by our measurement path.
  if ((context.font !== FONT && context.font !== _measureCtx.font) || !layout.length) return null;
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (!fontSet || fontSet.status !== 'loaded' || !fontSet.check(FONT, 'Boardfish')) return null;
  return getTextGpuRenderer()?.draw(context, layout, obj, { pad: TEXT_PAD }) || null;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function getTextGpuStats() {
  return _textGpuRenderer?.getStats() || { ready: false, bytes: 0, entries: 0 };
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function textDrawPlanRasterBounds(plan, font) {
  if (plan.rasterBounds?.font === font) return plan.rasterBounds.bounds;
  let left = Infinity, right = -Infinity, ascent = 0, descent = 0;
  for (const draw of plan) {
    const metrics = measureTextGlyphMetricsWithFont(draw.text, font);
    draw.inkLeft = draw.x - metrics.left;
    draw.inkRight = draw.x + metrics.right;
    left = Math.min(left, draw.inkLeft);
    right = Math.max(right, draw.inkRight);
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
  }
  const bounds = { left, right, ascent, descent };
  plan.rasterBounds = { font, bounds };
  return bounds;
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
    plan = cacheable
      ? prepareTextLineForDraw(line)
      : createTextDrawPlan(line, text, start, end);
  }
  const baseX = lineBaseX(obj);
  let raster = null;
  if (cacheable && plan.length && plan.rasterEligible &&
      typeof BoardfishTextRaster !== 'undefined' &&
      typeof context.getTransform === 'function' && typeof context.drawImage === 'function') {
    _textRasterCache ??= BoardfishTextRaster.createTextRasterCache();
    raster = _textRasterCache.draw(context, plan, baseX, line.textY, textDrawPlanRasterBounds(plan, context.font));
  }
  if (!raster) {
    for (const draw of plan) {
      context.fillText(draw.text, baseX + draw.x, line.textY);
    }
  }
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') return null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (options.collectStats === false) return null;
  const stats = cloneTextDrawStats(plan.stats, cacheHit);
  if (raster) {
    stats.drawCalls = raster.drawCalls;
    stats.rasterDrawCalls = raster.drawCalls;
    stats.rasterCacheHits = raster.cacheHit ? 1 : 0;
    stats.rasterCacheMisses = raster.cacheHit ? 0 : 1;
    stats.rasterizedDrawCalls = raster.rasterizedDrawCalls;
  }
  return stats;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

function layoutHitTestCaret(layout, wx, wy, obj, legacyScalar = false) {
  if (!layout.length) return { index: 0 };
  let lo = 0;
  let hi = layout.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wy < layout[mid].y + LINE_H) hi = mid;
    else lo = mid + 1;
  }
  const line = layout[lo];
  if (!line.text.length) return { index: line.startIndex, lineStartIndex: line.startIndex };
  const pw = line.prefixWidths;
  const offset = lineHitOffsetForX(line, wx, obj, !legacyScalar);
  const hitIndex = line.startIndex + offset;
  TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
  return { index: hitIndex, lineStartIndex: line.startIndex };
}
