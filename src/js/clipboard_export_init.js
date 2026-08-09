/* BOARDFISH_DEV_DIAGNOSTICS_START */
const collectClipboardDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
/* BOARDFISH_DEV_DIAGNOSTICS_END */

const finishWebClipboardTokenWrite = (result, token
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  if (!result?.boardfishTokenWritten) return;
  globalThis.markJsClipboardWebTokenWritten?.(token
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
};

const writeWebClipboardTokenForJsClipboard = (
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  dbg = null, meta = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  if (globalThis.document?.visibilityState === 'hidden') return;
  const webToken = globalThis.getJsClipboardWebToken?.() || '';
  if (!webToken) return;
  BoardfishClipboardIO.copyBoardfishTokenToClipboard(webToken
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg, meta
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  )
    .then((result) => {
      finishWebClipboardTokenWrite(result, webToken
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
    })
    .catch((err) => console.error('[copy] web clipboard token write FAILED:', err));
};

const readWebClipboardTokenForPaste = async (clipboardData
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  if (clipboardData) {
    return {
      checked: true,
      token: BoardfishClipboardIO.readBoardfishClipboardTokenFromEvent(clipboardData),
    };
  }
  try {
    return await BoardfishClipboardIO.readBoardfishClipboardTokenFromBrowser(
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    );
  } catch (err) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'browser-clipboard-token-read:error', { error: String(err) });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { checked: false, token: '' };
  }
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
  }
  syncTextAutoHeight(obj);
  return true;
};

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const clipboardTextMetricsForObjects = (items = []) => {
  if (!collectClipboardDiagnostics || !ClipDebug.enabled) return {};
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
/* BOARDFISH_DEV_DIAGNOSTICS_END */

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const clipboardNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const clipboardElapsedMs = (startedAt) => Math.round((clipboardNow() - startedAt) * 100) / 100;

const clipboardTextStats = (value, scriptRanges = []) => {
  if (!collectClipboardDiagnostics || !ClipDebug.enabled) return {};
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
/* BOARDFISH_DEV_DIAGNOSTICS_END */

const webSourceClipboardMime = (source) => {
  if (typeof isWebImageRef === 'function' && isWebImageRef(source)) return String(source.mime || '').toLowerCase();
  if (typeof source === 'string') return (/^data:([^;,]+)/i.exec(source)?.[1] || '').toLowerCase();
  return '';
};

/* BOARDFISH_DEV_DIAGNOSTICS_START */
const webSourceClipboardKind = (source) => {
  if (typeof isWebImageRef === 'function' && isWebImageRef(source)) return 'web-ref';
  if (typeof source === 'string' && source.startsWith('data:')) return 'data-url';
  return typeof source;
};
/* BOARDFISH_DEV_DIAGNOSTICS_END */

const createWebSourcePngClipboardBlob = (obj, source
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  if (!obj || imageNeedsRendering(obj)) return null;
  if (typeof Blob === 'undefined') return null;
  const container = globalThis.BoardfishWebBoardContainer;
  if (!container?.bytesForImageSource) return null;
  if (webSourceClipboardMime(source) !== 'image/png') return null;

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const startedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  try {
    const sourceBlob = container.blobForImageSource?.(source);
    if (sourceBlob) {
      const blob = sourceBlob.type === 'image/png'
        ? sourceBlob
        : sourceBlob.slice(0, sourceBlob.size, 'image/png');
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) {
        ClipDebug.step(dbg, 'copy:web-source-png-blob', {
          imgKey: obj?.data?.imgKey || '',
          sourceKind: webSourceClipboardKind(source),
          sourceBytes: blob.size,
          blobSize: blob.size,
          ms: Math.round((clipboardNow() - startedAt) * 100) / 100,
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return blob;
    }
    const bytes = container.bytesForImageSource(source);
    if (!bytes) return null;
    const blob = new Blob([bytes], { type: 'image/png' });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'copy:web-source-png-blob', {
        imgKey: obj?.data?.imgKey || '',
        sourceKind: webSourceClipboardKind(source),
        sourceBytes: bytes.byteLength ?? bytes.length ?? blob.size,
        blobSize: blob.size,
        ms: Math.round((clipboardNow() - startedAt) * 100) / 100,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return blob;
  } catch (err) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'copy:web-source-png-blob:error', {
        imgKey: obj?.data?.imgKey || '',
        sourceKind: webSourceClipboardKind(source),
        error: String(err),
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return null;
  }
};

async function pasteWebImageBlob(blob, wx, wy
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , source, dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) {
  if (!blob) return false;
  const imageBlob = blob.type ? blob : blob.slice(0, blob.size, 'image/png');
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const objectCountBefore = objects.length;
  if (collectClipboardDiagnostics) {
    ClipDebug.step(dbg, `${source}:insert-start`, {
      fileName: imageFileDebugName(imageBlob, source),
      fileSize: imageBlob.size ?? '',
      fileType: imageBlob.type || '',
      objectCountBefore,
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  await insertImageFiles([imageBlob], wx, wy
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , source
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  );
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const objectCountAfter = objects.length;
  const added = objectCountAfter > objectCountBefore;
  if (collectClipboardDiagnostics) {
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
  }
  return added;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
}

const copySelected = (options = {}) => {
  const animateCopy = options.animateCopy !== false;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = collectClipboardDiagnostics
    ? ClipDebug.start('copySelected', { selectedCount: selectedIds.size })
    : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (!selectedIds.size) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) ClipDebug.end(dbg, { skipped: 'empty-selection' });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return false;
  }

  if (selectedIds.size > 1) {
    const clonedObjs = [];
    const imageData = {};
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let imageCount = 0;
    let processed = 0;
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'copy:multi-start', { selectedCount: selectedIds.size });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    for (const id of selectedIds) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) processed++;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const obj = objectsMap.get(id);
      if (!obj) continue;
      const cloned = cloneObject(obj, true);
      if (cloned.type === 'image') {
        const imgKey = cloned.data.imgKey;
        const src = BoardfishImageStore.getSource(imgKey);
        if (src) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (
            collectClipboardDiagnostics &&
            !Object.prototype.hasOwnProperty.call(imageData, imgKey)
          ) imageCount++;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          imageData[imgKey] = src;
        }
      }
      clonedObjs.push(cloned);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (
        collectClipboardDiagnostics &&
        (processed === 1 || processed % 50 === 0 || processed === selectedIds.size)
      ) {
        ClipDebug.step(dbg, 'copy:multi-progress', {
          processed,
          selectedCount: selectedIds.size,
          objectCount: clonedObjs.length,
          imageCount,
          ...clipboardTextMetricsForObjects(clonedObjs),
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    if (!clonedObjs.length) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) ClipDebug.end(dbg, { skipped: 'no-clones' });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return false;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'copy:multi-set-jsClipboard-start', {
        objectCount: clonedObjs.length,
        imageCount,
        ...clipboardTextMetricsForObjects(clonedObjs),
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    setJsClipboard({ type: 'objects', objects: clonedObjs, imageData });
    writeWebClipboardTokenForJsClipboard(
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      dbg, { objectCount: clonedObjs.length, imageCount }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    );
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) {
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
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (animateCopy) globalThis.BoardfishMotion?.applyCopyFeedback?.({ selection: true });
    return true;
  }

  const obj = getFirstSelectedObject();
  if (!obj) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) ClipDebug.end(dbg, { skipped: 'missing-object' });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return false;
  }
  if (animateCopy && obj.type === 'text') globalThis.BoardfishMotion?.applyCopyFeedback?.({ objects: [obj] });

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const cloneStartedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const cloned = cloneObject(obj, true);
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (collectClipboardDiagnostics) {
    ClipDebug.step(dbg, 'copy:single-clone-done', {
      type: obj.type,
      ms: clipboardElapsedMs(cloneStartedAt),
      ...(obj.type === 'text' ? clipboardTextStats(cloned.data?.content, cloned.data?.scriptRanges) : {}),
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  const imgData = {};
  if (obj.type === 'image') {
    const src = BoardfishImageStore.getSource(obj.data.imgKey);
    if (src) imgData[obj.data.imgKey] = src;
  }
  setJsClipboard({ type: 'objects', objects: [cloned], imageData: imgData });
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (collectClipboardDiagnostics) {
    ClipDebug.step(dbg, 'set-jsClipboard', {
      type: obj.type,
      imgKey: obj.data?.imgKey,
      imageNeedsRendering: obj.type === 'image' ? imageNeedsRendering(obj) : false,
      ...(obj.type === 'text' ? clipboardTextStats(cloned.data?.content, cloned.data?.scriptRanges) : {}),
    });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  if (obj.type === 'text') {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const payloadStartedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const clipboardText = typeof textObjectContentForClipboard === 'function'
      ? textObjectContentForClipboard(obj)
      : textForClipboard(obj.data.content);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const textStats = collectClipboardDiagnostics
      ? clipboardTextStats(clipboardText, cloned.data?.scriptRanges)
      : null;
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'copy:text-payload-ready', {
        sourceTextLen: String(obj.data?.content || '').length,
        ms: clipboardElapsedMs(payloadStartedAt),
        ...textStats,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const webToken = globalThis.getJsClipboardWebToken?.() || '';
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const writeStartedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'copy:web-text-clipboard-write-start', {
        boardfishToken: !!webToken,
        ...textStats,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    BoardfishClipboardIO.copyTextToClipboard(
      clipboardText
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      , {
        boardfishToken: webToken
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , ...textStats
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
    )
      .then((result) => {
        finishWebClipboardTokenWrite(result, webToken
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          , dbg
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        );
      })
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      .then(() => {
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'copy:web-text-clipboard-write-end', {
            ms: clipboardElapsedMs(writeStartedAt),
            ...textStats,
          });
        }
      })
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      .catch((err) => {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'copy:web-text-clipboard-write-error', {
            ms: clipboardElapsedMs(writeStartedAt),
            error: String(err),
            ...textStats,
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        console.error('[copy] writeText FAILED:', err);
      })
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      .finally(() => {
        if (collectClipboardDiagnostics) {
          ClipDebug.end(dbg, {
            path: 'text-web',
            objectCount: 1,
            textObjectCount: 1,
            textCharCount: textStats.textLen,
            largestTextChars: textStats.textLen,
            ...textStats,
          });
        }
      })
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      ;
    return true;
  }

  if (obj.type === 'image') {
    const writeWebPngBlob = async (blob
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , path, meta = null
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    ) => {
      const webToken = globalThis.getJsClipboardWebToken?.() || '';
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const writeMeta = collectClipboardDiagnostics
        ? { path, blobSize: blob?.size ?? '', ...meta }
        : null;
      const startedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      let copied = false;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) {
        ClipDebug.step(dbg, 'copy:web-clipboard-write-start', writeMeta);
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      try {
        const result = await BoardfishClipboardIO.copyImageBlobToClipboard(blob, webToken
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          , dbg
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        );
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'copy:web-clipboard-write-end', {
            ...writeMeta,
            ms: Math.round((clipboardNow() - startedAt) * 100) / 100,
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        finishWebClipboardTokenWrite(result, webToken
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          , dbg
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        );
        copied = true;
        return true;
      } catch (err) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'copy:web-clipboard-write-error', {
            ...writeMeta,
            ms: Math.round((clipboardNow() - startedAt) * 100) / 100,
            error: String(err),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        console.error('[copy] clipboard.write FAILED:', err);
        return false;
      } finally {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) ClipDebug.end(dbg, writeMeta);
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        if (copied && animateCopy) {
          globalThis.BoardfishMotion?.applyCopyFeedback?.({ objects: [obj] });
        }
      }
    };
    const storedSource = BoardfishImageStore.getSource(obj.data.imgKey);
    const sourcePngBlob = createWebSourcePngClipboardBlob(obj, storedSource
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    );
    if (sourcePngBlob) {
      return writeWebPngBlob(sourcePngBlob
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , 'image-web-source-png', {
          imgKey: obj.data.imgKey,
          sourceKind: webSourceClipboardKind(storedSource),
          sourceBytes: sourcePngBlob.size,
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
    }
    let pngBlob = null;
    const canvas = renderImageToCanvas(obj);
    if (!canvas) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) {
        ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'image-not-ready' });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return false;
    }
    return (async () => {
      try {
        pngBlob = await canvasToPngBlob(canvas);
        if (!pngBlob) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectClipboardDiagnostics) {
            ClipDebug.end(dbg, { path: 'image-rendered', skipped: 'blob-null' });
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          return false;
        }
        return await writeWebPngBlob(pngBlob
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          , 'image-web-rendered'
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        );
      } catch (err) {
        console.error('[copy] clipboard.write FAILED:', err);
        return false;
      }
    })();
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (collectClipboardDiagnostics) {
    ClipDebug.end(dbg, { path: 'object-jsClipboard', type: obj.type || '' });
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (animateCopy) globalThis.BoardfishMotion?.applyCopyFeedback?.({ objects: [obj] });
  return true;
};

const cutSelected = () => {
  if (!hasSelection() || editingId) return false;
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
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const dbg = collectClipboardDiagnostics
    ? ClipDebug.start('pasteAtPos', {
        wx,
        wy,
        hasJsClipboard: !!jsClipboard,
        jsClipboardType: jsClipboard?.type,
        objectCountBefore: objects.length,
      })
    : null;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  if (_pasteInProgress) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) {
      ClipDebug.end(dbg, { path: 'paste-busy', skipped: 'paste-in-progress' });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return;
  }
  _pasteInProgress = true;
  try {
    let browserClipboardItems = null;
    if (jsClipboard && (clipboardData || _jsClipboardWebMaybeStale)) {
      const webClipboardToken = await readWebClipboardTokenForPaste(clipboardData
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
      browserClipboardItems = webClipboardToken.items || null;
      if (!jsClipboardStillCurrent(
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        dbg,
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        {
          webClipboardTokenChecked: webClipboardToken.checked,
          webClipboardToken: webClipboardToken.token,
        }
      )) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'clear-stale-jsClipboard', { expectedToken: _jsClipboardWebToken });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        clearJsClipboard();
      }
    }
    if (jsClipboard) {
      if (jsClipboard.type === 'objects') {
        const sourceObjects = jsClipboard.objects || [];
        if (!sourceObjects.length || !BoardfishWebLimits.canAddObjects(sourceObjects.length)) return;
        const imgData = jsClipboard.imageData || {};
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const imageCount = collectClipboardDiagnostics && ClipDebug.enabled
          ? Object.keys(imgData).length
          : 0;
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:objects-start', {
            objectCount: sourceObjects.length,
            imageCount,
            ...clipboardTextMetricsForObjects(sourceObjects),
          });
        }
        const cloneStart = collectClipboardDiagnostics ? performance.now() : 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        const clones = cloneObjects(sourceObjects, true);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:clone-done', {
            objectCount: clones.length,
            ms: Math.round((performance.now() - cloneStart) * 100) / 100,
            ...clipboardTextMetricsForObjects(clones),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        let trimmedTextObjects = 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        let additionalTextBytes = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const trimStart = collectClipboardDiagnostics ? clipboardNow() : 0;
        const contentLimitStart = trimStart;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        for (const obj of clones) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const trimmed =
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          trimPastedTextObjectContent(obj);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectClipboardDiagnostics && trimmed) trimmedTextObjects++;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          if (obj?.type === 'text') {
            additionalTextBytes += BoardfishWebLimits.textByteLength(String(obj.data?.content || ''));
          }
          minX = Math.min(minX, obj.x); minY = Math.min(minY, obj.y);
          maxX = Math.max(maxX, obj.x + obj.w); maxY = Math.max(maxY, obj.y + obj.h);
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:text-trim-done', {
            trimmedTextObjects,
            ms: clipboardElapsedMs(trimStart),
            ...clipboardTextMetricsForObjects(clones),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        let additionalImageBytes = 0;
        for (const key in imgData) {
          if (!Object.prototype.hasOwnProperty.call(imgData, key)) continue;
          if (!BoardfishImageStore.hasSource(key)) {
            additionalImageBytes += BoardfishWebLimits.imageSourceByteLength(imgData[key]);
          }
        }
        const canAcceptContent = BoardfishWebLimits.canAcceptAdditionalContentBytes(
          additionalImageBytes + additionalTextBytes,
          clones.length
        );
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:content-limit-done', {
            additionalImageBytes,
            additionalTextBytes,
            accepted: canAcceptContent,
            ms: clipboardElapsedMs(contentLimitStart),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        if (!canAcceptContent) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectClipboardDiagnostics) {
            ClipDebug.end(dbg, {
              skipped: 'web-content-limit',
              additionalImageBytes,
              additionalTextBytes,
            });
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          return;
        }
        // Re-register image data in case we're on a different board
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        let registeredImages = 0;
        let processedImages = 0;
        const registerImagesStart = collectClipboardDiagnostics ? clipboardNow() : 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        for (const key in imgData) {
          if (!Object.prototype.hasOwnProperty.call(imgData, key)) continue;
          const src = imgData[key];
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectClipboardDiagnostics) processedImages++;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          if (!BoardfishImageStore.hasSource(key)) {
            BoardfishImageStore.setSource(key, src);
            cacheImage(key, src);
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            if (collectClipboardDiagnostics) registeredImages++;
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (
            collectClipboardDiagnostics &&
            (processedImages === 1 || processedImages % 50 === 0 || processedImages === imageCount)
          ) {
            ClipDebug.step(dbg, 'paste:register-images-progress', {
              processed: processedImages,
              imageCount,
              registeredImages,
            });
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:register-images-done', {
            imageCount,
            registeredImages,
            ms: clipboardElapsedMs(registerImagesStart),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        const dx = wx - (minX + maxX) / 2, dy = wy - (minY + maxY) / 2;
        const pastedIds = [];
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:objects-add-start', {
            objectCount: clones.length,
            ...clipboardTextMetricsForObjects(clones),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        for (const o of clones) {
          o.id = newId(); o.x += dx; o.y += dy; o.z = ++zCounter;
          BoardfishEditorState.addObject(o);
          pastedIds.push(o.id);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (
            collectClipboardDiagnostics &&
            (pastedIds.length === 1 || pastedIds.length % 50 === 0 || pastedIds.length === clones.length)
          ) {
            ClipDebug.step(dbg, 'paste:objects-add-progress', {
              processed: pastedIds.length,
              objectCount: clones.length,
              registeredImages,
            });
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        }
        BoardfishEditorState.setSelection(pastedIds, {
          primaryId: pastedIds[pastedIds.length - 1],
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:objects-add-done', {
            objectCount: clones.length,
            registeredImages,
            ...clipboardTextMetricsForObjects(clones),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        scheduleRender(true, true);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:boardHistory-start', { objectCount: clones.length });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        pushHistory('paste-objects');
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:boardHistory-done', { historyIndex });
          ClipDebug.end(dbg, {
            path: 'jsClipboard',
            objectCount: clones.length,
            registeredImages,
            historyIndex,
            objectCountAfter: objects.length,
            ...clipboardTextMetricsForObjects(clones),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return;
      }
    }
    const eventImageFile = BoardfishClipboardIO.readClipboardImageFileFromEvent(clipboardData
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      , dbg
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    );
    if (eventImageFile) {
      await pasteWebImageBlob(eventImageFile, wx, wy
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , 'web-paste-event', dbg
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
      return;
    }
    const eventText = BoardfishClipboardIO.readClipboardTextFromEvent(clipboardData);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardDiagnostics) {
      ClipDebug.step(dbg, 'paste:event-text-read-done', clipboardTextStats(eventText));
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (eventText && eventText.trim()) {
      const text = textForExternalTextObjectPaste(eventText);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const objectCountBefore = collectClipboardDiagnostics ? objects.length : 0;
      const addStartedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
      if (collectClipboardDiagnostics) {
        ClipDebug.step(dbg, 'paste:plain-text-add-start', {
          path: 'event-text',
          objectCountBefore,
          ...clipboardTextStats(text),
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      addText(wx, wy, text,
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        dbg ? { anchor: 'center', contentPrepared: true, debug: dbg } :
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        { anchor: 'center', contentPrepared: true }
      );
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) {
        ClipDebug.step(dbg, 'paste:plain-text-add-done', {
          path: 'event-text',
          ms: clipboardElapsedMs(addStartedAt),
          objectCountBefore,
          objectCountAfter: objects.length,
          objectDelta: objects.length - objectCountBefore,
          ...clipboardTextStats(text),
        });
        ClipDebug.end(dbg, {
          path: 'event-text',
          textLen: text.length,
          textObjectCount: 1,
          textCharCount: text.length,
          largestTextChars: text.length,
          objectCountAfter: objects.length,
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return;
    }
    const releaseInputShield = acquireInputShield();
    try {
      const clipboardItems = browserClipboardItems || (
        navigator.clipboard?.read ? await navigator.clipboard.read() : []
      );
      let imageBlob = null;
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type !== 'image/png' && type !== 'image/jpeg') continue;
          imageBlob = await item.getType(type);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectClipboardDiagnostics) {
            ClipDebug.step(dbg, 'browser-image-blob', { type, blobSize: imageBlob.size });
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          break;
        }
        if (imageBlob) break;
      }
      if (imageBlob) {
        releaseInputShield();
        await pasteWebImageBlob(imageBlob, wx, wy
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          , 'web-paste-browser', dbg
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        );
        return;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const textReadStartedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
      if (collectClipboardDiagnostics) ClipDebug.step(dbg, 'browser-text-read:start');
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const browserText = await navigator.clipboard.readText();
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) {
        ClipDebug.step(dbg, 'browser-text-read:ok', {
          ms: clipboardElapsedMs(textReadStartedAt),
          ...clipboardTextStats(browserText),
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const text = textForExternalTextObjectPaste(browserText);
      if (text) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const objectCountBefore = collectClipboardDiagnostics ? objects.length : 0;
        const addStartedAt = collectClipboardDiagnostics ? clipboardNow() : 0;
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:plain-text-add-start', {
            path: 'web-text',
            objectCountBefore,
            ...clipboardTextStats(text),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        addText(wx, wy, text,
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          dbg ? { anchor: 'center', contentPrepared: true, debug: dbg } :
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          { anchor: 'center', contentPrepared: true }
        );
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardDiagnostics) {
          ClipDebug.step(dbg, 'paste:plain-text-add-done', {
            path: 'web-text',
            ms: clipboardElapsedMs(addStartedAt),
            objectCountBefore,
            objectCountAfter: objects.length,
            objectDelta: objects.length - objectCountBefore,
            ...clipboardTextStats(text),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) {
        ClipDebug.end(dbg, {
          path: 'web-text',
          textLen: text?.length || 0,
          textObjectCount: text ? 1 : 0,
          textCharCount: text?.length || 0,
          largestTextChars: text?.length || 0,
          objectCountAfter: objects.length,
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } catch (err) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardDiagnostics) {
        ClipDebug.end(dbg, {
          path: 'web-empty',
          error: String(err),
          objectCountAfter: objects.length,
        });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
  const point = typeof boardCursorWorldPoint === 'function'
    ? boardCursorWorldPoint()
    : toWorld(window.innerWidth / 2, window.innerHeight / 2);
  pasteAtPos(point.x, point.y, e.clipboardData);
});

// ─── Init ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);
