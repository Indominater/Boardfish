'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────
var canvas      = document.getElementById('canvas');
var boardCanvas = document.getElementById('board-canvas');
var ctx         = boardCanvas.getContext('2d');
var ctxMenu     = document.getElementById('ctx-menu');
var ctxActions  = document.getElementById('ctx-actions');
var darkModeMenuBtn = document.getElementById('ctx-btn-dark-mode');
var eyedropperMenuBtn = document.getElementById('ctx-btn-eyedropper');
var fileInput   = document.getElementById('file-input');
var selOverlay  = document.getElementById('sel-overlay');
var multiSelOverlay = document.getElementById('multi-sel-overlay');
var island       = document.getElementById('island');
var islZoom        = document.getElementById('isl-zoom');
var islMeasure     = document.getElementById('isl-measure');
var openingShield  = document.getElementById('opening-shield');
var objCtxMenu  = document.getElementById('obj-ctx-menu');
var copyBtn           = document.getElementById('obj-btn-copy');
var saveImageBtn      = document.getElementById('obj-btn-save-image');
var saveImagesBtn     = document.getElementById('obj-btn-save-images');
var exportSep         = document.getElementById('obj-sep-export');
var imageActionsSep   = document.getElementById('obj-sep-image-actions');
var flipHorizontalBtn = document.getElementById('obj-btn-flip-horizontal');
var flipVerticalBtn   = document.getElementById('obj-btn-flip-vertical');
var rotateBtn         = document.getElementById('obj-btn-rotate');
var rubberBand       = document.getElementById('rubber-band');
var addTextBtn       = document.getElementById('btn-add-text');
var addImageBtn      = document.getElementById('btn-add-image');
var pasteBtn         = document.getElementById('btn-paste');
var exportAllImageBtn = document.getElementById('btn-export-all-images');
var exportAllTextBtn  = document.getElementById('btn-export-all-text');
var exportAllSep      = document.getElementById('ctx-sep-export-all');
var IS_WIN = /Win/.test(navigator.platform) || /Win/.test(navigator.userAgent);
var IS_MAC = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
if (IS_MAC) document.body.classList.add('is-macos');
var COMMAND_KEY_LABEL = IS_MAC ? '\u2318' : 'Ctrl';
var SHIFT_KEY_LABEL = IS_MAC ? '\u21e7' : 'Shift';
var MENU_SHORTCUTS = {
  'new-board': [COMMAND_KEY_LABEL, 'N'],
  'add-images': [COMMAND_KEY_LABEL, 'I'],
  paste: [COMMAND_KEY_LABEL, 'V'],
  save: [COMMAND_KEY_LABEL, 'S'],
  'save-as': IS_MAC ? [SHIFT_KEY_LABEL, COMMAND_KEY_LABEL, 'S'] : [COMMAND_KEY_LABEL, SHIFT_KEY_LABEL, 'S'],
  open: [COMMAND_KEY_LABEL, 'O'],
  copy: [COMMAND_KEY_LABEL, 'C'],
  cut: [COMMAND_KEY_LABEL, 'X'],
  duplicate: [COMMAND_KEY_LABEL, 'D'],
  delete: ['Delete'],
};

function formatShortcut(keys) {
  return IS_MAC ? keys.join('') : keys.join('+');
}

