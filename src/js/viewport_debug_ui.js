'use strict';

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
    if (!DEBUG_TOOLS_ENABLED) return;
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
    if (!DEBUG_TOOLS_ENABLED) return;
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


