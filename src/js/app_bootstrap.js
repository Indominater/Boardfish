'use strict';

document.fonts?.ready.then(clearTextMeasurementCaches).catch(() => {});
resizeCanvas();
snapshot();
islSetWidth('100%');
updateZoomDisplay(true);
updateTitle();

async function confirmDirtyBeforeOpen(dbg) {
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
}

async function openBoardFromPath(filePath, dbg, errorLabel) {
  try {
    _boardOpening = true;
    openingShield.classList.add('active');
    await startPillTask({ message: 'Opening' });
    const data = await invokeReadBoard(filePath, dbg);
    applyBoardData(data, { dbg, sourcesCached: true, deferRender: true, endDebug: false });
    await finishOpenedBoard(dbg, data);
    currentFilePath = filePath;
    updateTitle();
  } catch (err) {
    finishFailedOpen(dbg, err, errorLabel);
  }
}

function finishFailedOpen(dbg, err, errorLabel) {
  console.error(errorLabel, err);
  _boardOpening = false;
  finishPillTransition({
    beforeTransition: () => openingShield.classList.remove('active'),
  });
  OpenDebug.end(dbg, { opened: false, error: String(err) });
}

async function openFilePath(filePath) {
  const dbg = OpenDebug.start('openFilePath', { path: filePath, currentFilePath, objectCount: objects.length });
  if (!(await confirmDirtyBeforeOpen(dbg))) return;
  await openBoardFromPath(filePath, dbg, 'Failed to open file:');
}

if (hasTauri()) {
  tauriListen('boardfish://open-file', (event) => {
    openFilePath(event.payload);
  });

  BoardfishTauri.getStartupFile().then((filePath) => {
    if (filePath) openFilePath(filePath);
  });
}
