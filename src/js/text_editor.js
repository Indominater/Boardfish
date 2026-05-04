function enterEdit(id) {
  if (editingId === id) return;
  if (editingId) exitEdit();
  editingId = id;

  const obj = objectsMap.get(id);
  if (!obj) return;
  const normalized = normalizeTextContent(obj.data.content);
  if (normalized !== obj.data.content) {
    obj.data.content = normalized;
    delete obj._layoutCache;
    _linesCacheMap.delete(obj.id);
    markDirty(obj.id);
  }
  obj._editStartContent = obj.data.content;
  obj._editMinLines = obj.data.content ? 1 : NEW_TEXT_EDIT_MIN_LINES;
  syncTextAutoHeight(obj, obj._editMinLines);
  _editHistoryLastContent = obj.data.content;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;

  const proxy = document.createElement('textarea');
  proxy.id = 'editor-proxy';
  proxy.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;';
  proxy.value = obj.data.content;
  document.body.appendChild(proxy);
  _editEl = proxy;

  proxy.addEventListener('input', () => {
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
    const heightChanged = syncTextAutoHeight(obj, obj._editMinLines || 1);
    scheduleEditHistoryCheckpoint(id);
    scheduleRender(true, heightChanged);
  });
  proxy.addEventListener('keydown', (e) => {
    _caretVisible = true;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      proxy.setSelectionRange(0, proxy.value.length, 'none');
      TextSelDebug._logSelection('select-all', proxy);
      scheduleRender(true, false);
      return;
    }

    // The 1px-wide proxy treats all content as a single column, so the browser's
    // own up/down logic navigates char-by-char instead of line-by-line. Intercept
    // and compute line navigation from the canvas layout instead.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
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
        if (refPos >= ln.startIndex && refPos <= (ln.endIndex ?? (ln.startIndex + ln.text.length))) {
          refLineIdx = i; break;
        }
      }
      const refLine = layout[refLineIdx];

      // Caret world-x in the reference line
      const off = refPos - refLine.startIndex;
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

      scheduleRender(true, false);
      return;
    }

    scheduleRender(true, false);
  });

  let _prevSelStart = -1, _prevSelEnd = -1;
  _selChangeListener = () => {
    if (document.activeElement !== proxy) return;
    const s = proxy.selectionStart, e = proxy.selectionEnd;
    if (s === _prevSelStart && e === _prevSelEnd && _caretVisible) return;
    _prevSelStart = s; _prevSelEnd = e;
    TextSelDebug._logSelection('selectionchange', proxy);
    _caretVisible = true;
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
  scheduleRender(true, true);
}

function exitEdit() {
  if (!editingId) return;
  const id = editingId;
  const proxy = _editEl;
  editingId = null;
  _editEl = null;

  clearInterval(_caretBlinkInterval);
  _caretBlinkInterval = null;
  clearTimeout(_editHistoryTimer);
  _editHistoryTimer = null;
  if (_selChangeListener) {
    document.removeEventListener('selectionchange', _selChangeListener);
    _selChangeListener = null;
  }

  if (proxy) proxy.remove();

  invalidateOffscreen();

  const obj = objectsMap.get(id);
  if (obj) {
    if (isTextContentEmpty(obj.data.content)) {
      BoardfishEditorState.removeEmptyTextObjects({ ids: [id] });
      delete obj._editStartContent;
      delete obj._editMinLines;
      _editHistoryLastContent = null;
      scheduleRender(true, true);
      pushHistory('delete-empty-text');
      return;
    }
    delete obj._layoutCache;
    const heightChanged = syncTextAutoHeight(obj);
    if (heightChanged) markDirty(id);
    const contentChanged = obj.data.content !== _editHistoryLastContent;
    pushEditHistoryIfChanged(id);
    if (heightChanged && !contentChanged) pushHistory('text-height-change');
    delete obj._editStartContent;
    delete obj._editMinLines;
  }

  _editHistoryLastContent = null;
  scheduleRender(true, true);
  window.getSelection()?.removeAllRanges();
}
