const canStartWebClipboardWrite = () => !hasTauri() && (typeof document === 'undefined' || document.visibilityState !== 'hidden');

const finishWebClipboardTokenWrite = (result, token, dbg = null) => {
  if (result?.boardfishTokenWritten) globalThis.markJsClipboardWebTokenOnNative?.(token, dbg);
};

const writeWebClipboardTokenForJsClipboard = (dbg = null, meta = {}) => {
  if (!canStartWebClipboardWrite()) return;
  const webToken = globalThis.getJsClipboardWebToken?.() || '';
  if (!webToken) return;
  BoardfishClipboardIO.copyBoardfishTokenToClipboard(webToken, dbg, meta)
    .then((result) => finishWebClipboardTokenWrite(result, webToken, dbg))
    .catch((err) => console.error('[copy] web clipboard token write FAILED:', err));
};

const readWebClipboardTokenForPaste = async (clipboardData, dbg = null) => {
  if (hasTauri()) return { checked: false, token: '' };
  if (clipboardData) {
    return {
      checked: true,
      token: BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(clipboardData),
    };
  }
  try {
    return await BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser(dbg);
  } catch (err) {
    ClipDebug.step(dbg, 'browser-clipboard-token-read:error', { error: String(err) });
    return { checked: false, token: '' };
  }
};

const noteTextObjectCopyFeedback = (obj) => {
  if (obj?.type !== 'text') return false;
  const text = normalizeTextContent(obj.data?.content);
  if (!text.length) return false;
  globalThis.BoardfishMotion?.applyActionAnimation?.('copy-text-object', {
    objects: [obj],
  });
  scheduleRender(true, true, 'copy-text-object');
  return true;
};

const trimPastedTextObjectContent = (obj) => {
  if (obj?.type !== 'text') return false;
  if (!obj.data) obj.data = {};
  const content = textForTextObjectPaste(obj.data?.content);
  if (content === obj.data.content) return false;
  obj.data.content = content;
  delete obj._layoutCache;
  delete obj._layoutCacheKey;
  syncTextAutoHeight(obj);
  return true;
};

const clipboardImageBlobName = (blob, fallback = 'clipboard-image') => {
  if (blob?.name) return blob.name;
  const ext = blob?.type === 'image/jpeg' ? 'jpg' : 'png';
  return `${fallback}.${ext}`;
};

const normalizeClipboardImageBlob = (blob, fallback = 'clipboard-image') => {
  if (!blob) return null;
  if (typeof File === 'function' && !(blob instanceof File)) {
    return new File([blob], clipboardImageBlobName(blob, fallback), { type: blob.type || 'image/png' });
  }
  return blob;
};

async function pasteWebImageBlob(blob, wx, wy, dbg, source) {
  const file = normalizeClipboardImageBlob(blob, source);
  if (!file) return false;
  const objectCountBefore = objects.length;
  ClipDebug.step(dbg, `${source}:insert-start`, {
    fileName: clipboardImageBlobName(file, source),
    fileSize: file.size ?? '',
    fileType: file.type || '',
    objectCountBefore,
  });
  await insertImageFiles([file], wx, wy, source);
  const objectCountAfter = objects.length;
  const added = objectCountAfter > objectCountBefore;
  ClipDebug.step(dbg, `${source}:insert-end`, {
    added,
    objectCountBefore,
    objectCountAfter,
    objectDelta: objectCountAfter - objectCountBefore,
  });
  ClipDebug.end(dbg, {
    path: source,
    added,
    objectCountBefore,
    objectCountAfter,
  });
  return added;
}

