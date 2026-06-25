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

  function unsupportedContainerError() {
    return new Error('unsupported Boardfish file; expected container .bf');
  }

  function invalidContainerError(message = 'invalid Boardfish container') {
    return new Error(message);
  }

  function ensureByteRange(bytes, offset, length, message = 'invalid Boardfish container') {
    const start = Number(offset);
    const size = Number(length);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(size) ||
      start < 0 ||
      size < 0 ||
      start + size > bytes.length
    ) {
      throw invalidContainerError(message);
    }
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
    if (!bytes || bytes.length < ZIP_EOCD_MIN_SIZE) throw unsupportedContainerError();
    const min = Math.max(0, bytes.length - ZIP_EOCD_MIN_SIZE - ZIP_EOCD_MAX_COMMENT);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = bytes.length - ZIP_EOCD_MIN_SIZE; offset >= min; offset--) {
      if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
    }
    throw unsupportedContainerError();
  }

  function parseCentralDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(bytes);
    ensureByteRange(bytes, eocdOffset, ZIP_EOCD_MIN_SIZE, 'invalid Boardfish container directory');
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    if (centralOffset + centralSize > bytes.length) throw invalidContainerError('invalid Boardfish container directory');

    const entries = new Map();
    let offset = centralOffset;
    const centralEnd = centralOffset + centralSize;
    for (let i = 0; i < entryCount; i++) {
      ensureByteRange(bytes, offset, 46, 'invalid Boardfish container entry');
      if (offset + 46 > centralEnd) throw invalidContainerError('invalid Boardfish container entry');
      if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY) {
        throw invalidContainerError('invalid Boardfish container entry');
      }
      const method = view.getUint16(offset + 10, true);
      const crc = view.getUint32(offset + 16, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameStart = offset + 46;
      const nextOffset = nameStart + nameLength + extraLength + commentLength;
      ensureByteRange(bytes, nameStart, nameLength, 'invalid Boardfish container entry name');
      if (nextOffset > centralEnd) throw invalidContainerError('invalid Boardfish container entry');
      const name = utf8Decode(bytes.slice(nameStart, nameStart + nameLength));
      entries.set(name, { name, method, crc, compressedSize, uncompressedSize, localOffset });
      offset = nextOffset;
    }
    return entries;
  }

  function compressedEntryBytes(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    ensureByteRange(bytes, entry.localOffset, 30, `invalid Boardfish container local entry ${entry.name}`);
    if (view.getUint32(entry.localOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`invalid Boardfish container local entry ${entry.name}`);
    }
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    ensureByteRange(bytes, entry.localOffset + 30, nameLength + extraLength, `invalid Boardfish container local entry ${entry.name}`);
    if (dataEnd > bytes.length) throw new Error(`truncated Boardfish container entry ${entry.name}`);
    return bytes.subarray(dataStart, dataEnd);
  }

  function entryReadLimit(entry, maxBytes) {
    const limits = [];
    const advertisedSize = Number(entry?.uncompressedSize);
    const max = Number(maxBytes);
    if (Number.isFinite(advertisedSize)) limits.push(Math.max(0, advertisedSize));
    if (Number.isFinite(max)) limits.push(Math.max(0, max));
    return limits.length ? Math.min(...limits) : Infinity;
  }

  function throwEntryTooLarge(entry, actualBytes, options = {}) {
    if (typeof options.tooLargeError === 'function') throw options.tooLargeError(actualBytes);
    throw new Error(`Boardfish container entry ${entry.name} exceeds the board content limit`);
  }

  async function inflateRaw(bytes, entry, options = {}) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('this browser cannot read compressed .bf entries');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    const limit = entryReadLimit(entry, options.maxBytes);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        total += chunk.length;
        if (Number.isFinite(limit) && total > limit) {
          try { await reader.cancel(); } catch (_) {}
          throwEntryTooLarge(entry, total, options);
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
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
    else if (entry.method === ZIP_METHOD_DEFLATED) out = await inflateRaw(compressed, entry, options);
    else throw new Error(`unsupported .bf compression method ${entry.method} for ${entry.name}`);
    const limit = Number(options.maxBytes);
    if (Number.isFinite(limit) && out.length > limit) {
      throwEntryTooLarge(entry, out.length, options);
    }
    if (Number(entry.uncompressedSize) !== out.length) {
      throw new Error(`invalid Boardfish container entry size ${entry.name}`);
    }
    if (options.verifyCrc !== false && Number.isFinite(Number(entry.crc))) {
      const actualCrc = crc32(out);
      if ((entry.crc >>> 0) !== actualCrc) {
        const mismatch = {
          type: 'crc-mismatch',
          path: entry.name,
          expected: entry.crc >>> 0,
          actual: actualCrc,
        };
        if (typeof options.onCrcMismatch === 'function') {
          const action = options.onCrcMismatch(mismatch);
          if (action === 'continue') return out;
        }
        throw new Error(`Boardfish container CRC mismatch for ${entry.name}`);
      }
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

  function createWebImageRef({ path, mime, ext, bytes, lazy }) {
    const normalizedExt = normalizeImageExt(ext, mime);
    const normalizedMime = mime || mimeForExt(normalizedExt);
    const byteLength = bytes?.length || (lazy?.entry ? zipEntryContentBytes(lazy.entry) : 0);
    const ref = {
      web: true,
      path,
      mime: normalizedMime,
      ext: normalizedExt,
      bytes: byteLength,
    };
    if (bytes) {
      Object.defineProperty(ref, '__bytes', {
        value: bytes,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    if (lazy?.containerBytes && lazy?.entry) {
      Object.defineProperty(ref, '__lazy', {
        value: {
          containerBytes: lazy.containerBytes,
          entry: lazy.entry,
        },
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    return ref;
  }

  function isWebImageRef(source) {
    return !!(source && typeof source === 'object' && source.web === true && (source.objectUrl || source.dataUrl || source.__bytes || source.__lazy));
  }

  function bytesForWebImageRef(source) {
    if (source.__bytes) return source.__bytes;
    if (source.__lazy?.containerBytes && source.__lazy?.entry) {
      if (source.__lazy.entry.method !== ZIP_METHOD_STORED) {
        throw new Error(`lazy image entry ${source.path || source.__lazy.entry.name} uses unsupported compression`);
      }
      return compressedEntryBytes(source.__lazy.containerBytes, source.__lazy.entry);
    }
    return null;
  }

  function displaySrcForImageSource(source) {
    if (typeof source === 'string') return source;
    if (!isWebImageRef(source)) return '';
    if (source.objectUrl || source.dataUrl) return source.objectUrl || source.dataUrl;
    const bytes = bytesForWebImageRef(source);
    if (!bytes) return '';
    const objectUrl = createObjectUrlForBytes(bytes, source.mime);
    if (objectUrl) {
      source.objectUrl = objectUrl;
      return objectUrl;
    }
    source.dataUrl = bytesToDataUrl(bytes, source.mime);
    return source.dataUrl;
  }

  function dataUrlForImageSource(source) {
    if (typeof source === 'string') return source;
    if (!isWebImageRef(source)) return '';
    if (source.dataUrl) return source.dataUrl;
    const bytes = bytesForWebImageRef(source);
    return bytes ? bytesToDataUrl(bytes, source.mime) : '';
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

  function canonicalImageEntryPath(key, manifest = {}) {
    const ext = normalizeImageExt(manifest.ext, manifest.mime);
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
    if (isWebImageRef(source)) {
      const bytes = bytesForWebImageRef(source);
      if (bytes) return bytes;
    }
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
        path: canonicalImageEntryPath(key, manifest),
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
    const startedAt = nowMs();
    let phaseStart = startedAt;
    let containerBytes = await blobToBytes(input);
    const readMs = nowMs() - phaseStart;
    const containerFileBytes = containerBytes.length;
    const warnings = [];
    phaseStart = nowMs();
    const entries = parseCentralDirectory(containerBytes);
    const zipOpenMs = nowMs() - phaseStart;
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
    phaseStart = nowMs();
    const boardJsonBytes = await readZipEntry(containerBytes, boardEntry, {
      maxBytes: Number.isFinite(maxBoardContentBytes) ? maxBoardContentBytes : undefined,
    });
    const boardJsonReadMs = nowMs() - phaseStart;
    phaseStart = nowMs();
    const board = JSON.parse(utf8Decode(boardJsonBytes));
    const boardJsonParseMs = nowMs() - phaseStart;
    const objectCount = board?.objects?.length || 0;
    const lazyImageRefs = options.lazyImageRefs === true;
    const verifyImageCrc = options.verifyImageCrc !== false;
    if (validateBoardPayload) {
      validateBoardPayload({ objectCount, boardJsonBytes: boardJsonBytes.length, imageBytes: 0 });
    }
    const nextSources = {};
    const imageEntries = [];
    let imageBytes = 0;
    let imageReadMs = 0;
    let imageReadMaxMs = 0;
    let imageReadMaxKey = '';
    let imageRefMs = 0;
    let imageCrcMs = 0;
    let imageCrcCount = 0;
    let lazyImageRefCount = 0;
    let eagerImageRefCount = 0;

    try {
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
        const entryWarnings = [];
        let bytes = null;
        const canUseLazyRef = lazyImageRefs && imageEntry.method === ZIP_METHOD_STORED;
        if (canUseLazyRef) {
          imageBytes += advertisedImageBytes;
          if (verifyImageCrc && Number.isFinite(Number(imageEntry.crc))) {
            const crcStart = nowMs();
            const view = compressedEntryBytes(containerBytes, imageEntry);
            const actualCrc = crc32(view);
            imageCrcMs += nowMs() - crcStart;
            imageCrcCount++;
            if ((imageEntry.crc >>> 0) !== actualCrc) {
              const warning = {
                type: 'crc-mismatch',
                path: imageEntry.name,
                expected: imageEntry.crc >>> 0,
                actual: actualCrc,
              };
              entryWarnings.push(warning);
              warnings.push(warning);
            }
          }
        } else {
          const imageReadStart = nowMs();
          bytes = await readZipEntry(containerBytes, imageEntry, {
            maxBytes: remainingBytes,
            onCrcMismatch(warning) {
              entryWarnings.push(warning);
              warnings.push(warning);
              return 'continue';
            },
          });
          const entryReadMs = nowMs() - imageReadStart;
          imageReadMs += entryReadMs;
          if (entryReadMs > imageReadMaxMs) {
            imageReadMaxMs = entryReadMs;
            imageReadMaxKey = key;
          }
          imageBytes += bytes.length;
        }
        if (validateBoardPayload) {
          validateBoardPayload({ objectCount, boardJsonBytes: boardJsonBytes.length, imageBytes });
        }
        const manifestExt = manifestObject.ext || '';
        const ext = manifestExt || normalizeImageExt(path.split('.').pop(), manifestObject.mime);
        const mime = manifestObject.mime || mimeForExt(ext);
        const imageRefStart = nowMs();
        nextSources[key] = canUseLazyRef
          ? createWebImageRef({ path, mime, ext, lazy: { containerBytes, entry: imageEntry } })
          : createWebImageRef({ path, mime, ext, bytes });
        if (canUseLazyRef) lazyImageRefCount++;
        else eagerImageRefCount++;
        imageEntries.push({
          key,
          path,
          mime,
          ext,
          byteLength: canUseLazyRef ? advertisedImageBytes : bytes.length,
          compressedSize: imageEntry.compressedSize,
          warnings: entryWarnings,
        });
        imageRefMs += nowMs() - imageRefStart;
      }
    } catch (err) {
      for (const source of Object.values(nextSources)) revokeImageSource(source);
      throw err;
    }
    containerBytes = null;

    return {
      board: {
        ...board,
        imageStore: nextSources,
      },
      debug: {
        format: 'container-web',
        file_bytes: containerFileBytes,
        board_json_bytes: boardJsonBytes.length,
        image_count: imageEntries.length,
        image_bytes: imageBytes,
        total_content_bytes: boardJsonBytes.length + imageBytes,
        total_ms: nowMs() - startedAt,
        read_ms: readMs,
        zip_open_ms: zipOpenMs,
        zip_entry_count: entries.size,
        board_json_read_ms: boardJsonReadMs,
        board_json_parse_ms: boardJsonParseMs,
        image_read_ms: imageReadMs,
        image_read_max_ms: imageReadMaxMs,
        image_read_max_key: imageReadMaxKey,
        image_ref_ms: imageRefMs,
        image_crc_ms: imageCrcMs,
        image_crc_count: imageCrcCount,
        lazy_image_refs: lazyImageRefCount,
        eager_image_refs: eagerImageRefCount,
        warnings,
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
