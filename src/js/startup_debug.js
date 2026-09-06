'use strict';

// Web release builds leave this disabled unless a dev build enables it.
const DEBUG_TOOLS_ENABLED = globalThis.__BOARDFISH_DEBUG_TOOLS_ENABLED__ === true;

function createNoopStartupDebug() {
  const events = [];
  const samples = [];
  const noopAsync = async () => ({ summary: {}, events, samples });
  return {
    record() { return null; },
    sample() { return null; },
    sampleFrames: async () => [],
    report: noopAsync,
    toggleStress: noopAsync,
    topBandScan: () => ({ summary: {}, rows: [] }),
    toggleBandStress: noopAsync,
    toggleThemeOrderStress: noopAsync,
    events,
    samples,
    expectedCanvasBg(theme = appTheme) {
      return theme === 'dark' ? '#1c1b22' : 'rgb(234, 234, 237)';
    },
    lastResult: null,
    lastJson: '',
  };
}

var StartupDebug = DEBUG_TOOLS_ENABLED ? (() => {
  const t0 = performance.now();
  const events = [];
  const samples = [];
  let lastResult = null;
  let lastJson = '';

  const round = round2;

  function colorToRgb(value) {
    const probe = document.createElement('span');
    probe.style.color = value || '';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }

  function expectedCanvasBg(theme = appTheme) {
    return theme === 'dark' ? colorToRgb('#1c1b22') : colorToRgb('rgb(234, 234, 237)');
  }

  function parseRgb(value) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    if (parts.length < 3 || parts.some((part, index) => index < 3 && !Number.isFinite(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1 };
  }

  function rgbDistance(a, b) {
    const pa = parseRgb(a);
    const pb = parseRgb(b);
    if (!pa || !pb) return Infinity;
    return Math.max(Math.abs(pa.r - pb.r), Math.abs(pa.g - pb.g), Math.abs(pa.b - pb.b));
  }

  function canvasPixelAt(clientX, clientY) {
    if (!boardCanvas || !ctx) return null;
    const rect = boardCanvas.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    const x = Math.max(0, Math.min(boardCanvas.width - 1, Math.floor((clientX - rect.left) * (boardCanvas.width / rect.width))));
    const y = Math.max(0, Math.min(boardCanvas.height - 1, Math.floor((clientY - rect.top) * (boardCanvas.height / rect.height))));
    try {
      const data = ctx.getImageData(x, y, 1, 1).data;
      return {
        canvasX: x,
        canvasY: y,
        rgba: `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${Math.round((data[3] / 255) * 1000) / 1000})`,
      };
    } catch (error) {
      return { error: String(error) };
    }
  }

  function currentColors(label = 'sample') {
    const bodyStyle = getComputedStyle(document.body);
    const canvasStyle = canvas ? getComputedStyle(canvas) : null;
    const boardStyle = boardCanvas ? getComputedStyle(boardCanvas) : null;
    const cssCanvasBg = bodyStyle.getPropertyValue('--canvas-bg').trim();
    const expected = expectedCanvasBg();
    return {
      t: round(performance.now() - t0),
      label,
      theme: appTheme,
      bodyTheme: document.body.dataset.theme || '',
      expected,
      cssCanvasBg,
      cssCanvasBgRgb: colorToRgb(cssCanvasBg),
      bodyBg: bodyStyle.backgroundColor,
      canvasBg: canvasStyle?.backgroundColor || '',
      boardCanvasBg: boardStyle?.backgroundColor || '',
      domMatchesExpected: colorToRgb(cssCanvasBg) === expected &&
        bodyStyle.backgroundColor === expected &&
        (!canvasStyle || canvasStyle.backgroundColor === expected),
    };
  }

  function record(step, detail = {}) {
    const entry = { t: round(performance.now() - t0), step, ...detail };
    events.push(entry);
    return entry;
  }

  function sample(label = 'sample') {
    const entry = currentColors(label);
    samples.push(entry);
    return entry;
  }

  function storeResult(result) {
    lastResult = result;
    lastJson = JSON.stringify(result, null, 2);
    api.lastResult = lastResult;
    api.lastJson = lastJson;
    return result;
  }

  async function copyDebugJson(label, result) {
    storeResult(result);
    const json = lastJson;
    let clipboardApiError = null;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        console.log(`Copied ${label} JSON to clipboard.`);
        return true;
      }
    } catch (error) {
      clipboardApiError = error;
    }

    const ta = document.createElement('textarea');
    ta.value = json;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      if (clipboardApiError) console.warn(`Clipboard API failed for ${label}.`, clipboardApiError);
      console.warn(`Selection copy failed for ${label}.`, error);
    }
    ta.remove();
    if (!copied && clipboardApiError) {
      console.warn(`Clipboard API failed for ${label}.`, clipboardApiError);
    }
    console.log(copied
      ? `Copied ${label} JSON to clipboard.`
      : `Copy command returned false.`);
    return copied;
  }

  async function sampleFrames(count = 8) {
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(sample(`frame-${i}`));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    console.table(rows);
    return rows;
  }

  async function report({ frames = 8 } = {}) {
    const frameRows = await sampleFrames(frames);
    const bodySet = events.find((event) => event.step === 'body-theme-applied');
    const firstMismatch = frameRows.find((row) => !row.domMatchesExpected);
    const summary = {
      theme: appTheme,
      expected: expectedCanvasBg(),
      bodyThemeAppliedAt: bodySet?.t ?? '',
      firstFrameMismatch: firstMismatch?.label || '',
      allSampledFramesMatch: !firstMismatch,
    };
    console.table([summary]);
    console.table(events);
    return storeResult({ summary, events: events.slice(), samples: samples.slice() });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function elementLabel(element) {
    if (!element) return '';
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className && typeof element.className === 'string'
      ? `.${element.className.trim().replace(/\s+/g, '.')}`
      : '';
    return `${element.tagName?.toLowerCase() || ''}${id}${classes}`;
  }

  function scanTopBandRows({
    height = 260,
    step = 10,
    x = Math.round(window.innerWidth / 2),
    yStart = 0,
    tolerance = 2,
  } = {}) {
    const expected = expectedCanvasBg();
    const rows = [];
    const elementCounts = {};

    for (let y = yStart; y <= height; y += step) {
      const element = document.elementFromPoint(x, y);
      const style = element ? getComputedStyle(element) : null;
      const canvasPixel = canvasPixelAt(x, y);
      const canvasPixelDistance = canvasPixel?.rgba ? rgbDistance(canvasPixel.rgba, expected) : '';
      const backgroundDistance = style?.backgroundColor ? rgbDistance(style.backgroundColor, expected) : '';
      const label = elementLabel(element);
      const bgIsTransparent = style?.backgroundColor === 'rgba(0, 0, 0, 0)' || style?.backgroundColor === 'transparent';
      const canvasMismatch = typeof canvasPixelDistance === 'number' && canvasPixelDistance > tolerance;
      const elementBgMismatch = typeof backgroundDistance === 'number' && backgroundDistance > tolerance && !bgIsTransparent;
      elementCounts[label] = (elementCounts[label] || 0) + 1;
      rows.push({
        y,
        x,
        element: label,
        position: style?.position || '',
        zIndex: style?.zIndex || '',
        display: style?.display || '',
        opacity: style?.opacity || '',
        bg: style?.backgroundColor || '',
        bgDistance: backgroundDistance,
        canvasPixel: canvasPixel?.rgba || '',
        canvasPixelDistance,
        canvasPixelXY: canvasPixel ? `${canvasPixel.canvasX ?? ''},${canvasPixel.canvasY ?? ''}` : '',
        canvasMismatch,
        elementBgMismatch,
        mismatch: canvasMismatch || elementBgMismatch,
      });
    }

    const mismatches = rows.filter((row) => row.mismatch);
    const canvasMismatches = rows.filter((row) => row.canvasMismatch);
    const elementBgMismatches = rows.filter((row) => row.elementBgMismatch);
    const summary = {
      theme: appTheme,
      expected,
      x,
      yStart,
      height,
      step,
      tolerance,
      rowCount: rows.length,
      mismatchCount: mismatches.length,
      canvasMismatchCount: canvasMismatches.length,
      elementBgMismatchCount: elementBgMismatches.length,
      firstMismatchY: mismatches[0]?.y ?? '',
      lastMismatchY: mismatches.at(-1)?.y ?? '',
      firstCanvasMismatchY: canvasMismatches[0]?.y ?? '',
      lastCanvasMismatchY: canvasMismatches.at(-1)?.y ?? '',
      firstElementBgMismatchY: elementBgMismatches[0]?.y ?? '',
      lastElementBgMismatchY: elementBgMismatches.at(-1)?.y ?? '',
      elements: elementCounts,
      verdict: canvasMismatches.length
        ? 'board canvas pixels mismatch expected theme'
        : elementBgMismatches.length
          ? 'board canvas matches; foreground/control backgrounds differ'
          : 'sampled rows match expected board background',
    };
    return { summary, rows };
  }

  function topBandScan({
    height = 260,
    step = 10,
    x = Math.round(window.innerWidth / 2),
    yStart = 0,
    tolerance = 2,
    copy = false,
  } = {}) {
    const result = scanTopBandRows({ height, step, x, yStart, tolerance });
    const { summary, rows } = result;
    console.table([summary]);
    console.table(rows);

    storeResult(result);
    if (copy) copyDebugJson('top band debug', result);

    return result;
  }

  async function toggleBandStress({
    toggles = 12,
    frames = 5,
    height = 260,
    step = 10,
    x = Math.round(window.innerWidth / 2),
    tolerance = 2,
    delayMs = 0,
    restore = true,
    copy = true,
  } = {}) {
    const originalTheme = appTheme;
    const frameRows = [];
    const mismatchRows = [];

    for (let toggleIndex = 0; toggleIndex < toggles; toggleIndex++) {
      const targetTheme = appTheme === 'dark' ? 'light' : 'dark';
      const eventStart = events.length;
      const startAt = performance.now();
      await applyAppTheme(targetTheme, { dirty: false });
      await new Promise((resolve) => requestAnimationFrame(resolve));

      for (let frame = 0; frame < frames; frame++) {
        if (frame > 0) await new Promise((resolve) => requestAnimationFrame(resolve));
        const scan = scanTopBandRows({ height, step, x, tolerance });
        const bodyEvent = latestSince('body-theme-applied', eventStart);
        const row = {
          toggleIndex,
          frame,
          targetTheme,
          sinceToggleMs: round(performance.now() - startAt),
          bodyAppliedAt: bodyEvent?.t ?? '',
          mismatchCount: scan.summary.mismatchCount,
          canvasMismatchCount: scan.summary.canvasMismatchCount,
          elementBgMismatchCount: scan.summary.elementBgMismatchCount,
          firstMismatchY: scan.summary.firstMismatchY,
          lastMismatchY: scan.summary.lastMismatchY,
          firstCanvasMismatchY: scan.summary.firstCanvasMismatchY,
          lastCanvasMismatchY: scan.summary.lastCanvasMismatchY,
          firstElementBgMismatchY: scan.summary.firstElementBgMismatchY,
          lastElementBgMismatchY: scan.summary.lastElementBgMismatchY,
          verdict: scan.summary.verdict,
        };
        frameRows.push(row);
        for (const mismatch of scan.rows.filter((item) => item.mismatch)) {
          mismatchRows.push({
            toggleIndex,
            frame,
            targetTheme,
            y: mismatch.y,
            element: mismatch.element,
            bg: mismatch.bg,
            bgDistance: mismatch.bgDistance,
            canvasPixel: mismatch.canvasPixel,
            canvasPixelDistance: mismatch.canvasPixelDistance,
            canvasPixelXY: mismatch.canvasPixelXY,
            canvasMismatch: mismatch.canvasMismatch,
            elementBgMismatch: mismatch.elementBgMismatch,
          });
        }
      }

      if (delayMs > 0) await wait(delayMs);
    }

    if (restore && appTheme !== originalTheme) {
      await applyAppTheme(originalTheme, { dirty: false });
    }

    const summary = {
      toggles,
      frames,
      height,
      step,
      x,
      tolerance,
      originalTheme,
      finalTheme: appTheme,
      totalFrameSamples: frameRows.length,
      framesWithMismatch: frameRows.filter((row) => row.mismatchCount > 0).length,
      framesWithCanvasMismatch: frameRows.filter((row) => row.canvasMismatchCount > 0).length,
      framesWithElementBgMismatch: frameRows.filter((row) => row.elementBgMismatchCount > 0).length,
      totalMismatchedRows: mismatchRows.length,
      totalCanvasMismatchedRows: mismatchRows.filter((row) => row.canvasMismatch).length,
      totalElementBgMismatchedRows: mismatchRows.filter((row) => row.elementBgMismatch).length,
      firstMismatch: mismatchRows[0] || null,
      maxMismatchCountInFrame: frameRows.reduce((max, row) => Math.max(max, row.mismatchCount), 0),
      maxCanvasMismatchCountInFrame: frameRows.reduce((max, row) => Math.max(max, row.canvasMismatchCount), 0),
      verdict: frameRows.some((row) => row.canvasMismatchCount > 0)
        ? 'board canvas mismatch occurred during toggle frames; inspect mismatchRows'
        : frameRows.some((row) => row.elementBgMismatchCount > 0)
          ? 'board canvas stayed consistent; foreground/control backgrounds differed'
          : 'sampled rows stayed consistent during toggle frames',
    };
    const result = { summary, frameRows, mismatchRows, events: events.slice() };
    console.table([summary]);
    console.table(frameRows);
    if (mismatchRows.length) console.table(mismatchRows.slice(0, 80));

    storeResult(result);
    if (copy) await copyDebugJson('top band toggle stress', result);

    return result;
  }

  async function toggleThemeOrderStress(options = {}) {
    return toggleBandStress(options);
  }

  function latestSince(step, sinceIndex) {
    for (let index = events.length - 1; index >= sinceIndex; index--) {
      if (events[index].step === step) return events[index];
    }
    return null;
  }

  async function toggleStress({
    toggles = 20,
    delayMs = 25,
    settleFrames = 2,
    restore = true,
    copy = false,
    mismatchThresholdMs = 16,
  } = {}) {
    const originalTheme = appTheme;
    const rows = [];

    for (let index = 0; index < toggles; index++) {
      const targetTheme = appTheme === 'dark' ? 'light' : 'dark';
      const eventStart = events.length;
      const startAt = performance.now();
      await applyAppTheme(targetTheme, { dirty: false });
      for (let frame = 0; frame < settleFrames; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const bodyEvent = latestSince('body-theme-applied', eventStart);
      const sampleRow = sample(`toggle-${index}-settled`);
      rows.push({
        index,
        targetTheme,
        totalMs: round(performance.now() - startAt),
        bodyAppliedAt: bodyEvent?.t ?? '',
        domMatchesExpected: sampleRow.domMatchesExpected,
        visibleMismatchRisk: !sampleRow.domMatchesExpected,
      });
      if (delayMs > 0) await wait(delayMs);
    }

    if (restore && appTheme !== originalTheme) {
      await applyAppTheme(originalTheme, { dirty: false });
    }

    const mismatches = rows.filter((row) => (
      !row.domMatchesExpected
    ));
    const summary = {
      toggles,
      delayMs,
      settleFrames,
      originalTheme,
      finalTheme: appTheme,
      mismatchThresholdMs,
      mismatchCount: mismatches.length,
      allDomFramesMatched: rows.every((row) => row.domMatchesExpected),
      anyVisibleMismatchRisk: rows.some((row) => row.visibleMismatchRisk),
      verdict: mismatches.length
        ? 'inspect rows with dom mismatch or visibleMismatchRisk'
        : 'all toggles matched within threshold',
    };
    const result = { summary, rows, events: events.slice(), samples: samples.slice() };
    console.table([summary]);
    console.table(rows);

    storeResult(result);
    if (copy) await copyDebugJson('theme toggle stress', result);

    return result;
  }

  const api = { record, sample, sampleFrames, report, toggleStress, topBandScan, toggleBandStress, toggleThemeOrderStress, events, samples, expectedCanvasBg, lastResult, lastJson };
  return api;
})() : createNoopStartupDebug();

