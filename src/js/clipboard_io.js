'use strict';

(function initClipboardIO(root) {
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  const collectClipboardIoDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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

  function imageClipboardHtml(token, dataUrl = '') {
    const marker = createBoardfishClipboardMarker(token);
    const src = String(dataUrl || '');
    if (!src) return boardfishTokenClipboardHtml(token);
    return `${marker}<img src="${src}" alt="">`;
  }

  async function blobToDataUrl(blob) {
    if (!blob) return '';
    if (typeof FileReader !== 'undefined') {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('failed to read image blob'));
        reader.readAsDataURL(blob);
      });
    }
    if (typeof blob.arrayBuffer !== 'function') return '';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (typeof Buffer !== 'undefined') {
      return `data:${blob.type || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}`;
    }
    if (typeof btoa !== 'function') return '';
    const chunkSize = 0x8000;
    let base64 = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      let binary = '';
      const chunk = bytes.subarray(offset, offset + chunkSize);
      for (const byte of chunk) binary += String.fromCharCode(byte);
      base64 += btoa(binary);
    }
    return `data:${blob.type || 'image/png'};base64,${base64}`;
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

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  function clipboardIoNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function clipboardIoElapsedMs(startedAt) {
    return Math.round((clipboardIoNow() - startedAt) * 100) / 100;
  }

  function textClipboardStats(text) {
    if (!collectClipboardIoDiagnostics || ClipDebug.enabled === false) return {};
    const value = String(text ?? '');
    const lines = value ? value.split('\n') : [];
    let largestLineChars = 0;
    for (const line of lines) largestLineChars = Math.max(largestLineChars, line.length);
    return {
      textLen: value.length,
      textLineCount: lines.length,
      largestLineChars,
      textBytes: root.BoardfishWebLimits.textByteLength(value),
    };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

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

  function readClipboardImageFileFromEvent(clipboardData
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg = null
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    if (!clipboardData) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardIoDiagnostics) ClipDebug.step(dbg, 'event-clipboard:none');
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return null;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardIoDiagnostics) {
      ClipDebug.step(dbg, 'event-clipboard:inspect', describeClipboardData(clipboardData));
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const imageFile = supportedClipboardImageFile(clipboardData.items || [], clipboardData.files || []);
    if (!imageFile) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardIoDiagnostics) ClipDebug.step(dbg, 'event-image:none');
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return null;
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardIoDiagnostics) {
      ClipDebug.step(dbg, 'event-image-blob', {
        type: imageFile.type,
        blobSize: imageFile.size,
        fileName: imageFile.name || '',
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return imageFile;
  }

  function readClipboardTextFromEvent(clipboardData) {
    if (!clipboardData) return '';
    return clipboardData.getData?.('text/plain') || clipboardData.getData?.('text') || '';
  }

  async function copyTextToClipboard(text
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg = null
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    , options = {}
  ) {
    const boardfishToken = options?.boardfishToken || '';
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const meta = options;
    const writeStartedAt = collectClipboardIoDiagnostics ? clipboardIoNow() : 0;
    const stats = collectClipboardIoDiagnostics ? textClipboardStats(text) : null;
    if (collectClipboardIoDiagnostics) {
      ClipDebug.step(dbg, 'web-clipboard-text-write-start', {
        ...meta,
        ...stats,
        richAttempted: !!boardfishToken && supportsRichClipboardWrite(),
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (boardfishToken && supportsRichClipboardWrite()) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const richStartedAt = collectClipboardIoDiagnostics ? clipboardIoNow() : 0;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      try {
        await writeClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([textToClipboardHtml(text, boardfishToken)], { type: 'text/html' }),
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardIoDiagnostics) {
          ClipDebug.step(dbg, 'web-clipboard-rich-text-write-end', {
            ...meta,
            ...stats,
            ms: clipboardIoElapsedMs(richStartedAt),
          });
          ClipDebug.step(dbg, 'web-clipboard-text-write-end', {
            ...meta,
            ...stats,
            boardfishTokenWritten: true,
            ms: clipboardIoElapsedMs(writeStartedAt),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return { boardfishTokenWritten: true };
      } catch (err) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardIoDiagnostics) {
          ClipDebug.step(dbg, 'web-clipboard-rich-text-miss', {
            ...meta,
            ...stats,
            ms: clipboardIoElapsedMs(richStartedAt),
            error: String(err),
          });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const plainStartedAt = collectClipboardIoDiagnostics ? clipboardIoNow() : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    await navigator.clipboard.writeText(text);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardIoDiagnostics) {
      ClipDebug.step(dbg, 'web-clipboard-plain-text-write-end', {
        ...meta,
        ...stats,
        ms: clipboardIoElapsedMs(plainStartedAt),
      });
      ClipDebug.step(dbg, 'web-clipboard-text-write-end', {
        ...meta,
        ...stats,
        boardfishTokenWritten: false,
        ms: clipboardIoElapsedMs(writeStartedAt),
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { boardfishTokenWritten: false };
  }

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  function describeClipboardData(clipboardData) {
    if (!clipboardData) return null;
    const describeFile = (file) => ({
      name: file.name || '',
      type: file.type || '',
      size: file.size ?? '',
    });
    const itemTypes = [];
    const items = [];
    for (const item of clipboardData.items || []) {
      itemTypes.push(item.type || item.kind || '');
      items.push({
        kind: item.kind || '',
        type: item.type || '',
      });
    }
    const fileTypes = [];
    const files = [];
    for (const file of clipboardData.files || []) {
      fileTypes.push(file.type || '');
      files.push(describeFile(file));
    }
    const types = [];
    for (const type of clipboardData.types || []) types.push(type);
    return {
      itemTypes,
      items,
      fileTypes,
      files,
      types,
    };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  async function readClipboardImageBlobFromBrowser(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg = null
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    if (!navigator.clipboard?.read) return null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardIoDiagnostics) ClipDebug.step(dbg, 'browser-clipboard-read:start');
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const items = await navigator.clipboard.read();
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardIoDiagnostics) {
      ClipDebug.step(dbg, 'browser-clipboard-read:ok', { itemCount: items.length });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    for (const item of items) {
      for (const type of item.types) {
        if (type !== 'image/png' && type !== 'image/jpeg') continue;
        const blob = await item.getType(type);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardIoDiagnostics) {
          ClipDebug.step(dbg, 'browser-image-blob', { type, blobSize: blob.size });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return blob;
      }
    }
    return null;
  }

  async function readBoardfishClipboardTokenFromBrowser(
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    dbg = null
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    if (!navigator.clipboard?.read) return { checked: false, token: '' };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardIoDiagnostics) {
      ClipDebug.step(dbg, 'browser-clipboard-token-read:start');
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types?.includes?.('text/html')) continue;
      const blob = await item.getType('text/html');
      const html = await blob.text();
      const token = readBoardfishClipboardTokenFromHtml(html);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardIoDiagnostics) {
        ClipDebug.step(dbg, 'browser-clipboard-token-read:ok', { tokenFound: !!token });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return { checked: true, token };
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectClipboardIoDiagnostics) {
      ClipDebug.step(dbg, 'browser-clipboard-token-read:ok', { tokenFound: false });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return { checked: true, token: '' };
  }

  async function copyBoardfishTokenToClipboard(token
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg = null, meta = null
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    if (!token || !supportsRichClipboardWrite()) return { boardfishTokenWritten: false };
    try {
      await writeClipboardItem({
        'text/plain': new Blob([''], { type: 'text/plain' }),
        'text/html': new Blob([boardfishTokenClipboardHtml(token)], { type: 'text/html' }),
      });
      return { boardfishTokenWritten: true };
    } catch (err) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectClipboardIoDiagnostics) {
        ClipDebug.step(dbg, 'web-clipboard-token-write-miss', { ...meta, error: String(err) });
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return { boardfishTokenWritten: false };
    }
  }

  async function copyImageBlobToClipboard(blob, token = ''
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    , dbg = null
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) {
    if (token && supportsRichClipboardWrite()) {
      const dataUrl = await blobToDataUrl(blob).catch((err) => {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardIoDiagnostics) {
          ClipDebug.step(dbg, 'web-clipboard-image-html-miss', { error: String(err) });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        return '';
      });
      try {
        const parts = { 'image/png': blob };
        if (dataUrl) {
          parts['text/html'] = new Blob([imageClipboardHtml(token, dataUrl)], { type: 'text/html' });
        }
        await writeClipboardItem(parts);
        return { boardfishTokenWritten: !!dataUrl };
      } catch (err) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectClipboardIoDiagnostics) {
          ClipDebug.step(dbg, 'web-clipboard-rich-image-miss', { error: String(err) });
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return { boardfishTokenWritten: false };
  }

  const clipboardIoApi = {
    copyBoardfishTokenToClipboard,
    copyImageBlobToClipboard,
    copyTextToClipboard,
    readBoardfishClipboardTokenFromBrowser,
    readBoardfishClipboardTokenFromEvent,
    readClipboardImageBlobFromBrowser,
    readClipboardImageFileFromEvent,
    readClipboardTextFromEvent,
  };
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  if (collectClipboardIoDiagnostics) clipboardIoApi.describeClipboardData = describeClipboardData;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  root.BoardfishClipboardIO = Object.freeze(clipboardIoApi);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BoardfishClipboardIO;
  }
})(typeof window !== 'undefined' ? window : globalThis);
