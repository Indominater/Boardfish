/* BOARDFISH_DEV_DIAGNOSTICS_START */
const textEditorDebugNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const textEditorDebugRound = (value) => Math.round((Number(value) || 0) * 100) / 100;

const textEditorEventTimestampMs = (event = null) => {
  const timestamp = Number(event?.timeStamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return textEditorDebugNow();
  return typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin) && timestamp > performance.timeOrigin
    ? timestamp - performance.timeOrigin
    : timestamp;
};

const textEditorEventDebugStats = (event = null) => {
  const now = textEditorDebugNow();
  const eventAt = textEditorEventTimestampMs(event);
  return {
    eventType: event?.type || '',
    eventAt: textEditorDebugRound(eventAt),
    eventAgeMs: textEditorDebugRound(Math.max(0, now - eventAt)),
    inputDataLength: typeof event?.data === 'string' ? event.data.length : '',
    isComposing: !!event?.isComposing,
    isTrusted: !!event?.isTrusted,
    cancelable: !!event?.cancelable,
    defaultPrevented: !!event?.defaultPrevented,
  };
};

const textEditorDebugLog = (label, obj, meta = {}) => {
  if (typeof TextSelDebug !== 'undefined') TextSelDebug._logEditLifecycle?.(label, obj, meta);
};

const textEditorClipDebugApi = () => (
  typeof ClipDebug !== 'undefined' ? ClipDebug : null
);

const textEditorClipStep = (dbg, step, meta = {}) => {
  const api = textEditorClipDebugApi();
  if (api && dbg) api.step(dbg, step, meta);
};

const textEditorClipboardLog = (label, obj, meta = {}) => {
  if (typeof TextSelDebug !== 'undefined') TextSelDebug._logClipboard?.(label, obj, meta);
};

const textEditorTextStats = (value) => {
  const text = String(value ?? '');
  const lines = text ? text.split('\n') : [];
  let largestLineChars = 0;
  for (const line of lines) largestLineChars = Math.max(largestLineChars, line.length);
  const textBytes = typeof BoardfishWebLimits !== 'undefined' && typeof BoardfishWebLimits.textByteLength === 'function'
    ? BoardfishWebLimits.textByteLength(text)
    : (typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length);
  return {
    textLen: text.length,
    textLineCount: lines.length,
    largestLineChars,
    textBytes,
  };
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const textEditorSelectionDebugStats = (selection = {}, value = '') => {
  const text = String(value ?? '');
  const start = Math.max(0, Math.min(selection.start ?? 0, text.length));
  const end = Math.max(start, Math.min(selection.end ?? start, text.length));
  return {
    selectionStart: start,
    selectionEnd: end,
    selectedChars: end - start,
    selectionDirection: selection.direction || 'none',
    hasSelection: start !== end,
  };
};

const textEditorCaretLineDebugStats = (obj, index, prefix = 'caret') => {
  const lines = Array.isArray(obj?._layoutCache) ? obj._layoutCache : [];
  const pos = Math.max(0, Math.trunc(Number(index)) || 0);
  let lineIndex = -1;
  let line = null;
  for (let i = 0; i < lines.length; i++) {
    const candidate = lines[i];
    const start = Math.max(0, Math.trunc(Number(candidate?.startIndex)) || 0);
    const end = Math.max(start, Math.trunc(Number(candidate?.caretEndIndex ?? candidate?.endIndex ?? start)) || start);
    if (pos >= start && pos <= end) {
      lineIndex = i;
      line = candidate;
      break;
    }
  }
  const text = String(line?.text ?? '');
  return {
    [`${prefix}LineIndex`]: lineIndex,
    [`${prefix}LineStart`]: line?.startIndex ?? '',
    [`${prefix}LineEnd`]: line?.endIndex ?? '',
    [`${prefix}LineCaretEnd`]: line?.caretEndIndex ?? '',
    [`${prefix}LineNextStart`]: line?.nextStartIndex ?? '',
    [`${prefix}LineLogicalIndex`]: line?.logicalLineIndex ?? '',
    [`${prefix}LineChars`]: text.length,
    [`${prefix}LineBlank`]: line ? !/\S/.test(text) : '',
    [`${prefix}LineTextSample`]: text.slice(0, 80),
  };
};

const textEditorObjectDebugStats = (obj) => ({
  objectWidth: obj?.w ?? '',
  objectHeight: obj?.h ?? '',
  editStartChars: typeof obj?._editStartContent === 'string' ? obj._editStartContent.length : '',
  editMinLines: obj?._editMinLines ?? '',
  preservedMinLines: obj?._textEditPreservedMinLines ?? '',
  pendingSizeSync: !!obj?._textEditPendingSizeSync,
  layoutCachePresent: !!obj?._layoutCache,
  layoutCacheLines: Array.isArray(obj?._layoutCache) ? obj._layoutCache.length : '',
});

const textEditorCap = (prefix, name) => (
  prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name
);

const textEditorSizeDebugStats = (obj, content = null, prefix = '') => {
  const key = (name) => textEditorCap(prefix, name);
  if (!obj || obj.type !== 'text') {
    return {
      [key('objectHeight')]: '',
      [key('expectedLogicalHeight')]: '',
      [key('expectedCachedHeight')]: '',
      [key('heightDeltaFromLogical')]: '',
      [key('heightDeltaFromCached')]: '',
    };
  }
  const text = normalizeTextContent(content ?? obj.data?.content ?? '');
  const lineH = Number(typeof LINE_H !== 'undefined' ? LINE_H : 24) || 24;
  const pad = Number(typeof TEXT_PAD !== 'undefined' ? TEXT_PAD : 16) || 16;
  const activeEditingId = typeof editingId !== 'undefined' ? editingId : '';
  const minLines = obj.id === activeEditingId ? (Math.max(1, Math.trunc(Number(obj._editMinLines)) || 1)) : 1;
  const logicalLines = Math.max(1, textNewlineCount(text) + 1);
  const layoutCacheValid = Array.isArray(obj._layoutCache) &&
    obj._layoutCacheContent === text &&
    obj._layoutCacheW === obj.w;
  const wrappedCountValid = obj._textWrappedLineCountCacheContent === text &&
    obj._textWrappedLineCountCacheW === obj.w &&
    Number.isFinite(obj._textWrappedLineCountCacheValue);
  const wrappedIndex = obj._textWrappedLineIndexCache;
  const wrappedIndexValid = wrappedIndex &&
    Array.isArray(wrappedIndex.entries) &&
    obj._textWrappedLineIndexCacheContent === text &&
    obj._textWrappedLineIndexCacheW === obj.w &&
    Number.isFinite(wrappedIndex.lineCount);
  const widthCache = obj._textWrappedLineIndexWidthCache;
  const widthCached = widthCache &&
    obj._textWrappedLineIndexWidthCacheContent === text &&
    typeof widthCache.get === 'function'
    ? widthCache.get(String(obj.w))
    : null;
  const widthCacheValid = widthCached &&
    Array.isArray(widthCached.entries) &&
    Number.isFinite(widthCached.lineCount);
  let cachedLines = '';
  let cachedSource = '';
  if (layoutCacheValid) {
    cachedLines = Math.max(1, obj._layoutCache.length);
    cachedSource = 'layout-cache';
  } else if (wrappedIndexValid) {
    cachedLines = Math.max(1, Math.trunc(Number(wrappedIndex.lineCount)) || 1);
    cachedSource = 'wrapped-index-cache';
  } else if (wrappedCountValid) {
    cachedLines = Math.max(1, Math.trunc(Number(obj._textWrappedLineCountCacheValue)) || 1);
    cachedSource = 'wrapped-count-cache';
  } else if (widthCacheValid) {
    cachedLines = Math.max(1, Math.trunc(Number(widthCached.lineCount)) || 1);
    cachedSource = 'wrapped-width-cache';
  }
  const heightLines = exactTextEditLineCountForHeight(obj.h);
  const expectedLogicalHeight = Math.max(minLines, logicalLines) * lineH + pad * 2;
  const expectedCachedHeight = cachedLines === ''
    ? ''
    : Math.max(minLines, cachedLines) * lineH + pad * 2;
  return {
    [key('objectWidth')]: obj.w,
    [key('objectHeight')]: obj.h,
    [key('heightLines')]: heightLines || '',
    [key('editMinLines')]: minLines,
    [key('logicalLines')]: logicalLines,
    [key('cachedLines')]: cachedLines,
    [key('cachedLineSource')]: cachedSource,
    [key('expectedLogicalHeight')]: expectedLogicalHeight,
    [key('expectedCachedHeight')]: expectedCachedHeight,
    [key('heightDeltaFromLogical')]: Number(obj.h) - expectedLogicalHeight,
    [key('heightDeltaFromCached')]: expectedCachedHeight === '' ? '' : Number(obj.h) - expectedCachedHeight,
    [key('layoutCacheValid')]: !!layoutCacheValid,
    [key('wrappedCountCacheValid')]: !!wrappedCountValid,
    [key('wrappedIndexCacheValid')]: !!wrappedIndexValid,
    [key('wrappedWidthCacheValid')]: !!widthCacheValid,
    [key('lineHeight')]: lineH,
    [key('textPad')]: pad,
  };
};

const textEditorProxySizeDebugStats = (proxy, prefix = 'proxy') => {
  const key = (name) => textEditorCap(prefix, name);
  if (!proxy) return {};
  return {
    [key('ScrollHeight')]: proxy.scrollHeight ?? '',
    [key('ClientHeight')]: proxy.clientHeight ?? '',
    [key('OffsetHeight')]: proxy.offsetHeight ?? '',
    [key('StyleHeight')]: proxy.style?.height || '',
  };
};

const textEditorPerfDebugApi = () => (
  typeof ManualPerfDebug !== 'undefined' ? ManualPerfDebug : null
);

const shouldTraceTextEditorInput = (inputType = '') => (
  !!textEditorPerfDebugApi()?.isTextEditInputTraceActive?.(inputType)
);

const recordTextEditorInputPerfStep = (step, meta = {}) => {
  textEditorPerfDebugApi()?.recordTextEditInputStep?.(step, meta);
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

const TEXT_EDIT_DEFER_AUTO_HEIGHT_CHARS = 20000;
const TEXT_EDIT_DIRECT_TEXTAREA_REPLACE_CHARS = 20000;
const TEXT_EDIT_DEFER_DOM_REPLACE_CHARS = 20000;
/* BOARDFISH_DEV_DIAGNOSTICS_START */
let textEditInputDebugSeq = 0;
const nextTextEditInputDebugSeq = () => ++textEditInputDebugSeq;
/* BOARDFISH_DEV_DIAGNOSTICS_END */
const textEditNavigationKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const textEditWordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'word' })
  : null;

