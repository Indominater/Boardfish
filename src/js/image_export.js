'use strict';

async function saveSelectedImage() {
  const dbg = ExportDebug.start('exportImage', { selectedCount: selectedIds.size });
  globalThis.BoardfishMotion?.applyActionAnimation?.('export-selected-image');
  const imageObjs = BoardfishExportUtils.selectedImageObjects();
  if (imageObjs.length !== 1) {
    ExportDebug.end(dbg, { skipped: true, imageCount: imageObjs.length });
    return;
  }

  ExportDebug.startMassive('exportImage', imageObjs);
  const obj = imageObjs[0];
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });
  const ext = BoardfishExportUtils.guessImageExtForObjectExport(obj);
  const defaultName = `image_${BoardfishExportUtils.randomHex()}.${ext}`;

  let busyPill = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects([obj], dbg, {
      filename: defaultName,
      targetMode: 'file',
      onStart: () => {
        busyPill = startPillTask({ message: 'Exporting', progress: true });
        updatePillTask(busyPill, 'Exporting');
        ExportDebug.step(dbg, 'web-export:pill-start', { imageCount: 1 });
      },
      onProgress: ({ phase, preparedCount, finishedCount }) => {
        if (phase === 'save-progress') updatePillTask(busyPill, `${finishedCount || preparedCount || 1}/1`);
      },
    });
    const saved = (downloadResult?.downloadedCount || 0) > 0;
    ExportDebug.end(dbg, { saved, ...downloadResult });
    if (saved) {
      finishPillTask({ beforeFinish: releaseInputShield, busyPill, finalMsg: '1 Image Exported' });
    } else if (busyPill) {
      finishPillTask({ beforeFinish: releaseInputShield, busyPill });
    } else {
      releaseInputShield();
    }
  } catch (err) {
    if (busyPill) finishPillTask({ beforeFinish: releaseInputShield, busyPill });
    else releaseInputShield();
    ExportDebug.end(dbg, { saved: false, error: String(err) });
    console.error('Save image failed:', err);
  }
}

async function exportImageBatch({
  op,
  mode,
  imageObjs,
  startMeta,
  skipMeta = null,
  errorLabel,
  clearSelectionAfter = false,
}) {
  const dbg = ExportDebug.start(op, startMeta);
  const stopTotalWatch = ExportDebug.watch(dbg, 'export-total', { mode }, 5000);
  if (skipMeta) {
    stopTotalWatch({ skipped: true });
    ExportDebug.end(dbg, { skipped: true, imageCount: imageObjs.length, ...skipMeta });
    hideInputShield();
    return;
  }

  ExportDebug.step(dbg, 'images:found', { imageCount: imageObjs.length });
  ExportDebug.startMassive(op, imageObjs);

  let busyPill = null;
  let updateProgress = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects(imageObjs, dbg, {
      targetMode: 'folder',
      onStart: () => {
        busyPill = startPillTask({ message: `0/${imageObjs.length}`, progress: true });
        updateProgress = BoardfishExportUtils.createProgressUpdater(imageObjs.length, busyPill);
        ExportDebug.step(dbg, 'web-export:pill-start', { imageCount: imageObjs.length });
      },
      onProgress: ({ phase, preparedCount, finishedCount, totalCount, force }) => {
        if (!updateProgress) return;
        updateProgress(phase || 'prepare-progress', preparedCount ?? finishedCount ?? imageObjs.length, {
          finishedCount: finishedCount ?? '',
          totalCount: totalCount ?? imageObjs.length,
        }, force === true);
      },
    });
    const downloadedCount = downloadResult?.downloadedCount || 0;
    const saved = downloadedCount > 0;
    stopTotalWatch({ saved, ...downloadResult });
    ExportDebug.end(dbg, { saved, imageCount: imageObjs.length, ...downloadResult });
    if (downloadedCount > 0) {
      finishPillTask({
        beforeFinish: () => BoardfishExportUtils.finishImageExportInputShield(clearSelectionAfter && imageObjs.length),
        busyPill,
        finalMsg: downloadedCount === 1 ? '1 Image Exported' : `${downloadedCount} Images Exported`,
      });
    } else if (busyPill) {
      finishPillTask({ beforeFinish: hideInputShield, busyPill });
    } else {
      hideInputShield();
    }
  } catch (err) {
    if (busyPill) finishPillTask({ beforeFinish: hideInputShield, busyPill });
    else hideInputShield();
    stopTotalWatch({ error: String(err) });
    ExportDebug.end(dbg, { saved: false, imageCount: imageObjs.length, error: String(err) });
    console.error(errorLabel, err);
  }
}

async function saveSelectedImages() {
  globalThis.BoardfishMotion?.applyActionAnimation?.('export-selected-images');
  const multiSelection = isMultiSelected();
  const selectedObjs = BoardfishExportUtils.selectedImageObjects();
  return exportImageBatch({
    op: 'exportImages',
    mode: 'selected',
    imageObjs: selectedObjs,
    startMeta: { selectedCount: selectedIds.size },
    skipMeta: (!multiSelection || selectedObjs.length < 1) ? { multiSelection } : null,
    errorLabel: 'Save images failed:',
  });
}
