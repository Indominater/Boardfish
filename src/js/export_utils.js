'use strict';

(function initExportUtils(root) {
  function guessImageExtFromDataUrl(dataUrl) {
    return extForMime(dataUrlMime(dataUrl));
  }

  function guessImageExtForObjectExport(obj) {
    const src = BoardfishImageStore.getSource(obj?.data?.imgKey);
    return imageNeedsRendering(obj) ? 'png' : guessImageExtForSource(src);
  }

  function guessImageExtForSource(src) {
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

  async function yieldToEventLoop(dbg, phase, meta = {}) {
    const t0 = performance.now();
    await delay(0);
    const ms = performance.now() - t0;
    ExportDebug.step(dbg, 'ui:event-loop-yield', { phase, ms, ...meta });
    ExportDebug.recordEventLoopYield?.({ phase, ms, ...meta });
    return ms;
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

  async function imageObjectDownloadEntry(obj, index, dbg, options = {}) {
    const source = BoardfishImageStore.getSource(obj?.data?.imgKey);
    const needsRendering = imageNeedsRendering(obj);
    const name = options.filename || `image_${index + 1}.${needsRendering ? 'png' : guessImageExtForSource(source)}`;
    if (!needsRendering) {
      const sourceEntry = await imageSourceDownloadEntry(source, name);
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
      debug: {
        phase: 'web-rendered',
        rendered: true,
        fallbackRender: true,
        sourceKind: imageSourceKind(source),
        bytes: data.length,
        width,
        height,
      },
    };
  }

  async function imageSourceDownloadEntry(source, name) {
    if (typeof isWebImageRef === 'function' && isWebImageRef(source) && root.BoardfishWebBoardContainer?.bytesForImageSource) {
      try {
        const data = typeof root.BoardfishWebBoardContainer.bytesForImageSourceAsync === 'function'
          ? await root.BoardfishWebBoardContainer.bytesForImageSourceAsync(source)
          : root.BoardfishWebBoardContainer.bytesForImageSource(source);
        if (!data) return null;
        const ext = source.ext === 'jpeg' ? 'jpg' : (source.ext || 'png');
        return {
          name: withImageExtension(name, ext),
          data,
          mime: source.mime || mimeForImageExt(ext),
          debug: {
            phase: 'web-original',
            rendered: false,
            sourceKind: 'web-ref',
            bytes: data.length,
          },
        };
      } catch (_) {}
    }
    if (typeof source === 'string' && source.startsWith('data:') && root.BoardfishWebBoardContainer?.dataUrlToBytes) {
      const ext = guessImageExtFromDataUrl(source);
      const data = root.BoardfishWebBoardContainer.dataUrlToBytes(source);
      return {
        name: withImageExtension(name, ext),
        data,
        mime: dataUrlMime(source),
        debug: {
          phase: 'web-original',
          rendered: false,
          sourceKind: 'data-url',
          bytes: data.length,
        },
      };
    }
    return null;
  }

  function imageSourceKind(source) {
    if (typeof isWebImageRef === 'function' && isWebImageRef(source)) return 'web-ref';
    if (typeof source === 'string') return source.startsWith('data:') ? 'data-url' : 'string';
    if (!source) return 'missing';
    return typeof source;
  }

  function recordWebResolveEntry(dbg, obj, index, entry, ms, extra = {}) {
    ExportDebug.recordResolve?.({
      index,
      objectId: obj?.id || '',
      imgKey: obj?.data?.imgKey || '',
      key: entry?.name || '',
      rendered: !!entry?.debug?.rendered,
      fallbackRender: !!entry?.debug?.fallbackRender,
      phase: entry?.debug?.phase || extra.phase || '',
      sourceKind: entry?.debug?.sourceKind || imageSourceKind(BoardfishImageStore.getSource(obj?.data?.imgKey)),
      bytesMB: entry?.debug?.bytes ? Math.round(entry.debug.bytes / 1024 / 1024 * 100) / 100 : '',
      ms,
      skipped: !entry,
      error: extra.error || '',
    });
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
    let renderedCount = 0;
    ExportDebug.recordResolveStart?.({
      imageCount: imageObjs.length,
      method: target?.handle ? 'file-picker' : (canZip ? 'zip' : 'download'),
      targetMode: options.targetMode || 'auto',
    });
    for (let i = 0; i < imageObjs.length; i++) {
      const itemStart = performance.now();
      const entry = await imageObjectDownloadEntry(imageObjs[i], i, dbg, {
        filename: imageObjs.length === 1 ? options.filename : uniqueImageExportName(imageObjs[i], usedNames),
      });
      if (!entry) {
        skippedCount++;
        recordWebResolveEntry(dbg, imageObjs[i], i, null, performance.now() - itemStart, { phase: 'web-skipped' });
        continue;
      }
      downloads.push(entry);
      if (entry.debug?.rendered) renderedCount++;
      recordWebResolveEntry(dbg, imageObjs[i], i, entry, performance.now() - itemStart);
      ExportDebug.recordResolveProgress?.({
        processed: i + 1,
        imageCount: imageObjs.length,
        keyCount: downloads.length,
        renderedCount,
        skippedCount,
      });
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          phase: 'prepare-progress',
          preparedCount: downloads.length,
          totalCount: imageObjs.length,
        });
      }
      if (i % 2 === 1 || i === imageObjs.length - 1) await yieldToEventLoop(dbg, 'web-prepare', { processed: i + 1, imageCount: imageObjs.length });
    }
    ExportDebug.recordResolveDone?.({
      processed: imageObjs.length,
      imageCount: imageObjs.length,
      keyCount: downloads.length,
      renderedCount,
      skippedCount,
    });

    if (!downloads.length) return { downloadedCount: 0, skippedCount, method: 'none' };

    if (downloads.length === 1) {
      const item = downloads[0];
      const blob = new Blob([item.data], { type: item.mime || 'image/png' });
      ExportDebug.recordSaveStart?.({ keyCount: downloads.length, batchSize: downloads.length, batchCount: 1, method: target?.handle ? 'file-picker' : 'download' });
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length, force: true });
      }
      const saveStart = performance.now();
      await saveExportBlob(blob, target, item.name);
      ExportDebug.recordSaveBatch?.({
        batchIndex: 1,
        batchCount: 1,
        batchSize: downloads.length,
        keyCount: downloads.length,
        savedCount: downloads.length,
        failedCount: 0,
        missingCount: 0,
        bytesMB: Math.round(blob.size / 1024 / 1024 * 100) / 100,
        ms: performance.now() - saveStart,
        method: target?.handle ? 'file-picker' : 'download',
      });
      ExportDebug.recordSaveDone?.({ savedCount: downloads.length, failedCount: 0, missingCount: skippedCount, bytesMB: Math.round(blob.size / 1024 / 1024 * 100) / 100 });
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-progress', preparedCount: downloads.length, finishedCount: downloads.length, totalCount: imageObjs.length, force: true });
      }
      return { downloadedCount: downloads.length, skippedCount, method: target?.handle ? 'file-picker' : 'download' };
    }

    if (!canZip) {
      ExportDebug.recordSaveStart?.({ keyCount: downloads.length, batchSize: 1, batchCount: downloads.length, method: 'download' });
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length, force: true });
      }
      let savedCount = 0;
      let savedBytes = 0;
      for (let i = 0; i < downloads.length; i++) {
        const item = downloads[i];
        const blob = new Blob([item.data], { type: item.mime || 'image/png' });
        const saveStart = performance.now();
        await saveExportBlob(blob, target, item.name);
        savedCount++;
        savedBytes += blob.size;
        ExportDebug.recordSaveBatch?.({
          batchIndex: i + 1,
          batchCount: downloads.length,
          batchSize: 1,
          keyCount: downloads.length,
          savedCount: 1,
          failedCount: 0,
          missingCount: 0,
          bytesMB: Math.round(blob.size / 1024 / 1024 * 100) / 100,
          ms: performance.now() - saveStart,
          method: 'download',
        });
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            phase: 'save-progress',
            preparedCount: downloads.length,
            finishedCount: savedCount,
            totalCount: imageObjs.length,
            force: i === downloads.length - 1,
          });
        }
        if (i % 2 === 1 || i === downloads.length - 1) await yieldToEventLoop(dbg, 'web-save-downloads', { savedCount, keyCount: downloads.length });
      }
      ExportDebug.recordSaveDone?.({ savedCount, failedCount: 0, missingCount: skippedCount, bytesMB: Math.round(savedBytes / 1024 / 1024 * 100) / 100 });
      return { downloadedCount: savedCount, skippedCount, method: 'download' };
    }

    const zipEntries = new Array(downloads.length);
    for (let i = 0; i < downloads.length; i++) {
      const item = downloads[i];
      zipEntries[i] = {
        name: item.name,
        data: item.data,
      };
    }
    ExportDebug.recordSaveStart?.({ keyCount: downloads.length, batchSize: downloads.length, batchCount: 2, method: target?.handle ? 'zip-file-picker' : 'zip' });
    await yieldToEventLoop(dbg, 'web-before-zip', { entryCount: zipEntries.length });
    const zipStart = performance.now();
    ExportDebug.step(dbg, 'web-export:zip-start', { entryCount: zipEntries.length });
    const zipBytes = root.BoardfishWebBoardContainer.createZip(zipEntries);
    const zipMs = performance.now() - zipStart;
    ExportDebug.step(dbg, 'web-export:zip-done', { entryCount: zipEntries.length, bytes: zipBytes.length, ms: zipMs });
    ExportDebug.recordSaveBatch?.({
      batchIndex: 1,
      batchCount: 2,
      batchSize: downloads.length,
      keyCount: downloads.length,
      savedCount: 0,
      failedCount: 0,
      missingCount: 0,
      ms: zipMs,
      method: 'zip-build',
    });
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const filename = target?.filename || `images_${randomHex()}.zip`;
    if (typeof options.onProgress === 'function') {
      options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length, force: true });
    }
    const saveStart = performance.now();
    await saveExportBlob(blob, target, filename);
    ExportDebug.recordSaveBatch?.({
      batchIndex: 2,
      batchCount: 2,
      batchSize: 1,
      keyCount: downloads.length,
      savedCount: downloads.length,
      failedCount: 0,
      missingCount: 0,
      bytesMB: Math.round(zipBytes.length / 1024 / 1024 * 100) / 100,
      ms: performance.now() - saveStart,
      method: target?.handle ? 'zip-file-picker' : 'zip-download',
    });
    ExportDebug.recordSaveDone?.({ savedCount: downloads.length, failedCount: 0, missingCount: skippedCount, bytesMB: Math.round(zipBytes.length / 1024 / 1024 * 100) / 100 });
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
    let renderedCount = 0;
    let bytes = 0;
    const errors = [];
    ExportDebug.recordResolveStart?.({ imageCount: imageObjs.length, method: 'directory-picker', targetMode: options.targetMode || 'folder' });
    ExportDebug.recordSaveStart({ keyCount: imageObjs.length, batchSize: 1, batchCount: imageObjs.length, method: 'directory-picker' });
    for (let i = 0; i < imageObjs.length; i++) {
      const name = uniqueImageExportName(imageObjs[i], usedNames);
      const itemStart = performance.now();
      const entry = await imageObjectDownloadEntry(imageObjs[i], i, dbg, { filename: name });
      if (!entry) {
        skippedCount++;
        recordWebResolveEntry(dbg, imageObjs[i], i, null, performance.now() - itemStart, { phase: 'web-skipped' });
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            phase: 'prepare-progress',
            preparedCount: savedCount + failedCount + skippedCount,
            totalCount: imageObjs.length,
          });
        }
        continue;
      }
      if (entry.debug?.rendered) renderedCount++;
      recordWebResolveEntry(dbg, imageObjs[i], i, entry, performance.now() - itemStart);
      ExportDebug.recordResolveProgress?.({
        processed: i + 1,
        imageCount: imageObjs.length,
        keyCount: savedCount + failedCount + 1,
        renderedCount,
        skippedCount,
      });
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
      let writtenBytes = 0;
      try {
        const written = await writeEntryToDirectory(directoryHandle, entry);
        savedCount++;
        batchSaved = 1;
        writtenBytes = written;
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
        bytesMB: Math.round(writtenBytes / 1024 / 1024 * 100) / 100,
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
      if (i % 2 === 1 || i === imageObjs.length - 1) await yieldToEventLoop(dbg, 'web-directory-save', { processed: i + 1, imageCount: imageObjs.length });
    }
    ExportDebug.recordResolveDone?.({
      processed: imageObjs.length,
      imageCount: imageObjs.length,
      keyCount: savedCount + failedCount,
      renderedCount,
      skippedCount,
    });
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
    createProgressUpdater,
    downloadImageObjects,
    finishImageExportInputShield,
    guessImageExtForObjectExport,
    guessImageExtFromDataUrl,
    randomHex,
    selectedImageObjects,
  });
})(typeof window !== 'undefined' ? window : globalThis);
