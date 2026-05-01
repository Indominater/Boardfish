// ─── Clipboard ───────────────────────────────────────────────────────────────
var jsClipboard = null;
var _jsClipboardSetAt = 0;
var _jsClipboardSequence = null;
var _jsClipboardSequencePromise = null;
var _jsClipboardNativeWritePending = false;
var _jsClipboardToken = 0;
var _pasteInProgress = false;
var _nativeClipboardWriteQueue = Promise.resolve();
var _nativeClipboardPendingCount = 0;
var _nativeClipboardLastError = '';
var _nativeClipboardIdleResolvers = [];
var _nativeClipboardOwnedSequences = new Set();

function nativeClipboardPendingCount() {
  return _nativeClipboardPendingCount;
}

function nativeClipboardLastError() {
  return _nativeClipboardLastError;
}

function resolveNativeClipboardIdleWaiters() {
  if (_nativeClipboardPendingCount > 0) return;
  const resolvers = _nativeClipboardIdleResolvers;
  _nativeClipboardIdleResolvers = [];
  for (const resolve of resolvers) resolve({ ready: true, error: _nativeClipboardLastError || '' });
}

function waitForNativeClipboardIdle(timeoutMs = 10000) {
  if (_nativeClipboardPendingCount <= 0) return Promise.resolve({ ready: true, error: _nativeClipboardLastError || '' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ready: false, pending: _nativeClipboardPendingCount, error: _nativeClipboardLastError || '' });
    }, timeoutMs);
    _nativeClipboardIdleResolvers.push((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function rememberOwnedClipboardSequence(seq) {
  if (seq === null || seq === undefined) return;
  _nativeClipboardOwnedSequences.add(seq);
  if (_nativeClipboardOwnedSequences.size > 50) {
    const oldest = _nativeClipboardOwnedSequences.values().next().value;
    _nativeClipboardOwnedSequences.delete(oldest);
  }
}

function clipboardSequenceChangedExternally(startSeq, currentSeq) {
  if (startSeq === null || currentSeq === null || startSeq === undefined || currentSeq === undefined) return false;
  return currentSeq !== startSeq && !_nativeClipboardOwnedSequences.has(currentSeq);
}

function enqueueNativeClipboardWrite(task, dbg = null, meta = {}) {
  const queuedAt = performance.now();
  _nativeClipboardPendingCount++;
  _nativeClipboardLastError = '';
  ClipDebug.step(dbg, 'native-copy-queued', { ...meta, nativePending: _nativeClipboardPendingCount });
  const run = _nativeClipboardWriteQueue.catch(() => {}).then(async () => {
    ClipDebug.step(dbg, 'native-copy-start', { ...meta, nativePending: _nativeClipboardPendingCount, queueMs: Math.round((performance.now() - queuedAt) * 100) / 100 });
    try {
      return await task();
    } catch (err) {
      _nativeClipboardLastError = String(err);
      throw err;
    } finally {
      _nativeClipboardPendingCount = Math.max(0, _nativeClipboardPendingCount - 1);
      ClipDebug.step(dbg, 'native-copy-finished', { ...meta, nativePending: _nativeClipboardPendingCount });
      resolveNativeClipboardIdleWaiters();
    }
  });
  _nativeClipboardWriteQueue = run.catch(() => {});
  return run;
}

async function getNativeClipboardSequence(dbg = null) {
  if (!hasTauri()) return null;
  try {
    return await ClipDebug.invoke(dbg, 'clipboard_sequence');
  } catch {
    return null;
  }
}

function markJsClipboardSequence(token = _jsClipboardToken, dbg = null) {
  const promise = (async () => {
    const seq = await getNativeClipboardSequence(dbg);
    rememberOwnedClipboardSequence(seq);
    if (seq !== null && jsClipboard && token === _jsClipboardToken) _jsClipboardSequence = seq;
    ClipDebug.step(dbg, 'mark-js-clipboard-sequence', { seq, token, currentToken: _jsClipboardToken, accepted: seq !== null && token === _jsClipboardToken });
    return seq;
  })();
  if (token === _jsClipboardToken) _jsClipboardSequencePromise = promise;
  return promise;
}

function finishNativeClipboardWrite(token, dbg = null) {
  return markJsClipboardSequence(token, dbg).finally(() => {
    if (token === _jsClipboardToken) _jsClipboardNativeWritePending = false;
  });
}

function setJsClipboard(value, trackNative = false, nativeWritePending = false) {
  jsClipboard = value;
  _jsClipboardSetAt = Date.now();
  _jsClipboardSequence = null;
  _jsClipboardSequencePromise = null;
  _jsClipboardNativeWritePending = nativeWritePending;
  const token = ++_jsClipboardToken;
  if (trackNative) markJsClipboardSequence(token);
  return token;
}

function clearJsClipboard() {
  jsClipboard = null;
  _jsClipboardSequence = null;
  _jsClipboardSequencePromise = null;
  _jsClipboardNativeWritePending = false;
  _jsClipboardToken++;
}

async function jsClipboardStillCurrent(dbg = null) {
  if (!jsClipboard) return false;
  if (_jsClipboardSequence === null && _jsClipboardSequencePromise) {
    await _jsClipboardSequencePromise.catch(() => null);
  }
  if (_jsClipboardSequence === null) {
    const age = Date.now() - _jsClipboardSetAt;
    const current = !hasTauri() || _jsClipboardNativeWritePending || age < 750;
    ClipDebug.step(dbg, 'validate-js-clipboard-untracked', { current, nativeWritePending: _jsClipboardNativeWritePending, age });
    return current;
  }
  const seq = await getNativeClipboardSequence(dbg);
  const current = seq === null || seq === _jsClipboardSequence;
  ClipDebug.step(dbg, 'validate-js-clipboard', { seq, expected: _jsClipboardSequence, current });
  return current;
}

function readClipboardImageDataUrlFromEvent(clipboardData, dbg = null) {
  if (!clipboardData) return null;
  const items = [...(clipboardData.items || [])];
  const files = [...(clipboardData.files || [])];
  const isSupportedImageType = (type) => type === 'image/png' || type === 'image/jpeg';
  const imageItem = items.find((item) => item.kind === 'file' && isSupportedImageType(item.type));
  const imageFile = imageItem?.getAsFile?.() || files.find((file) => isSupportedImageType(file.type));
  if (!imageFile) return null;
  ClipDebug.step(dbg, 'event-image-blob', { type: imageFile.type, blobSize: imageFile.size });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = () => reject(reader.error || new Error('failed to read clipboard image'));
    reader.readAsDataURL(imageFile);
  });
}

