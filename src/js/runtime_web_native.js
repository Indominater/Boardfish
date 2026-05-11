'use strict';

(function initWebNativeRuntime(root) {
  function hasTauri() {
    return false;
  }

  function tauriInvoke() {
    throw new Error('Tauri is unavailable');
  }

  function tauriListen() {
    throw new Error('Tauri is unavailable');
  }

  function tauriConvertFileSrc(path) {
    return path;
  }

  root.BoardfishTauri = Object.freeze({});
  root.hasTauri = hasTauri;
  root.tauriInvoke = tauriInvoke;
  root.tauriListen = tauriListen;
  root.tauriConvertFileSrc = tauriConvertFileSrc;
})(typeof window !== 'undefined' ? window : globalThis);
