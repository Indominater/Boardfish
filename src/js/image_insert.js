'use strict';

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

function addImageObject(imgKey, cx, cy, w, h, options = {}, renderSource = 'add-image') {
  const obj = { id: newId(), type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, z: ++zCounter, data: { imgKey } };
  objects.push(obj);
  objectsMap.set(obj.id, obj);
  const deferHistory = options.deferHistory ?? _bulkImageInsertDepth > 0;
  if (deferHistory) {
    if (editingId) exitEdit();
    selectedIds.clear();
    selectedIds.add(obj.id);
    selectedId = obj.id;
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

function addImage(src, cx, cy, exactSize = false, existingImgKey = null, options = {}) {
  return new Promise((resolve) => {
    const dbg = ViewportDebug.start('addImage', { src, cx, cy, exactSize, existingImgKey });
    const t0 = performance.now();
    ViewportDebug.count('imageAdds');
    if (!_boardOpening) showInputShield();
    const img = new Image();
    img.onload = () => {
      ViewportDebug.step(dbg, 'load', { width: img.naturalWidth, height: img.naturalHeight, ms: performance.now() - t0 });
      const { w, h } = fitImageSize(img.naturalWidth, img.naturalHeight, exactSize);
      ViewportDebug.step(dbg, 'size-object', { w, h });
      const imgKey = existingImgKey || newImgKey();
      imageStore[imgKey] = src;
      cacheImage(imgKey, src, null, img);
      ViewportDebug.step(dbg, 'cache-registered', { imgKey });
      const obj = addImageObject(imgKey, cx, cy, w, h, options, 'add-image');
      const total = performance.now() - t0;
      ViewportDebug.max('maxImageAddMs', total);
      ViewportDebug.end(dbg, { id: obj.id, imgKey, total });
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
    img.src = src;
    ViewportDebug.step(dbg, 'set-src', { src });
  });
}

async function addNativeImageFile(path, cx, cy, options = {}) {
  const dbg = ViewportDebug.start('addNativeImageFile', { path, cx, cy });
  const t0 = performance.now();
  ViewportDebug.count('imageAdds');
  ViewportDebug.count('nativeImageAdds');
  const imgKey = options.imgKey || newImgKey();
  const meta = await tauriInvoke('register_image_file_source', { imgKey, path });
  const naturalW = Number(meta.width) || 1;
  const naturalH = Number(meta.height) || 1;
  const { w, h } = fitImageSize(naturalW, naturalH, options.exactSize);
  imageStore[imgKey] = {
    native: true,
    mime: meta.mime || '',
    ext: meta.ext || '',
    bytes: meta.bytes || 0,
  };
  if (options.materializeAsset) {
    await materializeImageAssets([imgKey]);
  }
  if (!imageAssetUrlCache[imgKey]) imageAssetUrlCache[imgKey] = convertTauriFileSrc(path);
  cacheImage(imgKey, imageAssetUrlCache[imgKey], null, null, { skipSourceRegistration: true });
  const obj = addImageObject(imgKey, cx, cy, w, h, options, 'add-native-image');
  const total = performance.now() - t0;
  ViewportDebug.max('maxImageAddMs', total);
  ViewportDebug.end(dbg, { id: obj.id, imgKey, width: naturalW, height: naturalH, bytes: meta.bytes || 0, total });
  return obj;
}

fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  await insertImageFiles(files, ctxPos.x, ctxPos.y, 'file-input');
});

async function pickAndInsertImages(x, y) {
  if (hasTauri()) {
    const dbg = InsertDebug.start('pickImages', { source: 'file-picker-native' });
    try {
      const paths = await tauriInvoke('pick_image_files');
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

async function insertDataUrlImage(dataUrl, x, y, dbg, options = {}) {
  const addPromise = addImage(dataUrl, x, y, false, null, {
    deferHistory: options.deferHistory,
    suppressProgressRender: options.suppressProgressRender,
  });
  if (!options.holdShield) hideInputShield();
  const obj = await addPromise;
  if (!options.holdShield) showInputShield();
  InsertDebug.end(dbg, { added: !!obj, ...(options.endMeta || {}) });
  return obj;
}

async function pasteDataUrlImage(dataUrl, x, y, imgKey, path, dbg, options = {}) {
  showInputShield();
  try {
    ClipDebug.step(dbg, 'paste-image:add-start', { path, imgKey });
    const obj = await addImage(dataUrl, x, y, false, imgKey);
    if (!obj) {
      ClipDebug.end(dbg, { path, added: false, imgKey });
      return null;
    }
    ClipDebug.step(dbg, 'paste-image:ready-wait-start', { path, imgKey: obj.data?.imgKey });
    await imageReadyPromiseForKey(obj.data.imgKey);
    ClipDebug.step(dbg, 'paste-image:ready-wait-end', { path, imgKey: obj.data?.imgKey });
    ClipDebug.end(dbg, {
      path,
      added: true,
      imgKey: obj.data?.imgKey,
      bitmapReady: !!imageBitmapCache[obj.data?.imgKey],
      fallbackReady: imageBitmapFailed.has(obj.data?.imgKey) && !!imageCache[obj.data?.imgKey]?.complete,
    });
    return obj;
  } finally {
    hideInputShield();
  }
}

async function insertImageFiles(files, x, y, source = 'file-input') {
  const dbg = InsertDebug.start('insertImages', { source, fileCount: files.length });
  if (!files.length) { InsertDebug.end(dbg, { source, skipped: 'no-files' }); return; }
  let added = 0;
  const readyPromises = [];
  const bulk = files.length > 1;
  showInputShield();
  if (bulk) {
    beginBulkImageInsert();
    InsertDebug.step(dbg, 'bulk:start', { source, fileCount: files.length });
  }
  try {
    for (const file of files) {
      if (file.type !== 'image/png' && file.type !== 'image/jpeg') continue;
      const fileDbg = InsertDebug.start('insertImage', { source, fileName: file.name, fileSize: file.size, fileType: file.type });
      try {
        InsertDebug.step(fileDbg, 'read:start', { source, fileName: file.name, fileSize: file.size, fileType: file.type });
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.onerror = () => reject(reader.error || new Error('failed to read image file'));
          reader.readAsDataURL(file);
        });
        InsertDebug.step(fileDbg, 'read:end', { source, dataUrl });
        const obj = await insertDataUrlImage(dataUrl, x, y, fileDbg, {
          deferHistory: bulk,
          holdShield: true,
          suppressProgressRender: bulk,
          endMeta: { source },
        });
        if (obj) {
          added++;
          readyPromises.push(imageReadyPromiseForKey(obj.data.imgKey));
        }
      } catch (err) {
        InsertDebug.end(fileDbg, { source, error: String(err) });
      }
    }
  } finally {
    if (readyPromises.length) {
      InsertDebug.step(dbg, 'ready:wait-start', { source, added, readyCount: readyPromises.length });
      await Promise.allSettled(readyPromises);
      InsertDebug.step(dbg, 'ready:wait-end', { source, added, readyCount: readyPromises.length });
    }
    if (bulk) {
      const historyAdded = finishBulkImageInsert({ pushHistoryEntry: added > 0 });
      InsertDebug.step(dbg, 'bulk:end', { source, added, historyAdded });
    }
    hideInputShield();
    InsertDebug.end(dbg, { source, fileCount: files.length, added });
  }
}

async function insertNativeImagePaths(paths, x, y, source = 'native-drop') {
  const dbg = InsertDebug.start('insertImages', { source, fileCount: paths.length });
  let added = 0;
  const readyPromises = [];
  const imagePaths = paths.filter((path) => /\.(png|jpe?g)$/i.test(path));
  const bulk = imagePaths.length > 1;
  showInputShield();
  if (bulk) {
    beginBulkImageInsert();
    InsertDebug.step(dbg, 'bulk:start', { source, fileCount: imagePaths.length });
  }
  try {
    for (const path of imagePaths) {
      const fileDbg = InsertDebug.start('insertImage', { source, fileName: path });
      try {
        InsertDebug.step(fileDbg, 'register:start', { source, fileName: path });
        const obj = await addNativeImageFile(path, x, y, {
          deferHistory: bulk,
          materializeAsset: source === 'file-picker-native',
          suppressProgressRender: bulk,
        });
        const imgRef = obj ? imageStore[obj.data.imgKey] : null;
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
          added++;
          readyPromises.push(imageReadyPromiseForKey(obj.data.imgKey));
        }
      } catch (err) {
        InsertDebug.end(fileDbg, { source, error: String(err) });
        console.error('Failed to load image file:', err);
      }
    }
  } finally {
    if (readyPromises.length) {
      InsertDebug.step(dbg, 'ready:wait-start', { source, added, readyCount: readyPromises.length });
      await Promise.allSettled(readyPromises);
      InsertDebug.step(dbg, 'ready:wait-end', { source, added, readyCount: readyPromises.length });
    }
    if (bulk) {
      const historyAdded = finishBulkImageInsert({ pushHistoryEntry: added > 0 });
      InsertDebug.step(dbg, 'bulk:end', { source, fileCount: imagePaths.length, added, historyAdded });
    }
    hideInputShield();
    InsertDebug.end(dbg, { source, fileCount: imagePaths.length, droppedFileCount: paths.length, added });
  }
}

if (hasTauri()) {
  window.__TAURI__.event.listen('boardfish://file-drop', async (event) => {
    const { paths } = event.payload;
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    await insertNativeImagePaths(paths, center.x, center.y, 'native-drop');
  });
}

