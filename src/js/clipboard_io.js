'use strict';

(function initClipboardIO(root) {
  const BOARDFISH_CLIPBOARD_TOKEN_RE = /<!--\s*boardfish-clipboard:([A-Za-z0-9._:-]+)\s*-->/i;

  function createBoardfishClipboardMarker(token) {
    return token ? `<!--boardfish-clipboard:${token}-->` : '';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function textToClipboardHtml(text, token) {
    const marker = createBoardfishClipboardMarker(token);
    const html = escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
    return `${marker}<div>${html}</div>`;
  }

  function boardfishTokenClipboardHtml(token) {
    return `${createBoardfishClipboardMarker(token)}<span></span>`;
  }

  function readBoardfishClipboardTokenFromHtml(html = '') {
    return BOARDFISH_CLIPBOARD_TOKEN_RE.exec(String(html || ''))?.[1] || '';
  }

  function readBoardfishClipboardTokenFromEvent(clipboardData) {
    if (!clipboardData) return '';
    return readBoardfishClipboardTokenFromHtml(clipboardData.getData?.('text/html') || '');
  }

  function supportsRichClipboardWrite() {
    return !!navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' && typeof Blob !== 'undefined';
  }

  async function writeClipboardItem(parts) {
    await navigator.clipboard.write([new ClipboardItem(parts)]);
  }

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

  function readClipboardImageFileFromEvent(clipboardData, dbg = null) {
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
    ClipDebug.step(dbg, 'event-image-blob', { type: imageFile.type, blobSize: imageFile.size, fileName: imageFile.name || '' });
    return imageFile;
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
    if (meta.boardfishToken && supportsRichClipboardWrite()) {
      try {
        await writeClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([textToClipboardHtml(text, meta.boardfishToken)], { type: 'text/html' }),
        });
        return { boardfishTokenWritten: true };
      } catch (err) {
        ClipDebug.step(dbg, 'web-clipboard-rich-text-miss', { error: String(err) });
      }
    }
    await navigator.clipboard.writeText(text);
    return { boardfishTokenWritten: false };
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

  async function readClipboardImageBlobFromBrowser(dbg = null) {
    if (!navigator.clipboard?.read) return null;
    ClipDebug.step(dbg, 'browser-clipboard-read:start');
    const items = await navigator.clipboard.read();
    ClipDebug.step(dbg, 'browser-clipboard-read:ok', { itemCount: items.length });
    for (const item of items) {
      for (const type of item.types) {
        if (type !== 'image/png' && type !== 'image/jpeg') continue;
        const blob = await item.getType(type);
        ClipDebug.step(dbg, 'browser-image-blob', { type, blobSize: blob.size });
        return blob;
      }
    }
    return null;
  }

  async function readBoardfishClipboardTokenFromBrowser(dbg = null) {
    if (!navigator.clipboard?.read) return { checked: false, token: '' };
    ClipDebug.step(dbg, 'browser-clipboard-token-read:start');
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types?.includes?.('text/html')) continue;
      const blob = await item.getType('text/html');
      const html = await blob.text();
      const token = readBoardfishClipboardTokenFromHtml(html);
      ClipDebug.step(dbg, 'browser-clipboard-token-read:ok', { tokenFound: !!token });
      return { checked: true, token };
    }
    ClipDebug.step(dbg, 'browser-clipboard-token-read:ok', { tokenFound: false });
    return { checked: true, token: '' };
  }

  async function copyBoardfishTokenToClipboard(token, dbg = null, meta = {}) {
    if (!token || !supportsRichClipboardWrite()) return { boardfishTokenWritten: false };
    try {
      await writeClipboardItem({
        'text/plain': new Blob([''], { type: 'text/plain' }),
        'text/html': new Blob([boardfishTokenClipboardHtml(token)], { type: 'text/html' }),
      });
      return { boardfishTokenWritten: true };
    } catch (err) {
      ClipDebug.step(dbg, 'web-clipboard-token-write-miss', { ...meta, error: String(err) });
      return { boardfishTokenWritten: false };
    }
  }

  async function copyImageBlobToClipboard(blob, token = '', dbg = null) {
    if (token && supportsRichClipboardWrite()) {
      try {
        await writeClipboardItem({
          'image/png': blob,
          'text/html': new Blob([boardfishTokenClipboardHtml(token)], { type: 'text/html' }),
        });
        return { boardfishTokenWritten: true };
      } catch (err) {
        ClipDebug.step(dbg, 'web-clipboard-rich-image-miss', { error: String(err) });
      }
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return { boardfishTokenWritten: false };
  }

  root.BoardfishClipboardIO = Object.freeze({
    copyBoardfishTokenToClipboard,
    copyImageBlobToClipboard,
    copyTextToClipboard,
    describeClipboardData,
    readBoardfishClipboardTokenFromBrowser,
    readBoardfishClipboardTokenFromEvent,
    readClipboardImageBlobFromBrowser,
    readClipboardImageDataUrlFromBrowser,
    readClipboardImageDataUrlFromEvent,
    readClipboardImageFileFromEvent,
    readClipboardTextFromEvent,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BoardfishClipboardIO;
  }
})(typeof window !== 'undefined' ? window : globalThis);
