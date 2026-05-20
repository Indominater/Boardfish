'use strict';

async function saveSelectedImage() {
  const dbg = ExportDebug.start('exportImage', { selectedCount: selectedIds.size });
  globalThis.BoardfishMotion?.applyActionAnimation?.('export-selected-image');
  const imageObjs = BoardfishExportUtils.selectedImageObjects();
  if (imageObjs.length !== 1) { ExportDebug.end(dbg, { skipped: true, imageCount: imageObjs.length }); return; }
  ExportDebug.startMassive('exportImage', imageObjs);
  const obj = imageObjs[0];
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  if (hasTauri()) {
    let tempKeys = [];
    let busyPill = null;
    try {
      const ext = BoardfishExportUtils.guessImageExtForObjectExport(obj);
      const hex = BoardfishExportUtils.randomHex();
      const defaultName = `image_${hex}.${ext}`;
      const path = await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.SAVE_IMAGE_FILE_DIALOG,
        () => BoardfishTauri.saveImageFileDialog(defaultName),
        { defaultName }
      );
      ExportDebug.step(dbg, 'image:path-selected', { selected: !!path });
      if (!path) {
        globalThis.BoardfishMotion?.applyActionAnimation?.('file-dialog-cancel');
        releaseInputShield();
        ExportDebug.end(dbg, { saved: false, cancelled: true });
        return;
      }

      busyPill = startPillTask({ message: '0/1', progress: true });
      const updateProgress = BoardfishExportUtils.createProgressUpdater(1, busyPill);
      await BoardfishExportUtils.letUiPaint(dbg, 'before-resolve-key');
      ExportDebug.step(dbg, 'keys:resolve-start', { imageCount: 1, defaultName });
      const resolved = await resolveExportKeys([obj], dbg, ({ preparedCount }) => {
        updateProgress('prepare-progress', preparedCount);
      });
      tempKeys = resolved.tempKeys;
      const key = resolved.keys[0];
      ExportDebug.step(dbg, 'keys:ready', { keyCount: resolved.keys.length, tempKeyCount: tempKeys.length, renderedCount: resolved.renderedCount });
      if (!key) {
        finishPillTask({ beforeFinish: releaseInputShield, busyPill });
        ExportDebug.end(dbg, { skipped: true, reason: 'no-key' });
        return;
      }

      updateProgress('save-start', 1, {}, true);
      const result = await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.WRITE_IMAGE_FILE_BY_KEY,
        () => BoardfishTauri.writeImageFileByKey(path, key),
        { imgKey: key, path }
      );
      updateProgress('save-progress', 1, { finishedCount: 1, totalCount: 1 }, true);
      ExportDebug.end(dbg, { saved: true, bytesMB: result?.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : 0 });
      finishPillTask({ beforeFinish: releaseInputShield, busyPill, finalMsg: 'Image Exported' });
    } catch (err) {
      if (busyPill) finishPillTask({ beforeFinish: releaseInputShield, busyPill });
      else releaseInputShield();
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Save image failed:', err);
    } finally {
      await BoardfishExportUtils.cleanupTempKeys(tempKeys);
    }
    return;
  }

  const ext = BoardfishExportUtils.guessImageExtForObjectExport(obj);
  const hex = BoardfishExportUtils.randomHex();
  const defaultName = `image_${hex}.${ext}`;

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

function exportResolveConcurrency() {
  return 3;
}

const exportSaveBatchSize = (keyCount) => {
  if (keyCount >= 80) return 8;
  if (keyCount >= 24) return 6;
  return 3;
};

const exportSourceKind = (src) => {
  if (isNativeImageRef(src)) return 'native-ref';
  if (typeof isWebImageRef === 'function' && isWebImageRef(src)) return 'web-ref';
  if (typeof src === 'string') return src.startsWith('data:') ? 'data-url' : 'string';
  if (!src) return 'missing';
  return typeof src;
};

const exportTransformSignature = (obj) => {
  const transform = imageTransformFromObject(obj);
  return [
    obj?.data?.imgKey || '',
    transform.flipX ? 1 : 0,
    transform.flipY ? 1 : 0,
    normalizeRotation(transform.rotation),
  ].join(':');
};

