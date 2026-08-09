'use strict';

async function saveSelectedImage() {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = ExportDebug.start('exportImage', { selectedCount: selectedIds.size });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
    const downloadResult = await BoardfishExportUtils.downloadImageObjects([obj]
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , {
      filename: defaultName,
      targetMode: 'file',
      onStart: () => {
        busyPill = startPillTask({ message: 'Exporting', progress: true });
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
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  op,
  mode,
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  imageObjs,
  skip = false,
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  startMeta,
  skipMeta = null,
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  errorLabel,
  clearSelectionAfter = false,
}) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = ExportDebug.start(op, startMeta);
  const stopTotalWatch = typeof BOARDFISH_PRODUCTION === 'undefined'
    ? ExportDebug.watch(dbg, 'export-total', { mode }, 5000)
    : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (skip) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    stopTotalWatch?.({ skipped: true });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ExportDebug.end(dbg, { skipped: true, imageCount: imageObjs.length, ...skipMeta });
    hideInputShield();
    return;
  }

  ExportDebug.step(dbg, 'images:found', { imageCount: imageObjs.length });
  ExportDebug.startMassive(op, imageObjs);

  let busyPill = null;
  let updateProgress = null;
  try {
    const downloadResult = await BoardfishExportUtils.downloadImageObjects(imageObjs
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , {
      targetMode: 'folder',
      onStart: () => {
        busyPill = startPillTask({ message: `0/${imageObjs.length}`, progress: true });
        updateProgress = BoardfishExportUtils.createProgressUpdater(imageObjs.length, busyPill);
        ExportDebug.step(dbg, 'web-export:pill-start', { imageCount: imageObjs.length });
      },
      onProgress: typeof BOARDFISH_PRODUCTION === 'undefined'
        ? ({ phase, preparedCount, finishedCount, totalCount, force }) => {
          if (!updateProgress) return;
          updateProgress(phase || 'prepare-progress', preparedCount ?? finishedCount ?? imageObjs.length, {
            finishedCount: finishedCount ?? '',
            totalCount: totalCount ?? imageObjs.length,
          }, force === true);
        }
        : ({ preparedCount, finishedCount, force }) => {
          if (!updateProgress) return;
          updateProgress(preparedCount ?? finishedCount ?? imageObjs.length, force === true);
        },
    });
    const downloadedCount = downloadResult?.downloadedCount || 0;
    const saved = downloadedCount > 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    stopTotalWatch?.({ saved, ...downloadResult });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    stopTotalWatch?.({ error: String(err) });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ExportDebug.end(dbg, { saved: false, imageCount: imageObjs.length, error: String(err) });
    console.error(errorLabel, err);
  }
}

async function saveSelectedImages() {
  const multiSelection = isMultiSelected();
  const selectedObjs = BoardfishExportUtils.selectedImageObjects();
  return exportImageBatch({
    imageObjs: selectedObjs,
    skip: !multiSelection || selectedObjs.length < 1,
    errorLabel: 'Save images failed:',
    ...(typeof BOARDFISH_PRODUCTION === 'undefined'
      ? {
          op: 'exportImages',
          mode: 'selected',
          startMeta: { selectedCount: selectedIds.size },
          skipMeta: (!multiSelection || selectedObjs.length < 1) ? { multiSelection } : null,
        }
      : {}),
  });
}
