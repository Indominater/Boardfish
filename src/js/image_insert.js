'use strict';

const NATIVE_IMAGE_INSERT_CONCURRENCY = 3;
const WEB_IMAGE_INSERT_CONCURRENCY = 3;
const WEB_BULK_IMAGE_READY_RENDER_INTERVAL_MS = 450;

const nativeImageInsertConcurrency = (count) => (
  Math.max(1, Math.min(NATIVE_IMAGE_INSERT_CONCURRENCY, Number(count) || 1))
);

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

var NATIVE_DATA_URL_IMAGE_CACHE_THRESHOLD = 2 * 1024 * 1024;

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
    return BoardfishWebBoardContainer.createWebImageRef({
      path: `images/${imgKey}.${ext}`,
      mime,
      ext,
      bytes,
    });
  }
  if (typeof BoardfishWebBoardContainer !== 'undefined' && BoardfishWebBoardContainer?.bytesToDataUrl) {
    return BoardfishWebBoardContainer.bytesToDataUrl(bytes, mime);
  }
  throw new Error('web image container unavailable');
};

function shouldUseNativeDataUrlImageCache(src) {
  return hasTauri() && isImageDataUrl(src) && src.length >= NATIVE_DATA_URL_IMAGE_CACHE_THRESHOLD;
}

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
    BoardfishEditorState.setSelection([obj.id], { primaryId: obj.id, exitEditing: false });
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
    selectObject(obj.id);
    scheduleRender(true, false, renderSource);
    pushHistory(renderSource);
  }
  return obj;
}

async function addDataUrlImageViaNativeCache(src, cx, cy, exactSize = false, existingImgKey = null, options = {}) {
  const dbg = ViewportDebug.start('addImage', {
    src,
    cx,
    cy,
    exactSize,
    existingImgKey,
    path: 'native-data-url-cache',
  });
  const t0 = performance.now();
  ViewportDebug.count('imageAdds');
  ViewportDebug.count('nativeImageAdds');
  if (!_boardOpening) showInputShield();
  const imgKey = existingImgKey || newImgKey();
  const generation = _imageStoreGeneration;
  const sourceToken = createImageSourceToken(imgKey);
  try {
    ViewportDebug.step(dbg, 'native-data-url-register:start', { imgKey, dataUrl: src });
    const meta = await BoardfishTauri.registerImageSource(imgKey, src, sourceToken);
    if (generation !== _imageStoreGeneration) {
      cleanupNativeImageSourceToken(imgKey, sourceToken);
      return null;
    }
    const naturalW = Number(meta?.width) || 1;
    const naturalH = Number(meta?.height) || 1;
    BoardfishImageStore.setSource(imgKey, {
      native: true,
      mime: meta?.mime || 'image/png',
      ext: meta?.ext || 'png',
      bytes: meta?.bytes || 0,
    });
    ViewportDebug.step(dbg, 'native-data-url-register:end', {
      imgKey,
      width: naturalW,
      height: naturalH,
      bytes: meta?.bytes || 0,
      mime: meta?.mime || '',
      ext: meta?.ext || '',
    });

    await materializeImageAssets([imgKey], dbg);
    if (!imageAssetUrlCache[imgKey]) throw new Error('native data URL image materialization failed');
    cacheImage(imgKey, imageAssetUrlCache[imgKey], dbg, null, {
      skipSourceRegistration: true,
      resolveOnLoad: options.resolveOnLoad === true,
    });

    const { w, h } = fitImageSize(naturalW, naturalH, exactSize);
    ViewportDebug.step(dbg, 'size-object', { w, h });
    const obj = addImageObject(imgKey, cx, cy, w, h, options, 'add-native-data-url-image');
    if (typeof scheduleEyedropperNativeDecodePrewarm === 'function') {
      scheduleEyedropperNativeDecodePrewarm('add-native-data-url-image');
    }
    const total = performance.now() - t0;
    ViewportDebug.max('maxImageAddMs', total);
    ViewportDebug.end(dbg, { id: obj.id, imgKey, total, path: 'native-data-url-cache' });
    return obj;
  } catch (err) {
    const total = performance.now() - t0;
    ViewportDebug.max('maxImageAddMs', total);
    ViewportDebug.end(dbg, { imgKey, total, path: 'native-data-url-cache', error: String(err) });
    return null;
  } finally {
    if (!_boardOpening) hideInputShield();
  }
}

