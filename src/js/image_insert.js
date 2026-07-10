'use strict';

const WEB_IMAGE_INSERT_CONCURRENCY = 3;
const WEB_BULK_IMAGE_READY_RENDER_INTERVAL_MS = 450;

const webImageInsertConcurrency = (count) => (
  Math.max(1, Math.min(WEB_IMAGE_INSERT_CONCURRENCY, Number(count) || 1))
);

function beginBulkImageInsert() {
  _bulkImageInsertDepth++;
  _bulkImageInsertAdded = 0;
  _bulkImageInsertLastRender = 0;
}

function finishBulkImageInsert({ pushHistoryEntry = true } = {}) {
  if (_bulkImageInsertDepth > 0) _bulkImageInsertDepth--;
  if (_bulkImageInsertDepth === 0 && _bulkImageInsertAdded > 0) {
    invalidateOffscreen();
    scheduleRender(true, true, 'bulk-image-insert');
    if (pushHistoryEntry) pushHistory('bulk-image-insert');
  }
  const added = _bulkImageInsertAdded;
  if (_bulkImageInsertDepth === 0) {
    _bulkImageInsertAdded = 0;
    _bulkImageInsertLastRender = 0;
  }
  return added;
}

function fitImageSize(naturalW, naturalH, exactSize = false) {
  let w = naturalW;
  let h = naturalH;
  if (!exactSize) {
    const MAX = 600;
    if (w > MAX || h > MAX) {
      const scale = MAX / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
  }
  return { w, h };
}

var isImageDataUrl = (src) => typeof src === 'string' && /^data:image\/(?:png|jpeg);base64,/i.test(src);

const isWebInsertImageFile = (file) => (
  file?.type === 'image/png' || file?.type === 'image/jpeg'
);

const webImageExtForFile = (file) => (
  file?.type === 'image/jpeg' ? 'jpg' : 'png'
);

const webImageMimeForFile = (file) => (
  file?.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
);

const imageFileDebugName = (file, fallback = 'clipboard-image') => (
  file?.name || `${fallback}.${webImageExtForFile(file)}`
);

const readImageFileBytes = (file) => {
  if (file && typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(new Uint8Array(ev.target.result));
    reader.onerror = () => reject(reader.error || new Error('failed to read image file'));
    reader.readAsArrayBuffer(file);
  });
};

const createWebImageSourceFromBytes = (file, imgKey, bytes) => {
  const ext = webImageExtForFile(file);
  const mime = webImageMimeForFile(file);
  if (typeof BoardfishWebBoardContainer !== 'undefined' && BoardfishWebBoardContainer?.createWebImageRef) {
    const refOptions = {
      path: `images/${imgKey}.${ext}`,
      mime,
      ext,
    };
    if (typeof Blob === 'function') refOptions.blob = new Blob([bytes], { type: mime });
    else refOptions.bytes = bytes;
    return BoardfishWebBoardContainer.createWebImageRef(refOptions);
  }
  if (typeof BoardfishWebBoardContainer !== 'undefined' && BoardfishWebBoardContainer?.bytesToDataUrl) {
    return BoardfishWebBoardContainer.bytesToDataUrl(bytes, mime);
  }
  throw new Error('web image container unavailable');
};

const rollbackImageInsertSource = ({
  imgKey,
  source,
  hadPreviousSource = false,
  previousSource = undefined,
} = {}) => {
  if (
    imgKey
    && typeof imageStore !== 'undefined'
    && typeof BoardfishImageStore !== 'undefined'
    && BoardfishImageStore.getSource?.(imgKey) === source
  ) {
    if (hadPreviousSource) {
      BoardfishImageStore.setSource(imgKey, previousSource);
    } else {
      if (typeof removeImageRuntimeCachesForKey === 'function') removeImageRuntimeCachesForKey(imgKey, source);
      delete imageStore[imgKey];
    }
    return true;
  }
  return false;
};

const createImageInsertSourceRollback = (imgKey, source) => {
  const canCapture = !!(
    imgKey
    && typeof imageStore !== 'undefined'
    && typeof BoardfishImageStore !== 'undefined'
  );
  const hadPreviousSource = canCapture && Object.hasOwn(imageStore, imgKey);
  const previousSource = hadPreviousSource ? imageStore[imgKey] : undefined;
  let rolledBack = false;
  return () => {
    if (rolledBack) return false;
    rolledBack = true;
    return rollbackImageInsertSource({ imgKey, source, hadPreviousSource, previousSource });
  };
};