function textEditWordBoundary(value, index, direction) {
  const text = String(value ?? '');
  const position = Math.max(0, Math.min(Math.trunc(Number(index)) || 0, text.length));
  const moveRight = direction === 'right' || Number(direction) > 0;

  if (textEditWordSegmenter) {
    const segments = textEditWordSegmenter.segment(text);
    let part = segments.containing(moveRight ? position : position - 1);
    while (part && !part.isWordLike) {
      part = segments.containing(moveRight ? part.index + part.segment.length : part.index - 1);
    }
    return part ? part.index + (moveRight ? part.segment.length : 0) : moveRight ? text.length : 0;
  }

  const isWordChar = (char) => /[A-Za-z0-9_]/.test(char || '');
  let cursor = position;
  if (moveRight) {
    while (cursor < text.length && !isWordChar(text[cursor])) cursor++;
    while (cursor < text.length && isWordChar(text[cursor])) cursor++;
  } else {
    while (cursor > 0 && !isWordChar(text[cursor - 1])) cursor--;
    while (cursor > 0 && isWordChar(text[cursor - 1])) cursor--;
  }
  return cursor;
}

function textEditProxyValue(proxy) {
  return proxy._boardfishLogicalValue ?? proxy.value;
}

function setTextEditProxyLogicalValue(proxy, value = '', domSynced = true) {
  const text = String(value ?? '');
  proxy._boardfishLogicalValue = text;
  proxy._boardfishDomValueStale = !domSynced;
}

function syncTextEditProxyDomValue(proxy, value = '', selection = null) {
  if (!proxy._boardfishDomValueStale) {
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return false;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { synced: false, reason: 'dom-current' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  const text = String(value ?? '');
  proxy.value = text;
  setTextEditProxyLogicalValue(proxy, text);
  if (selection) {
    const max = text.length;
    const start = Math.max(0, Math.min(Math.trunc(Number(selection.start)) || 0, max));
    const end = Math.max(start, Math.min(Math.trunc(Number(selection.end ?? start)) || start, max));
    proxy.setSelectionRange(start, end, selection.direction || 'none');
  }
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') return true;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return { synced: true, reason: 'stale-dom' };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
}

function setTextEditProxySelectionRange(proxy, start, end = start, direction = 'none', value) {
  const text = value ?? textEditProxyValue(proxy);
  const max = text.length;
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, max));
  const to = Math.max(from, Math.min(Math.trunc(Number(end ?? start)) || from, max));
  const shouldSyncDom = !!proxy._boardfishDomValueStale && to > proxy.value.length;
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
    const synced = shouldSyncDom ? syncTextEditProxyDomValue(proxy, text, { start: from, end: to, direction }) : false;
    if (!synced) proxy.setSelectionRange(from, to, direction);
    return synced;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const syncResult = shouldSyncDom
    ? syncTextEditProxyDomValue(proxy, text, { start: from, end: to, direction })
    : { synced: false, reason: shouldSyncDom ? 'sync-skipped' : 'selection-fits-dom' };
  if (!syncResult.synced) proxy.setSelectionRange(from, to, direction);
  return {
    set: true,
    start: from,
    end: to,
    direction,
    synced: !!syncResult.synced,
    reason: syncResult.reason || '',
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
}

const textEditSelectionState = (proxy) => {
  const valueLength = textEditProxyValue(proxy).length;
  const start = Math.max(0, Math.min(proxy.selectionStart, valueLength));
  const end = Math.max(0, Math.min(proxy.selectionEnd, valueLength));
  return {
    start,
    end,
    direction: proxy.selectionDirection || 'none',
    hasSelection: start !== end,
  };
};

const TEXT_EDIT_INDENT = '\t';

const textEditLineStartAt = (value, index) => {
  const text = String(value ?? '');
  const clamped = Math.max(0, Math.min(index ?? 0, text.length));
  if (clamped <= 0) return 0;
  return text.lastIndexOf('\n', clamped - 1) + 1;
};

const applyTextEditLineIndent = (value, selection, outdent = false) => {
  const text = String(value ?? '');
  const selectionState = {
    start: Math.max(0, Math.min(selection?.start ?? 0, text.length)),
    end: Math.max(0, Math.min(selection?.end ?? selection?.start ?? 0, text.length)),
    direction: selection?.direction || 'none',
  };
  const lastSelectedIndex = selectionState.end > selectionState.start
    ? selectionState.end - 1
    : selectionState.start;
  const firstLineStart = textEditLineStartAt(text, selectionState.start);
  const lastLineStart = textEditLineStartAt(text, lastSelectedIndex);
  if (
    outdent &&
    firstLineStart === lastLineStart &&
    text[firstLineStart] !== TEXT_EDIT_INDENT &&
    text[firstLineStart] !== ' '
  ) return { ...selectionState, value: text, changed: false };

  const newlineAt = text.indexOf('\n', lastLineStart);
  const blockEnd = newlineAt === -1 ? text.length : newlineAt;
  const selectedText = text.slice(firstLineStart, blockEnd);
  let nextStart = selectionState.start;
  let nextEnd = selectionState.end;
  let nextSelectedText;
  if (outdent) {
    nextSelectedText = selectedText.replace(/(^|\n)(\t| {1,4})/g, (_, prefix, indent, offset) => {
      const lineStart = firstLineStart + offset + prefix.length;
      nextStart -= Math.min(indent.length, Math.max(0, selectionState.start - lineStart));
      nextEnd -= Math.min(indent.length, Math.max(0, selectionState.end - lineStart));
      return prefix;
    });
  } else {
    nextSelectedText = TEXT_EDIT_INDENT + selectedText.split('\n').join('\n' + TEXT_EDIT_INDENT);
    if (selectionState.start >= firstLineStart) nextStart += TEXT_EDIT_INDENT.length;
    if (selectionState.end >= firstLineStart) nextEnd += nextSelectedText.length - selectedText.length;
  }
  if (nextSelectedText === selectedText) return { ...selectionState, value: text, changed: false };

  return {
    value: text.slice(0, firstLineStart) + nextSelectedText + text.slice(blockEnd),
    start: nextStart,
    end: nextEnd,
    direction: selectionState.direction,
    changed: true,
    replacement: {
      start: firstLineStart,
      end: blockEnd,
      insertedText: nextSelectedText,
    },
  };
};

const applyTextEditLineBreakIndent = (value, selection) => {
  const text = String(value ?? '');
  const selectionState = {
    start: Math.max(0, Math.min(selection?.start ?? 0, text.length)),
    end: Math.max(0, Math.min(selection?.end ?? selection?.start ?? 0, text.length)),
    direction: selection?.direction || 'none',
  };
  const start = Math.min(selectionState.start, selectionState.end);
  const end = Math.max(selectionState.start, selectionState.end);
  // Indentation after the caret is already retained in the unchanged suffix.
  const lineStart = textEditLineStartAt(text, start);
  let indentEnd = lineStart;
  while (indentEnd < start && (text[indentEnd] === ' ' || text[indentEnd] === '\t')) indentEnd++;
  const insert = '\n' + text.slice(lineStart, indentEnd);
  const nextValue = text.slice(0, start) + insert + text.slice(end);
  const nextCaret = start + insert.length;
  return {
    value: nextValue,
    start: nextCaret,
    end: nextCaret,
    direction: 'none',
    changed: nextValue !== text,
  };
};

const textEditInputReplacement = (oldText = '', nextText = '', inputState = {}, inputType = '') => {
  const baseStart = Math.max(0, Math.min(inputState.start ?? 0, oldText.length));
  const baseEnd = Math.max(baseStart, Math.min(inputState.end ?? baseStart, oldText.length));
  const selectedLength = baseEnd - baseStart;
  const type = String(inputType || inputState.inputType || '');

  if (!selectedLength && type.startsWith('delete')) {
    const removedLength = Math.max(0, oldText.length - nextText.length);
    if (removedLength > 0) {
      if (type.includes('Backward')) {
        return {
          start: Math.max(0, baseStart - removedLength),
          end: baseStart,
          insertedText: '',
        };
      }
      return {
        start: baseStart,
        end: Math.min(oldText.length, baseStart + removedLength),
        insertedText: '',
      };
    }
  }

  const insertedLength = Math.max(0, nextText.length - (oldText.length - selectedLength));
  return {
    start: baseStart,
    end: baseEnd,
    insertedText: nextText.slice(baseStart, baseStart + insertedLength),
  };
};

const textEditBeforeInputReplacement = (text = '', selection = {}, event = null) => {
  const start = Math.max(0, Math.min(selection.start ?? 0, text.length));
  const end = Math.max(start, Math.min(selection.end ?? start, text.length));
  const inputType = String(event?.inputType || '');
  if (inputType === 'insertText' || inputType === 'insertCompositionText') {
    return { start, end, insertedText: String(event?.data ?? '') };
  }
  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
    return { start, end, insertedText: '\n' };
  }
  if (inputType.startsWith('delete')) {
    if (start !== end) return { start, end, insertedText: '' };
    const blankLineRange = textEditBlankLineDeleteRange(text, start, inputType);
    if (blankLineRange) return blankLineRange;
    if (inputType.includes('Backward')) return { start: Math.max(0, start - 1), end: start, insertedText: '' };
    if (inputType.includes('Forward')) return { start, end: Math.min(text.length, end + 1), insertedText: '' };
  }
  return null;
};

const textEditBlankLineDeleteRange = (text = '', index, keyOrInputType = '') => {
  const pos = Math.max(0, Math.min(Math.trunc(Number(index)) || 0, text.length));
  const backward = keyOrInputType === 'Backspace' || keyOrInputType.includes('Backward');
  if (backward ? pos > 0 && !' \t\n'.includes(text[pos - 1]) : !' \t\n'.includes(text[pos] || '\n')) return null;
  const before = text.lastIndexOf('\n', Math.max(0, pos - 1));
  const start = before < 0 ? 0 : before + 1;
  const after = text.indexOf('\n', pos);
  const end = after < 0 ? text.length : after;
  if (!/^[ \t]*$/.test(text.slice(start, end))) return null;
  if (backward && pos > start) return { start: pos - 1, end: pos, insertedText: '' };
  if (backward && start > 0) return { start: start - 1, end, insertedText: '' };
  if (!backward && end < text.length) return { start, end: end + 1, insertedText: '' };
  if (start > 0) return { start: start - 1, end, insertedText: '' };
  if (end < text.length) return { start, end: end + 1, insertedText: '' };
  return null;
};

const dispatchTextEditInputEvent = (proxy, inputType) => {
  let event = null;
  try {
    event = typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, inputType })
      : new Event('input', { bubbles: true });
  } catch (_) {
    event = document.createEvent('Event');
    event.initEvent('input', true, false);
  }
  if (event && !event.inputType) {
    try { Object.defineProperty(event, 'inputType', { value: inputType }); } catch (_) {}
  }
  proxy.dispatchEvent(event);
};

const syncFreshTextEditWidth = (obj) => {
  if (!obj || obj.type !== 'text' || obj._editStartContent !== '') return false;
  const width = getTextRenderedContentWidth(obj);
  if (!Number.isFinite(width) || width <= obj.w) return false;
  obj.w = width;
  return true;
};

const exactTextEditLineCountForHeight = (height) => {
  const lines = (Number(height) - TEXT_PAD * 2) / LINE_H;
  if (!Number.isFinite(lines) || lines <= 0) return 0;
  const rounded = Math.round(lines);
  return Math.abs(lines - rounded) < 1e-6 ? Math.max(1, rounded) : 0;
};