function readClipboardTextFromEvent(clipboardData) {
  if (!clipboardData) return '';
  return clipboardData.getData?.('text/plain') || clipboardData.getData?.('text') || '';
}

function describeClipboardData(clipboardData) {
  if (!clipboardData) return null;
  return {
    itemTypes: [...(clipboardData.items || [])].map((item) => item.type || item.kind || ''),
    fileTypes: [...(clipboardData.files || [])].map((file) => file.type || ''),
    types: [...(clipboardData.types || [])],
  };
}

async function readClipboardImageDataUrlFromBrowser(dbg = null) {
  if (!navigator.clipboard?.read) return null;
  ClipDebug.step(dbg, 'browser-clipboard-read:start');
  const items = await navigator.clipboard.read();
  ClipDebug.step(dbg, 'browser-clipboard-read:ok', { itemCount: items.length });
  for (const item of items) {
    for (const type of item.types) {
      if (type !== 'image/png' && type !== 'image/jpeg') continue;
      const blob = await item.getType(type);
      ClipDebug.step(dbg, 'browser-image-blob', { type, blobSize: blob.size });
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => reject(reader.error || new Error('failed to read browser clipboard image'));
        reader.readAsDataURL(blob);
      });
    }
  }
  return null;
}

async function copySelected() {
  const dbg = ClipDebug.start('copySelected', { selectedCount: selectedIds.size });
  if (!selectedIds.size) { ClipDebug.end(dbg, { skipped: 'empty-selection' }); return; }

  if (selectedIds.size > 1) {
    const clonedObjs = [];
    const imageData = {};
    let processed = 0;
    ClipDebug.step(dbg, 'copy:multi-start', { selectedCount: selectedIds.size });
    for (const id of selectedIds) {
      processed++;
      const obj = objectsMap.get(id);
      if (!obj) continue;
      const cloned = cloneObject(obj);
      if (cloned.type === 'image') {
        const src = imageStore[cloned.data.imgKey];
        if (src) imageData[cloned.data.imgKey] = src;
      }
      clonedObjs.push(cloned);
      if (processed === 1 || processed % 50 === 0 || processed === selectedIds.size) {
        ClipDebug.step(dbg, 'copy:multi-progress', {
          processed,
          selectedCount: selectedIds.size,
          objectCount: clonedObjs.length,
          imageCount: Object.keys(imageData).length,
        });
      }
    }
    if (!clonedObjs.length) { ClipDebug.end(dbg, { skipped: 'no-clones' }); return; }
    ClipDebug.step(dbg, 'copy:multi-set-jsClipboard-start', { objectCount: clonedObjs.length, imageCount: Object.keys(imageData).length });
    setJsClipboard({ type: 'objects', objects: clonedObjs, imageData }, true);
    ClipDebug.step(dbg, 'copy:multi-set-jsClipboard-end', { objectCount: clonedObjs.length, imageCount: Object.keys(imageData).length });
    ClipDebug.end(dbg, { path: 'multi-jsClipboard', objectCount: clonedObjs.length, imageCount: Object.keys(imageData).length });
    return;
  }

  const obj = getFirstSelectedObject();
  if (!obj) { ClipDebug.end(dbg, { skipped: 'missing-object' }); return; }

  const cloned = cloneObject(obj);
  const imgData = {};
  if (obj.type === 'image') {
    const src = imageStore[obj.data.imgKey];
    if (src) imgData[obj.data.imgKey] = src;
  }
  const isTauri = hasTauri();

  const clipboardToken = setJsClipboard({ type: 'objects', objects: [cloned], imageData: imgData }, false, isTauri);
  ClipDebug.step(dbg, 'set-jsClipboard', { type: obj.type, isTauri, imgKey: obj.data?.imgKey, imageNeedsRendering: obj.type === 'image' ? imageNeedsRendering(obj) : false });

  if (obj.type === 'text') {
    if (isTauri) {
      const copyStartSequencePromise = getNativeClipboardSequence(dbg);
      enqueueNativeClipboardWrite(async () => {
        if (clipboardToken !== _jsClipboardToken) {
          ClipDebug.step(dbg, 'native-copy-stale-skip', { type: 'text', token: clipboardToken, currentToken: _jsClipboardToken });
          return;
        }
        const startSeq = await copyStartSequencePromise;
        const currentSeq = await getNativeClipboardSequence(dbg);
        if (clipboardSequenceChangedExternally(startSeq, currentSeq)) {
          ClipDebug.step(dbg, 'native-copy-external-change-skip', { type: 'text', startSeq, currentSeq });
          return;
        }
        await ClipDebug.invoke(dbg, 'copy_text_to_clipboard', { text: obj.data.content }, { textLen: obj.data.content.length });
      }, dbg, { type: 'text', token: clipboardToken })
        .catch(err => console.error('[copy] copy_text_to_clipboard FAILED:', err))
        .finally(() => finishNativeClipboardWrite(clipboardToken, dbg))
        .finally(() => ClipDebug.end(dbg, { path: 'text-tauri' }));
    } else {
      navigator.clipboard.writeText(obj.data.content)
        .catch(err => console.error('[copy] writeText FAILED:', err))
        .finally(() => ClipDebug.end(dbg, { path: 'text-web' }));
    }
    return;
  }

  if (obj.type === 'image') {
    beginImageCopyInteractionLock();
    let imageCopyInteractionReleased = false;
    const releaseImageCopyInteractionLock = () => {
      if (imageCopyInteractionReleased) return;
      imageCopyInteractionReleased = true;
      endImageCopyInteractionLock();
    };
    if (isTauri) {
      const imgKey = obj.data.imgKey;
      const { flipX, flipY, rotation } = imageTransformFromObject(obj);
      const copyDataUrlFallback = async (reason) => {
        const sourceStart = performance.now();
        ClipDebug.step(dbg, 'copy:source-start', { imgKey, reason, storedType: typeof imageStore[obj.data.imgKey], nativeRef: isNativeImageRef(imageStore[obj.data.imgKey]) });
        const src = await ensureImageDataUrl(obj.data.imgKey, dbg);
        if (!src) return;
        ClipDebug.step(dbg, 'copy:source-ready', {
          imgKey,
          reason,
          ms: Math.round((performance.now() - sourceStart) * 100) / 100,
          dataUrl: src,
        });
        ClipDebug.step(dbg, 'copy:data-url-fallback', { imgKey, flipX, flipY, rotation, reason, dataUrl: src });
        await ClipDebug.invoke(
          dbg,
          'copy_image_data_url_to_clipboard_transformed',
          { dataUrl: src, flipX, flipY, rotation },
          { imgKey, flipX, flipY, rotation, dataUrl: src }
        );
      };
      enqueueNativeClipboardWrite(async () => {
        if (clipboardToken !== _jsClipboardToken) {
          ClipDebug.step(dbg, 'native-copy-stale-skip', { type: 'image', imgKey, token: clipboardToken, currentToken: _jsClipboardToken });
          return;
        }
        await copyDataUrlFallback('native-unique-copy');
        finishPillTransition({
          beforeTransition: releaseImageCopyInteractionLock,
          finalMsg: 'Copied',
        });
      }, dbg, { type: 'image', imgKey, flipX, flipY, rotation })
        .catch((err) => {
          ClipDebug.step(dbg, 'copy:image-error', { imgKey, flipX, flipY, rotation, error: String(err) });
          console.error('[copy] image clipboard write FAILED:', err);
        })
        .finally(() => releaseImageCopyInteractionLock())
        .finally(() => finishNativeClipboardWrite(clipboardToken, dbg))
        .finally(() => ClipDebug.end(dbg, { path: 'image-tauri-cached-transform', imgKey, flipX, flipY, rotation }));
    } else {
      let pngBlob = null;
      try {
        const canvas = renderImageToCanvas(obj);
        if (!canvas) {
          ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'image-not-ready' });
          return;
        }
        pngBlob = await canvasToPngBlob(canvas);
        if (!pngBlob) {
          ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'blob-null' });
          return;
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      } catch (err) {
        console.error('[copy] clipboard.write FAILED:', err);
      } finally {
        releaseImageCopyInteractionLock();
        if (pngBlob) ClipDebug.end(dbg, { path: 'image-web-rendered', blobSize: pngBlob.size });
      }
    }
  }
}

