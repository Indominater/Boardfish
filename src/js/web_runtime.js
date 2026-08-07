'use strict';

(function initBoardfishRuntime(root) {
  const WEB_COMMANDS = Object.freeze({
    OPEN_FILE_DIALOG: 'web_open_file_dialog',
    READ_BOARD: 'web_read_board',
    SAVE_BOARD: 'web_save_board',
    SAVE_FILE_DIALOG: 'web_save_file_dialog',
  });

  const BOARD_FILE_TYPES = Object.freeze([
    {
      description: 'Boardfish board',
      accept: {
        'application/octet-stream': ['.bf'],
      },
    },
  ]);

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
    return ref.kind === 'web-file-handle' || ref.kind === 'web-save-handle' || ref.kind === 'web-download';
  }

  function hasFileSystemAccess() {
    return typeof root.showOpenFilePicker === 'function' && typeof root.showSaveFilePicker === 'function';
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
          if (focusHandler) {
            root.removeEventListener('focus', focusHandler);
            focusHandler = null;
          }
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
    if (hasFileSystemAccess()) {
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
    if (hasFileSystemAccess()) {
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

  function revokeBoardImageSources(board) {
    const revoke = root.BoardfishWebBoardContainer?.revokeImageSource;
    if (typeof revoke !== 'function') return;
    const store = board?.imageStore || {};
    for (const key in store) {
      if (Object.prototype.hasOwnProperty.call(store, key)) revoke(store[key]);
    }
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
    let result = null;
    try {
      result = await root.BoardfishWebBoardContainer.readBoardContainer(file, {
        lazyImageRefs: true,
        verifyImageCrc: false,
        maxBoardContentBytes: root.BoardfishWebLimits?.LIMITS?.maxBoardContentBytes,
        validateBoardPayload: root.BoardfishWebLimits?.validateBoardPayload,
      });
      await root.BoardfishWebLimits?.validateOpenedImageEntries(result.imageEntries || []);
      const opened = {
        board: result.board,
      };
      if (typeof BOARDFISH_PRODUCTION === 'undefined') opened.debug = result.debug;
      return opened;
    } catch (err) {
      if (result?.board) revokeBoardImageSources(result.board);
      throw err;
    }
  }

  async function ensureReadWritePermission(handle) {
    if (!handle?.queryPermission || !handle?.requestPermission) return true;
    const options = { mode: 'readwrite' };
    if ((await handle.queryPermission(options)) === 'granted') return true;
    return (await handle.requestPermission(options)) === 'granted';
  }

  async function writeBlobToHandle(handle, blob) {
    if (!(await ensureReadWritePermission(handle))) {
      throw new Error('write permission was not granted');
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveBoard(ref, board, options = {}) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
    const totalStart = collectDiagnostics ? performance.now() : 0;
    const createStart = collectDiagnostics ? performance.now() : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const rawImageStore = options.imageStore || root.imageStore || {};
    const validateBoardPayload = root.BoardfishWebLimits?.validateBoardPayload;
    const payload = await root.BoardfishWebBoardContainer.createBoardContainerBlob(
      board,
      rawImageStore,
      {
        materializeBytes: false,
        validateBoardPayload,
      },
    );
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const serializeMs = collectDiagnostics ? performance.now() - createStart : 0;
    let imageSourceRefreshMs = 0;
    let imageSourceRefreshCount = 0;
    let imageSourceRefreshBytes = 0;
    let imageSourceRefreshSkipped = '';
    let imageSourceRefreshBacking = '';
    let imageSourceRefreshError = '';
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const writesExistingHandle = ref?.kind === 'web-file-handle' || ref?.kind === 'web-save-handle';
    const refreshImageSources = root.BoardfishWebBoardContainer.refreshBlobBackedImageRefsFromContainer;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const writeStart = collectDiagnostics ? performance.now() : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (writesExistingHandle) {
      await writeBlobToHandle(ref.handle, payload.blob);
    } else {
      downloadBlob(payload.blob, fileNameFromRef(ref, 'board.bf'));
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const writeMs = collectDiagnostics ? performance.now() - writeStart : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (writesExistingHandle && typeof refreshImageSources === 'function') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const refreshStart = collectDiagnostics ? performance.now() : 0;
      let refresh = null;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      let refreshedFromSavedFile = false;
      if (typeof ref.handle?.getFile === 'function') {
        try {
          const savedFile = await ref.handle.getFile();
          if (savedFile && Number(savedFile.size) === Number(payload.blob.size)) {
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            refresh =
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
            await refreshImageSources(board, rawImageStore, {
              blob: savedFile,
              imageArchiveEntries: payload.imageArchiveEntries,
            });
            refreshedFromSavedFile = true;
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            if (collectDiagnostics) imageSourceRefreshBacking = 'saved-file';
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
          } else {
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            imageSourceRefreshError = String(new Error(
              'saved file size does not match the generated Boardfish container',
            ));
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
          }
        } catch (err) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectDiagnostics) imageSourceRefreshError = String(err);
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        }
      } else {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        imageSourceRefreshError = String(new Error(
          'saved file handle cannot provide the persisted file snapshot',
        ));
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      if (!refreshedFromSavedFile) {
        try {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          refresh =
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          await refreshImageSources(board, rawImageStore, payload);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectDiagnostics) imageSourceRefreshBacking = 'container-snapshot-fallback';
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        } catch (fallbackErr) {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectDiagnostics) {
            imageSourceRefreshError += `; fallback refresh failed: ${String(fallbackErr)}`;
            imageSourceRefreshBacking = 'unrefreshed';
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        }
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) {
        imageSourceRefreshCount = Number(refresh?.refreshed || 0);
        imageSourceRefreshBytes = Number(refresh?.bytes || 0);
        imageSourceRefreshSkipped = refresh?.skipped || '';
        imageSourceRefreshMs += performance.now() - refreshStart;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
    WEB_COMMANDS,
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
