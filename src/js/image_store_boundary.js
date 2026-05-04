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

  function clearSources() {
    for (const key of Object.keys(imageStore)) delete imageStore[key];
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

  function getBitmap(key) {
    return imageBitmapCache[key] || null;
  }

  function getBestDisplaySource(key) {
    return imageBitmapCache[key] || imageCache[key] || null;
  }

  function snapshotSources() {
    const store = {};
    for (const [key, src] of Object.entries(imageStore || {})) {
      store[key] = src && typeof src === 'object' ? { ...src } : src;
    }
    return store;
  }

  function sourceKeys() {
    return Object.keys(imageStore || {});
  }

  function cacheKeys() {
    return Object.keys(imageCache || {});
  }

  root.BoardfishImageStore = Object.freeze({
    cacheKeys,
    clearSources,
    getBestDisplaySource,
    getBitmap,
    getDisplayImage,
    getSource,
    hasDisplayImage,
    hasSource,
    setDisplayImage,
    setSource,
    setSources,
    snapshotSources,
    sourceKeys,
    get generation() { return _imageStoreGeneration; },
  });
})(typeof window !== 'undefined' ? window : globalThis);
