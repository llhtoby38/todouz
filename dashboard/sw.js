// todouz service worker — offline app shell.
// Strategy: NETWORK-FIRST for every GET (so online users always get fresh code —
// no stale-JS lock-in), falling back to the cache when the network is unavailable.
// POST /api/* is never intercepted — the app's api() layer handles offline data
// (cached reads + a replayed write queue) itself.
const CACHE = 'todouz-v1';
const SHELL = [
  '/dashboard/',
  '/dashboard/index.html',
  '/dashboard/data.jsx',
  '/dashboard/views.jsx',
  '/dashboard/drawers.jsx',
  '/dashboard/brain.jsx',
  '/dashboard/nebula.jsx',
  '/dashboard/practice.jsx',
  '/dashboard/feed.jsx',
  '/dashboard/app.jsx',
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js',
  'https://unpkg.com/@babel/standalone@7/babel.min.js',
  'https://unpkg.com/marked@12.0.0/marked.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // POST /api etc. pass straight through
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = (await caches.match('/dashboard/index.html')) || (await caches.match('/dashboard/'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

// ─── web push (reminders) ─────────────────────────────────────────────
// The server sends a JSON payload { title, body, url, tag }; show it as a
// notification. Tapping it focuses an open todouz tab (or opens one) at `url`,
// which is usually a #issue= deep-link that opens the item.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: (e.data && e.data.text && e.data.text()) || '' }; }
  const title = d.title || 'todouz';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: '/dashboard/favicon-32.png',
    badge: '/dashboard/favicon-32.png',
    data: { url: d.url || '/dashboard/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/dashboard/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/dashboard') && 'focus' in c) {
        try { if ('navigate' in c && target) await c.navigate(target); } catch {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
