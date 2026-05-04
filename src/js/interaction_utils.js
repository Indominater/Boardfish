'use strict';

(function initInteractionUtils(root) {
  function createRafCommitter(apply) {
    let raf = null;
    let pending = false;
    let state = null;

    function flush() {
      if (!pending) return;
      const nextState = state;
      pending = false;
      state = null;
      apply(nextState);
    }

    return {
      schedule(nextState) {
        state = nextState;
        pending = true;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          flush();
        });
      },
      flush() {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        flush();
      },
      cancel() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        pending = false;
        state = null;
      },
      get pending() { return pending; },
    };
  }

  function beginDocumentDrag({ move, up, moveEvent = 'mousemove', upEvent = 'mouseup' }) {
    let active = true;
    const cleanup = (event = null) => {
      if (!active) return;
      active = false;
      document.removeEventListener(moveEvent, onMove);
      document.removeEventListener(upEvent, onUp);
      if (up) up(event);
    };
    const onMove = (event) => {
      if (move) move(event);
    };
    const onUp = (event) => cleanup(event);
    document.addEventListener(moveEvent, onMove);
    document.addEventListener(upEvent, onUp);
    return cleanup;
  }

  const api = Object.freeze({ beginDocumentDrag, createRafCommitter });
  root.BoardfishInteraction = api;
  root.beginDocumentDrag = beginDocumentDrag;
  root.createRafCommitter = createRafCommitter;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
