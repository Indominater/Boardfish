const canStartWebClipboardWrite = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

const finishWebClipboardTokenWrite = (result, token, dbg = null) => {
  if (result?.boardfishTokenWritten) globalThis.markJsClipboardWebTokenWritten?.(token, dbg);
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
  if (typeof clearTextObjectLayoutRuntime === 'function') clearTextObjectLayoutRuntime(obj);
  else {
    delete obj._layoutCache;
    delete obj._layoutCacheKey;
  }
  syncTextAutoHeight(obj);
  return true;
};

const clipboardTextMetricsForObjects = (items = []) => {
  let textObjectCount = 0;
  let textCharCount = 0;
  let largestTextChars = 0;
  for (const obj of items || []) {
    if (obj?.type !== 'text') continue;
    textObjectCount++;
    const chars = String(obj.data?.content || '').length;
    textCharCount += chars;
    largestTextChars = Math.max(largestTextChars, chars);
  }
  return { textObjectCount, textCharCount, largestTextChars };
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

const clipboardNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const clipboardElapsedMs = (startedAt) => Math.round((clipboardNow() - startedAt) * 100) / 100;

const clipboardTextStats = (value, scriptRanges = []) => {
  const text = String(value ?? '');
  const lines = text ? text.split('\n') : [];
  let largestLineChars = 0;
  for (const line of lines) largestLineChars = Math.max(largestLineChars, line.length);
  const textBytes = typeof BoardfishWebLimits !== 'undefined' && typeof BoardfishWebLimits.textByteLength === 'function'
    ? BoardfishWebLimits.textByteLength(text)
    : (typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length);
  return {
    textLen: text.length,
    textLineCount: lines.length,
    largestLineChars,
    textBytes,
    scriptRangeCount: Array.isArray(scriptRanges) ? scriptRanges.length : '',
  };
};

const addTextPasteOptions = (dbg, options = {}) => (
  typeof ClipDebug !== 'undefined' && ClipDebug.enabled === true
    ? { ...options, debug: dbg }
    : options
);

const webSourceClipboardMime = (source) => {
  if (typeof isWebImageRef === 'function' && isWebImageRef(source)) return String(source.mime || '').toLowerCase();
  if (typeof source === 'string') return (/^data:([^;,]+)/i.exec(source)?.[1] || '').toLowerCase();
  return '';
};

const webSourceClipboardKind = (source) => {
  if (typeof isWebImageRef === 'function' && isWebImageRef(source)) return 'web-ref';
  if (typeof source === 'string' && source.startsWith('data:')) return 'data-url';
  return typeof source;
};

const createWebSourcePngClipboardBlob = (obj, source, dbg = null) => {
  if (!obj || imageNeedsRendering(obj)) return null;
  if (typeof Blob === 'undefined') return null;
  const container = globalThis.BoardfishWebBoardContainer;
  if (!container?.bytesForImageSource) return null;
  const isDirectWebSource = (
    (typeof isWebImageRef === 'function' && isWebImageRef(source)) ||
    (typeof source === 'string' && /^data:image\/png[;,]/i.test(source))
  );
  if (!isDirectWebSource || webSourceClipboardMime(source) !== 'image/png') return null;

  const startedAt = clipboardNow();
  try {
    const bytes = container.bytesForImageSource(source);
    if (!bytes) return null;
    const blob = new Blob([bytes], { type: 'image/png' });
    ClipDebug.step(dbg, 'copy:web-source-png-blob', {
      imgKey: obj?.data?.imgKey || '',
      sourceKind: webSourceClipboardKind(source),
      sourceBytes: bytes.byteLength ?? bytes.length ?? blob.size,
      blobSize: blob.size,
      ms: Math.round((clipboardNow() - startedAt) * 100) / 100,
    });
    return blob;
  } catch (err) {
    ClipDebug.step(dbg, 'copy:web-source-png-blob:error', {
      imgKey: obj?.data?.imgKey || '',
      sourceKind: webSourceClipboardKind(source),
      error: String(err),
    });
    return null;
  }
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

const copySelected = (options = {}) => {
  const animateCopy = options.animateCopy !== false;
  const dbg = ClipDebug.start('copySelected', { selectedCount: selectedIds.size });
  if (!selectedIds.size) { ClipDebug.end(dbg, { skipped: 'empty-selection' }); return false; }

  if (selectedIds.size > 1) {
    if (animateCopy) globalThis.BoardfishMotion?.applyActionAnimation?.('copy-selected-objects', { selection: true });
    const clonedObjs = [];
    const imageData = {};
    let imageCount = 0;
    let processed = 0;
    ClipDebug.step(dbg, 'copy:multi-start', { selectedCount: selectedIds.size });
    for (const id of selectedIds) {
      processed++;
      const obj = objectsMap.get(id);
      if (!obj) continue;
      const cloned = cloneObject(obj, { runtimeTextCache: obj.type === 'text' });
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
          ...clipboardTextMetricsForObjects(clonedObjs),
        });
      }
    }
    if (!clonedObjs.length) { ClipDebug.end(dbg, { skipped: 'no-clones' }); return false; }
    ClipDebug.step(dbg, 'copy:multi-set-jsClipboard-start', {
      objectCount: clonedObjs.length,
      imageCount,
      ...clipboardTextMetricsForObjects(clonedObjs),
    });
    setJsClipboard({ type: 'objects', objects: clonedObjs, imageData });
    writeWebClipboardTokenForJsClipboard(dbg, { objectCount: clonedObjs.length, imageCount });
    ClipDebug.step(dbg, 'copy:multi-set-jsClipboard-end', {
      objectCount: clonedObjs.length,
      imageCount,
      ...clipboardTextMetricsForObjects(clonedObjs),
    });
    ClipDebug.end(dbg, {
      path: 'multi-jsClipboard',
      objectCount: clonedObjs.length,
      imageCount,
      ...clipboardTextMetricsForObjects(clonedObjs),
    });
    return true;
  }

  const obj = getFirstSelectedObject();
  if (!obj) { ClipDebug.end(dbg, { skipped: 'missing-object' }); return false; }
  if (animateCopy) {
    if (!noteTextObjectCopyFeedback(obj)) {
      globalThis.BoardfishMotion?.applyActionAnimation?.('copy-selected-objects', { selection: true });
    }
  }

  const cloneStartedAt = clipboardNow();
  const cloned = cloneObject(obj, { runtimeTextCache: obj.type === 'text' });
  ClipDebug.step(dbg, 'copy:single-clone-done', {
    type: obj.type,
    ms: clipboardElapsedMs(cloneStartedAt),
    ...(obj.type === 'text' ? clipboardTextStats(cloned.data?.content, cloned.data?.scriptRanges) : {}),
  });
  const imgData = {};
  if (obj.type === 'image') {
    const src = BoardfishImageStore.getSource(obj.data.imgKey);
    if (src) imgData[obj.data.imgKey] = src;
  }
  setJsClipboard({ type: 'objects', objects: [cloned], imageData: imgData });
  ClipDebug.step(dbg, 'set-jsClipboard', {
    type: obj.type,
    imgKey: obj.data?.imgKey,
    imageNeedsRendering: obj.type === 'image' ? imageNeedsRendering(obj) : false,
    ...(obj.type === 'text' ? clipboardTextStats(cloned.data?.content, cloned.data?.scriptRanges) : {}),
  });

  if (obj.type === 'text') {
    const payloadStartedAt = clipboardNow();
    const clipboardText = typeof textObjectContentForClipboard === 'function'
      ? textObjectContentForClipboard(obj)
      : textForClipboard(obj.data.content);
    const textStats = clipboardTextStats(clipboardText, cloned.data?.scriptRanges);
    ClipDebug.step(dbg, 'copy:text-payload-ready', {
      sourceTextLen: String(obj.data?.content || '').length,
      ms: clipboardElapsedMs(payloadStartedAt),
      ...textStats,
    });
    const webToken = globalThis.getJsClipboardWebToken?.() || '';
    const writeStartedAt = clipboardNow();
    ClipDebug.step(dbg, 'copy:web-text-clipboard-write-start', {
      boardfishToken: !!webToken,
      ...textStats,
    });
    BoardfishClipboardIO.copyTextToClipboard(clipboardText, dbg, { boardfishToken: webToken, ...textStats })
      .then((result) => finishWebClipboardTokenWrite(result, webToken, dbg))
      .then(() => {
        ClipDebug.step(dbg, 'copy:web-text-clipboard-write-end', {
          ms: clipboardElapsedMs(writeStartedAt),
          ...textStats,
        });
      })
      .catch((err) => {
        ClipDebug.step(dbg, 'copy:web-text-clipboard-write-error', {
          ms: clipboardElapsedMs(writeStartedAt),
          error: String(err),
          ...textStats,
        });
        console.error('[copy] writeText FAILED:', err);
      })
      .finally(() => ClipDebug.end(dbg, {
        path: 'text-web',
        objectCount: 1,
        textObjectCount: 1,
        textCharCount: textStats.textLen,
        largestTextChars: textStats.textLen,
        ...textStats,
      }));
    return true;
  }

  if (obj.type === 'image') {
    const writeWebPngBlob = async (blob, path, meta = {}) => {
      const webToken = globalThis.getJsClipboardWebToken?.() || '';
      const writeMeta = { path, blobSize: blob?.size ?? '', ...meta };
      const startedAt = clipboardNow();
      ClipDebug.step(dbg, 'copy:web-clipboard-write-start', writeMeta);
      try {
        const result = await BoardfishClipboardIO.copyImageBlobToClipboard(blob, webToken, dbg);
        ClipDebug.step(dbg, 'copy:web-clipboard-write-end', {
          ...writeMeta,
          ms: Math.round((clipboardNow() - startedAt) * 100) / 100,
        });
        finishWebClipboardTokenWrite(result, webToken, dbg);
        return true;
      } catch (err) {
        ClipDebug.step(dbg, 'copy:web-clipboard-write-error', {
          ...writeMeta,
          ms: Math.round((clipboardNow() - startedAt) * 100) / 100,
          error: String(err),
        });
        console.error('[copy] clipboard.write FAILED:', err);
        return false;
      } finally {
        ClipDebug.end(dbg, writeMeta);
      }
    };
    const storedSource = BoardfishImageStore.getSource(obj.data.imgKey);
    const sourcePngBlob = createWebSourcePngClipboardBlob(obj, storedSource, dbg);
    if (sourcePngBlob) {
      return writeWebPngBlob(sourcePngBlob, 'image-web-source-png', {
        imgKey: obj.data.imgKey,
        sourceKind: webSourceClipboardKind(storedSource),
        sourceBytes: sourcePngBlob.size,
      });
    }
    let pngBlob = null;
    const canvas = renderImageToCanvas(obj);
    if (!canvas) {
      ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'image-not-ready' });
      return false;
    }
    return (async () => {
      try {
        pngBlob = await canvasToPngBlob(canvas);
        if (!pngBlob) {
          ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'blob-null' });
          return false;
        }
        return await writeWebPngBlob(pngBlob, 'image-web-rendered');
      } catch (err) {
        console.error('[copy] clipboard.write FAILED:', err);
        return false;
      }
    })();
  }
  ClipDebug.end(dbg, { path: 'object-jsClipboard', type: obj.type || '' });
  return true;
};

