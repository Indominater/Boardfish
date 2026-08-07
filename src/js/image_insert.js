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
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, 'bulk-image-insert');
    else scheduleRender(true, true);
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

/* BOARDFISH_DEV_DIAGNOSTICS_START */
let imageFileDebugName = null;
if (typeof BOARDFISH_PRODUCTION === 'undefined') {
  imageFileDebugName = (file, fallback = 'clipboard-image') => (
    file?.name || `${fallback}.${webImageExtForFile(file)}`
  );
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

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

var _pendingImageInsertPoint = null;

function addImageObject(imgKey, cx, cy, w, h, options = {}, renderSource = 'add-image') {
  if (!BoardfishWebLimits.canAddObjects(1)) return null;
  const explicitZ = Number.isFinite(options.z) ? Number(options.z) : null;
  const z = explicitZ == null ? ++zCounter : explicitZ;
  if (explicitZ != null) zCounter = Math.max(zCounter, explicitZ);
  const obj = { id: newId(), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, z, data: { imgKey, flipX: false, flipY: false, rotation: 0 } };
  BoardfishEditorState.addObject(obj);
  const deferHistory = options.deferHistory ?? _bulkImageInsertDepth > 0;
  if (deferHistory) {
    if (editingId) exitEdit();
    BoardfishEditorState.setSelection([obj.id], { primaryId: obj.id, exitEditing: false });
    _bulkImageInsertAdded++;
    if (!options.suppressProgressRender) {
      const now = performance.now();
      if (now - _bulkImageInsertLastRender > 120) {
        _bulkImageInsertLastRender = now;
        if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, `${renderSource}-bulk-progress`);
        else scheduleRender(true, true);
      } else {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(false, true, `${renderSource}-bulk-overlay`);
        else scheduleRender(false, true);
      }
    }
  } else {
    if (editingId) exitEdit();
    BoardfishEditorState.setSelection([obj.id], { primaryId: obj.id, exitEditing: false });
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleRender(true, true, renderSource);
    else scheduleRender(true, true);
    pushHistory(renderSource);
  }
  return obj;
}

async function addImage(src, cx, cy, exactSize = false, existingImgKey = null, options = {}) {
  const displaySrc = isWebImageRef(src) ? webImageDisplaySrc(src) : src;
  if (typeof displaySrc !== 'string' || !displaySrc) return null;
  if (!options.webValidated && isImageDataUrl(src)) {
    const valid = await BoardfishWebLimits.validateDataUrlImage(src);
    if (!valid) return null;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let dbg = null;
  let t0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    dbg = ViewportDebug.start('addImage', { src: displaySrc, cx, cy, exactSize, existingImgKey, bitmapOnly: true });
    t0 = performance.now();
    ViewportDebug.count('imageAdds');
  }
  if (!_boardOpening) showInputShield();
  const imgKey = existingImgKey || newImgKey();
  const rollbackSource = createImageInsertSourceRollback(imgKey, src);
  try {
    BoardfishImageStore.setSource(imgKey, src);
    const cacheMetrics = await cacheImage(imgKey, src
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , null
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , {
      resolveOnLoad: options.resolveOnLoad === true,
      readyRenderMinIntervalMs: options.readyRenderMinIntervalMs,
    });
    const display = BoardfishImageStore.getDisplayImage?.(imgKey) || {};
    const naturalW = Number(cacheMetrics?.naturalWidth || display.naturalWidth || display.width || imageBitmapCache[imgKey]?.width || 0);
    const naturalH = Number(cacheMetrics?.naturalHeight || display.naturalHeight || display.height || imageBitmapCache[imgKey]?.height || 0);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      ViewportDebug.step(dbg, 'bitmap-ready', { width: naturalW, height: naturalH, ms: performance.now() - t0 });
    }
    if (!(naturalW > 0 && naturalH > 0)) {
      rollbackSource();
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        const total = performance.now() - t0;
        ViewportDebug.max('maxImageAddMs', total);
        ViewportDebug.end(dbg, { error: 'image bitmap failed', total });
      }
      return null;
    }
    const { w, h } = fitImageSize(naturalW, naturalH, exactSize);
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      ViewportDebug.step(dbg, 'size-object', { w, h });
      ViewportDebug.step(dbg, 'cache-registered', { imgKey, bitmapOnly: true });
      InsertDebug.step(options.insertDebug, 'cache:queued', {
        source: options.source || '',
        imgKey,
        resolveOnLoad: options.resolveOnLoad === true,
        sourceKind: imageSourceDebugInfo(src).kind,
        bitmapOnly: true,
      });
    }
    const obj = addImageObject(imgKey, cx, cy, w, h, options, 'add-image');
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      InsertDebug.step(options.insertDebug, 'object:add', {
        source: options.source || '',
        imgKey,
        objectId: obj?.id || '',
        w,
        h,
        z: obj?.z ?? '',
      });
    }
    if (!obj) rollbackSource();
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { id: obj?.id || '', imgKey, total, added: !!obj, bitmapOnly: true });
    }
    return obj;
  } catch (err) {
    rollbackSource();
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { error: String(err), total, bitmapOnly: true });
    }
    return null;
  } finally {
    if (!_boardOpening) hideInputShield();
  }
}

