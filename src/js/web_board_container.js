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
    let total = 0;
    for (const part of parts) total += part.length;
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

  async function crc32BlobAsync(blob, yieldState = null) {
    if (!crcTable) crcTable = makeCrcTable();
    let crc = 0xFFFFFFFF;
    const chunkSize = 1024 * 1024;
    for (let start = 0; start < blob.size; start += chunkSize) {
      const end = Math.min(blob.size, start + chunkSize);
      const chunk = new Uint8Array(await blob.slice(start, end).arrayBuffer());
      if (chunk.length !== end - start) throw new Error('truncated image Blob during save');
      crc = crc32Update(crc, chunk, 0, chunk.length);
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
    if (name.length > ZIP16_SENTINEL) throw new Error(`ZIP entry name is too long: ${entry.name}`);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength >= ZIP32_SENTINEL) {
      throw new Error(`ZIP entry is too large: ${entry.name}`);
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= ZIP32_SENTINEL) {
      throw new Error('Boardfish container is too large for ZIP32');
    }
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
        u32(entry.byteLength),
        u32(entry.byteLength),
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
      u32(entry.byteLength),
      u32(entry.byteLength),
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
    if (!Array.isArray(entries) || entries.length >= ZIP16_SENTINEL) {
      throw new Error('Boardfish container has too many ZIP entries');
    }
    const normalized = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []);
      normalized[i] = {
        name: entry.name,
        data,
        byteLength: data.length,
        date: entry.date || new Date(),
      };
    }
    for (const entry of normalized) entry.crc = crc32(entry.data);

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of normalized) {
      const local = localFileHeader(entry, offset);
      localParts.push(local.bytes, entry.data);
      offset += local.bytes.length + entry.byteLength;
      centralParts.push(centralDirectoryHeader(entry, local));
    }
    const centralOffset = offset;
    const central = concatBytes(centralParts);
    const eocd = endOfCentralDirectory(normalized.length, central.length, centralOffset);
    localParts.push(central, eocd);
    return concatBytes(localParts);
  }

  async function createZipBlob(entries, options = {}) {
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
    const yieldState = {
      everyMs: Number(options.yieldEveryMs) || 48,
      lastYieldAt: nowMs(),
    };
    let crcComputedEntries = 0;
    let crcReusedEntries = 0;
    let crcComputedBytes = 0;
    const crcStart = nowMs();
    for (const entry of normalized) {
      if (entry.crc !== null) {
        crcReusedEntries++;
        continue;
      }
      entry.crc = isNativeBlobPart(entry.data)
        ? await crc32BlobAsync(entry.data, yieldState)
        : await crc32Async(entry.data, yieldState);
      crcComputedEntries++;
      crcComputedBytes += entry.byteLength;
    }
    const crcMs = nowMs() - crcStart;

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of normalized) {
      const local = localFileHeader(entry, offset);
      entry.dataOffset = offset + local.bytes.length;
      localParts.push(local.bytes, entry.data);
      offset += local.bytes.length + entry.byteLength;
      centralParts.push(centralDirectoryHeader(entry, local));
    }
    const centralOffset = offset;
    const central = concatBytes(centralParts);
    const eocd = endOfCentralDirectory(normalized.length, central.length, centralOffset);
    localParts.push(central, eocd);
    const byteLength = offset + central.length + eocd.length;
    const blob = new Blob(localParts, { type: 'application/octet-stream' });
    const keepBytesBelow = Number(options.keepBytesBelow) || 8 * 1024 * 1024;
    const materializeBytes = options.materializeBytes !== false;
    const isSmallPayload = byteLength <= keepBytesBelow;
    const bytes = materializeBytes && isSmallPayload ? new Uint8Array(await blob.arrayBuffer()) : null;
    return {
      blob,
      bytes,
      byteLength,
      mode: bytes ? 'blob-parts+materialized-small' : 'blob-parts',
      crcMs,
      crcComputedBytes,
      crcComputedEntries,
      crcReusedEntries,
      entries: normalized.map((entry) => ({
        name: entry.name,
        byteLength: entry.byteLength,
        crc: entry.crc,
        blob: isNativeBlobPart(entry.data),
        dataOffset: entry.dataOffset,
      })),
    };
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

  function createObjectUrlForBlob(blob, mime = 'image/png') {
    if (!isBlobLike(blob) || !root.URL?.createObjectURL) return '';
    try {
      const typedBlob = blob.type === mime ? blob : blob.slice(0, blob.size, mime || 'image/png');
      return root.URL.createObjectURL(typedBlob);
    } catch (_) {
      return '';
    }
  }

  function createWebImageRef({ path, mime, ext, bytes, blob, lazy }) {
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
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    if (sourceBlob) {
      const holder = { blob: sourceBlob };
      Object.defineProperty(ref, '__blobHolder', {
        value: holder,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      Object.defineProperty(ref, '__blob', {
        get() { return holder.blob; },
        enumerable: false,
        configurable: false,
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

  function replaceWebImageRefBlob(source, blob, crc = null) {
    if (!isWebImageRef(source) || !source.__blobHolder || !isNativeBlobPart(blob)) return false;
    const typedBlob = blob.type === source.mime
      ? blob
      : blob.slice(0, blob.size, source.mime || 'image/png');
    const staleObjectUrl = source.objectUrl || '';
    source.__blobHolder.blob = typedBlob;
    source.bytes = typedBlob.size;
    if (source.objectUrl) delete source.objectUrl;
    if (source.dataUrl) delete source.dataUrl;
    if (staleObjectUrl && root.URL?.revokeObjectURL) {
      try { root.URL.revokeObjectURL(staleObjectUrl); } catch (_) {}
    }
    if (Number.isInteger(crc)) cacheImageSourceCrc(source, typedBlob.size, crc >>> 0);
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
    if (source.objectUrl || source.dataUrl) return source.objectUrl || source.dataUrl;
    const bytes = bytesForWebImageRef(source);
    const blob = isBlobLike(source.__blob) ? source.__blob : null;
    if (!blob && !bytes) return '';
    const objectUrl = blob
      ? createObjectUrlForBlob(blob, source.mime)
      : createObjectUrlForBytes(bytes, source.mime);
    if (objectUrl) {
      source.objectUrl = objectUrl;
      return objectUrl;
    }
    if (!bytes) return '';
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

  async function dataUrlForImageSourceAsync(source) {
    const syncDataUrl = dataUrlForImageSource(source);
    if (syncDataUrl) return syncDataUrl;
    if (!isWebImageRef(source)) return '';
    const bytes = await bytesForWebImageRefAsync(source);
    if (!bytes) return '';
    return bytesToDataUrl(bytes, source.mime);
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
    let path = candidates[0];
    for (const candidate of candidates) {
      if (!entries.has(candidate)) continue;
      path = candidate;
      break;
    }
    const entry = entries.get(path);
    if (!entry) throw new Error(`Boardfish file is missing ${path}`);
    return { path, entry };
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

  function refreshBlobRefsFromCreatedContainer(rawImageStore, containerPayload) {
    const containerBlob = containerPayload?.blob;
    const entries = containerPayload?.imageArchiveEntries;
    if (!isNativeBlobPart(containerBlob) || !Array.isArray(entries)) return null;
    const replacements = [];
    for (const entry of entries) {
      const source = rawImageStore[entry.key];
      if (!source?.__blobHolder) continue;
      const start = Number(entry.dataOffset);
      const byteLength = Number(entry.byteLength);
      const end = start + byteLength;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(byteLength) ||
        start < 0 ||
        byteLength < 0 ||
        end > containerBlob.size
      ) {
        throw new Error(`invalid saved image range ${entry.path || entry.key || ''}`);
      }
      const blob = containerBlob.slice(start, end, entry.mime || source.mime || 'image/png');
      if (blob.size !== byteLength) throw new Error(`truncated saved image ${entry.path || entry.key || ''}`);
      replacements.push({ source, blob, crc: entry.crc });
    }
    let bytes = 0;
    let refreshed = 0;
    for (const replacement of replacements) {
      if (!replaceWebImageRefBlob(replacement.source, replacement.blob, replacement.crc)) continue;
      refreshed++;
      bytes += replacement.blob.size;
    }
    return { refreshed, bytes, skipped: '' };
  }

  async function refreshBlobBackedImageRefsFromContainer(board, rawImageStore = {}, containerInput) {
    const createdRefresh = refreshBlobRefsFromCreatedContainer(rawImageStore, containerInput);
    if (createdRefresh) return createdRefresh;
    const containerBlob = isNativeBlobPart(containerInput?.blob) ? containerInput.blob : containerInput;
    if (!isNativeBlobPart(containerBlob)) return { refreshed: 0, bytes: 0, skipped: 'not-blob' };
    const directory = await parseCentralDirectoryFromBlob(containerBlob);
    const storedBlobs = await prepareLazyStoredImageBlobs(board, directory.entries, containerBlob, 8);
    const imageStore = board?.imageStore || {};
    let refreshed = 0;
    let bytes = 0;
    for (const key in imageStore) {
      if (!Object.prototype.hasOwnProperty.call(imageStore, key)) continue;
      const source = rawImageStore[key];
      if (!source?.__blobHolder) continue;
      const manifest = manifestEntryForKey(board, key);
      const resolved = resolveManifestImageEntry(directory.entries, key, manifest);
      const blob = storedBlobs.get(resolved.path);
      if (!blob || !replaceWebImageRefBlob(source, blob, resolved.entry.crc)) continue;
      refreshed++;
      bytes += blob.size;
    }
    return { refreshed, bytes, skipped: '' };
  }

  async function createBoardContainerBlob(board, rawImageStore = {}, options = {}) {
    let phaseStart = nowMs();
    const boardJson = JSON.stringify(board);
    const jsonStringifyMs = nowMs() - phaseStart;
    phaseStart = nowMs();
    const boardBytes = utf8Encode(boardJson);
    const jsonEncodeMs = nowMs() - phaseStart;
    const validateBoardPayload = typeof options.validateBoardPayload === 'function'
      ? options.validateBoardPayload
      : null;
    let validationMs = 0;
    if (validateBoardPayload) {
      phaseStart = nowMs();
      validateBoardPayload({
        objectCount: board?.objects?.length || 0,
        boardJsonBytes: boardBytes.length,
        imageBytes: 0,
      });
      validationMs += nowMs() - phaseStart;
    }
    phaseStart = nowMs();
    const imageEntries = await buildImageEntries(board, rawImageStore);
    const imageEntriesMs = nowMs() - phaseStart;
    let imageBytes = 0;
    let blobImageBytes = 0;
    let byteArrayImageBytes = 0;
    const zipEntries = [{ name: 'board.json', data: boardBytes }];
    for (const entry of imageEntries) {
      imageBytes += entry.byteLength;
      if (entry.blob) blobImageBytes += entry.byteLength;
      else byteArrayImageBytes += entry.byteLength;
      zipEntries.push({ name: entry.path, data: entry.data, crc: entry.crc });
    }
    if (validateBoardPayload) {
      phaseStart = nowMs();
      validateBoardPayload({
        objectCount: board?.objects?.length || 0,
        boardJsonBytes: boardBytes.length,
        imageBytes,
        imageEntries,
      });
      validationMs += nowMs() - phaseStart;
    }
    phaseStart = nowMs();
    const zip = await createZipBlob(zipEntries, options);
    const zipMs = nowMs() - phaseStart;
    const imageArchiveEntries = [];
    for (let i = 0; i < imageEntries.length; i++) {
      const entry = imageEntries[i];
      const zipEntry = zip.entries[i + 1];
      if (!zipEntry) continue;
      cacheImageSourceCrc(entry.source, entry.byteLength, zipEntry.crc);
      imageArchiveEntries.push({
        key: entry.key,
        path: entry.path,
        mime: entry.mime,
        byteLength: zipEntry.byteLength,
        dataOffset: zipEntry.dataOffset,
        crc: zipEntry.crc,
      });
    }
    return {
      blob: zip.blob,
      bytes: zip.bytes,
      zipBytes: zip.byteLength,
      zipMode: zip.mode,
      boardJsonBytes: boardBytes.length,
      imageBytes,
      imageCount: imageEntries.length,
      imageEntries,
      imageArchiveEntries,
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
    };
  }

  async function readBoardContainer(input, options = {}) {
    const startedAt = nowMs();
    let phaseStart = startedAt;
    const randomAccessBlob = isBlobLike(input) ? input : null;
    let containerBytes = null;
    let entries = null;
    let readMs = 0;
    let zipOpenMs = 0;
    let zipTailBytes = 0;
    let centralDirectoryBytes = 0;
    let containerFileBytes = 0;
    if (randomAccessBlob) {
      containerFileBytes = Number(randomAccessBlob.size) || 0;
      phaseStart = nowMs();
      const directory = await parseCentralDirectoryFromBlob(randomAccessBlob);
      entries = directory.entries;
      zipTailBytes = directory.tailBytes;
      centralDirectoryBytes = directory.centralBytes;
      zipOpenMs = nowMs() - phaseStart;
    } else {
      phaseStart = nowMs();
      containerBytes = await blobToBytes(input);
      readMs = nowMs() - phaseStart;
      containerFileBytes = containerBytes.length;
      phaseStart = nowMs();
      entries = parseCentralDirectory(containerBytes);
      zipOpenMs = nowMs() - phaseStart;
    }
    const warnings = [];
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
    const boardJsonBytes = await (randomAccessBlob ? readZipEntryFromBlob : readZipEntry)(
      randomAccessBlob || containerBytes,
      boardEntry,
      {
        maxBytes: Number.isFinite(maxBoardContentBytes) ? maxBoardContentBytes : undefined,
      },
    );
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
    let imageHeaderReadMs = 0;
    let lazyStoredImageBlobs = null;

    try {
      if (randomAccessBlob && lazyImageRefs) {
        const headerStart = nowMs();
        lazyStoredImageBlobs = await prepareLazyStoredImageBlobs(board, entries, randomAccessBlob, 8);
        imageHeaderReadMs = nowMs() - headerStart;
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
            const crcStart = nowMs();
            const view = randomAccessBlob
              ? new Uint8Array(await imageBlob.arrayBuffer())
              : compressedEntryBytes(containerBytes, imageEntry);
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
          bytes = await (randomAccessBlob ? readZipEntryFromBlob : readZipEntry)(
            randomAccessBlob || containerBytes,
            imageEntry,
            {
              maxBytes: remainingBytes,
              onCrcMismatch(warning) {
                entryWarnings.push(warning);
                warnings.push(warning);
                return 'continue';
              },
            },
          );
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
        const imageRefStart = nowMs();
        nextSources[key] = canUseLazyRef
          ? (randomAccessBlob
              ? createWebImageRef({ path, mime, ext, blob: imageBlob })
              : createWebImageRef({ path, mime, ext, lazy: { containerBytes, entry: imageEntry } }))
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
      for (const key in nextSources) {
        if (Object.prototype.hasOwnProperty.call(nextSources, key)) revokeImageSource(nextSources[key]);
      }
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
      },
      imageEntries,
    };
  }

  const api = Object.freeze({
    createBoardContainerBlob,
    createWebImageRef,
    createZip,
    blobForImageSource,
    bytesForImageSource,
    bytesForImageSourceAsync,
    dataUrlByteLength,
    dataUrlForImageSource,
    dataUrlForImageSourceAsync,
    dataUrlToBytes,
    displaySrcForImageSource,
    bytesToDataUrl,
    isWebImageRef,
    readBoardContainer,
    refreshBlobBackedImageRefsFromContainer,
    revokeImageSource,
  });

  root.BoardfishWebBoardContainer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