async function copySelected() {
  const dbg = ClipDebug.start('copySelected', { selectedCount: selectedIds.size });
  if (!selectedIds.size) { ClipDebug.end(dbg, { skipped: 'empty-selection' }); return false; }

  if (selectedIds.size > 1) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('copy-selected-objects', { selection: true });
    const clonedObjs = [];
    const imageData = {};
    let imageCount = 0;
    let processed = 0;
    ClipDebug.step(dbg, 'copy:multi-start', { selectedCount: selectedIds.size });
    for (const id of selectedIds) {
      processed++;
      const obj = objectsMap.get(id);
      if (!obj) continue;
      const cloned = cloneObject(obj);
      if (cloned.type === 'image') {
        const imgKey = cloned.data.imgKey;
        const src = BoardfishImageStore.getSource(imgKey);
        if (src) {
          if (!Object.prototype.hasOwnProperty.call(imageData, imgKey)) imageCount++;
          imageData[imgKey] = src;
        }
      }
      clonedObjs.push(cloned);
      if (processed === 1 || processed % 50 === 0 || processed === selectedIds.size) {
        ClipDebug.step(dbg, 'copy:multi-progress', {
          processed,
          selectedCount: selectedIds.size,
          objectCount: clonedObjs.length,
          imageCount,
        });
      }
    }
    if (!clonedObjs.length) { ClipDebug.end(dbg, { skipped: 'no-clones' }); return false; }
    ClipDebug.step(dbg, 'copy:multi-set-jsClipboard-start', { objectCount: clonedObjs.length, imageCount });
    setJsClipboard({ type: 'objects', objects: clonedObjs, imageData }, true);
    writeWebClipboardTokenForJsClipboard(dbg, { objectCount: clonedObjs.length, imageCount });
    ClipDebug.step(dbg, 'copy:multi-set-jsClipboard-end', { objectCount: clonedObjs.length, imageCount });
    ClipDebug.end(dbg, { path: 'multi-jsClipboard', objectCount: clonedObjs.length, imageCount });
    return true;
  }

  const obj = getFirstSelectedObject();
  if (!obj) { ClipDebug.end(dbg, { skipped: 'missing-object' }); return false; }
  if (!noteTextObjectCopyFeedback(obj)) {
    globalThis.BoardfishMotion?.applyActionAnimation?.('copy-selected-objects', { selection: true });
  }

  const cloned = cloneObject(obj);
  const imgData = {};
  if (obj.type === 'image') {
    const src = BoardfishImageStore.getSource(obj.data.imgKey);
    if (src) imgData[obj.data.imgKey] = src;
  }
  const isTauri = hasTauri();

  const clipboardToken = setJsClipboard({ type: 'objects', objects: [cloned], imageData: imgData }, false, isTauri);
  ClipDebug.step(dbg, 'set-jsClipboard', { type: obj.type, isTauri, imgKey: obj.data?.imgKey, imageNeedsRendering: obj.type === 'image' ? imageNeedsRendering(obj) : false });

  if (obj.type === 'text') {
    const clipboardText = textForClipboard(obj.data.content);
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
        await BoardfishClipboardIO.copyTextToClipboard(clipboardText, dbg);
      }, dbg, { type: 'text', token: clipboardToken })
        .catch((err) => console.error('[copy] copy_text_to_clipboard FAILED:', err))
        .finally(() => finishNativeClipboardWrite(clipboardToken, dbg))
        .finally(() => ClipDebug.end(dbg, { path: 'text-tauri' }));
      return true;
    } else {
      const webToken = globalThis.getJsClipboardWebToken?.() || '';
      BoardfishClipboardIO.copyTextToClipboard(clipboardText, dbg, { boardfishToken: webToken })
        .then((result) => finishWebClipboardTokenWrite(result, webToken, dbg))
        .catch((err) => console.error('[copy] writeText FAILED:', err))
        .finally(() => ClipDebug.end(dbg, { path: 'text-web' }));
      return true;
    }
  }

  if (obj.type === 'image') {
    if (isTauri) {
      const imgKey = obj.data.imgKey;
      const { flipX, flipY, rotation } = imageTransformFromObject(obj);
      const copyDataUrlFallback = async (reason) => {
        const sourceStart = performance.now();
        const storedSource = BoardfishImageStore.getSource(obj.data.imgKey);
        ClipDebug.step(dbg, 'copy:source-start', { imgKey, reason, storedType: typeof storedSource, nativeRef: isNativeImageRef(storedSource) });
        const src = await ensureImageDataUrl(obj.data.imgKey, dbg);
        if (!src) return;
        ClipDebug.step(dbg, 'copy:source-ready', {
          imgKey,
          reason,
          ms: Math.round((performance.now() - sourceStart) * 100) / 100,
          dataUrl: src,
        });
        ClipDebug.step(dbg, 'copy:data-url-fallback', { imgKey, flipX, flipY, rotation, reason, dataUrl: src });
        await ClipDebug.wrap(
          dbg,
          TAURI_COMMANDS.COPY_IMAGE_DATA_URL_TO_CLIPBOARD_TRANSFORMED,
          () => BoardfishTauri.copyImageDataUrlToClipboardTransformed({ dataUrl: src, flipX, flipY, rotation }),
          { imgKey, flipX, flipY, rotation, dataUrl: src }
        );
      };
      enqueueNativeClipboardWrite(async () => {
        if (clipboardToken !== _jsClipboardToken) {
          ClipDebug.step(dbg, 'native-copy-stale-skip', { type: 'image', imgKey, token: clipboardToken, currentToken: _jsClipboardToken });
          return;
        }
        await copyDataUrlFallback('native-unique-copy');
      }, dbg, { type: 'image', imgKey, flipX, flipY, rotation })
        .catch((err) => {
          ClipDebug.step(dbg, 'copy:image-error', { imgKey, flipX, flipY, rotation, error: String(err) });
          console.error('[copy] image clipboard write FAILED:', err);
        })
        .finally(() => finishNativeClipboardWrite(clipboardToken, dbg))
        .finally(() => ClipDebug.end(dbg, { path: 'image-tauri-cached-transform', imgKey, flipX, flipY, rotation }));
      return true;
    } else {
      let pngBlob = null;
      try {
        const canvas = renderImageToCanvas(obj);
        if (!canvas) {
          ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'image-not-ready' });
          return false;
        }
        pngBlob = await canvasToPngBlob(canvas);
        if (!pngBlob) {
          ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'blob-null' });
          return false;
        }
        const webToken = globalThis.getJsClipboardWebToken?.() || '';
        const result = await BoardfishClipboardIO.copyImageBlobToClipboard(pngBlob, webToken, dbg);
        finishWebClipboardTokenWrite(result, webToken, dbg);
        return true;
      } catch (err) {
        console.error('[copy] clipboard.write FAILED:', err);
        return false;
      } finally {
        if (pngBlob) ClipDebug.end(dbg, { path: 'image-web-rendered', blobSize: pngBlob.size });
      }
    }
  }
  ClipDebug.end(dbg, { path: 'object-jsClipboard', type: obj.type || '' });
  return true;
}