fileInput.addEventListener('change', async () => {
  const files = fileInput.files || [];
  const insertPoint = _pendingImageInsertPoint || ctxPos;
  try {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      await insertImageFiles(files, insertPoint.x, insertPoint.y, 'file-input');
    } else {
      await insertImageFiles(files, insertPoint.x, insertPoint.y);
    }
  } finally {
    _pendingImageInsertPoint = null;
    fileInput.value = '';
  }
});

async function pickAndInsertImages(x, y) {
  if (!BoardfishWebLimits.canAddObjects(1)) return;
  _pendingImageInsertPoint = { x, y };
  fileInput.value = '';
  fileInput.click();
}

const insertWebImageFile = async (file, x, y
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  , options = {}
) => {
  const imgKey = options.imgKey || newImgKey();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let fileName;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    fileName = imageFileDebugName(file);
    InsertDebug.step(dbg, 'read:start', {
      source: options.source,
      fileName,
      fileSize: file.size,
      fileType: file.type,
      readMode: 'array-buffer',
    });
  }
  const bytes = await readImageFileBytes(file);
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    InsertDebug.step(dbg, 'read:end', {
      source: options.source,
      fileName,
      fileSize: file.size,
      fileType: file.type,
      bytes: bytes.byteLength,
      readMode: 'array-buffer',
    });
  }
  const imageSource = createWebImageSourceFromBytes(file, imgKey, bytes);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let sourceInfo;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    sourceInfo = imageSourceDebugInfo(imageSource);
    InsertDebug.step(dbg, 'web-ref:create', {
      source: options.source,
      fileName,
      imgKey,
      sourceKind: sourceInfo.kind,
      bytes: bytes.byteLength,
      objectUrl: !!imageSource.objectUrl,
    });
  }
  const addOptions = {
    deferHistory: options.deferHistory,
    suppressProgressRender: options.suppressProgressRender,
    resolveOnLoad: options.resolveOnLoad === true,
    webValidated: true,
    z: options.z,
    readyRenderMinIntervalMs: options.readyRenderMinIntervalMs,
  };
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    addOptions.insertDebug = dbg;
    addOptions.source = options.source;
  }
  const addPromise = addImage(imageSource, x, y, false, imgKey, addOptions);
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
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
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
  }
  return obj;
};

