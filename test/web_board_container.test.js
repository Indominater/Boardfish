'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const WebContainer = require('../src/js/web_board_container.js');

function crc32(bytes) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[n] = value >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function storedZipEntryDataOffset(bytes, name) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const entryName = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    if (entryName === name) return dataStart;
    offset = dataStart + compressedSize;
  }
  throw new Error(`entry not found: ${name}`);
}

function centralDirectoryEntryOffset(bytes, name) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = bytes.length - 22;
  while (eocdOffset >= 0 && view.getUint32(eocdOffset, true) !== 0x06054b50) eocdOffset--;
  if (eocdOffset < 0) throw new Error('EOCD not found');
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('central entry not found');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const entryName = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (entryName === name) return offset;
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  throw new Error(`central entry not found: ${name}`);
}

test('ZIP CRC work yields on one-MiB budgets', async (t) => {
  let yields = 0;
  globalThis.scheduler = { yield: () => { yields++; return Promise.resolve(); } };
  t.after(() => { delete globalThis.scheduler; });
  const bytes = new Uint8Array(5 * 1024 * 1024);
  const countYields = async (data) => { yields = 0; await WebContainer.createZipBlob([{ name: 'payload.bin', data }], { materializeBytes: false }); return yields; };
  assert.deepEqual([await countYields(bytes), await countYields(new Blob([bytes]))], [5, 5]);
});

function createDeflatedZipWithAdvertisedSize(name, data, advertisedSize) {
  const nameBytes = Buffer.from(name);
  const compressed = zlib.deflateRawSync(Buffer.from(data));
  const crc = crc32(data);
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0x0800),
    u16(8),
    u16(0),
    u16(0),
    u32(crc),
    u32(compressed.length),
    u32(advertisedSize),
    u16(nameBytes.length),
    u16(0),
    nameBytes,
    compressed,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0800),
    u16(8),
    u16(0),
    u16(0),
    u32(crc),
    u32(compressed.length),
    u32(advertisedSize),
    u16(nameBytes.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    nameBytes,
  ]);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.length),
    u32(local.length),
    u16(0),
  ]);
  return new Uint8Array(Buffer.concat([local, central, eocd]));
}

test('writes and reads Boardfish .bf containers in browser format', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 1, panY: 2, zoom: 1 },
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const imageStore = {
    'img-1': 'data:image/png;base64,AQIDBA==',
  };

  const payload = await WebContainer.createBoardContainerBlob(board, imageStore);
  assert.equal(payload.imageBytes, 4);
  assert.equal(payload.imageCount, 1);
  assert.equal(payload.crcComputedEntries, 2);
  assert.equal(payload.crcReusedEntries, 0);
  assert.ok(payload.bytes[0] === 0x50 && payload.bytes[1] === 0x4b);

  const result = await WebContainer.readBoardContainer(payload.blob);
  assert.equal(result.board.version, 3);
  const source = result.board.imageStore['img-1'];
  assert.equal(WebContainer.isWebImageRef(source), true);
  assert.equal(source.mime, 'image/png');
  assert.equal(source.ext, 'png');
  assert.equal(source.bytes, 4);
  assert.deepEqual(WebContainer.bytesForImageSource(source), new Uint8Array([1, 2, 3, 4]));
  assert.equal(result.debug.image_bytes, 4);
  assert.equal(result.debug.format, 'container-web');
  assert.equal(typeof result.debug.total_ms, 'number');
  assert.equal(typeof result.debug.read_ms, 'number');
  assert.equal(typeof result.debug.zip_open_ms, 'number');
  assert.equal(typeof result.debug.board_json_read_ms, 'number');
  assert.equal(typeof result.debug.board_json_parse_ms, 'number');
  assert.equal(typeof result.debug.image_read_ms, 'number');
  assert.equal(typeof result.debug.image_read_max_ms, 'number');
  assert.equal(result.debug.image_read_max_key, 'img-1');
  assert.equal(typeof result.debug.image_ref_ms, 'number');
  assert.equal(typeof result.debug.image_crc_ms, 'number');
  assert.equal(result.debug.lazy_image_refs, 0);
  assert.equal(result.debug.eager_image_refs, 1);
  assert.equal(result.debug.zip_entry_count, 2);
  assert.equal(result.imageEntries[0].path, 'images/img-1.png');

  const savedAgain = await WebContainer.createBoardContainerBlob(board, result.board.imageStore);
  assert.equal(savedAgain.imageBytes, 4);
});

