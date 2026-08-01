'use strict';

(function initBoardfishTouchInput(root) {
  const TOUCH_HOLD_DELAY_MS = 550;
  const TOUCH_MOVE_THRESHOLD_PX = 8;
  const PINCH_MAX_SCALE_STEP = 1.2;

  function touchPoint(input) {
    if (!input) return null;
    const pointerId = input.pointerId ?? input.identifier;
    const x = Number(input.clientX);
    const y = Number(input.clientY);
    if (pointerId === undefined || pointerId === null || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      id: String(pointerId),
      pointerId,
      x,
      y,
      target: input.target || null,
      sourceEvent: input.sourceEvent || input,
    };
  }

  function twoPointerGeometry(points) {
    const [first, second] = points;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return {
      centerX: (first.x + second.x) / 2,
      centerY: (first.y + second.y) / 2,
      distance: Math.max(1, Math.hypot(dx, dy)),
    };
  }

  function medianOfThree(a, b, c) {
    return a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
  }

  function pinchViewportFromGesture(viewport = {}, gesture = {}, limits = {}) {
    const startZoom = Math.max(0.0001, Number(viewport.zoom) || 1);
    const minZoom = Number.isFinite(limits.minZoom) ? limits.minZoom : 0.01;
    const maxZoom = Number.isFinite(limits.maxZoom) ? limits.maxZoom : 100;
    const scale = Math.max(0.0001, Number(gesture.scale) || 1);
    const nextZoom = Math.min(maxZoom, Math.max(minZoom, startZoom * scale));
    const startCenterX = Number(gesture.startCenterX) || 0;
    const startCenterY = Number(gesture.startCenterY) || 0;
    const centerX = Number.isFinite(gesture.centerX) ? gesture.centerX : startCenterX;
    const centerY = Number.isFinite(gesture.centerY) ? gesture.centerY : startCenterY;
    const startPanX = Number(viewport.panX) || 0;
    const startPanY = Number(viewport.panY) || 0;
    const anchorWorldX = (startCenterX - startPanX) / startZoom;
    const anchorWorldY = (startCenterY - startPanY) / startZoom;
    return {
      zoom: nextZoom,
      panX: centerX - anchorWorldX * nextZoom,
      panY: centerY - anchorWorldY * nextZoom,
    };
  }

  function createTouchGestureController(options = {}) {
    const holdDelayMs = Number.isFinite(options.holdDelayMs)
      ? Math.max(0, options.holdDelayMs)
      : TOUCH_HOLD_DELAY_MS;
    const moveThresholdPx = Number.isFinite(options.moveThresholdPx)
      ? Math.max(0, options.moveThresholdPx)
      : TOUCH_MOVE_THRESHOLD_PX;
    const moveThresholdSq = moveThresholdPx * moveThresholdPx;
    const pinchMaxScaleStep = Number.isFinite(options.pinchMaxScaleStep)
      ? Math.max(1, options.pinchMaxScaleStep)
      : PINCH_MAX_SCALE_STEP;
    const pinchMinScaleStep = 1 / pinchMaxScaleStep;
    const scheduleTimer = options.scheduleTimer || ((callback, delay) => setTimeout(callback, delay));
    const cancelTimer = options.cancelTimer || ((timer) => clearTimeout(timer));
    const active = new Map();
    let mode = 'idle';
    let holdTimer = null;
    let pinchStart = null;
    let pinchGeometrySamples = [];
    let pinchFilteredDistance = 1;

    const call = (name, payload) => {
      if (typeof options[name] === 'function') options[name](payload);
    };

    function clearHoldTimer() {
      if (holdTimer === null) return;
      cancelTimer(holdTimer);
      holdTimer = null;
    }

    function activePoints(limit = Infinity) {
      const points = [];
      for (const point of active.values()) {
        points.push(point);
        if (points.length >= limit) break;
      }
      return points;
    }

    function gesturePayload(point, extra = {}) {
      return {
        pointerId: point?.pointerId,
        x: point?.x,
        y: point?.y,
        startX: point?.startX,
        startY: point?.startY,
        target: point?.target || null,
        event: point?.sourceEvent || null,
        activeCount: active.size,
        ...extra,
      };
    }

    function startHold(point) {
      clearHoldTimer();
      const pointerId = point.id;
      holdTimer = scheduleTimer(() => {
        holdTimer = null;
        const current = active.get(pointerId);
        if (mode !== 'pending' || active.size !== 1 || !current) return;
        const dx = current.x - current.startX;
        const dy = current.y - current.startY;
        if (dx * dx + dy * dy > moveThresholdSq) return;
        mode = 'long-press';
        call('onLongPress', gesturePayload(current));
      }, holdDelayMs);
    }

    function startPinch(sourceEvent = null) {
      clearHoldTimer();
      if (active.size < 2) return false;
      const points = activePoints(2);
      const geometry = twoPointerGeometry(points);
      mode = 'pinch';
      pinchStart = geometry;
      // A three-sample median rejects a single bad mobile pointer coordinate.
      // Seed it twice so the first real sample cannot move the viewport alone.
      pinchGeometrySamples = [geometry, geometry];
      pinchFilteredDistance = geometry.distance;
      call('onPinchStart', {
        ...geometry,
        startCenterX: geometry.centerX,
        startCenterY: geometry.centerY,
        startDistance: geometry.distance,
        scale: 1,
        pointers: points,
        event: sourceEvent || points[points.length - 1]?.sourceEvent || null,
        activeCount: active.size,
      });
      return true;
    }

    function stabilizedPinchGeometry(rawGeometry) {
      pinchGeometrySamples.push(rawGeometry);
      if (pinchGeometrySamples.length > 3) pinchGeometrySamples.shift();
      if (pinchGeometrySamples.length < 3) return rawGeometry;
      const [first, second, third] = pinchGeometrySamples;
      const medianDistance = medianOfThree(first.distance, second.distance, third.distance);
      const requestedScaleStep = medianDistance / Math.max(1, pinchFilteredDistance);
      const appliedScaleStep = Math.min(
        pinchMaxScaleStep,
        Math.max(pinchMinScaleStep, requestedScaleStep),
      );
      pinchFilteredDistance *= appliedScaleStep;
      return {
        centerX: medianOfThree(first.centerX, second.centerX, third.centerX),
        centerY: medianOfThree(first.centerY, second.centerY, third.centerY),
        distance: pinchFilteredDistance,
        rawCenterX: rawGeometry.centerX,
        rawCenterY: rawGeometry.centerY,
        rawDistance: rawGeometry.distance,
        requestedScaleStep,
        appliedScaleStep,
        scaleStepClamped: appliedScaleStep !== requestedScaleStep,
      };
    }

    function pointerDown(input) {
      const point = touchPoint(input);
      if (!point) return false;
      clearHoldTimer();
      const stored = {
        ...point,
        startX: point.x,
        startY: point.y,
        previousX: point.x,
        previousY: point.y,
      };
      active.set(point.id, stored);
      if (active.size === 1) {
        mode = 'pending';
        pinchStart = null;
        startHold(stored);
        call('onPressStart', gesturePayload(stored));
      } else {
        startPinch(point.sourceEvent);
      }
      return true;
    }

    function pointerMove(input) {
      const point = touchPoint(input);
      const current = point ? active.get(point.id) : null;
      if (!point || !current) return false;
      const previousX = current.x;
      const previousY = current.y;
      current.previousX = previousX;
      current.previousY = previousY;
      current.x = point.x;
      current.y = point.y;
      current.sourceEvent = point.sourceEvent;

      if (mode === 'pending') {
        const dx = current.x - current.startX;
        const dy = current.y - current.startY;
        if (dx * dx + dy * dy <= moveThresholdSq) return true;
        clearHoldTimer();
        mode = 'pan';
        call('onPanStart', gesturePayload(current));
        call('onPan', gesturePayload(current, { dx, dy }));
        return true;
      }

      if (mode === 'pan') {
        call('onPan', gesturePayload(current, {
          dx: current.x - previousX,
          dy: current.y - previousY,
        }));
        return true;
      }

      if (mode === 'pinch' && active.size >= 2 && pinchStart) {
        const points = activePoints(2);
        const geometry = stabilizedPinchGeometry(twoPointerGeometry(points));
        call('onPinch', {
          ...geometry,
          startCenterX: pinchStart.centerX,
          startCenterY: pinchStart.centerY,
          startDistance: pinchStart.distance,
          scale: geometry.distance / pinchStart.distance,
          pointers: points,
          event: point.sourceEvent,
          activeCount: active.size,
        });
      }
      return true;
    }

    function finishPointer(input, cancelled = false) {
      const point = touchPoint(input);
      const current = point ? active.get(point.id) : null;
      if (!point || !current) return false;
      clearHoldTimer();
      current.x = point.x;
      current.y = point.y;
      current.sourceEvent = point.sourceEvent;
      const finishedMode = mode;

      if (!cancelled && finishedMode === 'pending' && active.size === 1) {
        call('onTap', gesturePayload(current));
      }

      active.delete(point.id);
      if (finishedMode === 'pinch') {
        call('onPinchEnd', gesturePayload(current, { cancelled, activeCount: active.size }));
      }

      if (active.size >= 2) {
        startPinch(point.sourceEvent);
        return true;
      }

      if (active.size === 1 && finishedMode === 'pinch') {
        const remaining = activePoints(1)[0];
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        remaining.previousX = remaining.x;
        remaining.previousY = remaining.y;
        mode = 'pan';
        pinchStart = null;
        pinchGeometrySamples = [];
        call('onPanStart', gesturePayload(remaining, { resumedFromPinch: true }));
        return true;
      }

      if (active.size === 0) {
        mode = 'idle';
        pinchStart = null;
        pinchGeometrySamples = [];
        call('onGestureEnd', gesturePayload(current, { cancelled, finishedMode, activeCount: 0 }));
      }
      return true;
    }

    function cancel(reason = 'cancel') {
      if (!active.size && mode === 'idle') return false;
      const finishedMode = mode;
      const point = activePoints(1)[0] || null;
      clearHoldTimer();
      active.clear();
      mode = 'idle';
      pinchStart = null;
      pinchGeometrySamples = [];
      if (finishedMode === 'pinch') {
        call('onPinchEnd', gesturePayload(point, { cancelled: true, reason, activeCount: 0 }));
      }
      call('onGestureEnd', gesturePayload(point, {
        cancelled: true,
        reason,
        finishedMode,
        activeCount: 0,
      }));
      return true;
    }

    return Object.freeze({
      pointerDown,
      pointerMove,
      pointerUp: (input) => finishPointer(input, false),
      pointerCancel: (input) => finishPointer(input, true),
      cancel,
      hasPointer(pointerId) {
        return active.has(String(pointerId));
      },
      activeCount() {
        return active.size;
      },
      state() {
        return { mode, activeCount: active.size };
      },
    });
  }

  const api = Object.freeze({
    TOUCH_HOLD_DELAY_MS,
    TOUCH_MOVE_THRESHOLD_PX,
    PINCH_MAX_SCALE_STEP,
    createTouchGestureController,
    pinchViewportFromGesture,
  });
  root.BoardfishTouchInput = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof document === 'undefined' || !document.addEventListener || typeof canvas === 'undefined' || !canvas) {
    return;
  }

  const syntheticMouseEvents = new WeakSet();
  let touchPinchStartViewport = null;
  let suppressCompatibilityMouseUntil = 0;

  function touchInputNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function preventTouchDefault(event) {
    if (event?.cancelable) event.preventDefault();
  }

  function boardNavigationAllowed() {
    if (typeof isBoardInputBlocked !== 'function' || !isBoardInputBlocked()) return true;
    return typeof isBoardNavigationAllowedWhileBlocked === 'function' && isBoardNavigationAllowedWhileBlocked();
  }

  function boardPressAllowed() {
    return typeof isBoardInputBlocked !== 'function' || !isBoardInputBlocked();
  }

  function markTouchCompatibilityWindow() {
    suppressCompatibilityMouseUntil = touchInputNow() + 900;
  }

  function touchMouseTarget(point) {
    if (point?.target?.dispatchEvent && canvas.contains(point.target)) return point.target;
    const pointed = typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(point.x, point.y)
      : null;
    if (pointed?.dispatchEvent && canvas.contains(pointed)) return pointed;
    return boardCanvas || canvas;
  }

  function makeTouchMouseEvent(type, point, button, buttons) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: root,
      detail: 1,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x,
      screenY: point.y,
      button,
      buttons,
    });
    syntheticMouseEvents.add(event);
    return event;
  }

  function dispatchTouchLeftClick(point) {
    if (!boardPressAllowed()) return;
    const target = touchMouseTarget(point);
    target.dispatchEvent(makeTouchMouseEvent('mousedown', point, 0, 1));
    target.dispatchEvent(makeTouchMouseEvent('mouseup', point, 0, 0));
    target.dispatchEvent(makeTouchMouseEvent('click', point, 0, 0));
    if (editingId && _editEl && typeof focusTextEditProxyNow === 'function') {
      const obj = typeof objectsMap?.get === 'function' ? objectsMap.get(editingId) : null;
      focusTextEditProxyNow(_editEl, obj, 'touch-tap-focus', {
        phase: 'touch-tap',
        clientX: point.x,
        clientY: point.y,
      });
    }
  }

  function dispatchTouchRightClick(point) {
    if (!boardPressAllowed()) return;
    const target = touchMouseTarget(point);
    target.dispatchEvent(makeTouchMouseEvent('contextmenu', point, 2, 0));
  }

  function applyTouchPan(gesture) {
    if (!boardNavigationAllowed()) return;
    BoardfishViewportState.panBy(gesture.dx, gesture.dy);
    globalThis.BoardfishMotion?.applyActionAnimation?.('board-canvas-pan');
    scheduleTransform('touch-pan', gesture.event);
  }

  function beginTouchPinch() {
    touchPinchStartViewport = { panX, panY, zoom };
  }

  function applyTouchPinch(gesture) {
    if (!boardNavigationAllowed()) return;
    if (!touchPinchStartViewport) beginTouchPinch();
    const next = pinchViewportFromGesture(touchPinchStartViewport, gesture, {
      minZoom: typeof ZOOM_MIN === 'number' ? ZOOM_MIN : 0.01,
      maxZoom: typeof ZOOM_MAX === 'number' ? ZOOM_MAX : 100,
    });
    BoardfishViewportState.setZoomPan(next.zoom, next.panX, next.panY);
    globalThis.BoardfishMotion?.applyActionAnimation?.('board-wheel-zoom');
    scheduleTransform('touch-pinch-zoom', gesture.event);
  }

  const controller = createTouchGestureController({
    onTap: dispatchTouchLeftClick,
    onLongPress: dispatchTouchRightClick,
    onPan: applyTouchPan,
    onPinchStart: beginTouchPinch,
    onPinch: applyTouchPinch,
    onPinchEnd: () => { touchPinchStartViewport = null; },
    onGestureEnd: () => { touchPinchStartViewport = null; },
  });

  function shouldSuppressCompatibilityMouse(event) {
    if (syntheticMouseEvents.has(event)) return false;
    const firesTouchEvents = event?.sourceCapabilities?.firesTouchEvents;
    if (firesTouchEvents === false) return false;
    return controller.activeCount() > 0 || touchInputNow() <= suppressCompatibilityMouseUntil;
  }

  function suppressCompatibilityMouse(event) {
    if (!shouldSuppressCompatibilityMouse(event)) return;
    preventTouchDefault(event);
    event.stopImmediatePropagation();
  }

  for (const type of ['mousedown', 'mouseup', 'click', 'contextmenu']) {
    canvas.addEventListener(type, suppressCompatibilityMouse, true);
  }

  function captureTouchPointer(event) {
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch (_) {}
  }

  function releaseTouchPointer(event) {
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch (_) {}
  }

  function onTouchPointerDown(event) {
    if (event.pointerType !== 'touch') return;
    preventTouchDefault(event);
    markTouchCompatibilityWindow();
    if (!boardNavigationAllowed()) return;
    captureTouchPointer(event);
    controller.pointerDown(event);
  }

  function onTouchPointerMove(event) {
    if (event.pointerType !== 'touch' || !controller.hasPointer(event.pointerId)) return;
    preventTouchDefault(event);
    const coalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : null;
    if (coalesced?.length) {
      for (const sample of coalesced) controller.pointerMove(sample);
      return;
    }
    controller.pointerMove(event);
  }

  function onTouchPointerUp(event) {
    if (event.pointerType !== 'touch' || !controller.hasPointer(event.pointerId)) return;
    preventTouchDefault(event);
    markTouchCompatibilityWindow();
    controller.pointerUp(event);
    releaseTouchPointer(event);
  }

  function onTouchPointerCancel(event) {
    if (event.pointerType !== 'touch' || !controller.hasPointer(event.pointerId)) return;
    preventTouchDefault(event);
    markTouchCompatibilityWindow();
    controller.pointerCancel(event);
    releaseTouchPointer(event);
  }

  if ('PointerEvent' in root) {
    canvas.addEventListener('pointerdown', onTouchPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onTouchPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onTouchPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onTouchPointerCancel, { passive: false });
    canvas.addEventListener('lostpointercapture', onTouchPointerCancel, { passive: false });
  } else {
    const forEachChangedTouch = (event, callback) => {
      for (const touch of Array.from(event.changedTouches || [])) {
        callback({
          pointerId: touch.identifier,
          clientX: touch.clientX,
          clientY: touch.clientY,
          target: touch.target || event.target,
          sourceEvent: event,
        });
      }
    };
    canvas.addEventListener('touchstart', (event) => {
      preventTouchDefault(event);
      markTouchCompatibilityWindow();
      if (!boardNavigationAllowed()) return;
      forEachChangedTouch(event, (touch) => controller.pointerDown(touch));
    }, { passive: false });
    canvas.addEventListener('touchmove', (event) => {
      if (!controller.activeCount()) return;
      preventTouchDefault(event);
      forEachChangedTouch(event, (touch) => controller.pointerMove(touch));
    }, { passive: false });
    canvas.addEventListener('touchend', (event) => {
      if (!controller.activeCount()) return;
      preventTouchDefault(event);
      markTouchCompatibilityWindow();
      forEachChangedTouch(event, (touch) => controller.pointerUp(touch));
    }, { passive: false });
    canvas.addEventListener('touchcancel', (event) => {
      if (!controller.activeCount()) return;
      preventTouchDefault(event);
      markTouchCompatibilityWindow();
      forEachChangedTouch(event, (touch) => controller.pointerCancel(touch));
    }, { passive: false });
  }

  root.addEventListener?.('blur', () => controller.cancel('window-blur'));
  root.addEventListener?.('pagehide', () => controller.cancel('pagehide'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || document.visibilityState === 'hidden') controller.cancel('document-hidden');
  });
})(typeof window !== 'undefined' ? window : globalThis);
