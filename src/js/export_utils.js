'use strict';

(function initExportUtils(root) {
  const { extForMime, mimeForExt: mimeForImageExt } = root.BoardfishBoardTypes ||
    (typeof require === 'function' ? require('./board_types.js') : null);
  function guessImageExtFromDataUrl(dataUrl) {
    return extForMime(dataUrlMime(dataUrl));
  }

  function guessImageExtForObjectExport(obj) {
    return imageNeedsRendering(obj) ? 'png' : guessImageExtForSource(BoardfishImageStore.getSource(obj?.data?.imgKey));
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

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let yieldToEventLoop = null;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    yieldToEventLoop = async (dbg, phase, meta = {}) => {
      const t0 = performance.now();
      await delay(0);
      const ms = performance.now() - t0;
      ExportDebug.step(dbg, 'ui:event-loop-yield', { phase, ms, ...meta });
      ExportDebug.recordEventLoopYield?.({ phase, ms, ...meta });
      return ms;
    };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  function createProgressUpdater(totalCount, busyPill) {
    let currentProgressText = progressText(totalCount, 0);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      ExportDebug.recordProgressUi({
        phase: 'resolve-start',
        text: currentProgressText,
        finishedCount: 0,
        preparedCount: 0,
        totalCount,
      });
    }

    return (
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      phase,
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      preparedCount
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , extra = {}
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ) => {
      const text = progressText(totalCount, preparedCount);
      if (text === currentProgressText) return;
      currentProgressText = text;
      updatePillTask(busyPill, text);
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        ExportDebug.recordProgressUi({
          phase,
          text,
          finishedCount: Number(text.split('/')[0]) || 0,
          preparedCount,
          totalCount,
          ...extra,
        });
      }
    };
  }

  async function imageObjectDownloadEntry(obj, index
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    , options = {}
  ) {
    const source = BoardfishImageStore.getSource(obj?.data?.imgKey);
    const needsRendering = imageNeedsRendering(obj);
    const name = options.filename || `image_${index + 1}.${needsRendering ? 'png' : guessImageExtForSource(source)}`;
    if (!needsRendering) {
      const sourceEntry = await imageSourceDownloadEntry(source, name);
      if (sourceEntry) return sourceEntry;
    }

    let data = null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let width = 0;
    let height = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const canvas = renderImageToCanvas(obj) || await renderStoredImageToCanvas(obj, source);
    if (!canvas) return null;
    data = await canvasToPngBlob(canvas);
    if (!data) return null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    width = canvas.width;
    height = canvas.height;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      ExportDebug.step(dbg, 'web-export:rendered-blob', {
        imgKey: obj?.data?.imgKey,
        bytes: data.size ?? data.length,
        width,
        height,
        format: 'lossless-png',
      });
    }
    const entry = {
      name: options.filename || `image_${index + 1}.png`,
      data,
      mime: 'image/png',
    };
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      entry.debug = {
        phase: 'web-rendered',
        rendered: true,
        fallbackRender: true,
        sourceKind: imageSourceKind(source),
        bytes: data.size ?? data.length,
        width,
        height,
      };
    }
    return entry;
  }

  async function imageSourceDownloadEntry(source, name) {
    if (typeof isWebImageRef === 'function' && isWebImageRef(source) && root.BoardfishWebBoardContainer?.bytesForImageSource) {
      try {
        const data = source.__blob || await (typeof root.BoardfishWebBoardContainer.bytesForImageSourceAsync === 'function'
          ? root.BoardfishWebBoardContainer.bytesForImageSourceAsync(source) : root.BoardfishWebBoardContainer.bytesForImageSource(source));
        if (!data) return null;
        const ext = source.ext === 'jpeg' ? 'jpg' : (source.ext || 'png');
        const entry = {
          name: withImageExtension(name, ext),
          data,
          mime: source.mime || mimeForImageExt(ext),
        };
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          entry.debug = {
            phase: 'web-original',
            rendered: false,
            sourceKind: 'web-ref',
            bytes: data.size ?? data.length,
          };
        }
        return entry;
      } catch (_) {}
    }
    if (typeof source === 'string' && source.startsWith('data:') && root.BoardfishWebBoardContainer?.dataUrlToBytes) {
      const ext = guessImageExtFromDataUrl(source);
      const data = root.BoardfishWebBoardContainer.dataUrlToBytes(source);
      const entry = {
        name: withImageExtension(name, ext),
        data,
        mime: dataUrlMime(source),
      };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        entry.debug = {
          phase: 'web-original',
          rendered: false,
          sourceKind: 'data-url',
          bytes: data.length,
        };
      }
      return entry;
    }
    return null;
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let imageSourceKind = null;
  let recordWebResolveEntry = null;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    imageSourceKind = (source) => {
      if (typeof isWebImageRef === 'function' && isWebImageRef(source)) return 'web-ref';
      if (typeof source === 'string') return source.startsWith('data:') ? 'data-url' : 'string';
      if (!source) return 'missing';
      return typeof source;
    };
    recordWebResolveEntry = (obj, index, entry, ms, extra = {}) => {
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
    };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  async function downloadImageObjects(imageObjs
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    , options = {}
  ) {
    const canZip = imageObjs.length > 1 && !!root.BoardfishWebBoardContainer?.createZipBlob;
    const target = await pickWebExportTarget(imageObjs, options);
    if (target?.cancelled) return { downloadedCount: 0, skippedCount: 0, method: 'picker', cancelled: true };
    if (typeof options.onStart === 'function') options.onStart({ totalCount: imageObjs.length, target });

    if (target?.directoryHandle) {
      return saveImageObjectsToDirectory(imageObjs, target.directoryHandle
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        , options
      );
    }

    const downloads = [];
    const usedNames = new Set();
    let skippedCount = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let renderedCount;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      renderedCount = 0;
      ExportDebug.recordResolveStart?.({
        imageCount: imageObjs.length,
        method: target?.handle ? 'file-picker' : (canZip ? 'zip' : 'download'),
        targetMode: options.targetMode || 'auto',
      });
    }
    for (let i = 0; i < imageObjs.length; i++) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let itemStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') itemStart = performance.now();
      const entry = await imageObjectDownloadEntry(imageObjs[i], i
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        , {
        filename: imageObjs.length === 1 ? options.filename : uniqueImageExportName(imageObjs[i], usedNames),
      });
      if (!entry) {
        skippedCount++;
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          recordWebResolveEntry(imageObjs[i], i, null, performance.now() - itemStart, { phase: 'web-skipped' });
        }
        continue;
      }
      downloads.push(entry);
      if (typeof BOARDFISH_PRODUCTION === 'undefined' && entry.debug?.rendered) renderedCount++;
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        recordWebResolveEntry(imageObjs[i], i, entry, performance.now() - itemStart);
        ExportDebug.recordResolveProgress?.({
          processed: i + 1,
          imageCount: imageObjs.length,
          keyCount: downloads.length,
          renderedCount,
          skippedCount,
        });
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          phase: 'prepare-progress',
          preparedCount: downloads.length,
          totalCount: imageObjs.length,
        });
      }
      if (i % 2 === 1 || i === imageObjs.length - 1) {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          await yieldToEventLoop(dbg, 'web-prepare', { processed: i + 1, imageCount: imageObjs.length });
        } else {
          await delay(0);
        }
      }
    }
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      ExportDebug.recordResolveDone?.({
        processed: imageObjs.length,
        imageCount: imageObjs.length,
        keyCount: downloads.length,
        renderedCount,
        skippedCount,
      });
    }

    if (!downloads.length) return { downloadedCount: 0, skippedCount, method: 'none' };

    if (downloads.length === 1) {
      const item = downloads[0];
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        ExportDebug.recordSaveStart?.({ keyCount: downloads.length, batchSize: downloads.length, batchCount: 1, method: target?.handle ? 'file-picker' : 'download' });
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let saveStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') saveStart = performance.now();
      await saveExportData(item.data, target, item.name, item.mime || 'image/png');
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        ExportDebug.recordSaveBatch?.({
          batchIndex: 1,
          batchCount: 1,
          batchSize: downloads.length,
          keyCount: downloads.length,
          savedCount: downloads.length,
          failedCount: 0,
          missingCount: 0,
          bytesMB: Math.round((item.data.size ?? item.data.length) / 1024 / 1024 * 100) / 100,
          ms: performance.now() - saveStart,
          method: target?.handle ? 'file-picker' : 'download',
        });
        ExportDebug.recordSaveDone?.({ savedCount: downloads.length, failedCount: 0, missingCount: skippedCount, bytesMB: Math.round((item.data.size ?? item.data.length) / 1024 / 1024 * 100) / 100 });
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-progress', preparedCount: downloads.length, finishedCount: downloads.length, totalCount: imageObjs.length });
      }
      return { downloadedCount: downloads.length, skippedCount, method: target?.handle ? 'file-picker' : 'download' };
    }

    if (!canZip) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        ExportDebug.recordSaveStart?.({ keyCount: downloads.length, batchSize: 1, batchCount: downloads.length, method: 'download' });
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length });
      }
      let savedCount = 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let savedBytes;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') savedBytes = 0;
      for (let i = 0; i < downloads.length; i++) {
        const item = downloads[i];
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        let saveStart;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        if (typeof BOARDFISH_PRODUCTION === 'undefined') saveStart = performance.now();
        await saveExportData(item.data, target, item.name, item.mime || 'image/png');
        savedCount++;
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          savedBytes += item.data.size ?? item.data.length;
          ExportDebug.recordSaveBatch?.({
            batchIndex: i + 1,
            batchCount: downloads.length,
            batchSize: 1,
            keyCount: downloads.length,
            savedCount: 1,
            failedCount: 0,
            missingCount: 0,
            bytesMB: Math.round((item.data.size ?? item.data.length) / 1024 / 1024 * 100) / 100,
            ms: performance.now() - saveStart,
            method: 'download',
          });
        }
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            phase: 'save-progress',
            preparedCount: downloads.length,
            finishedCount: savedCount,
            totalCount: imageObjs.length,
          });
        }
        if (i % 2 === 1 || i === downloads.length - 1) {
          if (typeof BOARDFISH_PRODUCTION === 'undefined') {
            await yieldToEventLoop(dbg, 'web-save-downloads', { savedCount, keyCount: downloads.length });
          } else {
            await delay(0);
          }
        }
      }
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        ExportDebug.recordSaveDone?.({ savedCount, failedCount: 0, missingCount: skippedCount, bytesMB: Math.round(savedBytes / 1024 / 1024 * 100) / 100 });
      }
      return { downloadedCount: savedCount, skippedCount, method: 'download' };
    }

    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      ExportDebug.recordSaveStart?.({ keyCount: downloads.length, batchSize: downloads.length, batchCount: 2, method: target?.handle ? 'zip-file-picker' : 'zip' });
    }
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      await yieldToEventLoop(dbg, 'web-before-zip', { entryCount: downloads.length });
    } else {
      await delay(0);
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let zipStart;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      zipStart = performance.now();
      ExportDebug.step(dbg, 'web-export:zip-start', { entryCount: downloads.length });
    }
    const zip = await root.BoardfishWebBoardContainer.createZipBlob(downloads, { materializeBytes: false });
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const zipMs = performance.now() - zipStart;
      ExportDebug.step(dbg, 'web-export:zip-done', { entryCount: downloads.length, bytes: zip.byteLength, ms: zipMs });
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
    }
    const filename = target?.filename || `images_${randomHex()}.zip`;
    if (typeof options.onProgress === 'function') {
      options.onProgress({ phase: 'save-start', preparedCount: downloads.length, totalCount: imageObjs.length });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let saveStart;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') saveStart = performance.now();
    await saveExportData(zip.blob, target, filename, 'application/zip');
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      ExportDebug.recordSaveBatch?.({
        batchIndex: 2,
        batchCount: 2,
        batchSize: 1,
        keyCount: downloads.length,
        savedCount: downloads.length,
        failedCount: 0,
        missingCount: 0,
        bytesMB: Math.round(zip.byteLength / 1024 / 1024 * 100) / 100,
        ms: performance.now() - saveStart,
        method: target?.handle ? 'zip-file-picker' : 'zip-download',
      });
      ExportDebug.recordSaveDone?.({ savedCount: downloads.length, failedCount: 0, missingCount: skippedCount, bytesMB: Math.round(zip.byteLength / 1024 / 1024 * 100) / 100 });
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress({ phase: 'save-progress', preparedCount: downloads.length, finishedCount: downloads.length, totalCount: imageObjs.length });
    }
    return {
      downloadedCount: downloads.length,
      skippedCount,
      method: target?.handle ? 'zip-file-picker' : 'zip',
      filename,
      bytes: zip.byteLength,
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

  async function writeEntryToDirectory(directoryHandle, entry) {
    const fileHandle = await directoryHandle.getFileHandle(entry.name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(entry.data);
    } finally {
      await writable.close();
    }
    return entry.data?.size || entry.data?.length || 0;
  }

  async function saveImageObjectsToDirectory(imageObjs, directoryHandle
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    , options = {}
  ) {
    const usedNames = new Set();
    let savedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let renderedCount;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    let bytes = 0;
    const errors = [];
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      renderedCount = 0;
      ExportDebug.recordResolveStart?.({ imageCount: imageObjs.length, method: 'directory-picker', targetMode: options.targetMode || 'folder' });
      ExportDebug.recordSaveStart({ keyCount: imageObjs.length, batchSize: 1, batchCount: imageObjs.length, method: 'directory-picker' });
    }
    for (let i = 0; i < imageObjs.length; i++) {
      const name = uniqueImageExportName(imageObjs[i], usedNames);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let itemStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') itemStart = performance.now();
      const entry = await imageObjectDownloadEntry(imageObjs[i], i
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        , { filename: name }
      );
      if (!entry) {
        skippedCount++;
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          recordWebResolveEntry(imageObjs[i], i, null, performance.now() - itemStart, { phase: 'web-skipped' });
        }
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            phase: 'prepare-progress',
            preparedCount: savedCount + failedCount + skippedCount,
            totalCount: imageObjs.length,
          });
        }
        continue;
      }
      if (typeof BOARDFISH_PRODUCTION === 'undefined' && entry.debug?.rendered) renderedCount++;
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        recordWebResolveEntry(imageObjs[i], i, entry, performance.now() - itemStart);
        ExportDebug.recordResolveProgress?.({
          processed: i + 1,
          imageCount: imageObjs.length,
          keyCount: savedCount + failedCount + 1,
          renderedCount,
          skippedCount,
        });
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          phase: 'prepare-progress',
          preparedCount: savedCount + failedCount + skippedCount + 1,
          totalCount: imageObjs.length,
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let writeStart;
      let batchSaved;
      let batchFailed;
      let writtenBytes;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        writeStart = performance.now();
        batchSaved = 0;
        batchFailed = 0;
        writtenBytes = 0;
      }
      try {
        const written = await writeEntryToDirectory(directoryHandle, entry);
        savedCount++;
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          batchSaved = 1;
          writtenBytes = written;
        }
        bytes += written;
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          ExportDebug.step(dbg, 'web-export:folder-write', { name: entry.name, bytes: written });
        }
      } catch (err) {
        failedCount++;
        if (typeof BOARDFISH_PRODUCTION === 'undefined') batchFailed = 1;
        if (errors.length < 10) errors.push(`${entry.name}: ${err?.message || err}`);
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          ExportDebug.step(dbg, 'web-export:folder-write-error', { name: entry.name, error: String(err) });
        }
      }
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
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
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          phase: 'save-progress',
          preparedCount: savedCount + failedCount + skippedCount,
          finishedCount: savedCount + failedCount + skippedCount,
          totalCount: imageObjs.length,
        });
      }
      if (i % 2 === 1 || i === imageObjs.length - 1) {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          await yieldToEventLoop(dbg, 'web-directory-save', { processed: i + 1, imageCount: imageObjs.length });
        } else {
          await delay(0);
        }
      }
    }
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
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
    }
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

  async function saveExportData(data, target, fallbackName, type) {
    if (target?.handle) {
      const writable = await target.handle.createWritable();
      try {
        await writable.write(data);
      } finally {
        await writable.close();
      }
      return true;
    }
    downloadBlob(data instanceof Blob && data.type === type ? data : new Blob([data], { type }), fallbackName);
    return false;
  }

  function dataUrlMime(dataUrl) {
    return /^data:([^;,]+);base64,/i.exec(String(dataUrl || ''))?.[1] || 'image/png';
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

  root.BoardfishExportUtils = Object.freeze({
    createProgressUpdater,
    downloadImageObjects,
    guessImageExtForObjectExport,
    guessImageExtFromDataUrl,
    randomHex,
    selectedImageObjects,
  });
})(typeof window !== 'undefined' ? window : globalThis);
