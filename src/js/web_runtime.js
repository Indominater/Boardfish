'use strict';

(function initBoardfishRuntime(root) {
  const BOARD_FILE_TYPES = Object.freeze([
    {
      description: 'Boardfish board',
      accept: {
        'application/octet-stream': ['.bf'],
      },
    },
  ]);
  const FILE_OPERATION_TIMEOUT_MS = 30000;
  const FILE_OPERATION_MAX_TIMEOUT_MS = 5 * 60 * 1000;
  const FILE_ABORT_TIMEOUT_MS = 5000;
  const FILE_COMPARISON_TIMEOUT_MS = 5000;
  const FILE_WRITE_MIN_BYTES_PER_SECOND = 2 * 1024 * 1024;

  function isAbortError(err) {
    return err?.name === 'AbortError';
  }

  function webFileRef(file, name = '') {
    return {
      kind: 'web-file',
      file,
      name: name || file?.name || 'board.bf',
    };
  }

  function webFileHandleRef(handle) {
    return {
      kind: 'web-file-handle',
      handle,
      name: handle?.name || 'board.bf',
    };
  }

  function webSaveHandleRef(handle) {
    return {
      kind: 'web-save-handle',
      handle,
      name: handle?.name || 'board.bf',
    };
  }

  function webDownloadRef(name) {
    return {
      kind: 'web-download',
      name: name || 'board.bf',
    };
  }

  function describeFileRef(ref) {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    return ref.name || ref.handle?.name || ref.file?.name || '';
  }

  function fileNameFromRef(ref, fallback = 'board.bf') {
    const value = describeFileRef(ref) || fallback;
    return String(value).split(/[\\/]/).pop() || fallback;
  }

  function canSaveToExistingTarget(ref) {
    if (!ref) return false;
    return ref.unusable !== true && (ref.kind === 'web-file-handle' || ref.kind === 'web-save-handle');
  }

  function persistentFileHandleFromRef(ref) {
    if (ref?.kind !== 'web-file-handle' && ref?.kind !== 'web-save-handle') return null;
    return ref.handle || null;
  }

  async function fileRefsAreSameEntry(firstRef, secondRef) {
    const firstHandle = persistentFileHandleFromRef(firstRef);
    const secondHandle = persistentFileHandleFromRef(secondRef);
    if (!firstHandle || !secondHandle) return null;
    if (firstHandle === secondHandle) return true;

    for (const handle of [firstHandle, secondHandle]) {
      const otherHandle = handle === firstHandle ? secondHandle : firstHandle;
      if (typeof handle?.isSameEntry !== 'function') continue;
      try {
        return !!(await waitForFileOperation(
          () => handle.isSameEntry(otherHandle),
          'comparing board files',
          FILE_COMPARISON_TIMEOUT_MS,
        ));
      } catch (err) {
        // An unavailable comparison is not evidence that the files differ.
        if (err?.name === 'TimeoutError') return null;
      }
    }
    return null;
  }

  function isRecoverableImageSourceError(err) {
    if (!err || err.boardfishSaveTargetUncertain || err.boardfishLimit) return false;
    const name = String(err.name || '');
    if (/^(AbortError|NotAllowedError|SecurityError|QuotaExceededError|TimeoutError)$/i.test(name)) {
      return false;
    }
    if (/^NotReadableError$/i.test(name)) return true;
    const message = String(err.message || err);
    return /^TypeError$/i.test(name) && /failed to fetch|blob|read(?:ing)? (?:the )?file/i.test(message);
  }

  async function recoverBoardImageSources(sourceRef, board, rawImageStore) {
    const sourceHandle = persistentFileHandleFromRef(sourceRef);
    const recover = root.BoardfishWebBoardContainer?.recoverMatchingVolatileImageRefsFromContainer;
    if (!sourceHandle || typeof sourceHandle.getFile !== 'function' || typeof recover !== 'function') {
      return null;
    }
    const freshFile = await waitForFileOperation(
      () => sourceHandle.getFile(),
      'refreshing board image sources',
    );
    return recover(board, rawImageStore, freshFile);
  }

  function fileOperationTimeoutError(stage) {
    const err = new Error(`board save timed out while ${stage}`);
    err.name = 'TimeoutError';
    err.boardfishSaveTargetUncertain = true;
    return err;
  }

  function markSaveTargetUncertain(err) {
    if (err && (typeof err === 'object' || typeof err === 'function')) {
      try {
        err.boardfishSaveTargetUncertain = true;
        if (err.boardfishSaveTargetUncertain === true) return err;
      } catch (_) {
        // Some browser-provided errors are non-extensible; wrap them below.
      }
    }
    const wrapped = new Error(err?.message || String(err || 'board save failed'));
    wrapped.name = err?.name || 'Error';
    wrapped.cause = err;
    wrapped.boardfishSaveTargetUncertain = true;
    return wrapped;
  }

  async function waitForFileOperation(run, stage, timeoutMs = FILE_OPERATION_TIMEOUT_MS) {
    let timeoutId = 0;
    const operation = Promise.resolve(run());
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(fileOperationTimeoutError(stage)), timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function fileWriteTimeoutMs(blob) {
    const bytes = Math.max(0, Number(blob?.size) || 0);
    const transferMs = bytes / FILE_WRITE_MIN_BYTES_PER_SECOND * 1000;
    return Math.min(FILE_OPERATION_MAX_TIMEOUT_MS, FILE_OPERATION_TIMEOUT_MS + transferMs);
  }

  function pickFileWithInput(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      let settled = false;
      let focusHandler = null;
      let focusCancelTimer = 0;
      const removeFocusFallback = () => {
        if (focusHandler) {
          root.removeEventListener('focus', focusHandler);
          focusHandler = null;
        }
        if (focusCancelTimer) {
          clearTimeout(focusCancelTimer);
          focusCancelTimer = 0;
        }
      };
      const done = (value) => {
        if (settled) return;
        settled = true;
        removeFocusFallback();
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', () => {
        const file = input.files?.[0] || null;
        done(file ? webFileRef(file) : null);
      });
      setTimeout(() => {
        if (settled) return;
        focusHandler = () => {
          focusHandler = null;
          focusCancelTimer = setTimeout(() => {
            focusCancelTimer = 0;
            if (!input.files?.length) done(null);
          }, 500);
        };
        root.addEventListener('focus', focusHandler, { once: true });
      }, 0);
      document.body.appendChild(input);
      input.click();
    });
  }

  async function openFileDialog() {
    if (typeof root.showOpenFilePicker === 'function') {
      try {
        const handles = await root.showOpenFilePicker({
          multiple: false,
          types: BOARD_FILE_TYPES,
          excludeAcceptAllOption: false,
        });
        return handles?.[0] ? webFileHandleRef(handles[0]) : null;
      } catch (err) {
        if (isAbortError(err)) return null;
        throw err;
      }
    }
    return pickFileWithInput('.bf');
  }

  async function saveFileDialog(defaultName = 'board.bf') {
    if (typeof root.showSaveFilePicker === 'function') {
      try {
        const handle = await root.showSaveFilePicker({
          suggestedName: defaultName || 'board.bf',
          types: BOARD_FILE_TYPES,
          excludeAcceptAllOption: false,
        });
        return handle ? webSaveHandleRef(handle) : null;
      } catch (err) {
        if (isAbortError(err)) return null;
        throw err;
      }
    }
    return webDownloadRef(defaultName || 'board.bf');
  }

  async function fileFromRef(ref) {
    if (ref?.kind === 'web-file') return ref.file;
    if (ref?.kind === 'web-file-handle' || ref?.kind === 'web-save-handle') return ref.handle.getFile();
    if (ref instanceof File) return ref;
    throw new Error('unsupported web file reference');
  }

  async function readBoard(ref) {
    const file = await fileFromRef(ref);
    if (!file) throw new Error('no Boardfish file selected');
    if (root.BoardfishWebLimits?.LIMITS && file.size > root.BoardfishWebLimits.LIMITS.maxBoardContentBytes + 10 * 1024 * 1024) {
      throw root.BoardfishWebLimits.limitError(
        `This file is too large for Boardfish (${Math.round(file.size / 1024 / 1024 * 10) / 10} MB).`,
        root.BoardfishWebLimits.boardContentLimitMessage()
      );
    }
    return root.BoardfishWebBoardContainer.readBoardContainer(file, {
      lazyImageRefs: true,
      verifyImageCrc: false,
      maxBoardContentBytes: root.BoardfishWebLimits?.LIMITS?.maxBoardContentBytes,
      validateBoardPayload: root.BoardfishWebLimits?.validateBoardPayload,
    });
  }

  async function ensureReadWritePermission(handle) {
    if (!handle?.queryPermission || !handle?.requestPermission) return true;
    const options = { mode: 'readwrite' };
    const permission = await waitForFileOperation(
      () => handle.queryPermission(options),
      'checking file permission',
    );
    if (permission === 'granted') return true;
    return (await waitForFileOperation(
      () => handle.requestPermission(options),
      'requesting file permission',
    )) === 'granted';
  }

  async function writeBlobToHandle(handle, blob) {
    if (!(await ensureReadWritePermission(handle))) {
      throw new Error('write permission was not granted');
    }
    const timeoutMs = fileWriteTimeoutMs(blob);
    const writable = await waitForFileOperation(
      () => handle.createWritable(),
      'opening the board file',
    );
    let stage = 'writing the board file';
    try {
      await waitForFileOperation(() => writable.write(blob), stage, timeoutMs);
      stage = 'finishing the board file';
      await waitForFileOperation(() => writable.close(), stage, timeoutMs);
    } catch (err) {
      let failure = err;
      if (stage === 'finishing the board file') failure = markSaveTargetUncertain(failure);
      if (typeof writable.abort === 'function') {
        try {
          await waitForFileOperation(
            () => writable.abort(failure),
            'aborting the board save',
            FILE_ABORT_TIMEOUT_MS,
          );
        } catch (_) {
          failure = markSaveTargetUncertain(failure);
        }
      }
      throw failure;
    }
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name || 'board.bf';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function saveBoard(ref, board, options = {}) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
    const totalStart = collectDiagnostics ? performance.now() : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const rawImageStore = options.imageStore || root.imageStore || {};
    const validateBoardPayload = root.BoardfishWebLimits?.validateBoardPayload;
    const writesExistingHandle = ref?.kind === 'web-file-handle' || ref?.kind === 'web-save-handle';
    const sourceTargetSameEntry = writesExistingHandle && Object.prototype.hasOwnProperty.call(options, 'sourceFileRef')
      ? await fileRefsAreSameEntry(ref, options.sourceFileRef)
      : null;
    const stabilizeImageSources = root.BoardfishWebBoardContainer.stabilizeVolatileImageRefs;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let imageSourceRefreshMs = 0;
    let imageSourceRefreshCount = 0;
    let imageSourceRefreshBytes = 0;
    let imageSourceRefreshSkipped = '';
    let imageSourceRefreshBacking = '';
    let imageSourceRefreshError = '';
    let serializeMs = 0;
    let writeMs = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const preparePayload = async () => {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const stabilizeStart = collectDiagnostics ? performance.now() : 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (writesExistingHandle && sourceTargetSameEntry !== false && typeof stabilizeImageSources === 'function') {
        const stabilized = await stabilizeImageSources(board, rawImageStore);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectDiagnostics) {
          imageSourceRefreshMs += performance.now() - stabilizeStart;
          imageSourceRefreshCount += Number(stabilized?.refreshed || 0);
          imageSourceRefreshBytes += Number(stabilized?.bytes || 0);
          imageSourceRefreshSkipped = stabilized?.skipped || '';
          if (imageSourceRefreshBacking === 'fresh-file-retry') {
            imageSourceRefreshBacking = 'fresh-file-retry+detached-memory';
          } else {
            imageSourceRefreshBacking = imageSourceRefreshCount ? 'detached-memory' : 'already-stable';
          }
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } else if (writesExistingHandle && sourceTargetSameEntry === false) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectDiagnostics) imageSourceRefreshSkipped = 'distinct-target';
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const createStart = collectDiagnostics ? performance.now() : 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const created = await root.BoardfishWebBoardContainer.createBoardContainerBlob(
        board,
        rawImageStore,
        {
          materializeBytes: false,
          validateBoardPayload,
        },
      );
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) serializeMs += performance.now() - createStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return created;
    };

    const writePayload = async (payload) => {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const writeStart = collectDiagnostics ? performance.now() : 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      if (writesExistingHandle) {
        try {
          await writeBlobToHandle(ref.handle, payload.blob);
        } catch (err) {
          if (err?.boardfishSaveTargetUncertain) ref.unusable = true;
          throw err;
        }
      } else {
        downloadBlob(payload.blob, fileNameFromRef(ref, 'board.bf'));
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) writeMs += performance.now() - writeStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    };

    let payload;
    try {
      payload = await preparePayload();
      await writePayload(payload);
    } catch (err) {
      if (!isRecoverableImageSourceError(err)) throw err;
      const recovered = await recoverBoardImageSources(
        options.sourceFileRef,
        board,
        rawImageStore,
      );
      if (recovered !== true && Number(recovered?.refreshed || 0) <= 0) throw err;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) {
        imageSourceRefreshCount += Number(recovered?.refreshed || 0);
        imageSourceRefreshBytes += Number(recovered?.bytes || 0);
        imageSourceRefreshBacking = 'fresh-file-retry';
        imageSourceRefreshError = String(err);
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      payload = await preparePayload();
      await writePayload(payload);
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectDiagnostics) return {
      format: 'container-web',
      json_bytes: payload.boardJsonBytes,
      image_bytes: payload.imageBytes,
      image_count: payload.imageCount,
      serialize_ms: serializeMs,
      json_stringify_ms: payload.jsonStringifyMs,
      json_encode_ms: payload.jsonEncodeMs,
      source_lookup_ms: payload.imageEntriesMs,
      validate_ms: payload.validationMs,
      write_ms: writeMs,
      zip_ms: payload.zipMs,
      crc_ms: payload.crcMs,
      crc_computed_bytes: payload.crcComputedBytes,
      crc_computed_entries: payload.crcComputedEntries,
      crc_reused_entries: payload.crcReusedEntries,
      blob_image_bytes: payload.blobImageBytes,
      byte_array_image_bytes: payload.byteArrayImageBytes,
      image_source_refresh_ms: imageSourceRefreshMs,
      image_source_refresh_count: imageSourceRefreshCount,
      image_source_refresh_bytes: imageSourceRefreshBytes,
      image_source_refresh_skipped: imageSourceRefreshSkipped,
      image_source_refresh_backing: imageSourceRefreshBacking,
      image_source_refresh_error: imageSourceRefreshError,
      zip_mode: payload.zipMode,
      zip_bytes: payload.zipBytes,
      total_ms: performance.now() - totalStart,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  }

  const api = Object.freeze({
    canSaveToExistingTarget,
    describeFileRef,
    fileNameFromRef,
    fileRefFromFile: webFileRef,
    openFileDialog,
    readBoard,
    saveBoard,
    saveFileDialog,
  });

  root.BoardfishRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis);
