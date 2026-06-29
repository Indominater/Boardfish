'use strict';

const BOARDFISH_CACHE = 'boardfish-web-v3';
const BOARDFISH_STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './boardfish-icon.png',
  './boardfish-icon-192.png',
  './fonts/Geist.woff2',
];
const BOARDFISH_BUILD_ASSETS = [];
const BOARDFISH_APP_SHELL = new Array(BOARDFISH_STATIC_ASSETS.length + BOARDFISH_BUILD_ASSETS.length);
for (let i = 0; i < BOARDFISH_STATIC_ASSETS.length; i++) BOARDFISH_APP_SHELL[i] = BOARDFISH_STATIC_ASSETS[i];
for (let i = 0; i < BOARDFISH_BUILD_ASSETS.length; i++) BOARDFISH_APP_SHELL[BOARDFISH_STATIC_ASSETS.length + i] = BOARDFISH_BUILD_ASSETS[i];
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
  return isBoardfishBundleUrl(url) ||
    /\/fonts\/Geist\.woff2$/.test(url.pathname) ||
    /\/boardfish-icon(?:-192)?\.png$/.test(url.pathname);
}

function shouldCacheRequest(request, url) {
  return request.mode === 'navigate' || isAppShellUrl(url) || isBoardfishBundleUrl(url);
}

async function fetchAndCacheRequest(request, url) {
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic' && shouldCacheRequest(request, url)) {
    const cache = await caches.open(BOARDFISH_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function pruneCurrentCache() {
  const cache = await caches.open(BOARDFISH_CACHE);
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
    caches.open(BOARDFISH_CACHE)
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
          if (key.startsWith('boardfish-web-') && key !== BOARDFISH_CACHE) {
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
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isCacheFirstAssetUrl(url)) {
    const update = fetchAndCacheRequest(request, url).catch(() => null);
    event.waitUntil(update);
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await update;
      if (response) return response;
      throw new TypeError('Boardfish cache-first asset fetch failed');
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      return await fetchAndCacheRequest(request, url);
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match('./index.html');
      throw error;
    }
  })());
});
