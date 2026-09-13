'use strict';

var confirmDirtyBeforeOpen;
var openBoardFromPath;
var finishFailedOpen;

{
  document.fonts?.ready.then(clearTextMeasurementCaches).catch(() => {});
  startCanvasSizeTracking();
  resizeCanvas();
  snapshot();
  markSaved();

  confirmDirtyBeforeOpen = async function confirmDirtyBeforeOpen(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg,
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    if (!isDirty()) return true;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    OpenDebug.step(dbg, 'dirty-dialog:start');
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const choice = await showUnsavedDialog();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    OpenDebug.step(dbg, 'dirty-dialog:end', { choice });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (choice === 'cancel') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      OpenDebug.end(dbg, { cancelled: true });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return false;
    }
    if (choice !== 'save') return true;
    const saved = await saveBoard();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    OpenDebug.step(dbg, 'dirty-dialog:save-result', { saved });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (!saved) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      OpenDebug.end(dbg, { cancelled: true, reason: 'save-failed' });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return false;
    }
    return true;
  };

  openBoardFromPath = async function openBoardFromPath(
    filePath,
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg,
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    try {
      const fileLabel = BoardfishRuntime.describeFileRef(filePath);
      _boardOpening = true;
      beginOpeningFreeze();
      startPillTask({ message: 'Opening' });
      const data = await invokeReadBoard(filePath
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
      applyBoardData(data
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
      currentFileRef = filePath;
      currentFilePath = fileLabel;
      await finishOpenedBoard(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        dbg, data
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
    } catch (err) {
      finishFailedOpen(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        dbg,
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        err,
      );
    }
  };

  function openFailureIslandMessage(err) {
    if (err?.boardfishLimit) return err.boardfishUserMessage || 'Board Limit Exceeded';
    const raw = String(err?.message || err || '').replace(/^Error:\s*/i, '').trim();
    const name = String(err?.name || '');
    let detail = '';
    if (/^(NotAllowedError|SecurityError)$/i.test(name) || /^(permission|access denied|not allowed)\b/i.test(raw)) {
      detail = 'Permission Denied';
    } else if (/^(NotFoundError|NotReadableError)$/i.test(name) || /^(file unavailable|no file selected|(?:file|image) read failed|failed to fetch)\b/i.test(raw)) {
      detail = 'File Unavailable';
    } else if (name === 'NotSupportedError' || /^unsupported\b/i.test(raw)) {
      detail = 'Unsupported File';
    } else if (/^(file entry too large|ZIP size limit exceeded)\b/i.test(raw)) {
      detail = 'File Too Large';
    } else if (name === 'SyntaxError' || /^(invalid|truncated|missing|file checksum mismatch|image format mismatch|corrupt|expected image|base64)\b/i.test(raw)) {
      detail = 'Invalid File';
    }
    return detail ? `Open Failed: ${detail}` : 'Open Failed';
  }

  finishFailedOpen = function finishFailedOpen(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg,
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    err,
  ) {
    console.error('Open Failed:', err);
    const message = openFailureIslandMessage(err);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    OpenDebug.step(dbg, 'open-failed:message', { message, limit: !!err?.boardfishLimit });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    _boardOpening = false;
    finishPillTask({
      beforeFinish: endOpeningFreeze,
      finalMsg: message,
      duration: long_message,
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    OpenDebug.end(dbg, { opened: false, error: String(err) });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  };

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  async function openFilePath(filePath) {
    const dbg = OpenDebug.start('openFilePath', { path: BoardfishRuntime.describeFileRef(filePath), currentFilePath, objectCount: objects.length });
    if (!(await confirmDirtyBeforeOpen(dbg))) return;
    await openBoardFromPath(filePath, dbg);
  }

  // Console diagnostics must go through beginDebug()/finishDebug(). Register test
  // actions here instead of exposing them as globals so agents can pass them into
  // beginDebug({ openFilePath: [...] }) without bypassing capture/download.
  registerDebugCommand('openFilePath', openFilePath);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

}
