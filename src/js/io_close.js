// ─── Dirty tracking ───────────────────────────────────────────────────────────

// historyIndex at last save (or open). -1 means never saved.
var savedHistoryIndex = -1;
var currentFilePath = null;
var currentFileRef = null;

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
  const fileName = BoardfishRuntime?.fileNameFromRef?.(currentFileRef || currentFilePath, '') || '';
  const title = fileName ? `${isDirty() ? '* ' : ''}${fileName}` : 'Boardfish';
  document.title = title;
  if (hasTauri()) BoardfishTauri.setTitle('');
}


// ─── Unsaved changes dialog ───────────────────────────────────────────────────
var dialogOverlay = document.getElementById('dialog-overlay');
var unsavedDialog = document.getElementById('dialog');
var _dialogResolve = null;

function _dialogClose(result) {
  dialogOverlay.classList.remove('show');
  updateInputShieldVisual();
  const r = _dialogResolve;
  _dialogResolve = null;
  if (r) r(result);
}

unsavedDialog.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
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

const stripOpeningFreezeIds = (node) => {
  node?.removeAttribute?.('id');
  for (const child of node?.querySelectorAll?.('[id]') || []) child.removeAttribute('id');
};

const copyOpeningFreezeCanvas = (sourceCanvas, cloneCanvas) => {
  if (!sourceCanvas || !cloneCanvas) return false;
  cloneCanvas.width = sourceCanvas.width || 1;
  cloneCanvas.height = sourceCanvas.height || 1;
  try {
    cloneCanvas.getContext('2d')?.drawImage(sourceCanvas, 0, 0);
    return true;
  } catch (err) {
    return false;
  }
};

const appendOpeningFreezeBoard = () => {
  const rect = boardCanvas?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  const clone = document.createElement('canvas');
  copyOpeningFreezeCanvas(boardCanvas, clone);
  clone.className = 'opening-freeze-canvas';
  Object.assign(clone.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  openingShield.appendChild(clone);
};

const appendOpeningFreezeCards = () => {
  const card = typeof eyedropperCard !== 'undefined' ? eyedropperCard : null;
  if (!card?.el?.classList.contains('visible')) return;
  const clone = card.el.cloneNode(true);
  stripOpeningFreezeIds(clone);
  clone.classList.add('opening-freeze-card');
  clone.setAttribute('aria-hidden', 'true');
  const sourceCanvases = card.el.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  for (let i = 0; i < sourceCanvases.length; i++) {
    copyOpeningFreezeCanvas(sourceCanvases[i], cloneCanvases[i]);
  }
  openingShield.appendChild(clone);
};

const beginOpeningFreeze = () => {
  if (!openingShield) return;
  openingShield.replaceChildren();
  openingShield.style.background = canvas ? getComputedStyle(canvas).backgroundColor : '';
  openingShield.classList.add('opening-freeze', 'active');
  appendOpeningFreezeBoard();
  appendOpeningFreezeCards();
};

const endOpeningFreeze = () => {
  if (!openingShield) return;
  openingShield.classList.remove('active', 'opening-freeze');
  openingShield.replaceChildren();
  openingShield.style.background = '';
};

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

const getBoardSaveDebugMetrics = (dbg, data) => (
  SaveDebug.enabled && dbg ? getBoardSaveMetrics(data) : {}
);

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

async function invokeSaveBoard(fileRef, dbg) {
  const path = BoardfishRuntime.describeFileRef(fileRef);
  if (typeof flushEditHistoryCheckpoint === 'function' && flushEditHistoryCheckpoint()) {
    SaveDebug.step(dbg, 'flush-edit-history', { path, historyIndex });
  }
  const dataStart = performance.now();
  const data = boardDataForSave();
  const metrics = getBoardSaveDebugMetrics(dbg, data);
  SaveDebug.step(dbg, 'boardData', { ms: performance.now() - dataStart, path, ...metrics });
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
  const command = hasTauri() ? TAURI_COMMANDS.SAVE_BOARD : BoardfishRuntime.WEB_COMMANDS.SAVE_BOARD;
  const result = await SaveDebug.wrap(
    dbg,
    command,
    () => BoardfishRuntime.saveBoard(fileRef, data, { imageStore }),
    { path, ...metrics }
  );
  if (frameProbe) frameProbe();
  return result;
}

async function invokeReadBoard(fileRef, dbg) {
  const path = BoardfishRuntime.describeFileRef(fileRef);
  const frameProbe = scheduleOpenFrameProbe(dbg, 'open-frame-probe');
  const command = hasTauri() ? TAURI_COMMANDS.READ_BOARD : BoardfishRuntime.WEB_COMMANDS.READ_BOARD;
  const result = await OpenDebug.wrap(dbg, command, () => BoardfishRuntime.readBoard(fileRef), { path });
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

const isOpenHydratableImageSource = (source) => {
  return typeof source === 'string' || isNativeImageRef(source) || isWebImageRef(source);
};

function getVisibleImageKeys(limit = Infinity) {
  const b = getVisibleWorldBounds();
  const keys = [];
  const seen = new Set();
  const skipped = { nonImage: 0, outside: 0, missingKey: 0, nonHydratable: 0, cached: 0, duplicate: 0 };
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type !== 'image') { skipped.nonImage++; continue; }
    if (!objectIntersectsRect(obj, b)) { skipped.outside++; continue; }
    const key = obj.data.imgKey;
    if (!key) { skipped.missingKey++; continue; }
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);
    const source = BoardfishImageStore.getSource(key);
    if (!source) { skipped.missingKey++; continue; }
    if (!isOpenHydratableImageSource(source)) { skipped.nonHydratable++; continue; }
    if (BoardfishImageStore.hasDisplayImage(key)) { skipped.cached++; continue; }
    keys.push(key);
    if (keys.length >= limit) break;
  }
  getVisibleImageKeys.lastDebug = { visibleBounds: b, selected: keys.length, skipped };
  return keys;
}
getVisibleImageKeys.lastDebug = null;

