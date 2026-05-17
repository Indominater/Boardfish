'use strict';

const BoardfishEyedropperCards = (() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;

  const removePendingPinnedCardClone = (card) => {
    const clone = card?.pendingPinnedClone;
    if (card) card.pendingPinnedClone = null;
    if (!clone) return false;
    clone.remove?.();
    if (clone.parentNode) clone.parentNode.removeChild(clone);
    return true;
  };

  const removeIds = (clone) => {
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  };

  const copyCanvas = (card, clone, debug = null) => {
    const source = card?.canvas;
    const target = clone?.querySelector?.('.eyedropper-canvas');
    if (!source || !target) return false;
    target.width = source.width || target.width || 1;
    target.height = source.height || target.height || target.width || 1;
    const ctx = target.getContext?.('2d', { willReadFrequently: true });
    if (!ctx) return false;
    try {
      ctx.clearRect(0, 0, target.width, target.height);
      if (source.width && source.height) ctx.drawImage(source, 0, 0);
      return true;
    } catch (err) {
      debug?._logReadbackFailure?.('pinned-card-clone-canvas', { error: String(err) });
      return false;
    }
  };

  const preservePinnedCardUntilNextSample = (card, debug = null) => {
    if (!card?.el?.parentNode ||
        !card.el.classList.contains('visible') ||
        !card.el.classList.contains('pinned')) return false;
    removePendingPinnedCardClone(card);
    const clone = card.el.cloneNode(true);
    removeIds(clone);
    clone.classList.add('eyedropper-loupe', 'visible', 'pinned');
    clone.classList.remove('dragging', 'motion-smooth-slide-enter', 'motion-smooth-slide-exit');
    Object.assign(clone.style, { pointerEvents: 'none', animation: 'none', transition: 'none' });
    clone.setAttribute('aria-hidden', 'true');
    copyCanvas(card, clone, debug);
    card.el.parentNode.insertBefore(clone, card.el.nextSibling);
    card.pendingPinnedClone = clone;
    return true;
  };

  const api = Object.freeze({
    preservePinnedCardUntilNextSample,
    removePendingPinnedCardClone,
  });
  root.BoardfishEyedropperCards = api;
  return api;
})();
