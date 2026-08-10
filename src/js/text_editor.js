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

const textEditorTextStats = (value, scriptRanges = []) => {
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
    scriptRangeCount: Array.isArray(scriptRanges) ? scriptRanges.length : '',
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

const textEditorLayoutScriptKey = (obj) => {
  try {
    if (typeof getTextScriptRanges === 'function') {
      return JSON.stringify(getTextScriptRanges(obj));
    }
  } catch (_) {}
  return JSON.stringify(Array.isArray(obj?.data?.scriptRanges) ? obj.data.scriptRanges : []);
};

const textEditorLayoutAlignKey = (obj) => {
  try {
    if (typeof textLayoutAlignKey === 'function') return textLayoutAlignKey(obj);
  } catch (_) {}
  return '';
};

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
  const scriptKey = textEditorLayoutScriptKey(obj);
  const alignKey = textEditorLayoutAlignKey(obj);
  const lineH = Number(typeof LINE_H !== 'undefined' ? LINE_H : 24) || 24;
  const pad = Number(typeof TEXT_PAD !== 'undefined' ? TEXT_PAD : 16) || 16;
  const activeEditingId = typeof editingId !== 'undefined' ? editingId : '';
  const minLines = obj.id === activeEditingId ? (Math.max(1, Math.trunc(Number(obj._editMinLines)) || 1)) : 1;
  const logicalLines = Math.max(1, textNewlineCount(text) + 1);
  const layoutCacheValid = Array.isArray(obj._layoutCache) &&
    obj._layoutCacheContent === text &&
    obj._layoutCacheW === obj.w &&
    obj._layoutCacheScriptKey === scriptKey &&
    obj._layoutCacheAlignKey === alignKey;
  const wrappedCountValid = obj._textWrappedLineCountCacheContent === text &&
    obj._textWrappedLineCountCacheW === obj.w &&
    obj._textWrappedLineCountCacheScriptKey === scriptKey &&
    Number.isFinite(obj._textWrappedLineCountCacheValue);
  const wrappedIndex = obj._textWrappedLineIndexCache;
  const wrappedIndexValid = wrappedIndex &&
    Array.isArray(wrappedIndex.entries) &&
    obj._textWrappedLineIndexCacheContent === text &&
    obj._textWrappedLineIndexCacheW === obj.w &&
    obj._textWrappedLineIndexCacheScriptKey === scriptKey &&
    Number.isFinite(wrappedIndex.lineCount);
  const widthCache = obj._textWrappedLineIndexWidthCache;
  const widthCached = widthCache &&
    obj._textWrappedLineIndexWidthCacheContent === text &&
    obj._textWrappedLineIndexWidthCacheScriptKey === scriptKey &&
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
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function configureTextEditProxyElement(proxy) {
  if (!proxy) return;
  const setAttr = (name, value) => {
    if (typeof proxy.setAttribute === 'function') proxy.setAttribute(name, value);
    else proxy[name] = value;
  };
  proxy.id = 'editor-proxy';
  proxy.wrap = 'off';
  proxy.spellcheck = false;
  proxy.tabIndex = -1;
  setAttr('autocomplete', 'off');
  setAttr('autocorrect', 'off');
  setAttr('autocapitalize', 'off');
  setAttr('aria-label', 'Boardfish text editor');
  if (!proxy.style) proxy.style = {};
  proxy.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;overflow:hidden;white-space:pre;contain:strict;transform:translate(-100vw,-100vh)';
}

function textEditProxyValue(proxy) {
  if (typeof proxy?._boardfishLogicalValue === 'string') return proxy._boardfishLogicalValue;
  return String(proxy?.value ?? '');
}

function setTextEditProxyLogicalValue(proxy, value = '', { domSynced = true } = {}) {
  if (!proxy) return '';
  const text = String(value ?? '');
  proxy._boardfishLogicalValue = text;
  proxy._boardfishDomValueStale = !domSynced;
  return text;
}

function syncTextEditProxyDomValue(proxy, value = '', selection = null) {
  if (!proxy) {
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return false;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { synced: false, reason: 'missing-proxy' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  const text = String(value ?? '');
  if (!proxy._boardfishDomValueStale && String(proxy.value ?? '') === text) {
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return false;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { synced: false, reason: 'dom-current' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  proxy.value = text;
  setTextEditProxyLogicalValue(proxy, text, { domSynced: true });
  if (selection && typeof proxy.setSelectionRange === 'function') {
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

function setTextEditProxySelectionRange(proxy, start, end = start, direction = 'none', options = {}) {
  if (!proxy || typeof proxy.setSelectionRange !== 'function') {
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return false;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { set: false, synced: false, reason: 'missing-proxy' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  const text = options.value ?? textEditProxyValue(proxy);
  const max = text.length;
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, max));
  const to = Math.max(from, Math.min(Math.trunc(Number(end ?? start)) || from, max));
  const domValue = String(proxy.value ?? ''), domLength = domValue.length;
  const domStale = !!proxy._boardfishDomValueStale || domValue !== text;
  const shouldSyncDom = options.syncDom === true || (domStale && (from > domLength || to > domLength));
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
  const start = Math.max(0, Math.min(proxy?.selectionStart ?? 0, valueLength));
  const end = Math.max(0, Math.min(proxy?.selectionEnd ?? start, valueLength));
  return {
    start,
    end,
    direction: proxy?.selectionDirection || 'none',
    hasSelection: start !== end,
  };
};

const TEXT_EDIT_INDENT = '\t';

const textEditLineStartAt = (value, index) => {
  const text = String(value ?? '');
  const clamped = Math.max(0, Math.min(index ?? 0, text.length));
  if (clamped <= 0) return 0;
  const newlineAt = text.lastIndexOf('\n', clamped - 1);
  return newlineAt === -1 ? 0 : newlineAt + 1;
};

const textEditLineIndentAt = (value, index) => {
  const text = String(value ?? '');
  const lineStart = textEditLineStartAt(text, index);
  let end = lineStart;
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  return text.slice(lineStart, end);
};

const applyTextEditLineIndent = (value, selection, { outdent = false } = {}) => {
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
    if (selectionState.start >= firstLineStart) nextStart += TEXT_EDIT_INDENT.length;
    if (selectionState.end >= firstLineStart) nextEnd += TEXT_EDIT_INDENT.length;
    nextSelectedText = TEXT_EDIT_INDENT + selectedText.replace(/\n/g, (_, offset) => {
      const lineStart = firstLineStart + offset + 1;
      if (selectionState.start >= lineStart) nextStart += TEXT_EDIT_INDENT.length;
      if (selectionState.end >= lineStart) nextEnd += TEXT_EDIT_INDENT.length;
      return `\n${TEXT_EDIT_INDENT}`;
    });
  }
  if (nextSelectedText === selectedText) return { ...selectionState, value: text, changed: false };

  return {
    value: text.slice(0, firstLineStart) + nextSelectedText + text.slice(blockEnd),
    start: nextStart,
    end: nextEnd,
    direction: selectionState.direction,
    changed: true,
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
  const insert = '\n' + textEditLineIndentAt(text, start);
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
  const lowerType = String(inputType || inputState.inputType || '').toLowerCase();

  if (!selectedLength && lowerType.startsWith('delete')) {
    const removedLength = Math.max(0, oldText.length - nextText.length);
    if (removedLength > 0) {
      if (lowerType.includes('backward')) {
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
  const inputType = String(event?.inputType || '').toLowerCase();
  if (inputType === 'inserttext' || inputType === 'insertcompositiontext') {
    return { start, end, insertedText: String(event?.data ?? '') };
  }
  if (inputType === 'insertlinebreak' || inputType === 'insertparagraph') {
    return { start, end, insertedText: '\n' };
  }
  if (inputType.startsWith('delete')) {
    if (start !== end) return { start, end, insertedText: '' };
    const blankLineRange = textEditBlankLineDeleteRange(text, start, inputType);
    if (blankLineRange) return blankLineRange;
    if (inputType.includes('backward')) return { start: Math.max(0, start - 1), end: start, insertedText: '' };
    if (inputType.includes('forward')) return { start, end: Math.min(text.length, end + 1), insertedText: '' };
  }
  return null;
};

const textEditBlankLineDeleteRange = (text = '', index, keyOrInputType = '') => {
  if (!text.includes('\n')) return null;
  const pos = Math.max(0, Math.min(Math.trunc(Number(index)) || 0, text.length));
  const key = String(keyOrInputType || '').toLowerCase();
  if (!key.includes('delete') && !key.includes('backspace')) return null;
  const backward = key.includes('backspace') || key.includes('backward');
  const before = text.lastIndexOf('\n', Math.max(0, pos - 1));
  const start = before < 0 ? 0 : before + 1;
  const after = text.indexOf('\n', pos);
  const end = after < 0 ? text.length : after;
  if (!/^[ \t]*$/.test(text.slice(start, end))) return null;
  if (backward && pos > start) return null;
  if (backward && start > 0) return { start: start - 1, end, insertedText: '' };
  if (!backward && end < text.length) return { start, end: end + 1, insertedText: '' };
  if (start > 0) return { start: start - 1, end, insertedText: '' };
  if (end < text.length) return { start, end: end + 1, insertedText: '' };
  return null;
};

const trimmedTextSelectionForClipboard = (value) => {
  const text = normalizeTextContent(value);
  const lines = text.split('\n');
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && !/\S/.test(lines[first])) first++;
  while (last >= first && !/\S/.test(lines[last])) last--;
  if (first > last) return { text: '', start: 0, end: 0 };
  let start = 0;
  for (let i = 0; i < first; i++) start += lines[i].length + 1;
  let end = start;
  for (let i = first; i <= last; i++) {
    end += lines[i].length;
    if (i < last) end++;
  }
  return { text: text.slice(start, end), start, end };
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

const invalidateTextEditObjectLayout = (obj) => {
  if (!obj) return;
  clearTextObjectLayoutRuntime(obj);
};

const syncFreshTextEditWidth = (obj) => {
  if (!obj || obj.type !== 'text' || obj._editStartContent !== '') return false;
  const width = getTextRenderedContentWidth(obj);
  if (!Number.isFinite(width) || width <= obj.w) return false;
  obj.w = width;
  invalidateTextEditObjectLayout(obj);
  return true;
};

const exactTextEditLineCountForHeight = (height) => {
  const lines = (Number(height) - TEXT_PAD * 2) / LINE_H;
  if (!Number.isFinite(lines) || lines <= 0) return 0;
  const rounded = Math.round(lines);
  return Math.abs(lines - rounded) < 1e-6 ? Math.max(1, rounded) : 0;
};

const textEditMinLinesForSession = (obj, { preserveSize = false } = {}) => {
  if (!obj || obj.type !== 'text') return 1;
  const currentLines = exactTextEditLineCountForHeight(obj.h);
  if (preserveSize && currentLines > 1) return currentLines;
  return normalizeTextContent(obj._editStartContent ?? obj.data?.content ?? '') === ''
    ? NEW_TEXT_EDIT_MIN_LINES
    : 1;
};

const setTextEditMinLinesForSession = (obj, options = {}) => {
  if (!obj || obj.type !== 'text') return 1;
  const minLines = textEditMinLinesForSession(obj, options);
  obj._editMinLines = minLines;
  const normalMinLines = textEditMinLinesForSession(obj, { preserveSize: false });
  if (options.preserveSize && minLines > normalMinLines) {
    obj._textEditPreservedMinLines = minLines;
  } else {
    delete obj._textEditPreservedMinLines;
  }
  return minLines;
};

const resetTextEditPreservedMinLinesForInput = (obj) => {
  if (!obj || obj.type !== 'text' || !obj._textEditPreservedMinLines) return null;
  const previousMinLines = obj._editMinLines ?? '';
  const preservedMinLines = obj._textEditPreservedMinLines;
  const nextMinLines = textEditMinLinesForSession(obj, { preserveSize: false });
  obj._editMinLines = nextMinLines;
  delete obj._textEditPreservedMinLines;
  return {
    previousMinLines,
    preservedMinLines,
    nextMinLines,
  };
};

const shouldDeferTextEditAutoHeightForInput = (obj, options = {}) => {
  if (options.forceSync) return false;
  if (!obj || obj.type !== 'text') return false;
  if (String(obj._editStartContent ?? '') === '') return false;
  const contentLength = String(obj.data?.content || '').length;
  return contentLength >= TEXT_EDIT_DEFER_AUTO_HEIGHT_CHARS;
};

const syncTextEditAutoHeightForInput = (obj, minLines = 1, options = {}) => {
  if (shouldDeferTextEditAutoHeightForInput(obj, options)) {
    obj._textEditPendingSizeSync = true;
    return false;
  }
  delete obj._textEditPendingSizeSync;
  return syncTextAutoHeight(obj, minLines);
};

const setTextScriptCaretAffinity = (obj, index, affinity) => {
  if (!obj) return;
  obj._textScriptCaretIndex = index;
  obj._textScriptCaretAffinity = affinity;
  obj._textEditCaretIndex = index;
  delete obj._textEditCaretLineStartIndex;
};

const clearTextScriptCaretAffinity = (obj) => {
  if (!obj) return;
  delete obj._textScriptCaretIndex;
  delete obj._textScriptCaretAffinity;
};

const setTextEditCaretIndex = (obj, index, options = {}) => {
  if (!obj) return;
  const length = (obj.data?.content || '').length;
  const nextIndex = Math.max(0, Math.min(Math.trunc(index ?? 0), length));
  if (obj._textEditCaretIndex !== nextIndex || options.clearLineStartIndex === true) {
    delete obj._textEditCaretLineStartIndex;
  }
  obj._textEditCaretIndex = nextIndex;
  if (Number.isFinite(options.lineStartIndex)) {
    obj._textEditCaretLineStartIndex = Math.max(0, Math.min(Math.trunc(options.lineStartIndex), length));
  }
};

const clearTextEditCaretIndex = (obj) => {
  if (!obj) return;
  delete obj._textEditCaretIndex;
  delete obj._textEditCaretLineStartIndex;
};

const isBetterNestedTextEditScriptRange = (candidate, current) => (
  !current ||
  candidate.start > current.start ||
  (candidate.start === current.start && candidate.end < current.end)
);

const textEditScriptRanges = (obj) => obj ? getTextScriptRanges(obj) : [];

const setTextEditScriptRangesForContent = (obj, ranges = []) => {
  if (!obj || obj.type !== 'text') return;
  if (ranges.length) obj.data.scriptRanges = ranges;
  else delete obj.data.scriptRanges;
  obj._textScriptRangesCache = ranges;
  obj._textScriptRangesCacheContent = obj.data.content;
  obj._textScriptRangesCacheSourceKey = JSON.stringify(ranges);
};

const textEditScriptRangeContext = (ranges = []) => {
  if (!ranges.length) return null;
  const byMarker = new Map();
  const byStart = new Map();
  const byEnd = new Map();
  const byClose = new Map();
  const add = (map, key, range) => {
    if (!Number.isFinite(key)) return;
    const list = map.get(key);
    if (list) list.push(range);
    else map.set(key, [range]);
  };
  for (const range of ranges) {
    add(byMarker, Math.trunc(Number(range.start)) - 1, range);
    add(byStart, Math.trunc(Number(range.start)), range);
    add(byEnd, Math.trunc(Number(range.end)), range);
    add(byClose, Math.trunc(Number(range.end)) - 1, range);
  }
  return { byMarker, byStart, byEnd, byClose };
};

const textEditContextList = (context, key, index) => context?.[key]?.get(index) || [];

const isTextEditScriptHiddenAtFast = (index, text, context) => {
  if (!context) return false;
  if (textEditContextList(context, 'byMarker', index).length) return true;
  for (const range of textEditContextList(context, 'byStart', index)) {
    if (isTextScriptBracedRange(text, range)) return true;
  }
  for (const range of textEditContextList(context, 'byClose', index)) {
    if (isTextScriptBracedRange(text, range)) return true;
  }
  return false;
};

const textEditScriptRangesKey = (ranges) => JSON.stringify(Array.isArray(ranges) ? ranges : []);

const textEditScriptRangesEqual = (a = [], b = []) => {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const leftRange = left[i];
    const rightRange = right[i];
    if (leftRange?.start !== rightRange?.start || leftRange?.end !== rightRange?.end || leftRange?.kind !== rightRange?.kind) {
      return false;
    }
  }
  return true;
};

const textEditFlatArrayEqual = (a = [], b = []) => {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const textEditHasCurrentScriptRangeCache = (obj, content, sourceKey) => (
  Array.isArray(obj?._textScriptRangesCache) &&
  obj._textScriptRangesCacheContent === content &&
  obj._textScriptRangesCacheSourceKey === sourceKey
);

const textEditScriptRangesAreBraced = (content, ranges = []) => {
  const text = normalizeTextContent(content);
  if (!Array.isArray(ranges) || !ranges.length) return false;
  for (const range of ranges) {
    if (!isTextScriptBracedRange(text, range)) return false;
  }
  return true;
};

const normalizeTextObjectToEditableScriptBraces = (obj) => {
  if (!obj || obj.type !== 'text') return false;
  const current = normalizeTextContent(obj.data?.content || '');
  const sourceIsArray = Array.isArray(obj.data?.scriptRanges);
  let sourceRanges = sourceIsArray ? obj.data.scriptRanges : [];
  let sourceKey = textEditScriptRangesKey(sourceRanges);
  let sourceCacheCurrent = textEditHasCurrentScriptRangeCache(obj, current, sourceKey);
  if (sourceIsArray && !sourceCacheCurrent) {
    sourceRanges = normalizeTextScriptRangesForContent(current, sourceRanges);
    if (sourceRanges.length) obj.data.scriptRanges = sourceRanges;
    else delete obj.data.scriptRanges;
    sourceKey = textEditScriptRangesKey(sourceRanges);
    sourceCacheCurrent = textEditHasCurrentScriptRangeCache(obj, current, sourceKey);
  }
  if (!sourceRanges.length && !/[\^_]/.test(current)) return false;
  if (
    sourceRanges.length &&
    sourceCacheCurrent &&
    textEditScriptRangesAreBraced(current, sourceRanges)
  ) {
    return false;
  }
  const content = textScriptLinearToDeterministicBraces(current, sourceRanges);
  const derivedRanges = deriveBracedTextScriptRangesFromContent(content);
  const combinedRanges = new Array(sourceRanges.length + derivedRanges.length);
  for (let i = 0; i < sourceRanges.length; i++) combinedRanges[i] = sourceRanges[i];
  for (let i = 0; i < derivedRanges.length; i++) combinedRanges[sourceRanges.length + i] = derivedRanges[i];
  const scriptRanges = normalizeTextScriptRangesForContent(content, combinedRanges);
  if (content === current && textEditScriptRangesEqual(scriptRanges || [], obj.data?.scriptRanges || [])) return false;
  obj.data.content = content;
  if (scriptRanges?.length) obj.data.scriptRanges = scriptRanges;
  else delete obj.data.scriptRanges;
  invalidateTextEditObjectLayout(obj);
  return true;
};

const textEditScriptSnapshot = (obj) => {
  const text = obj?.data?.content || '';
  const ranges = textEditScriptRanges(obj);
  return { text, ranges, context: textEditScriptRangeContext(ranges) };
};

const normalizeTextEditVisibleCaretIndex = (obj, index, direction = 'forward', snapshot = null) => {
  const { text, context } = snapshot || textEditScriptSnapshot(obj);
  const hasBracedRangeStartingAt = (pos) => {
    for (const range of textEditContextList(context, 'byStart', pos)) {
      if (isTextScriptBracedRange(text, range)) return true;
    }
    return false;
  };
  let pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  const step = direction === 'backward' ? -1 : 1;
  let guard = text.length + 1;
  while (guard-- > 0 && hasBracedRangeStartingAt(pos)) {
    pos += step;
    if (pos < 0) return 0;
    if (pos > text.length) return text.length;
  }
  return pos;
};

const moveTextEditVisibleCaret = (obj, index, direction = 'forward', snapshot = null) => {
  const scriptSnapshot = snapshot || textEditScriptSnapshot(obj);
  const backward = direction === 'backward';
  const current = normalizeTextEditVisibleCaretIndex(obj, index, backward ? 'backward' : 'forward', scriptSnapshot);
  const stepped = current + (backward ? -1 : 1);
  return normalizeTextEditVisibleCaretIndex(obj, stepped, backward ? 'backward' : 'forward', scriptSnapshot);
};

const moveTextEditCaretScriptLayer = (obj, index, direction = 'forward', snapshot = null) => {
  const scriptSnapshot = snapshot || textEditScriptSnapshot(obj);
  const { text, ranges, context } = scriptSnapshot;
  const pos = normalizeTextEditVisibleCaretIndex(obj, index, direction, scriptSnapshot);
  const affinity = obj?._textScriptCaretIndex === pos ? obj._textScriptCaretAffinity : '';
  if (direction === 'forward') {
    let bracedClose = null;
    for (const range of ranges) {
      if (range.end - 1 !== pos || !isTextScriptBracedRange(text, range)) continue;
      if (isBetterNestedTextEditScriptRange(range, bracedClose)) bracedClose = range;
    }
    if (bracedClose) {
      return { index: bracedClose.end, affinity: 'after' };
    }
  }
  if (direction === 'backward') {
    let bracedEnd = null;
    for (const range of ranges) {
      if (range.end !== pos || !isTextScriptBracedRange(text, range)) continue;
      if (isBetterNestedTextEditScriptRange(range, bracedEnd)) bracedEnd = range;
    }
    if (bracedEnd && bracedEnd.end - 1 > bracedEnd.start) {
      return { index: bracedEnd.end - 1, affinity: 'after' };
    }
  }
  const endsScriptLayer = textEditContextList(context, 'byEnd', pos).length > 0;
  if (endsScriptLayer && direction === 'forward' && (affinity !== 'after' || pos >= text.length)) {
    return { index: pos, affinity: 'after' };
  }
  if (endsScriptLayer && direction === 'backward' && affinity === 'after') {
    return { index: pos, affinity: '' };
  }
  return null;
};

const textEditScriptRangeEndingAtContainsIndex = (ranges, index, end, context = null) => {
  const candidates = context ? textEditContextList(context, 'byEnd', end) : (ranges || []);
  for (const range of candidates) {
    if (!context && range.end !== end) continue;
    if (range.start <= index && index < range.end) return true;
  }
  return false;
};

const textEditScriptRangeVisibleBounds = (content, range) => {
  const text = String(content ?? '');
  if (isTextScriptBracedRange(text, range)) {
    return { start: range.start + 1, end: range.end - 1 };
  }
  return { start: range.start, end: range.end };
};

const textEditBaseChildScriptDeleteRange = (obj, baseIndex, content = null, ranges = null, context = null) => {
  if (!obj) return null;
  const text = content == null ? normalizeTextContent(obj.data?.content || '') : String(content ?? '');
  const scriptRanges = ranges || textEditScriptRanges(obj);
  const rangeContext = context || textEditScriptRangeContext(scriptRanges);
  const start = Math.max(0, Math.min(Math.trunc(baseIndex ?? 0), text.length));
  if (start >= text.length || isTextEditScriptHiddenAtFast(start, text, rangeContext)) return null;

  let end = start + 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (const range of textEditContextList(rangeContext, 'byMarker', end)) {
      const markerIndex = range.start - 1;
      if (markerIndex !== end) continue;
      if (textEditScriptRangeEndingAtContainsIndex(scriptRanges, start, markerIndex, rangeContext)) continue;
      if (!isTextEditScriptHiddenAtFast(markerIndex, text, rangeContext)) continue;
      if (range.end > end) {
        end = range.end;
        changed = true;
      }
    }
  }

  return end > start + 1 ? { start, end } : null;
};

const textEditScriptRootBaseIndexForRange = (ranges, range) => {
  let markerIndex = (range?.start ?? 0) - 1;
  if (markerIndex <= 0) return markerIndex - 1;
  let guard = (ranges || []).length + 1;
  while (guard-- > 0) {
    let previous = null;
    for (const item of ranges || []) {
      if (item.end !== markerIndex) continue;
      if (!previous || item.start < previous.start) previous = item;
    }
    if (!previous) break;
    markerIndex = previous.start - 1;
  }
  return markerIndex - 1;
};

const textEditCompoundScriptDeleteRangeBeforeCaret = (obj, index, content = null, ranges = null, context = null) => {
  if (!obj) return null;
  const text = content == null ? normalizeTextContent(obj.data?.content || '') : String(content ?? '');
  const scriptRanges = ranges || textEditScriptRanges(obj);
  const rangeContext = context || textEditScriptRangeContext(scriptRanges);
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  let best = null;
  for (const range of textEditContextList(rangeContext, 'byEnd', pos)) {
    if (range.end !== pos) continue;
    const baseIndex = textEditScriptRootBaseIndexForRange(scriptRanges, range);
    const candidate = textEditBaseChildScriptDeleteRange(obj, baseIndex, text, scriptRanges, rangeContext);
    if (!candidate || candidate.end !== pos) continue;
    if (!best || candidate.start < best.start || (candidate.start === best.start && candidate.end > best.end)) {
      best = candidate;
    }
  }
  return best;
};

const textEditVisibleSelectionDeleteRange = (obj, selection, content = null, ranges = null, context = null) => {
  if (!obj) return null;
  const text = content == null ? normalizeTextContent(obj.data?.content || '') : String(content ?? '');
  const scriptRanges = ranges || textEditScriptRanges(obj);
  const rangeContext = context || textEditScriptRangeContext(scriptRanges);
  let start = Math.max(0, Math.min(selection?.start ?? 0, text.length));
  let end = Math.max(start, Math.min(selection?.end ?? start, text.length));
  if (start === end) return null;

  let changed = true;
  while (changed) {
    changed = false;
    let expandedStart = true;
    while (expandedStart) {
      expandedStart = false;
      for (const range of scriptRanges || []) {
        const markerIndex = range.start - 1;
        const visibleBounds = textEditScriptRangeVisibleBounds(text, range);
        if (markerIndex < 0 || markerIndex >= start) continue;
        if (visibleBounds.start < start || visibleBounds.end > end) continue;
        if (!isTextEditScriptHiddenAtFast(markerIndex, text, rangeContext)) continue;
        start = markerIndex;
        end = Math.max(end, range.end);
        expandedStart = true;
        changed = true;
      }
    }

    for (let i = start; i < end; i++) {
      if (isTextEditScriptHiddenAtFast(i, text, rangeContext)) continue;
      const childRange = textEditBaseChildScriptDeleteRange(obj, i, text, scriptRanges, rangeContext);
      if (!childRange || childRange.start < start || childRange.start >= end || childRange.end <= end) continue;
      end = childRange.end;
      changed = true;
      break;
    }
  }

  return { start, end };
};

const textEditStructuralDeleteReplacement = (obj, deletion) => {
  const text = obj?.data?.content || '';
  const start = Math.max(0, Math.min(deletion?.start ?? 0, text.length));
  const end = Math.max(start, Math.min(deletion?.end ?? start, text.length));
  const fallback = { start, end, insertedText: '', insertedScriptRanges: [] };
  if (!obj || start === end) return fallback;
  const ranges = textEditScriptRanges(obj);
  let range = null;
  for (const candidate of ranges) {
    if (
      !isTextScriptBracedRange(text, candidate) ||
      start > candidate.start ||
      end <= candidate.start ||
      end > candidate.end - 1
    ) {
      continue;
    }
    if (isBetterNestedTextEditScriptRange(candidate, range)) range = candidate;
  }
  if (!range) return fallback;

  const insertedStart = end;
  const insertedEnd = range.end - 1;
  const insertedText = text.slice(insertedStart, insertedEnd);
  const insertedScriptRanges = [];
  for (const item of ranges) {
    if (item === range || item.start < insertedStart || item.end > insertedEnd) continue;
    insertedScriptRanges.push({
      start: item.start - insertedStart,
      end: item.end - insertedStart,
      kind: item.kind,
    });
  }

  return {
    start,
    end: range.end,
    insertedText,
    insertedScriptRanges,
  };
};

const normalizeTextEditSelectionForLayerReplacement = (obj, selection, content = null, ranges = null) => {
  if (!obj || !selection?.hasSelection) return selection;
  const text = content == null ? obj.data?.content || '' : String(content ?? '');
  const scriptRanges = ranges || textEditScriptRanges(obj);
  let start = Math.max(0, Math.min(selection.start ?? 0, text.length));
  const end = Math.max(start, Math.min(selection.end ?? start, text.length));
  for (const range of scriptRanges) {
    if (
      isTextScriptBracedRange(text, range) &&
      start === range.start &&
      end <= range.end - 1
    ) {
      start = Math.min(range.start + 1, end);
      break;
    }
  }
  return {
    ...selection,
    start,
    end,
    hasSelection: start !== end,
  };
};

const textEditVisibleSelectionReplacementRange = (obj, selection) => {
  const text = obj?.data?.content || '';
  const ranges = textEditScriptRanges(obj);
  const rangeContext = textEditScriptRangeContext(ranges);
  const replacementSelection = normalizeTextEditSelectionForLayerReplacement(obj, selection, text, ranges);
  if (!replacementSelection?.hasSelection) return replacementSelection;
  let replacementRange = textEditVisibleSelectionDeleteRange(obj, replacementSelection, text, ranges, rangeContext) || replacementSelection;
  const rawStart = Math.max(0, Math.min(selection?.start ?? 0, text.length));
  const rawEnd = Math.max(rawStart, Math.min(selection?.end ?? rawStart, text.length));
  let containingRange = null;
  for (const range of ranges) {
    if (
      !isTextScriptBracedRange(text, range) ||
      (rawStart !== range.start && rawStart !== range.start + 1) ||
      rawEnd > range.end - 1
    ) {
      continue;
    }
    if (!containingRange || range.end - range.start < containingRange.end - containingRange.start) {
      containingRange = range;
    }
  }
  if (containingRange) {
    replacementRange = {
      start: Math.max(replacementRange.start, containingRange.start + 1),
      end: Math.min(replacementRange.end, containingRange.end - 1),
    };
  }
  return replacementRange;
};

const textEditVisibleDeleteRange = (obj, index, key, snapshot = null) => {
  if (!obj || (key !== 'Backspace' && key !== 'Delete')) return null;
  const scriptSnapshot = snapshot || textEditScriptSnapshot(obj);
  const { text, ranges, context: rangeContext } = scriptSnapshot;
  if (!text.length) return null;
  const backward = key === 'Backspace';
  const caret = normalizeTextEditVisibleCaretIndex(obj, index, backward ? 'backward' : 'forward', scriptSnapshot);
  const blankLineRange = textEditBlankLineDeleteRange(text, caret, key);
  if (blankLineRange) {
    return {
      start: blankLineRange.start,
      end: blankLineRange.end,
    };
  }
  const affinity = obj?._textScriptCaretIndex === caret ? obj._textScriptCaretAffinity : '';
  if (affinity === 'after' && (backward || caret >= text.length)) {
    const previousCompound = textEditCompoundScriptDeleteRangeBeforeCaret(obj, caret, text, ranges, rangeContext);
    if (previousCompound) return previousCompound;
  }
  let target = backward ? caret - 1 : caret;
  const step = backward ? -1 : 1;
  while (target >= 0 && target < text.length && isTextEditScriptHiddenAtFast(target, text, rangeContext)) {
    target += step;
  }
  if (target < 0 || target >= text.length) return null;

  return textEditVisibleSelectionDeleteRange(obj, { start: target, end: target + 1 }, text, ranges, rangeContext);
};

const textEditScriptMarkerInsertionIndexAt = (obj, index) => {
  if (!obj) return null;
  const text = obj.data?.content || '';
  const ranges = textEditScriptRanges(obj);
  const rangeContext = textEditScriptRangeContext(ranges);
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  let currentRange = null;
  for (const range of ranges) {
    if (range.start !== pos && range.start - 1 !== pos) continue;
    currentRange = range;
    break;
  }
  if (!currentRange) return null;

  let insertIndex = currentRange.start - 1;
  if (!isTextEditScriptHiddenAtFast(insertIndex, text, rangeContext)) return null;
  let changed = true;
  while (changed) {
    changed = false;
    for (const range of ranges) {
      const markerIndex = range.start - 1;
      if (markerIndex < 0 || markerIndex >= insertIndex) continue;
      if (range.end !== insertIndex) continue;
      if (!isTextEditScriptHiddenAtFast(markerIndex, text, rangeContext)) continue;
      insertIndex = markerIndex;
      changed = true;
    }
  }
  return insertIndex;
};

const canAutoOpenTextScriptBraceAt = (content, index) => {
  const text = content || '';
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  if (pos <= 0) return false;
  const base = text[pos - 1];
  if (!base || isTextWordOrLineSeparator(base)) return false;
  if (textScriptKindForMarker(base)) return false;
  return base !== '{';
};

const textEditBracedScriptBoundaryInsertionAt = (obj, index) => {
  if (!obj) return null;
  const text = obj.data?.content || '';
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  const affinity = obj._textScriptCaretIndex === pos ? obj._textScriptCaretAffinity : '';
  if (affinity === 'after') return null;
  let range = null;
  for (const item of textEditScriptRanges(obj)) {
    if (item.end !== pos || !isTextScriptBracedRange(text, item)) continue;
    if (isBetterNestedTextEditScriptRange(item, range)) range = item;
  }
  if (!range || range.end - 1 <= range.start) return null;
  return { index: range.end - 1, affinity: 'after' };
};

const isTextScriptHiddenOpeningOrMarkerAt = (ranges, index, content = '', context = null) => {
  if (index < 0) return false;
  const rangeContext = context || textEditScriptRangeContext(ranges);
  if (textEditContextList(rangeContext, 'byMarker', index).length) return true;
  for (const range of textEditContextList(rangeContext, 'byStart', index)) {
    if (isTextScriptBracedRange(content, range)) return true;
  }
  return false;
};

const textScriptHiddenClosingBraceRangeAt = (ranges, index, content = '', context = null) => {
  if (index < 0 || content[index] !== '}') return null;
  const candidates = context ? textEditContextList(context, 'byClose', index) : (ranges || []);
  for (const range of candidates) {
    if (!isTextScriptBracedRange(content, range)) continue;
    if (range.end - 1 !== index) continue;
    return range;
  }
  return null;
};

const isTextScriptHiddenClosingBraceAt = (ranges, index, content = '', minMarkerIndex = 0, context = null) => {
  const range = textScriptHiddenClosingBraceRangeAt(ranges, index, content, context);
  return !!range && range.start - 1 >= minMarkerIndex;
};

const normalizeTextSelectionScriptHiddenBounds = (content, selection, ranges = []) => {
  const text = normalizeTextContent(content);
  const rangeContext = textEditScriptRangeContext(ranges);
  const rawStart = Math.max(0, Math.min(selection?.start ?? 0, text.length));
  const rawEnd = Math.max(rawStart, Math.min(selection?.end ?? rawStart, text.length));
  let start = rawStart;
  let end = rawEnd;
  while (
    start < end &&
    isTextEditScriptHiddenAtFast(start, text, rangeContext)
  ) {
    start++;
  }
  while (end > start && isTextScriptHiddenOpeningOrMarkerAt(ranges, end - 1, text, rangeContext)) {
    end--;
  }
  while (end > start) {
    const closingRange = textScriptHiddenClosingBraceRangeAt(ranges, end - 1, text, rangeContext);
    if (!closingRange || closingRange.start - 1 >= start) break;
    end--;
  }
  while (end < text.length && isTextScriptHiddenClosingBraceAt(ranges, end, text, start, rangeContext)) {
    end++;
  }
  return { start, end };
};

const textSelectionBracedRangeNeedsCompletion = (content, range, start, end) => {
  if (!isTextScriptBracedRange(content, range)) return false;
  if (end >= range.end) return false;
  const markerIndex = range.start - 1;
  if (markerIndex < start || range.start >= end) return false;
  return end > range.start + 1;
};

const completeTextSelectionBracedScriptRanges = (content, start, end, selectedText, rangeEntries = [], sourceRanges = []) => {
  let text = normalizeTextContent(selectedText);
  const missingClosings = [];
  for (const range of sourceRanges || []) {
    if (range.end <= start) continue;
    if (range.start >= end) break;
    if (textSelectionBracedRangeNeedsCompletion(content, range, start, end)) missingClosings.push(range);
  }
  missingClosings.sort((a, b) => b.start - a.start || a.end - b.end);

  for (const range of missingClosings) {
    const relativeStart = range.start - start;
    if (relativeStart < 0 || relativeStart >= text.length) continue;
    const closeIndex = text.length;
    text += '}';
    let entry = null;
    for (const item of rangeEntries) {
      if (item.sourceRange !== range) continue;
      entry = item;
      break;
    }
    if (entry) {
      entry.end = closeIndex + 1;
    } else {
      rangeEntries.push({
        start: relativeStart,
        end: closeIndex + 1,
        kind: range.kind,
        sourceRange: range,
      });
    }
  }

  return {
    text,
    scriptRanges: cloneTextScriptRanges(rangeEntries),
  };
};

const createTextSelectionClipboardPayload = (obj, selection) => {
  const content = normalizeTextContent(obj?.data?.content || '');
  const sourceRanges = textEditScriptRanges(obj);
  const { start: rawStart, end: rawEnd } = normalizeTextSelectionScriptHiddenBounds(content, selection, sourceRanges);
  const trimmed = trimmedTextSelectionForClipboard(content.slice(rawStart, rawEnd));
  const start = rawStart + trimmed.start;
  const end = rawStart + trimmed.end;
  const scriptRangeEntries = [];
  if (trimmed.text) {
    for (const range of sourceRanges) {
      if (range.end <= start) continue;
      if (range.start >= end) break;
      const rangeStart = Math.max(range.start, start);
      const rangeEnd = Math.min(range.end, end);
      if (rangeEnd > rangeStart) {
        scriptRangeEntries.push({
          start: rangeStart - start,
          end: rangeEnd - start,
          kind: range.kind,
          sourceRange: range,
        });
      }
    }
  }
  const completed = completeTextSelectionBracedScriptRanges(content, start, end, trimmed.text, scriptRangeEntries, sourceRanges);
  const normalizedScriptRanges = typeof normalizeTextScriptRangesForContent === 'function'
    ? normalizeTextScriptRangesForContent(completed.text, completed.scriptRanges)
    : completed.scriptRanges;
  const clipboardText = typeof textScriptLinearToDeterministicBraces === 'function'
    ? textScriptLinearToDeterministicBraces(completed.text, normalizedScriptRanges, { normalized: true })
    : typeof textContentWithCanonicalScriptBraces === 'function'
      ? textContentWithCanonicalScriptBraces(completed.text, normalizedScriptRanges, { normalized: true })
    : completed.text;
  const clipboardScriptRanges = typeof deriveBracedTextScriptRangesFromContent === 'function' &&
    typeof normalizeTextScriptRangesForContent === 'function'
    ? normalizeTextScriptRangesForContent(clipboardText, deriveBracedTextScriptRangesFromContent(clipboardText))
    : normalizedScriptRanges;
  return {
    type: 'text-selection',
    text: clipboardText,
    scriptRanges: clipboardScriptRanges,
  };
};

const textSelectionPayloadFromBoardfishClipboardValue = (clipboard) => {
  if (!clipboard) return null;
  if (clipboard.type === 'text-selection') {
    const text = normalizeTextContent(clipboard.text || '');
    const scriptRanges = typeof normalizeTextScriptRangesForContent === 'function'
      ? normalizeTextScriptRangesForContent(text, clipboard.scriptRanges || [])
      : cloneTextScriptRanges(clipboard.scriptRanges || []);
    return { type: 'text-selection', text, scriptRanges };
  }
  if (clipboard.type === 'objects') {
    const objects = clipboard.objects || [];
    if (objects.length !== 1 || objects[0]?.type !== 'text') return null;
    const source = objects[0];
    const content = normalizeTextContent(source.data?.content || '');
    return createTextSelectionClipboardPayload(source, {
      start: 0,
      end: content.length,
      direction: 'none',
    });
  }
  return null;
};

const currentBoardfishTextSelectionClipboardPayload = () => (
  textSelectionPayloadFromBoardfishClipboardValue(typeof jsClipboard !== 'undefined' ? jsClipboard : null)
);

const isTextScriptRangeActiveAt = (range, index, affinity) => {
  if (!range || index < range.start || index > range.end) return false;
  if (index === range.end && affinity === 'after') return false;
  return true;
};

const textScriptRangesEqual = textEditScriptRangesEqual;

const compareTextScriptRangesForEdit = (a, b) => {
  if (a.start !== b.start) return a.start - b.start;
  if (a.end !== b.end) return a.end - b.end;
  const aKind = String(a.kind);
  const bKind = String(b.kind);
  if (aKind < bKind) return -1;
  if (aKind > bKind) return 1;
  return 0;
};

const isFiniteTextScriptRangeForEdit = (range) => (
  range &&
  Number.isFinite(range.start) &&
  Number.isFinite(range.end) &&
  range.end >= range.start
);

const areTextScriptRangesSortedUniqueForEdit = (ranges = []) => {
  let previous = null;
  for (const range of Array.isArray(ranges) ? ranges : []) {
    if (!isFiniteTextScriptRangeForEdit(range)) return false;
    if (previous && compareTextScriptRangesForEdit(previous, range) >= 0) return false;
    previous = range;
  }
  return true;
};

const sortAndDedupeTextScriptRanges = (ranges = []) => {
  const source = Array.isArray(ranges) ? ranges : [];
  if (areTextScriptRangesSortedUniqueForEdit(source)) return source;
  const sorted = [];
  for (const range of source) {
    if (isFiniteTextScriptRangeForEdit(range)) {
      sorted.push({ start: range.start, end: range.end, kind: range.kind });
    }
  }
  sorted.sort(compareTextScriptRangesForEdit);
  const out = [];
  for (const range of sorted) {
    const previous = out[out.length - 1];
    if (previous && previous.start === range.start && previous.end === range.end && previous.kind === range.kind) continue;
    out.push(range);
  }
  return out;
};

const findTransformedActiveTextScriptRange = (ranges, expandedScript) => {
  if (!expandedScript) return null;
  for (const range of ranges || []) {
    if (range.start === expandedScript.start && range.kind === expandedScript.kind) return range;
  }
  return null;
};

const plainEditScriptNormalizeSkipInfo = (oldRanges = [], {
  editStart = 0,
  editEnd = editStart,
  pureInsertion = false,
  caretAffinity = '',
} = {}) => {
  for (let i = 0; i < (oldRanges || []).length; i++) {
    const range = oldRanges[i];
    const markerIndex = Math.max(0, Math.trunc(Number(range?.start)) - 1);
    const rangeEnd = Math.max(markerIndex, Math.trunc(Number(range?.end)));
    if (editEnd <= markerIndex || editStart > rangeEnd) continue;
    if (editStart === rangeEnd) {
      if (!pureInsertion || !isTextScriptRangeActiveAt(range, editStart, caretAffinity)) continue;
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') return { ok: false };
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      return {
        ok: false,
        reason: 'active-at-script-end',
        rangeIndex: i,
        markerIndex,
        rangeStart: range.start,
        rangeEnd: range.end,
        rangeKind: range.kind,
      };
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return { ok: false };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return {
      ok: false,
      reason: 'overlaps-script-range',
      rangeIndex: i,
      markerIndex,
      rangeStart: range.start,
      rangeEnd: range.end,
      rangeKind: range.kind,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') return { ok: true };
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return { ok: true, reason: '' };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

const fastNormalizeTextScriptRangesAfterPlainDelete = (content, scriptRanges = []) => {
  const text = normalizeTextContent(content);
  const normalized = [];
  const seen = new Set();
  for (const source of Array.isArray(scriptRanges) ? scriptRanges : []) {
    const kind = normalizeTextScriptKind(source?.kind);
    if (!kind) continue;
    const rawStart = Math.trunc(Number(source?.start));
    const rawEnd = Math.trunc(Number(source?.end));
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const start = Math.max(0, Math.min(rawStart, text.length));
    const end = Math.max(start, Math.min(rawEnd, text.length));
    if (end <= start) continue;
    const markerIndex = start - 1;
    if (markerIndex < 0 || text[markerIndex] !== textScriptMarkerForKind(kind)) continue;
    if (!canOpenTextScriptAt(text, markerIndex)) continue;
    if (text[start] === '{') {
      if (end <= start + 2 || text[end - 1] !== '}') continue;
      const newlineAt = text.indexOf('\n', start);
      if (newlineAt !== -1 && newlineAt < end) continue;
    } else {
      let valid = true;
      for (let i = start; i < end; i++) {
        if (isTextWordOrLineSeparator(text[i])) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
    }
    const key = `${start}:${end}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ start, end, kind });
  }
  normalized.sort((a, b) => a.start - b.start || a.end - b.end || String(a.kind).localeCompare(String(b.kind)));
  return normalized;
};

const shiftTextScriptRangesForPlainOutsideEdit = (oldRanges = [], {
  editStart = 0,
  editEnd = editStart,
  delta = 0,
} = {}) => {
  const ranges = [];
  for (const range of Array.isArray(oldRanges) ? oldRanges : []) {
    const start = Math.trunc(Number(range?.start));
    const end = Math.trunc(Number(range?.end));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const nextRange = { start, end, kind: range.kind };
    if (end <= editStart) {
      // unchanged
    } else if (start >= editEnd) {
      nextRange.start += delta;
      nextRange.end += delta;
    }
    ranges.push(nextRange);
  }
  return ranges;
};

const deriveBracedTextScriptRangesAroundEdit = (content, start, end) => {
  const text = normalizeTextContent(content);
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, text.length));
  const to = Math.max(from, Math.min(Math.trunc(Number(end)) || from, text.length));
  const previousNewline = text.lastIndexOf('\n', Math.max(0, from - 1));
  const scanStart = previousNewline === -1 ? 0 : previousNewline + 1;
  const nextNewline = text.indexOf('\n', to);
  const scanEnd = nextNewline === -1 ? text.length : nextNewline;
  const slice = text.slice(scanStart, scanEnd);
  const ranges = [];
  for (const range of deriveBracedTextScriptRangesFromContent(slice)) {
    const normalized = {
      start: scanStart + range.start,
      end: scanStart + range.end,
      kind: range.kind,
    };
    const markerIndex = Math.max(0, normalized.start - 1);
    if (normalized.end > from && markerIndex <= to) ranges.push(normalized);
  }
  return ranges;
};

const textScriptActiveRangesAtIndex = (ranges, index, options = {}) => (
  cloneTextScriptRanges(activeTextScriptRangesAt(ranges, index, options))
);

const textScriptCaretRangesForEditState = (scriptRanges, index, affinity = '') => (
  textScriptActiveRangesAtIndex(scriptRanges || [], index, { includeEnd: true, affinity })
);

const textScriptRangeEndingAt = (ranges, index) => {
  let best = null;
  for (const range of ranges || []) {
    if (range.end === index && isBetterNestedTextEditScriptRange(range, best)) best = range;
  }
  return best;
};

const setTextScriptCaretAffinityForRanges = (obj, index, desiredRanges = []) => {
  const ranges = textEditScriptRanges(obj);
  const defaultRanges = textScriptActiveRangesAtIndex(ranges, index, { includeEnd: true });
  if (textScriptRangesEqual(defaultRanges, desiredRanges)) {
    clearTextScriptCaretAffinity(obj);
    return;
  }
  const afterRanges = textScriptActiveRangesAtIndex(ranges, index, { includeEnd: true, affinity: 'after' });
  if (textScriptRangesEqual(afterRanges, desiredRanges)) {
    setTextScriptCaretAffinity(obj, index, 'after');
    return;
  }
  setTextScriptCaretAffinity(obj, index, 'inside');
};

const exitTextScriptForLineBreak = (obj, proxy) => {
  if (!obj || !proxy || proxy.selectionStart !== proxy.selectionEnd) return false;
  const pos = proxy.selectionStart;
  const affinity = obj._textScriptCaretIndex === pos ? obj._textScriptCaretAffinity : '';
  let nextPos = -Infinity;
  for (const range of textEditScriptRanges(obj)) {
    if (isTextScriptRangeActiveAt(range, pos, affinity) && range.end > nextPos) nextPos = range.end;
  }
  if (!Number.isFinite(nextPos)) return false;
  if (proxy.selectionStart !== nextPos || proxy.selectionEnd !== nextPos) {
    proxy.setSelectionRange(nextPos, nextPos, 'none');
  }
  setTextScriptCaretAffinity(obj, nextPos, 'after');
  return true;
};

const textScriptCaretAffinityForInput = (obj, proxy, selection) => {
  const start = selection?.start ?? proxy?.selectionStart ?? 0;
  return obj?._textScriptCaretIndex === start ? obj._textScriptCaretAffinity : '';
};

const transformTextScriptRangesForInput = (oldRanges, {
  oldValue = '',
  newValue = '',
  start = 0,
  end = start,
  insertedText = '',
  insertedScriptRanges = [],
  caretAffinity = '',
} = {}) => {
  const oldText = String(oldValue ?? '');
  const nextText = String(newValue ?? '');
  const editStart = Math.max(0, Math.min(start, oldText.length));
  const editEnd = Math.max(editStart, Math.min(end, oldText.length));
  const inserted = String(insertedText ?? '');
  const insertedLength = inserted.length;
  const removedLength = editEnd - editStart;
  const delta = insertedLength - removedLength;
  const pureInsertion = removedLength === 0 && insertedLength > 0;
  const hasInsertedScriptRanges = Array.isArray(insertedScriptRanges) && insertedScriptRanges.length > 0;
  const insertedMayCreateScriptRange = insertedLength > 0 && !hasInsertedScriptRanges && /[\^_{}]/.test(inserted);
  const localDerivedRanges = insertedMayCreateScriptRange
    ? deriveBracedTextScriptRangesAroundEdit(nextText, editStart, editStart + insertedLength)
    : [];
  let expandedScript = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const transformDebug = {
    insertedMayCreateScriptRange,
    localDerivedRangeCount: localDerivedRanges.length,
    skipReason: '',
    skipRangeIndex: '',
    skipRangeStart: '',
    skipRangeEnd: '',
    skipMarkerIndex: '',
    skipRangeKind: '',
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  const plainSkipInfo = !hasInsertedScriptRanges
    ? plainEditScriptNormalizeSkipInfo(oldRanges, {
      editStart,
      editEnd,
      pureInsertion,
      caretAffinity,
    })
    : { ok: false };
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (hasInsertedScriptRanges) plainSkipInfo.reason = 'inserted-script-ranges';
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!hasInsertedScriptRanges && plainSkipInfo.ok) {
    const ranges = shiftTextScriptRangesForPlainOutsideEdit(oldRanges, { editStart, editEnd, delta });
    if (localDerivedRanges.length) {
      for (const range of localDerivedRanges) ranges.push({ ...range });
    }
    const normalized = sortAndDedupeTextScriptRanges(ranges);
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return { ranges: normalized, active: null };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return {
      ranges: normalized,
      active: null,
      fastPath: insertedMayCreateScriptRange ? 'plain-local-script-ranges' : 'plain-outside-script-ranges',
      ...transformDebug,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  Object.assign(transformDebug, {
    skipReason: plainSkipInfo.reason || '',
    skipRangeIndex: plainSkipInfo.rangeIndex ?? '',
    skipRangeStart: plainSkipInfo.rangeStart ?? '',
    skipRangeEnd: plainSkipInfo.rangeEnd ?? '',
    skipMarkerIndex: plainSkipInfo.markerIndex ?? '',
    skipRangeKind: plainSkipInfo.rangeKind || '',
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  const ranges = [];
  for (const range of oldRanges || []) {
    if (
      !pureInsertion &&
      insertedLength > 0 &&
      isTextScriptBracedRange(oldText, range) &&
      editStart === range.start &&
      editEnd === range.end &&
      inserted === oldText.slice(range.start + 1, range.end - 1)
    ) {
      ranges.push({
        start: range.start,
        end: range.start + insertedLength,
        kind: range.kind,
      });
      continue;
    }
    if (
      !pureInsertion &&
      isTextScriptBracedRange(oldText, range) &&
      (
        (editStart <= range.start - 1 && editEnd > range.start - 1) ||
        (editStart <= range.start && editEnd > range.start) ||
        (editStart <= range.end - 1 && editEnd > range.end - 1)
      )
    ) {
      continue;
    }
    let nextRange = { ...range };
    if (pureInsertion) {
      const active = isTextScriptRangeActiveAt(range, editStart, caretAffinity);
      if (editStart < range.start) {
        nextRange.start += insertedLength;
        nextRange.end += insertedLength;
      } else if (editStart > range.end) {
        // unchanged
      } else if (editStart === range.end) {
        if (active) {
          nextRange.end += insertedLength;
          expandedScript = nextRange;
        }
      } else {
        nextRange.end += insertedLength;
        expandedScript = nextRange;
      }
    } else {
      if (range.end <= editStart) {
        // unchanged
      } else if (range.start >= editEnd) {
        nextRange.start += delta;
        nextRange.end += delta;
      } else {
        const replacementEnd = editStart + insertedLength;
        if (editStart <= range.start) nextRange.start = replacementEnd;
        if (editEnd < range.end) nextRange.end = range.end + delta;
        else nextRange.end = replacementEnd;
        if (nextRange.end < nextRange.start) nextRange.end = nextRange.start;
      }
    }
    ranges.push(nextRange);
  }

  const normalizedInsertedRanges = insertedLength > 0 && hasInsertedScriptRanges
    ? normalizeTextScriptRangesForContent(inserted, insertedScriptRanges || [])
    : [];
  for (const range of normalizedInsertedRanges) {
    ranges.push({
      start: editStart + range.start,
      end: editStart + range.end,
      kind: range.kind,
    });
  }
  if (!hasInsertedScriptRanges && localDerivedRanges.length) {
    for (const range of localDerivedRanges) ranges.push({ ...range });
  }

  if (pureInsertion && hasInsertedScriptRanges) {
    const normalized = sortAndDedupeTextScriptRanges(ranges);
    const active = findTransformedActiveTextScriptRange(normalized, expandedScript);
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return { ranges: normalized, active };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return {
      ranges: normalized,
      active,
      fastPath: 'inserted-script-ranges',
      ...transformDebug,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }

  if (!pureInsertion && insertedLength === 0 && !hasInsertedScriptRanges) {
    const normalized = fastNormalizeTextScriptRangesAfterPlainDelete(nextText, ranges);
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') return { ranges: normalized, active: null };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return {
      ranges: normalized,
      active: null,
      fastPath: 'plain-delete-script-ranges',
      ...transformDebug,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }

  const wholeTextDerivedRanges = insertedMayCreateScriptRange && !hasInsertedScriptRanges
    ? deriveBracedTextScriptRangesFromContent(nextText)
    : [];
  const combinedRanges = new Array(ranges.length + wholeTextDerivedRanges.length);
  for (let i = 0; i < ranges.length; i++) combinedRanges[i] = ranges[i];
  for (let i = 0; i < wholeTextDerivedRanges.length; i++) combinedRanges[ranges.length + i] = wholeTextDerivedRanges[i];
  const normalized = normalizeTextScriptRangesForContent(nextText, combinedRanges);
  const active = findTransformedActiveTextScriptRange(normalized, expandedScript);
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') return { ranges: normalized, active };
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  return { ranges: normalized, active, fastPath: '', ...transformDebug };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
};

const textEditInputTypeDeletesContent = (inputType = '') => String(inputType || '').toLowerCase().startsWith('delete');

const textScriptCaretRangesAfterInput = (inputState = {}, {
  oldValue = '',
  newValue = '',
  replacement = null,
  inputType = '',
} = {}) => {
  const type = inputType || inputState.inputType || '';
  const start = inputState.start ?? 0;
  const end = inputState.end ?? start;
  if (!textEditInputTypeDeletesContent(type) || inputState.hasSelection || start !== end) return null;
  const caretRanges = Array.isArray(inputState.scriptCaretRanges)
    ? cloneTextScriptRanges(inputState.scriptCaretRanges)
    : textScriptCaretRangesForEditState(inputState.scriptRanges || [], start, inputState.scriptCaretAffinity || '');
  if (!caretRanges.length) return [];
  const edit = replacement || textEditInputReplacement(oldValue, newValue, inputState, type);
  const transformed = transformTextScriptRangesForInput(caretRanges, {
    oldValue,
    newValue,
    start: edit.start,
    end: edit.end,
    insertedText: edit.insertedText,
    caretAffinity: inputState.scriptCaretAffinity || '',
  });
  return Array.isArray(transformed?.ranges) ? transformed.ranges : [];
};

const updateTextLineAlignForInput = (obj, oldValue, oldStart, oldEnd, nextValue, insertedText) => {
  if (!obj) return;
  if (!Array.isArray(obj.data?.lineAlign)) return;
  oldStart = Math.max(0, Math.min(oldStart ?? 0, oldValue.length));
  oldEnd = Math.max(oldStart, Math.min(oldEnd ?? oldStart, oldValue.length));
  const removedLineCount = textNewlineCount(oldValue, oldStart, oldEnd);
  const insertedLineCount = textNewlineCount(insertedText);
  if (!removedLineCount && !insertedLineCount) return;
  const oldAlign = normalizeTextLineAlignForContent(oldValue, obj.data.lineAlign);
  const lineIndex = textNewlineCount(oldValue, 0, oldStart);
  const baseAlign = oldAlign[lineIndex] || 'left';
  const spliceStart = lineIndex + 1;
  const suffixStart = Math.min(spliceStart + removedLineCount, oldAlign.length);
  const nextAlign = new Array(spliceStart + insertedLineCount + oldAlign.length - suffixStart);
  for (let i = 0; i < spliceStart; i++) nextAlign[i] = oldAlign[i];
  for (let i = 0; i < insertedLineCount; i++) nextAlign[spliceStart + i] = baseAlign;
  for (let i = suffixStart; i < oldAlign.length; i++) nextAlign[spliceStart + insertedLineCount + i - suffixStart] = oldAlign[i];
  const normalized = normalizeTextLineAlignForContent(nextValue, nextAlign);
  if (normalized.length) obj.data.lineAlign = normalized;
  else delete obj.data.lineAlign;
};

const applyTextEditAlignmentFromKeyboard = (direction = 'right', id = editingId, proxy = _editEl) => {
  if (!id || !proxy) return false;
  if (typeof isBoardInputBlocked === 'function' && isBoardInputBlocked()) return false;
  if (
    typeof applyTextLineAlignmentRange !== 'function' ||
    typeof textLogicalLineRangeForSelection !== 'function'
  ) {
    return false;
  }
  const obj = objectsMap.get(id);
  if (!obj || obj.type !== 'text') return false;
  if (typeof flushEditHistoryCheckpoint === 'function') flushEditHistoryCheckpoint();
  if (!obj.data) obj.data = {};
  const content = textEditProxyValue(proxy);
  if (obj.data.content !== content) obj.data.content = content;
  const selection = textEditSelectionState(proxy);
  const range = textLogicalLineRangeForSelection(content, selection);
  if (typeof _caretVisible !== 'undefined') _caretVisible = true;
  const changed = applyTextLineAlignmentRange(obj, range.startLine, range.endLine, direction);
  if (!changed) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, false, 'text-align');
    else scheduleRender(true, false);
    return true;
  }
  markDirty(id);
  if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, 'text-align');
  else scheduleRender(true, true);
  pushHistory('text-align');
  return true;
};

const copyTextEditSelectionFromProxy = async (id, proxy, selection = textEditSelectionState(proxy)) => {
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
  const sourceObj = obj ? { ...obj, data: { ...obj.data, content: sourceValue } } : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('copy:text-selection-payload-start', {
    sourceFound: !!sourceObj,
    ...textEditorSelectionDebugStats(selection, sourceValue),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const payload = sourceObj
    ? createTextSelectionClipboardPayload(sourceObj, selection)
    : { type: 'text-selection', text: textSelectionForClipboard(sourceValue.slice(selection.start, selection.end)), scriptRanges: [] };
  const clipboardText = payload.text;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const textStats = textEditorTextStats(clipboardText, payload.scriptRanges);
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
      scriptRanges: payload.scriptRanges || [],
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
  if (editingId === id && _editEl === proxy) {
    globalThis.BoardfishMotion?.applyCopyFeedback?.({
      textSelection: {
        id,
        ...selection,
      },
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logStep('copy:text-selection-feedback-done', textStats);
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
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const clipboardOptions = { ...meta, ...textStats };
    writePromise = BoardfishClipboardIO.copyTextToClipboard(clipboardText, dbg, clipboardOptions);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else {
    writePromise = BoardfishClipboardIO.copyTextToClipboard(clipboardText, meta);
  }
  writePromise
    .then((result) => {
      if (result?.boardfishTokenWritten && meta.boardfishToken) {
        if (typeof markJsClipboardWebTokenWritten === 'function') {
          if (typeof BOARDFISH_PRODUCTION === 'undefined') {
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            markJsClipboardWebTokenWritten(meta.boardfishToken, dbg);
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
          } else {
            markJsClipboardWebTokenWritten(meta.boardfishToken);
          }
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
  textEditorClipStep(dbg, 'paste:text-selection-js-payload-candidate', textEditorTextStats(payload.text, payload.scriptRanges));
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

const setPendingTextEditInputState = (proxy, state) => {
  if (!proxy) return;
  if (typeof proxy._boardfishSetPendingInputState === 'function') {
    proxy._boardfishSetPendingInputState(state);
  } else {
    proxy._boardfishPendingInputState = state;
  }
};

const isTextEditProxyDomStale = (proxy, logicalValue = null) => {
  if (!proxy) return false;
  const value = logicalValue == null ? textEditProxyValue(proxy) : normalizeTextContent(logicalValue);
  return !!proxy._boardfishDomValueStale || String(proxy.value ?? '') !== value;
};

const replaceTextEditProxyRange = (proxy, text, start, end, selectionMode = 'end', options = {}) => {
  const value = textEditProxyValue(proxy);
  const from = Math.max(0, Math.min(Math.trunc(Number(start)) || 0, value.length));
  const to = Math.max(from, Math.min(Math.trunc(Number(end)) || from, value.length));
  const inserted = normalizeTextContent(text);
  const nextLength = value.length + inserted.length - (to - from);
  const largeValue = value.length + inserted.length > TEXT_EDIT_DIRECT_TEXTAREA_REPLACE_CHARS;
  const deferDomValue = options.deferDomValue === true && nextLength > TEXT_EDIT_DEFER_DOM_REPLACE_CHARS;
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
      setTextEditProxyLogicalValue(proxy, nextValue, { domSynced: false });
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
    setTextEditProxyLogicalValue(proxy, nextValue, { domSynced: true });
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
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
    syncTextEditProxyDomValue(proxy, value);
  } else {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    var domSyncResult = syncTextEditProxyDomValue(proxy, value);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  proxy.setRangeText(inserted, from, to, selectionMode);
  setTextEditProxyLogicalValue(proxy, proxy.value, { domSynced: true });
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

const textForTextEditPaste = (value) => (
  typeof textForTextObjectPaste === 'function'
    ? textForTextObjectPaste(value)
    : normalizeTextContent(value)
);

const editableTextScriptPayload = (payload = {}) => {
  const brace = typeof textScriptLinearToDeterministicBraces === 'function'
    ? textScriptLinearToDeterministicBraces
    : (typeof textContentWithCanonicalScriptBraces === 'function' ? textContentWithCanonicalScriptBraces : null);
  const text = textForTextEditPaste(
    typeof brace === 'function'
      ? brace(payload.text || '', payload.scriptRanges || [])
      : (payload.text || '')
  );
  const derivedRanges = typeof deriveBracedTextScriptRangesFromContent === 'function'
    ? deriveBracedTextScriptRangesFromContent(text)
    : [];
  const scriptRanges = typeof normalizeTextScriptRangesForContent === 'function'
    ? normalizeTextScriptRangesForContent(text, derivedRanges)
    : [];
  return { text, scriptRanges };
};

const synchronousBoardfishClipboardTokenFromPasteEvent = (event) => {
  if (
    !event?.clipboardData ||
    typeof BoardfishClipboardIO === 'undefined' ||
    typeof BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent !== 'function'
  ) {
    return '';
  }
  return BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(event.clipboardData);
};

const boardfishPasteEventMatchesCurrentTextSelectionClipboard = (event) => {
  const eventToken = synchronousBoardfishClipboardTokenFromPasteEvent(event);
  const currentToken = typeof getJsClipboardWebToken === 'function' ? getJsClipboardWebToken() : '';
  return !!eventToken && !!currentToken && eventToken === currentToken;
};

const tryNativeBoardfishTextSelectionPaste = (id, proxy, payload, options = {}) => {
  if (!proxy || !payload || !options.event) return false;
  const obj = objectsMap.get(id);
  if (!obj) return false;
  const selection = options.selection || textEditSelectionState(proxy);
  if (selection.hasSelection) return false;
  if (textEditBracedScriptBoundaryInsertionAt(obj, selection.start)) return false;
  if (!boardfishPasteEventMatchesCurrentTextSelectionClipboard(options.event)) return false;

  const fallbackText = normalizeTextContent(options.fallbackText || '');
  const editablePayload = editableTextScriptPayload(payload);
  if (!editablePayload.text || fallbackText !== editablePayload.text) return false;

  const inputType = options.inputType || 'insertFromPaste';
  const currentProxyValue = textEditProxyValue(proxy);
  if (isTextEditProxyDomStale(proxy, currentProxyValue)) return false;
  const inputState = {
    ...selection,
    value: currentProxyValue,
    scriptRanges: textEditScriptRanges(obj),
    scriptCaretAffinity: obj._textScriptCaretIndex === selection.start ? obj._textScriptCaretAffinity : '',
    insertedScriptRanges: editablePayload.scriptRanges || [],
    inputType,
    replacement: {
      start: selection.start,
      end: selection.end,
      insertedText: editablePayload.text,
    },
    nativePasteHandled: true,
  };
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    inputState.debug = options.debug || null;
    inputState.nativePasteEndMeta = {
      path: 'jsClipboard-text-selection-native',
      pasted: true,
      textObjectCount: 1,
      textCharCount: editablePayload.text.length,
      largestTextChars: editablePayload.text.length,
      ...textEditorTextStats(editablePayload.text, editablePayload.scriptRanges),
    };
  }
  beginTextEditHistoryAction(id, inputState, {
    splitPending: shouldCommitTextEditInputImmediately(inputType, inputState.hasSelection),
  });
  setPendingTextEditInputState(proxy, inputState);
  return {
    text: editablePayload.text,
    scriptRanges: editablePayload.scriptRanges || [],
  };
};

const tryNativeExternalTextPaste = (id, proxy, text, options = {}) => {
  if (!proxy || !options.event) return false;
  const obj = objectsMap.get(id);
  if (!obj) return false;
  const selection = options.selection || textEditSelectionState(proxy);
  if (selection.hasSelection) return false;
  if (textEditBracedScriptBoundaryInsertionAt(obj, selection.start)) return false;

  const rawPastedText = normalizeTextContent(text || '');
  const pastedText = textForTextEditPaste(rawPastedText);
  if (!pastedText) return false;
  if (pastedText !== rawPastedText) return false;

  const inputType = options.inputType || 'insertFromPaste';
  const scriptRanges = textEditScriptRanges(obj);
  const currentProxyValue = textEditProxyValue(proxy);
  if (isTextEditProxyDomStale(proxy, currentProxyValue)) return false;
  const inputState = {
    ...selection,
    value: currentProxyValue,
    scriptRanges,
    scriptCaretAffinity: obj._textScriptCaretIndex === selection.start ? obj._textScriptCaretAffinity : '',
    insertedScriptRanges: [],
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
      ...textEditorTextStats(pastedText, []),
    };
  }
  beginTextEditHistoryAction(id, inputState, {
    splitPending: shouldCommitTextEditInputImmediately(inputType, inputState.hasSelection),
  });
  setPendingTextEditInputState(proxy, inputState);
  return {
    text: pastedText,
    scriptRanges: [],
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
    ...textEditorTextStats(payload.text, payload.scriptRanges),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const editablePayload = editableTextScriptPayload(payload);
  const text = editablePayload.text;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-editable-payload-done', textEditorTextStats(text, editablePayload.scriptRanges));
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
  const boundaryInsertion = !selection.hasSelection
    ? textEditBracedScriptBoundaryInsertionAt(obj, selection.start)
    : null;
  if (boundaryInsertion) {
    selection = {
      start: boundaryInsertion.index,
      end: boundaryInsertion.index,
      direction: 'none',
      hasSelection: false,
    };
  }
  const replacementRange = selection.hasSelection
    ? textEditVisibleSelectionReplacementRange(obj, selection)
    : selection;
  const inputType = options.inputType || 'insertFromPaste';
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-replacement-range-ready', {
    inputType,
    boundaryInsertion: !!boundaryInsertion,
    replacementStart: replacementRange.start,
    replacementEnd: replacementRange.end,
    replacementChars: Math.max(0, replacementRange.end - replacementRange.start),
    ...textEditorSelectionDebugStats(selection, currentProxyValue),
    ...textEditorTextStats(text, editablePayload.scriptRanges),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const inputState = {
    ...selection,
    value: currentProxyValue,
    scriptRanges: textEditScriptRanges(obj),
    scriptCaretAffinity: boundaryInsertion?.affinity || (obj._textScriptCaretIndex === selection.start ? obj._textScriptCaretAffinity : ''),
    insertedScriptRanges: editablePayload.scriptRanges || [],
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
  beginTextEditHistoryAction(id, inputState, {
    splitPending: shouldCommitTextEditInputImmediately(inputType, inputState.hasSelection),
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-history-action-ready', {
    historyActionMs: Math.round((textEditorDebugNow() - historyStartedAt) * 100) / 100,
    inputType,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  setPendingTextEditInputState(proxy, inputState);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const selectionStartedAt = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  setTextEditProxySelectionRange(proxy, replacementRange.start, replacementRange.end, selection.direction || 'none', {
    value: currentProxyValue,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  logStep('paste:text-edit-selection-range-set', {
    selectionSetMs: Math.round((textEditorDebugNow() - selectionStartedAt) * 100) / 100,
    replacementStart: replacementRange.start,
    replacementEnd: replacementRange.end,
  });
  const mutationResult = replaceTextEditProxyRange(proxy, text, replacementRange.start, replacementRange.end, 'end');
  logStep('paste:text-edit-range-text-set', {
    setRangeTextMs: mutationResult.setRangeTextMs,
    valueAssignMs: mutationResult.valueAssignMs,
    valueBuildMs: mutationResult.valueBuildMs,
    valueSetMs: mutationResult.valueSetMs,
    selectionSetMs: mutationResult.selectionSetMs,
    textareaMutationMs: mutationResult.textareaMutationMs,
    textareaMutationMethod: mutationResult.method,
    ...textEditorTextStats(text, editablePayload.scriptRanges),
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
    ...textEditorTextStats(text, editablePayload.scriptRanges),
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
  textEditorClipStep(dbg, 'paste:text-selection-js-payload-ready', textEditorTextStats(payload.text, payload.scriptRanges));
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const pasteOptions = {
    immediateHistory: options.immediateHistory,
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
  normalizeForEdit = true,
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
      normalizeForEdit,
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
    normalizeForEdit,
    previousEditingId,
    ms: 0,
    totalMs: Math.round((stepStart - enterStart) * 100) / 100,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let contentNormalized = false;
  let bracesNormalized = false;
  let lineAlignNormalized = false;
  if (normalizeForEdit !== false) {
    const normalized = normalizeTextContent(obj.data.content);
    if (normalized !== obj.data.content) {
      obj.data.content = normalized;
      invalidateTextEditObjectLayout(obj);
      markDirty(obj.id);
      contentNormalized = true;
    }
    bracesNormalized = normalizeTextObjectToEditableScriptBraces(obj);
    if (bracesNormalized) {
      markDirty(obj.id);
    }
    if (Array.isArray(obj.data?.lineAlign)) {
      const beforeLineAlign = obj.data.lineAlign || [];
      const lineAlign = normalizeTextLineAlignForContent(obj.data.content, obj.data.lineAlign);
      lineAlignNormalized = !textEditFlatArrayEqual(beforeLineAlign, lineAlign);
      if (lineAlignNormalized) {
        if (lineAlign.length) obj.data.lineAlign = lineAlign;
        else delete obj.data.lineAlign;
      }
    }
  }
  logStep('enter-normalize', {
    skipped: normalizeForEdit === false,
    contentNormalized,
    bracesNormalized,
    lineAlignNormalized,
  });
  clearTextScriptCaretAffinity(obj);
  obj._editStartContent = obj.data.content;
  setTextEditMinLinesForSession(obj, { preserveSize });
  _editHistoryLastContent = obj.data.content;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;
  logStep('enter-state-ready', {
    editMinLines: obj._editMinLines,
  });

  const proxy = document.createElement('textarea');
  configureTextEditProxyElement(proxy);
  proxy.value = obj.data.content;
  setTextEditProxyLogicalValue(proxy, obj.data.content, { domSynced: true });
  document.body.appendChild(proxy);
  _editEl = proxy;
  const proxyAttr = (name) => (
    typeof proxy.getAttribute === 'function' ? proxy.getAttribute(name) : (proxy[name] || '')
  );
  logStep('enter-proxy-ready', {
    proxyChars: proxy.value.length,
    proxyWrap: proxy.wrap || proxyAttr('wrap') || '',
    proxySpellcheck: proxy.spellcheck,
    proxyAutocomplete: proxyAttr('autocomplete'),
    proxyAutocorrect: proxyAttr('autocorrect'),
    proxyAutocapitalize: proxyAttr('autocapitalize'),
    proxyAriaHidden: proxyAttr('aria-hidden'),
    proxyAriaLabel: proxyAttr('aria-label'),
    proxyContain: proxy.style.contain || '',
    proxyWhiteSpace: proxy.style.whiteSpace || '',
    proxyOverflow: proxy.style.overflow || '',
  });

  let pendingInputState = null;
  proxy._boardfishSetPendingInputState = (state) => { pendingInputState = state; };
  proxy._boardfishSetLogicalValue = (value, options = {}) => {
    setTextEditProxyLogicalValue(proxy, value, options);
  };
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
      scriptRangeCount: Array.isArray(state.scriptRanges) ? state.scriptRanges.length : '',
      ...extra,
    });
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  proxy.addEventListener('beforeinput', (event) => {
    if (pendingInputState?.nativePasteHandled && event?.inputType === 'insertFromPaste') {
      return;
    }
    let selection = textEditSelectionState(proxy);
    let currentProxyValue = textEditProxyValue(proxy);
    const insertedMarker = event?.inputType === 'insertText' &&
      typeof event.data === 'string' &&
      event.data.length === 1 &&
      textScriptKindForMarker(event.data);
    if (selection.start === selection.end && insertedMarker) {
      const boundaryInsertion = textEditBracedScriptBoundaryInsertionAt(obj, selection.start);
      const scriptInsertIndex = textEditScriptMarkerInsertionIndexAt(obj, selection.start);
      const insertIndex = boundaryInsertion?.index ??
        (scriptInsertIndex != null && scriptInsertIndex < selection.start
        ? scriptInsertIndex
        : selection.start);
      if (canAutoOpenTextScriptBraceAt(currentProxyValue, insertIndex)) {
        event.preventDefault();
        const inputType = 'insertText';
        const insertedText = `${event.data}{`;
        pendingInputState = {
          start: insertIndex,
          end: insertIndex,
          direction: 'none',
          hasSelection: false,
          value: currentProxyValue,
          scriptRanges: textEditScriptRanges(obj),
          scriptCaretAffinity: boundaryInsertion?.affinity || '',
          inputType,
          replacement: {
            start: insertIndex,
            end: insertIndex,
            insertedText,
          },
        };
        beginTextEditHistoryAction(id, pendingInputState, {
          splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
        });
        proxy.setSelectionRange(insertIndex, insertIndex, 'none');
        proxy.setRangeText(insertedText, insertIndex, insertIndex, 'end');
        dispatchTextEditInputEvent(proxy, inputType);
        return;
      }
    }
    if (
      selection.start === selection.end &&
      event?.inputType === 'insertText' &&
      typeof event.data === 'string' &&
      event.data.length > 0
    ) {
      const boundaryInsertion = textEditBracedScriptBoundaryInsertionAt(obj, selection.start);
      if (boundaryInsertion) {
        event.preventDefault();
        const inputType = 'insertText';
        pendingInputState = {
          start: boundaryInsertion.index,
          end: boundaryInsertion.index,
          direction: 'none',
          hasSelection: false,
          value: currentProxyValue,
          scriptRanges: textEditScriptRanges(obj),
          scriptCaretAffinity: boundaryInsertion.affinity,
          inputType,
          replacement: {
            start: boundaryInsertion.index,
            end: boundaryInsertion.index,
            insertedText: event.data,
          },
        };
        beginTextEditHistoryAction(id, pendingInputState, {
          splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
        });
        proxy.setSelectionRange(boundaryInsertion.index, boundaryInsertion.index, 'none');
        proxy.setRangeText(event.data, boundaryInsertion.index, boundaryInsertion.index, 'end');
        dispatchTextEditInputEvent(proxy, inputType);
        return;
      }
    }
    if (
      selection.hasSelection &&
      event?.inputType === 'insertText' &&
      typeof event.data === 'string' &&
      event.data.length > 0
    ) {
      const replacementRange = textEditVisibleSelectionReplacementRange(obj, selection);
      event.preventDefault();
      const inputType = 'insertText';
      pendingInputState = {
        ...selection,
        value: currentProxyValue,
        scriptRanges: textEditScriptRanges(obj),
        scriptCaretAffinity: '',
        inputType,
        replacement: {
          start: replacementRange.start,
          end: replacementRange.end,
          insertedText: event.data,
        },
      };
      beginTextEditHistoryAction(id, pendingInputState, {
        splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
      });
      proxy.setSelectionRange(replacementRange.start, replacementRange.end, selection.direction || 'none');
      proxy.setRangeText(event.data, replacementRange.start, replacementRange.end, 'end');
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }
    if (
      selection.start === selection.end &&
      (event?.inputType === 'insertLineBreak' || event?.inputType === 'insertParagraph') &&
      exitTextScriptForLineBreak(obj, proxy)
    ) {
      selection = textEditSelectionState(proxy);
      currentProxyValue = textEditProxyValue(proxy);
    }
    const scriptRanges = textEditScriptRanges(obj);
    const scriptCaretAffinity = textScriptCaretAffinityForInput(obj, proxy, selection);
    const nativeReplacement = textEditBeforeInputReplacement(currentProxyValue, selection, event);
    pendingInputState = {
      ...selection,
      value: currentProxyValue,
      scriptRanges,
      scriptCaretAffinity,
      inputType: event?.inputType || '',
    };
    if (nativeReplacement) pendingInputState.replacement = nativeReplacement;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      pendingInputState._debugSeq = nextTextEditInputDebugSeq();
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let domSyncBeforeNativeInput = null;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
      syncTextEditProxyDomValue(proxy, currentProxyValue, selection);
    } else {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      domSyncBeforeNativeInput = syncTextEditProxyDomValue(proxy, currentProxyValue, selection);
      if (domSyncBeforeNativeInput.synced) pendingInputState.domSyncedBeforeNativeInput = true;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    beginTextEditHistoryAction(id, pendingInputState, {
      splitPending: shouldCommitTextEditInputImmediately(pendingInputState.inputType, pendingInputState.hasSelection),
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    recordInputSetupStep('beforeinput-state-ready', event, pendingInputState, {
      nativeReplacement: !!nativeReplacement,
      domSyncedBeforeNativeInput: domSyncBeforeNativeInput.synced,
      splitPending: shouldCommitTextEditInputImmediately(pendingInputState.inputType, pendingInputState.hasSelection),
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  });
	  proxy.addEventListener('input', (event) => {
	    const inputState = pendingInputState || proxy._boardfishPendingInputState || textEditSelectionState(proxy);
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
	      pendingInputState: !!pendingInputState || !!proxy._boardfishPendingInputState,
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
    proxy._boardfishPendingInputState = null;
	    const oldValue = inputState.value ?? obj.data.content ?? '';
	    let replacement = inputState.replacement || null;
	    let synthesizedStaleReplacement = false;
	    let nextRawValue = '';
	    if (proxy._boardfishDomValueStale && !replacement) {
	      replacement = textEditBeforeInputReplacement(oldValue, inputState, event);
	      synthesizedStaleReplacement = !!replacement;
	    }
	    if (proxy._boardfishDomValueStale && replacement) {
	      const replacementStart = Math.max(0, Math.min(replacement.start ?? 0, oldValue.length));
	      const replacementEnd = Math.max(replacementStart, Math.min(replacement.end ?? replacementStart, oldValue.length));
	      nextRawValue = normalizeTextContent(
	        oldValue.slice(0, replacementStart) +
	        String(replacement.insertedText ?? '') +
	        oldValue.slice(replacementEnd)
	      );
	    } else {
	      nextRawValue = proxy.value;
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
      ...textEditorTextStats(replacement.insertedText, inputState.insertedScriptRanges),
    }));
	    obj.data.content = nextRawValue;
	    markDirty(id);
	    logInputStep('motion-dirty-done');
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
	        setTextEditProxyLogicalValue(proxy, obj.data.content, { domSynced: false });
	      }
	    } else {
	      setTextEditProxyLogicalValue(proxy, obj.data.content, { domSynced: true });
	    }
	    logInputStep('content-normalized', {
	      proxyChars: textEditProxyValue(proxy).length,
	      domProxyChars: proxy.value.length,
	      domValueStale: !!proxy._boardfishDomValueStale,
	      synthesizedStaleReplacement,
	      contentChars: obj.data.content.length,
	    });
    updateTextLineAlignForInput(obj, oldValue, replacement.start, replacement.end, obj.data.content, replacement.insertedText);
    logInputStep('line-align-done', {
      lineAlignCount: Array.isArray(obj.data?.lineAlign) ? obj.data.lineAlign.length : 0,
    });
    const scriptTransformInputRanges = inputState.scriptRanges || textEditScriptRanges(obj);
    const scriptResult = transformTextScriptRangesForInput(scriptTransformInputRanges, {
      oldValue,
      newValue: obj.data.content,
      start: replacement.start,
      end: replacement.end,
      insertedText: replacement.insertedText,
      insertedScriptRanges: inputState.insertedScriptRanges || [],
      caretAffinity: inputState.scriptCaretAffinity || '',
    });
    logInputStep('script-ranges-transformed', {
      scriptTransformFastPath: scriptResult.fastPath || '',
      scriptTransformInputRangeCount: Array.isArray(scriptTransformInputRanges) ? scriptTransformInputRanges.length : '',
      scriptTransformInsertedRangeCount: Array.isArray(inputState.insertedScriptRanges) ? inputState.insertedScriptRanges.length : '',
      scriptTransformInsertedMayCreateRange: scriptResult.insertedMayCreateScriptRange ?? '',
      scriptTransformLocalDerivedRangeCount: scriptResult.localDerivedRangeCount ?? '',
      scriptTransformSkipReason: scriptResult.skipReason || '',
      scriptTransformSkipRangeIndex: scriptResult.skipRangeIndex ?? '',
      scriptTransformSkipRangeStart: scriptResult.skipRangeStart ?? '',
      scriptTransformSkipRangeEnd: scriptResult.skipRangeEnd ?? '',
      scriptTransformSkipMarkerIndex: scriptResult.skipMarkerIndex ?? '',
      scriptTransformSkipRangeKind: scriptResult.skipRangeKind || '',
      scriptActive: !!scriptResult.active,
      scriptRangeCount: scriptResult.ranges?.length || 0,
    });
    const preservedCaretRanges = textScriptCaretRangesAfterInput(inputState, {
      oldValue,
      newValue: obj.data.content,
      replacement,
      inputType,
    });
    logInputStep('caret-ranges-preserved', {
      preservedCaretRangeCount: Array.isArray(preservedCaretRanges) ? preservedCaretRanges.length : 0,
    });
    setTextEditScriptRangesForContent(obj, scriptResult.ranges || []);
    if (proxy.selectionStart === proxy.selectionEnd) {
      const normalizedCaret = normalizeTextEditVisibleCaretIndex(obj, proxy.selectionStart, 'forward');
      if (normalizedCaret !== proxy.selectionStart) {
        proxy.setSelectionRange(normalizedCaret, normalizedCaret, 'none');
      }
    }
    const closedScript = replacement.insertedText === '}' && proxy.selectionStart === proxy.selectionEnd
      ? textScriptRangeEndingAt(scriptResult.ranges || [], proxy.selectionStart)
      : null;
    if (closedScript) {
      setTextScriptCaretAffinity(obj, proxy.selectionStart, 'after');
    } else if (Array.isArray(preservedCaretRanges) && proxy.selectionStart === proxy.selectionEnd) {
      setTextScriptCaretAffinityForRanges(obj, proxy.selectionStart, preservedCaretRanges);
    } else if (scriptResult.active && proxy.selectionStart === proxy.selectionEnd) {
      setTextScriptCaretAffinity(obj, proxy.selectionStart, 'inside');
    } else if (obj._textScriptCaretIndex !== proxy.selectionStart) {
      clearTextScriptCaretAffinity(obj);
    }
    if (proxy.selectionStart === proxy.selectionEnd) {
      setTextEditCaretIndex(obj, proxy.selectionStart, { clearLineStartIndex: true });
    } else {
      clearTextEditCaretIndex(obj);
    }
    logInputStep('caret-updated', () => ({
      selectionStart: proxy.selectionStart,
      selectionEnd: proxy.selectionEnd,
      scriptCaretIndex: obj._textScriptCaretIndex ?? '',
      scriptCaretAffinity: obj._textScriptCaretAffinity || '',
      textEditCaretIndex: obj._textEditCaretIndex ?? '',
      textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
      ...textEditorCaretLineDebugStats(obj, proxy.selectionStart, 'updatedCaret'),
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
    if (!layoutPatched) invalidateTextEditObjectLayout(obj);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const layoutPatchDebug = obj._lastTextLayoutPatchDebug || {};
      logInputStep(layoutPatched ? 'layout-patched' : 'layout-invalidated', {
        layoutPatched,
        layoutCacheLines: Array.isArray(obj._layoutCache) ? obj._layoutCache.length : '',
        layoutPatchScriptMetricsPatched: layoutPatchDebug.scriptMetricsPatched ?? '',
        layoutPatchScriptMetricsPatchReason: layoutPatchDebug.scriptMetricsPatchReason || '',
        layoutPatchScriptMetricsInsertedRangeCount: layoutPatchDebug.scriptMetricsInsertedRangeCount ?? '',
        layoutPatchScriptMetricsDeletedRangeCount: layoutPatchDebug.scriptMetricsDeletedRangeCount ?? '',
        layoutPatchScriptMetricsOperation: layoutPatchDebug.scriptMetricsOperation || '',
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
    const restoredMinLinesReset = resetTextEditPreservedMinLinesForInput(obj);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') resetTextEditPreservedMinLinesForInput(obj);
    const pendingSizeSyncBeforeAutoHeight = !!obj._textEditPendingSizeSync;
    const replacementStart = Math.max(0, Math.min(replacement.start ?? 0, oldValue.length));
    const replacementEnd = Math.max(replacementStart, Math.min(replacement.end ?? replacementStart, oldValue.length));
    const insertedText = String(replacement.insertedText || '');
    const removedChars = replacementEnd - replacementStart;
    const insertedChars = insertedText.length;
    const deletesContent = textEditInputTypeDeletesContent(inputType);
    const deleteReducedLogicalLines = deletesContent &&
      textNewlineCount(oldValue, replacementStart, replacementEnd) > textNewlineCount(insertedText);
    const selectedDeleteShrankText = deletesContent && !!inputState.hasSelection && removedChars > insertedChars;
    const deleteShrankPendingEdit = pendingSizeSyncBeforeAutoHeight &&
      deletesContent &&
      removedChars > insertedChars;
    const layoutRemovedLines = layoutPatched && obj._lastTextLayoutLineDelta < 0;
    const forceAutoHeight = layoutRemovedLines || deleteReducedLogicalLines ||
      selectedDeleteShrankText || deleteShrankPendingEdit;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const autoHeightForceReason = layoutRemovedLines
      ? 'layout-line-removal'
      : (deleteReducedLogicalLines
        ? 'logical-line-delete'
        : (selectedDeleteShrankText
          ? 'selected-delete'
          : (deleteShrankPendingEdit ? 'pending-size-delete' : '')));
    const autoHeightDebugBefore = shouldLogInput
      ? {
          size: textEditorSizeDebugStats(obj, obj.data.content, 'beforeAutoHeight'),
          proxy: textEditorProxySizeDebugStats(proxy),
        }
      : null;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const heightChanged = syncTextEditAutoHeightForInput(obj, getTextMinLines(obj), {
      forceSync: forceAutoHeight,
    });
    logInputStep('auto-height-done', () => ({
      heightChanged,
      autoHeightDeferred: !!obj._textEditPendingSizeSync,
      autoHeightForceSync: forceAutoHeight,
      autoHeightForceReason,
      restoredMinLinesReset: !!restoredMinLinesReset,
      restoredPreviousMinLines: restoredMinLinesReset?.previousMinLines ?? '',
      restoredPreservedMinLines: restoredMinLinesReset?.preservedMinLines ?? '',
      restoredNextMinLines: restoredMinLinesReset?.nextMinLines ?? '',
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
      ...textEditorTextStats(obj.data.content, obj.data.scriptRanges),
    }));
    _textInputSelectionHistorySuppress = textEditSelectionState(proxy);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const historyPushed = recordTextEditInputHistory(id, {
      inputType,
      hadSelection: !!inputState.hasSelection,
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
      recordTextEditInputHistory(id, {
        inputType,
        hadSelection: !!inputState.hasSelection,
      });
    }
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
    const candidate = currentBoardfishTextSelectionClipboardPayload();
    const fallbackText = typeof BoardfishClipboardIO !== 'undefined'
      ? BoardfishClipboardIO.readClipboardTextFromEvent?.(event.clipboardData) || ''
      : '';
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    logPasteStep('paste:text-edit-event-read-done', {
      ...textEditorEventDebugStats(event),
      hasBoardfishCandidate: !!candidate,
      fallbackTextChars: fallbackText.length,
      proxyChars: proxy.value.length,
      ...textEditorObjectDebugStats(obj),
      ...textEditorTextStats(fallbackText),
      candidateTextLen: candidate?.text?.length ?? '',
      candidateScriptRangeCount: Array.isArray(candidate?.scriptRanges) ? candidate.scriptRanges.length : '',
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
    const selection = eventSelection;
    if (candidate) {
      const nativePasteOptions = {
        event,
        selection,
        fallbackText,
        inputType: 'insertFromPaste',
      };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') nativePasteOptions.debug = dbg;
      const nativePaste = tryNativeBoardfishTextSelectionPaste(id, proxy, candidate, nativePasteOptions);
      if (nativePaste) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        logPasteStep('paste:text-edit-native-textarea-allowed', {
          source: 'jsClipboard-text-selection',
          textLen: nativePaste.text.length,
          ...textEditorTextStats(nativePaste.text, nativePaste.scriptRanges),
          ...textEditorSelectionDebugStats(selection, proxy.value),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      logPasteStep('paste:text-edit-native-textarea-skipped', {
        source: 'jsClipboard-text-selection',
        hasToken: !!synchronousBoardfishClipboardTokenFromPasteEvent(event),
        tokenMatches: boardfishPasteEventMatchesCurrentTextSelectionClipboard(event),
        selectedChars: selection.end - selection.start,
        fallbackTextChars: fallbackText.length,
        candidateTextLen: candidate?.text?.length ?? '',
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    if (fallbackText) {
      const nativeExternalOptions = {
        event,
        selection,
        inputType: 'insertFromPaste',
      };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        nativeExternalOptions.debug = dbg;
        nativeExternalOptions.path = candidate ? 'fallback-event-text-native' : 'event-text-native';
      }
      const nativeExternalPaste = tryNativeExternalTextPaste(id, proxy, fallbackText, nativeExternalOptions);
      if (nativeExternalPaste) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        logPasteStep('paste:text-edit-native-event-text-allowed', {
          source: candidate ? 'fallback-event-text' : 'event-text',
          textLen: nativeExternalPaste.text.length,
          ...textEditorTextStats(nativeExternalPaste.text),
          ...textEditorSelectionDebugStats(selection, proxy.value),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      logPasteStep('paste:text-edit-native-event-text-skipped', {
        source: candidate ? 'fallback-event-text' : 'event-text',
        fallbackTextChars: fallbackText.length,
        selectedChars: selection.end - selection.start,
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    event.preventDefault();
    if (!candidate) {
      const replaceOptions = { selection, inputType: 'insertFromPaste' };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        replaceOptions.debug = dbg;
        replaceOptions.source = 'event-text';
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const pasted = replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
        scriptRanges: [],
      }, replaceOptions);
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
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        replaceTextEditSelectionWithPayload(id, proxy, {
          text: fallbackText,
          scriptRanges: [],
        }, replaceOptions);
      }
      return;
    }
    const pasteOptions = {
      id,
      proxy,
      event,
      selection,
      immediateHistory: false,
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
          ...textEditorTextStats(candidate?.text || '', candidate?.scriptRanges || []),
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
      const fallbackPasted = replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
        scriptRanges: [],
      }, fallbackOptions);
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
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        replaceTextEditSelectionWithPayload(id, proxy, {
          text: fallbackText,
          scriptRanges: [],
        }, fallbackOptions);
      }
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
      const fallbackPasted = replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
        scriptRanges: [],
      }, fallbackOptions);
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
      if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
        replaceTextEditSelectionWithPayload(id, proxy, {
          text: fallbackText,
          scriptRanges: [],
        }, fallbackOptions);
      }
    });
  });
  proxy.addEventListener('blur', () => {
    flushEditHistoryCheckpoint();
  });
  proxy.addEventListener('keydown', (e) => {
    _caretVisible = true;

    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const currentProxyValue = textEditProxyValue(proxy);
      const selection = textEditSelectionState(proxy);
      const indentResult = applyTextEditLineIndent(currentProxyValue, selection, { outdent: e.shiftKey });
      if (!indentResult.changed) {
        scheduleRender(true, false);
        return;
      }
      const inputType = e.shiftKey ? 'deleteContentBackward' : 'insertText';
      pendingInputState = {
        ...selection,
        value: currentProxyValue,
        scriptRanges: textEditScriptRanges(obj),
        scriptCaretAffinity: obj._textScriptCaretIndex === proxy.selectionStart ? obj._textScriptCaretAffinity : '',
        inputType,
      };
      beginTextEditHistoryAction(id, pendingInputState, {
        splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
      });
      proxy.value = indentResult.value;
      setTextEditProxyLogicalValue(proxy, indentResult.value, { domSynced: true });
      proxy.setSelectionRange(indentResult.start, indentResult.end, indentResult.direction);
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if (e.key === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      exitTextScriptForLineBreak(obj, proxy);
      const currentProxyValue = textEditProxyValue(proxy);
      const selection = textEditSelectionState(proxy);
      const lineBreakResult = applyTextEditLineBreakIndent(currentProxyValue, selection);
      const inputType = 'insertLineBreak';
      pendingInputState = {
        ...selection,
        value: currentProxyValue,
        scriptRanges: textEditScriptRanges(obj),
        scriptCaretAffinity: obj._textScriptCaretIndex === proxy.selectionStart ? obj._textScriptCaretAffinity : '',
        inputType,
      };
      beginTextEditHistoryAction(id, pendingInputState, {
        splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
      });
      proxy.value = lineBreakResult.value;
      setTextEditProxyLogicalValue(proxy, lineBreakResult.value, { domSynced: true });
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
      copyTextEditSelectionFromProxy(id, proxy);
      const selection = textEditSelectionState(proxy);
      const deletion = textEditVisibleSelectionDeleteRange(obj, selection) || selection;
      const inputType = 'deleteByCut';
      pendingInputState = {
        ...selection,
        value: textEditProxyValue(proxy),
        scriptRanges: textEditScriptRanges(obj),
        scriptCaretAffinity: '',
        inputType,
        replacement: {
          start: deletion.start,
          end: deletion.end,
          insertedText: '',
        },
      };
      beginTextEditHistoryAction(id, pendingInputState, {
        splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
      });
      proxy.setRangeText('', deletion.start, deletion.end, 'start');
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const currentProxyValue = textEditProxyValue(proxy);
      setTextEditProxySelectionRange(proxy, 0, currentProxyValue.length, 'none', {
        value: currentProxyValue,
      });
      TextSelDebug._logSelection('select-all', proxy);
      scheduleRender(true, false);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      applyTextEditAlignmentFromKeyboard(e.key === 'ArrowRight' ? 'right' : 'left', id, proxy);
      return;
    }

    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const selection = textEditSelectionState(proxy);
      const direction = e.key === 'ArrowLeft' ? 'backward' : 'forward';
      const scriptSnapshot = textEditScriptSnapshot(obj);
      let nextPos;
      let scriptLayerMove = false;
      if (selection.hasSelection && !e.shiftKey) {
        nextPos = normalizeTextEditVisibleCaretIndex(obj, direction === 'backward' ? selection.start : selection.end, direction, scriptSnapshot);
        setTextEditProxySelectionRange(proxy, nextPos, nextPos, 'none');
      } else if (e.shiftKey) {
        const activePos = selection.direction === 'backward' ? selection.start : selection.end;
        const anchorPos = selection.direction === 'backward' ? selection.end : selection.start;
        nextPos = moveTextEditVisibleCaret(obj, activePos, direction, scriptSnapshot);
        setTextEditProxySelectionRange(
          proxy,
          Math.min(anchorPos, nextPos),
          Math.max(anchorPos, nextPos),
          anchorPos <= nextPos ? 'forward' : 'backward'
        );
      } else {
        const layerMove = moveTextEditCaretScriptLayer(obj, selection.start, direction, scriptSnapshot);
        if (layerMove) {
          nextPos = layerMove.index;
          setTextEditProxySelectionRange(proxy, nextPos, nextPos, 'none');
          if (layerMove.affinity === 'after') {
            setTextScriptCaretAffinity(obj, nextPos, 'after');
          } else {
            clearTextScriptCaretAffinity(obj);
            setTextEditCaretIndex(obj, nextPos);
          }
          scriptLayerMove = true;
        } else {
          nextPos = moveTextEditVisibleCaret(obj, selection.start, direction, scriptSnapshot);
          setTextEditProxySelectionRange(proxy, nextPos, nextPos, 'none');
        }
      }
      if (proxy.selectionStart === proxy.selectionEnd) {
        if (!scriptLayerMove) setTextEditCaretIndex(obj, proxy.selectionStart);
      } else {
        clearTextEditCaretIndex(obj);
      }
      if (!scriptLayerMove) clearTextScriptCaretAffinity(obj);
      scheduleRender(true, false);
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const deleteKeyStartedAt = textEditorDebugNow();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const selection = textEditSelectionState(proxy);
      const direction = e.key === 'Backspace' ? 'backward' : 'forward';
      let normalizedSelection = selection;
      let deletion = null;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let deleteRangeMs = 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      let deleteCaret = selection.start;
      let blankLineDelete = false;
      if (selection.hasSelection) {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          const deleteRangeStartedAt = textEditorDebugNow();
          deletion = textEditVisibleSelectionDeleteRange(obj, selection);
          deleteRangeMs = textEditorDebugRound(textEditorDebugNow() - deleteRangeStartedAt);
        } else {
          deletion = textEditVisibleSelectionDeleteRange(obj, selection);
        }
      } else {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const deleteRangeStartedAt = textEditorDebugNow();
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        const scriptSnapshot = textEditScriptSnapshot(obj);
        const caret = normalizeTextEditVisibleCaretIndex(obj, selection.start, direction, scriptSnapshot);
        deleteCaret = caret;
        if (caret !== selection.start) proxy.setSelectionRange(caret, caret, 'none');
        normalizedSelection = {
          start: caret,
          end: caret,
          direction: 'none',
          hasSelection: false,
        };
        blankLineDelete = !!textEditBlankLineDeleteRange(textEditProxyValue(proxy), caret, e.key);
        deletion = textEditVisibleDeleteRange(obj, caret, e.key, scriptSnapshot);
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
        const replacement = textEditStructuralDeleteReplacement(obj, deletion);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const replacementBuildMs = textEditorDebugRound(textEditorDebugNow() - replacementStartedAt);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        pendingInputState = {
          ...normalizedSelection,
          value: textEditProxyValue(proxy),
          scriptRanges: textEditScriptRanges(obj),
          scriptCaretAffinity: !normalizedSelection.hasSelection && obj._textScriptCaretIndex === normalizedSelection.start ? obj._textScriptCaretAffinity : '',
          inputType,
          replacement: {
            start: replacement.start,
            end: replacement.end,
            insertedText: replacement.insertedText,
          },
        };
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          pendingInputState._debugSeq = nextTextEditInputDebugSeq();
        }
        if (replacement.insertedScriptRanges.length) {
          pendingInputState.insertedScriptRanges = replacement.insertedScriptRanges;
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const deleteDebugSeq = pendingInputState._debugSeq;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        beginTextEditHistoryAction(id, pendingInputState, {
          splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const deleteSetupMeta = {
          key: e.key,
          deleteCaret,
          blankLineDelete,
          deleteRangeMs,
          replacementBuildMs,
          keydownDeleteSetupMs: textEditorDebugRound(textEditorDebugNow() - deleteKeyStartedAt),
          deletionStart: deletion.start,
          deletionEnd: deletion.end,
          structuralReplacementEnd: replacement.end,
          insertedScriptRangeCount: replacement.insertedScriptRanges.length,
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
        const mutationResult = replaceTextEditProxyRange(proxy, replacement.insertedText, replacement.start, replacement.end, 'start', {
          deferDomValue: true,
        });
        const textareaMutationMs = textEditorDebugRound(textEditorDebugNow() - mutationStartedAt);
        const logicalProxyValue = textEditProxyValue(proxy);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        if (typeof BOARDFISH_PRODUCTION !== 'undefined') {
          replaceTextEditProxyRange(proxy, replacement.insertedText, replacement.start, replacement.end, 'start', {
            deferDomValue: true,
          });
        }
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
        blankLineDelete,
        deleteRangeMs,
        keydownDeleteSetupMs: textEditorDebugRound(textEditorDebugNow() - deleteKeyStartedAt),
        deletionStart: deletion?.start ?? '',
        deletionEnd: deletion?.end ?? '',
        textEditCaretIndex: obj._textEditCaretIndex ?? '',
        textEditCaretLineStartIndex: obj._textEditCaretLineStartIndex ?? '',
        ...textEditorEventDebugStats(e),
        ...textEditorSelectionDebugStats(normalizedSelection, textEditProxyValue(proxy)),
        ...textEditorCaretLineDebugStats(obj, deleteCaret, 'deleteCaret'),
      });
    }

    // The 1px-wide proxy treats all content as a single column, so the browser's
    // own up/down logic navigates char-by-char instead of line-by-line. Intercept
    // and compute line navigation from the canvas layout instead.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const layout = getTextLayout(obj);
      if (!layout.length) { scheduleRender(true, false); return; }

      const isUp = e.key === 'ArrowUp';

      // Which end of the selection to navigate from
      let refPos;
      if (e.shiftKey) {
        const d = proxy.selectionDirection;
        refPos = d === 'backward' ? proxy.selectionStart : proxy.selectionEnd;
      } else {
        refPos = isUp ? proxy.selectionStart : proxy.selectionEnd;
      }

      // Find the line containing refPos
      let lo = 0, hi = layout.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1, ln = layout[mid];
        if (refPos <= (ln.caretEndIndex ?? ln.endIndex ?? (ln.startIndex + ln.text.length))) hi = mid; else lo = mid + 1;
      }
      const refLineIdx = lo;
      const refLine = layout[refLineIdx];

      // Caret world-x in the reference line
      const off = Math.min(refPos - refLine.startIndex, refLine.text.length);
      const caretX = lineCaretXAtOffset(refLine, obj, off);

      // Find nearest position in the target line
      const targetIdx = isUp ? refLineIdx - 1 : refLineIdx + 1;
      let newPos;
      if (targetIdx < 0) {
        newPos = 0;
      } else if (targetIdx >= layout.length) {
        newPos = textEditProxyValue(proxy).length;
      } else {
        newPos = layoutHitTest([layout[targetIdx]], caretX, layout[targetIdx].y, obj);
      }

      if (e.shiftKey) {
        const d = proxy.selectionDirection;
        const anchorPos = d === 'backward' ? proxy.selectionEnd : proxy.selectionStart;
        setTextEditProxySelectionRange(
          proxy,
          Math.min(anchorPos, newPos), Math.max(anchorPos, newPos),
          anchorPos <= newPos ? 'forward' : 'backward'
        );
      } else {
        setTextEditProxySelectionRange(proxy, newPos, newPos, 'none');
      }

      scheduleRender(true, false);
      return;
    }

    if (textEditNavigationKeys.has(e.key)) flushEditHistoryCheckpoint();
    scheduleRender(true, false);
  });

  logStep('enter-listeners-ready');

  let _prevSelStart = -1, _prevSelEnd = -1;
  _selChangeListener = () => {
    if (document.activeElement !== proxy) return;
    const currentObj = objectsMap.get(id);
    let s = proxy.selectionStart, e = proxy.selectionEnd;
    if (currentObj && s === e) {
      const normalizedCaret = normalizeTextEditVisibleCaretIndex(currentObj, s, 'forward');
      if (normalizedCaret !== s) {
        proxy.setSelectionRange(normalizedCaret, normalizedCaret, 'none');
        s = normalizedCaret;
        e = normalizedCaret;
      }
    }
    if (s === _prevSelStart && e === _prevSelEnd && _caretVisible) return;
    _prevSelStart = s; _prevSelEnd = e;
    if (
      _textInputSelectionHistorySuppress &&
      _textInputSelectionHistorySuppress.start === s &&
      _textInputSelectionHistorySuppress.end === e
    ) {
      _textInputSelectionHistorySuppress = null;
    } else {
      _textInputSelectionHistorySuppress = null;
      flushEditHistoryCheckpoint();
    }
    TextSelDebug._logSelection('selectionchange', proxy);
    _caretVisible = true;
    if (currentObj) {
      if (s !== e || currentObj._textScriptCaretIndex !== s) {
        clearTextScriptCaretAffinity(currentObj);
      }
      if (s === e) setTextEditCaretIndex(currentObj, s);
      else clearTextEditCaretIndex(currentObj);
    }
    scheduleRender(true, false);
  };
  document.addEventListener('selectionchange', _selChangeListener);
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

  // Offscreen is now stale: it was built with this object; now we exclude it
  invalidateOffscreen();
  logStep('enter-offscreen-invalidated');

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
  const objAtStart = objectsMap.get(id);
  const proxy = _editEl;
  const proxyLogicalValue = textEditProxyValue(proxy);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
    proxyChars: proxyLogicalValue.length,
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

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const invalidateStart = textEditorDebugNow();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  invalidateOffscreen();
  logStep('exit-offscreen-invalidated', objAtStart, {
    invalidateOffscreenMs: textEditorDebugRound(textEditorDebugNow() - invalidateStart),
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
        markDirty(id);
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
    clearTextScriptCaretAffinity(obj);
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
