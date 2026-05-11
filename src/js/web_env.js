'use strict';

(function initBoardfishWebEnv(root) {
  if (Object.prototype.hasOwnProperty.call(root, '__BOARDFISH_WEB_DEV_MODE__')) return;
  Object.defineProperty(root, '__BOARDFISH_WEB_DEV_MODE__', {
    value: false,
    writable: false,
    configurable: false,
  });
}(globalThis));