test('read rejects unsupported image metadata during entry derivation', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'text/plain', ext: 'png' },
    },
    objects: [],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });

  await assert.rejects(
    () => WebContainer.readBoardContainer(payload.blob),
    /unsupported image metadata/,
  );
});

test('container creation validates the one exact UTF-8 board serialization before ZIP work', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'text-1', type: 'text', x: 0, y: 0, w: 100, h: 20, z: 1, data: { content: 'exact 🐟 text' } },
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 2, data: { imgKey: 'img-1' } },
    ],
  };
  const validations = [];
  const payload = await WebContainer.createBoardContainerBlob(
    board,
    { 'img-1': new Uint8Array([1, 2, 3, 4]) },
    {
      validateBoardPayload(next) {
        validations.push({
          objectCount: next.objectCount,
          boardJsonBytes: next.boardJsonBytes,
          imageBytes: next.imageBytes,
        });
      },
    },
  );

  assert.equal(validations.length, 2);
  assert.deepEqual(validations[0], {
    objectCount: 2,
    boardJsonBytes: payload.boardJsonBytes,
    imageBytes: 0,
  });
  assert.deepEqual(validations[1], {
    objectCount: 2,
    boardJsonBytes: payload.boardJsonBytes,
    imageBytes: 4,
  });
  assert.equal(payload.boardJsonBytes, new TextEncoder().encode(JSON.stringify(board)).length);
});

test('oversized board JSON is rejected before any image Blob is read', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'text-1', type: 'text', x: 0, y: 0, w: 100, h: 20, z: 1, data: { content: 'too large' } },
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 2, data: { imgKey: 'img-1' } },
    ],
  };
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
  let blobReads = 0;
  const originalSlice = blob.slice.bind(blob);
  Object.defineProperty(blob, 'slice', {
    configurable: true,
    value(...args) {
      blobReads++;
      return originalSlice(...args);
    },
  });
  const source = WebContainer.createWebImageRef({
    path: 'images/img-1.png',
    mime: 'image/png',
    ext: 'png',
    blob,
  });

  await assert.rejects(
    () => WebContainer.createBoardContainerBlob(board, { 'img-1': source }, {
      validateBoardPayload(next) {
        if (next.imageBytes === 0) throw new Error('board JSON limit');
      },
    }),
    /board JSON limit/,
  );
  assert.equal(blobReads, 0);
});

test('reads Boardfish containers with lazy image refs for fast web opens', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 1, panY: 2, zoom: 1 },
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const imageStore = {
    'img-1': 'data:image/png;base64,AQIDBA==',
  };
  const payload = await WebContainer.createBoardContainerBlob(board, imageStore);

  const result = await WebContainer.readBoardContainer(payload.blob, {
    lazyImageRefs: true,
    verifyImageCrc: false,
  });
  const source = result.board.imageStore['img-1'];

  assert.equal(WebContainer.isWebImageRef(source), true);
  assert.equal(source.bytes, 4);
  assert.equal(source.__bytes, undefined);
  assert.equal(source.__blob instanceof Blob, true);
  assert.equal(result.debug.lazy_image_refs, 1);
  assert.equal(result.debug.eager_image_refs, 0);
  assert.equal(result.debug.image_read_ms, 0);
  assert.equal(result.debug.image_crc_count, 0);
  assert.equal(result.debug.warnings.length, 0);
  assert.equal(WebContainer.bytesForImageSource(source), null);
  assert.deepEqual(await WebContainer.bytesForImageSourceAsync(source), new Uint8Array([1, 2, 3, 4]));
});

