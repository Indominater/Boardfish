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
        const src = BoardfishImageStore.getSource(cloned.data.imgKey);
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
    const src = BoardfishImageStore.getSource(obj.data.imgKey);
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
        await BoardfishClipboardIO.copyTextToClipboard(obj.data.content, dbg);
      }, dbg, { type: 'text', token: clipboardToken })
        .catch(err => console.error('[copy] copy_text_to_clipboard FAILED:', err))
        .finally(() => finishNativeClipboardWrite(clipboardToken, dbg))
        .finally(() => ClipDebug.end(dbg, { path: 'text-tauri' }));
    } else {
      BoardfishClipboardIO.copyTextToClipboard(obj.data.content, dbg)
        .catch(err => console.error('[copy] writeText FAILED:', err))
        .finally(() => ClipDebug.end(dbg, { path: 'text-web' }));
    }
    return;
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
        if (pngBlob) ClipDebug.end(dbg, { path: 'image-web-rendered', blobSize: pngBlob.size });
      }
    }
  }
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
        ClipDebug.step(dbg, 'paste:objects-add-start', { objectCount: clones.length });
        for (const o of clones) {
          processedObjects++;
          o.id = newId(); o.x += dx; o.y += dy; o.z = ++zCounter; o.locked = false;
          BoardfishEditorState.addObject(o);
          pastedIds.push(o.id);
          if (processedObjects === 1 || processedObjects % 50 === 0 || processedObjects === clones.length) {
            ClipDebug.step(dbg, 'paste:objects-add-progress', {
              processed: processedObjects,
              objectCount: clones.length,
              registeredImages,
            });
          }
        }
        BoardfishEditorState.setSelection(pastedIds, { primaryId: pastedIds[pastedIds.length - 1] });
        ClipDebug.step(dbg, 'paste:objects-add-done', { objectCount: clones.length, registeredImages });
        scheduleRender(true, true);
        ClipDebug.step(dbg, 'paste:boardHistory-start', { objectCount: clones.length });
        pushHistory('paste-objects');
        ClipDebug.step(dbg, 'paste:boardHistory-done', { historyIndex });
        ClipDebug.end(dbg, { path: 'jsClipboard', objectCount: clones.length, registeredImages, historyIndex, objectCountAfter: objects.length });
        return;
      }
    }
    const eventImage = BoardfishClipboardIO.readClipboardImageDataUrlFromEvent(clipboardData, dbg);
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
    const eventText = BoardfishClipboardIO.readClipboardTextFromEvent(clipboardData);
    if (eventText && eventText.trim()) {
      addText(wx - 100, wy - 40, eventText);
      ClipDebug.end(dbg, { path: 'event-text', textLen: eventText.length });
      return;
    }
    if (!hasTauri()) {
      try {
        const imgKey = newImgKey();
        const dataUrl = await BoardfishClipboardIO.readClipboardImageDataUrlFromBrowser(dbg);
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
        const meta = await ClipDebug.wrap(
          dbg,
          TAURI_COMMANDS.READ_IMAGE_FROM_CLIPBOARD_CACHED,
          () => BoardfishTauri.readImageFromClipboardCached(imgKey),
          { imgKey }
        );
        ClipDebug.step(dbg, 'native-image-read', {
          imgKey,
          width: meta?.width,
          height: meta?.height,
          pixels: meta?.pixels,
          bytes: meta?.bytes,
          mime: meta?.mime,
          ext: meta?.ext,
        });
        await pasteNativeCachedImage(meta, wx, wy, imgKey, 'native-image-cache', dbg);
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
          if (text && text.trim()) addText(wx - 100, wy - 40, text);
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
      const dataUrl = await BoardfishClipboardIO.readClipboardImageDataUrlFromBrowser(dbg);
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
