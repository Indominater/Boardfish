'use strict';

// ─── Text Selection Debugger ──────────────────────────────────────────────────
// Focused capture for text hit-testing, drag-highlight selection, and selection
// drawing. Output is bounded so huge textboxes do not create huge debug files.
// Usage:
//   await beginDebug({ textSel: ['enable', 'reset'] })
//   await finishDebug({ textSel: ['performanceSummary', 'enterEditReport', 'exitEditReport', 'selectionReport', 'summary', 'dump'] })
var _textSelDebugEnabled = false;
var TextSelDebug = (() => {
  const MAX_EVENTS = 1600;
  const TRIMMABLE_EVENT_TYPES = new Set(['draw', 'hit']);
  const TEXT_SAMPLE_CHARS = 180;
  const REPORT_NEIGHBOR_LINES = 2;
  const MEASURE_LINE_LIMIT = 12;
  const MEASURE_CHAR_LIMIT = 220;
  const events = [];
  let nextId = 1;

  const now = () => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  );

  const stats = {
    hits: 0,
    hitMsTotal: 0,
    maxHitMs: 0,
    layouts: 0,
    layoutMsTotal: 0,
    maxLayoutMs: 0,
    selections: 0,
    maxSelectedChars: 0,
    drawRuns: 0,
    drawSummaries: 0,
    maxSelectionRuns: 0,
    maxSelectionRects: 0,
    pointerEvents: 0,
    editEvents: 0,
    maxEditMs: 0,
    maxEnterMs: 0,
    maxClickToEditMs: 0,
    selectionModeEvents: 0,
    clipboardEvents: 0,
    maxClipboardMs: 0,
  };

  const round = (value, places = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const scale = Math.pow(10, places);
    return Math.round(n * scale) / scale;
  };

  const textValue = (value) => String(value ?? '');

  function showWhitespace(text) {
    return textValue(text)
      .replace(/ /g, '·')
      .replace(/\t/g, '→')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n\n');
  }

  function sampleText(text, limit = TEXT_SAMPLE_CHARS) {
    const value = textValue(text);
    if (value.length <= limit) return showWhitespace(value);
    const edge = Math.max(20, Math.floor((limit - 12) / 2));
    return `${showWhitespace(value.slice(0, edge))} ... ${showWhitespace(value.slice(-edge))}`;
  }

  function updateStats(evt) {
    if (evt.type === 'hit' || evt.type === 'hit-timing') {
      stats.hits++;
      const ms = Number(evt.ms);
      if (Number.isFinite(ms)) {
        stats.hitMsTotal += ms;
        stats.maxHitMs = Math.max(stats.maxHitMs, ms);
      }
    } else if (evt.type === 'layout') {
      stats.layouts++;
      const ms = Number(evt.ms);
      if (Number.isFinite(ms)) {
        stats.layoutMsTotal += ms;
        stats.maxLayoutMs = Math.max(stats.maxLayoutMs, ms);
      }
    } else if (evt.type === 'selection') {
      stats.selections++;
      stats.maxSelectedChars = Math.max(stats.maxSelectedChars, Number(evt.selectedChars) || 0);
    } else if (evt.type === 'draw') {
      stats.drawRuns++;
    } else if (evt.type === 'draw-summary') {
      stats.drawSummaries++;
      stats.maxSelectionRuns = Math.max(stats.maxSelectionRuns, Number(evt.selectionRuns) || 0);
      stats.maxSelectionRects = Math.max(stats.maxSelectionRects, Number(evt.selectionRects) || 0);
    } else if (evt.type === 'pointer') {
      stats.pointerEvents++;
    } else if (evt.type === 'edit') {
      stats.editEvents++;
      const ms = Number(evt.ms);
      if (Number.isFinite(ms)) stats.maxEditMs = Math.max(stats.maxEditMs, ms);
      const totalMs = Number(evt.totalMs);
      const label = String(evt.label || '');
      if (Number.isFinite(totalMs) && label.startsWith('enter-')) {
        stats.maxEnterMs = Math.max(stats.maxEnterMs, totalMs);
      }
      if (Number.isFinite(totalMs) && label.startsWith('click-to-edit-')) {
        stats.maxClickToEditMs = Math.max(stats.maxClickToEditMs, totalMs);
      }
    } else if (evt.type === 'selection-mode') {
      stats.selectionModeEvents++;
    } else if (evt.type === 'clipboard') {
      stats.clipboardEvents++;
      const ms = Number(evt.ms);
      if (Number.isFinite(ms)) stats.maxClipboardMs = Math.max(stats.maxClipboardMs, ms);
    }
  }

  function trimEvents() {
    while (events.length > MAX_EVENTS) {
      const dropIndex = events.findIndex((evt) => TRIMMABLE_EVENT_TYPES.has(evt?.type));
      events.splice(dropIndex >= 0 ? dropIndex : 0, 1);
    }
  }

  function push(evt) {
    if (!_textSelDebugEnabled) return;
    const normalized = { id: nextId++, at: round(now(), 1), ...evt };
    updateStats(normalized);
    events.push(normalized);
    trimEvents();
  }

  function currentTextObject() {
    if (typeof editingId === 'undefined' || !editingId) return null;
    return (typeof objectsMap !== 'undefined') && objectsMap.get(editingId) || null;
  }

  function contentForObject(obj) {
    return typeof normalizeTextContent === 'function'
      ? normalizeTextContent(obj?.data?.content || '')
      : textValue(obj?.data?.content || '').replace(/\r\n?/g, '\n');
  }

  function visibleLineCount(layout = []) {
    if (!Array.isArray(layout) || !layout.length) return 0;
    let viewportRect = null;
    if (typeof currentViewportWorldRect === 'function') {
      try {
        viewportRect = currentViewportWorldRect(0);
      } catch (_) {
        viewportRect = null;
      }
    }
    if (!viewportRect || typeof textLayoutLineIntersectsViewport !== 'function') return layout.length;
    let count = 0;
    for (const line of layout) if (textLayoutLineIntersectsViewport(line, viewportRect)) count++;
    return count;
  }

  function layoutMetrics(obj, layout = null) {
    const lines = Array.isArray(layout) ? layout : (Array.isArray(obj?._layoutCache) ? obj._layoutCache : []);
    let largestLineChars = 0;
    let prefixEntries = 0;
    for (const line of lines) {
      largestLineChars = Math.max(largestLineChars, textValue(line?.text).length);
      prefixEntries += Number(line?.prefixWidths?.length) || 0;
    }
    const content = contentForObject(obj);
    return {
      objectId: obj?.id || '',
      contentChars: content.length,
      width: round(obj?.w),
      height: round(obj?.h),
      layoutCached: Array.isArray(obj?._layoutCache),
      layoutLines: lines.length,
      visibleLines: visibleLineCount(lines),
      culledLines: lines.length ? Math.max(0, lines.length - visibleLineCount(lines)) : 0,
      largestLineChars,
      prefixEntries,
      scriptRanges: Array.isArray(obj?.data?.scriptRanges) ? obj.data.scriptRanges.length : 0,
    };
  }

  function lightLayoutMetrics(obj) {
    const lines = Array.isArray(obj?._layoutCache) ? obj._layoutCache : [];
    const content = textValue(obj?.data?.content || '');
    return {
      objectId: obj?.id || '',
      contentChars: content.length,
      width: round(obj?.w),
      height: round(obj?.h),
      layoutCached: Array.isArray(obj?._layoutCache),
      layoutLines: lines.length,
      visibleLines: '',
      culledLines: '',
      largestLineChars: '',
      prefixEntries: '',
      scriptRanges: Array.isArray(obj?.data?.scriptRanges) ? obj.data.scriptRanges.length : 0,
    };
  }

  function metricsForLifecycleLog(label, obj) {
    return String(label || '').startsWith('input-') ? lightLayoutMetrics(obj) : layoutMetrics(obj);
  }

  function selectionLineMetrics(layout = [], selStart = 0, selEnd = 0) {
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    let selectedLines = 0;
    let selectedVisibleLines = 0;
    let firstLine = -1;
    let lastLine = -1;
    let viewportRect = null;
    if (typeof currentViewportWorldRect === 'function') {
      try {
        viewportRect = currentViewportWorldRect(0);
      } catch (_) {
        viewportRect = null;
      }
    }
    for (let i = 0; i < layout.length; i++) {
      const line = layout[i];
      const textEnd = line.startIndex + textValue(line.text).length;
      if (!(end > line.startIndex && start < textEnd)) continue;
      selectedLines++;
      if (firstLine === -1) firstLine = i;
      lastLine = i;
      if (!viewportRect || typeof textLayoutLineIntersectsViewport !== 'function' ||
        textLayoutLineIntersectsViewport(line, viewportRect)) {
        selectedVisibleLines++;
      }
    }
    return { selectedLines, selectedVisibleLines, firstLine, lastLine };
  }

  function selectionSnapshot(label, proxy, obj = currentTextObject()) {
    const value = textValue(proxy?.value ?? obj?.data?.content ?? '');
    const selStart = Math.max(0, Math.min(proxy?.selectionStart ?? 0, value.length));
    const selEnd = Math.max(0, Math.min(proxy?.selectionEnd ?? selStart, value.length));
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    const layout = Array.isArray(obj?._layoutCache) ? obj._layoutCache : [];
    return {
      label,
      objectId: obj?.id || '',
      selStart,
      selEnd,
      selectedChars: end - start,
      direction: proxy?.selectionDirection || 'none',
      sample: sampleText(value.slice(start, end)),
      ...layoutMetrics(obj, layout),
      ...selectionLineMetrics(layout, selStart, selEnd),
    };
  }

  function selectionModeSnapshot(label, ids = [], meta = {}) {
    const requested = Array.isArray(ids) ? ids : [...(ids || [])];
    const selected = typeof selectedIds !== 'undefined' ? [...selectedIds] : [];
    let textSelectedCount = 0;
    let imageSelectedCount = 0;
    let largestSelectedTextChars = 0;
    let largestSelectedTextId = '';
    for (const id of selected) {
      const obj = typeof objectsMap !== 'undefined' ? objectsMap.get(id) : null;
      if (obj?.type === 'text') {
        textSelectedCount++;
        const chars = contentForObject(obj).length;
        if (chars > largestSelectedTextChars) {
          largestSelectedTextChars = chars;
          largestSelectedTextId = obj.id || '';
        }
      } else if (obj?.type === 'image') {
        imageSelectedCount++;
      }
    }
    return {
      type: 'selection-mode',
      label,
      requestedCount: requested.length,
      selectedCount: selected.length,
      selectedIds: selected.slice(0, 12).join(','),
      primaryId: typeof selectedId !== 'undefined' ? selectedId || '' : '',
      editingId: typeof editingId !== 'undefined' ? editingId || '' : '',
      textSelectedCount,
      imageSelectedCount,
      largestSelectedTextChars,
      largestSelectedTextId,
      ...meta,
    };
  }

  function enable() {
    if (!DEBUG_TOOLS_ENABLED) return;
    _textSelDebugEnabled = true;
    console.info(
      '[textSel] enabled. Edit a large text object, highlight words, enter/exit edit mode, then run ' +
      'finishDebug({ textSel: ["performanceSummary", "enterEditReport", "exitEditReport", "clipboardReport", "editLifecycleReport", "selectionReport", "summary", "dump"] }).'
    );
  }

  function disable() {
    _textSelDebugEnabled = false;
    if (DEBUG_TOOLS_ENABLED) console.info('[textSel] disabled.');
  }

  function eventRow(e) {
    return {
      id: e.id,
      at: e.at,
      type: e.type,
      label: e.label || '',
      objectId: e.objectId || '',
      editingId: e.editingId || '',
      phase: e.phase || '',
      reason: e.reason || '',
      ms: e.ms ?? '',
      totalMs: e.totalMs ?? '',
      clickToEditTotalMs: e.clickToEditTotalMs ?? '',
      enterEditMs: e.enterEditMs ?? '',
      historyMs: e.historyMs ?? '',
      proxyChars: e.proxyChars ?? '',
      domProxyChars: e.domProxyChars ?? '',
      domValueStale: e.domValueStale ?? '',
      proxyWrap: e.proxyWrap || '',
      proxySpellcheck: e.proxySpellcheck ?? '',
      proxyAutocomplete: e.proxyAutocomplete || '',
      proxyAutocorrect: e.proxyAutocorrect || '',
      proxyAutocapitalize: e.proxyAutocapitalize || '',
      proxyAriaHidden: e.proxyAriaHidden || '',
      proxyAriaLabel: e.proxyAriaLabel || '',
      proxyContain: e.proxyContain || '',
      proxyWhiteSpace: e.proxyWhiteSpace || '',
      proxyOverflow: e.proxyOverflow || '',
      activeElementIsProxy: e.activeElementIsProxy ?? '',
      requestedCount: e.requestedCount ?? '',
      selectedCount: e.selectedCount ?? '',
      primaryId: e.primaryId || '',
      selectedIds: e.selectedIds || '',
      requestedPrimaryId: e.requestedPrimaryId || '',
      exitEditing: e.exitEditing ?? '',
      hitObjectId: e.hitObjectId || '',
      hitObjectType: e.hitObjectType || '',
      hitObjectSelected: e.hitObjectSelected ?? '',
      canClickToEditText: e.canClickToEditText ?? '',
      wasSelected: e.wasSelected ?? '',
      inputType: e.inputType || '',
      source: e.source || '',
      fallbackTextChars: e.fallbackTextChars ?? '',
      candidateTextLen: e.candidateTextLen ?? '',
      candidateScriptRangeCount: e.candidateScriptRangeCount ?? '',
      sourceTextLen: e.sourceTextLen ?? '',
      oldChars: e.oldChars ?? '',
      nextChars: e.nextChars ?? '',
      insertedChars: e.insertedChars ?? '',
      removedChars: e.removedChars ?? '',
      textLen: e.textLen ?? '',
      textBytes: e.textBytes ?? '',
      textLineCount: e.textLineCount ?? '',
      largestLineChars: e.largestLineChars ?? '',
      scriptRangeCount: e.scriptRangeCount ?? '',
      replacementStart: e.replacementStart ?? '',
      replacementEnd: e.replacementEnd ?? '',
      replacementChars: e.replacementChars ?? '',
      rawStart: e.rawStart ?? '',
      rawEnd: e.rawEnd ?? '',
      rawSelectedChars: e.rawSelectedChars ?? '',
      normalizedStart: e.normalizedStart ?? '',
      normalizedEnd: e.normalizedEnd ?? '',
      normalizedSelectedChars: e.normalizedSelectedChars ?? '',
      stateValueChars: e.stateValueChars ?? '',
      previousContentChars: e.previousContentChars ?? '',
      nextContentChars: e.nextContentChars ?? '',
      splitPending: e.splitPending ?? '',
      hadTimer: e.hadTimer ?? '',
      hadPendingStart: e.hadPendingStart ?? '',
      reusedStart: e.reusedStart ?? '',
      reusedEditProxy: e.reusedEditProxy ?? '',
      proxyValueSetMethod: e.proxyValueSetMethod ?? '',
      proxyValueChanged: e.proxyValueChanged ?? '',
      proxyDomSyncedForSelection: e.proxyDomSyncedForSelection ?? '',
      proxyDomSyncReason: e.proxyDomSyncReason ?? '',
      proxyDomCharsBeforeSelection: e.proxyDomCharsBeforeSelection ?? '',
      proxyDomCharsAfterSelection: e.proxyDomCharsAfterSelection ?? '',
      clipboardWriteMs: e.clipboardWriteMs ?? '',
      historyActionMs: e.historyActionMs ?? '',
      setRangeTextMs: e.setRangeTextMs ?? '',
      dispatchMs: e.dispatchMs ?? '',
      contentNormalized: e.contentNormalized ?? '',
      scriptRangesNormalized: e.scriptRangesNormalized ?? '',
      bracesNormalized: e.bracesNormalized ?? '',
      lineAlignNormalized: e.lineAlignNormalized ?? '',
      autoHeightDeferred: e.autoHeightDeferred ?? '',
      pendingSizeSync: e.pendingSizeSync ?? '',
      contentChanged: e.contentChanged ?? '',
      motionMs: e.motionMs ?? '',
      timersMs: e.timersMs ?? '',
      selectionListenerRemoved: e.selectionListenerRemoved ?? '',
      proxyRemoveMs: e.proxyRemoveMs ?? '',
      invalidateOffscreenMs: e.invalidateOffscreenMs ?? '',
      widthSyncMs: e.widthSyncMs ?? '',
      heightSyncMs: e.heightSyncMs ?? '',
      markDirtyMs: e.markDirtyMs ?? '',
      widthChanged: e.widthChanged ?? '',
      heightChanged: e.heightChanged ?? '',
      autoHeightForceSync: e.autoHeightForceSync ?? '',
      autoHeightForceReason: e.autoHeightForceReason || '',
      restoredMinLinesReset: e.restoredMinLinesReset ?? '',
      restoredPreviousMinLines: e.restoredPreviousMinLines ?? '',
      restoredPreservedMinLines: e.restoredPreservedMinLines ?? '',
      restoredNextMinLines: e.restoredNextMinLines ?? '',
      pendingSizeSyncBeforeAutoHeight: e.pendingSizeSyncBeforeAutoHeight ?? '',
      needsExitSizeSync: e.needsExitSizeSync ?? '',
      sizeSyncReason: e.sizeSyncReason || '',
      startedEmpty: e.startedEmpty ?? '',
      editMinLines: e.editMinLines ?? '',
      editHistoryMs: e.editHistoryMs ?? '',
      heightHistoryMs: e.heightHistoryMs ?? '',
      emptyDeleted: e.emptyDeleted ?? '',
      proxyRemoved: e.proxyRemoved ?? '',
      renderScheduleMs: e.renderScheduleMs ?? '',
      windowSelectionClearMs: e.windowSelectionClearMs ?? '',
      emptyTextCleanupMs: e.emptyTextCleanupMs ?? '',
      emptyTextDeleted: e.emptyTextDeleted ?? '',
      worldPointMs: e.worldPointMs ?? '',
      hitTestMs: e.hitTestMs ?? '',
      layoutMs: e.layoutMs ?? '',
      hitMs: e.hitMs ?? '',
      focusMs: e.focusMs ?? '',
      focusScheduled: e.focusScheduled ?? '',
      scheduledDelayMs: e.scheduledDelayMs ?? '',
      skipped: e.skipped ?? '',
      caretApplyMs: e.caretApplyMs ?? '',
      key: e.key || '',
      deleteCaret: e.deleteCaret ?? '',
      blankLineDelete: e.blankLineDelete ?? '',
      deleteRangeMs: e.deleteRangeMs ?? '',
      replacementBuildMs: e.replacementBuildMs ?? '',
      keydownDeleteSetupMs: e.keydownDeleteSetupMs ?? '',
      deletionStart: e.deletionStart ?? '',
      deletionEnd: e.deletionEnd ?? '',
      structuralReplacementEnd: e.structuralReplacementEnd ?? '',
      deletedTextSample: e.deletedTextSample || '',
      textEditCaretIndex: e.textEditCaretIndex ?? '',
      textEditCaretLineStartIndex: e.textEditCaretLineStartIndex ?? '',
      inputStartCaretLineIndex: e.inputStartCaretLineIndex ?? '',
      inputStartCaretLineStart: e.inputStartCaretLineStart ?? '',
      inputStartCaretLineEnd: e.inputStartCaretLineEnd ?? '',
      inputStartCaretLineBlank: e.inputStartCaretLineBlank ?? '',
      replacementCaretLineIndex: e.replacementCaretLineIndex ?? '',
      replacementCaretLineStart: e.replacementCaretLineStart ?? '',
      replacementCaretLineEnd: e.replacementCaretLineEnd ?? '',
      replacementCaretLineBlank: e.replacementCaretLineBlank ?? '',
      deleteCaretLineIndex: e.deleteCaretLineIndex ?? '',
      deleteCaretLineStart: e.deleteCaretLineStart ?? '',
      deleteCaretLineEnd: e.deleteCaretLineEnd ?? '',
      deleteCaretLineBlank: e.deleteCaretLineBlank ?? '',
      updatedCaretLineIndex: e.updatedCaretLineIndex ?? '',
      updatedCaretLineStart: e.updatedCaretLineStart ?? '',
      updatedCaretLineEnd: e.updatedCaretLineEnd ?? '',
      updatedCaretLineBlank: e.updatedCaretLineBlank ?? '',
      layoutCacheLines: e.layoutCacheLines ?? '',
      layoutPatchOldLines: e.layoutPatchOldLines ?? '',
      layoutPatchNewLines: e.layoutPatchNewLines ?? '',
      layoutPatchRemovedLines: e.layoutPatchRemovedLines ?? '',
      layoutPatchInsertedLines: e.layoutPatchInsertedLines ?? '',
      inputStateObjectHeight: e.inputStateObjectHeight ?? '',
      inputStateLogicalLines: e.inputStateLogicalLines ?? '',
      inputStateCachedLines: e.inputStateCachedLines ?? '',
      inputStateCachedLineSource: e.inputStateCachedLineSource || '',
      inputStateExpectedLogicalHeight: e.inputStateExpectedLogicalHeight ?? '',
      inputStateExpectedCachedHeight: e.inputStateExpectedCachedHeight ?? '',
      inputStateHeightDeltaFromLogical: e.inputStateHeightDeltaFromLogical ?? '',
      inputStateHeightDeltaFromCached: e.inputStateHeightDeltaFromCached ?? '',
      updatedObjectHeight: e.updatedObjectHeight ?? '',
      updatedLogicalLines: e.updatedLogicalLines ?? '',
      updatedCachedLines: e.updatedCachedLines ?? '',
      updatedCachedLineSource: e.updatedCachedLineSource || '',
      updatedExpectedLogicalHeight: e.updatedExpectedLogicalHeight ?? '',
      updatedExpectedCachedHeight: e.updatedExpectedCachedHeight ?? '',
      updatedHeightDeltaFromLogical: e.updatedHeightDeltaFromLogical ?? '',
      updatedHeightDeltaFromCached: e.updatedHeightDeltaFromCached ?? '',
      beforeAutoHeightObjectHeight: e.beforeAutoHeightObjectHeight ?? '',
      beforeAutoHeightLogicalLines: e.beforeAutoHeightLogicalLines ?? '',
      beforeAutoHeightCachedLines: e.beforeAutoHeightCachedLines ?? '',
      beforeAutoHeightCachedLineSource: e.beforeAutoHeightCachedLineSource || '',
      beforeAutoHeightExpectedLogicalHeight: e.beforeAutoHeightExpectedLogicalHeight ?? '',
      beforeAutoHeightExpectedCachedHeight: e.beforeAutoHeightExpectedCachedHeight ?? '',
      beforeAutoHeightHeightDeltaFromLogical: e.beforeAutoHeightHeightDeltaFromLogical ?? '',
      beforeAutoHeightHeightDeltaFromCached: e.beforeAutoHeightHeightDeltaFromCached ?? '',
      afterAutoHeightObjectHeight: e.afterAutoHeightObjectHeight ?? '',
      afterAutoHeightLogicalLines: e.afterAutoHeightLogicalLines ?? '',
      afterAutoHeightCachedLines: e.afterAutoHeightCachedLines ?? '',
      afterAutoHeightCachedLineSource: e.afterAutoHeightCachedLineSource || '',
      afterAutoHeightExpectedLogicalHeight: e.afterAutoHeightExpectedLogicalHeight ?? '',
      afterAutoHeightExpectedCachedHeight: e.afterAutoHeightExpectedCachedHeight ?? '',
      afterAutoHeightHeightDeltaFromLogical: e.afterAutoHeightHeightDeltaFromLogical ?? '',
      afterAutoHeightHeightDeltaFromCached: e.afterAutoHeightHeightDeltaFromCached ?? '',
      inputEndObjectHeight: e.inputEndObjectHeight ?? '',
      inputEndLogicalLines: e.inputEndLogicalLines ?? '',
      inputEndCachedLines: e.inputEndCachedLines ?? '',
      inputEndCachedLineSource: e.inputEndCachedLineSource || '',
      inputEndExpectedLogicalHeight: e.inputEndExpectedLogicalHeight ?? '',
      inputEndExpectedCachedHeight: e.inputEndExpectedCachedHeight ?? '',
      inputEndHeightDeltaFromLogical: e.inputEndHeightDeltaFromLogical ?? '',
      inputEndHeightDeltaFromCached: e.inputEndHeightDeltaFromCached ?? '',
      proxyScrollHeight: e.proxyScrollHeight ?? '',
      proxyClientHeight: e.proxyClientHeight ?? '',
      startClientX: e.startClientX ?? '',
      startClientY: e.startClientY ?? '',
      clientX: e.clientX ?? '',
      clientY: e.clientY ?? '',
      wx: e.wx != null ? round(e.wx) : '',
      wy: e.wy != null ? round(e.wy) : '',
      returnedIdx: e.returnedIdx ?? '',
      affinity: e.affinity || '',
      lineStartIndex: e.lineStartIndex ?? '',
      selStart: e.selStart ?? '',
      selEnd: e.selEnd ?? '',
      selectedChars: e.selectedChars ?? '',
      selectedLines: e.selectedLines ?? '',
      selectedVisibleLines: e.selectedVisibleLines ?? '',
      layoutLines: e.layoutLines ?? '',
      visibleLines: e.visibleLines ?? '',
      contentChars: e.contentChars ?? '',
      selectionRuns: e.selectionRuns ?? '',
      selectionRects: e.selectionRects ?? '',
      x1: e.x1 != null ? round(e.x1) : '',
      x2: e.x2 != null ? round(e.x2) : '',
      lineText: e.lineText || e.hitLine || '',
      sample: e.sample || '',
      note: e.note || '',
    };
  }

  function summary() {
    const rows = events.map(eventRow);
    console.table(rows);
    return rows;
  }

  function performanceSummary() {
    const latestSelection = [...events].reverse().find((e) => e.type === 'selection') || null;
    const latestDraw = [...events].reverse().find((e) => e.type === 'draw-summary') || null;
    const out = {
      events: events.length,
      hits: stats.hits,
      avgHitMs: stats.hits ? round(stats.hitMsTotal / stats.hits) : 0,
      maxHitMs: round(stats.maxHitMs),
      layouts: stats.layouts,
      avgLayoutMs: stats.layouts ? round(stats.layoutMsTotal / stats.layouts) : 0,
      maxLayoutMs: round(stats.maxLayoutMs),
      selections: stats.selections,
      maxSelectedChars: stats.maxSelectedChars,
      drawRuns: stats.drawRuns,
      drawSummaries: stats.drawSummaries,
      maxSelectionRuns: stats.maxSelectionRuns,
      maxSelectionRects: stats.maxSelectionRects,
      pointerEvents: stats.pointerEvents,
      editEvents: stats.editEvents,
      maxEditMs: round(stats.maxEditMs),
      maxEnterMs: round(stats.maxEnterMs),
      maxClickToEditMs: round(stats.maxClickToEditMs),
      selectionModeEvents: stats.selectionModeEvents,
      clipboardEvents: stats.clipboardEvents,
      maxClipboardMs: round(stats.maxClipboardMs),
      latestSelectedChars: latestSelection?.selectedChars ?? '',
      latestSelectedLines: latestSelection?.selectedLines ?? '',
      latestContentChars: latestSelection?.contentChars ?? '',
      latestLayoutLines: latestSelection?.layoutLines ?? '',
      latestVisibleLines: latestSelection?.visibleLines ?? '',
      latestSelectionRuns: latestDraw?.selectionRuns ?? '',
      latestSelectionRects: latestDraw?.selectionRects ?? '',
    };
    console.table([out]);
    return out;
  }

  function clipboardReport() {
    const rows = events
      .filter((evt) => (
        evt.type === 'clipboard' ||
        (evt.type === 'edit' && /^input-/.test(evt.label || ''))
      ))
      .map(eventRow);
    const latest = [...rows].reverse().find(Boolean);
    const summary = {
      events: rows.length,
      latestLabel: latest?.label || '',
      latestInputType: latest?.inputType || '',
      latestTextLen: latest?.textLen ?? '',
      latestInsertedChars: latest?.insertedChars ?? '',
      latestTotalMs: latest?.totalMs ?? '',
      maxClipboardMs: round(stats.maxClipboardMs),
      maxEditMs: round(stats.maxEditMs),
    };
    console.table([summary]);
    console.table(rows.slice(-160));
    return { summary, rows };
  }

  function editLifecycleReport() {
    const rows = events
      .filter((evt) => evt.type === 'edit' || evt.type === 'selection-mode')
      .map(eventRow);
    console.table(rows);
    return rows;
  }

  function enterEditReport(options = {}) {
    const limit = Math.max(1, Math.min(MAX_EVENTS, Number(options.limit) || 260));
    const rows = events
      .filter((evt) => (
        evt.type === 'selection-mode' ||
        (
          evt.type === 'edit' &&
          (
            evt.phase === 'enter' ||
            String(evt.label || '').startsWith('enter-') ||
            String(evt.label || '').startsWith('click-to-edit-') ||
            evt.label === 'canvas-mousedown-route'
          )
        )
      ))
      .map(eventRow);
    const max = (field, predicate = null) => rows.reduce((value, row) => {
      if (predicate && !predicate(row)) return value;
      return Math.max(value, Number(row[field]) || 0);
    }, 0);
    const isEnter = (row) => String(row.label || '').startsWith('enter-');
    const isClickToEdit = (row) => String(row.label || '').startsWith('click-to-edit-');
    const latest = [...rows].reverse().find(Boolean);
    const latestEnter = [...rows].reverse().find(isEnter);
    const latestClick = [...rows].reverse().find(isClickToEdit);
    const latestRoute = [...rows].reverse().find((row) => row.label === 'canvas-mousedown-route');
    const summary = {
      events: rows.length,
      enterEvents: rows.filter(isEnter).length,
      clickToEditEvents: rows.filter(isClickToEdit).length,
      selectionModeEvents: rows.filter((row) => row.type === 'selection-mode').length,
      latestLabel: latest?.label || '',
      latestEnterLabel: latestEnter?.label || '',
      latestClickToEditLabel: latestClick?.label || '',
      latestRouteHitObjectId: latestRoute?.hitObjectId || '',
      latestRouteHitObjectType: latestRoute?.hitObjectType || '',
      latestObjectId: latestEnter?.objectId || latestClick?.objectId || latest?.objectId || '',
      latestContentChars: latestEnter?.contentChars ?? latestClick?.contentChars ?? '',
      latestLayoutLines: latestEnter?.layoutLines ?? latestClick?.layoutLines ?? '',
      maxEnterStepMs: max('ms', isEnter),
      maxEnterTotalMs: max('totalMs', isEnter),
      maxClickToEditStepMs: max('ms', isClickToEdit),
      maxClickToEditTotalMs: max('totalMs', isClickToEdit),
      maxEnterEditCallMs: max('enterEditMs'),
      maxCanvasRouteMs: max('totalMs', (row) => row.label === 'canvas-mousedown-route'),
      maxEmptyTextCleanupMs: max('emptyTextCleanupMs'),
      maxHitTestMs: max('hitTestMs'),
      maxLayoutMs: max('layoutMs'),
      maxHitMs: max('hitMs'),
      maxFocusMs: max('focusMs'),
      maxScheduledDelayMs: max('scheduledDelayMs'),
      maxCaretApplyMs: max('caretApplyMs'),
      maxMotionMs: max('motionMs'),
      maxRenderScheduleMs: max('renderScheduleMs'),
    };
    console.table([summary]);
    console.table(rows.slice(-limit));
    return { summary, rows: rows.slice(-limit) };
  }

  function exitEditReport(options = {}) {
    const limit = Math.max(1, Math.min(MAX_EVENTS, Number(options.limit) || 260));
    const rows = events
      .filter((evt) => evt.type === 'edit' && String(evt.label || '').startsWith('exit-'))
      .map(eventRow);
    const max = (field) => rows.reduce((value, row) => Math.max(value, Number(row[field]) || 0), 0);
    const latest = [...rows].reverse().find(Boolean);
    const summary = {
      exitEvents: rows.length,
      latestLabel: latest?.label || '',
      latestTotalMs: latest?.totalMs ?? '',
      latestObjectId: latest?.objectId || '',
      latestContentChars: latest?.contentChars ?? '',
      latestProxyChars: latest?.proxyChars ?? '',
      latestDomProxyChars: latest?.domProxyChars ?? '',
      latestDomValueStale: latest?.domValueStale ?? '',
      maxExitStepMs: max('ms'),
      maxExitTotalMs: max('totalMs'),
      maxMotionMs: max('motionMs'),
      maxTimersMs: max('timersMs'),
      maxProxyRemoveMs: max('proxyRemoveMs'),
      maxInvalidateOffscreenMs: max('invalidateOffscreenMs'),
      maxWidthSyncMs: max('widthSyncMs'),
      maxHeightSyncMs: max('heightSyncMs'),
      maxEditHistoryMs: max('editHistoryMs'),
      maxHeightHistoryMs: max('heightHistoryMs'),
      maxRenderScheduleMs: max('renderScheduleMs'),
      maxWindowSelectionClearMs: max('windowSelectionClearMs'),
      sizeSyncEvents: rows.filter((row) => row.label === 'exit-size-sync').length,
      sizeSyncSkippedEvents: rows.filter((row) => row.label === 'exit-size-sync-skipped').length,
      latestSizeSyncReason: [...rows].reverse().find((row) => row.sizeSyncReason)?.sizeSyncReason || '',
      contentChangedExits: rows.filter((row) => row.contentChanged === true).length,
      heightChangedExits: rows.filter((row) => row.heightChanged === true).length,
      widthChangedExits: rows.filter((row) => row.widthChanged === true).length,
    };
    console.table([summary]);
    console.table(rows.slice(-limit));
    return { summary, rows: rows.slice(-limit) };
  }

  function lineReportRow(line, index, value, selStart, selEnd) {
    const textEnd = line.startIndex + textValue(line.text).length;
    const nextStart = line.nextStartIndex ?? textEnd;
    const skipped = value.slice(textEnd, nextStart);
    const selected = selEnd > line.startIndex && selStart < textEnd;
    const selectedFrom = selected ? Math.max(selStart, line.startIndex) : '';
    const selectedTo = selected ? Math.min(selEnd, textEnd) : '';
    return {
      line: index,
      start: line.startIndex,
      textEnd,
      nextStart,
      chars: textValue(line.text).length,
      selected,
      selectedFrom,
      selectedTo,
      selectedChars: selected ? selectedTo - selectedFrom : 0,
      width: line.prefixWidths ? round(line.prefixWidths[textValue(line.text).length]) : '',
      textSample: sampleText(line.text),
      skippedAfterSample: sampleText(skipped, 80),
    };
  }

  function selectionReport(options = {}) {
    if (typeof editingId === 'undefined' || !editingId) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    const obj = currentTextObject();
    if (!obj) { console.warn('[textSel] Editing object not found.'); return null; }
    const value = textValue(_editEl?.value ?? obj.data.content ?? '');
    const selStart = Math.max(0, Math.min(_editEl?.selectionStart ?? 0, value.length));
    const selEnd = Math.max(0, Math.min(_editEl?.selectionEnd ?? selStart, value.length));
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    const layoutStart = now();
    const lines = getTextLayout(obj);
    const layoutMs = now() - layoutStart;
    const selectedLineMetrics = selectionLineMetrics(lines, selStart, selEnd);
    const neighborLines = Math.max(0, Math.trunc(Number(options.neighborLines ?? REPORT_NEIGHBOR_LINES)) || 0);
    const firstLine = selectedLineMetrics.firstLine >= 0 ? selectedLineMetrics.firstLine : 0;
    const lastLine = selectedLineMetrics.lastLine >= 0 ? selectedLineMetrics.lastLine : Math.min(lines.length - 1, firstLine);
    const fromLine = Math.max(0, firstLine - neighborLines);
    const toLine = Math.min(lines.length - 1, lastLine + neighborLines);
    const rows = [];
    for (let i = fromLine; i <= toLine; i++) {
      if (lines[i]) rows.push(lineReportRow(lines[i], i, value, start, end));
    }
    const payload = {
      objectId: obj.id,
      contentChars: value.length,
      selectionStart: selStart,
      selectionEnd: selEnd,
      selectedChars: end - start,
      selectionDirection: _editEl?.selectionDirection || 'none',
      selectedTextSample: sampleText(value.slice(start, end)),
      layoutMs: round(layoutMs),
      layout: layoutMetrics(obj, lines),
      ...selectedLineMetrics,
      reportedLineStart: fromLine,
      reportedLineEnd: toLine,
      reportedRows: rows.length,
      rows,
    };
    console.group('[textSel] selectionReport');
    console.log('selection', {
      start: payload.selectionStart,
      end: payload.selectionEnd,
      selectedChars: payload.selectedChars,
      selectedTextSample: payload.selectedTextSample,
    });
    console.table(rows);
    console.groupEnd();
    return payload;
  }

  const report = selectionReport;

  function selectAll() {
    if (typeof editingId === 'undefined' || !editingId || !_editEl) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    _editEl.focus({ preventScroll: true });
    const value = typeof textEditProxyValue === 'function'
      ? textEditProxyValue(_editEl)
      : String(_editEl.value ?? '');
    if (typeof setTextEditProxySelectionRange === 'function') {
      setTextEditProxySelectionRange(_editEl, 0, value.length, 'none', { value });
    } else {
      _editEl.setSelectionRange(0, value.length, 'none');
    }
    _caretVisible = true;
    _logSelection('debug-select-all', _editEl);
    scheduleRender(true, false);
    return selectionReport();
  }

  function measure(options = {}) {
    const reportPayload = selectionReport(options);
    if (!reportPayload) return null;
    const obj = currentTextObject();
    const lines = getTextLayout(obj);
    const selected = new Set(reportPayload.rows.filter((row) => row.selected).map((row) => row.line));
    const targetRows = reportPayload.rows
      .filter((row) => selected.has(row.line) || selected.size === 0)
      .slice(0, Math.max(1, Number(options.lineLimit) || MEASURE_LINE_LIMIT));
    const rows = [];
    for (const row of targetRows) {
      const line = lines[row.line];
      if (!line) continue;
      const text = textValue(line.text);
      const limit = Math.min(text.length, Math.max(1, Number(options.charLimit) || MEASURE_CHAR_LIMIT));
      for (let i = 0; i < limit; i++) {
        const x0 = lineXAtOffset(line, obj, i);
        const x1 = lineXAtOffset(line, obj, i + 1);
        rows.push({
          line: row.line,
          charIndex: line.startIndex + i,
          char: showWhitespace(text[i]),
          x0: round(x0, 3),
          x1: round(x1, 3),
          charWidth: round(x1 - x0, 3),
        });
      }
      if (text.length > limit) {
        rows.push({ line: row.line, truncatedChars: text.length - limit });
      }
    }
    console.table(rows);
    return { ...reportPayload, measuredRows: rows };
  }

  function dump() {
    console.table(events.map(eventRow));
    return events.slice();
  }

  function historyReport(options = {}) {
    const limit = Math.max(1, Math.min(MAX_EVENTS, Number(options.limit) || 260));
    const rows = events
      .filter((evt) => (
        evt.type === 'history' ||
        evt.type === 'selection' ||
        evt.type === 'draw-summary' ||
        evt.type === 'clipboard'
      ))
      .map(eventRow)
      .slice(-limit);
    console.table(rows);
    return rows;
  }

  function reset() {
    events.length = 0;
    nextId = 1;
    for (const key of Object.keys(stats)) stats[key] = 0;
  }

  function _logPointer(label, event = null, extra = {}) {
    if (!_textSelDebugEnabled) return;
    push({
      type: 'pointer',
      label,
      clientX: event?.clientX ?? '',
      clientY: event?.clientY ?? '',
      buttons: event?.buttons ?? '',
      ...extra,
    });
  }

  function _logLayout(label, obj, layout = null, ms = '', extra = {}) {
    if (!_textSelDebugEnabled) return;
    push({
      type: 'layout',
      label,
      ms: Number.isFinite(ms) ? round(ms) : '',
      ...layoutMetrics(obj, layout),
      ...extra,
    });
  }

  return {
    enable,
    disable,
    summary,
    performanceSummary,
    clipboardReport,
    historyReport,
    editLifecycleReport,
    enterEditReport,
    exitEditReport,
    selectionReport,
    report,
    selectAll,
    measure,
    dump,
    reset,
    clear: reset,
    showWhitespace,
    get enabled() { return _textSelDebugEnabled; },
    get events() { return events.slice(); },
    _logPointer,
    _logLayout,
    _logObjectSelection(label, ids = [], meta = {}) {
      if (!_textSelDebugEnabled) return;
      push(selectionModeSnapshot(label, ids, meta));
    },
    _logEditLifecycle(label, obj = currentTextObject(), meta = {}) {
      if (!_textSelDebugEnabled) return;
      push({
        type: 'edit',
        label,
        objectId: obj?.id || '',
        editingId: typeof editingId !== 'undefined' ? editingId || '' : '',
        selectedCount: typeof selectedIds !== 'undefined' ? selectedIds.size : '',
        proxyChars: typeof _editEl?.value === 'string' ? _editEl.value.length : '',
        ...metricsForLifecycleLog(label, obj),
        ...meta,
      });
    },
    _logClipboard(label, obj = currentTextObject(), meta = {}) {
      if (!_textSelDebugEnabled) return;
      push({
        type: 'clipboard',
        label,
        objectId: obj?.id || '',
        editingId: typeof editingId !== 'undefined' ? editingId || '' : '',
        selectedCount: typeof selectedIds !== 'undefined' ? selectedIds.size : '',
        proxyChars: typeof _editEl?.value === 'string' ? _editEl.value.length : '',
        ...lightLayoutMetrics(obj),
        ...meta,
      });
    },
    _logHistoryAction(label, meta = {}) {
      if (!_textSelDebugEnabled) return;
      push({
        type: 'history',
        label,
        editingId: typeof editingId !== 'undefined' ? editingId || '' : '',
        selectedCount: typeof selectedIds !== 'undefined' ? selectedIds.size : '',
        ...meta,
      });
    },
    _logHit(wx, wy, obj, line, returnedIdx, pw) {
      if (!_textSelDebugEnabled) return;
      const baseX = obj.x + TEXT_PAD;
      push({
        type: 'hit',
        wx,
        wy,
        baseX,
        hitLine: sampleText(line?.text || '', 80),
        returnedIdx,
        pw0: pw?.[0],
        pw1: pw?.[1],
        pw2: pw?.[2],
        pw3: pw?.[3],
        ...layoutMetrics(obj),
        note: `wx-baseX=${round(wx - baseX)}`,
      });
    },
    _logHitTiming(label, obj, hit, ms, extra = {}) {
      if (!_textSelDebugEnabled) return;
      push({
        type: 'hit-timing',
        label,
        objectId: obj?.id || '',
        returnedIdx: hit?.index ?? '',
        affinity: hit?.affinity || '',
        lineStartIndex: hit?.lineStartIndex ?? '',
        ms: round(ms),
        ...layoutMetrics(obj),
        ...extra,
      });
    },
    _logDraw(line, selStart, selEnd, x1, x2) {
      if (!_textSelDebugEnabled) return;
      push({
        type: 'draw',
        lineText: sampleText(line?.text || '', 80),
        selStart,
        selEnd,
        selectedChars: Math.abs((selEnd ?? 0) - (selStart ?? 0)),
        x1,
        x2,
        note: `width=${round((x2 ?? 0) - (x1 ?? 0))}`,
      });
    },
    _logSelectionDraw(meta = {}) {
      if (!_textSelDebugEnabled) return;
      push({
        type: 'draw-summary',
        ...meta,
      });
    },
    _logSelection(label, proxy, obj = currentTextObject()) {
      if (!_textSelDebugEnabled || !proxy) return;
      push({
        type: 'selection',
        ...selectionSnapshot(label, proxy, obj),
      });
    },
  };
})();

exposeDebug({ textSel: TextSelDebug });
