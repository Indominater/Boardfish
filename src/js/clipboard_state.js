'use strict';

// ─── Clipboard state / native sequence tracking ──────────────────────────────
var jsClipboard = null;
var _jsClipboardSetAt = 0;
var _jsClipboardSequence = null;
var _jsClipboardSequencePromise = null;
var _jsClipboardNativeWritePending = false;
var _jsClipboardToken = 0;
var _jsClipboardWebToken = '';
var _jsClipboardWebTokenOnNative = false;
var _jsClipboardWebMaybeStale = false;
var _jsClipboardWebTokenCounter = 0;
var _pasteInProgress = false;
var _nativeClipboardWriteQueue = Promise.resolve();
var _nativeClipboardPendingCount = 0;
var _nativeClipboardLastError = '';
var _nativeClipboardIdleResolvers = [];
var _nativeClipboardOwnedSequences = new Set();

function nativeClipboardPendingCount() {
  return _nativeClipboardPendingCount;
}

function nativeClipboardLastError() {
  return _nativeClipboardLastError;
}

function resolveNativeClipboardIdleWaiters() {
  if (_nativeClipboardPendingCount > 0) return;
  const resolvers = _nativeClipboardIdleResolvers;
  _nativeClipboardIdleResolvers = [];
  for (const resolve of resolvers) resolve({ ready: true, error: _nativeClipboardLastError || '' });
}

function waitForNativeClipboardIdle(timeoutMs = 10000) {
  if (_nativeClipboardPendingCount <= 0) return Promise.resolve({ ready: true, error: _nativeClipboardLastError || '' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ready: false, pending: _nativeClipboardPendingCount, error: _nativeClipboardLastError || '' });
    }, timeoutMs);
    _nativeClipboardIdleResolvers.push((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function rememberOwnedClipboardSequence(seq) {
  if (seq === null || seq === undefined) return;
  _nativeClipboardOwnedSequences.add(seq);
  if (_nativeClipboardOwnedSequences.size > 50) {
    const oldest = _nativeClipboardOwnedSequences.values().next().value;
    _nativeClipboardOwnedSequences.delete(oldest);
  }
}

function clipboardSequenceChangedExternally(startSeq, currentSeq) {
  if (startSeq === null || currentSeq === null || startSeq === undefined || currentSeq === undefined) return false;
  return currentSeq !== startSeq && !_nativeClipboardOwnedSequences.has(currentSeq);
}

const createJsClipboardWebToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `bf-${crypto.randomUUID()}`;
  }
  _jsClipboardWebTokenCounter++;
  return `bf-${Date.now().toString(36)}-${_jsClipboardWebTokenCounter.toString(36)}`;
};

const getJsClipboardWebToken = () => _jsClipboardWebToken;

const markJsClipboardWebTokenOnNative = (token = _jsClipboardWebToken, dbg = null) => {
  const accepted = !!token && token === _jsClipboardWebToken && !!jsClipboard;
  if (accepted) {
    _jsClipboardWebTokenOnNative = true;
    _jsClipboardWebMaybeStale = false;
  }
  ClipDebug.step(dbg, 'mark-js-clipboard-web-token', {
    token,
    currentToken: _jsClipboardWebToken,
    accepted,
  });
  return accepted;
};

const markJsClipboardMaybeStaleFromWebBlur = () => {
  if (!jsClipboard || hasTauri()) return;
  _jsClipboardWebMaybeStale = true;
};

function enqueueNativeClipboardWrite(task, dbg = null, meta = {}) {
  const queuedAt = performance.now();
  _nativeClipboardPendingCount++;
  _nativeClipboardLastError = '';
  ClipDebug.step(dbg, 'native-copy-queued', { ...meta, nativePending: _nativeClipboardPendingCount });
  const run = _nativeClipboardWriteQueue.catch(() => {}).then(async () => {
    ClipDebug.step(dbg, 'native-copy-start', { ...meta, nativePending: _nativeClipboardPendingCount, queueMs: Math.round((performance.now() - queuedAt) * 100) / 100 });
    try {
      return await task();
    } catch (err) {
      _nativeClipboardLastError = String(err);
      throw err;
    } finally {
      _nativeClipboardPendingCount = Math.max(0, _nativeClipboardPendingCount - 1);
      ClipDebug.step(dbg, 'native-copy-finished', { ...meta, nativePending: _nativeClipboardPendingCount });
      resolveNativeClipboardIdleWaiters();
    }
  });
  _nativeClipboardWriteQueue = run.catch(() => {});
  return run;
}

