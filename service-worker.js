const CACHE = 'finanzas-v2';
const SHELL = ['./', 'index.html', 'app.js', 'firebase-config.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Los datos (Firestore/Auth) nunca se cachean
  if (/(firestore|identitytoolkit|securetoken)\.googleapis\.com$/.test(url.hostname)) return;
  // Interfaz: stale-while-revalidate (ignoreSearch para que ?shared=… sirva el mismo index.html)
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => {
    const net = fetch(req).then(r => {
      if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => cached || caches.match('index.html'));
    return cached || net;
  }));
});
