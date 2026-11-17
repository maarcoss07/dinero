const APP = 'finanzas-app-v6';   // archivos propios (sube el número al cambiar código)
const EXT = 'finanzas-ext-v1';   // librerías de CDN (versionadas, se conservan entre actualizaciones)

const SHELL = ['index.html', 'app.js', 'firebase-config.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const EXTERNAL = [
  FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js',
  'https://cdn.tailwindcss.com/',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css'
];
const EXT_HOSTS = ['www.gstatic.com', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const LIVE_API = /(firestore|identitytoolkit|securetoken)\.googleapis\.com$/; // datos: nunca a caché

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const cacheable = r => r && (r.ok || r.type === 'opaque');

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP), ext = await caches.open(EXT);
    // Cada recurso por separado: si uno falla, la instalación NO se aborta
    await Promise.all([
      ...SHELL.map(u => app.add(new Request(u, { cache: 'reload' })).catch(() => {})),
      ...EXTERNAL.map(u => ext.match(u).then(hit => hit || fetch(u).then(r => cacheable(r) && ext.put(u, r))).catch(() => {}))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== APP && k !== EXT) await caches.delete(k);
    await self.clients.claim();
  })());
});

// CDN: Stale-While-Revalidate (devuelve la caché al instante y actualiza en segundo plano)
async function staleWhileRevalidate(e) {
  const cache = await caches.open(EXT), cached = await cache.match(e.request);
  const update = fetch(e.request).then(r => { if (cacheable(r)) cache.put(e.request, r.clone()); return r; }).catch(() => null);
  if (cached) { e.waitUntil(update); return cached; }
  return (await update) || Response.error();   // sin caché ni red: error limpio, nunca HTML disfrazado de JS
}

// Archivos propios: Network First con timeout de 4 s y respaldo en caché
async function networkFirst(e) {
  const req = e.request, nav = req.mode === 'navigate', cache = await caches.open(APP);
  try {
    const r = await withTimeout(fetch(req), 4000);
    if (r.ok) cache.put(nav ? 'index.html' : req, r.clone());
    return r;
  } catch {
    const hit = await cache.match(nav ? 'index.html' : req, { ignoreSearch: true });
    // index.html solo como respaldo de NAVEGACIONES (antes se servía también a los import de JS y rompía el módulo)
    return hit || Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (LIVE_API.test(url.hostname)) return;
  if (EXT_HOSTS.includes(url.hostname)) return e.respondWith(staleWhileRevalidate(e));
  if (url.origin === location.origin) return e.respondWith(networkFirst(e));
});
