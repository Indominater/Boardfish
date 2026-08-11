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
  const springImpulse = (timeSec, decay, omegaD) =>
    Math.exp(-decay * timeSec) * Math.sin(omegaD * timeSec);

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
    const timeSec = t * 0.5;
    const settle = 1 - smootherstep((t - 0.84) / 0.16000000000000003);
    const attackSec = 0.044;
    const xAttack = smootherstep(timeSec / attackSec);
    const yTimeSec = timeSec - 0.016;
    const yAttack = yTimeSec > 0 ? smootherstep(yTimeSec / attackSec) : 0;
    const xBase = springImpulse(timeSec, 9.933715970650928, 27.476232850677572);
    const yBase = yTimeSec > 0 ? springImpulse(yTimeSec, 5.353273881717007, 21.653388109167604) : 0;
    const coupledX = (yTimeSec > 0 ? springImpulse(yTimeSec, 9.421762031821933, 27.89482072193853) : 0) * 0.16;
    const sag = yTimeSec > 0
      ? (Math.exp(-3.2 * yTimeSec) - Math.exp(-11.200000000000001 * yTimeSec)) * 0.08
      : 0;
    const grouped = motion.groupSize > 1;
    const groupSide = grouped ? motion.groupSide : 1;
    const xPx = (xBase * xAttack + coupledX * yAttack) * settle * NORMALIZE_X * 5;
    const yPx = (yBase + sag) * yAttack * settle * NORMALIZE_Y * 10.75;
    const shapeTimeSec = timeSec - 0.044;
    const shapeAttack = shapeTimeSec > 0 ? smootherstep(shapeTimeSec / 0.044) : 0;
    const shape = (shapeTimeSec > 0
      ? springImpulse(shapeTimeSec, 6.3334507896370225, 18.7513199475259) * shapeAttack * settle
      : 0) * NORMALIZE_SHAPE;
    const strain = shape * 0.028 * (grouped ? 1 + groupSide * 0.06 : 1);
    return {
      groupTranslateX: (grouped ? 0 : xPx) / zoom,
      translateX: xPx * groupSide / zoom,
      translateY: yPx / zoom,
      scaleX: Math.exp(-strain),
      scaleY: Math.exp(strain),
      scaleOriginX: 0.5,
      scaleOriginY: 0.12,
    };
  };

  const blendTransforms = (previous, next, weight) => {
    const blend = (a, b) => a + (b - a) * weight;
    return {
      translateX: blend(previous.translateX, next.translateX),
      translateY: blend(previous.translateY, next.translateY),
      groupTranslateX: blend(previous.groupTranslateX, next.groupTranslateX),
      scaleX: Math.exp(blend(Math.log(previous.scaleX), Math.log(next.scaleX))),
      scaleY: Math.exp(blend(Math.log(previous.scaleY), Math.log(next.scaleY))),
      scaleOriginX: 0.5,
      scaleOriginY: 0.12,
    };
  };

  const transformAtElapsed = (motion, elapsedMs, zoom = 1) => {
    const elapsed = Math.max(0, elapsedMs);
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
    const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
    if (ax !== bx) return ax - bx;
    const ay = a.y + a.h / 2, by = b.y + b.h / 2;
    if (ay !== by) return ay - by;
    return a.id.localeCompare(b.id);
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
    const motion = { startedAt, groupSide, groupSize };
    if (handoff) motion.handoff = handoff;
    objectMotions.set(obj.id, motion);
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
    const motion = { startedAt, start, end, groupSide: 1, groupSize: 1 };
    if (handoff) motion.handoff = handoff;
    textSelectionMotions.set(spec.id, motion);
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

  const cancelTextSelectionMotion = (id) => textSelectionMotions.delete(id);

  const textSelectionJelloSpecsForDraw = (raw = false) => {
    if (!textSelectionMotions.size || prefersReducedMotion()) return raw ? null : EMPTY_SPECS;
    const cutoff = now();
    const specs = raw ? null : [];
    for (const [id, motion] of textSelectionMotions) {
      if (cutoff - motion.startedAt >= DURATION_MS) {
        textSelectionMotions.delete(id);
      } else if (!raw) {
        specs.push({ id, start: motion.start, end: motion.end });
      }
    }
    if (raw) return textSelectionMotions.size ? textSelectionMotions : null;
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

  const getLastDrawnObjectMotion = (value) => lastDrawnObjectMotions.get(typeof value === 'string' ? value : value?.id) || null;
  const hasLastDrawnObjectMotions = () => lastDrawnObjectMotions.size > 0;

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
    cancelTextSelectionMotion,
    getLastDrawnObjectMotion,
    hasLastDrawnObjectMotions,
    hasObjectMotionsForDraw,
    objectMotionForDraw,
    textSelectionJelloSpecsForDraw,
    textSelectionMotionForDraw,
  });
})();
