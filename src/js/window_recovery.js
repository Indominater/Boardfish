'use strict';

// Prevent native WebKit context menu (which contains "Reload Page") on any
// element not already handled by the canvas contextmenu handler.
document.addEventListener('contextmenu', (e) => {
  if (_rubberBandDragActive) {
    e.preventDefault();
    return;
  }
  if (!e.defaultPrevented) e.preventDefault();
});

// Native unload handlers cannot wait for the custom async save dialog.
window.addEventListener('beforeunload', (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});

function recoverWindowPaint(reason = 'resume', hardRepaint = false) {
  document.documentElement.style.display = '';
  document.documentElement.style.visibility = '';
  document.documentElement.style.opacity = '';
  document.body.style.display = '';
  document.body.style.visibility = '';
  document.body.style.opacity = '';
  canvas.style.display = '';
  boardCanvas.style.display = '';
  updateInputShieldVisual();
  if (dialogOverlay.classList.contains('show') && !_dialogResolve) dialogOverlay.classList.remove('show');
  if (
    !ctxMenu.classList.contains('visible') &&
    !objCtxMenu.classList.contains('visible') &&
    !BoardfishDOM.textCtxMenu.classList.contains('visible')
  ) {
    hideMenus();
  } else {
    MenuDebug.log('recoverWindowPaint:keep-open-menu', { reason });
  }
  if (hardRepaint) {
    document.body.style.display = 'none';
    void document.body.offsetHeight;
    document.body.style.display = '';
  }
  requestAnimationFrame(() => {
    resizeCanvas();
    scheduleRender(true, true, reason);
    requestAnimationFrame(() => {
      applyTransform();
      updateSelectionOverlay();
    });
  });
}

function recoverBlankUi(reason = 'watchdog') {
  if (document.hidden) return;
  const bodyStyle = getComputedStyle(document.body);
  const canvasStyle = getComputedStyle(boardCanvas);
  const canvasMissing = boardCanvas.width === 0 || boardCanvas.height === 0;
  const hidden =
    bodyStyle.display === 'none' ||
    bodyStyle.visibility === 'hidden' ||
    bodyStyle.opacity === '0' ||
    canvasStyle.display === 'none' ||
    canvasStyle.visibility === 'hidden';

  if (!hidden && !canvasMissing) return;
  recoverWindowPaint(`blank-ui:${reason}`, hidden);
}

window.addEventListener('pageshow', (event) => recoverWindowPaint('pageshow', event.persisted));
window.addEventListener('focus', () => recoverWindowPaint('focus'));
window.addEventListener('blur', () => setTimeout(() => recoverBlankUi('blur-followup'), 250));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    recoverWindowPaint('visibility');
    setTimeout(() => recoverBlankUi('visibility-followup'), 250);
  }
});
setInterval(() => recoverBlankUi('interval'), 2000);
boardCanvas.addEventListener('contextlost', (event) => {
  event.preventDefault();
});
boardCanvas.addEventListener('contextrestored', () => recoverWindowPaint('canvas-contextrestored', true));
