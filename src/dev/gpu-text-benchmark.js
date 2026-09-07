'use strict';

(function productionGpuTextBenchmark() {
  const WIDTH = 400, HEIGHT = 256;
  const MODES = ['retained', 'gpu'];
  const BACKGROUND = '#1e1e24';
  const FOREGROUND = '#ededf2';
  const $ = (id) => document.getElementById(id);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const round = (value) => Math.round(value * 1000) / 1000;
  const canvases = Object.fromEntries(MODES.map((mode) => [mode, $(mode)]));
  const contexts = { retained: canvases.retained.getContext('2d') };
  const rendererEvents = [];
  let current = null, busy = false, result = null, init = null;

  function setBusy(value) {
    busy = value;
    for (const id of ['dpr', 'scale', 'reading', 'dense', 'zoom', 'mixed', 'lifecycle', 'context', 'precision']) $(id).disabled = value;
  }

  function object(id, content, x = 0, y = 0, width = 1000) {
    return { id, type: 'text', x, y, w: width, h: 1, z: 1, data: { content } };
  }

  function fixtures(workload) {
    if (workload === 'dense') {
      const prose = Array.from({ length: 64 }, (_, i) => `Paragraph ${i + 1}: A quick brown fox jumps over the lazy dog. Boardfish keeps exact selection positions and wraps each sentence to the available width. ASCII 0123456789 !@#$%^&*() []{} <> ? / \\`).join('\n');
      return Array.from({ length: 24 }, (_, i) => object(`dense-${i}`, `Textbox ${i + 1}\n${prose}`, (i % 6) * 500, Math.floor(i / 6) * 4200, 480));
    }
    return [object('reading', [
      'Boardfish: sharp text at fractional positions.',
      'A quick brown fox jumps over the lazy dog.',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz 0123456789',
      '! " # $ % & \' ( ) * + , - . / : ; < = > ?',
      '@ [ \\ ] ^ _ ` { | } ~ AVATAR Toffee office',
      'affinity ffi ff fi fl ft tt ttt Hgjpqy',
      'Tabs:\talpha\tbeta\tgamma',
      '\tconst sum = (a, b) => a + b;',
      'Whitespace:   one  two   three',
      'thin stems: illl IIII 1111 |||| [](){}',
      'ASCII glyphs share retained GPU geometry.',
    ].join('\n'))];
  }

  function config(workload, scale = Number($('scale').value)) {
    return { workload, scale, dpr: Number($('dpr').value), widthCss: WIDTH, heightCss: HEIGHT, offsetCss: 0.375 };
  }

  function prepareRows(allObjects, settings, minimumScale = settings.scale) {
    const started = performance.now();
    const viewport = { x1: -16 / minimumScale, y1: -16 / minimumScale, x2: (WIDTH + 16) / minimumScale, y2: (HEIGHT + 16) / minimumScale };
    const entries = [];
    for (const obj of allObjects) {
      if (obj.type !== 'text') { entries.push({ obj }); continue; }
      if (obj.x > viewport.x2 || obj.x + obj.w < viewport.x1 || obj.y > viewport.y2) continue;
      syncTextAutoHeight(obj);
      if (obj.y + obj.h < viewport.y1) continue;
      const layout = getTextLayoutForViewport(obj, viewport);
      for (const line of layout) prepareTextLineForDraw(line);
      entries.push({ obj, layout });
    }
    return {
      entries,
      diagnostics: {
        layoutAndPlansMs: round(performance.now() - started), viewportWorld: viewport,
        totalObjects: allObjects.length, submittedObjects: entries.length,
        submittedLines: entries.reduce((sum, entry) => sum + (entry.layout?.length || 0), 0),
        submittedCharacters: entries.reduce((sum, entry) => sum + (entry.layout || []).reduce((n, line) => n + line.text.length, 0), 0),
        visibilityPolicy: 'Fixed whole-object overlap and existing vertical layout rows selected at the largest world viewport; every horizontal character is submitted throughout each run.',
      },
    };
  }

  function draw(mode, index = null, zoomScale = current.config.scale, cameraCss = null) {
    const context = contexts[mode], settings = current.config;
    const panX = index == null ? 0 : (index % 16) * 0.375;
    const panY = index == null ? 0 : (index % 13) * 0.25;
    if (mode === 'gpu') context.beginFrame(objects);
    else beginTextRasterFrame();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, canvases[mode].width, canvases[mode].height);
    const density = zoomScale * settings.dpr;
    context.setTransform(density, 0, 0, density,
      (cameraCss ? cameraCss.x : settings.offsetCss + panX) * settings.dpr,
      (cameraCss ? cameraCss.y : settings.offsetCss + panY) * settings.dpr);
    context.font = FONT;
    context.textBaseline = 'alphabetic';
    configureTextCanvasContext(context);
    context.fillStyle = FOREGROUND;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    for (const { obj, layout } of current.prepared.entries) {
      if (obj.type === 'image') {
        context.drawImage(obj.source, obj.x, obj.y, obj.w, obj.h);
        continue;
      }
      if (mode === 'gpu' && context.drawTextLayout(layout, obj, {
        fontSize: FONT_SIZE, padding: TEXT_PAD, lineHeight: LINE_H, baselineOffset: TEXT_BASELINE_Y_OFFSET,
      })) continue;
      for (const line of layout) drawTextLineRange(context, line, obj, 0, line.text.length, { collectStats: false });
    }
    if (mode === 'gpu') context.endFrame();
  }

  function visibility() {
    return {
      hidden: document.hidden, visibilityState: document.visibilityState,
      canvases: Object.fromEntries(MODES.map((mode) => {
        const rect = canvases[mode].getBoundingClientRect();
        return [mode, {
          mounted: canvases[mode].isConnected,
          fullyInViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          cssWidth: rect.width, cssHeight: rect.height,
          backingWidth: canvases[mode].width, backingHeight: canvases[mode].height,
        }];
      })),
    };
  }

  function stats() {
    return JSON.parse(JSON.stringify(contexts.gpu.getStats()));
  }

  function delta(before, after) {
    return Object.fromEntries(Object.keys(after).filter((key) => Number.isFinite(after[key]) && Number.isFinite(before[key])).map((key) => [key, round(after[key] - before[key])]));
  }

  function capture(mode) {
    const link = $(`${mode}-png`);
    link.href = canvases[mode].toDataURL('image/png');
    link.download = `boardfish-production-${mode}-${current.config.workload}-${current.config.scale}x-dpr${current.config.dpr}.png`;
  }

  function pixels(mode) {
    // Static readback only. Copy immediately because the GL drawing buffer is
    // deliberately not preserved between browser presentations.
    const canvas = document.createElement('canvas');
    canvas.width = canvases[mode].width;
    canvas.height = canvases[mode].height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvases[mode], 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }

  function pixelSummary(mode) {
    const image = pixels(mode);
    let inkPixels = 0, hash = 2166136261;
    for (let i = 0; i < image.data.length; i += 4) {
      const [r, g, b, a] = image.data.subarray(i, i + 4);
      if (Math.abs(r - 30) + Math.abs(g - 30) + Math.abs(b - 36) > 12 && a > 0) inkPixels++;
      hash = Math.imul(hash ^ r, 16777619);
      hash = Math.imul(hash ^ g, 16777619);
      hash = Math.imul(hash ^ b, 16777619);
    }
    return { width: image.width, height: image.height, inkPixels, checksum: (hash >>> 0).toString(16) };
  }

  function staticPreviews() {
    const summaries = {};
    for (const mode of MODES) {
      draw(mode);
      capture(mode);
      summaries[mode] = pixelSummary(mode);
    }
    return summaries;
  }

  function baseResult() {
    return {
      study: 'Production retained GPU text vs current retained Canvas2D lines',
      createdAt: new Date().toISOString(), browser: navigator.userAgent,
      actualDevicePixelRatio: window.devicePixelRatio, config: current.config,
      font: FONT, baselineOffsetWorld: TEXT_BASELINE_Y_OFFSET,
      preparation: current.prepared.diagnostics, rendererInitialization: init,
      cold: current.cold, gpuStats: stats(), rendererEvents: rendererEvents.slice(),
      currentRasterCache: getTextRasterCacheStats(), visibility: visibility(),
      limitations: [
        'CPU submission and rAF pacing are not GPU execution or confirmed presentation times.',
        'Both mounted panels must remain foreground and fully visible.',
        'Native PNGs and coarse pixel probes do not replace visual small-text sharpness inspection.',
        'GPU memory counters cover retained resources, not complete driver or browser allocations.',
      ],
    };
  }

  function publish() { $('json').textContent = JSON.stringify(result, null, 2); }

  async function prepare(workload, { scale, minimumScale, capturePreviews = true, customObjects } = {}) {
    const settings = config(workload, scale ?? Number($('scale').value));
    $('status').textContent = `Preparing ${workload} layouts…`;
    await frame();
    for (const canvas of Object.values(canvases)) {
      const width = Math.round(WIDTH * settings.dpr), height = Math.round(HEIGHT * settings.dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    objects = customObjects || fixtures(workload);
    // Both paths begin with empty retained scene caches. The shared font atlas
    // stays loaded, with its one-time preparation reported in initialization.
    contexts.gpu.resetResources();
    clearTextLayoutCaches({ measurements: true });
    refreshTextMetrics();
    const prepared = prepareRows(objects, settings, minimumScale ?? settings.scale);
    current = { config: settings, prepared, cold: {} };
    for (const mode of MODES) {
      const before = mode === 'gpu' ? stats() : getTextRasterCacheStats();
      const started = performance.now();
      draw(mode);
      const firstDrawSubmissionMs = round(performance.now() - started);
      const after = mode === 'gpu' ? stats() : getTextRasterCacheStats();
      current.cold[mode] = { firstDrawSubmissionMs, before, after, delta: delta(before, after) };
    }
    result = baseResult();
    if (capturePreviews) result.pixelProbes = staticPreviews();
    $('summary').textContent = '';
    publish();
  }

  function summarize(samples) {
    const percentile = (key, q) => {
      const values = samples.map((sample) => sample[key]).sort((a, b) => a - b);
      return round(values[Math.max(0, Math.ceil(values.length * q) - 1)] || 0);
    };
    return {
      samples: samples.length,
      submissionMedianMs: percentile('submissionMs', 0.5), submissionP95Ms: percentile('submissionMs', 0.95),
      nextRafIntervalMedianMs: percentile('nextRafIntervalMs', 0.5), nextRafIntervalP95Ms: percentile('nextRafIntervalMs', 0.95),
      intervalsOver25ms: samples.filter((sample) => sample.nextRafIntervalMs > 25).length,
      hiddenSamples: samples.filter((sample) => sample.hidden).length, raw: samples,
    };
  }

  function showSummary(modes) {
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Path</th><th>Submission median / p95 ms</th><th>Next rAF median / p95 ms</th><th>Intervals &gt;25 ms</th><th>Hidden frames</th></tr></thead><tbody></tbody>';
    for (const mode of MODES) {
      const metric = modes[mode], row = document.createElement('tr');
      for (const value of [mode, `${metric.submissionMedianMs} / ${metric.submissionP95Ms}`, `${metric.nextRafIntervalMedianMs} / ${metric.nextRafIntervalP95Ms}`, metric.intervalsOver25ms, metric.hiddenSamples]) {
        const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
      }
      table.querySelector('tbody').appendChild(row);
    }
    $('summary').replaceChildren(table);
  }

  async function measureBlock(mode, count, warmups, scaleAt, roundIndex) {
    const block = { mode, round: roundIndex, visibilityStart: visibility(), statsBefore: stats(), samples: [] };
    let timestamp = await frame();
    for (let i = -warmups; i < count; i++) {
      const index = i < 0 ? i + warmups : i;
      const scale = scaleAt(index);
      const hiddenBefore = document.hidden;
      const started = performance.now();
      draw(mode, index, scale);
      const submitted = performance.now();
      const nextTimestamp = await frame();
      if (i >= 0) block.samples.push({
        frame: i, round: roundIndex, scale: round(scale),
        submissionMs: round(submitted - started), nextRafIntervalMs: round(nextTimestamp - timestamp),
        hidden: hiddenBefore || document.hidden,
      });
      timestamp = nextTimestamp;
    }
    block.statsAfter = stats();
    block.statsDelta = delta(block.statsBefore, block.statsAfter);
    block.visibilityEnd = visibility();
    return block;
  }

  async function compare(workload) {
    await prepare(workload, { capturePreviews: false });
    $('panels').scrollIntoView({ block: 'center', inline: 'nearest' });
    const samples = { retained: [], gpu: [] }, blocks = [];
    const orders = [['retained', 'gpu'], ['gpu', 'retained']];
    for (let roundIndex = 0; roundIndex < orders.length; roundIndex++) {
      for (const mode of orders[roundIndex]) {
        $('status').textContent = `Measuring ${mode}, round ${roundIndex + 1}/2. Keep both panels visible.`;
        const block = await measureBlock(mode, 45, 6, () => current.config.scale, roundIndex + 1);
        samples[mode].push(...block.samples); delete block.samples; blocks.push(block);
      }
    }
    result = baseResult();
    result.animation = { measuredFramesPerPath: 90, warmupsPerBlock: 6, orders, blocks, modes: Object.fromEntries(MODES.map((mode) => [mode, summarize(samples[mode])])) };
    result.pixelProbes = staticPreviews();
    showSummary(result.animation.modes); publish();
    $('status').textContent = 'Comparison complete: 90 measured frames per path. Check visibility flags, CPU work, resource deltas, and native pixels.';
  }

  async function continuousZoom() {
    await prepare('dense', { scale: 1, minimumScale: 0.18, capturePreviews: false });
    $('panels').scrollIntoView({ block: 'center', inline: 'nearest' });
    const samples = {}, blocks = [];
    for (const mode of MODES) {
      $('status').textContent = `Continuous zoom: ${mode}, 180 first-visit scales. Every frame renders immediately.`;
      const block = await measureBlock(mode, 180, 0, (i) => 0.18 * Math.pow(4 / 0.18, i / 179), 1);
      samples[mode] = block.samples; delete block.samples; blocks.push(block);
    }
    result = baseResult();
    result.animation = {
      measuredFramesPerPath: 180, warmups: 0, scalePath: '0.18 * (4 / 0.18) ** (frame / 179)',
      fixedLayoutAtMinimumScale: 0.18, blocks,
      modes: Object.fromEntries(MODES.map((mode) => [mode, summarize(samples[mode])])),
    };
    // At a never-before-used fractional scale, moving and repeated resting
    // frames receive identical geometry and uniforms. Compare exact pixels.
    const qualityScale = 1.371927;
    draw('gpu', 7, qualityScale); const moving = pixelSummary('gpu');
    await frame();
    draw('gpu', 7, qualityScale); const resting = pixelSummary('gpu');
    result.motionRestIdentity = { scale: qualityScale, moving, resting, equal: moving.checksum === resting.checksum };
    result.pixelProbes = staticPreviews();
    showSummary(result.animation.modes); publish();
    $('status').textContent = `Continuous zoom complete. Motion/rest pixels ${result.motionRestIdentity.equal ? 'match' : 'differ'} at identical transforms; inspect resource counter deltas for zoom uploads.`;
  }

  function colorImage(color) {
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 4, 4);
    return canvas;
  }

  async function mixedOrder() {
    const alphaCanvas = colorImage('rgba(240, 80, 40, 0.5)');
    const alphaBitmap = await createImageBitmap(alphaCanvas);
    const mixed = [
      { id: 'blue', type: 'image', x: 0, y: 0, w: 200, h: 170, source: colorImage('#2050c0') },
      object('behind-red', 'HHHHHHHHHHHH', 16, 24, 320),
      { id: 'red', type: 'image', x: 50, y: 50, w: 100, h: 50, source: colorImage('#d03020') },
      object('above-red', 'TOP', 44, 70, 300),
      { id: 'alpha-canvas', type: 'image', x: 210, y: 20, w: 60, h: 60, source: alphaCanvas },
      { id: 'alpha-bitmap', type: 'image', x: 280, y: 20, w: 60, h: 60, source: alphaBitmap },
      object('unicode', 'Legacy: café Ω 😀', 0, 180, 390),
    ];
    await prepare('mixed', { scale: 1, customObjects: mixed });
    const checks = [];
    for (const mode of MODES) {
      draw(mode); const image = pixels(mode);
      for (const [name, x, y, expected] of [
        ['blue behind text', 5, 5, [32, 80, 192]],
        ['red above earlier text', 80, 65, [208, 48, 32]],
        ['partially transparent Canvas', 240, 50, [135, 55, 38]],
        ['partially transparent ImageBitmap', 310, 50, [135, 55, 38]],
      ]) {
        const px = Math.floor((x + current.config.offsetCss) * current.config.dpr);
        const py = Math.floor((y + current.config.offsetCss) * current.config.dpr);
        const index = (py * image.width + px) * 4;
        const actual = Array.from(image.data.slice(index, index + 3));
        checks.push({ mode, name, actual, expected, pass: actual.every((value, channel) => Math.abs(value - expected[channel]) <= 2) });
      }
      capture(mode);
    }
    result = baseResult(); result.imageOrderChecks = checks; result.pixelProbes = staticPreviews(); publish();
    $('status').textContent = `Mixed image order: ${checks.every((check) => check.pass) ? 'pixel probes passed' : 'pixel probe failure'}. Inspect TOP above red and the legacy Unicode fallback in native PNGs.`;
  }

  async function lifecycle() {
    await prepare('lifecycle', { customObjects: [object('reused-id', 'Original ASCII text\nSecond retained line', 0, 0, 380)] });
    const steps = [];
    function checkpoint(name) {
      current.prepared = prepareRows(objects, current.config);
      draw('gpu');
      const image = pixelSummary('gpu');
      steps.push({ name, objectCount: objects.length, ...image, stats: stats() });
      return image;
    }
    checkpoint('initial');
    objects[0].data.content = 'Edited content with a long line to verify wrapping and reused geometry.\nUnchanged final row.';
    checkpoint('content edit');
    objects[0].w = 180;
    checkpoint('wrap width changed');
    objects[0].x += 31; objects[0].y += 19;
    checkpoint('moved object');
    objects = [];
    checkpoint('deleted');
    objects = [object('reused-id', 'Replacement object: fresh pixels', 0, 0, 380)];
    const replacement = checkpoint('ID reused by replacement');
    const repeated = checkpoint('unchanged replacement frame');
    result = baseResult();
    result.lifecycle = {
      steps,
      checks: {
        initialTextVisible: steps[0].inkPixels > 0,
        editChangesPixels: steps[1].checksum !== steps[0].checksum,
        resizeChangesPixels: steps[2].checksum !== steps[1].checksum,
        movementChangesPixels: steps[3].checksum !== steps[2].checksum,
        deletionClearsText: steps[4].inkPixels === 0,
        replacementVisible: replacement.inkPixels > 0,
        replacementDiffersFromOriginal: replacement.checksum !== steps[0].checksum,
        unchangedFrameStable: replacement.checksum === repeated.checksum,
      },
    };
    result.pixelProbes = staticPreviews(); publish();
    $('status').textContent = `Lifecycle checks ${Object.values(result.lifecycle.checks).every(Boolean) ? 'passed' : 'FAILED'}: edit, wrap, movement, deletion, ID reuse, and unchanged frame.`;
  }

  async function restoreContext() {
    await prepare('context');
    draw('gpu'); const before = pixelSummary('gpu');
    const gl = canvases.gpu.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WEBGL_lose_context is unavailable; restoration cannot be exercised in this browser.');
    const lost = new Promise((resolve) => canvases.gpu.addEventListener('webglcontextlost', resolve, { once: true }));
    extension.loseContext(); await lost; await frame();
    const restored = new Promise((resolve) => canvases.gpu.addEventListener('webglcontextrestored', resolve, { once: true }));
    const readyCount = rendererEvents.filter((event) => event.name === 'ready').length;
    extension.restoreContext(); await restored;
    const deadline = performance.now() + 15000;
    while (rendererEvents.filter((event) => event.name === 'ready').length <= readyCount) {
      if (performance.now() > deadline) throw new Error('Timed out waiting for the font atlas after restoring the WebGL context.');
      await frame();
    }
    draw('gpu'); const after = pixelSummary('gpu');
    result = baseResult();
    result.contextRestoration = { before, after, restoredTextVisible: after.inkPixels > 0, pixelsIdentical: before.checksum === after.checksum };
    result.pixelProbes = staticPreviews(); publish();
    $('status').textContent = `Context restored: text ${after.inkPixels > 0 ? 'visible' : 'MISSING'}, pixels ${result.contextRestoration.pixelsIdentical ? 'identical' : 'different'}.`;
  }

  async function scaleAndPrecision() {
    const obj = object('precision', 'H', 0, 0, 2000);
    await prepare('precision', { scale: 1, customObjects: [obj] });
    // Keep the same authoritative layout source during the camera test. Switching
    // from viewport layout to full layout creates fresh prefix arrays and is a
    // layout replacement, which must be measured separately from camera changes.
    const layoutPreparationBefore = stats();
    current.prepared.entries = [{ obj, layout: getTextLayout(obj) }];
    draw('gpu');
    const layoutPreparationDelta = delta(layoutPreparationBefore, stats());
    const glyph = measureTextGlyphMetricsWithFont('H', FONT);
    // Follow the left stem so the 1000% sample retains visible glyph ink.
    const anchorX = TEXT_PAD - glyph.left + 0.65;
    const anchorY = TEXT_PAD + TEXT_BASELINE_Y_OFFSET - glyph.ascent * 0.5;
    const scales = [0.1, 0.18, 0.25, 0.5, 1, 1.25, 1.75, 2, 4, 10];
    const checks = [], startStats = stats();
    for (const scale of scales) {
      const images = [], uploadCounts = [];
      for (const origin of [0, 10000000]) {
        obj.x = obj.y = origin;
        current.prepared.entries = [{ obj, layout: getTextLayout(obj) }];
        const camera = {
          x: WIDTH / 2 + 0.375 - (origin + anchorX) * scale,
          y: HEIGHT / 2 + 0.375 - (origin + anchorY) * scale,
        };
        const before = stats();
        draw('gpu', null, scale, camera);
        const after = stats();
        uploadCounts.push(after.bufferUploads - before.bufferUploads);
        images.push(pixelSummary('gpu'));
      }
      checks.push({
        scale, deviceEm: round(FONT_SIZE * scale * current.config.dpr),
        originZero: images[0], originTenMillion: images[1],
        identicalPixels: images[0].checksum === images[1].checksum,
        cameraBufferUploads: uploadCounts[0], objectMoveBufferUploads: uploadCounts[1],
      });
    }
    const precision = {
      checks, layoutPreparationDelta, before: startStats, after: stats(),
      allPixelsIdentical: checks.every((check) => check.identicalPixels),
      noGeometryUploads: checks.every((check) => check.cameraBufferUploads === 0 && check.objectMoveBufferUploads === 0),
      fractionalTargetCss: [WIDTH / 2 + 0.375, HEIGHT / 2 + 0.375],
      minimumScaleLegibilityRequired: false,
    };
    objects = fixtures('reading');
    current.config.workload = 'scale-quality';
    const minimumScale = 1 / current.config.dpr;
    current.prepared = prepareRows(objects, current.config, minimumScale);
    const qualitySamples = [];
    $('quality-samples').replaceChildren();
    for (const deviceEm of [16, 20, 28]) {
      const scale = deviceEm / (FONT_SIZE * current.config.dpr);
      current.config.scale = scale;
      const sample = { deviceEm, scale, pixelProbes: {} };
      for (const mode of MODES) {
        draw(mode);
        sample.pixelProbes[mode] = pixelSummary(mode);
        const link = document.createElement('a');
        link.id = `${mode}-ppem${deviceEm}-png`;
        link.href = canvases[mode].toDataURL('image/png');
        link.download = `boardfish-production-${mode}-${deviceEm}ppem-dpr${current.config.dpr}.png`;
        link.textContent = `${mode} ${deviceEm} ppem PNG`;
        link.style.marginRight = '16px';
        $('quality-samples').appendChild(link);
        capture(mode);
      }
      qualitySamples.push(sample);
    }
    result = baseResult(); result.scaleAndPrecision = precision; result.qualitySamples = qualitySamples; publish();
    $('status').textContent = `Scale checks: ${precision.allPixelsIdentical ? 'identical' : 'DIFFERENT'} pixels at origin ten million; ${precision.noGeometryUploads ? 'zero' : 'UNEXPECTED'} geometry uploads. Native 16/20/28 ppem samples ready.`;
  }

  async function action(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    catch (error) { result = { error: error.stack || String(error), rendererEvents }; publish(); $('status').textContent = result.error; }
    finally { setBusy(false); }
  }

  $('reading').addEventListener('click', () => action(() => compare('reading')));
  $('dense').addEventListener('click', () => action(() => compare('dense')));
  $('zoom').addEventListener('click', () => action(continuousZoom));
  $('mixed').addEventListener('click', () => action(mixedOrder));
  $('lifecycle').addEventListener('click', () => action(lifecycle));
  $('context').addEventListener('click', () => action(restoreContext));
  $('precision').addEventListener('click', () => action(scaleAndPrecision));

  (async () => {
    setBusy(true);
    try {
      const started = performance.now();
      await document.fonts.load(FONT, 'Boardfish'); await document.fonts.ready;
      refreshTextMetrics();
      let resolveReady, rejectReady;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const timer = setTimeout(() => rejectReady(new Error('Timed out loading production GPU font atlas.')), 15000);
      contexts.gpu = BoardfishGpuRenderer.createContext(canvases.gpu, {
        coverageFont: { ...BoardfishAsciiCoverageFont, atlasURL: `../${BoardfishAsciiCoverageFont.atlasURL}` },
        font: {
          ...BoardfishAsciiFont, atlasURL: '../fonts/geist-ascii-msdf.png',
          ...(BoardfishAsciiFont.largeFont ? {
            largeFont: { ...BoardfishAsciiFont.largeFont, atlasURL: '../fonts/geist-ascii-large-msdf.png' },
          } : {}),
        },
        onReady() { rendererEvents.push({ name: 'ready', atMs: round(performance.now() - started) }); resolveReady(); },
        onLost() { rendererEvents.push({ name: 'lost', atMs: round(performance.now() - started) }); },
        onError(error) { rendererEvents.push({ name: 'error', message: String(error) }); rejectReady(error instanceof Error ? error : new Error(String(error))); },
      });
      if (!contexts.gpu) { clearTimeout(timer); throw new Error('Production WebGL2 renderer unavailable.'); }
      try { await ready; } finally { clearTimeout(timer); }
      init = { readinessMs: round(performance.now() - started), stats: stats() };
      await prepare('reading');
      $('status').textContent = 'Production renderer ready. Choose a comparison or lifecycle check.';
    } catch (error) {
      result = { error: error.stack || String(error), rendererEvents }; publish(); $('status').textContent = result.error;
    } finally { setBusy(false); }
  })();
})();