const cleanupFailedWebImageInsertSource = (imgKey, imageSource) => {
  rollbackImageInsertSource({ imgKey, source: imageSource });
  if (typeof BoardfishWebBoardContainer !== 'undefined') {
    BoardfishWebBoardContainer.revokeImageSource?.(imageSource);
  }
};

const pendingInsertedImageMotions = new Map();

const queueImageObjectInsertMotion = (obj, options = {}) => {
  if (!obj?.id || options.animateInsert === false) return;
  pendingInsertedImageMotions.set(obj.id, {
    obj,
    action: options.insertMotionAction || 'image-object-create',
  });
};

const clearInsertedImageMotions = (ids = null) => {
  if (ids == null) {
    const cleared = pendingInsertedImageMotions.size;
    pendingInsertedImageMotions.clear();
    return cleared;
  }
  const iterable = typeof ids === 'string' ? [ids] : ids;
  if (!iterable || typeof iterable[Symbol.iterator] !== 'function') return 0;
  let cleared = 0;
  for (const id of iterable) {
    if (pendingInsertedImageMotions.delete(id)) cleared++;
  }
  return cleared;
};

const clearStaleInsertedImageMotions = () => {
  let cleared = 0;
  for (const [id, pending] of pendingInsertedImageMotions) {
    if (objectsMap.get(id) === pending.obj) continue;
    pendingInsertedImageMotions.delete(id);
    cleared++;
  }
  return cleared;
};

