'use strict';

const BOARDFISH_CACHE = 'boardfish-web-v2';
const BOARDFISH_APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './boardfish-icon.png',
  './boardfish-icon-192.png',
  './fonts/Geist.woff2',
];

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
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('boardfish-web-') && key !== BOARDFISH_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(BOARDFISH_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match('./index.html');
      throw error;
    }
  })());
});