function guessImageExtFromDataUrl(dataUrl) {
  if (dataUrl.startsWith('data:image/jpeg')) return 'jpg';
  return 'png';
}

function guessImageExtForObjectExport(obj) {
  if (imageNeedsRendering(obj)) return 'png';
  const src = imageStore[obj?.data?.imgKey];
  if (isNativeImageRef(src)) return src.ext === 'jpeg' ? 'jpg' : (src.ext || 'png');
  if (typeof src === 'string') return guessImageExtFromDataUrl(src);
  return 'png';
}

async function saveSelectedImage() {
  const dbg = ExportDebug.start('exportImage', { selectedCount: selectedIds.size });
  const imageObjs = [...selectedIds].map(id => objectsMap.get(id)).filter(o => o && o.type === 'image');
  if (imageObjs.length !== 1) { ExportDebug.end(dbg, { skipped: true, imageCount: imageObjs.length }); return; }
  const obj = imageObjs[0];
  const releaseInputShield = acquireInputShield({ keepSelectionOverlay: true });

  if (hasTauri()) {
    let tempKeys = [];
    try {
      const ext = guessImageExtForObjectExport(obj);
      const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
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

      const path = await ExportDebug.invoke(dbg, 'save_image_file_dialog', { defaultName }, { defaultName });
      ExportDebug.step(dbg, 'image:path-selected', { selected: !!path });
      if (!path) {
        releaseInputShield();
        ExportDebug.end(dbg, { saved: false, cancelled: true });
        return;
      }

      const result = await ExportDebug.invoke(dbg, 'write_image_file_by_key', { path, imgKey: key }, { imgKey: key, path });
      ExportDebug.end(dbg, { saved: true, bytesMB: result?.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : 0 });
      finishPillTransition({ beforeTransition: releaseInputShield, finalMsg: 'Image Exported' });
    } catch (err) {
      releaseInputShield();
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Save image failed:', err);
    } finally {
      cleanupExportTempKeys(tempKeys);
    }
    return;
  }

  ExportDebug.step(dbg, 'render:start');
  const src = await getRenderedImageDataUrl(obj, dbg);
  ExportDebug.step(dbg, 'render:complete', { hasDataUrl: !!src });
  if (!src) { releaseInputShield(); ExportDebug.end(dbg, { skipped: true, reason: 'no-dataurl' }); return; }

  const ext = guessImageExtFromDataUrl(src);
  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  const defaultName = `image_${hex}.${ext}`;

  const a = document.createElement('a');
  a.href = src;
  a.download = defaultName;
  a.click();
  releaseInputShield();
  ExportDebug.end(dbg, { saved: true, method: 'download' });
}

