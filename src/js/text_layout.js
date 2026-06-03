'use strict';

var FONT_SIZE = 16;
var LINE_H    = 24;
var TEXT_PAD  = 4;
var NEW_TEXT_EDIT_MIN_LINES = 5;
const TEXT_BOX_GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const regular_text = 400;
const textFontForSize = (size) => `${regular_text} ${size}px 'Geist Sans', system-ui`;
var FONT      = textFontForSize(FONT_SIZE);
const TEXT_SCRIPT_FONT_SCALE = Math.SQRT1_2;
const TEXT_SCRIPT_MAX_SIZE_DEPTH = 2;
var TEXT_SCRIPT_FONT_SIZE = Math.max(1, FONT_SIZE * TEXT_SCRIPT_FONT_SCALE);
var TEXT_SCRIPT_FONT = textFontForSize(TEXT_SCRIPT_FONT_SIZE);
const TEXT_SCRIPT_SUP_OFFSET = -FONT_SIZE * 0.38;
const TEXT_SCRIPT_SUB_OFFSET = FONT_SIZE * 0.24;
var TEXT_BASELINE_Y_OFFSET = FONT_SIZE;

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

function isTextContentEmpty(value) {
  return normalizeTextContent(value).replace(/[\u200B-\u200D\uFEFF]/g, '').trim() === '';
}

var _measureCanvas = document.createElement('canvas');
var _measureCtx = _measureCanvas.getContext('2d');
_measureCtx.font = FONT;
refreshTextMetrics();
const TEXT_MEASURE_CACHE_MAX_ENTRIES = 4096;
const TEXT_PREFIX_CACHE_MAX_ENTRIES = 2048;
const TEXT_LINES_CACHE_MAX_ENTRIES = 2048;
const TEXT_TAB_SIZE_SPACES = 8;
var _mwCache = new Map();
var _scriptMwCache = new Map();
var _fontMeasureCaches = new Map();

