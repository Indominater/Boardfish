'use strict';

async function saveSelectedImage() {
  const dbg = ExportDebug.start('exportImage', { selectedCount: selectedIds.size });
  const imageObjs = [...selectedIds].map(id => objectsMap.get(id)).filter(o => o && o.type === 'image');
  if (imageObjs.length !== 1) { ExportDebug.end(dbg, { skipped: true, imageCount: imageObjs.length }); return; }
  const obj = imageObjs[0];
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  if (hasTauri()) {
    let tempKeys = [];
    try {
      const ext = BoardfishExportUtils.guessImageExtForObjectExport(obj);
      const hex = BoardfishExportUtils.randomHex();
      const defaultName = `image_${hex}.${ext}`;
      ExportDebug.step(dbg, 'keys:resolve-start', { imageCount: 1, defaultName });
      const resolved = await resolveExportKeys([obj], dbg);
      tempKeys = resolved.tempKeys;
      const key = resolved.keys[0];
      ExportDebug.step(dbg, 'keys:ready', { keyCount: resolved.keys.length, tempKeyCount: tempKeys.length, renderedCount: resolved.renderedCount });
      if (!key) {
        releaseInputShield();
        ExportDebug.end(dbg, { skipped: true, reason: 'no-key' });
        return;
      }

      const path = await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.SAVE_IMAGE_FILE_DIALOG,
        () => BoardfishTauri.saveImageFileDialog(defaultName),
        { defaultName }
      );
      ExportDebug.step(dbg, 'image:path-selected', { selected: !!path });
      if (!path) {
        releaseInputShield();
        ExportDebug.end(dbg, { saved: false, cancelled: true });
        return;
      }

      const result = await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.WRITE_IMAGE_FILE_BY_KEY,
        () => BoardfishTauri.writeImageFileByKey(path, key),
        { imgKey: key, path }
      );
      ExportDebug.end(dbg, { saved: true, bytesMB: result?.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : 0 });
      finishPillTask({ beforeFinish: releaseInputShield, finalMsg: 'Image Exported' });
    } catch (err) {
      releaseInputShield();
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Save image failed:', err);
    } finally {
      await BoardfishExportUtils.cleanupTempKeys(tempKeys);
    }
    return;
  }

  ExportDebug.step(dbg, 'render:start');
  const src = await getRenderedImageDataUrl(obj, dbg);
  ExportDebug.step(dbg, 'render:complete', { hasDataUrl: !!src });
  if (!src) { releaseInputShield(); ExportDebug.end(dbg, { skipped: true, reason: 'no-dataurl' }); return; }

  const ext = BoardfishExportUtils.guessImageExtFromDataUrl(src);
  const hex = BoardfishExportUtils.randomHex();
  const defaultName = `image_${hex}.${ext}`;

  const a = document.createElement('a');
  a.href = src;
  a.download = defaultName;
  a.click();
  releaseInputShield();
  ExportDebug.end(dbg, { saved: true, method: 'download' });
}

function exportResolveConcurrency() {
  return 3;
}

