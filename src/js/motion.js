'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const jelloObjectMotions = new Map();
  const textSelectionJelloMotions = new Map();
  // Keep the sampled transform until the renderer samples this object again;
  // async motion cleanup must not move DOM outlines ahead of canvas pixels.
  const lastDrawnObjectMotions = new Map();
  let motionRenderPending = false;
  let motionRenderRequestedAt = 0;
  const jelloDefaults = Object.freeze({
    amplitude: 0.062,
    duration: 520,
    oscillations: 6.5,
    rebound: 0.22,
    squish: 0.68,
    staggerMs: 18,
  });
  const copyJiggleDefaults = Object.freeze({
    duration: 500,
    translateXPx: 5.0,
    translateYPx: 10.75,
    yFreqHz: 3.55,
    xFreqHz: 4.65,
    yDamping: 0.24,
    xDamping: 0.34,
    yLagMs: 16,
    attackMs: 44,
    settleStart: 0.84,
    sagGain: 0.08,
    sagDecay: 3.2,
    lateralCoupling: 0.16,
    deformation: 0.028,
    deformationLagMs: 28,
    deformationFreqHz: 3.15,
    deformationDamping: 0.32,
    scaleOriginX: 0.5,
    scaleOriginY: 0.12,
    carryDurationMs: 180,
    normalizePath: true,
  });
  const JIGGLE_RETRIGGER_MIN_INTERVAL_MS = 48;
  const smoothSlideDefaults = Object.freeze({
    duration: 220,
    ease: 'cubic-bezier(0.18, 0.9, 0.24, 1.18)',
  });
  const COPY_JIGGLE_ACTIONS = new Set([
    'copy-selected-objects',
    'copy-text-object',
    'copy-text-selection',
  ]);
  let jelloParams = null;
  let smoothSlideParams = null;
  const copyJiggleNormalizerCache = new Map();
  let reducedMotionQueryReady = false;
  let reducedMotionQuery = null;

  const reducedMotionMediaQuery = () => {
    if (reducedMotionQueryReady) return reducedMotionQuery;
    reducedMotionQueryReady = true;
    try {
      reducedMotionQuery = root.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    } catch (_) {
      reducedMotionQuery = null;
    }
    return reducedMotionQuery;
  };

  const prefersReducedMotion = () => !!reducedMotionMediaQuery()?.matches;

  const now = () => (
    root.performance?.now ? root.performance.now() : Date.now()
  );

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const smootherstep = (value) => {
    const t = clamp01(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const numberInRange = (value, fallback, min, max) => {
    if (value == null || value === '') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  };
  const normalizeJelloParams = (options = {}, base = jelloDefaults) => ({
    amplitude: numberInRange(options.amplitude, base.amplitude, 0, 0.24),
    duration: numberInRange(options.duration, base.duration, 180, 1200),
    oscillations: numberInRange(options.oscillations, base.oscillations, 1, 16),
    rebound: numberInRange(options.rebound, base.rebound, 0, 0.8),
    squish: numberInRange(options.squish, base.squish, 0, 1.4),
    staggerMs: numberInRange(options.staggerMs, base.staggerMs, 0, 240),
  });
  const normalizeSmoothSlideParams = (options = {}, base = smoothSlideDefaults) => ({
    duration: numberInRange(options.duration, base.duration, 80, 900),
    ease: typeof options.ease === 'string' && options.ease.trim() ? options.ease.trim() : base.ease,
  });
  const normalizeCopyJiggleParams = (options = {}, base = copyJiggleDefaults) => ({
    yFreqHz: numberInRange(options.yFreqHz, base.yFreqHz, 0.1, 12),
    xFreqHz: numberInRange(options.xFreqHz, base.xFreqHz, 0.1, 12),
    yDamping: numberInRange(options.yDamping, base.yDamping, 0.001, 0.999),
    xDamping: numberInRange(options.xDamping, base.xDamping, 0.001, 0.999),
    yLagMs: numberInRange(options.yLagMs, base.yLagMs, 0, 160),
    attackMs: numberInRange(options.attackMs, base.attackMs, 0, 240),
    settleStart: numberInRange(options.settleStart, base.settleStart, 0, 0.99),
    sagGain: numberInRange(options.sagGain, base.sagGain, -1, 1),
    sagDecay: numberInRange(options.sagDecay, base.sagDecay, 0, 12),
    lateralCoupling: numberInRange(options.lateralCoupling, base.lateralCoupling, -1, 1),
    deformation: numberInRange(options.deformation, base.deformation, 0, 0.12),
    deformationLagMs: numberInRange(options.deformationLagMs, base.deformationLagMs, 0, 180),
    deformationFreqHz: numberInRange(options.deformationFreqHz, base.deformationFreqHz, 0.1, 12),
    deformationDamping: numberInRange(options.deformationDamping, base.deformationDamping, 0.001, 0.999),
    scaleOriginX: numberInRange(options.scaleOriginX, base.scaleOriginX, 0, 1),
    scaleOriginY: numberInRange(options.scaleOriginY, base.scaleOriginY, 0, 1),
    carryDurationMs: numberInRange(options.carryDurationMs, base.carryDurationMs, 80, 320),
    normalizePath: options.normalizePath == null ? base.normalizePath : options.normalizePath !== false,
  });
  const copyJiggleParamKey = (p) => [
    p.duration,
    p.yFreqHz,
    p.xFreqHz,
    p.yDamping,
    p.xDamping,
    p.yLagMs,
    p.attackMs,
    p.settleStart,
    p.sagGain,
    p.sagDecay,
    p.lateralCoupling,
    p.deformation,
    p.deformationLagMs,
    p.deformationFreqHz,
    p.deformationDamping,
    p.normalizePath ? 1 : 0,
  ].join('|');
  const dampedSpringImpulse = (timeSec, freqHz, dampingRatio) => {
    const zeta = numberInRange(dampingRatio, 0.5, 0.001, 0.999);
    const omega0 = 2 * Math.PI * freqHz;
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    return Math.exp(-zeta * omega0 * timeSec) * Math.sin(omegaD * timeSec);
  };
  const copyJiggleUnit = (t, p) => {
    const durationSec = p.duration / 1000;
    const timeSec = t * durationSec;
    const attackSec = Math.max(0.001, p.attackMs / 1000);
    const xAttack = smootherstep(timeSec / attackSec);
    const settle = 1 - smootherstep((t - p.settleStart) / Math.max(0.001, 1 - p.settleStart));
    const yTimeSec = timeSec - p.yLagMs / 1000;
    const yAttack = yTimeSec > 0 ? smootherstep(yTimeSec / attackSec) : 0;
    const xBase = dampedSpringImpulse(timeSec, p.xFreqHz, p.xDamping);
    const yBase = yTimeSec > 0 ? dampedSpringImpulse(yTimeSec, p.yFreqHz, p.yDamping) : 0;
    const coupledX = (
      (yTimeSec > 0 ? dampedSpringImpulse(yTimeSec, p.yFreqHz * 1.32, p.yDamping + 0.08) : 0)
      * p.lateralCoupling
    );
    const sagRise = Math.max(p.sagDecay + 6, p.sagDecay * 3.5);
    const sag = yTimeSec > 0
      ? (Math.exp(-p.sagDecay * yTimeSec) - Math.exp(-sagRise * yTimeSec)) * p.sagGain
      : 0;
    return {
      x: (xBase * xAttack + coupledX * yAttack) * settle,
      y: (yBase + sag) * yAttack * settle,
    };
  };

  const copyJiggleShapeUnit = (t, p) => {
    if (!p.deformation) return 0;
    const durationSec = p.duration / 1000;
    const timeSec = t * durationSec;
    const shapeTimeSec = timeSec - (p.yLagMs + p.deformationLagMs) / 1000;
    if (shapeTimeSec <= 0) return 0;
    const attack = smootherstep(shapeTimeSec / Math.max(0.001, p.attackMs / 1000));
    const settle = 1 - smootherstep((t - p.settleStart) / Math.max(0.001, 1 - p.settleStart));
    return dampedSpringImpulse(
      shapeTimeSec,
      p.deformationFreqHz,
      p.deformationDamping,
    ) * attack * settle;
  };
  const getCopyJiggleNormalizer = (p) => {
    if (!p.normalizePath) return { x: 1, y: 1, shape: 1 };
    const key = copyJiggleParamKey(p);
    const cached = copyJiggleNormalizerCache.get(key);
    if (cached) return cached;
    let maxX = 0.0001;
    let maxY = 0.0001;
    let maxShape = 0.0001;
    const samples = 192;
    for (let i = 0; i <= samples; i += 1) {
      const point = copyJiggleUnit(i / samples, p);
      maxX = Math.max(maxX, Math.abs(point.x));
      maxY = Math.max(maxY, Math.abs(point.y));
      maxShape = Math.max(maxShape, Math.abs(copyJiggleShapeUnit(i / samples, p)));
    }
    const normalizer = Object.freeze({
      x: 1 / maxX,
      y: 1 / maxY,
      shape: 1 / maxShape,
    });
    if (copyJiggleNormalizerCache.size > 32) copyJiggleNormalizerCache.clear();
    copyJiggleNormalizerCache.set(key, normalizer);
    return normalizer;
  };
  const applySmoothSlideCssVars = () => {
    const style = root.document?.documentElement?.style;
    if (!style) return;
    style.setProperty('--smooth-slide-duration', `${smoothSlideParams.duration}ms`);
    style.setProperty('--smooth-slide-ease', smoothSlideParams.ease);
  };
  jelloParams = normalizeJelloParams(root.BoardfishJelloParams || {});
  smoothSlideParams = normalizeSmoothSlideParams(root.BoardfishSmoothSlideParams || {});
  applySmoothSlideCssVars();

  const motionEndElapsed = (motion) => Math.max(
    motion.delay + motion.duration,
    Number(motion.handoff?.duration) || 0,
  );

  const pruneFinishedObjectMotions = () => {
    const cutoff = now();
    let removed = 0;
    for (const motions of [jelloObjectMotions, textSelectionJelloMotions]) {
      for (const [id, motion] of motions) {
        const endElapsed = motionEndElapsed(motion);
        if (cutoff - motion.startedAt >= endElapsed + 80) {
          motions.delete(id);
          removed++;
        }
      }
    }
    return removed;
  };

  const hasObjectMotions = () => (
    jelloObjectMotions.size || textSelectionJelloMotions.size
  );

  const motionDebugMeta = () => ({
    jelloObjectMotions: jelloObjectMotions.size,
    textSelectionJelloMotions: textSelectionJelloMotions.size,
    hasObjectMotions: !!hasObjectMotions(),
  });

  const recordMotionDebug = (stepName, meta = {}) => {
    root.ViewportDebug?.recordMotion?.(stepName, {
      ...motionDebugMeta(),
      ...meta,
    });
  };

  const requestMotionFrame = () => {
    if (motionRenderPending || prefersReducedMotion()) return;
    if (typeof root.scheduleRender !== 'function') return;
    const requestedAt = now();
    motionRenderPending = true;
    motionRenderRequestedAt = requestedAt;
    recordMotionDebug('raf-scheduled', { requestedAt, source: 'motion' });
    root.scheduleRender?.(true, true, 'motion');
    recordMotionDebug('render-scheduled', { source: 'motion' });
  };

  const afterViewportRenderFrame = (meta = {}) => {
    if (prefersReducedMotion()) return;
    if (!motionRenderPending && !hasObjectMotions()) return;
    const requestedAt = motionRenderRequestedAt;
    const firedAt = now();
    const wasPending = motionRenderPending;
    motionRenderPending = false;
    motionRenderRequestedAt = 0;
    const removed = pruneFinishedObjectMotions();
    if (wasPending) {
      recordMotionDebug('raf-fired', {
        requestedAt,
        firedAt,
        waitMs: requestedAt ? firedAt - requestedAt : '',
        removed,
        source: meta.source || meta.sources || 'motion',
      });
    }
    if (!hasObjectMotions()) {
      if (removed) root.scheduleRender?.(true, true, 'motion-finished');
      if (wasPending || removed) recordMotionDebug('finished', { removed });
      return;
    }
    requestMotionFrame();
  };

  const copyJiggleMotionFields = (options = {}, baseMotion = {}) => {
    const translateXPx = numberInRange(options.translateXPx, 0, 0, 48);
    const translateYPx = numberInRange(options.translateYPx, 0, 0, 48);
    if (!translateXPx && !translateYPx) {
      return { translateXPx, translateYPx };
    }
    const params = normalizeCopyJiggleParams(options);
    return {
      ...params,
      translateXPx,
      translateYPx,
      copyJiggleNormalizer: getCopyJiggleNormalizer({
        ...baseMotion,
        ...params,
        translateXPx,
        translateYPx,
      }),
    };
  };

  const transformNumber = (transform, key, fallback) => (
    Number.isFinite(transform?.[key]) ? transform[key] : fallback
  );

  const motionHandoff = (motion, cutoff, durationMs) => {
    if (!motion) return null;
    const elapsed = cutoff - motion.startedAt;
    if (elapsed < 0 || elapsed >= motionEndElapsed(motion)) return null;
    return {
      duration: numberInRange(durationMs, copyJiggleDefaults.carryDurationMs, 80, 320),
      motion,
    };
  };

  const noteObjectJello = (obj, options = {}) => {
    if (!obj?.id || (options.includeText === false && obj.type === 'text') || prefersReducedMotion()) return;
    const amplitude = numberInRange(options.amplitude, jelloParams.amplitude, 0, 0.24);
    if (amplitude <= 0) return;
    const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : now();
    const existing = jelloObjectMotions.get(obj.id);
    if (
      existing &&
      existing.phase === (options.phase === 'exit' ? 'exit' : 'pulse') &&
      startedAt - existing.startedAt >= 0 &&
      startedAt - existing.startedAt < JIGGLE_RETRIGGER_MIN_INTERVAL_MS
    ) {
      recordMotionDebug('jiggle-coalesced', {
        id: obj.id,
        objectType: obj.type || '',
        action: options.action || '',
      });
      requestMotionFrame();
      return;
    }
    const handoff = motionHandoff(
      existing,
      startedAt,
      options.carryDurationMs,
    );
    const baseMotion = {
      obj: options.phase === 'exit' ? obj : null,
      phase: options.phase === 'exit' ? 'exit' : 'pulse',
      startedAt,
      delay: Math.max(0, Number(options.delay) || 0),
      duration: numberInRange(options.duration, jelloParams.duration, 180, 1200),
      amplitude,
      oscillations: numberInRange(options.oscillations, jelloParams.oscillations, 1, 16),
      rebound: numberInRange(options.rebound, jelloParams.rebound, 0, 0.8),
      squish: numberInRange(options.squish, jelloParams.squish, 0, 1.4),
      decayPower: numberInRange(options.decayPower, 2.15, 0.8, 4),
      groupSide: numberInRange(options.groupSide, 1, -1, 1),
      groupSize: Math.max(1, Number(options.groupSize) || 1),
    };
    const motion = {
      ...baseMotion,
      ...copyJiggleMotionFields(options, baseMotion),
      ...(handoff ? { handoff } : {}),
    };
    jelloObjectMotions.set(obj.id, motion);
    recordMotionDebug(motion.translateXPx || motion.translateYPx ? 'jiggle-start' : 'jello-start', {
      id: obj.id,
      objectType: obj.type || '',
      action: options.action || '',
      phase: motion.phase,
      delay: motion.delay,
      duration: motion.duration,
      amplitude: motion.amplitude,
      translateXPx: motion.translateXPx || 0,
      translateYPx: motion.translateYPx || 0,
      xFreqHz: motion.xFreqHz || '',
      yFreqHz: motion.yFreqHz || '',
    });
    requestMotionFrame();
  };

  const noteObjectsJello = (items, options = {}) => {
    const list = Array.isArray(items) ? items : [];
    const stagger = numberInRange(options.staggerMs, jelloParams.staggerMs, 0, 240);
    const hasTranslation = !!(
      numberInRange(options.translateXPx, 0, 0, 48) ||
      numberInRange(options.translateYPx, 0, 0, 48)
    );
    const startedAt = now();
    const ranked = list.filter((obj) => (
      obj?.id && !(options.includeText === false && obj.type === 'text')
    )).sort((a, b) => {
      const ax = (Number(a?.x) || 0) + (Number(a?.w) || 0) / 2;
      const bx = (Number(b?.x) || 0) + (Number(b?.w) || 0) / 2;
      if (ax !== bx) return ax - bx;
      const ay = (Number(a?.y) || 0) + (Number(a?.h) || 0) / 2;
      const by = (Number(b?.y) || 0) + (Number(b?.h) || 0) / 2;
      if (ay !== by) return ay - by;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    ranked.forEach((obj, index) => {
      const groupSide = ranked.length > 1 ? -1 + (index * 2) / (ranked.length - 1) : 1;
      noteObjectJello(obj, {
        ...options,
        startedAt,
        groupSide,
        groupSize: ranked.length,
        delay: hasTranslation ? 0 : Math.min(index * stagger, 160),
      });
    });
  };

  const noteObjectsJelloRemoved = (items, options = {}) => {
    const list = Array.isArray(items) ? items : [];
    const stagger = numberInRange(options.staggerMs, jelloParams.staggerMs, 0, 240);
    list.forEach((obj, index) => noteObjectJello(obj, {
      ...options,
      phase: 'exit',
      delay: Math.min(index * stagger, 160),
    }));
  };

  const noteTextSelectionJello = (spec = {}, options = {}) => {
    if (!spec?.id || !spec.hasSelection || prefersReducedMotion()) return;
    const amplitude = numberInRange(options.amplitude, jelloParams.amplitude, 0, 0.24);
    if (amplitude <= 0) return;
    const startedAt = now();
    const existing = textSelectionJelloMotions.get(spec.id);
    if (
      existing &&
      startedAt - existing.startedAt >= 0 &&
      startedAt - existing.startedAt < JIGGLE_RETRIGGER_MIN_INTERVAL_MS
    ) {
      recordMotionDebug('jiggle-coalesced', {
        id: spec.id,
        objectType: 'text-selection',
        action: options.action || '',
      });
      requestMotionFrame();
      return;
    }
    const handoff = existing && existing.start === Math.min(spec.start, spec.end) && existing.end === Math.max(spec.start, spec.end)
      ? motionHandoff(existing, startedAt, options.carryDurationMs)
      : null;
    const baseMotion = {
      startedAt,
      delay: Math.max(0, Number(options.delay) || 0),
      duration: numberInRange(options.duration, jelloParams.duration, 180, 1200),
      amplitude,
      oscillations: numberInRange(options.oscillations, jelloParams.oscillations, 1, 16),
      rebound: numberInRange(options.rebound, jelloParams.rebound, 0, 0.8),
      squish: numberInRange(options.squish, jelloParams.squish, 0, 1.4),
      decayPower: numberInRange(options.decayPower, 2.15, 0.8, 4),
      start: Math.min(spec.start, spec.end),
      end: Math.max(spec.start, spec.end),
    };
    const motion = {
      ...baseMotion,
      ...copyJiggleMotionFields(options, baseMotion),
      ...(handoff ? { handoff } : {}),
    };
    textSelectionJelloMotions.set(spec.id, motion);
    recordMotionDebug(motion.translateXPx || motion.translateYPx ? 'jiggle-start' : 'jello-start', {
      id: spec.id,
      objectType: 'text-selection',
      action: options.action || '',
      delay: motion.delay,
      duration: motion.duration,
      amplitude: motion.amplitude,
      translateXPx: motion.translateXPx || 0,
      translateYPx: motion.translateYPx || 0,
      start: motion.start,
      end: motion.end,
    });
    requestMotionFrame();
  };

  const motionProgress = (motion, cutoff) => {
    const elapsed = cutoff - motion.startedAt - motion.delay;
    const totalElapsed = cutoff - motion.startedAt;
    if (elapsed < 0) return { waiting: true, done: false, t: 0, elapsed: totalElapsed };
    const raw = elapsed / motion.duration;
    const endElapsed = motionEndElapsed(motion);
    return {
      waiting: false,
      done: totalElapsed >= endElapsed,
      t: clamp01(raw),
      elapsed: totalElapsed,
    };
  };

  const screenPxToWorldValue = (value, options = {}) => {
    const viewZoom = Number(options?.view?.zoom);
    const safeZoom = Number.isFinite(viewZoom) && viewZoom > 0 ? viewZoom : 1;
    return value / safeZoom;
  };

  const jelloScaleForMotion = (motion, t) => {
    const decay = Math.pow(1 - t, numberInRange(motion.decayPower, 2.15, 0.8, 4));
    const wobble = Math.sin(t * Math.PI * motion.oscillations) * motion.amplitude * decay;
    const rebound = Math.sin(t * Math.PI * motion.oscillations * 2) * motion.amplitude * motion.rebound * decay;
    return {
      scaleX: 1 + wobble + rebound,
      scaleY: 1 - wobble * motion.squish,
    };
  };

  const jelloTranslateForMotion = (motion, t, options = {}) => {
    const point = copyJiggleUnit(t, motion);
    const normalizer = motion.copyJiggleNormalizer || getCopyJiggleNormalizer(motion);
    const groupSize = Math.max(1, Number(motion.groupSize) || 1);
    const groupSide = groupSize > 1 ? numberInRange(motion.groupSide, 0, -1, 1) : 1;
    const xPx = point.x * normalizer.x * motion.translateXPx;
    const yPx = point.y * normalizer.y * motion.translateYPx;
    const result = {
      groupTranslateX: screenPxToWorldValue(groupSize > 1 ? 0 : xPx, options),
      groupTranslateY: screenPxToWorldValue(yPx, options),
    };
    if (motion.translateXPx) {
      result.translateX = screenPxToWorldValue(xPx * groupSide, options);
    }
    if (motion.translateYPx) {
      result.translateY = screenPxToWorldValue(yPx, options);
    }
    if (motion.deformation) {
      const shape = copyJiggleShapeUnit(t, motion) * normalizer.shape;
      const shapeAsymmetry = groupSize > 1 ? 1 + groupSide * 0.06 : 1;
      const strain = shape * motion.deformation * shapeAsymmetry;
      result.scaleX = Math.exp(-strain);
      result.scaleY = Math.exp(strain);
      result.scaleOriginX = motion.scaleOriginX;
      result.scaleOriginY = motion.scaleOriginY;
    }
    return result;
  };

  const blendMotionTransforms = (previous, next, weight) => {
    const t = clamp01(weight);
    const blend = (a, b) => a + (b - a) * t;
    const result = {};
    for (const key of ['translateX', 'translateY', 'groupTranslateX', 'groupTranslateY']) {
      if (!Number.isFinite(previous?.[key]) && !Number.isFinite(next?.[key])) continue;
      result[key] = blend(transformNumber(previous, key, 0), transformNumber(next, key, 0));
    }
    const hasScale = (
      Number.isFinite(previous?.scaleX) ||
      Number.isFinite(previous?.scaleY) ||
      Number.isFinite(next?.scaleX) ||
      Number.isFinite(next?.scaleY)
    );
    if (hasScale) {
      const previousScaleX = Math.max(0.01, transformNumber(previous, 'scaleX', 1));
      const previousScaleY = Math.max(0.01, transformNumber(previous, 'scaleY', 1));
      const nextScaleX = Math.max(0.01, transformNumber(next, 'scaleX', 1));
      const nextScaleY = Math.max(0.01, transformNumber(next, 'scaleY', 1));
      result.scaleX = Math.exp(blend(Math.log(previousScaleX), Math.log(nextScaleX)));
      result.scaleY = Math.exp(blend(Math.log(previousScaleY), Math.log(nextScaleY)));
      result.scaleOriginX = blend(
        transformNumber(previous, 'scaleOriginX', 0.5),
        transformNumber(next, 'scaleOriginX', 0.5),
      );
      result.scaleOriginY = blend(
        transformNumber(previous, 'scaleOriginY', 0.5),
        transformNumber(next, 'scaleOriginY', 0.5),
      );
    }
    return result;
  };

  const motionTransformAtElapsed = (motion, elapsedMs, options = {}) => {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const localElapsed = elapsed - motion.delay;
    const t = localElapsed <= 0 ? 0 : clamp01(localElapsed / motion.duration);
    return jelloTransformForMotion(motion, t, options, elapsed);
  };

  const applyMotionHandoff = (transform, motion, elapsedMs, options = {}) => {
    const handoff = motion.handoff;
    if (!handoff || elapsedMs >= handoff.duration) return transform;
    const cutoff = motion.startedAt + elapsedMs;
    const previousElapsed = cutoff - handoff.motion.startedAt;
    const previous = motionTransformAtElapsed(handoff.motion, previousElapsed, options);
    const weight = smootherstep(elapsedMs / Math.max(1, handoff.duration));
    return blendMotionTransforms(previous, transform, weight);
  };

  const jelloTransformForMotion = (motion, t, options = {}, elapsedMs = t * motion.duration) => {
    const transform = motion.translateXPx || motion.translateYPx
      ? jelloTranslateForMotion(motion, t, options)
      : jelloScaleForMotion(motion, t);
    return applyMotionHandoff(transform, motion, Math.max(0, elapsedMs), options);
  };

  const restingJelloTransformForMotion = (motion, options = {}, elapsedMs = 0) => {
    if (motion.translateXPx || motion.translateYPx) {
      return applyMotionHandoff({
        translateX: 0,
        translateY: 0,
        groupTranslateX: 0,
        groupTranslateY: 0,
        ...(motion.deformation ? {
          scaleX: 1,
          scaleY: 1,
          scaleOriginX: motion.scaleOriginX,
          scaleOriginY: motion.scaleOriginY,
        } : {}),
      }, motion, Math.max(0, elapsedMs), options);
    }
    return applyMotionHandoff({
      scaleX: 1,
      scaleY: 1,
    }, motion, Math.max(0, elapsedMs), options);
  };

  const textSelectionMotionForDraw = (id, start, end, options = {}) => {
    const motion = textSelectionJelloMotions.get(id);
    if (!motion || prefersReducedMotion()) return null;
    if (motion.start !== Math.min(start, end) || motion.end !== Math.max(start, end)) {
      textSelectionJelloMotions.delete(id);
      recordMotionDebug('jiggle-cancelled', {
        id,
        objectType: 'text-selection',
        reason: 'selection-range-changed',
      });
      return null;
    }
    const progress = motionProgress(motion, now());
    if (progress.done) {
      textSelectionJelloMotions.delete(id);
      recordMotionDebug('jiggle-done', {
        id,
        objectType: 'text-selection',
        t: 1,
      });
      return null;
    }
    if (progress.waiting) {
      const transform = restingJelloTransformForMotion(motion, options, progress.elapsed);
      recordMotionDebug('jiggle-waiting', {
        id,
        objectType: 'text-selection',
        t: 0,
        ...transform,
      });
      return { opacity: 1, ...transform };
    }
    const transform = jelloTransformForMotion(motion, progress.t, options, progress.elapsed);
    recordMotionDebug(motion.translateXPx || motion.translateYPx ? 'jiggle-progress' : 'jello-progress', {
      id,
      objectType: 'text-selection',
      t: progress.t,
      ...transform,
    });
    return {
      opacity: 1,
      ...transform,
    };
  };

  const textSelectionJelloSpecsForDraw = () => {
    if (prefersReducedMotion()) return [];
    const cutoff = now();
    const specs = [];
    for (const [id, motion] of textSelectionJelloMotions) {
      const progress = motionProgress(motion, cutoff);
      if (progress.done) {
        textSelectionJelloMotions.delete(id);
        continue;
      }
      specs.push({ id, start: motion.start, end: motion.end });
    }
    return specs;
  };

  const jelloMotionForDraw = (obj, options = {}) => {
    const jello = jelloObjectMotions.get(obj?.id);
    if (!jello || prefersReducedMotion()) return null;
    const cutoff = now();
    const progress = motionProgress(jello, cutoff);
    if (progress.done) {
      jelloObjectMotions.delete(obj.id);
      recordMotionDebug(jello.translateXPx || jello.translateYPx ? 'jiggle-done' : 'jello-done', {
        id: obj.id,
        objectType: obj.type || '',
        phase: jello.phase,
        t: 1,
      });
      return jello.phase === 'exit' ? { opacity: 0, scale: 1, skip: true } : null;
    }
    if (progress.waiting) {
      const transform = restingJelloTransformForMotion(jello, options, progress.elapsed);
      recordMotionDebug(jello.translateXPx || jello.translateYPx ? 'jiggle-waiting' : 'jello-waiting', {
        id: obj.id,
        objectType: obj.type || '',
        phase: jello.phase,
        t: 0,
        ...transform,
      });
      return { opacity: 1, ...transform };
    }
    const t = progress.t;
    const exitOpacity = jello.phase === 'exit' ? clamp01(1 - t) : 1;
    const transform = jelloTransformForMotion(jello, t, options, progress.elapsed);
    recordMotionDebug(jello.translateXPx || jello.translateYPx ? 'jiggle-progress' : 'jello-progress', {
      id: obj.id,
      objectType: obj.type || '',
      phase: jello.phase,
      t,
      opacity: exitOpacity,
      ...transform,
    });
    return {
      opacity: exitOpacity,
      ...transform,
    };
  };

  const objectMotionForDraw = (obj, options = {}) => {
    if (!obj?.id) return null;
    const motion = hasObjectMotions() ? jelloMotionForDraw(obj, options) : null;
    if (motion) lastDrawnObjectMotions.set(obj.id, motion);
    else lastDrawnObjectMotions.delete(obj.id);
    return motion;
  };

  const getLastDrawnObjectMotion = (obj) => (
    obj?.id ? lastDrawnObjectMotions.get(obj.id) || null : null
  );

  const motionObjectsForDraw = () => {
    if (prefersReducedMotion() || !hasObjectMotions()) return [];
    const objects = [];
    for (const motion of jelloObjectMotions.values()) {
      if (motion.phase === 'exit' && motion.obj) objects.push(motion.obj);
    }
    return objects;
  };

  const pulseSelection = (options = {}) => {
    const selectedIds = root.selectedIds;
    const objectsMap = root.objectsMap;
    if (!selectedIds?.size || !objectsMap?.get) return;
    const selectedObjects = [];
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (obj) selectedObjects.push(obj);
    }
    noteObjectsJello(selectedObjects, options);
  };

  const asObjectList = (items) => {
    if (!items) return [];
    if (!Array.isArray(items)) return items ? [items] : [];
    const out = [];
    for (const item of items) {
      if (item) out.push(item);
    }
    return out;
  };

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

  const jiggleActionControlOptions = (options = {}) => {
    const controls = {};
    if (hasOwn(options, 'includeText')) controls.includeText = options.includeText;
    if (hasOwn(options, 'textMotion')) controls.textMotion = options.textMotion;
    controls.duration = numberInRange(options.duration, copyJiggleDefaults.duration, 180, 1200);
    controls.translateXPx = numberInRange(options.translateXPx, copyJiggleDefaults.translateXPx, 0, 48);
    controls.translateYPx = numberInRange(options.translateYPx, copyJiggleDefaults.translateYPx, 0, 48);
    Object.assign(controls, normalizeCopyJiggleParams(options));
    return controls;
  };

  const actionOptionsForSet = (options = {}) => ({
    ...jelloParams,
    ...jiggleActionControlOptions(options),
  });

  const applyActionAnimation = (action, payload = {}, options = {}) => {
    if (!COPY_JIGGLE_ACTIONS.has(action)) {
      if (typeof payload?.after === 'function') payload.after();
      return false;
    }

    const motionOptions = {
      ...actionOptionsForSet({
        ...(payload?.options || {}),
        ...(options || {}),
      }),
      action,
    };
    const hasExplicitObjects = hasOwn(payload, 'objects') || hasOwn(payload, 'addedObjects');
    const hasExplicitRemovedObjects = hasOwn(payload, 'removedObjects');
    const objects = hasExplicitObjects
      ? asObjectList(hasOwn(payload, 'objects') ? payload.objects : payload.addedObjects)
      : [];
    const removedObjects = hasExplicitRemovedObjects ? asObjectList(payload.removedObjects) : [];

    if (payload?.textSelection) {
      noteTextSelectionJello(payload.textSelection, motionOptions);
      return true;
    }
    if (payload?.selection) {
      pulseSelection(motionOptions);
      return true;
    }
    let applied = false;
    if (objects.length) {
      noteObjectsJello(objects, motionOptions);
      applied = true;
    }
    if (removedObjects.length) {
      noteObjectsJelloRemoved(removedObjects, motionOptions);
      applied = true;
    }
    return applied;
  };

  const api = Object.freeze({
    afterViewportRenderFrame,
    applyActionAnimation,
    getLastDrawnObjectMotion,
    motionObjectsForDraw,
    objectMotionForDraw,
    textSelectionJelloSpecsForDraw,
    textSelectionMotionForDraw,
  });

  root.BoardfishMotion = api;
})();
