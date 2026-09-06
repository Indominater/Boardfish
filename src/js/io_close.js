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

function markSaved() {
  _dirtyIds.clear();
  savedHistoryRevision = boardHistory[historyIndex]?.revision;
  savedDefaultEmptyBoard = isDefaultEmptyBoardState();
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
  openingShield.classList.add('opening-freeze', 'active');
  appendOpeningFreezeBoard();
};

const endOpeningFreeze = () => {
  if (!openingShield) return;
  canvas.prepend(boardCanvas);
  boardCanvas.removeAttribute('style');
  openingShield.classList.remove('active', 'opening-freeze');
  openingShield.replaceChildren();
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

const isOpenHydratableImageSource = (source) => {
  return typeof source === 'string' || isWebImageRef(source);
};

function getVisibleImageKeys(limit = Infinity) {
  const b = viewportWorldRect();
  const keys = [];
  const seen = new Set();
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
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      skipped.duplicate++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      continue;
    }
    seen.add(key);
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

function getPendingHydratableImageKeys(keys = []) {
  const seen = new Set(keys);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const initialCount = keys.length;
  const skipped = { nonHydratable: 0, cached: 0 };
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  for (const key of Object.keys(imageStore)) {
    if (seen.has(key)) continue;
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
    keys.push(key);
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  getPendingHydratableImageKeys.lastDebug = { selected: keys.length - initialCount, skipped };
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

function createOpenTextWarmupTarget() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    // drawTextLineRange retains the actual line surfaces; this canvas only
    // supplies the draw context and does not need a throwaway page of pixels.
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext?.('2d') || null;
    if (!context) return null;
    context.font = FONT;
    configureTextCanvasContext(context);
    context.textBaseline = 'alphabetic';
    return { canvas, context };
  } catch (_) {
    return null;
  }
}

function warmOpenTextLineForDraw(target, obj, line) {
  if (!target?.context || !line || !String(line.text ?? '').length) return;
  const context = target.context;
  const dpr = typeof window !== 'undefined' ? (Number(window.devicePixelRatio) || 1) : 1;
  const viewZoom = typeof zoom !== 'undefined' ? (Number(zoom) || 1) : 1;
  const deviceScale = viewZoom * dpr;
  const margin = 12;
  const baseX = (Number(obj?.x) || 0) + TEXT_PAD;
  const textY = Number(line.textY) || 0;
  try {
    context.fillStyle = canvasTextColor();
    context.setTransform(
      deviceScale,
      0,
      0,
      deviceScale,
      margin - baseX * deviceScale,
      margin + LINE_H * deviceScale - textY * deviceScale,
    );
    drawTextLineRange(context, line, obj);
  } catch (_) {}
}

async function hydrateTextDrawCachesForOpen(
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  const fontSet = typeof document !== 'undefined' ? document.fonts : null;
  if (fontSet?.ready) {
    try { await fontSet.ready; } catch (_) {}
  }

  const gpuContext = typeof ctx !== 'undefined' && ctx?.isBoardfishGpuContext ? ctx : null;
  if (gpuContext?.ready) await gpuContext.ready;
  const warmupTarget = gpuContext ? null : createOpenTextWarmupTarget();
  beginTextRasterFrame();
  let batchStartedAt = performance.now();
  for (const obj of objects) {
    if (obj?.type !== 'text') continue;
    const layout = getTextLayout(obj);
    if (gpuContext?.prepareTextLayout?.(layout, obj, {
      fontSize: FONT_SIZE, padding: TEXT_PAD, lineHeight: LINE_H,
    })) {
      if (performance.now() - batchStartedAt >= 8) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        batchStartedAt = performance.now();
      }
      continue;
    }
    for (const line of layout) {
      prepareTextLineForDraw(line);
      warmOpenTextLineForDraw(warmupTarget, obj, line);
      if (performance.now() - batchStartedAt >= 8) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        batchStartedAt = performance.now();
      }
    }
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  OpenDebug.step(dbg, 'hydrate-text-draw-caches');
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const hydrateStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const visibleKeys = getVisibleImageKeys(Infinity);
  const hydrationKeys = getPendingHydratableImageKeys([...visibleKeys]);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const debugMeta = isOpenDebugActive(dbg)
    ? { ...(getVisibleImageKeys.lastDebug || {}), ...getOpenImageRuntimeMetrics() }
    : {};
  OpenDebug.step(dbg, 'hydrate-all:candidates', {
    count: hydrationKeys.length,
    visibleCount: visibleKeys.length,
    ...debugMeta,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  let imageHydrationPromise;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    imageHydrationPromise = hydrateImageKeysWithLimit(
      hydrationKeys,
      dbg,
      'hydrate-all',
      getOpenHydrationConcurrency(),
    );
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else {
    imageHydrationPromise = hydrateImageKeysWithLimit(
      hydrationKeys,
      getOpenHydrationConcurrency(),
    );
  }
  const textHydrationPromise = hydrateTextDrawCachesForOpen(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
  await Promise.all([
    imageHydrationPromise,
    textHydrationPromise,
  ]);
  const imageDrawCaches = await settleOpenImageDrawCaches(getOpenHydrationConcurrency());
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const pendingImages = getPendingHydratableImageKeys().length;
  OpenDebug.step(dbg, 'settle-open-image-draw-caches', imageDrawCaches);
  OpenDebug.step(dbg, 'hydrate-initial-policy', {
    mode: 'all-before-interaction',
    imageCount: hydrationKeys.length,
    visibleCount: visibleKeys.length,
    pendingImages,
    phaseMs: performance.now() - hydrateStart,
  });
  PillDebug.log('open:hydrate-all:end', {
    phaseMs: performance.now() - hydrateStart,
    imageCount: hydrationKeys.length,
    pendingImages,
  });
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
        endOpeningFreeze();
        OpenDebug.step(dbg, 'opening-shield:removed', { ms: performance.now() - shieldStart });
        PillDebug.log('open:openingShield:removed', { reason: 'before-pill-hide' });
      },
    });
    PillDebug.log('open:pillFinish:end', { pillFinishReason });
    OpenDebug.end(dbg, { opened: true, ...openMetrics });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  } else {
    finishPillTask({ beforeFinish: endOpeningFreeze });
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
    allContentBeforeInteraction: true,
    ...getOpenImageRuntimeDebugMetrics(dbg),
  });
  OpenDebug.step(dbg, 'image-store-sample', { sample: getImageStoreOpenDebugSampleIfEnabled(dbg) });

  const stateStart = performance.now();
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (editingId) exitEdit();
  BoardfishEditorState.clearSelection();
  clearTextLayoutCaches({ objectLayout: false });
  if (typeof ctx !== 'undefined') ctx?.resetResources?.();
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
  markSaved();
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
