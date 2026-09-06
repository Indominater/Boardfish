'use strict';

const BOARDFISH_CACHE_VERSION = 'v5';
const BOARDFISH_CACHE_NAMESPACE =
  `boardfish-pwa-${encodeURIComponent(self.registration.scope)}::`;
const BOARDFISH_CACHE = `${BOARDFISH_CACHE_NAMESPACE}${BOARDFISH_CACHE_VERSION}`;
const currentCache = caches.open(BOARDFISH_CACHE);
const BOARDFISH_APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './boardfish-icon.png',
  './boardfish-icon-192.png',
  './fonts/Geist.woff2',
  './fonts/geist-ascii-msdf.png',
  './fonts/geist-ascii-large-msdf.png',
  /* BOARDFISH_BUILD_ASSETS */
];
const BOARDFISH_APP_SHELL_URLS = new Set();
for (const asset of BOARDFISH_APP_SHELL) {
  BOARDFISH_APP_SHELL_URLS.add(new URL(asset, self.location.href).href);
}

function isBoardfishBundleUrl(url) {
  return /\/assets\/boardfish-web-preview(?:\.[a-f0-9]{12})?\.min\.js$/.test(url.pathname);
}

function isAppShellUrl(url) {
  return BOARDFISH_APP_SHELL_URLS.has(url.href);
}

function isCacheFirstAssetUrl(url) {
  return isBoardfishBundleUrl(url) || /\/(?:fonts\/(?:Geist\.woff2|geist-ascii-(?:large-)?msdf\.png)|boardfish-icon(?:-192)?\.png)$/.test(url.pathname);
}

function shouldCacheRequest(request, url) {
  return request.mode === 'navigate' || isAppShellUrl(url) || isBoardfishBundleUrl(url);
}

function matchCurrentCache(request) {
  return currentCache.then((cache) => cache.match(request));
}

async function fetchAndCacheRequest(event, request, url) {
  const response = await fetch(request);
  if (response.ok && response.type === 'basic' && shouldCacheRequest(request, url)) {
    const copy = response.clone();
    event.waitUntil(currentCache.then((cache) => cache.put(request, copy)).catch(() => {}));
  }
  return response;
}

async function pruneCurrentCache() {
  const cache = await currentCache;
  const requests = await cache.keys();
  const deletions = [];
  for (const request of requests) {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || (isBoardfishBundleUrl(url) && !isAppShellUrl(url))) {
      deletions.push(cache.delete(request));
    }
  }
  await Promise.all(deletions);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    currentCache
      .then((cache) => cache.addAll(BOARDFISH_APP_SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const deletions = [];
        for (const key of keys) {
          const isCurrentScopeCache = key.startsWith(BOARDFISH_CACHE_NAMESPACE);
          if (isCurrentScopeCache && key !== BOARDFISH_CACHE) {
            deletions.push(caches.delete(key));
          }
        }
        return Promise.all(deletions);
      })
      .then(() => pruneCurrentCache())
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isCacheFirstAssetUrl(url)) {
    const cached = matchCurrentCache(request);
    if (/\.[a-f0-9]{12}\.min\.js$/.test(url.pathname)) {
      event.respondWith(cached.then((hit) => hit || fetchAndCacheRequest(event, request, url)));
    } else {
      const update = fetchAndCacheRequest(event, request, url).catch(() => null);
      event.waitUntil(update);
      event.respondWith(cached.then(async (hit) => hit || await update || Promise.reject(new TypeError('Boardfish cache-first asset fetch failed'))));
    }
    return;
  }

  event.respondWith(fetchAndCacheRequest(event, request, url).catch(async (error) => {
    const cached = await matchCurrentCache(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return matchCurrentCache('./index.html');
    throw error;
  }));
});
