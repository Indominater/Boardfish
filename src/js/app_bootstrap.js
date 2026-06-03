'use strict';

var confirmDirtyBeforeOpen;
var openBoardFromPath;
var finishFailedOpen;

{
  document.fonts?.ready.then(clearTextMeasurementCaches).catch(() => {});
  resizeCanvas();
  snapshot();
  updateTitle();

  confirmDirtyBeforeOpen = async function confirmDirtyBeforeOpen(dbg) {
    if (!isDirty()) return true;
    OpenDebug.step(dbg, 'dirty-dialog:start');
    const choice = await showUnsavedDialog();
    OpenDebug.step(dbg, 'dirty-dialog:end', { choice });
    if (choice === 'cancel') {
      OpenDebug.end(dbg, { cancelled: true });
      return false;
    }
    if (choice !== 'save') return true;
    const saved = await saveBoard();
    OpenDebug.step(dbg, 'dirty-dialog:save-result', { saved });
    if (!saved) {
      OpenDebug.end(dbg, { cancelled: true, reason: 'save-failed' });
      return false;
    }
    return true;
  };

  openBoardFromPath = async function openBoardFromPath(filePath, dbg, errorLabel) {
    try {
      const fileLabel = BoardfishRuntime.describeFileRef(filePath);
      _boardOpening = true;
      if (typeof beginOpeningFreeze === 'function') beginOpeningFreeze();
      else openingShield.classList.add('active');
      startPillTask({ message: 'Opening' });
      const data = await invokeReadBoard(filePath, dbg);
      applyBoardData(data, { dbg, sourcesCached: true, deferRender: true, endDebug: false });
      currentFileRef = filePath;
      currentFilePath = fileLabel;
      updateTitle();
      await finishOpenedBoard(dbg, data);
      updateTitle();
    } catch (err) {
      finishFailedOpen(dbg, err, errorLabel);
    }
  };

  function openFailureUserDetail(detail, err) {
    if (err?.boardfishUserMessage) return err.boardfishUserMessage;
    const raw = String(detail || '').replace(/^Error:\s*/, '').trim();
    const name = String(err?.name || '');
    if (/^(NotAllowedError|SecurityError)$/i.test(name) || /\b(permission|not allowed|denied)\b/i.test(raw)) {
      return 'Permission was not granted';
    }
    if (/^no Boardfish file selected$/i.test(raw)) return 'No Boardfish file selected';
    if (/unsupported Boardfish file; expected container \.bf|unsupported binary input/i.test(raw)) {
      return 'Unsupported Boardfish file';
    }
    if (/unsupported board version/i.test(raw)) return 'Unsupported Boardfish file version';
    if (/unsupported board format/i.test(raw)) return 'Unsupported Boardfish file format';
    if (/this browser cannot read compressed \.bf entries|unsupported \.bf compression method/i.test(raw)) {
      return 'This browser cannot open compressed Boardfish files';
    }
    if (/Boardfish file is missing board\.json/i.test(raw)) return 'Boardfish file is missing board data';
    if (/Boardfish file is missing .+|references missing image/i.test(raw)) return 'Boardfish file is missing image data';
    if (
      name === 'SyntaxError' ||
      /invalid Boardfish container|truncated Boardfish container|expected image data URL|base64 (?:de|en)coding is unavailable|board data must be an object|imageStore must be an object|imageStore contains an empty key|imageStore\..+ must be a string or object|object \d+ is not an object|object \d+ has unsupported type|object \d+ is missing id|image object .+ is missing imgKey/i.test(raw)
    ) {
      return 'Boardfish file is invalid';
    }
    if (/unsupported web file reference/i.test(raw)) return 'Unable to read Boardfish file';
    if (err?.boardfishLimit) {
      return raw
        .replace(/^(?:images\/)?[^/\\]+\.(?:png|jpe?g|webp|gif)\s+is\s+/i, 'one image is ')
        .replace(/^.+[\\/]images[\\/][^/\\]+\.(?:png|jpe?g|webp|gif)\s+is\s+/i, 'one image is ')
        .replace(/\.$/, '');
    }
    return raw.replace(/\.$/, '');
  }

  function openFailureIslandMessage(errorLabel, err) {
    const prefix = String(errorLabel || 'Open failed:').replace(/:\s*$/, '').trim() || 'Open failed';
    const detail = openFailureUserDetail(err?.message || err, err);
    if (!detail) return prefix;
    if (detail.toLowerCase().startsWith(prefix.toLowerCase())) return detail;
    return `${prefix}: ${detail}`;
  }

  finishFailedOpen = function finishFailedOpen(dbg, err, errorLabel) {
    console.error(errorLabel, err);
    const message = openFailureIslandMessage(errorLabel, err);
    OpenDebug.step(dbg, 'open-failed:message', { message, limit: !!err?.boardfishLimit });
    _boardOpening = false;
    finishPillTask({
      beforeFinish: () => {
        if (typeof endOpeningFreeze === 'function') endOpeningFreeze();
        else openingShield.classList.remove('active');
      },
      finalMsg: message,
      duration: long_message,
    });
    OpenDebug.end(dbg, { opened: false, error: String(err) });
  };

  async function openFilePath(filePath) {
    const dbg = OpenDebug.start('openFilePath', { path: BoardfishRuntime.describeFileRef(filePath), currentFilePath, objectCount: objects.length });
    if (!(await confirmDirtyBeforeOpen(dbg))) return;
    await openBoardFromPath(filePath, dbg, 'Open failed:');
  }

  // Console diagnostics must go through beginDebug()/finishDebug(). Register test
  // actions here instead of exposing them as globals so agents can pass them into
  // beginDebug({ openFilePath: [...] }) without bypassing capture/download.
  registerDebugCommand('openFilePath', openFilePath);

}
