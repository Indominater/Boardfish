// ─── Clipboard / image debugger ──────────────────────────────────────────────
var ClipDebug = (() => {

  const MAX_EVENTS = 2000;

  function sanitize(value) {
    return sanitizeDebugMeta(value);
  }

  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish clipboard]',
    sanitize,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish clipboard debugger enabled. Use finishDebug({ clipboard: ["textPasteLagReport", "textClipboardReport", "copyPanReport", "copyBreakdown", "pasteBreakdown", "largePasteReport", "status", "phaseSummary", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish clipboard debugger disabled.');
  }
  const setVerbose = core.setVerbose;
  const start = core.start;
  const step = core.step;
  const end = core.end;

  function timing(meta, key) {
    return meta?.timing?.[key] ?? '';
  }

  function debugRow(e, { includeId = false, includeSkipped = false } = {}) {
    return {
      ...(includeId ? { id: e.id, op: e.op } : {}),
      step: e.step,
      total: e.total,
      dt: e.dt,
      ms: e.meta?.ms ?? '',
      command: e.meta?.command || '',
      path: e.meta?.path || '',
      reason: e.meta?.reason || '',
      objectId: e.meta?.objectId || '',
      selectedCount: e.meta?.selectedCount ?? '',
      objectCount: e.meta?.objectCount ?? '',
      imageCount: e.meta?.imageCount ?? '',
      textObjectCount: e.meta?.textObjectCount ?? '',
      textCharCount: e.meta?.textCharCount ?? '',
      largestTextChars: e.meta?.largestTextChars ?? '',
      trimmedTextObjects: e.meta?.trimmedTextObjects ?? '',
      additionalImageBytes: e.meta?.additionalImageBytes ?? '',
      additionalTextBytes: e.meta?.additionalTextBytes ?? '',
      processed: e.meta?.processed ?? '',
      registeredImages: e.meta?.registeredImages ?? '',
      accepted: e.meta?.accepted ?? '',
      historyIndex: e.meta?.historyIndex ?? '',
      queueMs: e.meta?.queueMs ?? '',
      signature: e.meta?.signature || '',
      imgKey: e.meta?.imgKey || '',
      added: e.meta?.added ?? '',
      displayReady: e.meta?.displayReady ?? '',
      readyStage: e.meta?.readyStage || '',
      bitmapReady: e.meta?.bitmapReady ?? '',
      fallbackReady: e.meta?.fallbackReady ?? '',
      cacheTotalMs: e.meta?.cacheTotalMs ?? '',
      cacheQueueWaitMs: e.meta?.cacheQueueWaitMs ?? '',
      cacheBitmapMs: e.meta?.cacheBitmapMs ?? '',
      objectDelta: e.meta?.objectDelta ?? '',
      dataUrlLen: e.meta?.dataUrlLen ?? '',
      blobSize: e.meta?.blobSize ?? '',
      blobType: e.meta?.blobType || e.meta?.type || '',
      fileName: e.meta?.fileName || '',
      fileSize: e.meta?.fileSize ?? '',
      source: e.meta?.source || '',
      sourceKind: e.meta?.sourceKind || e.meta?.pathKind || e.meta?.assetKind || '',
      sourceLen: e.meta?.sourceLen ?? e.meta?.pathLen ?? e.meta?.assetLen ?? '',
      sourcePrefix: e.meta?.sourcePrefix || e.meta?.pathPrefix || e.meta?.assetPrefix || '',
      sourceBytes: e.meta?.sourceBytes ?? timing(e.meta, 'sourceBytes'),
      bytes: e.meta?.bytes ?? timing(e.meta, 'bytes'),
      assetReady: e.meta?.assetReady ?? '',
      sourcePath: timing(e.meta, 'path'),
      flipped: timing(e.meta, 'flipped'),
      width: e.meta?.width ?? timing(e.meta, 'width'),
      height: e.meta?.height ?? timing(e.meta, 'height'),
      pixels: timing(e.meta, 'pixels'),
      rgbaMB: timing(e.meta, 'rgbaMb'),
      totalMs: timing(e.meta, 'totalMs'),
      decodeMs: timing(e.meta, 'decodeMs'),
      readMs: timing(e.meta, 'readMs'),
      pngEncodeMs: timing(e.meta, 'pngEncodeMs'),
      cacheInsertMs: timing(e.meta, 'cacheInsertMs'),
      base64Ms: timing(e.meta, 'base64Ms'),
      imageDecodeMs: timing(e.meta, 'imageDecodeMs'),
      rgbaConvertMs: timing(e.meta, 'rgbaConvertMs'),
      transformMs: timing(e.meta, 'transformMs'),
      clipboardWriteMs: e.meta?.clipboardWriteMs ?? timing(e.meta, 'clipboardWriteMs'),
      textLen: e.meta?.textLen ?? '',
      boardfishTokenWritten: e.meta?.boardfishTokenWritten ?? '',
      richAttempted: e.meta?.richAttempted ?? '',
      inputType: e.meta?.inputType || '',
      scriptTransformMs: e.meta?.scriptTransformMs ?? '',
      scriptTransformFastPath: e.meta?.scriptTransformFastPath || '',
      scriptTransformInputRangeCount: e.meta?.scriptTransformInputRangeCount ?? '',
      scriptTransformInsertedRangeCount: e.meta?.scriptTransformInsertedRangeCount ?? '',
      scriptTransformInsertedMayCreateRange: e.meta?.scriptTransformInsertedMayCreateRange ?? '',
      scriptTransformLocalDerivedRangeCount: e.meta?.scriptTransformLocalDerivedRangeCount ?? '',
      scriptTransformSkipReason: e.meta?.scriptTransformSkipReason || '',
      scriptTransformSkipRangeIndex: e.meta?.scriptTransformSkipRangeIndex ?? '',
      scriptTransformSkipRangeStart: e.meta?.scriptTransformSkipRangeStart ?? '',
      scriptTransformSkipRangeEnd: e.meta?.scriptTransformSkipRangeEnd ?? '',
      scriptTransformSkipMarkerIndex: e.meta?.scriptTransformSkipMarkerIndex ?? '',
      scriptTransformSkipRangeKind: e.meta?.scriptTransformSkipRangeKind || '',
      eventType: e.meta?.eventType || '',
      eventAgeMs: e.meta?.eventAgeMs ?? '',
      eventAt: e.meta?.eventAt ?? '',
      inputDataLength: e.meta?.inputDataLength ?? '',
      isComposing: e.meta?.isComposing ?? '',
      isTrusted: e.meta?.isTrusted ?? '',
      cancelable: e.meta?.cancelable ?? '',
      defaultPrevented: e.meta?.defaultPrevented ?? '',
      sourceTextLen: e.meta?.sourceTextLen ?? '',
      fallbackTextChars: e.meta?.fallbackTextChars ?? '',
      candidateTextLen: e.meta?.candidateTextLen ?? '',
      candidateScriptRangeCount: e.meta?.candidateScriptRangeCount ?? '',
      selectedChars: e.meta?.selectedChars ?? '',
      selectionStart: e.meta?.selectionStart ?? '',
      selectionEnd: e.meta?.selectionEnd ?? '',
      replacementStart: e.meta?.replacementStart ?? '',
      replacementEnd: e.meta?.replacementEnd ?? '',
      replacementChars: e.meta?.replacementChars ?? '',
      oldChars: e.meta?.oldChars ?? '',
      nextChars: e.meta?.nextChars ?? '',
      insertedChars: e.meta?.insertedChars ?? '',
      removedChars: e.meta?.removedChars ?? '',
      proxyChars: e.meta?.proxyChars ?? '',
      textBytes: e.meta?.textBytes ?? '',
      textLineCount: e.meta?.textLineCount ?? '',
      largestLineChars: e.meta?.largestLineChars ?? '',
      scriptRangeCount: e.meta?.scriptRangeCount ?? '',
      objectWidth: e.meta?.objectWidth ?? '',
      objectHeight: e.meta?.objectHeight ?? '',
      editStartChars: e.meta?.editStartChars ?? '',
      layoutCachePresent: e.meta?.layoutCachePresent ?? '',
      layoutCacheLines: e.meta?.layoutCacheLines ?? '',
      layoutPatched: e.meta?.layoutPatched ?? '',
      layoutPatchMs: e.meta?.layoutPatchMs ?? '',
      layoutPatchTotalMs: e.meta?.layoutPatchTotalMs ?? '',
      layoutPatchRangeMs: e.meta?.layoutPatchRangeMs ?? '',
      layoutPatchSpliceMs: e.meta?.layoutPatchSpliceMs ?? '',
      layoutPatchWrapMs: e.meta?.layoutPatchWrapMs ?? '',
      layoutPatchScriptRangesMs: e.meta?.layoutPatchScriptRangesMs ?? '',
      layoutPatchScriptMetricsMs: e.meta?.layoutPatchScriptMetricsMs ?? '',
      layoutPatchScriptMetricsPatched: e.meta?.layoutPatchScriptMetricsPatched ?? '',
      layoutPatchScriptMetricsPatchReason: e.meta?.layoutPatchScriptMetricsPatchReason || '',
      layoutPatchScriptMetricsInsertedRangeCount: e.meta?.layoutPatchScriptMetricsInsertedRangeCount ?? '',
      layoutPatchInsertLayoutMs: e.meta?.layoutPatchInsertLayoutMs ?? '',
      layoutPatchRemapMs: e.meta?.layoutPatchRemapMs ?? '',
      layoutPatchLinesCacheMs: e.meta?.layoutPatchLinesCacheMs ?? '',
      layoutPatchOldLines: e.meta?.layoutPatchOldLines ?? '',
      layoutPatchNewLines: e.meta?.layoutPatchNewLines ?? '',
      layoutPatchRemovedLines: e.meta?.layoutPatchRemovedLines ?? '',
      layoutPatchInsertedLines: e.meta?.layoutPatchInsertedLines ?? '',
      layoutPatchLineDelta: e.meta?.layoutPatchLineDelta ?? '',
      layoutPatchLogicalLineDelta: e.meta?.layoutPatchLogicalLineDelta ?? '',
      layoutPatchReason: e.meta?.layoutPatchReason || '',
      historyActionMs: e.meta?.historyActionMs ?? '',
      historyRecordMs: e.meta?.historyRecordMs ?? '',
      historyPushed: e.meta?.historyPushed ?? '',
      setRangeTextMs: e.meta?.setRangeTextMs ?? '',
      valueAssignMs: e.meta?.valueAssignMs ?? '',
      valueBuildMs: e.meta?.valueBuildMs ?? '',
      valueSetMs: e.meta?.valueSetMs ?? '',
      selectionSetMs: e.meta?.selectionSetMs ?? '',
      textareaMutationMs: e.meta?.textareaMutationMs ?? '',
      textareaMutationMethod: e.meta?.textareaMutationMethod || '',
      dispatchMs: e.meta?.dispatchMs ?? '',
      heightChanged: e.meta?.heightChanged ?? '',
      autoHeightDeferred: e.meta?.autoHeightDeferred ?? '',
      autoHeightForceSync: e.meta?.autoHeightForceSync ?? '',
      autoHeightForceReason: e.meta?.autoHeightForceReason || '',
      restoredMinLinesReset: e.meta?.restoredMinLinesReset ?? '',
      restoredPreviousMinLines: e.meta?.restoredPreviousMinLines ?? '',
      restoredPreservedMinLines: e.meta?.restoredPreservedMinLines ?? '',
      restoredNextMinLines: e.meta?.restoredNextMinLines ?? '',
      pendingSizeSyncBeforeAutoHeight: e.meta?.pendingSizeSyncBeforeAutoHeight ?? '',
      pendingSizeSync: e.meta?.pendingSizeSync ?? '',
      inputStateObjectHeight: e.meta?.inputStateObjectHeight ?? '',
      inputStateLogicalLines: e.meta?.inputStateLogicalLines ?? '',
      inputStateCachedLines: e.meta?.inputStateCachedLines ?? '',
      inputStateCachedLineSource: e.meta?.inputStateCachedLineSource || '',
      inputStateExpectedLogicalHeight: e.meta?.inputStateExpectedLogicalHeight ?? '',
      inputStateExpectedCachedHeight: e.meta?.inputStateExpectedCachedHeight ?? '',
      inputStateHeightDeltaFromLogical: e.meta?.inputStateHeightDeltaFromLogical ?? '',
      inputStateHeightDeltaFromCached: e.meta?.inputStateHeightDeltaFromCached ?? '',
      updatedObjectHeight: e.meta?.updatedObjectHeight ?? '',
      updatedLogicalLines: e.meta?.updatedLogicalLines ?? '',
      updatedCachedLines: e.meta?.updatedCachedLines ?? '',
      updatedCachedLineSource: e.meta?.updatedCachedLineSource || '',
      updatedExpectedLogicalHeight: e.meta?.updatedExpectedLogicalHeight ?? '',
      updatedExpectedCachedHeight: e.meta?.updatedExpectedCachedHeight ?? '',
      updatedHeightDeltaFromLogical: e.meta?.updatedHeightDeltaFromLogical ?? '',
      updatedHeightDeltaFromCached: e.meta?.updatedHeightDeltaFromCached ?? '',
      beforeAutoHeightObjectHeight: e.meta?.beforeAutoHeightObjectHeight ?? '',
      beforeAutoHeightLogicalLines: e.meta?.beforeAutoHeightLogicalLines ?? '',
      beforeAutoHeightCachedLines: e.meta?.beforeAutoHeightCachedLines ?? '',
      beforeAutoHeightCachedLineSource: e.meta?.beforeAutoHeightCachedLineSource || '',
      beforeAutoHeightExpectedLogicalHeight: e.meta?.beforeAutoHeightExpectedLogicalHeight ?? '',
      beforeAutoHeightExpectedCachedHeight: e.meta?.beforeAutoHeightExpectedCachedHeight ?? '',
      beforeAutoHeightHeightDeltaFromLogical: e.meta?.beforeAutoHeightHeightDeltaFromLogical ?? '',
      beforeAutoHeightHeightDeltaFromCached: e.meta?.beforeAutoHeightHeightDeltaFromCached ?? '',
      afterAutoHeightObjectHeight: e.meta?.afterAutoHeightObjectHeight ?? '',
      afterAutoHeightLogicalLines: e.meta?.afterAutoHeightLogicalLines ?? '',
      afterAutoHeightCachedLines: e.meta?.afterAutoHeightCachedLines ?? '',
      afterAutoHeightCachedLineSource: e.meta?.afterAutoHeightCachedLineSource || '',
      afterAutoHeightExpectedLogicalHeight: e.meta?.afterAutoHeightExpectedLogicalHeight ?? '',
      afterAutoHeightExpectedCachedHeight: e.meta?.afterAutoHeightExpectedCachedHeight ?? '',
      afterAutoHeightHeightDeltaFromLogical: e.meta?.afterAutoHeightHeightDeltaFromLogical ?? '',
      afterAutoHeightHeightDeltaFromCached: e.meta?.afterAutoHeightHeightDeltaFromCached ?? '',
      inputEndObjectHeight: e.meta?.inputEndObjectHeight ?? '',
      inputEndLogicalLines: e.meta?.inputEndLogicalLines ?? '',
      inputEndCachedLines: e.meta?.inputEndCachedLines ?? '',
      inputEndCachedLineSource: e.meta?.inputEndCachedLineSource || '',
      inputEndExpectedLogicalHeight: e.meta?.inputEndExpectedLogicalHeight ?? '',
      inputEndExpectedCachedHeight: e.meta?.inputEndExpectedCachedHeight ?? '',
      inputEndHeightDeltaFromLogical: e.meta?.inputEndHeightDeltaFromLogical ?? '',
      inputEndHeightDeltaFromCached: e.meta?.inputEndHeightDeltaFromCached ?? '',
      proxyScrollHeight: e.meta?.proxyScrollHeight ?? '',
      proxyClientHeight: e.meta?.proxyClientHeight ?? '',
      renderScheduleMs: e.meta?.renderScheduleMs ?? '',
      renderBoard: e.meta?.renderBoard ?? '',
      renderOverlay: e.meta?.renderOverlay ?? '',
      renderSource: e.meta?.renderSource || '',
      pasted: e.meta?.pasted ?? '',
      seq: e.meta?.seq ?? '',
      expected: e.meta?.expected ?? '',
      current: e.meta?.current ?? '',
      ...(includeSkipped ? { skipped: e.meta?.skipped ?? '' } : {}),
      error: e.meta?.error || '',
    };
  }

  function dump() {
    console.table(events);
    return events.slice();
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => debugRow(e, { includeId: true }));
    console.table(rows);
    return rows;
  }

  function phaseSummary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => debugRow(e, { includeId: true, includeSkipped: true }));
    console.table(rows);
    return rows;
  }

  function copyBreakdown() {
    const rows = events
      .filter(e => (e.op === 'copySelected' || e.op === 'copyTextEditSelection') && e.step && e.step !== 'start')
      .map(e => debugRow(e, { includeId: true, includeSkipped: true }));
    console.table(rows);
    return rows;
  }

  function copyPanReport() {
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const copyStarts = events.filter(e => e.op === 'copySelected' && e.step === 'start');
    const copyStart = copyStarts[copyStarts.length - 1];
    if (!copyStart) {
      const empty = { copyRuns: 0, verdict: 'no copySelected events captured' };
      console.table([empty]);
      return empty;
    }

    const run = events.filter(e => e.id === copyStart.id);
    const latest = (stepName) => [...run].reverse().find(e => e.step === stepName);
    const copyEnd = latest('end');
    const copyDoneAt = copyEnd?.at ?? run[run.length - 1]?.at ?? copyStart.at;
    const copyWindowRows = events.filter(e => e.at >= copyStart.at && e.at <= copyDoneAt + 1);
    const renderCanvasEnd = copyWindowRows.find(e => e.op === 'renderImageToCanvas' && e.step === 'end');
    const pngBlobEnd = copyWindowRows.find(e => e.op === 'canvasToPngBlob' && e.step === 'end');
    const webSourcePngBlob = latest('copy:web-source-png-blob');
    const webClipboardWriteEnd = latest('copy:web-clipboard-write-end');

    const viewportEvents = typeof ViewportDebug !== 'undefined' ? ViewportDebug.events : [];
    const frameStarts = new Map();
    for (const e of viewportEvents) {
      if (e.op === 'frame' && e.step === 'start') frameStarts.set(e.id, e);
    }
    const frameRows = viewportEvents
      .filter(e => e.op === 'frame' && e.step === 'end')
      .map(e => ({
        kind: 'pan-frame',
        at: e.at,
        id: e.id,
        ...(frameStarts.get(e.id)?.meta || {}),
        ...(e.meta || {}),
      }))
      .filter(row => row.at >= copyStart.at && /pan/.test(String(row.inputSource || row.sources || '')));

    const timeline = [];
    for (const e of viewportEvents) {
      if (e.at < copyStart.at) continue;
      if (e.op === 'wheel' && e.step === 'end' && e.meta?.mode === 'pan') {
        timeline.push({
          kind: 'wheel-pan',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          gapMs: '',
          deltaX: e.meta?.appliedDX ?? e.meta?.deltaX ?? '',
          deltaY: e.meta?.appliedDY ?? e.meta?.deltaY ?? '',
        });
      } else if (e.op === 'mousePan' && e.step === 'start') {
        timeline.push({
          kind: 'mouse-pan-start',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          startX: e.meta?.startX ?? '',
          startY: e.meta?.startY ?? '',
        });
      } else if (e.op === 'eventLoop' && e.step === 'gap') {
        timeline.push({
          kind: 'event-loop-gap',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          gapMs: e.meta?.gapMs ?? '',
          overMs: e.meta?.overMs ?? '',
        });
      } else if (e.op === 'longTask' && e.step === 'entry') {
        timeline.push({
          kind: 'long-task',
          at: e.at,
          afterCopyMs: round(e.at - copyStart.at),
          durationMs: e.meta?.duration ?? '',
          startTime: e.meta?.startTime ?? '',
        });
      }
    }
    for (const row of frameRows) {
      timeline.push({
        kind: row.kind,
        at: row.at,
        afterCopyMs: round(row.at - copyStart.at),
        inputSource: row.inputSource || '',
        inputAgeMs: row.inputAgeMs ?? '',
        queueMs: row.queueMs ?? '',
        frameMs: row.frameMs ?? '',
        rafGap: row.rafGap ?? '',
        sources: row.sources || '',
      });
    }
    timeline.sort((a, b) => a.at - b.at);
    const wheelPanRows = timeline.filter(row => row.kind === 'wheel-pan');
    for (let i = 1; i < wheelPanRows.length; i++) {
      wheelPanRows[i].gapMs = round(wheelPanRows[i].at - wheelPanRows[i - 1].at);
    }
    const rawInputRows = viewportEvents
      .filter(e => e.op === 'input' && e.at >= copyStart.at)
      .map(e => ({
        at: e.at,
        step: e.step,
        ...(e.meta || {}),
      }));

    const firstPan = timeline.find(row => /pan/.test(row.kind));
    const firstPanFrame = timeline.find(row => row.kind === 'pan-frame');
    const windowEndAt = Math.max(copyDoneAt, firstPan?.at || copyDoneAt);
    const eventLoopGapsDuringCopy = timeline
      .filter(row => row.kind === 'event-loop-gap' && row.at <= windowEndAt)
      .map(row => Number(row.gapMs) || 0);
    const maxEventLoopGapMs = eventLoopGapsDuringCopy.reduce((max, value) => Math.max(max, value), 0);
    const copyPendingAtFirstPan = !!firstPan && copyDoneAt > firstPan.at;
    const dataUrlLen = latest('copy:source-ready')?.meta?.dataUrlLen ?? '';
    const sourceLen = latest('copy:key-start')?.meta?.sourceLen ?? '';
    const sourceBytes = webSourcePngBlob?.meta?.sourceBytes || '';
    const renderCanvasMs = renderCanvasEnd?.total ?? '';
    const pngBlobMs = pngBlobEnd?.total ?? '';
    const webSourcePngBlobMs = webSourcePngBlob?.meta?.ms ?? '';
    const webBlobReady = pngBlobEnd || webSourcePngBlob;
    const webClipboardWriteAfterBlobMs = webBlobReady && (webClipboardWriteEnd || copyEnd)
      ? round((webClipboardWriteEnd?.at ?? copyEnd.at) - webBlobReady.at)
      : '';
    const maxWheelPanGapMs = wheelPanRows.reduce((max, row) => Math.max(max, Number(row.gapMs) || 0), 0);
    const postCopyWheelPanGapMs = wheelPanRows
      .filter(row => row.at >= copyDoneAt && row.at <= copyDoneAt + 1500)
      .reduce((max, row) => Math.max(max, Number(row.gapMs) || 0), 0);
    const maxPanFrameRafGapMs = timeline
      .filter(row => row.kind === 'pan-frame')
      .reduce((max, row) => Math.max(max, Number(row.rafGap) || 0), 0);
    const firstRawInput = rawInputRows.find(row => row.at >= copyDoneAt);
    const firstRawWheel = rawInputRows.find(row => row.eventType === 'wheel' && row.at >= copyDoneAt);
    const blockedInputsAfterCopy = rawInputRows
      .filter(row => row.step === 'shield-block' && row.at >= copyDoneAt && row.at <= copyDoneAt + 1500)
      .length;
    const firstRawWheelDeliveryAgeMs = Number(firstRawWheel?.eventAgeMs) || 0;
    const firstPanFrameMs = Number(firstPanFrame?.frameMs) || 0;
    const firstPanInputAgeMs = Number(firstPanFrame?.inputAgeMs) || 0;
    const likelyBlock = Math.max(
      maxEventLoopGapMs,
      firstPanInputAgeMs,
      firstPanFrameMs,
      postCopyWheelPanGapMs,
      maxPanFrameRafGapMs,
      firstRawWheelDeliveryAgeMs
    ) > 32;
    const webRenderedPath = copyEnd?.meta?.path === 'image-web-rendered';
    let verdict = 'no >32ms copy-to-pan stall captured';
    if (!firstPan) {
      verdict = blockedInputsAfterCopy
        ? 'copy captured; post-copy input was blocked by Boardfish input shield'
        : 'copy captured; no pan input captured after copy';
    } else if (blockedInputsAfterCopy) {
      verdict = 'post-copy input reached Boardfish but was blocked by input shield';
    } else if (firstRawWheelDeliveryAgeMs > 32) {
      verdict = 'pan input was generated earlier but delivered late to Boardfish';
    } else if (likelyBlock && webRenderedPath) {
      verdict = 'stutter captured on web image copy; inspect render/png/clipboard timings and pan gaps';
    } else if (likelyBlock && copyPendingAtFirstPan) {
      verdict = 'stutter overlaps browser clipboard write; inspect clipboard timing and pan gaps';
    } else if (likelyBlock) {
      verdict = 'pan frame or event-loop gap is slow; inspect viewport timeline';
    }

    const summary = {
      copyRuns: copyStarts.length,
      copyPath: copyEnd?.meta?.path || '',
      sourceLen,
      sourceBytes,
      dataUrlLen,
      webClipboardWriteMs: webClipboardWriteEnd?.meta?.ms ?? '',
      webSourcePngBlobMs,
      renderCanvasMs,
      pngBlobMs,
      webClipboardWriteAfterBlobMs,
      maxWheelPanGapMs: round(maxWheelPanGapMs),
      postCopyWheelPanGapMs: round(postCopyWheelPanGapMs),
      maxPanFrameRafGapMs: round(maxPanFrameRafGapMs),
      firstRawInputAfterCopyEndMs: firstRawInput ? round(firstRawInput.at - copyDoneAt) : '',
      firstRawInputType: firstRawInput?.eventType || '',
      firstRawWheelAfterCopyEndMs: firstRawWheel ? round(firstRawWheel.at - copyDoneAt) : '',
      firstRawWheelEventAfterCopyEndMs: firstRawWheel?.eventAt ? round(firstRawWheel.eventAt - copyDoneAt) : '',
      firstRawWheelDeliveryAgeMs: firstRawWheel?.eventAgeMs ?? '',
      blockedInputsAfterCopy,
      copyEndMs: copyEnd?.total ?? '',
      firstPanAfterCopyEndMs: firstPan ? round(firstPan.at - copyDoneAt) : '',
      firstPanAfterCopyMs: firstPan?.afterCopyMs ?? '',
      firstPanKind: firstPan?.kind || '',
      copyPendingAtFirstPan,
      firstPanInputAgeMs: firstPanFrame?.inputAgeMs ?? '',
      firstPanFrameMs: firstPanFrame?.frameMs ?? '',
      firstPanRafGapMs: firstPanFrame?.rafGap ?? '',
      eventLoopGapsDuringCopy: eventLoopGapsDuringCopy.length,
      maxEventLoopGapMs: round(maxEventLoopGapMs),
      verdict,
    };
    console.table([summary]);
    console.table(timeline.slice(0, 80));
    return {
      summary,
      timeline: timeline.slice(0, 200),
      rawInputRows: rawInputRows.slice(0, 200),
      copyRows: copyWindowRows.map(e => debugRow(e, { includeId: true, includeSkipped: true })),
    };
  }

  function memorySnapshotFromEvent(e) {
    const meta = e?.meta || {};
    const bytes = Number(meta.blobSize ?? meta.bytes ?? timing(meta, 'bytes')) || 0;
    const dataUrlLen = Number(meta.dataUrlLen) || 0;
    const width = Number(meta.width ?? timing(meta, 'width')) || 0;
    const height = Number(meta.height ?? timing(meta, 'height')) || 0;
    const pixels = Number(meta.pixels ?? timing(meta, 'pixels')) || (width && height ? width * height : 0);
    return {
      blobMB: bytes ? Math.round(bytes / 1024 / 1024 * 100) / 100 : '',
      dataUrlMB: dataUrlLen ? Math.round(dataUrlLen / 1024 / 1024 * 100) / 100 : '',
      rgbaMB: pixels ? Math.round(pixels * 4 / 1024 / 1024 * 100) / 100 : '',
      width: width || '',
      height: height || '',
      pixels: pixels || '',
    };
  }

  function largePasteReport() {
    const pasteStarts = events.filter(e => e.op === 'pasteAtPos' && e.step === 'start');
    const pasteStart = pasteStarts[pasteStarts.length - 1];
    if (!pasteStart) {
      const empty = { pasteRuns: 0, verdict: 'no pasteAtPos events captured' };
      console.table([empty]);
      return empty;
    }
    const run = events.filter(e => e.id === pasteStart.id);
    const stepNames = new Set(run.map(e => e.step));
    const latest = (stepName) => [...run].reverse().find(e => e.step === stepName);
    const firstError = run.find(e => /(?:error|miss|empty)$/i.test(e.step) || e.meta?.error);
    const blobEvent = latest('event-image-blob') || latest('browser-image-blob');
    const blobReadOk = latest('clipboard-blob-read:ok');
    const webInsertEnd = latest('web-paste-event:insert-end') || latest('web-paste-browser:insert-end');
    const addObject = latest('paste:objects-add-start') || latest('paste-image:add-object') || webInsertEnd;
    const end = latest('end');
    const textPayload = latest('paste:objects-add-done') || latest('paste:clone-done') || latest('paste:objects-start') || end;
    const objectCountBefore = pasteStart?.meta?.objectCountBefore ?? '';
    const objectCountAfter = end?.meta?.objectCountAfter ?? '';
    const objectDelta = typeof objectCountBefore === 'number' && typeof objectCountAfter === 'number'
      ? objectCountAfter - objectCountBefore
      : '';
    const pathDetected = webInsertEnd
      ? end?.meta?.path || 'web-paste-blob'
      : blobReadOk
      ? 'event-or-browser-blob'
      : stepNames.has('browser-clipboard-read:start')
        ? 'browser-read'
        : stepNames.has('event-clipboard:inspect')
          ? 'paste-event'
          : 'unknown';
    const checkpoints = [
      ['pasteStarted', true],
      ['eventInspected', stepNames.has('event-clipboard:inspect') || !pasteStart.meta?.clipboardData],
      ['imagePayloadFound', !!blobEvent || !!webInsertEnd || pathDetected === 'browser-read'],
      ['imagePayloadRead', !!blobReadOk || !!webInsertEnd || pathDetected !== 'unknown'],
      ['objectAddStarted', !!addObject],
      ['pasteEndedAdded', end?.meta?.added === true || objectDelta > 0],
    ];
    const failedCheckpoint = checkpoints.find(([, ok]) => !ok);
    const sizeEvent = blobReadOk || blobEvent;
    const out = {
      pasteRuns: pasteStarts.length,
      totalMs: end?.total ?? run.at(-1)?.total ?? '',
      path: end?.meta?.path || '',
      added: end?.meta?.added ?? '',
      displayReady: end?.meta?.displayReady ?? (webInsertEnd ? true : ''),
      readyStage: end?.meta?.readyStage || '',
      bitmapReady: end?.meta?.bitmapReady ?? '',
      objectCountBefore,
      objectCountAfter,
      objectDelta,
      textObjectCount: textPayload?.meta?.textObjectCount ?? '',
      textCharCount: textPayload?.meta?.textCharCount ?? '',
      largestTextChars: textPayload?.meta?.largestTextChars ?? '',
      pathDetected,
      imageSource: blobEvent?.meta?.type || blobReadOk?.meta?.blobType || '',
      blobSize: blobEvent?.meta?.blobSize ?? blobReadOk?.meta?.blobSize ?? '',
      bytes: blobReadOk?.meta?.bytes ?? blobEvent?.meta?.bytes ?? '',
      dataUrlLen: blobReadOk?.meta?.dataUrlLen ?? '',
      ...memorySnapshotFromEvent(sizeEvent),
      failedCheckpoint: failedCheckpoint ? failedCheckpoint[0] : '',
      firstErrorStep: firstError?.step || '',
      firstError: firstError?.meta?.error || '',
      verdict: failedCheckpoint
        ? `inspect ${failedCheckpoint[0]} and surrounding rows`
        : 'all paste checkpoints reached in captured run',
    };
    console.table([out]);
    console.table(checkpoints.map(([checkpoint, ok]) => ({ checkpoint, ok })));
    return { summary: out, checkpoints: checkpoints.map(([checkpoint, ok]) => ({ checkpoint, ok })), rows: run.map(e => debugRow(e, { includeId: true, includeSkipped: true })) };
  }

  function pasteBreakdown() {
    const pasteStarts = events.filter(e => e.op === 'pasteAtPos' && e.step === 'start');
    const pasteStart = pasteStarts[pasteStarts.length - 1];
    if (!pasteStart) {
      const empty = { pasteRuns: 0, verdict: 'no pasteAtPos events captured' };
      console.table([empty]);
      return empty;
    }
    const run = events.filter(e => e.id === pasteStart.id);
    const latest = (stepName) => [...run].reverse().find(e => e.step === stepName);
    const first = (stepName) => run.find(e => e.step === stepName);
    const blobEvent = latest('event-image-blob') || latest('browser-image-blob');
    const blobReadOk = latest('clipboard-blob-read:ok');
    const objectAdd = latest('paste:objects-add-start') || latest('paste-image:add-object');
    const webInsertEnd = latest('web-paste-event:insert-end') || latest('web-paste-browser:insert-end');
    const readyEnd = latest('paste-image:ready-wait-end');
    const cloneDone = latest('paste:clone-done');
    const trimDone = latest('paste:text-trim-done');
    const objectLimitDone = latest('paste:object-limit-done');
    const contentLimitDone = latest('paste:content-limit-done');
    const registerImagesDone = latest('paste:register-images-done');
    const historyStart = latest('paste:boardHistory-start');
    const historyDone = latest('paste:boardHistory-done');
    const end = latest('end');
    const textPayload = latest('paste:objects-add-done') || latest('paste:clone-done') || latest('paste:objects-start') || end;
    const imageReadAt = blobReadOk?.total ?? webInsertEnd?.total ?? '';
    const objectAt = objectAdd?.total ?? webInsertEnd?.total ?? '';
    const displayAt = readyEnd?.total ?? webInsertEnd?.total ?? '';
    const out = {
      pasteRuns: pasteStarts.length,
      path: end?.meta?.path || '',
      totalMs: end?.total ?? run.at(-1)?.total ?? '',
      imagePayloadAtMs: imageReadAt,
      objectAtMs: objectAt,
      displayReadyAtMs: displayAt,
      objectToDisplayMs: typeof objectAt === 'number' && typeof displayAt === 'number' ? Math.round((displayAt - objectAt) * 100) / 100 : '',
      textObjectCount: textPayload?.meta?.textObjectCount ?? '',
      textCharCount: textPayload?.meta?.textCharCount ?? '',
      largestTextChars: textPayload?.meta?.largestTextChars ?? '',
      cloneMs: cloneDone?.meta?.ms ?? '',
      trimMs: trimDone?.meta?.ms ?? '',
      trimmedTextObjects: trimDone?.meta?.trimmedTextObjects ?? '',
      objectLimitMs: objectLimitDone?.meta?.ms ?? '',
      objectLimitAccepted: objectLimitDone?.meta?.accepted ?? '',
      contentLimitMs: contentLimitDone?.meta?.ms ?? '',
      contentLimitAccepted: contentLimitDone?.meta?.accepted ?? '',
      additionalTextBytes: contentLimitDone?.meta?.additionalTextBytes ?? '',
      additionalImageBytes: contentLimitDone?.meta?.additionalImageBytes ?? '',
      registerImagesMs: registerImagesDone?.meta?.ms ?? '',
      historyMs: typeof historyStart?.total === 'number' && typeof historyDone?.total === 'number'
        ? Math.round((historyDone.total - historyStart.total) * 100) / 100
        : '',
      blobReadMs: blobReadOk?.meta?.ms ?? '',
      blobSize: blobEvent?.meta?.blobSize ?? blobReadOk?.meta?.blobSize ?? '',
      dataUrlLen: blobReadOk?.meta?.dataUrlLen ?? '',
      readyStage: readyEnd?.meta?.readyStage || end?.meta?.readyStage || '',
      cacheTotalMs: readyEnd?.meta?.cacheTotalMs ?? '',
      cacheQueueWaitMs: readyEnd?.meta?.cacheQueueWaitMs ?? '',
      cacheBitmapMs: readyEnd?.meta?.cacheBitmapMs ?? '',
      displayReady: end?.meta?.displayReady ?? (webInsertEnd ? true : ''),
      bitmapReady: end?.meta?.bitmapReady ?? '',
      added: end?.meta?.added ?? '',
      objectDelta: webInsertEnd?.meta?.objectDelta ?? '',
      firstPayloadStep: first('event-image-blob')?.step || first('browser-image-blob')?.step || '',
      verdict: end?.meta?.added || webInsertEnd?.meta?.added
        ? 'paste produced a drawable object'
        : 'paste did not add an image; inspect rows',
    };
    console.table([out]);
    return { summary: out, rows: run.map(e => debugRow(e, { includeId: true, includeSkipped: true })) };
  }

  function textPasteLagReport(options = {}) {
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const pasteStarts = events.filter(e => e.op === 'pasteTextEditSelection' && e.step === 'start');
    const pasteStart = pasteStarts[pasteStarts.length - 1];
    if (!pasteStart) {
      const empty = { pasteRuns: 0, verdict: 'no pasteTextEditSelection events captured' };
      console.table([empty]);
      return empty;
    }

    const run = events.filter(e => e.id === pasteStart.id && e.op === pasteStart.op);
    const latest = (stepName) => [...run].reverse().find(e => e.step === stepName);
    const first = (stepName) => run.find(e => e.step === stepName);
    const latestMetaValue = (names) => {
      for (const event of [...run].reverse()) {
        for (const name of names) {
          const value = event.meta?.[name];
          if (value !== undefined && value !== '') return value;
        }
      }
      return '';
    };
    const summarizePasteRun = (start) => {
      const runEvents = events.filter(e => e.id === start.id && e.op === start.op);
      const runLatest = (stepName) => [...runEvents].reverse().find(e => e.step === stepName);
      const nativeAllowed = runLatest('paste:text-edit-native-textarea-allowed');
      const end = runLatest('end');
      const last = end || runEvents[runEvents.length - 1] || start;
      const inputEndForRun = runLatest('text-edit-input:end');
      const rangeTextForRun = runLatest('paste:text-edit-range-text-set');
      const scriptTransformForRun = runLatest('text-edit-input:script-ranges-transformed');
      const layoutForRun = runLatest('text-edit-input:layout-patched') || runLatest('text-edit-input:layout-invalidated');
      const dispatchForRun = runLatest('paste:text-edit-input-dispatched');
      const inputMs = Number(inputEndForRun?.meta?.totalMs ?? inputEndForRun?.dt) || 0;
      const transformMs = Number(scriptTransformForRun?.meta?.scriptTransformMs ?? scriptTransformForRun?.dt) || 0;
      const textareaMs = Number(rangeTextForRun?.meta?.textareaMutationMs ?? rangeTextForRun?.meta?.setRangeTextMs) || 0;
      let runVerdict = 'no >32ms paste/input stall captured';
      if (nativeAllowed && !end) runVerdict = 'native paste allowed; waiting for input/end capture';
      else if (transformMs > 32) runVerdict = 'script range transform slow';
      else if (inputMs > 32 || Number(dispatchForRun?.meta?.dispatchMs || 0) > 32) runVerdict = 'input handler slow';
      else if (textareaMs > 32) runVerdict = `textarea ${rangeTextForRun?.meta?.textareaMutationMethod || 'mutation'} slow`;
      return {
        id: start.id,
        path: end?.meta?.path || (nativeAllowed ? 'jsClipboard-text-selection-native' : ''),
        pasted: end?.meta?.pasted ?? '',
        totalMs: end?.total ?? last?.total ?? '',
        nativeAllowed: !!nativeAllowed,
        inputCaptured: !!inputEndForRun,
        fallbackTextChars: runLatest('paste:text-edit-event-read-done')?.meta?.fallbackTextChars ?? '',
        candidateTextLen: runLatest('paste:text-edit-event-read-done')?.meta?.candidateTextLen ?? '',
        insertedChars: runLatest('text-edit-input:replacement-ready')?.meta?.insertedChars ?? end?.meta?.textCharCount ?? '',
        inputHandlerMs: inputEndForRun?.meta?.totalMs ?? inputEndForRun?.dt ?? '',
        dispatchMs: dispatchForRun?.meta?.dispatchMs ?? '',
        scriptTransformMs: scriptTransformForRun?.meta?.scriptTransformMs ?? '',
        scriptTransformFastPath: scriptTransformForRun?.meta?.scriptTransformFastPath || '',
        scriptTransformInsertedMayCreateRange: scriptTransformForRun?.meta?.scriptTransformInsertedMayCreateRange ?? '',
        scriptTransformLocalDerivedRangeCount: scriptTransformForRun?.meta?.scriptTransformLocalDerivedRangeCount ?? '',
        scriptTransformSkipReason: scriptTransformForRun?.meta?.scriptTransformSkipReason || '',
        scriptTransformSkipRangeIndex: scriptTransformForRun?.meta?.scriptTransformSkipRangeIndex ?? '',
        textareaMutationMs: rangeTextForRun?.meta?.textareaMutationMs ?? rangeTextForRun?.meta?.setRangeTextMs ?? '',
        textareaMutationMethod: rangeTextForRun?.meta?.textareaMutationMethod || '',
        layoutPatchMs: layoutForRun?.meta?.layoutPatchMs ?? '',
        verdict: runVerdict,
      };
    };
    const runSummaries = pasteStarts.map(summarizePasteRun);
    const pasteEnd = latest('end') || run[run.length - 1] || pasteStart;
    const inputStart = first('text-edit-input:start');
    const inputEnd = latest('text-edit-input:end');
    const renderScheduled = latest('text-edit-input:render-scheduled');
    const autoHeight = latest('text-edit-input:auto-height-done');
    const layoutPatch = latest('text-edit-input:layout-patched') || latest('text-edit-input:layout-invalidated');
    const history = latest('text-edit-input:history-recorded');
    const scriptTransform = latest('text-edit-input:script-ranges-transformed');
    const replacement = latest('text-edit-input:replacement-ready') || latest('paste:text-edit-replace-selection-ready');
    const rangeText = latest('paste:text-edit-range-text-set');
    const dispatch = latest('paste:text-edit-input-dispatched');
    const windowBeforeMs = Number(options.windowBeforeMs ?? 40) || 40;
    const windowAfterMs = Number(options.windowAfterMs ?? 1200) || 1200;
    const startAt = Math.max(0, pasteStart.at - windowBeforeMs);
    const endAt = (pasteEnd.at || pasteStart.at) + windowAfterMs;
    const viewportEvents = typeof ViewportDebug !== 'undefined' ? ViewportDebug.events : [];
    const frameStarts = new Map();
    for (const event of viewportEvents) {
      if (event.op === 'frame' && event.step === 'start') frameStarts.set(event.id, event);
    }
    const frameRows = viewportEvents
      .filter(e => e.op === 'frame' && e.step === 'end' && e.at >= startAt && e.at <= endAt)
      .map(e => ({
        at: e.at,
        afterPasteStartMs: round(e.at - pasteStart.at),
        afterPasteEndMs: pasteEnd?.at ? round(e.at - pasteEnd.at) : '',
        ...(frameStarts.get(e.id)?.meta || {}),
        ...(e.meta || {}),
      }));
    const rawInputRows = viewportEvents
      .filter(e => e.op === 'input' && e.at >= startAt && e.at <= endAt)
      .map(e => ({
        at: e.at,
        afterPasteStartMs: round(e.at - pasteStart.at),
        step: e.step,
        eventType: e.meta?.eventType || '',
        inputType: e.meta?.inputType || '',
        eventAgeMs: e.meta?.eventAgeMs ?? '',
        source: e.meta?.source || '',
        target: e.meta?.target || '',
        defaultPrevented: e.meta?.defaultPrevented ?? '',
        blocked: e.meta?.blocked ?? '',
      }));
    const eventLoopRows = viewportEvents
      .filter(e => (e.op === 'eventLoop' || e.op === 'longTask') && e.at >= startAt && e.at <= endAt)
      .map(e => ({
        at: e.at,
        afterPasteStartMs: round(e.at - pasteStart.at),
        kind: e.op,
        step: e.step,
        gapMs: e.meta?.gapMs ?? '',
        durationMs: e.meta?.duration ?? '',
      }));
    const max = (rows, field) => rows.reduce((value, row) => Math.max(value, Number(row[field]) || 0), 0);
    const maxFrameMs = max(frameRows, 'frameMs');
    const maxDrawMs = max(frameRows, 'totalMeasuredMs');
    const maxEditingOverlayMs = max(frameRows, 'editingOverlayMs');
    const maxEditLayoutMs = max(frameRows, 'editLayoutMs');
    const maxEditTextDrawMs = max(frameRows, 'editTextDrawMs');
    const maxEditSelectionMs = max(frameRows, 'editSelectionMs');
    const maxEventLoopGapMs = max(eventLoopRows, 'gapMs');
    const maxLongTaskMs = max(eventLoopRows, 'durationMs');
    const firstFrameAfterInput = inputEnd
      ? frameRows.find(row => row.at >= inputEnd.at)
      : frameRows.find(row => row.at >= pasteEnd.at);
    const browserPasteEventAgeMs = Number(pasteStart.meta?.eventAgeMs) || 0;
    const inputEventAgeMs = Number(inputStart?.meta?.eventAgeMs) || 0;
    const inputHandlerMs = Number(inputEnd?.meta?.totalMs ?? inputEnd?.dt) || 0;
    const scriptTransformMs = Number(scriptTransform?.meta?.scriptTransformMs ?? scriptTransform?.dt) || 0;
    const dispatchMs = Number(dispatch?.meta?.dispatchMs) || 0;
    const setRangeTextMs = Number(rangeText?.meta?.setRangeTextMs) || 0;
    const textareaMutationMs = Number(rangeText?.meta?.textareaMutationMs ?? rangeText?.meta?.setRangeTextMs) || 0;
    const historyRecordMs = Number(history?.meta?.historyRecordMs) || 0;
    const renderToFirstFrameMs = firstFrameAfterInput && renderScheduled
      ? round(firstFrameAfterInput.at - renderScheduled.at)
      : '';
    let verdict = 'no >32ms paste/input/render stall captured';
    if (browserPasteEventAgeMs > 32 || inputEventAgeMs > 32) {
      verdict = 'native paste/input event delivery was delayed before Boardfish handled it';
    } else if (scriptTransformMs > 32) {
      verdict = 'text script range transform was slow; inspect text-edit-input:script-ranges-transformed';
    } else if (inputHandlerMs > 32 || dispatchMs > 32) {
      verdict = 'Boardfish text input handler was slow; inspect text-edit-input rows';
    } else if (textareaMutationMs > 32) {
      verdict = `browser textarea ${rangeText?.meta?.textareaMutationMethod || 'mutation'} was slow for the large value`;
    } else if (historyRecordMs > 32) {
      verdict = 'text edit history checkpoint was slow';
    } else if (maxFrameMs > 32 || maxDrawMs > 32 || maxEditingOverlayMs > 32) {
      verdict = 'post-paste render frame was slow; inspect frame and draw rows';
    } else if (maxEventLoopGapMs > 32 || maxLongTaskMs > 32) {
      verdict = 'event loop gap or browser long task overlapped the paste';
    }
    const summary = {
      pasteRuns: pasteStarts.length,
      path: pasteEnd?.meta?.path || '',
      pasted: pasteEnd?.meta?.pasted ?? '',
      totalMs: pasteEnd?.total ?? '',
      browserPasteEventAgeMs: pasteStart.meta?.eventAgeMs ?? '',
      inputEventAgeMs: inputStart?.meta?.eventAgeMs ?? '',
      inputHandlerMs: inputEnd?.meta?.totalMs ?? inputEnd?.dt ?? '',
      dispatchMs: dispatch?.meta?.dispatchMs ?? '',
      scriptTransformMs: scriptTransform?.meta?.scriptTransformMs ?? '',
      scriptTransformFastPath: scriptTransform?.meta?.scriptTransformFastPath || '',
      scriptTransformInputRangeCount: scriptTransform?.meta?.scriptTransformInputRangeCount ?? '',
      scriptTransformInsertedRangeCount: scriptTransform?.meta?.scriptTransformInsertedRangeCount ?? '',
      scriptTransformInsertedMayCreateRange: scriptTransform?.meta?.scriptTransformInsertedMayCreateRange ?? '',
      scriptTransformLocalDerivedRangeCount: scriptTransform?.meta?.scriptTransformLocalDerivedRangeCount ?? '',
      scriptTransformSkipReason: scriptTransform?.meta?.scriptTransformSkipReason || '',
      scriptTransformSkipRangeIndex: scriptTransform?.meta?.scriptTransformSkipRangeIndex ?? '',
      scriptTransformSkipRangeStart: scriptTransform?.meta?.scriptTransformSkipRangeStart ?? '',
      scriptTransformSkipRangeEnd: scriptTransform?.meta?.scriptTransformSkipRangeEnd ?? '',
      scriptTransformSkipMarkerIndex: scriptTransform?.meta?.scriptTransformSkipMarkerIndex ?? '',
      scriptTransformSkipRangeKind: scriptTransform?.meta?.scriptTransformSkipRangeKind || '',
      setRangeTextMs: rangeText?.meta?.setRangeTextMs ?? '',
      valueAssignMs: rangeText?.meta?.valueAssignMs ?? '',
      valueBuildMs: rangeText?.meta?.valueBuildMs ?? '',
      valueSetMs: rangeText?.meta?.valueSetMs ?? '',
      selectionSetMs: rangeText?.meta?.selectionSetMs ?? '',
      textareaMutationMs: rangeText?.meta?.textareaMutationMs ?? rangeText?.meta?.setRangeTextMs ?? '',
      textareaMutationMethod: rangeText?.meta?.textareaMutationMethod || '',
      historyRecordMs: history?.meta?.historyRecordMs ?? '',
      historyPushed: history?.meta?.historyPushed ?? '',
      renderScheduleMs: renderScheduled?.meta?.renderScheduleMs ?? '',
      renderToFirstFrameMs,
      firstFrameAfterInputMs: firstFrameAfterInput ? round(firstFrameAfterInput.at - (inputEnd?.at || pasteEnd.at)) : '',
      maxFrameMs: round(maxFrameMs),
      maxDrawMs: round(maxDrawMs),
      maxEditingOverlayMs: round(maxEditingOverlayMs),
      maxEditLayoutMs: round(maxEditLayoutMs),
      maxEditTextDrawMs: round(maxEditTextDrawMs),
      maxEditSelectionMs: round(maxEditSelectionMs),
      maxEventLoopGapMs: round(maxEventLoopGapMs),
      maxLongTaskMs: round(maxLongTaskMs),
      oldChars: replacement?.meta?.oldChars ?? '',
      nextChars: replacement?.meta?.nextChars ?? '',
      insertedChars: latestMetaValue(['insertedChars', 'textLen', 'fallbackTextChars', 'textCharCount']),
      selectedChars: latestMetaValue(['selectedChars']),
      textBytes: latestMetaValue(['textBytes']),
      textLineCount: latestMetaValue(['textLineCount']),
      largestLineChars: latestMetaValue(['largestLineChars']),
      scriptRangeCount: latestMetaValue(['scriptRangeCount']),
      autoHeightDeferred: autoHeight?.meta?.autoHeightDeferred ?? '',
      pendingSizeSync: autoHeight?.meta?.pendingSizeSync ?? pasteEnd?.meta?.pendingSizeSync ?? '',
      layoutPatched: layoutPatch?.meta?.layoutPatched ?? '',
      layoutPatchMs: layoutPatch?.meta?.layoutPatchMs ?? '',
      layoutPatchTotalMs: layoutPatch?.meta?.layoutPatchTotalMs ?? '',
      layoutPatchRangeMs: layoutPatch?.meta?.layoutPatchRangeMs ?? '',
      layoutPatchSpliceMs: layoutPatch?.meta?.layoutPatchSpliceMs ?? '',
      layoutPatchWrapMs: layoutPatch?.meta?.layoutPatchWrapMs ?? '',
      layoutPatchScriptRangesMs: layoutPatch?.meta?.layoutPatchScriptRangesMs ?? '',
      layoutPatchScriptMetricsMs: layoutPatch?.meta?.layoutPatchScriptMetricsMs ?? '',
      layoutPatchScriptMetricsPatched: layoutPatch?.meta?.layoutPatchScriptMetricsPatched ?? '',
      layoutPatchScriptMetricsPatchReason: layoutPatch?.meta?.layoutPatchScriptMetricsPatchReason || '',
      layoutPatchScriptMetricsInsertedRangeCount: layoutPatch?.meta?.layoutPatchScriptMetricsInsertedRangeCount ?? '',
      layoutPatchInsertLayoutMs: layoutPatch?.meta?.layoutPatchInsertLayoutMs ?? '',
      layoutPatchRemapMs: layoutPatch?.meta?.layoutPatchRemapMs ?? '',
      layoutPatchLinesCacheMs: layoutPatch?.meta?.layoutPatchLinesCacheMs ?? '',
      layoutPatchLineDelta: layoutPatch?.meta?.layoutPatchLineDelta ?? '',
      layoutPatchLogicalLineDelta: layoutPatch?.meta?.layoutPatchLogicalLineDelta ?? '',
      layoutPatchReason: layoutPatch?.meta?.layoutPatchReason || '',
      objectWidth: latestMetaValue(['objectWidth']),
      objectHeight: latestMetaValue(['objectHeight']),
      layoutCachePresent: latestMetaValue(['layoutCachePresent']),
      layoutCacheLines: latestMetaValue(['layoutCacheLines']),
      rawInputs: rawInputRows.length,
      frames: frameRows.length,
      slowFramesOver16ms: frameRows.filter(row => Number(row.frameMs) > 16.7).length,
      eventLoopOrLongTaskRows: eventLoopRows.length,
      verdict,
    };
    const rowLimit = Math.max(1, Number(options.limit) || 200);
    console.table([summary]);
    if (runSummaries.length > 1) console.table(runSummaries.slice(-rowLimit));
    console.table(run.map(e => debugRow(e, { includeId: true, includeSkipped: true })).slice(-rowLimit));
    if (frameRows.length) console.table(frameRows.slice(-Math.min(rowLimit, 80)));
    return {
      summary,
      runSummaries,
      rows: run.map(e => debugRow(e, { includeId: true, includeSkipped: true })),
      frameRows: frameRows.slice(-rowLimit),
      rawInputRows: rawInputRows.slice(-rowLimit),
      eventLoopRows: eventLoopRows.slice(-rowLimit),
    };
  }

  function textClipboardReport() {
    const textOps = new Set(['copySelected', 'copyTextEditSelection', 'pasteAtPos', 'pasteTextEditSelection']);
    const rows = events
      .filter(e => textOps.has(e.op) && e.step && e.step !== 'start')
      .map(e => debugRow(e, { includeId: true, includeSkipped: true }));
    const latestRun = (ops) => {
      const starts = events.filter(e => ops.includes(e.op) && e.step === 'start');
      const start = starts[starts.length - 1];
      if (!start) return { start: null, run: [], end: null };
      const run = events.filter(e => e.id === start.id && e.op === start.op);
      const end = [...run].reverse().find(e => e.step === 'end') || null;
      return { start, run, end };
    };
    const copy = latestRun(['copyTextEditSelection', 'copySelected']);
    const paste = latestRun(['pasteTextEditSelection', 'pasteAtPos']);
    const latestMetaValue = (run, names) => {
      for (const event of [...run].reverse()) {
        for (const name of names) {
          const value = event.meta?.[name];
          if (value !== undefined && value !== '') return value;
        }
      }
      return '';
    };
    const stepTotal = (run, name) => [...run].reverse().find(e => e.step === name)?.total ?? '';
    const summary = {
      copyRuns: events.filter(e => (e.op === 'copySelected' || e.op === 'copyTextEditSelection') && e.step === 'start').length,
      pasteRuns: events.filter(e => (e.op === 'pasteAtPos' || e.op === 'pasteTextEditSelection') && e.step === 'start').length,
      lastCopyOp: copy.start?.op || '',
      lastCopyPath: copy.end?.meta?.path || '',
      lastCopyTotalMs: copy.end?.total ?? '',
      lastCopyTextChars: latestMetaValue(copy.run, ['textCharCount', 'textLen', 'sourceTextLen']),
      lastCopyTextBytes: latestMetaValue(copy.run, ['textBytes']),
      lastCopyLines: latestMetaValue(copy.run, ['textLineCount']),
      lastCopyScriptRanges: latestMetaValue(copy.run, ['scriptRangeCount']),
      lastCopyClipboardWriteMs: latestMetaValue(copy.run, ['clipboardWriteMs']),
      lastCopyPayloadReadyAtMs: stepTotal(copy.run, 'copy:text-selection-payload-ready') || stepTotal(copy.run, 'copy:text-payload-ready'),
      lastPasteOp: paste.start?.op || '',
      lastPastePath: paste.end?.meta?.path || '',
      lastPasteTotalMs: paste.end?.total ?? '',
      lastPasteTextChars: latestMetaValue(paste.run, ['textCharCount', 'textLen', 'insertedChars', 'fallbackTextChars']),
      lastPasteTextBytes: latestMetaValue(paste.run, ['textBytes', 'additionalTextBytes']),
      lastPasteLines: latestMetaValue(paste.run, ['textLineCount']),
      lastPasteScriptRanges: latestMetaValue(paste.run, ['scriptRangeCount']),
      lastPasteSetRangeTextMs: latestMetaValue(paste.run, ['setRangeTextMs']),
      lastPasteDispatchMs: latestMetaValue(paste.run, ['dispatchMs']),
      lastPasteInputEventAgeMs: latestMetaValue(paste.run, ['eventAgeMs']),
      lastPasteInputHandlerMs: latestMetaValue(paste.run, ['totalMs']),
      lastPasteHistoryRecordMs: latestMetaValue(paste.run, ['historyRecordMs']),
      lastPasteAutoHeightDeferred: latestMetaValue(paste.run, ['autoHeightDeferred']),
      lastPastePendingSizeSync: latestMetaValue(paste.run, ['pendingSizeSync']),
      lastPasteRenderScheduleMs: latestMetaValue(paste.run, ['renderScheduleMs']),
      lastPasteInputEndAtMs: stepTotal(paste.run, 'text-edit-input:end'),
      lastPasteAutoHeightAtMs: stepTotal(paste.run, 'text-edit-input:auto-height-done') || stepTotal(paste.run, 'addText:auto-height-done'),
      lastPasteHistoryAtMs: stepTotal(paste.run, 'text-edit-input:history-recorded') || stepTotal(paste.run, 'paste:boardHistory-done') || stepTotal(paste.run, 'addText:history-pushed'),
      lastPasteObjectCountAfter: paste.end?.meta?.objectCountAfter ?? '',
      verdict: paste.start
        ? 'text copy/paste capture present'
        : copy.start
          ? 'copy captured; no paste captured'
          : 'no text copy/paste events captured',
    };
    console.table([summary]);
    console.table(rows.slice(-160));
    return { summary, rows };
  }

  function status() {
    const last = events[events.length - 1];
    const latest = (stepName) => [...events].reverse().find(e => e.step === stepName);
    const copyEnd = [...events].reverse().find(e => (e.op === 'copySelected' || e.op === 'copyTextEditSelection') && e.step === 'end');
    const pasteEnd = [...events].reverse().find(e => (e.op === 'pasteAtPos' || e.op === 'pasteTextEditSelection') && e.step === 'end');
    const copyProgress = latest('copy:multi-progress');
    const pasteProgress = latest('paste:objects-add-progress') || latest('paste:register-images-progress');
    const out = {
      lastOp: last?.op || '',
      lastStep: last?.step || '',
      totalMs: last?.total ?? '',
      path: last?.meta?.path || '',
      copyObjects: copyEnd?.meta?.objectCount ?? copyProgress?.meta?.objectCount ?? '',
      copyImages: copyEnd?.meta?.imageCount ?? copyProgress?.meta?.imageCount ?? '',
      copyTextChars: copyEnd?.meta?.textCharCount ?? copyEnd?.meta?.textLen ?? '',
      pasteObjects: pasteEnd?.meta?.objectCount ?? pasteProgress?.meta?.objectCount ?? '',
      pasteTextObjects: pasteEnd?.meta?.textObjectCount ?? pasteProgress?.meta?.textObjectCount ?? '',
      pasteTextChars: pasteEnd?.meta?.textCharCount ?? pasteEnd?.meta?.textLen ?? pasteProgress?.meta?.textCharCount ?? '',
      largestTextChars: pasteEnd?.meta?.largestTextChars ?? pasteProgress?.meta?.largestTextChars ?? '',
      processed: pasteProgress?.meta?.processed ?? copyProgress?.meta?.processed ?? '',
      registeredImages: pasteEnd?.meta?.registeredImages ?? pasteProgress?.meta?.registeredImages ?? '',
      historyIndex: pasteEnd?.meta?.historyIndex ?? '',
      objectCountBefore: pasteEnd?.meta?.objectCountBefore ?? '',
      objectCountAfter: pasteEnd?.meta?.objectCountAfter ?? '',
      error: last?.meta?.error || '',
    };
    console.table([out]);
    return out;
  }

  function reset() { core.reset(); }
  const clear = reset;


  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    dump,
    summary,
    phaseSummary,
    copyBreakdown,
    copyPanReport,
    textPasteLagReport,
    textClipboardReport,
    largePasteReport,
    pasteBreakdown,
    status,
    reset,
    clear,
    get events() { return events.slice(); },
  };
})();

