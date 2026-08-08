'use strict';

(function initInteractionUtils(root) {
  function createRafCommitter(apply) {
    let raf = null, value0, value1, value2, value3;

    function commit() {
      raf = null;
      const next0 = value0, next1 = value1, next2 = value2, next3 = value3;
      value0 = value1 = value2 = value3 = undefined;
      apply(next0, next1, next2, next3);
    }

    return {
      schedule(next0, next1, next2, next3) {
        value0 = next0; value1 = next1; value2 = next2; value3 = next3;
        if (raf !== null) return;
        raf = requestAnimationFrame(commit);
      },
      flush() {
        if (raf === null) return;
        cancelAnimationFrame(raf);
        commit();
      },
      get pending() { return raf !== null; },
    };
  }

  function beginDocumentDrag({ move, up, moveEvent = 'mousemove', upEvent = 'mouseup' }) {
    let active = true;
    const cleanup = (event = null) => {
      if (!active) return;
      active = false;
      document.removeEventListener(moveEvent, move);
      document.removeEventListener(upEvent, cleanup);
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('blur', onCancel);
        window.removeEventListener('pagehide', onCancel);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange, true);
      document.removeEventListener('pointercancel', onCancel, true);
      up(event);
    };
    const onCancel = (event) => cleanup({
      __boardfishDragCancel: true,
      type: event?.type || 'cancel',
      clientX: event?.clientX,
      clientY: event?.clientY,
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' || document.hidden) {
        onCancel({ type: 'visibilitychange' });
      }
    };
    document.addEventListener(moveEvent, move);
    document.addEventListener(upEvent, cleanup);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('blur', onCancel);
      window.addEventListener('pagehide', onCancel);
    }
    document.addEventListener('visibilitychange', onVisibilityChange, true);
    document.addEventListener('pointercancel', onCancel, true);
    return cleanup;
  }

  root.beginDocumentDrag = beginDocumentDrag;
  root.createRafCommitter = createRafCommitter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.freeze({ beginDocumentDrag, createRafCommitter });
  }
})(typeof window !== 'undefined' ? window : globalThis);
