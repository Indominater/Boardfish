// ─── Dirty tracking ───────────────────────────────────────────────────────────

var savedHistoryRevision;
var savedDefaultEmptyBoard = false;
var currentFilePath = null;
var currentFileRef = null;

function isDefaultEmptyBoardState(objectList = objects) {
  for (const obj of objectList || []) {
    if (!obj) continue;
    if (obj.type !== 'text') return false;
    const content = obj.data?.content;
    if ((typeof isTextContentEmpty === 'function'
      ? !isTextContentEmpty(content)
      : String(content || '').trim() !== '')) return false;
  }
  return true;
}

function isCleanDefaultEmptyBoardState() {
  return savedDefaultEmptyBoard && isDefaultEmptyBoardState(objects);
}

function isDirty() {
  const revision = boardHistory[historyIndex]?.revision;
  return (_dirtyIds.size > 0 || revision === undefined || revision !== savedHistoryRevision) && !isCleanDefaultEmptyBoardState();
}

function markSaved(updateDocumentTitle = true) {
  _dirtyIds.clear();
  savedHistoryRevision = boardHistory[historyIndex]?.revision;
  savedDefaultEmptyBoard = isDefaultEmptyBoardState();
  if (updateDocumentTitle) updateTitle();
}

function updateTitle() {
  const fileName = BoardfishRuntime?.fileNameFromRef?.(currentFileRef || currentFilePath, '') || '';
  const title = fileName ? `${isDirty() ? '* ' : ''}${fileName}` : 'Boardfish';
  if (document.title !== title) document.title = title;
}


// ─── Unsaved changes dialog ───────────────────────────────────────────────────
function _dialogClose(result) {
  dialogOverlay.classList.remove('show');
  const r = _dialogResolve;
  _dialogResolve = null;
  updateInputShieldVisual();
  if (r) r(result);
}

unsavedDialog.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
document.getElementById('dlg-save').addEventListener('click', () => {
  _dialogClose('save');
});
document.getElementById('dlg-discard').addEventListener('click', () => {
  _dialogClose('discard');
});
document.getElementById('dlg-cancel').addEventListener('click', () => {
  _dialogClose('cancel');
});

// Returns 'save' | 'discard' | 'cancel'
function showUnsavedDialog() {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    dialogOverlay.classList.add('show');
    updateInputShieldVisual();
  });
}

