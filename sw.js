// OX-Alpha Workbench Pro — Service Worker (v2.6)
// • App shell (index.html): network-first, falls back to cache when offline (#815)
// • CDN libraries & fonts: stale-while-revalidate (#825)
// • Editor/runner chunks (/assets/, content-hashed): cache-first; workers (/workers/): network-first
// • APIs (OpenRouter, GitHub, webhooks…): never cached
// • Updates wait for the user: the page shows "update available" and posts SKIP_WAITING (#861)
const VERSION = 'v2.7';
const SHELL_CACHE = 'ox-alpha-shell-' + VERSION;
const CDN_CACHE = 'ox-alpha-cdn-' + VERSION;
const ASSET_CACHE = 'ox-alpha-assets-' + VERSION;
const MAX_ASSET_ENTRIES = 200;
const SHELL = ['/', '/index.html', '/manifest.json'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const MAX_CDN_ENTRIES = 60;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
  // No skipWaiting() here: a new version waits until the user accepts the update.
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ox-alpha') && k !== SHELL_CACHE && k !== CDN_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req.mode === 'navigate' ? '/index.html' : req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req)) || (await cache.match('/index.html')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  const type = res.headers.get('content-type') || '';
  // never cache an SPA fallback (index.html) served for a missing chunk
  if (res.ok && !type.includes('text/html')) cache.put(req, res.clone()).then(() => trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES));
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(event.request, res.clone()).then(() => trimCache(CDN_CACHE, MAX_CDN_ENTRIES));
    }
    return res;
  }).catch(() => cached);
  if (cached) { event.waitUntil(refresh); return cached; }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') { event.respondWith(networkFirst(req)); return; }
    if (url.pathname === '/sw.js') return;
    if (url.pathname === '/CHANGELOG.md' || url.pathname.startsWith('/workers/')) { event.respondWith(networkFirst(req)); return; }
    if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req)); return; }
    event.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) { event.respondWith(staleWhileRevalidate(event)); return; }
  // Everything else (openrouter.ai, api.github.com, webhooks, tavily…) goes straight to the network.
});