async function getNativeClipboardSequence(dbg = null) {
  if (!hasTauri()) return null;
  try {
    return await ClipDebug.wrap(dbg, TAURI_COMMANDS.CLIPBOARD_SEQUENCE, () => BoardfishTauri.clipboardSequence());
  } catch {
    return null;
  }
}

function markJsClipboardSequence(token = _jsClipboardToken, dbg = null) {
  const promise = (async () => {
    const seq = await getNativeClipboardSequence(dbg);
    rememberOwnedClipboardSequence(seq);
    if (seq !== null && jsClipboard && token === _jsClipboardToken) _jsClipboardSequence = seq;
    ClipDebug.step(dbg, 'mark-js-clipboard-sequence', { seq, token, currentToken: _jsClipboardToken, accepted: seq !== null && token === _jsClipboardToken });
    return seq;
  })();
  if (token === _jsClipboardToken) _jsClipboardSequencePromise = promise;
  return promise;
}

function finishNativeClipboardWrite(token, dbg = null) {
  return markJsClipboardSequence(token, dbg).finally(() => {
    if (token === _jsClipboardToken) _jsClipboardNativeWritePending = false;
  });
}

function setJsClipboard(value, trackNative = false, nativeWritePending = false) {
  jsClipboard = value;
  _jsClipboardSetAt = Date.now();
  _jsClipboardSequence = null;
  _jsClipboardSequencePromise = null;
  _jsClipboardNativeWritePending = nativeWritePending;
  _jsClipboardWebToken = createJsClipboardWebToken();
  _jsClipboardWebTokenOnNative = false;
  _jsClipboardWebMaybeStale = false;
  const token = ++_jsClipboardToken;
  if (trackNative) markJsClipboardSequence(token);
  return token;
}

function clearJsClipboard() {
  jsClipboard = null;
  _jsClipboardSequence = null;
  _jsClipboardSequencePromise = null;
  _jsClipboardNativeWritePending = false;
  _jsClipboardWebToken = '';
  _jsClipboardWebTokenOnNative = false;
  _jsClipboardWebMaybeStale = false;
  _jsClipboardToken++;
}

async function jsClipboardStillCurrent(dbg = null, options = {}) {
  if (!jsClipboard) return false;
  if (!hasTauri()) {
    const clipboardTokenChecked = options.webClipboardTokenChecked === true;
    const clipboardToken = options.webClipboardToken || '';
    if (clipboardTokenChecked && (_jsClipboardWebTokenOnNative || clipboardToken)) {
      const current = !!clipboardToken && clipboardToken === _jsClipboardWebToken;
      ClipDebug.step(dbg, 'validate-js-clipboard-web-token', {
        clipboardToken,
        expected: _jsClipboardWebToken,
        tokenOnNative: _jsClipboardWebTokenOnNative,
        current,
      });
      return current;
    }
    const age = Date.now() - _jsClipboardSetAt;
    const current = !_jsClipboardWebMaybeStale || age < 750;
    ClipDebug.step(dbg, 'validate-js-clipboard-web-untracked', {
      current,
      maybeStale: _jsClipboardWebMaybeStale,
      age,
    });
    return current;
  }
  if (_jsClipboardSequence === null && _jsClipboardSequencePromise) {
    await _jsClipboardSequencePromise.catch(() => null);
  }
  if (_jsClipboardSequence === null) {
    const age = Date.now() - _jsClipboardSetAt;
    const current = !hasTauri() || _jsClipboardNativeWritePending || age < 750;
    ClipDebug.step(dbg, 'validate-js-clipboard-untracked', { current, nativeWritePending: _jsClipboardNativeWritePending, age });
    return current;
  }
  const seq = await getNativeClipboardSequence(dbg);
  const current = seq === null || seq === _jsClipboardSequence;
  ClipDebug.step(dbg, 'validate-js-clipboard', { seq, expected: _jsClipboardSequence, current });
  return current;
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', markJsClipboardMaybeStaleFromWebBlur);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') markJsClipboardMaybeStaleFromWebBlur();
  });
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    getJsClipboardWebToken,
    markJsClipboardWebTokenOnNative,
  });
}
