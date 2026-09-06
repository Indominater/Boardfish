'use strict';

(function textPanelBenchmark() {
  const WIDTH = 400, HEIGHT = 300;
  const $ = (id) => document.getElementById(id);
  const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const round = (n) => Math.round(n * 1000) / 1000;
  const canvases = { gpu: $('gpu'), fallback: $('fallback') };
  const contexts = { fallback: canvases.fallback.getContext('2d') };
  const captures = new Map(), events = [];
  const sources = {};
  let current = { scale: 1, dpr: 2, panX: 0, panY: 0, theme: 'dark' }, result = null, busy = false;

  function bounds(obj, viewport) {
    return obj.x <= viewport.x2 && obj.x + obj.w >= viewport.x1 && obj.y <= viewport.y2 && obj.y + obj.h >= viewport.y1;
  }

  const boardRenderer = BoardfishRenderer.createBoardRenderer({
    objects: () => objects,
    zoom: () => current.scale, dpr: () => current.dpr,
    panX: () => current.panX, panY: () => current.panY,
    canvasTextColor: () => current.theme === 'light' ? '#16161a' : '#fbfbfe',
    font: FONT, fontSize: FONT_SIZE, textPad: TEXT_PAD, lineHeight: LINE_H,
    getTextLayout, getTextLayoutForViewport, drawTextLineRange,
    textPanelStyle: () => BoardfishTextPanels.getStyle(),
    imageBitmapCache: () => sources, imageStore: () => sources,
    selectImageSourceForDraw: (key) => ({ source: sources[key], scale: 1, targetScale: 1 }),
    currentViewportWorldRect: viewport,
    viewportCullingEnabled: () => true,
    objectIntersectsRect: bounds,
  });

  function viewport() {
    return { x1: -current.panX / current.scale, y1: -current.panY / current.scale,
      x2: (WIDTH - current.panX) / current.scale, y2: (HEIGHT - current.panY) / current.scale };
  }

  function text(id, x, y, w, h, content = '') {
    return { id, type: 'text', x, y, w, h, z: objects.length + 1, data: { content } };
  }

  function image(id, x, y, w, h, key) {
    return { id, type: 'image', x, y, w, h, z: objects.length + 1, data: { imgKey: key } };
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['scale', 'dpr', 'style', 'checks', 'overlap', 'separated']) $(id).disabled = value;
  }

  function resize(dpr) {
    for (const canvas of Object.values(canvases)) {
      if (canvas.width !== WIDTH * dpr) canvas.width = WIDTH * dpr;
      if (canvas.height !== HEIGHT * dpr) canvas.height = HEIGHT * dpr;
    }
  }

  function prepare(scene, settings = {}) {
    objects = scene;
    current = { scale: 1, dpr: 2, panX: 0, panY: 0, theme: 'dark', ...settings };
    resize(current.dpr);
    document.body.dataset.theme = current.theme;
    BoardfishTextPanels.refreshStyle();
    for (const obj of objects) {
      if (obj.type !== 'text') continue;
      for (const line of getTextLayout(obj)) prepareTextLineForDraw(line);
    }
  }

  function draw(mode = 'gpu', planned = true, collect = false) {
    const context = contexts[mode], view = { zoom: current.scale, dpr: current.dpr }, rect = viewport();
    context.beginFrame?.(objects);
    if (mode === 'fallback') beginTextRasterFrame();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = current.theme === 'light' ? '#eaeaed' : '#1c1b22';
    context.fillRect(0, 0, canvases[mode].width, canvases[mode].height);
    boardRenderer.setWorldCanvasTransform(context);
    context.font = FONT;
    context.textBaseline = 'alphabetic';
    configureTextCanvasContext(context);
    const counters = collect ? boardRenderer.createDrawCounters() : null;
    if (planned) {
      boardRenderer.drawVisibleObjects(context, counters, rect, null, null, false, view);
    } else {
      for (const obj of objects) {
        const visible = obj.type === 'text' ? BoardfishTextPanels.intersectsViewport(obj, rect) : bounds(obj, rect);
        if (visible) boardRenderer.drawSingleObj(context, obj, counters, rect, view);
      }
    }
    context.endFrame?.();
    return counters;
  }

  function stats() { return { ...contexts.gpu.getStats() }; }
  function delta(before, after) {
    return Object.fromEntries(Object.entries(after).filter(([key, value]) => Number.isFinite(value) && Number.isFinite(before[key]))
      .map(([key, value]) => [key, round(value - before[key])]));
  }

  function readPixels(mode) {
    const canvas = document.createElement('canvas');
    canvas.width = canvases[mode].width; canvas.height = canvases[mode].height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvases[mode], 0, 0);
    return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }

  function pixelHash(pixels) {
    let hash = 2166136261;
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
    return (hash >>> 0).toString(16);
  }

  function capture(mode = 'gpu', name = mode) {
    const { canvas, pixels } = readPixels(mode), url = canvas.toDataURL('image/png');
    captures.set(name, url);
    const link = $(`${mode}-png`);
    link.href = url; link.download = `boardfish-text-panel-${name}.png`;
    return { name, width: canvas.width, height: canvas.height, checksum: pixelHash(pixels) };
  }

  function pixelDifference(a, b) {
    let total = 0, max = 0, changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      let local = 0;
      for (let c = 0; c < 4; c++) {
        const difference = Math.abs(a[i + c] - b[i + c]);
        total += difference; local += difference; max = Math.max(max, difference);
      }
      if (local > 0) changed++;
    }
    return { identical: changed === 0, changedPixels: changed, maxChannelDifference: max,
      meanAbsoluteChannelDifference: round(total / a.length) };
  }

  function pixelAt(pixels, x, y) {
    const i = (Math.floor(y * current.dpr) * WIDTH * current.dpr + Math.floor(x * current.dpr)) * 4;
    return [...pixels.subarray(i, i + 4)];
  }

  function brightPixelsInside(pixels, obj) {
    let count = 0;
    const left = Math.ceil((obj.x + TEXT_PAD) * current.dpr), right = Math.floor((obj.x + obj.w - TEXT_PAD) * current.dpr);
    const top = Math.ceil((obj.y + TEXT_PAD) * current.dpr), bottom = Math.floor((obj.y + obj.h - TEXT_PAD) * current.dpr);
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const i = (y * WIDTH * current.dpr + x) * 4;
      if (pixels[i] > 225 && pixels[i + 1] > 225 && pixels[i + 2] > 225) count++;
    }
    return count;
  }

  function publish(value) {
    result = value;
    $('json').textContent = JSON.stringify(value, null, 2);
    $('downloads').replaceChildren();
    for (const [name, url] of captures) {
      const link = document.createElement('a');
      link.textContent = name; link.href = url; link.download = `boardfish-text-panel-${name}.png`;
      $('downloads').appendChild(link);
    }
    return value;
  }

  function baseResult(study) {
    return { study, createdAt: new Date().toISOString(), browser: navigator.userAgent,
      actualDevicePixelRatio: window.devicePixelRatio, config: { ...current },
      style: BoardfishTextPanels.getStyle(), cssSquircleSupported: CSS.supports('corner-shape', 'squircle'),
      events: events.slice(), hidden: document.hidden };
  }

  function cssReference(obj) {
    const menu = $('ctx-menu');
    Object.assign(menu.style, { left: `${obj.x * current.scale + current.panX}px`, top: `${obj.y * current.scale + current.panY}px`,
      width: `${obj.w}px`, height: `${obj.h}px`, transform: `scale(${current.scale})` });
    menu.textContent = obj.data.content;
    $('css-reference').style.background = current.theme === 'light' ? '#eaeaed' : '#1c1b22';
  }

  function referenceBounds() {
    const rect = $('css-reference').getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      requiredBrowserDprForNativeComparison: current.dpr };
  }

  async function compareStyle(options = {}) {
    await ready;
    const scale = options.scale ?? Number($('scale').value), dpr = options.dpr ?? Number($('dpr').value);
    prepare([text('style-panel', 25, 20, 150, 90, options.content ?? '')], { scale, dpr, theme: options.theme ?? 'dark' });
    cssReference(objects[0]);
    const samples = {};
    for (const mode of ['gpu', 'fallback']) {
      draw(mode); samples[mode] = capture(mode, `style-${scale}x-dpr${dpr}-${mode}`);
    }
    const computed = getComputedStyle($('ctx-menu'));
    $('status').textContent = `Style comparison at ${scale * 100}%, DPR ${dpr}. CSS reference uses the actual context-menu stylesheet.`;
    return publish({ ...baseResult('Text panel versus context-menu CSS'), samples, referenceBounds: referenceBounds(),
      referenceStyle: { background: computed.backgroundColor, color: computed.color, border: computed.border,
        borderRadius: computed.borderRadius, cornerShape: computed.cornerShape, boxShadow: computed.boxShadow } });
  }

  function makeSources() {
    for (const [name, alpha] of [['opaque', 1], ['translucent', 0.5]]) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d');
      context.fillStyle = `rgba(240,72,32,${alpha})`; context.fillRect(0, 0, 32, 32);
      if (name === 'translucent') context.clearRect(12, 0, 8, 32);
      sources[name] = canvas;
    }
  }

  async function tallPanelPrecision(options = {}) {
    await ready;
    // Keep the unit-test fixture's bottom edge visible, even when the rest of
    // the benchmark runs at DPR 1. Matrices below are in device pixels.
    const dpr = Math.max(2, options.dpr ?? 2), bottomDevicePx = 480.3125, xDevicePx = 20.125;
    prepare([], { dpr });
    const context = contexts.gpu, style = BoardfishTextPanels.getStyle();
    const before = stats(), comparisons = [];
    function drawPanel(height, scale, name) {
      const obj = text(`precision-${name}`, 0, 0.125, 320, height);
      const translationY = bottomDevicePx - (height + obj.y) * scale;
      context.beginFrame([obj]);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#1c1b22';
      context.fillRect(0, 0, canvases.gpu.width, canvases.gpu.height);
      context.setTransform(scale, 0, 0, scale, xDevicePx, translationY);
      context.drawTextPanel(obj, style);
      context.endFrame();
      const pixels = readPixels('gpu').pixels;
      const sample = capture('gpu', `precision-bottom-${scale}-${name}-dpr${dpr}`);
      const pixel = (x, y) => [...pixels.subarray((y * canvases.gpu.width + x) * 4, (y * canvases.gpu.width + x) * 4 + 4)];
      return { pixels, sample, height, transform: [scale, 0, 0, scale, xDevicePx, translationY],
        interiorPixel: pixel(80, 470), belowEdgePixel: pixel(80, 490), belowShadowPixel: pixel(80, 570) };
    }
    for (const scale of [0.697, 0.713, 1.31]) {
      const tall = drawPanel(2400000.25, scale, 'tall');
      const reference = drawPanel(2000.25, scale, 'reference');
      comparisons.push({ deviceScale: scale, bottomDevicePx, xDevicePx,
        tall: { ...tall, pixels: undefined }, reference: { ...reference, pixels: undefined },
        difference: pixelDifference(tall.pixels, reference.pixels),
        opaqueInteriorCorrect: tall.interiorPixel.join(',') === '66,65,77,255',
        visibleBottomVerified: tall.interiorPixel.join(',') !== tall.belowShadowPixel.join(',') });
    }
    const after = stats();
    return { dpr, widthDevicePx: canvases.gpu.width, heightDevicePx: canvases.gpu.height,
      matricesMatchUnitFixture: true, comparisons, counterDelta: delta(before, after),
      allIdentical: comparisons.every((row) => row.difference.identical),
      allBottomsVisible: comparisons.every((row) => row.opaqueInteriorCorrect && row.visibleBottomVerified) };
  }

  async function checks(options = {}) {
    await ready;
    const dpr = options.dpr ?? 2;
    const fixtures = [
      { name: 'fully-covered-panels', scene: [text('covered', 100, 80, 150, 80, 'LOWER TEXT'), text('cover', 20, 10, 360, 280, 'TOP LAYER')] },
      { name: 'identical-panel-shadows', scene: Array.from({ length: 12 }, (_, i) => text(`same-${i}`, 60, 50, 230, 150, i === 11 ? 'TOP LAYER' : 'HIDDEN TEXT')) },
      { name: 'staggered-corners-shadows', scene: Array.from({ length: 8 }, (_, i) => text(`stagger-${i}`, 20 + i * 24, 15 + i * 18, 185, 125, `Layer ${i}\nSharp ASCII`)) },
      { name: 'empty-text-panel', scene: [text('empty', 80, 60, 180, 100)] },
      { name: 'mixed-transparent-image', scene: [image('base', 15, 15, 340, 240, 'opaque'), text('middle', 55, 45, 260, 180, 'TEXT BETWEEN IMAGES'), image('alpha', 110, 85, 240, 140, 'translucent'), text('top', 180, 155, 190, 95, 'TOP TEXT')] },
      { name: 'shadow-from-offscreen', scene: [text('outside', -180, 55, 176, 100), text('edge', 315, -35, 160, 100, 'EDGE')] },
      { name: 'light-theme-text', scene: [text('light', 60, 50, 280, 150, 'WHITE ASCII TEXT\nGeist 0123456789')], theme: 'light' },
    ];
    const comparisons = [];
    for (const fixture of fixtures) {
      prepare(fixture.scene, { dpr, theme: fixture.theme ?? 'dark' });
      draw('gpu', false);
      const reference = readPixels('gpu').pixels;
      const painter = capture('gpu', `${fixture.name}-painter-dpr${dpr}`);
      const before = stats(), counters = draw('gpu', true, true), after = stats();
      const planned = readPixels('gpu').pixels;
      const preview = capture('gpu', `${fixture.name}-planned-dpr${dpr}`);
      comparisons.push({ name: fixture.name, painter, planned: preview, counters,
        difference: pixelDifference(reference, planned), gpuCounterDelta: delta(before, after),
        centerPixel: pixelAt(planned, 150, 100),
        ...(fixture.name === 'empty-text-panel' ? { opaqueFillCorrect: pixelAt(planned, 150, 100).join(',') === '66,65,77,255' } : {}),
        ...(fixture.name === 'light-theme-text' ? { whiteTextInkPixels: brightPixelsInside(planned, fixture.scene[0]) } : {}),
        ...(fixture.name === 'shadow-from-offscreen' ? { offscreenShadowPixel: pixelAt(planned, 0, 90) } : {}),
      });
    }

    const precision = await tallPanelPrecision({ dpr });
    prepare([text('warm', 35, 35, 300, 210, 'Warm retained ASCII text\n0123456789 AVATAR office\nPanning and zooming keep glyphs.')], { dpr });
    draw();
    const before = stats();
    for (let i = 0; i < 45; i++) {
      current.scale = 0.7 + i * 0.025;
      current.panX = (i % 7) * 0.375; current.panY = (i % 9) * 0.25;
      draw();
    }
    const after = stats();
    const motionPixels = readPixels('gpu').pixels;
    await raf(); draw();
    const restPixels = readPixels('gpu').pixels;
    const warm = { frames: 45, before, after, counterDelta: delta(before, after),
      motionVersusRest: pixelDifference(motionPixels, restPixels),
      capture: capture('gpu', `warm-retained-text-dpr${dpr}`) };
    draw('fallback'); capture('fallback', `warm-fallback-dpr${dpr}`);
    const allIdentical = comparisons.every((row) => row.difference.identical) && precision.allIdentical;
    $('status').textContent = `${comparisons.length} layering and 3 tall-panel cases: ${allIdentical ? 'pixel-identical to their references' : 'differences require inspection'}. Warm geometry uploads: ${warm.counterDelta.bufferUploads}.`;
    return publish({ ...baseResult('Panel ordering, shadow coverage, and retained glyph checks'), comparisons, precision, warm, allIdentical });
  }

  function workload(name, count) {
    if (name === 'overlap') {
      const scene = Array.from({ length: count - 1 }, (_, i) => text(`hidden-${i}`, 110 + i % 3, 85 + i % 5, 130, 75, `Hidden ${i}`));
      scene.push(text('visible-top', 12, 8, 376, 280, 'Top visible panel\nThe lower boxes and their shadows\nfit inside this opaque surface.'));
      return { scene, scale: 1 };
    }
    const cols = Math.ceil(Math.sqrt(count * WIDTH / HEIGHT)), rows = Math.ceil(count / cols);
    return { scene: Array.from({ length: count }, (_, i) => text(`separated-${i}`, (i % cols) * 210 + 30, Math.floor(i / cols) * 130 + 30, 150, 70, `Box ${i}\nASCII text`)),
      scale: Math.min(WIDTH / (cols * 210 + 30), HEIGHT / (rows * 130 + 30)) };
  }

  function distribution(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return { median: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
      p95: round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0), max: round(sorted.at(-1) ?? 0) };
  }

  async function run(options = {}) {
    await ready;
    if (busy) throw new Error('A benchmark is already running.');
    setBusy(true);
    try {
      const name = options.workload ?? 'overlap', count = options.count ?? 1000, frames = options.frames ?? 90, dpr = options.dpr ?? 2;
      const fixture = workload(name, count);
      const preparationStart = performance.now();
      prepare(fixture.scene, { scale: fixture.scale, dpr });
      const preparationMs = round(performance.now() - preparationStart), initialScale = current.scale;
      const renderers = {};
      // Both paths use the current GPU shader; only visibility planning differs.
      for (const mode of ['painter', 'planned']) {
        const planned = mode === 'planned';
        contexts.gpu.resetResources();
        for (let i = 0; i < 12; i++) { await raf(); draw('gpu', planned); }
        const before = stats(), samples = [];
        for (let i = 0; i < frames; i++) {
          $('status').textContent = `${name}: ${mode}, frame ${i + 1}/${frames}`;
          const startRaf = await raf();
          current.scale = initialScale * (0.985 + (i % 17) * 0.001);
          current.panX = (i % 11) * 0.25; current.panY = (i % 7) * 0.25;
          const started = performance.now(); draw('gpu', planned);
          const cpuMs = performance.now() - started;
          const endRaf = await raf();
          samples.push({ cpuMs: round(cpuMs), rafMs: round(endRaf - startRaf), hidden: document.hidden });
        }
        const after = stats();
        renderers[mode] = { cpuMs: distribution(samples.map((row) => row.cpuMs)), rafMs: distribution(samples.map((row) => row.rafMs)),
          hiddenSamples: samples.filter((row) => row.hidden).length, intervalsOver25ms: samples.filter((row) => row.rafMs > 25).length,
          before, after, counterDelta: delta(before, after), samples };
      }
      const counters = draw('gpu', true, true);
      const preview = capture('gpu', `${name}-${count}-dpr${dpr}`);
      draw('fallback'); capture('fallback', `${name}-${count}-fallback-dpr${dpr}`);
      $('status').textContent = `${name}: painter CPU p95 ${renderers.painter.cpuMs.p95} ms; planned ${renderers.planned.cpuMs.p95} ms.`;
      return publish({ ...baseResult('Production panel visibility benchmark'), workload: name, count, frames, preparationMs,
        renderers, counters, preview,
        limits: ['CPU and rAF measurements are not GPU execution times.', 'All timing requires the browser tab to remain foreground.',
          'The separated 1000-box view uses small-scale text to keep every object onscreen.'] });
    } finally { setBusy(false); }
  }

  async function action(fn) {
    try { return await fn(); }
    catch (error) { $('status').textContent = String(error); publish({ error: error.stack || String(error) }); throw error; }
  }

  const ready = (async () => {
    const started = performance.now();
    await document.fonts.load(FONT, 'Boardfish'); await document.fonts.ready;
    refreshTextMetrics(); makeSources();
    let resolveReady, rejectReady;
    const fontReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const timer = setTimeout(() => rejectReady(new Error('GPU font loading timed out.')), 15000);
    contexts.gpu = BoardfishGpuRenderer.createContext(canvases.gpu, {
      font: { ...BoardfishAsciiFont, atlasURL: '../fonts/geist-ascii-msdf.png',
        largeFont: { ...BoardfishAsciiFont.largeFont, atlasURL: '../fonts/geist-ascii-large-msdf.png' } },
      onReady() { events.push({ name: 'ready', atMs: round(performance.now() - started) }); resolveReady(); },
      onLost() { events.push({ name: 'lost' }); },
      onError(error) { events.push({ name: 'error', message: String(error) }); rejectReady(error); },
    });
    try {
      if (!contexts.gpu) throw new Error('WebGL2 is unavailable.');
      await fontReady;
      if (typeof contexts.gpu.drawTextPanel !== 'function') throw new Error('The GPU text-panel renderer is not installed.');
      setBusy(false);
      $('status').textContent = 'Ready. Choose a style comparison, layer check, or performance workload.';
    } finally { clearTimeout(timer); }
    return { readyMs: round(performance.now() - started), stats: stats() };
  })();

  window.textPanelBenchmark = Object.freeze({ ready, compareStyle, checks, tallPanelPrecision, run, referenceBounds,
    getCapture: (name) => captures.get(name) ?? null, captureNames: () => [...captures.keys()],
    getResult: () => result, getStats: stats });
  $('style').addEventListener('click', () => action(() => compareStyle()));
  $('checks').addEventListener('click', () => action(() => checks()));
  $('overlap').addEventListener('click', () => action(() => run({ workload: 'overlap' })));
  $('separated').addEventListener('click', () => action(() => run({ workload: 'separated' })));
  ready.catch((error) => { $('status').textContent = String(error); publish({ error: error.stack || String(error), events }); });
})();
