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

  function clipboardIoNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function clipboardIoElapsedMs(startedAt) {
    return Math.round((clipboardIoNow() - startedAt) * 100) / 100;
  }

  function clipDebugStep(dbg, step, meta = {}) {
    if (typeof ClipDebug !== 'undefined') ClipDebug.step(dbg, step, meta);
  }

  function textClipboardStats(text) {
    const value = String(text ?? '');
    const lines = value ? value.split('\n') : [];
    let largestLineChars = 0;
    for (const line of lines) largestLineChars = Math.max(largestLineChars, line.length);
    const textBytes = typeof TextEncoder === 'function'
      ? new TextEncoder().encode(value).length
      : value.length;
    return {
      textLen: value.length,
      textLineCount: lines.length,
      largestLineChars,
      textBytes,
    };
  }

  function supportedClipboardImageFile(items = [], files = []) {
    const isSupportedImageType = (type) => type === 'image/png' || type === 'image/jpeg';
    for (const item of items) {
      if (item.kind === 'file' && isSupportedImageType(item.type)) {
        const file = item.getAsFile?.();
        if (file) return file;
        break;
      }
    }
    for (const file of files) {
      if (isSupportedImageType(file.type)) return file;
    }
    return null;
  }

  function readClipboardImageFileFromClipboardData(clipboardData, dbg = null, describeBlob = null) {
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
    ClipDebug.step(dbg, 'event-image-blob', describeBlob ? describeBlob(imageFile) : { type: imageFile.type, blobSize: imageFile.size });
    return imageFile;
  }

  function readClipboardImageFileFromEvent(clipboardData, dbg = null) {
    const imageFile = readClipboardImageFileFromClipboardData(clipboardData, dbg, (file) => ({
      type: file.type,
      blobSize: file.size,
      fileName: file.name || '',
    }));
    return imageFile;
  }

  function readClipboardTextFromEvent(clipboardData) {
    if (!clipboardData) return '';
    return clipboardData.getData?.('text/plain') || clipboardData.getData?.('text') || '';
  }

  async function copyTextToClipboard(text, dbg = null, meta = {}) {
    const writeStartedAt = clipboardIoNow();
    clipDebugStep(dbg, 'web-clipboard-text-write-start', {
      ...meta,
      ...textClipboardStats(text),
      richAttempted: !!meta.boardfishToken && supportsRichClipboardWrite(),
    });
    if (meta.boardfishToken && supportsRichClipboardWrite()) {
      const richStartedAt = clipboardIoNow();
      try {
        await writeClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([textToClipboardHtml(text, meta.boardfishToken)], { type: 'text/html' }),
        });
        clipDebugStep(dbg, 'web-clipboard-rich-text-write-end', {
          ...meta,
          ...textClipboardStats(text),
          ms: clipboardIoElapsedMs(richStartedAt),
        });
        clipDebugStep(dbg, 'web-clipboard-text-write-end', {
          ...meta,
          ...textClipboardStats(text),
          boardfishTokenWritten: true,
          ms: clipboardIoElapsedMs(writeStartedAt),
        });
        return { boardfishTokenWritten: true };
      } catch (err) {
        clipDebugStep(dbg, 'web-clipboard-rich-text-miss', {
          ...meta,
          ...textClipboardStats(text),
          ms: clipboardIoElapsedMs(richStartedAt),
          error: String(err),
        });
      }
    }
    const plainStartedAt = clipboardIoNow();
    await navigator.clipboard.writeText(text);
    clipDebugStep(dbg, 'web-clipboard-plain-text-write-end', {
      ...meta,
      ...textClipboardStats(text),
      ms: clipboardIoElapsedMs(plainStartedAt),
    });
    clipDebugStep(dbg, 'web-clipboard-text-write-end', {
      ...meta,
      ...textClipboardStats(text),
      boardfishTokenWritten: false,
      ms: clipboardIoElapsedMs(writeStartedAt),
    });
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

  async function readClipboardImageBlobFromBrowserClipboard(dbg = null) {
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

  async function readClipboardImageBlobFromBrowser(dbg = null) {
    return readClipboardImageBlobFromBrowserClipboard(dbg);
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
    readClipboardImageFileFromEvent,
    readClipboardTextFromEvent,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BoardfishClipboardIO;
  }
})(typeof window !== 'undefined' ? window : globalThis);
