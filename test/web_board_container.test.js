'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const WebContainer = require('../src/js/web_board_container.js');

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

function createDeflatedZipWithAdvertisedSize(name, data, advertisedSize) {
  const nameBytes = Buffer.from(name);
  const compressed = zlib.deflateRawSync(Buffer.from(data));
  const crc = WebContainer.crc32(data);
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
  assert.ok(payload.bytes[0] === 0x50 && payload.bytes[1] === 0x4b);

  const result = await WebContainer.readBoardContainer(payload.blob);
  assert.equal(result.board.version, 3);
  const source = result.board.imageStore['img-1'];
  assert.equal(WebContainer.isWebImageRef(source), true);
  assert.equal(source.mime, 'image/png');
  assert.equal(source.ext, 'png');
  assert.equal(source.bytes, 4);
  assert.equal(WebContainer.dataUrlForImageSource(source), imageStore['img-1']);
  assert.equal(result.debug.image_bytes, 4);
  assert.equal(result.imageEntries[0].path, 'images/img-1.png');

  const savedAgain = await WebContainer.createBoardContainerBlob(board, result.board.imageStore);
  assert.equal(savedAgain.imageBytes, 4);
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

test('failed reads do not eagerly create object URLs before image display', async () => {
  const board = {
    version: 3,
    format: 'boardfish-container',
    imageStore: {
      'img-1': { path: 'images/img-1.png', mime: 'image/png', ext: 'png' },
      'img-2': { path: 'images/img-2.png', mime: 'image/png', ext: 'png' },
    },
    objects: [
      { id: 'obj-1', type: 'image', x: 0, y: 0, w: 10, h: 10, z: 1, data: { imgKey: 'img-1' } },
      { id: 'obj-2', type: 'image', x: 12, y: 0, w: 10, h: 10, z: 2, data: { imgKey: 'img-2' } },
    ],
  };
  const payload = await WebContainer.createBoardContainerBlob(board, {
    'img-1': 'data:image/png;base64,AQIDBA==',
    'img-2': 'data:image/png;base64,BQYHCA==',
  });
  const created = [];
  const revoked = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    const url = `blob:boardfish-test-${created.length}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
  };
  try {
    await assert.rejects(
      () => WebContainer.readBoardContainer(payload.blob, {
        validateBoardPayload(next) {
          if ((next.imageBytes || 0) > 4) throw new Error('board content limit');
        },
      }),
      /board content limit/,
    );
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }

  assert.deepEqual(created, []);
  assert.deepEqual(revoked, []);
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
  assert.equal(source.dataUrl ? source.dataUrl.startsWith('data:image/jpeg;base64,') : true, true);
  assert.equal(WebContainer.bytesForImageSource(source).length, 5);
  assert.equal(WebContainer.dataUrlForImageSource(source), 'data:image/jpeg;base64,AQIDBAU=');
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
});
