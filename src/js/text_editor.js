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

const copyTextEditSelectionFromProxy = async (id, proxy, selection = textEditSelectionState(proxy)) => {
  if (!selection?.hasSelection || !proxy) return false;
  const selectedText = proxy.value.slice(selection.start, selection.end);
  const clipboardText = textSelectionForClipboard(selectedText);
  clearJsClipboard();
  if (editingId === id && _editEl === proxy) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('copy-text-selection', {
      textSelection: {
        id,
        ...selection,
      },
    });
    scheduleRender(true, false, 'copy-text-selection');
  }
  BoardfishClipboardIO.copyTextToClipboard(clipboardText)
    .catch((err) => console.error('[copy] text selection clipboard write FAILED:', err));
  return true;
};

function enterEdit(id, { history = true } = {}) {
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
  obj._editStartContent = obj.data.content;
  obj._editMinLines = obj.data.content ? 1 : NEW_TEXT_EDIT_MIN_LINES;
  syncTextAutoHeight(obj, obj._editMinLines);
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
  proxy.addEventListener('beforeinput', (event) => {
    pendingInputState = {
      ...textEditSelectionState(proxy),
      inputType: event?.inputType || '',
    };
    beginTextEditHistoryAction(id, pendingInputState, {
      splitPending: shouldCommitTextEditInputImmediately(pendingInputState.inputType, pendingInputState.hasSelection),
    });
  });
  proxy.addEventListener('input', (event) => {
    const inputState = pendingInputState || textEditSelectionState(proxy);
    pendingInputState = null;
    globalThis.BoardfishMotion?.applyActionAnimation?.(textEditActionFromInputType(event?.inputType));
    markDirty(id);
    obj.data.content = normalizeTextContent(proxy.value);
    if (proxy.value !== obj.data.content) {
      const start = proxy.selectionStart;
      const end = proxy.selectionEnd;
      const direction = proxy.selectionDirection || 'none';
      proxy.value = obj.data.content;
      proxy.setSelectionRange(start, end, direction);
    }
    delete obj._layoutCache;
    delete obj._layoutCacheKey;
    const heightChanged = syncTextAutoHeight(obj, obj._editMinLines || 1);
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
      const selection = textEditSelectionState(proxy);
      const lineBreakResult = applyTextEditLineBreakIndent(proxy.value, selection);
      const inputType = 'insertLineBreak';
      pendingInputState = {
        ...selection,
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

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      flushEditHistoryCheckpoint();
      proxy.setSelectionRange(0, proxy.value.length, 'none');
      TextSelDebug._logSelection('select-all', proxy);
      globalThis.BoardfishMotion?.applyActionAnimation?.('text-edit-select-all');
      scheduleRender(true, false);
      return;
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
    const s = proxy.selectionStart, e = proxy.selectionEnd;
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
      _editHistoryLastContent = null;
      _editHistoryActionStartState = null;
      scheduleRender(true, true);
      pushHistory('delete-empty-text');
      return;
    }
    delete obj._layoutCache;
    delete obj._layoutCacheKey;
    const widthChanged = obj._editStartContent === '' && typeof fitTextObjectWidthToRenderedContent === 'function'
      ? fitTextObjectWidthToRenderedContent(obj)
      : false;
    const heightChanged = syncTextAutoHeight(obj);
    if (widthChanged || heightChanged) markDirty(id);
    const contentChanged = obj.data.content !== _editHistoryLastContent;
    pushEditHistoryIfChanged(id);
    if ((widthChanged || heightChanged) && !contentChanged) pushHistory('text-height-change');
    if ((widthChanged || heightChanged) && !contentChanged) globalThis.BoardfishMotion?.applyActionAnimation?.('text-height-change');
    delete obj._editStartContent;
    delete obj._editMinLines;
  }

  _editHistoryLastContent = null;
  _editHistoryActionStartState = null;
  scheduleRender(true, true);
  window.getSelection()?.removeAllRanges();
}