function getReferencedHydratableImageKeys(limit = Infinity, exclude = new Set()) {
  const keys = [];
  const seen = new Set();
  const skipped = { excluded: 0, nonImage: 0, missingKey: 0, missingStore: 0, nonHydratable: 0, cached: 0, duplicate: 0 };
  for (const obj of objects) {
    if (obj.type !== 'image') { skipped.nonImage++; continue; }
    const key = obj.data?.imgKey;
    if (!key) { skipped.missingKey++; continue; }
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);
    if (exclude.has(key)) { skipped.excluded++; continue; }
    const source = BoardfishImageStore.getSource(key);
    if (!source) { skipped.missingStore++; continue; }
    if (!isOpenHydratableImageSource(source)) { skipped.nonHydratable++; continue; }
    if (BoardfishImageStore.hasDisplayImage(key)) { skipped.cached++; continue; }
    keys.push(key);
    if (keys.length >= limit) break;
  }
  getReferencedHydratableImageKeys.lastDebug = { selected: keys.length, skipped };
  return keys;
}
getReferencedHydratableImageKeys.lastDebug = null;

function getPendingHydratableImageKeys(limit = Infinity, exclude = new Set()) {
  const keys = [];
  const skipped = { excluded: 0, nonHydratable: 0, cached: 0 };
  for (const key of BoardfishImageStore.sourceKeys()) {
    if (exclude.has(key)) { skipped.excluded++; continue; }
    if (!isOpenHydratableImageSource(BoardfishImageStore.getSource(key))) { skipped.nonHydratable++; continue; }
    if (BoardfishImageStore.hasDisplayImage(key)) { skipped.cached++; continue; }
    keys.push(key);
    if (keys.length >= limit) break;
  }
  getPendingHydratableImageKeys.lastDebug = { selected: keys.length, skipped };
  return keys;
}
getPendingHydratableImageKeys.lastDebug = null;

