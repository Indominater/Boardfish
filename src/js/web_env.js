'use strict';

(function initBoardfishWebEnv(root) {
  if (Object.prototype.hasOwnProperty.call(root, '__BOARDFISH_WEB_DEV_MODE__')) return;
  Object.defineProperty(root, '__BOARDFISH_WEB_DEV_MODE__', {
    value: false,
    writable: false,
    configurable: false,
  });
}(globalThis));

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
