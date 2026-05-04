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
    return true;
  }

  function setSources(nextSources = {}) {
    Object.assign(imageStore, nextSources || {});
    return imageStore;
  }

  function getDisplayImage(key) {
    return imageCache[key] || null;
  }

  function setDisplayImage(key, img) {
    if (!key) return false;
    imageCache[key] = img;
    return true;
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
    setDisplayImage,
    setSource,
    setSources,
    sourceKeys,
    get generation() { return _imageStoreGeneration; },
  });
})(typeof window !== 'undefined' ? window : globalThis);