const setTextEditMinLinesForSession = (obj, preserveSize = false) => {
  if (!obj || obj.type !== 'text') return 1;
  const minLines = (preserveSize && exactTextEditLineCountForHeight(obj.h)) || 1;
  obj._editMinLines = minLines;
  if (preserveSize && minLines > 1) {
    obj._textEditPreservedMinLines = minLines;
  } else {
    delete obj._textEditPreservedMinLines;
  }
  return minLines;
};

const resetTextEditPreservedMinLines = (obj) => {
  if (!obj || obj.type !== 'text' || !obj._textEditPreservedMinLines) return false;
  obj._editMinLines = 1;
  delete obj._textEditPreservedMinLines;
  return true;
};

const resetTextEditNavigation = (obj) => {
  if (!obj) return;
  delete obj._textEditPreferredX;
  delete obj._textEditNavigationSelection;
};

const setTextEditCaretIndex = (obj, index, lineStartIndex = null, clearLineStartIndex = false, preserveNavigation = false) => {
  if (!obj) return;
  if (!preserveNavigation) resetTextEditNavigation(obj);
  const length = (obj.data?.content || '').length;
  const nextIndex = Math.max(0, Math.min(Math.trunc(index ?? 0), length));
  if (obj._textEditCaretIndex !== nextIndex || clearLineStartIndex) {
    delete obj._textEditCaretLineStartIndex;
  }
  obj._textEditCaretIndex = nextIndex;
  if (Number.isFinite(lineStartIndex)) {
    obj._textEditCaretLineStartIndex = Math.max(0, Math.min(Math.trunc(lineStartIndex), length));
  }
};

const clearTextEditCaretIndex = (obj) => {
  if (!obj) return;
  resetTextEditNavigation(obj);
  delete obj._textEditCaretIndex;
  delete obj._textEditCaretLineStartIndex;
};

// A soft wrap has two visual positions for the same text index. Keep the row
// selected by a click/navigation, or choose the side approached by an arrow.
const textEditCaretLineAtIndex = (obj, layout, index, affinity = null) => {
  if (!layout.length) return -1;
  let lo = 0, hi = layout.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const line = layout[mid];
    const end = line.caretEndIndex ?? line.endIndex ?? (line.startIndex + line.text.length);
    if (index <= end) hi = mid;
    else lo = mid + 1;
  }
  const preferred = affinity == null && obj?._textEditCaretIndex === index
    ? obj._textEditCaretLineStartIndex : null;
  let result = lo;
  // Crossing consumed wrap whitespace reaches the next row's beginning. A
  // hard word wrap, in contrast, still has a caret at the preceding row's end.
  const line = layout[lo];
  const visibleEnd = line.endIndex ?? (line.startIndex + line.text.length);
  if (index > visibleEnd && layout[lo + 1]?.startIndex === index) result = lo + 1;
  for (let i = lo; i < layout.length && layout[i].startIndex <= index; i++) {
    if (layout[i].startIndex === preferred) return i;
    if (affinity === 'forward') result = i;
  }
  return result;
};

const rememberTextEditNavigationSelection = (obj, proxy, index, lineStartIndex) => {
  setTextEditCaretIndex(obj, index, lineStartIndex, true, true);
  obj._textEditNavigationSelection = {
    start: proxy.selectionStart,
    end: proxy.selectionEnd,
    direction: proxy.selectionDirection || 'none',
  };
};

const applyTextEditNavigationSelection = (obj, proxy, selection, index, lineStartIndex, extend) => {
  const anchor = selection.direction === 'backward' ? selection.end : selection.start;
  if (extend) {
    setTextEditProxySelectionRange(proxy, Math.min(anchor, index), Math.max(anchor, index),
      index < anchor ? 'backward' : 'forward');
  } else {
    setTextEditProxySelectionRange(proxy, index, index, 'none');
  }
  rememberTextEditNavigationSelection(obj, proxy, index, lineStartIndex);
};

const textEditVisibleSelectionReplacementRange = (content, selection = {}) => {
  const length = String(content ?? '').length;
  const first = Math.max(0, Math.min(Math.trunc(Number(selection.start)) || 0, length));
  const second = Math.max(0, Math.min(Math.trunc(Number(selection.end ?? first)) || 0, length));
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  return { ...selection, start, end, hasSelection: start !== end };
};

const createTextSelectionClipboardPayload = (value, selection = {}) => {
  const content = String(value ?? '');
  const range = textEditVisibleSelectionReplacementRange(content, selection);
  return {
    type: 'text-selection',
    text: textSelectionForClipboard(content.slice(range.start, range.end)),
  };
};

const textSelectionPayloadFromBoardfishClipboardValue = (clipboard) => {
  if (!clipboard) return null;
  if (clipboard.type === 'text-selection') {
    return { type: 'text-selection', text: textSelectionForClipboard(clipboard.text || '') };
  }
  if (clipboard.type !== 'objects') return null;
  const source = clipboard.objects?.length === 1 ? clipboard.objects[0] : null;
  if (source?.type !== 'text') return null;
  const content = String(source.data?.content ?? '');
  return createTextSelectionClipboardPayload(content, { start: 0, end: content.length });
};

const currentBoardfishTextSelectionClipboardPayload = () => (
  textSelectionPayloadFromBoardfishClipboardValue(typeof jsClipboard !== 'undefined' ? jsClipboard : null)
);