test('Blob lazy opens use range reads and preserve exact image bytes on re-save', async () => {
  const imageBytes = new Uint8Array(192 * 1024);
  for (let i = 0; i < imageBytes.length; i++) imageBytes[i] = i % 251;
  const board = {
    version: 3,
    format: 'boardfish-container',
    viewport: { panX: 0, panY: 0, zoom: 1 },
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, { 'img-1': imageBytes });
  const input = payload.blob;
  const originalSlice = input.slice.bind(input);
  let fullArrayBufferReads = 0;
  const materializedRanges = [];
  const sliceRanges = [];
  Object.defineProperty(input, 'arrayBuffer', {
    configurable: true,
    value() {
      fullArrayBufferReads++;
      throw new Error('full Blob materialization is forbidden during lazy open');
    },
  });
  Object.defineProperty(input, 'slice', {
    configurable: true,
    value(start = 0, end = input.size, type = '') {
      const from = Math.max(0, Number(start) || 0);
      const to = Math.min(input.size, end == null ? input.size : Number(end));
      sliceRanges.push({ start: from, end: to });
      const sliced = originalSlice(start, end, type);
      const slicedArrayBuffer = sliced.arrayBuffer.bind(sliced);
      Object.defineProperty(sliced, 'arrayBuffer', {
        configurable: true,
        value() {
          materializedRanges.push({ start: from, end: to });
          return slicedArrayBuffer();
        },
      });
      return sliced;
    },
  });

  const opened = await WebContainer.readBoardContainer(input, {
    lazyImageRefs: true,
    verifyImageCrc: false,
  });
  const source = opened.board.imageStore['img-1'];

  assert.equal(fullArrayBufferReads, 0);
  assert.equal(opened.debug.read_mode, 'blob-random-access');
  assert.equal(opened.debug.random_access, true);
  assert.ok(sliceRanges.length >= 5);
  assert.equal(materializedRanges.length, 4);
  assert.ok(sliceRanges.every((range) => range.end - range.start < input.size));
  assert.equal(materializedRanges.some((range) => range.end - range.start === imageBytes.length), false);
  assert.equal(source.__blob instanceof Blob, true);
  assert.equal(source.__blob.size, imageBytes.length);
  assert.equal(source.__bytes, undefined);
  assert.equal(source.__lazy, undefined);

  const extracted = await WebContainer.bytesForImageSourceAsync(source);
  assert.deepEqual(extracted, imageBytes);

  let fullImageBlobReads = 0;
  Object.defineProperty(source.__blob, 'arrayBuffer', {
    configurable: true,
    value() {
      fullImageBlobReads++;
      throw new Error('full image Blob materialization is forbidden during save');
    },
  });

  const savedAgain = await WebContainer.createBoardContainerBlob(board, opened.board.imageStore);
  assert.equal(fullImageBlobReads, 0);
  assert.equal(savedAgain.blobImageBytes, imageBytes.length);
  assert.equal(savedAgain.byteArrayImageBytes, 0);
  assert.equal(savedAgain.crcComputedEntries, 2);
  assert.equal(savedAgain.crcReusedEntries, 0);

  const savedThird = await WebContainer.createBoardContainerBlob(board, opened.board.imageStore);
  assert.equal(fullImageBlobReads, 0);
  assert.equal(savedThird.crcComputedEntries, 1);
  assert.equal(savedThird.crcReusedEntries, 1);
  assert.ok(savedThird.crcComputedBytes < savedAgain.crcComputedBytes);

  const reopened = await WebContainer.readBoardContainer(savedThird.blob, {
    lazyImageRefs: true,
    verifyImageCrc: false,
  });
  assert.deepEqual(await WebContainer.bytesForImageSourceAsync(reopened.board.imageStore['img-1']), imageBytes);
  assert.equal(savedAgain.imageEntries[0].path, 'images/img-1.png');
});