function exportProgressText(totalCount, preparedCount) {
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

async function letExportUiPaint(dbg, phase) {
  const t0 = performance.now();
  ExportDebug.step(dbg, 'ui:paint-wait:start', { phase });
  await nextAnimationFrame();
  await nextAnimationFrame();
  ExportDebug.step(dbg, 'ui:paint-wait:end', { phase, ms: performance.now() - t0 });
}

function createExportProgressUpdater(totalCount, busyPill) {
  let progressText = exportProgressText(totalCount, 0);
  ExportDebug.recordProgressUi({
    phase: 'resolve-start',
    text: progressText,
    finishedCount: 0,
    preparedCount: 0,
    totalCount,
  });

  return (phase, preparedCount, extra = {}, force = false) => {
    const text = exportProgressText(totalCount, preparedCount);
    if (!force && text === progressText) return;
    progressText = text;
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

function exportResolveConcurrency() {
  return 3;
}

// Resolves a list of image objects to img_keys for native folder export.
// Transformed native images stay in Rust: the existing cached source is decoded,
// transformed into a temp cache key, and saved by key without JS base64/canvas IPC.
async function resolveExportKeys(imageObjs, dbg, onProgress = null) {
  const nativeConcurrency = exportResolveConcurrency();
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
      if (processed % 3 === 0 || processed === imageObjs.length) await delay(0);
    };

    if (!imageNeedsRendering(obj)) {
      const itemStart = performance.now();
      await cacheImageSourceForExport(imgKey, imageStore[imgKey], dbg);
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

    const tempKey = `__export_tmp_${obj.id}`;
    if (hasTauri() && isNativeImageRef(imageStore[imgKey])) {
      const nativeStart = performance.now();
      try {
        const result = await ExportDebug.invoke(
          dbg,
          'register_transformed_image_source',
          {
            imgKey,
            tempKey,
            ...imageTransformFromObject(obj),
          },
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
      await ExportDebug.invoke(dbg, 'register_image_source', { imgKey: tempKey, dataUrl }, { imgKey: tempKey, dataUrlLen: dataUrl.length });
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
    const folder = await ExportDebug.invoke(dbg, 'pick_folder', {}, {});
    stopWatch({ picked: !!folder });
    return folder;
  } catch (err) {
    stopWatch({ error: String(err) });
    throw err;
  }
}

function cleanupExportTempKeys(tempKeys) {
  if (!tempKeys?.length || !hasTauri()) return;
  tauriInvoke('remove_cached_image_sources', { imgKeys: tempKeys })
    .catch((err) => console.warn('[export] remove_cached_image_sources failed:', err));
}

function normalizeExportSaveResult(result) {
  if (!result || typeof result === 'number') return { savedCount: result || 0 };
  return {
    savedCount: result.savedCount ?? result.saved_count ?? 0,
    failedCount: result.failedCount ?? result.failed_count ?? 0,
    missingCount: result.missingCount ?? result.missing_count ?? 0,
    bytesMB: result.bytes ? Math.round(result.bytes / 1024 / 1024 * 100) / 100 : 0,
    error: result.errors?.length ? result.errors.slice(0, 3).join(' | ') : '',
  };
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
      const result = await ExportDebug.invoke(
        dbg,
        'save_images_to_existing_folder_by_keys',
        { folder, imgKeys: batch },
        { keyCount: batch.length, batchIndex, batchCount }
      );
      const normalized = normalizeExportSaveResult(result);
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
      const updateProgress = createExportProgressUpdater(imageObjs.length, busyPill);
      await letExportUiPaint(dbg, 'before-resolve-keys');
      const stopResolveWatch = ExportDebug.watch(dbg, 'resolve-keys', { imageCount: imageObjs.length });
      const resolved = await resolveExportKeys(imageObjs, dbg, ({ preparedCount }) => {
        updateProgress('prepare-progress', preparedCount);
      }).finally(() => stopResolveWatch());
      const keys = resolved.keys;
      tempKeys = resolved.tempKeys;
      ExportDebug.step(dbg, 'keys:ready', { keyCount: keys.length, tempKeyCount: tempKeys.length, renderedCount: resolved.renderedCount });
      if (!keys.length) {
        finishPillTransition({ beforeTransition: hideInputShield, busyPill });
        stopTotalWatch({ skipped: true });
        ExportDebug.end(dbg, { skipped: true, reason: 'no-keys' });
        return;
      }
      updateProgress('save-start', imageObjs.length, {}, true);
      const saveResult = await saveExportKeysToFolderInBatches(folder, keys, dbg, 3, ({ finishedCount, totalCount, batchIndex, batchCount }) => {
        updateProgress('save-progress', imageObjs.length, { batchIndex, batchCount, savedKeyCount: finishedCount, keyCount: totalCount });
      });
      const savedCount = typeof saveResult === 'number' ? saveResult : (saveResult?.savedCount || 0);
      ExportDebug.step(dbg, 'save:result', normalizeExportSaveResult(saveResult));
      stopTotalWatch({ savedCount });
      ExportDebug.end(dbg, { savedCount, ...normalizeExportSaveResult(saveResult) });
      if (savedCount > 0) {
        finishPillTransition({
          beforeTransition: () => finishImageExportInputShield(clearSelectionAfter),
          busyPill,
          finalMsg: savedCount === 1 ? '1 Image Exported' : `${savedCount} Images Exported`,
        });
      }
      else {
        finishPillTransition({ beforeTransition: hideInputShield, busyPill });
      }
    } catch (err) {
      if (busyPill) finishPillTransition({ beforeTransition: hideInputShield, busyPill });
      else hideInputShield();
      stopTotalWatch({ error: String(err) });
      ExportDebug.end(dbg, { error: String(err) });
      console.error(errorLabel, err);
    } finally {
      cleanupExportTempKeys(tempKeys);
    }
    return;
  }

  await downloadImageObjects(imageObjs, dbg);
  stopTotalWatch({ saved: true, method: 'download' });
  ExportDebug.end(dbg, { saved: true, method: 'download', imageCount: imageObjs.length });
  finishImageExportInputShield(clearSelectionAfter && imageObjs.length);
}

async function saveSelectedImages() {
  const multiSelection = isMultiSelected();
  const selectedObjs = selectedImageObjects();
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

async function exportAllText() {
  const dbg = ExportDebug.start('exportAllText', { objectCount: objects.length });
  const textObjs = [...objects].sort((a, b) => b.z - a.z).filter((o) => o.type === 'text');
  if (!textObjs.length) { ExportDebug.end(dbg, { skipped: true, reason: 'no-text' }); return; }
  const releaseInputShield = acquireInputShield();

  const combined = textObjs.map((o) => o.data.content).join('\n\n');
  ExportDebug.step(dbg, 'combined', { textCount: textObjs.length, combinedLen: combined.length });

  if (hasTauri()) {
    try {
      const path = await ExportDebug.invoke(dbg, 'save_text_file_dialog', {}, { textCount: textObjs.length });
      ExportDebug.step(dbg, 'text:path-selected', { selected: !!path });
      if (!path) {
        releaseInputShield();
        ExportDebug.end(dbg, { saved: false, cancelled: true });
        return;
      }
      await runShieldedPillTask({
        releaseInputShield,
        successMessage: 'Text Exported',
        task: () => ExportDebug.invoke(dbg, 'write_text_file', { path, text: combined }, { textCount: textObjs.length, textLen: combined.length }),
      });
      ExportDebug.end(dbg, { saved: true });
    } catch (err) {
      releaseInputShield();
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Export all text failed:', err);
    }
    return;
  }

  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  const blob = new Blob([combined], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `text_${hex}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  releaseInputShield();
  ExportDebug.end(dbg, { saved: true, method: 'download', textCount: textObjs.length });
}

async function pasteAtPos(wx, wy, clipboardData = null) {
  const dbg = ClipDebug.start('pasteAtPos', {
    wx,
    wy,
    hasJsClipboard: !!jsClipboard,
    jsClipboardType: jsClipboard?.type,
    clipboardData: describeClipboardData(clipboardData),
  });
  if (_pasteInProgress) {
    ClipDebug.end(dbg, { path: 'paste-busy', skipped: 'paste-in-progress' });
    return;
  }
  _pasteInProgress = true;
  try {
    if (jsClipboard && !(await jsClipboardStillCurrent(dbg))) {
      ClipDebug.step(dbg, 'clear-stale-jsClipboard', { expectedSequence: _jsClipboardSequence });
      clearJsClipboard();
    }
    if (jsClipboard) {
      if (jsClipboard.type === 'objects') {
        const sourceObjects = jsClipboard.objects || [];
        const imgData = jsClipboard.imageData || {};
        const imgEntries = Object.entries(imgData);
        ClipDebug.step(dbg, 'paste:objects-start', { objectCount: sourceObjects.length, imageCount: imgEntries.length });
        const cloneStart = performance.now();
        const clones = cloneObjects(sourceObjects);
        ClipDebug.step(dbg, 'paste:clone-done', { objectCount: clones.length, ms: Math.round((performance.now() - cloneStart) * 100) / 100 });
        if (!clones.length) { ClipDebug.end(dbg, { skipped: 'empty-jsClipboard' }); return; }
        // Re-register image data in case we're on a different board
        let registeredImages = 0;
        let processedImages = 0;
        for (const [key, src] of imgEntries) {
          processedImages++;
          if (!imageStore[key]) { imageStore[key] = src; cacheImage(key, src); registeredImages++; }
          if (processedImages === 1 || processedImages % 50 === 0 || processedImages === imgEntries.length) {
            ClipDebug.step(dbg, 'paste:register-images-progress', {
              processed: processedImages,
              imageCount: imgEntries.length,
              registeredImages,
            });
          }
        }
        ClipDebug.step(dbg, 'paste:register-images-done', { imageCount: imgEntries.length, registeredImages });
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const o of clones) {
          minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
          maxX = Math.max(maxX, o.x + o.w); maxY = Math.max(maxY, o.y + o.h);
        }
        const dx = wx - (minX + maxX) / 2, dy = wy - (minY + maxY) / 2;
        selectedIds.clear();
        let processedObjects = 0;
        ClipDebug.step(dbg, 'paste:objects-add-start', { objectCount: clones.length });
        for (const o of clones) {
          processedObjects++;
          o.id = newId(); o.x += dx; o.y += dy; o.z = ++zCounter;
          objects.push(o); objectsMap.set(o.id, o); selectedIds.add(o.id);
          if (processedObjects === 1 || processedObjects % 50 === 0 || processedObjects === clones.length) {
            ClipDebug.step(dbg, 'paste:objects-add-progress', {
              processed: processedObjects,
              objectCount: clones.length,
              registeredImages,
            });
          }
        }
        selectedId = clones[clones.length - 1].id;
        ClipDebug.step(dbg, 'paste:objects-add-done', { objectCount: clones.length, registeredImages });
        scheduleRender(true, true);
        ClipDebug.step(dbg, 'paste:boardHistory-start', { objectCount: clones.length });
        pushHistory('paste-objects');
        ClipDebug.step(dbg, 'paste:boardHistory-done', { historyIndex });
        ClipDebug.end(dbg, { path: 'jsClipboard', objectCount: clones.length, registeredImages, historyIndex });
        return;
      }
    }
    const eventImage = readClipboardImageDataUrlFromEvent(clipboardData, dbg);
    if (eventImage) {
      try {
        const imgKey = newImgKey();
        const dataUrl = await eventImage;
        ClipDebug.step(dbg, 'event-image-read', { imgKey, dataUrl });
        await pasteDataUrlImage(dataUrl, wx, wy, imgKey, 'event-image', dbg);
        return;
      } catch (err) {
        hideInputShield();
        ClipDebug.step(dbg, 'event-image-miss', { error: String(err) });
      }
    }
    const eventText = readClipboardTextFromEvent(clipboardData);
    if (eventText && eventText.trim()) {
      addText(wx - 100, wy - 40, eventText);
      ClipDebug.end(dbg, { path: 'event-text', textLen: eventText.length });
      return;
    }
    if (!hasTauri()) {
      try {
        const imgKey = newImgKey();
        const dataUrl = await readClipboardImageDataUrlFromBrowser(dbg);
        if (dataUrl) {
          ClipDebug.step(dbg, 'browser-image-read', { imgKey, dataUrl });
          await pasteDataUrlImage(dataUrl, wx, wy, imgKey, 'browser-image', dbg);
          return;
        }
      } catch (err) {
        ClipDebug.step(dbg, 'browser-image-miss', { error: String(err) });
      }
    }
    if (hasTauri()) {
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        const imgKey = newImgKey();
        const dataUrl = await ClipDebug.invoke(dbg, 'read_image_from_clipboard_cached', { imgKey }, { imgKey });
        ClipDebug.step(dbg, 'native-image-read', { imgKey, dataUrl });
        await pasteDataUrlImage(dataUrl, wx, wy, imgKey, 'native-image', dbg);
        return;
      } catch (err) {
        hideInputShield();
        ClipDebug.step(dbg, 'native-image-miss', { error: String(err) });
        try {
          const text = await ClipDebug.invoke(dbg, 'read_text_from_clipboard');
          if (text && text.trim()) addText(wx - 100, wy - 40, text);
          ClipDebug.end(dbg, { path: 'native-text', textLen: text?.length || 0 });
          return;
        } catch (textErr) {
          ClipDebug.end(dbg, { path: 'native-empty', error: String(textErr) });
        }
        return;
      }
    }
    showInputShield();
    try {
      const dataUrl = await readClipboardImageDataUrlFromBrowser(dbg);
      if (dataUrl) {
        const imgKey = newImgKey();
        ClipDebug.step(dbg, 'web-image-read', { imgKey, dataUrl });
        hideInputShield();
        await pasteDataUrlImage(dataUrl, wx, wy, imgKey, 'web-image', dbg);
        return;
      }
      hideInputShield();
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) addText(wx - 100, wy - 40, text);
      ClipDebug.end(dbg, { path: 'web-text', textLen: text?.length || 0 });
    } catch (err) {
      hideInputShield();
      ClipDebug.end(dbg, { path: 'web-empty', error: String(err) });
    }
  } finally {
    _pasteInProgress = false;
  }
}

document.addEventListener('paste', (e) => {
  if (editingId) return;
  e.preventDefault();
  if (isBoardInputBlocked()) return;
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  pasteAtPos(center.x, center.y, e.clipboardData);
});

// ─── Init ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);
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

// Open a .bf file by path — used for startup file and macOS open events
async function openFilePath(filePath) {
  const dbg = OpenDebug.start('openFilePath', { path: filePath, currentFilePath, objectCount: objects.length });
  if (!(await confirmDirtyBeforeOpen(dbg))) return;
  await openBoardFromPath(filePath, dbg, 'Failed to open file:');
}

if (hasTauri()) {
  // macOS double-click (app already running): Rust emits this event
  window.__TAURI__.event.listen('boardfish://open-file', (event) => {
    openFilePath(event.payload);
  });

  // Cold launch: check if Rust stored a file path before JS was ready
  tauriInvoke('get_startup_file').then((filePath) => {
    if (filePath) openFilePath(filePath);
  });
}