async function insertImageFiles(files, x, y
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , source = 'file-input'
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const fileCount = files.length;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let dbg = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    dbg = InsertDebug.start('insertImages', { source, fileCount });
  }
  if (!fileCount) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') InsertDebug.end(dbg, { source, skipped: 'no-files' });
    return;
  }
  let added = 0;
  const accepted = [];
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let dropped = null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    dropped = { type: 0, objectLimit: 0, contentLimit: 0 };
  }
  let contentLimitDropped = false;
  const supportedFiles = [];
  let acceptedBytes = 0;
  for (const file of files) {
    if (!isWebInsertImageFile(file)) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        dropped.type++;
        InsertDebug.step(dbg, 'file:skip', { source, fileName: file?.name || '', fileSize: file?.size ?? '', fileType: file?.type || '', skipped: 'unsupported-type' });
      }
      continue;
    }
    supportedFiles.push(file);
  }
  if (!supportedFiles.length) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      InsertDebug.end(dbg, { source, fileCount, added: 0, skipped: 'no-supported-files', ...dropped });
    }
    return;
  }
  if (!BoardfishWebLimits.canAddObjects(supportedFiles.length)) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      dropped.objectLimit = supportedFiles.length;
      InsertDebug.end(dbg, { source, fileCount, supportedFileCount: supportedFiles.length, added: 0, skipped: 'web-object-limit', ...dropped });
    }
    return;
  }
  for (const file of supportedFiles) {
    const projectedBytes = acceptedBytes + Number(file.size || 0);
    const projectedObjects = accepted.length + 1;
    if (!BoardfishWebLimits.canAcceptAdditionalContentBytes(projectedBytes, projectedObjects, { notifyUser: false })) {
      contentLimitDropped = true;
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        dropped.contentLimit++;
        InsertDebug.step(dbg, 'file:skip', { source, fileName: file.name, fileSize: file.size, fileType: file.type, skipped: 'web-content-limit' });
      }
      continue;
    }
    acceptedBytes = projectedBytes;
    accepted.push(file);
  }
  const bulk = accepted.length > 1;
  if (!accepted.length) {
    if (contentLimitDropped) BoardfishWebLimits.notify(BoardfishWebLimits.boardContentLimitMessage());
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      InsertDebug.end(dbg, { source, fileCount, added: 0, skipped: 'no-supported-files', ...dropped });
    }
    return;
  }
  const concurrency = webImageInsertConcurrency(accepted.length);
  const bulkZBase = bulk ? zCounter + 1 : null;
  const addedIds = new Array(accepted.length);
  showInputShield();
  if (bulk) {
    beginBulkImageInsert();
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      InsertDebug.step(dbg, 'bulk:start', { source, fileCount: accepted.length, concurrency, bytes: acceptedBytes });
    }
  }
  try {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      InsertDebug.step(dbg, 'web:concurrency', { source, fileCount: accepted.length, concurrency, bytes: acceptedBytes });
    }
    await mapWithConcurrency(accepted, concurrency, async (file, acceptedIndex) => {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      let fileDbg = null;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        fileDbg = InsertDebug.start('insertImage', { source, fileName: file.name, fileSize: file.size, fileType: file.type });
      }
      try {
        const insertOptions = {
          deferHistory: bulk,
          holdShield: true,
          suppressProgressRender: bulk,
          resolveOnLoad: true,
          imgKey: newImgKey(),
          z: bulkZBase == null ? undefined : bulkZBase + acceptedIndex,
          readyRenderMinIntervalMs: bulk ? WEB_BULK_IMAGE_READY_RENDER_INTERVAL_MS : undefined,
        };
        if (typeof BOARDFISH_PRODUCTION === 'undefined') insertOptions.source = source;
        const obj = await insertWebImageFile(file, x, y
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          , fileDbg
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          , insertOptions
        );
        if (obj) {
          addedIds[acceptedIndex] = obj.id;
          added++;
        }
      } catch (err) {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          InsertDebug.end(fileDbg, { source, fileName: file.name, fileSize: file.size, fileType: file.type, error: String(err) });
        }
      }
    }, false);
  } finally {
    if (bulk) {
      const ids = addedIds.filter(Boolean);
      const primaryId = ids[ids.length - 1];
      if (primaryId) {
        BoardfishEditorState.setSelection(ids, {
          primaryId,
          exitEditing: false,
        });
      }
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        const historyAdded = finishBulkImageInsert({ pushHistoryEntry: added > 0 });
        InsertDebug.step(dbg, 'bulk:end', { source, added, historyAdded });
      } else {
        finishBulkImageInsert({ pushHistoryEntry: added > 0 });
      }
    }
    hideInputShield();
    if (contentLimitDropped) BoardfishWebLimits.notify(BoardfishWebLimits.boardContentLimitMessage());
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      InsertDebug.end(dbg, { source, fileCount, acceptedFileCount: accepted.length, added, concurrency, ...dropped });
    }
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
  const files = event.dataTransfer?.files || [];
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
    await openBoardFileRef(BoardfishRuntime.fileRefFromFile(boardFile));
    return;
  }
  const wp = toWorld(event.clientX, event.clientY);
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    await insertImageFiles(files, wp.x, wp.y, 'web-drop');
  } else {
    await insertImageFiles(files, wp.x, wp.y);
  }
});
