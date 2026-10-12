// Service worker generato da scripts/build.mjs
const VERSION = 'ppdf-4630f75f0147';
const PRECACHE = ["/preventivopdf/app/","/preventivopdf/assets/app-AWPYOIYZ.js","/preventivopdf/assets/chunks/chunk-5ERHN3ES.js","/preventivopdf/assets/chunks/pdf-OSRBPAP5.js","/preventivopdf/assets/site-Y2OUK4X3.css","/preventivopdf/fonts/bricolage-wght.woff2","/preventivopdf/favicon.svg","/preventivopdf/icon-192.png","/preventivopdf/manifest.webmanifest"];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('/preventivopdf/app/'))));
    return;
  }
  if (url.pathname.startsWith('/preventivopdf/assets/') || url.pathname.startsWith('/preventivopdf/fonts/')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