async function addImage(src, cx, cy, exactSize = false, existingImgKey = null, options = {}) {
  if (shouldUseNativeDataUrlImageCache(src)) {
    return addDataUrlImageViaNativeCache(src, cx, cy, exactSize, existingImgKey, options);
  }
  const displaySrc = isWebImageRef(src) ? webImageDisplaySrc(src) : src;
  if (typeof displaySrc !== 'string' || !displaySrc) return null;
  if (!hasTauri() && !options.webValidated && isImageDataUrl(src)) {
    const valid = await BoardfishWebLimits.validateDataUrlImage(src, 'image');
    if (!valid) return null;
  }
  return new Promise((resolve) => {
    const dbg = ViewportDebug.start('addImage', { src: displaySrc, cx, cy, exactSize, existingImgKey });
    const t0 = performance.now();
    ViewportDebug.count('imageAdds');
    if (!_boardOpening) showInputShield();
    const img = new Image();
    img.onload = () => {
      ViewportDebug.step(dbg, 'load', { width: img.naturalWidth, height: img.naturalHeight, ms: performance.now() - t0 });
      const { w, h } = fitImageSize(img.naturalWidth, img.naturalHeight, exactSize);
      ViewportDebug.step(dbg, 'size-object', { w, h });
      const imgKey = existingImgKey || newImgKey();
      BoardfishImageStore.setSource(imgKey, src);
      cacheImage(imgKey, src, null, img, {
        resolveOnLoad: options.resolveOnLoad === true,
        readyRenderMinIntervalMs: options.readyRenderMinIntervalMs,
      });
      ViewportDebug.step(dbg, 'cache-registered', { imgKey });
      InsertDebug.step(options.insertDebug, 'cache:queued', {
        source: options.source || '',
        imgKey,
        resolveOnLoad: options.resolveOnLoad === true,
        sourceKind: imageSourceDebugInfo(src).kind,
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
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { id: obj?.id || '', imgKey, total, added: !!obj });
      if (!_boardOpening) hideInputShield();
      resolve(obj);
    };
    img.onerror = () => {
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { error: 'image load failed', total });
      if (!_boardOpening) hideInputShield();
      resolve(null);
    };
    img.src = displaySrc;
    ViewportDebug.step(dbg, 'set-src', { src: displaySrc });
  });
}

