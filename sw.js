// OX-Alpha Workbench Pro — Service Worker (v2.14)
// • App shell (index.html): network-first, falls back to cache when offline (#815)
// • CDN libraries & fonts: stale-while-revalidate (#825)
// • Editor/runner chunks (/assets/, content-hashed): cache-first; workers (/workers/): network-first
// • APIs (OpenRouter, GitHub, webhooks…): never cached
// • Updates wait for the user: the page shows "update available" and posts SKIP_WAITING (#861)
// Sprint 12:
// • Delta updates (#866): the asset cache is no longer per-version — unchanged content-hashed chunks survive an
//   update, and only the changed entry chunks the user actually used are pre-fetched (version.json lists hashes)
// • Rollback (#865): the previous shell is kept; PIN_PREV serves it until UNPIN
// • Update channels (#869): a stable client refuses to install a beta build (install fails → old SW stays)
// • Background Sync (#826): queued requests (IndexedDB "ox-alpha-bg") are replayed on `sync`
// • Push (#949) + notification actions for watches (#972, #973) + PWA widgets (#964)
const VERSION = 'v2.14';
const SHELL_CACHE = 'ox-alpha-shell-' + VERSION;
const PREV_CACHE = 'ox-alpha-shell-prev';
const CDN_CACHE = 'ox-alpha-cdn-' + VERSION;
const ASSET_CACHE = 'ox-alpha-assets';
const META_CACHE = 'ox-alpha-meta';
const MAX_ASSET_ENTRIES = 260;
const SHELL = ['/', '/index.html', '/manifest.json'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const MAX_CDN_ENTRIES = 60;
const KEEP = (k) => k === SHELL_CACHE || k === CDN_CACHE || k === ASSET_CACHE || k === META_CACHE || k === PREV_CACHE;

// ------------------------------------------------------------------ META (small JSON records in a cache)
async function metaGet(key, dflt = null) {
  try { const r = await (await caches.open(META_CACHE)).match('/__ox/' + key); return r ? await r.json() : dflt; } catch (e) { return dflt; }
}
async function metaSet(key, value) {
  const c = await caches.open(META_CACHE);
  if (value === null || value === undefined) return c.delete('/__ox/' + key);
  return c.put('/__ox/' + key, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }));
}
async function broadcast(msg) {
  const list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  list.forEach((c) => c.postMessage(msg));
  return list;
}

// ------------------------------------------------------------------ INSTALL (channel check + delta precache)
async function fetchVersion() {
  try { const r = await fetch('/version.json', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
/** Entry chunks the user already used (present in the asset cache) whose content changed → fetch the new ones now. */
async function deltaPrecache(next, prev) {
  const stats = { version: next.version, reused: 0, fetched: 0, bytes: 0, skipped: 0, at: Date.now() };
  const assets = await caches.open(ASSET_CACHE);
  const cachedPaths = new Set((await assets.keys()).map((r) => new URL(r.url).pathname));
  const prevEntries = (prev && prev.entries) || {};
  const usedNames = new Set(Object.entries(prevEntries).filter(([p]) => cachedPaths.has(p)).map(([, n]) => n));
  for (const [p, name] of Object.entries(next.entries || {})) {
    if (cachedPaths.has(p)) { stats.reused++; continue; } // same content hash → nothing to download
    if (!usedNames.has(name)) { stats.skipped++; continue; } // never used → stays lazy
    try {
      const res = await fetch(p, { cache: 'no-cache' });
      if (res.ok) { const buf = await res.clone().arrayBuffer(); stats.bytes += buf.byteLength; stats.fetched++; await assets.put(p, res); }
    } catch (e) { /* offline → fetched on demand later */ }
  }
  for (const p of Object.keys(next.files || {})) if (p.startsWith('/assets/') && cachedPaths.has(p) && !(p in (next.entries || {}))) stats.reused++;
  return stats;
}
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const next = await fetchVersion();
    const channel = await metaGet('channel', 'stable');
    if (next && channel === 'stable' && next.channel === 'beta') {
      await metaSet('skipped', { version: next.version, channel: next.channel, at: Date.now() });
      throw new Error('OX: beta build ' + next.version + ' skipped on the stable channel');
    }
    await (await caches.open(SHELL_CACHE)).addAll(SHELL);
    if (next) {
      const prev = await metaGet('version');
      await metaSet('next', next);
      if (prev && prev.version !== next.version) await metaSet('delta', await deltaPrecache(next, prev));
    }
  })());
  // No skipWaiting() here: a new version waits until the user accepts the update.
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // Keep the shell we are replacing as the rollback target (#865)
    const older = keys.filter((k) => k.startsWith('ox-alpha-shell-v') && k !== SHELL_CACHE).sort().pop();
    if (older) {
      const src = await caches.open(older), hit = await src.match('/index.html');
      if (hit) {
        const prevVersion = await metaGet('version');
        await caches.delete(PREV_CACHE);
        await (await caches.open(PREV_CACHE)).put('/index.html', hit);
        await metaSet('prev', { version: (prevVersion && prevVersion.version) || older.replace('ox-alpha-shell-', ''), files: (prevVersion && prevVersion.files) || {}, cache: older, at: Date.now() });
      }
    }
    // One-time migration from the per-version asset caches (≤ v2.11) so unchanged chunks are not downloaded again
    const assets = await caches.open(ASSET_CACHE);
    for (const k of keys.filter((x) => x.startsWith('ox-alpha-assets-'))) {
      const old = await caches.open(k);
      for (const req of await old.keys()) { if (!(await assets.match(req))) { const r = await old.match(req); if (r) await assets.put(req, r); } }
    }
    await Promise.all(keys.filter((k) => k.startsWith('ox-alpha') && !KEEP(k)).map((k) => caches.delete(k)));
    const next = await metaGet('next');
    if (next) { await metaSet('version', next); await metaSet('next', null); await pruneAssets(); }
    await self.clients.claim();
  })());
});

