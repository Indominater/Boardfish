'use strict';

(function initImageStoreBoundary(root) {
  function getSource(key) {
    return imageStore[key];
  }

  function hasSource(key) {
    return !!imageStore[key];
  }

  function setSource(key, source) {
    if (!key) return false;
    imageStore[key] = source;
    if (typeof noteEyedropperImageSourceChanged === 'function') {
      noteEyedropperImageSourceChanged(key, 'image-source');
    }
    return true;
  }

  function setSources(nextSources = {}) {
    Object.assign(imageStore, nextSources || {});
    if (typeof noteEyedropperBoardContentChanged === 'function') {
      noteEyedropperBoardContentChanged('image-sources');
    }
    return imageStore;
  }

  function getDisplayImage(key) {
    return imageCache[key] || null;
  }

  function hasDisplayImage(key) {
    return !!imageCache[key];
  }

  function sourceKeys() {
    return Object.keys(imageStore || {});
  }

  root.BoardfishImageStore = Object.freeze({
    getDisplayImage,
    getSource,
    hasDisplayImage,
    hasSource,
    setSource,
    setSources,
    sourceKeys,
  });
})(typeof window !== 'undefined' ? window : globalThis);
