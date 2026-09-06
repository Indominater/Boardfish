'use strict';

(function gpuImageBenchmark() {
  const WIDTH = 340, HEIGHT = 224, BOUNDARY = Math.SQRT1_2;
  const MODES = window.BoardfishGpuRendererBefore ? ['before', 'current', 'canvas2d'] : ['current', 'canvas2d'];
  const $ = (id) => document.getElementById(id);
  const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const round = (value) => Math.round(value * 1000) / 1000;
  const canvases = Object.fromEntries(MODES.map((mode) => [mode, $(mode)]));
  const contexts = { canvas2d: canvases.canvas2d.getContext('2d') };
  const boardRenderer = BoardfishRenderer.createBoardRenderer({ imageBitmapCache: () => ({}) });
  const errors = [], sourceSets = new Map();
  let busy = false, current = null, lastResult = null;

  function setBusy(value) {
    busy = value;
    for (const id of ['run', 'pixels', 'seams', 'workload', 'motion', 'dpr', 'clipping']) $(id).disabled = value;
  }

  async function makeSource(width, height, index) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${index * 53 % 360} 70% 28%)`);
    gradient.addColorStop(1, `hsl(${(index * 53 + 100) % 360} 85% 75%)`);
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    for (let y = 0; y < height; y += 64) {
      for (let x = 0; x < width; x += 64) {
        context.fillStyle = ((x + y) / 64) % 2 ? '#ffffff30' : '#00000030';
        context.fillRect(x, y, 64, 64);
      }
    }
    context.strokeStyle = '#ffffff'; context.lineWidth = 3;
    for (let x = 13; x < width; x += 97) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x + 150, height); context.stroke(); }
    context.fillStyle = '#ffffff'; context.font = 'bold 100px monospace';
    context.fillText(`IMAGE ${index + 1}`, 48, 180);
    // Alpha cuts cross both a downsampled tile edge and an original 2048 edge.
    context.clearRect(width * 0.45, height * 0.38, width * 0.18, height * 0.13);
    context.fillStyle = '#40ffa080'; context.fillRect(width * 0.45, height * 0.38, width * 0.18, height * 0.13);
    const full = await createImageBitmap(canvas);
    const low = await createImageBitmap(canvas, { resizeWidth: width / 4, resizeHeight: height / 4, resizeQuality: 'high' });
    canvas.width = canvas.height = 0;
    return { full, low, width, height };
  }

  async function fixtures(workload) {
    if (sourceSets.has(workload)) return sourceSets.get(workload);
    const pressure = workload === 'pressure';
    const sources = [];
    for (let i = 0; i < (pressure ? 6 : 3); i++) {
      $('status').textContent = `Preparing immutable ${workload} image ${i + 1}…`;
      sources.push(await makeSource(pressure ? 4096 : 2048, pressure ? 3072 : 1536, i));
    }
    sourceSets.set(workload, sources);
    return sources;
  }

  function counters(mode) { return contexts[mode].getStats?.() || {}; }
  function delta(before, after) {
    return Object.fromEntries(Object.entries(after).filter(([key, value]) => Number.isFinite(value) && Number.isFinite(before[key])).map(([key, value]) => [key, round(value - before[key])]));
  }
  function distribution(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return { median: round(sorted[Math.floor(sorted.length / 2)]), p95: round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]), max: round(sorted[sorted.length - 1]) };
  }

  function resize(dpr) {
    for (const canvas of Object.values(canvases)) { canvas.width = WIDTH * dpr; canvas.height = HEIGHT * dpr; }
  }

  function draw(mode, index = 0, scale = 0.72, pixelCheck = false) {
    const context = contexts[mode], { sources, dpr } = current;
    context.beginFrame?.();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#1e1e24'; context.fillRect(0, 0, canvases[mode].width, canvases[mode].height);
    const panX = (index % 11) * 0.375 + 0.25, panY = (index % 7) * 0.25 + 0.375;
    context.setTransform(scale * dpr, 0, 0, scale * dpr, panX * dpr, panY * dpr);
    const viewport = { x1: -panX / scale, y1: -panY / scale, x2: (WIDTH - panX) / scale, y2: (HEIGHT - panY) / scale };
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i], image = scale <= BOUNDARY ? source.low : source.full;
      const w = source.width * 0.25 / BOUNDARY / dpr, h = source.height * 0.25 / BOUNDARY / dpr;
      context.save();
      context.globalAlpha = i ? 0.68 : 1;
      if (pixelCheck) {
        context.translate(140 + i * 15, 115 + i * 12);
        context.rotate((i - 1) * 0.21); if (i === 1) context.scale(-1, 1);
        const sx = image.width * 0.37, sy = image.height * 0.22, sw = image.width * 0.36, sh = image.height * 0.50;
        context.drawImage(image, sx, sy, sw, sh, -150, -90, 300, 180);
      } else if (current.uncropped) {
        context.drawImage(image, -w * 0.36 + i * 47, -h * 0.31 + i * 26, w, h);
      } else {
        const obj = { id: `fixture-${i}`, type: 'image', x: -w * 0.36 + i * 47, y: -h * 0.31 + i * 26, w, h, data: { imgKey: `fixture-${i}` } };
        boardRenderer.drawSingleObj(context, obj, null, viewport, { zoom: scale, dpr }, () => ({ source: image, scale: scale <= BOUNDARY ? 0.25 : 1 }));
      }
      context.restore();
    }
    context.endFrame?.();
  }

  function capture(mode) {
    const target = document.createElement('canvas');
    target.width = canvases[mode].width; target.height = canvases[mode].height;
    const context = target.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvases[mode], 0, 0);
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    const url = target.toDataURL('image/png');
    $(`${mode}-png`).href = url; $(`${mode}-png`).download = `boardfish-image-${mode}-${current.workload}.png`;
    return { pixels, url, width: target.width, height: target.height };
  }

  function pixelChecks(scale = 0.72) {
    const captures = {};
    for (const mode of MODES) { draw(mode, 0, scale, true); captures[mode] = capture(mode); }
    const reference = captures.canvas2d.pixels;
    return Object.fromEntries(MODES.map((mode) => {
      let difference = 0, maximum = 0, differing = 0, hash = 2166136261;
      const values = captures[mode].pixels;
      for (let i = 0; i < values.length; i += 4) {
        let local = 0;
        for (let c = 0; c < 3; c++) { const error = Math.abs(values[i + c] - reference[i + c]); difference += error; local += error; maximum = Math.max(maximum, error); hash = Math.imul(hash ^ values[i + c], 16777619); }
        if (local > 12) differing++;
      }
      return [mode, { width: captures[mode].width, height: captures[mode].height, meanAbsoluteChannelDifference: round(difference / (values.length / 4 * 3)), maxChannelDifference: maximum, pixelsDifferingByMoreThan12: differing, checksum: (hash >>> 0).toString(16) }];
    }));
  }

  function publish(result) {
    lastResult = result;
    $('json').textContent = JSON.stringify(result, null, 2);
    if (result.renderers) $('summary').innerHTML = '<table><tr><th>Renderer</th><th>CPU median / p95</th><th>rAF median / p95</th><th>Image uploads</th></tr>' + Object.entries(result.renderers).map(([mode, data]) => `<tr><td>${mode}</td><td>${data.cpuMs.median} / ${data.cpuMs.p95} ms</td><td>${data.rafMs?.median} / ${data.rafMs?.p95} ms</td><td>${data.counterDelta.imageUploads ?? 'browser managed'}</td></tr>`).join('') + '</table>';
    return result;
  }

  async function run(options = {}) {
    await ready;
    if (busy) throw new Error('Image benchmark is already running');
    setBusy(true);
    try {
      const workload = options.workload || 'modest', motion = options.motion || 'boundary', frames = Math.max(2, Math.floor(options.frames || 90)), dpr = options.dpr === 2 ? 2 : 1;
      current = { workload, motion, dpr, uncropped: options.uncropped === true, sources: await fixtures(workload) };
      resize(dpr);
      const results = Object.fromEntries(MODES.map((mode) => [mode, { cpu: [], intervals: [], before: null, after: null, warmup: null }]));
      const scaleAt = (index) => motion === 'native' ? BOUNDARY * 4 : motion === 'pan' ? 0.72 : index % 2 ? 0.72 : 0.68;
      for (const mode of MODES) {
        contexts[mode].resetResources?.();
        const before = counters(mode), started = performance.now();
        for (let i = 0; i < 6; i++) { await raf(); draw(mode, i, scaleAt(i)); }
        results[mode].warmup = { elapsedMs: round(performance.now() - started), counterDelta: delta(before, counters(mode)) };
        results[mode].before = counters(mode);
      }
      for (let block = 0; block < 2; block++) {
        const order = block ? MODES.slice().reverse() : MODES;
        const start = block ? Math.ceil(frames / 2) : 0, end = block ? frames : Math.ceil(frames / 2);
        for (const mode of order) {
          $('status').textContent = `${workload} ${motion}: ${mode}, block ${block + 1}/2…`;
          let previous = null;
          for (let i = start; i < end; i++) {
            const timestamp = await raf();
            if (previous !== null) results[mode].intervals.push(timestamp - previous);
            const started = performance.now(); draw(mode, i, scaleAt(i)); results[mode].cpu.push(performance.now() - started);
            previous = timestamp;
          }
        }
      }
      for (const mode of MODES) results[mode].after = counters(mode);
      const renderers = Object.fromEntries(MODES.map((mode) => {
        const data = results[mode];
        return [mode, { cpuMs: distribution(data.cpu), rafMs: distribution(data.intervals), rafIntervalsOver25Ms: data.intervals.filter((v) => v > 25).length, measuredFrames: data.cpu.length, counterDelta: delta(data.before, data.after), before: data.before, after: data.after, warmup: data.warmup }];
      }));
      for (const mode of MODES) { draw(mode, 0, scaleAt(1)); capture(mode); }
      const first = current.sources[0];
      const result = publish({ workload, motion, frames, dpr, clippingPolicy: current.uncropped ? 'complete source draws; no application viewport crop' : 'actual BoardfishRenderer.drawSingleObj viewport source crop and edge overdraw', browserDpr: devicePixelRatio, timestamp: new Date().toISOString(), visibility: document.visibilityState, userAgent: navigator.userAgent, sourceCount: current.sources.length, fullSize: [first.width, first.height], lowSize: [first.low.width, first.low.height], fullAndLowSourceBytes: current.sources.reduce((sum, source) => sum + (source.width * source.height + source.low.width * source.low.height) * 4, 0), widthCss: WIDTH, heightCss: HEIGHT, sourceBoundaryZoom: BOUNDARY, renderers, errors: errors.slice() });
      $('status').textContent = 'Complete. Native PNG links show the final measured transform.';
      return result;
    } finally { setBusy(false); }
  }

  async function checkPixels(options = {}) {
    await ready;
    if (busy) throw new Error('Image benchmark is already running');
    setBusy(true);
    try {
      const workload = options.workload || 'modest', dpr = options.dpr === 2 ? 2 : 1;
      current = { workload, dpr, sources: await fixtures(workload) }; resize(dpr);
      const result = publish({ kind: 'crop-rotation-alpha', dpr, scale: options.scale || 0.72, pixelChecks: pixelChecks(options.scale || 0.72) });
      $('status').textContent = 'Static pixel comparison ready. PNGs include cropped, rotated, flipped and translucent images.';
      return result;
    } finally { setBusy(false); }
  }

  async function checkSeams() {
    await ready;
    if (busy) throw new Error('Image benchmark is already running');
    setBusy(true);
    const width = 8193, height = 2049, levelWidth = 4097, levelHeight = 1025;
    let original, reference;
    try {
      $('status').textContent = 'Preparing an odd-sized high-frequency source and global half-resolution reference…';
      current = { workload: 'odd-source-seams', dpr: 1, sources: [] }; resize(1);
      const source = document.createElement('canvas'); source.width = width; source.height = height;
      const sourceContext = source.getContext('2d');
      const pattern = document.createElement('canvas'); pattern.width = 31; pattern.height = 29;
      const patternContext = pattern.getContext('2d'), data = patternContext.createImageData(pattern.width, pattern.height);
      for (let y = 0; y < pattern.height; y++) {
        for (let x = 0; x < pattern.width; x++) {
          const index = (y * pattern.width + x) * 4;
          data.data[index] = (x * 73 + y * 29) % 256;
          data.data[index + 1] = (x * 19 + y * 107) % 256;
          data.data[index + 2] = ((x + y) % 2) * 255;
          data.data[index + 3] = (x + y) % 7 ? 255 : 96;
        }
      }
      patternContext.putImageData(data, 0, 0);
      sourceContext.fillStyle = sourceContext.createPattern(pattern, 'repeat'); sourceContext.fillRect(0, 0, width, height);
      original = await createImageBitmap(source);
      const globalLevel = document.createElement('canvas'); globalLevel.width = levelWidth; globalLevel.height = levelHeight;
      const globalContext = globalLevel.getContext('2d'); globalContext.imageSmoothingEnabled = true; globalContext.imageSmoothingQuality = 'high';
      globalContext.drawImage(original, 0, 0, width, height, 0, 0, levelWidth, levelHeight);
      reference = await createImageBitmap(globalLevel);
      source.width = source.height = globalLevel.width = globalLevel.height = pattern.width = pattern.height = 0;
      const context = contexts.current;
      context.resetResources();
      const initialStats = counters('current');
      const drawSeam = (image, phase) => {
        context.beginFrame(); context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = '#1e1e24'; context.fillRect(0, 0, WIDTH, HEIGHT);
        // Original source density is exactly 1/2, so its selected upload level
        // is ceil(8193/2) × ceil(2049/2). The reference is already that size;
        // both sources are rendered through the same GL shader and geometry.
        const density = 0.5;
        context.setTransform(density, 0, 0, density,
          WIDTH / 2 - density * (2048 * width / levelWidth) + phase,
          HEIGHT / 2 - density * (512 * height / levelHeight) + 0.375);
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.globalAlpha = 1;
        context.drawImage(image, 0, 0, width, height); context.endFrame();
        return capture('current');
      };
      const phases = [];
      let lastActual, lastReference;
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        const actual = drawSeam(original, phase), expected = drawSeam(reference, phase);
        const groups = { seam: { pixels: 0, differing: 0, difference: 0, maximum: 0 }, away: { pixels: 0, differing: 0, difference: 0, maximum: 0 } };
        for (let y = 2; y < HEIGHT - 2; y++) {
          for (let x = 2; x < WIDTH - 2; x++) {
            const group = Math.abs(x + 0.5 - (WIDTH / 2 + phase)) <= 3 ? groups.seam : groups.away;
            group.pixels++; let sum = 0;
            for (let channel = 0; channel < 3; channel++) {
              const index = (y * WIDTH + x) * 4 + channel, difference = Math.abs(actual.pixels[index] - expected.pixels[index]);
              sum += difference; group.difference += difference; group.maximum = Math.max(group.maximum, difference);
            }
            if (sum > 3) group.differing++;
          }
        }
        phases.push({ phase, groups: Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, { testedPixels: group.pixels, pixelsWithRgbDifferenceOver3: group.differing, meanAbsoluteChannelDifference: round(group.difference / (group.pixels * 3)), maximumChannelDifference: group.maximum }])) });
        lastActual = actual; lastReference = expected;
      }
      let previews = $('seam-previews');
      if (!previews) { previews = document.createElement('div'); previews.id = 'seam-previews'; previews.style.display = 'flex'; previews.style.gap = '12px'; $('panels').parentNode.after(previews); }
      previews.replaceChildren();
      for (const [label, snapshot] of [['GPU tiles downsampled from 8193 × 2049', lastActual], ['GPU drawing globally resized 4097 × 1025 reference', lastReference]]) {
        const figure = document.createElement('figure'), caption = document.createElement('figcaption'), image = document.createElement('img'), link = document.createElement('a');
        caption.textContent = label; image.src = snapshot.url; image.width = WIDTH; image.height = HEIGHT; image.style.display = 'block';
        link.href = snapshot.url; link.download = label.startsWith('GPU tiles') ? 'boardfish-odd-source-tile-seam.png' : 'boardfish-odd-source-global-reference.png'; link.textContent = 'Native PNG';
        figure.append(caption, image, link); previews.append(figure);
      }
      const result = publish({ kind: 'odd-source-tile-seam', source: [width, height], level: [levelWidth, levelHeight], tileBoundaryInLevelPixels: 2048, renderedSourceDensity: 0.5, comparison: 'same GPU path: original odd-size source versus a single globally downsized immutable bitmap; ignores two outer viewport pixels', phases, counterDelta: delta(initialStats, counters('current')) });
      $('status').textContent = 'Odd-size seam comparison ready. The tile seam lies at the center of each native preview.';
      return result;
    } finally {
      contexts.current.resetResources(); original?.close(); reference?.close(); setBusy(false);
    }
  }

  const ready = (async () => {
    const font = { ...BoardfishAsciiFont, atlasURL: '../' + BoardfishAsciiFont.atlasURL, largeFont: { ...BoardfishAsciiFont.largeFont, atlasURL: '../' + BoardfishAsciiFont.largeFont.atlasURL } };
    for (const mode of MODES.filter((value) => value !== 'canvas2d')) {
      const renderer = mode === 'before' ? BoardfishGpuRendererBefore : BoardfishGpuRenderer;
      contexts[mode] = renderer.createContext(canvases[mode], { font, onError: (error) => errors.push({ mode, error: String(error) }) });
      if (!contexts[mode] || !await contexts[mode].ready) throw new Error(`${mode} renderer failed to initialize`);
    }
    resize(1); setBusy(false); $('status').textContent = 'Ready. Baseline, current GPU and Canvas2D run against identical immutable sources.';
    return true;
  })();
  ready.catch((error) => { $('status').textContent = String(error); });
  $('run').addEventListener('click', () => run({ workload: $('workload').value, motion: $('motion').value, dpr: Number($('dpr').value), uncropped: $('clipping').value === 'uncropped' }).catch((error) => { $('status').textContent = String(error); }));
  $('pixels').addEventListener('click', () => checkPixels({ dpr: Number($('dpr').value) }).catch((error) => { $('status').textContent = String(error); }));
  $('seams').addEventListener('click', () => checkSeams().catch((error) => { $('status').textContent = String(error); }));
  window.BoardfishGpuImageBenchmark = { ready, run, checkPixels, checkSeams, getResult: () => lastResult };
})();
