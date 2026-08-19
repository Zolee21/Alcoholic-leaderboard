const CACHE_VERSION = 'italpont-v5.1-shell-1';
const SHELL = [
  './','./index.html','./platform.js','./native.js','./pwa.js','./manifest.webmanifest',
  './assets/kulturfarm-banner.jpg','./assets/app-icon.png',
  './assets/pwa/icon-192.png','./assets/pwa/icon-512.png','./assets/pwa/apple-touch-icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('italpont-') && k !== CACHE_VERSION).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(caches.match(req).then(cached => {
    const fresh = fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});