const appendOpeningFreezeBoard = () => {
  const rect = boardCanvas?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  Object.assign(boardCanvas.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  openingShield.appendChild(boardCanvas);
};

const beginOpeningFreeze = () => {
  if (!openingShield || boardCanvas.parentNode === openingShield) return;
  openingShield.replaceChildren();
  openingShield.style.background = canvas ? getComputedStyle(canvas).backgroundColor : '';
  openingShield.classList.add('opening-freeze', 'active');
  appendOpeningFreezeBoard();
};

const endOpeningFreeze = () => {
  if (!openingShield) return;
  canvas.prepend(boardCanvas);
  boardCanvas.removeAttribute('style');
  openingShield.classList.remove('active', 'opening-freeze');
  openingShield.replaceChildren();
  openingShield.style.background = '';
  resizeCanvas();
};

// ─── Save / Open ─────────────────────────────────────────────────────────────

function boardDocumentDeps() {
  return {
    imageStoreBytesEstimate,
    imageRefKind,
    rawImageStore: imageStore,
    rawObjects: objects,
    historyLength: boardHistory.length,
    historyIndex,
    dirty: isDirty(),
    runtime: {
      imageBitmapCache,
      imageBitmapFailed,
    },
  };
}

function boardDataForSave() {
  return BoardfishBoardDocument.createBoardDataForSave({
    viewport: { panX, panY, zoom },
    imageStore,
    objects,
  }, { schema: BoardSchema, guessImageExtFromDataUrl: BoardfishExportUtils.guessImageExtFromDataUrl });
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function getBoardSaveMetrics(data) {
  return BoardfishBoardDocument.getBoardSaveMetrics(data, boardDocumentDeps());
}

const getBoardSaveDebugMetrics = (dbg, data) => (
  SaveDebug.enabled && dbg ? getBoardSaveMetrics(data) : {}
);

function getBoardOpenMetrics(data) {
  return BoardfishBoardDocument.getBoardOpenMetrics(data, boardDocumentDeps());
}

const isDebugApiEnabledForStep = (api, dbg = null) => {
  return !!(dbg && api && (api.enabled === true || api.isEnabled?.() === true));
};

const isOpenDebugActive = (dbg = null) => {
  return isDebugApiEnabledForStep(OpenDebug, dbg);
};

const isPillDebugActive = () => {
  return !!(PillDebug && (PillDebug.enabled === true || PillDebug.isEnabled?.() === true));
};

const shouldCollectOpenBoardMetrics = (dbg = null) => {
  return isOpenDebugActive(dbg) || isPillDebugActive();
};

const getBoardOpenDebugMetrics = (dbg, data) => {
  return shouldCollectOpenBoardMetrics(dbg) ? getBoardOpenMetrics(data) : {};
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function imageRefKind(src) {
  return BoardfishBoardDocument.defaultImageRefKind(src);
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
function getImageStoreOpenDebugSample(limit = 12) {
  return BoardfishBoardDocument.getImageStoreDebugSample(imageStore, boardDocumentDeps(), limit);
}

function getOpenImageRuntimeMetrics() {
  return BoardfishBoardDocument.getImageRuntimeMetrics(imageStore, boardDocumentDeps());
}

const getOpenImageRuntimeDebugMetrics = (dbg = null) => {
  return isOpenDebugActive(dbg) ? getOpenImageRuntimeMetrics() : {};
};

const getImageStoreOpenDebugSampleIfEnabled = (dbg = null) => {
  return isOpenDebugActive(dbg) ? getImageStoreOpenDebugSample() : [];
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

/* BOARDFISH_DEV_DIAGNOSTICS_START */
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
/* BOARDFISH_DEV_DIAGNOSTICS_END */

async function invokeSaveBoard(fileRef
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  , options = {}
) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    const historyFlushed = typeof flushEditHistoryCheckpoint === 'function' && flushEditHistoryCheckpoint();
    const path = BoardfishRuntime.describeFileRef(fileRef);
    if (historyFlushed) SaveDebug.step(dbg, 'flush-edit-history', { path, historyIndex });
    const dataStart = performance.now();
    const data = boardDataForSave();
    const metrics = getBoardSaveDebugMetrics(dbg, data);
    SaveDebug.step(dbg, 'boardData', { ms: performance.now() - dataStart, path, ...metrics });
    const frameProbe = scheduleSaveFrameProbe(dbg, 'save-frame-probe');
    const result = await SaveDebug.wrap(
      dbg,
      'web_save_board',
      () => BoardfishRuntime.saveBoard(fileRef, data, { imageStore, ...options }),
      { path, ...metrics },
    );
    if (frameProbe) frameProbe();
    return result;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (typeof flushEditHistoryCheckpoint === 'function') flushEditHistoryCheckpoint();
  const data = boardDataForSave();
  return BoardfishRuntime.saveBoard(fileRef, data, { imageStore, ...options });
}

async function invokeReadBoard(fileRef
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    const path = BoardfishRuntime.describeFileRef(fileRef);
    const frameProbe = scheduleOpenFrameProbe(dbg, 'open-frame-probe');
    const result = await OpenDebug.wrap(dbg, 'web_read_board', () => BoardfishRuntime.readBoard(fileRef), { path });
    if (frameProbe) frameProbe();
    const board = result?.board || result;
    if (isOpenDebugActive(dbg)) {
      const boardMetrics = getBoardOpenMetrics(board);
      if (result && result.debug) OpenDebug.step(dbg, 'read-board-debug', { rust: result.debug, ...boardMetrics });
      OpenDebug.step(dbg, 'read-board-shape', boardMetrics);
    }
    return board;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const result = await BoardfishRuntime.readBoard(fileRef);
  return result?.board || result;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
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
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function getVisibleWorldBounds() {
  return viewportWorldRect();
}

const isOpenHydratableImageSource = (source) => {
  return typeof source === 'string' || isWebImageRef(source);
};

function updateVisibleImagePreviewTask(tasks, key, obj) {
  const area = Math.max(1, Number(obj.w || 0)) * Math.max(1, Number(obj.h || 0));
  const previous = tasks.get(key);
  if (!previous || area > previous.area) tasks.set(key, { key, obj, area });
}

function getVisibleImageKeys(limit = Infinity, previewTasks = null) {
  const b = getVisibleWorldBounds();
  const keys = [];
  const seen = previewTasks || new Set();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const skipped = { nonImage: 0, outside: 0, missingKey: 0, nonHydratable: 0, cached: 0, duplicate: 0 };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type !== 'image') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.nonImage++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    if (!objectIntersectsRect(obj, b)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.outside++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    const key = obj.data.imgKey;
    if (!key) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.missingKey++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    if (seen.has(key)) {
      if (previewTasks?.get(key)) updateVisibleImagePreviewTask(previewTasks, key, obj);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.duplicate++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    if (previewTasks) previewTasks.set(key, null);
    else seen.add(key);
    const source = BoardfishImageStore.getSource(key);
    if (!source) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.missingKey++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    if (!isOpenHydratableImageSource(source)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.nonHydratable++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    if (previewTasks) updateVisibleImagePreviewTask(previewTasks, key, obj);
    if (BoardfishImageStore.hasDisplayImage(key)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.cached++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    keys.push(key);
    if (keys.length >= limit) break;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  getVisibleImageKeys.lastDebug = { visibleBounds: b, selected: keys.length, skipped };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return keys;
}
/* BOARDFISH_DEV_DIAGNOSTICS_START */
if (typeof BOARDFISH_PRODUCTION === 'undefined') getVisibleImageKeys.lastDebug = null;
/* BOARDFISH_DEV_DIAGNOSTICS_END */

function getPendingHydratableImageKeys() {
  const keys = Object.keys(imageStore);
  let write = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const skipped = { nonHydratable: 0, cached: 0 };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (const key of keys) {
    if (!isOpenHydratableImageSource(BoardfishImageStore.getSource(key))) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.nonHydratable++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    if (BoardfishImageStore.hasDisplayImage(key)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.cached++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    keys[write++] = key;
  }
  keys.length = write;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  getPendingHydratableImageKeys.lastDebug = { selected: keys.length, skipped };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return keys;
}
/* BOARDFISH_DEV_DIAGNOSTICS_START */
if (typeof BOARDFISH_PRODUCTION === 'undefined') getPendingHydratableImageKeys.lastDebug = null;
/* BOARDFISH_DEV_DIAGNOSTICS_END */

async function hydrateImageForDisplay(key
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const source = BoardfishImageStore.getSource(key);
  if (BoardfishImageStore.hasDisplayImage(key) || !isOpenHydratableImageSource(source)) return false;
  const pendingReady = imageReadyPromises.get(key);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
  if (pendingReady) {
    const t0 = performance.now();
    const cacheMetrics = await pendingReady;
    const displayReady = BoardfishImageStore.hasDisplayImage(key);
    OpenDebug.step(dbg, 'hydrate-image', {
      imgKey: key,
      ms: performance.now() - t0,
      fetchMs: 0,
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
  const readyStart = performance.now();
  const cacheMetrics = await cacheImage(key, source, dbg);
  const readyMs = performance.now() - readyStart;
  const displayReady = BoardfishImageStore.hasDisplayImage(key);
  OpenDebug.step(dbg, 'hydrate-image', {
    imgKey: key,
    ms: performance.now() - t0,
    fetchMs: 0,
    readyMs,
    ...(cacheMetrics || {}),
    dataUrlLen: typeof source === 'string' ? source.length : 0,
    source: typeof source === 'string' ? 'data-url' : 'web-blob',
    bitmapReady: !!imageBitmapCache[key],
    displayReady,
  });
  return displayReady;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (pendingReady) {
    await pendingReady;
    return BoardfishImageStore.hasDisplayImage(key);
  }
  await cacheImage(key, source);
  return BoardfishImageStore.hasDisplayImage(key);
}

async function hydrateImageKeysWithLimit(keys
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg, label
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  , concurrency = getOpenHydrationConcurrency()
) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, `${label}:start`, { count: keys.length, concurrency, ...getOpenImageRuntimeDebugMetrics(dbg) });
  const t0 = performance.now();
  let hydrated = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let anyHydrated = false;
  await mapWithConcurrency(keys, concurrency, async (key) => {
    try {
      if (await hydrateImageForDisplay(key
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      )) {
        anyHydrated = true;
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        hydrated++;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
    } catch (err) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      OpenDebug.step(dbg, `${label}:error`, { imgKey: key, error: String(err) });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
  }, false);
  if (anyHydrated) invalidateOffscreen();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, `${label}:end`, { count: keys.length, hydrated, concurrency, ms: performance.now() - t0, ...getOpenImageRuntimeDebugMetrics(dbg) });
  if (typeof BOARDFISH_PRODUCTION === 'undefined') return hydrated;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return anyHydrated;
}

async function buildVisibleImagePreviewsForOpen(previewTasks
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  if (typeof buildOpenInitialImagePreviewForOpen !== 'function') return null;
  const tasks = [];
  for (const task of previewTasks.values()) if (task) tasks.push(task);
  const view = { zoom, panX, panY, dpr: window.devicePixelRatio || 1 };
  const concurrency = Math.max(1, Math.min(8, tasks.length || 1));
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const t0 = performance.now();
  OpenDebug.step(dbg, 'open-preview-visible:start', {
    count: tasks.length,
    selected: tasks.length,
    includeCached: true,
    concurrency,
  });
  let built = 0;
  let ready = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let pendingReady = 0;
  const results = await mapWithConcurrency(tasks, concurrency, async ({ key, obj }) => {
    const result = await buildOpenInitialImagePreviewForOpen(key, obj, view
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    );
    if (result.ready) {
      pendingReady++;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      ready++;
      if (!result.skipped) built++;
      bytes += Number(result.bytes) || 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    else if (result.skipped === 'error') failed++;
    else skipped++;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return result;
  },
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  typeof BOARDFISH_PRODUCTION === 'undefined' ? true :
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  false);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (!shouldCollectOpenBoardMetrics(dbg)) return { pendingReady };
  const resultRows = new Array(results.length);
  const slowResults = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const row = {
      key: result?.key || '',
      ready: result?.ready === true,
      skipped: result?.skipped || '',
      width: result?.width ?? '',
      height: result?.height ?? '',
      ms: result?.ms ?? '',
      error: result?.error || '',
    };
    resultRows[i] = row;
    const rowMs = Number(row.ms) || 0;
    let insertAt = slowResults.length;
    while (insertAt > 0 && rowMs > (Number(slowResults[insertAt - 1].ms) || 0)) insertAt--;
    if (insertAt < 24) {
      slowResults.splice(insertAt, 0, row);
      if (slowResults.length > 24) slowResults.pop();
    }
  }
  const slowest = slowResults[0] || null;
  const sampleResults = resultRows.slice(0, 24);
  const out = {
    count: tasks.length,
    selected: tasks.length,
    ready,
    pendingReady,
    built,
    failed,
    skipped,
    bytes,
    mb: Math.round(bytes / 1024 / 1024 * 100) / 100,
    concurrency,
    ms: performance.now() - t0,
    maxMs: slowest?.ms ?? '',
    maxKey: slowest?.key || '',
    maxWidth: slowest?.width ?? '',
    maxHeight: slowest?.height ?? '',
    results: sampleResults,
    slowResults,
  };
  OpenDebug.step(dbg, 'open-preview-visible:end', out);
  return out;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return { pendingReady };
}

function countVisibleImageBitmapSettle(visibleKeys) {
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
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
  return {
    count,
    ready,
    failed,
    missingStore,
    settled,
    pending: Math.max(0, count - settled),
  };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return { ready, settled };
}

async function settleVisibleImageBitmapsForOpen(keys
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const visibleKeys = keys;
  const count = visibleKeys.length;
  let state = countVisibleImageBitmapSettle(visibleKeys);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const before = state.ready;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!count || state.settled >= count) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return null;
  }

  const startedAt = performance.now();
  const timeoutMs = 15000;
  const deadline = startedAt + timeoutMs;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let timedOut = false;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  while (state.settled < count) {
    await new Promise((resolve) => setTimeout(resolve, 12));
    state = countVisibleImageBitmapSettle(visibleKeys);
    if (performance.now() >= deadline) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      timedOut = true;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      break;
    }
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const ms = performance.now() - startedAt;
  const pendingKeys = [];
  if (timedOut) {
    for (const key of visibleKeys) {
      const source = BoardfishImageStore.getSource(key);
      if (source && !imageBitmapCache[key] && !imageBitmapFailed.has(key)) pendingKeys.push(key);
    }
  }
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
    timedOut,
    timeoutMs,
    pendingKeys,
  });
  return { count, before, after: state.ready, failed: state.failed, missingStore: state.missingStore, pending: state.pending, settled: state.settled, missing: Math.max(0, count - state.ready), target: count, ms, timedOut, timeoutMs, pendingKeys };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return null;
}

/* BOARDFISH_DEV_DIAGNOSTICS_START */
async function hydrateImageBatchForOpen(keys, dbg = null, label = 'hydrate-batch') {
  return hydrateImageKeysWithLimit(keys, dbg, label, getOpenHydrationConcurrency());
}
/* BOARDFISH_DEV_DIAGNOSTICS_END */

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const waitForOpenRenderFrame = (dbg = null, reason = 'open-render-settle') => {
  const t0 = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = (source = '') => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      OpenDebug.step(dbg, 'open-render-frame:settled', { reason, source, ms: performance.now() - t0 });
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => finish('raf'));
    }
    timeoutId = setTimeout(() => finish('timeout'), 80);
    if (settled) clearTimeout(timeoutId);
  });
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

var _backgroundOpenHydrationRunning = false;
const BACKGROUND_OPEN_HYDRATION_INPUT_IDLE_MS = 180;

async function hydrateRemainingImagesForOpen(
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  dbg = null,
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  batchSize = 2,
  priorityKeys = [],
) {
  if (_backgroundOpenHydrationRunning) return;
  _backgroundOpenHydrationRunning = true;
  const generation = _imageStoreGeneration;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const totalStart = performance.now();
  let batchCount = 0;
  let hydratedTotal = 0;
  let hadBatch = false;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  try {
    const hydrationKeys = [...new Set([
      ...priorityKeys,
      ...getPendingHydratableImageKeys(),
    ])];
    let hydrationIndex = 0;
    while (!_boardOpening && generation === _imageStoreGeneration) {
      const inputIdleMs = typeof lastViewportInputAt !== 'undefined' && lastViewportInputAt > 0
        ? performance.now() - lastViewportInputAt
        : Infinity;
      if (inputIdleMs < BACKGROUND_OPEN_HYDRATION_INPUT_IDLE_MS) {
        await new Promise((resolve) => setTimeout(
          resolve,
          Math.max(16, BACKGROUND_OPEN_HYDRATION_INPUT_IDLE_MS - inputIdleMs),
        ));
        continue;
      }
      const keys = [];
      while (keys.length < batchSize && hydrationIndex < hydrationKeys.length) {
        const key = hydrationKeys[hydrationIndex++];
        const source = BoardfishImageStore.getSource(key);
        if (BoardfishImageStore.hasDisplayImage(key) || !isOpenHydratableImageSource(source)) continue;
        keys.push(key);
      }
      if (!keys.length) break;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      hadBatch = true;
      batchCount++;
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        const hydrated = await hydrateImageBatchForOpen(keys, dbg, 'hydrate-background');
        hydratedTotal += hydrated;
      } else
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      {
        await hydrateImageKeysWithLimit(keys, getOpenHydrationConcurrency());
      }
      const previewRelease = releaseReadyOpenInitialImagePreviewsForOpen();
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (previewRelease.released || previewRelease.pending || previewRelease.failed) {
        OpenDebug.step(dbg, 'open-preview-release', previewRelease);
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const previewStillHoldingRender = Number(previewRelease.pending) > 0;
      if (!previewStillHoldingRender || previewRelease.released) {
        if (typeof BOARDFISH_PRODUCTION === 'undefined') {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          scheduleRender(true, null, previewRelease.released ? 'open-preview-release' : 'open-background-hydration');
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        } else {
          scheduleRender(true);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    _backgroundOpenHydrationRunning = false;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const remaining = getPendingHydratableImageKeys().length;
    const stale = generation !== _imageStoreGeneration;
    OpenDebug.step(dbg, 'hydrate-background:done', {
      batchCount,
      hydrated: hydratedTotal,
      remaining,
      stale,
      ms: performance.now() - totalStart,
    });
    if (!stale && remaining === 0 && hadBatch) {
      if (typeof BOARDFISH_PRODUCTION === 'undefined') {
        await waitForOpenRenderFrame(dbg, 'open-all-content-rendered');
      }
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
}

function queueVisibleImageHydration(limit = 3
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  for (const key of getVisibleImageKeys(limit)) queueImageHydration(key
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
}

async function finishOpenedBoard(
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  dbg, data,
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const openMetrics = getBoardOpenDebugMetrics(dbg, data);
  PillDebug.log('open:finishOpenedBoard:start', openMetrics);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let skipInitialScaledPrewarm = false;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hydrateStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const previewTasks = new Map();
  const visibleKeys = getVisibleImageKeys(Infinity, previewTasks);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const debugMeta = isOpenDebugActive(dbg)
    ? { ...(getVisibleImageKeys.lastDebug || {}), ...getOpenImageRuntimeMetrics() }
    : {};
  OpenDebug.step(dbg, 'hydrate-visible:candidates', { count: visibleKeys.length, ...debugMeta });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const preview = await buildVisibleImagePreviewsForOpen(previewTasks
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
  const previewReady = preview && preview.pendingReady >= visibleKeys.length;
  if (!previewReady) {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      await hydrateImageKeysWithLimit(visibleKeys, dbg, 'hydrate-visible', getOpenHydrationConcurrency());
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      await hydrateImageKeysWithLimit(visibleKeys, getOpenHydrationConcurrency());
    }
  }
  else {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    OpenDebug.step(dbg, 'hydrate-visible:end', {
      count: visibleKeys.length,
      hydrated: 0,
      previewReady: preview.ready,
      previewPendingReady: preview.pendingReady,
      previewBuilt: preview.built,
      previewMB: preview.mb,
      previewMaxMs: preview.maxMs,
      previewMaxKey: preview.maxKey,
      skipped: 'open-preview-ready',
      concurrency: preview.concurrency,
      ms: performance.now() - hydrateStart,
      ...getOpenImageRuntimeMetrics(),
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    skipInitialScaledPrewarm = true;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  PillDebug.log('open:hydrate-visible:end', { phaseMs: performance.now() - hydrateStart, visibleCount: visibleKeys?.length || 0, previewReady: preview?.ready ?? '' });
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    const bitmapSettle = previewReady
      ? {
          count: visibleKeys.length,
          before: 0,
          after: 0,
          failed: 0,
          missingStore: 0,
          pending: 0,
          settled: visibleKeys.length,
          missing: 0,
          target: visibleKeys.length,
          ms: 0,
          skipped: 'open-preview-ready',
          previewReady: preview.ready,
          previewPendingReady: preview.pendingReady,
        }
      : await settleVisibleImageBitmapsForOpen(visibleKeys, dbg);
    if (previewReady) {
      OpenDebug.step(dbg, 'hydrate-visible:bitmap-settle', bitmapSettle);
    }
    PillDebug.log('open:hydrate-visible:bitmap-settle', { phaseMs: bitmapSettle.ms, before: bitmapSettle.before, after: bitmapSettle.after, failed: bitmapSettle.failed, pending: bitmapSettle.pending, missing: bitmapSettle.missing });
    if (isOpenDebugActive(dbg)) {
      OpenDebug.step(dbg, 'hydrate-initial-policy', {
        mode: 'visible-first',
        visibleCount: visibleKeys?.length || 0,
        visibleBitmapsReady: bitmapSettle.after,
        visibleBitmapsFailed: bitmapSettle.failed,
        visibleBitmapsMissing: bitmapSettle.missing,
        visiblePreviewReady: bitmapSettle.previewReady ?? '',
        visibleBitmapSettleMs: bitmapSettle.ms,
        pendingImages: getPendingHydratableImageKeys().length,
      });
    }
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!skipInitialScaledPrewarm && typeof prewarmVisibleScaledImageVariantsForOpen === 'function') {
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const prewarmStart = performance.now();
      const prewarm = await prewarmVisibleScaledImageVariantsForOpen(4);
      OpenDebug.step(dbg, 'prewarm-visible-scaled-variants', {
        ms: performance.now() - prewarmStart,
        ...prewarm,
      });
      PillDebug.log('open:prewarm-visible-scaled-variants:end', {
        phaseMs: performance.now() - prewarmStart,
        candidates: prewarm?.candidates ?? '',
        built: prewarm?.built ?? '',
        skipped: prewarm?.skipped ?? '',
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      await prewarmVisibleScaledImageVariantsForOpen(4);
    }
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  else if (skipInitialScaledPrewarm) {
    OpenDebug.step(dbg, 'prewarm-visible-scaled-variants', {
      skipped: 'open-preview-ready',
      ms: 0,
      built: 0,
      candidates: 0,
      alreadyReady: 0,
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  _boardOpening = false;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const renderStart = performance.now();
    PillDebug.log('open:initial-applyTransform:start');
    const collectInitialRenderDebug = OpenDebug.beginInitialRenderDebug?.() === true;
    try {
      applyTransform();
    } finally {
      if (collectInitialRenderDebug) OpenDebug.endInitialRenderDebug?.();
    }
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
      overlayMs: renderBreakdown?.overlayMs ?? '',
      overlaySkipped: renderBreakdown?.overlaySkipped ?? '',
      drawBoardTotalMs: drawBreakdown?.totalMeasuredMs ?? '',
      backgroundSetupMs: drawBreakdown?.backgroundSetupMs ?? '',
      objectLoopMs: drawBreakdown?.objectLoopMs ?? '',
      drawnImages: drawBreakdown?.drawnImages ?? '',
      drawnText: drawBreakdown?.drawnText ?? '',
      visibleObjects: drawBreakdown?.visibleObjects ?? '',
      testedObjects: drawBreakdown?.testedObjects ?? '',
      culledImages: drawBreakdown?.culledImages ?? '',
      culledText: drawBreakdown?.culledText ?? '',
      bitmapImages: drawBreakdown?.bitmapImages ?? '',
      elementImages: drawBreakdown?.elementImages ?? '',
      scaledImages: drawBreakdown?.scaledImages ?? '',
      openPreviewImages: drawBreakdown?.openPreviewImages ?? '',
      scaledFallbackFull: drawBreakdown?.scaledFallbackFull ?? '',
      scaledVariantPendingImages: drawBreakdown?.scaledVariantPendingImages ?? '',
      croppedImages: drawBreakdown?.croppedImages ?? '',
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else {
    applyTransform();
  }
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const pillFinishReason = finishPillTask({
      beforeFinish: () => {
        const shieldStart = performance.now();
        if (typeof endOpeningFreeze === 'function') endOpeningFreeze();
        else openingShield.classList.remove('active');
        OpenDebug.step(dbg, 'opening-shield:removed', { ms: performance.now() - shieldStart });
        PillDebug.log('open:openingShield:removed', { reason: 'before-pill-hide' });
      },
    });
    PillDebug.log('open:pillFinish:end', { pillFinishReason });
    OpenDebug.end(dbg, { opened: true, ...openMetrics });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else {
    finishPillTask({
      beforeFinish: () => {
        if (typeof endOpeningFreeze === 'function') endOpeningFreeze();
        else openingShield.classList.remove('active');
      },
    });
  }
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    setTimeout(() => hydrateRemainingImagesForOpen(dbg, 2, visibleKeys).catch((err) => {
      OpenDebug.step(dbg, 'hydrate-background:error', { error: String(err) });
    }), 80);
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else {
    setTimeout(() => hydrateRemainingImagesForOpen(2, visibleKeys).catch(() => {}), 80);
  }
}

function applyBoardData(data
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  data = BoardSchema.normalizeBoardData(data);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const openMetrics = getBoardOpenDebugMetrics(dbg, data);
  PillDebug.log('open:applyBoardData:start', openMetrics);
  OpenDebug.step(dbg, 'applyBoardData:start', openMetrics);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  clearJsClipboard();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const t0 = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  clearImageStore();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'clearImageStore', { ms: performance.now() - t0 });

  const imageStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  imageStore = data.imageStore || {};
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let deferredInitialCacheImages = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (const k of Object.keys(imageStore)) {
    const n = parseInt(k.slice(4));
    if (n >= imgKeyCounter) imgKeyCounter = n + 1;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (isOpenHydratableImageSource(BoardfishImageStore.getSource(k))) deferredInitialCacheImages++;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'cacheImage:start-all', {
    ms: performance.now() - imageStart,
    sourcesCached: true,
    deferredInitialCacheImages,
    visibleFirstOpen: true,
    ...getOpenImageRuntimeDebugMetrics(dbg),
  });
  OpenDebug.step(dbg, 'image-store-sample', { sample: getImageStoreOpenDebugSampleIfEnabled(dbg) });

  const stateStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (editingId) exitEdit();
  BoardfishEditorState.clearSelection();
  clearTextLayoutCaches({ objectLayout: false });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const replaceStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  BoardfishEditorState.replaceBoardObjects(data.objects || []);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'replaceBoardObjects', { ms: performance.now() - replaceStart, objectCount: objects.length });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  invalidateOffscreen();
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'apply-state', { ms: performance.now() - stateStart, objectCount: objects.length });

  const countersStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  BoardfishEditorState.restoreObjectCounters();
  BoardfishEditorState.setViewport(data.viewport);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'restore-counters-viewport', { ms: performance.now() - countersStart, panX, panY, zoom });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const historyStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  snapshot();
  markSaved(false);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'reset-boardHistory-markSaved', { ms: performance.now() - historyStart, historyLength: boardHistory.length, historyIndex });
  PillDebug.log('open:applyBoardData:end', openMetrics);
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
}

const runExclusiveBoardSave = (
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  op,
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  run,
) => {
  if (runExclusiveBoardSave.inFlight) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const dbg = SaveDebug.start(`${op}:coalesced`, { reason: 'save-in-flight' });
    SaveDebug.end(dbg, { reused: true });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return runExclusiveBoardSave.inFlight;
  }
  const tracked = run().finally(() => {
    if (runExclusiveBoardSave.inFlight === tracked) runExclusiveBoardSave.inFlight = null;
  });
  runExclusiveBoardSave.inFlight = tracked;
  return tracked;
};
runExclusiveBoardSave.inFlight = null;

function showSaveFailurePill() {
  showIslandMsg('Save failed', long_message);
}

const saveBoardAsImpl = async () => {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = SaveDebug.start('saveBoardAs', { currentFilePath, objectCount: objects.length });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const releaseInputShield = acquireInputShield({ visual: false, keepSelectionOverlay: true });
  try {
    const defaultName = BoardfishRuntime.fileNameFromRef(currentFileRef || currentFilePath, 'board.bf');
    const chooseFile = () => BoardfishRuntime.saveFileDialog(defaultName);
    let fileRef;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      fileRef = await SaveDebug.wrap(
        dbg,
        'web_save_file_dialog',
        chooseFile,
        { defaultName },
      );
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      fileRef = await chooseFile();
    }
    if (!fileRef) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      SaveDebug.end(dbg, { cancelled: true });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      releaseInputShield();
      return false;
    }
    await runShieldedPillTask({
      releaseInputShield,
      startMessage: 'Saving',
      successMessage: 'Saved',
      task: async () => {
        await invokeSaveBoard(fileRef
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          , dbg
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          , { sourceFileRef: currentFileRef }
        );
        currentFileRef = fileRef;
        currentFilePath = BoardfishRuntime.describeFileRef(fileRef);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        SaveDebug.step(dbg, 'markSaved:start');
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        markSaved();
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        SaveDebug.step(dbg, 'markSaved:end');
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      },
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    SaveDebug.end(dbg, { saved: true, path: currentFilePath });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return true;
  } catch (err) {
    releaseInputShield();
    console.error('Save failed:', err);
    showSaveFailurePill();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    SaveDebug.end(dbg, { saved: false, error: String(err) });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return false;
  }
};

function saveBoardAs() {
  return runExclusiveBoardSave(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    'saveBoardAs',
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    saveBoardAsImpl,
  );
}

const saveBoardImpl = async () => {
  const target = BoardfishRuntime.canSaveToExistingTarget(currentFileRef) ? currentFileRef : null;
  if (target) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const path = BoardfishRuntime.describeFileRef(target);
    const dbg = SaveDebug.start('saveBoard', { path, objectCount: objects.length });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const releaseInputShield = acquireInputShield({ visual: false, keepSelectionOverlay: true });
    try {
      await runShieldedPillTask({
        releaseInputShield,
        startMessage: 'Saving',
        successMessage: 'Saved',
        task: async () => {
          await invokeSaveBoard(target
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            , dbg
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
            , { sourceFileRef: currentFileRef }
          );
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          SaveDebug.step(dbg, 'markSaved:start');
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          markSaved();
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          SaveDebug.step(dbg, 'markSaved:end');
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        },
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      SaveDebug.end(dbg, { saved: true, path });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return true;
    } catch (err) {
      releaseInputShield();
      console.error('Save failed:', err);
      showSaveFailurePill();
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      SaveDebug.end(dbg, { saved: false, error: String(err) });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return false;
    }
  }
  return saveBoardAsImpl();
};

function saveBoard() {
  return runExclusiveBoardSave(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    'saveBoard',
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    saveBoardImpl,
  );
}


async function openBoardFileRef(fileRef) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const path = BoardfishRuntime.describeFileRef(fileRef);
  const dbg = OpenDebug.start('openBoardFileRef', { path, currentFilePath, objectCount: objects.length });
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    if (!(await confirmDirtyBeforeOpen(dbg))) return;
    await openBoardFromPath(fileRef, dbg, 'Open failed:');
    return;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!(await confirmDirtyBeforeOpen())) return;
  await openBoardFromPath(fileRef, 'Open failed:');
}

async function openBoard() {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = OpenDebug.start('openBoard', { currentFilePath, objectCount: objects.length });
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    if (!(await confirmDirtyBeforeOpen(dbg))) return;
  } else
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!(await confirmDirtyBeforeOpen())) return;

  try {
    const chooseFile = () => BoardfishRuntime.openFileDialog();
    let fileRef;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      fileRef = await OpenDebug.wrap(dbg, 'web_open_file_dialog', chooseFile);
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      fileRef = await chooseFile();
    }
    if (!fileRef) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      OpenDebug.end(dbg, { cancelled: true });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return;
    }
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      await openBoardFromPath(fileRef, dbg, 'Open failed:');
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      await openBoardFromPath(fileRef, 'Open failed:');
    }
  } catch (err) {
    finishFailedOpen(
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      dbg,
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      err,
      'Open failed:',
    );
  }
}

window.addEventListener('beforeunload', (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});
