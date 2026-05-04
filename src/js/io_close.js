// ─── Dirty tracking ───────────────────────────────────────────────────────────

// historyIndex at last save (or open). -1 means never saved.
var savedHistoryIndex = -1;
var currentFilePath = null;

function isDirty() {
  if (objects.length === 0) return false;
  return historyIndex !== savedHistoryIndex || _dirtyIds.size > 0;
}

function markSaved() {
  _dirtyIds.clear();
  savedHistoryIndex = historyIndex;
  updateTitle();
}

function updateTitle() {
  if (!hasTauri()) return;
  const title = '';
  document.title = title;
  BoardfishTauri.setTitle(title);
}


// ─── Unsaved changes dialog ───────────────────────────────────────────────────
var dialogOverlay = document.getElementById('dialog-overlay');
var _dialogResolve = null;

function _dialogClose(result) {
  dialogOverlay.classList.remove('show');
  updateInputShieldVisual();
  const r = _dialogResolve;
  _dialogResolve = null;
  if (r) r(result);
}

document.getElementById('dlg-save').addEventListener('click', () => _dialogClose('save'));
document.getElementById('dlg-discard').addEventListener('click', () => _dialogClose('discard'));
document.getElementById('dlg-cancel').addEventListener('click', () => _dialogClose('cancel'));

// Returns 'save' | 'discard' | 'cancel'
function showUnsavedDialog() {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    dialogOverlay.classList.add('show');
    updateInputShieldVisual();
  });
}

// ─── Save / Open ─────────────────────────────────────────────────────────────

function boardDocumentDeps() {
  return {
    schema: BoardSchema,
    isNativeImageRef,
    guessImageExtFromDataUrl: BoardfishExportUtils.guessImageExtFromDataUrl,
    imageStoreBytesEstimate,
    imageRefKind,
    rawImageStore: imageStore,
    historyLength: boardHistory.length,
    historyIndex,
    dirty: isDirty(),
    runtime: {
      imageCache,
      imageAssetUrlCache,
      imageBitmapCache,
      imageBitmapFailed,
    },
  };
}

function boardData() {
  return BoardfishBoardDocument.createLegacyBoardData({
    viewport: { panX, panY, zoom },
    imageStore,
    objects,
  });
}

function boardDataForSave() {
  return BoardfishBoardDocument.createBoardDataForSave({
    viewport: { panX, panY, zoom },
    imageStore,
    objects,
  }, boardDocumentDeps());
}

function summarizeImageStore(store = {}, { includeRuntime = false } = {}) {
  return BoardfishBoardDocument.summarizeImageStore(store, boardDocumentDeps(), { includeRuntime });
}

function getObjectTypeCounts(objectsList = []) {
  return BoardfishBoardDocument.getObjectTypeCounts(objectsList);
}

function getBoardSaveMetrics(data) {
  return BoardfishBoardDocument.getBoardSaveMetrics(data, boardDocumentDeps());
}

function getBoardOpenMetrics(data) {
  return BoardfishBoardDocument.getBoardOpenMetrics(data, boardDocumentDeps());
}

function imageRefKind(src) {
  return BoardfishBoardDocument.defaultImageRefKind(src, isNativeImageRef);
}

function getImageStoreOpenDebugSample(limit = 12) {
  return BoardfishBoardDocument.getImageStoreDebugSample(imageStore, boardDocumentDeps(), limit);
}

function getOpenImageRuntimeMetrics() {
  return BoardfishBoardDocument.getImageRuntimeMetrics(imageStore, boardDocumentDeps());
}

function measureBoardJsonForSaveDebug(dbg, data) {
  if (!SaveDebug.enabled) return;
  const t0 = performance.now();
  try {
    const json = JSON.stringify(data);
    SaveDebug.step(dbg, 'json-stringify', {
      ms: performance.now() - t0,
      jsonBytes: json.length,
    });
  } catch (err) {
    SaveDebug.step(dbg, 'json-stringify:error', { error: String(err) });
  }
}