async function addNativeImageFile(path, cx, cy, options = {}) {
  const dbg = ViewportDebug.start('addNativeImageFile', { path, cx, cy });
  const insertDbg = options.insertDebug || null;
  const source = options.source || '';
  const t0 = performance.now();
  ViewportDebug.count('imageAdds');
  ViewportDebug.count('nativeImageAdds');
  const imgKey = options.imgKey || newImgKey();
  const generation = _imageStoreGeneration;
  const sourceToken = createImageSourceToken(imgKey);
  InsertDebug.step(insertDbg, 'native-register:start', { source, fileName: path, imgKey });
  const meta = await BoardfishTauri.registerImageFileSource(imgKey, path, sourceToken);
  InsertDebug.step(insertDbg, 'native-register:end', {
    source,
    fileName: path,
    imgKey,
    width: meta.width,
    height: meta.height,
    fileSize: meta.bytes || '',
    fileType: meta.mime || '',
  });
  if (generation !== _imageStoreGeneration) {
    cleanupNativeImageSourceToken(imgKey, sourceToken);
    return null;
  }
  const naturalW = Number(meta.width) || 1;
  const naturalH = Number(meta.height) || 1;
  const { w, h } = fitImageSize(naturalW, naturalH, options.exactSize);
  BoardfishImageStore.setSource(imgKey, {
    native: true,
    mime: meta.mime || '',
    ext: meta.ext || '',
    bytes: meta.bytes || 0,
  });
  if (options.materializeAsset) {
    const materializeStart = performance.now();
    InsertDebug.step(insertDbg, 'materialize:start', { source, fileName: path, imgKey });
    await materializeImageAssets([imgKey]);
    InsertDebug.step(insertDbg, 'materialize:end', {
      source,
      fileName: path,
      imgKey,
      ms: performance.now() - materializeStart,
      assetReady: !!imageAssetUrlCache[imgKey],
    });
  }
  if (!imageAssetUrlCache[imgKey]) {
    imageAssetUrlCache[imgKey] = convertTauriFileSrc(path);
    InsertDebug.step(insertDbg, 'display-src:direct-file', { source, fileName: path, imgKey });
  }
  cacheImage(imgKey, imageAssetUrlCache[imgKey], null, null, {
    skipSourceRegistration: true,
    resolveOnLoad: options.resolveOnLoad === true,
  });
  InsertDebug.step(insertDbg, 'cache:queued', {
    source,
    fileName: path,
    imgKey,
    resolveOnLoad: options.resolveOnLoad === true,
    assetReady: !!imageAssetUrlCache[imgKey],
  });
  const obj = addImageObject(imgKey, cx, cy, w, h, options, 'add-native-image');
  InsertDebug.step(insertDbg, 'object:add', {
    source,
    fileName: path,
    imgKey,
    objectId: obj?.id || '',
    w,
    h,
    z: obj?.z ?? '',
  });
  if (typeof scheduleEyedropperNativeDecodePrewarm === 'function') {
    scheduleEyedropperNativeDecodePrewarm('add-native-image');
  }
  const total = performance.now() - t0;
  ViewportDebug.max('maxImageAddMs', total);
  ViewportDebug.end(dbg, { id: obj?.id || '', imgKey, width: naturalW, height: naturalH, bytes: meta.bytes || 0, total, added: !!obj });
  return obj;
}

fileInput.addEventListener('change', async () => {
  if (eyedropperEnabled) {
    fileInput.value = '';
    return;
  }
  const files = [...fileInput.files];
  try {
    await insertImageFiles(files, ctxPos.x, ctxPos.y, 'file-input');
  } finally {
    fileInput.value = '';
  }
});

async function pickAndInsertImages(x, y) {
  if (eyedropperEnabled) return;
  if (!BoardfishWebLimits.canAddObjects(1)) return;
  if (hasTauri()) {
    const dbg = InsertDebug.start('pickImages', { source: 'file-picker-native' });
    try {
      const paths = await BoardfishTauri.pickImageFiles();
      InsertDebug.end(dbg, { source: 'file-picker-native', fileCount: paths?.length || 0, cancelled: !paths?.length });
      if (paths?.length) await insertNativeImagePaths(paths, x, y, 'file-picker-native');
    } catch (err) {
      InsertDebug.end(dbg, { source: 'file-picker-native', error: String(err) });
      console.error('Failed to pick images:', err);
    }
    return;
  }
  fileInput.value = '';
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
    readyRenderMinIntervalMs: options.readyRenderMinIntervalMs,
  });
  if (!options.holdShield) hideInputShield();
  const obj = await addPromise;
  if (!options.holdShield) showInputShield();
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

