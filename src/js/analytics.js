'use strict';

(function initBoardfishAnalytics(root) {
  const DEFAULT_TOKEN = 'b0d33f7dee1b4308b72b231c46ef1faa';
  const DEFAULT_SCRIPT_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
  const PRODUCTION_HOST = 'indominater.github.io';
  const PRODUCTION_PATH_PREFIX = '/Boardfish';
  const BETA_PATH_PREFIX = `${PRODUCTION_PATH_PREFIX}/beta`;

  function pathIsWithin(pathname, rootPath) {
    return pathname === rootPath || pathname.startsWith(`${rootPath}/`);
  }

  function isProductionBoardfishWeb() {
    const location = root.location;
    if (!location) return false;
    return (
      location.protocol === 'https:' &&
      location.hostname === PRODUCTION_HOST &&
      pathIsWithin(location.pathname, PRODUCTION_PATH_PREFIX) &&
      !pathIsWithin(location.pathname, BETA_PATH_PREFIX)
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

  const token = configuredValue('BOARDFISH_CLOUDFLARE_ANALYTICS_TOKEN', DEFAULT_TOKEN);
  if (configuredEnabled() && !doNotTrackEnabled() && token && root.document?.head) {
    const script = root.document.createElement('script');
    script.defer = true;
    script.src = configuredValue('BOARDFISH_ANALYTICS_SCRIPT_SRC', DEFAULT_SCRIPT_SRC);
    script.setAttribute('data-cf-beacon', JSON.stringify({ token }));
    root.document.head.appendChild(script);
  }
}(globalThis));