function measureRawTextWWithFont(text, font, cache) {
  const value = String(text ?? '');
  if (cache.has(value)) return cache.get(value);
  if (cache.size >= TEXT_MEASURE_CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  const previousFont = _measureCtx.font;
  if (previousFont !== font) _measureCtx.font = font;
  const width = _measureCtx.measureText(value).width;
  if (_measureCtx.font !== previousFont) _measureCtx.font = previousFont;
  cache.set(value, width);
  return width;
}

function measureRawTextW(text) {
  return measureRawTextWWithFont(text, FONT, _mwCache);
}

function measureScriptRawTextW(text) {
  return measureRawTextWWithFont(text, TEXT_SCRIPT_FONT, _scriptMwCache);
}

const textScriptSizeDepthForDepth = (depth) => Math.min(TEXT_SCRIPT_MAX_SIZE_DEPTH, Math.max(0, depth || 0));

const textScriptScaleForDepth = (depth) => Math.pow(TEXT_SCRIPT_FONT_SCALE, textScriptSizeDepthForDepth(depth));

function defaultTextBoxSize() {
  const h = NEW_TEXT_EDIT_MIN_LINES * LINE_H + TEXT_PAD * 2;
  return { w: h * TEXT_BOX_GOLDEN_RATIO, h };
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

const clearMeasuredTextWidthCache = () => {
  _mwCache.clear();
  _scriptMwCache.clear();
  _fontMeasureCaches.clear();
};

const clearTextLayoutCaches = (options = {}) => {
  _linesCacheMap.clear();
  _prefixCache.clear();
  if (options.measurements) clearMeasuredTextWidthCache();
  if (options.objectLayout !== false) {
    for (const obj of objects) {
      delete obj._layoutCache;
      delete obj._layoutCacheKey;
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
  let segmentStart = 0;
  let segmentBaseWidth = 0;
  for (let k = 0; k < value.length; k++) {
    if (value[k] === '\t') {
      const widthBeforeTab = segmentBaseWidth + measureRawTextW(value.slice(segmentStart, k));
      pw[k] = widthBeforeTab;
      pw[k + 1] = textWidthAfterTab(widthBeforeTab);
      segmentStart = k + 1;
      segmentBaseWidth = pw[k + 1];
    } else {
      pw[k + 1] = segmentBaseWidth + measureRawTextW(value.slice(segmentStart, k + 1));
    }
  }
  _prefixCache.set(value, pw);
  trimMapCache(_prefixCache, TEXT_PREFIX_CACHE_MAX_ENTRIES);
  return pw;
}

function measureStyledTextW(text, state) {
  return measureRawTextWForDepth(text, state?.depth || 0);
}

function getTextRangePrefixWidths(text, rangeStart = 0, scriptRanges = [], content = '') {
  const value = String(text ?? '');
  const pw = new Float64Array(value.length + 1);
  let i = 0;
  let width = 0;
  const sourceContent = content || value;

  while (i < value.length) {
    const globalIndex = rangeStart + i;
    if (isTextScriptMarkerHiddenAt(scriptRanges, globalIndex, sourceContent)) {
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

    const state = textScriptStateAt(scriptRanges, globalIndex);
    let j = i + 1;
    while (j < value.length) {
      const nextGlobalIndex = rangeStart + j;
      if (value[j] === '\t') break;
      if (isTextScriptMarkerHiddenAt(scriptRanges, nextGlobalIndex, sourceContent)) break;
      if (textScriptStateAt(scriptRanges, nextGlobalIndex).key !== state.key) break;
      j++;
    }

    const segment = value.slice(i, j);
    const baseWidth = width;
    for (let k = 1; k <= segment.length; k++) {
      pw[i + k] = baseWidth + measureStyledTextW(segment.slice(0, k), state);
    }
    width = pw[j];
    i = j;
  }

  return pw;
}

function measureTextRangeW(content, start, end, scriptRanges = []) {
  const text = normalizeTextContent(content);
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const widths = getTextRangePrefixWidths(text.slice(from, to), from, scriptRanges, text);
  return widths[widths.length - 1] || 0;
}

function clearTextMeasurementCaches() {
  refreshTextMetrics();
  clearTextLayoutCaches({ measurements: true });
  syncAllTextAutoHeights();
  invalidateOffscreen();
  scheduleRender(true, true);
}

function getWrappedLines(obj) {
  const cached = _linesCacheMap.get(obj.id);
  const scriptLayout = textScriptLayoutContext(obj);
  const scriptRanges = scriptLayout.ranges;
  const rawBounds = scriptLayout.rawBounds;
  const scriptKey = JSON.stringify(scriptRanges);
  const rawKey = textScriptRawLayoutKey(rawBounds);
  if (
    cached &&
    cached.content === obj.data.content &&
    cached.w === obj.w &&
    cached.scriptKey === scriptKey &&
    cached.rawKey === rawKey
  ) return cached.lines;

  const maxW = obj.w - TEXT_PAD * 2;
  const result = [];

  const isWrapSpace = (ch) => ch === ' ' || ch === '\t';
  const pushLine = (start, end, nextStart = end, caretEnd = end, logicalLineIndex = 0) => {
    result.push({
      text: obj.data.content.slice(start, end),
      startIndex: start,
      endIndex: end,
      caretEndIndex: caretEnd,
      nextStartIndex: nextStart,
      logicalLineIndex,
    });
  };

  let paraStart = 0;
  let logicalLineIndex = 0;
  while (paraStart <= obj.data.content.length) {
    const newlineAt = obj.data.content.indexOf('\n', paraStart);
    const paraEnd = newlineAt === -1 ? obj.data.content.length : newlineAt;

    if (paraStart === paraEnd) {
      result.push({ text: '', startIndex: paraStart, endIndex: paraStart, nextStartIndex: paraStart, logicalLineIndex });
    } else if (textScriptRawBoundsIntersectRange(rawBounds, paraStart, paraEnd)) {
      pushLine(paraStart, paraEnd, paraEnd, paraEnd, logicalLineIndex);
    } else {
      let lineStart = paraStart;
      while (lineStart < paraEnd) {
        let lo = lineStart + 1;
        let hi = paraEnd;
        if (measureTextRangeW(obj.data.content, lineStart, lo, scriptRanges) > maxW) {
          pushLine(lineStart, lo, lo, lo, logicalLineIndex);
          lineStart = lo;
          continue;
        }
        while (lo < hi) {
          const mid = Math.ceil((lo + hi + 1) / 2);
          if (measureTextRangeW(obj.data.content, lineStart, mid, scriptRanges) <= maxW) lo = mid;
          else hi = mid - 1;
        }

        let lineEnd = lo;
        let nextStart = lineEnd;
        let caretEnd = lineEnd;
        if (lineEnd < paraEnd) {
          let breakAt = -1;
          for (let i = lineEnd; i > lineStart; i--) {
            if (isWrapSpace(obj.data.content[i - 1])) {
              breakAt = i - 1;
              break;
            }
          }
          if (breakAt > lineStart) {
            nextStart = breakAt;
            while (nextStart < paraEnd && isWrapSpace(obj.data.content[nextStart])) nextStart++;
            if (nextStart < paraEnd) {
              lineEnd = breakAt;
            }
            caretEnd = nextStart;
          } else if (isWrapSpace(obj.data.content[nextStart])) {
            while (nextStart < paraEnd && isWrapSpace(obj.data.content[nextStart])) nextStart++;
            caretEnd = nextStart;
          }
        }

        if (lineEnd <= lineStart) {
          lineEnd = Math.min(lineStart + 1, paraEnd);
          nextStart = lineEnd;
        }
        pushLine(lineStart, lineEnd, nextStart, caretEnd, logicalLineIndex);
        lineStart = nextStart;
      }
    }

    if (newlineAt === -1) break;
    paraStart = newlineAt + 1;
    logicalLineIndex++;
  }

  _linesCacheMap.set(obj.id, { content: obj.data.content, w: obj.w, scriptKey, rawKey, lines: result });
  trimMapCache(_linesCacheMap, TEXT_LINES_CACHE_MAX_ENTRIES);
  return result;
}

function getTextAutoHeight(obj, minLines = 1) {
  return Math.max(minLines * LINE_H + TEXT_PAD * 2, getWrappedLines(obj).length * LINE_H + TEXT_PAD * 2);
}

const isTextWordSeparator = (ch) => ch === ' ' || ch === '\t';
const isTextLineSeparator = (ch) => ch === '\n';
const isTextWordOrLineSeparator = (ch) => isTextWordSeparator(ch) || isTextLineSeparator(ch);
const TEXT_LINE_ALIGN_VALUES = Object.freeze(['left', 'center', 'right']);
const TEXT_SCRIPT_KINDS = Object.freeze(['sup', 'sub']);

const normalizeTextLineAlignValue = (value) => TEXT_LINE_ALIGN_VALUES.includes(value) ? value : 'left';

const textLogicalLineCount = (value) => normalizeTextContent(value).split('\n').length;

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

const textLogicalLineIndexAt = (value, index) => {
  const text = normalizeTextContent(value);
  const clamped = Math.max(0, Math.min(index ?? 0, text.length));
  let lineIndex = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === '\n') lineIndex++;
  }
  return lineIndex;
};

const textLogicalLineRangeForSelection = (value, selection = {}) => {
  const text = normalizeTextContent(value);
  const start = Math.max(0, Math.min(selection.start ?? 0, text.length));
  const end = Math.max(0, Math.min(selection.end ?? start, text.length));
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const lastIndex = to > from ? to - 1 : from;
  return {
    startLine: textLogicalLineIndexAt(text, from),
    endLine: textLogicalLineIndexAt(text, lastIndex),
  };
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
  delete obj._layoutCache;
  delete obj._layoutCacheKey;
  _linesCacheMap.delete(obj.id);
  return true;
};

const normalizeTextScriptKind = (kind) => TEXT_SCRIPT_KINDS.includes(kind) ? kind : '';
const textScriptMarkerForKind = (kind) => kind === 'sub' ? '_' : '^';
const textScriptKindForMarker = (marker) => marker === '^' ? 'sup' : marker === '_' ? 'sub' : '';
const isTextScriptBracedRange = (content, range) => {
  const text = normalizeTextContent(content);
  if (!range || range.start <= 0 || range.end <= range.start + 1 || range.end > text.length) return false;
  return text[range.start] === '{' &&
    text[range.end - 1] === '}' &&
    text[range.start - 1] === textScriptMarkerForKind(range.kind);
};

const canOpenTextScriptAt = (content, markerIndex) => {
  const text = normalizeTextContent(content);
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
  for (const range of ranges) {
    if (normalized.some((item) => item.start === range.start && item.end === range.end && item.kind === range.kind)) continue;
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

const textScriptEndForMarkerAt = (content, markerIndex) => {
  const text = normalizeTextContent(content);
  const start = markerIndex + 1;
  let end = findBalancedTextScriptEnd(text, start);
  if (end === -1) {
    end = start;
    while (end < text.length && !isTextWordOrLineSeparator(text[end])) end++;
  }
  return end;
};

const textScriptRangeForMarkerAt = (content, markerIndex) => {
  const text = normalizeTextContent(content);
  const kind = textScriptKindForMarker(text[markerIndex]);
  if (!kind || !canOpenTextScriptAt(text, markerIndex)) return null;
  const start = markerIndex + 1;
  const end = textScriptEndForMarkerAt(text, markerIndex);
  if (end <= start) return null;
  return { start, end, kind };
};

const deriveTextScriptRangesFromContent = (content) => {
  const text = normalizeTextContent(content);
  const ranges = [];
  for (let i = 0; i < text.length - 1; i++) {
    const range = textScriptRangeForMarkerAt(text, i);
    if (range) ranges.push(range);
  }
  return ranges;
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
  const bracedRanges = deriveBracedTextScriptRangesFromContent(content);
  const combined = [...source, ...bracedRanges];
  if (combined.length) {
    const normalized = normalizeTextScriptRangesForContent(content, combined);
    if (normalized.length) obj.data.scriptRanges = normalized;
    else delete obj.data.scriptRanges;
    return normalized;
  }
  if (obj.data) delete obj.data.scriptRanges;
  return [];
};

const findBalancedTextScriptStart = (content, closeIndex) => {
  const text = normalizeTextContent(content);
  const close = text[closeIndex];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const open = pairs[close];
  if (!open) return -1;
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    if (text[i] === close) depth++;
    else if (text[i] === open) {
      depth--;
      if (depth === 0) return i;
    }
    if (text[i] === '\n') return -1;
  }
  return -1;
};

const isTextScriptCompoundBoundary = (ch) => (
  !ch || isTextWordOrLineSeparator(ch) || '{}()[]+-*/=,;:<>&|'.includes(ch)
);

const textScriptCompoundStartForMarker = (content, markerIndex) => {
  const text = normalizeTextContent(content);
  const marker = Math.max(0, Math.min(markerIndex ?? 0, text.length));
  let previous = marker - 1;
  if (previous < 0) return marker;

  if (text[previous] === '}') {
    const openIndex = findBalancedTextScriptStart(text, previous);
    const previousMarker = openIndex - 1;
    if (
      previousMarker >= 0 &&
      textScriptKindForMarker(text[previousMarker]) &&
      canOpenTextScriptAt(text, previousMarker)
    ) {
      return textScriptCompoundStartForMarker(text, previousMarker);
    }
    return openIndex === -1 ? previous : openIndex;
  }

  if (text[previous] === ')' || text[previous] === ']') {
    const openIndex = findBalancedTextScriptStart(text, previous);
    return openIndex === -1 ? previous : openIndex;
  }

  while (previous > 0 && !isTextScriptCompoundBoundary(text[previous - 1])) previous--;
  return previous;
};

const textScriptCompoundEndForRange = (content, range) => {
  const text = normalizeTextContent(content);
  let end = Math.max(0, Math.min(range?.end ?? 0, text.length));
  while (end < text.length - 1) {
    const kind = textScriptKindForMarker(text[end]);
    if (!kind || text[end + 1] !== '{') break;
    if (!canOpenTextScriptAt(text, end)) break;
    const nextEnd = findBalancedTextScriptEnd(text, end + 1);
    if (nextEnd === -1 || nextEnd <= end + 3) break;
    end = nextEnd;
  }
  return end;
};

const textScriptCompoundBoundsForRange = (content, range) => {
  if (!isTextScriptBracedRange(content, range)) return null;
  const markerIndex = range.start - 1;
  const start = textScriptCompoundStartForMarker(content, markerIndex);
  const end = textScriptCompoundEndForRange(content, range);
  return end > start ? { start, end } : null;
};

const textScriptEditingCaretIndex = (obj, content) => {
  if (!obj || typeof editingId === 'undefined' || obj.id !== editingId) return null;
  const text = normalizeTextContent(content);
  const rawIndex = Number.isFinite(obj._textEditCaretIndex) ? obj._textEditCaretIndex : obj._textScriptCaretIndex;
  if (!Number.isFinite(rawIndex)) return null;
  return Math.max(0, Math.min(Math.trunc(rawIndex), text.length));
};

const textScriptRawCompoundBoundsAtCaret = (content, ranges = [], caretIndex = null) => {
  if (!Number.isFinite(caretIndex)) return [];
  const bounds = [];
  for (const range of ranges || []) {
    const compound = textScriptCompoundBoundsForRange(content, range);
    if (!compound) continue;
    if (caretIndex > compound.start && caretIndex < compound.end) bounds.push(compound);
  }
  bounds.sort((a, b) => a.start - b.start || b.end - a.end);
  return bounds;
};

const textScriptLayoutContext = (obj) => ({ ranges: getTextScriptRanges(obj), rawBounds: [] });

const getTextScriptRangesForLayout = (obj) => textScriptLayoutContext(obj).ranges;

const textScriptRawLayoutKey = (rawBounds = []) => {
  if (!rawBounds.length) return '';
  return rawBounds.map((bounds) => `${bounds.start}:${bounds.end}`).join('|');
};

const textScriptRawBoundsIntersectRange = (rawBounds = [], start = 0, end = start) => {
  for (const bounds of rawBounds || []) {
    if (bounds.start < end && bounds.end > start) return true;
  }
  return false;
};

const textContentWithCanonicalScriptBraces = (content, scriptRanges = []) => {
  const text = normalizeTextContent(content);
  const ranges = normalizeTextScriptRangesForContent(text, [
    ...(Array.isArray(scriptRanges) ? scriptRanges : []),
    ...deriveBracedTextScriptRangesFromContent(text),
  ]);
  if (!ranges.length) return text;

  const rangesByMarkerIndex = new Map();
  for (const range of ranges) {
    const markerIndex = range.start - 1;
    if (markerIndex < 0) continue;
    const existing = rangesByMarkerIndex.get(markerIndex);
    if (!existing || range.end > existing.end) rangesByMarkerIndex.set(markerIndex, range);
  }

  const writeSegment = (start, end) => {
    let out = '';
    let i = start;
    while (i < end) {
      const range = rangesByMarkerIndex.get(i);
      if (range && range.start === i + 1 && range.end <= end) {
        const marker = textScriptMarkerForKind(range.kind);
        if (isTextScriptBracedRange(text, range)) {
          out += `${marker}{${writeSegment(range.start + 1, range.end - 1)}}`;
        } else {
          out += `${marker}{${writeSegment(range.start, range.end)}}`;
        }
        i = range.end;
        continue;
      }
      out += text[i];
      i++;
    }
    return out;
  };

  return writeSegment(0, text.length);
};

const textContentWithLinearScriptMarkers = (content, scriptRanges = []) => {
  const text = normalizeTextContent(content);
  const ranges = normalizeTextScriptRangesForContent(text, [
    ...(Array.isArray(scriptRanges) ? scriptRanges : []),
    ...deriveBracedTextScriptRangesFromContent(text),
  ]);
  const bracedRanges = ranges.filter((range) => isTextScriptBracedRange(text, range));
  if (!bracedRanges.length) return { text, scriptRanges: ranges };

  const bracedByMarkerIndex = new Map();
  for (const range of bracedRanges) {
    const markerIndex = range.start - 1;
    const existing = bracedByMarkerIndex.get(markerIndex);
    if (!existing || range.end > existing.end) bracedByMarkerIndex.set(markerIndex, range);
  }

  let out = '';
  const outRanges = [];
  const oldPositionToNew = new Array(text.length + 1);
  const markPosition = (index) => {
    if (index >= 0 && index <= text.length && oldPositionToNew[index] == null) oldPositionToNew[index] = out.length;
  };
  const appendChar = (index) => {
    markPosition(index);
    out += text[index];
    oldPositionToNew[index + 1] = out.length;
  };
  const skipChar = (index) => {
    markPosition(index);
    oldPositionToNew[index + 1] = out.length;
  };

  const writeSegment = (start, end) => {
    let i = start;
    markPosition(i);
    while (i < end) {
      const range = bracedByMarkerIndex.get(i);
      if (range && range.start === i + 1 && range.end <= end) {
        appendChar(i);
        skipChar(range.start);
        const rangeStart = out.length;
        writeSegment(range.start + 1, range.end - 1);
        skipChar(range.end - 1);
        const rangeEnd = out.length;
        if (rangeEnd > rangeStart) outRanges.push({ start: rangeStart, end: rangeEnd, kind: range.kind });
        i = range.end;
        markPosition(i);
        continue;
      }
      appendChar(i);
      i++;
    }
    markPosition(end);
  };

  writeSegment(0, text.length);
  for (let i = 0, last = 0; i < oldPositionToNew.length; i++) {
    if (oldPositionToNew[i] == null) oldPositionToNew[i] = last;
    else last = oldPositionToNew[i];
  }

  for (const range of ranges) {
    if (isTextScriptBracedRange(text, range)) continue;
    const start = oldPositionToNew[range.start];
    const end = oldPositionToNew[range.end];
    if (end > start) outRanges.push({ start, end, kind: range.kind });
  }

  return {
    text: out,
    scriptRanges: normalizeTextScriptRangesForContent(out, outRanges),
  };
};

const textScriptDeterministicBracesToLinear = (content, scriptRanges = []) => (
  textContentWithLinearScriptMarkers(content, scriptRanges)
);

const textScriptLinearToDeterministicBraces = (content, scriptRanges = []) => (
  textContentWithCanonicalScriptBraces(content, scriptRanges)
);

const textObjectContentForClipboard = (obj) => {
  if (!obj || obj.type !== 'text') return '';
  const content = normalizeTextContent(obj.data?.content || '');
  return textForClipboard(textScriptLinearToDeterministicBraces(content, getTextScriptRanges(obj)));
};

const textScriptRangeForIndex = (ranges, index, { includeEnd = false } = {}) => {
  for (const range of ranges || []) {
    if (index >= range.start && (index < range.end || (includeEnd && index === range.end))) return range;
  }
  return null;
};

const textScriptRangeForMarkerIndex = (ranges, index) => {
  for (const range of ranges || []) {
    if (range.start === index + 1) return range;
  }
  return null;
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
  active.sort((a, b) => a.start - b.start || b.end - a.end || a.kind.localeCompare(b.kind));
  return active;
};

const textScriptOffsetForKind = (kind) => kind === 'sub' ? TEXT_SCRIPT_SUB_OFFSET : TEXT_SCRIPT_SUP_OFFSET;

const textScriptStateFromRanges = (activeRanges) => {
  const ranges = activeRanges || [];
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

const textScriptCaretKindAt = (obj, index) => {
  const state = textScriptCaretStateAt(obj, index);
  return state.kinds[state.kinds.length - 1] || '';
};

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
  const lines = content.split('\n');
  const scriptRanges = getTextScriptRangesForLayout(obj);
  let best = empty;
  let contentOffset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
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
      const width = measureTextRangeW(content, contentOffset + segmentStart, contentOffset + wordEnd, scriptRanges);

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

const textLayoutLineSignature = (line) => ({
  startIndex: line.startIndex,
  endIndex: line.endIndex,
  caretEndIndex: line.caretEndIndex,
  nextStartIndex: line.nextStartIndex,
});

const textLayoutSignaturesEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].startIndex !== b[i].startIndex) return false;
    if (a[i].endIndex !== b[i].endIndex) return false;
    if (a[i].caretEndIndex !== b[i].caretEndIndex) return false;
    if (a[i].nextStartIndex !== b[i].nextStartIndex) return false;
  }
  return true;
};

const textWidthPreservesCurrentWrap = (obj, width, currentSignature) => {
  if (!obj || !Number.isFinite(width) || width <= 0) return false;
  const originalW = obj.w;
  const originalCache = obj._layoutCache;
  const originalCacheKey = obj._layoutCacheKey;
  obj.w = width;
  delete obj._layoutCache;
  delete obj._layoutCacheKey;
  _linesCacheMap.delete(obj.id);
  const nextSignature = getTextLayout(obj).map(textLayoutLineSignature);
  obj.w = originalW;
  obj._layoutCache = originalCache;
  obj._layoutCacheKey = originalCacheKey;
  _linesCacheMap.delete(obj.id);
  return textLayoutSignaturesEqual(currentSignature, nextSignature);
};

const fitTextObjectWidthToRenderedContent = (obj) => {
  if (!obj || obj.type !== 'text') return false;
  const currentSignature = getTextLayout(obj).map(textLayoutLineSignature);
  const w = getTextRenderedContentWidth(obj);
  if (!Number.isFinite(w) || w <= 0 || obj.w === w) return false;
  if (w < obj.w && !textWidthPreservesCurrentWrap(obj, w, currentSignature)) return false;
  obj.w = w;
  delete obj._layoutCache;
  delete obj._layoutCacheKey;
  _linesCacheMap.delete(obj.id);
  return true;
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
  return lines.map((line, i) => {
    const y = obj.y + TEXT_PAD + i * LINE_H;
    return {
      text: line.text,
      startIndex: line.startIndex,
      endIndex: line.endIndex,
      caretEndIndex: line.caretEndIndex,
      nextStartIndex: line.nextStartIndex,
      logicalLineIndex: line.logicalLineIndex || 0,
      align: textLineAlignAt(obj, line.logicalLineIndex || 0),
      scriptRanges,
      content: obj.data.content,
      y,
      textY: y + TEXT_BASELINE_Y_OFFSET,
      prefixWidths: getTextRangePrefixWidths(line.text, line.startIndex, scriptRanges, obj.data.content),
    };
  });
}

function getTextLayout(obj) {
  const scriptLayout = textScriptLayoutContext(obj);
  const scriptKey = JSON.stringify(scriptLayout.ranges);
  const rawKey = textScriptRawLayoutKey(scriptLayout.rawBounds);
  const alignKey = JSON.stringify(normalizeTextLineAlignForContent(obj.data?.content, obj.data?.lineAlign));
  const cacheKey = `${obj.data.content}\n${obj.w}\n${obj.y}\n${scriptKey}\n${rawKey}\n${alignKey}`;
  if (obj._layoutCache && obj._layoutCacheKey === cacheKey) return obj._layoutCache;
  obj._layoutCacheKey = cacheKey;
  obj._layoutCache = calculateTextLayout(obj);
  return obj._layoutCache;
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

const drawTextLineRange = (context, line, obj, startOffset = 0, endOffset = line?.text?.length ?? 0) => {
  if (!context || !line || !obj) return;
  const text = String(line.text ?? '');
  const start = Math.max(0, Math.min(startOffset, text.length));
  const end = Math.max(start, Math.min(endOffset, text.length));
  const ranges = line.scriptRanges || [];
  let i = start;
  while (i < end) {
    const globalIndex = line.startIndex + i;
    if (text[i] === '\t' || isTextScriptMarkerHiddenAt(ranges, globalIndex, line.content || '')) {
      i++;
      continue;
    }
    const state = textScriptStateAt(ranges, globalIndex);
    let j = i + 1;
    while (j < end) {
      const nextGlobalIndex = line.startIndex + j;
      if (text[j] === '\t') break;
      if (isTextScriptMarkerHiddenAt(ranges, nextGlobalIndex, line.content || '')) break;
      if (textScriptStateAt(ranges, nextGlobalIndex).key !== state.key) break;
      j++;
    }
    const previousFont = context.font;
    if (state.depth > 0) context.font = state.font;
    const y = line.textY + state.offset;
    context.fillText(text.slice(i, j), lineXAtOffset(line, obj, i), y);
    if (state.depth > 0 && context.font !== previousFont) context.font = previousFont;
    i = j;
  }
};

function lineEndX(line, obj) {
  return lineXAtOffset(line, obj, line.text.length);
}

const normalizeTextLayoutHitCaretIndex = (line, index, direction = 'forward') => {
  const text = String(line?.content ?? line?.text ?? '');
  const ranges = line?.scriptRanges || [];
  let pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  const step = direction === 'backward' ? -1 : 1;
  const shouldSkip = () => ranges.some((range) => {
    if (isTextScriptBracedRange(text, range)) return range.start === pos;
    return range.start === pos + 1;
  });
  let guard = text.length + 1;
  while (guard-- > 0 && pos >= 0 && pos <= text.length && shouldSkip()) {
    pos += step;
    if (pos < 0) return 0;
    if (pos > text.length) return text.length;
  }
  return pos;
};

const textLayoutLineForHit = (layout, wy) => {
  if (!layout.length) return 0;
  let line = layout[layout.length - 1];
  for (let i = 0; i < layout.length; i++) {
    if (wy < layout[i].y + LINE_H) { line = layout[i]; break; }
  }
  return line;
};

const textLayoutCaretCenterYForHit = (line, obj, index, affinity = '') => {
  const state = textScriptCaretStateForHit(obj, index, affinity);
  if (state?.depth > 0) {
    const scale = Number.isFinite(state.scale) && state.scale > 0 ? state.scale : 1;
    const textY = Number.isFinite(line.textY) ? line.textY : line.y + TEXT_BASELINE_Y_OFFSET;
    const y = textY + state.offset - (TEXT_BASELINE_Y_OFFSET * scale);
    return y + (LINE_H * scale) / 2;
  }
  return line.y + LINE_H / 2;
};

const textLayoutNearestCaretOffsets = (line, wx, obj) => {
  const text = String(line?.text ?? '');
  let bestDistance = Infinity;
  let bestX = lineXAtOffset(line, obj, 0);
  for (let offset = 0; offset <= text.length; offset++) {
    const x = lineXAtOffset(line, obj, offset);
    const distance = Math.abs(wx - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestX = x;
    }
  }
  const offsets = [];
  const epsilon = 1e-7;
  for (let offset = 0; offset <= text.length; offset++) {
    if (Math.abs(lineXAtOffset(line, obj, offset) - bestX) <= epsilon) offsets.push(offset);
  }
  return offsets;
};

const textLayoutCaretHitCandidates = (line, wx, obj) => {
  const content = String(line?.content ?? line?.text ?? '');
  const ranges = line?.scriptRanges || [];
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
      centerY: textLayoutCaretCenterYForHit(line, obj, caretIndex, affinity),
    });
  };

  for (const offset of textLayoutNearestCaretOffsets(line, wx, obj)) {
    const rawIndex = Math.max(0, Math.min(line.startIndex + offset, content.length));
    const bracedOpeningGap = ranges.some((range) => (
      isTextScriptBracedRange(content, range) && range.start === rawIndex
    ));
    if (bracedOpeningGap) continue;

    const bracedRangeAtClosing = ranges.some((range) => (
      isTextScriptBracedRange(content, range) && range.end - 1 === rawIndex
    ));
    const bracedRangeEnding = ranges.some((range) => (
      isTextScriptBracedRange(content, range) && range.end === rawIndex
    ));
    const linearRangeEnding = ranges.some((range) => (
      !isTextScriptBracedRange(content, range) && range.end === rawIndex
    ));

    if (bracedRangeEnding) addCandidate(rawIndex, 'after');
    if (linearRangeEnding) {
      addCandidate(rawIndex, '');
      addCandidate(rawIndex, 'after');
    }
    if (bracedRangeAtClosing && !bracedRangeEnding) {
      addCandidate(rawIndex, ranges.some((range) => range.end === rawIndex) ? 'after' : '');
    }
    if (!bracedRangeEnding && !linearRangeEnding && !bracedRangeAtClosing) {
      addCandidate(rawIndex, ranges.some((range) => range.end === rawIndex) ? 'after' : '');
    }
  }

  return candidates;
};

