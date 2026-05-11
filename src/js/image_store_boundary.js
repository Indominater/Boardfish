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
    if (imageStore[key] && imageStore[key] !== source && typeof BoardfishWebBoardContainer !== 'undefined') {
      BoardfishWebBoardContainer.revokeImageSource?.(imageStore[key]);
    }
    imageStore[key] = source;
    if (typeof noteEyedropperImageSourceChanged === 'function') {
      noteEyedropperImageSourceChanged(key, 'image-source');
    }
    return true;
  }

  function setSources(nextSources = {}) {
    for (const [key, source] of Object.entries(nextSources || {})) {
      if (imageStore[key] && imageStore[key] !== source && typeof BoardfishWebBoardContainer !== 'undefined') {
        BoardfishWebBoardContainer.revokeImageSource?.(imageStore[key]);
      }
    }
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
