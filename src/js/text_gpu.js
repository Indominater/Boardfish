'use strict';

(function initTextGpu(root) {
  // Both /js/text_gpu.js and the production /assets/ bundle sit one level below
  // the application root. Capture currentScript while this classic script runs.
  const scriptUrl = root.document?.currentScript?.src;
  const defaultAssetBase = scriptUrl ? new URL('../fonts/', scriptUrl).href : null;
  const INSTANCE_FLOATS = 8;
  const INSTANCE_BYTES = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_rect;
layout(location=1) in vec4 a_uv;
uniform vec2 u_surface;
uniform vec2 u_origin;
uniform float u_scale;
out vec2 v_uv;
void main() {
  vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
  vec2 corner = corners[gl_VertexID];
  vec2 pixel = u_origin + (a_rect.xy + corner*a_rect.zw)*u_scale;
  gl_Position = vec4(pixel.x/u_surface.x*2.0-1.0, 1.0-pixel.y/u_surface.y*2.0, 0, 1);
  v_uv = mix(a_uv.xy, a_uv.zw, corner);
}`;
  const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform vec2 u_unitRange;
uniform vec4 u_color;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec3 sampleValue = texture(u_atlas, v_uv).rgb;
  float medianValue = max(min(sampleValue.r,sampleValue.g),min(max(sampleValue.r,sampleValue.g),sampleValue.b));
  vec2 screenTextureSize = vec2(1.0)/max(fwidth(v_uv),vec2(0.0000001));
  float screenRange = max(0.5*dot(u_unitRange,screenTextureSize),1.0);
  float coverage = clamp(screenRange*(medianValue-0.5)+0.5,0.0,1.0);
  float alpha = coverage*u_color.a;
  outColor = vec4(u_color.rgb*alpha,alpha);
}`;

  function colorChannels(value) {
    if (typeof value !== 'string') return null;
    const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
    if (hex) {
      let digits = hex[1];
      if (digits.length < 5) digits = [...digits].map((x) => x + x).join('');
      return [0, 2, 4, 6].map((offset) => offset < digits.length ? parseInt(digits.slice(offset, offset + 2), 16) / 255 : 1);
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value);
    if (!rgb) return null;
    const channels = [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, rgb[4] === undefined ? 1 : Number(rgb[4])];
    return channels.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ? channels : null;
  }

  function destinationState(context, color, fontSize) {
    if (!context?.canvas || typeof context.getTransform !== 'function' ||
        typeof context.drawImage !== 'function' || typeof context.save !== 'function' ||
        typeof context.restore !== 'function' || typeof context.setTransform !== 'function') return null;
    const defaults = {
      textBaseline: 'alphabetic', textAlign: 'left', direction: 'ltr',
      fontKerning: 'none', fontStretch: 'normal', fontVariantCaps: 'normal',
      letterSpacing: '0px', wordSpacing: '0px', globalAlpha: 1,
      globalCompositeOperation: 'source-over', filter: 'none',
      shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    };
    for (const key in defaults) if (context[key] !== undefined && context[key] !== defaults[key]) return null;
    if (context.shadowColor !== undefined && !['transparent', 'rgba(0, 0, 0, 0)', '#00000000'].includes(context.shadowColor)) return null;
    if (typeof context.font === 'string' && (!context.font.includes(`${fontSize}px`) || !context.font.includes('Geist Sans'))) return null;
    const rgba = colorChannels(color);
    if (!rgba) return null;
    let matrix;
    try { matrix = context.getTransform(); } catch (_) { return null; }
    if (!matrix || ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
        matrix.a <= 0 || matrix.b !== 0 || matrix.c !== 0 || Math.abs(matrix.a - matrix.d) > matrix.a * 1e-10) return null;
    const width = Number(context.canvas.width), height = Number(context.canvas.height);
    if (!(width > 0 && height > 0)) return null;
    return { matrix, rgba, width, height };
  }

  async function loadAtlasImage(url) {
    if (typeof root.createImageBitmap === 'function') {
      const response = await root.fetch(url);
      if (!response.ok) throw new Error('Unable to load text atlas');
      return root.createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    }
    return new Promise((resolve, reject) => {
      const image = new root.Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  function createTextGpuRenderer(options = {}) {
    const fontSize = options.fontSize ?? 16;
    const maxBytes = Math.max(0, Math.floor(options.maxBytes ?? 16 * 1024 * 1024));
    const maxSurfaceBytes = Math.max(0, Math.floor(options.maxSurfaceBytes ?? 64 * 1024 * 1024));
    const chunkSize = Math.max(1, Math.min(4096, Math.floor(options.chunkGlyphs ?? 4096)));
    const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 512));
    const lineHeight = options.lineHeight ?? 24;
    const bandLines = Math.max(1, Math.floor(options.bandLines ?? 32));
    const entries = new Map();
    const frameKeys = new Set();
    let externalFrames = false;
    let lineInfos = new WeakMap();
    let nextLineId = 1;
    let bytes = 0;
    let canvas = null, gl = null, program = null, texture = null, vao = null, uniforms = null;
    let atlasData = null, atlasImage = null, glyphs = null, maxDimension = 0;
    let available = false, disposed = false, lost = false;
    let lastError = '';
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const totals = { drawCalls: 0, batches: 0, glyphs: 0, uploads: 0, uploadedBytes: 0, hits: 0, misses: 0, evictions: 0, fallbacks: 0 };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */

    function releaseEntry(entry, deleteResource = true) {
      entries.delete(entry.key);
      bytes -= entry.bytes;
      if (deleteResource && entry.buffer && gl) gl.deleteBuffer(entry.buffer);
    }

    function clear(deleteResources = true) {
      for (const entry of entries.values()) releaseEntry(entry, deleteResources);
      lineInfos = new WeakMap();
      frameKeys.clear();
      bytes = 0;
      if (canvas && deleteResources && !lost) {
        canvas.width = 1;
        canvas.height = 1;
      }
    }

    function releasePipeline(deleteResources = true) {
      clear(deleteResources);
      if (deleteResources && gl) {
        if (texture) gl.deleteTexture(texture);
        if (vao) gl.deleteVertexArray(vao);
        if (program) gl.deleteProgram(program);
      }
      texture = null; vao = null; program = null; uniforms = null;
      available = false;
    }

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Text shader allocation failed');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'Text shader compilation failed';
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    }

    function initializePipeline() {
      if (disposed || lost || !gl || !atlasData || !atlasImage) return false;
      let vertex = null, fragment = null;
      try {
        maxDimension = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
        const atlas = atlasData.atlas;
        if (!atlas || !(atlas.width > 0 && atlas.height > 0 && atlas.distanceRange > 0) ||
            atlas.width > maxDimension || atlas.height > maxDimension || atlasImage.width !== atlas.width || atlasImage.height !== atlas.height) {
          throw new Error('Invalid text atlas dimensions');
        }
        glyphs = new Map(atlasData.glyphs.map((glyph) => [glyph.unicode, glyph]));
        vertex = compileShader(gl.VERTEX_SHADER, VERTEX);
        fragment = compileShader(gl.FRAGMENT_SHADER, FRAGMENT);
        program = gl.createProgram();
        if (!program) throw new Error('Text program allocation failed');
        gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Text program linking failed');
        vao = gl.createVertexArray();
        texture = gl.createTexture();
        if (!vao || !texture) throw new Error('Text GPU allocation failed');
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
        gl.vertexAttribDivisor(0, 1); gl.vertexAttribDivisor(1, 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasImage);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Text atlas upload failed');
        uniforms = {};
        for (const name of ['surface', 'origin', 'scale', 'atlas', 'unitRange', 'color']) uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
        gl.useProgram(program);
        gl.uniform1i(uniforms.atlas, 0);
        gl.uniform2f(uniforms.unitRange, atlas.distanceRange / atlas.width, atlas.distanceRange / atlas.height);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        gl.clearColor(0, 0, 0, 0);
        available = true;
        lastError = '';
        try { options.onReady?.(); } catch (_) {}
      } catch (error) {
        lastError = String(error?.message || error);
        releasePipeline();
      } finally {
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
      }
      return available;
    }

    const onContextLost = (event) => {
      event.preventDefault?.();
      lost = true;
      releasePipeline(false);
      try { options.onReady?.(); } catch (_) {}
    };
    const onContextRestored = () => { lost = false; initializePipeline(); };

    const ready = (async () => {
      try {
        canvas = options.createCanvas ? options.createCanvas() :
          typeof root.OffscreenCanvas === 'function' ? new root.OffscreenCanvas(1, 1) : root.document?.createElement('canvas');
        gl = options.gl || canvas?.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
        if (!canvas || !gl) return false;
        canvas.addEventListener?.('webglcontextlost', onContextLost);
        canvas.addEventListener?.('webglcontextrestored', onContextRestored);
        const assetBase = options.assetBase || defaultAssetBase;
        if ((!options.atlasData || !options.atlasImage) && !assetBase) return false;
        const loaded = await Promise.allSettled([
          options.atlasData || root.fetch(new URL('geist-ascii-msdf.json', assetBase).href).then((response) => {
            if (!response.ok) throw new Error('Unable to load text atlas metrics');
            return response.json();
          }),
          options.atlasImage || loadAtlasImage(new URL('geist-ascii-msdf.png', assetBase).href),
        ]);
        if (loaded.some((result) => result.status === 'rejected')) {
          if (!options.atlasImage && loaded[1].status === 'fulfilled') loaded[1].value?.close?.();
          throw loaded.find((result) => result.status === 'rejected').reason;
        }
        atlasData = loaded[0].value; atlasImage = loaded[1].value;
        if (disposed) { if (!options.atlasImage) atlasImage?.close?.(); return false; }
        return initializePipeline();
      } catch (error) {
        lastError = String(error?.message || error);
        return false;
      }
    })();

    function getLineInfo(line) {
      const text = line?.text;
      const widths = line?.prefixWidths;
      if (typeof text !== 'string' || !widths || typeof widths !== 'object' || widths.length < text.length + 1) return null;
      const cached = lineInfos.get(widths);
      if (cached?.text === text) return cached;
      let count = 0;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if ((code !== 9 && (code < 32 || code > 126)) || !Number.isFinite(widths[i])) return null;
        if (code === 9 || code === 32) continue;
        const glyph = glyphs.get(code);
        if (!glyph?.planeBounds || !glyph?.atlasBounds) return null;
        count++;
      }
      const info = { id: nextLineId++, text, widths, count };
      lineInfos.set(widths, info);
      return info;
    }

    function chunksForLayout(layout, obj, pad) {
      const lines = [];
      let glyphCount = 0;
      for (const line of layout) {
        const info = getLineInfo(line);
        if (!info || !Number.isFinite(line.textY)) return null;
        if (info.count) {
          const localY = (Number.isFinite(line.y) ? line.y : line.textY - fontSize) - (Number(obj.y) || 0) - pad;
          const band = Math.floor(Math.round(localY / lineHeight) / bandLines);
          lines.push({ info, baseline: line.textY, band });
          glyphCount += info.count;
        }
      }
      const chunks = [];
      let chunk = null;
      for (const line of lines) {
        // Stable world-local row bands keep complete interior batches reusable
        // when a row enters or leaves the requested viewport layout.
        if (chunk && chunk.band !== line.band) { chunks.push(chunk); chunk = null; }
        for (let start = 0; start < line.info.text.length;) {
          if (!chunk) chunk = { originY: line.baseline, band: line.band, length: 0, parts: [], key: '' };
          const end = Math.min(line.info.text.length, start + chunkSize - chunk.length);
          const dy = line.baseline - chunk.originY;
          chunk.parts.push({ info: line.info, start, end, dy });
          chunk.key += `${line.info.id}:${start}:${end}:${dy};`;
          chunk.length += end - start;
          start = end;
          if (chunk.length === chunkSize) { chunks.push(chunk); chunk = null; }
        }
      }
      if (chunk) chunks.push(chunk);
      return { chunks, glyphCount };
    }

    function buildChunk(chunk, protectedEntries) {
      const data = new Float32Array(chunk.length * INSTANCE_FLOATS);
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      const atlas = atlasData.atlas;
      let count = 0;
      for (const part of chunk.parts) for (let i = part.start; i < part.end; i++) {
        const code = part.info.text.charCodeAt(i);
        if (code === 9 || code === 32) continue;
        const glyph = glyphs.get(code), p = glyph.planeBounds, a = glyph.atlasBounds;
        const left = part.info.widths[i] + p.left * fontSize;
        const right = part.info.widths[i] + p.right * fontSize;
        const top = part.dy - p.top * fontSize, bottom = part.dy - p.bottom * fontSize;
        const uvTop = atlas.yOrigin === 'top' ? a.top / atlas.height : 1 - a.top / atlas.height;
        const uvBottom = atlas.yOrigin === 'top' ? a.bottom / atlas.height : 1 - a.bottom / atlas.height;
        data.set([left, top, right - left, bottom - top, a.left / atlas.width, uvTop, a.right / atlas.width, uvBottom], count * INSTANCE_FLOATS);
        bounds.left = Math.min(bounds.left, left); bounds.right = Math.max(bounds.right, right);
        bounds.top = Math.min(bounds.top, top); bounds.bottom = Math.max(bounds.bottom, bottom);
        count++;
      }
      const allocation = count * INSTANCE_BYTES;
      while (bytes + allocation > maxBytes || entries.size >= maxEntries) {
        let evicted = false;
        for (const entry of entries.values()) {
          if (protectedEntries.has(entry.key)) continue;
          releaseEntry(entry);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */ totals.evictions++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
          evicted = true;
          break;
        }
        if (!evicted) return null;
      }
      const buffer = gl.createBuffer();
      if (!buffer) return null;
      try {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * INSTANCE_FLOATS), gl.STATIC_DRAW);
      } catch (_) { gl.deleteBuffer(buffer); return null; }
      const entry = { key: chunk.key, buffer, bytes: allocation, count, bounds };
      entries.set(entry.key, entry);
      bytes += allocation;
      /* BOARDFISH_DEV_DIAGNOSTICS_START */ totals.uploads++; totals.uploadedBytes += allocation; totals.misses++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return entry;
    }

    function fallback() {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */ totals.fallbacks++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return null;
    }

    function draw(context, layout, obj, drawOptions = {}) {
      if (!available || disposed || lost || !Array.isArray(layout) || !Number.isFinite(obj?.x)) return fallback();
      const state = destinationState(context, drawOptions.color ?? context.fillStyle, fontSize);
      const pad = drawOptions.pad ?? 16;
      if (!state || !Number.isFinite(pad)) return fallback();
      try {
        if (!externalFrames) frameKeys.clear();
        const prepared = chunksForLayout(layout, obj, pad);
        if (!prepared || prepared.chunks.length > maxEntries) return fallback();
        const { chunks } = prepared;
        // Preflight the entire call so budget pressure cannot leave a partially
        // composited textbox. Whitespace does not consume GPU instance storage.
        if (prepared.glyphCount * INSTANCE_BYTES > maxBytes) return fallback();
        const protect = new Set([...frameKeys, ...chunks.map((chunk) => chunk.key)]);
        let newBytes = prepared.glyphCount * INSTANCE_BYTES;
        const missingKeys = new Set();
        for (const chunk of chunks) {
          const existing = entries.get(chunk.key);
          if (existing) newBytes -= existing.bytes;
          else missingKeys.add(chunk.key);
        }
        let protectedBytes = 0, protectedCount = 0;
        for (const key of protect) {
          const existing = entries.get(key);
          if (!existing) continue;
          protectedBytes += existing.bytes; protectedCount++;
        }
        if (protectedBytes + Math.max(0, newBytes) > maxBytes || protectedCount + missingKeys.size > maxEntries) return fallback();
        const rendered = [];
        const newEntries = [];
        const worldX = obj.x + pad;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        let glyphCount = 0;
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ let hits = 0, misses = 0, uploadedBytes = 0; /* BOARDFISH_DEV_DIAGNOSTICS_END */
        for (const chunk of chunks) {
          let entry = entries.get(chunk.key);
          if (entry) {
            entries.delete(chunk.key); entries.set(chunk.key, entry);
            /* BOARDFISH_DEV_DIAGNOSTICS_START */ totals.hits++; hits++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
          } else {
            entry = buildChunk(chunk, protect);
            if (entry) newEntries.push(entry);
            /* BOARDFISH_DEV_DIAGNOSTICS_START */ misses++; uploadedBytes += entry?.bytes || 0; /* BOARDFISH_DEV_DIAGNOSTICS_END */
          }
          if (!entry) {
            for (const added of newEntries) { releaseEntry(added); frameKeys.delete(added.key); }
            gl.getError();
            return fallback();
          }
          frameKeys.add(entry.key);
          rendered.push({ entry, originY: chunk.originY });
          left = Math.min(left, worldX + entry.bounds.left); right = Math.max(right, worldX + entry.bounds.right);
          top = Math.min(top, chunk.originY + entry.bounds.top); bottom = Math.max(bottom, chunk.originY + entry.bounds.bottom);
          glyphCount += entry.count;
        }
        // One cold-path validation covers every upload in this textbox. A GL
        // error query per chunk would serialize CPU/GPU work during preparation.
        if (newEntries.length && gl.getError() !== gl.NO_ERROR) {
          for (const added of newEntries) { releaseEntry(added); frameKeys.delete(added.key); }
          return fallback();
        }
        const { a: scale, e: tx, f: ty } = state.matrix;
        const x = Math.max(0, Math.floor(left * scale + tx) - 1);
        const y = Math.max(0, Math.floor(top * scale + ty) - 1);
        const x2 = Math.min(state.width, Math.ceil(right * scale + tx) + 1);
        const y2 = Math.min(state.height, Math.ceil(bottom * scale + ty) + 1);
        const width = x2 - x, height = y2 - y;
        if (width > maxDimension || height > maxDimension || (width > 0 && height > 0 && width * height * 4 > maxSurfaceBytes)) return fallback();
        let submitted = 0;
        if (glyphCount && width > 0 && height > 0) {
          // Reuse one growing scratch framebuffer across differently sized
          // textboxes and fractional pans. Only the copied rectangle is tight.
          const widthCap = Math.min(state.width, maxDimension);
          const heightCap = Math.min(state.height, maxDimension);
          let nextWidth = Math.min(widthCap, Math.max(canvas.width, 2 ** Math.ceil(Math.log2(width))));
          let nextHeight = Math.min(heightCap, Math.max(canvas.height, 2 ** Math.ceil(Math.log2(height))));
          if (nextWidth * nextHeight * 4 > maxSurfaceBytes) {
            nextWidth = Math.min(widthCap, Math.max(canvas.width, width));
            nextHeight = Math.min(heightCap, Math.max(canvas.height, height));
            if (nextWidth * nextHeight * 4 > maxSurfaceBytes) { nextWidth = width; nextHeight = height; }
          }
          if (canvas.width !== nextWidth) canvas.width = nextWidth;
          if (canvas.height !== nextHeight) canvas.height = nextHeight;
          gl.viewport(0, canvas.height - height, width, height);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(program); gl.bindVertexArray(vao);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.uniform2f(uniforms.surface, width, height);
          gl.uniform1f(uniforms.scale, scale);
          gl.uniform4fv(uniforms.color, state.rgba);
          for (const { entry, originY } of rendered) {
            gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
            gl.vertexAttribPointer(0, 4, gl.FLOAT, false, INSTANCE_BYTES, 0);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * Float32Array.BYTES_PER_ELEMENT);
            gl.uniform2f(uniforms.origin, worldX * scale + tx - x, originY * scale + ty - y);
            gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, entry.count);
            submitted++;
          }
          if (gl.isContextLost()) return fallback();
          context.save();
          try {
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.drawImage(canvas, 0, 0, width, height, x, y, width, height);
          } finally { context.restore(); }
        }
        if (typeof BOARDFISH_PRODUCTION !== 'undefined') return true;
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        totals.batches += submitted; totals.drawCalls += submitted ? 1 : 0; totals.glyphs += glyphCount;
        return { drawCalls: submitted ? 1 : 0, batches: submitted, uploadedBytes, glyphs: glyphCount, cacheHits: hits, cacheMisses: misses, bytes };
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } catch (error) {
        lastError = String(error?.message || error);
        return fallback();
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      canvas?.removeEventListener?.('webglcontextlost', onContextLost);
      canvas?.removeEventListener?.('webglcontextrestored', onContextRestored);
      releasePipeline(!lost);
      if (!options.atlasImage) atlasImage?.close?.();
      atlasImage = null;
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }

    function getStats() {
      return { ready: available, lost, disposed, entries: entries.size, bytes, maxBytes, maxSurfaceBytes,
        atlasBytes: texture ? atlasData.atlas.width * atlasData.atlas.height * 4 : 0,
        surfaceBytes: canvas ? canvas.width * canvas.height * 4 : 0, error: lastError,
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ ...totals, /* BOARDFISH_DEV_DIAGNOSTICS_END */
      };
    }

    function beginFrame() { externalFrames = true; frameKeys.clear(); }

    const isReady = () => available && !disposed && !lost;
    return { ready, draw, clear, dispose, getStats, beginFrame, isReady };
  }

  const api = Object.freeze({ createTextGpuRenderer });
  root.BoardfishTextGpu = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