async function pasteDataUrlImage(dataUrl, x, y, imgKey, path, dbg, options = {}) {
  showInputShield();
  const objectCountBefore = objects.length;
  try {
    ClipDebug.step(dbg, 'paste-image:add-start', { path, imgKey });
    const obj = await addImage(dataUrl, x, y, false, imgKey, {
      resolveOnLoad: options.resolveOnLoad !== false,
      readyRenderMinIntervalMs: options.readyRenderMinIntervalMs,
      source: path,
    });
    if (!obj) {
      ClipDebug.end(dbg, { path, added: false, imgKey, objectCountBefore, objectCountAfter: objects.length });
      return null;
    }
    ClipDebug.step(dbg, 'paste-image:add-object', { path, imgKey: obj.data?.imgKey, objectId: obj.id, w: obj.w, h: obj.h });
    ClipDebug.step(dbg, 'paste-image:ready-wait-start', { path, imgKey: obj.data?.imgKey });
    const readyMetrics = await imageReadyPromiseForKey(obj.data.imgKey);
    const readyStage = readyMetrics?.cacheReadyStage || '';
    ClipDebug.step(dbg, 'paste-image:ready-wait-end', {
      path,
      imgKey: obj.data?.imgKey,
      readyStage,
      cacheTotalMs: readyMetrics?.cacheTotalMs ?? '',
      cacheQueueWaitMs: readyMetrics?.cacheQueueWaitMs ?? '',
      cacheBitmapMs: readyMetrics?.cacheBitmapMs ?? '',
    });
    ClipDebug.end(dbg, {
      path,
      added: true,
      imgKey: obj.data?.imgKey,
      readyStage,
      displayReady: readyStage === 'display' || !!BoardfishImageStore.getDisplayImage(obj.data?.imgKey)?.complete,
      bitmapReady: !!imageBitmapCache[obj.data?.imgKey],
      fallbackReady: imageBitmapFailed.has(obj.data?.imgKey) && !!BoardfishImageStore.getDisplayImage(obj.data?.imgKey)?.complete,
      objectCountBefore,
      objectCountAfter: objects.length,
    });
    return obj;
  } finally {
    hideInputShield();
  }
}

async function pasteNativeCachedImage(meta, x, y, imgKey, path, dbg, sourceToken = null) {
  showInputShield();
  const objectCountBefore = objects.length;
  try {
    const naturalW = Number(meta?.width) || 1;
    const naturalH = Number(meta?.height) || 1;
    const bytes = Number(meta?.bytes) || 0;
    ClipDebug.step(dbg, 'paste-native-cache:source-registered', {
      path,
      imgKey,
      width: naturalW,
      height: naturalH,
      pixels: Number(meta?.pixels) || naturalW * naturalH,
      rgbaMB: meta?.rgbaMb ?? '',
      bytes,
      mime: meta?.mime || '',
      ext: meta?.ext || '',
    });
    BoardfishImageStore.setSource(imgKey, {
      native: true,
      mime: meta?.mime || 'image/png',
      ext: meta?.ext || 'png',
      bytes,
    });

    const materializeStart = performance.now();
    ClipDebug.step(dbg, 'paste-native-cache:materialize-start', { path, imgKey });
    await materializeImageAssets([imgKey], dbg);
    ClipDebug.step(dbg, 'paste-native-cache:materialize-end', {
      path,
      imgKey,
      ms: Math.round((performance.now() - materializeStart) * 100) / 100,
      assetReady: !!imageAssetUrlCache[imgKey],
    });

    if (!imageAssetUrlCache[imgKey]) throw new Error('native clipboard image materialization failed');
    cacheImage(imgKey, imageAssetUrlCache[imgKey], dbg, null, {
      skipSourceRegistration: true,
      resolveOnLoad: true,
    });
    const { w, h } = fitImageSize(naturalW, naturalH, false);
    const obj = addImageObject(imgKey, x, y, w, h, {}, 'paste-native-image');
    ClipDebug.step(dbg, 'paste-native-cache:add-object', { path, imgKey, objectId: obj.id, w, h });
    ClipDebug.step(dbg, 'paste-image:ready-wait-start', { path, imgKey });
    const readyMetrics = await imageReadyPromiseForKey(imgKey);
    const readyStage = readyMetrics?.cacheReadyStage || '';
    ClipDebug.step(dbg, 'paste-image:ready-wait-end', {
      path,
      imgKey,
      readyStage,
      cacheTotalMs: readyMetrics?.cacheTotalMs ?? '',
      cacheQueueWaitMs: readyMetrics?.cacheQueueWaitMs ?? '',
      cacheBitmapMs: readyMetrics?.cacheBitmapMs ?? '',
    });
    ClipDebug.end(dbg, {
      path,
      added: true,
      imgKey,
      readyStage,
      displayReady: readyStage === 'display' || !!BoardfishImageStore.getDisplayImage(imgKey)?.complete,
      bitmapReady: !!imageBitmapCache[imgKey],
      fallbackReady: imageBitmapFailed.has(imgKey) && !!BoardfishImageStore.getDisplayImage(imgKey)?.complete,
      objectCountBefore,
      objectCountAfter: objects.length,
    });
    return obj;
  } catch (err) {
    cleanupNativeImageSourceToken(imgKey, sourceToken);
    throw err;
  } finally {
    hideInputShield();
  }
}

