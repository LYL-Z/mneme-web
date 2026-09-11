/* ΜΝΗΜΗ service worker
 * 只缓存带哈希的 /assets（JS/CSS/字体/图）。
 * 绝不缓存 /api、文档正文、检索、队列。口令页 HTML 也不进 Cache Storage。
 */
const ASSET = 'mneme-assets-v1';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const c = await caches.open(ASSET);
    await c.addAll(['/offline.html']).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== ASSET).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(ASSET).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    })());
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline.html').then(r => r || Response.error())),
    );
  }
});
