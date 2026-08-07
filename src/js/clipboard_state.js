'use strict';

// Clipboard state for in-app object copy/paste plus browser clipboard tokens.
var jsClipboard = null;
var _jsClipboardSetAt = 0;
var _jsClipboardToken = 0;
var _jsClipboardWebToken = '';
var _jsClipboardWebTokenWritten = false;
var _jsClipboardWebMaybeStale = false;
var _jsClipboardWebTokenCounter = 0;
var _pasteInProgress = false;

const createJsClipboardWebToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `bf-${crypto.randomUUID()}`;
  }
  _jsClipboardWebTokenCounter++;
  return `bf-${Date.now().toString(36)}-${_jsClipboardWebTokenCounter.toString(36)}`;
};

const getJsClipboardWebToken = () => _jsClipboardWebToken;

const markJsClipboardWebTokenWritten = (token = _jsClipboardWebToken
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  , dbg = null
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
) => {
  const accepted = !!token && token === _jsClipboardWebToken && !!jsClipboard;
  if (accepted) {
    _jsClipboardWebTokenWritten = true;
    _jsClipboardWebMaybeStale = false;
  }
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  ClipDebug.step(dbg, 'mark-js-clipboard-web-token', {
    token,
    currentToken: _jsClipboardWebToken,
    accepted,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  return accepted;
};

const markJsClipboardMaybeStaleFromWebBlur = () => {
  if (!jsClipboard) return;
  _jsClipboardWebMaybeStale = true;
};

function setJsClipboard(value) {
  jsClipboard = value;
  _jsClipboardSetAt = Date.now();
  _jsClipboardWebToken = createJsClipboardWebToken();
  _jsClipboardWebTokenWritten = false;
  _jsClipboardWebMaybeStale = false;
  return ++_jsClipboardToken;
}

function clearJsClipboard() {
  jsClipboard = null;
  _jsClipboardWebToken = '';
  _jsClipboardWebTokenWritten = false;
  _jsClipboardWebMaybeStale = false;
  _jsClipboardToken++;
}

function jsClipboardStillCurrent(
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  dbg = null,
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
  options = {}
) {
  if (!jsClipboard) return false;
  const clipboardTokenChecked = options.webClipboardTokenChecked === true;
  const clipboardToken = options.webClipboardToken || '';
  if (clipboardTokenChecked && (_jsClipboardWebTokenWritten || clipboardToken)) {
    const current = !!clipboardToken && clipboardToken === _jsClipboardWebToken;
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    ClipDebug.step(dbg, 'validate-js-clipboard-web-token', {
      clipboardToken,
      expected: _jsClipboardWebToken,
      tokenWritten: _jsClipboardWebTokenWritten,
      current,
    });
    /* BOARDFISH_DEV_DIAGNOSTICS_END */
    return current;
  }
  const age = Date.now() - _jsClipboardSetAt;
  const current = !_jsClipboardWebMaybeStale || age < 750;
  /* BOARDFISH_DEV_DIAGNOSTICS_START */
  ClipDebug.step(dbg, 'validate-js-clipboard-web-untracked', {
    current,
    maybeStale: _jsClipboardWebMaybeStale,
    age,
  });
  /* BOARDFISH_DEV_DIAGNOSTICS_END */
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
    markJsClipboardWebTokenWritten,
  });
}