/** Drop chunks that neither the current nor the rollback version references (#866). */
async function pruneAssets() {
  const cur = await metaGet('version'), prev = await metaGet('prev');
  if (!cur || !cur.files || !prev || !prev.files || !Object.keys(prev.files).length) return 0; // unknown previous file list → keep (trimCache bounds the size)
  const keep = new Set([...Object.keys(cur.files || {}), ...Object.keys((prev && prev.files) || {})]);
  const assets = await caches.open(ASSET_CACHE);
  let n = 0;
  for (const req of await assets.keys()) { const p = new URL(req.url).pathname; if (!keep.has(p)) { await assets.delete(req); n++; } }
  return n;
}

// ------------------------------------------------------------------ MESSAGES FROM THE PAGE
self.addEventListener('message', (e) => {
  const d = e.data || {};
  const reply = (v) => { try { if (e.ports && e.ports[0]) e.ports[0].postMessage(v); } catch (err) { /* closed */ } };
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  e.waitUntil((async () => {
    if (d.type === 'SET_CHANNEL') { await metaSet('channel', d.channel === 'beta' ? 'beta' : 'stable'); reply({ ok: true }); }
    else if (d.type === 'PIN_PREV') { const prev = await metaGet('prev'); if (prev) await metaSet('pin', { version: prev.version, at: Date.now() }); reply({ ok: !!prev, prev }); }
    else if (d.type === 'UNPIN') { await metaSet('pin', null); reply({ ok: true }); }
    else if (d.type === 'WIDGET_DATA') { await metaSet('widget', d.data || {}); await updateWidgets(); reply({ ok: true }); }
    else if (d.type === 'BG_SYNC_NOW') { reply(await replayQueue()); }
    else if (d.type === 'STATUS') {
      reply({ sw: VERSION, version: await metaGet('version'), prev: await metaGet('prev'), pin: await metaGet('pin'), channel: await metaGet('channel', 'stable'),
        delta: await metaGet('delta'), skipped: await metaGet('skipped'), queue: (await queueAll()).length, caches: await caches.keys() });
    }
  })());
});

// ------------------------------------------------------------------ FETCH STRATEGIES
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
/** Navigations: the pinned (rolled-back) shell wins while a pin is set (#865). */
async function shell(req) {
  const pin = await metaGet('pin');
  if (pin) { const prev = await (await caches.open(PREV_CACHE)).match('/index.html'); if (prev) return prev; }
  return networkFirst(req);
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

// ------------------------------------------------------------------ LOCAL REST API (#987)
// /api/v1/* from same-origin pages/iframes/tabs is answered by an open OX-Alpha window (MessageChannel).
const API_CORS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'cache-control': 'no-store' };
async function apiProxy(req, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: API_CORS });
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const target = wins.find((c) => new URL(c.url).pathname.indexOf('/api/') === -1);
  if (!target) return new Response(JSON.stringify({ error: 'OX-Alpha is not open in any tab' }), { status: 503, headers: API_CORS });
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') { const t = await req.text(); try { body = t ? JSON.parse(t) : null; } catch (e) { body = t; } }
  const msg = { type: 'ox-api', req: { method: req.method, path: url.pathname.replace(/^.*?\/api\/v1/, '/api/v1'), query: Object.fromEntries(url.searchParams), auth: req.headers.get('authorization') || '', body } };
  const reply = await new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve({ status: 504, body: { error: 'OX-Alpha did not answer (is the API enabled in Integrations → API?)' } }), 60000);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data || { status: 500, body: { error: 'empty reply' } }); };
    target.postMessage(msg, [ch.port2]);
  });
  return new Response(JSON.stringify(reply.body == null ? null : reply.body, null, 2), { status: reply.status || 200, headers: API_CORS });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin === self.location.origin && /\/api\/v1(\/|$)/.test(url.pathname)) { event.respondWith(apiProxy(req, url)); return; }
  if (req.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') { event.respondWith(shell(req)); return; }
    if (url.pathname === '/sw.js' || url.pathname === '/version.json') return;
    if (url.pathname === '/widgets/data.json') { event.respondWith(metaGet('widget', {}).then((d) => new Response(JSON.stringify(widgetData(d)), { headers: { 'content-type': 'application/json' } }))); return; }
    if (url.pathname === '/CHANGELOG.md' || url.pathname.startsWith('/workers/')) { event.respondWith(networkFirst(req)); return; }
    if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req)); return; }
    event.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) { event.respondWith(staleWhileRevalidate(event)); return; }
  // Everything else (openrouter.ai, api.github.com, webhooks, tavily…) goes straight to the network.
});

