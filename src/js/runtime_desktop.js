'use strict';

(function initDesktopRuntime(root) {
  const WEB_COMMANDS = Object.freeze({
    OPEN_FILE_DIALOG: 'web_open_file_dialog',
    READ_BOARD: 'web_read_board',
    SAVE_BOARD: 'web_save_board',
    SAVE_FILE_DIALOG: 'web_save_file_dialog',
  });

  function describeFileRef(ref) {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    return ref.name || ref.handle?.name || ref.file?.name || '';
  }

  function fileNameFromRef(ref, fallback = 'board.bf') {
    const value = describeFileRef(ref) || fallback;
    return String(value).split(/[\\/]/).pop() || fallback;
  }

  const api = Object.freeze({
    WEB_COMMANDS,
    canSaveToExistingTarget: (ref) => typeof ref === 'string',
    describeFileRef,
    fileNameFromRef,
    fileRefFromFile: (file) => file,
    isDesktop: () => true,
    isWeb: () => false,
    openFileDialog: () => root.BoardfishTauri.openFileDialog(),
    readBoard: (path) => root.BoardfishTauri.readBoard(path),
    saveBoard: (path, board) => root.BoardfishTauri.saveBoard(path, board),
    saveFileDialog: (defaultName) => root.BoardfishTauri.saveFileDialog(defaultName),
  });

  root.BoardfishRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis);