const copyTextEditSelectionFromProxy = async (
  id,
  proxy,
  selection = textEditSelectionState(proxy),
) => {
  if (!selection?.hasSelection || !proxy) return false;
  const sourceValue = textEditProxyValue(proxy);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbgApi = textEditorClipDebugApi();
  const dbg = dbgApi?.start?.('copyTextEditSelection', {
    objectId: id,
    proxyChars: sourceValue.length,
    ...textEditorSelectionDebugStats(selection, sourceValue),
  }) || null;
  let stepStartedAt = textEditorDebugNow();
  const copyStartedAt = stepStartedAt;
  const logStep = (step, meta = {}) => {
    const now = textEditorDebugNow();
    const payload = {
      ms: Math.round((now - stepStartedAt) * 100) / 100,
      totalMs: Math.round((now - copyStartedAt) * 100) / 100,
      objectId: id,
      ...meta,
    };
    dbgApi?.step?.(dbg, step, payload);
    textEditorClipboardLog(step, objectsMap.get(id), payload);
    stepStartedAt = now;
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const obj = objectsMap.get(id);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('copy:text-selection-payload-start', {
    sourceFound: !!obj,
    ...textEditorSelectionDebugStats(selection, sourceValue),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const payload = obj
    ? createTextSelectionClipboardPayload(sourceValue, selection)
    : { type: 'text-selection', text: textSelectionForClipboard(sourceValue.slice(selection.start, selection.end)) };
  const clipboardText = payload.text;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const textStats = textEditorTextStats(clipboardText);
  logStep('copy:text-selection-payload-ready', {
    sourceTextLen: sourceValue.length,
    ...textStats,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (clipboardText && typeof setJsClipboard === 'function') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logStep('copy:text-selection-set-jsClipboard-start', textStats);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    setJsClipboard({
      type: 'text-selection',
      text: clipboardText,
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logStep('copy:text-selection-set-jsClipboard-end', textStats);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else if (typeof clearJsClipboard === 'function') {
    clearJsClipboard();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logStep('copy:text-selection-clear-jsClipboard', textStats);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  const meta = {};
  if (typeof getJsClipboardWebToken === 'function') {
    const webToken = getJsClipboardWebToken();
    if (webToken) meta.boardfishToken = webToken;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const writeStartedAt = textEditorDebugNow();
  logStep('copy:web-text-clipboard-write-start', {
    boardfishToken: !!meta.boardfishToken,
    ...textStats,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let writePromise;
  writePromise = BoardfishClipboardIO.copyTextToClipboard(clipboardText,
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg,
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    typeof BOARDFISH_PRODUCTION === 'undefined' ? { ...meta, ...textStats } : meta,
  );
  writePromise
    .then((result) => {
      if (result?.boardfishTokenWritten && meta.boardfishToken) {
        if (typeof markJsClipboardWebTokenWritten === 'function') {
          markJsClipboardWebTokenWritten(meta.boardfishToken
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            , dbg
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
          );
        }
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      logStep('copy:web-text-clipboard-write-end', {
        clipboardWriteMs: Math.round((textEditorDebugNow() - writeStartedAt) * 100) / 100,
        boardfishTokenWritten: !!result?.boardfishTokenWritten,
        ...textStats,
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    })
    .catch((err) => {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      logStep('copy:web-text-clipboard-write-error', {
        clipboardWriteMs: Math.round((textEditorDebugNow() - writeStartedAt) * 100) / 100,
        error: String(err),
        ...textStats,
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      console.error('[copy] text selection clipboard write FAILED:', err);
    });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  writePromise.finally(() => {
    dbgApi?.end?.(dbg, {
      path: 'text-edit-selection-web',
      objectId: id,
      textObjectCount: 1,
      textCharCount: textStats.textLen,
      largestTextChars: textStats.textLen,
      ...textStats,
    });
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return true;
};

const boardfishTextClipboardStillCurrent = async (event = null
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  if (typeof jsClipboard === 'undefined' || !jsClipboard) return false;
  if (typeof jsClipboardStillCurrent !== 'function') return true;
  let webClipboardTokenChecked = false;
  let webClipboardToken = '';
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const tokenReadStartedAt = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (
    event?.clipboardData &&
    typeof BoardfishClipboardIO !== 'undefined' &&
    typeof BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent === 'function'
  ) {
    webClipboardTokenChecked = true;
    webClipboardToken = BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(event.clipboardData);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    textEditorClipStep(dbg, 'paste:text-selection-event-token-read', {
      tokenFound: !!webClipboardToken,
      ms: Math.round((textEditorDebugNow() - tokenReadStartedAt) * 100) / 100,
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else if (
    (typeof _jsClipboardWebMaybeStale === 'undefined' || _jsClipboardWebMaybeStale) &&
    typeof BoardfishClipboardIO !== 'undefined' &&
    typeof BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser === 'function'
  ) {
    try {
      const result = typeof BOARDFISH_PRODUCTION === 'undefined'
        ? await BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser(dbg)
        : await BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser();
      webClipboardTokenChecked = result?.checked === true;
      webClipboardToken = result?.token || '';
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      textEditorClipStep(dbg, 'paste:text-selection-browser-token-read', {
        checked: webClipboardTokenChecked,
        tokenFound: !!webClipboardToken,
        ms: Math.round((textEditorDebugNow() - tokenReadStartedAt) * 100) / 100,
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } catch (_) {}
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const currentStartedAt = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const currentOptions = { webClipboardTokenChecked, webClipboardToken };
  const current = typeof BOARDFISH_PRODUCTION === 'undefined'
    ? jsClipboardStillCurrent(dbg, currentOptions)
    : jsClipboardStillCurrent(currentOptions);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  textEditorClipStep(dbg, 'paste:text-selection-current-check-done', {
    current,
    webClipboardTokenChecked,
    webClipboardTokenFound: !!webClipboardToken,
    ms: Math.round((textEditorDebugNow() - currentStartedAt) * 100) / 100,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return current;
};

const readBoardfishTextClipboardPayloadForPaste = async (event = null
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  const payload = currentBoardfishTextSelectionClipboardPayload();
  if (!payload) return null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  textEditorClipStep(dbg, 'paste:text-selection-js-payload-candidate', textEditorTextStats(payload.text));
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const current = typeof BOARDFISH_PRODUCTION === 'undefined'
    ? await boardfishTextClipboardStillCurrent(event, dbg)
    : await boardfishTextClipboardStillCurrent(event);
  if (!current) {
    if (typeof clearJsClipboard === 'function') clearJsClipboard();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    textEditorClipStep(dbg, 'paste:text-selection-js-payload-stale');
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return null;
  }
  return currentBoardfishTextSelectionClipboardPayload();
};

const replaceTextEditProxyRange = (proxy, inserted, start, end, selectionMode = 'end', deferDomValue = false) => {
  const value = textEditProxyValue(proxy);
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, value.length));
  const to = Math.max(from, Math.min(Math.trunc(Number(end)) || from, value.length));
  const nextLength = value.length + inserted.length - (to - from);
  const largeValue = value.length + inserted.length > TEXT_EDIT_DIRECT_TEXTAREA_REPLACE_CHARS;
  deferDomValue = deferDomValue && nextLength > TEXT_EDIT_DEFER_DOM_REPLACE_CHARS;
  if (largeValue) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const buildStartedAt = textEditorDebugNow();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const nextValue = `${value.slice(0, from)}${inserted}${value.slice(to)}`;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const valueBuildMs = textEditorDebugRound(textEditorDebugNow() - buildStartedAt);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const caret = selectionMode === 'start' ? from : from + inserted.length;
    if (deferDomValue) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const logicalStartedAt = textEditorDebugNow();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      setTextEditProxyLogicalValue(proxy, nextValue, false);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const logicalSetMs = textEditorDebugRound(textEditorDebugNow() - logicalStartedAt);
      const selectionStartedAt = textEditorDebugNow();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      proxy.setSelectionRange(caret, caret, 'none');
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const selectionSetMs = textEditorDebugRound(textEditorDebugNow() - selectionStartedAt);
      const ms = textEditorDebugRound(valueBuildMs + logicalSetMs + selectionSetMs);
      return {
        method: 'logical',
        textareaMutationMs: ms,
        setRangeTextMs: '',
        valueAssignMs: '',
        valueBuildMs,
        valueSetMs: '',
        logicalSetMs,
        selectionSetMs,
      };
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const assignStartedAt = textEditorDebugNow();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    proxy.value = nextValue;
    setTextEditProxyLogicalValue(proxy, nextValue);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const valueSetMs = textEditorDebugRound(textEditorDebugNow() - assignStartedAt);
    const selectionStartedAt = textEditorDebugNow();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    proxy.setSelectionRange(caret, caret, 'none');
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const selectionSetMs = textEditorDebugRound(textEditorDebugNow() - selectionStartedAt);
    const ms = textEditorDebugRound(valueBuildMs + valueSetMs + selectionSetMs);
    return {
      method: 'value',
      textareaMutationMs: ms,
      setRangeTextMs: '',
      valueAssignMs: ms,
      valueBuildMs,
      valueSetMs,
      logicalSetMs: '',
      selectionSetMs,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const rangeTextStartedAt = textEditorDebugNow();
  const domSyncResult =
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  syncTextEditProxyDomValue(proxy, value);
  proxy.setRangeText(inserted, from, to, selectionMode);
  setTextEditProxyLogicalValue(proxy, proxy.value);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const ms = textEditorDebugRound(textEditorDebugNow() - rangeTextStartedAt);
  return {
    method: 'setRangeText',
    textareaMutationMs: ms,
    domSyncedBeforeMutation: domSyncResult.synced,
    setRangeTextMs: ms,
    valueAssignMs: '',
    valueBuildMs: '',
    valueSetMs: '',
    logicalSetMs: '',
    selectionSetMs: '',
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

const tryNativeExternalTextPaste = (id, proxy, text, options = {}) => {
  if (!proxy || !options.event) return false;
  const obj = objectsMap.get(id);
  if (!obj) return false;
  const selection = options.selection || textEditSelectionState(proxy);
  if (selection.hasSelection) return false;

  const rawPastedText = normalizeTextContent(text || '');
  const pastedText = textForTextObjectPaste(rawPastedText);
  if (!pastedText) return false;
  if (pastedText !== rawPastedText) return false;

  const inputType = options.inputType || 'insertFromPaste';
  const currentProxyValue = textEditProxyValue(proxy);
  if (proxy._boardfishDomValueStale || proxy.value !== currentProxyValue) return false;
  const inputState = {
    ...selection,
    value: currentProxyValue,
    inputType,
    replacement: {
      start: selection.start,
      end: selection.end,
      insertedText: pastedText,
    },
    nativePasteHandled: true,
  };
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    inputState.debug = options.debug || null;
    inputState.nativePasteEndMeta = {
      path: options.path || 'event-text-native',
      pasted: true,
      textObjectCount: 1,
      textCharCount: pastedText.length,
      largestTextChars: pastedText.length,
      ...textEditorTextStats(pastedText),
    };
  }
  beginTextEditHistoryAction(id, inputState);
  proxy?._boardfishSetPendingInputState?.(inputState);
  return {
    text: pastedText,
  };
};

const replaceTextEditSelectionWithPayload = (id, proxy, payload, options = {}) => {
  if (!proxy || !payload) return false;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = options.debug || null;
  let stepStartedAt = textEditorDebugNow();
  const replaceStartedAt = stepStartedAt;
  const objForStart = typeof objectsMap !== 'undefined' ? objectsMap.get(id) : null;
  const logStep = (step, meta = {}) => {
    const now = textEditorDebugNow();
    const debugPayload = {
      ms: Math.round((now - stepStartedAt) * 100) / 100,
      totalMs: Math.round((now - replaceStartedAt) * 100) / 100,
      objectId: id,
      ...meta,
    };
    textEditorClipStep(dbg, step, debugPayload);
    textEditorClipboardLog(step, objForStart, debugPayload);
    stepStartedAt = now;
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const currentProxyValue = textEditProxyValue(proxy);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-replace-start', {
    source: options.source || '',
    proxyChars: currentProxyValue.length,
    domProxyChars: proxy.value.length,
    domValueStale: !!proxy._boardfishDomValueStale,
    ...textEditorObjectDebugStats(objForStart),
    ...textEditorTextStats(payload.text),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const text = textForTextObjectPaste(payload.text || '');
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-editable-payload-done', textEditorTextStats(text));
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!text) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logStep('paste:text-edit-replace-empty');
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return false;
  }
  const obj = objectsMap.get(id);
  if (!obj) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logStep('paste:text-edit-replace-missing-object');
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return false;
  }
  let selection = options.selection || textEditSelectionState(proxy);
  const replacementRange = selection.hasSelection
    ? textEditVisibleSelectionReplacementRange(obj.data?.content, selection)
    : selection;
  const inputType = options.inputType || 'insertFromPaste';
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-replacement-range-ready', {
    inputType,
    replacementStart: replacementRange.start,
    replacementEnd: replacementRange.end,
    replacementChars: Math.max(0, replacementRange.end - replacementRange.start),
    ...textEditorSelectionDebugStats(selection, currentProxyValue),
    ...textEditorTextStats(text),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const inputState = {
    ...selection,
    value: currentProxyValue,
    inputType,
    replacement: {
      start: replacementRange.start,
      end: replacementRange.end,
      insertedText: text,
    },
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  inputState.debug = dbg;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const historyStartedAt = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  beginTextEditHistoryAction(id, inputState);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-history-action-ready', {
    historyActionMs: Math.round((textEditorDebugNow() - historyStartedAt) * 100) / 100,
    inputType,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  proxy?._boardfishSetPendingInputState?.(inputState);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const mutationResult = replaceTextEditProxyRange(proxy, text, replacementRange.start, replacementRange.end, 'end');
  logStep('paste:text-edit-range-text-set', {
    setRangeTextMs: mutationResult.setRangeTextMs,
    valueAssignMs: mutationResult.valueAssignMs,
    valueBuildMs: mutationResult.valueBuildMs,
    valueSetMs: mutationResult.valueSetMs,
    selectionSetMs: mutationResult.selectionSetMs,
    textareaMutationMs: mutationResult.textareaMutationMs,
    textareaMutationMethod: mutationResult.method,
    ...textEditorTextStats(text),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
    replaceTextEditProxyRange(proxy, text, replacementRange.start, replacementRange.end, 'end');
  }
  _caretVisible = true;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dispatchStartedAt = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  dispatchTextEditInputEvent(proxy, inputType);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-input-dispatched', {
    dispatchMs: Math.round((textEditorDebugNow() - dispatchStartedAt) * 100) / 100,
    inputType,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-replace-end', {
    inputType,
    proxyChars: textEditProxyValue(proxy).length,
    domProxyChars: proxy.value.length,
    domValueStale: !!proxy._boardfishDomValueStale,
    ...textEditorTextStats(text),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return true;
};

const pasteBoardfishTextSelectionIntoEditSelection = async (options = {}) => {
  const proxy = options.proxy || _editEl;
  const id = options.id || editingId;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = options.debug || null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const payload = typeof BOARDFISH_PRODUCTION === 'undefined'
    ? await readBoardfishTextClipboardPayloadForPaste(options.event || null, dbg)
    : await readBoardfishTextClipboardPayloadForPaste(options.event || null);
  if (!payload) return false;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  textEditorClipStep(dbg, 'paste:text-selection-js-payload-ready', textEditorTextStats(payload.text));
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const pasteOptions = {
    selection: options.selection,
    inputType: 'insertFromPaste',
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  pasteOptions.debug = dbg;
  pasteOptions.source = 'jsClipboard-text-selection';
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return replaceTextEditSelectionWithPayload(id, proxy, payload, pasteOptions);
};

function enterEdit(id, {
  history = true,
  preserveSize = false,
  placeInitialCaret = true,
} = {}) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const enterStart = textEditorDebugNow();
  const previousEditingId = editingId || '';
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (editingId === id) return;
  if (editingId) exitEdit();

  const obj = objectsMap.get(id);
  if (!obj) return;
  editingId = id;
  invalidateOffscreen();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let stepStart = textEditorDebugNow();
  const logStep = (label, meta = {}) => {
    const t = textEditorDebugNow();
    textEditorDebugLog(label, obj, {
      phase: 'enter',
      history,
      preserveSize,
      placeInitialCaret,
      previousEditingId,
      ms: Math.round((t - stepStart) * 100) / 100,
      totalMs: Math.round((t - enterStart) * 100) / 100,
      ...meta,
    });
    stepStart = t;
  };
  textEditorDebugLog('enter-start', obj, {
    phase: 'enter',
    history,
    preserveSize,
    placeInitialCaret,
    previousEditingId,
    ms: 0,
    totalMs: Math.round((stepStart - enterStart) * 100) / 100,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  obj._editStartContent = obj.data.content;
  setTextEditMinLinesForSession(obj, preserveSize);
  _editHistoryLastContent = obj.data.content;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;
  logStep('enter-state-ready', {
    editMinLines: obj._editMinLines,
  });

  const proxy = document.createElement('textarea');
  proxy.wrap = 'off';
  proxy.spellcheck = false;
  proxy.tabIndex = -1;
  proxy.setAttribute('autocomplete', 'off');
  proxy.setAttribute('autocorrect', 'off');
  proxy.setAttribute('autocapitalize', 'off');
  proxy.setAttribute('aria-label', 'Boardfish text editor');
  proxy.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;overflow:hidden;white-space:pre;contain:strict;transform:translate(-100vw,-100vh)';
  proxy.value = obj.data.content;
  setTextEditProxyLogicalValue(proxy, obj.data.content);
  document.body.appendChild(proxy);
  _editEl = proxy;
  logStep('enter-proxy-ready', {
    proxyChars: proxy.value.length,
    proxyWrap: proxy.wrap || proxy.getAttribute('wrap') || '',
    proxySpellcheck: proxy.spellcheck,
    proxyAutocomplete: proxy.getAttribute('autocomplete'),
    proxyAutocorrect: proxy.getAttribute('autocorrect'),
    proxyAutocapitalize: proxy.getAttribute('autocapitalize'),
    proxyAriaHidden: proxy.getAttribute('aria-hidden'),
    proxyAriaLabel: proxy.getAttribute('aria-label'),
    proxyContain: proxy.style.contain || '',
    proxyWhiteSpace: proxy.style.whiteSpace || '',
    proxyOverflow: proxy.style.overflow || '',
  });

  let pendingInputState = null;
  let pendingNativeNavigation = null;
  proxy._boardfishSetPendingInputState = (state) => { pendingInputState = state; };
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const recordInputSetupStep = (step, event, state = {}, extra = {}) => {
    const inputType = event?.inputType || state.inputType || '';
    if (!shouldTraceTextEditorInput(inputType)) return;
    const sourceValue = normalizeTextContent(state.value ?? textEditProxyValue(proxy));
    const replacement = state.replacement || null;
    recordTextEditorInputPerfStep(step, {
      seq: state._debugSeq ?? '',
      inputType,
      objectId: id,
      proxyChars: textEditProxyValue(proxy).length,
      domProxyChars: proxy.value.length,
      domValueStale: !!proxy._boardfishDomValueStale,
      ...textEditorEventDebugStats(event),
      ...textEditorObjectDebugStats(obj),
      ...textEditorSizeDebugStats(obj, sourceValue, 'inputState'),
      ...textEditorProxySizeDebugStats(proxy),
      ...textEditorSelectionDebugStats(state, sourceValue),
      oldChars: sourceValue.length,
      insertedChars: String(replacement?.insertedText ?? '').length,
      removedChars: replacement ? Math.max(0, (replacement.end ?? 0) - (replacement.start ?? 0)) : 0,
      replacementStart: replacement?.start ?? '',
      replacementEnd: replacement?.end ?? '',
      ...extra,
    });
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  proxy.addEventListener('beforeinput', (event) => {
    resetTextEditNavigation(obj);
    pendingNativeNavigation = null;
    if (pendingInputState?.nativePasteHandled && event?.inputType === 'insertFromPaste') {
      return;
    }
    const selection = textEditSelectionState(proxy);
    const currentProxyValue = textEditProxyValue(proxy);
    const nativeReplacement = textEditBeforeInputReplacement(currentProxyValue, selection, event);
    pendingInputState = {
      ...selection,
      value: currentProxyValue,
      inputType: event?.inputType || '',
    };
    if (nativeReplacement) pendingInputState.replacement = nativeReplacement;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      pendingInputState._debugSeq = nextTextEditInputDebugSeq();
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const domSyncBeforeNativeInput =
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    syncTextEditProxyDomValue(proxy, currentProxyValue, selection);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (domSyncBeforeNativeInput.synced) pendingInputState.domSyncedBeforeNativeInput = true;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    beginTextEditHistoryAction(id, pendingInputState);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    recordInputSetupStep('beforeinput-state-ready', event, pendingInputState, {
      nativeReplacement: !!nativeReplacement,
      domSyncedBeforeNativeInput: domSyncBeforeNativeInput.synced,
      splitPending: shouldCommitTextEditInputImmediately(pendingInputState.inputType, pendingInputState.hasSelection),
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  });
	  proxy.addEventListener('input', (event) => {
	    const inputState = pendingInputState || textEditSelectionState(proxy);
	    const inputType = event?.inputType || inputState.inputType || '';
	    /* BOARDFISH_DEV_DIAGNOSTICS_START */
	    const dbg = inputState.debug || null;
	    const perfTraceInput = shouldTraceTextEditorInput(inputType);
	    const shouldLogInput = perfTraceInput || !!dbg ||
	      (typeof TextSelDebug !== 'undefined' && TextSelDebug.enabled === true);
	    const inputDebugSeq = inputState._debugSeq || nextTextEditInputDebugSeq();
	    inputState._debugSeq = inputDebugSeq;
	    let inputStepStartedAt = shouldLogInput ? textEditorDebugNow() : 0;
    const inputStartedAt = inputStepStartedAt;
    const logInputStep = (step, meta = {}) => {
      if (!shouldLogInput) return;
      const details = typeof meta === 'function' ? meta() : meta;
      const now = textEditorDebugNow();
      const payload = {
        seq: inputDebugSeq,
        inputType,
        ms: textEditorDebugRound(now - inputStepStartedAt),
        totalMs: textEditorDebugRound(now - inputStartedAt),
        objectId: id,
        ...details,
      };
      textEditorClipStep(dbg, `text-edit-input:${step}`, payload);
      textEditorDebugLog(`input-${step}`, obj, payload);
      if (perfTraceInput) recordTextEditorInputPerfStep(step, payload);
      inputStepStartedAt = now;
	    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
	    logInputStep('start', () => ({
	      proxyChars: textEditProxyValue(proxy).length,
	      domProxyChars: proxy.value.length,
	      domValueStale: !!proxy._boardfishDomValueStale,
	      pendingInputState: !!pendingInputState,
	      textEditCaretIndex: obj._textEditCaretIndex ?? '',
	      textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
	      ...textEditorCaretLineDebugStats(obj, inputState.start ?? proxy.selectionStart, 'inputStartCaret'),
	      ...textEditorEventDebugStats(event),
	      ...textEditorObjectDebugStats(obj),
	      ...textEditorSizeDebugStats(obj, inputState.value ?? obj.data.content ?? '', 'inputStart'),
	      ...textEditorProxySizeDebugStats(proxy),
	      ...textEditorSelectionDebugStats(inputState, inputState.value ?? obj.data.content ?? ''),
	    }));
    pendingInputState = null;
	    const oldValue = inputState.value ?? obj.data.content ?? '';
	    let replacement = inputState.replacement || null;
	    let synthesizedStaleReplacement = false;
	    let nextRawValue = '';
	    if (proxy._boardfishDomValueStale && !replacement) {
	      replacement = textEditBeforeInputReplacement(oldValue, inputState, event);
	      synthesizedStaleReplacement = !!replacement;
	    }
	    if (synthesizedStaleReplacement) {
	      nextRawValue = normalizeTextContent(
	        oldValue.slice(0, replacement.start) + replacement.insertedText + oldValue.slice(replacement.end)
	      );
	    } else {
	      nextRawValue = proxy._boardfishDomValueStale && replacement ? textEditProxyValue(proxy) : proxy.value;
	      replacement = replacement || textEditInputReplacement(oldValue, nextRawValue, inputState, inputType);
	    }
	    logInputStep('replacement-ready', () => ({
	      oldChars: oldValue.length,
	      nextChars: nextRawValue.length,
      insertedChars: String(replacement.insertedText || '').length,
      removedChars: Math.max(0, (replacement.end ?? 0) - (replacement.start ?? 0)),
      replacementStart: replacement.start,
      replacementEnd: replacement.end,
      deletedTextSample: oldValue.slice(replacement.start ?? 0, replacement.end ?? replacement.start ?? 0).slice(0, 120),
      textEditCaretIndex: obj._textEditCaretIndex ?? '',
      textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
      ...textEditorCaretLineDebugStats(obj, replacement.start ?? inputState.start ?? 0, 'replacementCaret'),
      ...textEditorSizeDebugStats(obj, oldValue, 'replacementOld'),
      ...textEditorTextStats(replacement.insertedText),
    }));
	    obj.data.content = nextRawValue;
	    markDirty(obj);
	    logInputStep('content-dirty-done');
	    if (proxy._boardfishDomValueStale) {
	      if (synthesizedStaleReplacement) {
	        const caret = Math.max(0, Math.min(
	          (replacement.start ?? 0) + String(replacement.insertedText ?? '').length,
	          obj.data.content.length
	        ));
	        syncTextEditProxyDomValue(proxy, obj.data.content, {
	          start: caret,
	          end: caret,
	          direction: 'none',
	        });
	      } else {
	        setTextEditProxyLogicalValue(proxy, obj.data.content, false);
	      }
	    } else {
	      setTextEditProxyLogicalValue(proxy, obj.data.content);
	    }
	    logInputStep('content-normalized', {
	      proxyChars: textEditProxyValue(proxy).length,
	      domProxyChars: proxy.value.length,
	      domValueStale: !!proxy._boardfishDomValueStale,
	      synthesizedStaleReplacement,
	      contentChars: obj.data.content.length,
	    });
    const selectionStart = proxy.selectionStart;
    const selectionEnd = proxy.selectionEnd;
    if (selectionStart === selectionEnd) setTextEditCaretIndex(obj, selectionStart, null, true);
    else clearTextEditCaretIndex(obj);
    logInputStep('caret-updated', () => ({
      selectionStart,
      selectionEnd,
      textEditCaretIndex: obj._textEditCaretIndex ?? '',
      textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
      ...textEditorCaretLineDebugStats(obj, selectionStart, 'updatedCaret'),
      ...textEditorSizeDebugStats(obj, obj.data.content, 'updated'),
      ...textEditorProxySizeDebugStats(proxy),
    }));

    const layoutPatched = patchTextObjectLayoutAfterInput(obj, {
      oldContent: oldValue,
      newContent: obj.data.content,
      start: replacement.start,
      end: replacement.end,
      insertedText: replacement.insertedText,
    });
    if (!layoutPatched) clearTextObjectLayoutRuntime(obj);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const layoutPatchDebug = obj._lastTextLayoutPatchDebug || {};
      logInputStep(layoutPatched ? 'layout-patched' : 'layout-invalidated', {
        layoutPatched,
        layoutCacheLines: Array.isArray(obj._layoutCache) ? obj._layoutCache.length : '',
        layoutPatchOldLines: layoutPatchDebug.oldLayoutLines ?? '',
        layoutPatchNewLines: layoutPatchDebug.newLayoutLines ?? '',
        layoutPatchRemovedLines: layoutPatchDebug.removedLayoutLines ?? '',
        layoutPatchInsertedLines: layoutPatchDebug.insertedLayoutLines ?? '',
        layoutPatchLineDelta: layoutPatchDebug.layoutLineDelta ?? '',
        layoutPatchLogicalLineDelta: layoutPatchDebug.logicalLineDelta ?? '',
        layoutPatchReason: layoutPatchDebug.reason || '',
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const restoredMinLinesReset = resetTextEditPreservedMinLines(obj);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') resetTextEditPreservedMinLines(obj);
    const pendingSizeSyncBeforeAutoHeight = !!obj._textEditPendingSizeSync;
    const replacementStart = Math.max(0, Math.min(replacement.start ?? 0, oldValue.length));
    const replacementEnd = Math.max(replacementStart, Math.min(replacement.end ?? replacementStart, oldValue.length));
    const insertedText = String(replacement.insertedText || '');
    const removedChars = replacementEnd - replacementStart;
    const insertedChars = insertedText.length;
    const deletesContent = String(inputType || '').startsWith('delete');
    const deleteReducedLogicalLines = deletesContent && oldValue.slice(replacementStart, replacementEnd).includes('\n');
    const selectedDeleteShrankText = deletesContent && !!inputState.hasSelection && removedChars > insertedChars;
    const deleteShrankPendingEdit = pendingSizeSyncBeforeAutoHeight &&
      deletesContent &&
      removedChars > insertedChars;
    const layoutRemovedLines = layoutPatched && obj._lastTextLayoutLineDelta < 0;
    const insertsLineBreak = inputType === 'insertLineBreak' || inputType === 'insertParagraph';
    const forceAutoHeight = layoutRemovedLines || deleteReducedLogicalLines ||
      selectedDeleteShrankText || deleteShrankPendingEdit || insertsLineBreak;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const autoHeightForceReason = layoutRemovedLines
      ? 'layout-line-removal'
      : (deleteReducedLogicalLines
        ? 'logical-line-delete'
        : (selectedDeleteShrankText
          ? 'selected-delete'
          : (deleteShrankPendingEdit
            ? 'pending-size-delete'
            : (insertsLineBreak ? 'line-break-insert' : ''))));
    const autoHeightDebugBefore = shouldLogInput
      ? {
          size: textEditorSizeDebugStats(obj, obj.data.content, 'beforeAutoHeight'),
          proxy: textEditorProxySizeDebugStats(proxy),
        }
      : null;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    let heightChanged;
    if (
      !forceAutoHeight &&
      obj?.type === 'text' &&
      String(obj._editStartContent ?? '') !== '' &&
      String(obj.data?.content || '').length >= TEXT_EDIT_DEFER_AUTO_HEIGHT_CHARS
    ) {
      obj._textEditPendingSizeSync = true;
      heightChanged = false;
    } else {
      delete obj._textEditPendingSizeSync;
      heightChanged = syncTextAutoHeight(obj, getTextMinLines(obj));
    }
    logInputStep('auto-height-done', () => ({
      heightChanged,
      autoHeightDeferred: !!obj._textEditPendingSizeSync,
      autoHeightForceSync: forceAutoHeight,
      autoHeightForceReason,
      restoredMinLinesReset: !!restoredMinLinesReset,
      pendingSizeSyncBeforeAutoHeight,
      pendingSizeSync: !!obj._textEditPendingSizeSync,
      width: obj.w,
      height: obj.h,
      ...autoHeightDebugBefore?.size,
      ...textEditorSizeDebugStats(obj, obj.data.content, 'afterAutoHeight'),
      ...autoHeightDebugBefore?.proxy,
      removedChars,
      insertedChars,
      removedNewlines: textNewlineCount(oldValue, replacementStart, replacementEnd),
      insertedNewlines: textNewlineCount(insertedText),
      ...textEditorTextStats(obj.data.content),
    }));
    _textInputSelectionHistorySuppress = textEditSelectionState(proxy);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const historyPushed =
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    recordTextEditInputHistory(id, inputType, !!inputState.hasSelection);
    logInputStep('history-recorded', {
      historyPushed,
      hadSelection: !!inputState.hasSelection,
    });
    scheduleRender(true, heightChanged);
    logInputStep('render-scheduled', {
      renderBoard: true,
      renderOverlay: heightChanged,
      renderSource: 'render',
    });
	    logInputStep('end', () => ({
	      heightChanged,
	      proxyChars: textEditProxyValue(proxy).length,
	      domProxyChars: proxy.value.length,
	      domValueStale: !!proxy._boardfishDomValueStale,
	      ...textEditorObjectDebugStats(obj),
	      ...textEditorSizeDebugStats(obj, obj.data.content, 'inputEnd'),
	      ...textEditorProxySizeDebugStats(proxy),
	      ...textEditorSelectionDebugStats(_textInputSelectionHistorySuppress, textEditProxyValue(proxy)),
	    }));
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (inputState.nativePasteEndMeta && dbg) {
      textEditorClipDebugApi()?.end?.(dbg, {
        ...inputState.nativePasteEndMeta,
        objectId: id,
        proxyChars: textEditProxyValue(proxy).length,
        domProxyChars: proxy.value.length,
        domValueStale: !!proxy._boardfishDomValueStale,
        ...textEditorObjectDebugStats(obj),
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  });
  proxy.addEventListener('paste', (event) => {
    const eventSelection = textEditSelectionState(proxy);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const dbgApi = textEditorClipDebugApi();
    const dbg = dbgApi?.start?.('pasteTextEditSelection', {
      objectId: id,
      proxyChars: proxy.value.length,
      clipboardData: typeof BoardfishClipboardIO !== 'undefined'
        ? BoardfishClipboardIO.describeClipboardData?.(event.clipboardData)
        : null,
      ...textEditorEventDebugStats(event),
      ...textEditorObjectDebugStats(obj),
      ...textEditorSelectionDebugStats(eventSelection, proxy.value),
    }) || null;
    let pasteStepStartedAt = textEditorDebugNow();
    const pasteStartedAt = pasteStepStartedAt;
    const logPasteStep = (step, meta = {}) => {
      const now = textEditorDebugNow();
      const payload = {
        ms: Math.round((now - pasteStepStartedAt) * 100) / 100,
        totalMs: Math.round((now - pasteStartedAt) * 100) / 100,
        objectId: id,
        ...meta,
      };
      dbgApi?.step?.(dbg, step, payload);
      textEditorClipboardLog(step, obj, payload);
      pasteStepStartedAt = now;
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const fallbackText = typeof BoardfishClipboardIO !== 'undefined'
      ? BoardfishClipboardIO.readClipboardTextFromEvent?.(event.clipboardData) || ''
      : '';
    const selection = eventSelection;
    if (fallbackText) {
      const nativeExternalOptions = {
        event,
        selection,
        inputType: 'insertFromPaste',
      };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        nativeExternalOptions.debug = dbg;
      }
      const nativeExternalPaste = tryNativeExternalTextPaste(id, proxy, fallbackText, nativeExternalOptions);
      if (nativeExternalPaste) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        logPasteStep('paste:text-edit-native-event-text-allowed', {
          source: 'event-text',
          textLen: nativeExternalPaste.text.length,
          ...textEditorTextStats(nativeExternalPaste.text),
          ...textEditorSelectionDebugStats(selection, proxy.value),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      logPasteStep('paste:text-edit-native-event-text-skipped', {
        source: 'event-text',
        fallbackTextChars: fallbackText.length,
        selectedChars: selection.end - selection.start,
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    const candidate = currentBoardfishTextSelectionClipboardPayload();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logPasteStep('paste:text-edit-event-read-done', {
      ...textEditorEventDebugStats(event),
      hasBoardfishCandidate: !!candidate,
      fallbackTextChars: fallbackText.length,
      proxyChars: proxy.value.length,
      ...textEditorObjectDebugStats(obj),
      ...textEditorTextStats(fallbackText),
      candidateTextLen: candidate?.text?.length ?? '',
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (!candidate && !fallbackText) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      dbgApi?.end?.(dbg, {
        path: 'empty',
        skipped: 'no-text-payload',
        objectId: id,
        proxyChars: proxy.value.length,
        ...textEditorObjectDebugStats(obj),
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return;
    }
    event.preventDefault();
    if (!candidate) {
      const replaceOptions = { selection, inputType: 'insertFromPaste' };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        replaceOptions.debug = dbg;
        replaceOptions.source = 'event-text';
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const pasted =
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
      }, replaceOptions);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      dbgApi?.end?.(dbg, {
        path: 'event-text',
        pasted,
        objectId: id,
        proxyChars: proxy.value.length,
        textObjectCount: 1,
        textCharCount: fallbackText.length,
        largestTextChars: fallbackText.length,
        ...textEditorObjectDebugStats(obj),
        ...textEditorTextStats(fallbackText),
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return;
    }
    const pasteOptions = {
      id,
      proxy,
      event,
      selection,
    };
    if (typeof BOARDFISH_PRODUCTION === 'undefined') pasteOptions.debug = dbg;
    pasteBoardfishTextSelectionIntoEditSelection(pasteOptions).then((pasted) => {
      if (pasted || !fallbackText) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        dbgApi?.end?.(dbg, {
          path: pasted ? 'jsClipboard-text-selection' : 'jsClipboard-empty',
          pasted,
          objectId: id,
          proxyChars: proxy.value.length,
          textObjectCount: pasted ? 1 : 0,
          textCharCount: pasted ? (candidate?.text?.length || 0) : 0,
          largestTextChars: pasted ? (candidate?.text?.length || 0) : 0,
          ...textEditorObjectDebugStats(obj),
          ...textEditorTextStats(candidate?.text || ''),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      logPasteStep('paste:text-edit-js-payload-fallback-event-text', textEditorTextStats(fallbackText));
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const fallbackOptions = { selection, inputType: 'insertFromPaste' };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        fallbackOptions.debug = dbg;
        fallbackOptions.source = 'fallback-event-text';
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const fallbackPasted =
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
      }, fallbackOptions);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      dbgApi?.end?.(dbg, {
        path: 'fallback-event-text',
        pasted: fallbackPasted,
        objectId: id,
        proxyChars: proxy.value.length,
        textObjectCount: fallbackPasted ? 1 : 0,
        textCharCount: fallbackPasted ? fallbackText.length : 0,
        largestTextChars: fallbackPasted ? fallbackText.length : 0,
        ...textEditorObjectDebugStats(obj),
        ...textEditorTextStats(fallbackText),
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }).catch((err) => {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      logPasteStep('paste:text-edit-js-payload-error', { error: String(err) });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      console.error('[paste] Boardfish text selection paste FAILED:', err);
      if (!fallbackText) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        dbgApi?.end?.(dbg, {
          path: 'error',
          error: String(err),
          objectId: id,
          proxyChars: proxy.value.length,
          ...textEditorObjectDebugStats(obj),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return;
      }
      const fallbackOptions = { selection, inputType: 'insertFromPaste' };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        fallbackOptions.debug = dbg;
        fallbackOptions.source = 'error-fallback-event-text';
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const fallbackPasted =
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
      }, fallbackOptions);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      dbgApi?.end?.(dbg, {
        path: 'error-fallback-event-text',
        error: String(err),
        pasted: fallbackPasted,
        objectId: id,
        proxyChars: proxy.value.length,
        textObjectCount: fallbackPasted ? 1 : 0,
        textCharCount: fallbackPasted ? fallbackText.length : 0,
        largestTextChars: fallbackPasted ? fallbackText.length : 0,
        ...textEditorObjectDebugStats(obj),
        ...textEditorTextStats(fallbackText),
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    });
  });
  proxy.addEventListener('blur', flushEditHistoryCheckpoint);
  proxy.addEventListener('keydown', (e) => {
    const wakeCaret = !_caretVisible;
    _caretVisible = true;
    pendingNativeNavigation = null;
    if (!['ArrowUp', 'ArrowDown', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      resetTextEditNavigation(obj);
    }

    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const currentProxyValue = textEditProxyValue(proxy);
      const selection = textEditSelectionState(proxy);
      const indentResult = applyTextEditLineIndent(currentProxyValue, selection, e.shiftKey);
      if (!indentResult.changed) {
        if (wakeCaret) scheduleRender(true, false);
        return;
      }
      const inputType = e.shiftKey ? 'deleteContentBackward' : 'insertText';
      pendingInputState = {
        ...selection,
        value: currentProxyValue,
        inputType,
        replacement: indentResult.replacement,
      };
      beginTextEditHistoryAction(id, pendingInputState);
      proxy.value = indentResult.value;
      setTextEditProxyLogicalValue(proxy, indentResult.value);
      proxy.setSelectionRange(indentResult.start, indentResult.end, indentResult.direction);
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if (e.key === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const currentProxyValue = textEditProxyValue(proxy);
      const selection = textEditSelectionState(proxy);
      const lineBreakResult = applyTextEditLineBreakIndent(currentProxyValue, selection);
      const inputType = 'insertLineBreak';
      pendingInputState = {
        ...selection,
        value: currentProxyValue,
        inputType,
      };
      beginTextEditHistoryAction(id, pendingInputState);
      proxy.value = lineBreakResult.value;
      setTextEditProxyLogicalValue(proxy, lineBreakResult.value);
      proxy.setSelectionRange(lineBreakResult.start, lineBreakResult.end, lineBreakResult.direction);
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && proxy.selectionStart !== proxy.selectionEnd) {
      e.preventDefault();
      copyTextEditSelectionFromProxy(id, proxy);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'x' && proxy.selectionStart !== proxy.selectionEnd) {
      e.preventDefault();
      const selection = textEditSelectionState(proxy);
      copyTextEditSelectionFromProxy(id, proxy, selection);
      const deletion = selection;
      const inputType = 'deleteByCut';
      pendingInputState = {
        ...selection,
        value: textEditProxyValue(proxy),
        inputType,
        replacement: {
          start: deletion.start,
          end: deletion.end,
          insertedText: '',
        },
      };
      beginTextEditHistoryAction(id, pendingInputState);
      proxy.setRangeText('', deletion.start, deletion.end, 'start');
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const currentProxyValue = textEditProxyValue(proxy);
      setTextEditProxySelectionRange(proxy, 0, currentProxyValue.length, 'none', currentProxyValue);
      TextSelDebug._logSelection('select-all', proxy);
      scheduleRender(true, false);
      return;
    }

    if (
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing
    ) {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const currentProxyValue = textEditProxyValue(proxy);
      const selection = textEditSelectionState(proxy);
      syncTextEditProxyDomValue(proxy, currentProxyValue, selection);
      const moveRight = e.key === 'ArrowRight';
      let reference = moveRight ? selection.end : selection.start;
      if (e.shiftKey) {
        const backward = selection.direction === 'backward';
        reference = backward ? selection.start : selection.end;
      }
      const nextPosition = textEditWordBoundary(
        currentProxyValue,
        reference,
        moveRight ? 'right' : 'left',
      );
      const layout = getTextLayout(obj);
      const lineIndex = textEditCaretLineAtIndex(obj, layout, nextPosition, moveRight ? 'backward' : 'forward');
      applyTextEditNavigationSelection(obj, proxy, selection, nextPosition,
        layout[lineIndex]?.startIndex, e.shiftKey);
      scheduleRender(true, false);
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const deleteKeyStartedAt = textEditorDebugNow();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const selection = textEditSelectionState(proxy);
      let deletion = null;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let deleteRangeMs = 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      let deleteCaret = selection.start;
      if (selection.hasSelection) {
        deletion = { start: selection.start, end: selection.end };
      } else {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const deleteRangeStartedAt = textEditorDebugNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        deletion = textEditBlankLineDeleteRange(textEditProxyValue(proxy), selection.start, e.key);
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          deleteRangeMs = textEditorDebugRound(textEditorDebugNow() - deleteRangeStartedAt);
        }
      }
      if (deletion && deletion.end > deletion.start) {
        e.preventDefault();
        const inputType = e.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward';
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const replacementStartedAt = textEditorDebugNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        const replacement = { start: deletion.start, end: deletion.end, insertedText: '' };
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const replacementBuildMs = textEditorDebugRound(textEditorDebugNow() - replacementStartedAt);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        pendingInputState = {
          ...selection,
          value: textEditProxyValue(proxy),
          inputType,
          replacement,
        };
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          pendingInputState._debugSeq = nextTextEditInputDebugSeq();
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const deleteDebugSeq = pendingInputState._debugSeq;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        beginTextEditHistoryAction(id, pendingInputState);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const deleteSetupMeta = {
          key: e.key,
          deleteCaret,
          deleteRangeMs,
          replacementBuildMs,
          keydownDeleteSetupMs: textEditorDebugRound(textEditorDebugNow() - deleteKeyStartedAt),
          deletionStart: deletion.start,
          deletionEnd: deletion.end,
          structuralReplacementEnd: replacement.end,
          deletedTextSample: pendingInputState.value.slice(deletion.start, deletion.end).slice(0, 120),
          textEditCaretIndex: obj._textEditCaretIndex ?? '',
          textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
          ...textEditorCaretLineDebugStats(obj, deleteCaret, 'deleteCaret'),
        };
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        recordInputSetupStep('keydown-delete-replacement-ready', e, pendingInputState, deleteSetupMeta);
        textEditorDebugLog('keydown-delete-replacement-ready', obj, {
          seq: deleteDebugSeq,
          inputType,
          objectId: id,
          ...textEditorEventDebugStats(e),
          ...textEditorSelectionDebugStats(pendingInputState, pendingInputState.value),
          oldChars: pendingInputState.value.length,
          removedChars: Math.max(0, replacement.end - replacement.start),
          replacementStart: replacement.start,
          replacementEnd: replacement.end,
          ...deleteSetupMeta,
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const mutationStartedAt = textEditorDebugNow();
        const mutationResult =
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        replaceTextEditProxyRange(
          proxy, replacement.insertedText, replacement.start, replacement.end, 'start', true,
        );
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const textareaMutationMs = textEditorDebugRound(textEditorDebugNow() - mutationStartedAt);
        const logicalProxyValue = textEditProxyValue(proxy);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        recordTextEditorInputPerfStep('keydown-delete-textarea-mutated', {
          seq: deleteDebugSeq,
          inputType,
          objectId: id,
          key: e.key,
          textareaMutationMs,
          textareaMutationMethod: mutationResult.method,
          setRangeTextMs: mutationResult.setRangeTextMs,
          valueAssignMs: mutationResult.valueAssignMs,
          valueBuildMs: mutationResult.valueBuildMs,
          valueSetMs: mutationResult.valueSetMs,
          logicalSetMs: mutationResult.logicalSetMs,
          selectionSetMs: mutationResult.selectionSetMs,
          proxyChars: logicalProxyValue.length,
          domProxyChars: proxy.value.length,
          domValueStale: !!proxy._boardfishDomValueStale,
          oldChars: pendingInputState.value.length,
          nextChars: logicalProxyValue.length,
          insertedChars: String(replacement.insertedText || '').length,
          removedChars: Math.max(0, replacement.end - replacement.start),
          replacementStart: replacement.start,
          replacementEnd: replacement.end,
          ...textEditorSelectionDebugStats(pendingInputState, pendingInputState.value),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const dispatchStartedAt = textEditorDebugNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        dispatchTextEditInputEvent(proxy, inputType);
        recordTextEditorInputPerfStep('keydown-delete-input-dispatched', {
          seq: deleteDebugSeq,
          inputType,
          objectId: id,
          key: e.key,
          dispatchMs: textEditorDebugRound(textEditorDebugNow() - dispatchStartedAt),
        });
        return;
      }
      textEditorDebugLog('keydown-delete-no-replacement', obj, {
        inputType: e.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward',
        key: e.key,
        deleteCaret,
        deleteRangeMs,
        keydownDeleteSetupMs: textEditorDebugRound(textEditorDebugNow() - deleteKeyStartedAt),
        deletionStart: deletion?.start ?? '',
        deletionEnd: deletion?.end ?? '',
        textEditCaretIndex: obj._textEditCaretIndex ?? '',
        textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
        ...textEditorEventDebugStats(e),
        ...textEditorSelectionDebugStats(selection, textEditProxyValue(proxy)),
        ...textEditorCaretLineDebugStats(obj, deleteCaret, 'deleteCaret'),
      });
    }

    // Command arrows use the canvas rows, since the hidden textarea is unwrapped.
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      resetTextEditNavigation(obj);
      const selection = textEditSelectionState(proxy);
      const layout = getTextLayout(obj);
      const towardStart = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      const reference = e.shiftKey
        ? (selection.direction === 'backward' ? selection.start : selection.end)
        : (towardStart ? selection.start : selection.end);
      const lineIndex = textEditCaretLineAtIndex(obj, layout, reference);
      const line = layout[lineIndex];
      let position, lineStart;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        position = towardStart ? 0 : textEditProxyValue(proxy).length;
        lineStart = (towardStart ? layout[0] : layout[layout.length - 1])?.startIndex;
      } else {
        position = towardStart ? (line?.startIndex ?? 0)
          : (line?.caretEndIndex ?? line?.endIndex ?? ((line?.startIndex ?? 0) + (line?.text.length ?? 0)));
        lineStart = line?.startIndex;
      }
      applyTextEditNavigationSelection(obj, proxy, selection, position, lineStart, e.shiftKey);
      scheduleRender(true, false);
      return;
    }

    // Navigate canvas rows and retain the requested column through short lines.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.isComposing) {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const layout = getTextLayout(obj);
      if (!layout.length) { scheduleRender(true, false); return; }
      const selection = textEditSelectionState(proxy);
      const isUp = e.key === 'ArrowUp';
      const refPos = e.shiftKey
        ? (selection.direction === 'backward' ? selection.start : selection.end)
        : (isUp ? selection.start : selection.end);
      const refLineIdx = textEditCaretLineAtIndex(obj, layout, refPos);
      const refLine = layout[refLineIdx];
      const caretX = obj._textEditPreferredX ?? lineCaretXAtOffset(refLine, obj,
        Math.max(0, Math.min(refPos - refLine.startIndex, refLine.text.length)));
      const targetIdx = isUp ? refLineIdx - 1 : refLineIdx + 1;
      let hit;
      if (targetIdx < 0) {
        hit = { index: 0, lineStartIndex: layout[0].startIndex };
      } else if (targetIdx >= layout.length) {
        hit = { index: textEditProxyValue(proxy).length, lineStartIndex: layout[layout.length - 1].startIndex };
      } else {
        hit = layoutHitTestCaret([layout[targetIdx]], caretX, layout[targetIdx].y, obj);
      }
      applyTextEditNavigationSelection(obj, proxy, selection, hit.index, hit.lineStartIndex, e.shiftKey);
      obj._textEditPreferredX = caretX;
      scheduleRender(true, false);
      return;
    }

    if (textEditNavigationKeys.has(e.key)) {
      flushEditHistoryCheckpoint();
      const selection = textEditSelectionState(proxy);
      // Native navigation must see the latest text even when a large edit left
      // the textarea value deferred; otherwise it can enter deleted positions.
      syncTextEditProxyDomValue(proxy, textEditProxyValue(proxy), selection);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        pendingNativeNavigation = { ...selection, key: e.key };
      }
    }
    if (wakeCaret) scheduleRender(true, false);
  });

  logStep('enter-listeners-ready');

  let _prevSelStart = -1, _prevSelEnd = -1;
  _selChangeListener = () => {
    if (document.activeElement !== proxy) return;
    let s = proxy.selectionStart, e = proxy.selectionEnd;
    const suppressed = _textInputSelectionHistorySuppress;
    if (typeof suppressed?.hasSelection === 'boolean' && suppressed.start === s && suppressed.end === e) {
      _textInputSelectionHistorySuppress = null;
      _prevSelStart = s; _prevSelEnd = e; _caretVisible = true;
      return;
    }
    const currentObj = objectsMap.get(id);
    if (s === _prevSelStart && e === _prevSelEnd && _caretVisible) return;
    _prevSelStart = s; _prevSelEnd = e;
    _textInputSelectionHistorySuppress = null;
    if (!suppressed || suppressed.start !== s || suppressed.end !== e) flushEditHistoryCheckpoint();
    TextSelDebug._logSelection('selectionchange', proxy);
    _caretVisible = true;
    if (currentObj) {
      const direction = proxy.selectionDirection || 'none';
      const navigation = currentObj._textEditNavigationSelection;
      const nativeNavigation = pendingNativeNavigation;
      if (nativeNavigation && (s !== nativeNavigation.start || e !== nativeNavigation.end ||
          direction !== nativeNavigation.direction)) {
        const index = direction === 'backward' ? s : e;
        const layout = getTextLayout(currentObj);
        const lineIndex = textEditCaretLineAtIndex(currentObj, layout, index,
          nativeNavigation.key === 'ArrowLeft' ? 'forward' : 'backward');
        rememberTextEditNavigationSelection(currentObj, proxy, index, layout[lineIndex]?.startIndex);
        pendingNativeNavigation = null;
      } else if (!navigation || navigation.start !== s || navigation.end !== e || navigation.direction !== direction) {
        if (s === e) setTextEditCaretIndex(currentObj, s);
        else clearTextEditCaretIndex(currentObj);
      }
    }
    scheduleRender(true, false);
  };
  document.addEventListener('selectionchange', _selChangeListener);
  proxy.addEventListener('keyup', (event) => {
    if (pendingNativeNavigation?.key !== event.key) return;
    // A browser may dispatch keyup before the queued selectionchange event.
    _selChangeListener();
    pendingNativeNavigation = null;
  });
  logStep('enter-selection-listener-ready');

  _caretVisible = true;
  _caretBlinkInterval = setInterval(() => {
    if (!editingId) return;
    const hasSelection = proxy.selectionStart !== proxy.selectionEnd;
    if (hasSelection) { _caretVisible = true; return; }
    _caretVisible = !_caretVisible;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, false, 'caret-blink');
    else scheduleRender(true, false);
  }, 500);

  if (placeInitialCaret) {
    proxy.focus({ preventScroll: true });
    proxy.setSelectionRange(proxy.value.length, proxy.value.length);
    setTextEditCaretIndex(obj, proxy.value.length);
    logStep('enter-focus-selection', {
      selectionStart: proxy.selectionStart,
      selectionEnd: proxy.selectionEnd,
    });
  } else {
    logStep('enter-focus-selection-skipped', {
      selectionStart: proxy.selectionStart,
      selectionEnd: proxy.selectionEnd,
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let historyMs = '';
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (history && typeof pushHistory === 'function') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const historyStart = textEditorDebugNow();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    pushHistory('text-edit-enter');
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    historyMs = Math.round((textEditorDebugNow() - historyStart) * 100) / 100;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    logStep('enter-history-pushed', { historyMs });
  }
  scheduleRender(true, true);
  logStep('enter-end', {
    historyMs,
    selectionStart: proxy.selectionStart,
    selectionEnd: proxy.selectionEnd,
  });
}

function exitEdit() {
  if (!editingId) return;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const exitStart = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const id = editingId;
  const proxy = _editEl;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const objAtStart = objectsMap.get(id);
  let stepStart = exitStart;
  const logStep = (label, obj = objAtStart, meta = {}) => {
    const t = textEditorDebugNow();
    textEditorDebugLog(label, obj, {
      phase: 'exit',
      ms: Math.round((t - stepStart) * 100) / 100,
      totalMs: Math.round((t - exitStart) * 100) / 100,
      ...meta,
    });
    stepStart = t;
  };
  textEditorDebugLog('exit-start', objAtStart, {
    phase: 'exit',
    ms: 0,
    totalMs: 0,
    proxyChars: textEditProxyValue(proxy).length,
    domProxyChars: typeof proxy?.value === 'string' ? proxy.value.length : '',
    domValueStale: !!proxy?._boardfishDomValueStale,
    selectionStart: proxy?.selectionStart ?? '',
    selectionEnd: proxy?.selectionEnd ?? '',
    activeElementIsProxy: typeof document !== 'undefined' ? document.activeElement === proxy : '',
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  editingId = null;
  _editEl = null;

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const timersStart = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  clearInterval(_caretBlinkInterval);
  _caretBlinkInterval = null;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let selectionListenerRemoved = false;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (_selChangeListener) {
    document.removeEventListener('selectionchange', _selChangeListener);
    _selChangeListener = null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    selectionListenerRemoved = true;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  logStep('exit-listeners-cleared', objAtStart, {
    timersMs: textEditorDebugRound(textEditorDebugNow() - timersStart),
    selectionListenerRemoved,
  });

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const proxyRemoveStart = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (proxy) proxy.remove();
  logStep('exit-proxy-removed', objAtStart, {
    proxyRemoved: !!proxy,
    proxyRemoveMs: textEditorDebugRound(textEditorDebugNow() - proxyRemoveStart),
    domProxyChars: typeof proxy?.value === 'string' ? proxy.value.length : '',
    domValueStale: !!proxy?._boardfishDomValueStale,
  });

  const obj = objectsMap.get(id);
  if (obj) {
    if (isTextContentEmpty(obj.data.content)) {
      BoardfishEditorState.removeObjectsById([id]);
      delete obj._editStartContent;
      delete obj._editMinLines;
      delete obj._textEditPendingSizeSync;
      clearTextEditCaretIndex(obj);
      _editHistoryLastContent = null;
      _editHistoryActionStartState = null;
      scheduleRender(true, true);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let historyMs = '';
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (typeof pushHistory === 'function') {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const historyStart = textEditorDebugNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        pushHistory('delete-empty-text');
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        historyMs = Math.round((textEditorDebugNow() - historyStart) * 100) / 100;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      logStep('exit-empty-delete-end', obj, {
        emptyDeleted: true,
        historyMs,
      });
      return;
    }
    const contentChanged = obj.data.content !== _editHistoryLastContent;
    const pendingSizeSync = !!obj._textEditPendingSizeSync;
    const startedEmpty = obj._editStartContent === '';
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const editMinLines = obj._editMinLines || 1;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const needsExitSizeSync = contentChanged || pendingSizeSync || startedEmpty;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const sizeSyncReason = contentChanged
      ? 'content-changed'
      : (pendingSizeSync ? 'pending-size-sync' : (startedEmpty ? 'started-empty' : 'unchanged'));
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    let widthChanged = false;
    let heightChanged = false;
    if (needsExitSizeSync) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const widthSyncStart = textEditorDebugNow();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      widthChanged = syncFreshTextEditWidth(obj);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const widthSyncMs = textEditorDebugRound(textEditorDebugNow() - widthSyncStart);
      const heightSyncStart = textEditorDebugNow();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      heightChanged = syncTextAutoHeight(obj);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const heightSyncMs = textEditorDebugRound(textEditorDebugNow() - heightSyncStart);
      let markDirtyMs = '';
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (widthChanged || heightChanged) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const markDirtyStart = textEditorDebugNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        markDirty(obj);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        markDirtyMs = textEditorDebugRound(textEditorDebugNow() - markDirtyStart);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      logStep('exit-size-sync', obj, {
        widthSyncMs,
        heightSyncMs,
        markDirtyMs,
        widthChanged,
        heightChanged,
        contentChanged,
        pendingSizeSync,
        needsExitSizeSync,
        sizeSyncReason,
        startedEmpty,
        editMinLines,
      });
    } else {
      logStep('exit-size-sync-skipped', obj, {
        widthChanged,
        heightChanged,
        contentChanged,
        pendingSizeSync,
        needsExitSizeSync,
        sizeSyncReason,
        startedEmpty,
        editMinLines,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const editHistoryStart = textEditorDebugNow();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    pushEditHistoryIfChanged(id);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const editHistoryMs = Math.round((textEditorDebugNow() - editHistoryStart) * 100) / 100;
    let heightHistoryMs = '';
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if ((widthChanged || heightChanged) && !contentChanged) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const heightHistoryStart = textEditorDebugNow();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      pushHistory('text-height-change');
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      heightHistoryMs = Math.round((textEditorDebugNow() - heightHistoryStart) * 100) / 100;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    delete obj._editStartContent;
    delete obj._editMinLines;
    delete obj._textEditPendingSizeSync;
    clearTextEditCaretIndex(obj);
    logStep('exit-history-cleanup', obj, {
      editHistoryMs,
      heightHistoryMs,
      contentChanged,
      widthChanged,
      heightChanged,
    });
  }

  _editHistoryLastContent = null;
  _editHistoryActionStartState = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const renderScheduleStart = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  scheduleRender(true, true);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const renderScheduleMs = textEditorDebugRound(textEditorDebugNow() - renderScheduleStart);
  const clearSelectionStart = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  window.getSelection()?.removeAllRanges();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const windowSelectionClearMs = textEditorDebugRound(textEditorDebugNow() - clearSelectionStart);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  logStep('exit-end', obj, {
    hadObject: !!obj,
    renderScheduleMs,
    windowSelectionClearMs,
  });
}
