'use strict';

(function initWebBoardContainer(root) {
  const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
  const ZIP_CENTRAL_DIRECTORY = 0x02014b50;
  const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
  const ZIP_METHOD_STORED = 0;
  const ZIP_METHOD_DEFLATED = 8;
  const ZIP_EOCD_MIN_SIZE = 22;
  const ZIP_EOCD_MAX_COMMENT = 0xFFFF;

  let crcTable = null;
  let utf8TextEncoder = null;
  let utf8TextDecoder = null;

  function textEncoder() {
    if (!utf8TextEncoder) utf8TextEncoder = new TextEncoder();
    return utf8TextEncoder;
  }

  function textDecoder() {
    if (!utf8TextDecoder) utf8TextDecoder = new TextDecoder();
    return utf8TextDecoder;
  }

  function utf8Encode(text) {
    return textEncoder().encode(String(text));
  }

  function utf8Decode(bytes) {
    return textDecoder().decode(bytes);
  }

  function u16(value) {
    const out = new Uint8Array(2);
    const view = new DataView(out.buffer);
    view.setUint16(0, value, true);
    return out;
  }

  function u32(value) {
    const out = new Uint8Array(4);
    const view = new DataView(out.buffer);
    view.setUint32(0, value >>> 0, true);
    return out;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  function crc32(bytes) {
    if (!crcTable) crcTable = makeCrcTable();
    let crc = 0xFFFFFFFF;
    crc = crc32Update(crc, bytes, 0, bytes.length);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function crc32Update(crc, bytes, start = 0, end = bytes.length) {
    if (!crcTable) crcTable = makeCrcTable();
    for (let i = start; i < end; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return crc >>> 0;
  }

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function yieldToEventLoop() {
    if (root.scheduler?.yield) return root.scheduler.yield();
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function maybeYield(state) {
    if (!state || state.everyMs <= 0) return;
    const now = nowMs();
    if (now - state.lastYieldAt < state.everyMs) return;
    state.lastYieldAt = now;
    await yieldToEventLoop();
  }

  async function crc32Async(bytes, yieldState = null) {
    if (!crcTable) crcTable = makeCrcTable();
    let crc = 0xFFFFFFFF;
    const chunkSize = 1024 * 1024;
    for (let start = 0; start < bytes.length; start += chunkSize) {
      crc = crc32Update(crc, bytes, start, Math.min(bytes.length, start + chunkSize));
      await maybeYield(yieldState);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);
    return {
      time: (hours << 11) | (minutes << 5) | seconds,
      date: ((year - 1980) << 9) | (month << 5) | day,
    };
  }

  function localFileHeader(entry, offset) {
    const name = utf8Encode(entry.name);
    const { time, date } = dosDateTime(entry.date);
    return {
      offset,
      name,
      bytes: concatBytes([
        u32(ZIP_LOCAL_FILE_HEADER),
        u16(20),
        u16(0x0800),
        u16(ZIP_METHOD_STORED),
        u16(time),
        u16(date),
        u32(entry.crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        name,
      ]),
    };
  }

  function centralDirectoryHeader(entry, local) {
    const { time, date } = dosDateTime(entry.date);
    return concatBytes([
      u32(ZIP_CENTRAL_DIRECTORY),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(ZIP_METHOD_STORED),
      u16(time),
      u16(date),
      u32(entry.crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(local.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(local.offset),
      local.name,
    ]);
  }

  function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
    return concatBytes([
      u32(ZIP_END_OF_CENTRAL_DIRECTORY),
      u16(0),
      u16(0),
      u16(entryCount),
      u16(entryCount),
      u32(centralSize),
      u32(centralOffset),
      u16(0),
    ]);
  }

  function createZip(entries) {
    const normalized = entries.map((entry) => ({
      name: entry.name,
      data: entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []),
      date: entry.date || new Date(),
    }));
    for (const entry of normalized) entry.crc = crc32(entry.data);

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of normalized) {
      const local = localFileHeader(entry, offset);
      localParts.push(local.bytes, entry.data);
      offset += local.bytes.length + entry.data.length;
      centralParts.push(centralDirectoryHeader(entry, local));
    }
    const centralOffset = offset;
    const central = concatBytes(centralParts);
    const eocd = endOfCentralDirectory(normalized.length, central.length, centralOffset);
    return concatBytes([...localParts, central, eocd]);
  }

  async function createZipBlob(entries, options = {}) {
    const normalized = entries.map((entry) => ({
      name: entry.name,
      data: entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []),
      date: entry.date || new Date(),
    }));
    const yieldState = {
      everyMs: Number(options.yieldEveryMs) || 48,
      lastYieldAt: nowMs(),
    };
    for (const entry of normalized) entry.crc = await crc32Async(entry.data, yieldState);

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of normalized) {
      const local = localFileHeader(entry, offset);
      localParts.push(local.bytes, entry.data);
      offset += local.bytes.length + entry.data.length;
      centralParts.push(centralDirectoryHeader(entry, local));
    }
    const centralOffset = offset;
    const central = concatBytes(centralParts);
    const eocd = endOfCentralDirectory(normalized.length, central.length, centralOffset);
    const parts = [...localParts, central, eocd];
    const byteLength = offset + central.length + eocd.length;
    const blob = new Blob(parts, { type: 'application/octet-stream' });
    const keepBytesBelow = Number(options.keepBytesBelow) || 8 * 1024 * 1024;
    const materializeBytes = options.materializeBytes !== false;
    const isSmallPayload = byteLength <= keepBytesBelow;
    const bytes = materializeBytes && isSmallPayload ? new Uint8Array(await blob.arrayBuffer()) : null;
    return {
      blob,
      bytes,
      byteLength,
      mode: isSmallPayload ? 'blob-parts+materialized-small' : 'blob-parts',
    };
  }

  async function blobToBytes(blob) {
    if (blob instanceof Uint8Array) return blob;
    if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
    if (ArrayBuffer.isView(blob)) return new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
    if (blob?.arrayBuffer) return new Uint8Array(await blob.arrayBuffer());
    throw new Error('unsupported binary input');
  }

  function findEndOfCentralDirectory(bytes) {
    const min = Math.max(0, bytes.length - ZIP_EOCD_MIN_SIZE - ZIP_EOCD_MAX_COMMENT);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = bytes.length - ZIP_EOCD_MIN_SIZE; offset >= min; offset--) {
      if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
    }
    throw new Error('unsupported Boardfish file; expected container .bf');
  }

  function parseCentralDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(bytes);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    if (centralOffset + centralSize > bytes.length) throw new Error('invalid Boardfish container directory');

    const entries = new Map();
    let offset = centralOffset;
    for (let i = 0; i < entryCount; i++) {
      if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY) {
        throw new Error('invalid Boardfish container entry');
      }
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameStart = offset + 46;
      const name = utf8Decode(bytes.slice(nameStart, nameStart + nameLength));
      entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
      offset = nameStart + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  function compressedEntryBytes(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(entry.localOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`invalid Boardfish container local entry ${entry.name}`);
    }
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.length) throw new Error(`truncated Boardfish container entry ${entry.name}`);
    return bytes.slice(dataStart, dataEnd);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('this browser cannot read compressed .bf entries');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function assertZipEntryReadBudget(entry, maxBytes, tooLargeError = null) {
    const limit = Number(maxBytes);
    if (!Number.isFinite(limit)) return;
    const advertisedSize = zipEntryContentBytes(entry);
    if (advertisedSize <= limit) return;
    if (typeof tooLargeError === 'function') throw tooLargeError(advertisedSize);
    throw new Error(`Boardfish container entry ${entry?.name || ''} exceeds the board content limit`);
  }

  function zipEntryContentBytes(entry) {
    const uncompressedSize = Number(entry?.uncompressedSize || 0);
    if (entry?.method === ZIP_METHOD_STORED) {
      return Math.max(uncompressedSize, Number(entry?.compressedSize || 0));
    }
    return uncompressedSize;
  }

  async function readZipEntry(bytes, entry, options = {}) {
    assertZipEntryReadBudget(entry, options.maxBytes, options.tooLargeError);
    const compressed = compressedEntryBytes(bytes, entry);
    let out;
    if (entry.method === ZIP_METHOD_STORED) out = compressed;
    else if (entry.method === ZIP_METHOD_DEFLATED) out = await inflateRaw(compressed);
    else throw new Error(`unsupported .bf compression method ${entry.method} for ${entry.name}`);
    const limit = Number(options.maxBytes);
    if (Number.isFinite(limit) && out.length > limit) {
      if (typeof options.tooLargeError === 'function') throw options.tooLargeError(out.length);
      throw new Error(`Boardfish container entry ${entry.name} exceeds the board content limit`);
    }
    return out;
  }

  function base64ToBytes(base64) {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
    throw new Error('base64 decoding is unavailable');
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    if (typeof btoa !== 'function') throw new Error('base64 encoding is unavailable');
    let out = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      let binary = '';
      for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
      out += btoa(binary);
    }
    return out;
  }

  function dataUrlParts(dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!match) throw new Error('expected image data URL');
    return { mime: match[1].toLowerCase(), base64: match[2] };
  }

  function dataUrlToBytes(dataUrl) {
    return base64ToBytes(dataUrlParts(dataUrl).base64);
  }

  function dataUrlByteLength(dataUrl) {
    const base64 = dataUrlParts(dataUrl).base64.replace(/\s/g, '');
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  }

  function bytesToDataUrl(bytes, mime = 'image/png') {
    return `data:${mime || 'image/png'};base64,${bytesToBase64(bytes)}`;
  }

  function extForMime(mime = '') {
    const value = String(mime || '').toLowerCase();
    if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
    if (value === 'image/webp') return 'webp';
    if (value === 'image/gif') return 'gif';
    return 'png';
  }

  function mimeForExt(ext = '') {
    const value = String(ext || '').replace(/^\./, '').toLowerCase();
    if (value === 'jpg' || value === 'jpeg') return 'image/jpeg';
    if (value === 'webp') return 'image/webp';
    if (value === 'gif') return 'image/gif';
    return 'image/png';
  }

  function normalizeImageExt(ext = '', mime = '') {
    const value = String(ext || '').replace(/^\./, '').toLowerCase();
    return value || extForMime(mime);
  }

  function createObjectUrlForBytes(bytes, mime = 'image/png') {
    if (typeof Blob === 'function' && root.URL?.createObjectURL) {
      try {
        return root.URL.createObjectURL(new Blob([bytes], { type: mime || 'image/png' }));
      } catch (_) {
        return '';
      }
    }
    return '';
  }

  function createWebImageRef({ path, mime, ext, bytes }) {
    const normalizedExt = normalizeImageExt(ext, mime);
    const normalizedMime = mime || mimeForExt(normalizedExt);
    const ref = {
      web: true,
      path,
      mime: normalizedMime,
      ext: normalizedExt,
      bytes: bytes?.length || 0,
    };
    const objectUrl = createObjectUrlForBytes(bytes, normalizedMime);
    if (objectUrl) ref.objectUrl = objectUrl;
    else ref.dataUrl = bytesToDataUrl(bytes, normalizedMime);
    Object.defineProperty(ref, '__bytes', {
      value: bytes,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return ref;
  }

  function isWebImageRef(source) {
    return !!(source && typeof source === 'object' && source.web === true && (source.objectUrl || source.dataUrl || source.__bytes));
  }

  function displaySrcForImageSource(source) {
    if (typeof source === 'string') return source;
    if (!isWebImageRef(source)) return '';
    return source.objectUrl || source.dataUrl || (source.__bytes ? bytesToDataUrl(source.__bytes, source.mime) : '');
  }

  function dataUrlForImageSource(source) {
    if (typeof source === 'string') return source;
    if (!isWebImageRef(source)) return '';
    if (source.dataUrl) return source.dataUrl;
    return source.__bytes ? bytesToDataUrl(source.__bytes, source.mime) : '';
  }

  function revokeImageSource(source) {
    if (!isWebImageRef(source) || !source.objectUrl || !root.URL?.revokeObjectURL) return false;
    try {
      root.URL.revokeObjectURL(source.objectUrl);
      return true;
    } catch (_) {
      return false;
    }
  }

  function manifestEntryForKey(board, key) {
    const entry = board?.imageStore?.[key];
    return entry && typeof entry === 'object' ? entry : {};
  }

  function imageEntryPath(key, manifest) {
    if (typeof manifest.path === 'string' && manifest.path) return manifest.path;
    const ext = manifest.ext || (manifest.mime === 'image/jpeg' ? 'jpg' : 'png');
    return `images/${key}.${ext}`;
  }

  function candidateImageEntryPaths(key, manifest = {}) {
    const paths = [
      imageEntryPath(key, manifest),
      `images/${key}.${normalizeImageExt(manifest.ext, manifest.mime)}`,
      `images/${key}.png`,
      `images/${key}.jpg`,
      `images/${key}.jpeg`,
      `images/${key}.webp`,
      `images/${key}.gif`,
    ];
    return [...new Set(paths.filter(Boolean))];
  }

  function mimeForImageSource(source, manifest = {}) {
    if (typeof manifest.mime === 'string' && manifest.mime) return manifest.mime;
    if (isWebImageRef(source) && source.mime) return source.mime;
    if (typeof source === 'string') return dataUrlParts(source).mime;
    return 'image/png';
  }

  function bytesForImageSource(source) {
    if (isWebImageRef(source) && source.__bytes) return source.__bytes;
    if (typeof source === 'string') return dataUrlToBytes(source);
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    throw new Error('web .bf save only supports browser image data URLs');
  }

  function buildImageEntries(board, rawImageStore = {}) {
    const entries = [];
    for (const key of Object.keys(board?.imageStore || {})) {
      const manifest = manifestEntryForKey(board, key);
      const source = rawImageStore[key];
      const bytes = bytesForImageSource(source);
      entries.push({
        key,
        path: imageEntryPath(key, manifest),
        mime: mimeForImageSource(source, manifest),
        ext: manifest.ext || '',
        bytes,
        byteLength: bytes.length,
      });
    }
    return entries;
  }

  async function createBoardContainerBlob(board, rawImageStore = {}, options = {}) {
    const boardJson = JSON.stringify(board);
    const boardBytes = utf8Encode(boardJson);
    const imageEntries = buildImageEntries(board, rawImageStore);
    const imageBytes = imageEntries.reduce((sum, entry) => sum + entry.byteLength, 0);
    const zip = await createZipBlob([
      { name: 'board.json', data: boardBytes },
      ...imageEntries.map((entry) => ({ name: entry.path, data: entry.bytes })),
    ], options);
    return {
      blob: zip.blob,
      bytes: zip.bytes,
      zipBytes: zip.byteLength,
      zipMode: zip.mode,
      boardJsonBytes: boardBytes.length,
      imageBytes,
      imageCount: imageEntries.length,
      imageEntries,
      totalContentBytes: boardBytes.length + imageBytes,
    };
  }

  async function readBoardContainer(input, options = {}) {
    const containerBytes = await blobToBytes(input);
    const entries = parseCentralDirectory(containerBytes);
    const boardEntry = entries.get('board.json');
    if (!boardEntry) throw new Error('Boardfish file is missing board.json');
    const validateBoardPayload = typeof options.validateBoardPayload === 'function'
      ? options.validateBoardPayload
      : null;
    const maxBoardContentBytes = Number(options.maxBoardContentBytes);
    if (validateBoardPayload) {
      validateBoardPayload({
        objectCount: 0,
        boardJsonBytes: zipEntryContentBytes(boardEntry),
        imageBytes: 0,
      });
    }
    const boardJsonBytes = await readZipEntry(containerBytes, boardEntry, {
      maxBytes: Number.isFinite(maxBoardContentBytes) ? maxBoardContentBytes : undefined,
    });
    const board = JSON.parse(utf8Decode(boardJsonBytes));
    const objectCount = board?.objects?.length || 0;
    if (validateBoardPayload) {
      validateBoardPayload({ objectCount, boardJsonBytes: boardJsonBytes.length, imageBytes: 0 });
    }
    const nextSources = {};
    const imageEntries = [];
    let imageBytes = 0;

    for (const [key, manifest] of Object.entries(board.imageStore || {})) {
      const manifestObject = manifest && typeof manifest === 'object' ? manifest : {};
      const candidates = candidateImageEntryPaths(key, manifestObject);
      const path = candidates.find((candidate) => entries.has(candidate)) || candidates[0];
      const imageEntry = entries.get(path);
      if (!imageEntry) throw new Error(`Boardfish file is missing ${path}`);
      const advertisedImageBytes = zipEntryContentBytes(imageEntry);
      if (validateBoardPayload) {
        validateBoardPayload({
          objectCount,
          boardJsonBytes: boardJsonBytes.length,
          imageBytes: imageBytes + advertisedImageBytes,
        });
      }
      const remainingBytes = Number.isFinite(maxBoardContentBytes)
        ? maxBoardContentBytes - boardJsonBytes.length - imageBytes
        : undefined;
      const bytes = await readZipEntry(containerBytes, imageEntry, { maxBytes: remainingBytes });
      imageBytes += bytes.length;
      if (validateBoardPayload) {
        validateBoardPayload({ objectCount, boardJsonBytes: boardJsonBytes.length, imageBytes });
      }
      const manifestExt = manifestObject.ext || '';
      const ext = manifestExt || normalizeImageExt(path.split('.').pop(), manifestObject.mime);
      const mime = manifestObject.mime || mimeForExt(ext);
      nextSources[key] = createWebImageRef({ path, mime, ext, bytes });
      imageEntries.push({
        key,
        path,
        mime,
        ext,
        bytes,
        byteLength: bytes.length,
        compressedSize: imageEntry.compressedSize,
      });
    }

    return {
      board: {
        ...board,
        imageStore: nextSources,
      },
      debug: {
        format: 'container-web',
        file_bytes: containerBytes.length,
        board_json_bytes: boardJsonBytes.length,
        image_count: imageEntries.length,
        image_bytes: imageBytes,
        total_content_bytes: boardJsonBytes.length + imageBytes,
      },
      imageEntries,
    };
  }

  const api = Object.freeze({
    createBoardContainerBlob,
    createWebImageRef,
    createZip,
    createZipBlob,
    crc32,
    dataUrlByteLength,
    dataUrlForImageSource,
    dataUrlToBytes,
    displaySrcForImageSource,
    bytesToDataUrl,
    bytesForImageSource,
    isWebImageRef,
    readBoardContainer,
    revokeImageSource,
  });

  root.BoardfishWebBoardContainer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
