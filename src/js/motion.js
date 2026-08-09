'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const objectMotions = new Map();
  const textSelectionMotions = new Map();
  // Keep the sampled transform until the renderer samples this object again;
  // async motion cleanup must not move DOM outlines ahead of canvas pixels.
  const lastDrawnObjectMotions = new Map();
  const EMPTY_SPECS = Object.freeze([]);
  const DURATION_MS = 500;
  const CARRY_DURATION_MS = 180;
  const RETRIGGER_MIN_INTERVAL_MS = 48;
  const NORMALIZE_X = 1.4635663223528887;
  const NORMALIZE_Y = 1.3800858435981482;
  const NORMALIZE_SHAPE = 1.6076214313650838;
  let motionRenderPending = false;
  let reducedMotionQuery;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let motionRenderRequestedAt = 0;
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  const prefersReducedMotion = () => {
    if (reducedMotionQuery === undefined) {
      try {
        reducedMotionQuery = root.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
      } catch (_) {
        reducedMotionQuery = null;
      }
    }
    return !!reducedMotionQuery?.matches;
  };
  const now = () => root.performance?.now ? root.performance.now() : Date.now();
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const smootherstep = (value) => {
    const t = clamp01(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const springImpulse = (timeSec, freqHz, dampingRatio) => {
    const omega0 = 2 * Math.PI * freqHz;
    const omegaD = omega0 * Math.sqrt(1 - dampingRatio * dampingRatio);
    return Math.exp(-dampingRatio * omega0 * timeSec) * Math.sin(omegaD * timeSec);
  };

  const jiggleUnit = (t) => {
    const timeSec = t * (DURATION_MS / 1000);
    const attackSec = Math.max(0.001, 44 / 1000);
    const xAttack = smootherstep(timeSec / attackSec);
    const settle = 1 - smootherstep((t - 0.84) / Math.max(0.001, 1 - 0.84));
    const yTimeSec = timeSec - 16 / 1000;
    const yAttack = yTimeSec > 0 ? smootherstep(yTimeSec / attackSec) : 0;
    const xBase = springImpulse(timeSec, 4.65, 0.34);
    const yBase = yTimeSec > 0 ? springImpulse(yTimeSec, 3.55, 0.24) : 0;
    const coupledX = (
      (yTimeSec > 0 ? springImpulse(yTimeSec, 3.55 * 1.32, 0.24 + 0.08) : 0) * 0.16
    );
    const sagRise = Math.max(3.2 + 6, 3.2 * 3.5);
    const sag = yTimeSec > 0
      ? (Math.exp(-3.2 * yTimeSec) - Math.exp(-sagRise * yTimeSec)) * 0.08
      : 0;
    return {
      x: (xBase * xAttack + coupledX * yAttack) * settle,
      y: (yBase + sag) * yAttack * settle,
    };
  };

  const jiggleShapeUnit = (t) => {
    const timeSec = t * (DURATION_MS / 1000);
    const shapeTimeSec = timeSec - (16 + 28) / 1000;
    if (shapeTimeSec <= 0) return 0;
    const attack = smootherstep(shapeTimeSec / Math.max(0.001, 44 / 1000));
    const settle = 1 - smootherstep((t - 0.84) / Math.max(0.001, 1 - 0.84));
    return springImpulse(shapeTimeSec, 3.15, 0.32) * attack * settle;
  };

  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  let recordMotionDebug = null;
  if (typeof BOARDFISH_PRODUCTION === 'undefined') {
    recordMotionDebug = (stepName, meta = {}) => {
      root.ViewportDebug?.recordMotion?.(stepName, {
        jelloObjectMotions: objectMotions.size,
        textSelectionJelloMotions: textSelectionMotions.size,
        hasObjectMotions: !!(objectMotions.size || textSelectionMotions.size),
        ...meta,
      });
    };
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_END */

  const requestMotionFrame = () => {
    if (motionRenderPending || typeof root.scheduleRender !== 'function') return;
    motionRenderPending = true;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const requestedAt = now();
      motionRenderRequestedAt = requestedAt;
      recordMotionDebug('raf-scheduled', { requestedAt, source: 'motion' });
      root.scheduleRender(true, true, 'motion');
      recordMotionDebug('render-scheduled', { source: 'motion' });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    } else {
      root.scheduleRender(true, true);
    }
  };

  const pruneFinishedMotions = () => {
    const cutoff = now();
    let removed = 0;
    for (const motions of [objectMotions, textSelectionMotions]) {
      for (const [id, motion] of motions) {
        if (cutoff - motion.startedAt >= DURATION_MS + 80) {
          motions.delete(id);
          removed++;
        }
      }
    }
    return removed;
  };

  const afterViewportRenderFrame = (
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    meta = {},
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  ) => {
    if ((!motionRenderPending && !(objectMotions.size || textSelectionMotions.size)) || prefersReducedMotion()) return;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const wasPending = typeof BOARDFISH_PRODUCTION === 'undefined' && motionRenderPending;
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    motionRenderPending = false;
    const removed = root._boardOpening === true ? pruneFinishedMotions() : 0;
    if (typeof BOARDFISH_PRODUCTION === 'undefined' && wasPending) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      const requestedAt = motionRenderRequestedAt;
      const firedAt = now();
      motionRenderRequestedAt = 0;
      recordMotionDebug('raf-fired', {
        requestedAt,
        firedAt,
        waitMs: requestedAt ? firedAt - requestedAt : '',
        removed,
        source: meta.source || meta.sources || 'motion',
      });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    if (!(objectMotions.size || textSelectionMotions.size)) {
      if (removed) requestMotionFrame();
      return;
    }
    requestMotionFrame();
  };

  const jiggleTransform = (motion, t, zoom = 1) => {
    const point = jiggleUnit(t);
    const groupSide = motion.groupSize > 1 ? motion.groupSide : 1;
    const xPx = point.x * NORMALIZE_X * 5;
    const yPx = point.y * NORMALIZE_Y * 10.75;
    const viewZoom = Number(zoom);
    const safeZoom = Number.isFinite(viewZoom) && viewZoom > 0 ? viewZoom : 1;
    const shape = jiggleShapeUnit(t) * NORMALIZE_SHAPE;
    const strain = shape * 0.028 * (motion.groupSize > 1 ? 1 + groupSide * 0.06 : 1);
    return {
      groupTranslateX: (motion.groupSize > 1 ? 0 : xPx) / safeZoom,
      groupTranslateY: yPx / safeZoom,
      translateX: xPx * groupSide / safeZoom,
      translateY: yPx / safeZoom,
      scaleX: Math.exp(-strain),
      scaleY: Math.exp(strain),
      scaleOriginX: 0.5,
      scaleOriginY: 0.12,
    };
  };

  const blendTransforms = (previous, next, weight) => {
    const t = clamp01(weight);
    const blend = (a, b) => a + (b - a) * t;
    return {
      translateX: blend(previous.translateX, next.translateX),
      translateY: blend(previous.translateY, next.translateY),
      groupTranslateX: blend(previous.groupTranslateX, next.groupTranslateX),
      groupTranslateY: blend(previous.groupTranslateY, next.groupTranslateY),
      scaleX: Math.exp(blend(Math.log(previous.scaleX), Math.log(next.scaleX))),
      scaleY: Math.exp(blend(Math.log(previous.scaleY), Math.log(next.scaleY))),
      scaleOriginX: blend(previous.scaleOriginX, next.scaleOriginX),
      scaleOriginY: blend(previous.scaleOriginY, next.scaleOriginY),
    };
  };

  const transformAtElapsed = (motion, elapsedMs, zoom = 1) => {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const transform = jiggleTransform(motion, clamp01(elapsed / DURATION_MS), zoom);
    if (!motion.handoff || elapsed >= CARRY_DURATION_MS) return transform;
    const previousElapsed = motion.startedAt + elapsed - motion.handoff.startedAt;
    const previous = transformAtElapsed(motion.handoff, previousElapsed, zoom);
    return blendTransforms(previous, transform, smootherstep(elapsed / CARRY_DURATION_MS));
  };

  const handoffAt = (motion, cutoff) => {
    if (!motion) return null;
    const elapsed = cutoff - motion.startedAt;
    return elapsed >= 0 && elapsed < DURATION_MS ? motion : null;
  };

  const compareObjectGeometry = (a, b) => {
    const ax = (Number(a?.x) || 0) + (Number(a?.w) || 0) / 2;
    const bx = (Number(b?.x) || 0) + (Number(b?.w) || 0) / 2;
    if (ax !== bx) return ax - bx;
    const ay = (Number(a?.y) || 0) + (Number(a?.h) || 0) / 2;
    const by = (Number(b?.y) || 0) + (Number(b?.h) || 0) / 2;
    if (ay !== by) return ay - by;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  };

  const noteObject = (obj, startedAt, groupSide, groupSize) => {
    if (!obj?.id) return;
    const existing = objectMotions.get(obj.id);
    if (existing && startedAt - existing.startedAt >= 0 && startedAt - existing.startedAt < RETRIGGER_MIN_INTERVAL_MS) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') recordMotionDebug('jiggle-coalesced', { id: obj.id, objectType: obj.type || '' });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return;
    }
    const handoff = handoffAt(existing, startedAt);
    objectMotions.set(obj.id, {
      startedAt,
      groupSide,
      groupSize,
      ...(handoff ? { handoff } : {}),
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') recordMotionDebug('jiggle-start', { id: obj.id, objectType: obj.type || '' });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
  };

  const noteObjects = (items) => {
    const ranked = (Array.isArray(items) ? items : []).filter((obj) => obj?.id).sort(compareObjectGeometry);
    if (!ranked.length) return false;
    const startedAt = now();
    for (let index = 0; index < ranked.length; index++) {
      noteObject(
        ranked[index],
        startedAt,
        ranked.length > 1 ? -1 + (index * 2) / (ranked.length - 1) : 1,
        ranked.length,
      );
    }
    requestMotionFrame();
    return true;
  };

  const noteTextSelection = (spec) => {
    if (!spec?.id || !spec.hasSelection) return;
    const startedAt = now();
    const existing = textSelectionMotions.get(spec.id);
    if (existing && startedAt - existing.startedAt >= 0 && startedAt - existing.startedAt < RETRIGGER_MIN_INTERVAL_MS) {
      /* BOARDFISH_DEV_DIAGNOSTICS_START */
      if (typeof BOARDFISH_PRODUCTION === 'undefined') recordMotionDebug('jiggle-coalesced', { id: spec.id, objectType: 'text-selection' });
      /* BOARDFISH_DEV_DIAGNOSTICS_END */
      requestMotionFrame();
      return;
    }
    const start = Math.min(spec.start, spec.end);
    const end = Math.max(spec.start, spec.end);
    const handoff = existing && existing.start === start && existing.end === end
      ? handoffAt(existing, startedAt)
      : null;
    textSelectionMotions.set(spec.id, {
      startedAt,
      start,
      end,
      groupSide: 1,
      groupSize: 1,
      ...(handoff ? { handoff } : {}),
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') recordMotionDebug('jiggle-start', { id: spec.id, objectType: 'text-selection', start, end });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    requestMotionFrame();
  };

  const textSelectionMotionForDraw = (id, start, end, zoom = 1) => {
    const motion = textSelectionMotions.get(id);
    if (!motion || prefersReducedMotion()) return null;
    if (motion.start !== Math.min(start, end) || motion.end !== Math.max(start, end)) {
      textSelectionMotions.delete(id);
      return null;
    }
    const elapsed = now() - motion.startedAt;
    if (elapsed >= DURATION_MS) {
      textSelectionMotions.delete(id);
      return null;
    }
    const transform = transformAtElapsed(motion, elapsed, zoom);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') recordMotionDebug('jiggle-progress', { id, objectType: 'text-selection', t: clamp01(elapsed / DURATION_MS), ...transform });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return transform;
  };

  const textSelectionJelloSpecsForDraw = () => {
    if (!textSelectionMotions.size || prefersReducedMotion()) return EMPTY_SPECS;
    const cutoff = now();
    const specs = [];
    for (const [id, motion] of textSelectionMotions) {
      if (cutoff - motion.startedAt >= DURATION_MS) {
        textSelectionMotions.delete(id);
      } else {
        specs.push({ id, start: motion.start, end: motion.end });
      }
    }
    return specs.length ? specs : EMPTY_SPECS;
  };

  const objectMotionForDraw = (obj, zoom = 1) => {
    if (!obj?.id || (!objectMotions.size && !lastDrawnObjectMotions.size)) return null;
    const motion = objectMotions.get(obj.id);
    if (!motion || prefersReducedMotion()) {
      lastDrawnObjectMotions.delete(obj.id);
      return null;
    }
    const elapsed = now() - motion.startedAt;
    if (elapsed >= DURATION_MS) {
      objectMotions.delete(obj.id);
      lastDrawnObjectMotions.delete(obj.id);
      return null;
    }
    const transform = transformAtElapsed(motion, elapsed, zoom);
    lastDrawnObjectMotions.set(obj.id, transform);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    if (typeof BOARDFISH_PRODUCTION === 'undefined') recordMotionDebug('jiggle-progress', { id: obj.id, objectType: obj.type || '', t: clamp01(elapsed / DURATION_MS), ...transform });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return transform;
  };

  const getLastDrawnObjectMotion = (obj) => (
    obj?.id ? lastDrawnObjectMotions.get(obj.id) || null : null
  );

  const hasObjectMotionsForDraw = () => {
    if (!objectMotions.size) {
      lastDrawnObjectMotions.clear();
      return false;
    }
    if (prefersReducedMotion()) {
      lastDrawnObjectMotions.clear();
      return false;
    }
    const cutoff = now();
    for (const [id, motion] of objectMotions) {
      if (cutoff - motion.startedAt >= DURATION_MS) {
        objectMotions.delete(id);
        lastDrawnObjectMotions.delete(id);
      }
    }
    return objectMotions.size > 0;
  };

  const copySelection = () => {
    if (!root.selectedIds?.size || !root.objectsMap?.get) return;
    const selectedObjects = [];
    for (const id of root.selectedIds) {
      const obj = root.objectsMap.get(id);
      if (obj) selectedObjects.push(obj);
    }
    noteObjects(selectedObjects);
  };

  const applyCopyFeedback = (payload = {}) => {
    if (prefersReducedMotion()) return false;
    if (payload.textSelection) {
      noteTextSelection(payload.textSelection);
      return true;
    }
    if (payload.selection) {
      copySelection();
      return true;
    }
    return noteObjects(payload.objects);
  };

  root.BoardfishMotion = Object.freeze({
    afterViewportRenderFrame,
    applyCopyFeedback,
    getLastDrawnObjectMotion,
    hasObjectMotionsForDraw,
    objectMotionForDraw,
    textSelectionJelloSpecsForDraw,
    textSelectionMotionForDraw,
  });
})();