const noteInsertedImageObjectDrawn = (obj) => {
  const pending = pendingInsertedImageMotions.get(obj?.id);
  if (!pending) return;
  pendingInsertedImageMotions.delete(obj.id);
  if (objectsMap.get(obj.id) !== obj) return;
  const start = () => {
    if (objectsMap.get(obj.id) !== obj) return;
    globalThis.BoardfishMotion?.applyActionAnimation?.(
      pending.action || 'image-object-create',
      { objects: [obj] }
    );
    scheduleRender(true, true, 'image-insert-jello');
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(start);
  else start();
};

globalThis.BoardfishImageInsertMotion = Object.freeze({
  clear: clearInsertedImageMotions,
  clearStale: clearStaleInsertedImageMotions,
  noteDrawn: noteInsertedImageObjectDrawn,
});

var _pendingImageInsertPoint = null;

function addImageObject(imgKey, cx, cy, w, h, options = {}, renderSource = 'add-image') {
  if (!BoardfishWebLimits.canAddObjects(1)) return null;
  const explicitZ = Number.isFinite(options.z) ? Number(options.z) : null;
  const z = explicitZ == null ? ++zCounter : explicitZ;
  if (explicitZ != null) zCounter = Math.max(zCounter, explicitZ);
  const obj = { id: newId(), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, z, data: { imgKey } };
  BoardfishEditorState.addObject(obj);
  const deferHistory = options.deferHistory ?? _bulkImageInsertDepth > 0;
  if (deferHistory) {
    if (editingId) exitEdit();
    BoardfishEditorState.setSelection([obj.id], { primaryId: obj.id, exitEditing: false, animateSelection: false });
    _bulkImageInsertAdded++;
    if (!options.suppressProgressRender) {
      const now = performance.now();
      if (now - _bulkImageInsertLastRender > 120) {
        _bulkImageInsertLastRender = now;
        scheduleRender(true, true, `${renderSource}-bulk-progress`);
      } else {
        scheduleRender(false, true, `${renderSource}-bulk-overlay`);
      }
    }
  } else {
    if (editingId) exitEdit();
    BoardfishEditorState.setSelection([obj.id], { primaryId: obj.id, exitEditing: false, animateSelection: false });
    scheduleRender(true, true, renderSource);
    pushHistory(renderSource);
  }
  queueImageObjectInsertMotion(obj, options);
  return obj;
}

async function addImage(src, cx, cy, exactSize = false, existingImgKey = null, options = {}) {
  const displaySrc = isWebImageRef(src) ? webImageDisplaySrc(src) : src;
  if (typeof displaySrc !== 'string' || !displaySrc) return null;
  if (!options.webValidated && isImageDataUrl(src)) {
    const valid = await BoardfishWebLimits.validateDataUrlImage(src, 'image');
    if (!valid) return null;
  }
  const dbg = ViewportDebug.start('addImage', { src: displaySrc, cx, cy, exactSize, existingImgKey, bitmapOnly: true });
  const t0 = performance.now();
  ViewportDebug.count('imageAdds');
  if (!_boardOpening) showInputShield();
  const imgKey = existingImgKey || newImgKey();
  const rollbackSource = createImageInsertSourceRollback(imgKey, src);
  try {
    BoardfishImageStore.setSource(imgKey, src);
    const cacheMetrics = await cacheImage(imgKey, src, null, null, {
      resolveOnLoad: options.resolveOnLoad === true,
      readyRenderMinIntervalMs: options.readyRenderMinIntervalMs,
    });
    const display = BoardfishImageStore.getDisplayImage?.(imgKey) || {};
    const naturalW = Number(cacheMetrics?.naturalWidth || display.naturalWidth || display.width || imageBitmapCache[imgKey]?.width || 0);
    const naturalH = Number(cacheMetrics?.naturalHeight || display.naturalHeight || display.height || imageBitmapCache[imgKey]?.height || 0);
    ViewportDebug.step(dbg, 'bitmap-ready', { width: naturalW, height: naturalH, ms: performance.now() - t0 });
    if (!(naturalW > 0 && naturalH > 0)) {
      rollbackSource();
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { error: 'image bitmap failed', total });
      return null;
    }
    const { w, h } = fitImageSize(naturalW, naturalH, exactSize);
    ViewportDebug.step(dbg, 'size-object', { w, h });
    ViewportDebug.step(dbg, 'cache-registered', { imgKey, bitmapOnly: true });
    InsertDebug.step(options.insertDebug, 'cache:queued', {
      source: options.source || '',
      imgKey,
      resolveOnLoad: options.resolveOnLoad === true,
      sourceKind: imageSourceDebugInfo(src).kind,
      bitmapOnly: true,
    });
    const obj = addImageObject(imgKey, cx, cy, w, h, options, 'add-image');
    InsertDebug.step(options.insertDebug, 'object:add', {
      source: options.source || '',
      imgKey,
      objectId: obj?.id || '',
      w,
      h,
      z: obj?.z ?? '',
    });
    if (!obj) rollbackSource();
    const total = performance.now() - t0;
    ViewportDebug.max('maxImageAddMs', total);
    ViewportDebug.end(dbg, { id: obj?.id || '', imgKey, total, added: !!obj, bitmapOnly: true });
    return obj;
  } catch (err) {
    rollbackSource();
    const total = performance.now() - t0;
    ViewportDebug.max('maxImageAddMs', total);
    ViewportDebug.end(dbg, { error: String(err), total, bitmapOnly: true });
    return null;
  } finally {
    if (!_boardOpening) hideInputShield();
  }
}

function imageInsertFilesFromList(fileList) {
  const files = [];
  for (const file of fileList || []) files.push(file);
  return files;
}

fileInput.addEventListener('change', async () => {
  const files = imageInsertFilesFromList(fileInput.files);
  const insertPoint = _pendingImageInsertPoint || ctxPos;
  if (!files.length) globalThis.BoardfishMotion?.applyActionAnimation?.('file-dialog-cancel');
  try {
    await insertImageFiles(files, insertPoint.x, insertPoint.y, 'file-input');
  } finally {
    _pendingImageInsertPoint = null;
    fileInput.value = '';
  }
});

async function pickAndInsertImages(x, y) {
  if (!BoardfishWebLimits.canAddObjects(1)) return;
  _pendingImageInsertPoint = { x, y };
  fileInput.value = '';
  globalThis.BoardfishMotion?.applyActionAnimation?.('image-file-dialog-open');
  fileInput.click();
}

