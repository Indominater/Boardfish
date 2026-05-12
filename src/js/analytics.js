'use strict';

(function initBoardfishAnalytics(root) {
  const DEFAULT_DOMAIN = 'indominater.github.io';
  const DEFAULT_SCRIPT_SRC = 'https://plausible.io/js/script.js';
  const PRODUCTION_HOST = 'indominater.github.io';
  const PRODUCTION_PATH_PREFIX = '/Boardfish';

  function isProductionBoardfishWeb() {
    const location = root.location;
    if (!location) return false;
    return (
      location.protocol === 'https:' &&
      location.hostname === PRODUCTION_HOST &&
      location.pathname.startsWith(PRODUCTION_PATH_PREFIX)
    );
  }

  function doNotTrackEnabled() {
    const nav = root.navigator || {};
    return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
  }

  function configuredValue(name, fallback) {
    const value = root[name];
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function configuredEnabled() {
    if (typeof root.BOARDFISH_ANALYTICS_ENABLED === 'boolean') {
      return root.BOARDFISH_ANALYTICS_ENABLED;
    }
    return isProductionBoardfishWeb();
  }

  function cleanEventName(name) {
    return String(name || '')
      .trim()
      .replace(/[^a-zA-Z0-9:_ -]/g, '')
      .slice(0, 80);
  }

  function cleanProps(props) {
    const out = {};
    for (const [key, value] of Object.entries(props || {})) {
      const cleanKey = String(key || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 40);
      if (!cleanKey) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[cleanKey] = value;
      } else if (typeof value === 'boolean') {
        out[cleanKey] = value ? 'true' : 'false';
      } else if (typeof value === 'string') {
        out[cleanKey] = value.replace(/[^a-zA-Z0-9:_ .-]/g, '').slice(0, 80);
      }
    }
    return out;
  }

  const state = {
    enabled: configuredEnabled() && !doNotTrackEnabled(),
    loaded: false,
    domain: configuredValue('BOARDFISH_ANALYTICS_DOMAIN', DEFAULT_DOMAIN),
    scriptSrc: configuredValue('BOARDFISH_ANALYTICS_SCRIPT_SRC', DEFAULT_SCRIPT_SRC),
  };

  function ensurePlausibleStub() {
    if (typeof root.plausible === 'function') return;
    root.plausible = function plausible() {
      root.plausible.q = root.plausible.q || [];
      root.plausible.q.push(arguments);
    };
  }

  function loadScript() {
    if (!state.enabled || state.loaded || !root.document?.head) return false;
    ensurePlausibleStub();
    const script = root.document.createElement('script');
    script.defer = true;
    script.dataset.domain = state.domain;
    script.src = state.scriptSrc;
    root.document.head.appendChild(script);
    state.loaded = true;
    return true;
  }

  function track(name, props = {}) {
    if (!state.enabled) return false;
    const eventName = cleanEventName(name);
    if (!eventName) return false;
    loadScript();
    if (typeof root.plausible !== 'function') return false;
    const clean = cleanProps(props);
    if (Object.keys(clean).length) root.plausible(eventName, { props: clean });
    else root.plausible(eventName);
    return true;
  }

  root.BoardfishAnalytics = Object.freeze({
    init: loadScript,
    track,
    get enabled() { return state.enabled; },
    get domain() { return state.domain; },
  });

  loadScript();
}(globalThis));
