'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function noopDebugApi() {
  return {
    start: () => null,
    step() {},
    end() {},
    count() {},
    max() {},
    wrap: async (_ctx, _command, call) => call(),
  };
}

function loadImageState(createImageBitmap) {
  const rafs = [];
  let now = 0;
  const context = {
    console,
    Map,
    Set,
    Promise,
    Error,
    Object,
    Number,
    Math,
    String,
    performance: { now: () => ++now },
    window: {},
    document: {
      createElement(name) {
        if (name !== 'canvas') return {};
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage() {},
              getImageData() { return { data: [0, 0, 0, 0] }; },
              save() {},
              translate() {},
              scale() {},
              rotate() {},
            };
          },
        };
      },
    },
    Image: function Image() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.complete = false;
    },
    clearTimeout() {},
    setTimeout() { return 0; },
    requestAnimationFrame(cb) {
      rafs.push(cb);
      return rafs.length;
    },
    invalidateOffscreen() {},
    scheduleRender() {},
    scheduleVisibleScaledVariantPrewarmAfterIdle() {},
    _bulkImageInsertDepth: 0,
    _boardOpening: false,
    _imageReadyLastRender: 0,
    hasTauri: () => false,
    tauriConvertFileSrc: (value) => value,
    SaveDebug: noopDebugApi(),
    ExportDebug: noopDebugApi(),
    OpenDebug: noopDebugApi(),
    ViewportDebug: noopDebugApi(),
    ClipDebug: noopDebugApi(),
    BoardfishTauri: {},
    TAURI_COMMANDS: { REGISTER_IMAGE_SOURCE: 'register_image_source' },
    clearScaledImageVariants() {},
    isSidewaysRotation: () => false,
    imageTransformFromObject: () => ({ rotation: 0, flipX: false, flipY: false }),
    setCanvasImageQuality() {},
    createImageBitmap,
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'image_state.js'), 'utf8'),
    context,
    { filename: 'image_state.js' },
  );
  return { context, rafs };
}

test('cacheImage keeps an existing current bitmap and closes a racing duplicate', async () => {
  let resolveBitmap;
  const duplicate = { closed: false, close() { this.closed = true; } };
  const existing = { closed: false, close() { this.closed = true; } };
  const { context, rafs } = loadImageState(() => new Promise((resolve) => {
    resolveBitmap = resolve;
  }));
  const src = 'data:image/png;base64,boardfish';
  const loadedImg = {
    naturalWidth: 16,
    naturalHeight: 16,
    currentSrc: src,
    src,
    complete: true,
  };

  context.imageStore['img-1'] = src;
  const ready = context.cacheImage('img-1', src, null, loadedImg, { skipSourceRegistration: true });
  assert.equal(rafs.length, 1);

  rafs.shift()();
  context.imageBitmapCache['img-1'] = existing;
  resolveBitmap(duplicate);

  const metrics = await ready;
  assert.equal(metrics.cacheReadyStage, 'bitmap');
  assert.equal(context.imageBitmapCache['img-1'], existing);
  assert.equal(existing.closed, false);
  assert.equal(duplicate.closed, true);
});
