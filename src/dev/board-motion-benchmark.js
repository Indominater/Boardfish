'use strict';

(function boardMotionBenchmark() {
  const WIDTH = 400, HEIGHT = 256, PHASES = 32, INSET = 24;
  const MODES = ['before', 'after'], BACKGROUND = '#1e1e24', FOREGROUND = '#ededf2';
  const STYLE = { fontSize: FONT_SIZE, padding: TEXT_PAD, lineHeight: LINE_H, baselineOffset: TEXT_BASELINE_Y_OFFSET };
  const $ = id => document.getElementById(id);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const round = (value, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;
  const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const rms = values => Math.sqrt(mean(values.map(value => value * value)));
  const canvases = Object.fromEntries(MODES.map(mode => [mode, $(mode)]));
  const contexts = {}, copies = {}, rendererEvents = [], scenes = {}, gpuTimers = {};
  const parameters = new URLSearchParams(location.search);
  const baselineAvailable = typeof BoardfishGpuRendererBefore !== 'undefined';
  const portable = parameters.get('portable') === '1';
  const textTileCacheEnabled = parameters.get('cache') !== '0';
  const requestedTileBytes = parameters.has('budget') ? Number(parameters.get('budget')) : undefined;
  const tileBudget = Number.isFinite(requestedTileBytes) && requestedTileBytes >= 0 ? requestedTileBytes : undefined;
  let fixture = [], focus, busy = true, animated = false, generation = 0, result = null, downloadURL;

  function controls() {
    for (const id of ['dpr', 'zoom', 'text-cache', 'phase-position', 'phases', 'performance', 'run-all']) $(id).disabled = busy || animated;
    $('animate').disabled = busy;
    $('animate').textContent = animated ? 'Stop animation' : 'Animate pan / zoom';
  }
  function settings() { return { zoom: Number($('zoom').value), dpr: Number($('dpr').value) }; }
  function configure(config) {
    $('dpr').value = String(config.dpr); $('zoom').value = String(config.zoom);
    for (const mode of MODES) {
      if (canvases[mode].width !== WIDTH * config.dpr) canvases[mode].width = WIDTH * config.dpr;
      if (canvases[mode].height !== HEIGHT * config.dpr) canvases[mode].height = HEIGHT * config.dpr;
    }
  }
  function focusCamera(config, obj = focus, phaseX = 0, phaseY = 0) {
    return { x: WIDTH / 2 - (obj.x + obj.w / 2) * config.zoom + phaseX / config.dpr,
      y: HEIGHT / 2 - (obj.y + obj.h / 2) * config.zoom + phaseY / config.dpr };
  }
  function draw(mode, config, camera = focusCamera(config)) {
    const context = contexts[mode], scene = scenes[mode], canvas = canvases[mode];
    context.beginFrame(scene); context.resetTransform();
    context.fillStyle = BACKGROUND; context.fillRect(0, 0, canvas.width, canvas.height);
    const density = config.zoom * config.dpr;
    context.setTransform(density, 0, 0, density, camera.x * config.dpr, camera.y * config.dpr);
    context.font = FONT; context.textBaseline = 'alphabetic'; configureTextCanvasContext(context); context.fillStyle = FOREGROUND;
    const viewport = { x1: -camera.x / config.zoom, y1: -camera.y / config.zoom,
      x2: (WIDTH - camera.x) / config.zoom, y2: (HEIGHT - camera.y) / config.zoom };
    let visibleObjects = 0, visibleRows = 0, visibleCharacters = 0;
    for (const obj of scene) {
      if (obj.x > viewport.x2 || obj.x + obj.w < viewport.x1 || obj.y > viewport.y2 || obj.y + obj.h < viewport.y1) continue;
      const layout = getTextLayoutForViewport(obj, viewport);
      visibleObjects++; visibleRows += layout.length;
      for (const line of layout) visibleCharacters += line.text.length;
      if (!context.drawTextLayout(layout, obj, STYLE)) throw new Error(`${mode} declined text object ${obj.id}; GPU-only comparison is unavailable.`);
    }
    context.endFrame();
    return { visibleObjects, visibleRows, visibleCharacters };
  }
  function readPixels(mode) {
    const source = canvases[mode];
    if (!copies[mode]) {
      const canvas = document.createElement('canvas');
      copies[mode] = { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
    }
    const copy = copies[mode];
    if (copy.canvas.width !== source.width) copy.canvas.width = source.width;
    if (copy.canvas.height !== source.height) copy.canvas.height = source.height;
    copy.context.clearRect(0, 0, source.width, source.height); copy.context.drawImage(source, 0, 0);
    return copy.context.getImageData(0, 0, source.width, source.height);
  }
  function cropSignal(image, config) {
    const inset = INSET * config.dpr, width = image.width - 2 * inset, height = image.height - 2 * inset;
    const pixels = new Float32Array(width * height), rows = [];
    for (let y = 0; y < height; y++) {
      let total = 0;
      for (let x = 0; x < width; x++) {
        const at = ((y + inset) * image.width + x + inset) * 4;
        const value = (image.data[at] - 30) / (237 - 30);
        pixels[y * width + x] = value; total += value;
      }
      rows.push(total / width);
    }
    const brightness = mean(rows);
    return { width, height, pixels, rows, brightness, rowContrast: rms(rows.map(value => value - brightness)) };
  }
  function summarize(values) {
    const sorted = values.slice().sort((a, b) => a - b), average = mean(values);
    const percentile = q => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] || 0;
    return { count: values.length, min: round(sorted[0] || 0), max: round(sorted.at(-1) || 0), mean: round(average),
      p50: round(percentile(.5)), p95: round(percentile(.95)), peakToPeakPercent: round(average ? (sorted.at(-1) - sorted[0]) / average * 100 : 0) };
  }
  function differenceRms(current, previous, older) {
    let energy = 0;
    for (let i = 0; i < current.length; i++) {
      const difference = older ? current[i] - 2 * previous[i] + older[i] : current[i] - previous[i];
      energy += difference * difference;
    }
    return Math.sqrt(energy / current.length);
  }

  // Double-precision, reorthogonalized modified Gram-Schmidt. Explicit rank
  // checks prevent a folded harmonic being reported as separately measured
  // when it is actually indistinguishable from a lower line harmonic.
  function orthogonalFit(columns) {
    const q = [], r = [], norms = [];
    for (let j = 0; j < columns.length; j++) {
      const vector = Float64Array.from(columns[j]);
      r[j] = Array(columns.length).fill(0);
      for (let pass = 0; pass < 2; pass++) for (let k = 0; k < j; k++) {
        let projection = 0;
        for (let i = 0; i < vector.length; i++) projection += q[k][i] * vector[i];
        r[k][j] += projection;
        for (let i = 0; i < vector.length; i++) vector[i] -= projection * q[k][i];
      }
      let energy = 0;
      for (const value of vector) energy += value * value;
      const norm = Math.sqrt(energy); norms.push(norm);
      if (norm < Math.sqrt(vector.length) * 1e-8) return { identifiable: false, reason: 'The sampled harmonic basis is rank deficient.' };
      r[j][j] = norm;
      for (let i = 0; i < vector.length; i++) vector[i] /= norm;
      q.push(vector);
    }
    return { identifiable: true, smallestOrthogonalNormRatio: Math.min(...norms) / Math.max(...norms), fit(values) {
      const coefficients = q.map(vector => {
        let projection = 0;
        for (let i = 0; i < vector.length; i++) projection += vector[i] * values[i];
        return projection;
      });
      for (let j = coefficients.length - 1; j >= 0; j--) {
        for (let k = j + 1; k < coefficients.length; k++) coefficients[j] -= r[j][k] * coefficients[k];
        coefficients[j] /= r[j][j];
      }
      let residualEnergy = 0;
      for (let i = 0; i < values.length; i++) {
        let predicted = 0;
        for (let j = 0; j < coefficients.length; j++) predicted += columns[j][i] * coefficients[j];
        residualEnergy += (values[i] - predicted) ** 2;
      }
      return { coefficients, residualRms: Math.sqrt(residualEnergy / values.length) };
    } };
  }

  function aliasBands(samples, config, axis) {
    const pitch = LINE_H * config.zoom * config.dpr;
    const firstAliasedHarmonic = Math.floor(pitch / 2 + 1e-9) + 1;
    const sourceFrequency = firstAliasedHarmonic / pitch;
    const signedAliasFrequency = sourceFrequency - Math.round(sourceFrequency);
    const metadata = { linePitchPhysicalPx: round(pitch), firstAliasedHarmonic, sourceCyclesPerPixel: round(sourceFrequency),
      foldedCyclesPerPixel: round(Math.abs(signedAliasFrequency)), physicalFontEm: round(FONT_SIZE * config.zoom * config.dpr) };
    if (FONT_SIZE * config.zoom * config.dpr >= 12) return { ...metadata, skipped: 'Coherent line alias analysis is limited to minified text below 12 physical pixels per em.' };
    const rows = samples[0].rowMeans.length, columns = [new Float64Array(rows).fill(1), Float64Array.from({ length: rows }, (_, y) => (y - rows / 2) / rows)];
    const harmonicColumns = [], frequencies = [];
    let spatialReason = null;
    for (let harmonic = 1; harmonic <= firstAliasedHarmonic; harmonic++) {
      const unfolded = harmonic / pitch, folded = Math.abs(unfolded - Math.round(unfolded));
      if (folded < 1e-8 || frequencies.some(value => Math.abs(value - folded) < 1e-8)) {
        spatialReason = 'The alias coincides with DC or a legitimate sampled line harmonic; spatial amplitude cannot identify its source.';
        break;
      }
      frequencies.push(folded);
      const indices = [columns.length];
      columns.push(Float64Array.from({ length: rows }, (_, y) => Math.cos(2 * Math.PI * folded * y)));
      if (Math.abs(folded - .5) > 1e-8) {
        indices.push(columns.length);
        columns.push(Float64Array.from({ length: rows }, (_, y) => Math.sin(2 * Math.PI * folded * y)));
      }
      harmonicColumns.push(indices);
    }
    let spatial;
    if (spatialReason) spatial = { identifiable: false, reason: spatialReason };
    else {
      const model = orthogonalFit(columns);
      if (!model.identifiable) spatial = model;
      else {
        const amplitudes = [], fundamentals = [], residuals = [];
        for (const sample of samples) {
          const fit = model.fit(sample.rowMeans);
          const amplitude = indices => Math.hypot(...indices.map(index => fit.coefficients[index]));
          amplitudes.push(amplitude(harmonicColumns.at(-1))); fundamentals.push(amplitude(harmonicColumns[0])); residuals.push(fit.residualRms);
        }
        spatial = { identifiable: true, smallestOrthogonalNormRatio: round(model.smallestOrthogonalNormRatio),
          aliasedAmplitude: summarize(amplitudes), fundamentalAmplitude: summarize(fundamentals), residualRms: summarize(residuals),
          aliasAmplitudeRelativeToMeanInkPercent: round(100 * mean(amplitudes) / Math.max(1e-12, mean(samples.map(sample => sample.meanBrightness)))),
          aliasedAmplitudeSamples: amplitudes.map(value => round(value)), fundamentalAmplitudeSamples: fundamentals.map(value => round(value)) };
      }
    }
    if (axis !== 'y') return { ...metadata, spatial, jointSpacePhase: { skipped: 'A horizontal sweep has no known vertical temporal phase.' } };

    // Sampling folds spatial frequency but preserves the source frequency's
    // pan-phase rotation. Joint fitting can therefore identify alias sources
    // even at integer pitches where a single image cannot distinguish them.
    const count = samples.length * rows;
    const jointColumns = [new Float64Array(count).fill(1), Float64Array.from({ length: count }, (_, i) => (i % rows - rows / 2) / rows)];
    const jointHarmonics = [], harmonicLimit = firstAliasedHarmonic + 2;
    for (let harmonic = 1; harmonic <= harmonicLimit; harmonic++) {
      const frequency = harmonic / pitch, indices = [jointColumns.length, jointColumns.length + 1];
      const cosine = new Float64Array(count), sine = new Float64Array(count);
      for (let phase = 0; phase < samples.length; phase++) for (let y = 0; y < rows; y++) {
        const angle = 2 * Math.PI * frequency * (y - samples[phase].phasePhysicalPx), at = phase * rows + y;
        cosine[at] = Math.cos(angle); sine[at] = Math.sin(angle);
      }
      jointColumns.push(cosine, sine); jointHarmonics.push({ harmonic, frequency, indices });
    }
    const jointModel = orthogonalFit(jointColumns);
    let jointSpacePhase;
    if (!jointModel.identifiable) jointSpacePhase = jointModel;
    else {
      const fit = jointModel.fit(Float64Array.from(samples.flatMap(sample => sample.rowMeans)));
      const harmonics = jointHarmonics.map(({ harmonic, frequency, indices }) => ({ harmonic, sourceCyclesPerPixel: round(frequency),
        foldedCyclesPerPixel: round(Math.abs(frequency - Math.round(frequency))), aboveNyquist: frequency > .5 + 1e-9,
        amplitude: round(Math.hypot(...indices.map(index => fit.coefficients[index]))) }));
      const target = harmonics[firstAliasedHarmonic - 1];
      jointSpacePhase = { identifiable: true, fittedHarmonicCount: harmonicLimit, smallestOrthogonalNormRatio: round(jointModel.smallestOrthogonalNormRatio),
        residualRms: round(fit.residualRms), meanInk: round(fit.coefficients[0]), firstAliasedAmplitude: target.amplitude,
        firstAliasedAmplitudeRelativeToMeanInkPercent: round(100 * target.amplitude / Math.max(1e-12, fit.coefficients[0])),
        harmonics, note: 'A coherent periodic-source fit; residuals include nonperiodic content, unmodeled higher harmonics, and quantization.' };
    }
    return { ...metadata, spatial, jointSpacePhase };
  }
  function stats(mode) { return JSON.parse(JSON.stringify(contexts[mode].getStats())); }
  function delta(before, after) {
    return Object.fromEntries(Object.keys(after).filter(key => Number.isFinite(before[key]) && Number.isFinite(after[key]))
      .map(key => [key, round(after[key] - before[key])]));
  }
  function visibility() {
    return { hidden: document.hidden, devicePixelRatio, panels: Object.fromEntries(MODES.map(mode => {
      const rect = canvases[mode].getBoundingClientRect();
      return [mode, { mounted: canvases[mode].isConnected, fullyVisible: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        cssWidth: rect.width, cssHeight: rect.height, backingWidth: canvases[mode].width, backingHeight: canvases[mode].height }];
    })) };
  }
  async function phaseSweep(config) {
    configure(config);
    const cropContainsFocusEdges = focus.w * config.zoom < WIDTH - 2 * INSET + 2 || focus.h * config.zoom < HEIGHT - 2 * INSET + 2;
    const entry = { ...config, focusId: focus.id, phases: PHASES, physicalPixelTravel: (PHASES - 1) / PHASES,
      cropInsetCss: INSET, cropContainsFocusEdges, visibility: visibility(), modes: {} };
    for (const mode of MODES) {
      const before = stats(mode), axes = {};
      for (const axis of ['x', 'y']) {
        const samples = [], adjacentPixelRms = [], secondPixelRms = [], adjacentRowRms = [], secondRowRms = [];
        let previous, older;
        for (let phase = 0; phase < PHASES; phase++) {
          const counts = draw(mode, config, focusCamera(config, focus, axis === 'x' ? phase / PHASES : 0, axis === 'y' ? phase / PHASES : 0));
          const signal = cropSignal(readPixels(mode), config);
          if (previous) {
            adjacentPixelRms.push(differenceRms(signal.pixels, previous.pixels));
            adjacentRowRms.push(differenceRms(signal.rows, previous.rows));
          }
          if (older) {
            secondPixelRms.push(differenceRms(signal.pixels, previous.pixels, older.pixels));
            secondRowRms.push(differenceRms(signal.rows, previous.rows, older.rows));
          }
          samples.push({ phasePhysicalPx: phase / PHASES, meanBrightness: round(signal.brightness), rowContrastRms: round(signal.rowContrast),
            rowMeans: signal.rows.map(value => round(value)), ...counts });
          older = previous; previous = signal;
          if (phase % 8 === 7) { $('status').textContent = `Real-board phases: ${config.zoom * 100}% · DPR ${config.dpr} · ${mode} · ${axis} ${phase + 1}/${PHASES}`; await frame(); }
        }
        axes[axis] = { brightness: summarize(samples.map(sample => sample.meanBrightness)), rowContrast: summarize(samples.map(sample => sample.rowContrastRms)),
          adjacentPixelRms: summarize(adjacentPixelRms), secondPixelRms: summarize(secondPixelRms), adjacentRowRms: summarize(adjacentRowRms), secondRowRms: summarize(secondRowRms),
          adjacentPixelRmsSamples: adjacentPixelRms.map(value => round(value)), secondPixelRmsSamples: secondPixelRms.map(value => round(value)),
          adjacentRowRmsSamples: adjacentRowRms.map(value => round(value)), secondRowRmsSamples: secondRowRms.map(value => round(value)),
          aliasBands: aliasBands(samples, config, axis), samples };
      }
      entry.modes[mode] = { axes, resources: delta(before, stats(mode)) };
    }
    return entry;
  }
  function motionCamera(index, config) {
    const section = Math.floor(index / 20) % fixture.length, obj = fixture[section];
    const travel = (index % 20) / 19;
    const camera = focusCamera(config, obj);
    camera.x += (travel - .5) * Math.min(obj.w * config.zoom * .65, WIDTH * 1.1);
    camera.y += (travel - .5) * Math.min(obj.h * config.zoom * .75, HEIGHT * 1.6);
    return camera;
  }
  async function timedBlock(mode, config, blockIndex) {
    for (let i = 0; i < 12; i++) { await frame(); draw(mode, config, motionCamera(i * 10, config)); }
    const before = stats(mode), cpu = [], intervals = [], drawCounts = [];
    const timer = gpuTimers[mode], queries = [], gpuSamplesMs = [], gpuSampleStatus = [];
    let disjoint = false;
    const collectGpuQueries = () => {
      if (!timer.extension) return;
      if (timer.gl.getParameter(timer.extension.GPU_DISJOINT_EXT)) disjoint = true;
      for (const entry of queries) {
        if (!entry.query || !timer.gl.getQueryParameter(entry.query, timer.gl.QUERY_RESULT_AVAILABLE)) continue;
        const nanoseconds = timer.gl.getQueryParameter(entry.query, timer.gl.QUERY_RESULT);
        gpuSamplesMs[entry.index] = disjoint ? null : round(nanoseconds / 1000000);
        gpuSampleStatus[entry.index] = disjoint ? 'disjoint' : 'available';
        timer.gl.deleteQuery(entry.query); entry.query = null;
      }
    };
    let previous = await frame();
    for (let i = 0; i < 60; i++) {
      let query;
      if (timer.extension) {
        query = timer.gl.createQuery();
        timer.gl.beginQuery(timer.extension.TIME_ELAPSED_EXT, query);
      }
      const started = performance.now();
      drawCounts.push(draw(mode, config, motionCamera(i + (blockIndex >= 2 ? 60 : 0), config)));
      cpu.push(performance.now() - started);
      if (query) {
        timer.gl.endQuery(timer.extension.TIME_ELAPSED_EXT);
        queries.push({ index: i, query }); gpuSamplesMs.push(null); gpuSampleStatus.push('pending');
      }
      const at = await frame(); intervals.push(at - previous); previous = at;
      collectGpuQueries();
    }
    // Results are polled after presentation opportunities; never wait for GPU
    // completion or perform readback inside the measured frames.
    for (let retry = 0; queries.some(entry => entry.query) && retry < 8; retry++) { await frame(); collectGpuQueries(); }
    for (const entry of queries) if (entry.query) {
      timer.gl.deleteQuery(entry.query); entry.query = null; gpuSampleStatus[entry.index] = disjoint ? 'disjoint' : 'unresolved';
    }
    if (disjoint) for (let i = 0; i < gpuSamplesMs.length; i++) { gpuSamplesMs[i] = null; gpuSampleStatus[i] = 'disjoint'; }
    const validGpuSamples = gpuSamplesMs.filter(Number.isFinite);
    return { mode, blockIndex, cpuMs: summarize(cpu), rafMs: summarize(intervals), cpuSamplesMs: cpu.map(value => round(value)),
      rafSamplesMs: intervals.map(value => round(value)), drawCounts, resources: delta(before, stats(mode)),
      gpuTimerAvailable: !!timer.extension, gpuDisjoint: disjoint, gpuMs: validGpuSamples.length ? summarize(validGpuSamples) : null,
      gpuSamplesMs, gpuSampleStatus };
  }
  async function performanceRun(config) {
    configure(config);
    const entry = { ...config, framesPerRenderer: 120, warmupsPerBlock: 12, visibility: visibility(), blocks: [] };
    for (const [blockIndex, mode] of ['before', 'after', 'after', 'before'].entries()) {
      $('status').textContent = `Real-board panning: ${config.zoom * 100}% · DPR ${config.dpr} · ${mode} · block ${blockIndex + 1}/4`;
      entry.blocks.push(await timedBlock(mode, config, blockIndex));
    }
    entry.modes = Object.fromEntries(MODES.map(mode => {
      const blocks = entry.blocks.filter(block => block.mode === mode);
      const gpuSamples = blocks.flatMap(block => block.gpuSamplesMs).filter(Number.isFinite);
      return [mode, { cpuMs: summarize(blocks.flatMap(block => block.cpuSamplesMs)), rafMs: summarize(blocks.flatMap(block => block.rafSamplesMs)),
        gpuTimerAvailable: !!gpuTimers[mode].extension, gpuMs: gpuSamples.length ? summarize(gpuSamples) : null, finalResources: stats(mode) }];
    }));
    entry.visibilityAfter = visibility();
    return entry;
  }
  async function capture(config, saveEvidence = false) {
    const captures = [];
    for (const mode of MODES) {
      draw(mode, config, focusCamera(config, focus, 0, Number($('phase-position').value) / PHASES));
      $(`${mode}-png`).href = canvases[mode].toDataURL('image/png');
      $(`${mode}-png`).download = `board-motion-${mode}-${config.zoom}-dpr${config.dpr}.png`;
      if (saveEvidence) captures.push(new Promise((resolve, reject) => {
        canvases[mode].toBlob(blob => blob ? resolve({ mode, blob }) : reject(new Error(`${mode} PNG capture failed.`)), 'image/png');
      }));
    }
    if (saveEvidence) {
      const images = await Promise.all(captures);
      result.pngEvidence = await Promise.all(images.map(async ({ mode, blob }) => {
        const path = `/__evidence/board-motion-${mode}.png`;
        try {
          const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
          return { mode, path, ...config, saved: response.ok, status: response.status, bytes: blob.size };
        } catch (error) { return { mode, path, ...config, saved: false, error: String(error) }; }
      }));
    }
  }
  async function publish() {
    const json = JSON.stringify(result, null, 2); $('json').textContent = json;
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    $('json-download').href = downloadURL; $('json-download').hidden = false;
    const phaseRows = result.phaseSweeps.map(entry => {
      const value = mode => entry.modes[mode].axes.y.rowContrast.peakToPeakPercent;
      return `<tr><td>${entry.zoom * 100}% / DPR ${entry.dpr}</td><td>${value('before')}%</td><td>${value('after')}%</td></tr>`;
    }).join('');
    const aliasRows = result.phaseSweeps.filter(entry => !entry.modes.after.axes.y.aliasBands.skipped).map(entry => {
      const value = mode => {
        const fit = entry.modes[mode].axes.y.aliasBands.jointSpacePhase;
        return fit.identifiable ? `${fit.firstAliasedAmplitudeRelativeToMeanInkPercent}%` : 'Unidentifiable';
      };
      return `<tr><td>${entry.zoom * 100}% / DPR ${entry.dpr}</td><td>${value('before')}</td><td>${value('after')}</td></tr>`;
    }).join('');
    const timingCell = mode => `${mode.cpuMs.p50} / ${mode.cpuMs.p95}${mode.gpuMs ? `<br>GPU ${mode.gpuMs.p50} / ${mode.gpuMs.p95}` : '<br>GPU unavailable'}`;
    const timings = result.performance.map(entry => `<tr><td>${entry.zoom * 100}% / DPR ${entry.dpr}</td><td>${timingCell(entry.modes.before)}</td><td>${timingCell(entry.modes.after)}</td></tr>`).join('');
    $('summary').innerHTML = (aliasRows ? `<p>First coherent aliased line harmonic: fitted amplitude / mean ink, using space and pan phase. Lower indicates less alias energy.</p><table><tr><th>Configuration</th><th>Previous</th><th>Current</th></tr>${aliasRows}</table>` : '') +
      (phaseRows ? `<p>Y-pan row-contrast modulation, peak-to-peak / mean.</p><table><tr><th>Configuration</th><th>Previous</th><th>Current</th></tr>${phaseRows}</table>` : '') +
      (timings ? `<p>Real-board CPU submission: p50 / p95 milliseconds.</p><table><tr><th>Configuration</th><th>Previous</th><th>Current</th></tr>${timings}</table>` : '');
    try {
      const response = await fetch('/__evidence/board-motion.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
      if (!response.ok) rendererEvents.push({ evidenceSaveStatus: response.status });
    } catch (error) { rendererEvents.push({ evidenceSaveError: String(error) }); }
  }
  async function run(kind) {
    if (busy || animated) return;
    busy = true; controls(); $('panels').scrollIntoView({ block: 'center', inline: 'nearest' });
    result = { benchmark: 'Boardfish actual boardTest.bf motion', at: new Date().toISOString(), userAgent: navigator.userAgent,
      baselineAvailable, portable, textTileCacheEnabled, tileBudget, baselineDescription: baselineAvailable ? 'Snapshot in gpu-motion-before.js' : 'Unavailable: both panels use the current renderer',
      fixture: fixture.map(obj => ({ id: obj.id, x: obj.x, y: obj.y, w: obj.w, h: obj.h, characters: obj.data.content.length })),
      gpuTimerExtension: 'EXT_disjoint_timer_query_webgl2', gpuTimerAvailability: Object.fromEntries(MODES.map(mode => [mode, !!gpuTimers[mode].extension])),
      rendererEvents, phaseSweeps: [], performance: [] };
    const configurations = kind === 'all' ? [1, 2].flatMap(dpr => [.1, .125, .15, .2, .25, .5, 1].map(zoom => ({ dpr, zoom }))) : [settings()];
    try {
      for (const config of configurations) {
        if (kind !== 'performance') result.phaseSweeps.push(await phaseSweep(config));
        if (kind !== 'phases') result.performance.push(await performanceRun(config));
        await publish();
      }
      await capture(configurations.at(-1), true); await publish();
      $('status').textContent = `Complete: ${result.phaseSweeps.length} phase sweeps, ${result.performance.length} panning comparisons. JSON and native PNGs are ready.`;
    } catch (error) {
      result.error = String(error?.stack || error); await publish(); $('status').textContent = `Benchmark failed: ${error.message}`;
    } finally { busy = false; controls(); }
  }
  async function animate() {
    if (busy) return;
    animated = !animated; controls();
    if (!animated) { generation++; capture(settings()); $('status').textContent = 'Animation paused.'; return; }
    const animation = ++generation, config = settings();
    configure(config); $('panels').scrollIntoView({ block: 'center', inline: 'nearest' });
    let index = 0;
    while (animated && animation === generation) {
      await frame();
      const t = index++ / 60, zoom = .1 + .15 * (.5 + .5 * Math.sin(t / 4));
      const animatedConfig = { ...config, zoom }, camera = focusCamera(animatedConfig);
      camera.x += Math.sin(t * .31) * 150; camera.y += Math.sin(t * .17) * 80 + t * .65 % 1;
      for (const mode of MODES) draw(mode, animatedConfig, camera);
      if (index % 12 === 0) $('status').textContent = `Actual obj-545 · pan / zoom ${(zoom * 100).toFixed(2)}% · DPR ${config.dpr}`;
    }
  }
  async function initialize() {
    const response = await fetch('/__fixture/board.json');
    if (!response.ok) throw new Error(`Actual board fixture unavailable (${response.status}). Start the local reproduction server.`);
    const data = await response.json(), allObjects = Array.isArray(data) ? data : data.objects || data.document?.objects || data.board?.objects;
    if (!Array.isArray(allObjects)) throw new Error('Actual board JSON has no objects array.');
    fixture = allObjects.filter(obj => obj.type === 'text').map(obj => ({ ...obj, data: { ...obj.data } }));
    if (!fixture.length) throw new Error('Actual board JSON contains no textboxes.');
    focus = fixture.find(obj => obj.id === 'obj-545') || fixture.reduce((largest, obj) => obj.data.content.length > largest.data.content.length ? obj : largest);
    for (const mode of MODES) scenes[mode] = fixture.map(obj => ({ ...obj, data: { ...obj.data } }));
    $('fixture').textContent = `Actual boardTest.bf: ${fixture.length} textboxes, ${fixture.reduce((sum, obj) => sum + obj.data.content.length, 0).toLocaleString()} characters. Phase focus: ${focus.id} (${focus.data.content.length.toLocaleString()} characters).`;
    await document.fonts.load("normal 400 16px 'Geist Sans'"); await document.fonts.ready; refreshTextMetrics(); STYLE.baselineOffset = TEXT_BASELINE_Y_OFFSET;
    const font = { ...BoardfishAsciiFont, atlasURL: `/${BoardfishAsciiFont.atlasURL}` };
    if (font.largeFont) font.largeFont = { ...font.largeFont, atlasURL: `/${font.largeFont.atlasURL}` };
    const coverageFont = typeof BoardfishAsciiCoverageFont === 'undefined' ? undefined : { ...BoardfishAsciiCoverageFont, atlasURL: '/fonts/geist-ascii-coverage.png' };
    const integralFont = typeof BoardfishAsciiIntegralFont === 'undefined' ? undefined : { ...BoardfishAsciiIntegralFont, atlasURL: '/fonts/geist-ascii-integral.png' };
    for (const mode of MODES) {
      const api = mode === 'before' && baselineAvailable ? BoardfishGpuRendererBefore : BoardfishGpuRenderer;
      if (portable) {
        const gl = canvases[mode].getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
        if (!gl) throw new Error('WebGL2 is unavailable.');
        const getExtension = gl.getExtension.bind(gl);
        gl.getExtension = name => /^(EXT_color_buffer_float|OES_texture_float_linear)$/.test(name) ? null : getExtension(name);
      }
      contexts[mode] = api.createContext(canvases[mode], { font, integralFont:mode==='before'?integralFont:undefined, coverageFont,
        ...(mode === 'after' ? { textTileCache: textTileCacheEnabled, maxTextTileBytes: tileBudget } : {}), onError: error => rendererEvents.push({ mode, error: String(error) }) });
      if (!contexts[mode] || !await contexts[mode].ready) throw new Error(`Could not initialize ${mode} renderer: ${JSON.stringify(rendererEvents)}`);
      const gl = canvases[mode].getContext('webgl2');
      gpuTimers[mode] = { gl, extension: gl?.getExtension('EXT_disjoint_timer_query_webgl2') || null };
    }
    if (!baselineAvailable) $('before-caption').textContent = 'Current renderer (previous unavailable)';
    configure(settings()); await capture(settings()); busy = false; controls();
    $('status').textContent = 'Ready. Sweep a physical pixel, measure real-board panning, or inspect animated pan / zoom.';
  }
  $('phases').addEventListener('click', () => run('phases'));
  $('text-cache').checked = textTileCacheEnabled;
  $('text-cache').addEventListener('change', () => {
    const url = new URL(location.href); url.searchParams.set('cache', $('text-cache').checked ? '1' : '0'); location.href = url.href;
  });
  $('performance').addEventListener('click', () => run('performance'));
  $('run-all').addEventListener('click', () => run('all'));
  $('animate').addEventListener('click', () => animate().catch(error => { animated = false; controls(); $('status').textContent = String(error); }));
  for (const id of ['dpr', 'zoom']) $(id).addEventListener('change', () => { configure(settings()); capture(settings()); });
  $('phase-position').addEventListener('input', () => { $('phase-label').textContent = `${$('phase-position').value}/32 px`; capture(settings()); });
  initialize().catch(error => { $('status').textContent = `Initialization failed: ${error.message}`; });
})();
