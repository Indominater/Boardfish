'use strict';

(function textRenderBenchmark() {
  const WIDTH = 1024;
  const HEIGHT = 640;
  const WARMUP_FRAMES = 4;
  const $ = (id) => document.getElementById(id);
  const round = (value) => Math.round(value * 1000) / 1000;
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));
  const cacheStats = () => typeof getTextRasterCacheStats === 'function' ? getTextRasterCacheStats() : null;
  const resetRaster = () => { if (typeof clearTextRasterCache === 'function') clearTextRasterCache(); };
  const COMPLETION_DESCRIPTIONS = {
    snapshot: 'OffscreenCanvas transferToImageBitmap().close() per sample; snapshot completion, not presented frames or a GPU fence. Empty path reports snapshot baseline.',
    readback: 'Full-canvas getImageData per sample; CPU-readable pixel completion includes readback overhead. Empty path reports readback baseline.',
  };
  let downloadURL;
  let sampleChecksum = 0;

  function supportsBitmapSnapshots() {
    if (typeof OffscreenCanvas !== 'function') return false;
    try {
      const probe = new OffscreenCanvas(1, 1);
      if (!probe.getContext('2d') || typeof probe.transferToImageBitmap !== 'function') return false;
      const bitmap = probe.transferToImageBitmap();
      if (typeof bitmap.close !== 'function') return false;
      bitmap.close();
      return true;
    } catch (_) { return false; }
  }

  const bitmapSnapshotsAvailable = supportsBitmapSnapshots();

  function updateCompletionNote() {
    const prefix = bitmapSnapshotsAvailable ? '' : 'Bitmap snapshot unavailable in this browser; CPU readback selected. ';
    $('completion-note').textContent = prefix + COMPLETION_DESCRIPTIONS[$('completion').value];
  }

  function makeObject(id, content, x = 0, y = 0, width = 480) {
    return { id, type: 'text', x, y, w: width, h: 1, z: 1, data: { content } };
  }

  function workloads() {
    const prose = Array.from({ length: 64 }, (_, i) => (
      `Paragraph ${i + 1}: A quick brown fox jumps over the lazy dog. Boardfish stores plain ASCII text, ` +
      'keeps exact selection positions, and wraps each sentence to the available width. '
    )).join('\n');
    const code = Array.from({ length: 60 }, (_, i) => (
      `function process${i}(value) {\n\tconst result = value.map((item) => item * 2);\n` +
      '\tif (result.length > 0) {\n\t\treturn result.join(", ");\n\t}\n\treturn "empty";\n}'
    )).join('\n');
    const alphabet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join('');
    const wide = alphabet.repeat(64).slice(0, 6000);
    return [
      { name: 'Prose', objects: [makeObject('prose', prose, 0, 0, 780)] },
      { name: 'Indented code', objects: [makeObject('code', code, 0, 0, 900)] },
      { name: 'Wide ASCII row', objects: [makeObject('wide', wide, 0, 0, 100000)] },
      { name: '24 large textboxes', viewportLayout: true, objects: Array.from({ length: 24 }, (_, i) => (
        makeObject(`board-${i}`, `Textbox ${i + 1}\n${prose}`, (i % 6) * 500, Math.floor(i / 6) * 4200, 480)
      )) },
    ];
  }

  function createCanvas(width, height, dpr) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    return canvas;
  }

  function setupContext(context, config) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.fillStyle = config.background || '#ffffff';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.setTransform(config.scale * config.dpr, 0, 0, config.scale * config.dpr,
      config.offset * config.dpr, config.offset * config.dpr);
    context.font = FONT;
    context.textBaseline = 'alphabetic';
    configureTextCanvasContext(context);
    context.fillStyle = config.color || '#202028';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
  }

  function viewportFor(config) {
    return {
      x1: -config.offset / config.scale,
      y1: -config.offset / config.scale,
      x2: (config.width - config.offset) / config.scale,
      y2: (config.height - config.offset) / config.scale,
    };
  }

  function prepareWorkload(workload, config) {
    objects = workload.objects;
    // Reset layout without syncAllTextAutoHeights prewarming it outside timing.
    refreshTextMetrics();
    clearTextLayoutCaches({ measurements: true });
    const viewport = viewportFor(config);
    const started = performance.now();
    const entries = [];
    for (const obj of workload.objects) {
      // Match the renderer's object visibility test; no row is horizontally trimmed.
      if (obj.x > viewport.x2 || obj.x + obj.w < viewport.x1 || obj.y > viewport.y2) continue;
      let layout;
      if (workload.viewportLayout) {
        layout = getTextLayoutForViewport(obj, viewport);
      } else {
        getTextLayout(obj);
        layout = getTextLayoutForViewport(obj, viewport);
      }
      for (const line of layout) {
        entries.push({ obj, line, plan: prepareTextLineForDraw(line) });
      }
    }
    const layoutAndPlansMs = performance.now() - started;
    return { entries, viewport, layoutAndPlansMs };
  }

  function drawDirect(context, entries) {
    for (const { obj, line, plan } of entries) {
      for (const draw of plan) context.fillText(draw.text, lineBaseX(obj) + draw.x, line.textY);
    }
  }

  function drawRetained(context, entries) {
    beginTextRasterFrame();
    for (const { obj, line } of entries) {
      drawTextLineRange(context, line, obj, 0, line.text.length, { collectStats: false });
    }
  }

  function completePixels(context) {
    const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    // Consume a byte so the read is observably used; all pixels were requested.
    sampleChecksum = (sampleChecksum + pixels.data[pixels.data.length >> 1]) >>> 0;
  }

  function completeDestination(context, config) {
    if (config.completionMode === 'snapshot') {
      const bitmap = context.canvas.transferToImageBitmap();
      bitmap.close();
    } else {
      completePixels(context);
    }
  }

  function timedDraw(context, config, draw) {
    const start = performance.now();
    setupContext(context, config);
    draw();
    const submitted = performance.now();
    completeDestination(context, config);
    return { submitMs: submitted - start, completedMs: performance.now() - start };
  }

  function summarize(samples) {
    const percentile = (key, fraction) => {
      const sorted = samples.map((sample) => sample[key]).sort((a, b) => a - b);
      return round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0);
    };
    return {
      medianMs: percentile('completedMs', 0.5), p95Ms: percentile('completedMs', 0.95),
      submissionMedianMs: percentile('submitMs', 0.5), submissionP95Ms: percentile('submitMs', 0.95),
      samples: samples.map((sample) => ({ submitMs: round(sample.submitMs), completedMs: round(sample.completedMs) })),
    };
  }

  function countDestinationCalls(context, config, draw) {
    const counts = { fillText: 0, drawImage: 0 };
    const originals = { fillText: context.fillText, drawImage: context.drawImage };
    for (const method of Object.keys(originals)) {
      context[method] = function (...args) { counts[method]++; return originals[method].apply(this, args); };
    }
    try { setupContext(context, config); draw(); completeDestination(context, config); }
    finally { for (const method of Object.keys(originals)) context[method] = originals[method]; }
    return counts;
  }

  async function benchmarkCase(workload, config, sampleCount) {
    const prepared = prepareWorkload(workload, config);
    const canvas = config.completionMode === 'snapshot'
      ? new OffscreenCanvas(Math.ceil(config.width * config.dpr), Math.ceil(config.height * config.dpr))
      : createCanvas(config.width, config.height, config.dpr);
    const context = canvas.getContext('2d');
    const sourceCanvas = createCanvas(config.width, config.height, config.dpr);
    const sourceContext = sourceCanvas.getContext('2d');
    setupContext(sourceContext, config);
    drawDirect(sourceContext, prepared.entries);
    completePixels(sourceContext);
    const imageSource = typeof createImageBitmap === 'function' ? await createImageBitmap(sourceCanvas) : sourceCanvas;
    const draw = {
      direct: () => drawDirect(context, prepared.entries),
      retained: () => drawRetained(context, prepared.entries),
      image: () => context.drawImage(imageSource, prepared.viewport.x1, prepared.viewport.y1,
        config.width / config.scale, config.height / config.scale),
      empty: () => {},
    };
    resetRaster();
    const cacheBefore = cacheStats();
    const coldRetained = timedDraw(context, config, draw.retained);
    const cacheAfterCold = cacheStats();
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      for (const mode of Object.keys(draw)) timedDraw(context, config, draw[mode]);
    }
    const samples = { direct: [], retained: [], image: [], empty: [] };
    const modes = Object.keys(draw);
    for (let i = 0; i < sampleCount; i++) {
      for (let j = 0; j < modes.length; j++) {
        const mode = modes[(i + j) % modes.length];
        samples[mode].push(timedDraw(context, config, draw[mode]));
      }
      if (i % 5 === 4) await nextFrame();
    }
    const calls = {};
    for (const mode of modes) calls[mode] = countDestinationCalls(context, config, draw[mode]);
    const results = Object.fromEntries(modes.map((mode) => [mode, summarize(samples[mode])]));
    const result = {
      workload: workload.name, scale: config.scale, dpr: config.dpr, completionMode: config.completionMode,
      destinationType: config.completionMode === 'snapshot' ? 'OffscreenCanvas' : 'HTMLCanvasElement',
      objectCount: workload.objects.length,
      totalCharacters: workload.objects.reduce((sum, obj) => sum + obj.data.content.length, 0),
      visibleRows: prepared.entries.length,
      submittedCharacters: prepared.entries.reduce((sum, entry) => sum + entry.line.text.length, 0),
      layoutAndPlansMs: round(prepared.layoutAndPlansMs),
      coldRetained: { submitMs: round(coldRetained.submitMs), completedMs: round(coldRetained.completedMs) },
      warm: results, destinationCalls: calls,
      speedup: results.retained.medianMs > 0 ? round(results.direct.medianMs / results.retained.medianMs) : null,
      cacheBefore, cacheAfterCold, cacheAfterWarm: cacheStats(),
      referenceSource: imageSource === sourceCanvas ? 'canvas' : 'ImageBitmap',
      estimatedBytes: {
        destination: canvas.width * canvas.height * 4,
        referenceCaptureCanvas: sourceCanvas.width * sourceCanvas.height * 4,
        referenceImageBitmap: imageSource === sourceCanvas ? 0 : sourceCanvas.width * sourceCanvas.height * 4,
        readbackArrayPerSample: config.completionMode === 'readback' ? canvas.width * canvas.height * 4 : 0,
        transferredSnapshotPerSample: config.completionMode === 'snapshot' ? canvas.width * canvas.height * 4 : 0,
      },
    };
    imageSource.close?.();
    canvas.width = canvas.height = 1;
    sourceCanvas.width = sourceCanvas.height = 1;
    return result;
  }

  function appendResult(result) {
    $('results').hidden = false;
    const row = document.createElement('tr');
    const format = (mode) => `${result.warm[mode].medianMs} / ${result.warm[mode].p95Ms}`;
    const stats = result.cacheAfterWarm || {};
    const bytes = stats.bytes ?? stats.estimatedBytes ?? stats.totalBytes ?? stats.byteLength ?? null;
    const values = [
      `${result.workload} / ${result.scale * 100}%`, result.submittedCharacters.toLocaleString(),
      result.layoutAndPlansMs, result.coldRetained.completedMs, format('direct'), format('retained'), format('image'),
      result.speedup == null ? 'n/a' : `${result.speedup}x`,
      `${result.destinationCalls.direct.fillText} / ${result.destinationCalls.retained.fillText} + ${result.destinationCalls.retained.drawImage}`,
      bytes == null ? 'see JSON' : Number(bytes).toLocaleString(),
    ];
    for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); }
    $('results').querySelector('tbody').appendChild(row);
  }

  async function runBenchmark() {
    $('run').disabled = true;
    $('run-animation').disabled = true;
    $('preview').disabled = true;
    $('results').querySelector('tbody').replaceChildren();
    $('results').hidden = true;
    $('download').hidden = true;
    const sampleCount = Math.trunc(clamp($('samples').value, 8, 120));
    const dpr = clamp($('dpr').value, 1, 4);
    const scales = $('scales').value.split(',').map(Number);
    const completionMode = $('completion').value;
    const output = {
      version: 2, timestamp: new Date().toISOString(), userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency, browserDevicePixelRatio: devicePixelRatio,
      canvas: { cssWidth: WIDTH, cssHeight: HEIGHT, dpr }, samplesPerPath: sampleCount, warmupFrames: WARMUP_FRAMES,
      completionMode, completion: COMPLETION_DESCRIPTIONS[completionMode], bitmapSnapshotsAvailable,
      scope: 'Isolated draw replay; layout/plans measured separately. No behavioral pan/zoom optimizations.',
      rasterDiagnosticsAvailable: typeof getTextRasterCacheStats === 'function', results: [],
    };
    try {
      for (const workload of workloads()) {
        for (const scale of scales) {
          $('status').textContent = `Running ${workload.name} at ${scale * 100}% (${output.results.length + 1}/${4 * scales.length}); ${completionMode === 'snapshot' ? 'snapshot completion' : 'CPU readback'}...`;
          await nextFrame();
          const result = await benchmarkCase(workload, { width: WIDTH, height: HEIGHT, dpr, scale, offset: 0, completionMode }, sampleCount);
          output.results.push(result);
          appendResult(result);
          $('json').textContent = JSON.stringify(output, null, 2);
        }
      }
      output.pixelReadChecksum = sampleChecksum;
      const json = JSON.stringify(output, null, 2);
      $('json').textContent = json;
      if (downloadURL) URL.revokeObjectURL(downloadURL);
      downloadURL = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      $('download').href = downloadURL;
      $('download').hidden = false;
      $('status').textContent = `Complete: ${output.results.length} cases, ${sampleCount} samples per path. ` +
        (completionMode === 'snapshot' ? 'Snapshot completion timings; these are not presented-frame timings. ' : 'CPU-readable pixel completion timings include full-canvas readback. ') +
        'See empty-destination baseline and submission timings in JSON.';
    } catch (error) {
      $('status').textContent = `Benchmark failed: ${error.stack || error.message || error}`;
    } finally {
      $('run').disabled = false;
      $('run-animation').disabled = false;
      $('preview').disabled = false;
      renderComparison();
    }
  }

  function runAnimationBlock(context, entries, config, mode) {
    const warmupFrames = 10;
    const measuredFrames = 45;
    return new Promise((resolve, reject) => {
      const samples = [];
      let frameIndex = 0;
      let previousTimestamp = null;
      let pendingSample = null;
      function frame(timestamp) {
        try {
          // Pair each draw with the interval ending at the following callback.
          if (pendingSample) {
            pendingSample.rafIntervalMs = timestamp - previousTimestamp;
            samples.push(pendingSample);
          }
          if (frameIndex === warmupFrames + measuredFrames) { resolve(samples); return; }
          const offset = ((frameIndex % 16) - 8) * 0.375;
          const started = performance.now();
          setupContext(context, { ...config, offset });
          if (mode === 'direct') drawDirect(context, entries);
          else drawRetained(context, entries);
          const submissionMs = performance.now() - started;
          pendingSample = frameIndex >= warmupFrames
            ? { submissionMs, offsetCssPx: offset, foreground: document.visibilityState === 'visible' }
            : null;
          previousTimestamp = timestamp;
          frameIndex++;
          requestAnimationFrame(frame);
        } catch (error) { reject(error); }
      }
      requestAnimationFrame(frame);
    });
  }

  function summarizeAnimation(samples) {
    function timings(key) {
      const sorted = samples.map((sample) => sample[key]).sort((a, b) => a - b);
      const at = (fraction) => round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0);
      return { medianMs: at(0.5), p95Ms: at(0.95), over25Ms: sorted.filter((value) => value > 25).length };
    }
    return {
      sampleCount: samples.length,
      submission: timings('submissionMs'),
      rafInterval: timings('rafIntervalMs'),
      framesWhileHidden: samples.filter((sample) => !sample.foreground).length,
      samples: samples.map((sample) => ({ ...sample,
        submissionMs: round(sample.submissionMs), rafIntervalMs: round(sample.rafIntervalMs) })),
    };
  }

  async function runAnimationComparison() {
    for (const id of ['run', 'run-animation', 'preview']) $(id).disabled = true;
    const config = { width: WIDTH, height: HEIGHT, dpr: clamp($('dpr').value, 1, 4), scale: 0.25, offset: 0 };
    const order = ['direct', 'retained', 'retained', 'direct'];
    const output = {
      version: 1, timestamp: new Date().toISOString(), userAgent: navigator.userAgent,
      browserDevicePixelRatio: devicePixelRatio,
      canvas: { cssWidth: WIDTH, cssHeight: HEIGHT, dpr: config.dpr, type: 'HTMLCanvasElement', contextOptions: 'default' },
      workload: '24 large textboxes', scale: config.scale, blockOrder: order,
      warmupFramesPerBlock: 10, measuredFramesPerBlock: 45,
      method: 'Mounted visible canvas, one draw per rAF callback, no destination readback or bitmap transfer. rAF interval is the time until the next callback, not precise GPU latency or a confirmed presentation timestamp.',
      translation: 'Same repeating sequence per block: ((frameIndex % 16) - 8) * 0.375 CSS pixels on both axes.',
      blocks: [],
    };
    try {
      $('animation-status').textContent = 'Preparing the large-board layout and retained pixels...';
      const canvas = $('animation-canvas');
      canvas.width = Math.ceil(WIDTH * config.dpr);
      canvas.height = Math.ceil(HEIGHT * config.dpr);
      canvas.style.width = `${WIDTH}px`;
      const context = canvas.getContext('2d');
      canvas.scrollIntoView({ block: 'center', behavior: 'instant' });
      await nextFrame();
      output.canvas.displayedWidth = canvas.clientWidth;
      output.canvas.displayedHeight = canvas.clientHeight;
      const workload = workloads().find((entry) => entry.name === output.workload);
      const prepared = prepareWorkload(workload, config);
      output.totalCharacters = workload.objects.reduce((sum, obj) => sum + obj.data.content.length, 0);
      output.submittedCharacters = prepared.entries.reduce((sum, entry) => sum + entry.line.text.length, 0);
      output.submittedRows = prepared.entries.length;
      output.layoutAndPlansMs = round(prepared.layoutAndPlansMs);
      resetRaster();
      setupContext(context, config);
      drawRetained(context, prepared.entries);
      output.cacheAfterPreparation = cacheStats();
      const samplesByMode = { direct: [], retained: [] };
      for (let index = 0; index < order.length; index++) {
        const mode = order[index];
        $('animation-status').textContent = `Animation block ${index + 1}/4: ${mode}; 10 warmup + 45 measured frames. Keep this canvas visible.`;
        const samples = await runAnimationBlock(context, prepared.entries, config, mode);
        samplesByMode[mode].push(...samples);
        output.blocks.push({ mode, ...summarizeAnimation(samples) });
      }
      output.direct = summarizeAnimation(samplesByMode.direct);
      output.retained = summarizeAnimation(samplesByMode.retained);
      output.cacheAfterAnimation = cacheStats();
      $('animation-json').textContent = JSON.stringify(output, null, 2);
      $('animation-summary').textContent = ['direct', 'retained'].map((mode) => {
        const result = output[mode];
        return `${mode}: ${result.sampleCount} frames; submission median/p95 ${result.submission.medianMs}/${result.submission.p95Ms} ms; ` +
          `rAF interval median/p95 ${result.rafInterval.medianMs}/${result.rafInterval.p95Ms} ms; ` +
          `rAF intervals >25 ms: ${result.rafInterval.over25Ms}/${result.sampleCount}; hidden frames: ${result.framesWhileHidden}`;
      }).join('\n');
      $('animation-status').textContent = 'Complete. Mounted-canvas rAF pacing and submission timings are shown below. No destination pixel reads or bitmap transfers were performed.';
    } catch (error) {
      $('animation-status').textContent = `Animation comparison failed: ${error.stack || error.message || error}`;
    } finally {
      for (const id of ['run', 'run-animation', 'preview']) $(id).disabled = false;
    }
  }

  function renderComparison() {
    const text = $('visual-text').value;
    if (/[^\x00-\x7f]/.test(text)) {
      $('visual-status').textContent = 'The sample includes non-ASCII text; this will also exercise the compatibility fallback.';
    }
    const dark = $('visual-theme').value === 'dark';
    const config = { width: 640, height: 300, scale: Number($('visual-scale').value),
      offset: Number($('visual-offset').value), dpr: clamp($('dpr').value, 1, 4),
      color: dark ? '#e8e8ef' : '#202028', background: dark ? '#1c1b22' : '#ffffff' };
    const obj = makeObject('visual', text, 0, 0, 3000);
    const layout = getTextLayout(obj);
    const entries = layout.map((line) => ({ obj, line, plan: prepareTextLineForDraw(line) }));
    const contexts = ['direct-preview', 'retained-preview'].map((id) => {
      const canvas = $(id);
      canvas.width = Math.ceil(config.width * config.dpr);
      canvas.height = Math.ceil(config.height * config.dpr);
      const context = canvas.getContext('2d');
      setupContext(context, config);
      return context;
    });
    drawDirect(contexts[0], entries);
    drawRetained(contexts[1], entries);
    const a = contexts[0].getImageData(0, 0, contexts[0].canvas.width, contexts[0].canvas.height).data;
    const b = contexts[1].getImageData(0, 0, contexts[1].canvas.width, contexts[1].canvas.height).data;
    let absoluteDifference = 0;
    let pixelsOver16 = 0;
    for (let i = 0; i < a.length; i += 4) {
      let maximum = 0;
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(a[i + channel] - b[i + channel]);
        absoluteDifference += delta;
        maximum = Math.max(maximum, delta);
      }
      if (maximum > 16) pixelsOver16++;
    }
    $('visual-status').textContent = `${config.scale * 100}% zoom, DPR ${config.dpr}, origin ${config.offset}px. ` +
      `Mean RGB difference: ${round(absoluteDifference / (a.length / 4 * 3))}/255. ` +
      `Pixels differing by >16 in any RGB channel: ${pixelsOver16.toLocaleString()} (${round(pixelsOver16 / (a.length / 4) * 100)}%). ` +
      'Pixel differences are a diagnostic, not a perceptual quality score.';
  }

  $('dpr').value = Math.min(4, devicePixelRatio || 1);
  if (!bitmapSnapshotsAvailable) {
    $('completion').querySelector('option[value="snapshot"]').disabled = true;
    $('completion').value = 'readback';
  }
  updateCompletionNote();
  $('completion').addEventListener('change', updateCompletionNote);
  $('run').addEventListener('click', runBenchmark);
  $('run-animation').addEventListener('click', runAnimationComparison);
  $('preview').addEventListener('click', renderComparison);
  for (const id of ['visual-scale', 'visual-offset', 'visual-theme']) $(id).addEventListener('change', renderComparison);
  document.fonts.load("400 16px 'Geist Sans'").then(() => document.fonts.ready).then(() => {
    clearTextMeasurementCaches();
    $('run').disabled = false;
    $('run-animation').disabled = false;
    $('preview').disabled = false;
    $('status').textContent = `Ready. Geist loaded. Raster diagnostics ${typeof getTextRasterCacheStats === 'function' ? 'available' : 'unavailable; check renderer integration before interpreting results'}.`;
    renderComparison();
  }).catch((error) => { $('status').textContent = `Initialization failed: ${error.stack || error}`; });
})();