function layoutHitTestCaret(layout, wx, wy, obj) {
  if (!layout.length) return { index: 0, affinity: '' };
  const line = textLayoutLineForHit(layout, wy);
  if (!line.text.length) return { index: line.startIndex, affinity: '' };
  const candidates = textLayoutCaretHitCandidates(line, wx, obj);
  if (candidates.length) {
    candidates.sort((a, b) => Math.abs(a.centerY - wy) - Math.abs(b.centerY - wy) ||
      a.index - b.index ||
      String(a.affinity).localeCompare(String(b.affinity)));
    const hit = candidates[0];
    TextSelDebug._logHit(wx, wy, obj, line, hit.index, line.prefixWidths);
    return { index: hit.index, affinity: hit.affinity || '' };
  }

  const baseX = lineBaseX(line, obj);
  const pw = line.prefixWidths;
  for (let j = 0; j < line.text.length; j++) {
    if (wx < baseX + pw[j] + (pw[j + 1] - pw[j]) / 2) {
      const hitIndex = normalizeTextLayoutHitCaretIndex(line, line.startIndex + j, 'forward');
      TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
      return hitIndex;
    }
  }
  const hitIndex = normalizeTextLayoutHitCaretIndex(line, line.startIndex + line.text.length, 'backward');
  TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
  return { index: hitIndex, affinity: '' };
}

function layoutHitTest(layout, wx, wy, obj) {
  if (!layout.length) return 0;
  const line = textLayoutLineForHit(layout, wy);
  if (!line.text.length) return line.startIndex;
  const baseX = lineBaseX(line, obj);
  const pw = line.prefixWidths;
  for (let j = 0; j < line.text.length; j++) {
    if (wx < baseX + pw[j] + (pw[j + 1] - pw[j]) / 2) {
      const hitIndex = normalizeTextLayoutHitCaretIndex(line, line.startIndex + j, 'forward');
      TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
      return hitIndex;
    }
  }
  const hitIndex = normalizeTextLayoutHitCaretIndex(line, line.startIndex + line.text.length, 'backward');
  TextSelDebug._logHit(wx, wy, obj, line, hitIndex, pw);
  return hitIndex;
}
