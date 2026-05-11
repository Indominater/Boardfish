'use strict';

(function initExportUtils(root) {
  function guessImageExtFromDataUrl(dataUrl) {
    return extForMime(dataUrlMime(dataUrl));
  }

  function guessImageExtForObjectExport(obj) {
    if (imageNeedsRendering(obj)) return 'png';
    const src = BoardfishImageStore.getSource(obj?.data?.imgKey);
    if (isNativeImageRef(src)) return src.ext === 'jpeg' ? 'jpg' : (src.ext || 'png');
    if (typeof isWebImageRef === 'function' && isWebImageRef(src)) return src.ext === 'jpeg' ? 'jpg' : (src.ext || 'png');
    if (typeof src === 'string') return guessImageExtFromDataUrl(src);
    return 'png';
  }

  function randomHex() {
    return Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  }

  function uniqueImageExportName(obj, usedNames = new Set()) {
    const ext = guessImageExtForObjectExport(obj);
    for (let i = 0; i < 1000; i++) {
      const name = `image_${randomHex()}.${ext}`;
      const key = name.toLowerCase();
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return name;
      }
    }
    const fallback = `image_${Date.now().toString(36)}.${ext}`;
    usedNames.add(fallback.toLowerCase());
    return fallback;
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
    if (!tempKeys?.length || !hasTauri()) return Promise.resolve(0);
    return BoardfishTauri.removeCachedImageSources(tempKeys)
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

  async function imageObjectDownloadEntry(obj, index, dbg, options = {}) {
    const name = options.filename || `image_${index + 1}.${guessImageExtForObjectExport(obj)}`;
    const source = BoardfishImageStore.getSource(obj?.data?.imgKey);
    if (!imageNeedsRendering(obj)) {
      const sourceEntry = imageSourceDownloadEntry(source, name);
      if (sourceEntry) return sourceEntry;
    }

    let data = null;
    let width = 0;
    let height = 0;
    const canvas = renderImageToCanvas(obj);
    if (canvas) {
      const blob = await canvasToPngBlob(canvas);
      if (!blob) return null;
      data = new Uint8Array(await blob.arrayBuffer());
      width = canvas.width;
      height = canvas.height;
    } else {
      const dataUrl = await getRenderedImageDataUrl(obj, dbg);
      if (!dataUrl || !root.BoardfishWebBoardContainer?.dataUrlToBytes) return null;
      data = root.BoardfishWebBoardContainer.dataUrlToBytes(dataUrl);
    }
    ExportDebug.step(dbg, 'web-export:rendered-blob', {
      imgKey: obj?.data?.imgKey,
      bytes: data.length,
      width,
      height,
      format: 'lossless-png',
    });
    return {
      name: options.filename || `image_${index + 1}.png`,
      data,
      mime: 'image/png',
    };
  }

  function imageSourceDownloadEntry(source, name) {
    if (typeof isWebImageRef === 'function' && isWebImageRef(source) && root.BoardfishWebBoardContainer?.bytesForImageSource) {
      try {
        const data = root.BoardfishWebBoardContainer.bytesForImageSource(source);
        const ext = source.ext === 'jpeg' ? 'jpg' : (source.ext || 'png');
        return {
          name: withImageExtension(name, ext),
          data,
          mime: source.mime || mimeForImageExt(ext),
        };
      } catch (_) {}
    }
    if (typeof source === 'string' && source.startsWith('data:') && root.BoardfishWebBoardContainer?.dataUrlToBytes) {
      const ext = guessImageExtFromDataUrl(source);
      return {
        name: withImageExtension(name, ext),
        data: root.BoardfishWebBoardContainer.dataUrlToBytes(source),
        mime: dataUrlMime(source),
      };
    }
    return null;
  }

  async function downloadImageObjects(imageObjs, dbg, options = {}) {
    const canZip = imageObjs.length > 1 && !!root.BoardfishWebBoardContainer?.createZip;
    const target = await pickWebExportTarget(imageObjs, options);
    if (target?.cancelled) return { downloadedCount: 0, skippedCount: 0, method: 'picker', cancelled: true };
    if (typeof options.onStart === 'function') options.onStart({ totalCount: imageObjs.length, target });

    if (target?.directoryHandle) {
      return saveImageObjectsToDirectory(imageObjs, target.directoryHandle, dbg, options);
    }

    const downloads = [];
    const usedNames = new Set();
    let skippedCount = 0;
    for (let i = 0; i < imageObjs.length; i++) {
      const entry = await imageObjectDownloadEntry(imageObjs[i], i, dbg, {
        filename: imageObjs.length === 1 ? options.filename : uniqueImageExportName(imageObjs[i], usedNames),
      });
      if (!entry) {
        skippedCount++;
        continue;
      }
      downloads.push(entry);
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          phase: 'prepare-progress',
          preparedCount: downloads.length,
          totalCount: imageObjs.length,
        });
      }
      if (i % 2 === 1 || i === imageObjs.length - 1) await delay(0);
    }

    if (!downloads.length) return { downloadedCount: 0, skippedCount, method: 'none' };

    if (downloads.length === 1 || !canZip) {
      const item = downloads[0];
      const blob = new Blob([item.data], { type: item.mime || 'image/png' });
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length, force: true });
      }
      await saveExportBlob(blob, target, item.name);
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-progress', preparedCount: downloads.length, finishedCount: downloads.length, totalCount: imageObjs.length, force: true });
      }
      return { downloadedCount: downloads.length, skippedCount, method: target?.handle ? 'file-picker' : 'download' };
    }

    const zipEntries = downloads.map((item) => ({
      name: item.name,
      data: item.data,
    }));
    await delay(0);
    const zipBytes = root.BoardfishWebBoardContainer.createZip(zipEntries);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const filename = target?.filename || `images_${randomHex()}.zip`;
    if (typeof options.onProgress === 'function') {
      options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length, force: true });
    }
    await saveExportBlob(blob, target, filename);
    if (typeof options.onProgress === 'function') {
      options.onProgress({ phase: 'save-progress', preparedCount: downloads.length, finishedCount: downloads.length, totalCount: imageObjs.length, force: true });
    }
    return {
      downloadedCount: downloads.length,
      skippedCount,
      method: target?.handle ? 'zip-file-picker' : 'zip',
      filename,
      bytes: zipBytes.length,
    };
  }

  async function pickWebExportTarget(imageObjs, options = {}) {
    const mode = options.targetMode || 'auto';
    if (mode === 'folder') {
      const folderTarget = await pickWebExportDirectory();
      if (folderTarget) return folderTarget;
    }
    if (mode === 'folder-only' || typeof root.showSaveFilePicker !== 'function') return null;
    const single = imageObjs.length === 1;
    const ext = single ? guessImageExtForObjectExport(imageObjs[0]) : 'zip';
    const mime = single ? mimeForImageExt(ext) : 'application/zip';
    const filename = single
      ? withImageExtension(options.filename || `image_${randomHex()}.${ext}`, ext)
      : (options.filename || `images_${randomHex()}.zip`);
    try {
      const handle = await root.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: single ? 'Image' : 'ZIP archive',
          accept: { [mime]: [`.${ext}`] },
        }],
        excludeAcceptAllOption: false,
      });
      return handle ? { handle, filename } : { cancelled: true };
    } catch (err) {
      if (err?.name === 'AbortError') return { cancelled: true };
      console.warn('[export] save picker failed; falling back to browser download.', err);
      return null;
    }
  }

  async function pickWebExportDirectory() {
    if (typeof root.showDirectoryPicker !== 'function') return null;
    try {
      const handle = await root.showDirectoryPicker({ mode: 'readwrite' });
      return handle ? { directoryHandle: handle, filename: '', method: 'directory-picker' } : { cancelled: true };
    } catch (err) {
      if (err?.name === 'AbortError') return { cancelled: true };
      console.warn('[export] directory picker failed; falling back to file download.', err);
      return null;
    }
  }

  async function ensureDirectoryWritePermission(handle) {
    if (!handle?.queryPermission || !handle?.requestPermission) return true;
    const options = { mode: 'readwrite' };
    if ((await handle.queryPermission(options)) === 'granted') return true;
    return (await handle.requestPermission(options)) === 'granted';
  }

  async function writeEntryToDirectory(directoryHandle, entry) {
    if (!(await ensureDirectoryWritePermission(directoryHandle))) {
      throw new Error('write permission was not granted');
    }
    const fileHandle = await directoryHandle.getFileHandle(entry.name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(new Blob([entry.data], { type: entry.mime || 'image/png' }));
    } finally {
      await writable.close();
    }
    return entry.data?.length || 0;
  }

  async function saveImageObjectsToDirectory(imageObjs, directoryHandle, dbg, options = {}) {
    const usedNames = new Set();
    let savedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let bytes = 0;
    const errors = [];
    ExportDebug.recordSaveStart({ keyCount: imageObjs.length, batchSize: 1, batchCount: imageObjs.length, method: 'directory-picker' });
    for (let i = 0; i < imageObjs.length; i++) {
      const name = uniqueImageExportName(imageObjs[i], usedNames);
      const entry = await imageObjectDownloadEntry(imageObjs[i], i, dbg, { filename: name });
      if (!entry) {
        skippedCount++;
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            phase: 'prepare-progress',
            preparedCount: savedCount + failedCount + skippedCount,
            totalCount: imageObjs.length,
          });
        }
        continue;
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          phase: 'prepare-progress',
          preparedCount: savedCount + failedCount + skippedCount + 1,
          totalCount: imageObjs.length,
        });
      }
      const writeStart = performance.now();
      let batchSaved = 0;
      let batchFailed = 0;
      try {
        const written = await writeEntryToDirectory(directoryHandle, entry);
        savedCount++;
        batchSaved = 1;
        bytes += written;
        ExportDebug.step(dbg, 'web-export:folder-write', { name: entry.name, bytes: written });
      } catch (err) {
        failedCount++;
        batchFailed = 1;
        if (errors.length < 10) errors.push(`${entry.name}: ${err?.message || err}`);
        ExportDebug.step(dbg, 'web-export:folder-write-error', { name: entry.name, error: String(err) });
      }
      ExportDebug.recordSaveBatch({
        batchIndex: i + 1,
        batchCount: imageObjs.length,
        batchSize: 1,
        keyCount: 1,
        savedCount: batchSaved,
        failedCount: batchFailed,
        missingCount: 0,
        bytesMB: Math.round(bytes / 1024 / 1024 * 100) / 100,
        ms: performance.now() - writeStart,
        error: errors[errors.length - 1] || '',
      });
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          phase: 'save-progress',
          preparedCount: savedCount + failedCount + skippedCount,
          finishedCount: savedCount + failedCount + skippedCount,
          totalCount: imageObjs.length,
          force: true,
        });
      }
      if (i % 2 === 1 || i === imageObjs.length - 1) await delay(0);
    }
    ExportDebug.recordSaveDone({
      savedCount,
      failedCount,
      missingCount: skippedCount,
      bytesMB: Math.round(bytes / 1024 / 1024 * 100) / 100,
      method: 'directory-picker',
    });
    return {
      downloadedCount: savedCount,
      savedCount,
      failedCount,
      skippedCount,
      missingCount: skippedCount,
      method: 'directory-picker',
      bytes,
      errors,
    };
  }

  async function saveExportBlob(blob, target, fallbackName) {
    if (target?.handle) {
      const writable = await target.handle.createWritable();
      try {
        await writable.write(blob);
      } finally {
        await writable.close();
      }
      return true;
    }
    downloadBlob(blob, fallbackName);
    return false;
  }

  function dataUrlMime(dataUrl) {
    return /^data:([^;,]+);base64,/i.exec(String(dataUrl || ''))?.[1] || 'image/png';
  }

  function extForMime(mime = '') {
    const value = String(mime || '').toLowerCase();
    if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
    if (value === 'image/webp') return 'webp';
    if (value === 'image/gif') return 'gif';
    return 'png';
  }

  function mimeForImageExt(ext = '') {
    const value = String(ext || '').replace(/^\./, '').toLowerCase();
    if (value === 'jpg' || value === 'jpeg') return 'image/jpeg';
    if (value === 'webp') return 'image/webp';
    if (value === 'gif') return 'image/gif';
    return 'image/png';
  }

  function withImageExtension(name, ext) {
    const cleanExt = String(ext || 'png').replace(/^\./, '').toLowerCase() || 'png';
    return String(name || `image.${cleanExt}`).replace(/\.(png|jpe?g|webp|gif)$/i, '') + `.${cleanExt}`;
  }

  function blobFromDataUrl(dataUrl) {
    if (!/^data:([^;,]+);base64,/i.test(String(dataUrl || '')) || !root.BoardfishWebBoardContainer?.dataUrlToBytes) return null;
    return new Blob([root.BoardfishWebBoardContainer.dataUrlToBytes(dataUrl)], { type: dataUrlMime(dataUrl) });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function downloadDataUrl(dataUrl, filename) {
    const blob = blobFromDataUrl(dataUrl);
    if (blob) {
      downloadBlob(blob, filename);
      return true;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
    return false;
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
    downloadDataUrl,
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
