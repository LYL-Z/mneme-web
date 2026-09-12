/* ΜΝΗΜΗ service worker
 * 缓存：带哈希 /assets + 带 X-Mneme-Cache: public 的公开正文。
 * 绝不缓存私密层、绝密正文、检索、队列、口令页。
 */
const ASSET = 'mneme-assets-v3';
const DOCS = 'mneme-docs-v1';
const DOC_MAX = 48;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const c = await caches.open(ASSET);
    await c.addAll(['/offline.html']).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([ASSET, DOCS]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

const isPrivateDocUrl = (url) => {
  let p = '';
  try { p = decodeURIComponent(url.pathname); } catch { p = url.pathname; }
  return /私人资料|(^|\/)隐私\//.test(p);
};

const trimDocs = async (cache) => {
  const keys = await cache.keys();
  if (keys.length <= DOC_MAX) return;
  await Promise.all(keys.slice(0, keys.length - DOC_MAX).map(k => cache.delete(k)));
};

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'mneme-purge-docs') {
    event.waitUntil(caches.delete(DOCS));
    return;
  }
  if (data.type === 'mneme-forget-doc' && data.path) {
    event.waitUntil((async () => {
      const cache = await caches.open(DOCS);
      const keys = await cache.keys();
      const needle = encodeURI(String(data.path));
      await Promise.all(keys.filter(k => k.url.includes(needle)).map(k => cache.delete(k)));
    })());
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/doc/')) {
    if (isPrivateDocUrl(url)) return;
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && res.headers.get('X-Mneme-Cache') === 'public') {
          const copy = res.clone();
          caches.open(DOCS).then(c => c.put(req, copy).then(() => trimDocs(c))).catch(() => {});
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw new Error('offline');
      }
    })());
    return;
  }

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
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSET).then(c => c.put('/index.html', copy)).catch(() => {});
        }
        return res;
      } catch {
        const shell = await caches.match('/index.html') || await caches.match('/');
        if (shell) return shell;
        return (await caches.match('/offline.html')) || Response.error();
      }
    })());
  }
});