// Resolves a list of image objects to img_keys for native folder export.
// Transformed native images stay in Rust: the existing cached source is decoded,
// transformed into a temp cache key, and saved by key without JS base64/canvas IPC.
async function resolveExportKeys(imageObjs, dbg, onProgress = null) {
  const nativeConcurrency = exportResolveConcurrency();
  const exportRunToken = `${Date.now().toString(36)}_${Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0')}`;
  let processed = 0;
  let keyCount = 0;
  let renderedCount = 0;
  ExportDebug.recordResolveStart({
    imageCount: imageObjs.length,
    concurrency: nativeConcurrency,
    hardwareConcurrency: navigator.hardwareConcurrency || '',
  });

  const results = await mapWithConcurrency(imageObjs, nativeConcurrency, async (obj, index) => {
    const imgKey = obj.data?.imgKey;
    const progress = async (meta = {}) => {
      processed++;
      ExportDebug.recordResolveProgress({
        processed,
        imageCount: imageObjs.length,
        keyCount,
        renderedCount,
        concurrency: nativeConcurrency,
        ...meta,
      });
      if (onProgress) {
        onProgress({
          phase: 'prepare-progress',
          preparedCount: processed,
          totalCount: imageObjs.length,
        });
      }
      if (processed === 1 || processed % 10 === 0 || processed === imageObjs.length) {
        ExportDebug.step(dbg, 'keys:progress', {
          processed,
          imageCount: imageObjs.length,
          keyCount,
          renderedCount,
          concurrency: nativeConcurrency,
          ...meta,
        });
      }
      if (processed % 3 === 0 || processed === imageObjs.length) await BoardfishExportUtils.delay(0);
    };

    if (!imageNeedsRendering(obj)) {
      const itemStart = performance.now();
      await cacheImageSourceForExport(imgKey, BoardfishImageStore.getSource(imgKey), dbg);
      keyCount++;
      ExportDebug.recordResolve({
        index,
        objectId: obj.id,
        imgKey,
        key: imgKey,
        ms: performance.now() - itemStart,
        phase: 'passthrough',
      });
      await progress({ index, imgKey, nativeTransform: false });
      return { key: imgKey, tempKey: null, rendered: false };
    }

    const tempKey = `__export_tmp_${exportRunToken}_${index}_${obj.id}`;
    if (hasTauri() && isNativeImageRef(BoardfishImageStore.getSource(imgKey))) {
      const nativeStart = performance.now();
      const sourceToken = createImageSourceToken(tempKey);
      try {
        const result = await ExportDebug.wrap(
          dbg,
          TAURI_COMMANDS.REGISTER_TRANSFORMED_IMAGE_SOURCE,
          () => BoardfishTauri.registerTransformedImageSource({
            imgKey,
            tempKey,
            ...imageTransformFromObject(obj),
            sourceToken,
          }),
          {
            imgKey,
            tempKey,
            ...imageTransformFromObject(obj),
          }
        );
        keyCount++;
        renderedCount++;
        ExportDebug.recordResolve({
          index,
          objectId: obj.id,
          imgKey,
          key: tempKey,
          tempKey,
          rendered: true,
          nativeTransform: true,
          phase: 'native-transform',
          ms: performance.now() - nativeStart,
        });
        ExportDebug.step(dbg, 'native-transform-image', {
          index,
          imgKey,
          tempKey,
          ms: performance.now() - nativeStart,
          bytesMB: result?.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : '',
          width: result?.width ?? '',
          height: result?.height ?? '',
          decodeMs: result?.decodeMs ?? '',
          transformMs: result?.transformMs ?? '',
          encodeMs: result?.encodeMs ?? '',
        });
        await progress({ index, imgKey, nativeTransform: true });
        return { key: tempKey, tempKey, rendered: true };
      } catch (err) {
        ExportDebug.step(dbg, 'native-transform-image:error', { index, imgKey, tempKey, ms: performance.now() - nativeStart, error: String(err) });
      }
    }

    const renderStart = performance.now();
    try {
      const dataUrl = await getRenderedImageDataUrl(obj, dbg);
      ExportDebug.step(dbg, 'rendered-image', { imgKey, ms: performance.now() - renderStart, hasDataUrl: !!dataUrl, dataUrlLen: dataUrl?.length || 0 });
      if (!dataUrl) {
        ExportDebug.recordResolve({
          index,
          objectId: obj.id,
          imgKey,
          fallbackRender: true,
          skipped: true,
          phase: 'fallback-render',
          ms: performance.now() - renderStart,
          error: 'render returned empty data URL',
        });
        await progress({ index, imgKey, fallbackRender: true, skipped: true });
        return null;
      }
      const sourceToken = createImageSourceToken(tempKey);
      await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.REGISTER_IMAGE_SOURCE,
        () => BoardfishTauri.registerImageSource(tempKey, dataUrl, sourceToken),
        { imgKey: tempKey, dataUrlLen: dataUrl.length }
      );
      keyCount++;
      renderedCount++;
      ExportDebug.recordResolve({
        index,
        objectId: obj.id,
        imgKey,
        key: tempKey,
        tempKey,
        rendered: true,
        fallbackRender: true,
        phase: 'fallback-render',
        ms: performance.now() - renderStart,
      });
      await progress({ index, imgKey, fallbackRender: true });
      return { key: tempKey, tempKey, rendered: true };
    } catch (err) {
      ExportDebug.step(dbg, 'rendered-image:error', { imgKey, ms: performance.now() - renderStart, error: String(err) });
      ExportDebug.recordResolve({
        index,
        objectId: obj.id,
        imgKey,
        fallbackRender: true,
        phase: 'fallback-render',
        ms: performance.now() - renderStart,
        error: String(err),
      });
      await progress({ index, imgKey, fallbackRender: true, error: String(err) });
      return null;
    }
  });

  const keys = results.map(r => r?.key).filter(Boolean);
  const tempKeys = results.map(r => r?.tempKey).filter(Boolean);
  const finalRenderedCount = results.filter(r => r?.rendered).length;
  ExportDebug.recordResolveDone({
    processed,
    imageCount: imageObjs.length,
    keyCount: keys.length,
    tempKeyCount: tempKeys.length,
    renderedCount: finalRenderedCount,
  });
  return { keys, tempKeys, renderedCount: finalRenderedCount };
}