test('volatile File-backed image refs detach once before repeated saves', async () => {
  const imageBytes = new Uint8Array(160 * 1024);
  for (let i = 0; i < imageBytes.length; i++) imageBytes[i] = (i * 29) % 251;
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const initial = await WebContainer.createBoardContainerBlob(board, { 'img-1': imageBytes });
  const opened = await WebContainer.readBoardContainer(
    new File([initial.blob], 'volatile-board.bf', { type: 'application/octet-stream' }),
    { lazyImageRefs: true, verifyImageCrc: false },
  );
  const source = opened.board.imageStore['img-1'];
  const volatileBlob = source.__blob;
  assert.equal(source.__blobVolatile, true);

  const stabilized = await WebContainer.stabilizeVolatileImageRefs(board, opened.board.imageStore);
  assert.deepEqual(stabilized, { refreshed: 1, bytes: imageBytes.length, skipped: '' });
  assert.equal(source.__blobVolatile, false);
  assert.notEqual(source.__blob, volatileBlob);

  Object.defineProperties(volatileBlob, {
    arrayBuffer: {
      configurable: true,
      value() { throw new Error('the replaced File snapshot is no longer readable'); },
    },
    slice: {
      configurable: true,
      value() { throw new Error('the replaced File snapshot is no longer sliceable'); },
    },
    stream: {
      configurable: true,
      value() { throw new Error('the replaced File snapshot is no longer streamable'); },
    },
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const saved = await WebContainer.createBoardContainerBlob(board, opened.board.imageStore, {
      materializeBytes: false,
    });
    const reopened = await WebContainer.readBoardContainer(saved.blob, {
      lazyImageRefs: true,
      verifyImageCrc: true,
    });
    assert.deepEqual(await WebContainer.bytesForImageSourceAsync(reopened.board.imageStore['img-1']), imageBytes);
  }

  const repeatedStabilize = await WebContainer.stabilizeVolatileImageRefs(board, opened.board.imageStore);
  assert.deepEqual(repeatedStabilize, { refreshed: 0, bytes: 0, skipped: '' });
});

test('volatile File-backed image refs recover only from a matching fresh snapshot', async () => {
  const imageBytes = new Uint8Array(128 * 1024);
  for (let i = 0; i < imageBytes.length; i++) imageBytes[i] = (i * 31) % 251;
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const initial = await WebContainer.createBoardContainerBlob(board, { 'img-1': imageBytes });
  const opened = await WebContainer.readBoardContainer(
    new File([initial.blob], 'stale-board.bf', { type: 'application/octet-stream' }),
    { lazyImageRefs: true, verifyImageCrc: false },
  );
  const source = opened.board.imageStore['img-1'];
  const staleBlob = source.__blob;

  const recovered = await WebContainer.recoverMatchingVolatileImageRefsFromContainer(
    board,
    opened.board.imageStore,
    new File([initial.blob], 'fresh-board.bf', { type: 'application/octet-stream' }),
  );
  assert.deepEqual(recovered, { refreshed: 1, bytes: imageBytes.length, skipped: '' });
  assert.equal(source.__blobVolatile, true);
  assert.notEqual(source.__blob, staleBlob);
  assert.deepEqual(await WebContainer.bytesForImageSourceAsync(source), imageBytes);

  const changedBytes = imageBytes.slice();
  changedBytes[changedBytes.length - 1] ^= 0xff;
  const changed = await WebContainer.createBoardContainerBlob(board, { 'img-1': changedBytes });
  const recoveredBlob = source.__blob;
  await assert.rejects(
    () => WebContainer.recoverMatchingVolatileImageRefsFromContainer(
      board,
      opened.board.imageStore,
      changed.blob,
    ),
    /saved image source changed for img-1/,
  );
  assert.equal(source.__blob, recoveredBlob);
  assert.deepEqual(await WebContainer.bytesForImageSourceAsync(source), imageBytes);
});

test('ZIP32 writer rejects fields that would otherwise be silently truncated', async () => {
  const entry = { name: 'x'.repeat(0x10000), data: new Uint8Array([1]) };
  await assert.rejects(
    () => WebContainer.createZipBlob([entry], { materializeBytes: false }),
    /ZIP entry name is too long/,
  );
});

test('Uint8Array lazy opens retain synchronous byte-backed compatibility', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const imageStore = { 'img-1': 'data:image/png;base64,AQIDBA==' };
  const payload = await WebContainer.createBoardContainerBlob(board, imageStore);

  const opened = await WebContainer.readBoardContainer(payload.bytes, {
    lazyImageRefs: true,
    verifyImageCrc: false,
  });
  const source = opened.board.imageStore['img-1'];

  assert.equal(opened.debug.read_mode, 'full-buffer');
  assert.equal(source.__blob, undefined);
  assert.ok(source.__lazy?.containerBytes);
  assert.deepEqual(WebContainer.bytesForImageSource(source), new Uint8Array([1, 2, 3, 4]));
});

