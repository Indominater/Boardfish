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
    const hadSource = Object.hasOwn(imageStore, key);
    const previous = imageStore[key];
    const changed = hadSource && previous !== source;
    if (changed && typeof invalidateImageSourceCachesForKey === 'function') {
      invalidateImageSourceCachesForKey(key);
    }
    imageStore[key] = source;
    return true;
  }

  function hasDisplayImage(key) {
    return !!imageBitmapCache[key];
  }

  function sourceKeys() {
    return Object.keys(imageStore || {});
  }

  root.BoardfishImageStore = Object.freeze({
    getSource,
    hasDisplayImage,
    hasSource,
    setSource,
    sourceKeys,
  });
})(typeof window !== 'undefined' ? window : globalThis);