exposeDebug({ clipboard: ClipDebug });

// ─── History debugger ───────────────────────────────────────────────────────
var HistoryDebug = (() => {
  const MAX_EVENTS = 1200;
  const stats = {
    snapshots: 0,
    pushHistory: 0,
    restores: 0,
    undo: 0,
    redo: 0,
    cloneObjectCalls: 0,
    cloneObjectsCalls: 0,
    clonedObjects: 0,
    reusedObjects: 0,
    maxSnapshotMs: 0,
    maxPushHistoryMs: 0,
    maxRestoreMs: 0,
    maxCloneObjectsMs: 0,
  };

  function round(value) {
    return round2(value);
  }

  function sanitize(value) {
    return sanitizeDebugMeta(value, { redactPattern: null, roundNumbers: true });
  }
  const core = createDebugRecorder({
    maxEvents: MAX_EVENTS,
    label: '[Boardfish history]',
    sanitize,
  });
  const events = core._events;

  function enable(options = {}) {
    core.enable(options);
    if (core.enabled) console.info('Boardfish history debugger enabled. Use finishDebug({ history: ["textUndoRedoReport", "largeTextReport", "pushes", "summary", "dump"] }) to collect results.');
  }

  function disable() {
    core.disable();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish history debugger disabled.');
  }
  const setVerbose = core.setVerbose;
  const start = core.start;
  const step = core.step;
  const end = core.end;

  function count(key, amount = 1) {
    if (!core.enabled) return;
    if (!Object.hasOwn(stats, key)) stats[key] = 0;
    stats[key] += amount;
  }

  function max(key, value) {
    if (!core.enabled) return;
    if (!Object.hasOwn(stats, key)) stats[key] = 0;
    stats[key] = Math.max(stats[key], value || 0);
  }

  function summary() {
    const rows = events.filter(e => e.step && e.step !== 'start').map(e => ({
      id: e.id,
      op: e.op,
      step: e.step,
      dt: e.dt,
      total: e.total,
      objectCount: e.meta?.objectCount ?? '',
      historyLength: e.meta?.historyLength ?? '',
      historyIndex: e.meta?.historyIndex ?? '',
      cloned: e.meta?.cloned ?? '',
      reused: e.meta?.reused ?? '',
      dirtyCount: e.meta?.dirtyCount ?? '',
      selectedCount: e.meta?.selectedCount ?? '',
      editState: e.meta?.editState ?? '',
      restoredEdit: e.meta?.restoredEdit ?? '',
      actionReason: e.meta?.actionReason ?? '',
      targetReason: e.meta?.targetReason ?? '',
      sourceReason: e.meta?.sourceReason ?? '',
      flushedCheckpoint: e.meta?.flushedCheckpoint ?? '',
      skipped: e.meta?.skipped ?? '',
      textObjectCount: e.meta?.textObjectCount ?? '',
      textCharCount: e.meta?.textCharCount ?? '',
      largestTextChars: e.meta?.largestTextChars ?? '',
      textLineCount: e.meta?.textLineCount ?? '',
      largestTextLineChars: e.meta?.largestTextLineChars ?? '',
      runtimeTextLayoutObjects: e.meta?.runtimeTextLayoutObjects ?? '',
      runtimeTextLayoutLines: e.meta?.runtimeTextLayoutLines ?? '',
      runtimeTextLayoutPrefixEntries: e.meta?.runtimeTextLayoutPrefixEntries ?? '',
      runtimeTextLineContentChars: e.meta?.runtimeTextLineContentChars ?? '',
      restoreCloneMs: e.meta?.cloneObjectsMs ?? '',
      hydrateCandidates: e.meta?.candidates ?? '',
      hydratedTextRuntimeCaches: e.meta?.hydrated ?? '',
      hydratedTextLayoutCaches: e.meta?.layoutCaches ?? '',
      hydratedTextScriptRangeCaches: e.meta?.scriptRangeCaches ?? '',
      hydratedTextScriptMetricCaches: e.meta?.scriptMetricCaches ?? '',
      replaceBoardObjectsMs: e.meta?.replaceBoardObjectsMs ?? '',
      enterEditMs: e.meta?.enterEditMs ?? '',
      renderScheduleMs: e.meta?.renderScheduleMs ?? '',
      reason: e.meta?.reason ?? '',
      ms: e.meta?.ms ?? '',
    }));
    console.table(rows);
    return rows;
  }

  function pushes() {
    const rows = events.filter(e => e.op === 'pushHistory' && e.step === 'end').map(e => ({
      id: e.id,
      objectCount: e.meta?.objectCount ?? '',
      historyLength: e.meta?.historyLength ?? '',
      historyIndex: e.meta?.historyIndex ?? '',
      cloned: e.meta?.cloned ?? '',
      reused: e.meta?.reused ?? '',
      reason: e.meta?.reason ?? '',
      textObjectCount: e.meta?.textObjectCount ?? '',
      textCharCount: e.meta?.textCharCount ?? '',
      largestTextChars: e.meta?.largestTextChars ?? '',
      textLineCount: e.meta?.textLineCount ?? '',
      largestTextLineChars: e.meta?.largestTextLineChars ?? '',
      runtimeTextLayoutLines: e.meta?.runtimeTextLayoutLines ?? '',
      runtimeTextLayoutPrefixEntries: e.meta?.runtimeTextLayoutPrefixEntries ?? '',
      ms: e.meta?.ms ?? '',
    }));
    console.table(rows);
    return rows;
  }

  function largeTextReport() {
    const rows = events
      .filter(e => (
        e.step === 'end' ||
        e.step === 'cloneObjects' ||
        e.step === 'clone-dirty-objects' ||
        e.step === 'clone-snapshot' ||
        e.step === 'clone-snapshot-objects' ||
        e.step === 'hydrate-live-text-caches' ||
        e.step === 'replace-board-objects' ||
        e.step === 'restore-selection' ||
        e.step === 'renderAll' ||
        e.step === 'renderAll-scheduled' ||
        e.step === 'motion-replay' ||
        e.step === 'restore-edit-selection' ||
        e.step === 'enter-edit-restored' ||
        e.step === 'restore-edit-caret' ||
        e.step === 'restore-render-scheduled' ||
        e.step === 'flush-edit-history' ||
        e.step === 'restore-done'
      ))
      .filter(e => (
        Number(e.meta?.textCharCount || 0) ||
        Number(e.meta?.largestTextChars || 0) ||
        Number(e.meta?.runtimeTextLayoutLines || 0) ||
        ['snapshot', 'pushHistory', 'restoreSnapshot', 'undo', 'redo'].includes(e.op)
      ))
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        total: e.total,
        dt: e.dt,
        reason: e.meta?.reason ?? '',
        ms: e.meta?.ms ?? '',
        objectCount: e.meta?.objectCount ?? '',
        cloned: e.meta?.cloned ?? '',
        reused: e.meta?.reused ?? '',
        textObjectCount: e.meta?.textObjectCount ?? '',
        textCharCount: e.meta?.textCharCount ?? '',
        largestTextChars: e.meta?.largestTextChars ?? '',
        largestTextId: e.meta?.largestTextId ?? '',
        textLineCount: e.meta?.textLineCount ?? '',
        largestTextLineChars: e.meta?.largestTextLineChars ?? '',
        runtimeTextLayoutObjects: e.meta?.runtimeTextLayoutObjects ?? '',
        runtimeTextLayoutLines: e.meta?.runtimeTextLayoutLines ?? '',
        runtimeTextLayoutPrefixEntries: e.meta?.runtimeTextLayoutPrefixEntries ?? '',
        runtimeTextLineContentChars: e.meta?.runtimeTextLineContentChars ?? '',
        actionReason: e.meta?.actionReason ?? '',
        targetReason: e.meta?.targetReason ?? '',
        sourceReason: e.meta?.sourceReason ?? '',
        editStateId: e.meta?.editStateId ?? '',
        editValueChars: e.meta?.editValueChars ?? '',
        selectionStart: e.meta?.selectionStart ?? '',
        selectionEnd: e.meta?.selectionEnd ?? '',
        cloneObjectsMs: e.meta?.cloneObjectsMs ?? '',
        hydrateCandidates: e.meta?.candidates ?? '',
        hydratedTextRuntimeCaches: e.meta?.hydrated ?? '',
        hydratedTextLayoutCaches: e.meta?.layoutCaches ?? '',
        hydratedTextScriptRangeCaches: e.meta?.scriptRangeCaches ?? '',
        hydratedTextScriptMetricCaches: e.meta?.scriptMetricCaches ?? '',
        replaceBoardObjectsMs: e.meta?.replaceBoardObjectsMs ?? '',
        enterEditMs: e.meta?.enterEditMs ?? '',
        reusedEditProxy: e.meta?.reusedEditProxy ?? '',
        proxyValueSetMs: e.meta?.proxyValueSetMs ?? '',
        proxyValueChanged: e.meta?.proxyValueChanged ?? '',
        proxyValueSetMethod: e.meta?.proxyValueSetMethod ?? '',
        proxyDomSyncedForSelection: e.meta?.proxyDomSyncedForSelection ?? '',
        proxyDomSyncReason: e.meta?.proxyDomSyncReason ?? '',
        proxyDomSyncMs: e.meta?.proxyDomSyncMs ?? '',
        proxyDomCharsBeforeSelection: e.meta?.proxyDomCharsBeforeSelection ?? '',
        proxyDomCharsAfterSelection: e.meta?.proxyDomCharsAfterSelection ?? '',
        proxyValueDiffMs: e.meta?.proxyValueDiffMs ?? '',
        proxyValueMutationMs: e.meta?.proxyValueMutationMs ?? '',
        proxyValueAssignMs: e.meta?.proxyValueAssignMs ?? '',
        proxyValueInsertedChars: e.meta?.proxyValueInsertedChars ?? '',
        proxyValueRemovedChars: e.meta?.proxyValueRemovedChars ?? '',
        proxyValuePatchStart: e.meta?.proxyValuePatchStart ?? '',
        proxyValuePatchEnd: e.meta?.proxyValuePatchEnd ?? '',
        proxyValuePatchPrefixChars: e.meta?.proxyValuePatchPrefixChars ?? '',
        proxyValuePatchSuffixChars: e.meta?.proxyValuePatchSuffixChars ?? '',
        setSelectionRangeMs: e.meta?.setSelectionRangeMs ?? '',
        focusMs: e.meta?.focusMs ?? '',
        focusSkipped: e.meta?.focusSkipped ?? '',
        renderScheduleMs: e.meta?.renderScheduleMs ?? '',
        flushedCheckpoint: e.meta?.flushedCheckpoint ?? '',
        historyLength: e.meta?.historyLength ?? '',
        historyIndex: e.meta?.historyIndex ?? '',
      }));
    console.table(rows);
    return rows;
  }

  function textUndoRedoReport(options = {}) {
    const rowLimit = Math.max(1, Math.min(MAX_EVENTS, Number(options.limit) || 240));
    const rows = events
      .filter(e => (
        ['undo', 'redo', 'restoreSnapshot', 'pushHistory'].includes(e.op) ||
        e.step === 'flush-edit-history'
      ))
      .map(e => ({
        id: e.id,
        op: e.op,
        step: e.step,
        total: e.total,
        dt: e.dt,
        ms: e.meta?.ms ?? '',
        reason: e.meta?.reason ?? '',
        actionReason: e.meta?.actionReason ?? '',
        targetReason: e.meta?.targetReason ?? '',
        sourceReason: e.meta?.sourceReason ?? '',
        flushedCheckpoint: e.meta?.flushedCheckpoint ?? '',
        flushMs: e.meta?.flushMs ?? '',
        restoreMs: e.meta?.restoreMs ?? '',
        skipped: e.meta?.skipped ?? '',
        objectCount: e.meta?.objectCount ?? '',
        selectedCount: e.meta?.selectedCount ?? '',
        editState: e.meta?.editState ?? '',
        restoredEdit: e.meta?.restoredEdit ?? '',
	        editStateId: e.meta?.editStateId ?? '',
	        editValueChars: e.meta?.editValueChars ?? '',
	        selectionStart: e.meta?.selectionStart ?? '',
	        selectionEnd: e.meta?.selectionEnd ?? '',
	        editStateSelectionStart: e.meta?.editStateSelectionStart ?? '',
	        editStateSelectionEnd: e.meta?.editStateSelectionEnd ?? '',
	        editStateSelectedChars: e.meta?.editStateSelectedChars ?? '',
	        beforeEditStateSelectionStart: e.meta?.beforeEditStateSelectionStart ?? '',
	        beforeEditStateSelectionEnd: e.meta?.beforeEditStateSelectionEnd ?? '',
	        beforeEditStateSelectedChars: e.meta?.beforeEditStateSelectedChars ?? '',
	        actionEditStateSelectionStart: e.meta?.actionEditStateSelectionStart ?? '',
	        actionEditStateSelectionEnd: e.meta?.actionEditStateSelectionEnd ?? '',
	        actionEditStateSelectedChars: e.meta?.actionEditStateSelectedChars ?? '',
	        actionBeforeEditStateSelectionStart: e.meta?.actionBeforeEditStateSelectionStart ?? '',
	        actionBeforeEditStateSelectionEnd: e.meta?.actionBeforeEditStateSelectionEnd ?? '',
	        actionBeforeEditStateSelectedChars: e.meta?.actionBeforeEditStateSelectedChars ?? '',
	        targetEditStateSelectionStart: e.meta?.targetEditStateSelectionStart ?? '',
	        targetEditStateSelectionEnd: e.meta?.targetEditStateSelectionEnd ?? '',
	        targetEditStateSelectedChars: e.meta?.targetEditStateSelectedChars ?? '',
	        sourceEditStateSelectionStart: e.meta?.sourceEditStateSelectionStart ?? '',
	        sourceEditStateSelectionEnd: e.meta?.sourceEditStateSelectionEnd ?? '',
	        sourceEditStateSelectedChars: e.meta?.sourceEditStateSelectedChars ?? '',
	        textObjectCount: e.meta?.textObjectCount ?? '',
        textCharCount: e.meta?.textCharCount ?? '',
        largestTextChars: e.meta?.largestTextChars ?? '',
        largestTextId: e.meta?.largestTextId ?? '',
        textLineCount: e.meta?.textLineCount ?? '',
        largestTextLineChars: e.meta?.largestTextLineChars ?? '',
        runtimeTextLayoutObjects: e.meta?.runtimeTextLayoutObjects ?? '',
        runtimeTextLayoutLines: e.meta?.runtimeTextLayoutLines ?? '',
        runtimeTextLayoutPrefixEntries: e.meta?.runtimeTextLayoutPrefixEntries ?? '',
        cloneObjectsMs: e.meta?.cloneObjectsMs ?? '',
        hydrateCandidates: e.meta?.candidates ?? '',
        hydratedTextRuntimeCaches: e.meta?.hydrated ?? '',
        hydratedTextLayoutCaches: e.meta?.layoutCaches ?? '',
        hydratedTextScriptRangeCaches: e.meta?.scriptRangeCaches ?? '',
        hydratedTextScriptMetricCaches: e.meta?.scriptMetricCaches ?? '',
        replaceBoardObjectsMs: e.meta?.replaceBoardObjectsMs ?? '',
        setSelectionMs: e.meta?.setSelectionMs ?? '',
        renderScheduleMs: e.meta?.renderScheduleMs ?? '',
        motionReplayMs: e.meta?.motionReplayMs ?? '',
        enterEditMs: e.meta?.enterEditMs ?? '',
        reusedEditProxy: e.meta?.reusedEditProxy ?? '',
        proxyValueSetMs: e.meta?.proxyValueSetMs ?? '',
        proxyValueChanged: e.meta?.proxyValueChanged ?? '',
        proxyValueSetMethod: e.meta?.proxyValueSetMethod ?? '',
        proxyDomSyncedForSelection: e.meta?.proxyDomSyncedForSelection ?? '',
        proxyDomSyncReason: e.meta?.proxyDomSyncReason ?? '',
        proxyDomSyncMs: e.meta?.proxyDomSyncMs ?? '',
        proxyDomCharsBeforeSelection: e.meta?.proxyDomCharsBeforeSelection ?? '',
        proxyDomCharsAfterSelection: e.meta?.proxyDomCharsAfterSelection ?? '',
        proxyValueDiffMs: e.meta?.proxyValueDiffMs ?? '',
        proxyValueMutationMs: e.meta?.proxyValueMutationMs ?? '',
        proxyValueAssignMs: e.meta?.proxyValueAssignMs ?? '',
        proxyValueInsertedChars: e.meta?.proxyValueInsertedChars ?? '',
        proxyValueRemovedChars: e.meta?.proxyValueRemovedChars ?? '',
        proxyValuePatchStart: e.meta?.proxyValuePatchStart ?? '',
        proxyValuePatchEnd: e.meta?.proxyValuePatchEnd ?? '',
        proxyValuePatchPrefixChars: e.meta?.proxyValuePatchPrefixChars ?? '',
        proxyValuePatchSuffixChars: e.meta?.proxyValuePatchSuffixChars ?? '',
        setSelectionRangeMs: e.meta?.setSelectionRangeMs ?? '',
        focusMs: e.meta?.focusMs ?? '',
        focusSkipped: e.meta?.focusSkipped ?? '',
        proxyChars: e.meta?.proxyChars ?? '',
        historyLength: e.meta?.historyLength ?? '',
        historyIndex: e.meta?.historyIndex ?? '',
      }));
    const max = (field) => rows.reduce((value, row) => Math.max(value, Number(row[field]) || 0), 0);
    const sum = (field) => rows.reduce((value, row) => value + (Number(row[field]) || 0), 0);
    const endRows = rows.filter(row => row.step === 'end');
    const restoreEnds = endRows.filter(row => row.op === 'restoreSnapshot');
    const summaryOut = {
      undoCount: events.filter(e => e.op === 'undo' && e.step === 'start').length,
      redoCount: events.filter(e => e.op === 'redo' && e.step === 'start').length,
      restoreCount: events.filter(e => e.op === 'restoreSnapshot' && e.step === 'start').length,
      textEditCheckpointPushes: events.filter(e => e.op === 'pushHistory' && e.step === 'end' && e.meta?.reason === 'text-edit-checkpoint').length,
      maxRestoreMs: restoreEnds.reduce((value, row) => Math.max(value, Number(row.ms) || Number(row.total) || 0), 0),
      maxOuterRestoreMs: max('restoreMs'),
      maxFlushMs: max('flushMs'),
      maxCloneObjectsMs: max('cloneObjectsMs'),
      maxHydrateCandidates: max('hydrateCandidates'),
      hydratedTextRuntimeCaches: sum('hydratedTextRuntimeCaches'),
      hydratedTextLayoutCaches: sum('hydratedTextLayoutCaches'),
      hydratedTextScriptRangeCaches: sum('hydratedTextScriptRangeCaches'),
      hydratedTextScriptMetricCaches: sum('hydratedTextScriptMetricCaches'),
      maxReplaceBoardObjectsMs: max('replaceBoardObjectsMs'),
      maxEnterEditMs: max('enterEditMs'),
      maxProxyValueSetMs: max('proxyValueSetMs'),
      maxProxyValueDiffMs: max('proxyValueDiffMs'),
      maxProxyValueMutationMs: max('proxyValueMutationMs'),
      maxProxyValueAssignMs: max('proxyValueAssignMs'),
      maxSetSelectionRangeMs: max('setSelectionRangeMs'),
      maxFocusMs: max('focusMs'),
      maxRenderScheduleMs: max('renderScheduleMs'),
      maxMotionReplayMs: max('motionReplayMs'),
      maxTextCharCount: max('textCharCount'),
      maxLargestTextChars: max('largestTextChars'),
      maxRuntimeTextLayoutLines: max('runtimeTextLayoutLines'),
      restoredEditCount: restoreEnds.filter(row => row.restoredEdit === true).length,
      skippedRows: rows.filter(row => row.skipped).length,
    };
    const opEnds = endRows.filter(row => row.op === 'undo' || row.op === 'redo');
    summaryOut.maxUndoMs = opEnds
      .filter(row => row.op === 'undo')
      .reduce((value, row) => Math.max(value, Number(row.total) || 0), 0);
    summaryOut.maxRedoMs = opEnds
      .filter(row => row.op === 'redo')
      .reduce((value, row) => Math.max(value, Number(row.total) || 0), 0);
    for (const key of Object.keys(summaryOut)) {
      if (typeof summaryOut[key] === 'number') summaryOut[key] = round(summaryOut[key]);
    }
    if (options.table !== false) {
      console.table([summaryOut]);
      console.table(rows.slice(-rowLimit));
    }
    return { summary: summaryOut, rows: rows.slice(-rowLimit) };
  }

  function dump() {
    console.table(events);
    return events.slice();
  }

  function reset() {
    core.reset();
    for (const key of Object.keys(stats)) stats[key] = 0;
  }

  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    count,
    max,
    summary,
    pushes,
    largeTextReport,
    textUndoRedoReport,
    dump,
    reset,
    clear: reset,
    isEnabled: () => core.enabled,
    get enabled() { return core.enabled; },
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
  };
})();