async function insertImageFiles(files, x, y, source = 'file-input') {
  const dbg = InsertDebug.start('insertImages', { source, fileCount: files.length });
  if (!files.length) { InsertDebug.end(dbg, { source, skipped: 'no-files' }); return; }
  let added = 0;
  const readyPromises = [];
  if (!BoardfishWebLimits.canAddObjects(1)) {
    InsertDebug.end(dbg, { source, skipped: 'web-object-limit', fileCount: files.length });
    return;
  }
  const accepted = [];
  const dropped = { type: 0, objectLimit: 0, contentLimit: 0 };
  const remainingSlotsRaw = BoardfishWebLimits.remainingObjectSlots?.();
  const remainingSlots = Number.isFinite(Number(remainingSlotsRaw)) ? Number(remainingSlotsRaw) : files.length;
  const maxObjects = Math.max(0, Math.min(files.length, remainingSlots));
  let acceptedBytes = 0;
  for (const file of files) {
    if (!isWebInsertImageFile(file)) {
      dropped.type++;
      InsertDebug.step(dbg, 'file:skip', { source, fileName: file?.name || '', fileSize: file?.size ?? '', fileType: file?.type || '', skipped: 'unsupported-type' });
      continue;
    }
    if (accepted.length >= maxObjects) {
      dropped.objectLimit++;
      InsertDebug.step(dbg, 'file:skip', { source, fileName: file.name, fileSize: file.size, fileType: file.type, skipped: 'web-object-limit' });
      continue;
    }
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
    if (dropped.contentLimit > 0) BoardfishWebLimits.notify(`Boardfish Web boards are limited to ${Math.round(BoardfishWebLimits.LIMITS.maxBoardContentBytes / 1024 / 1024 * 10) / 10} MB`);
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
    if (accepted.length) {
      InsertDebug.step(dbg, 'web:concurrency', { source, fileCount: accepted.length, concurrency, bytes: acceptedBytes });
    }
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
      const primaryObj = addedObjects.slice().reverse().find(Boolean);
      if (primaryObj) BoardfishEditorState.setSelection([primaryObj.id], { primaryId: primaryObj.id, exitEditing: false });
      const historyAdded = finishBulkImageInsert({ pushHistoryEntry: added > 0 });
      InsertDebug.step(dbg, 'bulk:end', { source, added, historyAdded });
    }
    hideInputShield();
    if (dropped.contentLimit > 0) BoardfishWebLimits.notify(`Boardfish Web boards are limited to ${Math.round(BoardfishWebLimits.LIMITS.maxBoardContentBytes / 1024 / 1024 * 10) / 10} MB`);
    InsertDebug.end(dbg, { source, fileCount: files.length, acceptedFileCount: accepted.length, added, concurrency, ...dropped });
  }
}

