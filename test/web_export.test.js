'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/js/web_board_container.js');
require('../src/js/export_utils.js');

test('web image export writes original bytes to a picked folder', async () => {
  const previous = {
    BoardfishImageStore: globalThis.BoardfishImageStore,
    ExportDebug: globalThis.ExportDebug,
    Blob: globalThis.Blob,
    getRenderedImageDataUrl: globalThis.getRenderedImageDataUrl,
    imageNeedsRendering: globalThis.imageNeedsRendering,
    isNativeImageRef: globalThis.isNativeImageRef,
    performance: globalThis.performance,
    renderImageToCanvas: globalThis.renderImageToCanvas,
    showDirectoryPicker: globalThis.showDirectoryPicker,
  };
  const sourceBytes = new Uint8Array([1, 2, 3, 4]);
  const source = globalThis.BoardfishWebBoardContainer.bytesToDataUrl(sourceBytes, 'image/png');
  const writes = [];
  const directoryHandle = {
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getFileHandle(name, options) {
      assert.equal(options.create, true);
      return {
        async createWritable() {
          return {
            async write(blob) {
              writes.push({
                name,
                bytes: new Uint8Array(await blob.arrayBuffer()),
                type: blob.type,
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
  globalThis.getRenderedImageDataUrl = async () => '';
  globalThis.imageNeedsRendering = () => false;
  globalThis.isNativeImageRef = () => false;
  globalThis.renderImageToCanvas = () => null;
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
    assert.deepEqual([...writes[0].bytes], [...sourceBytes]);
    assert.equal(writes[0].type, 'image/png');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('web export keeps data URL image extensions lossless', () => {
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/png;base64,AQ=='), 'png');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/jpeg;base64,AQ=='), 'jpg');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/webp;base64,AQ=='), 'webp');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/gif;base64,AQ=='), 'gif');
});
