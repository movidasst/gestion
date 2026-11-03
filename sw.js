/* Gestión SST PWA: solo caché de recursos públicos. Nunca guardar sesiones ni datos administrativos. */
const STATIC_CACHE = 'gestion-pwa-public-v1';
const PREFIX = 'gestion-pwa-public-';
const PUBLIC_FILES = [
  '/offline.html',
  '/assets/logo-oficial-movida-sst-plus.png',
  '/assets/gestion-icon-192.png',
  '/assets/gestion-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(PUBLIC_FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== STATIC_CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Nunca cachear HTML de administración ni respuestas de autenticación.
  event.respondWith(fetch(req).catch(async () => {
    const fallback = await caches.match('/offline.html');
    return fallback || new Response('Sin conexión. Vuelve a conectarte para acceder a Gestión.', {
      status: 503,
      headers: {'Content-Type': 'text/plain; charset=utf-8'}
    });
  }));
});
