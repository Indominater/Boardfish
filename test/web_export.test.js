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
    canvasToPngBlob: globalThis.canvasToPngBlob,
    imageNeedsRendering: globalThis.imageNeedsRendering,
    isWebImageRef: globalThis.isWebImageRef,
    performance: globalThis.performance,
    renderImageToCanvas: globalThis.renderImageToCanvas,
    renderStoredImageToCanvas: globalThis.renderStoredImageToCanvas,
    showDirectoryPicker: globalThis.showDirectoryPicker,
  };
  const sourceBytes = new Uint8Array([1, 2, 3, 4]);
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
    assert.equal(writes[0].data, source.__blob);

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

test('web export keeps data URL image extensions lossless', () => {
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/png;base64,AQ=='), 'png');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/jpeg;base64,AQ=='), 'jpg');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/webp;base64,AQ=='), 'webp');
  assert.equal(globalThis.BoardfishExportUtils.guessImageExtFromDataUrl('data:image/gif;base64,AQ=='), 'gif');
});

test('web image export downloads one ZIP archive containing the original image bytes', async () => {
  const previous = {
    BoardfishImageStore: globalThis.BoardfishImageStore,
    ExportDebug: globalThis.ExportDebug,
    document: globalThis.document,
    imageNeedsRendering: globalThis.imageNeedsRendering,
    performance: globalThis.performance,
    renderImageToCanvas: globalThis.renderImageToCanvas,
    setTimeout: globalThis.setTimeout,
    URL: globalThis.URL,
  };
  const source = 'data:image/png;base64,AQID';
  const downloads = [];
  const objectUrls = [];

  globalThis.BoardfishImageStore = { getSource: () => source };
  globalThis.ExportDebug = {
    recordEventLoopYield() {},
    recordResolve() {},
    recordResolveDone() {},
    recordResolveProgress() {},
    recordResolveStart() {},
    recordSaveBatch() {},
    recordSaveDone() {},
    recordSaveStart() {},
    step() {},
  };
  globalThis.document = {
    body: { appendChild() {} },
    createElement(name) {
      assert.equal(name, 'a');
      return {
        style: {},
        click() {
          downloads.push({ href: this.href, download: this.download });
        },
        remove() {},
      };
    },
  };
  globalThis.imageNeedsRendering = () => false;
  globalThis.renderImageToCanvas = () => null;
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };
  globalThis.URL = {
    createObjectURL(blob) {
      const url = `blob:test-${objectUrls.length}`;
      objectUrls.push({ url, blob });
      return url;
    },
    revokeObjectURL() {},
  };

  try {
    const result = await globalThis.BoardfishExportUtils.downloadImageObjects(
      [
        { id: 'obj-1', type: 'image', data: { imgKey: 'img-1' } },
        { id: 'obj-2', type: 'image', data: { imgKey: 'img-2' } },
      ],
      null,
    );

    assert.equal(result.method, 'zip');
    assert.equal(result.downloadedCount, 2);
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].download, /^images_[0-9a-f]{6}\.zip$/);
    assert.equal(objectUrls.length, 1);
    assert.equal(objectUrls[0].blob.type, 'application/zip');
    const bytes = new Uint8Array(await objectUrls[0].blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const names = new Set();
    let offset = 0;
    for (let i = 0; i < 2; i++) {
      assert.equal(view.getUint32(offset, true), 0x04034b50);
      assert.equal(view.getUint16(offset + 8, true), 0, 'Image entries retain their original bytes');
      const size = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      assert.match(name, /^image_[0-9a-f]{6}\.png$/);
      names.add(name);
      const dataStart = offset + 30 + nameLength + extraLength;
      assert.deepEqual(bytes.slice(dataStart, dataStart + size), new Uint8Array([1, 2, 3]));
      offset = dataStart + size;
    }
    assert.equal(names.size, 2);
    assert.equal(view.getUint32(offset, true), 0x02014b50, 'Both images precede the ZIP directory');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
