'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadReadableImageSourceBlob, pngBytes } = require('../test-support/image_output.js');

require('../src/js/web_board_container.js');
require('../src/js/export_utils.js');

test('web image export writes original bytes to a picked folder', async () => {
  const previous = {
    BoardfishImageStore: globalThis.BoardfishImageStore,
    ExportDebug: globalThis.ExportDebug,
    Blob: globalThis.Blob,
    canvasToPngBlob: globalThis.canvasToPngBlob,
    imageNeedsRendering: globalThis.imageNeedsRendering,
    isWebImageRef: globalThis.isWebImageRef,
    performance: globalThis.performance,
    renderImageToCanvas: globalThis.renderImageToCanvas,
    renderStoredImageToCanvas: globalThis.renderStoredImageToCanvas,
    readableImageSourceBlob: globalThis.readableImageSourceBlob,
    showDirectoryPicker: globalThis.showDirectoryPicker,
  };
  const sourceBytes = new Uint8Array(pngBytes);
  const source = globalThis.BoardfishWebBoardContainer.createWebImageRef({
    path: 'images/img-1.png',
    mime: 'image/png',
    ext: 'png',
    blob: new Blob([sourceBytes], { type: 'image/png' }),
  });
  const writes = [];
  const directoryHandle = {
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getFileHandle(name, options) {
      assert.equal(options.create, true);
      return {
        async createWritable() {
          return {
            async write(data) {
              writes.push({
                name,
                data,
                type: data.type || '',
              });
            },
            async close() {},
          };
        },
      };
    },
  };

  globalThis.BoardfishImageStore = { getSource: () => source };
  globalThis.ExportDebug = {
    recordSaveBatch() {},
    recordSaveDone() {},
    recordSaveStart() {},
    step() {},
  };
  globalThis.imageNeedsRendering = () => false;
  globalThis.isWebImageRef = (value) => globalThis.BoardfishWebBoardContainer.isWebImageRef(value);
  globalThis.renderImageToCanvas = () => null;
  globalThis.readableImageSourceBlob = loadReadableImageSourceBlob();
  globalThis.showDirectoryPicker = async () => directoryHandle;

  try {
    const result = await globalThis.BoardfishExportUtils.downloadImageObjects(
      [{ id: 'obj-1', type: 'image', data: { imgKey: 'img-1' } }],
      null,
      { targetMode: 'folder' },
    );
    assert.equal(result.method, 'directory-picker');
    assert.equal(result.downloadedCount, 1);
    assert.equal(writes.length, 1);
    assert.match(writes[0].name, /^image_[0-9a-f]{6}\.png$/);
    assert.equal(writes[0].type, 'image/png');
    assert.deepEqual(new Uint8Array(await writes[0].data.arrayBuffer()), sourceBytes);

    const renderedBytes = new Uint8Array([137, 80, 78, 71]);
    const renderedBlob = new Blob([renderedBytes], { type: 'image/png' });
    Object.defineProperty(renderedBlob, 'arrayBuffer', {
      value() { throw new Error('export should not materialize the encoded PNG'); },
    });
    let fallbackSource = null;
    globalThis.BoardfishImageStore = { getSource: () => source };
    globalThis.imageNeedsRendering = () => true;
    globalThis.renderImageToCanvas = () => null;
    globalThis.renderStoredImageToCanvas = async (_obj, value) => {
      fallbackSource = value;
      return { width: 8, height: 8 };
    };
    globalThis.canvasToPngBlob = async () => renderedBlob;
    await globalThis.BoardfishExportUtils.downloadImageObjects(
      [{ id: 'obj-2', type: 'image', data: { imgKey: 'img-2', rotation: 90 } }], null, { targetMode: 'folder' },
    );
    assert.equal(fallbackSource, source);
    assert.equal(writes[1].data, renderedBlob);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('exports recover broken source bytes as PNGs in downloads, folders, and ZIP archives', async (t) => {
  const container = globalThis.BoardfishWebBoardContainer;
  const unreadable = new Blob([pngBytes], { type: 'image/jpeg' });
  Object.defineProperty(unreadable, 'stream', { value() { throw new Error('stale file snapshot'); } });
  const sources = {
    stale: container.createWebImageRef({ mime: 'image/jpeg', ext: 'jpg', blob: unreadable }),
    corrupt: container.createWebImageRef({ mime: 'image/png', blob: new Blob(['broken']) }),
    dataUrl: 'data:image/png;base64,not%%%base64',
    missing: null,
  };
  const writes = [];
  const rendered = new Blob([pngBytes], { type: 'image/png' });
  const overrides = {
    BoardfishImageStore: { getSource: (key) => sources[key] },
    BoardfishRuntime: { downloadBlob: (data, name) => writes.push({ name, data }) },
    ExportDebug: { step() {}, recordSaveBatch() {}, recordSaveDone() {}, recordSaveStart() {} },
    imageNeedsRendering: () => false,
    isWebImageRef: container.isWebImageRef,
    readableImageSourceBlob: loadReadableImageSourceBlob(),
    renderImageToCanvas: () => ({ width: 192, height: 192 }),
    renderStoredImageToCanvas: async () => null,
    canvasToPngBlob: async () => rendered,
    showSaveFilePicker: undefined,
    showDirectoryPicker: undefined,
  };
  for (const [key, value] of Object.entries(overrides)) {
    const previous = globalThis[key];
    globalThis[key] = value;
    t.after(() => { if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; });
  }
  const objects = Object.keys(sources).map((key) => ({ id: key, type: 'image', data: { imgKey: key } }));
  const single = await globalThis.BoardfishExportUtils.downloadImageObjects([objects[0]], null, { filename: 'recovered.jpg' });
  assert.equal(single.downloadedCount, 1);
  assert.equal(writes[0].name, 'recovered.png');
  assert.equal(writes[0].data, rendered);

  globalThis.showDirectoryPicker = async () => ({
    async getFileHandle(name) {
      return { async createWritable() { return {
        async write(data) { writes.push({ name, data }); },
        async close() {},
      }; } };
    },
  });
  const folder = await globalThis.BoardfishExportUtils.downloadImageObjects(objects, null, { targetMode: 'folder' });
  assert.equal(folder.downloadedCount, objects.length);
  for (const entry of writes.slice(1)) {
    assert.match(entry.name, /\.png$/);
    assert.equal(entry.data, rendered);
  }

  const zipped = await globalThis.BoardfishExportUtils.downloadImageObjects(objects, null);
  assert.equal(zipped.downloadedCount, objects.length);
  assert.equal(writes.at(-1).data.type, 'application/zip');
  const zipBytes = Buffer.from(await writes.at(-1).data.arrayBuffer());
  assert.equal(zipBytes.subarray(0, 4).toString('hex'), '504b0304');
  assert.doesNotMatch(zipBytes.toString('latin1'), /image_[a-f0-9]+\.jpg/);
  assert.equal(zipBytes.toString('latin1').match(/image_[a-f0-9]+\.png/g).length, objects.length * 2);
});

test('web export keeps data URL image extensions lossless', () => {
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/png;base64,AQ=='), 'png');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/jpeg;base64,AQ=='), 'jpg');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/webp;base64,AQ=='), 'webp');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/gif;base64,AQ=='), 'gif');
});
