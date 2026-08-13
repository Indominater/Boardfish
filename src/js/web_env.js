'use strict';

/* BOARDFISH_DEV_DIAGNOSTICS_START */
(function initBoardfishWebEnv(root) {
  if (Object.prototype.hasOwnProperty.call(root, '__BOARDFISH_DEBUG_TOOLS_ENABLED__')) return;
  Object.defineProperty(root, '__BOARDFISH_DEBUG_TOOLS_ENABLED__', {
    value: false,
  });
}(globalThis));
/* BOARDFISH_DEV_DIAGNOSTICS_END */

(function registerBoardfishServiceWorker(root) {
  if (!root.navigator?.serviceWorker || !root.location) return;
  const { protocol, hostname } = root.location;
  const canRegister =
    protocol === 'https:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1';
  if (!canRegister) return;

  root.addEventListener?.('load', () => {
    root.navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('[Boardfish] service worker registration failed:', error);
    });
  });
}(globalThis));
