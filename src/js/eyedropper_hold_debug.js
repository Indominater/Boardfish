'use strict';

(function initEyedropperHoldDebug(root) {
  const roundMs = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : '';
  };

  function keyboardEventAgeMs(e, now = performance.now()) {
    const timeStamp = Number(e?.timeStamp);
    if (!Number.isFinite(timeStamp) || timeStamp <= 0) return '';
    if (timeStamp > now + 100000 && typeof Date.now === 'function') return roundMs(Math.max(0, Date.now() - timeStamp));
    return roundMs(Math.max(0, now - timeStamp));
  }

  function lastMouseSnapshot(now = performance.now()) {
    const last = typeof root._eyedropperLastMouseEvent !== 'undefined' ? root._eyedropperLastMouseEvent : null;
    return {
      hasLastMouse: !!last,
      lastMouseX: last?.clientX ?? '',
      lastMouseY: last?.clientY ?? '',
      lastMouseAgeMs: last?.receivedAt ? roundMs(Math.max(0, now - last.receivedAt)) : '',
      lastMouseInputAgeMs: last?.inputAgeAtReceiveMs ?? '',
    };
  }

  function cardState() {
    const card = typeof root.eyedropperActiveCard !== 'undefined' ? root.eyedropperActiveCard : root.eyedropperCard;
    const classes = card?.el?.classList;
    return {
      loupeVisible: !!classes?.contains('visible'),
      loupePinned: !!classes?.contains('pinned'),
      pendingPinnedClone: !!card?.pendingPinnedClone,
    };
  }

  function log(event, meta = {}) {
    root.EyedropperDebug?._logSamplingEvent?.(event, meta);
  }

  function beginShiftKeyDebug(e, meta = {}) {
    const activationAt = Number(meta.keyDownAt ?? performance.now());
    const out = {
      activationAt,
      activationEventType: e?.type || '',
      activationKey: e?.key || '',
      activationCode: e?.code || '',
      activationInputAgeAtReceiveMs: keyboardEventAgeMs(e, activationAt),
    };
    log('shift-keydown-start', {
      ...out,
      keyId: meta.keyId || '',
      repeat: !!e?.repeat,
      hasOtherKeyDown: !!meta.hasOtherKeyDown,
      activeKeyCount: meta.activeKeyCount ?? '',
      editing: !!root.editingId,
      enabledBefore: typeof root.eyedropperEnabled !== 'undefined' ? !!root.eyedropperEnabled : '',
      holdActiveBefore: typeof root._eyedropperHoldActive !== 'undefined' ? !!root._eyedropperHoldActive : '',
      samplingBefore: typeof root.eyedropperSampling !== 'undefined' ? !!root.eyedropperSampling : '',
      ...cardState(),
      ...lastMouseSnapshot(activationAt),
    });
    return out;
  }

  function finishShiftKeyDebug(e, meta = {}) {
    const at = performance.now();
    log('shift-keydown-finish', {
      activationAt: roundMs(meta.activationAt),
      activationInputAgeAtReceiveMs: meta.activationInputAgeAtReceiveMs ?? '',
      enableMs: roundMs(meta.enableMs),
      beginHoldMs: roundMs(meta.beginHoldMs),
      totalMs: roundMs(meta.totalMs ?? (at - Number(meta.activationAt || at))),
      holdStarted: !!meta.holdStarted,
      defaultPrevented: !!e?.defaultPrevented,
      enabledAfter: typeof root.eyedropperEnabled !== 'undefined' ? !!root.eyedropperEnabled : '',
      holdActiveAfter: typeof root._eyedropperHoldActive !== 'undefined' ? !!root._eyedropperHoldActive : '',
      samplingAfter: typeof root.eyedropperSampling !== 'undefined' ? !!root.eyedropperSampling : '',
      ...cardState(),
      ...lastMouseSnapshot(at),
    });
  }

  function logShiftKeyup(e, meta = {}) {
    const at = Number(meta.keyUpAt ?? performance.now());
    log('shift-keyup', {
      key: e?.key || '',
      code: e?.code || '',
      inputAgeAtReceiveMs: keyboardEventAgeMs(e, at),
      endedHold: !!meta.endedHold,
      enabledAfter: typeof root.eyedropperEnabled !== 'undefined' ? !!root.eyedropperEnabled : '',
      holdActiveAfter: typeof root._eyedropperHoldActive !== 'undefined' ? !!root._eyedropperHoldActive : '',
      samplingAfter: typeof root.eyedropperSampling !== 'undefined' ? !!root.eyedropperSampling : '',
      ...cardState(),
      ...lastMouseSnapshot(at),
    });
  }

  function attachActivationTiming(sourceEvent, activation = {}, holdStartAt = performance.now()) {
    if (!sourceEvent || typeof sourceEvent !== 'object') return sourceEvent;
    sourceEvent.activationAt = Number(activation?.activationAt);
    sourceEvent.activationEventType = activation?.activationEventType || '';
    sourceEvent.activationInputAgeAtReceiveMs = activation?.activationInputAgeAtReceiveMs ?? '';
    sourceEvent.holdStartAt = holdStartAt;
    return sourceEvent;
  }

  function beginHoldDebug(e, activation = {}, holdStartAt = performance.now()) {
    log('hold-begin-start', {
      activationAt: roundMs(activation?.activationAt),
      activationInputAgeAtReceiveMs: activation?.activationInputAgeAtReceiveMs ?? '',
      activationToHoldStartMs: Number.isFinite(Number(activation?.activationAt)) ? roundMs(holdStartAt - Number(activation.activationAt)) : '',
      sourceEventType: e?.type || '',
      sourceHasPoint: e?.clientX != null && e?.clientY != null,
      enabledBefore: typeof root.eyedropperEnabled !== 'undefined' ? !!root.eyedropperEnabled : '',
      holdActiveBefore: typeof root._eyedropperHoldActive !== 'undefined' ? !!root._eyedropperHoldActive : '',
      samplingBefore: typeof root.eyedropperSampling !== 'undefined' ? !!root.eyedropperSampling : '',
      ...cardState(),
      ...lastMouseSnapshot(holdStartAt),
    });
  }

  function finishHoldDebug(meta = {}) {
    const now = performance.now();
    const activationAt = Number(meta.activation?.activationAt);
    const holdStartAt = Number(meta.holdStartAt);
    const sourceReceivedAt = Number(meta.sourceEvent?.receivedAt);
    log('hold-begin-finish', {
      activationAt: roundMs(activationAt),
      activationInputAgeAtReceiveMs: meta.activation?.activationInputAgeAtReceiveMs ?? '',
      activationToHoldFinishMs: Number.isFinite(activationAt) ? roundMs(now - activationAt) : '',
      activationToCardReadyMs: Number.isFinite(activationAt) ? roundMs(now - activationAt) : '',
      holdToCardReadyMs: Number.isFinite(holdStartAt) ? roundMs(now - holdStartAt) : '',
      totalMs: roundMs(meta.totalMs ?? (Number.isFinite(holdStartAt) ? now - holdStartAt : '')),
      prepareMs: roundMs(meta.prepareMs),
      commitMs: roundMs(meta.commitMs),
      sourceEventType: meta.sourceEvent?.activationEventType || '',
      sourceX: meta.sourceEvent?.clientX ?? '',
      sourceY: meta.sourceEvent?.clientY ?? '',
      sourceMouseAgeAtHoldStartMs: Number.isFinite(sourceReceivedAt) && Number.isFinite(holdStartAt) ? roundMs(holdStartAt - sourceReceivedAt) : '',
      hadSourceEvent: !!meta.sourceEvent,
      sampleVisible: typeof root.isEyedropperSampleVisible === 'function' ? root.isEyedropperSampleVisible() : '',
      enabledAfter: typeof root.eyedropperEnabled !== 'undefined' ? !!root.eyedropperEnabled : '',
      holdActiveAfter: typeof root._eyedropperHoldActive !== 'undefined' ? !!root._eyedropperHoldActive : '',
      samplingAfter: typeof root.eyedropperSampling !== 'undefined' ? !!root.eyedropperSampling : '',
      ...cardState(),
    });
  }

  Object.assign(root, {
    beginEyedropperShiftKeyDebug: beginShiftKeyDebug,
    finishEyedropperShiftKeyDebug: finishShiftKeyDebug,
    logEyedropperShiftKeyupDebug: logShiftKeyup,
    attachEyedropperActivationTiming: attachActivationTiming,
    beginEyedropperHoldDebug: beginHoldDebug,
    finishEyedropperHoldDebug: finishHoldDebug,
    logEyedropperShortcutDebug: log,
  });
})(typeof window !== 'undefined' ? window : globalThis);