// DevTools diagnostics are intentionally funneled through beginDebug() and
// finishDebug(). Agents should give developers those two calls, not raw
// BoardfishDebug.* commands, because finishDebug() captures console output,
// table inputs, function results, and writes one JSON artifact.
(function initBoardfishDebugConsole() {
let initializingDebugConsole = true;
const BoardfishDebugConsole = (() => {
  const namespaces = {};
  const commands = {};
  const publicDebug = {};
  const guardCache = new WeakMap();
  const directCallStackPattern = /\/(?:src\/)?(?:js\/(?!startup_debug\.js)|app\.js)/;
  const reservedSpecKeys = new Set(['calls', 'commands', 'label', 'filename', 'download']);
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'table', 'group', 'groupCollapsed', 'groupEnd'];
  const debugGlobalNames = {
    startup: 'StartupDebug',
    clipboard: 'ClipDebug',
    history: 'HistoryDebug',
    viewport: 'ViewportDebug',
    save: 'SaveDebug',
    open: 'OpenDebug',
    export: 'ExportDebug',
    perf: 'ManualPerfDebug',
    insert: 'InsertDebug',
    textSel: 'TextSelDebug',
    pill: 'PillDebug',
    menu: 'MenuDebug',
  };

  let activeDepth = 0;
  let activeSession = null;
  let consoleCapture = null;
  let originalConsole = null;
  let nextSessionId = 1;

  function resetPublicDebug() {
    for (const key of Object.keys(publicDebug)) delete publicDebug[key];
  }

  function guardMessage(path) {
    return `[Boardfish debug] Direct console call "${path}" is disabled. Use beginDebug()/finishDebug() so logs, tables, and results are captured in one JSON file.`;
  }

  function isAllowedCaller() {
    if (activeDepth > 0) return true;
    const stack = new Error().stack || '';
    return directCallStackPattern.test(stack);
  }

  function guardValue(value, path) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (guardCache.has(value)) return guardCache.get(value);
    if (typeof value === 'function') {
      const guarded = function guardedDebugFunction(...args) {
        if (!isAllowedCaller()) throw new Error(guardMessage(path));
        return value.apply(this, args);
      };
      guardCache.set(value, guarded);
      return guarded;
    }

    const proxy = new Proxy(value, {
      get(target, prop, receiver) {
        const raw = Reflect.get(target, prop, receiver);
        if (typeof prop === 'symbol') return raw;
        return guardValue(raw, `${path}.${String(prop)}`);
      },
      set(target, prop, nextValue, receiver) {
        if (!isAllowedCaller()) throw new Error(guardMessage(`${path}.${String(prop)}`));
        return Reflect.set(target, prop, nextValue, receiver);
      },
    });
    guardCache.set(value, proxy);
    return proxy;
  }

  function publish() {
    resetPublicDebug();
    for (const [name, api] of Object.entries(namespaces)) {
      publicDebug[name] = guardValue(api, `BoardfishDebug.${name}`);
      const globalName = debugGlobalNames[name];
      if (globalName && window[globalName] === api) window[globalName] = publicDebug[name];
    }
    publicDebug.beginDebug = beginDebug;
    publicDebug.finishDebug = finishDebug;
    window.BoardfishDebug = publicDebug;
    window.beginDebug = beginDebug;
    window.finishDebug = finishDebug;
  }

  function expose(tools) {
    if (!initializingDebugConsole && !isAllowedCaller()) throw new Error('[Boardfish debug] exposeDebug() is internal. Use beginDebug()/finishDebug() from the console.');
    if (!DEBUG_TOOLS_ENABLED) {
      try {
        delete window.BoardfishDebug;
        delete window.beginDebug;
        delete window.finishDebug;
      } catch (_) {
        window.BoardfishDebug = undefined;
        window.beginDebug = undefined;
        window.finishDebug = undefined;
      }
      return;
    }
    Object.assign(namespaces, tools);
    publish();
  }

  function registerCommand(name, fn) {
    if (!DEBUG_TOOLS_ENABLED || typeof fn !== 'function') return;
    if (!isAllowedCaller()) throw new Error('[Boardfish debug] registerDebugCommand() is for codebase-owned test actions. Use beginDebug()/finishDebug() from the console.');
    commands[name] = fn;
  }

  function serializeDebugValue(value, seen = new WeakSet(), depth = 0) {
    const type = typeof value;
    if (value == null || type === 'number' || type === 'boolean') return value;
    if (type === 'string') {
      if (/^data:/i.test(value)) {
        const comma = value.indexOf(',');
        return { type: 'data-url', length: value.length, mime: comma > 0 ? value.slice(0, comma) : value.slice(0, 80) };
      }
      if (value.length > 500000) return { type: 'string', length: value.length, preview: value.slice(0, 2000) };
      return value;
    }
    if (type === 'bigint') return value.toString();
    if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (depth > 8) return '[MaxDepth]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack || '' };
    }
    if (value instanceof Element) {
      return {
        node: value.tagName.toLowerCase(),
        id: value.id || '',
        className: typeof value.className === 'string' ? value.className : '',
        text: (value.textContent || '').slice(0, 200),
      };
    }
    if (Array.isArray(value)) {
      const max = 10000;
      const out = value.slice(0, max).map((item) => serializeDebugValue(item, seen, depth + 1));
      if (value.length > max) out.push({ truncated: value.length - max });
      return out;
    }
    if (value instanceof Map) {
      return {
        type: 'Map',
        entries: Array.from(value.entries()).slice(0, 1000)
          .map(([key, item]) => [serializeDebugValue(key, seen, depth + 1), serializeDebugValue(item, seen, depth + 1)]),
        size: value.size,
      };
    }
    if (value instanceof Set) {
      return {
        type: 'Set',
        values: Array.from(value.values()).slice(0, 1000).map((item) => serializeDebugValue(item, seen, depth + 1)),
        size: value.size,
      };
    }

    const out = {};
    for (const key of Object.keys(value).slice(0, 1000)) {
      try {
        out[key] = serializeDebugValue(value[key], seen, depth + 1);
      } catch (error) {
        out[key] = { error: String(error) };
      }
    }
    return out;
  }

  function startConsoleCapture(sessionId) {
    if (consoleCapture) return consoleCapture;
    originalConsole = {};
    consoleCapture = { sessionId, startedAt: new Date().toISOString(), entries: [] };
    for (const method of consoleMethods) {
      const original = console[method];
      if (typeof original !== 'function') continue;
      originalConsole[method] = original;
      console[method] = function capturedConsoleMethod(...args) {
        try {
          consoleCapture.entries.push({
            at: Math.round(performance.now() * 100) / 100,
            method,
            args: args.map((arg) => serializeDebugValue(arg)),
            stack: (new Error().stack || '').split('\n').slice(2, 7),
          });
        } catch (_) {
          // Capture must never interfere with the diagnostic action being tested.
        }
        return original.apply(this, args);
      };
    }
    return consoleCapture;
  }

  function stopConsoleCapture() {
    if (!originalConsole) return null;
    for (const [method, original] of Object.entries(originalConsole)) {
      console[method] = original;
    }
    const stopped = consoleCapture;
    originalConsole = null;
    consoleCapture = null;
    return stopped;
  }

  function normalizePath(path) {
    return String(path || '').replace(/^BoardfishDebug\./, '');
  }

  function argsFromValue(value) {
    if (value === true || value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function addCall(calls, path, args = []) {
    calls.push({ path: normalizePath(path), args: Array.isArray(args) ? args : [args] });
  }

  function normalizeCallEntry(entry, calls, prefix = '') {
    if (typeof entry === 'string') {
      addCall(calls, prefix ? `${prefix}.${entry}` : entry);
      return;
    }
    if (Array.isArray(entry)) {
      const [path, ...args] = entry;
      addCall(calls, prefix && !String(path).includes('.') ? `${prefix}.${path}` : path, args);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const path = entry.path || entry.fn || entry.name || entry.call;
    if (path) {
      addCall(calls, prefix && !String(path).includes('.') ? `${prefix}.${path}` : path, argsFromValue(entry.args));
      return;
    }
    for (const [method, value] of Object.entries(entry)) {
      addCall(calls, prefix ? `${prefix}.${method}` : method, argsFromValue(value));
    }
  }

  function normalizeNamespaceCalls(namespace, value, calls) {
    if (value === true) {
      addCall(calls, `${namespace}.enable`);
      addCall(calls, `${namespace}.reset`);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) normalizeCallEntry(item, calls, namespace);
      return;
    }
    if (typeof value === 'string') {
      addCall(calls, `${namespace}.${value}`);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [method, args] of Object.entries(value)) addCall(calls, `${namespace}.${method}`, argsFromValue(args));
    }
  }

  function normalizeSpec(spec) {
    const calls = [];
    const options = {};
    if (spec == null) return { calls, options };
    if (typeof spec === 'string' || Array.isArray(spec)) {
      const items = Array.isArray(spec) ? spec : [spec];
      for (const item of items) normalizeCallEntry(item, calls);
      return { calls, options };
    }
    if (typeof spec !== 'object') return { calls, options };
    for (const key of ['label', 'filename', 'download']) {
      if (Object.prototype.hasOwnProperty.call(spec, key)) options[key] = spec[key];
    }
    for (const item of spec.calls || []) normalizeCallEntry(item, calls);
    for (const item of spec.commands || []) normalizeCallEntry(item, calls);
    for (const [key, value] of Object.entries(spec)) {
      if (reservedSpecKeys.has(key)) continue;
      if (namespaces[key]) normalizeNamespaceCalls(key, value, calls);
      else if (commands[key]) addCall(calls, key, argsFromValue(value));
      else if (key.includes('.')) addCall(calls, key, argsFromValue(value));
      else throw new Error(`[Boardfish debug] Unknown debug target "${key}". Register it with registerDebugCommand() or exposeDebug().`);
    }
    return { calls, options };
  }

  function resolveCall(path) {
    const normalized = normalizePath(path);
    if (commands[normalized]) return commands[normalized];
    const parts = normalized.split('.');
    let current = namespaces[parts.shift()];
    for (const part of parts) current = current?.[part];
    if (typeof current !== 'function') throw new Error(`[Boardfish debug] "${normalized}" is not a registered debug function.`);
    return current;
  }

  async function runCalls(calls, phase) {
    const results = [];
    for (const call of calls) {
      const startedAt = performance.now();
      const row = { phase, path: call.path, args: serializeDebugValue(call.args), ok: false, ms: 0 };
      try {
        const fn = resolveCall(call.path);
        activeDepth++;
        try {
          row.result = serializeDebugValue(await fn(...call.args));
        } finally {
          activeDepth--;
        }
        row.ok = true;
      } catch (error) {
        row.error = serializeDebugValue(error);
        console.error(`[Boardfish debug] ${call.path} failed`, error);
      }
      row.ms = Math.round((performance.now() - startedAt) * 100) / 100;
      results.push(row);
      if (phase === 'begin' && call.path.endsWith('.enable') && activeSession) {
        activeSession.enabledNamespaces.add(call.path.split('.')[0]);
      }
    }
    return results;
  }

  function defaultFinishCalls() {
    const calls = [];
    if (!activeSession) return calls;
    for (const namespace of activeSession.enabledNamespaces) {
      const api = namespaces[namespace];
      for (const method of ['summary', 'dump']) {
        if (typeof api?.[method] === 'function') addCall(calls, `${namespace}.${method}`);
      }
    }
    return calls;
  }

  function debugFileName(label = '') {
    const safeLabel = String(label || '').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `boardfish-debug${safeLabel ? '-' + safeLabel : ''}-${stamp}.json`;
  }

  function browserDownload(filename, json) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { method: 'browser-download', filename, bytes: json.length };
  }

  async function persistPayload(payload, options) {
    const filename = options.filename || debugFileName(options.label || payload.label || '');
    const json = JSON.stringify(payload, null, 2);
    if (options.download === false) return { method: 'disabled', filename, bytes: json.length };
    return browserDownload(filename, json);
  }

  async function beginDebug(spec = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish debug] Debug tools are disabled in this build.');
      return null;
    }
    if (activeSession) {
      stopConsoleCapture();
      activeSession = null;
    }
    const { calls, options } = normalizeSpec(spec);
    const id = `debug-${nextSessionId++}`;
    activeSession = {
      id,
      label: options.label || '',
      startedAt: new Date().toISOString(),
      beginSpec: serializeDebugValue(spec),
      beginCalls: [],
      finishCalls: [],
      enabledNamespaces: new Set(),
    };
    startConsoleCapture(id);
    console.info(`[Boardfish debug] Session ${id} started. Run the test, then call finishDebug(...).`);
    activeSession.beginCalls = await runCalls(calls, 'begin');
    return {
      sessionId: id,
      startedAt: activeSession.startedAt,
      calls: activeSession.beginCalls,
    };
  }

  async function finishDebug(spec = {}) {
    if (!DEBUG_TOOLS_ENABLED) {
      console.warn('[Boardfish debug] Debug tools are disabled in this build.');
      return null;
    }
    if (!activeSession) {
      const id = `debug-${nextSessionId++}`;
      activeSession = {
        id,
        label: '',
        startedAt: new Date().toISOString(),
        beginSpec: null,
        beginCalls: [],
        finishCalls: [],
        enabledNamespaces: new Set(),
      };
      startConsoleCapture(id);
    }
    const { calls, options } = normalizeSpec(spec);
    const finishCalls = calls.length ? calls : defaultFinishCalls();
    activeSession.finishSpec = serializeDebugValue(spec);
    activeSession.finishCalls = await runCalls(finishCalls, 'finish');
    const stoppedCapture = stopConsoleCapture() || { entries: [] };
    const finishedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      app: 'Boardfish',
      sessionId: activeSession.id,
      label: options.label || activeSession.label || '',
      startedAt: activeSession.startedAt,
      finishedAt,
      durationMs: Math.round((new Date(finishedAt).getTime() - new Date(activeSession.startedAt).getTime()) * 100) / 100,
      location: window.location.href,
      userAgent: navigator.userAgent,
      beginSpec: activeSession.beginSpec,
      finishSpec: activeSession.finishSpec,
      beginCalls: activeSession.beginCalls,
      finishCalls: activeSession.finishCalls,
      console: stoppedCapture.entries,
    };
    const persistResult = await persistPayload(payload, options);
    activeSession = null;
    console.info(`[Boardfish debug] Wrote ${persistResult.bytes} bytes to ${persistResult.path || persistResult.filename}.`);
    return { sessionId: payload.sessionId, file: persistResult, finishCalls: payload.finishCalls };
  }

  return { expose, registerCommand, beginDebug, finishDebug };
})();

function exposeDebug(tools) {
  BoardfishDebugConsole.expose(tools);
}

function registerDebugCommand(name, fn) {
  BoardfishDebugConsole.registerCommand(name, fn);
}
window.exposeDebug = exposeDebug;
window.registerDebugCommand = registerDebugCommand;
exposeDebug({ startup: StartupDebug });
initializingDebugConsole = false;
})();
