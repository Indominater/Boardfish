'use strict';

(function textMinificationBenchmark() {
  const WIDTH = 400, HEIGHT = 256, MODES = ['before', 'after'];
  const BACKGROUND = '#18181c', FOREGROUND = '#eeeeee', RED_RANGE = 238 - 24;
  const PHASES = 64, WARMUPS = 12, BLOCK_FRAMES = 60;
  const PROBES = ['.', '_', '-', 'i', '|', 'H', 'e', 'A'];
  const STYLE = { fontSize: FONT_SIZE, padding: TEXT_PAD, lineHeight: LINE_H, baselineOffset: TEXT_BASELINE_Y_OFFSET };
  const $ = id => document.getElementById(id);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const rounded = (value, places = 4) => Math.round(value * 10 ** places) / 10 ** places;
  const canvases = Object.fromEntries(MODES.map(mode => [mode, $(mode)]));
  const contexts = {}, copies = {}, rendererEvents = [];
  let scenes = {}, busy = true, animated = false, animationGeneration = 0, result, downloadURL;
  const baselineAvailable = typeof BoardfishGpuRendererBefore !== 'undefined';
  const portable = new URLSearchParams(location.search).get('portable') === '1';

  function controls() {
    for (const id of ['dpr', 'zoom', 'run-all', 'phase', 'performance']) $(id).disabled = busy || animated;
    $('animate').disabled = busy;
    $('animate').textContent = animated ? 'Stop panning' : 'Animate panning';
  }

  function settings() { return { zoom: Number($('zoom').value), dpr: Number($('dpr').value) }; }
  function object(id, content, x, y, w) {
    const obj = { id, type: 'text', x, y, w, h: 1, data: { content } };
    obj.h = getTextAutoHeight(obj);
    return obj;
  }
  function denseObjects(mode) {
    return Array.from({ length: 3 }, (_, index) => {
      const paragraph = `Textbox ${index + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. A quick brown fox jumps over the lazy dog. Sharp small text, punctuation .,:;_- and thin stems iii lll ||| remain present while the camera moves. 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ.\n`;
      const content = paragraph.repeat(Math.ceil(100000 / paragraph.length)).slice(0, 100000);
      return object(`${mode}-dense-${index}`, content, index * 3600, index * 23.375, 3500);
    });
  }
  function probeObjects(mode) {
    return PROBES.map((glyph, index) => object(`${mode}-probe-${index}`, glyph.repeat(180), 100, 100 + index * 240, 3400));
  }

  function configure(config, workload) {
    $('dpr').value = String(config.dpr); $('zoom').value = String(config.zoom);
    for (const mode of MODES) {
      canvases[mode].width = WIDTH * config.dpr; canvases[mode].height = HEIGHT * config.dpr;
      contexts[mode].resetResources();
      scenes[mode] = workload === 'phases' ? probeObjects(mode) : denseObjects(mode);
    }
    $('fixture-label').textContent = workload === 'phases'
      ? `Isolated lines, top to bottom: ${PROBES.map(glyph => JSON.stringify(glyph)).join(', ')}. Each repeats 180 times. Phase travel: one physical pixel.`
      : 'Dense fixture: 3 × 100,000 characters, 3,500 world-pixel textbox widths. Live viewport layout on every frame.';
  }

  function draw(mode, config, camera = { x: 0, y: 0 }) {
    const context = contexts[mode], scene = scenes[mode], canvas = canvases[mode];
    context.beginFrame(scene);
    context.resetTransform(); context.fillStyle = BACKGROUND; context.fillRect(0, 0, canvas.width, canvas.height);
    const density = config.zoom * config.dpr;
    context.setTransform(density, 0, 0, density, camera.x * config.dpr, camera.y * config.dpr);
    context.font = FONT; context.textBaseline = 'alphabetic'; configureTextCanvasContext(context); context.fillStyle = FOREGROUND;
    const viewport = { x1: -camera.x / config.zoom, y1: -camera.y / config.zoom,
      x2: (WIDTH - camera.x) / config.zoom, y2: (HEIGHT - camera.y) / config.zoom };
    let visibleObjects = 0, visibleRows = 0, characters = 0;
    for (const obj of scene) {
      if (obj.x > viewport.x2 || obj.x + obj.w < viewport.x1 || obj.y > viewport.y2 || obj.y + obj.h < viewport.y1) continue;
      const layout = getTextLayoutForViewport(obj, viewport);
      visibleObjects++; visibleRows += layout.length;
      for (const line of layout) characters += line.text.length;
      if (!context.drawTextLayout(layout, obj, STYLE)) {
        throw new Error(`${mode} declined an ASCII layout; this run cannot compare the GPU paths.`);
      }
    }
    context.endFrame();
    return { visibleObjects, visibleRows, characters };
  }

  function readPixels(mode) {
    const canvas = canvases[mode];
    let copy = copies[mode];
    if (!copy) {
      const target = document.createElement('canvas');
      copy = copies[mode] = { canvas: target, context: target.getContext('2d', { willReadFrequently: true }) };
    }
    if (copy.canvas.width !== canvas.width) copy.canvas.width = canvas.width;
    if (copy.canvas.height !== canvas.height) copy.canvas.height = canvas.height;
    copy.context.clearRect(0, 0, canvas.width, canvas.height);
    copy.context.drawImage(canvas, 0, 0);
    return copy.context.getImageData(0, 0, canvas.width, canvas.height);
  }

  function rowEnergy(image, obj, config, camera) {
    const baseline = ((obj.y + TEXT_PAD + TEXT_BASELINE_Y_OFFSET) * config.zoom + camera.y) * config.dpr;
    const margin = Math.ceil(6 * config.dpr);
    const first = Math.max(0, Math.floor(baseline) - margin), last = Math.min(image.height, Math.ceil(baseline) + margin);
    let energy = 0;
    for (let y = first; y < last; y++) for (let x = 0; x < image.width; x++) {
      energy += Math.max(0, image.data[(y * image.width + x) * 4] - 24) / RED_RANGE;
    }
    return energy;
  }
  function energySummary(values) {
    const min = Math.min(...values), max = Math.max(...values), mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { min: rounded(min), max: rounded(max), mean: rounded(mean),
      peakToPeakPercent: rounded(mean ? 100 * (max - min) / mean : 0),
      zeroPhases: values.filter(value => value < .0001).length, samples: values.map(value => rounded(value)) };
  }
  function stats(mode) { return JSON.parse(JSON.stringify(contexts[mode].getStats())); }
  function difference(before, after) {
    return Object.fromEntries(Object.keys(after).filter(key => Number.isFinite(before[key]) && Number.isFinite(after[key]))
      .map(key => [key, rounded(after[key] - before[key])]));
  }
  function visibility() {
    return { hidden: document.hidden, browserDpr: devicePixelRatio,
      panels: Object.fromEntries(MODES.map(mode => {
        const rect = canvases[mode].getBoundingClientRect();
        return [mode, { mounted: canvases[mode].isConnected, fullyVisible: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          cssWidth: rect.width, cssHeight: rect.height, backingWidth: canvases[mode].width, backingHeight: canvases[mode].height }];
      })) };
  }

  async function phaseSweep(config) {
    configure(config, 'phases');
    const entry = { ...config, positionsPerAxis: PHASES, physicalPixelTravel: (PHASES - 1) / PHASES, visibility: visibility(), modes: {} };
    for (const mode of MODES) {
      const before = stats(mode), axes = {};
      for (const axis of ['x', 'y']) {
        const samples = PROBES.map(() => []);
        for (let phase = 0; phase < PHASES; phase++) {
          const camera = { x: .125 / config.dpr, y: .125 / config.dpr };
          camera[axis] += phase / PHASES / config.dpr;
          draw(mode, config, camera);
          const image = readPixels(mode);
          scenes[mode].forEach((obj, index) => samples[index].push(rowEnergy(image, obj, config, camera)));
          if (phase % 16 === 15) {
            $('status').textContent = `Subpixel phases: ${config.zoom * 100}% · DPR ${config.dpr} · ${mode} · ${axis} ${phase + 1}/${PHASES}`;
            await frame();
          }
        }
        axes[axis] = PROBES.map((glyph, index) => ({ glyph, ...energySummary(samples[index]) }));
      }
      entry.modes[mode] = { axes, resources: difference(before, stats(mode)) };
    }
    entry.comparison = ['x', 'y'].flatMap(axis => PROBES.map((glyph, index) => {
      const before = entry.modes.before.axes[axis][index].peakToPeakPercent, after = entry.modes.after.axes[axis][index].peakToPeakPercent;
      return { axis, glyph, beforePercent: before, afterPercent: after, reductionPercent: before ? rounded(100 * (before - after) / before) : null };
    }));
    return entry;
  }

  function cameraFor(index, config) {
    return { x: 16 - ((index * 131) % 7100) * config.zoom + (index % 16) / 64,
      y: 18 - ((index * 53) % 4300) * config.zoom + (index % 13) / 64 };
  }
  function summarize(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const percentile = value => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))] || 0;
    return { count: values.length, mean: rounded(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)),
      p50: rounded(percentile(.5)), p95: rounded(percentile(.95)), max: rounded(sorted.at(-1) || 0) };
  }
  async function timedBlock(mode, config, blockIndex) {
    for (let i = 0; i < WARMUPS; i++) { await frame(); draw(mode, config, cameraFor(i, config)); }
    const before = stats(mode), cpu = [], intervals = [], drawCounts = [];
    let previous = await frame();
    for (let i = 0; i < BLOCK_FRAMES; i++) {
      const started = performance.now();
      const counts = draw(mode, config, cameraFor(i + WARMUPS, config));
      cpu.push(performance.now() - started); drawCounts.push(counts);
      const at = await frame(); intervals.push(at - previous); previous = at;
    }
    return { mode, blockIndex, cpuMs: summarize(cpu), rafMs: summarize(intervals),
      cpuSamplesMs: cpu.map(value => rounded(value)), rafSamplesMs: intervals.map(value => rounded(value)),
      drawCounts, resources: difference(before, stats(mode)) };
  }
  async function densePanning(config) {
    const setupStarted = performance.now(); configure(config, 'dense');
    const entry = { ...config, charactersPerObject: scenes.after.map(obj => obj.data.content.length),
      textboxWidths: scenes.after.map(obj => obj.w), setupMs: rounded(performance.now() - setupStarted),
      warmupsPerBlock: WARMUPS, framesPerBlock: BLOCK_FRAMES, blocks: [], visibility: visibility() };
    for (const mode of MODES) draw(mode, config, cameraFor(0, config));
    for (const [blockIndex, mode] of ['before', 'after', 'after', 'before'].entries()) {
      $('status').textContent = `Dense panning: ${config.zoom * 100}% · DPR ${config.dpr} · ${mode} · block ${blockIndex + 1}/4`;
      entry.blocks.push(await timedBlock(mode, config, blockIndex));
    }
    entry.modes = Object.fromEntries(MODES.map(mode => {
      const blocks = entry.blocks.filter(block => block.mode === mode);
      return [mode, { cpuMs: summarize(blocks.flatMap(block => block.cpuSamplesMs)), rafMs: summarize(blocks.flatMap(block => block.rafSamplesMs)), finalResources: stats(mode) }];
    }));
    entry.visibilityAfter = visibility();
    return entry;
  }

  function capture(config, workload = 'dense') {
    for (const mode of MODES) {
      draw(mode, config, workload === 'dense' ? cameraFor(29, config) : { x: .125, y: .125 });
      const link = $(`${mode}-png`); link.href = canvases[mode].toDataURL('image/png');
      link.download = `boardfish-minification-${mode}-${workload}-${config.zoom}-dpr${config.dpr}.png`;
    }
  }
  function publish() {
    const output = JSON.stringify(result, null, 2); $('json').textContent = output;
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
    $('json-download').href = downloadURL; $('json-download').hidden = false;
    const phaseRows = (result.phaseSweeps || []).map(entry => {
      const worst = mode => Math.max(...['x', 'y'].flatMap(axis => entry.modes[mode].axes[axis].map(row => row.peakToPeakPercent)));
      return `<tr><td>${entry.zoom * 100}% / DPR ${entry.dpr}</td><td>${rounded(worst('before'), 2)}%</td><td>${rounded(worst('after'), 2)}%</td></tr>`;
    }).join('');
    const timingRows = (result.densePanning || []).map(entry => `<tr><td>${entry.zoom * 100}% / DPR ${entry.dpr}</td><td>${entry.modes.before.cpuMs.p50}</td><td>${entry.modes.after.cpuMs.p50}</td><td>${entry.modes.before.cpuMs.p95}</td><td>${entry.modes.after.cpuMs.p95}</td></tr>`).join('');
    $('summary').innerHTML = (phaseRows ? `<p>Worst integrated row-brightness variation over one physical pixel of travel (lower is steadier).</p><table><tr><th>Configuration</th><th>Previous</th><th>Current</th></tr>${phaseRows}</table>` : '') +
      (timingRows ? `<p>Dense panning CPU submission in milliseconds.</p><table><tr><th>Configuration</th><th>Previous p50</th><th>Current p50</th><th>Previous p95</th><th>Current p95</th></tr>${timingRows}</table>` : '');
  }

  async function run(kind) {
    if (busy || animated) return;
    busy = true; controls(); $('panels').scrollIntoView({ block: 'center', inline: 'nearest' });
    result = { benchmark: 'Boardfish text minification', at: new Date().toISOString(), userAgent: navigator.userAgent,
      baselineAvailable, portable, baselineDescription: baselineAvailable ? 'BoardfishGpuRendererBefore from gpu-text-before.js' : 'Unavailable: both panels use the current renderer',
      rendererEvents, phaseSweeps: [], densePanning: [] };
    const configurations = kind === 'all' ? [1, 2].flatMap(dpr => [.1, .125].map(zoom => ({ dpr, zoom }))) : [settings()];
    try {
      for (const config of configurations) {
        if (kind !== 'performance') { result.phaseSweeps.push(await phaseSweep(config)); publish(); }
        if (kind !== 'phases') { result.densePanning.push(await densePanning(config)); publish(); }
      }
      const config = configurations.at(-1), workload = kind === 'phases' ? 'phases' : 'dense';
      capture(config, workload); publish();
      $('status').textContent = `Complete. ${result.phaseSweeps.length} phase sweeps and ${result.densePanning.length} dense-panning comparisons. ${baselineAvailable ? 'Results and native PNGs are ready.' : 'Previous renderer unavailable; both panels used the current renderer.'}`;
    } catch (error) {
      result.error = String(error?.stack || error); publish(); $('status').textContent = `Benchmark failed: ${error.message}`;
    } finally { busy = false; controls(); }
  }

  async function animate() {
    if (busy) return;
    animated = !animated; controls();
    if (!animated) { animationGeneration++; $('status').textContent = 'Panning paused.'; return; }
    const generation = ++animationGeneration, config = settings();
    configure(config, 'dense'); $('panels').scrollIntoView({ block: 'center', inline: 'nearest' });
    $('status').textContent = `Panning three 100,000-character textboxes at ${config.zoom * 100}% and DPR ${config.dpr}.`;
    let index = 0;
    while (animated && generation === animationGeneration) {
      await frame();
      const step = index++ / 8, camera = { x: 16 - (step * 131 % 7100) * config.zoom, y: 18 - (step * 53 % 4300) * config.zoom };
      for (const mode of MODES) draw(mode, config, camera);
    }
  }

  async function initialize() {
    await document.fonts.load("normal 400 16px 'Geist Sans'"); await document.fonts.ready; refreshTextMetrics();
    STYLE.baselineOffset = TEXT_BASELINE_Y_OFFSET;
    const font = { ...BoardfishAsciiFont, atlasURL: `/${BoardfishAsciiFont.atlasURL}` };
    if (font.largeFont) font.largeFont = { ...font.largeFont, atlasURL: `/${font.largeFont.atlasURL}` };
    const integralFont = typeof BoardfishAsciiIntegralFont === 'undefined' ? undefined
      : { ...BoardfishAsciiIntegralFont, atlasURL: '/fonts/geist-ascii-integral.png' };
    for (const mode of MODES) {
      const api = mode === 'before' && baselineAvailable ? BoardfishGpuRendererBefore : BoardfishGpuRenderer;
      if (portable && mode === 'after') {
        const gl = canvases[mode].getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false,
          premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
        if (!gl) throw new Error('WebGL2 is unavailable.');
        const getExtension = gl.getExtension.bind(gl);
        gl.getExtension = name => /^(EXT_color_buffer_float|OES_texture_float_linear)$/.test(name) ? null : getExtension(name);
      }
      contexts[mode] = api.createContext(canvases[mode], { font, integralFont: mode === 'before' ? integralFont : undefined, coverageFont: { ...BoardfishAsciiCoverageFont, atlasURL: '/fonts/geist-ascii-coverage.png' }, onError: error => rendererEvents.push({ mode, error: String(error) }) });
      if (!contexts[mode] || !await contexts[mode].ready) throw new Error(`Could not initialize ${mode} GPU renderer.`);
    }
    if (!baselineAvailable) $('before-caption').textContent = 'Current renderer (previous unavailable)';
    configure(settings(), 'dense'); capture(settings());
    busy = false; controls(); $('status').textContent = 'Ready. Run all checks or animate panning to inspect the text.';
  }
  $('run-all').addEventListener('click', () => run('all'));
  $('phase').addEventListener('click', () => run('phases'));
  $('performance').addEventListener('click', () => run('performance'));
  $('animate').addEventListener('click', () => animate().catch(error => { animated = false; controls(); $('status').textContent = String(error); }));
  for (const id of ['dpr', 'zoom']) $(id).addEventListener('change', () => { configure(settings(), 'dense'); capture(settings()); });
  initialize().catch(error => { $('status').textContent = `Initialization failed: ${error.message}`; });
})();