// Resolves a list of image objects to img_keys for native folder export.
// Transformed native images stay in Rust: the existing cached source is decoded,
// transformed into a temp cache key, and saved by key without JS base64/canvas IPC.
async function resolveExportKeys(imageObjs, dbg, onProgress = null) {
  const nativeConcurrency = exportResolveConcurrency();
  const exportRunToken = `${Date.now().toString(36)}_${Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0')}`;
  const resolvePromises = new Map();
  let processed = 0;
  let keyCount = 0;
  let renderedCount = 0;
  ExportDebug.recordResolveStart({
    imageCount: imageObjs.length,
    concurrency: nativeConcurrency,
    hardwareConcurrency: navigator.hardwareConcurrency || '',
  });

  const noteProgress = async (meta = {}) => {
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
    if (processed % 3 === 0 || processed === imageObjs.length) {
      await BoardfishExportUtils.yieldToEventLoop(dbg, 'resolve-keys', { processed, imageCount: imageObjs.length });
    }
  };

  const recordResolvedObject = async (obj, index, result, meta = {}) => {
    if (result?.key) keyCount++;
    if (result?.rendered) renderedCount++;
    ExportDebug.recordResolve({
      index,
      objectId: obj?.id || '',
      imgKey: obj?.data?.imgKey || '',
      key: result?.key || '',
      tempKey: result?.tempKey || '',
      rendered: !!result?.rendered,
      nativeTransform: !!result?.nativeTransform,
      fallbackRender: !!result?.fallbackRender,
      phase: meta.phase || result?.phase || '',
      sourceKind: result?.sourceKind || meta.sourceKind || '',
      bytesMB: result?.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : '',
      ms: meta.ms,
      deduped: !!meta.deduped,
      reusedTempKey: !!meta.reusedTempKey,
      skipped: !!result?.skipped,
      error: result?.error || '',
    });
    await noteProgress({
      index,
      imgKey: obj?.data?.imgKey,
      phase: meta.phase || result?.phase,
      deduped: !!meta.deduped,
      nativeTransform: !!result?.nativeTransform,
      fallbackRender: !!result?.fallbackRender,
      skipped: !!result?.skipped,
    });
  };

  const resolveUniqueObject = async (obj, index) => {
    const imgKey = obj?.data?.imgKey;
    const source = BoardfishImageStore.getSource(imgKey);
    const sourceKind = exportSourceKind(source);
    if (!imgKey || !source) {
      return {
        key: '',
        tempKey: null,
        rendered: false,
        skipped: true,
        phase: 'missing-source',
        sourceKind,
        error: !imgKey ? 'missing imgKey' : 'missing image source',
      };
    }

    if (!imageNeedsRendering(obj)) {
      const itemStart = performance.now();
      await cacheImageSourceForExport(imgKey, source, dbg);
      return {
        key: imgKey,
        tempKey: null,
        rendered: false,
        nativeTransform: false,
        fallbackRender: false,
        phase: 'passthrough',
        sourceKind,
        ms: performance.now() - itemStart,
      };
    }

    const tempKey = `__export_tmp_${exportRunToken}_${index}_${obj.id}`;
    if (hasTauri() && isNativeImageRef(source)) {
      const nativeStart = performance.now();
      const transform = imageTransformFromObject(obj);
      const sourceToken = createImageSourceToken(tempKey);
      try {
        const result = await ExportDebug.wrap(
          dbg,
          TAURI_COMMANDS.REGISTER_TRANSFORMED_IMAGE_SOURCE,
          () => BoardfishTauri.registerTransformedImageSource({
            imgKey,
            tempKey,
            ...transform,
            sourceToken,
          }),
          {
            imgKey,
            tempKey,
            ...transform,
          }
        );
        const ms = performance.now() - nativeStart;
        ExportDebug.step(dbg, 'native-transform-image', {
          index,
          imgKey,
          tempKey,
          ms,
          bytesMB: result?.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : '',
          width: result?.width ?? '',
          height: result?.height ?? '',
          decodeMs: result?.decodeMs ?? '',
          transformMs: result?.transformMs ?? '',
          encodeMs: result?.encodeMs ?? '',
          totalMs: result?.totalMs ?? '',
        });
        return {
          key: tempKey,
          tempKey,
          rendered: true,
          nativeTransform: true,
          fallbackRender: false,
          phase: 'native-transform',
          sourceKind,
          bytes: result?.bytes || 0,
          ms,
        };
      } catch (err) {
        ExportDebug.step(dbg, 'native-transform-image:error', { index, imgKey, tempKey, ms: performance.now() - nativeStart, error: String(err) });
      }
    }

    const renderStart = performance.now();
    try {
      const dataUrl = await getRenderedImageDataUrl(obj, dbg);
      ExportDebug.step(dbg, 'rendered-image', { imgKey, ms: performance.now() - renderStart, hasDataUrl: !!dataUrl, dataUrlLen: dataUrl?.length || 0 });
      if (!dataUrl) {
        return {
          key: '',
          tempKey: null,
          rendered: false,
          fallbackRender: true,
          skipped: true,
          phase: 'fallback-render',
          sourceKind,
          ms: performance.now() - renderStart,
          error: 'render returned empty data URL',
        };
      }
      const sourceToken = createImageSourceToken(tempKey);
      const registerResult = await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.REGISTER_IMAGE_SOURCE,
        () => BoardfishTauri.registerImageSource(tempKey, dataUrl, sourceToken),
        { imgKey: tempKey, dataUrlLen: dataUrl.length }
      );
      return {
        key: tempKey,
        tempKey,
        rendered: true,
        nativeTransform: false,
        fallbackRender: true,
        phase: 'fallback-render',
        sourceKind,
        bytes: registerResult?.bytes || 0,
        ms: performance.now() - renderStart,
      };
    } catch (err) {
      ExportDebug.step(dbg, 'rendered-image:error', { imgKey, ms: performance.now() - renderStart, error: String(err) });
      return {
        key: '',
        tempKey: null,
        rendered: false,
        fallbackRender: true,
        phase: 'fallback-render',
        sourceKind,
        ms: performance.now() - renderStart,
        error: String(err),
      };
    }
  };

  const results = await mapWithConcurrency(imageObjs, nativeConcurrency, async (obj, index) => {
    const imgKey = obj.data?.imgKey;
    const source = BoardfishImageStore.getSource(imgKey);
    const dedupeKey = imageNeedsRendering(obj)
      ? `render:${exportTransformSignature(obj)}`
      : `passthrough:${imgKey || ''}:${exportSourceKind(source)}`;
    const itemStart = performance.now();
    const existing = resolvePromises.get(dedupeKey);
    if (existing) {
      const result = await existing;
      const reused = result ? { ...result } : null;
      await recordResolvedObject(obj, index, reused, {
        ms: performance.now() - itemStart,
        deduped: true,
        reusedTempKey: !!reused?.tempKey,
        phase: reused?.phase ? `${reused.phase}:deduped` : 'deduped',
      });
      return reused;
    }

    const promise = resolveUniqueObject(obj, index);
    resolvePromises.set(dedupeKey, promise);
    const result = await promise;
    if (result?.ms == null) result.ms = performance.now() - itemStart;
    await recordResolvedObject(obj, index, result, { ms: result?.ms });
    return result;
  });

  const keys = [];
  const tempKeySet = new Set();
  let finalRenderedCount = 0;
  for (const result of results) {
    if (result?.key) keys.push(result.key);
    if (result?.tempKey) tempKeySet.add(result.tempKey);
    if (result?.rendered) finalRenderedCount++;
  }
  const tempKeys = [...tempKeySet];
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
  const batchCount = Math.ceil(keys.length / batchSize);
  ExportDebug.recordSaveStart({ keyCount: keys.length, batchSize, batchCount });
  let savedCount = 0;
  let failedCount = 0;
  let missingCount = 0;
  let bytes = 0;
  const errors = [];
  try {
    for (let start = 0; start < keys.length; start += batchSize) {
      const batch = keys.slice(start, start + batchSize);
      const batchIndex = Math.floor(start / batchSize) + 1;
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
      const saveBatchSize = exportSaveBatchSize(keys.length);
      ExportDebug.step(dbg, 'save:batch-plan', { keyCount: keys.length, batchSize: saveBatchSize });
      const saveResult = await saveExportKeysToFolderInBatches(folder, keys, dbg, saveBatchSize, ({ finishedCount, totalCount, batchIndex, batchCount }) => {
        updateProgress('save-progress', imageObjs.length, { batchIndex, batchCount, savedKeyCount: finishedCount, keyCount: totalCount });
      });
      const savedCount = typeof saveResult === 'number' ? saveResult : (saveResult?.savedCount || 0);
      const normalizedSaveResult = BoardfishExportUtils.normalizeSaveResult(saveResult);
      ExportDebug.step(dbg, 'save:result', normalizedSaveResult);
      stopTotalWatch({ savedCount });
      ExportDebug.end(dbg, { savedCount, ...normalizedSaveResult });
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

async function exportAllImages() {
  globalThis.BoardfishMotion?.applyActionAnimation?.('export-all-images');
  deselectAll();
  const imageObjs = objects.filter((o) => o.type === 'image').sort((a, b) => b.z - a.z);
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
