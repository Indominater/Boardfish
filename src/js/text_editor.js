const textEditActionFromInputType = (inputType = '') => {
  const value = String(inputType || '');
  const lower = value.toLowerCase();
  if (lower.includes('paste')) return 'text-edit-paste';
  if (lower.includes('cut')) return 'text-edit-cut';
  if (value.startsWith('delete')) return 'text-edit-delete';
  return 'text-edit-type';
};

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

const textEditSelectionState = (proxy) => {
  const valueLength = proxy?.value?.length ?? 0;
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
const TEXT_EDIT_LEGACY_SPACE_INDENT_SIZE = 4;

const textEditLineStartAt = (value, index) => {
  const text = String(value ?? '');
  const clamped = Math.max(0, Math.min(index ?? 0, text.length));
  if (clamped <= 0) return 0;
  const newlineAt = text.lastIndexOf('\n', clamped - 1);
  return newlineAt === -1 ? 0 : newlineAt + 1;
};

const textEditSelectedLineStarts = (value, selection) => {
  const text = String(value ?? '');
  const start = Math.max(0, Math.min(selection?.start ?? 0, text.length));
  const end = Math.max(0, Math.min(selection?.end ?? start, text.length));
  const lastSelectedIndex = end > start ? end - 1 : start;
  const firstLineStart = textEditLineStartAt(text, start);
  const lastLineStart = textEditLineStartAt(text, lastSelectedIndex);
  const starts = [];
  let lineStart = firstLineStart;
  while (lineStart <= lastLineStart) {
    starts.push(lineStart);
    const newlineAt = text.indexOf('\n', lineStart);
    if (newlineAt === -1) break;
    lineStart = newlineAt + 1;
  }
  return starts;
};

const textEditOutdentLengthAt = (value, lineStart) => {
  if (value[lineStart] === '\t') return 1;
  let count = 0;
  while (count < TEXT_EDIT_LEGACY_SPACE_INDENT_SIZE && value[lineStart + count] === ' ') count++;
  return count;
};

const textEditLineIndentAt = (value, index) => {
  const text = String(value ?? '');
  const lineStart = textEditLineStartAt(text, index);
  let end = lineStart;
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  return text.slice(lineStart, end);
};

const adjustTextEditIndexForRemoval = (index, start, length) => {
  if (index <= start) return index;
  if (index >= start + length) return index - length;
  return start;
};

const applyTextEditLineIndent = (value, selection, { outdent = false } = {}) => {
  const text = String(value ?? '');
  const selectionState = {
    start: Math.max(0, Math.min(selection?.start ?? 0, text.length)),
    end: Math.max(0, Math.min(selection?.end ?? selection?.start ?? 0, text.length)),
    direction: selection?.direction || 'none',
  };
  const lineStarts = textEditSelectedLineStarts(text, selectionState);
  const edits = outdent
    ? lineStarts
      .map((lineStart) => ({ lineStart, length: textEditOutdentLengthAt(text, lineStart) }))
      .filter((edit) => edit.length > 0)
    : lineStarts.map((lineStart) => ({ lineStart, insert: TEXT_EDIT_INDENT }));
  if (!edits.length) return { ...selectionState, value: text, changed: false };

  let nextValue = text;
  let nextStart = selectionState.start;
  let nextEnd = selectionState.end;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    if (edit.insert) {
      nextValue = nextValue.slice(0, edit.lineStart) + edit.insert + nextValue.slice(edit.lineStart);
      if (nextStart >= edit.lineStart) nextStart += edit.insert.length;
      if (nextEnd >= edit.lineStart) nextEnd += edit.insert.length;
    } else {
      nextValue = nextValue.slice(0, edit.lineStart) + nextValue.slice(edit.lineStart + edit.length);
      nextStart = adjustTextEditIndexForRemoval(nextStart, edit.lineStart, edit.length);
      nextEnd = adjustTextEditIndexForRemoval(nextEnd, edit.lineStart, edit.length);
    }
  }

  return {
    value: nextValue,
    start: nextStart,
    end: nextEnd,
    direction: selectionState.direction,
    changed: nextValue !== text,
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

const textEditInputReplacement = (oldValue, nextValue, inputState = {}, inputType = '') => {
  const oldText = normalizeTextContent(oldValue);
  const nextText = normalizeTextContent(nextValue);
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
  delete obj._layoutCache;
  delete obj._layoutCacheKey;
  if (typeof _linesCacheMap !== 'undefined') _linesCacheMap.delete(obj.id);
};

const syncFreshTextEditWidth = (obj) => {
  if (!obj || obj.type !== 'text' || obj._editStartContent !== '') return false;
  if (typeof getTextRenderedContentWidth !== 'function') return false;
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
  if (!normalizeTextContent(obj.data?.content || '')) return NEW_TEXT_EDIT_MIN_LINES;
  const currentLines = exactTextEditLineCountForHeight(obj.h);
  if (currentLines >= NEW_TEXT_EDIT_MIN_LINES) return currentLines;
  if (preserveSize && currentLines > 1) return currentLines;
  return 1;
};

const setTextScriptCaretAffinity = (obj, index, affinity) => {
  if (!obj) return;
  obj._textScriptCaretIndex = index;
  obj._textScriptCaretAffinity = affinity;
  obj._textEditCaretIndex = index;
};

const clearTextScriptCaretAffinity = (obj) => {
  if (!obj) return;
  delete obj._textScriptCaretIndex;
  delete obj._textScriptCaretAffinity;
};

const setTextEditCaretIndex = (obj, index) => {
  if (!obj) return;
  const length = normalizeTextContent(obj.data?.content || '').length;
  obj._textEditCaretIndex = Math.max(0, Math.min(Math.trunc(index ?? 0), length));
};

const clearTextEditCaretIndex = (obj) => {
  if (!obj) return;
  delete obj._textEditCaretIndex;
};

const textEditScriptRanges = (obj) => {
  if (!obj || typeof getTextScriptRanges !== 'function') return [];
  return getTextScriptRanges(obj).map((range) => ({ ...range }));
};

const normalizeTextObjectToEditableScriptBraces = (obj) => {
  const brace = typeof textScriptLinearToDeterministicBraces === 'function'
    ? textScriptLinearToDeterministicBraces
    : (typeof textContentWithCanonicalScriptBraces === 'function' ? textContentWithCanonicalScriptBraces : null);
  if (!obj || obj.type !== 'text' || typeof brace !== 'function') return false;
  const current = normalizeTextContent(obj.data?.content || '');
  const content = brace(current, Array.isArray(obj.data?.scriptRanges) ? obj.data.scriptRanges : []);
  const scriptRanges = typeof normalizeTextScriptRangesForContent === 'function'
    ? normalizeTextScriptRangesForContent(content, [
      ...(Array.isArray(obj.data?.scriptRanges) ? obj.data.scriptRanges : []),
      ...(typeof deriveBracedTextScriptRangesFromContent === 'function' ? deriveBracedTextScriptRangesFromContent(content) : []),
    ])
    : [];
  if (content === current && JSON.stringify(scriptRanges || []) === JSON.stringify(obj.data?.scriptRanges || [])) return false;
  obj.data.content = content;
  if (scriptRanges?.length) obj.data.scriptRanges = scriptRanges;
  else delete obj.data.scriptRanges;
  invalidateTextEditObjectLayout(obj);
  return true;
};

const isTextEditScriptMarkerHiddenAt = (obj, index, content = null, ranges = null) => {
  if (!obj || typeof isTextScriptMarkerHiddenAt !== 'function') return false;
  const text = content == null ? normalizeTextContent(obj.data?.content || '') : normalizeTextContent(content);
  const scriptRanges = ranges || textEditScriptRanges(obj);
  return isTextScriptMarkerHiddenAt(scriptRanges, index, text);
};

const isTextEditBracedScriptOpeningCaretBoundaryAt = (ranges, index, content) => {
  if (typeof isTextScriptBracedRange !== 'function') return false;
  const text = normalizeTextContent(content);
  return (ranges || []).some((range) => range.start === index && isTextScriptBracedRange(text, range));
};

const normalizeTextEditVisibleCaretIndex = (obj, index, direction = 'forward') => {
  const text = normalizeTextContent(obj?.data?.content || '');
  const ranges = textEditScriptRanges(obj);
  let pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  const step = direction === 'backward' ? -1 : 1;
  let guard = text.length + 1;
  while (guard-- > 0 && isTextEditBracedScriptOpeningCaretBoundaryAt(ranges, pos, text)) {
    pos += step;
    if (pos < 0) return 0;
    if (pos > text.length) return text.length;
  }
  return pos;
};

const moveTextEditVisibleCaret = (obj, index, direction = 'forward') => {
  const text = normalizeTextContent(obj?.data?.content || '');
  const backward = direction === 'backward';
  const current = normalizeTextEditVisibleCaretIndex(obj, index, backward ? 'backward' : 'forward');
  const stepped = current + (backward ? -1 : 1);
  return normalizeTextEditVisibleCaretIndex(obj, stepped, backward ? 'backward' : 'forward');
};

const textEditCanExitScriptLayerAt = (obj, index, affinity = '') => {
  if (!obj || affinity === 'after') return false;
  const pos = normalizeTextEditVisibleCaretIndex(obj, index, 'forward');
  return textEditScriptRanges(obj).some((range) => range.end === pos && isTextScriptRangeActiveAt(range, pos, affinity));
};

const textEditCanEnterScriptLayerAt = (obj, index, affinity = '') => {
  if (!obj || affinity !== 'after') return false;
  const pos = normalizeTextEditVisibleCaretIndex(obj, index, 'backward');
  return textEditScriptRanges(obj).some((range) => range.end === pos);
};

const moveTextEditCaretScriptLayer = (obj, index, direction = 'forward') => {
  const pos = normalizeTextEditVisibleCaretIndex(obj, index, direction);
  const affinity = obj?._textScriptCaretIndex === pos ? obj._textScriptCaretAffinity : '';
  const text = normalizeTextContent(obj?.data?.content || '');
  const ranges = textEditScriptRanges(obj);
  if (direction === 'forward' && typeof isTextScriptBracedRange === 'function') {
    const bracedClose = ranges
      .filter((range) => range.end - 1 === pos && isTextScriptBracedRange(text, range))
      .sort((a, b) => b.start - a.start || a.end - b.end)[0];
    if (bracedClose) {
      return { index: bracedClose.end, affinity: 'after' };
    }
  }
  if (direction === 'backward' && typeof isTextScriptBracedRange === 'function') {
    const bracedEnd = ranges
      .filter((range) => range.end === pos && isTextScriptBracedRange(text, range))
      .sort((a, b) => b.start - a.start || a.end - b.end)[0];
    if (bracedEnd && bracedEnd.end - 1 > bracedEnd.start) {
      return { index: bracedEnd.end - 1, affinity: 'after' };
    }
  }
  if (
    direction === 'forward' &&
    pos >= text.length &&
    textEditCanEnterScriptLayerAt(obj, pos, affinity)
  ) {
    return { index: pos, affinity: 'after' };
  }
  if (direction === 'forward' && textEditCanExitScriptLayerAt(obj, pos, affinity)) {
    return { index: pos, affinity: 'after' };
  }
  if (direction === 'backward' && textEditCanEnterScriptLayerAt(obj, pos, affinity)) {
    return { index: pos, affinity: '' };
  }
  return null;
};

const textEditScriptRangeEndingAtContainsIndex = (ranges, index, end) => (
  (ranges || []).some((range) => range.end === end && range.start <= index && index < range.end)
);

const textEditScriptRangeVisibleBounds = (content, range) => {
  const text = normalizeTextContent(content);
  if (typeof isTextScriptBracedRange === 'function' && isTextScriptBracedRange(text, range)) {
    return { start: range.start + 1, end: range.end - 1 };
  }
  return { start: range.start, end: range.end };
};

const textEditBaseChildScriptDeleteRange = (obj, baseIndex, content = null, ranges = null) => {
  if (!obj) return null;
  const text = content == null ? normalizeTextContent(obj.data?.content || '') : normalizeTextContent(content);
  const scriptRanges = ranges || textEditScriptRanges(obj);
  const start = Math.max(0, Math.min(Math.trunc(baseIndex ?? 0), text.length));
  if (start >= text.length || isTextEditScriptMarkerHiddenAt(obj, start, text, scriptRanges)) return null;

  let end = start + 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (const range of scriptRanges) {
      const markerIndex = range.start - 1;
      if (markerIndex !== end) continue;
      if (textEditScriptRangeEndingAtContainsIndex(scriptRanges, start, markerIndex)) continue;
      if (!isTextEditScriptMarkerHiddenAt(obj, markerIndex, text, scriptRanges)) continue;
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
    const previous = (ranges || [])
      .filter((item) => item.end === markerIndex)
      .sort((a, b) => (a.start - 1) - (b.start - 1))[0];
    if (!previous) break;
    markerIndex = previous.start - 1;
  }
  return markerIndex - 1;
};

const textEditCompoundScriptDeleteRangeBeforeCaret = (obj, index, content = null, ranges = null) => {
  if (!obj) return null;
  const text = content == null ? normalizeTextContent(obj.data?.content || '') : normalizeTextContent(content);
  const scriptRanges = ranges || textEditScriptRanges(obj);
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  let best = null;
  for (const range of scriptRanges) {
    if (range.end !== pos) continue;
    const baseIndex = textEditScriptRootBaseIndexForRange(scriptRanges, range);
    const candidate = textEditBaseChildScriptDeleteRange(obj, baseIndex, text, scriptRanges);
    if (!candidate || candidate.end !== pos) continue;
    if (!best || candidate.start < best.start || (candidate.start === best.start && candidate.end > best.end)) {
      best = candidate;
    }
  }
  return best;
};

const textEditVisibleSelectionDeleteRange = (obj, selection) => {
  if (!obj) return null;
  const text = normalizeTextContent(obj.data?.content || '');
  const ranges = textEditScriptRanges(obj);
  let start = Math.max(0, Math.min(selection?.start ?? 0, text.length));
  let end = Math.max(start, Math.min(selection?.end ?? start, text.length));
  if (start === end) return null;

  let changed = true;
  while (changed) {
    changed = false;
    let expandedStart = true;
    while (expandedStart) {
      expandedStart = false;
      for (const range of ranges || []) {
        const markerIndex = range.start - 1;
        const visibleBounds = textEditScriptRangeVisibleBounds(text, range);
        if (markerIndex < 0 || markerIndex >= start) continue;
        if (visibleBounds.start < start || visibleBounds.end > end) continue;
        if (!isTextEditScriptMarkerHiddenAt(obj, markerIndex, text, ranges)) continue;
        start = markerIndex;
        end = Math.max(end, range.end);
        expandedStart = true;
        changed = true;
      }
    }

    for (let i = start; i < end; i++) {
      if (isTextEditScriptMarkerHiddenAt(obj, i, text, ranges)) continue;
      const childRange = textEditBaseChildScriptDeleteRange(obj, i, text, ranges);
      if (!childRange || childRange.start < start || childRange.start >= end || childRange.end <= end) continue;
      end = childRange.end;
      changed = true;
      break;
    }
  }

  return { start, end };
};

const textEditStructuralDeleteReplacement = (obj, deletion) => {
  const text = normalizeTextContent(obj?.data?.content || '');
  const start = Math.max(0, Math.min(deletion?.start ?? 0, text.length));
  const end = Math.max(start, Math.min(deletion?.end ?? start, text.length));
  const fallback = { start, end, insertedText: '', insertedScriptRanges: [] };
  if (!obj || start === end || typeof isTextScriptBracedRange !== 'function') return fallback;
  const ranges = textEditScriptRanges(obj);
  const candidates = ranges
    .filter((range) => (
      isTextScriptBracedRange(text, range) &&
      start <= range.start &&
      end > range.start &&
      end <= range.end - 1
    ))
    .sort((a, b) => b.start - a.start || a.end - b.end);
  const range = candidates[0];
  if (!range) return fallback;

  const insertedStart = end;
  const insertedEnd = range.end - 1;
  const insertedText = text.slice(insertedStart, insertedEnd);
  const insertedScriptRanges = ranges
    .filter((item) => item !== range && item.start >= insertedStart && item.end <= insertedEnd)
    .map((item) => ({
      start: item.start - insertedStart,
      end: item.end - insertedStart,
      kind: item.kind,
    }));

  return {
    start,
    end: range.end,
    insertedText,
    insertedScriptRanges,
  };
};

const normalizeTextEditSelectionForLayerReplacement = (obj, selection) => {
  if (!obj || !selection?.hasSelection) return selection;
  const text = normalizeTextContent(obj.data?.content || '');
  const ranges = textEditScriptRanges(obj);
  let start = Math.max(0, Math.min(selection.start ?? 0, text.length));
  const end = Math.max(start, Math.min(selection.end ?? start, text.length));
  for (const range of ranges) {
    if (
      typeof isTextScriptBracedRange === 'function' &&
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
  const replacementSelection = normalizeTextEditSelectionForLayerReplacement(obj, selection);
  if (!replacementSelection?.hasSelection) return replacementSelection;
  let replacementRange = textEditVisibleSelectionDeleteRange(obj, replacementSelection) || replacementSelection;
  const text = normalizeTextContent(obj?.data?.content || '');
  const rawStart = Math.max(0, Math.min(selection?.start ?? 0, text.length));
  const rawEnd = Math.max(rawStart, Math.min(selection?.end ?? rawStart, text.length));
  const containingRange = textEditScriptRanges(obj)
    .filter((range) => (
      typeof isTextScriptBracedRange === 'function' &&
      isTextScriptBracedRange(text, range) &&
      (rawStart === range.start || rawStart === range.start + 1) &&
      rawEnd <= range.end - 1
    ))
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  if (containingRange) {
    replacementRange = {
      start: Math.max(replacementRange.start, containingRange.start + 1),
      end: Math.min(replacementRange.end, containingRange.end - 1),
    };
  }
  return replacementRange;
};

const textEditVisibleDeleteRange = (obj, index, key) => {
  if (!obj || (key !== 'Backspace' && key !== 'Delete')) return null;
  const text = normalizeTextContent(obj.data?.content || '');
  const ranges = textEditScriptRanges(obj);
  if (!text.length) return null;
  const backward = key === 'Backspace';
  const caret = normalizeTextEditVisibleCaretIndex(obj, index, backward ? 'backward' : 'forward');
  const affinity = obj?._textScriptCaretIndex === caret ? obj._textScriptCaretAffinity : '';
  if (affinity === 'after' && (backward || caret >= text.length)) {
    const previousCompound = textEditCompoundScriptDeleteRangeBeforeCaret(obj, caret, text, ranges);
    if (previousCompound) return previousCompound;
  }
  let target = backward ? caret - 1 : caret;
  const step = backward ? -1 : 1;
  while (target >= 0 && target < text.length && isTextEditScriptMarkerHiddenAt(obj, target, text, ranges)) {
    target += step;
  }
  if (target < 0 || target >= text.length) return null;

  return textEditVisibleSelectionDeleteRange(obj, { start: target, end: target + 1 });
};

const textEditScriptMarkerInsertionIndexAt = (obj, index) => {
  if (!obj || typeof isTextScriptMarkerHiddenAt !== 'function') return null;
  const text = normalizeTextContent(obj.data?.content || '');
  const ranges = textEditScriptRanges(obj);
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  const currentRange = ranges.find((range) => range.start === pos || range.start - 1 === pos);
  if (!currentRange) return null;

  let insertIndex = currentRange.start - 1;
  if (!isTextEditScriptMarkerHiddenAt(obj, insertIndex, text, ranges)) return null;
  let changed = true;
  while (changed) {
    changed = false;
    for (const range of ranges) {
      const markerIndex = range.start - 1;
      if (markerIndex < 0 || markerIndex >= insertIndex) continue;
      if (range.end !== insertIndex) continue;
      if (!isTextEditScriptMarkerHiddenAt(obj, markerIndex, text, ranges)) continue;
      insertIndex = markerIndex;
      changed = true;
    }
  }
  return insertIndex;
};

const canAutoOpenTextScriptBraceAt = (content, index) => {
  const text = normalizeTextContent(content);
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  if (pos <= 0) return false;
  const base = text[pos - 1];
  if (!base || (typeof isTextWordOrLineSeparator === 'function' ? isTextWordOrLineSeparator(base) : /\s/.test(base))) return false;
  if (typeof textScriptKindForMarker === 'function' && textScriptKindForMarker(base)) return false;
  return base !== '{';
};

const textEditBracedScriptBoundaryInsertionAt = (obj, index) => {
  if (!obj || typeof isTextScriptBracedRange !== 'function') return null;
  const text = normalizeTextContent(obj.data?.content || '');
  const pos = Math.max(0, Math.min(Math.trunc(index ?? 0), text.length));
  const affinity = obj._textScriptCaretIndex === pos ? obj._textScriptCaretAffinity : '';
  if (affinity === 'after') return null;
  const range = textEditScriptRanges(obj)
    .filter((item) => item.end === pos && isTextScriptBracedRange(text, item))
    .sort((a, b) => b.start - a.start || a.end - b.end)[0];
  if (!range || range.end - 1 <= range.start) return null;
  return { index: range.end - 1, affinity: 'after' };
};

const isTextScriptHiddenOpeningOrMarkerAt = (ranges, index, content = '') => {
  if (index < 0) return false;
  for (const range of ranges || []) {
    if (range.start === index + 1) return true;
    if (typeof isTextScriptBracedRange === 'function' && isTextScriptBracedRange(content, range) && index === range.start) {
      return true;
    }
  }
  return false;
};

const textScriptHiddenClosingBraceRangeAt = (ranges, index, content = '') => {
  if (index < 0 || content[index] !== '}') return null;
  for (const range of ranges || []) {
    if (typeof isTextScriptBracedRange !== 'function' || !isTextScriptBracedRange(content, range)) continue;
    if (range.end - 1 !== index) continue;
    return range;
  }
  return null;
};

const isTextScriptHiddenClosingBraceAt = (ranges, index, content = '', minMarkerIndex = 0) => {
  const range = textScriptHiddenClosingBraceRangeAt(ranges, index, content);
  return !!range && range.start - 1 >= minMarkerIndex;
};

const normalizeTextSelectionScriptHiddenBounds = (content, selection, ranges = []) => {
  const text = normalizeTextContent(content);
  const rawStart = Math.max(0, Math.min(selection?.start ?? 0, text.length));
  const rawEnd = Math.max(rawStart, Math.min(selection?.end ?? rawStart, text.length));
  let start = rawStart;
  let end = rawEnd;
  while (
    start < end &&
    typeof isTextScriptMarkerHiddenAt === 'function' &&
    isTextScriptMarkerHiddenAt(ranges, start, text)
  ) {
    start++;
  }
  while (end > start && isTextScriptHiddenOpeningOrMarkerAt(ranges, end - 1, text)) {
    end--;
  }
  while (end > start) {
    const closingRange = textScriptHiddenClosingBraceRangeAt(ranges, end - 1, text);
    if (!closingRange || closingRange.start - 1 >= start) break;
    end--;
  }
  while (end < text.length && isTextScriptHiddenClosingBraceAt(ranges, end, text, start)) {
    end++;
  }
  return { start, end };
};

const textSelectionBracedRangeNeedsCompletion = (content, range, start, end) => {
  if (typeof isTextScriptBracedRange !== 'function' || !isTextScriptBracedRange(content, range)) return false;
  if (end >= range.end) return false;
  const markerIndex = range.start - 1;
  if (markerIndex < start || range.start >= end) return false;
  return end > range.start + 1;
};

const completeTextSelectionBracedScriptRanges = (content, start, end, selectedText, rangeEntries = [], sourceRanges = []) => {
  let text = normalizeTextContent(selectedText);
  const entries = rangeEntries.map((entry) => ({ ...entry }));
  const missingClosings = [];
  for (const range of sourceRanges || []) {
    if (textSelectionBracedRangeNeedsCompletion(content, range, start, end)) missingClosings.push(range);
  }
  missingClosings.sort((a, b) => b.start - a.start || a.end - b.end);

  for (const range of missingClosings) {
    const relativeStart = range.start - start;
    if (relativeStart < 0 || relativeStart >= text.length) continue;
    const closeIndex = text.length;
    text += '}';
    const entry = entries.find((item) => item.sourceRange === range);
    if (entry) {
      entry.end = closeIndex + 1;
    } else {
      entries.push({
        start: relativeStart,
        end: closeIndex + 1,
        kind: range.kind,
        sourceRange: range,
      });
    }
  }

  return {
    text,
    scriptRanges: entries.map(({ start: rangeStart, end: rangeEnd, kind }) => ({
      start: rangeStart,
      end: rangeEnd,
      kind,
    })),
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
    ? textScriptLinearToDeterministicBraces(completed.text, normalizedScriptRanges)
    : typeof textContentWithCanonicalScriptBraces === 'function'
      ? textContentWithCanonicalScriptBraces(completed.text, normalizedScriptRanges)
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
      : (clipboard.scriptRanges || []).map((range) => ({ ...range }));
    return { type: 'text-selection', text, scriptRanges };
  }
  if (clipboard.type === 'objects') {
    const textObjects = (clipboard.objects || []).filter((obj) => obj?.type === 'text');
    if (textObjects.length !== 1 || (clipboard.objects || []).length !== 1) return null;
    const source = textObjects[0];
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

const textScriptRangesEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].start !== b[i].start || a[i].end !== b[i].end || a[i].kind !== b[i].kind) return false;
  }
  return true;
};

const textScriptActiveRangesAtIndex = (ranges, index, options = {}) => {
  if (typeof activeTextScriptRangesAt === 'function') {
    return activeTextScriptRangesAt(ranges, index, options).map((range) => ({ ...range }));
  }
  const includeEnd = options.includeEnd === true;
  const affinity = options.affinity || '';
  return (ranges || [])
    .filter((range) => {
      if (index < range.start || index > range.end) return false;
      if (index === range.end) {
        if (!includeEnd) return false;
        if (affinity === 'after') return false;
      }
      return true;
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || String(a.kind).localeCompare(String(b.kind)))
    .map((range) => ({ ...range }));
};

const textScriptActiveRangesAtCaret = (obj, index) => {
  const ranges = textEditScriptRanges(obj);
  const affinity = obj?._textScriptCaretIndex === index ? obj._textScriptCaretAffinity : '';
  return textScriptActiveRangesAtIndex(ranges, index, { includeEnd: true, affinity });
};

const textScriptCaretRangesForEditState = (scriptRanges, index, affinity = '') => (
  textScriptActiveRangesAtIndex(scriptRanges || [], index, { includeEnd: true, affinity }).map((range) => ({ ...range }))
);

const textScriptRangeEndingAt = (ranges, index) => {
  const candidates = (ranges || []).filter((range) => range.end === index);
  candidates.sort((a, b) => b.start - a.start || a.end - b.end || String(a.kind).localeCompare(String(b.kind)));
  return candidates[0] || null;
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

const addOrMergeTextScriptRange = (ranges, range) => {
  if (!range || !range.kind) return false;
  const existing = ranges.find((item) => item.start === range.start && item.kind === range.kind);
  if (existing) {
    existing.end = Math.max(existing.end, range.end);
    return true;
  }
  ranges.push({ ...range });
  return true;
};

const shouldExitTextScriptAt = (obj, index, affinity = '') => {
  if (!obj || index == null || affinity === 'after') return false;
  return textEditScriptRanges(obj).some((range) => range.end === index && isTextScriptRangeActiveAt(range, index, affinity));
};

const isTextScriptSpaceKeyEvent = (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === ' ' || e.key === 'Spacebar';
};

const isTextScriptInsertSpaceInput = (event) => {
  return event?.inputType === 'insertText' && event?.data === ' ';
};

const isTextScriptSpaceEvent = (event) => {
  if (!event) return true;
  if (isTextScriptInsertSpaceInput(event)) return true;
  return isTextScriptSpaceKeyEvent(event);
};

const textScriptCurrentRangeAt = (obj, index, affinity = '') => {
  const active = textEditScriptRanges(obj)
    .filter((range) => isTextScriptRangeActiveAt(range, index, affinity))
    .sort((a, b) => b.start - a.start || a.end - b.end);
  return active[0] || null;
};

const textScriptPendingRangeAt = (obj, index) => {
  if (!obj || obj.type !== 'text') return null;
  const text = normalizeTextContent(obj.data?.content || '');
  const caret = Math.max(0, Math.min(index ?? 0, text.length));
  const resolvedMarkerIndexes = new Set(textEditScriptRanges(obj).map((range) => range.start - 1));
  for (let markerIndex = caret - 1; markerIndex > 0; markerIndex--) {
    if (resolvedMarkerIndexes.has(markerIndex)) continue;
    const kind = typeof textScriptKindForMarker === 'function' ? textScriptKindForMarker(text[markerIndex]) : '';
    if (!kind) continue;
    if (typeof canOpenTextScriptAt === 'function' && !canOpenTextScriptAt(text, markerIndex)) continue;
    const start = markerIndex + 1;
    if (start >= caret) continue;
    let crossesSeparator = false;
    for (let i = start; i < caret; i++) {
      if (typeof isTextWordOrLineSeparator === 'function' ? isTextWordOrLineSeparator(text[i]) : /\s/.test(text[i])) {
        crossesSeparator = true;
        break;
      }
    }
    if (crossesSeparator) continue;
    return { start, end: caret, kind };
  }
  return null;
};

const commitPendingTextScriptAt = (obj, index) => {
  if (!obj || typeof normalizeTextScriptRangesForContent !== 'function') return null;
  const range = textScriptPendingRangeAt(obj, index);
  if (!range) return null;
  const content = normalizeTextContent(obj.data?.content || '');
  const ranges = [...textEditScriptRanges(obj), range];
  obj.data.content = content;
  const normalized = normalizeTextScriptRangesForContent(content, ranges);
  if (normalized.length) obj.data.scriptRanges = normalized;
  else delete obj.data.scriptRanges;
  const caret = Math.max(0, Math.min(index ?? 0, content.length));
  const committed = normalized.find((item) => item.start === range.start && item.end === range.end && item.kind === range.kind) || range;
  setTextScriptCaretAffinity(obj, caret, 'after');
  invalidateTextEditObjectLayout(obj);
  return { ...committed, caret, content };
};

const handleTextScriptCommitSpace = (obj, proxy, e = null) => {
  return false;
};

const exitTextScriptForLineBreak = (obj, proxy) => {
  if (!obj || !proxy || proxy.selectionStart !== proxy.selectionEnd) return false;
  const pos = proxy.selectionStart;
  const affinity = obj._textScriptCaretIndex === pos ? obj._textScriptCaretAffinity : '';
  const active = textEditScriptRanges(obj).filter((range) => isTextScriptRangeActiveAt(range, pos, affinity));
  if (!active.length) return false;
  const nextPos = Math.max(...active.map((range) => range.end));
  if (proxy.selectionStart !== nextPos || proxy.selectionEnd !== nextPos) {
    proxy.setSelectionRange(nextPos, nextPos, 'none');
  }
  setTextScriptCaretAffinity(obj, nextPos, 'after');
  return true;
};

const textScriptCaretAffinityForInput = (obj, proxy, event, selection) => {
  const start = selection?.start ?? proxy?.selectionStart ?? 0;
  return obj?._textScriptCaretIndex === start ? obj._textScriptCaretAffinity : '';
};

const textScriptRangesMatch = (a, b) => (
  !!a && !!b && a.start === b.start && a.end === b.end && a.kind === b.kind
);

const textScriptRangeForDeleteUncommit = (obj, index, key) => {
  if (!obj || obj.type !== 'text') return null;
  const text = normalizeTextContent(obj.data?.content || '');
  const pos = Math.max(0, Math.min(index ?? 0, text.length));
  const ranges = textEditScriptRanges(obj);
  const candidates = ranges.filter((range) => {
    if (typeof isTextScriptBracedRange === 'function' && isTextScriptBracedRange(text, range)) return false;
    const markerIndex = range.start - 1;
    if (key === 'Delete') return markerIndex <= pos && pos < range.end;
    return markerIndex < pos && pos <= range.end;
  });
  candidates.sort((a, b) => (a.start - b.start) || (b.end - a.end) || String(a.kind).localeCompare(String(b.kind)));
  return candidates[0] || null;
};

const bracedTextScriptStructuralRangeAt = (ranges, index, content = '') => {
  if (typeof isTextScriptBracedRange !== 'function') return null;
  for (const range of ranges || []) {
    if (!isTextScriptBracedRange(content, range)) continue;
    if (index === range.start - 1 || index === range.start || index === range.end - 1) return range;
  }
  return null;
};

const bracedTextScriptBoundaryForCompoundDelete = (ranges, index, key, content = '') => {
  if (typeof isTextScriptBracedRange !== 'function' || typeof textScriptCompoundBoundsForRange !== 'function') return null;
  const text = normalizeTextContent(content);
  const pos = Math.max(0, Math.min(index ?? 0, text.length));
  if (
    typeof textScriptRawCompoundBoundsAtCaret === 'function' &&
    textScriptRawCompoundBoundsAtCaret(text, ranges, pos).length
  ) {
    return null;
  }
  const candidates = [];
  for (const range of ranges || []) {
    if (!isTextScriptBracedRange(text, range)) continue;
    const bounds = textScriptCompoundBoundsForRange(text, range);
    if (!bounds || (pos > bounds.start && pos < bounds.end)) continue;
    if ((key === 'Backspace' && pos === bounds.end) || (key === 'Delete' && pos === bounds.start)) {
      candidates.push({ range, bounds });
    }
  }
  candidates.sort((a, b) => (a.bounds.start - b.bounds.start) || (b.bounds.end - a.bounds.end));
  return candidates[0] || null;
};

const handleTextLayerDelete = (obj, proxy, e) => {
  if (!obj || !proxy || (e.key !== 'Backspace' && e.key !== 'Delete')) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return false;
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
  if (typeof normalizeTextScriptRangesForContent !== 'function') return [];
  const oldText = normalizeTextContent(oldValue);
  const nextText = normalizeTextContent(newValue);
  const editStart = Math.max(0, Math.min(start, oldText.length));
  const editEnd = Math.max(editStart, Math.min(end, oldText.length));
  const inserted = String(insertedText ?? '');
  const insertedLength = inserted.length;
  const removedLength = editEnd - editStart;
  const delta = insertedLength - removedLength;
  const pureInsertion = removedLength === 0 && insertedLength > 0;
  let expandedScript = null;

  const ranges = [];
  for (const range of oldRanges || []) {
    if (
      !pureInsertion &&
      insertedLength > 0 &&
      typeof isTextScriptBracedRange === 'function' &&
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
      typeof isTextScriptBracedRange === 'function' &&
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
    const active = isTextScriptRangeActiveAt(range, editStart, caretAffinity);
    if (pureInsertion) {
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

  const normalizedInsertedRanges = insertedLength > 0
    ? normalizeTextScriptRangesForContent(inserted, insertedScriptRanges)
    : [];
  for (const range of normalizedInsertedRanges) {
    ranges.push({
      start: editStart + range.start,
      end: editStart + range.end,
      kind: range.kind,
    });
  }

  const derivedRanges = typeof deriveBracedTextScriptRangesFromContent === 'function'
    ? deriveBracedTextScriptRangesFromContent(nextText)
    : [];
  const normalized = normalizeTextScriptRangesForContent(nextText, [...ranges, ...derivedRanges]);
  const active = normalized.find((range) => expandedScript && range.start === expandedScript.start && range.kind === expandedScript.kind) || null;
  return { ranges: normalized, active };
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
    ? inputState.scriptCaretRanges.map((range) => ({ ...range }))
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

const updateTextLineAlignForInput = (obj, inputState, nextValue, insertedText) => {
  if (!obj || typeof normalizeTextLineAlignForContent !== 'function') return;
  if (!Array.isArray(obj.data?.lineAlign)) return;
  const oldValue = normalizeTextContent(inputState?.value ?? '');
  const oldAlign = normalizeTextLineAlignForContent(oldValue, obj.data.lineAlign);
  const oldStart = Math.max(0, Math.min(inputState?.start ?? 0, oldValue.length));
  const oldEnd = Math.max(oldStart, Math.min(inputState?.end ?? oldStart, oldValue.length));
  const removedLineCount = textLogicalLineIndexAt(oldValue, oldEnd) - textLogicalLineIndexAt(oldValue, oldStart);
  const insertedLineCount = String(insertedText ?? '').split('\n').length - 1;
  if (removedLineCount || insertedLineCount) {
    const lineIndex = textLogicalLineIndexAt(oldValue, oldStart);
    const baseAlign = oldAlign[lineIndex] || 'left';
    while (oldAlign.length < textLogicalLineCount(oldValue)) oldAlign.push('left');
    oldAlign.splice(lineIndex + 1, removedLineCount, ...new Array(insertedLineCount).fill(baseAlign));
  }
  const normalized = normalizeTextLineAlignForContent(nextValue, oldAlign);
  if (normalized.length) obj.data.lineAlign = normalized;
  else delete obj.data.lineAlign;
};

const applyTextAlignmentShortcut = (obj, proxy, direction) => {
  if (!obj || obj.type !== 'text' || typeof applyTextLineAlignmentRange !== 'function') return false;
  const selection = proxy ? textEditSelectionState(proxy) : { start: 0, end: normalizeTextContent(obj.data?.content).length };
  const range = textLogicalLineRangeForSelection(obj.data?.content || '', selection);
  const changed = applyTextLineAlignmentRange(obj, range.startLine, range.endLine, direction);
  if (!changed) return false;
  markDirty(obj.id);
  globalThis.BoardfishMotion?.applyActionAnimation?.('text-align');
  scheduleRender(true, true, 'text-align');
  pushHistory('text-align');
  return true;
};

const copyTextEditSelectionFromProxy = async (id, proxy, selection = textEditSelectionState(proxy)) => {
  if (!selection?.hasSelection || !proxy) return false;
  const obj = objectsMap.get(id);
  const sourceObj = obj ? { ...obj, data: { ...obj.data, content: proxy.value } } : null;
  const payload = sourceObj
    ? createTextSelectionClipboardPayload(sourceObj, selection)
    : { type: 'text-selection', text: textSelectionForClipboard(proxy.value.slice(selection.start, selection.end)), scriptRanges: [] };
  const clipboardText = payload.text;
  if (clipboardText && typeof setJsClipboard === 'function') {
    setJsClipboard({
      type: 'text-selection',
      text: clipboardText,
      scriptRanges: payload.scriptRanges || [],
    });
  } else if (typeof clearJsClipboard === 'function') {
    clearJsClipboard();
  }
  if (editingId === id && _editEl === proxy) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('copy-text-selection', {
      textSelection: {
        id,
        ...selection,
      },
    });
    scheduleRender(true, false, 'copy-text-selection');
  }
  const meta = {};
  if (typeof getJsClipboardWebToken === 'function') {
    const webToken = getJsClipboardWebToken();
    if (webToken) meta.boardfishToken = webToken;
  }
  BoardfishClipboardIO.copyTextToClipboard(clipboardText, null, meta)
    .then((result) => {
      if (result?.boardfishTokenWritten && meta.boardfishToken) {
        if (typeof markJsClipboardWebTokenWritten === 'function') {
          markJsClipboardWebTokenWritten(meta.boardfishToken);
        }
      }
    })
    .catch((err) => console.error('[copy] text selection clipboard write FAILED:', err));
  return true;
};

const boardfishTextClipboardStillCurrent = async (event = null) => {
  if (typeof jsClipboard === 'undefined' || !jsClipboard) return false;
  if (typeof jsClipboardStillCurrent !== 'function') return true;
  let webClipboardTokenChecked = false;
  let webClipboardToken = '';
  if (
    event?.clipboardData &&
    typeof BoardfishClipboardIO !== 'undefined' &&
    typeof BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent === 'function'
  ) {
    webClipboardTokenChecked = true;
    webClipboardToken = BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(event.clipboardData);
  } else if (
    typeof BoardfishClipboardIO !== 'undefined' &&
    typeof BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser === 'function'
  ) {
    try {
      const result = await BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser();
      webClipboardTokenChecked = result?.checked === true;
      webClipboardToken = result?.token || '';
    } catch (_) {}
  }
  return jsClipboardStillCurrent(null, {
    webClipboardTokenChecked,
    webClipboardToken,
  });
};

const readBoardfishTextClipboardPayloadForPaste = async (event = null) => {
  const payload = currentBoardfishTextSelectionClipboardPayload();
  if (!payload) return null;
  const current = await boardfishTextClipboardStillCurrent(event);
  if (!current) {
    if (typeof clearJsClipboard === 'function') clearJsClipboard();
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

const editableTextScriptPayload = (payload = {}) => {
  const brace = typeof textScriptLinearToDeterministicBraces === 'function'
    ? textScriptLinearToDeterministicBraces
    : (typeof textContentWithCanonicalScriptBraces === 'function' ? textContentWithCanonicalScriptBraces : null);
  const text = normalizeTextContent(
    typeof brace === 'function'
      ? brace(payload.text || '', payload.scriptRanges || [])
      : (payload.text || '')
  );
  const scriptRanges = typeof normalizeTextScriptRangesForContent === 'function'
    ? normalizeTextScriptRangesForContent(text, [
      ...(typeof deriveBracedTextScriptRangesFromContent === 'function' ? deriveBracedTextScriptRangesFromContent(text) : []),
    ])
    : [];
  return { text, scriptRanges };
};

const replaceTextEditSelectionWithPayload = (id, proxy, payload, options = {}) => {
  if (!proxy || !payload) return false;
  const editablePayload = editableTextScriptPayload(payload);
  const text = editablePayload.text;
  if (!text) return false;
  const obj = objectsMap.get(id);
  if (!obj) return false;
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
  const inputState = {
    ...selection,
    value: proxy.value,
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
  inputState.scriptCaretRanges = textScriptCaretRangesForEditState(inputState.scriptRanges, inputState.start, inputState.scriptCaretAffinity);
  beginTextEditHistoryAction(id, inputState, {
    splitPending: shouldCommitTextEditInputImmediately(inputType, inputState.hasSelection),
  });
  setPendingTextEditInputState(proxy, inputState);
  proxy.setSelectionRange(replacementRange.start, replacementRange.end, selection.direction || 'none');
  proxy.setRangeText(text, replacementRange.start, replacementRange.end, 'end');
  _caretVisible = true;
  dispatchTextEditInputEvent(proxy, inputType);
  if (options.immediateHistory) flushEditHistoryCheckpoint();
  return true;
};

const pasteBoardfishTextSelectionIntoEditSelection = async (options = {}) => {
  const proxy = options.proxy || _editEl;
  const id = options.id || editingId;
  const payload = await readBoardfishTextClipboardPayloadForPaste(options.event || null);
  if (!payload) return false;
  return replaceTextEditSelectionWithPayload(id, proxy, payload, {
    immediateHistory: options.immediateHistory,
    selection: options.selection,
    inputType: 'insertFromPaste',
  });
};

function enterEdit(id, { history = true, preserveSize = false } = {}) {
  if (editingId === id) return;
  if (editingId) exitEdit();
  editingId = id;

  const obj = objectsMap.get(id);
  if (!obj) return;
  globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-enter');
  const normalized = normalizeTextContent(obj.data.content);
  if (normalized !== obj.data.content) {
    obj.data.content = normalized;
    delete obj._layoutCache;
    delete obj._layoutCacheKey;
    _linesCacheMap.delete(obj.id);
    markDirty(obj.id);
  }
  if (typeof normalizeTextScriptRangesForContent === 'function' && Array.isArray(obj.data?.scriptRanges)) {
    const scriptRanges = normalizeTextScriptRangesForContent(obj.data.content, obj.data.scriptRanges);
    if (scriptRanges.length) obj.data.scriptRanges = scriptRanges;
    else delete obj.data.scriptRanges;
  }
  if (normalizeTextObjectToEditableScriptBraces(obj)) {
    markDirty(obj.id);
  }
  if (typeof normalizeTextLineAlignForContent === 'function' && Array.isArray(obj.data?.lineAlign)) {
    const lineAlign = normalizeTextLineAlignForContent(obj.data.content, obj.data.lineAlign);
    if (lineAlign.length) obj.data.lineAlign = lineAlign;
    else delete obj.data.lineAlign;
  }
  clearTextScriptCaretAffinity(obj);
  obj._editStartContent = obj.data.content;
  obj._editMinLines = textEditMinLinesForSession(obj, { preserveSize });
  _editHistoryLastContent = obj.data.content;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;

  const proxy = document.createElement('textarea');
  proxy.id = 'editor-proxy';
  proxy.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;';
  proxy.value = obj.data.content;
  document.body.appendChild(proxy);
  _editEl = proxy;

  let pendingInputState = null;
  proxy._boardfishSetPendingInputState = (state) => { pendingInputState = state; };
  proxy.addEventListener('beforeinput', (event) => {
    let selection = textEditSelectionState(proxy);
    const insertedMarker = event?.inputType === 'insertText' &&
      typeof event.data === 'string' &&
      event.data.length === 1 &&
      typeof textScriptKindForMarker === 'function' &&
      textScriptKindForMarker(event.data);
    if (selection.start === selection.end && insertedMarker) {
      const boundaryInsertion = textEditBracedScriptBoundaryInsertionAt(obj, selection.start);
      const scriptInsertIndex = textEditScriptMarkerInsertionIndexAt(obj, selection.start);
      const insertIndex = boundaryInsertion?.index ??
        (scriptInsertIndex != null && scriptInsertIndex < selection.start
        ? scriptInsertIndex
        : selection.start);
      if (canAutoOpenTextScriptBraceAt(proxy.value, insertIndex)) {
        event.preventDefault();
        const inputType = 'insertText';
        const insertedText = `${event.data}{`;
        pendingInputState = {
          start: insertIndex,
          end: insertIndex,
          direction: 'none',
          hasSelection: false,
          value: proxy.value,
          scriptRanges: textEditScriptRanges(obj),
          scriptCaretAffinity: boundaryInsertion?.affinity || '',
          scriptCaretRanges: [],
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
          value: proxy.value,
          scriptRanges: textEditScriptRanges(obj),
          scriptCaretAffinity: boundaryInsertion.affinity,
          scriptCaretRanges: textScriptCaretRangesForEditState(
            textEditScriptRanges(obj),
            boundaryInsertion.index,
            boundaryInsertion.affinity
          ),
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
        value: proxy.value,
        scriptRanges: textEditScriptRanges(obj),
        scriptCaretAffinity: '',
        scriptCaretRanges: [],
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
    }
    const scriptRanges = textEditScriptRanges(obj);
    const scriptCaretAffinity = textScriptCaretAffinityForInput(obj, proxy, event, selection);
    pendingInputState = {
      ...selection,
      value: proxy.value,
      scriptRanges,
      scriptCaretAffinity,
      scriptCaretRanges: textScriptCaretRangesForEditState(scriptRanges, selection.start, scriptCaretAffinity),
      inputType: event?.inputType || '',
    };
    beginTextEditHistoryAction(id, pendingInputState, {
      splitPending: shouldCommitTextEditInputImmediately(pendingInputState.inputType, pendingInputState.hasSelection),
    });
  });
  proxy.addEventListener('input', (event) => {
    const inputState = pendingInputState || proxy._boardfishPendingInputState || textEditSelectionState(proxy);
    pendingInputState = null;
    proxy._boardfishPendingInputState = null;
    globalThis.BoardfishMotion?.applyActionAnimation?.(textEditActionFromInputType(event?.inputType));
    markDirty(id);
    const nextRawValue = normalizeTextContent(proxy.value);
    const oldValue = normalizeTextContent(inputState.value ?? obj.data.content ?? '');
    const replacement = inputState.replacement || textEditInputReplacement(oldValue, nextRawValue, inputState, event?.inputType || inputState.inputType || '');
    obj.data.content = normalizeTextContent(proxy.value);
    if (proxy.value !== obj.data.content) {
      const start = proxy.selectionStart;
      const end = proxy.selectionEnd;
      const direction = proxy.selectionDirection || 'none';
      proxy.value = obj.data.content;
      proxy.setSelectionRange(start, end, direction);
    }
    updateTextLineAlignForInput(obj, { ...inputState, value: oldValue, start: replacement.start, end: replacement.end }, obj.data.content, replacement.insertedText);
    const scriptResult = transformTextScriptRangesForInput(inputState.scriptRanges || textEditScriptRanges(obj), {
      oldValue,
      newValue: obj.data.content,
      start: replacement.start,
      end: replacement.end,
      insertedText: replacement.insertedText,
      insertedScriptRanges: inputState.insertedScriptRanges || [],
      caretAffinity: inputState.scriptCaretAffinity || '',
    });
    const preservedCaretRanges = textScriptCaretRangesAfterInput(inputState, {
      oldValue,
      newValue: obj.data.content,
      replacement,
      inputType: event?.inputType || inputState.inputType || '',
    });
    if (scriptResult.ranges?.length) obj.data.scriptRanges = scriptResult.ranges;
    else delete obj.data.scriptRanges;
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
    if (proxy.selectionStart === proxy.selectionEnd) setTextEditCaretIndex(obj, proxy.selectionStart);
    else clearTextEditCaretIndex(obj);
    invalidateTextEditObjectLayout(obj);
    const heightChanged = syncTextAutoHeight(obj, getTextMinLines(obj));
    const nextSelectionState = textEditSelectionState(proxy);
    _textInputSelectionHistorySuppress = {
      start: nextSelectionState.start,
      end: nextSelectionState.end,
    };
    recordTextEditInputHistory(id, {
      inputType: event?.inputType || inputState.inputType || '',
      hadSelection: !!inputState.hasSelection,
    });
    scheduleRender(true, heightChanged);
  });
  proxy.addEventListener('paste', (event) => {
    const candidate = currentBoardfishTextSelectionClipboardPayload();
    const fallbackText = typeof BoardfishClipboardIO !== 'undefined'
      ? BoardfishClipboardIO.readClipboardTextFromEvent?.(event.clipboardData) || ''
      : '';
    if (!candidate && !fallbackText) return;
    event.preventDefault();
    const selection = textEditSelectionState(proxy);
    if (!candidate) {
      replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
        scriptRanges: [],
      }, {
        selection,
        inputType: 'insertFromPaste',
      });
      return;
    }
    pasteBoardfishTextSelectionIntoEditSelection({
      id,
      proxy,
      event,
      selection,
      immediateHistory: false,
    }).then((pasted) => {
      if (pasted || !fallbackText) return;
      replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
        scriptRanges: [],
      }, {
        selection,
        inputType: 'insertFromPaste',
      });
    }).catch((err) => {
      console.error('[paste] Boardfish text selection paste FAILED:', err);
      if (!fallbackText) return;
      replaceTextEditSelectionWithPayload(id, proxy, {
        text: fallbackText,
        scriptRanges: [],
      }, {
        selection,
        inputType: 'insertFromPaste',
      });
    });
  });
  proxy.addEventListener('blur', () => {
    flushEditHistoryCheckpoint();
  });
  proxy.addEventListener('keydown', (e) => {
    _caretVisible = true;

    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const selection = textEditSelectionState(proxy);
      const indentResult = applyTextEditLineIndent(proxy.value, selection, { outdent: e.shiftKey });
      if (!indentResult.changed) {
        scheduleRender(true, false);
        return;
      }
      const inputType = e.shiftKey ? 'deleteContentBackward' : 'insertText';
      pendingInputState = {
        ...selection,
        value: proxy.value,
        scriptRanges: textEditScriptRanges(obj),
        scriptCaretAffinity: obj._textScriptCaretIndex === proxy.selectionStart ? obj._textScriptCaretAffinity : '',
        inputType,
      };
      beginTextEditHistoryAction(id, pendingInputState, {
        splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
      });
      proxy.value = indentResult.value;
      proxy.setSelectionRange(indentResult.start, indentResult.end, indentResult.direction);
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if (e.key === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      exitTextScriptForLineBreak(obj, proxy);
      const selection = textEditSelectionState(proxy);
      const lineBreakResult = applyTextEditLineBreakIndent(proxy.value, selection);
      const inputType = 'insertLineBreak';
      pendingInputState = {
        ...selection,
        value: proxy.value,
        scriptRanges: textEditScriptRanges(obj),
        scriptCaretAffinity: obj._textScriptCaretIndex === proxy.selectionStart ? obj._textScriptCaretAffinity : '',
        inputType,
      };
      beginTextEditHistoryAction(id, pendingInputState, {
        splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
      });
      proxy.value = lineBreakResult.value;
      proxy.setSelectionRange(lineBreakResult.start, lineBreakResult.end, lineBreakResult.direction);
      dispatchTextEditInputEvent(proxy, inputType);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && proxy.selectionStart !== proxy.selectionEnd) {
      e.preventDefault();
      copyTextEditSelectionFromProxy(id, proxy);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && proxy.selectionStart !== proxy.selectionEnd) {
      e.preventDefault();
      copyTextEditSelectionFromProxy(id, proxy);
      const selection = textEditSelectionState(proxy);
      const deletion = textEditVisibleSelectionDeleteRange(obj, selection) || selection;
      const inputType = 'deleteByCut';
      pendingInputState = {
        ...selection,
        value: proxy.value,
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
      flushEditHistoryCheckpoint();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      proxy.setSelectionRange(0, proxy.value.length, 'none');
      TextSelDebug._logSelection('select-all', proxy);
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-select-all');
      scheduleRender(true, false);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      applyTextAlignmentShortcut(obj, proxy, e.key === 'ArrowRight' ? 'right' : 'left');
      return;
    }

    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      const selection = textEditSelectionState(proxy);
      const direction = e.key === 'ArrowLeft' ? 'backward' : 'forward';
      let nextPos;
      let scriptLayerMove = false;
      if (selection.hasSelection && !e.shiftKey) {
        nextPos = normalizeTextEditVisibleCaretIndex(obj, direction === 'backward' ? selection.start : selection.end, direction);
        proxy.setSelectionRange(nextPos, nextPos, 'none');
      } else if (e.shiftKey) {
        const activePos = selection.direction === 'backward' ? selection.start : selection.end;
        const anchorPos = selection.direction === 'backward' ? selection.end : selection.start;
        nextPos = moveTextEditVisibleCaret(obj, activePos, direction);
        proxy.setSelectionRange(
          Math.min(anchorPos, nextPos),
          Math.max(anchorPos, nextPos),
          anchorPos <= nextPos ? 'forward' : 'backward'
        );
      } else {
        const layerMove = moveTextEditCaretScriptLayer(obj, selection.start, direction);
        if (layerMove) {
          nextPos = layerMove.index;
          proxy.setSelectionRange(nextPos, nextPos, 'none');
          if (layerMove.affinity === 'after') {
            setTextScriptCaretAffinity(obj, nextPos, 'after');
          } else {
            clearTextScriptCaretAffinity(obj);
            setTextEditCaretIndex(obj, nextPos);
          }
          scriptLayerMove = true;
        } else {
          nextPos = moveTextEditVisibleCaret(obj, selection.start, direction);
          proxy.setSelectionRange(nextPos, nextPos, 'none');
        }
      }
      if (proxy.selectionStart === proxy.selectionEnd) {
        if (!scriptLayerMove) setTextEditCaretIndex(obj, proxy.selectionStart);
      } else {
        clearTextEditCaretIndex(obj);
      }
      if (!scriptLayerMove) clearTextScriptCaretAffinity(obj);
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-caret-move');
      scheduleRender(true, false);
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const selection = textEditSelectionState(proxy);
      const direction = e.key === 'Backspace' ? 'backward' : 'forward';
      let normalizedSelection = selection;
      let deletion = null;
      if (selection.hasSelection) {
        deletion = textEditVisibleSelectionDeleteRange(obj, selection);
      } else {
        const caret = normalizeTextEditVisibleCaretIndex(obj, selection.start, direction);
        if (caret !== selection.start) proxy.setSelectionRange(caret, caret, 'none');
        normalizedSelection = {
          start: caret,
          end: caret,
          direction: 'none',
          hasSelection: false,
        };
        deletion = textEditVisibleDeleteRange(obj, caret, e.key);
      }
      if (deletion && deletion.end > deletion.start) {
        e.preventDefault();
        const inputType = e.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward';
        const replacement = textEditStructuralDeleteReplacement(obj, deletion);
        pendingInputState = {
          ...normalizedSelection,
          value: proxy.value,
          scriptRanges: textEditScriptRanges(obj),
          scriptCaretAffinity: !normalizedSelection.hasSelection && obj._textScriptCaretIndex === normalizedSelection.start ? obj._textScriptCaretAffinity : '',
          inputType,
          replacement: {
            start: replacement.start,
            end: replacement.end,
            insertedText: replacement.insertedText,
          },
        };
        if (replacement.insertedScriptRanges.length) {
          pendingInputState.insertedScriptRanges = replacement.insertedScriptRanges;
        }
        pendingInputState.scriptCaretRanges = textScriptCaretRangesForEditState(
          pendingInputState.scriptRanges,
          pendingInputState.start,
          pendingInputState.scriptCaretAffinity
        );
        beginTextEditHistoryAction(id, pendingInputState, {
          splitPending: shouldCommitTextEditInputImmediately(inputType, pendingInputState.hasSelection),
        });
        proxy.setRangeText(replacement.insertedText, replacement.start, replacement.end, 'start');
        dispatchTextEditInputEvent(proxy, inputType);
        return;
      }
    }

    if (handleTextLayerDelete(obj, proxy, e)) return;

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
      let refLineIdx = layout.length - 1;
      for (let i = 0; i < layout.length; i++) {
        const ln = layout[i];
        if (refPos >= ln.startIndex && refPos <= (ln.caretEndIndex ?? ln.endIndex ?? (ln.startIndex + ln.text.length))) {
          refLineIdx = i; break;
        }
      }
      const refLine = layout[refLineIdx];

      // Caret world-x in the reference line
      const off = Math.min(refPos - refLine.startIndex, refLine.text.length);
      const caretX = lineXAtOffset(refLine, obj, off);

      // Find nearest position in the target line
      const targetIdx = isUp ? refLineIdx - 1 : refLineIdx + 1;
      let newPos;
      if (targetIdx < 0) {
        newPos = 0;
      } else if (targetIdx >= layout.length) {
        newPos = proxy.value.length;
      } else {
        newPos = layoutHitTest([layout[targetIdx]], caretX, layout[targetIdx].y, obj);
      }

      if (e.shiftKey) {
        const d = proxy.selectionDirection;
        const anchorPos = d === 'backward' ? proxy.selectionEnd : proxy.selectionStart;
        proxy.setSelectionRange(
          Math.min(anchorPos, newPos), Math.max(anchorPos, newPos),
          anchorPos <= newPos ? 'forward' : 'backward'
        );
      } else {
        proxy.setSelectionRange(newPos, newPos);
      }

      globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-caret-move');
      scheduleRender(true, false);
      return;
    }

    if (textEditNavigationKeys.has(e.key)) flushEditHistoryCheckpoint();
    scheduleRender(true, false);
  });

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
    globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-caret-move');
    scheduleRender(true, false);
  };
  document.addEventListener('selectionchange', _selChangeListener);

  _caretVisible = true;
  _caretBlinkInterval = setInterval(() => {
    if (!editingId) return;
    const hasSelection = proxy.selectionStart !== proxy.selectionEnd;
    if (hasSelection) { _caretVisible = true; return; }
    _caretVisible = !_caretVisible;
    scheduleRender(true, false, 'caret-blink');
  }, 500);

  // Offscreen is now stale: it was built with this object; now we exclude it
  invalidateOffscreen();

  proxy.focus({ preventScroll: true });
  proxy.setSelectionRange(proxy.value.length, proxy.value.length);
  setTextEditCaretIndex(obj, proxy.value.length);
  if (history && typeof pushHistory === 'function') pushHistory('text-edit-enter');
  scheduleRender(true, true);
}

function exitEdit() {
  if (!editingId) return;
  globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-exit');
  const id = editingId;
  const proxy = _editEl;
  editingId = null;
  _editEl = null;

  clearInterval(_caretBlinkInterval);
  _caretBlinkInterval = null;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  _editHistoryActionStartState = null;
  if (_selChangeListener) {
    document.removeEventListener('selectionchange', _selChangeListener);
    _selChangeListener = null;
  }

  if (proxy) proxy.remove();

  invalidateOffscreen();

  const obj = objectsMap.get(id);
  if (obj) {
    if (isTextContentEmpty(obj.data.content)) {
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-empty-delete-on-exit');
      BoardfishEditorState.removeEmptyTextObjects({ ids: [id] });
      delete obj._editStartContent;
      delete obj._editMinLines;
      clearTextEditCaretIndex(obj);
      _editHistoryLastContent = null;
      _editHistoryActionStartState = null;
      scheduleRender(true, true);
      pushHistory('delete-empty-text');
      return;
    }
    delete obj._layoutCache;
    delete obj._layoutCacheKey;
    const widthChanged = syncFreshTextEditWidth(obj);
    const heightChanged = syncTextAutoHeight(obj);
    if (widthChanged || heightChanged) markDirty(id);
    const contentChanged = obj.data.content !== _editHistoryLastContent;
    pushEditHistoryIfChanged(id);
    if ((widthChanged || heightChanged) && !contentChanged) pushHistory('text-height-change');
    if ((widthChanged || heightChanged) && !contentChanged) globalThis.BoardfishMotion?.applyActionAnimation?.('text-height-change');
    delete obj._editStartContent;
    delete obj._editMinLines;
    clearTextScriptCaretAffinity(obj);
    clearTextEditCaretIndex(obj);
  }

  _editHistoryLastContent = null;
  _editHistoryActionStartState = null;
  scheduleRender(true, true);
  window.getSelection()?.removeAllRanges();
}