test('read validates advertised image bytes before materializing image entries', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });
  const maxBoardContentBytes = payload.boardJsonBytes + 3;
  const validations = [];

  await assert.rejects(
    () => WebContainer.readBoardContainer(payload.blob, {
      maxBoardContentBytes,
      validateBoardPayload(next) {
        validations.push({ ...next });
        if ((next.boardJsonBytes || 0) + (next.imageBytes || 0) > maxBoardContentBytes) {
          throw new Error('board content limit');
        }
      },
    }),
    /board content limit/,
  );
  assert.ok(validations.some((next) => next.imageBytes === 4));
});

test('measures data URL payload bytes without base64 inflation', () => {
  assert.equal(WebContainer.dataUrlByteLength('data:image/png;base64,AQIDBA=='), 4);
});

test('creates byte-backed web image refs for inserted files', async () => {
  const source = WebContainer.createWebImageRef({
    path: 'images/img-2.jpg',
    mime: 'image/jpeg',
    ext: 'jpg',
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
  });

  assert.equal(WebContainer.isWebImageRef(source), true);
  assert.equal(source.bytes, 5);
  assert.deepEqual(WebContainer.bytesForImageSource(source), new Uint8Array([1, 2, 3, 4, 5]));
});

test('rejects tiny malformed containers without raw DataView range errors', async () => {
  await assert.rejects(
    () => WebContainer.readBoardContainer(new Uint8Array([0x50, 0x4b])),
    /unsupported Boardfish file/,
  );
});

test('board json CRC mismatch fails open', async () => {
  const payload = await WebContainer.createBoardContainerBlob({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
  }, {});
  const corrupt = new Uint8Array(payload.bytes);
  corrupt[storedZipEntryDataOffset(corrupt, 'board.json')] ^= 0xff;

  await assert.rejects(
    () => WebContainer.readBoardContainer(corrupt),
    /CRC mismatch for board\.json/,
  );
});

test('image CRC mismatch is reported as a warning while preserving recoverable data', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });
  const corrupt = new Uint8Array(payload.bytes);
  corrupt[storedZipEntryDataOffset(corrupt, 'images/img-1.png')] ^= 0xff;

  const result = await WebContainer.readBoardContainer(corrupt);

  assert.equal(result.debug.warnings.length, 1);
  assert.equal(result.debug.warnings[0].type, 'crc-mismatch');
  assert.equal(result.debug.warnings[0].path, 'images/img-1.png');
  assert.equal(WebContainer.bytesForImageSource(result.board.imageStore['img-1'])[0], 254);

  const unchecked = await WebContainer.readBoardContainer(corrupt, { verifyImageCrc: false });
  assert.equal(unchecked.debug.warnings.length, 0);
  assert.equal(WebContainer.bytesForImageSource(unchecked.board.imageStore['img-1'])[0], 254);
});

test('Blob lazy refs preserve default image CRC warning behavior', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });
  const corrupt = new Uint8Array(payload.bytes);
  corrupt[storedZipEntryDataOffset(corrupt, 'images/img-1.png')] ^= 0xff;

  const result = await WebContainer.readBoardContainer(new Blob([corrupt]), {
    lazyImageRefs: true,
  });

  assert.equal(result.debug.image_crc_count, 1);
  assert.equal(result.debug.warnings.length, 1);
  assert.equal(result.debug.warnings[0].type, 'crc-mismatch');
  assert.equal((await WebContainer.bytesForImageSourceAsync(result.board.imageStore['img-1']))[0], 254);
});

