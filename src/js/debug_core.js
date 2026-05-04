'use strict';

(function initDebugCore(root) {
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
      if (!DEBUG_TOOLS_ENABLED) return;
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

  root.BoardfishDebugCore = Object.freeze({
    createDebugRecorder,
    mapWithConcurrency,
    round2,
    sanitizeDebugMeta,
  });
  root.createDebugRecorder = createDebugRecorder;
  root.mapWithConcurrency = mapWithConcurrency;
  root.round2 = round2;
  root.sanitizeDebugMeta = sanitizeDebugMeta;
})(typeof window !== 'undefined' ? window : globalThis);
