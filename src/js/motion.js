'use strict';

const BoardfishMotion = (() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const jelloObjectMotions = new Map();
  const textSelectionJelloMotions = new Map();
  const smoothSlideObjectMotions = new Map();
  const smoothSlideSurfaceCloses = new WeakMap();
  const smoothSlideEnterAnimation = 'bf-smooth-slide-enter';
  const smoothSlideExitAnimation = 'bf-smooth-slide-exit';
  let tickRaf = 0;
  const jelloDefaults = Object.freeze({
    amplitude: 0.062,
    duration: 520,
    oscillations: 6.5,
    rebound: 0.22,
    squish: 0.68,
    staggerMs: 18,
  });
  const smoothSlideDefaults = Object.freeze({
    duration: 220,
    offsetY: -6,
    settleY: 1,
    startScale: 0.985,
    settleScale: 1.005,
    ease: 'cubic-bezier(0.18, 0.9, 0.24, 1.18)',
  });
  const noAnimationDefaults = Object.freeze({
    duration: 0,
  });
  const ACTION_ANIMATION_SETS = Object.freeze({
    none: 'no-animation',
    smoothSlide: 'smooth-slide',
    jiggle: 'jiggle',
    notApplicable: 'not-applicable',
  });
  const actionAnimationGroup = (setName, actions) => Object.freeze({
    setName,
    actions: Object.freeze([...actions]),
  });
  // ACTION ANIMATION CONTRACT:
  // Every new user-visible action must be added to exactly one group below and
  // feature code must request motion through applyActionAnimation(action, ...).
  // Keep inherently connected action paths in the same group or replay them
  // through the same action name, so changing one setName updates the sequence.
  // Keep low-level note* helpers inside this module or tests; new action code
  // should not choose jello/smooth-slide/no-animation directly.
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
    eyedropperQuiet: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'eyedropper-hold-end',
      'eyedropper-hold-start',
      'eyedropper-hover',
      'eyedropper-loupe-close',
      'eyedropper-loupe-drag',
      'eyedropper-loupe-open',
    ]),
    exportCommands: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'export-selected-image',
      'export-selected-images',
    ]),
    fileDialogCommands: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'file-dialog-cancel',
      'image-file-dialog-open',
      'image-file-drop',
      'native-file-dialog-open',
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
      'text-box-undo-create',
    ]),
    textBoxRemoval: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'text-box-delete',
      'text-box-empty-delete-on-exit',
      'text-box-redo-delete',
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
      'opening-shield-pill-open',
      'pill-message-close',
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
      'object-undo-insert',
    ]),
    objectDuplicate: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'image-object-duplicate',
    ]),
    objectPaste: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'image-object-paste',
    ]),
    objectTransform: actionAnimationGroup(ACTION_ANIMATION_SETS.none, [
      'image-object-drag',
      'image-object-resize',
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
    appWindowNative: actionAnimationGroup(ACTION_ANIMATION_SETS.notApplicable, [
      'app-window-close-request',
      'app-window-drag',
      'app-window-minimize',
      'app-window-resize',
      'app-window-toggle-maximize',
      'external-github-open',
      'native-find-shortcut',
    ]),
  });
  const buildActionAnimationAssignments = () => {
    const assignments = {};
    for (const setName of Object.values(ACTION_ANIMATION_SETS)) assignments[setName] = [];
    for (const group of Object.values(ACTION_ANIMATION_GROUPS)) {
      if (!assignments[group.setName]) assignments[group.setName] = [];
      assignments[group.setName].push(...group.actions);
    }
    for (const [setName, actions] of Object.entries(assignments)) {
      assignments[setName] = Object.freeze(actions);
    }
    return assignments;
  };
  const ACTION_ANIMATION_ASSIGNMENTS = Object.freeze(buildActionAnimationAssignments());
  let jelloParams = null;
  let smoothSlideParams = null;
  let noAnimationParams = null;
  const actionAnimationRuntimeUnassigned = new Set();
  const actionAnimationPolicyDuplicateAssignments = [];

  const prefersReducedMotion = () => {
    try {
      return !!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  };

  const now = () => (
    root.performance?.now ? root.performance.now() : Date.now()
  );

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
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
    offsetY: numberInRange(options.offsetY, base.offsetY, -48, 48),
    settleY: numberInRange(options.settleY, base.settleY, -24, 24),
    startScale: numberInRange(options.startScale, base.startScale, 0.8, 1.2),
    settleScale: numberInRange(options.settleScale, base.settleScale, 0.8, 1.2),
    ease: typeof options.ease === 'string' && options.ease.trim() ? options.ease.trim() : base.ease,
  });
  const applySmoothSlideCssVars = () => {
    const style = root.document?.documentElement?.style;
    if (!style) return;
    style.setProperty('--smooth-slide-duration', `${smoothSlideParams.duration}ms`);
    style.setProperty('--smooth-slide-offset-y', `${smoothSlideParams.offsetY}px`);
    style.setProperty('--smooth-slide-settle-y', `${smoothSlideParams.settleY}px`);
    style.setProperty('--smooth-slide-start-scale', String(smoothSlideParams.startScale));
    style.setProperty('--smooth-slide-settle-scale', String(smoothSlideParams.settleScale));
    style.setProperty('--smooth-slide-ease', smoothSlideParams.ease);
  };
  jelloParams = normalizeJelloParams(root.BoardfishJelloParams || {});
  smoothSlideParams = normalizeSmoothSlideParams(root.BoardfishSmoothSlideParams || {});
  noAnimationParams = { ...noAnimationDefaults, ...(root.BoardfishNoAnimationParams || {}) };
  noAnimationParams.duration = 0;
  applySmoothSlideCssVars();

  const buildActionAnimationLookup = () => {
    const lookup = new Map();
    for (const [setName, actions] of Object.entries(ACTION_ANIMATION_ASSIGNMENTS)) {
      for (const action of actions) {
        if (lookup.has(action)) {
          const existingSet = lookup.get(action);
          actionAnimationPolicyDuplicateAssignments.push({ action, sets: [existingSet, setName] });
          console.error?.(`[Boardfish motion] action "${action}" is assigned to both ${existingSet} and ${setName}`);
          continue;
        }
        lookup.set(action, setName);
      }
    }
    return lookup;
  };
  const actionAnimationLookup = buildActionAnimationLookup();
  const normalizeActionAnimationSet = (setName) => {
    const value = String(setName || '').trim();
    if (value === ACTION_ANIMATION_SETS.none || value === 'none') return ACTION_ANIMATION_SETS.none;
    if (value === ACTION_ANIMATION_SETS.smoothSlide || value === 'smooth') return ACTION_ANIMATION_SETS.smoothSlide;
    if (value === ACTION_ANIMATION_SETS.jiggle || value === 'jello') return ACTION_ANIMATION_SETS.jiggle;
    if (value === ACTION_ANIMATION_SETS.notApplicable || value === 'not-applicable') return ACTION_ANIMATION_SETS.notApplicable;
    return '';
  };
  const actionAnimationSetFor = (action) => {
    const value = String(action || '').trim();
    if (!value) return '';
    return actionAnimationLookup.get(value) || '';
  };
  const getActionAnimationPartition = () => Object.freeze({
    [ACTION_ANIMATION_SETS.none]: [...ACTION_ANIMATION_ASSIGNMENTS[ACTION_ANIMATION_SETS.none]],
    [ACTION_ANIMATION_SETS.smoothSlide]: [...ACTION_ANIMATION_ASSIGNMENTS[ACTION_ANIMATION_SETS.smoothSlide]],
    [ACTION_ANIMATION_SETS.jiggle]: [...ACTION_ANIMATION_ASSIGNMENTS[ACTION_ANIMATION_SETS.jiggle]],
    [ACTION_ANIMATION_SETS.notApplicable]: [...ACTION_ANIMATION_ASSIGNMENTS[ACTION_ANIMATION_SETS.notApplicable]],
  });
  const getActionAnimationGroups = () => Object.freeze(Object.fromEntries(
    Object.entries(ACTION_ANIMATION_GROUPS).map(([name, group]) => [name, Object.freeze({
      setName: group.setName,
      actions: [...group.actions],
    })])
  ));
  const getActionAnimationPolicyIssues = () => Object.freeze({
    duplicateAssignments: actionAnimationPolicyDuplicateAssignments.map((issue) => ({
      action: issue.action,
      sets: [...issue.sets],
    })),
    runtimeUnassigned: getUnassignedActionAnimations(),
  });
  const getUnassignedActionAnimations = () => [...actionAnimationRuntimeUnassigned].sort();
  const noteUnassignedActionAnimation = (action) => {
    const value = String(action || '').trim() || '(empty-action)';
    actionAnimationRuntimeUnassigned.add(value);
    console.warn?.(`[Boardfish motion] unassigned action animation: ${value}`);
  };

  const pruneFinishedObjectMotions = () => {
    const cutoff = now();
    let removed = 0;
    for (const motions of [jelloObjectMotions, textSelectionJelloMotions, smoothSlideObjectMotions]) {
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
    jelloObjectMotions.size || textSelectionJelloMotions.size || smoothSlideObjectMotions.size
  );

  const requestMotionFrame = () => {
    if (tickRaf || prefersReducedMotion()) return;
    tickRaf = root.requestAnimationFrame?.(() => {
      tickRaf = 0;
      const removed = pruneFinishedObjectMotions();
      if (!hasObjectMotions()) {
        if (removed) root.scheduleRender?.(true, true, 'motion-finished');
        return;
      }
      root.scheduleRender?.(true, true, 'motion');
      requestMotionFrame();
    }) || 0;
  };

  const noteObjectAdded = (obj, options = {}) => {
    if (obj?.type === 'text' && options.includeText !== true) return;
    noteObjectJello(obj, options);
  };

  const noteObjectsAdded = (items, options = {}) => {
    const list = Array.isArray(items) ? items : [];
    if (options.textMotion === 'smooth-slide') {
      const textObjects = options.includeText === false ? [] : list.filter((obj) => obj?.type === 'text');
      const jelloObjects = list.filter((obj) => obj?.type !== 'text');
      noteObjectsJello(jelloObjects, { ...options, includeText: false });
      noteObjectsSmoothSlideAdded(textObjects, options);
      return;
    }
    noteObjectsJello(list, options);
  };

  const noteObjectsRemoved = (items, options = {}) => {
    const list = Array.isArray(items) ? items : [];
    noteObjectsSmoothSlideRemoved(
      options.includeText === false ? list.filter((obj) => obj?.type !== 'text') : list,
      options
    );
  };

  const noteObjectJello = (obj, options = {}) => {
    if (!obj?.id || (options.includeText === false && obj.type === 'text') || prefersReducedMotion()) return;
    const amplitude = numberInRange(options.amplitude, jelloParams.amplitude, 0, 0.24);
    if (amplitude <= 0) return;
    jelloObjectMotions.set(obj.id, {
      obj: options.phase === 'exit' ? obj : null,
      phase: options.phase === 'exit' ? 'exit' : 'pulse',
      startedAt: now(),
      delay: Math.max(0, Number(options.delay) || 0),
      duration: numberInRange(options.duration, jelloParams.duration, 180, 1200),
      amplitude,
      oscillations: numberInRange(options.oscillations, jelloParams.oscillations, 1, 16),
      rebound: numberInRange(options.rebound, jelloParams.rebound, 0, 0.8),
      squish: numberInRange(options.squish, jelloParams.squish, 0, 1.4),
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
    textSelectionJelloMotions.set(spec.id, {
      startedAt: now(),
      delay: Math.max(0, Number(options.delay) || 0),
      duration: numberInRange(options.duration, jelloParams.duration, 180, 1200),
      amplitude,
      oscillations: numberInRange(options.oscillations, jelloParams.oscillations, 1, 16),
      rebound: numberInRange(options.rebound, jelloParams.rebound, 0, 0.8),
      squish: numberInRange(options.squish, jelloParams.squish, 0, 1.4),
      start: Math.min(spec.start, spec.end),
      end: Math.max(spec.start, spec.end),
    });
    requestMotionFrame();
  };

  const noteObjectsSmoothSlideAdded = (items, options = {}) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length || prefersReducedMotion()) return;
    const params = normalizeSmoothSlideParams(options, smoothSlideParams);
    const startedAt = now();
    const delay = Math.max(0, Number(options.delay) || 0);
    list.forEach((obj) => {
      if (!obj?.id) return;
      smoothSlideObjectMotions.set(obj.id, {
        phase: smoothSlideEnterAnimation,
        startedAt,
        delay,
        duration: params.duration,
        offsetY: params.offsetY,
        settleY: params.settleY,
        startScale: params.startScale,
        settleScale: params.settleScale,
        ease: params.ease,
      });
    });
    requestMotionFrame();
  };

  const noteTextObjectsSmoothSlide = (items, options = {}) => {
    const textObjects = (Array.isArray(items) ? items : [])
      .filter((obj) => obj?.type === 'text');
    noteObjectsSmoothSlideAdded(textObjects, options);
  };

  const noteTextObjectSmoothSlide = (obj, options = {}) => {
    if (obj?.type !== 'text') return;
    noteObjectsSmoothSlideAdded([obj], options);
  };

  const noteObjectsSmoothSlideRemoved = (items, options = {}) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length || prefersReducedMotion()) return;
    const params = normalizeSmoothSlideParams(options, smoothSlideParams);
    const startedAt = now();
    const delay = Math.max(0, Number(options.delay) || 0);
    list.forEach((obj) => {
      if (!obj?.id) return;
      smoothSlideObjectMotions.set(obj.id, {
        obj,
        phase: smoothSlideExitAnimation,
        startedAt,
        delay,
        duration: params.duration,
        offsetY: params.offsetY,
        settleY: params.settleY,
        startScale: params.startScale,
        settleScale: params.settleScale,
        ease: params.ease,
      });
    });
    requestMotionFrame();
  };

  const configureJello = (options = {}) => {
    jelloParams = normalizeJelloParams(options, jelloParams);
    root.BoardfishJelloParams = { ...jelloParams };
    return { ...jelloParams };
  };

  const getJelloParams = () => ({ ...jelloParams });

  const configureSmoothSlide = (options = {}) => {
    smoothSlideParams = normalizeSmoothSlideParams(options, smoothSlideParams);
    root.BoardfishSmoothSlideParams = { ...smoothSlideParams };
    applySmoothSlideCssVars();
    return { ...smoothSlideParams };
  };

  const getSmoothSlideParams = () => ({ ...smoothSlideParams });

  const configureNoAnimation = (options = {}) => {
    noAnimationParams = { ...noAnimationParams, ...(options || {}), duration: 0 };
    root.BoardfishNoAnimationParams = { ...noAnimationParams };
    return { ...noAnimationParams };
  };

  const getNoAnimationParams = () => ({ ...noAnimationParams });

  const getActionAnimationSetParams = (setName) => {
    const normalized = normalizeActionAnimationSet(setName);
    if (normalized === ACTION_ANIMATION_SETS.none) return getNoAnimationParams();
    if (normalized === ACTION_ANIMATION_SETS.smoothSlide) return getSmoothSlideParams();
    if (normalized === ACTION_ANIMATION_SETS.jiggle) return getJelloParams();
    if (normalized === ACTION_ANIMATION_SETS.notApplicable) return getNoAnimationParams();
    return {};
  };

  const configureActionAnimationSet = (setName, options = {}) => {
    const normalized = normalizeActionAnimationSet(setName);
    if (normalized === ACTION_ANIMATION_SETS.none) return configureNoAnimation(options);
    if (normalized === ACTION_ANIMATION_SETS.smoothSlide) return configureSmoothSlide(options);
    if (normalized === ACTION_ANIMATION_SETS.jiggle) return configureJello(options);
    if (normalized === ACTION_ANIMATION_SETS.notApplicable) return getNoAnimationParams();
    return {};
  };

  const motionProgress = (motion, cutoff) => {
    const elapsed = cutoff - motion.startedAt - motion.delay;
    if (elapsed < 0) return { waiting: true, done: false, t: 0 };
    const raw = elapsed / motion.duration;
    return { waiting: false, done: raw >= 1, t: clamp01(raw) };
  };

  const parseCubicBezier = (ease) => {
    if (typeof ease !== 'string') return null;
    const normalized = ease.trim().toLowerCase();
    const keywordCurves = {
      linear: [0, 0, 1, 1],
      ease: [0.25, 0.1, 0.25, 1],
      'ease-in': [0.42, 0, 1, 1],
      'ease-out': [0, 0, 0.58, 1],
      'ease-in-out': [0.42, 0, 0.58, 1],
    };
    if (keywordCurves[normalized]) return keywordCurves[normalized];
    if (!normalized.startsWith('cubic-bezier')) return null;
    const values = ease.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
    if (values[0] < 0 || values[0] > 1 || values[2] < 0 || values[2] > 1) return null;
    return values;
  };

  const cubicBezierProgress = (t, ease) => {
    const bezier = parseCubicBezier(ease);
    if (!bezier) return t * t * (3 - 2 * t);
    const [x1, y1, x2, y2] = bezier;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
    const sampleY = (u) => ((ay * u + by) * u + cy) * u;
    const sampleDerivativeX = (u) => (3 * ax * u + 2 * bx) * u + cx;
    let u = t;
    for (let i = 0; i < 5; i++) {
      const dx = sampleX(u) - t;
      const derivative = sampleDerivativeX(u);
      if (Math.abs(dx) < 0.0001 || Math.abs(derivative) < 0.000001) break;
      u = clamp01(u - dx / derivative);
    }
    if (Math.abs(sampleX(u) - t) > 0.0001) {
      let lower = 0;
      let upper = 1;
      u = t;
      for (let i = 0; i < 8; i++) {
        const x = sampleX(u);
        if (Math.abs(x - t) < 0.0001) break;
        if (x < t) lower = u;
        else upper = u;
        u = (lower + upper) / 2;
      }
    }
    return sampleY(u);
  };

  const smoothSlideObjectTranslateYValue = (value, options = {}) => {
    const viewZoom = Number(options?.view?.zoom);
    const safeZoom = Number.isFinite(viewZoom) && viewZoom > 0 ? viewZoom : 1;
    return value / safeZoom;
  };

  const smoothSlideObjectTranslateY = (motion, options = {}, eased = 0) => {
    return smoothSlideObjectTranslateYValue(motion.offsetY * eased, options);
  };

  const smoothSlideObjectEnterMotionForDraw = (motion, options = {}, eased = 0) => {
    const t = clamp01(eased);
    const settleAt = 0.7;
    if (t <= settleAt) {
      const p = t / settleAt;
      return {
        opacity: clamp01(p),
        scale: motion.startScale + (motion.settleScale - motion.startScale) * p,
        translateY: smoothSlideObjectTranslateYValue(motion.offsetY + (motion.settleY - motion.offsetY) * p, options),
      };
    }
    const p = (t - settleAt) / (1 - settleAt);
    return {
      opacity: 1,
      scale: motion.settleScale + (1 - motion.settleScale) * p,
      translateY: smoothSlideObjectTranslateYValue(motion.settleY * (1 - p), options),
    };
  };

  const jelloScaleForMotion = (motion, t) => {
    const decay = Math.pow(1 - t, 2.15);
    const wobble = Math.sin(t * Math.PI * motion.oscillations) * motion.amplitude * decay;
    const rebound = Math.sin(t * Math.PI * motion.oscillations * 2) * motion.amplitude * motion.rebound * decay;
    return {
      scaleX: 1 + wobble + rebound,
      scaleY: 1 - wobble * motion.squish,
    };
  };

  const textSelectionMotionForDraw = (id, start, end) => {
    const motion = textSelectionJelloMotions.get(id);
    if (!motion || prefersReducedMotion()) return null;
    if (motion.start !== Math.min(start, end) || motion.end !== Math.max(start, end)) {
      textSelectionJelloMotions.delete(id);
      return null;
    }
    const progress = motionProgress(motion, now());
    if (progress.done) {
      textSelectionJelloMotions.delete(id);
      return null;
    }
    if (progress.waiting) return { opacity: 1, scaleX: 1, scaleY: 1 };
    return {
      opacity: 1,
      ...jelloScaleForMotion(motion, progress.t),
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

  const jelloMotionForDraw = (obj) => {
    const jello = jelloObjectMotions.get(obj?.id);
    if (!jello || prefersReducedMotion()) return null;
    const cutoff = now();
    const progress = motionProgress(jello, cutoff);
    if (progress.done) {
      jelloObjectMotions.delete(obj.id);
      return jello.phase === 'exit' ? { opacity: 0, scale: 1, skip: true } : null;
    }
    if (progress.waiting) return { opacity: 1, scale: 1 };
    const t = progress.t;
    const exitOpacity = jello.phase === 'exit' ? clamp01(1 - t) : 1;
    return {
      opacity: exitOpacity,
      ...jelloScaleForMotion(jello, t),
    };
  };

  const smoothSlideObjectMotionForDraw = (obj, options = {}) => {
    const motion = smoothSlideObjectMotions.get(obj?.id);
    if (!motion || prefersReducedMotion()) return null;
    const progress = motionProgress(motion, now());
    if (progress.done) {
      smoothSlideObjectMotions.delete(obj.id);
      return motion.phase === smoothSlideExitAnimation
        ? { opacity: 0, scale: 1, translateY: 0, skip: true }
        : null;
    }
    if (motion.phase === smoothSlideEnterAnimation && progress.waiting) {
      return smoothSlideObjectEnterMotionForDraw(motion, options, 0);
    }
    if (progress.waiting) return { opacity: 1, scale: 1, translateY: 0 };
    const eased = cubicBezierProgress(progress.t, motion.ease);
    if (motion.phase === smoothSlideEnterAnimation) {
      return smoothSlideObjectEnterMotionForDraw(motion, options, eased);
    }
    return {
      opacity: clamp01(1 - eased),
      scale: 1 + (motion.startScale - 1) * eased,
      translateY: smoothSlideObjectTranslateY(motion, options, eased),
    };
  };

  const objectMotionForDraw = (obj, options = {}) => {
    if (!hasObjectMotions()) return null;
    return smoothSlideObjectMotionForDraw(obj, options) || jelloMotionForDraw(obj);
  };

  const motionObjectsForDraw = () => {
    if (prefersReducedMotion() || !hasObjectMotions()) return [];
    const objects = [];
    const seenIds = new Set();
    const addExitObjects = (motions) => {
      for (const motion of motions.values()) {
        if (
          (motion.phase !== smoothSlideExitAnimation && motion.phase !== 'exit') ||
          !motion.obj ||
          seenIds.has(motion.obj.id)
        ) continue;
        seenIds.add(motion.obj.id);
        objects.push(motion.obj);
      }
    };
    addExitObjects(smoothSlideObjectMotions);
    addExitObjects(jelloObjectMotions);
    return objects;
  };

  const restartClass = (el, className) => {
    if (!el || prefersReducedMotion()) return;
    el.classList.remove(className);
    // Force style invalidation so repeating the same action replays cleanly.
    void el.offsetWidth;
    el.classList.add(className);
  };

  const noteSmoothSlideOpened = (surface) => {
    if (!surface) return;
    surface.__bfSmoothSlideExitToken = (surface.__bfSmoothSlideExitToken || 0) + 1;
    smoothSlideSurfaceCloses.delete(surface);
    surface.classList.remove('motion-smooth-slide-exit');
    restartClass(surface, 'motion-smooth-slide-enter');
  };
  const noteMenuOpened = (menu) => noteSmoothSlideOpened(menu);

  const noteSmoothSlideClosed = (surface, after = null) => {
    if (!surface || prefersReducedMotion()) {
      if (typeof after === 'function') after();
      return false;
    }
    const pendingClose = smoothSlideSurfaceCloses.get(surface);
    if (pendingClose && surface.classList.contains('motion-smooth-slide-exit')) {
      if (typeof after === 'function') pendingClose.callbacks.push(after);
      return true;
    }
    surface.classList.remove('motion-smooth-slide-enter');
    const token = (surface.__bfSmoothSlideExitToken || 0) + 1;
    surface.__bfSmoothSlideExitToken = token;
    smoothSlideSurfaceCloses.set(surface, {
      callbacks: typeof after === 'function' ? [after] : [],
    });
    restartClass(surface, 'motion-smooth-slide-exit');
    const finish = () => {
      if (surface.__bfSmoothSlideExitToken !== token) return;
      surface.classList.remove('motion-smooth-slide-exit');
      const close = smoothSlideSurfaceCloses.get(surface);
      smoothSlideSurfaceCloses.delete(surface);
      for (const callback of close?.callbacks || []) callback();
    };
    if (typeof root.setTimeout === 'function') root.setTimeout(finish, smoothSlideParams.duration);
    else finish();
    return true;
  };

  const bumpIsland = () => {
    const doc = root.document;
    noteSmoothSlideOpened(doc?.getElementById('island'));
    noteSmoothSlideOpened(doc?.querySelector?.('.opening-shield-pill.visible'));
  };

  const pulseSelection = (options = {}) => {
    const selectedIds = root.selectedIds;
    const objectsMap = root.objectsMap;
    if (!selectedIds?.size || !objectsMap?.get) return;
    const selectedObjects = [...selectedIds]
      .map((id) => objectsMap.get(id))
      .filter(Boolean);
    noteObjectsJello(selectedObjects, options);
  };

  const asObjectList = (items) => {
    if (!items) return [];
    return Array.isArray(items) ? items.filter(Boolean) : [items].filter(Boolean);
  };

  const selectedObjectsFromRoot = () => {
    const selectedIds = root.selectedIds;
    const objectsMap = root.objectsMap;
    if (!selectedIds?.size || !objectsMap?.get) return [];
    return [...selectedIds].map((id) => objectsMap.get(id)).filter(Boolean);
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
    return controls;
  };

  const actionOptionsForSet = (setName, options = {}) => {
    if (setName === ACTION_ANIMATION_SETS.jiggle) {
      return {
        ...getActionAnimationSetParams(setName),
        ...jiggleActionControlOptions(options),
      };
    }
    return {
      ...getActionAnimationSetParams(setName),
      ...(options || {}),
    };
  };

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

    const motionOptions = actionOptionsForSet(setName, {
      ...(payload?.options || {}),
      ...(options || {}),
    });
    const hasExplicitObjects = hasOwn(payload, 'objects') || hasOwn(payload, 'addedObjects');
    const hasExplicitRemovedObjects = hasOwn(payload, 'removedObjects');
    let objects = hasExplicitObjects
      ? asObjectList(hasOwn(payload, 'objects') ? payload.objects : payload.addedObjects)
      : [];
    const removedObjects = hasExplicitRemovedObjects ? asObjectList(payload.removedObjects) : [];
    if (!objects.length && !removedObjects.length && !hasExplicitObjects && !hasExplicitRemovedObjects) {
      objects = payload?.selection ? selectedObjectsFromRoot() : inferActionObjects(action, payload);
    }

    if (setName === ACTION_ANIMATION_SETS.smoothSlide) {
      if (payload?.pill) {
        bumpIsland();
        return true;
      }
      if (payload?.phase === 'close' || payload?.close === true) {
        return noteSmoothSlideClosed(payload?.surface, payload?.after);
      }
      if (payload?.surface) {
        noteSmoothSlideOpened(payload.surface);
        return true;
      }
      let applied = false;
      if (objects.length) {
        noteObjectsSmoothSlideAdded(objects, motionOptions);
        applied = true;
      }
      if (removedObjects.length) {
        noteObjectsSmoothSlideRemoved(removedObjects, motionOptions);
        applied = true;
      }
      return applied;
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
    ACTION_ANIMATION_SETS,
    applyActionAnimation,
    bumpIsland,
    configureActionAnimationSet,
    configureNoAnimation,
    configureSmoothSlide,
    configureJello,
    getActionAnimationPartition,
    getActionAnimationGroups,
    getActionAnimationPolicyIssues,
    getActionAnimationSetParams,
    getJelloParams,
    getNoAnimationParams,
    getSmoothSlideParams,
    getUnassignedActionAnimations,
    actionAnimationSetFor,
    noteMenuOpened,
    noteObjectAdded,
    noteObjectsAdded,
    noteObjectJello,
    noteObjectsJello,
    noteObjectsJelloRemoved,
    noteObjectsRemoved,
    noteObjectsSmoothSlideAdded,
    noteObjectsSmoothSlideRemoved,
    noteTextObjectSmoothSlide,
    noteTextObjectsSmoothSlide,
    noteTextSelectionJello,
    noteSmoothSlideClosed,
    noteSmoothSlideOpened,
    motionObjectsForDraw,
    objectMotionForDraw,
    pulseSelection,
    textSelectionJelloSpecsForDraw,
    textSelectionMotionForDraw,
  });

  root.BoardfishMotion = api;
  return api;
})();