const cutSelected = () => {
  if (!hasSelection() || editingId) return false;
  globalThis.BoardfishMotion?.applyActionAnimation?.('cut-selected-objects');
  let copyResult = false;
  try {
    copyResult = copySelected({ animateCopy: false });
  } catch (err) {
    console.error('[cut] copySelected FAILED:', err);
    return false;
  }
  if (copyResult === false) return false;
  deleteSelected();
  if (copyResult && typeof copyResult.catch === 'function') {
    copyResult.catch((err) => console.error('[cut] copySelected FAILED:', err));
  }
  return true;
};

async function pasteAtPos(wx, wy, clipboardData = null) {
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
      ClipDebug.step(dbg, 'clear-stale-jsClipboard', { expectedToken: _jsClipboardWebToken });
      clearJsClipboard();
    }
    if (jsClipboard) {
      if (jsClipboard.type === 'objects') {
        const sourceObjects = jsClipboard.objects || [];
        const imgData = jsClipboard.imageData || {};
        const imgEntries = Object.entries(imgData);
        ClipDebug.step(dbg, 'paste:objects-start', {
          objectCount: sourceObjects.length,
          imageCount: imgEntries.length,
          ...clipboardTextMetricsForObjects(sourceObjects),
        });
        const cloneStart = performance.now();
        const clones = cloneObjects(sourceObjects, { runtimeTextCache: true });
        ClipDebug.step(dbg, 'paste:clone-done', {
          objectCount: clones.length,
          ms: Math.round((performance.now() - cloneStart) * 100) / 100,
          ...clipboardTextMetricsForObjects(clones),
        });
        if (!clones.length) { ClipDebug.end(dbg, { skipped: 'empty-jsClipboard' }); return; }
        let trimmedTextObjects = 0;
        const trimStart = clipboardNow();
        for (const obj of clones) {
          if (trimPastedTextObjectContent(obj)) trimmedTextObjects++;
        }
        ClipDebug.step(dbg, 'paste:text-trim-done', {
          trimmedTextObjects,
          ms: clipboardElapsedMs(trimStart),
          ...clipboardTextMetricsForObjects(clones),
        });
        const objectLimitStart = clipboardNow();
        const canAddObjects = BoardfishWebLimits.canAddObjects(clones.length);
        ClipDebug.step(dbg, 'paste:object-limit-done', {
          objectCount: clones.length,
          accepted: canAddObjects,
          ms: clipboardElapsedMs(objectLimitStart),
        });
        if (!canAddObjects) {
          ClipDebug.end(dbg, { skipped: 'web-object-limit', objectCount: clones.length });
          return;
        }
        if (!BoardfishWebLimits.isLimitedRuntime || BoardfishWebLimits.isLimitedRuntime()) {
          const contentLimitStart = clipboardNow();
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
          const canAcceptContent = BoardfishWebLimits.canAcceptAdditionalContentBytes(
            additionalImageBytes + additionalTextBytes,
            clones.length
          );
          ClipDebug.step(dbg, 'paste:content-limit-done', {
            additionalImageBytes,
            additionalTextBytes,
            accepted: canAcceptContent,
            ms: clipboardElapsedMs(contentLimitStart),
          });
          if (!canAcceptContent) {
            ClipDebug.end(dbg, { skipped: 'web-content-limit', additionalImageBytes, additionalTextBytes });
            return;
          }
        }
        // Re-register image data in case we're on a different board
        let registeredImages = 0;
        let processedImages = 0;
        const registerImagesStart = clipboardNow();
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
        ClipDebug.step(dbg, 'paste:register-images-done', {
          imageCount: imgEntries.length,
          registeredImages,
          ms: clipboardElapsedMs(registerImagesStart),
        });
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
        ClipDebug.step(dbg, 'paste:objects-add-start', { objectCount: clones.length, ...clipboardTextMetricsForObjects(clones) });
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
        ClipDebug.step(dbg, 'paste:objects-add-done', {
          objectCount: clones.length,
          registeredImages,
          ...clipboardTextMetricsForObjects(clones),
        });
        scheduleRender(true, true);
        ClipDebug.step(dbg, 'paste:boardHistory-start', { objectCount: clones.length });
        pushHistory('paste-objects');
        ClipDebug.step(dbg, 'paste:boardHistory-done', { historyIndex });
        ClipDebug.end(dbg, {
          path: 'jsClipboard',
          objectCount: clones.length,
          registeredImages,
          historyIndex,
          objectCountAfter: objects.length,
          ...clipboardTextMetricsForObjects(clones),
        });
        return;
      }
    }
    const eventImageFile = BoardfishClipboardIO.readClipboardImageFileFromEvent(clipboardData, dbg);
    if (eventImageFile) {
      await pasteWebImageBlob(eventImageFile, wx, wy, dbg, 'web-paste-event');
      return;
    }
    const eventText = BoardfishClipboardIO.readClipboardTextFromEvent(clipboardData);
    ClipDebug.step(dbg, 'paste:event-text-read-done', clipboardTextStats(eventText));
    if (eventText && eventText.trim()) {
      const objectCountBefore = objects.length;
      const addStartedAt = clipboardNow();
      ClipDebug.step(dbg, 'paste:plain-text-add-start', {
        path: 'event-text',
        objectCountBefore,
        ...clipboardTextStats(eventText),
      });
      addText(wx, wy, eventText, addTextPasteOptions(dbg, {
        anchor: 'center',
        editAfterCreate: true,
        enterEditHistory: false,
      }));
      ClipDebug.step(dbg, 'paste:plain-text-add-done', {
        path: 'event-text',
        ms: clipboardElapsedMs(addStartedAt),
        objectCountBefore,
        objectCountAfter: objects.length,
        objectDelta: objects.length - objectCountBefore,
        ...clipboardTextStats(eventText),
      });
      ClipDebug.end(dbg, { path: 'event-text', textLen: eventText.length, textObjectCount: 1, textCharCount: eventText.length, largestTextChars: eventText.length, objectCountAfter: objects.length });
      return;
    }
    const releaseInputShield = acquireInputShield();
    try {
      const imageBlob = await BoardfishClipboardIO.readClipboardImageBlobFromBrowser(dbg);
      if (imageBlob) {
        releaseInputShield();
        await pasteWebImageBlob(imageBlob, wx, wy, dbg, 'web-paste-browser');
        return;
      }
      const textReadStartedAt = clipboardNow();
      ClipDebug.step(dbg, 'browser-text-read:start');
      const text = await navigator.clipboard.readText();
      ClipDebug.step(dbg, 'browser-text-read:ok', {
        ms: clipboardElapsedMs(textReadStartedAt),
        ...clipboardTextStats(text),
      });
      if (text && text.trim()) {
        const objectCountBefore = objects.length;
        const addStartedAt = clipboardNow();
        ClipDebug.step(dbg, 'paste:plain-text-add-start', {
          path: 'web-text',
          objectCountBefore,
          ...clipboardTextStats(text),
        });
        addText(wx, wy, text, addTextPasteOptions(dbg, {
          anchor: 'center',
          editAfterCreate: true,
          enterEditHistory: false,
        }));
        ClipDebug.step(dbg, 'paste:plain-text-add-done', {
          path: 'web-text',
          ms: clipboardElapsedMs(addStartedAt),
          objectCountBefore,
          objectCountAfter: objects.length,
          objectDelta: objects.length - objectCountBefore,
          ...clipboardTextStats(text),
        });
      }
      ClipDebug.end(dbg, {
        path: 'web-text',
        textLen: text?.length || 0,
        textObjectCount: text && text.trim() ? 1 : 0,
        textCharCount: text?.length || 0,
        largestTextChars: text?.length || 0,
        objectCountAfter: objects.length,
      });
    } catch (err) {
      ClipDebug.end(dbg, { path: 'web-empty', error: String(err), objectCountAfter: objects.length });
    } finally {
      releaseInputShield();
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