const insertWebImageFile = async (file, x, y, dbg, options = {}) => {
  const imgKey = options.imgKey || newImgKey();
  const fileName = imageFileDebugName(file);
  InsertDebug.step(dbg, 'read:start', {
    source: options.source,
    fileName,
    fileSize: file.size,
    fileType: file.type,
    readMode: 'array-buffer',
  });
  const bytes = await readImageFileBytes(file);
  InsertDebug.step(dbg, 'read:end', {
    source: options.source,
    fileName,
    fileSize: file.size,
    fileType: file.type,
    bytes: bytes.byteLength,
    readMode: 'array-buffer',
  });
  const imageSource = createWebImageSourceFromBytes(file, imgKey, bytes);
  const sourceInfo = imageSourceDebugInfo(imageSource);
  InsertDebug.step(dbg, 'web-ref:create', {
    source: options.source,
    fileName,
    imgKey,
    sourceKind: sourceInfo.kind,
    bytes: bytes.byteLength,
    objectUrl: !!imageSource.objectUrl,
  });
  const addPromise = addImage(imageSource, x, y, false, imgKey, {
    deferHistory: options.deferHistory,
    suppressProgressRender: options.suppressProgressRender,
    resolveOnLoad: options.resolveOnLoad === true,
    webValidated: true,
    insertDebug: dbg,
    source: options.source,
    z: options.z,
    animateInsert: options.animateInsert,
    readyRenderMinIntervalMs: options.readyRenderMinIntervalMs,
  });
  if (!options.holdShield) hideInputShield();
  let obj;
  try {
    obj = await addPromise;
  } catch (err) {
    cleanupFailedWebImageInsertSource(imgKey, imageSource);
    if (!options.holdShield) showInputShield();
    throw err;
  }
  if (!options.holdShield) showInputShield();
  if (!obj) cleanupFailedWebImageInsertSource(imgKey, imageSource);
  InsertDebug.end(dbg, {
    added: !!obj,
    source: options.source,
    fileName,
    fileSize: file.size,
    fileType: file.type,
    imgKey,
    sourceKind: sourceInfo.kind,
    bytes: bytes.byteLength,
  });
  return obj;
};