async function insertNativeImagePaths(paths, x, y, source = 'native-drop') {
  const dbg = InsertDebug.start('insertImages', { source, fileCount: paths.length });
  let added = 0;
  const readyPromises = [];
  const addedObjects = new Array(paths.length);
  const imagePaths = paths.filter((path) => /\.(png|jpe?g)$/i.test(path));
  const bulk = imagePaths.length > 1;
  const concurrency = nativeImageInsertConcurrency(imagePaths.length);
  const bulkZBase = bulk ? zCounter + 1 : null;
  showInputShield();
  if (bulk) {
    beginBulkImageInsert();
    InsertDebug.step(dbg, 'bulk:start', { source, fileCount: imagePaths.length, concurrency });
  }
  try {
    if (imagePaths.length) {
      InsertDebug.step(dbg, 'native:concurrency', { source, fileCount: imagePaths.length, concurrency });
    }
    await mapWithConcurrency(imagePaths, concurrency, async (path, index) => {
      const fileDbg = InsertDebug.start('insertImage', { source, fileName: path });
      try {
        InsertDebug.step(fileDbg, 'register:start', { source, fileName: path });
        const obj = await addNativeImageFile(path, x, y, {
          deferHistory: bulk,
          materializeAsset: source === 'file-picker-native',
          suppressProgressRender: false,
          resolveOnLoad: true,
          insertDebug: fileDbg,
          source,
          z: bulkZBase == null ? undefined : bulkZBase + index,
        });
        const imgRef = obj ? BoardfishImageStore.getSource(obj.data.imgKey) : null;
        InsertDebug.step(fileDbg, 'register:end', {
          source,
          fileName: path,
          imgKey: obj?.data?.imgKey,
          native: true,
          fileSize: imgRef?.bytes || '',
          fileType: imgRef?.mime || '',
        });
        InsertDebug.end(fileDbg, { source, added: !!obj, imgKey: obj?.data?.imgKey, native: true });
        if (obj) {
          addedObjects[index] = obj;
          added++;
          readyPromises.push(imageReadyPromiseForKey(obj.data.imgKey).then((metrics) => {
            InsertDebug.step(fileDbg, 'ready', {
              source,
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
        InsertDebug.end(fileDbg, { source, error: String(err) });
        console.error('Failed to load image file:', err);
      }
    });
  } finally {
    if (readyPromises.length) {
      InsertDebug.step(dbg, 'ready:wait-start', { source, added, readyCount: readyPromises.length });
      await Promise.allSettled(readyPromises);
      InsertDebug.step(dbg, 'ready:wait-end', { source, added, readyCount: readyPromises.length });
    }
    if (bulk) {
      const primaryObj = addedObjects.slice().reverse().find(Boolean);
      if (primaryObj) BoardfishEditorState.setSelection([primaryObj.id], { primaryId: primaryObj.id, exitEditing: false });
      const historyAdded = finishBulkImageInsert({ pushHistoryEntry: added > 0 });
      InsertDebug.step(dbg, 'bulk:end', { source, fileCount: imagePaths.length, added, historyAdded });
    }
    hideInputShield();
    InsertDebug.end(dbg, { source, fileCount: imagePaths.length, droppedFileCount: paths.length, added });
  }
}

if (hasTauri()) {
  tauriListen('boardfish://file-drop', async (event) => {
    const { paths } = event.payload;
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    await insertNativeImagePaths(paths, center.x, center.y, 'native-drop');
  });
} else {
  canvas.addEventListener('dragover', (event) => {
    if (![...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file')) return;
    event.preventDefault();
  });

  canvas.addEventListener('drop', async (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    const boardFile = files.find((file) => /\.bf$/i.test(file.name || ''));
    if (boardFile && typeof openBoardFileRef === 'function') {
      await openBoardFileRef(BoardfishRuntime.fileRefFromFile(boardFile));
      return;
    }
    const wp = toWorld(event.clientX, event.clientY);
    await insertImageFiles(files, wp.x, wp.y, 'web-drop');
  });
}
