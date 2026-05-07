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

  async function readClipboardBlobAsDataUrlDebug(blob, errorMessage, dbg, meta = {}) {
    const readStart = performance.now();
    ClipDebug.step(dbg, 'clipboard-blob-read:start', {
      ...meta,
      blobSize: blob?.size ?? '',
      blobType: blob?.type || '',
    });
    try {
      const dataUrl = await readClipboardBlobAsDataUrl(blob, errorMessage);
      ClipDebug.step(dbg, 'clipboard-blob-read:ok', {
        ...meta,
        blobSize: blob?.size ?? '',
        dataUrl,
        ms: Math.round((performance.now() - readStart) * 100) / 100,
      });
      return dataUrl;
    } catch (err) {
      ClipDebug.step(dbg, 'clipboard-blob-read:error', {
        ...meta,
        blobSize: blob?.size ?? '',
        ms: Math.round((performance.now() - readStart) * 100) / 100,
        error: String(err),
      });
      throw err;
    }
  }

  function supportedClipboardImageFile(items = [], files = []) {
    const isSupportedImageType = (type) => type === 'image/png' || type === 'image/jpeg';
    const imageItem = [...items].find((item) => item.kind === 'file' && isSupportedImageType(item.type));
    return imageItem?.getAsFile?.() || [...files].find((file) => isSupportedImageType(file.type)) || null;
  }

  function readClipboardImageDataUrlFromEvent(clipboardData, dbg = null) {
    if (!clipboardData) {
      ClipDebug.step(dbg, 'event-clipboard:none');
      return null;
    }
    ClipDebug.step(dbg, 'event-clipboard:inspect', describeClipboardData(clipboardData));
    const imageFile = supportedClipboardImageFile(clipboardData.items || [], clipboardData.files || []);
    if (!imageFile) {
      ClipDebug.step(dbg, 'event-image:none');
      return null;
    }
    ClipDebug.step(dbg, 'event-image-blob', { type: imageFile.type, blobSize: imageFile.size });
    return readClipboardBlobAsDataUrlDebug(imageFile, 'failed to read clipboard image', dbg, { source: 'paste-event' });
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
    const describeFile = (file) => ({
      name: file.name || '',
      type: file.type || '',
      size: file.size ?? '',
    });
    return {
      itemTypes: [...(clipboardData.items || [])].map((item) => item.type || item.kind || ''),
      items: [...(clipboardData.items || [])].map((item) => ({
        kind: item.kind || '',
        type: item.type || '',
      })),
      fileTypes: [...(clipboardData.files || [])].map((file) => file.type || ''),
      files: [...(clipboardData.files || [])].map(describeFile),
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
        return readClipboardBlobAsDataUrlDebug(blob, 'failed to read browser clipboard image', dbg, { source: 'browser-clipboard' });
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
