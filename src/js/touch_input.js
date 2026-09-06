'use strict';

(function initBoardfishTouchInput(root) {
  const TOUCH_HOLD_DELAY_MS = 500;
  const TOUCH_MOVE_THRESHOLD_PX = 8;

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

  function createTouchGestureController(options = {}) {
    const holdDelayMs = Number.isFinite(options.holdDelayMs)
      ? Math.max(0, options.holdDelayMs)
      : TOUCH_HOLD_DELAY_MS;
    const moveThresholdPx = Number.isFinite(options.moveThresholdPx)
      ? Math.max(0, options.moveThresholdPx)
      : TOUCH_MOVE_THRESHOLD_PX;
    const moveThresholdSq = moveThresholdPx * moveThresholdPx;
    const scheduleTimer = options.scheduleTimer || ((callback, delay) => setTimeout(callback, delay));
    const cancelTimer = options.cancelTimer || ((timer) => clearTimeout(timer));
    const active = new Map();
    let mode = 'idle';
    let holdTimer = null;
    let pinchX, pinchY, pinchDistance = 0;

    const call = (name, payload) => {
      if (typeof options[name] === 'function') options[name](payload);
    };

    function clearHoldTimer() {
      if (holdTimer === null) return;
      cancelTimer(holdTimer);
      holdTimer = null;
    }

    function gesturePayload(point, extra = {}) {
      extra.x = point?.x;
      extra.y = point?.y;
      extra.startX = point?.startX;
      extra.startY = point?.startY;
      extra.target = point?.target || null;
      extra.event = point?.sourceEvent || null;
      return extra;
    }

    function startHold(point) {
      const pointerId = point.pointerId;
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
      const geometry = twoPointerGeometry(active.values());
      mode = 'pinch';
      pinchX = geometry.startCenterX = geometry.centerX;
      pinchY = geometry.startCenterY = geometry.centerY;
      pinchDistance = geometry.distance;
      geometry.scale = 1;
      geometry.event = sourceEvent;
      call('onPinchStart', geometry);
    }

    function emitPinch(point) {
      if (mode !== 'pinch' || active.size < 2 || !pinchDistance) return false;
      const geometry = twoPointerGeometry(active.values());
      geometry.startCenterX = pinchX;
      geometry.startCenterY = pinchY;
      geometry.scale = geometry.distance / pinchDistance;
      geometry.event = point?.sourceEvent || null;
      call('onPinch', geometry);
      return true;
    }

    function updateActivePoint(input, sourceEvent = null) {
      if (!input) return null;
      const pointerId = input.pointerId ?? input.identifier;
      const x = input.clientX;
      const y = input.clientY;
      const current = active.get(pointerId);
      if (!current) return null;
      if (input.pointerType === 'touch') preventTouchDefault(input);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      current.previousX = current.x;
      current.previousY = current.y;
      current.x = x;
      current.y = y;
      current.sourceEvent = sourceEvent || input.sourceEvent || input;
      return current;
    }

    function pointerDown(input, sourceEvent = null) {
      const pointerId = input?.pointerId ?? input?.identifier;
      const x = input?.clientX;
      const y = input?.clientY;
      if (pointerId === undefined || pointerId === null || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      clearHoldTimer();
      const event = sourceEvent || input.sourceEvent || input;
      const stored = {
        pointerId, x, y,
        target: input.target || event?.target || null,
        sourceEvent: event,
        startX: x, startY: y,
        previousX: x, previousY: y,
      };
      active.set(pointerId, stored);
      if (active.size === 1) {
        mode = 'pending';
        pinchDistance = 0;
        startHold(stored);
        call('onPressStart', gesturePayload(stored));
      } else {
        startPinch(event);
      }
      return true;
    }

    function pointerMove(input, sourceEvent = null) {
      const current = updateActivePoint(input, sourceEvent);
      if (!current) return false;

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
        const dx = current.x - current.previousX, dy = current.y - current.previousY;
        if (dx || dy) call('onPan', gesturePayload(current, { dx, dy }));
        return true;
      }

      if (current.x - current.previousX || current.y - current.previousY) emitPinch(current);
      return true;
    }

    function pointerMoves(inputs, sourceEvent = null) {
      if (mode !== 'pinch' || active.size < 2) {
        let handled = false;
        for (let i = 0; i < (inputs?.length || 0); i++) handled = pointerMove(inputs[i], sourceEvent) || handled;
        return handled;
      }

      // Touch Events expose one coherent snapshot containing both contacts.
      // Update the complete snapshot before deriving its absolute scale so
      // event ordering and movement speed cannot affect the zoom ratio.
      let lastPoint = null;
      for (let i = 0; i < (inputs?.length || 0); i++) {
        const current = updateActivePoint(inputs[i], sourceEvent);
        if (current && (current.x - current.previousX || current.y - current.previousY)) lastPoint = current;
      }
      return lastPoint ? emitPinch(lastPoint) : false;
    }

    function finishPointer(input, cancelled = false, sourceEvent = null) {
      const current = updateActivePoint(input, sourceEvent);
      if (!current) return false;
      clearHoldTimer();
      const finishedMode = mode;

      // Commit the exact final separation before removing either pointer. This
      // also confirms a legitimate last move without repeating a committed one.
      if (!cancelled && finishedMode === 'pinch' &&
          (current.x - current.previousX || current.y - current.previousY)) emitPinch(current);

      if (!cancelled && finishedMode === 'pending' && active.size === 1) {
        call('onTap', gesturePayload(current));
      }

      active.delete(current.pointerId);
      if (finishedMode === 'pinch') {
        call('onPinchEnd', gesturePayload(current, { cancelled }));
      }

      if (active.size >= 2) {
        startPinch(current.sourceEvent);
        return true;
      }

      if (active.size === 1 && finishedMode === 'pinch') {
        const remaining = active.values().next().value;
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        remaining.previousX = remaining.x;
        remaining.previousY = remaining.y;
        mode = 'pan';
        pinchDistance = 0;
        call('onPanStart', gesturePayload(remaining, { resumedFromPinch: true }));
        return true;
      }

      if (active.size === 0) {
        mode = 'idle';
        pinchDistance = 0;
        call('onGestureEnd', gesturePayload(current, { cancelled, finishedMode }));
      }
      return true;
    }

    function cancel(reason = 'cancel') {
      if (!active.size && mode === 'idle') return false;
      const finishedMode = mode;
      const point = active.values().next().value || null;
      clearHoldTimer();
      active.clear();
      mode = 'idle';
      pinchDistance = 0;
      if (finishedMode === 'pinch') {
        call('onPinchEnd', gesturePayload(point, { cancelled: true, reason }));
      }
      call('onGestureEnd', gesturePayload(point, {
        cancelled: true,
        reason,
        finishedMode,
      }));
      return true;
    }

    return Object.freeze({
      pointerDown,
      pointerMove,
      pointerMoves,
      pointerUp: (input, sourceEvent = null) => finishPointer(input, false, sourceEvent),
      pointerCancel: (input, sourceEvent = null) => finishPointer(input, true, sourceEvent),
      cancel,
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
    createTouchGestureController,
  });
  root.BoardfishTouchInput = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof document === 'undefined' || !document.addEventListener || typeof canvas === 'undefined' || !canvas) {
    return;
  }

  let touchPinchStartViewport = null;
  let touchSelectionDrag = null;
  let suppressCompatibilityMouseUntil = 0;

  const touchInputNow = () => root.performance?.now?.() ?? Date.now();

  function preventTouchDefault(event) {
    if (event?.cancelable) event.preventDefault();
  }

  function boardNavigationAllowed() {
    return !isBoardInputBlocked() || isBoardNavigationAllowedWhileBlocked();
  }

  function boardPressAllowed() {
    return !isBoardInputBlocked();
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
    return new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX: point.x,
      clientY: point.y,
      button,
      buttons,
    });
  }

  function dispatchTouchLeftClick(point) {
    if (!boardPressAllowed()) return;
    const target = touchMouseTarget(point);
    target.dispatchEvent(makeTouchMouseEvent('mousedown', point, 0, 1));
    target.dispatchEvent(makeTouchMouseEvent('mouseup', point, 0, 0));
    if (editingId && _editEl) {
      focusTextEditProxyNow(_editEl
        /* BOARDFISH_DEV_DIAGNOSTICS_START */
        , typeof objectsMap?.get === 'function' ? objectsMap.get(editingId) : null,
        'touch-tap-focus', {
          phase: 'touch-tap',
          clientX: point.x,
          clientY: point.y,
        }
        /* BOARDFISH_DEV_DIAGNOSTICS_END */
      );
    }
  }

  function dispatchTouchRightClick(point) {
    if (!boardPressAllowed()) return;
    const target = touchMouseTarget(point);
    target.dispatchEvent(makeTouchMouseEvent('contextmenu', point, 2, 0));
  }

  function beginTouchPan(gesture) {
    if (gesture?.resumedFromPinch || !boardPressAllowed()) return false;
    const drag = startSelectedRegionDrag({
      clientX: gesture.startX,
      clientY: gesture.startY,
    });
    if (!drag) return false;
    touchSelectionDrag = drag;
    return true;
  }

  function finishTouchSelectionDrag(gesture = null) {
    if (!touchSelectionDrag) return false;
    const drag = touchSelectionDrag;
    touchSelectionDrag = null;
    drag.move(gesture?.x, gesture?.y);
    drag.finish();
    return true;
  }

  function applyTouchPan(gesture) {
    if (touchSelectionDrag) {
      touchSelectionDrag.move(gesture.x, gesture.y);
      return;
    }
    if (!boardNavigationAllowed()) return;
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleTransform(BoardfishViewportState.panBy(gesture.dx, gesture.dy), 'touch-pan', gesture.event);
    else scheduleTransform(BoardfishViewportState.panBy(gesture.dx, gesture.dy));
  }

  function beginTouchPinch() {
    finishTouchSelectionDrag();
    touchPinchStartViewport = { panX, panY, zoom };
  }

  function applyTouchPinch(gesture) {
    if (!boardNavigationAllowed()) return;
    const start = touchPinchStartViewport;
    if (!start) return;
    const nextZoom = BoardfishBoardTypes.clampZoom(start.zoom * gesture.scale, start.zoom);
    const scale = nextZoom / start.zoom;
    const changed = BoardfishViewportState.setZoomPan(
      nextZoom,
      gesture.centerX - (gesture.startCenterX - start.panX) * scale,
      gesture.centerY - (gesture.startCenterY - start.panY) * scale,
    );
    if (typeof BOARDFISH_PRODUCTION === 'undefined') scheduleTransform(changed, 'touch-pinch-zoom', gesture.event);
    else scheduleTransform(changed);
  }

  function finishTouchPinch() {
    touchPinchStartViewport = null;
  }

  const controller = createTouchGestureController({
    onTap: dispatchTouchLeftClick,
    onLongPress: dispatchTouchRightClick,
    onPanStart: beginTouchPan,
    onPan: applyTouchPan,
    onPinchStart: beginTouchPinch,
    onPinch: applyTouchPinch,
    onPinchEnd: () => {
      if (controller.activeCount() < 2) finishTouchPinch();
    },
    onGestureEnd: (gesture) => {
      finishTouchSelectionDrag(gesture);
      if (touchPinchStartViewport) finishTouchPinch();
    },
  });

  function shouldSuppressCompatibilityMouse(event) {
    if (!event.isTrusted) return false;
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
    captureTouchPointer(event);
    controller.pointerDown(event);
  }

  function onTouchPointerMove(event) {
    if (event.pointerType !== 'touch') return;
    controller.pointerMove(event);
  }

  function onTouchPointerUp(event) {
    if (event.pointerType !== 'touch' || !controller.pointerUp(event)) return;
    markTouchCompatibilityWindow();
    releaseTouchPointer(event);
  }

  function onTouchPointerCancel(event) {
    if (event.pointerType !== 'touch' || !controller.pointerCancel(event)) return;
    markTouchCompatibilityWindow();
    releaseTouchPointer(event);
  }

  const forEachChangedTouch = (event, callback) => {
    for (let i = 0; i < (event.changedTouches?.length || 0); i++) callback(event.changedTouches[i], event);
  };
  const useAtomicTouchEvents = (
    typeof root.TouchEvent === 'function' && Number(root.navigator?.maxTouchPoints) > 0
  ) || !('PointerEvent' in root);

  if (useAtomicTouchEvents) {
    canvas.addEventListener('touchstart', (event) => {
      preventTouchDefault(event);
      markTouchCompatibilityWindow();
      if (!boardNavigationAllowed()) return;
      forEachChangedTouch(event, controller.pointerDown);
    }, { passive: false });
    canvas.addEventListener('touchmove', (event) => {
      if (!controller.activeCount()) return;
      preventTouchDefault(event);
      controller.pointerMoves(event.touches, event);
    }, { passive: false });
    canvas.addEventListener('touchend', (event) => {
      if (!controller.activeCount()) return;
      preventTouchDefault(event);
      markTouchCompatibilityWindow();
      if (controller.state().mode === 'pinch') {
        // A single touchend can report final coordinates for both contacts.
        // Commit that complete snapshot before removing either pointer so the
        // last zoom value cannot depend on changedTouches iteration order.
        const finalTouchSnapshot = Array.from(event.touches || []);
        forEachChangedTouch(event, (touch) => finalTouchSnapshot.push(touch));
        controller.pointerMoves(finalTouchSnapshot, event);
      }
      forEachChangedTouch(event, controller.pointerUp);
    }, { passive: false });
    canvas.addEventListener('touchcancel', (event) => {
      if (!controller.activeCount()) return;
      preventTouchDefault(event);
      markTouchCompatibilityWindow();
      forEachChangedTouch(event, controller.pointerCancel);
    }, { passive: false });
  } else {
    canvas.addEventListener('pointerdown', onTouchPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onTouchPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onTouchPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onTouchPointerCancel, { passive: false });
    canvas.addEventListener('lostpointercapture', onTouchPointerCancel, { passive: false });
  }

  root.addEventListener?.('blur', () => controller.cancel('window-blur'));
  root.addEventListener?.('pagehide', () => controller.cancel('pagehide'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || document.visibilityState === 'hidden') controller.cancel('document-hidden');
  });
})(typeof window !== 'undefined' ? window : globalThis);