function scheduleSaveFrameProbe(dbg, label) {
  if (!SaveDebug.enabled) return null;
  const scheduledAt = performance.now();
  let done = false;
  requestAnimationFrame(() => {
    done = true;
    SaveDebug.step(dbg, label, { queueMs: performance.now() - scheduledAt });
  });
  return () => {
    if (!done) SaveDebug.step(dbg, `${label}:pending`, { elapsedMs: performance.now() - scheduledAt });
  };
}

async function invokeSaveBoard(path, dbg) {
  const dataStart = performance.now();
  const data = hasTauri() ? boardDataForSave() : boardData();
  SaveDebug.step(dbg, 'boardData', { ms: performance.now() - dataStart, path, ...getBoardSaveMetrics(data) });
  measureBoardJsonForSaveDebug(dbg, data);
  if (hasTauri()) {
    const pendingSources = Object.keys(data.imageStore || {})
      .map((key) => imageSourceCachePromises.get(key))
      .filter(Boolean);
    if (pendingSources.length) {
      const sourceStart = performance.now();
      SaveDebug.step(dbg, 'await-image-source-cache:start', { count: pendingSources.length });
      await Promise.allSettled(pendingSources);
      SaveDebug.step(dbg, 'await-image-source-cache:end', { count: pendingSources.length, ms: performance.now() - sourceStart });
    }
  }
  const frameProbe = scheduleSaveFrameProbe(dbg, 'save-frame-probe');
  const result = await SaveDebug.wrap(dbg, TAURI_COMMANDS.SAVE_BOARD, () => BoardfishTauri.saveBoard(path, data), { path, ...getBoardSaveMetrics(data) });
  if (frameProbe) frameProbe();
  return result;
}

async function invokeReadBoard(path, dbg) {
  const frameProbe = scheduleOpenFrameProbe(dbg, 'open-frame-probe');
  const result = await OpenDebug.wrap(dbg, TAURI_COMMANDS.READ_BOARD, () => BoardfishTauri.readBoard(path), { path });
  if (frameProbe) frameProbe();
  const board = result?.board || result;
  if (result && result.debug) OpenDebug.step(dbg, 'read-board-debug', { rust: result.debug, ...getBoardOpenMetrics(board) });
  OpenDebug.step(dbg, 'read-board-shape', getBoardOpenMetrics(board));
  return board;
}

function scheduleOpenFrameProbe(dbg, label) {
  if (!OpenDebug.enabled) return null;
  const scheduledAt = performance.now();
  let done = false;
  requestAnimationFrame(() => {
    done = true;
    OpenDebug.step(dbg, label, { queueMs: performance.now() - scheduledAt });
  });
  return () => {
    if (!done) OpenDebug.step(dbg, `${label}:pending`, { elapsedMs: performance.now() - scheduledAt });
  };
}

function getVisibleWorldBounds() {
  return viewportWorldRect();
}

function getVisibleImageKeys(limit = Infinity) {
  const b = getVisibleWorldBounds();
  const keys = [];
  const skipped = { nonImage: 0, outside: 0, missingKey: 0, nonNative: 0, cached: 0 };
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type !== 'image') { skipped.nonImage++; continue; }
    if (!objectIntersectsRect(obj, b)) { skipped.outside++; continue; }
    const key = obj.data.imgKey;
    const source = BoardfishImageStore.getSource(key);
    if (!key || !source) { skipped.missingKey++; continue; }
    if (!isNativeImageRef(source)) { skipped.nonNative++; continue; }
    if (BoardfishImageStore.hasDisplayImage(key)) { skipped.cached++; continue; }
    keys.push(key);
    if (keys.length >= limit) break;
  }
  getVisibleImageKeys.lastDebug = { visibleBounds: b, selected: keys.length, skipped };
  return keys;
}
getVisibleImageKeys.lastDebug = null;