async function insertImageFiles(files, x, y, source = 'file-input') {
  const dbg = InsertDebug.start('insertImages', { source, fileCount: files.length });
  if (!files.length) { InsertDebug.end(dbg, { source, skipped: 'no-files' }); return; }
  let added = 0;
  const readyPromises = [];
  const accepted = [];
  const dropped = { type: 0, objectLimit: 0, contentLimit: 0 };
  const supportedFiles = [];
  let acceptedBytes = 0;
  for (const file of files) {
    if (!isWebInsertImageFile(file)) {
      dropped.type++;
      InsertDebug.step(dbg, 'file:skip', { source, fileName: file?.name || '', fileSize: file?.size ?? '', fileType: file?.type || '', skipped: 'unsupported-type' });
      continue;
    }
    supportedFiles.push(file);
  }
  if (!supportedFiles.length) {
    InsertDebug.end(dbg, { source, fileCount: files.length, added: 0, skipped: 'no-supported-files', ...dropped });
    return;
  }
  if (!BoardfishWebLimits.canAddObjects(supportedFiles.length)) {
    dropped.objectLimit = supportedFiles.length;
    InsertDebug.end(dbg, { source, fileCount: files.length, supportedFileCount: supportedFiles.length, added: 0, skipped: 'web-object-limit', ...dropped });
    return;
  }
  for (const file of supportedFiles) {
    const projectedBytes = acceptedBytes + Number(file.size || 0);
    const projectedObjects = accepted.length + 1;
    if (!BoardfishWebLimits.canAcceptAdditionalContentBytes(projectedBytes, projectedObjects, { notifyUser: false })) {
      dropped.contentLimit++;
      InsertDebug.step(dbg, 'file:skip', { source, fileName: file.name, fileSize: file.size, fileType: file.type, skipped: 'web-content-limit' });
      continue;
    }
    acceptedBytes = projectedBytes;
    accepted.push({ file, acceptedIndex: accepted.length });
  }
  const bulk = accepted.length > 1;
  if (!accepted.length) {
    if (dropped.contentLimit > 0) BoardfishWebLimits.notify(BoardfishWebLimits.boardContentLimitMessage());
    InsertDebug.end(dbg, { source, fileCount: files.length, added: 0, skipped: 'no-supported-files', ...dropped });
    return;
  }
  const concurrency = webImageInsertConcurrency(accepted.length);
  const bulkZBase = bulk ? zCounter + 1 : null;
  const addedObjects = new Array(accepted.length);
  showInputShield();
  if (bulk) {
    beginBulkImageInsert();
    InsertDebug.step(dbg, 'bulk:start', { source, fileCount: accepted.length, concurrency, bytes: acceptedBytes });
  }
  try {
    InsertDebug.step(dbg, 'web:concurrency', { source, fileCount: accepted.length, concurrency, bytes: acceptedBytes });
    await mapWithConcurrency(accepted, concurrency, async ({ file, acceptedIndex }) => {
      const fileDbg = InsertDebug.start('insertImage', { source, fileName: file.name, fileSize: file.size, fileType: file.type });
      try {
        const obj = await insertWebImageFile(file, x, y, fileDbg, {
          source,
          deferHistory: bulk,
          holdShield: true,
          suppressProgressRender: bulk,
          resolveOnLoad: true,
          imgKey: newImgKey(),
          z: bulkZBase == null ? undefined : bulkZBase + acceptedIndex,
          insertMotionAction: bulk ? 'bulk-image-create' : undefined,
          readyRenderMinIntervalMs: bulk ? WEB_BULK_IMAGE_READY_RENDER_INTERVAL_MS : undefined,
        });
        if (obj) {
          addedObjects[acceptedIndex] = obj;
          added++;
          readyPromises.push(imageReadyPromiseForKey(obj.data.imgKey).then((metrics) => {
            InsertDebug.step(fileDbg, 'ready', {
              source,
              fileName: file.name,
              imgKey: obj.data.imgKey,
              cacheReadyStage: metrics?.cacheReadyStage || '',
              cacheTotalMs: metrics?.cacheTotalMs ?? '',
              cacheQueueWaitMs: metrics?.cacheQueueWaitMs ?? '',
              cacheBitmapMs: metrics?.cacheBitmapMs ?? '',
              bitmapReady: !!imageBitmapCache[obj.data.imgKey],
            });
            return metrics;
          }));
        }
      } catch (err) {
        InsertDebug.end(fileDbg, { source, fileName: file.name, fileSize: file.size, fileType: file.type, error: String(err) });
      }
    });
  } finally {
    if (readyPromises.length) {
      InsertDebug.step(dbg, 'ready:wait-start', { source, added, readyCount: readyPromises.length });
      await Promise.allSettled(readyPromises);
      InsertDebug.step(dbg, 'ready:wait-end', { source, added, readyCount: readyPromises.length });
    }
    if (bulk) {
      const orderedAddedObjects = [];
      for (const obj of addedObjects) {
        if (obj) orderedAddedObjects.push(obj);
      }
      const primaryObj = orderedAddedObjects[orderedAddedObjects.length - 1];
      if (primaryObj) {
        const ids = new Array(orderedAddedObjects.length);
        for (let i = 0; i < orderedAddedObjects.length; i++) ids[i] = orderedAddedObjects[i].id;
        BoardfishEditorState.setSelection(ids, {
          primaryId: primaryObj.id,
          exitEditing: false,
          animateSelection: false,
        });
      }
      const historyAdded = finishBulkImageInsert({ pushHistoryEntry: added > 0 });
      InsertDebug.step(dbg, 'bulk:end', { source, added, historyAdded });
    }
    hideInputShield();
    if (dropped.contentLimit > 0) BoardfishWebLimits.notify(BoardfishWebLimits.boardContentLimitMessage());
    InsertDebug.end(dbg, { source, fileCount: files.length, acceptedFileCount: accepted.length, added, concurrency, ...dropped });
  }
}

canvas.addEventListener('dragover', (event) => {
  let hasFile = false;
  for (const item of event.dataTransfer?.items || []) {
    if (item.kind === 'file') {
      hasFile = true;
      break;
    }
  }
  if (!hasFile) return;
  event.preventDefault();
});

canvas.addEventListener('drop', async (event) => {
  const files = imageInsertFilesFromList(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.preventDefault();
  let boardFile = null;
  for (const file of files) {
    if (/\.bf$/i.test(file.name || '')) {
      boardFile = file;
      break;
    }
  }
  if (boardFile && typeof openBoardFileRef === 'function') {
    globalThis.BoardfishMotion?.applyActionAnimation?.('board-file-drop-open');
    await openBoardFileRef(BoardfishRuntime.fileRefFromFile(boardFile));
    return;
  }
  const wp = toWorld(event.clientX, event.clientY);
  globalThis.BoardfishMotion?.applyActionAnimation?.('image-file-drop');
  await insertImageFiles(files, wp.x, wp.y, 'web-drop');
});