// ------------------------------------------------------------------ BACKGROUND SYNC (#826)
function bgDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ox-alpha-bg', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('q')) r.result.createObjectStore('q', { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function queueAll() {
  try {
    const db = await bgDB();
    return await new Promise((resolve, reject) => { const r = db.transaction('q').objectStore('q').getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error); });
  } catch (e) { return []; }
}
async function queueDel(id) {
  const db = await bgDB();
  return new Promise((resolve) => { const tx = db.transaction('q', 'readwrite'); tx.objectStore('q').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
}
async function queuePut(item) {
  const db = await bgDB();
  return new Promise((resolve) => { const tx = db.transaction('q', 'readwrite'); tx.objectStore('q').put(item); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
}
async function replayQueue() {
  const items = await queueAll();
  const out = { sent: 0, failed: 0, dropped: 0 };
  for (const it of items) {
    try {
      const res = await fetch(it.url, { method: it.method || 'POST', headers: it.headers || {}, body: it.body == null ? undefined : it.body, mode: it.mode || 'cors' });
      if (res.ok || res.type === 'opaque' || (res.status >= 400 && res.status < 500)) { await queueDel(it.id); if (res.ok || res.type === 'opaque') out.sent++; else out.dropped++; }
      else { it.tries = (it.tries || 0) + 1; await queuePut(it); out.failed++; }
    } catch (e) { it.tries = (it.tries || 0) + 1; await queuePut(it); out.failed++; }
  }
  if (items.length) await broadcast({ type: 'OX_BG_SYNC', ...out });
  return out;
}
self.addEventListener('sync', (e) => { if (e.tag === 'ox-bg-sync') e.waitUntil(replayQueue().then((r) => { if (r.failed) throw new Error('retry later'); })); });

// ------------------------------------------------------------------ PUSH + NOTIFICATION ACTIONS (#949, #972, #973)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'OX-Alpha';
  e.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || '').slice(0, 240), tag: d.tag || 'ox-push', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
    data: { url: d.url || '/', action: d.action || null }, actions: (d.actions || []).slice(0, 2), vibrate: d.vibrate || [80, 40, 80], renotify: !!d.renotify
  }));
});
self.addEventListener('notificationclick', (e) => {
  const n = e.notification, data = n.data || {};
  n.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const action = e.action || data.action;
    if (action) {
      // Watch / lock-screen buttons: run the action in an open tab without stealing focus when possible
      if (list.length) { list.forEach((c) => c.postMessage({ type: 'OX_ACTION', action, data })); if (action === 'open' || action === 'reply') try { await list[0].focus(); } catch (err) {} return; }
      return self.clients.openWindow('/?action=' + encodeURIComponent(action));
    }
    if (list.length) { try { await list[0].focus(); } catch (err) {} list[0].postMessage({ type: 'OX_ACTION', action: 'open', data }); return; }
    return self.clients.openWindow(data.url || '/');
  })());
});

// ------------------------------------------------------------------ PWA WIDGETS (#964 — Windows 11 widgets board)
function widgetData(d) {
  return { title: 'OX-Alpha', version: VERSION, sessions: d.sessions || 0, tasks: d.tasks || 0, today: d.today || 0, last: d.last || '—', updated: d.updated || '' };
}
async function updateWidgets() {
  if (!self.widgets || !self.widgets.updateByTag) return;
  try {
    const tpl = await (await fetch('/widgets/quick.json')).text();
    await self.widgets.updateByTag('ox-quick', { template: tpl, data: JSON.stringify(widgetData(await metaGet('widget', {}))) });
  } catch (e) { /* widgets host unavailable */ }
}
self.addEventListener('widgetinstall', (e) => e.waitUntil(updateWidgets()));
self.addEventListener('widgetresume', (e) => e.waitUntil(updateWidgets()));
self.addEventListener('widgetclick', (e) => {
  const a = e.action || 'open';
  e.waitUntil(self.clients.openWindow(a === 'new' ? '/?action=new' : a === 'tasks' ? '/?action=tasks' : '/'));
});