function getPendingNativeImageKeys(limit = Infinity, exclude = new Set()) {
  const keys = [];
  const skipped = { excluded: 0, nonNative: 0, cached: 0 };
  for (const key of BoardfishImageStore.sourceKeys()) {
    if (exclude.has(key)) { skipped.excluded++; continue; }
    if (!isNativeImageRef(BoardfishImageStore.getSource(key))) { skipped.nonNative++; continue; }
    if (BoardfishImageStore.hasDisplayImage(key)) { skipped.cached++; continue; }
    keys.push(key);
    if (keys.length >= limit) break;
  }
  getPendingNativeImageKeys.lastDebug = { selected: keys.length, skipped };
  return keys;
}
getPendingNativeImageKeys.lastDebug = null;

async function hydrateImageForDisplay(key, dbg = null) {
  if (BoardfishImageStore.hasDisplayImage(key) || !isNativeImageRef(BoardfishImageStore.getSource(key))) return false;
  const t0 = performance.now();
  const fetchStart = performance.now();
  const display = await ensureImageDisplaySrc(key, dbg);
  const fetchMs = performance.now() - fetchStart;
  if (!display.src) {
    OpenDebug.step(dbg, 'hydrate-image:skip', { imgKey: key, reason: 'no-display-src', storeKind: imageRefKind(BoardfishImageStore.getSource(key)) });
    return false;
  }
  const loadStart = performance.now();
  let img;
  try {
    img = await loadImageElement(display.src);
  } catch (err) {
    OpenDebug.step(dbg, 'hydrate-image:load-error', { imgKey: key, source: display.source, error: String(err), srcPrefix: String(display.src).slice(0, 80) });
    throw err;
  }
  const loadMs = performance.now() - loadStart;
  BoardfishImageStore.setDisplayImage(key, img);
  let bitmapMs = 0;
  let bitmapReady = false;
  try {
    const bitmapStart = performance.now();
    imageBitmapCache[key] = await createImageBitmap(img);
    bitmapMs = performance.now() - bitmapStart;
    bitmapReady = true;
  } catch (err) {
    imageBitmapFailed.add(key);
    OpenDebug.step(dbg, 'hydrate-image:bitmap-error', { imgKey: key, source: display.source, error: String(err), complete: !!img?.complete, naturalW: img?.naturalWidth || 0, naturalH: img?.naturalHeight || 0 });
  }
  OpenDebug.step(dbg, 'hydrate-image', {
    imgKey: key,
    ms: performance.now() - t0,
    fetchMs,
    loadMs,
    bitmapMs,
    dataUrlLen: display.dataUrlLen,
    source: display.source,
    bitmapReady,
  });
  return true;
}

async function hydrateImageKeysWithLimit(keys, dbg, label, concurrency = OpenDebug.hydrationConcurrency) {
  OpenDebug.step(dbg, `${label}:start`, { count: keys.length, concurrency, ...getOpenImageRuntimeMetrics() });
  const t0 = performance.now();
  await materializeImageAssets(keys, dbg).catch((err) => {
    OpenDebug.step(dbg, `${label}:materialize-error`, { error: String(err) });
  });
  let hydrated = 0;
  await mapWithConcurrency(keys, concurrency, async (key) => {
    try {
      if (await hydrateImageForDisplay(key, dbg)) hydrated++;
    } catch (err) {
      OpenDebug.step(dbg, `${label}:error`, { imgKey: key, error: String(err) });
    }
  });
  OpenDebug.step(dbg, `${label}:end`, { count: keys.length, hydrated, concurrency, ms: performance.now() - t0, ...getOpenImageRuntimeMetrics() });
  if (hydrated) invalidateOffscreen();
  return hydrated;
}

async function hydrateVisibleImagesForOpen(dbg = null) {
  const keys = getVisibleImageKeys();
  OpenDebug.step(dbg, 'hydrate-visible:candidates', { count: keys.length, ...(getVisibleImageKeys.lastDebug || {}), ...getOpenImageRuntimeMetrics() });
  await hydrateImageKeysWithLimit(keys, dbg, 'hydrate-visible', OpenDebug.hydrationConcurrency);
  return keys;
}