async function hydrateImageForDisplay(key, dbg = null) {
  const source = BoardfishImageStore.getSource(key);
  if (BoardfishImageStore.hasDisplayImage(key) || !isOpenHydratableImageSource(source)) return false;
  const pendingReady = imageReadyPromises.get(key);
  if (pendingReady) {
    const t0 = performance.now();
    const cacheMetrics = await pendingReady;
    const displayReady = BoardfishImageStore.hasDisplayImage(key);
    OpenDebug.step(dbg, 'hydrate-image', {
      imgKey: key,
      ms: performance.now() - t0,
      fetchMs: 0,
      loadMs: 0,
      readyMs: performance.now() - t0,
      ...(cacheMetrics || {}),
      dataUrlLen: 0,
      source: 'pending-cache',
      bitmapReady: !!imageBitmapCache[key],
      displayReady,
    });
    return displayReady;
  }
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
  const readyStart = performance.now();
  const cacheMetrics = await cacheImage(key, display.src, dbg, img, {
    skipSourceRegistration: true,
    resolveOnLoad: true,
  });
  const readyMs = performance.now() - readyStart;
  const bitmapReady = !!imageBitmapCache[key];
  const displayReady = BoardfishImageStore.hasDisplayImage(key);
  OpenDebug.step(dbg, 'hydrate-image', {
    imgKey: key,
    ms: performance.now() - t0,
    fetchMs,
    loadMs,
    readyMs,
    ...(cacheMetrics || {}),
    dataUrlLen: display.dataUrlLen,
    source: display.source,
    bitmapReady,
    displayReady,
  });
  return displayReady;
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

function countVisibleImageBitmapSettle(keys) {
  const visibleKeys = Array.isArray(keys) ? keys.filter(Boolean) : [];
  let ready = 0;
  let failed = 0;
  let missingStore = 0;
  for (const key of visibleKeys) {
    if (imageBitmapCache[key]) {
      ready++;
    } else if (imageBitmapFailed.has(key)) {
      failed++;
    } else if (!BoardfishImageStore.hasSource(key)) {
      missingStore++;
    }
  }
  const count = visibleKeys.length;
  const settled = ready + failed + missingStore;
  return {
    count,
    ready,
    failed,
    missingStore,
    settled,
    pending: Math.max(0, count - settled),
  };
}

async function settleVisibleImageBitmapsForOpen(keys, dbg = null) {
  const visibleKeys = Array.isArray(keys) ? keys.filter(Boolean) : [];
  const count = visibleKeys.length;
  let state = countVisibleImageBitmapSettle(visibleKeys);
  const before = state.ready;
  if (!count || state.settled >= count) {
    OpenDebug.step(dbg, 'hydrate-visible:bitmap-settle', {
      count,
      before,
      after: state.ready,
      failed: state.failed,
      missingStore: state.missingStore,
      pending: state.pending,
      settled: state.settled,
      missing: Math.max(0, count - state.ready),
      ms: 0,
      skipped: !count ? 'no-visible-images' : 'already-ready',
      target: count,
    });
    return { count, before, after: state.ready, failed: state.failed, missingStore: state.missingStore, pending: state.pending, settled: state.settled, missing: Math.max(0, count - state.ready), target: count, ms: 0, skipped: true };
  }

  const startedAt = performance.now();
  while (state.settled < count) {
    await new Promise((resolve) => setTimeout(resolve, 12));
    state = countVisibleImageBitmapSettle(visibleKeys);
  }
  const ms = performance.now() - startedAt;
  OpenDebug.step(dbg, 'hydrate-visible:bitmap-settle', {
    count,
    before,
    after: state.ready,
    failed: state.failed,
    missingStore: state.missingStore,
    pending: state.pending,
    settled: state.settled,
    missing: Math.max(0, count - state.ready),
    target: count,
    ms,
  });
  return { count, before, after: state.ready, failed: state.failed, missingStore: state.missingStore, pending: state.pending, settled: state.settled, missing: Math.max(0, count - state.ready), target: count, ms };
}

async function hydrateImageBatchForOpen(keys, dbg = null, label = 'hydrate-batch') {
  return hydrateImageKeysWithLimit(keys, dbg, label, OpenDebug.hydrationConcurrency);
}

async function hydrateAllImagesForOpen(dbg = null) {
  const keys = getReferencedHydratableImageKeys();
  OpenDebug.step(dbg, 'hydrate-all:candidates', {
    count: keys.length,
    ...(getReferencedHydratableImageKeys.lastDebug || {}),
    pendingImages: getPendingHydratableImageKeys().length,
    ...getOpenImageRuntimeMetrics(),
  });
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
      const keys = getPendingHydratableImageKeys(batchSize);
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
      remaining: getPendingHydratableImageKeys().length,
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

var openHydrationMode = 'visible-first';
function setOpenHydrationMode(mode) {
  const allowed = new Set(['all-before-open', 'visible-first']);
  if (!allowed.has(mode)) return openHydrationMode;
  openHydrationMode = mode;
  return openHydrationMode;
}
function getOpenHydrationMode() {
  return openHydrationMode;
}

async function finishOpenedBoard(dbg, data) {
  PillDebug.log('open:finishOpenedBoard:start', getBoardOpenMetrics(data));
  const hydrationMode = getOpenHydrationMode();
  if (hydrationMode === 'visible-first') {
    const hydrateStart = performance.now();
    const visibleKeys = await hydrateVisibleImagesForOpen(dbg);
    PillDebug.log('open:hydrate-visible:end', { phaseMs: performance.now() - hydrateStart, visibleCount: visibleKeys?.length || 0 });
    const bitmapSettle = await settleVisibleImageBitmapsForOpen(visibleKeys, dbg);
    PillDebug.log('open:hydrate-visible:bitmap-settle', { phaseMs: bitmapSettle.ms, before: bitmapSettle.before, after: bitmapSettle.after, failed: bitmapSettle.failed, pending: bitmapSettle.pending, missing: bitmapSettle.missing });
    OpenDebug.step(dbg, 'hydrate-initial-policy', {
      mode: 'visible-first',
      visibleCount: visibleKeys?.length || 0,
      visibleBitmapsReady: bitmapSettle.after,
      visibleBitmapsFailed: bitmapSettle.failed,
      visibleBitmapsMissing: bitmapSettle.missing,
      visibleBitmapSettleMs: bitmapSettle.ms,
      pendingImages: getPendingHydratableImageKeys().length,
    });
  } else {
    OpenDebug.step(dbg, 'hydrate-initial-policy', {
      mode: 'all-before-open',
      pendingImages: getPendingHydratableImageKeys().length,
    });
    const hydrateStart = performance.now();
    await hydrateAllImagesForOpen(dbg);
    PillDebug.log('open:hydrate-all:end', { phaseMs: performance.now() - hydrateStart, pendingImages: getPendingHydratableImageKeys().length });
  }
  _boardOpening = false;
  const renderStart = performance.now();
  PillDebug.log('open:initial-applyTransform:start');
  applyTransform();
  const renderMs = performance.now() - renderStart;
  const renderBreakdown = typeof getLastApplyTransformMeta === 'function'
    ? getLastApplyTransformMeta()
    : null;
  const drawBreakdown = renderBreakdown?.drawBoard || null;
  PillDebug.log('open:initial-applyTransform:end', { phaseMs: renderMs });
  OpenDebug.step(dbg, 'initial-applyTransform', {
    ms: renderMs,
    totalMeasuredMs: renderBreakdown?.totalMeasuredMs ?? '',
    drawMs: renderBreakdown?.drawMs ?? '',
    saveViewportMs: renderBreakdown?.saveViewportMs ?? '',
    overlayMs: renderBreakdown?.overlayMs ?? '',
    overlaySkipped: renderBreakdown?.overlaySkipped ?? '',
    drawBoardTotalMs: drawBreakdown?.totalMeasuredMs ?? '',
    backgroundSetupMs: drawBreakdown?.backgroundSetupMs ?? '',
    objectLoopMs: drawBreakdown?.objectLoopMs ?? '',
    resetMs: drawBreakdown?.resetMs ?? '',
    drawnImages: drawBreakdown?.drawnImages ?? '',
    drawnText: drawBreakdown?.drawnText ?? '',
    visibleObjects: drawBreakdown?.visibleObjects ?? '',
    testedObjects: drawBreakdown?.testedObjects ?? '',
    culledImages: drawBreakdown?.culledImages ?? '',
    culledText: drawBreakdown?.culledText ?? '',
    bitmapImages: drawBreakdown?.bitmapImages ?? '',
    elementImages: drawBreakdown?.elementImages ?? '',
    scaledImages: drawBreakdown?.scaledImages ?? '',
    scaledFallbackFull: drawBreakdown?.scaledFallbackFull ?? '',
    scaledVariantPendingImages: drawBreakdown?.scaledVariantPendingImages ?? '',
    croppedImages: drawBreakdown?.croppedImages ?? '',
  });
  const prewarmResult = typeof scheduleEyedropperNativeDecodePrewarm === 'function'
    ? scheduleEyedropperNativeDecodePrewarm('board-loaded')
    : { scheduled: false, reason: 'unavailable' };
  OpenDebug.step(dbg, 'eyedropper-prewarm:scheduled', prewarmResult || { scheduled: false });
  const pillFinishReason = await finishPillTask({
    beforeFinish: () => {
      const shieldStart = performance.now();
      applyNativeAppTheme();
      if (typeof endOpeningFreeze === 'function') endOpeningFreeze();
      else openingShield.classList.remove('active');
      OpenDebug.step(dbg, 'opening-shield:removed', { ms: performance.now() - shieldStart });
      PillDebug.log('open:openingShield:removed', { reason: 'before-pill-hide' });
    },
  });
  PillDebug.log('open:pillFinish:end', { pillFinishReason });
  OpenDebug.end(dbg, { opened: true, ...getBoardOpenMetrics(data) });
  if (hydrationMode === 'visible-first') {
    setTimeout(() => hydrateRemainingImagesForOpen(dbg).catch((err) => {
      OpenDebug.step(dbg, 'hydrate-background:error', { error: String(err) });
    }), 80);
  }
}

function applyBoardData(data, options = {}) {
  data = BoardSchema.normalizeBoardData(data);
  if (!hasTauri()) BoardfishWebLimits.assertBoardDataAllowed(data);
  const prune = BoardfishBoardDocument.pruneBoardDataImageStore(data);
  data = prune.data;
  const dbg = options.dbg || null;
  const sourcesCached = !!options.sourcesCached;
  const deferRender = !!options.deferRender;
  const endDebug = options.endDebug !== false;
  PillDebug.log('open:applyBoardData:start', getBoardOpenMetrics(data));
  OpenDebug.step(dbg, 'applyBoardData:start', getBoardOpenMetrics(data));
  OpenDebug.step(dbg, 'prune-unreferenced-images', {
    removed: prune.removed,
    kept: prune.kept,
    referenced: prune.referenced,
  });
  setEyedropperEnabled(false);
  clearJsClipboard();
  if (typeof clearEyedropperCardForBoard === 'function') {
    clearEyedropperCardForBoard();
  }
  const t0 = performance.now();
  clearImageStore(!sourcesCached);
  OpenDebug.step(dbg, 'clearImageStore', { ms: performance.now() - t0 });

  const imageStart = performance.now();
  BoardfishImageStore.setSources(data.imageStore || {});
  const visibleFirstOpen = deferRender &&
    typeof getOpenHydrationMode === 'function' &&
    getOpenHydrationMode() === 'visible-first';
  let deferredInitialCacheImages = 0;
  _skipImageSourceRegistration = sourcesCached;
  try {
    for (const k of BoardfishImageStore.sourceKeys()) {
      const source = BoardfishImageStore.getSource(k);
      const n = parseInt(k.split('-')[1]);
      if (!isNaN(n) && n >= imgKeyCounter) imgKeyCounter = n + 1;
      if (visibleFirstOpen && isOpenHydratableImageSource(source)) {
        deferredInitialCacheImages++;
        continue;
      }
      if (!sourcesCached || !isNativeImageRef(source)) cacheImage(k, source);
    }
  } finally {
    _skipImageSourceRegistration = false;
  }
  OpenDebug.step(dbg, 'cacheImage:start-all', {
    ms: performance.now() - imageStart,
    sourcesCached,
    deferredInitialCacheImages,
    visibleFirstOpen,
    ...getOpenImageRuntimeMetrics(),
  });
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

const runExclusiveBoardSave = (op, run) => {
  if (runExclusiveBoardSave.inFlight) {
    const dbg = SaveDebug.start(`${op}:coalesced`, { reason: 'save-in-flight' });
    SaveDebug.end(dbg, { reused: true });
    return runExclusiveBoardSave.inFlight;
  }
  const promise = Promise.resolve().then(run);
  const tracked = promise.finally(() => {
    if (runExclusiveBoardSave.inFlight === tracked) runExclusiveBoardSave.inFlight = null;
  });
  runExclusiveBoardSave.inFlight = tracked;
  return tracked;
};
runExclusiveBoardSave.inFlight = null;

const saveBoardAsImpl = async () => {
  const dbg = SaveDebug.start('saveBoardAs', { currentFilePath, objectCount: objects.length });
  const releaseInputShield = acquireInputShield({ visual: false, keepSelectionOverlay: true });
  try {
    const defaultName = BoardfishRuntime.fileNameFromRef(currentFileRef || currentFilePath, 'board.bf');
    const command = hasTauri() ? TAURI_COMMANDS.SAVE_FILE_DIALOG : BoardfishRuntime.WEB_COMMANDS.SAVE_FILE_DIALOG;
    const fileRef = await SaveDebug.wrap(dbg, command, () => BoardfishRuntime.saveFileDialog(defaultName), { defaultName });
    if (!fileRef) { SaveDebug.end(dbg, { cancelled: true }); releaseInputShield(); return false; }
    await runShieldedPillTask({
      releaseInputShield,
      startMessage: 'Saving',
      successMessage: 'Saved',
      task: async () => {
        await invokeSaveBoard(fileRef, dbg);
        currentFileRef = fileRef;
        currentFilePath = BoardfishRuntime.describeFileRef(fileRef);
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
};

async function saveBoardAs() {
  return runExclusiveBoardSave('saveBoardAs', saveBoardAsImpl);
}

const saveBoardImpl = async () => {
  const target = BoardfishRuntime.canSaveToExistingTarget(currentFileRef)
    ? currentFileRef
    : (hasTauri() && currentFilePath ? currentFilePath : null);
  if (target) {
    const path = BoardfishRuntime.describeFileRef(target);
    const dbg = SaveDebug.start('saveBoard', { path, objectCount: objects.length });
    const releaseInputShield = acquireInputShield({ visual: false, keepSelectionOverlay: true });
    try {
      await runShieldedPillTask({
        releaseInputShield,
        startMessage: 'Saving',
        successMessage: 'Saved',
        task: async () => {
          await invokeSaveBoard(target, dbg);
          SaveDebug.step(dbg, 'markSaved:start');
          markSaved();
          SaveDebug.step(dbg, 'markSaved:end');
        },
      });
      SaveDebug.end(dbg, { saved: true, path });
      return true;
    } catch (err) {
      releaseInputShield();
      console.error('Save failed:', err);
      SaveDebug.end(dbg, { saved: false, error: String(err) });
      return false;
    }
  }
  return saveBoardAsImpl();
};

async function saveBoard() {
  return runExclusiveBoardSave('saveBoard', saveBoardImpl);
}


async function openBoardFileRef(fileRef) {
  const path = BoardfishRuntime.describeFileRef(fileRef);
  const dbg = OpenDebug.start('openBoardFileRef', { path, currentFilePath, objectCount: objects.length });
  if (!(await confirmDirtyBeforeOpen(dbg))) return;
  await openBoardFromPath(fileRef, dbg, 'Open failed:');
}

async function openBoard() {
  const dbg = OpenDebug.start('openBoard', { currentFilePath, objectCount: objects.length });

  if (!(await confirmDirtyBeforeOpen(dbg))) return;

  try {
    const command = hasTauri() ? TAURI_COMMANDS.OPEN_FILE_DIALOG : BoardfishRuntime.WEB_COMMANDS.OPEN_FILE_DIALOG;
    const fileRef = await OpenDebug.wrap(dbg, command, () => BoardfishRuntime.openFileDialog());
    if (!fileRef) { OpenDebug.end(dbg, { cancelled: true }); return; }
    await openBoardFromPath(fileRef, dbg, 'Open failed:');
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
} else {
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
