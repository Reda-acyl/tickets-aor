const VERSION = 'aor-tickets-v3';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'export.js', 'manifest.webmanifest',
  'lib/exceljs.min.js', 'lib/jspdf.umd.min.js', 'lib/carlito-Regular.js', 'lib/carlito-Bold.js',
  'fonts/Carlito-Regular.ttf', 'fonts/Carlito-Bold.ttf', 'img/logo.jpg', 'img/entete.jpg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true})));
});
