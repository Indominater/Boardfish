'use strict';

(function initBoardfishAnalytics(root) {
  const DEFAULT_TOKEN = 'b0d33f7dee1b4308b72b231c46ef1faa';
  const DEFAULT_SCRIPT_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
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

  const state = {
    enabled: configuredEnabled() && !doNotTrackEnabled(),
    loaded: false,
    token: configuredValue('BOARDFISH_CLOUDFLARE_ANALYTICS_TOKEN', DEFAULT_TOKEN),
    scriptSrc: configuredValue('BOARDFISH_ANALYTICS_SCRIPT_SRC', DEFAULT_SCRIPT_SRC),
  };

  function loadScript() {
    if (!state.enabled || state.loaded || !state.token || !root.document?.head) return false;
    const script = root.document.createElement('script');
    script.defer = true;
    script.src = state.scriptSrc;
    script.setAttribute('data-cf-beacon', JSON.stringify({ token: state.token }));
    root.document.head.appendChild(script);
    state.loaded = true;
    return true;
  }

  loadScript();
}(globalThis));