async function hydrateImageBatchForOpen(keys, dbg = null, label = 'hydrate-batch') {
  return hydrateImageKeysWithLimit(keys, dbg, label, OpenDebug.hydrationConcurrency);
}

async function hydrateAllImagesForOpen(dbg = null) {
  const keys = getPendingNativeImageKeys();
  OpenDebug.step(dbg, 'hydrate-all:candidates', { count: keys.length, ...(getPendingNativeImageKeys.lastDebug || {}), ...getOpenImageRuntimeMetrics() });
  return hydrateImageBatchForOpen(keys, dbg, 'hydrate-all');
}
var _backgroundOpenHydrationRunning = false;
async function hydrateRemainingImagesForOpen(dbg = null, batchSize = 4) {
  if (_backgroundOpenHydrationRunning) return;
  _backgroundOpenHydrationRunning = true;
  const generation = _imageStoreGeneration;
  const totalStart = performance.now();
  let batchCount = 0;
  let hydratedTotal = 0;
  try {
    while (!_boardOpening && generation === _imageStoreGeneration) {
      const keys = getPendingNativeImageKeys(batchSize);
      if (!keys.length) break;
      batchCount++;
      hydratedTotal += await hydrateImageBatchForOpen(keys, dbg, 'hydrate-background');
      scheduleRender(true, false, 'open-background-hydration');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    _backgroundOpenHydrationRunning = false;
    OpenDebug.step(dbg, 'hydrate-background:done', {
      batchCount,
      hydrated: hydratedTotal,
      remaining: getPendingNativeImageKeys().length,
      stale: generation !== _imageStoreGeneration,
      ms: performance.now() - totalStart,
    });
  }
}

function queueVisibleImageHydration(limit = 3, dbg = null) {
  for (const key of getVisibleImageKeys(limit)) queueImageHydration(key, dbg);
}
var _visibleHydrationTimer = null;
function scheduleVisibleHydrationAfterIdle() {
  if (!hasTauri() || _boardOpening || (typeof eyedropperEnabled !== 'undefined' && eyedropperEnabled)) return;
  clearTimeout(_visibleHydrationTimer);
  _visibleHydrationTimer = setTimeout(() => {
    queueVisibleImageHydration(1);
    if (typeof scheduleVisibleScaledVariantPrewarmAfterIdle === 'function') {
      scheduleVisibleScaledVariantPrewarmAfterIdle('visible-hydration');
    }
  }, 180);
}

async function finishOpenedBoard(dbg, data) {
  PillDebug.log('open:finishOpenedBoard:start', getBoardOpenMetrics(data));
  if (OpenDebug.hydrationMode === 'visible-first') {
    const hydrateStart = performance.now();
    const visibleKeys = await hydrateVisibleImagesForOpen(dbg);
    PillDebug.log('open:hydrate-visible:end', { phaseMs: performance.now() - hydrateStart, visibleCount: visibleKeys?.length || 0 });
    OpenDebug.step(dbg, 'hydrate-initial-policy', {
      mode: 'visible-first',
      visibleCount: visibleKeys?.length || 0,
      pendingNativeImages: getPendingNativeImageKeys().length,
    });
  } else {
    OpenDebug.step(dbg, 'hydrate-initial-policy', {
      mode: 'all-before-open',
      pendingNativeImages: getPendingNativeImageKeys().length,
    });
    const hydrateStart = performance.now();
    await hydrateAllImagesForOpen(dbg);
    PillDebug.log('open:hydrate-all:end', { phaseMs: performance.now() - hydrateStart, pendingNativeImages: getPendingNativeImageKeys().length });
  }
  _boardOpening = false;
  const renderStart = performance.now();
  PillDebug.log('open:initial-applyTransform:start');
  applyTransform();
  const renderMs = performance.now() - renderStart;
  PillDebug.log('open:initial-applyTransform:end', { phaseMs: renderMs });
  OpenDebug.step(dbg, 'initial-applyTransform', { ms: renderMs });
  const zoomRestoreReason = await finishPillTransition({
    beforeTransition: () => {
      applyNativeAppTheme();
      openingShield.classList.remove('active');
      PillDebug.log('open:openingShield:removed', { reason: 'before-zoom-restore' });
    },
  });
  PillDebug.log('open:restoreIslandZoom:end', { zoomRestoreReason });
  OpenDebug.end(dbg, { opened: true, ...getBoardOpenMetrics(data) });
  if (OpenDebug.hydrationMode === 'visible-first') {
    setTimeout(() => hydrateRemainingImagesForOpen(dbg).catch((err) => {
      OpenDebug.step(dbg, 'hydrate-background:error', { error: String(err) });
    }), 80);
  }
}

function applyBoardData(data, options = {}) {
  data = BoardSchema.normalizeBoardData(data);
  const dbg = options.dbg || null;
  const sourcesCached = !!options.sourcesCached;
  const deferRender = !!options.deferRender;
  const endDebug = options.endDebug !== false;
  PillDebug.log('open:applyBoardData:start', getBoardOpenMetrics(data));
  OpenDebug.step(dbg, 'applyBoardData:start', getBoardOpenMetrics(data));
  setEyedropperEnabled(false);
  clearJsClipboard();
  const t0 = performance.now();
  clearImageStore(!sourcesCached);
  OpenDebug.step(dbg, 'clearImageStore', { ms: performance.now() - t0 });

  const imageStart = performance.now();
  BoardfishImageStore.setSources(data.imageStore || {});
  _skipImageSourceRegistration = sourcesCached;
  try {
    for (const k of BoardfishImageStore.sourceKeys()) {
      const source = BoardfishImageStore.getSource(k);
      const n = parseInt(k.split('-')[1]);
      if (!isNaN(n) && n >= imgKeyCounter) imgKeyCounter = n + 1;
      if (!sourcesCached || !isNativeImageRef(source)) cacheImage(k, source);
    }
  } finally {
    _skipImageSourceRegistration = false;
  }
  OpenDebug.step(dbg, 'cacheImage:start-all', { ms: performance.now() - imageStart, sourcesCached, ...getOpenImageRuntimeMetrics() });
  OpenDebug.step(dbg, 'image-store-sample', { sample: getImageStoreOpenDebugSample() });

  const stateStart = performance.now();
  if (editingId) exitEdit();
  BoardfishEditorState.clearSelection();
  const replaceStart = performance.now();
  BoardfishEditorState.replaceBoardObjects(data.objects || [], { restoreCounters: false });
  OpenDebug.step(dbg, 'replaceBoardObjects', { ms: performance.now() - replaceStart, objectCount: objects.length });
  invalidateOffscreen();
  OpenDebug.step(dbg, 'apply-state', { ms: performance.now() - stateStart, objectCount: objects.length });

  const countersStart = performance.now();
  BoardfishEditorState.restoreObjectCountersFromObjects(objects);
  BoardfishEditorState.setViewport(data.viewport);
  if (!deferRender) applyNativeAppTheme();
  OpenDebug.step(dbg, 'restore-counters-viewport', { ms: performance.now() - countersStart, panX, panY, zoom });

  if (!deferRender) {
    const renderStart = performance.now();
    applyTransform();
    OpenDebug.step(dbg, 'applyTransform', { ms: performance.now() - renderStart });
  }

  const historyStart = performance.now();
  boardHistory = []; historyIndex = -1; snapshot();
  markSaved();
  OpenDebug.step(dbg, 'reset-boardHistory-markSaved', { ms: performance.now() - historyStart, historyLength: boardHistory.length, historyIndex });
  PillDebug.log('open:applyBoardData:end', getBoardOpenMetrics(data));
  if (endDebug) OpenDebug.end(dbg, { opened: true, ...getBoardOpenMetrics(data) });
}

async function saveBoardAs() {
  if (!hasTauri()) { alert('Save requires the desktop app.'); return false; }
  const dbg = SaveDebug.start('saveBoardAs', { currentFilePath, objectCount: objects.length });
  const releaseInputShield = acquireInputShield();
  try {
    const defaultName = currentFilePath
      ? currentFilePath.split(/[\\/]/).pop()
      : 'board.bf';
    const filePath = await SaveDebug.wrap(dbg, TAURI_COMMANDS.SAVE_FILE_DIALOG, () => BoardfishTauri.saveFileDialog(defaultName), { defaultName });
    if (!filePath) { SaveDebug.end(dbg, { cancelled: true }); releaseInputShield(); return false; }
    await runShieldedPillTask({
      releaseInputShield,
      startMessage: 'Saving',
      successMessage: 'Saved',
      task: async () => {
        await invokeSaveBoard(filePath, dbg);
        currentFilePath = filePath;
        SaveDebug.step(dbg, 'markSaved:start');
        markSaved();
        SaveDebug.step(dbg, 'markSaved:end');
      },
    });
    SaveDebug.end(dbg, { saved: true, path: filePath });
    return true;
  } catch (err) {
    releaseInputShield();
    console.error('Save failed:', err);
    SaveDebug.end(dbg, { saved: false, error: String(err) });
    return false;
  }
}

async function saveBoard() {
  if (currentFilePath) {
    if (!hasTauri()) return false;
    const dbg = SaveDebug.start('saveBoard', { path: currentFilePath, objectCount: objects.length });
    const releaseInputShield = acquireInputShield();
    try {
      await runShieldedPillTask({
        releaseInputShield,
        startMessage: 'Saving',
        successMessage: 'Saved',
        task: async () => {
          await invokeSaveBoard(currentFilePath, dbg);
          SaveDebug.step(dbg, 'markSaved:start');
          markSaved();
          SaveDebug.step(dbg, 'markSaved:end');
        },
      });
      SaveDebug.end(dbg, { saved: true, path: currentFilePath });
      return true;
    } catch (err) {
      releaseInputShield();
      console.error('Save failed:', err);
      SaveDebug.end(dbg, { saved: false, error: String(err) });
      return false;
    }
  }
  return saveBoardAs();
}


async function openBoard() {
  if (!hasTauri()) { alert('Open requires the desktop app.'); return; }
  const dbg = OpenDebug.start('openBoard', { currentFilePath, objectCount: objects.length });

  if (!(await confirmDirtyBeforeOpen(dbg))) return;

  try {
    const filePath = await OpenDebug.wrap(dbg, TAURI_COMMANDS.OPEN_FILE_DIALOG, () => BoardfishTauri.openFileDialog());
    if (!filePath) { OpenDebug.end(dbg, { cancelled: true }); return; }
    await openBoardFromPath(filePath, dbg, 'Open failed:');
  } catch (err) {
    finishFailedOpen(dbg, err, 'Open failed:');
  }
}

// ─── Close guard ─────────────────────────────────────────────────────────────
var _closeGuardRunning = false;

async function requestAppClose(event = null) {
  if (!hasTauri()) return;
  const seq = Number(event?.payload || 0);
  if (seq) BoardfishTauri.acknowledgeCloseRequest(seq).catch(() => {});
  if (_closeGuardRunning) return;
  _closeGuardRunning = true;
  try {
    recoverWindowPaint('close-request', false);
    if (isDirty()) {
      const choice = await showUnsavedDialog();
      if (choice === 'cancel') {
        BoardfishTauri.cancelPendingTermination().catch(() => {});
        return;
      }
      if (choice === 'save') {
        const saved = await saveBoard();
        if (!saved) {
          BoardfishTauri.cancelPendingTermination().catch(() => {});
          return;
        }
      }
    }
    clearJsClipboard();
    // Use process.exit instead of appWindow.close() to avoid re-triggering
    // the CloseRequested event in Rust (which would cause an infinite loop)
    await BoardfishTauri.exitApp();
  } finally {
    _closeGuardRunning = false;
  }
}

if (hasTauri()) {
  tauriListen('boardfish://close-requested', requestAppClose);
  tauriListen('boardfish://app-resumed', () => {
    recoverWindowPaint('app-resumed');
    setTimeout(() => recoverBlankUi('app-resumed-followup'), 250);
  });
}