test('Blob random-access reads reject invalid local entry offsets and truncated entry data', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });
  const badOffset = new Uint8Array(payload.bytes);
  const badOffsetView = new DataView(badOffset.buffer, badOffset.byteOffset, badOffset.byteLength);
  const imageCentralOffset = centralDirectoryEntryOffset(badOffset, 'images/img-1.png');
  badOffsetView.setUint32(imageCentralOffset + 42, badOffset.length - 10, true);

  await assert.rejects(
    () => WebContainer.readBoardContainer(new Blob([badOffset]), {
      lazyImageRefs: true,
      verifyImageCrc: false,
    }),
    /invalid Boardfish container local entry images\/img-1\.png/,
  );

  const truncatedData = new Uint8Array(payload.bytes);
  const truncatedView = new DataView(truncatedData.buffer, truncatedData.byteOffset, truncatedData.byteLength);
  const truncatedCentralOffset = centralDirectoryEntryOffset(truncatedData, 'images/img-1.png');
  truncatedView.setUint32(truncatedCentralOffset + 20, truncatedData.length, true);
  truncatedView.setUint32(truncatedCentralOffset + 24, truncatedData.length, true);

  await assert.rejects(
    () => WebContainer.readBoardContainer(new Blob([truncatedData]), {
      lazyImageRefs: true,
      verifyImageCrc: false,
    }),
    /truncated Boardfish container entry images\/img-1\.png/,
  );
});

test('Blob lazy reads reject inconsistent stored entry sizes before creating refs', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });
  const corrupt = new Uint8Array(payload.bytes);
  const view = new DataView(corrupt.buffer, corrupt.byteOffset, corrupt.byteLength);
  const imageCentralOffset = centralDirectoryEntryOffset(corrupt, 'images/img-1.png');
  view.setUint32(imageCentralOffset + 24, 5, true);

  await assert.rejects(
    () => WebContainer.readBoardContainer(new Blob([corrupt]), {
      lazyImageRefs: true,
      verifyImageCrc: false,
    }),
    /invalid Boardfish container entry size images\/img-1\.png/,
  );
});

test('EOCD signatures inside a valid ZIP comment are ignored', async () => {
  const payload = await WebContainer.createBoardContainerBlob({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
  }, {});
  const comment = new Uint8Array(30);
  comment.set([0x50, 0x4b, 0x05, 0x06], 0);
  const commented = new Uint8Array(payload.bytes.length + comment.length);
  commented.set(payload.bytes);
  commented.set(comment, payload.bytes.length);
  const eocdOffset = payload.bytes.length - 22;
  new DataView(commented.buffer).setUint16(eocdOffset + 20, comment.length, true);

  const result = await WebContainer.readBoardContainer(new Blob([commented]));

  assert.equal(result.board.format, 'boardfish-container');
  assert.equal(result.debug.random_access, true);
});

test('saved image paths are canonicalized instead of preserving hostile manifest paths', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: '../evil.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
    ],
  };

  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
  });

  assert.equal(payload.imageEntries[0].path, 'images/img-1.png');
  assert.doesNotThrow(() => storedZipEntryDataOffset(payload.bytes, 'images/img-1.png'));
});

test('deflated entries abort when decompressed bytes exceed advertised size', async (t) => {
  if (typeof DecompressionStream !== 'function') return t.skip('DecompressionStream is unavailable');
  const boardJson = new TextEncoder().encode(JSON.stringify({
    version: 3,
    format: 'boardfish-container',
    imageStore: {},
    objects: [],
  }));
  const zip = createDeflatedZipWithAdvertisedSize('board.json', boardJson, 2);

  await assert.rejects(
    () => WebContainer.readBoardContainer(zip),
    /exceeds the board content limit|invalid Boardfish container entry size/,
  );
  await assert.rejects(
    () => WebContainer.readBoardContainer(new Blob([zip])),
    /exceeds the board content limit|invalid Boardfish container entry size/,
  );
});