async function pasteAtPos(wx, wy, clipboardData = null) {
  if (eyedropperEnabled) return;
  const dbg = ClipDebug.start('pasteAtPos', {
    wx,
    wy,
    hasJsClipboard: !!jsClipboard,
    jsClipboardType: jsClipboard?.type,
    clipboardData: BoardfishClipboardIO.describeClipboardData(clipboardData),
    objectCountBefore: objects.length,
  });
  if (_pasteInProgress) {
    ClipDebug.end(dbg, { path: 'paste-busy', skipped: 'paste-in-progress' });
    return;
  }
  _pasteInProgress = true;
  try {
    const webClipboardToken = jsClipboard
      ? await readWebClipboardTokenForPaste(clipboardData, dbg)
      : { checked: false, token: '' };
    if (jsClipboard && !(await jsClipboardStillCurrent(dbg, {
      webClipboardTokenChecked: webClipboardToken.checked,
      webClipboardToken: webClipboardToken.token,
    }))) {
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
        let trimmedTextObjects = 0;
        for (const obj of clones) {
          if (trimPastedTextObjectContent(obj)) trimmedTextObjects++;
        }
        if (trimmedTextObjects) ClipDebug.step(dbg, 'paste:text-trim-trailing-lines', { trimmedTextObjects });
        if (!BoardfishWebLimits.canAddObjects(clones.length)) {
          ClipDebug.end(dbg, { skipped: 'web-object-limit', objectCount: clones.length });
          return;
        }
        if (!BoardfishWebLimits.isLimitedRuntime || BoardfishWebLimits.isLimitedRuntime()) {
          const additionalImageBytes = imgEntries.reduce((sum, [key, src]) => (
            BoardfishImageStore.hasSource(key) ? sum : sum + BoardfishWebLimits.imageSourceByteLength(src)
          ), 0);
          const additionalTextBytes = clones.reduce((sum, obj) => {
            if (obj?.type !== 'text') return sum;
            const text = String(obj.data?.content || '');
            return sum + (typeof BoardfishWebLimits.textByteLength === 'function'
              ? BoardfishWebLimits.textByteLength(text)
              : (typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length));
          }, 0);
          if (!BoardfishWebLimits.canAcceptAdditionalContentBytes(additionalImageBytes + additionalTextBytes, clones.length)) {
            ClipDebug.end(dbg, { skipped: 'web-content-limit', additionalImageBytes, additionalTextBytes });
            return;
          }
        }
        // Re-register image data in case we're on a different board
        let registeredImages = 0;
        let processedImages = 0;
        for (const [key, src] of imgEntries) {
          processedImages++;
          if (!BoardfishImageStore.hasSource(key)) {
            BoardfishImageStore.setSource(key, src);
            cacheImage(key, src);
            registeredImages++;
          }
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
        let processedObjects = 0;
        const pastedIds = [];
        const pastedTextObjects = [];
        const pastedNonTextObjects = [];
        ClipDebug.step(dbg, 'paste:objects-add-start', { objectCount: clones.length });
        for (const o of clones) {
          processedObjects++;
          o.id = newId(); o.x += dx; o.y += dy; o.z = ++zCounter;
          BoardfishEditorState.addObject(o);
          pastedIds.push(o.id);
          if (o.type === 'text') pastedTextObjects.push(o);
          else pastedNonTextObjects.push(o);
          if (processedObjects === 1 || processedObjects % 50 === 0 || processedObjects === clones.length) {
            ClipDebug.step(dbg, 'paste:objects-add-progress', {
              processed: processedObjects,
              objectCount: clones.length,
              registeredImages,
            });
          }
        }
        BoardfishEditorState.setSelection(pastedIds, {
          primaryId: pastedIds[pastedIds.length - 1],
          animateSelection: false,
        });
        globalThis.BoardfishMotion?.applyActionAnimation?.('text-box-paste', { objects: pastedTextObjects });
        globalThis.BoardfishMotion?.applyActionAnimation?.('image-object-paste', { objects: pastedNonTextObjects });
        ClipDebug.step(dbg, 'paste:objects-add-done', { objectCount: clones.length, registeredImages });
        scheduleRender(true, true);
        ClipDebug.step(dbg, 'paste:boardHistory-start', { objectCount: clones.length });
        pushHistory('paste-objects');
        ClipDebug.step(dbg, 'paste:boardHistory-done', { historyIndex });
        ClipDebug.end(dbg, { path: 'jsClipboard', objectCount: clones.length, registeredImages, historyIndex, objectCountAfter: objects.length });
        return;
      }
    }
    if (!hasTauri()) {
      const eventImageFile = BoardfishClipboardIO.readClipboardImageFileFromEvent(clipboardData, dbg);
      if (eventImageFile) {
        await pasteWebImageBlob(eventImageFile, wx, wy, dbg, 'web-paste-event');
        return;
      }
    }
    const eventImage = hasTauri()
      ? BoardfishClipboardIO.readClipboardImageDataUrlFromEvent(clipboardData, dbg)
      : null;
    if (eventImage) {
      try {
        const imgKey = newImgKey();
        const dataUrl = await eventImage;
        ClipDebug.step(dbg, 'event-image-read', { imgKey, dataUrl });
        await pasteDataUrlImage(dataUrl, wx, wy, imgKey, 'event-image', dbg, { resolveOnLoad: true });
        return;
      } catch (err) {
        hideInputShield();
        ClipDebug.step(dbg, 'event-image-miss', { error: String(err) });
      }
    }
    const eventText = BoardfishClipboardIO.readClipboardTextFromEvent(clipboardData);
    if (eventText && eventText.trim()) {
      addText(wx, wy, eventText, { anchor: 'center' });
      ClipDebug.end(dbg, { path: 'event-text', textLen: eventText.length });
      return;
    }
    if (hasTauri()) {
      try {
        if (nativeClipboardPendingCount() > 0) {
          const settleStart = performance.now();
          ClipDebug.step(dbg, 'native-clipboard-settle:start', { nativePending: nativeClipboardPendingCount() });
          const settle = await waitForNativeClipboardIdle(250);
          ClipDebug.step(dbg, 'native-clipboard-settle:end', {
            nativePending: nativeClipboardPendingCount(),
            ready: settle?.ready ?? '',
            error: settle?.error || '',
            ms: Math.round((performance.now() - settleStart) * 100) / 100,
          });
        } else {
          ClipDebug.step(dbg, 'native-clipboard-settle:skip', { reason: 'no-pending-native-write' });
        }
        const imgKey = newImgKey();
        const generation = _imageStoreGeneration;
        const sourceToken = createImageSourceToken(imgKey);
        const meta = await ClipDebug.wrap(
          dbg,
          TAURI_COMMANDS.READ_IMAGE_FROM_CLIPBOARD_CACHED,
          () => BoardfishTauri.readImageFromClipboardCached(imgKey, sourceToken),
          { imgKey }
        );
        if (generation !== _imageStoreGeneration) {
          cleanupNativeImageSourceToken(imgKey, sourceToken);
          ClipDebug.step(dbg, 'native-image-stale-skip', { imgKey });
          return;
        }
        ClipDebug.step(dbg, 'native-image-read', {
          imgKey,
          width: meta?.width,
          height: meta?.height,
          pixels: meta?.pixels,
          bytes: meta?.bytes,
          mime: meta?.mime,
          ext: meta?.ext,
        });
        await pasteNativeCachedImage(meta, wx, wy, imgKey, 'native-image-cache', dbg, sourceToken);
        return;
      } catch (err) {
        hideInputShield();
        ClipDebug.step(dbg, 'native-image-miss', { error: String(err) });
        try {
          const text = await ClipDebug.wrap(
            dbg,
            TAURI_COMMANDS.READ_TEXT_FROM_CLIPBOARD,
            () => BoardfishTauri.readTextFromClipboard()
          );
          if (text && text.trim()) addText(wx, wy, text, { anchor: 'center' });
          ClipDebug.end(dbg, { path: 'native-text', textLen: text?.length || 0, objectCountAfter: objects.length });
          return;
        } catch (textErr) {
          ClipDebug.end(dbg, { path: 'native-empty', error: String(textErr), objectCountAfter: objects.length });
        }
        return;
      }
    }
    showInputShield();
    try {
      const imageBlob = await BoardfishClipboardIO.readClipboardImageBlobFromBrowser(dbg);
      if (imageBlob) {
        hideInputShield();
        await pasteWebImageBlob(imageBlob, wx, wy, dbg, 'web-paste-browser');
        return;
      }
      hideInputShield();
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) addText(wx, wy, text, { anchor: 'center' });
      ClipDebug.end(dbg, { path: 'web-text', textLen: text?.length || 0, objectCountAfter: objects.length });
    } catch (err) {
      hideInputShield();
      ClipDebug.end(dbg, { path: 'web-empty', error: String(err), objectCountAfter: objects.length });
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