function syncPlatformShortcutLabels() {
  for (const item of document.querySelectorAll('[data-shortcut]')) {
    const keys = MENU_SHORTCUTS[item.dataset.shortcut];
    item.textContent = keys ? formatShortcut(keys) : '';
  }
}
syncPlatformShortcutLabels();
var TRANSPARENT_TEXT_COLOR = 'rgba(255,255,255,0)';
var APP_THEMES = {
  light: {
    native: 'Light',
  },
  dark: {
    native: 'Dark',
  },
};
var appTheme = 'light';
var APP_THEME_STORAGE_KEY = 'bf_app_theme';
var _queuedNativeAppTheme = null;
var _nativeAppThemeRaf = null;
var _nativeAppThemeInFlight = false;
var StartupDebug = (() => {
  const t0 = performance.now();
  const events = [];
  const samples = [];
  let lastResult = null;
  let lastJson = '';

  function round(value) {
    return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  }

  function colorToRgb(value) {
    const probe = document.createElement('span');
    probe.style.color = value || '';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }

  function expectedCanvasBg(theme = appTheme) {
    return theme === 'dark' ? colorToRgb('#1c1b22') : colorToRgb('rgb(224, 224, 227)');
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
      : `Copy command returned false. Result is available as BoardfishStartupDebug.lastJson and BoardfishStartupDebug.lastResult.`);
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
    const nativeDone = events.find((event) => event.step === 'apply-native-theme:done');
    const bodySet = events.find((event) => event.step === 'body-theme-applied');
    const showStart = events.find((event) => event.step === 'show-window:start');
    const firstMismatch = frameRows.find((row) => !row.domMatchesExpected);
    const summary = {
      theme: appTheme,
      expected: expectedCanvasBg(),
      nativeThemeDoneAt: nativeDone?.t ?? '',
      bodyThemeAppliedAt: bodySet?.t ?? '',
      showRequestedAt: showStart?.t ?? '',
      nativeVsBodyDeltaMs: nativeDone && bodySet ? round(nativeDone.t - bodySet.t) : '',
      firstFrameMismatch: firstMismatch?.label || '',
      allSampledFramesMatch: !firstMismatch,
      nativeColor: nativeDone?.nativeColor || '',
      nativeTheme: nativeDone?.nativeTheme || '',
    };
    console.table([summary]);
    console.table(events);
    return storeResult({ summary, events: events.slice(), samples: samples.slice() });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFrames(count = 0) {
    for (let frame = 0; frame < count; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
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
      await applyAppTheme(targetTheme, { dirty: false, nativeFirst: true });

      for (let frame = 0; frame < frames; frame++) {
        if (frame > 0) await new Promise((resolve) => requestAnimationFrame(resolve));
        const scan = scanTopBandRows({ height, step, x, tolerance });
        const bodyEvent = latestSince('body-theme-applied', eventStart);
        const nativeEvent = latestSince('apply-native-theme:done', eventStart);
        const row = {
          toggleIndex,
          frame,
          targetTheme,
          sinceToggleMs: round(performance.now() - startAt),
          bodyAppliedAt: bodyEvent?.t ?? '',
          nativeDoneAt: nativeEvent?.t ?? '',
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
      await applyAppTheme(originalTheme, { dirty: false, nativeFirst: true });
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

  async function toggleNativeSkewStress({
    togglesPerVariant = 8,
    frames = 3,
    height = window.innerHeight - 1,
    step = 50,
    x = Math.round(window.innerWidth / 2),
    tolerance = 2,
    delayMs = 0,
    pauseBetweenVariantsMs = 900,
    restore = true,
    copy = true,
    variants = [
      { label: 'native-first-immediate', nativeFirst: true, nativeSettleFrames: 0, nativeSettleMs: 0 },
      { label: 'native-first-1-frame', nativeFirst: true, nativeSettleFrames: 1, nativeSettleMs: 0 },
      { label: 'native-first-0ms', nativeFirst: true, nativeSettleFrames: 0, nativeSettleMs: 0 },
      { label: 'native-parallel-0ms', nativeParallel: true, nativeParallelDomMs: 0 },
      { label: 'dom-first-immediate', nativeFirst: false, nativeSettleFrames: 0, nativeSettleMs: 0 },
    ],
  } = {}) {
    const originalTheme = appTheme;
    const variantRows = [];
    const frameRows = [];

    for (const variant of variants) {
      const variantStartIndex = frameRows.length;
      console.info('[Boardfish startup]', 'native-skew-variant:start', variant);
      record('native-skew-variant:start', variant);

      for (let toggleIndex = 0; toggleIndex < togglesPerVariant; toggleIndex++) {
        const targetTheme = appTheme === 'dark' ? 'light' : 'dark';
        const eventStart = events.length;
        const startAt = performance.now();
        await applyAppTheme(targetTheme, {
          dirty: false,
          nativeFirst: variant.nativeFirst !== false,
          nativeParallel: variant.nativeParallel === true,
          nativeParallelDomMs: variant.nativeParallelDomMs || 0,
          nativeSettleFrames: variant.nativeSettleFrames || 0,
          nativeSettleMs: variant.nativeSettleMs || 0,
        });

        for (let frame = 0; frame < frames; frame++) {
          if (frame > 0) await waitFrames(1);
          const scan = scanTopBandRows({ height, step, x, tolerance });
          const nativeStart = latestSince('apply-native-theme:start', eventStart);
          const nativeDone = latestSince('apply-native-theme:done', eventStart);
          const bodyEvent = latestSince('body-theme-applied', eventStart);
          const repaintEvent = latestSince('theme-canvas-repaint', eventStart);
          frameRows.push({
            variant: variant.label || '',
            toggleIndex,
            frame,
            targetTheme,
            sinceToggleMs: round(performance.now() - startAt),
            nativeStartAt: nativeStart?.t ?? '',
            nativeDoneAt: nativeDone?.t ?? '',
            bodyAppliedAt: bodyEvent?.t ?? '',
            canvasRepaintAt: repaintEvent?.t ?? '',
            nativeDoneToBodyMs: nativeDone && bodyEvent ? round(bodyEvent.t - nativeDone.t) : '',
            bodyToCanvasRepaintMs: bodyEvent && repaintEvent ? round(repaintEvent.t - bodyEvent.t) : '',
            nativeStartToBodyMs: nativeStart && bodyEvent ? round(bodyEvent.t - nativeStart.t) : '',
            nativeStartToCanvasRepaintMs: nativeStart && repaintEvent ? round(repaintEvent.t - nativeStart.t) : '',
            canvasMismatchCount: scan.summary.canvasMismatchCount,
            elementBgMismatchCount: scan.summary.elementBgMismatchCount,
            verdict: scan.summary.verdict,
          });
        }

        if (delayMs > 0) await wait(delayMs);
      }

      const rows = frameRows.slice(variantStartIndex);
      const variantSummary = {
        label: variant.label || '',
        nativeFirst: variant.nativeFirst !== false,
        nativeParallel: variant.nativeParallel === true,
        nativeParallelDomMs: variant.nativeParallelDomMs || 0,
        nativeSettleFrames: variant.nativeSettleFrames || 0,
        nativeSettleMs: variant.nativeSettleMs || 0,
        samples: rows.length,
        framesWithCanvasMismatch: rows.filter((row) => row.canvasMismatchCount > 0).length,
        maxCanvasMismatchCountInFrame: rows.reduce((max, row) => Math.max(max, row.canvasMismatchCount), 0),
        minNativeDoneToBodyMs: rows.reduce((min, row) => typeof row.nativeDoneToBodyMs === 'number' ? Math.min(min, row.nativeDoneToBodyMs) : min, Infinity),
        maxNativeDoneToBodyMs: rows.reduce((max, row) => typeof row.nativeDoneToBodyMs === 'number' ? Math.max(max, row.nativeDoneToBodyMs) : max, -Infinity),
        averageNativeDoneToBodyMs: round(rows.reduce((sum, row) => sum + (Number(row.nativeDoneToBodyMs) || 0), 0) / Math.max(1, rows.filter((row) => typeof row.nativeDoneToBodyMs === 'number').length)),
        note: 'Native titlebar pixels cannot be sampled from the webview; visually compare titlebar/canvas during this variant.',
      };
      if (variantSummary.minNativeDoneToBodyMs === Infinity) variantSummary.minNativeDoneToBodyMs = '';
      if (variantSummary.maxNativeDoneToBodyMs === -Infinity) variantSummary.maxNativeDoneToBodyMs = '';
      variantRows.push(variantSummary);
      console.table([variantSummary]);

      if (pauseBetweenVariantsMs > 0) await wait(pauseBetweenVariantsMs);
    }

    if (restore && appTheme !== originalTheme) {
      await applyAppTheme(originalTheme, { dirty: false, nativeFirst: true });
    }

    const result = {
      summary: {
        togglesPerVariant,
        frames,
        height,
        step,
        x,
        tolerance,
        originalTheme,
        finalTheme: appTheme,
        variants: variantRows.length,
        verdict: 'Use visual comparison between variants; if settle variants look aligned, app can delay web repaint. If none align, native OS composition is likely the limit.',
      },
      variantRows,
      frameRows,
      events: events.slice(),
    };
    console.table(variantRows);
    console.table(frameRows);

    storeResult(result);
    if (copy) await copyDebugJson('native skew stress', result);

    return result;
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
      await applyAppTheme(targetTheme, { dirty: false, nativeFirst: true });
      for (let frame = 0; frame < settleFrames; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const bodyEvent = latestSince('body-theme-applied', eventStart);
      const nativeEvent = latestSince('apply-native-theme:done', eventStart);
      const sampleRow = sample(`toggle-${index}-settled`);
      const expectedNativeColor = targetTheme === 'dark' ? '#1c1b22' : '#e0e0e3';
      const mismatchMs = bodyEvent && nativeEvent ? round(nativeEvent.t - bodyEvent.t) : '';
      rows.push({
        index,
        targetTheme,
        totalMs: round(performance.now() - startAt),
        bodyAppliedAt: bodyEvent?.t ?? '',
        nativeDoneAt: nativeEvent?.t ?? '',
        mismatchMs,
        nativeColor: nativeEvent?.nativeColor || '',
        expectedNativeColor,
        nativeMatchesTarget: nativeEvent?.theme === targetTheme && nativeEvent?.nativeColor === expectedNativeColor,
        domMatchesExpected: sampleRow.domMatchesExpected,
        visibleMismatchRisk: typeof mismatchMs === 'number' && mismatchMs > mismatchThresholdMs,
      });
      if (delayMs > 0) await wait(delayMs);
    }

    if (restore && appTheme !== originalTheme) {
      await applyAppTheme(originalTheme, { dirty: false, nativeFirst: true });
    }

    const mismatches = rows.filter((row) => (
      !row.nativeMatchesTarget ||
      !row.domMatchesExpected ||
      row.visibleMismatchRisk
    ));
    const summary = {
      toggles,
      delayMs,
      settleFrames,
      originalTheme,
      finalTheme: appTheme,
      mismatchThresholdMs,
      maxMismatchMs: rows.reduce((max, row) => Math.max(max, Number(row.mismatchMs) || 0), 0),
      mismatchCount: mismatches.length,
      allNativeColorsMatched: rows.every((row) => row.nativeMatchesTarget),
      allDomFramesMatched: rows.every((row) => row.domMatchesExpected),
      anyVisibleMismatchRisk: rows.some((row) => row.visibleMismatchRisk),
      verdict: mismatches.length
        ? 'inspect rows with native/color/dom mismatch or visibleMismatchRisk'
        : 'all toggles matched within threshold',
    };
    const result = { summary, rows, events: events.slice(), samples: samples.slice() };
    console.table([summary]);
    console.table(rows);

    storeResult(result);
    if (copy) await copyDebugJson('theme toggle stress', result);

    return result;
  }

  const api = { record, sample, sampleFrames, report, toggleStress, topBandScan, toggleBandStress, toggleNativeSkewStress, events, samples, expectedCanvasBg, lastResult, lastJson };
  return api;
})();
window.BoardfishStartupDebug = StartupDebug;
var DEBUG_TOOLS_ENABLED = (() => {
  try {
    const params = new URLSearchParams(window.location?.search || '');
    return localStorage.getItem('bf_debug_tools') === '1' || params.get('bf_debug_tools') === '1';
  } catch (_) {
    return false;
  }
})();

function exposeDebug(tools) {
  if (!DEBUG_TOOLS_ENABLED) return;
  window.BoardfishDebug = Object.assign(window.BoardfishDebug || {}, tools);
}
exposeDebug({ startup: StartupDebug });

function hasTauri() {
  return !!window.__TAURI__;
}

function tauriInvoke(command, args = {}) {
  if (!hasTauri()) throw new Error('Tauri is unavailable');
  return window.__TAURI__.core.invoke(command, args);
}

function logStartupStep(step, detail = {}) {
  StartupDebug.record(step, detail);
  try {
    console.info('[Boardfish startup]', step, detail);
  } catch (_) {}
}

function logStartupError(step, error) {
  StartupDebug.record(step, { error: String(error) });
  try {
    console.error('[Boardfish startup]', step, error);
  } catch (_) {}
}

function setNativeDebug(command, enabled) {
  if (!hasTauri()) return;
  tauriInvoke(command, { enabled }).catch(() => {});
}

function normalizeAppTheme(value) {
  return String(value || '').toLowerCase() === 'dark' ? 'dark' : 'light';
}

function loadStoredAppTheme() {
  try {
    return normalizeAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch (_) {
    return 'light';
  }
}

function storeAppTheme() {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
  } catch (_) {}
}

function applyNativeAppTheme(theme = appTheme) {
  if (!hasTauri()) return Promise.resolve();
  const nextTheme = normalizeAppTheme(theme);
  const nativeTheme = APP_THEMES[nextTheme].native;
  logStartupStep('apply-native-theme:start', { theme: nextTheme, nativeTheme });
  return tauriInvoke('set_app_theme', { theme: nativeTheme })
    .then((native) => logStartupStep('apply-native-theme:done', {
      theme: nextTheme,
      nativeTheme: native?.theme || nativeTheme,
      nativeColor: native?.color || '',
      nativeMs: native?.ms ?? '',
    }))
    .catch((err) => {
      logStartupError('apply-native-theme:failed', err);
    });
}

function showAppWindow() {
  if (!hasTauri()) return Promise.resolve();
  logStartupStep('show-window:start', { theme: appTheme });
  return tauriInvoke('show_app_window')
    .then(() => logStartupStep('show-window:done', { theme: appTheme }))
    .catch((err) => {
      logStartupError('show-window:failed', err);
    });
}

function flushQueuedNativeAppTheme() {
  if (_nativeAppThemeInFlight || !_queuedNativeAppTheme) return Promise.resolve();
  const nextTheme = _queuedNativeAppTheme;
  _queuedNativeAppTheme = null;
  _nativeAppThemeInFlight = true;
  return applyNativeAppTheme(nextTheme).finally(() => {
    _nativeAppThemeInFlight = false;
    if (!_queuedNativeAppTheme) return;
    if (_queuedNativeAppTheme === nextTheme) {
      _queuedNativeAppTheme = null;
      return;
    }
    scheduleNativeAppThemeAfterPaint(_queuedNativeAppTheme);
  });
}

function scheduleNativeAppThemeAfterPaint(theme = appTheme) {
  if (!hasTauri()) return Promise.resolve();
  _queuedNativeAppTheme = normalizeAppTheme(theme);
  if (_nativeAppThemeRaf || _nativeAppThemeInFlight) return Promise.resolve();
  _nativeAppThemeRaf = requestAnimationFrame(() => {
    _nativeAppThemeRaf = null;
    flushQueuedNativeAppTheme();
  });
  return Promise.resolve();
}

function repaintBoardForThemeChange() {
  if (typeof invalidateOffscreen === 'function') {
    invalidateOffscreen();
  }

  const boardIsOpening = typeof _boardOpening !== 'undefined' && _boardOpening;
  if (!boardIsOpening && typeof drawBoard === 'function') {
    if (typeof withRenderSource === 'function') {
      withRenderSource('theme-change-sync', drawBoard);
    } else {
      drawBoard();
    }
    return 'sync-board';
  }

  if (typeof scheduleRender === 'function') {
    scheduleRender(true, false, 'theme-change');
    return 'scheduled-board';
  }

  return 'deferred-unavailable';
}

async function waitForNativeThemeSettle({ frames = 0, ms = 0, theme = appTheme } = {}) {
  if (frames <= 0 && ms <= 0) return;
  const start = performance.now();
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  for (let frame = 0; frame < frames; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  logStartupStep('native-theme-settle', {
    theme,
    frames,
    ms,
    actualMs: Math.round((performance.now() - start) * 100) / 100,
  });
}

function applyAppTheme(theme, {
  dirty = false,
  native = true,
  render = true,
  nativeFirst = false,
  nativeParallel = false,
  nativeParallelDomMs = 0,
  nativeSettleFrames = 0,
  nativeSettleMs = 0,
} = {}) {
  const nextTheme = normalizeAppTheme(theme);
  const applyDomTheme = () => {
    const changed = appTheme !== nextTheme;
    appTheme = nextTheme;
    document.body.dataset.theme = appTheme;
    logStartupStep('body-theme-applied', StartupDebug.sample('body-theme-applied'));
    if (render && (changed || dirty)) {
      logStartupStep('theme-canvas-repaint', { theme: appTheme, mode: repaintBoardForThemeChange() });
    }
    if (dirty) {
      storeAppTheme();
    }
  };

  if (native && nativeParallel) {
    const nativePromise = applyNativeAppTheme(nextTheme);
    return waitForNativeThemeSettle({
      ms: nativeParallelDomMs,
      theme: nextTheme,
    })
      .then(applyDomTheme)
      .then(() => nativePromise);
  }

  if (native && nativeFirst) {
    return applyNativeAppTheme(nextTheme)
      .then(() => waitForNativeThemeSettle({
        frames: nativeSettleFrames,
        ms: nativeSettleMs,
        theme: nextTheme,
      }))
      .then(applyDomTheme);
  }

  applyDomTheme();
  return native ? applyNativeAppTheme(nextTheme) : Promise.resolve();
}

function toggleAppTheme() {
  return applyAppTheme(appTheme === 'dark' ? 'light' : 'dark', {
    dirty: true,
    native: true,
    nativeParallel: true,
  });
}

const startupTheme = loadStoredAppTheme();
logStartupStep('theme-bootstrap', { theme: startupTheme, hasTauri: hasTauri() });
applyAppTheme(startupTheme, { render: false }).finally(showAppWindow);

function round2(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
}

function sanitizeDebugMeta(value, { redactPattern = /dataUrl|src|base64/i, roundNumbers = false } = {}) {
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (redactPattern && redactPattern.test(key) && typeof item === 'string') {
      out[`${key}Len`] = item.length;
      const comma = item.indexOf(',');
      out.mime = comma > 0 ? item.slice(0, comma) : item.slice(0, 48);
    } else {
      out[key] = roundNumbers ? round2(item) : item;
    }
  }
  return out;
}

function createDebugRecorder({
  maxEvents = 300,
  label = 'Boardfish',
  sanitize = (value) => value,
  verboseDefault = false,
  onEnable = null,
  onDisable = null,
} = {}) {
  let enabled = false;
  let verbose = verboseDefault;
  let nextOpId = 1;
  const events = [];
  const round = (value) => Math.round((value || 0) * 100) / 100;

  function push(evt) {
    if (!enabled) return;
    const entry = { at: round(performance.now()), ...evt };
    events.push(entry);
    if (events.length > maxEvents) events.shift();
    if (verbose) console.debug(label, entry);
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    if (options.verbose === true) setVerbose(true);
    if (onEnable) onEnable(options);
  }

  function disable() {
    enabled = false;
    if (onDisable) onDisable();
  }

  function setVerbose(value) {
    verbose = !!value;
    console.info(`${label} verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }

  function start(op, meta = {}) {
    if (!enabled) return null;
    const ctx = { id: nextOpId++, op, t0: performance.now(), last: performance.now() };
    push({ id: ctx.id, op, step: 'start', total: 0, dt: 0, meta: sanitize(meta) });
    return ctx;
  }

  function step(ctx, stepName, meta = {}) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    if (!ctx.steps) ctx.steps = {};
    ctx.steps[stepName] = { ms: now - ctx.last, total: now - ctx.t0, meta: sanitize(meta) };
    push({ id: ctx.id, op: ctx.op, step: stepName, total: round(now - ctx.t0), dt: round(now - ctx.last), meta: sanitize(meta) });
    ctx.last = now;
  }

  function end(ctx, meta = {}) {
    step(ctx, 'end', meta);
  }

  function reset() {
    events.length = 0;
    nextOpId = 1;
  }

  return {
    enable,
    disable,
    setVerbose,
    start,
    step,
    end,
    reset,
    push,
    get enabled() { return enabled; },
    get events() { return events.slice(); },
    _events: events,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

function normalizeRotation(value) {
  return ((Number(value) || 0) % 360 + 360) % 360;
}

function imageTransformFromData(data = {}) {
  return {
    flipX: !!data.flipX,
    flipY: !!data.flipY,
    rotation: normalizeRotation(data.rotation),
  };
}

function imageTransformFromObject(obj) {
  return imageTransformFromData(obj?.data || {});
}

function imageTransformNeedsRendering(transform) {
  return !!(transform?.flipX || transform?.flipY || transform?.rotation);
}

function isSidewaysRotation(rotation) {
  const normalized = normalizeRotation(rotation);
  return normalized === 90 || normalized === 270;
}

function createRafCommitter(apply) {
  let raf = null;
  let pending = false;
  let state = null;

  function flush() {
    if (!pending) return;
    const nextState = state;
    pending = false;
    state = null;
    apply(nextState);
  }

  return {
    schedule(nextState) {
      state = nextState;
      pending = true;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        flush();
      });
    },
    flush() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      flush();
    },
    cancel() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      pending = false;
      state = null;
    },
    get pending() { return pending; },
  };
}

function beginDocumentDrag({ move, up, moveEvent = 'mousemove', upEvent = 'mouseup' }) {
  let active = true;
  const cleanup = (event = null) => {
    if (!active) return;
    active = false;
    document.removeEventListener(moveEvent, onMove);
    document.removeEventListener(upEvent, onUp);
    if (up) up(event);
  };
  const onMove = (event) => {
    if (move) move(event);
  };
  const onUp = (event) => cleanup(event);
  document.addEventListener(moveEvent, onMove);
  document.addEventListener(upEvent, onUp);
  return cleanup;
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function boardBg() {
  return cssVar('--canvas-bg') || '#d6d8da';
}

function canvasTextColor() {
  return cssVar('--canvas-text') || '#111418';
}

function islandTextColor() {
  return cssVar('--firefox-menu-text') || '#f7f7fb';
}

function islandStatusTextColor() {
  return cssVar('--firefox-menu-text') || '#f7f7fb';
}

function fillBoardBackground(context, width, height) {
  context.fillStyle = boardBg();
  context.fillRect(0, 0, width, height);
}
