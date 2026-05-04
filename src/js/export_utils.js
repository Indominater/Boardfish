'use strict';

(function initExportUtils(root) {
  function guessImageExtFromDataUrl(dataUrl) {
    if (dataUrl.startsWith('data:image/jpeg')) return 'jpg';
    return 'png';
  }

  function guessImageExtForObjectExport(obj) {
    if (imageNeedsRendering(obj)) return 'png';
    const src = BoardfishImageStore.getSource(obj?.data?.imgKey);
    if (isNativeImageRef(src)) return src.ext === 'jpeg' ? 'jpg' : (src.ext || 'png');
    if (typeof src === 'string') return guessImageExtFromDataUrl(src);
    return 'png';
  }

  function randomHex() {
    return Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  }

  function progressText(totalCount, preparedCount) {
    const n = Math.max(1, Number(totalCount) || 1);
    const value = Math.max(0, Math.min(n, Number(preparedCount) || 0));
    return `${value}/${n}`;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function nextAnimationFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  async function letUiPaint(dbg, phase) {
    const t0 = performance.now();
    ExportDebug.step(dbg, 'ui:paint-wait:start', { phase });
    await nextAnimationFrame();
    await nextAnimationFrame();
    ExportDebug.step(dbg, 'ui:paint-wait:end', { phase, ms: performance.now() - t0 });
  }

  function createProgressUpdater(totalCount, busyPill) {
    let currentProgressText = progressText(totalCount, 0);
    ExportDebug.recordProgressUi({
      phase: 'resolve-start',
      text: currentProgressText,
      finishedCount: 0,
      preparedCount: 0,
      totalCount,
    });

    return (phase, preparedCount, extra = {}, force = false) => {
      const text = progressText(totalCount, preparedCount);
      if (!force && text === currentProgressText) return;
      currentProgressText = text;
      updatePillTask(busyPill, text);
      ExportDebug.recordProgressUi({
        phase,
        text,
        finishedCount: Number(text.split('/')[0]) || 0,
        preparedCount,
        totalCount,
        ...extra,
      });
    };
  }

  function cleanupTempKeys(tempKeys) {
    if (!tempKeys?.length || !hasTauri()) return;
    BoardfishTauri.removeCachedImageSources(tempKeys)
      .catch((err) => console.warn('[export] remove_cached_image_sources failed:', err));
  }

  function normalizeSaveResult(result) {
    if (!result || typeof result === 'number') return { savedCount: result || 0 };
    return {
      savedCount: result.savedCount ?? result.saved_count ?? 0,
      failedCount: result.failedCount ?? result.failed_count ?? 0,
      missingCount: result.missingCount ?? result.missing_count ?? 0,
      bytesMB: result.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : 0,
      error: result.errors?.length ? result.errors.slice(0, 3).join(' | ') : '',
    };
  }

  async function downloadImageObjects(imageObjs, dbg) {
    for (let i = 0; i < imageObjs.length; i++) {
      const src = await getRenderedImageDataUrl(imageObjs[i], dbg);
      if (!src) continue;
      const ext = guessImageExtFromDataUrl(src);
      const a = document.createElement('a');
      a.href = src;
      a.download = `image_${i + 1}.${ext}`;
      a.click();
    }
  }

  function selectedImageObjects() {
    const selectedObjs = [];
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (obj?.type === 'image') selectedObjs.push(obj);
    }
    return selectedObjs;
  }

  function finishImageExportInputShield(clearSelection) {
    hideInputShield();
    if (clearSelection) deselectAll();
  }

  root.BoardfishExportUtils = Object.freeze({
    cleanupTempKeys,
    createProgressUpdater,
    delay,
    downloadImageObjects,
    finishImageExportInputShield,
    guessImageExtForObjectExport,
    guessImageExtFromDataUrl,
    normalizeSaveResult,
    randomHex,
    selectedImageObjects,
    letUiPaint,
  });
})(typeof window !== 'undefined' ? window : globalThis);
