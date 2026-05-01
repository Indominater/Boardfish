// ─── Viewport ─────────────────────────────────────────────────────────────────
var panX = 0, panY = 0, zoom = 1;
var _vpSaveTimer = null;
function saveViewport() {
  clearTimeout(_vpSaveTimer);
  _vpSaveTimer = setTimeout(() => {
    localStorage.setItem('bf_vp', JSON.stringify({ panX, panY, zoom }));
  }, 400);
}


// ─── Pill debugger ───────────────────────────────────────────────────────────
var PillDebug = (() => {
  const MAX_EVENTS = 1000;
  let enabled = false;
  let verbose = true;
  const events = [];
  const t0 = performance.now();
  let longTaskObserver = null;

  function round(value) {
    return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  }

  function snapshot() {
    const style = getComputedStyle(islZoom);
    return {
      text: islZoom.textContent,
      styleWidth: islZoom.style.width,
      offsetWidth: islZoom.offsetWidth,
      computedWidth: style.width,
      color: style.color,
      opacity: style.opacity,
      transition: style.transition,
      msgActive: _islMsgActive,
      boardOpening: _boardOpening,
      zoomPct: Math.round(zoom * 100) + '%',
    };
  }

  function push(event, data = {}) {
    if (!enabled) return null;
    const entry = {
      t: round(performance.now() - t0),
      event,
      ...snapshot(),
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, round(v)])),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[pill]', entry);
    return entry;
  }

  function log(event, data = {}) {
    return push(event, data);
  }

  function enable() {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    events.length = 0;
    startLongTaskObserver();
    console.info('Boardfish pill debugger enabled. Use BoardfishDebug.pill.summary(), .timeline(), .diagnose(), .dump(), or .reset().');
  }
  function disable() {
    enabled = false;
    if (longTaskObserver) {
      longTaskObserver.disconnect();
      longTaskObserver = null;
    }
  }
  function setVerbose(value) {
    verbose = !!value;
    console.info(`Boardfish pill verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }
  function reset() { events.length = 0; }
  function dump() {
    console.table(events);
    return events.slice();
  }
  function summary() {
    const rows = events.map(e => ({
      t: e.t,
      event: e.event,
      text: e.text,
      styleWidth: e.styleWidth,
      offsetWidth: e.offsetWidth,
      msgActive: e.msgActive,
      boardOpening: e.boardOpening,
      duration: e.duration ?? '',
      elapsed: e.elapsed ?? '',
      reason: e.reason ?? '',
      longTaskMs: e.longTaskMs ?? '',
      phaseMs: e.phaseMs ?? '',
    }));
    console.table(rows);
    return rows;
  }
  function timeline() {
    const rows = [];
    for (let i = 0; i < events.length; i++) {
      const prev = events[i - 1];
      const e = events[i];
      rows.push({
        dt: prev ? round(e.t - prev.t) : 0,
        t: e.t,
        event: e.event,
        text: e.text,
        width: e.offsetWidth,
        styleWidth: e.styleWidth,
        color: e.color,
        propertyName: e.propertyName ?? '',
        elapsedTime: e.elapsedTime ?? '',
        reason: e.reason ?? '',
        sampleMs: e.sampleMs ?? '',
        sampleWidth: e.sampleWidth ?? '',
        targetWidth: e.targetWidth ?? '',
        longTaskMs: e.longTaskMs ?? '',
      });
    }
    console.table(rows);
    return rows;
  }

  function widthSamples() {
    const rows = events
      .filter(e => e.event === 'pill-sample')
      .map(e => ({
        label: e.label,
        sampleMs: e.sampleMs,
        sampleWidth: e.sampleWidth,
        startWidth: e.startWidth,
        targetWidth: e.targetWidth,
        textAlpha: e.textAlpha,
        text: e.text,
        color: e.color,
      }));
    console.table(rows);
    return rows;
  }

  function animationSamples() {
    const rows = events
      .filter(e => (
        e.event === 'pill-sample' ||
        e.event === 'pill-frame-ready' ||
        e.event === 'pill-frame-wait-timeout' ||
        e.event === 'transitionstart' ||
        e.event === 'transitionend' ||
        e.event === 'transitioncancel'
      ))
      .map(e => ({
        t: e.t,
        event: e.event,
        label: e.label ?? '',
        propertyName: e.propertyName ?? '',
        sampleMs: e.sampleMs ?? '',
        frameGapMs: e.frameGapMs ?? '',
        stableFrames: e.stableFrames ?? '',
        width: e.sampleWidth ?? e.offsetWidth,
        startWidth: e.startWidth ?? '',
        targetWidth: e.targetWidth ?? '',
        textAlpha: e.textAlpha ?? '',
        text: e.text,
        color: e.color,
      }));
    console.table(rows);
    return rows;
  }

  function samplePillAnimation(label, durationMs = 1100) {
    if (!enabled) return;
    const start = performance.now();
    const startWidth = islZoom.getBoundingClientRect().width;
    const targetWidth = parseFloat(islZoom.style.width) || parseFloat(getComputedStyle(islZoom).width) || startWidth;
    const tick = () => {
      if (!enabled) return;
      const now = performance.now();
      const sampleMs = now - start;
      push('pill-sample', {
        label,
        sampleMs,
        sampleWidth: islZoom.getBoundingClientRect().width,
        startWidth,
        targetWidth,
        textAlpha: islandTextAlpha(),
      });
      if (sampleMs < durationMs) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function largestSampleGap(label = null) {
    const samples = events.filter(e => e.event === 'pill-sample' && (!label || e.label === label));
    let largest = 0;
    for (let i = 1; i < samples.length; i++) {
      largest = Math.max(largest, Number(samples[i].sampleMs) - Number(samples[i - 1].sampleMs));
    }
    return round(largest);
  }

  function diagnose() {
    const longTasks = events.filter(e => e.event === 'longtask');
    const bigLongTasks = longTasks.filter(e => Number(e.longTaskMs) >= 100);
    const restoreStart = events.find(e => e.event === 'restoreIslandZoom:start');
    const restoreWidth = events.find(e => e.event === 'restoreIslandZoom:text-set');
    const restoreShown = events.find(e => e.event === 'restoreIslandZoom:shown');
    const forcedTransparent = events.find(e => e.event === 'forceIslandTextTransparent');
    const openingRender = events.find(e => e.event === 'open:initial-applyTransform:end');
    const findings = [];
    const textAlpha = (entry) => {
      const match = String(entry?.color || '').match(/rgba?\(([^)]+)\)/);
      if (!match) return 1;
      const parts = match[1].split(',').map((part) => part.trim());
      return parts.length >= 4 ? Number(parts[3]) || 0 : 1;
    };
    const widthSwapVisible = textAlpha(restoreWidth) > 0.05;

    if (bigLongTasks.length) {
      findings.push(`${bigLongTasks.length} long main-thread task(s) over 100ms occurred while the pill was animating or opening.`);
    }
    const restoreGap = largestSampleGap('restoreIslandZoom');
    if (restoreGap >= 80) {
      findings.push(`Restore animation missed frames; largest sample gap was ${restoreGap}ms.`);
    }
    if (openingRender && Number(openingRender.phaseMs) >= 100) {
      findings.push(`Initial board render took ${openingRender.phaseMs}ms before the pill restored to zoom.`);
    }
    if (restoreStart && restoreWidth && restoreWidth.t - restoreStart.t > 650 && widthSwapVisible) {
      findings.push(`Restore width/text update was delayed by ${round(restoreWidth.t - restoreStart.t)}ms after restore started.`);
    }
    if (restoreWidth && restoreShown && restoreShown.t - restoreWidth.t < 32 && widthSwapVisible) {
      findings.push('Width/text and visible color were applied too close together for a visible transition.');
    }
    if (forcedTransparent && restoreWidth && !widthSwapVisible) {
      findings.push('Fallback transparency path was used; width/text swap was hidden.');
    }
    if (!findings.length) findings.push('No obvious pill animation stall found in the current buffer.');

    const report = {
      findings,
      eventCount: events.length,
      longTaskCount: longTasks.length,
      maxLongTaskMs: longTasks.reduce((n, e) => Math.max(n, Number(e.longTaskMs) || 0), 0),
      restoreLargestSampleGapMs: restoreGap,
    };
    console.table(report.findings.map(finding => ({ finding })));
    return report;
  }

  function startLongTaskObserver() {
    if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          push('longtask', {
            longTaskMs: entry.duration,
            startTime: entry.startTime,
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (_) {
      longTaskObserver = null;
    }
  }

  return { enable, disable, setVerbose, reset, dump, summary, timeline, widthSamples, animationSamples, diagnose, log, samplePillAnimation, largestSampleGap, get enabled() { return enabled; } };
})();
exposeDebug({ pill: PillDebug });

// ─── Context menu debugger ───────────────────────────────────────────────────
var MenuDebug = (() => {
  const MAX_EVENTS = 500;
  let enabled = false;
  let verbose = false;
  let nextId = 1;
  const events = [];

  function round(value) {
    return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  }

  function elementLabel(el) {
    if (!el) return '';
    if (el === window) return 'window';
    if (el === document) return 'document';
    if (el === document.body) return 'body';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().replace(/\s+/g, '.')
      : '';
    return `${el.tagName?.toLowerCase() || String(el)}${id}${cls}`;
  }

  function menuState() {
    const active = document.activeElement;
    const point = lastPointerEvent
      ? document.elementFromPoint(lastPointerEvent.clientX, lastPointerEvent.clientY)
      : null;
    return {
      ctxVisible: ctxMenu.classList.contains('visible'),
      objVisible: objCtxMenu.classList.contains('visible'),
      ctxDisplay: getComputedStyle(ctxMenu).display,
      objDisplay: getComputedStyle(objCtxMenu).display,
      shieldActive: openingShield.classList.contains('active'),
      inputShieldCount: _inputShieldCount,
      boardOpening: _boardOpening,
      active: elementLabel(active),
      elementAtPointer: elementLabel(point),
    };
  }

  let lastPointerEvent = null;

  function push(event, data = {}) {
    if (!enabled) return null;
    const entry = {
      id: nextId++,
      t: round(performance.now()),
      event,
      ...menuState(),
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, round(v)])),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (verbose) console.debug('[Boardfish menu]', entry);
    return entry;
  }

  function enable(options = {}) {
    if (!DEBUG_TOOLS_ENABLED) return;
    enabled = true;
    verbose = !!options.verbose;
    events.length = 0;
    nextId = 1;
    console.info('Boardfish menu debugger enabled. Use BoardfishDebug.menu.summary(), .events(), .last(), .setVerbose(true), or .reset().');
  }

  function disable() { enabled = false; }
  function setVerbose(value) {
    verbose = !!value;
    console.info(`Boardfish menu verbose logging ${verbose ? 'enabled' : 'disabled'}.`);
  }
  function reset() { events.length = 0; nextId = 1; }
  function eventsCopy() { console.table(events); return events.slice(); }
  function last(limit = 30) {
    const rows = events.slice(-limit);
    console.table(rows);
    return rows;
  }
  function summary() {
    const rows = events.map(e => ({
      id: e.id,
      event: e.event,
      type: e.type ?? '',
      phase: e.phase ?? '',
      target: e.target ?? '',
      currentTarget: e.currentTarget ?? '',
      button: e.button ?? '',
      x: e.x ?? '',
      y: e.y ?? '',
      command: e.command ?? '',
      ctxVisible: e.ctxVisible,
      objVisible: e.objVisible,
      shieldActive: e.shieldActive,
      defaultPrevented: e.defaultPrevented ?? '',
      propagationStopped: e.propagationStopped ?? '',
      elementAtPointer: e.elementAtPointer,
    }));
    console.table(rows);
    return rows;
  }

  function log(event, data = {}) { return push(event, data); }

  function logDomEvent(label, event) {
    lastPointerEvent = event;
    push(label, {
      type: event.type,
      phase: event.eventPhase,
      target: elementLabel(event.target),
      currentTarget: elementLabel(event.currentTarget),
      button: event.button,
      x: event.clientX,
      y: event.clientY,
      defaultPrevented: event.defaultPrevented,
    });
  }

  return {
    enable,
    disable,
    setVerbose,
    reset,
    events: eventsCopy,
    last,
    summary,
    log,
    logDomEvent,
    get enabled() { return enabled; },
  };
})();
exposeDebug({ menu: MenuDebug });
try {
  if (DEBUG_TOOLS_ENABLED && localStorage.getItem('bf_debug_menu') === '1') {
    MenuDebug.enable({ verbose: localStorage.getItem('bf_debug_menu_verbose') === '1' });
  }
} catch (_) {}

function islSetWidth(text) {
  PillDebug.log('islSetWidth:before', { text });
  const measuredWidth = measureIslandTextWidth(text);
  islZoom.style.width = measuredWidth + 'px';
  PillDebug.log('islSetWidth:after', { text, measuredWidth });
}

function measureIslandTextWidth(text) {
  islMeasure.textContent = text;
  return islMeasure.offsetWidth;
}
var _lastZoomPct = -1;
var _islMsgActive = false;
var _imageCopyInFlight = 0;
var _lastZoomDisplayAt = 0;
var _zoomDisplayTimer = null;

function applyIslandInteractionState() {
  const disabled = _islMsgActive || _imageCopyInFlight > 0;
  islZoom.style.pointerEvents = disabled ? 'none' : '';
  islZoom.style.cursor = disabled ? 'default' : '';
}

function beginImageCopyInteractionLock() {
  _imageCopyInFlight += 1;
  applyIslandInteractionState();
}

function endImageCopyInteractionLock() {
  _imageCopyInFlight = Math.max(0, _imageCopyInFlight - 1);
  applyIslandInteractionState();
}

function updateZoomDisplay(force = false) {
  if (_islMsgActive) return;
  const pct = Math.round(zoom * 100);
  if (pct === _lastZoomPct) return;
  const now = performance.now();
  if (!force && now - _lastZoomDisplayAt < 80) {
    clearTimeout(_zoomDisplayTimer);
    _zoomDisplayTimer = setTimeout(() => updateZoomDisplay(true), 90);
    return;
  }
  _lastZoomDisplayAt = now;
  _lastZoomPct = pct;
  const text = pct + '%';
  PillDebug.log('updateZoomDisplay:set', { force, text });
  islZoom.textContent = text;
  islSetWidth(text);
}
var _islMsgTimer = null;
var _islFadeTimer = null;
var _islAnimToken = 0;

function islandTextAlpha() {
  const color = getComputedStyle(islZoom).color;
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(',').map((part) => part.trim());
  return parts.length >= 4 ? Number(parts[3]) || 0 : 1;
}

function waitForIslandTransition(propertyName, timeoutMs = 700) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      islZoom.removeEventListener('transitionend', onEnd);
      islZoom.removeEventListener('transitioncancel', onCancel);
      resolve(reason);
    };
    const onEnd = (event) => {
      if (event.target === islZoom && event.propertyName === propertyName) finish('transitionend');
    };
    const onCancel = (event) => {
      if (event.target === islZoom && event.propertyName === propertyName) finish('transitioncancel');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    islZoom.addEventListener('transitionend', onEnd);
    islZoom.addEventListener('transitioncancel', onCancel);
  });
}

function forceIslandTextTransparent() {
  const transition = islZoom.style.transition;
  islZoom.style.transition = 'none';
  islZoom.style.color = TRANSPARENT_TEXT_COLOR;
  void islZoom.offsetWidth;
  islZoom.style.transition = transition;
  PillDebug.log('forceIslandTextTransparent');
}

function waitForIslandFrames(count = 1, token = _islAnimToken) {
  return new Promise((resolve) => {
    const step = (remaining) => {
      requestAnimationFrame(() => {
        if (token !== _islAnimToken) { resolve('stale'); return; }
        if (remaining <= 1) { resolve('frames'); return; }
        step(remaining - 1);
      });
    };
    step(Math.max(1, count));
  });
}

async function fadeIslandTextTo(color, { token = _islAnimToken, timeoutMs = 700, skipTransparent = false } = {}) {
  if (token !== _islAnimToken) return 'stale';
  const alreadyTransparent = skipTransparent && color === TRANSPARENT_TEXT_COLOR && islandTextAlpha() <= 0.05;
  const done = alreadyTransparent
    ? Promise.resolve('already-transparent')
    : waitForIslandTransition('color', timeoutMs);
  islZoom.style.color = color;
  const reason = await done;
  if (token !== _islAnimToken) return 'stale';
  return reason;
}

function startIslandBusyMsg(text) {
  const token = ++_islAnimToken;
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  _islMsgActive = true;
  applyIslandInteractionState();
  islZoom.style.color = islandStatusTextColor();
  islSetWidth(text);
  islZoom.textContent = text;
  PillDebug.samplePillAnimation('busyIslandMsg');

  return {
    update(nextText) {
      if (token !== _islAnimToken) return;
      islSetWidth(nextText);
      islZoom.textContent = nextText;
    },
    done(finalMsg = null, duration = 1500, onRestore = null) {
      if (token !== _islAnimToken) return;
      if (finalMsg) showIslandMsg(finalMsg, duration, onRestore);
      else restoreIslandZoom();
    },
  };
}

function waitForPillFrameReady({ stableFramesNeeded = 4, maxFrameGapMs = 34, minWaitMs = 120, timeoutMs = 1800 } = {}) {
  const start = performance.now();
  let lastFrame = start;
  let stableFrames = 0;
  return new Promise((resolve) => {
    const tick = (now) => {
      const elapsed = now - start;
      const frameGapMs = now - lastFrame;
      lastFrame = now;
      if (frameGapMs <= maxFrameGapMs) stableFrames += 1;
      else stableFrames = 0;
      if (elapsed >= minWaitMs && stableFrames >= stableFramesNeeded) {
        PillDebug.log('pill-frame-ready', { elapsed, frameGapMs, stableFrames });
        resolve('stable');
        return;
      }
      if (elapsed >= timeoutMs) {
        PillDebug.log('pill-frame-wait-timeout', { elapsed, frameGapMs, stableFrames });
        resolve('timeout');
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function showIslandMsg(msg, duration = 0, onRestore = null) {
  const token = ++_islAnimToken;
  PillDebug.log('showIslandMsg:start', { msg, duration });
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  _islMsgActive = true;
  applyIslandInteractionState();
  islSetWidth(msg);
  PillDebug.samplePillAnimation('showIslandMsg');
  const timerStart = performance.now();
  PillDebug.log('showIslandMsg:fadeOut', { msg, computedColor: getComputedStyle(islZoom).color, transition: getComputedStyle(islZoom).transition });
  const fadeOutReason = await fadeIslandTextTo(TRANSPARENT_TEXT_COLOR, { token, skipTransparent: true });
  if (token !== _islAnimToken) return 'stale';
  PillDebug.log('showIslandMsg:fadeOutComplete', { msg, reason: fadeOutReason, elapsed: performance.now() - timerStart });
  PillDebug.log('showIslandMsg:fadeIn', { msg, computedColorBefore: getComputedStyle(islZoom).color });
  islZoom.textContent = msg;
  const fadeInReason = await fadeIslandTextTo(islandStatusTextColor(), { token });
  PillDebug.log('showIslandMsg:fadeInSet', { computedColorAfter: getComputedStyle(islZoom).color });
  if (token !== _islAnimToken) return 'stale';
  PillDebug.log('showIslandMsg:resolved', { msg, reason: fadeInReason, elapsed: performance.now() - timerStart });
  if (duration > 0) {
    _islMsgTimer = setTimeout(async () => {
      if (token !== _islAnimToken) return;
      const zoomRestoreReason = await restoreIslandZoom();
      if (onRestore) onRestore();
      PillDebug.log('showIslandMsg:onRestore', { msg, zoomRestoreReason });
    }, duration);
  }
  return fadeInReason;
}

async function restoreIslandZoom() {
  const token = ++_islAnimToken;
  PillDebug.log('restoreIslandZoom:start');
  clearTimeout(_islMsgTimer);
  clearTimeout(_islFadeTimer);
  const pct = Math.round(zoom * 100) + '%';
  const frameReadyReason = await waitForPillFrameReady();
  if (token !== _islAnimToken) return;
  PillDebug.log('restoreIslandZoom:frame-ready', { reason: frameReadyReason });
  const currentWidth = islZoom.getBoundingClientRect().width;
  const targetWidth = measureIslandTextWidth(pct);
  const widthDone = Math.abs(currentWidth - targetWidth) < 0.5
    ? Promise.resolve('same-width')
    : waitForIslandTransition('width', 700);
  islSetWidth(pct);
  PillDebug.samplePillAnimation('restoreIslandZoom', 1800);
  PillDebug.log('restoreIslandZoom:width-set', { pct });
  PillDebug.log('restoreIslandZoom:fadeOut');
  const [widthReason, fadeOutReason] = await Promise.all([
    widthDone,
    fadeIslandTextTo(TRANSPARENT_TEXT_COLOR, { token, skipTransparent: true }),
  ]);
  if (token !== _islAnimToken) return;
  PillDebug.log('restoreIslandZoom:widthComplete', { reason: widthReason });
  PillDebug.log('restoreIslandZoom:fadeOutComplete', { reason: fadeOutReason });
  if (islandTextAlpha() > 0.05) {
    forceIslandTextTransparent();
    if (token !== _islAnimToken) return;
  }
  _islMsgActive = false;
  _lastZoomPct = -1;
  islZoom.textContent = pct;
  PillDebug.log('restoreIslandZoom:text-set', { pct });
  const frameReason = await waitForIslandFrames(2, token);
  if (token !== _islAnimToken) return 'stale';
  PillDebug.log('restoreIslandZoom:frames-ready', { pct, reason: frameReason });
  const colorReason = await fadeIslandTextTo(islandTextColor(), { token });
  applyIslandInteractionState();
  PillDebug.log('restoreIslandZoom:shown', { pct, colorReason });
  return colorReason;
}

islZoom.addEventListener('transitionstart', (event) => {
  PillDebug.log('transitionstart', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
islZoom.addEventListener('transitionend', (event) => {
  PillDebug.log('transitionend', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
islZoom.addEventListener('transitioncancel', (event) => {
  PillDebug.log('transitioncancel', { propertyName: event.propertyName, elapsedTime: event.elapsedTime });
});
// ─── Offscreen buffer ─────────────────────────────────────────────────────────
var _offscreen = document.createElement('canvas');
var _offCtx    = _offscreen.getContext('2d');
var _offscreenDirty = true;
var _offscreenRebuilding = false;
var _offscreenVersion = 0;
function invalidateOffscreen() {
  _offscreenDirty = true;
  _offscreenVersion++;
}

async function _rebuildOffscreenAsync() {
  if (_offscreenRebuilding) return;
  _offscreenRebuilding = true;
  const snapshotEditingId = editingId;
  const rebuildVersion = _offscreenVersion;
  const dbg = ViewportDebug.start('offscreenRebuild', { objectCount: objects.length, editingId: snapshotEditingId, version: rebuildVersion });

  // Ensure all images have GPU-resident ImageBitmap before drawing
  const bitmapPromises = [];
  for (const obj of objects) {
    if (obj.id === snapshotEditingId || obj.type !== 'image') continue;
    const key = obj.data?.imgKey;
    if (!key || imageBitmapCache[key]) continue;
    const img = imageCache[key];
    if (!img || !img.complete) continue;
    bitmapPromises.push(
      img.decode()
        .then(() => createImageBitmap(img))
        .then(bm => { imageBitmapCache[key] = bm; })
        .catch(() => { imageBitmapFailed.add(key); ViewportDebug.count('imageBitmapFailures'); })
    );
  }
  const bitmapStart = performance.now();
  await Promise.all(bitmapPromises);
  ViewportDebug.step(dbg, 'ensure-bitmaps', { count: bitmapPromises.length, ms: performance.now() - bitmapStart });

  // Bail if edit mode or viewport content changed while we were awaiting.
  if (!editingId || editingId !== snapshotEditingId || rebuildVersion !== _offscreenVersion) {
    _offscreenRebuilding = false;
    ViewportDebug.end(dbg, { stale: true, currentVersion: _offscreenVersion });
    if (editingId && _offscreenDirty) scheduleRender(true, false, 'offscreen-stale');
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  _offscreen.width  = boardCanvas.width;
  _offscreen.height = boardCanvas.height;
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);
  fillBoardBackground(_offCtx, _offscreen.width, _offscreen.height);
  _offCtx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
  setCanvasImageQuality(_offCtx);
  _offCtx.font = FONT;
  _offCtx.textBaseline = 'alphabetic';
  const viewportRect = currentViewportWorldRect();
  for (const obj of objects) {
    if (obj.id === editingId) continue;
    if (viewportCullingEnabled && !objectIntersectsRect(obj, viewportRect)) continue;
    drawSingleObj(_offCtx, obj);
  }
  _offCtx.setTransform(1, 0, 0, 1, 0, 0);

  _offscreenRebuilding = false;
  if (rebuildVersion === _offscreenVersion) _offscreenDirty = false;
  // Re-render to display the fresh offscreen (caret/selection on top)
  scheduleRender(true, false, 'offscreen-ready');
  ViewportDebug.end(dbg, { stale: false });
}

// ─── History delta tracking ───────────────────────────────────────────────────
var _dirtyIds = new Set();
function markDirty(id) {
  const wasDirty = isDirty();
  _dirtyIds.add(id);
  if (!wasDirty) updateTitle();
}

// ─── Canvas resize ────────────────────────────────────────────────────────────

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(window.innerWidth * dpr);
  const height = Math.round(window.innerHeight * dpr);
  if (boardCanvas.width === width && boardCanvas.height === height) return;
  boardCanvas.width = width;
  boardCanvas.height = height;
  invalidateOffscreen();
  scheduleRender(true, false);
}

function drawImageObj(context, obj, img) {
  const flipX = !!obj.data.flipX;
  const flipY = !!obj.data.flipY;
  const rotation = ((obj.data.rotation || 0) % 360 + 360) % 360;
  if (flipX || flipY || rotation) {
    const sideways = rotation === 90 || rotation === 270;
    const drawW = sideways ? obj.h : obj.w;
    const drawH = sideways ? obj.w : obj.h;
    context.save();
    context.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    if (rotation) context.rotate((rotation * Math.PI) / 180);
    context.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    context.restore();
    return;
  }

  context.drawImage(img, obj.x, obj.y, obj.w, obj.h);
}

function isDrawableImageSource(source) {
  if (!source) return false;
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return true;
  return !!(source.complete && source.naturalWidth > 0);
}
var VIEWPORT_CULL_PADDING_PX = 256;

function currentViewportWorldRect(padScreenPx = VIEWPORT_CULL_PADDING_PX) {
  return viewportWorldRect(padScreenPx);
}

function countCulledObject(obj, counters = null) {
  if (!counters) return;
  if (obj.type === 'image') counters.culledImages = (counters.culledImages || 0) + 1;
  else if (obj.type === 'text') counters.culledText = (counters.culledText || 0) + 1;
}

// Draws a single non-editing object onto any canvas context (world coords).
function drawSingleObj(context, obj, counters = null) {
  if (obj.type === 'text') {
    context.fillStyle = canvasTextColor();
    context.textBaseline = 'alphabetic';
    const lines = getWrappedLines(obj);
    for (let i = 0; i < lines.length; i++) {
      context.fillText(lines[i].text, obj.x + TEXT_PAD, obj.y + TEXT_PAD + TEXT_BASELINE_Y_OFFSET + i * LINE_H);
    }
    return true;
  } else if (obj.type === 'image') {
    const key = obj.data.imgKey;
    const bitmap = imageBitmapCache[key];
    const fullImg = bitmap || imageCache[key] || null;
    const selected = fullImg ? selectImageSourceForDraw(key, obj, fullImg) : null;
    const img = selected?.source || null;
    if (isDrawableImageSource(img)) {
      if (counters) {
        if (selected?.scale < 1) {
          counters.scaledImages = (counters.scaledImages || 0) + 1;
          counters.scaledImageScaleTotal = (counters.scaledImageScaleTotal || 0) + selected.scale;
          counters.scaledImageTargetScaleTotal = (counters.scaledImageTargetScaleTotal || 0) + selected.targetScale;
        } else if (selected?.targetScale < 1) {
          counters.scaledFallbackFull = (counters.scaledFallbackFull || 0) + 1;
        }
        if (bitmap || selected?.scale < 1) counters.bitmapImages++;
        else {
          counters.elementImages++;
          counters.fallbackImages++;
        }
      }
      try {
        drawImageObj(context, obj, img);
        return true;
      } catch (err) {
        if (counters) {
          counters.erroredImages++;
          counters.lastDrawError = String(err);
          counters.lastDrawErrorKey = key;
          counters.lastDrawErrorId = obj.id;
        }
        return false;
      }
    }
    if (counters) {
      counters.missingImages++;
      counters.lastMissingKey = key;
      counters.lastMissingId = obj.id;
      counters.lastMissingReason = !key ? 'missing-key'
        : !imageStore[key] ? 'missing-store'
          : !imageCache[key] ? 'missing-image-element'
            : !imageCache[key].complete ? 'not-complete'
              : imageCache[key].naturalWidth <= 0 ? 'zero-natural-width'
                : !bitmap ? 'missing-bitmap'
                  : 'unknown';
    }
    return false;
  }
  return false;
}


function createDrawCounters() {
  return {
    bitmapImages: 0,
    elementImages: 0,
    fallbackImages: 0,
    missingImages: 0,
    erroredImages: 0,
    croppedImages: 0,
    scaledImages: 0,
    scaledFallbackFull: 0,
    scaledImageScaleTotal: 0,
    scaledImageTargetScaleTotal: 0,
    culledImages: 0,
    culledText: 0,
  };
}

function resetCanvasToScreen(context) {
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function setWorldCanvasTransform(context, dpr = window.devicePixelRatio || 1) {
  context.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
  setCanvasImageQuality(context);
  context.font = FONT;
  context.textBaseline = 'alphabetic';
}

function drawVisibleObjects(context, counters, { skipId = null, viewportRect = currentViewportWorldRect() } = {}) {
  let drawnImages = 0;
  let drawnText = 0;
  for (const obj of objects) {
    if (obj.id === skipId) continue;
    if (viewportCullingEnabled && !objectIntersectsRect(obj, viewportRect)) {
      countCulledObject(obj, counters);
      continue;
    }
    const drawn = drawSingleObj(context, obj, counters);
    if (obj.type === 'image' && drawn) drawnImages++;
    else if (obj.type === 'text') drawnText++;
  }
  return { drawnImages, drawnText };
}

function drawTextSelectionHighlight(context, obj, layout, selStart, selEnd) {
  if (selStart === selEnd) return;
  context.fillStyle = 'rgba(10, 132, 255, 0.3)';
  for (const line of layout) {
    const ls = line.startIndex, textEnd = ls + line.text.length;
    const h0 = Math.max(selStart, ls), h1 = Math.min(selEnd, textEnd);
    if (h0 < h1) {
      const o0 = h0 - ls, o1 = h1 - ls;
      const endX = lineEndX(line, obj);
      const x1 = o0 < line.text.length ? lineXAtOffset(line, obj, o0) : endX;
      const x2 = o1 < line.text.length ? lineXAtOffset(line, obj, o1) : endX;
      TextSelDebug._logDraw(line, selStart, selEnd, x1, x2);
      context.fillRect(x1, line.y, x2 - x1, LINE_H);
    }
  }
}

function drawCaret(context, obj, layout, selStart) {
  if (!_caretVisible) return;
  let cx = obj.x + TEXT_PAD, cy = obj.y + TEXT_PAD;
  for (const line of layout) {
    const ls = line.startIndex, le = line.endIndex ?? (ls + line.text.length);
    if (selStart >= ls && selStart <= le) {
      const off = selStart - ls;
      cx = off < line.text.length ? lineXAtOffset(line, obj, off) : lineEndX(line, obj);
      cy = line.y;
      break;
    }
  }
  context.fillStyle = canvasTextColor();
  context.fillRect(cx, cy, 2 / zoom, LINE_H);
}

function drawEditingTextOverlay(context) {
  const obj = objectsMap.get(editingId);
  if (!obj || obj.type !== 'text') return;
  context.font = FONT;
  context.textBaseline = 'alphabetic';

  const selStart = _editEl ? _editEl.selectionStart : 0;
  const selEnd   = _editEl ? _editEl.selectionEnd   : 0;
  const layout = getTextLayout(obj);

  drawTextSelectionHighlight(context, obj, layout, selStart, selEnd);

  context.fillStyle = canvasTextColor();
  for (const line of layout) context.fillText(line.text, obj.x + TEXT_PAD, line.textY);

  if (selStart === selEnd) drawCaret(context, obj, layout, selStart);
}

function drawBoard() {
  const dbg = ViewportDebug.start('drawBoard', { source: _activeRenderSource, objectCount: objects.length, editing: !!editingId, offscreenDirty: _offscreenDirty });
  if (_boardOpening) {
    ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  const counters = createDrawCounters();
  const dpr = window.devicePixelRatio || 1;
  const viewportRect = currentViewportWorldRect();
  let drawnImages = 0;
  let drawnText = 0;

  if (editingId) {
    if (_offscreenDirty) {
      // Kick off async rebuild (pre-decodes images to avoid GPU stall).
      // Draw all objects directly this frame while the rebuild is pending.
      _rebuildOffscreenAsync();
      resetCanvasToScreen(ctx);
      fillBoardBackground(ctx, boardCanvas.width, boardCanvas.height);
      setWorldCanvasTransform(ctx, dpr);
      const drawn = drawVisibleObjects(ctx, counters, { skipId: editingId, viewportRect });
      drawnImages += drawn.drawnImages;
      drawnText += drawn.drawnText;
    } else {
      // Blit cached offscreen (background + all non-editing objects)
      resetCanvasToScreen(ctx);
      ctx.drawImage(_offscreen, 0, 0);
    }

    setWorldCanvasTransform(ctx, dpr);
    drawEditingTextOverlay(ctx);
    resetCanvasToScreen(ctx);
  } else {
    resetCanvasToScreen(ctx);
    fillBoardBackground(ctx, boardCanvas.width, boardCanvas.height);
    setWorldCanvasTransform(ctx, dpr);
    const drawn = drawVisibleObjects(ctx, counters, { viewportRect });
    drawnImages = drawn.drawnImages;
    drawnText = drawn.drawnText;
    resetCanvasToScreen(ctx);
  }
  ViewportDebug.count('croppedImages', counters.croppedImages);
  ViewportDebug.count('imageDrawMissing', counters.missingImages);
  ViewportDebug.count('imageDrawFallback', counters.fallbackImages);
  ViewportDebug.count('imageDrawErrors', counters.erroredImages);
  ViewportDebug.end(dbg, { drawnImages, drawnText, ...counters });
}

function hitTest(wx, wy) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (wx >= obj.x && wx <= obj.x + obj.w && wy >= obj.y && wy <= obj.y + obj.h) return obj;
  }
  return null;
}

function applyTransform(frameDbg = null) {
  const dbg = ViewportDebug.start('applyTransform', { editing: !!editingId, panX, panY, zoom, objectCount: objects.length, selectedCount: selectedIds.size });
  if (_boardOpening) {
    ViewportDebug.end(dbg, { skipped: 'board-opening' });
    return;
  }
  if (editingId) invalidateOffscreen();
  const drawStart = performance.now();
  drawBoard();
  const drawMs = performance.now() - drawStart;
  ViewportDebug.step(dbg, 'drawBoard', { ms: drawMs });
  ViewportDebug.step(frameDbg, 'drawBoard', { ms: drawMs });
  const zoomStart = performance.now();
  updateZoomDisplay();
  const zoomMs = performance.now() - zoomStart;
  ViewportDebug.step(dbg, 'updateZoomDisplay', { ms: zoomMs });
  ViewportDebug.step(frameDbg, 'updateZoomDisplay', { ms: zoomMs });
  const saveStart = performance.now();
  saveViewport();
  const saveMs = performance.now() - saveStart;
  ViewportDebug.step(dbg, 'saveViewport', { ms: saveMs });
  ViewportDebug.step(frameDbg, 'saveViewport', { ms: saveMs });
  const overlayStart = performance.now();
  updateSelectionOverlay();
  const overlayMs = performance.now() - overlayStart;
  ViewportDebug.step(dbg, 'updateSelectionOverlay', { ms: overlayMs });
  ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: overlayMs });
  scheduleVisibleHydrationAfterIdle();
  ViewportDebug.end(dbg);
}

function toWorld(sx, sy) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}
var _frameRaf = null;
var _needTransform = false;
var _needBoardRender = false;
var _needOverlayRender = false;
var _frameScheduledAt = 0;
var _frameSources = [];
var _activeRenderSource = 'direct';

function setCanvasImageQuality(context) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
}

function withRenderSource(source, fn) {
  const prev = _activeRenderSource;
  _activeRenderSource = source || prev;
  try {
    return fn();
  } finally {
    _activeRenderSource = prev;
  }
}

function scheduleFrame(source = 'unknown') {
  if (source) _frameSources.push(source);
  if (_frameRaf) {
    ViewportDebug.count('coalescedFrames');
    return;
  }
  _frameScheduledAt = performance.now();
  ViewportDebug.count('scheduledFrames');
  _frameRaf = requestAnimationFrame(() => {
    const sources = [...new Set(_frameSources)];
    _frameSources = [];
    const frameDbg = ViewportDebug.frameStart(performance.now() - _frameScheduledAt);
    ViewportDebug.step(frameDbg, 'sources', { sources: sources.join(',') });
    _frameRaf = null;
    const doTransform = _needTransform;
    const doBoard = _needBoardRender;
    const doOverlay = _needOverlayRender;
    _needTransform = false;
    _needBoardRender = false;
    _needOverlayRender = false;

    if (doTransform) {
      ViewportDebug.count('transformFrames');
      const transformStart = performance.now();
      withRenderSource(sources.join(',') || 'transform', () => applyTransform(frameDbg));
      ViewportDebug.step(frameDbg, 'applyTransformCall', { ms: performance.now() - transformStart });
      ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sources.join(',') });
      return;
    }
    if (doBoard) {
      ViewportDebug.count('boardFrames');
      withRenderSource(sources.join(',') || 'board', () => drawBoard());
    }
    if (doOverlay) {
      const overlayStart = performance.now();
      ViewportDebug.count('overlayFrames');
      updateSelectionOverlay();
      ViewportDebug.step(frameDbg, 'updateSelectionOverlay', { ms: performance.now() - overlayStart });
    }
    ViewportDebug.frameEnd(frameDbg, { doTransform, doBoard, doOverlay, sources: sources.join(',') });
  });
}

function scheduleTransform(source = 'transform') {
  lastViewportInputAt = performance.now();
  _needTransform = true;
  scheduleFrame(source);
}

function scheduleRender(board = true, overlay = true, source = 'render') {
  if (board) _needBoardRender = true;
  if (overlay) _needOverlayRender = true;
  scheduleFrame(source);
}
