'use strict';

(function initWebBoardContainer(root) {
  const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
  const ZIP_CENTRAL_DIRECTORY = 0x02014b50;
  const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
  const ZIP_METHOD_STORED = 0;
  const ZIP_METHOD_DEFLATED = 8;
  const ZIP_EOCD_MIN_SIZE = 22;
  const ZIP_EOCD_MAX_COMMENT = 0xFFFF;
  const ZIP16_SENTINEL = 0xFFFF;
  const ZIP32_SENTINEL = 0xFFFFFFFF;

  let crcTable = null;
  let utf8TextEncoder = null;
  let utf8TextDecoder = null;
  const imageSourceCrcCache = new WeakMap();
  const imageSourceArchiveIdentityCache = new WeakMap();

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
    return (crc32Update(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0;
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

  const BYTE_CRC_CHUNK_SIZE = 4 * 1024 * 1024;
  const BLOB_CRC_CHUNK_SIZE = 1024 * 1024;

  async function crc32Async(bytes) {
    let crc = 0xFFFFFFFF;
    for (let start = 0; start < bytes.length; start += BYTE_CRC_CHUNK_SIZE) {
      crc = crc32Update(crc, bytes, start, Math.min(bytes.length, start + BYTE_CRC_CHUNK_SIZE));
      await yieldToEventLoop();
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function crc32BlobAsync(blob) {
    let crc = 0xFFFFFFFF;
    for (let start = 0; start < blob.size; start += BLOB_CRC_CHUNK_SIZE) {
      const end = Math.min(blob.size, start + BLOB_CRC_CHUNK_SIZE);
      const chunk = new Uint8Array(await blob.slice(start, end).arrayBuffer());
      if (chunk.length !== end - start) throw new Error('truncated image Blob during save');
      crc = crc32Update(crc, chunk, 0, chunk.length);
      if (end === blob.size || end % BYTE_CRC_CHUNK_SIZE === 0) await yieldToEventLoop();
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
    if (name.length > ZIP16_SENTINEL) throw new Error(`ZIP entry name is too long: ${entry.name}`);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength >= ZIP32_SENTINEL) {
      throw new Error(`ZIP entry is too large: ${entry.name}`);
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= ZIP32_SENTINEL) {
      throw new Error('Boardfish container is too large for ZIP32');
    }
    const { time, date } = dosDateTime(entry.date);
    const bytes = new Uint8Array(30 + name.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZIP_LOCAL_FILE_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, ZIP_METHOD_STORED, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.byteLength, true);
    view.setUint32(22, entry.byteLength, true);
    view.setUint16(26, name.length, true);
    bytes.set(name, 30);
    return {
      offset,
      name,
      bytes,
    };
  }

  function centralDirectoryHeader(entry, local) {
    const { time, date } = dosDateTime(entry.date);
    const bytes = new Uint8Array(46 + local.name.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZIP_CENTRAL_DIRECTORY, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, ZIP_METHOD_STORED, true);
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.byteLength, true);
    view.setUint32(24, entry.byteLength, true);
    view.setUint16(28, local.name.length, true);
    view.setUint32(42, local.offset, true);
    bytes.set(local.name, 46);
    return bytes;
  }

  function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
    if (!Number.isSafeInteger(entryCount) || entryCount < 0 || entryCount >= ZIP16_SENTINEL) {
      throw new Error('Boardfish container has too many ZIP entries');
    }
    if (
      !Number.isSafeInteger(centralSize) ||
      !Number.isSafeInteger(centralOffset) ||
      centralSize < 0 ||
      centralOffset < 0 ||
      centralSize >= ZIP32_SENTINEL ||
      centralOffset >= ZIP32_SENTINEL
    ) {
      throw new Error('Boardfish container is too large for ZIP32');
    }
    const bytes = new Uint8Array(ZIP_EOCD_MIN_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY, true);
    view.setUint16(8, entryCount, true);
    view.setUint16(10, entryCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    return bytes;
  }

  async function createZipBlob(entries, options = {}) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (!Array.isArray(entries) || entries.length >= ZIP16_SENTINEL) {
      throw new Error('Boardfish container has too many ZIP entries');
    }
    const normalized = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let data;
      if (isNativeBlobPart(entry.data)) data = entry.data;
      else if (isBlobLike(entry.data)) data = await blobToBytes(entry.data);
      else data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []);
      const hasSuppliedCrc = entry.crc !== null && entry.crc !== undefined;
      const suppliedCrc = hasSuppliedCrc ? Number(entry.crc) : NaN;
      normalized[i] = {
        name: entry.name,
        data,
        byteLength: isNativeBlobPart(data) ? Number(data.size) : data.length,
        date: entry.date || new Date(),
        crc: Number.isInteger(suppliedCrc) && suppliedCrc >= 0 && suppliedCrc <= 0xFFFFFFFF
          ? suppliedCrc >>> 0
          : null,
      };
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let crcComputedEntries = 0;
    let crcReusedEntries = 0;
    let crcComputedBytes = 0;
    const crcStart = collectDiagnostics ? nowMs() : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    for (const entry of normalized) {
      if (entry.crc !== null) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectDiagnostics) crcReusedEntries++;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        continue;
      }
      entry.crc = isNativeBlobPart(entry.data)
        ? await crc32BlobAsync(entry.data)
        : await crc32Async(entry.data);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) {
        crcComputedEntries++;
        crcComputedBytes += entry.byteLength;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const crcMs = collectDiagnostics ? nowMs() - crcStart : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    let centralSize = 0;
    for (const entry of normalized) {
      const local = localFileHeader(entry, offset);
      localParts.push(local.bytes, entry.data);
      offset += local.bytes.length + entry.byteLength;
      const central = centralDirectoryHeader(entry, local);
      centralParts.push(central);
      centralSize += central.length;
    }
    const centralOffset = offset;
    const eocd = endOfCentralDirectory(normalized.length, centralSize, centralOffset);
    const byteLength = offset + centralSize + eocd.length;
    const blob = new Blob(localParts.concat(centralParts, eocd), { type: 'application/octet-stream' });
    const keepBytesBelow = Number(options.keepBytesBelow) || 8 * 1024 * 1024;
    const materializeBytes = options.materializeBytes !== false;
    const isSmallPayload = byteLength <= keepBytesBelow;
    const bytes = materializeBytes && isSmallPayload ? new Uint8Array(await blob.arrayBuffer()) : null;
    const result = {
      blob,
      bytes,
      byteLength,
      crcs: normalized.map((entry) => entry.crc),
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectDiagnostics) {
      Object.assign(result, {
        mode: bytes ? 'blob-parts+materialized-small' : 'blob-parts',
        crcMs,
        crcComputedBytes,
        crcComputedEntries,
        crcReusedEntries,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return result;
  }

  async function blobToBytes(blob) {
    if (blob instanceof Uint8Array) return blob;
    if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
    if (ArrayBuffer.isView(blob)) return new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
    if (blob?.arrayBuffer) return new Uint8Array(await blob.arrayBuffer());
    throw new Error('unsupported binary input');
  }

  function isBlobLike(value) {
    return !!(
      value &&
      typeof value.arrayBuffer === 'function' &&
      typeof value.slice === 'function' &&
      Number.isFinite(Number(value.size))
    );
  }

  function isNativeBlobPart(value) {
    return typeof Blob === 'function' && value instanceof Blob;
  }

  async function blobRangeToBytes(blob, start, end) {
    const size = Number(blob?.size);
    const from = Number(start);
    const to = Number(end);
    if (
      !Number.isFinite(size) ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 0 ||
      to < from ||
      to > size
    ) {
      throw invalidContainerError('invalid Boardfish container range');
    }
    const slice = blob.slice(from, to);
    if (Number(slice?.size) !== to - from) {
      throw invalidContainerError('truncated Boardfish container range');
    }
    const bytes = await blobToBytes(slice);
    if (bytes.length !== to - from) {
      throw invalidContainerError('truncated Boardfish container range');
    }
    return bytes;
  }

  function findEndOfCentralDirectory(bytes) {
    if (!bytes || bytes.length < ZIP_EOCD_MIN_SIZE) throw unsupportedContainerError();
    const min = Math.max(0, bytes.length - ZIP_EOCD_MIN_SIZE - ZIP_EOCD_MAX_COMMENT);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = bytes.length - ZIP_EOCD_MIN_SIZE; offset >= min; offset--) {
      if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + ZIP_EOCD_MIN_SIZE + commentLength === bytes.length) return offset;
    }
    throw unsupportedContainerError();
  }

  function endOfCentralDirectoryInfo(bytes, { baseOffset = 0, containerSize = bytes?.length || 0 } = {}) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(bytes);
    ensureByteRange(bytes, eocdOffset, ZIP_EOCD_MIN_SIZE, 'invalid Boardfish container directory');
    const diskNumber = view.getUint16(eocdOffset + 4, true);
    const centralDisk = view.getUint16(eocdOffset + 6, true);
    const diskEntryCount = view.getUint16(eocdOffset + 8, true);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
      throw invalidContainerError('multi-disk Boardfish containers are unsupported');
    }
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw invalidContainerError('ZIP64 Boardfish containers are unsupported');
    }
    const absoluteEocdOffset = baseOffset + eocdOffset;
    if (
      centralOffset + centralSize > containerSize ||
      centralOffset + centralSize > absoluteEocdOffset
    ) {
      throw invalidContainerError('invalid Boardfish container directory');
    }
    return {
      entryCount,
      centralSize,
      centralOffset,
      eocdOffset: absoluteEocdOffset,
    };
  }

  function parseCentralDirectoryBytes(bytes, entryCount, centralSize = bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (centralSize > bytes.length) throw invalidContainerError('invalid Boardfish container directory');
    const entries = new Map();
    let offset = 0;
    const centralEnd = centralSize;
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
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw invalidContainerError('ZIP64 Boardfish containers are unsupported');
      }
      const nameStart = offset + 46;
      const nextOffset = nameStart + nameLength + extraLength + commentLength;
      ensureByteRange(bytes, nameStart, nameLength, 'invalid Boardfish container entry name');
      if (nextOffset > centralEnd) throw invalidContainerError('invalid Boardfish container entry');
      const name = utf8Decode(bytes.subarray(nameStart, nameStart + nameLength));
      entries.set(name, { name, method, crc, compressedSize, uncompressedSize, localOffset });
      offset = nextOffset;
    }
    return entries;
  }

  function parseCentralDirectory(bytes) {
    const info = endOfCentralDirectoryInfo(bytes, { containerSize: bytes.length });
    const centralBytes = bytes.subarray(info.centralOffset, info.centralOffset + info.centralSize);
    return parseCentralDirectoryBytes(centralBytes, info.entryCount, info.centralSize);
  }

  async function parseCentralDirectoryFromBlob(blob) {
    const containerSize = Number(blob?.size) || 0;
    if (containerSize < ZIP_EOCD_MIN_SIZE) throw unsupportedContainerError();
    const tailSize = Math.min(containerSize, ZIP_EOCD_MIN_SIZE + ZIP_EOCD_MAX_COMMENT);
    const tailOffset = containerSize - tailSize;
    const tailBytes = await blobRangeToBytes(blob, tailOffset, containerSize);
    const info = endOfCentralDirectoryInfo(tailBytes, {
      baseOffset: tailOffset,
      containerSize,
    });
    const centralBytes = await blobRangeToBytes(
      blob,
      info.centralOffset,
      info.centralOffset + info.centralSize,
    );
    return {
      entries: parseCentralDirectoryBytes(centralBytes, info.entryCount, info.centralSize),
      tailBytes: tailBytes.length,
      centralBytes: centralBytes.length,
    };
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

  function assertStoredEntrySize(entry) {
    if (
      entry?.method === ZIP_METHOD_STORED &&
      Number(entry.compressedSize) !== Number(entry.uncompressedSize)
    ) {
      throw new Error(`invalid Boardfish container entry size ${entry?.name || ''}`);
    }
  }

  async function compressedEntryBlob(blob, entry, type = '') {
    const containerSize = Number(blob?.size) || 0;
    const localOffset = Number(entry?.localOffset);
    assertStoredEntrySize(entry);
    if (!Number.isFinite(localOffset) || localOffset < 0 || localOffset + 30 > containerSize) {
      throw new Error(`invalid Boardfish container local entry ${entry?.name || ''}`);
    }
    const header = await blobRangeToBytes(blob, localOffset, localOffset + 30);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`invalid Boardfish container local entry ${entry.name}`);
    }
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + Number(entry.compressedSize || 0);
    if (dataStart < localOffset + 30 || dataEnd > containerSize) {
      throw new Error(`truncated Boardfish container entry ${entry.name}`);
    }
    const out = blob.slice(dataStart, dataEnd, type || '');
    if (Number(out?.size) !== dataEnd - dataStart) {
      throw new Error(`truncated Boardfish container entry ${entry.name}`);
    }
    return out;
  }

  function entryReadLimit(entry, maxBytes) {
    const advertisedSize = Number(entry?.uncompressedSize);
    const max = Number(maxBytes);
    const hasAdvertisedSize = Number.isFinite(advertisedSize);
    const hasMax = Number.isFinite(max);
    if (hasAdvertisedSize && hasMax) return Math.min(Math.max(0, advertisedSize), Math.max(0, max));
    if (hasAdvertisedSize) return Math.max(0, advertisedSize);
    if (hasMax) return Math.max(0, max);
    return Infinity;
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

  function validateReadZipEntry(out, entry, options = {}) {
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
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
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
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        throw new Error(`Boardfish container CRC mismatch for ${entry.name}`);
      }
    }
    return out;
  }

  async function readZipEntry(bytes, entry, options = {}) {
    assertZipEntryReadBudget(entry, options.maxBytes, options.tooLargeError);
    const compressed = compressedEntryBytes(bytes, entry);
    let out;
    if (entry.method === ZIP_METHOD_STORED) out = compressed;
    else if (entry.method === ZIP_METHOD_DEFLATED) out = await inflateRaw(compressed, entry, options);
    else throw new Error(`unsupported .bf compression method ${entry.method} for ${entry.name}`);
    return validateReadZipEntry(out, entry, options);
  }

  async function readZipEntryFromBlob(blob, entry, options = {}) {
    assertZipEntryReadBudget(entry, options.maxBytes, options.tooLargeError);
    const compressedBlob = await compressedEntryBlob(blob, entry);
    const compressed = new Uint8Array(await compressedBlob.arrayBuffer());
    if (compressed.length !== Number(entry.compressedSize)) {
      throw new Error(`truncated Boardfish container entry ${entry.name}`);
    }
    let out;
    if (entry.method === ZIP_METHOD_STORED) out = compressed;
    else if (entry.method === ZIP_METHOD_DEFLATED) out = await inflateRaw(compressed, entry, options);
    else throw new Error(`unsupported .bf compression method ${entry.method} for ${entry.name}`);
    return validateReadZipEntry(out, entry, options);
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

  function createWebImageRef({ path, mime, ext, bytes, blob, lazy, volatileBlob = false, archiveCrc = null }) {
    const normalizedExt = normalizeImageExt(ext, mime);
    const normalizedMime = mime || mimeForExt(normalizedExt);
    const sourceBlob = isBlobLike(blob)
      ? (blob.type === normalizedMime ? blob : blob.slice(0, blob.size, normalizedMime))
      : null;
    const byteLength = bytes?.length || Number(sourceBlob?.size || 0) || (lazy?.entry ? zipEntryContentBytes(lazy.entry) : 0);
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
      });
    }
    if (sourceBlob) {
      Object.defineProperties(ref, {
        __blob: { value: sourceBlob, writable: true },
        __blobVolatile: { value: volatileBlob === true, writable: true },
      });
    }
    if (lazy?.containerBytes && lazy?.entry) {
      Object.defineProperty(ref, '__lazy', {
        value: {
          containerBytes: lazy.containerBytes,
          entry: lazy.entry,
        },
      });
    }
    if (Number.isInteger(archiveCrc)) {
      cacheImageSourceArchiveIdentity(ref, byteLength, archiveCrc >>> 0);
    }
    return ref;
  }

  function replaceWebImageRefBlob(source, blob, crc = null, { volatile = false } = {}) {
    if (!isWebImageRef(source) || !isBlobLike(source.__blob) || !isNativeBlobPart(blob)) return false;
    const typedBlob = blob.type === source.mime
      ? blob
      : blob.slice(0, blob.size, source.mime || 'image/png');
    const staleObjectUrl = source.objectUrl || '';
    source.__blob = typedBlob;
    source.__blobVolatile = volatile === true;
    source.bytes = typedBlob.size;
    if (source.objectUrl) delete source.objectUrl;
    if (source.dataUrl) delete source.dataUrl;
    if (staleObjectUrl && root.URL?.revokeObjectURL) {
      try { root.URL.revokeObjectURL(staleObjectUrl); } catch (_) {}
    }
    if (Number.isInteger(crc)) cacheImageSourceCrc(source, typedBlob.size, crc >>> 0);
    return true;
  }

  async function detachedBlobCopy(blob, mime = 'image/png') {
    let copy = null;
    if (typeof root.Response === 'function' && typeof blob?.stream === 'function') {
      copy = await new root.Response(blob.stream(), {
        headers: { 'Content-Type': mime || 'image/png' },
      }).blob();
    } else {
      copy = new Blob([await blob.arrayBuffer()], { type: mime || 'image/png' });
    }
    if (Number(copy?.size) !== Number(blob?.size)) {
      throw new Error('truncated image Blob while preparing board save');
    }
    return copy.type === mime ? copy : copy.slice(0, copy.size, mime || 'image/png');
  }

  async function stabilizeVolatileImageRefs(board, rawImageStore = {}) {
    const imageStore = board?.imageStore || {};
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
    let refreshed = 0;
    let bytes = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    for (const key in imageStore) {
      if (!Object.prototype.hasOwnProperty.call(imageStore, key)) continue;
      const source = rawImageStore[key];
      if (!source?.__blobVolatile || !isBlobLike(source.__blob)) continue;
      const sourceBlob = source.__blob;
      const cachedCrc = cachedImageSourceCrc(source, sourceBlob.size);
      const stableBlob = await detachedBlobCopy(sourceBlob, source.mime || 'image/png');
      if (!replaceWebImageRefBlob(source, stableBlob, cachedCrc, { volatile: false })) {
        throw new Error(`failed to stabilize image source ${key}`);
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) {
        refreshed++;
        bytes += stableBlob.size;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return { refreshed, bytes, skipped: '' };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return true;
  }

  function isWebImageRef(source) {
    return !!(source && typeof source === 'object' && source.web === true && (source.objectUrl || source.dataUrl || source.__bytes || source.__blob || source.__lazy));
  }

  function imageSourceCrcIdentity(source) {
    if (!isWebImageRef(source)) return null;
    return isBlobLike(source.__blob) ? source.__blob : null;
  }

  function cachedImageSourceCrc(source, byteLength) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity) return null;
    const cached = imageSourceCrcCache.get(source);
    if (!cached || cached.identity !== identity || cached.byteLength !== byteLength) return null;
    return cached.crc;
  }

  function cacheImageSourceCrc(source, byteLength, crc) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity || !Number.isInteger(crc)) return false;
    imageSourceCrcCache.set(source, { identity, byteLength, crc: crc >>> 0 });
    return true;
  }

  function archivedImageSourceIdentity(source, byteLength) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity) return null;
    const cached = imageSourceArchiveIdentityCache.get(source);
    if (!cached || cached.identity !== identity || cached.byteLength !== byteLength) return null;
    return cached;
  }

  function cacheImageSourceArchiveIdentity(source, byteLength, crc) {
    const identity = imageSourceCrcIdentity(source);
    if (!identity || !Number.isInteger(crc)) return false;
    imageSourceArchiveIdentityCache.set(source, {
      identity,
      byteLength,
      crc: crc >>> 0,
    });
    return true;
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

  function blobForWebImageRef(source) {
    if (isBlobLike(source?.__blob)) return source.__blob;
    const bytes = bytesForWebImageRef(source);
    if (!bytes || typeof Blob !== 'function') return null;
    return new Blob([bytes], { type: source?.mime || 'image/png' });
  }

  async function bytesForWebImageRefAsync(source) {
    const bytes = bytesForWebImageRef(source);
    if (bytes) return bytes;
    const blob = blobForWebImageRef(source);
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }

  function displaySrcForImageSource(source) {
    if (typeof source === 'string') return source;
    if (!isWebImageRef(source)) return '';
    return source.objectUrl || source.dataUrl || '';
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
    const out = [];
    for (const path of paths) {
      if (!path || out.includes(path)) continue;
      out.push(path);
    }
    return out;
  }

  function resolveManifestImageEntry(entries, key, manifest = {}) {
    const candidates = candidateImageEntryPaths(key, manifest);
    for (const path of candidates) {
      const entry = entries.get(path);
      if (entry) return { path, entry };
    }
    throw new Error(`Boardfish file is missing ${candidates[0]}`);
  }

  async function prepareLazyStoredImageBlobs(board, entries, containerBlob, concurrency = 8) {
    const tasks = [];
    const seen = new Set();
    const imageStore = board?.imageStore || {};
    for (const key in imageStore) {
      if (!Object.prototype.hasOwnProperty.call(imageStore, key)) continue;
      const manifest = imageStore[key];
      const manifestObject = manifest && typeof manifest === 'object' ? manifest : {};
      const resolved = resolveManifestImageEntry(entries, key, manifestObject);
      if (resolved.entry.method !== ZIP_METHOD_STORED || seen.has(resolved.path)) continue;
      seen.add(resolved.path);
      tasks.push(resolved);
    }
    const out = new Map();
    let next = 0;
    const workerCount = Math.max(1, Math.min(Math.trunc(Number(concurrency)) || 1, tasks.length || 1));
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        out.set(task.path, await compressedEntryBlob(containerBlob, task.entry));
      }
    }));
    return out;
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
      return null;
    }
    if (typeof source === 'string') return dataUrlToBytes(source);
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    throw new Error('web .bf save only supports browser image data URLs');
  }

  function blobForImageSource(source) {
    if (isWebImageRef(source)) return blobForWebImageRef(source);
    if (isBlobLike(source)) return source;
    const bytes = bytesForImageSource(source);
    if (!bytes || typeof Blob !== 'function') return null;
    return new Blob([bytes], { type: mimeForImageSource(source) });
  }

  async function bytesForImageSourceAsync(source) {
    if (isWebImageRef(source)) {
      const bytes = await bytesForWebImageRefAsync(source);
      if (bytes) return bytes;
    }
    if (isBlobLike(source)) return new Uint8Array(await source.arrayBuffer());
    return bytesForImageSource(source);
  }

  async function buildImageEntries(board, rawImageStore = {}) {
    const entries = [];
    const imageStore = board?.imageStore || {};
    for (const key in imageStore) {
      if (!Object.prototype.hasOwnProperty.call(imageStore, key)) continue;
      const manifest = manifestEntryForKey(board, key);
      const source = rawImageStore[key];
      const sourceBlob = isWebImageRef(source) && isNativeBlobPart(source.__blob)
        ? source.__blob
        : (isNativeBlobPart(source) ? source : null);
      const bytes = sourceBlob ? null : await bytesForImageSourceAsync(source);
      const data = sourceBlob || bytes;
      if (!data) throw new Error(`web .bf save is missing image bytes for ${key}`);
      const byteLength = sourceBlob ? Number(sourceBlob.size) : bytes.length;
      entries.push({
        key,
        path: canonicalImageEntryPath(key, manifest),
        mime: mimeForImageSource(source, manifest),
        ext: manifest.ext || '',
        source,
        data,
        bytes,
        byteLength,
        crc: cachedImageSourceCrc(source, byteLength),
        blob: !!sourceBlob,
      });
    }
    return entries;
  }

  async function recoverMatchingVolatileImageRefsFromContainer(board, rawImageStore = {}, containerInput) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const containerBlob = isNativeBlobPart(containerInput?.blob) ? containerInput.blob : containerInput;
    if (!isNativeBlobPart(containerBlob)) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      return { refreshed: 0, bytes: 0, skipped: 'not-blob' };
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return false;
    }
    const directory = await parseCentralDirectoryFromBlob(containerBlob);
    const imageStore = board?.imageStore || {};
    const replacements = [];
    for (const key in imageStore) {
      if (!Object.prototype.hasOwnProperty.call(imageStore, key)) continue;
      const source = rawImageStore[key];
      if (!source?.__blobVolatile || !isBlobLike(source.__blob)) continue;
      const manifest = manifestEntryForKey(board, key);
      const resolved = resolveManifestImageEntry(directory.entries, key, manifest);
      const byteLength = Number(source.bytes || source.__blob.size);
      const expectedIdentity = archivedImageSourceIdentity(source, byteLength);
      const persistedByteLength = zipEntryContentBytes(resolved.entry);
      if (
        !Number.isInteger(expectedIdentity?.crc) ||
        resolved.entry.method !== ZIP_METHOD_STORED ||
        persistedByteLength !== byteLength ||
        (resolved.entry.crc >>> 0) !== (expectedIdentity.crc >>> 0)
      ) {
        throw new Error(`saved image source changed for ${key}`);
      }
      const blob = await compressedEntryBlob(
        containerBlob,
        resolved.entry,
        source.mime || manifest.mime || 'image/png',
      );
      replacements.push({ source, blob, crc: expectedIdentity.crc });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let refreshed = 0;
    let bytes = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    for (const replacement of replacements) {
      if (!replaceWebImageRefBlob(
        replacement.source,
        replacement.blob,
        null,
        { volatile: true },
      )) {
        throw new Error('failed to recover saved image source');
      }
      cacheImageSourceArchiveIdentity(
        replacement.source,
        replacement.blob.size,
        replacement.crc,
      );
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) {
        refreshed++;
        bytes += replacement.blob.size;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    return {
      refreshed,
      bytes,
      skipped: refreshed ? '' : 'no-volatile-images',
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return replacements.length > 0;
  }

  async function createBoardContainerBlob(board, rawImageStore = {}, options = {}) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
    let phaseStart = collectDiagnostics ? nowMs() : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const boardJson = JSON.stringify(board);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const jsonStringifyMs = collectDiagnostics ? nowMs() - phaseStart : 0;
    if (collectDiagnostics) phaseStart = nowMs();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const boardBytes = utf8Encode(boardJson);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const jsonEncodeMs = collectDiagnostics ? nowMs() - phaseStart : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const validateBoardPayload = typeof options.validateBoardPayload === 'function'
      ? options.validateBoardPayload
      : null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let validationMs = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (validateBoardPayload) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) phaseStart = nowMs();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      validateBoardPayload({
        objectCount: board?.objects?.length || 0,
        boardJsonBytes: boardBytes.length,
        imageBytes: 0,
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) validationMs += nowMs() - phaseStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectDiagnostics) phaseStart = nowMs();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const imageEntries = await buildImageEntries(board, rawImageStore);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const imageEntriesMs = collectDiagnostics ? nowMs() - phaseStart : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    let imageBytes = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let blobImageBytes = 0;
    let byteArrayImageBytes = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const zipEntries = [{ name: 'board.json', data: boardBytes }];
    for (const entry of imageEntries) {
      imageBytes += entry.byteLength;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) {
        if (entry.blob) blobImageBytes += entry.byteLength;
        else byteArrayImageBytes += entry.byteLength;
      }
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      zipEntries.push({ name: entry.path, data: entry.data, crc: entry.crc });
    }
    if (validateBoardPayload) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) phaseStart = nowMs();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      validateBoardPayload({
        objectCount: board?.objects?.length || 0,
        boardJsonBytes: boardBytes.length,
        imageBytes,
        imageEntries,
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) validationMs += nowMs() - phaseStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectDiagnostics) phaseStart = nowMs();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const zip = await createZipBlob(zipEntries, options);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const zipMs = collectDiagnostics ? nowMs() - phaseStart : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    for (let i = 0; i < imageEntries.length; i++) {
      const entry = imageEntries[i];
      const crc = zip.crcs[i + 1];
      if (crc !== undefined) cacheImageSourceCrc(entry.source, entry.byteLength, crc);
    }
    const result = {
      blob: zip.blob,
      bytes: zip.bytes,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectDiagnostics) {
      Object.assign(result, {
        zipBytes: zip.byteLength,
        zipMode: zip.mode,
        boardJsonBytes: boardBytes.length,
        imageBytes,
        imageCount: imageEntries.length,
        imageEntries,
        jsonStringifyMs,
        jsonEncodeMs,
        imageEntriesMs,
        validationMs,
        zipMs,
        crcMs: zip.crcMs,
        crcComputedBytes: zip.crcComputedBytes,
        crcComputedEntries: zip.crcComputedEntries,
        crcReusedEntries: zip.crcReusedEntries,
        blobImageBytes,
        byteArrayImageBytes,
      });
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return result;
  }

  async function readBoardContainer(input, options = {}) {
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const collectDiagnostics = typeof BOARDFISH_PRODUCTION === 'undefined';
    const startedAt = collectDiagnostics ? nowMs() : 0;
    let phaseStart = startedAt;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const randomAccessBlob = isBlobLike(input) ? input : null;
    let containerBytes = null;
    let entries = null;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let readMs = 0;
    let zipOpenMs = 0;
    let zipTailBytes = 0;
    let centralDirectoryBytes = 0;
    let containerFileBytes = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    if (randomAccessBlob) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      containerFileBytes = Number(randomAccessBlob.size) || 0;
      if (collectDiagnostics) phaseStart = nowMs();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      const directory = await parseCentralDirectoryFromBlob(randomAccessBlob);
      entries = directory.entries;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      zipTailBytes = directory.tailBytes;
      centralDirectoryBytes = directory.centralBytes;
      if (collectDiagnostics) zipOpenMs = nowMs() - phaseStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) phaseStart = nowMs();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      containerBytes = await blobToBytes(input);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) readMs = nowMs() - phaseStart;
      containerFileBytes = containerBytes.length;
      if (collectDiagnostics) phaseStart = nowMs();
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      entries = parseCentralDirectory(containerBytes);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (collectDiagnostics) zipOpenMs = nowMs() - phaseStart;
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const warnings = [];
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectDiagnostics) phaseStart = nowMs();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const boardJsonBytes = await (randomAccessBlob ? readZipEntryFromBlob : readZipEntry)(
      randomAccessBlob || containerBytes,
      boardEntry,
      {
        maxBytes: Number.isFinite(maxBoardContentBytes) ? maxBoardContentBytes : undefined,
      },
    );
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const boardJsonReadMs = collectDiagnostics ? nowMs() - phaseStart : 0;
    if (collectDiagnostics) phaseStart = nowMs();
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const board = JSON.parse(utf8Decode(boardJsonBytes));
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const boardJsonParseMs = collectDiagnostics ? nowMs() - phaseStart : 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    const objectCount = board?.objects?.length || 0;
    const lazyImageRefs = options.lazyImageRefs === true;
    const verifyImageCrc = options.verifyImageCrc !== false;
    if (validateBoardPayload) {
      validateBoardPayload({ objectCount, boardJsonBytes: boardJsonBytes.length, imageBytes: 0 });
    }
    const nextSources = {};
    const imageEntries = [];
    let imageBytes = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    let imageReadMs = 0;
    let imageReadMaxMs = 0;
    let imageReadMaxKey = '';
    let imageRefMs = 0;
    let imageCrcMs = 0;
    let imageCrcCount = 0;
    let lazyImageRefCount = 0;
    let eagerImageRefCount = 0;
    let imageHeaderReadMs = 0;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    let lazyStoredImageBlobs = null;

    try {
      if (randomAccessBlob && lazyImageRefs) {
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const headerStart = collectDiagnostics ? nowMs() : 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        lazyStoredImageBlobs = await prepareLazyStoredImageBlobs(board, entries, randomAccessBlob, 8);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectDiagnostics) imageHeaderReadMs = nowMs() - headerStart;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      const imageStore = board.imageStore || {};
      for (const key in imageStore) {
        if (!Object.prototype.hasOwnProperty.call(imageStore, key)) continue;
        const manifest = imageStore[key];
        const manifestObject = manifest && typeof manifest === 'object' ? manifest : {};
        const resolvedImage = resolveManifestImageEntry(entries, key, manifestObject);
        const path = resolvedImage.path;
        const imageEntry = resolvedImage.entry;
        const advertisedImageBytes = zipEntryContentBytes(imageEntry);
        const manifestExt = manifestObject.ext || '';
        const ext = manifestExt || normalizeImageExt(path.split('.').pop(), manifestObject.mime);
        const mime = manifestObject.mime || mimeForExt(ext);
        if (path.includes('\0')) throw new Error('Boardfish image entry path is invalid');
        if (typeof mime !== 'string' || !/^image\/(?:png|jpe?g|webp|gif)$/.test(mime.toLowerCase())) {
          throw new Error(`${path} has unsupported image metadata`);
        }
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
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const entryWarnings = [];
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        let bytes = null;
        let imageBlob = null;
        const canUseLazyRef = lazyImageRefs && imageEntry.method === ZIP_METHOD_STORED;
        if (canUseLazyRef) {
          assertStoredEntrySize(imageEntry);
          imageBytes += advertisedImageBytes;
          if (randomAccessBlob) {
            const untypedBlob = lazyStoredImageBlobs?.get(path);
            if (!untypedBlob) throw new Error(`Boardfish file is missing ${path}`);
            imageBlob = untypedBlob.type === mime
              ? untypedBlob
              : untypedBlob.slice(0, untypedBlob.size, mime);
          }
          if (verifyImageCrc && Number.isFinite(Number(imageEntry.crc))) {
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            const crcStart = collectDiagnostics ? nowMs() : 0;
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
            const view = randomAccessBlob
              ? new Uint8Array(await imageBlob.arrayBuffer())
              : compressedEntryBytes(containerBytes, imageEntry);
            const actualCrc = crc32(view);
            /* BOARDFISH_DEV_DIAGNOSTICS_START */
            if (collectDiagnostics) {
              imageCrcMs += nowMs() - crcStart;
              imageCrcCount++;
            }
            /* BOARDFISH_DEV_DIAGNOSTICS_END */
            if ((imageEntry.crc >>> 0) !== actualCrc) {
              /* BOARDFISH_DEV_DIAGNOSTICS_START */
              const warning = {
                type: 'crc-mismatch',
                path: imageEntry.name,
                expected: imageEntry.crc >>> 0,
                actual: actualCrc,
              };
              entryWarnings.push(warning);
              if (collectDiagnostics) warnings.push(warning);
              /* BOARDFISH_DEV_DIAGNOSTICS_END */
            }
          }
        } else {
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          const imageReadStart = collectDiagnostics ? nowMs() : 0;
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          bytes = await (randomAccessBlob ? readZipEntryFromBlob : readZipEntry)(
            randomAccessBlob || containerBytes,
            imageEntry,
            {
              maxBytes: remainingBytes,
              /* BOARDFISH_DEV_DIAGNOSTICS_START */
              onCrcMismatch(warning) {
                entryWarnings.push(warning);
                if (collectDiagnostics) warnings.push(warning);
                return 'continue';
              },
              /* BOARDFISH_DEV_DIAGNOSTICS_END */
              verifyCrc: typeof BOARDFISH_PRODUCTION === 'undefined' && verifyImageCrc,
            },
          );
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          if (collectDiagnostics) {
            const entryReadMs = nowMs() - imageReadStart;
            imageReadMs += entryReadMs;
            if (entryReadMs > imageReadMaxMs) {
              imageReadMaxMs = entryReadMs;
              imageReadMaxKey = key;
            }
          }
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
          imageBytes += bytes.length;
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        const imageRefStart = collectDiagnostics ? nowMs() : 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        nextSources[key] = canUseLazyRef
          ? (randomAccessBlob
              ? createWebImageRef({
                  path,
                  mime,
                  ext,
                  blob: imageBlob,
                  volatileBlob: true,
                  archiveCrc: imageEntry.crc,
                })
              : createWebImageRef({ path, mime, ext, lazy: { containerBytes, entry: imageEntry } }))
          : createWebImageRef({ path, mime, ext, bytes });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectDiagnostics) {
          if (canUseLazyRef) lazyImageRefCount++;
          else eagerImageRefCount++;
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
        imageEntries.push({
          key,
          path,
          mime,
          ext,
          byteLength: canUseLazyRef ? advertisedImageBytes : bytes.length,
          compressedSize: imageEntry.compressedSize,
          /* BOARDFISH_DEV_DIAGNOSTICS_START */
          warnings: entryWarnings,
          /* BOARDFISH_DEV_DIAGNOSTICS_END */
        });
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        if (collectDiagnostics) imageRefMs += nowMs() - imageRefStart;
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
    } catch (err) {
      for (const key in nextSources) {
        if (Object.prototype.hasOwnProperty.call(nextSources, key)) revokeImageSource(nextSources[key]);
      }
      throw err;
    }
    containerBytes = null;

    const result = {
      board: {
        ...board,
        imageStore: nextSources,
      },
      imageEntries,
    };
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (collectDiagnostics) {
      result.debug = {
        format: 'container-web',
        file_bytes: containerFileBytes,
        board_json_bytes: boardJsonBytes.length,
        image_count: imageEntries.length,
        image_bytes: imageBytes,
        total_content_bytes: boardJsonBytes.length + imageBytes,
        total_ms: nowMs() - startedAt,
        read_ms: readMs,
        zip_open_ms: zipOpenMs,
        read_mode: randomAccessBlob ? 'blob-random-access' : 'full-buffer',
        random_access: !!randomAccessBlob,
        zip_tail_bytes: zipTailBytes,
        central_directory_bytes: centralDirectoryBytes,
        zip_entry_count: entries.size,
        board_json_read_ms: boardJsonReadMs,
        board_json_parse_ms: boardJsonParseMs,
        image_read_ms: imageReadMs,
        image_read_max_ms: imageReadMaxMs,
        image_read_max_key: imageReadMaxKey,
        image_ref_ms: imageRefMs,
        image_header_read_ms: imageHeaderReadMs,
        image_crc_ms: imageCrcMs,
        image_crc_count: imageCrcCount,
        lazy_image_refs: lazyImageRefCount,
        eager_image_refs: eagerImageRefCount,
        warnings,
      };
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return result;
  }

  const api = Object.freeze({
    createBoardContainerBlob,
    createWebImageRef,
    createZipBlob,
    blobForImageSource,
    bytesForImageSource,
    bytesForImageSourceAsync,
    dataUrlByteLength,
    dataUrlToBytes,
    displaySrcForImageSource,
    isWebImageRef,
    readBoardContainer,
    recoverMatchingVolatileImageRefsFromContainer,
    revokeImageSource,
    stabilizeVolatileImageRefs,
  });

  root.BoardfishWebBoardContainer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
