'use strict';

(function initClipboardIO(root) {
  function readClipboardBlobAsDataUrl(blob, errorMessage) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.onerror = () => reject(reader.error || new Error(errorMessage));
      reader.readAsDataURL(blob);
    });
  }

  function supportedClipboardImageFile(items = [], files = []) {
    const isSupportedImageType = (type) => type === 'image/png' || type === 'image/jpeg';
    const imageItem = [...items].find((item) => item.kind === 'file' && isSupportedImageType(item.type));
    return imageItem?.getAsFile?.() || [...files].find((file) => isSupportedImageType(file.type)) || null;
  }

  function readClipboardImageDataUrlFromEvent(clipboardData, dbg = null) {
    if (!clipboardData) return null;
    const imageFile = supportedClipboardImageFile(clipboardData.items || [], clipboardData.files || []);
    if (!imageFile) return null;
    ClipDebug.step(dbg, 'event-image-blob', { type: imageFile.type, blobSize: imageFile.size });
    return readClipboardBlobAsDataUrl(imageFile, 'failed to read clipboard image');
  }

  function readClipboardTextFromEvent(clipboardData) {
    if (!clipboardData) return '';
    return clipboardData.getData?.('text/plain') || clipboardData.getData?.('text') || '';
  }

  async function copyTextToClipboard(text, dbg = null, meta = {}) {
    if (hasTauri()) {
      await ClipDebug.wrap(
        dbg,
        TAURI_COMMANDS.COPY_TEXT_TO_CLIPBOARD,
        () => BoardfishTauri.copyTextToClipboard(text),
        { textLen: text.length, ...meta }
      );
      return;
    }
    await navigator.clipboard.writeText(text);
  }

  function describeClipboardData(clipboardData) {
    if (!clipboardData) return null;
    return {
      itemTypes: [...(clipboardData.items || [])].map((item) => item.type || item.kind || ''),
      fileTypes: [...(clipboardData.files || [])].map((file) => file.type || ''),
      types: [...(clipboardData.types || [])],
    };
  }

  async function readClipboardImageDataUrlFromBrowser(dbg = null) {
    if (!navigator.clipboard?.read) return null;
    ClipDebug.step(dbg, 'browser-clipboard-read:start');
    const items = await navigator.clipboard.read();
    ClipDebug.step(dbg, 'browser-clipboard-read:ok', { itemCount: items.length });
    for (const item of items) {
      for (const type of item.types) {
        if (type !== 'image/png' && type !== 'image/jpeg') continue;
        const blob = await item.getType(type);
        ClipDebug.step(dbg, 'browser-image-blob', { type, blobSize: blob.size });
        return readClipboardBlobAsDataUrl(blob, 'failed to read browser clipboard image');
      }
    }
    return null;
  }

  root.BoardfishClipboardIO = Object.freeze({
    copyTextToClipboard,
    describeClipboardData,
    readClipboardImageDataUrlFromBrowser,
    readClipboardImageDataUrlFromEvent,
    readClipboardTextFromEvent,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BoardfishClipboardIO;
  }
})(typeof window !== 'undefined' ? window : globalThis);
