'use strict';

var FONT_SIZE = 16;
var LINE_H    = 24;
var TEXT_PAD  = 4;
var NEW_TEXT_EDIT_MIN_LINES = 3;
var FONT      = `${FONT_SIZE}px 'Geist Sans', system-ui`;
var TEXT_BASELINE_Y_OFFSET = FONT_SIZE;

function normalizeTextContent(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

var _measureCanvas = document.createElement('canvas');
var _measureCtx = _measureCanvas.getContext('2d');
_measureCtx.font = FONT;
refreshTextMetrics();
var _mwCache = Object.create(null);

function measureTextW(text) {
  if (text in _mwCache) return _mwCache[text];
  _measureCtx.font = FONT;
  return (_mwCache[text] = _measureCtx.measureText(text).width);
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

// External line layout cache: id -> {content, w, lines: [{text, startIndex}]}
// Auto-invalidates on content/width change; never serialized with objects.
var _linesCacheMap = new Map();

// Prefix-width cache: line text -> Float64Array of prefix widths [0, w0, w0+w1, ...]
// Computed once per unique line string; avoids O(n2) slice allocations on every frame.
var _prefixCache = new Map();

function getPrefixWidths(text) {
  const hit = _prefixCache.get(text);
  if (hit) return hit;
  const pw = new Float64Array(text.length + 1);
  for (let k = 0; k < text.length; k++) {
    pw[k + 1] = measureTextW(text.slice(0, k + 1));
  }
  _prefixCache.set(text, pw);
  return pw;
}

function clearTextMeasurementCaches() {
  refreshTextMetrics();
  for (const k of Object.keys(_mwCache)) delete _mwCache[k];
  _linesCacheMap.clear();
  _prefixCache.clear();
  for (const obj of objects) delete obj._layoutCache;
  syncAllTextAutoHeights();
  invalidateOffscreen();
  scheduleRender(true, true);
}

function getWrappedLines(obj) {
  const cached = _linesCacheMap.get(obj.id);
  if (cached && cached.content === obj.data.content && cached.w === obj.w) return cached.lines;

  const maxW = obj.w - TEXT_PAD * 2;
  const result = [];

  const isWrapSpace = (ch) => ch === ' ' || ch === '\t';
  const pushLine = (start, end, nextStart = end) => {
    result.push({
      text: obj.data.content.slice(start, end),
      startIndex: start,
      endIndex: end,
      nextStartIndex: nextStart,
    });
  };

  let paraStart = 0;
  while (paraStart <= obj.data.content.length) {
    const newlineAt = obj.data.content.indexOf('\n', paraStart);
    const paraEnd = newlineAt === -1 ? obj.data.content.length : newlineAt;

    if (paraStart === paraEnd) {
      result.push({ text: '', startIndex: paraStart, endIndex: paraStart, nextStartIndex: paraStart });
    } else {
      let lineStart = paraStart;
      while (lineStart < paraEnd) {
        let lo = lineStart + 1;
        let hi = paraEnd;
        if (measureTextW(obj.data.content.slice(lineStart, lo)) > maxW) {
          pushLine(lineStart, lo);
          lineStart = lo;
          continue;
        }
        while (lo < hi) {
          const mid = Math.ceil((lo + hi + 1) / 2);
          if (measureTextW(obj.data.content.slice(lineStart, mid)) <= maxW) lo = mid;
          else hi = mid - 1;
        }

        let lineEnd = lo;
        let nextStart = lineEnd;
        if (lineEnd < paraEnd) {
          let breakAt = -1;
          for (let i = lineEnd; i > lineStart; i--) {
            if (isWrapSpace(obj.data.content[i - 1])) {
              breakAt = i - 1;
              break;
            }
          }
          if (breakAt > lineStart) {
            lineEnd = breakAt;
            nextStart = breakAt;
            while (nextStart < paraEnd && isWrapSpace(obj.data.content[nextStart])) nextStart++;
          }
        }

        if (lineEnd <= lineStart) {
          lineEnd = Math.min(lineStart + 1, paraEnd);
          nextStart = lineEnd;
        }
        pushLine(lineStart, lineEnd, nextStart);
        lineStart = nextStart;
      }
    }

    if (newlineAt === -1) break;
    paraStart = newlineAt + 1;
  }

  _linesCacheMap.set(obj.id, { content: obj.data.content, w: obj.w, lines: result });
  return result;
}

function getTextAutoHeight(obj, minLines = 1) {
  return Math.max(minLines * LINE_H + TEXT_PAD * 2, getWrappedLines(obj).length * LINE_H + TEXT_PAD * 2);
}

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
  return lines.map((line, i) => {
    const y = obj.y + TEXT_PAD + i * LINE_H;
    return {
      text: line.text,
      startIndex: line.startIndex,
      endIndex: line.endIndex,
      nextStartIndex: line.nextStartIndex,
      y,
      textY: y + TEXT_BASELINE_Y_OFFSET,
      prefixWidths: getPrefixWidths(line.text),
    };
  });
}

function getTextLayout(obj) {
  if (obj._layoutCache) return obj._layoutCache;
  obj._layoutCache = calculateTextLayout(obj);
  return obj._layoutCache;
}

function lineXAtOffset(line, obj, offset) {
  return obj.x + TEXT_PAD + line.prefixWidths[Math.max(0, Math.min(offset, line.text.length))];
}

function lineEndX(line, obj) {
  return lineXAtOffset(line, obj, line.text.length);
}

function layoutHitTest(layout, wx, wy, obj) {
  if (!layout.length) return 0;
  let line = layout[layout.length - 1];
  for (let i = 0; i < layout.length; i++) {
    if (wy < layout[i].y + LINE_H) { line = layout[i]; break; }
  }
  if (!line.text.length) return line.startIndex;
  const baseX = obj.x + TEXT_PAD;
  const pw = line.prefixWidths;
  for (let j = 0; j < line.text.length; j++) {
    if (wx < baseX + pw[j] + (pw[j + 1] - pw[j]) / 2) {
      TextSelDebug._logHit(wx, wy, obj, line, line.startIndex + j, pw);
      return line.startIndex + j;
    }
  }
  TextSelDebug._logHit(wx, wy, obj, line, line.startIndex + line.text.length, pw);
  return line.startIndex + line.text.length;
}
