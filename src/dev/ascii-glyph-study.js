'use strict';

(function asciiGlyphStudy() {
  const WIDTH = 400, HEIGHT = 256;
  const PHASES = 4, FIRST_GLYPH = 33, GLYPHS = 94;
  const MAX_ATLAS_BYTES = 64 * 1024 * 1024;
  const BACKGROUND = [30 / 255, 30 / 255, 36 / 255, 1];
  const FOREGROUND = [237 / 255, 237 / 255, 242 / 255];
  const MODES = ['direct', 'retained', 'gpu'];
  const ORDERS = [['direct', 'retained', 'gpu'], ['gpu', 'direct', 'retained'], ['retained', 'gpu', 'direct']];
  const WARMUPS = 6, SAMPLES = 30;
  const $ = (id) => document.getElementById(id);
  const round = (value) => Math.round(value * 1000) / 1000;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const canvases = Object.fromEntries(MODES.map((mode) => [mode, $(mode)]));
  const contexts = { direct: canvases.direct.getContext('2d'), retained: canvases.retained.getContext('2d') };
  let gpu = null, current = null, busy = false, result = null;

  function setBusy(value) {
    busy = value;
    for (const id of ['scale', 'dpr', 'workload', 'offset', 'preview', 'run']) $(id).disabled = value;
  }

  function configFromControls() {
    return {
      widthCss: WIDTH, heightCss: HEIGHT,
      scale: Number($('scale').value), dpr: Number($('dpr').value),
      workload: $('workload').value,
      offsetCss: Math.max(-8, Math.min(8, Number($('offset').value) || 0)),
    };
  }

  function makeObject(id, content, x, y, width) {
    return { id, type: 'text', x, y, w: width, h: 1, z: 1, data: { content } };
  }

  function makeObjects(workload) {
    if (workload === 'reading') {
      const sample = [
        'Boardfish: crisp text at fractional positions.',
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
        'Small text, exact positions, one GPU batch.',
      ].join('\n');
      return [makeObject('reading', sample, 0, 0, 1000)];
    }
    const prose = Array.from({ length: 64 }, (_, i) => (
      `Paragraph ${i + 1}: A quick brown fox jumps over the lazy dog. Boardfish stores plain ASCII text, ` +
      'keeps exact selection positions, and wraps each sentence to the available width. '
    )).join('\n');
    return Array.from({ length: 24 }, (_, i) => (
      makeObject(`dense-${i}`, `Textbox ${i + 1}\n${prose}`, (i % 6) * 500, Math.floor(i / 6) * 4200, 480)
    ));
  }

  function prepareLayout(config) {
    objects = makeObjects(config.workload);
    refreshTextMetrics();
    clearTextLayoutCaches({ measurements: true });
    const started = performance.now();
    const entries = [];
    // Fixed margin covers every translation used by the animation. Preserve
    // whole-object visibility, then retain every character of each selected row.
    // No objects or rows are added or removed while measuring.
    const viewport = {
      x1: -16 / config.scale, y1: -16 / config.scale,
      x2: (WIDTH + 16) / config.scale, y2: (HEIGHT + 16) / config.scale,
    };
    for (const obj of objects) {
      if (obj.x > viewport.x2 || obj.x + obj.w < viewport.x1 || obj.y > viewport.y2) continue;
      // Fixtures begin with a placeholder height; resolve actual bounds before
      // applying the final object intersection test, as a live board already has.
      syncTextAutoHeight(obj);
      if (obj.y + obj.h < viewport.y1) continue;
      const layout = getTextLayoutForViewport(obj, viewport);
      for (const line of layout) entries.push({ obj, line, plan: prepareTextLineForDraw(line) });
    }
    const layoutAndPlansMs = performance.now() - started;
    const instanceStarted = performance.now();
    let glyphCount = 0, textCalls = 0, submittedCharacters = 0;
    for (const { line, plan } of entries) {
      textCalls += plan.length;
      submittedCharacters += line.text.length;
      for (let i = 0; i < line.text.length; i++) {
        const code = line.text.charCodeAt(i);
        if (code >= FIRST_GLYPH && code < FIRST_GLYPH + GLYPHS) glyphCount++;
      }
    }
    const instances = new Float32Array(glyphCount * 3);
    let index = 0;
    for (const { obj, line } of entries) {
      for (let i = 0; i < line.text.length; i++) {
        const code = line.text.charCodeAt(i);
        if (code < FIRST_GLYPH || code >= FIRST_GLYPH + GLYPHS) continue;
        instances[index++] = lineBaseX(obj) + line.prefixWidths[i];
        instances[index++] = line.textY;
        instances[index++] = code - FIRST_GLYPH;
      }
    }
    return {
      entries, instances, glyphCount,
      diagnostics: {
        totalObjects: objects.length, submittedObjects: new Set(entries.map(({ obj }) => obj.id)).size,
        submittedLines: entries.length, submittedCharacters, glyphInstances: glyphCount,
        directTextCalls: textCalls, instanceBytes: instances.byteLength,
        layoutAndPlansMs: round(layoutAndPlansMs),
        instancePreparationMs: round(performance.now() - instanceStarted),
        viewportWorld: viewport,
        visibilityPolicy: 'Whole-object intersection and existing vertical row range, with 16 CSS px margin; full horizontal character coverage within each selected row.',
      },
    };
  }

  function makeShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed: ${error}`);
    }
    return shader;
  }

  function createGpuRenderer(canvas) {
    const started = performance.now();
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is unavailable; the GPU comparison cannot run.');
    const vertex = makeShader(gl, gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location = 0) in vec3 aGlyph;
      uniform vec2 uViewport;
      uniform float uDensity;
      uniform vec2 uOffset;
      uniform vec2 uCellSize;
      uniform vec2 uCellOrigin;
      uniform vec2 uAtlasSize;
      uniform float uColumns;
      out vec2 vUV;
      void main() {
        vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
        vec2 baseline = aGlyph.xy * uDensity + uOffset;
        vec2 quantized = floor(baseline * 4.0 + 0.5) * 0.25;
        vec2 origin = floor(quantized);
        vec2 phase = floor((quantized - origin) * 4.0 + 0.01);
        float cell = aGlyph.z * 16.0 + phase.y * 4.0 + phase.x;
        vec2 atlasCell = vec2(mod(cell, uColumns), floor(cell / uColumns));
        vec2 position = origin + uCellOrigin + corner * uCellSize;
        gl_Position = vec4(position.x / uViewport.x * 2.0 - 1.0,
          1.0 - position.y / uViewport.y * 2.0, 0.0, 1.0);
        vUV = (atlasCell + corner) * uCellSize / uAtlasSize;
      }
    `);
    const fragment = makeShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform sampler2D uAtlas;
      uniform vec3 uColor;
      in vec2 vUV;
      out vec4 outColor;
      void main() {
        float coverage = texture(uAtlas, vUV).a;
        outColor = vec4(uColor * coverage, coverage);
      }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);
    const uniforms = {};
    for (const name of ['uViewport', 'uDensity', 'uOffset', 'uCellSize', 'uCellOrigin', 'uAtlasSize', 'uColumns', 'uAtlas', 'uColor']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(uniforms.uAtlas, 0);
    gl.uniform3fv(uniforms.uColor, FOREGROUND);
    const initMs = performance.now() - started;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let texture = null, count;

    function update(config, prepared) {
      const density = config.scale * config.dpr;
      const buildStarted = performance.now();
      const metrics = Array.from({ length: GLYPHS }, (_, glyph) => (
        measureTextGlyphMetricsWithFont(String.fromCharCode(glyph + FIRST_GLYPH), FONT)
      ));
      const left = Math.floor(Math.min(...metrics.map((m) => -m.left)) * density) - 2;
      const top = Math.floor(Math.min(...metrics.map((m) => -m.ascent)) * density) - 2;
      const right = Math.ceil(Math.max(...metrics.map((m) => m.right)) * density) + 3;
      const bottom = Math.ceil(Math.max(...metrics.map((m) => m.descent)) * density) + 3;
      const cellWidth = right - left, cellHeight = bottom - top;
      const cells = GLYPHS * PHASES * PHASES;
      const columns = Math.min(32, Math.floor(maxTextureSize / cellWidth));
      const rows = Math.ceil(cells / columns);
      const atlasWidth = columns * cellWidth, atlasHeight = rows * cellHeight;
      const bytes = atlasWidth * atlasHeight * 4;
      if (columns < 1 || atlasHeight > maxTextureSize || bytes > MAX_ATLAS_BYTES || !Number.isFinite(bytes)) {
        throw new Error(`Atlas resource guard rejected ${atlasWidth} × ${atlasHeight} (${bytes} bytes).`);
      }
      const atlasCanvas = document.createElement('canvas');
      atlasCanvas.width = atlasWidth;
      atlasCanvas.height = atlasHeight;
      const atlasContext = atlasCanvas.getContext('2d', { willReadFrequently: true });
      if (!atlasContext) throw new Error('Unable to create the glyph atlas Canvas2D context.');
      configureTextCanvasContext(atlasContext);
      atlasContext.font = FONT;
      atlasContext.textBaseline = 'alphabetic';
      atlasContext.fillStyle = '#ffffff';
      for (let glyph = 0; glyph < GLYPHS; glyph++) {
        for (let py = 0; py < PHASES; py++) {
          for (let px = 0; px < PHASES; px++) {
            const cell = glyph * PHASES * PHASES + py * PHASES + px;
            const x = (cell % columns) * cellWidth;
            const y = Math.floor(cell / columns) * cellHeight;
            atlasContext.setTransform(density, 0, 0, density, x - left + px / PHASES, y - top + py / PHASES);
            atlasContext.fillText(String.fromCharCode(glyph + FIRST_GLYPH), 0, 0);
          }
        }
      }
      const atlasBuildMs = performance.now() - buildStarted;
      const uploadStarted = performance.now();
      if (texture) gl.deleteTexture(texture);
      texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
      const atlasUploadSubmissionMs = performance.now() - uploadStarted;
      gl.finish();
      const atlasUploadAndFinishMs = performance.now() - uploadStarted;
      const instanceUploadStarted = performance.now();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, prepared.instances, gl.STATIC_DRAW);
      const instanceUploadSubmissionMs = performance.now() - instanceUploadStarted;
      count = prepared.glyphCount;
      gl.useProgram(program);
      gl.uniform1f(uniforms.uDensity, density);
      gl.uniform2f(uniforms.uCellSize, cellWidth, cellHeight);
      gl.uniform2f(uniforms.uCellOrigin, left, top);
      gl.uniform2f(uniforms.uAtlasSize, atlasWidth, atlasHeight);
      gl.uniform1f(uniforms.uColumns, columns);
      atlasCanvas.width = 1;
      atlasCanvas.height = 1;
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`WebGL resource setup failed: 0x${error.toString(16)}`);
      const atlasInfo = {
        density, glyphs: GLYPHS, phaseVariantsPerGlyph: PHASES * PHASES,
        width: atlasWidth, height: atlasHeight, cellWidth, cellHeight,
        textureBytes: bytes, peakAtlasCanvasBytes: bytes,
        atlasBuildMs: round(atlasBuildMs),
        atlasUploadSubmissionMs: round(atlasUploadSubmissionMs),
        atlasUploadAndFinishMs: round(atlasUploadAndFinishMs),
        instanceUploadSubmissionMs: round(instanceUploadSubmissionMs),
        estimatedPersistentGpuBytes: bytes + prepared.instances.byteLength,
      };
      return atlasInfo;
    }

    function draw(offsetX, offsetY) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(...BACKGROUND);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2f(uniforms.uViewport, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uOffset, offsetX, offsetY);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }

    return { gl, update, draw, initMs: round(initMs), maxTextureSize, contextAttributes: gl.getContextAttributes() };
  }

  function draw2d(mode, prepared, config, offsetX, offsetY) {
    const context = contexts[mode];
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#1e1e24';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    const density = config.scale * config.dpr;
    context.setTransform(density, 0, 0, density, offsetX, offsetY);
    context.font = FONT;
    context.textBaseline = 'alphabetic';
    configureTextCanvasContext(context);
    context.fillStyle = '#ededf2';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (mode === 'retained') beginTextRasterFrame();
    for (const { obj, line, plan } of prepared.entries) {
      if (mode === 'direct') {
        for (const draw of plan) context.fillText(draw.text, lineBaseX(obj) + draw.x, line.textY);
      } else {
        drawTextLineRange(context, line, obj, 0, line.text.length, { collectStats: false });
      }
    }
  }

  function draw(mode, index = null) {
    const { prepared, config } = current;
    const panX = index == null ? 0 : (index % 16) * 0.375;
    const panY = index == null ? 0 : (index % 13) * 0.25;
    const x = (config.offsetCss + panX) * config.dpr;
    const y = (config.offsetCss + panY) * config.dpr;
    if (mode === 'gpu') gpu.draw(x, y);
    else draw2d(mode, prepared, config, x, y);
  }

  function countRetainedCalls() {
    const counts = { fillText: 0, drawImage: 0 };
    const context = contexts.retained;
    const originals = { fillText: context.fillText, drawImage: context.drawImage };
    for (const method of Object.keys(originals)) {
      context[method] = function (...args) {
        counts[method]++;
        return originals[method].apply(this, args);
      };
    }
    try { draw('retained'); }
    finally { for (const [method, original] of Object.entries(originals)) context[method] = original; }
    return counts;
  }

  function visibility() {
    return {
      hidden: document.hidden, visibilityState: document.visibilityState,
      canvases: Object.fromEntries(MODES.map((mode) => {
        const rect = canvases[mode].getBoundingClientRect();
        return [mode, {
          mounted: canvases[mode].isConnected,
          fullyInViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          intersectsViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
          cssWidth: rect.width, cssHeight: rect.height,
          backingWidth: canvases[mode].width, backingHeight: canvases[mode].height,
        }];
      })),
    };
  }

  function makeResult() {
    return {
      study: 'ASCII coverage atlas vs current Boardfish text paths',
      createdAt: new Date().toISOString(),
      browser: navigator.userAgent, actualDevicePixelRatio: window.devicePixelRatio,
      config: current.config,
      font: FONT, lineHeightWorld: LINE_H, baselineOffsetWorld: TEXT_BASELINE_Y_OFFSET,
      preparation: current.prepared.diagnostics,
      gpu: { ...current.atlas, backendInitializationMs: gpu.initMs, maxTextureSize: gpu.maxTextureSize, contextAttributes: gpu.contextAttributes },
      currentRasterColdSubmissionMs: current.rasterColdSubmissionMs,
      currentRasterCache: getTextRasterCacheStats(),
      drawCalls: { direct: { fillText: current.prepared.diagnostics.directTextCalls }, retained: current.retainedCalls, gpu: { drawArraysInstanced: 1, instances: current.prepared.glyphCount } },
      destinationBytesEach: Math.round(WIDTH * current.config.dpr) * Math.round(HEIGHT * current.config.dpr) * 4,
      visibility: visibility(),
      limitations: [
        'Quarter-device-pixel baseline quantization, maximum error 0.125 px per axis.',
        'Canvas alpha coverage; not ClearType and no extra font hinting or gamma correction.',
        'Exact-density atlas rebuilt synchronously; only 25%, 100%, 125%, 200% zoom and DPR 1/2.',
        'CPU submission and rAF pacing are not GPU execution or confirmed presentation times.',
        'Mounted canvases must be visible and foreground; retained driver memory is not fully measured.',
        'No full board compositor, arbitrary zoom, interaction, or context-loss recovery.',
        'Direct verified two-glyph runs may rasterize differently from single glyph instances.',
        'No horizontal culling and no content omission changes during timing; fixed existing vertical rows.',
      ],
    };
  }

  function publish() {
    $('json').textContent = JSON.stringify(result, null, 2);
    window.asciiGlyphStudyResult = result;
  }

  function capturePreview(mode) {
    const link = $(`${mode}-png`);
    link.href = canvases[mode].toDataURL('image/png');
    link.download = `boardfish-${mode}-${current.config.scale}x-dpr${current.config.dpr}.png`;
  }

  async function refresh({ capture = true } = {}) {
    const config = configFromControls();
    $('status').textContent = 'Preparing actual layouts, current rasters, and exact-density ASCII atlas…';
    await frame();
    for (const canvas of Object.values(canvases)) {
      const width = Math.round(WIDTH * config.dpr), height = Math.round(HEIGHT * config.dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    const prepared = prepareLayout(config);
    gpu ||= createGpuRenderer(canvases.gpu);
    const atlas = gpu.update(config, prepared);
    current = { config, prepared, atlas };
    const coldStarted = performance.now();
    draw('retained');
    current.rasterColdSubmissionMs = round(performance.now() - coldStarted);
    current.retainedCalls = countRetainedCalls();
    if (capture) capturePreview('retained');
    draw('direct');
    if (capture) capturePreview('direct');
    draw('gpu');
    // Read immediately: the WebGL context does not preserve its drawing buffer.
    if (capture) capturePreview('gpu');
    result = makeResult();
    $('summary').textContent = '';
    publish();
    $('status').textContent = `Preview ready: ${prepared.glyphCount.toLocaleString()} glyph instances; ${(atlas.textureBytes / 1048576).toFixed(2)} MiB atlas. Run comparison for frame measurements.`;
  }

  function summarize(samples) {
    const percentile = (key, fraction) => {
      const values = samples.map((s) => s[key]).sort((a, b) => a - b);
      return round(values[Math.max(0, Math.ceil(values.length * fraction) - 1)] || 0);
    };
    return {
      samples: samples.length,
      submissionMedianMs: percentile('submissionMs', 0.5), submissionP95Ms: percentile('submissionMs', 0.95),
      nextRafIntervalMedianMs: percentile('nextRafIntervalMs', 0.5), nextRafIntervalP95Ms: percentile('nextRafIntervalMs', 0.95),
      intervalsOver25ms: samples.filter((s) => s.nextRafIntervalMs > 25).length,
      hiddenSamples: samples.filter((s) => s.hidden).length,
      raw: samples,
    };
  }

  async function run() {
    await refresh({ capture: false });
    $('panels').scrollIntoView({ block: 'center', inline: 'nearest' });
    await frame();
    const samples = Object.fromEntries(MODES.map((mode) => [mode, []]));
    const blocks = [];
    for (let roundIndex = 0; roundIndex < ORDERS.length; roundIndex++) {
      for (const mode of ORDERS[roundIndex]) {
        $('status').textContent = `Measuring ${mode}, round ${roundIndex + 1}/3. Keep all three panels visible and the tab in the foreground.`;
        const block = { round: roundIndex + 1, mode, visibilityStart: visibility() };
        let timestamp = await frame();
        for (let i = -WARMUPS; i < SAMPLES; i++) {
          const started = performance.now();
          draw(mode, i < 0 ? i + WARMUPS : i);
          const submitted = performance.now();
          const hiddenBefore = document.hidden;
          const nextTimestamp = await frame();
          if (i >= 0) samples[mode].push({
            round: roundIndex + 1, frame: i,
            submissionMs: round(submitted - started),
            nextRafIntervalMs: round(nextTimestamp - timestamp),
            hidden: hiddenBefore || document.hidden,
          });
          timestamp = nextTimestamp;
        }
        block.visibilityEnd = visibility();
        blocks.push(block);
      }
    }
    for (const mode of MODES) {
      draw(mode);
      capturePreview(mode);
    }
    result = makeResult();
    result.animation = {
      warmupsPerBlock: WARMUPS, samplesPerBlock: SAMPLES, orders: ORDERS,
      panCss: 'x = origin + (frame % 16) * 0.375; y = origin + (frame % 13) * 0.25',
      blocks, modes: Object.fromEntries(MODES.map((mode) => [mode, summarize(samples[mode])])),
    };
    publish();
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Path</th><th>Submission median / p95 ms</th><th>Next rAF median / p95 ms</th><th>Intervals &gt;25 ms</th><th>Hidden frames</th></tr></thead><tbody></tbody>';
    for (const mode of MODES) {
      const stats = result.animation.modes[mode];
      const row = document.createElement('tr');
      for (const value of [mode, `${stats.submissionMedianMs} / ${stats.submissionP95Ms}`, `${stats.nextRafIntervalMedianMs} / ${stats.nextRafIntervalP95Ms}`, stats.intervalsOver25ms, stats.hiddenSamples]) {
        const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
      }
      table.querySelector('tbody').appendChild(row);
    }
    $('summary').replaceChildren(table);
    const hidden = MODES.reduce((sum, mode) => sum + result.animation.modes[mode].hiddenSamples, 0);
    $('status').textContent = `Comparison complete: 90 measured frames per path. ${hidden} hidden samples. Review visibility flags and limitations alongside the results.`;
  }

  async function action(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    catch (error) {
      $('status').textContent = error.stack || String(error);
      result = { error: error.stack || String(error), config: configFromControls() };
      publish();
    } finally { setBusy(false); }
  }

  $('preview').addEventListener('click', () => action(refresh));
  $('run').addEventListener('click', () => action(run));
  window.asciiGlyphStudy = { refresh: () => action(refresh), run: () => action(run), getResult: () => result };
  (async () => {
    setBusy(true);
    try {
      await document.fonts.load(FONT, 'Boardfish');
      await document.fonts.ready;
      await refresh();
    } catch (error) {
      $('status').textContent = error.stack || String(error);
    } finally { setBusy(false); }
  })();
})();
