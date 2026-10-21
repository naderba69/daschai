// Minimal Service Worker for offline shell caching (OX-Alpha Pro v2)
const CACHE = 'ox-alpha-v2.1';
const SHELL = ['/', '/index.html', '/manifest.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=> self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(()=> caches.match('/index.html'))));
});
