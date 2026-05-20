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

  function isDesktop() {
    return false;
  }

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
      const done = (value) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', () => {
        const file = input.files?.[0] || null;
        done(file ? webFileRef(file) : null);
      });
      setTimeout(() => {
        root.addEventListener('focus', () => {
          setTimeout(() => {
            if (!input.files?.length) done(null);
          }, 500);
        }, { once: true });
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

  async function readBoard(ref) {
    const file = await fileFromRef(ref);
    if (!file) throw new Error('no Boardfish file selected');
    if (root.BoardfishWebLimits?.LIMITS && file.size > root.BoardfishWebLimits.LIMITS.maxBoardContentBytes + 10 * 1024 * 1024) {
      throw root.BoardfishWebLimits.limitError(
        `This file is too large for Boardfish (${Math.round(file.size / 1024 / 1024 * 10) / 10} MB).`,
        root.BoardfishWebLimits.boardContentLimitMessage()
      );
    }
    const result = await root.BoardfishWebBoardContainer.readBoardContainer(file, {
      maxBoardContentBytes: root.BoardfishWebLimits?.LIMITS?.maxBoardContentBytes,
      validateBoardPayload(payload) {
        return root.BoardfishWebLimits?.validateBoardPayload(payload);
      },
    });
    root.BoardfishWebLimits?.validateBoardPayload({
      objectCount: result.board?.objects?.length || 0,
      boardJsonBytes: result.debug?.board_json_bytes || 0,
      imageBytes: result.debug?.image_bytes,
      imageEntries: result.imageEntries || [],
    });
    await root.BoardfishWebLimits?.validateOpenedImageEntries(result.imageEntries || []);
    return {
      board: result.board,
      debug: result.debug,
    };
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
    const totalStart = performance.now();
    const createStart = performance.now();
    const payload = await root.BoardfishWebBoardContainer.createBoardContainerBlob(
      board,
      options.imageStore || root.imageStore || {},
      { materializeBytes: false },
    );
    root.BoardfishWebLimits?.validateBoardPayload({
      objectCount: board?.objects?.length || 0,
      boardJsonBytes: payload.boardJsonBytes,
      imageBytes: payload.imageBytes,
      imageEntries: payload.imageEntries,
    });
    const serializeMs = performance.now() - createStart;
    const writeStart = performance.now();
    if (ref?.kind === 'web-file-handle' || ref?.kind === 'web-save-handle') {
      await writeBlobToHandle(ref.handle, payload.blob);
    } else {
      downloadBlob(payload.blob, fileNameFromRef(ref, 'board.bf'));
    }
    return {
      format: 'container-web',
      json_bytes: payload.boardJsonBytes,
      image_bytes: payload.imageBytes,
      image_count: payload.imageCount,
      serialize_ms: serializeMs,
      write_ms: performance.now() - writeStart,
      zip_ms: serializeMs,
      zip_mode: payload.zipMode,
      zip_bytes: payload.zipBytes,
      total_ms: performance.now() - totalStart,
    };
  }

  const api = Object.freeze({
    WEB_COMMANDS,
    canSaveToExistingTarget,
    describeFileRef,
    fileNameFromRef,
    fileRefFromFile: webFileRef,
    isDesktop,
    isWeb: () => true,
    openFileDialog,
    readBoard,
    saveBoard,
    saveFileDialog,
  });

  root.BoardfishRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis);
