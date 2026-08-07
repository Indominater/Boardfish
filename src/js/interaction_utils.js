'use strict';

(function initInteractionUtils(root) {
  function createRafCommitter(apply) {
    let raf = null;
    let state = null;

    function commit() {
      raf = null;
      if (state === null) return;
      const nextState = state;
      state = null;
      apply(nextState);
    }

    return {
      schedule(nextState) {
        state = nextState;
        if (raf) return;
        raf = requestAnimationFrame(commit);
      },
      flush() {
        if (raf) cancelAnimationFrame(raf);
        commit();
      },
      get pending() { return state !== null; },
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
      if (document.removeEventListener) {
        document.removeEventListener('visibilitychange', onVisibilityChange, true);
        document.removeEventListener('pointercancel', onCancel, true);
      }
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
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', onVisibilityChange, true);
      document.addEventListener('pointercancel', onCancel, true);
    }
    return cleanup;
  }

  root.beginDocumentDrag = beginDocumentDrag;
  root.createRafCommitter = createRafCommitter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.freeze({ beginDocumentDrag, createRafCommitter });
  }
})(typeof window !== 'undefined' ? window : globalThis);
