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
    if (changed && previous && typeof BoardfishWebBoardContainer !== 'undefined') {
      BoardfishWebBoardContainer.revokeImageSource?.(previous);
    }
    imageStore[key] = source;
    return true;
  }

  function setSources(nextSources = {}) {
    for (const [key, source] of Object.entries(nextSources || {})) {
      const hadSource = Object.hasOwn(imageStore, key);
      const previous = imageStore[key];
      const changed = hadSource && previous !== source;
      if (changed && typeof invalidateImageSourceCachesForKey === 'function') {
        invalidateImageSourceCachesForKey(key);
      }
      if (changed && previous && typeof BoardfishWebBoardContainer !== 'undefined') {
        BoardfishWebBoardContainer.revokeImageSource?.(previous);
      }
    }
    Object.assign(imageStore, nextSources || {});
    return imageStore;
  }

  function getDisplayImage(key) {
    return imageMetadataCache[key] || (imageBitmapCache[key] ? {
      width: imageBitmapCache[key].width || 0,
      height: imageBitmapCache[key].height || 0,
      naturalWidth: imageBitmapCache[key].width || 0,
      naturalHeight: imageBitmapCache[key].height || 0,
      complete: true,
      src: '',
      currentSrc: '',
    } : null);
  }

  function hasDisplayImage(key) {
    return !!(imageMetadataCache[key] || imageBitmapCache[key]);
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