exposeDebug({ history: HistoryDebug });
var ViewportDebug = (() => {
  const MAX_EVENTS = 10000;
  const MAX_SLOW_RECORDS = 100;
  let enabled = false;
  let verbose = false;
  let nextOpId = 1;
  const events = [];
  const slowRecords = [];
  const stats = {
    wheel: 0,
    wheelPan: 0,
    wheelZoom: 0,
    mousePanMoves: 0,
    frameCount: 0,
    frameTotalMs: 0,
    frameQueueTotalMs: 0,
    inputFrameCount: 0,
    inputAgeTotalMs: 0,
    scheduledFrames: 0,
    coalescedFrames: 0,
    transformFrames: 0,
    boardFrames: 0,
    overlayFrames: 0,
    selectionOverlaySkipped: 0,
    slowFrames: 0,
    maxFrameMs: 0,
    maxQueueMs: 0,
    maxInputAgeMs: 0,
    lastRafGapMs: 0,
    maxRafGapMs: 0,
    eventLoopGaps: 0,
    maxEventLoopGapMs: 0,
    longTasks: 0,
    maxLongTaskMs: 0,
    rawInputEvents: 0,
    shieldBlockedInputs: 0,
    wheelHandlerCount: 0,
    wheelHandlerTotalMs: 0,
    maxWheelHandlerMs: 0,
    mousePanHandlerCount: 0,
    mousePanHandlerTotalMs: 0,
    maxMousePanHandlerMs: 0,
    imageAdds: 0,
    imageLoads: 0,
    imageDecodeQueued: 0,
    maxImageDecodeQueueDepth: 0,
    imageDecodes: 0,
    imageDecodeFailures: 0,
    imageBitmaps: 0,
    imageBitmapFailures: 0,
    imagePreviewPrepared: 0,
    imagePreviewFailures: 0,
    imageDrawMissing: 0,
    imageDrawFallback: 0,
    imageDrawErrors: 0,
    culledImages: 0,
    culledText: 0,
    croppedImages: 0,
    maxImageAddMs: 0,
    maxImageLoadMs: 0,
    maxImageDecodeMs: 0,
    maxImageBitmapMs: 0,
    maxImagePreviewMs: 0,
  };
  let lastRafAt = 0;
  let eventLoopTimer = null;
  let eventLoopLastTick = 0;
  let longTaskObserver = null;
  let rawInputMonitorActive = false;
  const EVENT_LOOP_INTERVAL_MS = 50;
  const EVENT_LOOP_GAP_THRESHOLD_MS = 80;
  const RAW_INPUT_TYPES = [
    'wheel',
    'keydown',
    'keyup',
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mousemove',
    'mouseup',
  ];

  function sanitize(value) {
    return sanitizeDebugMeta(value, { roundNumbers: true });
  }

  function push(evt) {
    if (!enabled) return;
    const entry = { at: Math.round(performance.now() * 100) / 100, ...evt };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish viewport]', entry);
  }

  function startEventLoopMonitor(options = {}) {
    if (eventLoopTimer || typeof setInterval !== 'function') return;
    const thresholdMs = Math.max(16, Number(options.eventLoopGapThresholdMs) || EVENT_LOOP_GAP_THRESHOLD_MS);
    const requestedIntervalMs = Number(options.eventLoopIntervalMs);
    const intervalMs = Math.max(8, Number.isFinite(requestedIntervalMs) && requestedIntervalMs > 0
      ? requestedIntervalMs
      : Math.min(EVENT_LOOP_INTERVAL_MS, Math.max(8, thresholdMs / 2)));
    eventLoopLastTick = performance.now();
    eventLoopTimer = setInterval(() => {
      const now = performance.now();
      const gapMs = now - eventLoopLastTick;
      eventLoopLastTick = now;
      if (gapMs < thresholdMs) return;
      stats.eventLoopGaps++;
      stats.maxEventLoopGapMs = Math.max(stats.maxEventLoopGapMs, gapMs);
      push({
        op: 'eventLoop',
        step: 'gap',
        meta: sanitize({
          gapMs,
          expectedMs: intervalMs,
          thresholdMs,
          overMs: gapMs - thresholdMs,
          panX,
          panY,
          zoom,
        }),
      });
    }, intervalMs);
  }

  function stopEventLoopMonitor() {
    if (!eventLoopTimer) return;
    clearInterval(eventLoopTimer);
    eventLoopTimer = null;
    eventLoopLastTick = 0;
  }

  function startLongTaskObserver() {
    if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Number(entry.duration) || 0;
          stats.longTasks++;
          stats.maxLongTaskMs = Math.max(stats.maxLongTaskMs, duration);
          push({
            op: 'longTask',
            step: 'entry',
            meta: sanitize({
              startTime: entry.startTime,
              duration,
              name: entry.name || '',
            }),
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (_) {
      longTaskObserver = null;
    }
  }

  function stopLongTaskObserver() {
    if (!longTaskObserver) return;
    longTaskObserver.disconnect();
    longTaskObserver = null;
  }

  function eventTimestampMs(event = null) {
    const timestamp = Number(event?.timeStamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return performance.now();
    return timestamp > performance.timeOrigin ? timestamp - performance.timeOrigin : timestamp;
  }

  function eventTargetLabel(target) {
    if (!target) return '';
    const id = target.id ? `#${target.id}` : '';
    const className = typeof target.className === 'string'
      ? target.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(name => `.${name}`).join('')
      : '';
    return `${String(target.tagName || target.nodeName || '').toLowerCase()}${id}${className}`;
  }

  function inputShieldState() {
    const shieldActive = typeof openingShield !== 'undefined' &&
      !!openingShield?.classList?.contains?.('active');
    return {
      shieldActive,
      inputShieldCount: typeof _inputShieldCount !== 'undefined' ? _inputShieldCount : '',
      boardOpening: typeof _boardOpening !== 'undefined' ? !!_boardOpening : '',
      rubberBandDragActive: typeof _rubberBandDragActive !== 'undefined' ? !!_rubberBandDragActive : '',
      spaceDown: typeof _spaceDown !== 'undefined' ? !!_spaceDown : '',
      editingId: typeof editingId !== 'undefined' ? (editingId || '') : '',
    };
  }

  function inputEventMeta(event, extra = {}) {
    const eventAt = eventTimestampMs(event);
    return sanitize({
      source: extra.source || '',
      eventType: event?.type || '',
      eventAt,
      eventAgeMs: Math.max(0, performance.now() - eventAt),
      key: event?.key || '',
      code: event?.code || '',
      repeat: !!event?.repeat,
      deltaX: event?.deltaX ?? '',
      deltaY: event?.deltaY ?? '',
      button: event?.button ?? '',
      buttons: event?.buttons ?? '',
      clientX: event?.clientX ?? '',
      clientY: event?.clientY ?? '',
      ctrlKey: !!event?.ctrlKey,
      metaKey: !!event?.metaKey,
      shiftKey: !!event?.shiftKey,
      altKey: !!event?.altKey,
      defaultPrevented: !!event?.defaultPrevented,
      cancelable: !!event?.cancelable,
      target: eventTargetLabel(event?.target),
      ...inputShieldState(),
      ...extra,
    });
  }

  function recordRawInput(event, source = 'raw-capture') {
    if (!enabled) return;
    stats.rawInputEvents++;
    push({
      op: 'input',
      step: 'raw',
      meta: inputEventMeta(event, { source }),
    });
  }

  function recordShieldBlock(event, meta = {}) {
    if (!enabled) return;
    stats.shieldBlockedInputs++;
    push({
      op: 'input',
      step: 'shield-block',
      meta: inputEventMeta(event, { source: 'input-shield', blocked: true, ...meta }),
    });
  }

  function onRawInputCapture(event) {
    if (!enabled) return;
    try {
      if (event.__boardfishViewportRawInputLogged) return;
      event.__boardfishViewportRawInputLogged = true;
    } catch (_) {}
    recordRawInput(event, 'window-capture');
  }

  function startRawInputMonitor(options = {}) {
    if (rawInputMonitorActive || options.rawInput !== true || typeof window === 'undefined') return;
    rawInputMonitorActive = true;
    for (const type of RAW_INPUT_TYPES) {
      window.addEventListener(type, onRawInputCapture, { capture: true, passive: true });
    }
  }

  function stopRawInputMonitor() {
    if (!rawInputMonitorActive || typeof window === 'undefined') return;
    for (const type of RAW_INPUT_TYPES) {
      window.removeEventListener(type, onRawInputCapture, { capture: true, passive: true });
    }
    rawInputMonitorActive = false;
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    startEventLoopMonitor(options);
    startLongTaskObserver();
    startRawInputMonitor(options);

    if (options.verbose === true) setVerbose(true);
    console.info('Boardfish viewport debugger enabled. Use finishDebug({ viewport: ["report", "summary", "frameSummary", "wheelSummary", "drawSummary", "slowFrames", "eventLoopTimeline", "rawInputTimeline", "imageHealth", "dump"] }) to collect results.');
  }

  function disable() {
    enabled = false;
    stopEventLoopMonitor();
    stopLongTaskObserver();
    stopRawInputMonitor();
    if (DEBUG_TOOLS_ENABLED) console.info('Boardfish viewport debugger disabled.');
  }

  function setVerbose(value) {
    if (!DEBUG_TOOLS_ENABLED) return;
    verbose = !!value;

    console.info(`Boardfish viewport verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    if (!ctx.steps) ctx.steps = {};
    ctx.steps[stepName] = {
      ms: meta?.ms ?? (now - ctx.last),
      total: now - ctx.t0,
      meta: sanitize(meta),
    };
    push({
      id: ctx.id,
      op: ctx.op,
      step: stepName,
      dt: Math.round((now - ctx.last) * 100) / 100,
      total: Math.round((now - ctx.t0) * 100) / 100,
      meta: sanitize(meta),
    });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    step(ctx, 'end', meta);
  }

  function count(name, amount = 1) {
    if (!enabled) return;
    stats[name] = (stats[name] || 0) + amount;
  }

  function max(name, value) {
    if (!enabled) return;
    stats[name] = Math.max(stats[name] || 0, value || 0);
  }

  function timing(name, value) {
    if (!enabled) return;
    const ms = value || 0;
    stats[`${name}Count`] = (stats[`${name}Count`] || 0) + 1;
    stats[`${name}TotalMs`] = (stats[`${name}TotalMs`] || 0) + ms;
    stats[`max${name[0].toUpperCase()}${name.slice(1)}Ms`] = Math.max(
      stats[`max${name[0].toUpperCase()}${name.slice(1)}Ms`] || 0,
      ms
    );
  }

  function frameStart(queueMs, extra = {}) {
    if (!enabled) return null;
    const now = performance.now();
    const rafGap = lastRafAt ? now - lastRafAt : 0;
    lastRafAt = now;
    const inputAgeMs = Number(extra.inputAgeMs) || 0;
    stats.lastRafGapMs = rafGap;
    stats.maxRafGapMs = Math.max(stats.maxRafGapMs, rafGap);
    stats.maxQueueMs = Math.max(stats.maxQueueMs, queueMs || 0);
    stats.maxInputAgeMs = Math.max(stats.maxInputAgeMs, inputAgeMs);
    const meta = { queueMs, rafGap, inputAgeMs, inputSource: extra.inputSource || '', panX, panY, zoom };
    const ctx = start('frame', meta);
    if (ctx) ctx.startMeta = meta;
    return ctx;
  }

  function frameEnd(ctx, meta = {}) {
    if (!enabled || !ctx) return;
    const total = performance.now() - ctx.t0;
    const startMeta = ctx.startMeta || {};
    const queueMs = Number(startMeta.queueMs) || 0;
    const inputAgeMs = Number(startMeta.inputAgeMs) || 0;
    const hasInput = !!startMeta.inputSource || inputAgeMs > 0;
    stats.frameCount++;
    stats.frameTotalMs += total;
    stats.frameQueueTotalMs += queueMs;
    if (hasInput) {
      stats.inputFrameCount++;
      stats.inputAgeTotalMs += inputAgeMs;
    }
    stats.maxFrameMs = Math.max(stats.maxFrameMs, total);
    if (total > 16.7) {
      stats.slowFrames++;
      slowRecords.push({
        id: ctx.id,
        frameMs: Math.round(total * 100) / 100,
        ...(ctx.startMeta || {}),
        steps: ctx.steps || {},
        ...sanitize(meta),
      });
      if (slowRecords.length > MAX_SLOW_RECORDS) slowRecords.shift();
    }
    end(ctx, { ...meta, frameMs: total, slow: total > 16.7 });
  }

  function summary() {
    const rows = [
      { metric: 'wheel', value: stats.wheel },
      { metric: 'perfMode', value: viewportPerfModeSummary().label },
      { metric: 'cullingEnabled', value: viewportCullingEnabled },
      { metric: 'imageScalingSupported', value: VIEWPORT_IMAGE_SCALING_SUPPORTED },
      { metric: 'imageScalingEnabled', value: viewportImageScalingEnabled },
      { metric: 'imageScaleLevels', value: IMAGE_SCALE_LEVELS.join(',') },
      { metric: 'wheelPan', value: stats.wheelPan },
      { metric: 'wheelZoom', value: stats.wheelZoom },
      { metric: 'mousePanMoves', value: stats.mousePanMoves },
      { metric: 'frames', value: stats.frameCount },
      { metric: 'inputFrames', value: stats.inputFrameCount },
      { metric: 'scheduledFrames', value: stats.scheduledFrames },
      { metric: 'coalescedFrames', value: stats.coalescedFrames },
      { metric: 'transformFrames', value: stats.transformFrames },
      { metric: 'boardFrames', value: stats.boardFrames },
      { metric: 'overlayFrames', value: stats.overlayFrames },
      { metric: 'selectionOverlaySkipped', value: stats.selectionOverlaySkipped },
      { metric: 'slowFramesOver16ms', value: stats.slowFrames },
      { metric: 'maxFrameMs', value: Math.round(stats.maxFrameMs * 100) / 100 },
      { metric: 'maxQueueMs', value: Math.round(stats.maxQueueMs * 100) / 100 },
      { metric: 'maxInputAgeMs', value: Math.round(stats.maxInputAgeMs * 100) / 100 },
      { metric: 'maxRafGapMs', value: Math.round(stats.maxRafGapMs * 100) / 100 },
      { metric: 'eventLoopGapsOverThreshold', value: stats.eventLoopGaps },
      { metric: 'maxEventLoopGapMs', value: Math.round(stats.maxEventLoopGapMs * 100) / 100 },
      { metric: 'longTasks', value: stats.longTasks },
      { metric: 'maxLongTaskMs', value: Math.round(stats.maxLongTaskMs * 100) / 100 },
      { metric: 'rawInputEvents', value: stats.rawInputEvents },
      { metric: 'shieldBlockedInputs', value: stats.shieldBlockedInputs },
      { metric: 'avgWheelHandlerMs', value: stats.wheelHandlerCount ? Math.round(stats.wheelHandlerTotalMs / stats.wheelHandlerCount * 100) / 100 : 0 },
      { metric: 'maxWheelHandlerMs', value: Math.round(stats.maxWheelHandlerMs * 100) / 100 },
      { metric: 'avgMousePanHandlerMs', value: stats.mousePanHandlerCount ? Math.round(stats.mousePanHandlerTotalMs / stats.mousePanHandlerCount * 100) / 100 : 0 },
      { metric: 'maxMousePanHandlerMs', value: Math.round(stats.maxMousePanHandlerMs * 100) / 100 },
      { metric: 'imageAdds', value: stats.imageAdds },
      { metric: 'imageLoads', value: stats.imageLoads },
      { metric: 'imageDecodeQueued', value: stats.imageDecodeQueued },
      { metric: 'maxImageDecodeQueueDepth', value: stats.maxImageDecodeQueueDepth },
      { metric: 'imageDecodes', value: stats.imageDecodes },
      { metric: 'imageDecodeFailures', value: stats.imageDecodeFailures },
      { metric: 'imageBitmaps', value: stats.imageBitmaps },
      { metric: 'imageBitmapFailures', value: stats.imageBitmapFailures },
      { metric: 'imagePreviewPrepared', value: stats.imagePreviewPrepared },
      { metric: 'imagePreviewFailures', value: stats.imagePreviewFailures },
      { metric: 'imageDrawMissing', value: stats.imageDrawMissing },
      { metric: 'imageDrawFallback', value: stats.imageDrawFallback },
      { metric: 'imageDrawErrors', value: stats.imageDrawErrors },
      { metric: 'culledImages', value: stats.culledImages },
      { metric: 'culledText', value: stats.culledText },
      { metric: 'croppedImages', value: stats.croppedImages },
      { metric: 'maxImageAddMs', value: Math.round(stats.maxImageAddMs * 100) / 100 },
      { metric: 'maxImageLoadMs', value: Math.round(stats.maxImageLoadMs * 100) / 100 },
      { metric: 'maxImageDecodeMs', value: Math.round(stats.maxImageDecodeMs * 100) / 100 },
      { metric: 'maxImageBitmapMs', value: Math.round(stats.maxImageBitmapMs * 100) / 100 },
      { metric: 'maxImagePreviewMs', value: Math.round(stats.maxImagePreviewMs * 100) / 100 },
    ];
    console.table(rows);
    return rows;
  }

  function frameSummary() {
    const starts = new Map();
    for (const e of events) {
      if (e.op === 'frame' && e.step === 'start') starts.set(e.id, e.meta || {});
    }
    const frames = events
      .filter(e => e.op === 'frame' && e.step === 'end')
      .map(e => ({ ...(starts.get(e.id) || {}), ...(e.meta || {}) }));
    const inputFrames = frames.filter(row => row.inputSource || Number(row.inputAgeMs) > 0);
    const max = (field) => frames.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const out = {
      frames: stats.frameCount,
      recentFrames: frames.length,
      inputFrames: stats.inputFrameCount,
      recentInputFrames: inputFrames.length,
      slowFramesOver16ms: stats.slowFrames,
      recentSlowFramesOver16ms: frames.filter(row => row.slow).length,
      avgFrameMs: stats.frameCount ? Math.round(stats.frameTotalMs / stats.frameCount * 100) / 100 : 0,
      maxFrameMs: Math.round(stats.maxFrameMs * 100) / 100,
      recentMaxFrameMs: Math.round(max('frameMs') * 100) / 100,
      avgQueueMs: stats.frameCount ? Math.round(stats.frameQueueTotalMs / stats.frameCount * 100) / 100 : 0,
      maxQueueMs: Math.round(stats.maxQueueMs * 100) / 100,
      avgInputAgeMs: stats.inputFrameCount ? Math.round(stats.inputAgeTotalMs / stats.inputFrameCount * 100) / 100 : 0,
      maxInputAgeMs: Math.round(stats.maxInputAgeMs * 100) / 100,
      recentMaxInputAgeMs: Math.round(max('inputAgeMs') * 100) / 100,
      maxRafGapMs: Math.round(stats.maxRafGapMs * 100) / 100,
      recentMaxRafGapMs: Math.round(max('rafGap') * 100) / 100,
      eventLoopGapsOverThreshold: stats.eventLoopGaps,
      maxEventLoopGapMs: Math.round(stats.maxEventLoopGapMs * 100) / 100,
      longTasks: stats.longTasks,
      maxLongTaskMs: Math.round(stats.maxLongTaskMs * 100) / 100,
      rawInputEvents: stats.rawInputEvents,
      shieldBlockedInputs: stats.shieldBlockedInputs,
      transformFrames: stats.transformFrames,
      boardFrames: stats.boardFrames,
      overlayFrames: stats.overlayFrames,
    };
    console.table([out]);
    return out;
  }

  function wheelRows() {
    const starts = new Map();
    for (const e of events) {
      if (e.op === 'wheel' && e.step === 'start') starts.set(e.id, { at: e.at, ...(e.meta || {}) });
    }
    return events
      .filter(e => e.op === 'wheel' && e.step === 'end')
      .map(e => ({ ...(starts.get(e.id) || {}), endAt: e.at, ...(e.meta || {}) }))
      .filter(row => row.at != null);
  }

  function wheelSummary() {
    const rows = wheelRows();
    const zoomRows = rows.filter(row => row.mode === 'zoom');
    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push(rows[i].at - rows[i - 1].at);
    const sum = (values) => values.reduce((n, value) => n + (Number(value) || 0), 0);
    const max = (values) => values.reduce((n, value) => Math.max(n, Number(value) || 0), 0);
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const absDeltaY = rows.map(row => Math.abs(Number(row.deltaY) || 0));
    const zoomStepPct = zoomRows.map(row => {
      const before = Number(row.zoom) || 0;
      const after = Number(row.newZoom) || 0;
      return before && after ? Math.abs((after / before) - 1) * 100 : 0;
    });
    let directionChanges = 0;
    let lastDir = 0;
    for (const row of zoomRows) {
      const dy = Number(row.deltaY) || 0;
      const dir = dy === 0 ? 0 : dy > 0 ? 1 : -1;
      if (dir && lastDir && dir !== lastDir) directionChanges++;
      if (dir) lastDir = dir;
    }
    const out = {
      bufferedWheelEvents: rows.length,
      zoomEvents: zoomRows.length,
      panEvents: rows.filter(row => row.mode === 'pan').length,
      avgWheelGapMs: gaps.length ? round(sum(gaps) / gaps.length) : 0,
      maxWheelGapMs: round(max(gaps)),
      gapsOver16ms: gaps.filter(gap => gap > 16.7).length,
      gapsOver32ms: gaps.filter(gap => gap > 32).length,
      gapsOver80ms: gaps.filter(gap => gap > 80).length,
      avgAbsDeltaY: absDeltaY.length ? round(sum(absDeltaY) / absDeltaY.length) : 0,
      maxAbsDeltaY: round(max(absDeltaY)),
      avgZoomStepPct: zoomStepPct.length ? round(sum(zoomStepPct) / zoomStepPct.length) : 0,
      maxZoomStepPct: round(max(zoomStepPct)),
      directionChanges,
      firstAt: rows[0]?.at ?? '',
      lastAt: rows[rows.length - 1]?.at ?? '',
    };
    console.table([out]);
    return out;
  }

  function wheelTimeline(limit = 80) {
    const rows = wheelRows();
    const start = Math.max(0, rows.length - Math.max(1, Number(limit) || 80));
    const recent = rows.slice(start).map((row, idx, list) => ({
      at: row.at,
      gapMs: idx ? Math.round((row.at - list[idx - 1].at) * 100) / 100 : '',
      mode: row.mode || '',
      deltaX: row.deltaX ?? '',
      deltaY: row.deltaY ?? '',
      ctrl: !!row.ctrlKey,
      meta: !!row.metaKey,
      zoom: row.zoom ?? '',
      newZoom: row.newZoom ?? '',
    }));
    console.table(recent);
    return recent;
  }

  function drawSummary() {
    const draws = events
      .filter(e => e.op === 'drawBoard' && e.step === 'end' && !e.meta?.skipped)
      .map(e => ({ ms: e.total, ...(e.meta || {}) }));
    const retainedSlowDraws = slowRecords
      .map(e => ({
        frameMs: e.frameMs,
        drawMs: e.steps?.drawBoard?.ms ?? e.steps?.drawBoard?.meta?.totalMeasuredMs ?? 0,
        objectLoopMs: e.steps?.drawBoard?.meta?.objectLoopMs ?? 0,
        croppedImages: e.steps?.drawBoard?.meta?.croppedImages ?? 0,
        drawnTextLines: e.steps?.drawBoard?.meta?.drawnTextLines ?? 0,
        culledTextLines: e.steps?.drawBoard?.meta?.culledTextLines ?? 0,
        editLayoutMs: e.steps?.drawBoard?.meta?.editLayoutMs ?? 0,
        editTextDrawMs: e.steps?.drawBoard?.meta?.editTextDrawMs ?? 0,
        editSelectionMs: e.steps?.drawBoard?.meta?.editSelectionMs ?? 0,
        editCaretMs: e.steps?.drawBoard?.meta?.editCaretMs ?? 0,
        editVisibleLines: e.steps?.drawBoard?.meta?.editVisibleLines ?? 0,
        editCulledLines: e.steps?.drawBoard?.meta?.editCulledLines ?? 0,
        editSelectedChars: e.steps?.drawBoard?.meta?.editSelectedChars ?? 0,
        editSelectionLines: e.steps?.drawBoard?.meta?.editSelectionLines ?? 0,
        editSelectionVisibleLines: e.steps?.drawBoard?.meta?.editSelectionVisibleLines ?? 0,
      }))
      .filter(row => Number(row.drawMs) > 0);
    const sum = (field) => draws.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => draws.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const slowMax = (field) => retainedSlowDraws.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const recentMaxDrawMs = Math.round(max('ms') * 100) / 100;
    const retainedMaxSlowDrawMs = Math.round(slowMax('drawMs') * 100) / 100;
    const recentMaxObjectLoopMs = Math.round(max('objectLoopMs') * 100) / 100;
    const retainedMaxSlowObjectLoopMs = Math.round(slowMax('objectLoopMs') * 100) / 100;
    const out = {
      draws: draws.length,
      retainedSlowDraws: retainedSlowDraws.length,
      avgDrawMs: draws.length ? Math.round(sum('ms') / draws.length * 100) / 100 : 0,
      maxDrawMs: Math.max(recentMaxDrawMs, retainedMaxSlowDrawMs),
      recentMaxDrawMs,
      retainedMaxSlowDrawMs,
      avgDrawnImages: draws.length ? Math.round(sum('drawnImages') / draws.length * 100) / 100 : 0,
      maxDrawnImages: max('drawnImages'),
      avgTestedObjects: draws.length ? Math.round(sum('testedObjects') / draws.length * 100) / 100 : 0,
      maxTestedObjects: max('testedObjects'),
      avgVisibleObjects: draws.length ? Math.round(sum('visibleObjects') / draws.length * 100) / 100 : 0,
      maxVisibleObjects: max('visibleObjects'),
      avgObjectLoopMs: draws.length ? Math.round(sum('objectLoopMs') / draws.length * 100) / 100 : 0,
      maxObjectLoopMs: Math.max(recentMaxObjectLoopMs, retainedMaxSlowObjectLoopMs),
      recentMaxObjectLoopMs,
      retainedMaxSlowObjectLoopMs,
      avgBackgroundSetupMs: draws.length ? Math.round(sum('backgroundSetupMs') / draws.length * 100) / 100 : 0,
      maxBackgroundSetupMs: Math.round(max('backgroundSetupMs') * 100) / 100,
      avgOffscreenBlitMs: draws.length ? Math.round(sum('offscreenBlitMs') / draws.length * 100) / 100 : 0,
      maxOffscreenBlitMs: Math.round(max('offscreenBlitMs') * 100) / 100,
      avgEditingOverlayMs: draws.length ? Math.round(sum('editingOverlayMs') / draws.length * 100) / 100 : 0,
      maxEditingOverlayMs: Math.round(max('editingOverlayMs') * 100) / 100,
      avgCulledImages: draws.length ? Math.round(sum('culledImages') / draws.length * 100) / 100 : 0,
      maxCulledImages: max('culledImages'),
      avgBitmapImages: draws.length ? Math.round(sum('bitmapImages') / draws.length * 100) / 100 : 0,
      avgElementImages: draws.length ? Math.round(sum('elementImages') / draws.length * 100) / 100 : 0,
      avgScaledImages: draws.length ? Math.round(sum('scaledImages') / draws.length * 100) / 100 : 0,
      maxScaledImages: max('scaledImages'),
      avgScaledFallbackFull: draws.length ? Math.round(sum('scaledFallbackFull') / draws.length * 100) / 100 : 0,
      avgScaledVariantPendingImages: draws.length ? Math.round(sum('scaledVariantPendingImages') / draws.length * 100) / 100 : 0,
      maxScaledVariantPendingImages: max('scaledVariantPendingImages'),
      avgScaledImageScale: sum('scaledImages') ? Math.round(sum('scaledImageScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgTargetImageScale: sum('scaledImages') ? Math.round(sum('scaledImageTargetScaleTotal') / sum('scaledImages') * 1000) / 1000 : 1,
      avgMissingImages: draws.length ? Math.round(sum('missingImages') / draws.length * 100) / 100 : 0,
      maxMissingImages: max('missingImages'),
      avgErroredImages: draws.length ? Math.round(sum('erroredImages') / draws.length * 100) / 100 : 0,
      avgCroppedImages: draws.length ? Math.round(sum('croppedImages') / draws.length * 100) / 100 : 0,
      maxRetainedSlowCroppedImages: slowMax('croppedImages'),
      avgDrawnText: draws.length ? Math.round(sum('drawnText') / draws.length * 100) / 100 : 0,
      avgCulledText: draws.length ? Math.round(sum('culledText') / draws.length * 100) / 100 : 0,
      avgTextLayoutMs: draws.length ? Math.round(sum('textLayoutMs') / draws.length * 100) / 100 : 0,
      maxTextLayoutMs: Math.round(max('maxTextLayoutMs') * 100) / 100,
      avgTextLayoutObjects: draws.length ? Math.round(sum('textLayoutObjects') / draws.length * 100) / 100 : 0,
      maxTextCharCount: max('textCharCount'),
      largestTextChars: max('largestTextChars'),
      largestTextLayoutLines: max('largestTextLayoutLines'),
      avgTextLines: draws.length ? Math.round(sum('textLines') / draws.length * 100) / 100 : 0,
      avgDrawnTextLines: draws.length ? Math.round(sum('drawnTextLines') / draws.length * 100) / 100 : 0,
      maxDrawnTextLines: Math.max(max('drawnTextLines'), slowMax('drawnTextLines')),
      avgCulledTextLines: draws.length ? Math.round(sum('culledTextLines') / draws.length * 100) / 100 : 0,
      maxCulledTextLines: Math.max(max('culledTextLines'), slowMax('culledTextLines')),
      avgEditLayoutMs: draws.length ? Math.round(sum('editLayoutMs') / draws.length * 100) / 100 : 0,
      maxEditLayoutMs: Math.round(Math.max(max('editLayoutMs'), slowMax('editLayoutMs')) * 100) / 100,
      avgEditTextDrawMs: draws.length ? Math.round(sum('editTextDrawMs') / draws.length * 100) / 100 : 0,
      maxEditTextDrawMs: Math.round(Math.max(max('editTextDrawMs'), slowMax('editTextDrawMs')) * 100) / 100,
      avgEditSelectionMs: draws.length ? Math.round(sum('editSelectionMs') / draws.length * 100) / 100 : 0,
      maxEditSelectionMs: Math.round(Math.max(max('editSelectionMs'), slowMax('editSelectionMs')) * 100) / 100,
      maxEditSelectedChars: Math.max(max('editSelectedChars'), slowMax('editSelectedChars')),
      maxEditSelectionLines: Math.max(max('editSelectionLines'), slowMax('editSelectionLines')),
      maxEditSelectionVisibleLines: Math.max(max('editSelectionVisibleLines'), slowMax('editSelectionVisibleLines')),
      avgEditCaretMs: draws.length ? Math.round(sum('editCaretMs') / draws.length * 100) / 100 : 0,
      maxEditCaretMs: Math.round(Math.max(max('editCaretMs'), slowMax('editCaretMs')) * 100) / 100,
      avgEditVisibleLines: draws.length ? Math.round(sum('editVisibleLines') / draws.length * 100) / 100 : 0,
      maxEditVisibleLines: Math.max(max('editVisibleLines'), slowMax('editVisibleLines')),
      avgEditCulledLines: draws.length ? Math.round(sum('editCulledLines') / draws.length * 100) / 100 : 0,
      maxEditCulledLines: Math.max(max('editCulledLines'), slowMax('editCulledLines')),
    };
    console.table([out]);
    return out;
  }

  function imageHealth(limit = 40) {
    const rows = (typeof objects === 'undefined' ? [] : objects)
      .filter(obj => obj.type === 'image')
      .map(obj => {
        const key = obj.data?.imgKey || '';
        const img = key ? (imageMetadataCache[key] || imageCache[key]) : null;
        const bitmap = key ? imageBitmapCache[key] : null;
        const src = key ? imageStore[key] : null;
        const ready = key ? imageReadyPromises.get(key) : null;
        let status = 'ok';
        if (!key) status = 'missing-key';
        else if (!src) status = 'missing-store';
        else if (!img) status = 'missing-image-element';
        else if (imageBitmapFailed.has(key) && img.complete && img.naturalWidth > 0) status = 'fallback-ok';
        else if (imageBitmapFailed.has(key)) status = 'bitmap-failed-no-fallback';
        else if (!bitmap) status = img.complete && img.naturalWidth > 0 ? 'loaded-no-bitmap' : 'not-loaded';
        return {
          id: obj.id,
          key,
          status,
          x: Math.round(obj.x),
          y: Math.round(obj.y),
          w: Math.round(obj.w),
          h: Math.round(obj.h),
          sourceKind: typeof isWebImageRef === 'function' && isWebImageRef(src) ? 'web-ref' : typeof src,
          bytes: src?.bytes ?? '',
          hasImg: !!img,
          complete: !!img?.complete,
          naturalW: img?.naturalWidth || 0,
          naturalH: img?.naturalHeight || 0,
          hasBitmap: !!bitmap,
          bitmapFailed: key ? imageBitmapFailed.has(key) : false,
          hasReadyPromise: !!ready,
        };
      });
    const bad = rows.filter(row => row.status !== 'ok' && row.status !== 'fallback-ok');
    console.table((bad.length ? bad : rows).slice(0, limit));
    return { total: rows.length, badCount: bad.length, bad, rows };
  }

  function imageHealthSummary() {
    const health = imageHealth(0);
    const counts = health.rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});
    const out = {
      total: health.total,
      badCount: health.badCount,
      ok: counts.ok || 0,
      missingKey: counts['missing-key'] || 0,
      missingStore: counts['missing-store'] || 0,
      missingAssetUrl: counts['missing-asset-url'] || 0,
      missingImageElement: counts['missing-image-element'] || 0,
      fallbackOk: counts['fallback-ok'] || 0,
      bitmapFailedNoFallback: counts['bitmap-failed-no-fallback'] || 0,
      loadedNoBitmap: counts['loaded-no-bitmap'] || 0,
      notLoaded: counts['not-loaded'] || 0,
    };
    console.table([out]);
    return out;
  }

  function imageScaleCacheSummary(options = {}) {
    const byScale = {};
    let variantCount = 0;
    for (const map of imageScaledBitmapCache.values()) {
      for (const [scale, entry] of map.entries()) {
        variantCount++;
        if (!byScale[scale]) byScale[scale] = { count: 0, mb: 0 };
        byScale[scale].count++;
        byScale[scale].mb += (entry.bytes || 0) / 1024 / 1024;
      }
    }
    const rows = Object.entries(byScale).map(([scale, row]) => ({
      scale,
      count: row.count,
      mb: Math.round(row.mb * 100) / 100,
    }));
    const out = {
      variants: variantCount,
      cacheMB: Math.round(imageScaledBitmapBytes / 1024 / 1024 * 100) / 100,
      limitMB: Math.round(IMAGE_VARIANT_MEMORY_LIMIT / 1024 / 1024),
      pending: imageScaledBitmapPending.size,
      pendingMB: Math.round(pendingScaledVariantBytes() / 1024 / 1024 * 100) / 100,
      queued: imageScaledVariantQueue.length,
      renderBatchPending: !!imageScaledVariantRenderTimer,
      renderBatchCount: imageScaledVariantRenderCount,
      inputIdleMs: Math.round((performance.now() - lastViewportInputAt) * 10) / 10,
      inputIdleThresholdMs: IMAGE_VARIANT_INPUT_IDLE_MS,
      activeInputQueueDelayMs: IMAGE_VARIANT_ACTIVE_INPUT_QUEUE_DELAY_MS,
      builds: imageScaledVariantBuildCount,
      avgBuildMs: imageScaledVariantBuildCount ? Math.round(imageScaledVariantBuildTotalMs / imageScaledVariantBuildCount * 10) / 10 : 0,
      maxBuildMs: Math.round(imageScaledVariantBuildMaxMs * 10) / 10,
      resizeBitmapBuilds: imageScaledVariantResizeBitmapCount,
      canvasFallbackBuilds: imageScaledVariantCanvasFallbackCount,
      evictions: imageScaledVariantEvictionCount,
      memorySkips: imageScaledVariantMemorySkipCount,
      prewarmRuns: imageScaledVariantPrewarmRunCount,
      prewarmCandidates: imageScaledVariantPrewarmCandidateCount,
      prewarmReady: imageScaledVariantPrewarmReadyCount,
      prewarmQueued: imageScaledVariantPrewarmQueuedCount,
      prewarmNoSource: imageScaledVariantPrewarmNoSourceCount,
      prewarmPending: !!imageScaledVariantPrewarmTimer,
      prewarmPadPx: IMAGE_VARIANT_PREWARM_PAD_PX,
      levels: IMAGE_SCALE_LEVELS.join(','),
      supported: VIEWPORT_IMAGE_SCALING_SUPPORTED,
      enabled: viewportImageScalingEnabled,
    };
    if (options.table !== false) {
      console.table([out]);
      if (rows.length) console.table(rows);
    }
    return { ...out, byScale: rows };
  }

  function cullingSummary() {
    const rect = currentViewportWorldRect();
    let visibleImages = 0;
    let visibleText = 0;
    let culledImages = 0;
    let culledText = 0;
    let visibleImagesWithScaledVariant = 0;
    let visibleImagesMissingScaledVariant = 0;
    let visibleScaledVariantMB = 0;
    for (const obj of objects) {
      const visible = objectIntersectsRect(obj, rect);
      if (obj.type === 'image') {
        if (visible) {
          visibleImages++;
          const key = obj.data?.imgKey;
          const bitmap = key ? imageBitmapCache[key] : null;
          const fullSource = bitmap || imageMetadataCache[key] || imageCache[key] || null;
          const scalingActive = typeof isViewportImageScalingActive === 'function'
            ? isViewportImageScalingActive()
            : viewportImageScalingEnabled;
          const targetScale = scalingActive && fullSource ? chooseImageScaleForDraw(obj, fullSource) : 1;
          if (targetScale < 1) {
            const sourceW = fullSource?.width || fullSource?.naturalWidth || 0;
            const sourceH = fullSource?.height || fullSource?.naturalHeight || 0;
            visibleScaledVariantMB += scaledVariantEstimatedBytes(sourceW, sourceH, targetScale) / 1024 / 1024;
            if (imageScaledBitmapCache.get(key)?.has(targetScale)) visibleImagesWithScaledVariant++;
            else visibleImagesMissingScaledVariant++;
          }
        } else culledImages++;
      } else if (obj.type === 'text') {
        if (visible) visibleText++;
        else culledText++;
      }
    }
    const out = {
      paddingPx: VIEWPORT_CULL_PADDING_PX,
      enabled: viewportCullingEnabled,
      zoom: Math.round(zoom * 1000) / 1000,
      padWorld: Math.round((VIEWPORT_CULL_PADDING_PX / Math.max(zoom, 0.001)) * 100) / 100,
      visibleImages,
      culledImages,
      visibleImagesWithScaledVariant,
      visibleImagesMissingScaledVariant,
      visibleScaledVariantMB: Math.round(visibleScaledVariantMB * 100) / 100,
      visibleText,
      culledText,
      rectX1: Math.round(rect.x1),
      rectY1: Math.round(rect.y1),
      rectX2: Math.round(rect.x2),
      rectY2: Math.round(rect.y2),
    };
    console.table([out]);
    return out;
  }

  function slowFrames(limit = 20) {
    const rows = slowRecords
      .map(e => ({
        id: e.id,
        frameMs: e.frameMs ?? '',
        queueMs: e.queueMs ?? '',
        inputAgeMs: e.inputAgeMs ?? '',
        inputSource: e.inputSource ?? '',
        rafGap: e.rafGap ?? '',
        sources: e.sources ?? '',
        doTransform: e.doTransform ?? '',
        doBoard: e.doBoard ?? '',
        doOverlay: e.doOverlay ?? '',
        applyTransformCallMs: e.steps?.applyTransformCall?.ms ?? '',
        drawBoardMs: e.steps?.drawBoard?.ms ?? '',
        objectLoopMs: e.steps?.drawBoard?.meta?.objectLoopMs ?? '',
        backgroundSetupMs: e.steps?.drawBoard?.meta?.backgroundSetupMs ?? '',
        offscreenBlitMs: e.steps?.drawBoard?.meta?.offscreenBlitMs ?? '',
        editingOverlayMs: e.steps?.drawBoard?.meta?.editingOverlayMs ?? '',
        testedObjects: e.steps?.drawBoard?.meta?.testedObjects ?? '',
        visibleObjects: e.steps?.drawBoard?.meta?.visibleObjects ?? '',
        drawnImages: e.steps?.drawBoard?.meta?.drawnImages ?? '',
        drawnText: e.steps?.drawBoard?.meta?.drawnText ?? '',
        textLayoutMs: e.steps?.drawBoard?.meta?.textLayoutMs ?? '',
        maxTextLayoutMs: e.steps?.drawBoard?.meta?.maxTextLayoutMs ?? '',
        textLayoutObjects: e.steps?.drawBoard?.meta?.textLayoutObjects ?? '',
        textCharCount: e.steps?.drawBoard?.meta?.textCharCount ?? '',
        largestTextChars: e.steps?.drawBoard?.meta?.largestTextChars ?? '',
        largestTextLayoutLines: e.steps?.drawBoard?.meta?.largestTextLayoutLines ?? '',
        textLines: e.steps?.drawBoard?.meta?.textLines ?? '',
        drawnTextLines: e.steps?.drawBoard?.meta?.drawnTextLines ?? '',
        culledTextLines: e.steps?.drawBoard?.meta?.culledTextLines ?? '',
        editLayoutMs: e.steps?.drawBoard?.meta?.editLayoutMs ?? '',
        editTextDrawMs: e.steps?.drawBoard?.meta?.editTextDrawMs ?? '',
        editSelectionMs: e.steps?.drawBoard?.meta?.editSelectionMs ?? '',
        editCaretMs: e.steps?.drawBoard?.meta?.editCaretMs ?? '',
        editLayoutLines: e.steps?.drawBoard?.meta?.editLayoutLines ?? '',
        editVisibleLines: e.steps?.drawBoard?.meta?.editVisibleLines ?? '',
        editCulledLines: e.steps?.drawBoard?.meta?.editCulledLines ?? '',
        editSelectionRuns: e.steps?.drawBoard?.meta?.editSelectionRuns ?? '',
        editSelectedChars: e.steps?.drawBoard?.meta?.editSelectedChars ?? '',
        editSelectionLines: e.steps?.drawBoard?.meta?.editSelectionLines ?? '',
        editSelectionVisibleLines: e.steps?.drawBoard?.meta?.editSelectionVisibleLines ?? '',
        editCaretDrawn: e.steps?.drawBoard?.meta?.editCaretDrawn ?? '',
        bitmapImages: e.steps?.drawBoard?.meta?.bitmapImages ?? '',
        elementImages: e.steps?.drawBoard?.meta?.elementImages ?? '',
        scaledImages: e.steps?.drawBoard?.meta?.scaledImages ?? '',
        scaledFallbackFull: e.steps?.drawBoard?.meta?.scaledFallbackFull ?? '',
        scaledVariantPendingImages: e.steps?.drawBoard?.meta?.scaledVariantPendingImages ?? '',
        fullScaleImages: e.steps?.drawBoard?.meta?.fullScaleImages ?? '',
        missingImages: e.steps?.drawBoard?.meta?.missingImages ?? '',
        croppedImages: e.steps?.drawBoard?.meta?.croppedImages ?? '',
        culledImages: e.steps?.drawBoard?.meta?.culledImages ?? '',
        culledText: e.steps?.drawBoard?.meta?.culledText ?? '',
        slowDrawObjects: (e.steps?.drawBoard?.meta?.slowDrawObjects || [])
          .map(row => `${row.type || ''}:${row.id || ''}:${row.ms ?? ''}ms`)
          .join(' | '),
        canvasW: e.steps?.drawBoard?.meta?.canvasW ?? '',
        canvasH: e.steps?.drawBoard?.meta?.canvasH ?? '',
        zoom: e.steps?.drawBoard?.meta?.zoom ?? e.zoom ?? '',
        updateSelectionOverlayMs: e.steps?.updateSelectionOverlay?.ms ?? '',
      }))
      .sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0))
      .slice(0, limit);
    console.table(rows);
    return rows;
  }

  function slowFrameDetails(limit = 5) {
    const rows = slowRecords
      .slice()
      .sort((a, b) => (b.frameMs || 0) - (a.frameMs || 0))
      .slice(0, limit)
      .map(e => ({
        id: e.id,
        frameMs: e.frameMs ?? '',
        queueMs: e.queueMs ?? '',
        inputAgeMs: e.inputAgeMs ?? '',
        inputSource: e.inputSource ?? '',
        rafGap: e.rafGap ?? '',
        sources: e.sources ?? '',
        start: {
          panX: e.panX,
          panY: e.panY,
          zoom: e.zoom,
        },
        flags: {
          doTransform: e.doTransform,
          doBoard: e.doBoard,
          doOverlay: e.doOverlay,
        },
        steps: Object.fromEntries(Object.entries(e.steps || {}).map(([name, step]) => ([
          name,
          {
            ms: Math.round((step.ms || 0) * 100) / 100,
            total: Math.round((step.total || 0) * 100) / 100,
            meta: step.meta || {},
          },
        ]))),
      }));
    console.log(rows);
    return rows;
  }

  function transformSummary() {
    const stepsById = new Map();
    const starts = new Map();
    for (const e of events) {
      if (e.op !== 'applyTransform') continue;
      if (e.step === 'start') starts.set(e.id, e.meta || {});
      else if (e.step !== 'end') {
        if (!stepsById.has(e.id)) stepsById.set(e.id, {});
        stepsById.get(e.id)[e.step] = e.meta?.ms ?? e.total ?? 0;
      }
    }
    const rows = events
      .filter(e => e.op === 'applyTransform' && e.step === 'end' && !e.meta?.skipped)
      .map(e => ({ ...(starts.get(e.id) || {}), ...(stepsById.get(e.id) || {}), totalMs: e.total }));
    const sum = (field) => rows.reduce((n, row) => n + (Number(row[field]) || 0), 0);
    const max = (field) => rows.reduce((n, row) => Math.max(n, Number(row[field]) || 0), 0);
    const out = {
      transforms: rows.length,
      avgTotalMs: rows.length ? Math.round(sum('totalMs') / rows.length * 100) / 100 : 0,
      maxTotalMs: Math.round(max('totalMs') * 100) / 100,
      avgDrawBoardMs: rows.length ? Math.round(sum('drawBoard') / rows.length * 100) / 100 : 0,
      maxDrawBoardMs: Math.round(max('drawBoard') * 100) / 100,
      avgSaveViewportMs: rows.length ? Math.round(sum('saveViewport') / rows.length * 100) / 100 : 0,
      maxSaveViewportMs: Math.round(max('saveViewport') * 100) / 100,
      avgOverlayMs: rows.length ? Math.round(sum('updateSelectionOverlay') / rows.length * 100) / 100 : 0,
      maxOverlayMs: Math.round(max('updateSelectionOverlay') * 100) / 100,
    };
    console.table([out]);
    return out;
  }

  function eventLoopTimeline(limit = 80) {
    const rows = events
      .filter(e => e.op === 'eventLoop' || e.op === 'longTask')
      .slice(-Math.max(1, Number(limit) || 80))
      .map(e => ({
        at: e.at,
        kind: e.op,
        step: e.step,
        gapMs: e.meta?.gapMs ?? '',
        overMs: e.meta?.overMs ?? '',
        durationMs: e.meta?.duration ?? '',
        startTime: e.meta?.startTime ?? '',
      }));
    console.table(rows);
    return rows;
  }

  function rawInputTimeline(limit = 120) {
    const rows = events
      .filter(e => e.op === 'input')
      .slice(-Math.max(1, Number(limit) || 120))
      .map(e => ({
        at: e.at,
        step: e.step,
        source: e.meta?.source || '',
        eventType: e.meta?.eventType || '',
        eventAgeMs: e.meta?.eventAgeMs ?? '',
        deltaX: e.meta?.deltaX ?? '',
        deltaY: e.meta?.deltaY ?? '',
        key: e.meta?.key || '',
        code: e.meta?.code || '',
        repeat: e.meta?.repeat ?? '',
        button: e.meta?.button ?? '',
        buttons: e.meta?.buttons ?? '',
        ctrl: !!e.meta?.ctrlKey,
        meta: !!e.meta?.metaKey,
        shieldActive: e.meta?.shieldActive ?? '',
        inputShieldCount: e.meta?.inputShieldCount ?? '',
        blocked: e.meta?.blocked ?? '',
        target: e.meta?.target || '',
      }));
    console.table(rows);
    return rows;
  }

  function report(options = {}) {
    const out = {
      summary: summary(),
      frameSummary: frameSummary(),
      wheelSummary: wheelSummary(),
      drawSummary: drawSummary(),
      transformSummary: transformSummary(),
      eventLoopTimeline: eventLoopTimeline(options.eventLoopLimit ?? 80),
      rawInputTimeline: rawInputTimeline(options.rawInputLimit ?? 120),
      slowFrames: slowFrames(options.slowFrames ?? options.limit ?? 20),
      imageScaleCache: imageScaleCacheSummary(),
      culling: cullingSummary(),
    };
    if (options.details !== false) out.slowFrameDetails = slowFrameDetails(options.detailLimit ?? 3);
    if (options.log !== false) console.log(out);
    return out;
  }

  function dump() {
    const flat = events.map(({ meta, ...rest }) => {
      if (!meta) return rest;
      const { rust, ...other } = meta;
      return rust && typeof rust === 'object' ? { ...rest, ...other, ...Object.fromEntries(Object.entries(rust).map(([k, v]) => ['rust_' + k, v])) } : { ...rest, ...other };
    });
    console.table(flat);
    return events.slice();
  }

  function reset() {
    events.length = 0;
    slowRecords.length = 0;
    for (const key of Object.keys(stats)) stats[key] = 0;
    lastRafAt = 0;
    eventLoopLastTick = performance.now();
  }

  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    count,
    max,
    timing,
    frameStart,
    frameEnd,
    report,
    summary,
    frameSummary,
    drawSummary,
    imageHealth,
    imageHealthSummary,
    imageScaleCacheSummary,
    cullingSummary,
    setPerfMode: (modeKey) => (
      typeof setViewportPerfMode === 'function' ? setViewportPerfMode(modeKey) : null
    ),
    perfMode: (modeKey = null) => (
      typeof viewportPerfModeSummary === 'function' ? viewportPerfModeSummary(modeKey) : null
    ),
    transformSummary,
    eventLoopTimeline,
    rawInputTimeline,
    recordRawInput,
    recordShieldBlock,
    wheelSummary,
    wheelTimeline,
    slowFrames,
    slowFrameDetails,
    dump,
    reset,
    isEnabled: () => enabled,
    get events() { return events.slice(); },
    get stats() { return { ...stats }; },
  };
})();

exposeDebug({ viewport: ViewportDebug });

// ─── Manual performance debugger ─────────────────────────────────────────────

// ─── Save debugger ───────────────────────────────────────────────────────────

// ─── Open debugger ───────────────────────────────────────────────────────────

// ─── Export debugger ─────────────────────────────────────────────────────────
