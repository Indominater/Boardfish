'use strict';

(function initWindowTitlebar(root) {
  const isWindows = /Win/.test(navigator.platform) || /Win/.test(navigator.userAgent);
  if (!isWindows) return;

  const titlebar = document.getElementById('windows-titlebar');
  const dragRegion = document.getElementById('windows-titlebar-drag');
  const minimizeButton = document.getElementById('win-btn-minimize');
  const maximizeButton = document.getElementById('win-btn-maximize');
  const closeButton = document.getElementById('win-btn-close');
  if (!titlebar || !dragRegion || !minimizeButton || !maximizeButton || !closeButton) return;

  titlebar.setAttribute('aria-hidden', 'false');

  function hasNativeWindow() {
    return typeof root.hasTauri === 'function' && root.hasTauri() && root.BoardfishTauri;
  }

  if (!hasNativeWindow()) return;

  document.body.classList.add('is-windows');

  function reportWindowControlError(action, error) {
    try {
      console.warn(`[Boardfish window] ${action} failed`, error);
    } catch (_) {}
  }

  function setMaximizedState(maximized) {
    const next = !!maximized;
    maximizeButton.dataset.maximized = next ? 'true' : 'false';
    maximizeButton.setAttribute('aria-label', next ? 'Restore' : 'Maximize');
    maximizeButton.setAttribute('title', next ? 'Restore' : 'Maximize');
  }

  function syncMaximizedState() {
    if (!hasNativeWindow()) return Promise.resolve();
    return root.BoardfishTauri.getWindowMaximized()
      .then((state) => setMaximizedState(state?.maximized))
      .catch((error) => reportWindowControlError('sync maximize state', error));
  }

  function consumeWindowControlEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function minimizeWindow(event) {
    consumeWindowControlEvent(event);
    if (!hasNativeWindow()) return;
    root.BoardfishTauri.minimizeWindow()
      .catch((error) => reportWindowControlError('minimize', error));
  }

  function toggleMaximizeWindow(event) {
    if (event) consumeWindowControlEvent(event);
    if (!hasNativeWindow()) return;
    root.BoardfishTauri.toggleMaximizeWindow()
      .then((state) => setMaximizedState(state?.maximized))
      .catch((error) => reportWindowControlError('toggle maximize', error));
  }

  function requestWindowClose(event) {
    consumeWindowControlEvent(event);
    if (!hasNativeWindow()) return;
    root.BoardfishTauri.requestWindowClose()
      .catch((error) => reportWindowControlError('close', error));
  }

  minimizeButton.addEventListener('click', minimizeWindow);
  maximizeButton.addEventListener('click', toggleMaximizeWindow);
  closeButton.addEventListener('click', requestWindowClose);
  dragRegion.addEventListener('dblclick', toggleMaximizeWindow);

  let resizeRaf = 0;
  root.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      syncMaximizedState();
    });
  });

  syncMaximizedState();
})(typeof window !== 'undefined' ? window : globalThis);