async function pickExportFolder(dbg) {
  const stopWatch = ExportDebug.watch(dbg, 'pick-folder');
  try {
    const folder = await ExportDebug.wrap(dbg, TAURI_COMMANDS.PICK_FOLDER, () => BoardfishTauri.pickFolder(), {});
    stopWatch({ picked: !!folder });
    return folder;
  } catch (err) {
    stopWatch({ error: String(err) });
    throw err;
  }
}

async function saveExportKeysToFolderInBatches(folder, keys, dbg, batchSize = 3, onProgress = null) {
  const stopWatch = ExportDebug.watch(dbg, 'save-batches', { keyCount: keys.length, batchSize });
  ExportDebug.recordSaveStart({ keyCount: keys.length, batchSize, batchCount: Math.ceil(keys.length / batchSize) });
  let savedCount = 0;
  let failedCount = 0;
  let missingCount = 0;
  let bytes = 0;
  const errors = [];
  try {
    for (let start = 0; start < keys.length; start += batchSize) {
      const batch = keys.slice(start, start + batchSize);
      const batchIndex = Math.floor(start / batchSize) + 1;
      const batchCount = Math.ceil(keys.length / batchSize);
      ExportDebug.step(dbg, 'save:batch-start', {
        batchIndex,
        batchCount,
        processed: start,
        keyCount: keys.length,
        batchSize: batch.length,
      });
      const batchStart = performance.now();
      const result = await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.SAVE_IMAGES_TO_EXISTING_FOLDER_BY_KEYS,
        () => BoardfishTauri.saveImagesToExistingFolderByKeys(folder, batch),
        { keyCount: batch.length, batchIndex, batchCount }
      );
      const normalized = BoardfishExportUtils.normalizeSaveResult(result);
      savedCount += normalized.savedCount || 0;
      failedCount += normalized.failedCount || 0;
      missingCount += normalized.missingCount || 0;
      bytes += result?.bytes || 0;
      if (normalized.error) errors.push(normalized.error);
      ExportDebug.step(dbg, 'save:batch-result', {
        batchIndex,
        batchCount,
        processed: Math.min(start + batch.length, keys.length),
        keyCount: keys.length,
        ...normalized,
      });
      ExportDebug.recordSaveBatch({
        batchIndex,
        batchCount,
        batchSize: batch.length,
        keyCount: batch.length,
        ms: performance.now() - batchStart,
        ...normalized,
      });
      if (onProgress) {
        onProgress({
          finishedCount: savedCount + failedCount + missingCount,
          savedCount,
          failedCount,
          missingCount,
          totalCount: keys.length,
          batchIndex,
          batchCount,
        });
      }
    }
  } finally {
    stopWatch({ savedCount, failedCount, missingCount, bytesMB: Math.round(bytes / 1024 / 1024 * 100) / 100 });
    ExportDebug.recordSaveDone({ savedCount, failedCount, missingCount, bytesMB: Math.round(bytes / 1024 / 1024 * 100) / 100 });
  }
  return {
    savedCount,
    failedCount,
    missingCount,
    bytes,
    errors,
  };
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

  if (hasTauri()) {
    let tempKeys = [];
    let busyPill = null;
    try {
      const folder = await pickExportFolder(dbg);
      ExportDebug.step(dbg, 'folder:selected', { folder });
      if (!folder) { hideInputShield(); stopTotalWatch({ cancelled: true }); ExportDebug.end(dbg, { savedCount: 0, cancelled: true }); return; }
      busyPill = startPillTask({ message: `0/${imageObjs.length}`, progress: true });
      const updateProgress = BoardfishExportUtils.createProgressUpdater(imageObjs.length, busyPill);
      await BoardfishExportUtils.letUiPaint(dbg, 'before-resolve-keys');
      const stopResolveWatch = ExportDebug.watch(dbg, 'resolve-keys', { imageCount: imageObjs.length });
      const resolved = await resolveExportKeys(imageObjs, dbg, ({ preparedCount }) => {
        updateProgress('prepare-progress', preparedCount);
      }).finally(() => stopResolveWatch());
      const keys = resolved.keys;
      tempKeys = resolved.tempKeys;
      ExportDebug.step(dbg, 'keys:ready', { keyCount: keys.length, tempKeyCount: tempKeys.length, renderedCount: resolved.renderedCount });
      if (!keys.length) {
        finishPillTask({ beforeFinish: hideInputShield, busyPill });
        stopTotalWatch({ skipped: true });
        ExportDebug.end(dbg, { skipped: true, reason: 'no-keys' });
        return;
      }
      updateProgress('save-start', imageObjs.length, {}, true);
      const saveResult = await saveExportKeysToFolderInBatches(folder, keys, dbg, 3, ({ finishedCount, totalCount, batchIndex, batchCount }) => {
        updateProgress('save-progress', imageObjs.length, { batchIndex, batchCount, savedKeyCount: finishedCount, keyCount: totalCount });
      });
      const savedCount = typeof saveResult === 'number' ? saveResult : (saveResult?.savedCount || 0);
      ExportDebug.step(dbg, 'save:result', BoardfishExportUtils.normalizeSaveResult(saveResult));
      stopTotalWatch({ savedCount });
      ExportDebug.end(dbg, { savedCount, ...BoardfishExportUtils.normalizeSaveResult(saveResult) });
      if (savedCount > 0) {
        finishPillTask({
          beforeFinish: () => BoardfishExportUtils.finishImageExportInputShield(clearSelectionAfter),
          busyPill,
          finalMsg: savedCount === 1 ? '1 Image Exported' : `${savedCount} Images Exported`,
        });
      }
      else {
        finishPillTask({ beforeFinish: hideInputShield, busyPill });
      }
    } catch (err) {
      if (busyPill) finishPillTask({ beforeFinish: hideInputShield, busyPill });
      else hideInputShield();
      stopTotalWatch({ error: String(err) });
      ExportDebug.end(dbg, { error: String(err) });
      console.error(errorLabel, err);
    } finally {
      await BoardfishExportUtils.cleanupTempKeys(tempKeys);
    }
    return;
  }

  await BoardfishExportUtils.downloadImageObjects(imageObjs, dbg);
  stopTotalWatch({ saved: true, method: 'download' });
  ExportDebug.end(dbg, { saved: true, method: 'download', imageCount: imageObjs.length });
  BoardfishExportUtils.finishImageExportInputShield(clearSelectionAfter && imageObjs.length);
}

async function saveSelectedImages() {
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

async function exportAllImages() {
  deselectAll();
  const imageObjs = [...objects].sort((a, b) => b.z - a.z).filter((o) => o.type === 'image');
  return exportImageBatch({
    op: 'exportAllImages',
    mode: 'all',
    imageObjs,
    startMeta: { objectCount: objects.length },
    skipMeta: imageObjs.length ? null : { reason: 'no-images' },
    errorLabel: 'Export all images failed:',
    clearSelectionAfter: true,
  });
}
