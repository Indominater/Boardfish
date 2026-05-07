'use strict';

(function initTauriBridge(root) {
  var TAURI_COMMANDS = Object.freeze({
    ACKNOWLEDGE_CLOSE_REQUEST: 'acknowledge_close_request',
    CANCEL_PENDING_TERMINATION: 'cancel_pending_termination',
    CLEAR_IMAGE_SOURCE_CACHE: 'clear_image_source_cache',
    CLIPBOARD_SEQUENCE: 'clipboard_sequence',
    COPY_IMAGE_DATA_URL_TO_CLIPBOARD_TRANSFORMED: 'copy_image_data_url_to_clipboard_transformed',
    COPY_TEXT_TO_CLIPBOARD: 'copy_text_to_clipboard',
    EXIT_APP: 'exit_app',
    GET_CACHED_IMAGE_DATA_URL: 'get_cached_image_data_url',
    PREWARM_CACHED_IMAGE_PIXELS: 'prewarm_cached_image_pixels',
    SAMPLE_CACHED_IMAGE_PIXEL: 'sample_cached_image_pixel',
    GET_STARTUP_FILE: 'get_startup_file',
    MATERIALIZE_CACHED_IMAGE_SOURCES: 'materialize_cached_image_sources',
    OPEN_FILE_DIALOG: 'open_file_dialog',
    PICK_FOLDER: 'pick_folder',
    PICK_IMAGE_FILES: 'pick_image_files',
    READ_BOARD: 'read_board',
    READ_IMAGE_FROM_CLIPBOARD_CACHED: 'read_image_from_clipboard_cached',
    READ_TEXT_FROM_CLIPBOARD: 'read_text_from_clipboard',
    REGISTER_IMAGE_FILE_SOURCE: 'register_image_file_source',
    REGISTER_IMAGE_SOURCE: 'register_image_source',
    REGISTER_TRANSFORMED_IMAGE_SOURCE: 'register_transformed_image_source',
    REMOVE_CACHED_IMAGE_SOURCES: 'remove_cached_image_sources',
    SAVE_BOARD: 'save_board',
    SAVE_FILE_DIALOG: 'save_file_dialog',
    SAVE_IMAGE_FILE_DIALOG: 'save_image_file_dialog',
    SAVE_IMAGES_TO_EXISTING_FOLDER_BY_KEYS: 'save_images_to_existing_folder_by_keys',
    SAVE_TEXT_FILE_DIALOG: 'save_text_file_dialog',
    SET_APP_THEME: 'set_app_theme',
    SET_TITLE: 'set_title',
    SHOW_APP_WINDOW: 'show_app_window',
    WRITE_IMAGE_FILE_BY_KEY: 'write_image_file_by_key',
    WRITE_DEBUG_LOG_FILE: 'write_debug_log_file',
    WRITE_TEXT_FILE: 'write_text_file',
  });

  function hasTauri() {
    return !!root.__TAURI__;
  }

  function resolveTauriCommand(command) {
    return TAURI_COMMANDS[command] || command;
  }

  function tauriInvoke(command, args = {}) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    return root.__TAURI__.core.invoke(resolveTauriCommand(command), args);
  }

  function tauriListen(eventName, handler) {
    if (!hasTauri()) throw new Error('Tauri is unavailable');
    return root.__TAURI__.event.listen(eventName, handler);
  }

  function tauriConvertFileSrc(path) {
    if (root.__TAURI__?.core?.convertFileSrc) return root.__TAURI__.core.convertFileSrc(path);
    if (root.__TAURI_INTERNALS__?.convertFileSrc) return root.__TAURI_INTERNALS__.convertFileSrc(path, 'asset');
    return path;
  }

  var BoardfishTauri = Object.freeze({
    acknowledgeCloseRequest(seq) {
      return tauriInvoke(TAURI_COMMANDS.ACKNOWLEDGE_CLOSE_REQUEST, { seq });
    },
    cancelPendingTermination() {
      return tauriInvoke(TAURI_COMMANDS.CANCEL_PENDING_TERMINATION);
    },
    clearImageSourceCache() {
      return tauriInvoke(TAURI_COMMANDS.CLEAR_IMAGE_SOURCE_CACHE);
    },
    exitApp() {
      return tauriInvoke(TAURI_COMMANDS.EXIT_APP);
    },
    getStartupFile() {
      return tauriInvoke(TAURI_COMMANDS.GET_STARTUP_FILE);
    },
    getCachedImageDataUrl(imgKey) {
      return tauriInvoke(TAURI_COMMANDS.GET_CACHED_IMAGE_DATA_URL, { imgKey });
    },
    prewarmCachedImagePixels(imgKey) {
      return tauriInvoke(TAURI_COMMANDS.PREWARM_CACHED_IMAGE_PIXELS, { imgKey });
    },
    sampleCachedImagePixel(imgKey, sourceX, sourceY) {
      return tauriInvoke(TAURI_COMMANDS.SAMPLE_CACHED_IMAGE_PIXEL, { imgKey, sourceX, sourceY });
    },
    materializeCachedImageSources(imgKeys) {
      return tauriInvoke(TAURI_COMMANDS.MATERIALIZE_CACHED_IMAGE_SOURCES, { imgKeys });
    },
    openFileDialog() {
      return tauriInvoke(TAURI_COMMANDS.OPEN_FILE_DIALOG);
    },
    pickImageFiles() {
      return tauriInvoke(TAURI_COMMANDS.PICK_IMAGE_FILES);
    },
    pickFolder() {
      return tauriInvoke(TAURI_COMMANDS.PICK_FOLDER);
    },
    removeCachedImageSources(imgKeys) {
      return tauriInvoke(TAURI_COMMANDS.REMOVE_CACHED_IMAGE_SOURCES, { imgKeys });
    },
    readBoard(path) {
      return tauriInvoke(TAURI_COMMANDS.READ_BOARD, { path });
    },
    readImageFromClipboardCached(imgKey) {
      return tauriInvoke(TAURI_COMMANDS.READ_IMAGE_FROM_CLIPBOARD_CACHED, { imgKey });
    },
    readTextFromClipboard() {
      return tauriInvoke(TAURI_COMMANDS.READ_TEXT_FROM_CLIPBOARD);
    },
    registerImageFileSource(imgKey, path) {
      return tauriInvoke(TAURI_COMMANDS.REGISTER_IMAGE_FILE_SOURCE, { imgKey, path });
    },
    registerImageSource(imgKey, dataUrl) {
      return tauriInvoke(TAURI_COMMANDS.REGISTER_IMAGE_SOURCE, { imgKey, dataUrl });
    },
    registerTransformedImageSource({ imgKey, tempKey, flipX, flipY, rotation }) {
      return tauriInvoke(TAURI_COMMANDS.REGISTER_TRANSFORMED_IMAGE_SOURCE, { imgKey, tempKey, flipX, flipY, rotation });
    },
    saveBoard(path, board) {
      return tauriInvoke(TAURI_COMMANDS.SAVE_BOARD, { path, board });
    },
    saveFileDialog(defaultName) {
      return tauriInvoke(TAURI_COMMANDS.SAVE_FILE_DIALOG, { defaultName });
    },
    saveImageFileDialog(defaultName) {
      return tauriInvoke(TAURI_COMMANDS.SAVE_IMAGE_FILE_DIALOG, { defaultName });
    },
    saveImagesToExistingFolderByKeys(folder, imgKeys) {
      return tauriInvoke(TAURI_COMMANDS.SAVE_IMAGES_TO_EXISTING_FOLDER_BY_KEYS, { folder, imgKeys });
    },
    saveTextFileDialog() {
      return tauriInvoke(TAURI_COMMANDS.SAVE_TEXT_FILE_DIALOG);
    },
    setAppTheme(theme) {
      return tauriInvoke(TAURI_COMMANDS.SET_APP_THEME, { theme });
    },
    setTitle(title) {
      return tauriInvoke(TAURI_COMMANDS.SET_TITLE, { title });
    },
    showAppWindow() {
      return tauriInvoke(TAURI_COMMANDS.SHOW_APP_WINDOW);
    },
    writeImageFileByKey(path, imgKey) {
      return tauriInvoke(TAURI_COMMANDS.WRITE_IMAGE_FILE_BY_KEY, { path, imgKey });
    },
    writeDebugLogFile(filename, json) {
      return tauriInvoke(TAURI_COMMANDS.WRITE_DEBUG_LOG_FILE, { filename, json });
    },
    writeTextFile(path, text) {
      return tauriInvoke(TAURI_COMMANDS.WRITE_TEXT_FILE, { path, text });
    },
    copyTextToClipboard(text) {
      return tauriInvoke(TAURI_COMMANDS.COPY_TEXT_TO_CLIPBOARD, { text });
    },
    copyImageDataUrlToClipboardTransformed({ dataUrl, flipX, flipY, rotation }) {
      return tauriInvoke(TAURI_COMMANDS.COPY_IMAGE_DATA_URL_TO_CLIPBOARD_TRANSFORMED, { dataUrl, flipX, flipY, rotation });
    },
    clipboardSequence() {
      return tauriInvoke(TAURI_COMMANDS.CLIPBOARD_SEQUENCE);
    },
  });

  root.TAURI_COMMANDS = TAURI_COMMANDS;
  root.BoardfishTauri = BoardfishTauri;
  root.hasTauri = hasTauri;
  root.resolveTauriCommand = resolveTauriCommand;
  root.tauriInvoke = tauriInvoke;
  root.tauriListen = tauriListen;
  root.tauriConvertFileSrc = tauriConvertFileSrc;
})(typeof window !== 'undefined' ? window : globalThis);
