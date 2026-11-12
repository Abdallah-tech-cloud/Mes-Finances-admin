/* Service worker : permet d'installer l'application et de l'ouvrir sans réseau (l'écran, pas les données).
   Il ne met en cache que les fichiers de ce site ; les comptes et les données (Supabase) ne passent jamais par lui. */
const VERSION = 'mf-v2';
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'api.js', 'app.js', 'logo.svg', 'manifest.webmanifest',
               'confidentialite.html', 'conditions.html', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  if (/^\/(auth|rest)\//.test(u.pathname)) return;   // jamais de cache pour les comptes et les données
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
