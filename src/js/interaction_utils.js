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
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('blur', onCancel);
        window.removeEventListener('pagehide', onCancel);
      }
      if (document.removeEventListener) {
        document.removeEventListener('visibilitychange', onVisibilityChange, true);
        document.removeEventListener('pointercancel', onCancel, true);
      }
      if (up) up(event);
    };
    const onMove = (event) => {
      if (move) move(event);
    };
    const onUp = (event) => cleanup(event);
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
    document.addEventListener(moveEvent, onMove);
    document.addEventListener(upEvent, onUp);
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

  function activateInteractiveSurface({
    kind = 'surface',
    reason = '',
    closeMenus = false,
    clearObjectSelection = false,
    exitTextEdit = clearObjectSelection,
    renderSelection = clearObjectSelection || exitTextEdit,
  } = {}) {
    const actionReason = reason || `${kind}:activate`;
    if (closeMenus && typeof root.closeOpenMenusExcept === 'function') {
      root.closeOpenMenusExcept('', actionReason);
    }

    const hasSelection = !!root.selectedIds?.size;
    const hasEditing = !!root.editingId;
    if (clearObjectSelection && (hasSelection || (exitTextEdit && hasEditing))) {
      if (typeof root.deselectAll === 'function') {
        root.deselectAll();
      } else if (root.BoardfishEditorState?.clearSelection) {
        if (exitTextEdit && hasEditing && typeof root.exitEdit === 'function') root.exitEdit();
        root.BoardfishEditorState.clearSelection();
        if (renderSelection && typeof root.scheduleRender === 'function') {
          root.scheduleRender(false, true, actionReason);
        }
      }
    } else if (exitTextEdit && hasEditing && typeof root.exitEdit === 'function') {
      root.exitEdit();
      if (renderSelection && typeof root.scheduleRender === 'function') {
        root.scheduleRender(false, true, actionReason);
      }
    }

    return {
      kind,
      reason: actionReason,
      closedMenus: !!closeMenus,
      clearedObjectSelection: !!clearObjectSelection && hasSelection,
      exitedTextEdit: !!exitTextEdit && hasEditing,
    };
  }

  const api = Object.freeze({ activateInteractiveSurface, beginDocumentDrag, createRafCommitter });
  root.BoardfishInteraction = api;
  root.activateInteractiveSurface = activateInteractiveSurface;
  root.beginDocumentDrag = beginDocumentDrag;
  root.createRafCommitter = createRafCommitter;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
