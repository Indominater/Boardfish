'use strict';

const BoardfishMotion = (() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const jelloObjectMotions = new Map();
  const textSelectionJelloMotions = new Map();
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
    attackMs: 26,
    settleStart: 0.88,
    sagGain: 0.18,
    sagDecay: 2.15,
    lateralCoupling: 0.16,
    normalizePath: true,
  });
  const smoothSlideDefaults = Object.freeze({
    duration: 220,
    ease: 'cubic-bezier(0.18, 0.9, 0.24, 1.18)',
  });
  const ACTION_ANIMATION_SETS = Object.freeze({
    none: 'no-animation',
    jiggle: 'jiggle',
    notApplicable: 'not-applicable',
  });
  const actionAnimationGroup = (setName, actions) => {
    const frozenActions = new Array(actions.length);
    for (let i = 0; i < actions.length; i++) frozenActions[i] = actions[i];
    return Object.freeze({
      setName,
      actions: Object.freeze(frozenActions),
    });
  };
  // ACTION ANIMATION CONTRACT:
  // Every new user-visible action must be added to exactly one group below and
  // feature code must request motion through applyActionAnimation(action, ...).
  // Keep inherently connected action paths in the same group or replay them
  // through the same action name, so changing one setName updates the sequence.
  // Keep low-level note* helpers inside this module; feature code should not
  // choose animation implementations directly.
  const ACTION_ANIMATION_GROUPS = Object.freeze({
    boardNavigation: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'board-canvas-pan',
      'board-reset-zoom',
      'board-wheel-zoom',
    ]),
    boardFileOpen: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'board-file-drop-open',
      'open-board-file-pick',
    ]),
    objectRemoval: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'cut-selected-objects',
      'object-delete',
    ]),
    quietObjectSelection: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'object-deselect',
      'rubber-band-release',
    ]),
    appStateCommands: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'dark-mode-toggle',
      'history-redo',
      'history-undo',
      'menu-command-press',
      'new-board-state-reset',
    ]),
    exportCommands: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'export-selected-image',
      'export-selected-images',
    ]),
    fileDialogCommands: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'file-dialog-cancel',
      'file-dialog-open',
      'image-file-dialog-open',
      'image-file-drop',
    ]),
    saveCommands: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'save-board',
      'save-board-as',
    ]),
    textBoxCreate: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'plain-text-paste-as-text-box',
      'text-box-create',
      'text-box-redo-create',
      'text-box-resize',
    ]),
    textBoxRemoval: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'text-box-empty-delete-on-exit',
      'text-box-undo-delete',
    ]),
    textBoxTransform: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'text-box-drag',
      'text-box-duplicate',
      'text-box-paste',
    ]),
    textEditing: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'text-edit-caret-move',
      'text-edit-cut',
      'text-edit-delete',
      'text-edit-drag-select',
      'text-edit-enter',
      'text-edit-exit',
      'text-edit-paste',
      'text-edit-select-all',
      'text-edit-type',
      'text-align',
      'text-height-change',
    ]),
    unsavedDialogButtons: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'unsaved-dialog-cancel-press',
      'unsaved-dialog-delete-press',
      'unsaved-dialog-save-press',
    ]),
    floatingSurface: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'context-action-rail-close',
      'context-action-rail-open',
      'menu-close',
      'menu-open',
    ]),
    pillSurface: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'pill-message-open',
      'pill-message-update',
    ]),
    unsavedDialogSurface: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'unsaved-dialog-close',
      'unsaved-dialog-open',
    ]),
    objectSelection: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'additive-select',
      'object-select',
      'rubber-band-select',
    ]),
    objectCopy: actionAnimationGroup(ACTION_ANIMATION_SETS.jiggle, [
      'copy-selected-objects',
      'copy-text-object',
      'copy-text-selection',
    ]),
    objectCreate: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'bulk-image-create',
      'image-object-create',
    ]),
    objectDuplicate: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'image-object-duplicate',
    ]),
    objectPaste: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'image-object-paste',
    ]),
    objectTransform: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'object-drag',
      'object-group-drag',
      'object-multi-resize',
      'object-resize',
      'send-selected-to-back',
    ]),
    imageTransform: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'flip-image',
      'rotate-image',
    ]),
    historyFallbackReplay: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'history-object-jiggle-replay',
    ]),
    objectRestore: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'object-undo-delete',
    ]),
    browserReservedShortcuts: actionAnimationGroup(ACTION_ANIMATION_SETS.notApplicable, [
      'browser-find-shortcut',
      'external-github-open',
    ]),
  });
  const buildActionAnimationAssignments = () => {
    const assignments = {};
    for (const key in ACTION_ANIMATION_SETS) {
      if (!Object.prototype.hasOwnProperty.call(ACTION_ANIMATION_SETS, key)) continue;
      assignments[ACTION_ANIMATION_SETS[key]] = [];
    }
    for (const key in ACTION_ANIMATION_GROUPS) {
      if (!Object.prototype.hasOwnProperty.call(ACTION_ANIMATION_GROUPS, key)) continue;
      const group = ACTION_ANIMATION_GROUPS[key];
      if (!assignments[group.setName]) assignments[group.setName] = [];
      for (const action of group.actions) assignments[group.setName].push(action);
    }
    for (const setName in assignments) {
      if (!Object.prototype.hasOwnProperty.call(assignments, setName)) continue;
      const actions = assignments[setName];
      assignments[setName] = Object.freeze(actions);
    }
    return assignments;
  };
  const ACTION_ANIMATION_ASSIGNMENTS = Object.freeze(buildActionAnimationAssignments());
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
  const smoothstep = (value) => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
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
    const attack = smoothstep(timeSec / Math.max(0.001, p.attackMs / 1000));
    const settle = 1 - smoothstep((t - p.settleStart) / Math.max(0.001, 1 - p.settleStart));
    const yTimeSec = Math.max(0, timeSec - p.yLagMs / 1000);
    const xBase = dampedSpringImpulse(timeSec, p.xFreqHz, p.xDamping);
    const yBase = dampedSpringImpulse(yTimeSec, p.yFreqHz, p.yDamping);
    const coupledX = (
      dampedSpringImpulse(yTimeSec, p.yFreqHz * 1.32, p.yDamping + 0.08)
      * p.lateralCoupling
    );
    const sag = (
      Math.sin(t * Math.PI)
      * Math.exp(-p.sagDecay * timeSec)
      * p.sagGain
    );
    return {
      x: (xBase + coupledX) * attack * settle,
      y: (yBase + sag) * attack * settle,
    };
  };
  const getCopyJiggleNormalizer = (p) => {
    if (!p.normalizePath) return { x: 1, y: 1 };
    const key = copyJiggleParamKey(p);
    const cached = copyJiggleNormalizerCache.get(key);
    if (cached) return cached;
    let maxX = 0.0001;
    let maxY = 0.0001;
    const samples = 192;
    for (let i = 0; i <= samples; i += 1) {
      const point = copyJiggleUnit(i / samples, p);
      maxX = Math.max(maxX, Math.abs(point.x));
      maxY = Math.max(maxY, Math.abs(point.y));
    }
    const normalizer = Object.freeze({
      x: 1 / maxX,
      y: 1 / maxY,
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

  const buildActionAnimationLookup = () => {
    const lookup = new Map();
    for (const setName in ACTION_ANIMATION_ASSIGNMENTS) {
      if (!Object.prototype.hasOwnProperty.call(ACTION_ANIMATION_ASSIGNMENTS, setName)) continue;
      const actions = ACTION_ANIMATION_ASSIGNMENTS[setName];
      for (const action of actions) {
        if (lookup.has(action)) {
          const existingSet = lookup.get(action);
          console.error?.(`[Boardfish motion] action "${action}" is assigned to both ${existingSet} and ${setName}`);
          continue;
        }
        lookup.set(action, setName);
      }
    }
    return lookup;
  };
  const actionAnimationLookup = buildActionAnimationLookup();
  const actionAnimationSetFor = (action) => {
    const value = String(action || '').trim();
    if (!value) return '';
    return actionAnimationLookup.get(value) || '';
  };
  const noteUnassignedActionAnimation = (action) => {
    const value = String(action || '').trim() || '(empty-action)';
    console.warn?.(`[Boardfish motion] unassigned action animation: ${value}`);
  };

  const pruneFinishedObjectMotions = () => {
    const cutoff = now();
    let removed = 0;
    for (const motions of [jelloObjectMotions, textSelectionJelloMotions]) {
      for (const [id, motion] of motions) {
        if (cutoff - motion.startedAt >= motion.delay + motion.duration + 80) {
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

  const noteObjectJello = (obj, options = {}) => {
    if (!obj?.id || (options.includeText === false && obj.type === 'text') || prefersReducedMotion()) return;
    const amplitude = numberInRange(options.amplitude, jelloParams.amplitude, 0, 0.24);
    if (amplitude <= 0) return;
    const baseMotion = {
      obj: options.phase === 'exit' ? obj : null,
      phase: options.phase === 'exit' ? 'exit' : 'pulse',
      startedAt: now(),
      delay: Math.max(0, Number(options.delay) || 0),
      duration: numberInRange(options.duration, jelloParams.duration, 180, 1200),
      amplitude,
      oscillations: numberInRange(options.oscillations, jelloParams.oscillations, 1, 16),
      rebound: numberInRange(options.rebound, jelloParams.rebound, 0, 0.8),
      squish: numberInRange(options.squish, jelloParams.squish, 0, 1.4),
      decayPower: numberInRange(options.decayPower, 2.15, 0.8, 4),
    };
    const motion = {
      ...baseMotion,
      ...copyJiggleMotionFields(options, baseMotion),
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
    list.forEach((obj, index) => noteObjectJello(obj, {
      ...options,
      delay: Math.min(index * stagger, 160),
    }));
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
    const baseMotion = {
      startedAt: now(),
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
    if (elapsed < 0) return { waiting: true, done: false, t: 0 };
    const raw = elapsed / motion.duration;
    return { waiting: false, done: raw >= 1, t: clamp01(raw) };
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
    const result = {};
    if (motion.translateXPx) {
      result.translateX = screenPxToWorldValue(point.x * normalizer.x * motion.translateXPx, options);
    }
    if (motion.translateYPx) {
      result.translateY = screenPxToWorldValue(point.y * normalizer.y * motion.translateYPx, options);
    }
    return result;
  };

  const jelloTransformForMotion = (motion, t, options = {}) => {
    if (motion.translateXPx || motion.translateYPx) return jelloTranslateForMotion(motion, t, options);
    return jelloScaleForMotion(motion, t);
  };

  const restingJelloTransformForMotion = (motion) => {
    if (motion.translateXPx || motion.translateYPx) {
      return {
        translateX: 0,
        translateY: 0,
      };
    }
    return {
      scaleX: 1,
      scaleY: 1,
    };
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
      const transform = restingJelloTransformForMotion(motion);
      recordMotionDebug('jiggle-waiting', {
        id,
        objectType: 'text-selection',
        t: 0,
        ...transform,
      });
      return { opacity: 1, ...transform };
    }
    const transform = jelloTransformForMotion(motion, progress.t, options);
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
      const transform = restingJelloTransformForMotion(jello);
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
    const transform = jelloTransformForMotion(jello, t, options);
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
    if (!hasObjectMotions()) return null;
    return jelloMotionForDraw(obj, options);
  };

  const motionObjectsForDraw = () => {
    if (prefersReducedMotion() || !hasObjectMotions()) return [];
    const objects = [];
    const seenIds = new Set();
    const addExitObjects = (motions) => {
      for (const motion of motions.values()) {
        if (
          motion.phase !== 'exit' ||
          !motion.obj ||
          seenIds.has(motion.obj.id)
        ) continue;
        seenIds.add(motion.obj.id);
        objects.push(motion.obj);
      }
    };
    addExitObjects(jelloObjectMotions);
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

  const selectedObjectsFromRoot = () => {
    const selectedIds = root.selectedIds;
    const objectsMap = root.objectsMap;
    if (!selectedIds?.size || !objectsMap?.get) return [];
    const out = [];
    for (const id of selectedIds) {
      const obj = objectsMap.get(id);
      if (obj) out.push(obj);
    }
    return out;
  };

  const inferActionObjects = (action, payload = {}) => {
    if (payload.inferObjects === false) return [];
    const value = String(action || '');
    if (value.startsWith('text-edit-')) {
      const obj = root.objectsMap?.get?.(root.editingId);
      return obj ? [obj] : [];
    }
    if (
      value.startsWith('text-box-') ||
      value.startsWith('object-') ||
      value.startsWith('image-object-') ||
      value === 'flip-image' ||
      value === 'rotate-image' ||
      value === 'send-selected-to-back'
    ) {
      return selectedObjectsFromRoot();
    }
    return [];
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
    const setName = actionAnimationSetFor(action);
    if (!setName) {
      noteUnassignedActionAnimation(action);
      if (typeof payload?.after === 'function') payload.after();
      return false;
    }
    if (setName === ACTION_ANIMATION_SETS.none || setName === ACTION_ANIMATION_SETS.notApplicable) {
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
    let objects = hasExplicitObjects
      ? asObjectList(hasOwn(payload, 'objects') ? payload.objects : payload.addedObjects)
      : [];
    const removedObjects = hasExplicitRemovedObjects ? asObjectList(payload.removedObjects) : [];
    if (!objects.length && !removedObjects.length && !hasExplicitObjects && !hasExplicitRemovedObjects) {
      objects = payload?.selection ? selectedObjectsFromRoot() : inferActionObjects(action, payload);
    }

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
    motionObjectsForDraw,
    objectMotionForDraw,
    textSelectionJelloSpecsForDraw,
    textSelectionMotionForDraw,
  });

  root.BoardfishMotion = api;
  return api;
})();
