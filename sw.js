/* GymTrack service worker — cache-first app shell for full offline use. */
// Bump on EVERY release. The browser only installs a new worker when sw.js itself
// changes byte-for-byte, so shipping app.js/styles.css without touching this file
// means no 'updatefound', no update banner, and users sit on the old cache.
const CACHE = 'gymtrack-i18n-d3fc9614ed0f0d5c9963';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './workout-model.js',
  './demo-data.js',
  './demo.js',
  './exercise-library.js',
  './i18n.js',
  './exercises.js',
  './locales/catalog.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  // No skipWaiting() here — the new worker stays in "waiting" until the page
  // asks it to activate (see the update banner in app.js), so users get an
  // explicit "update available" prompt instead of a silent second-open update.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('gymtrack-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // sync API calls go directly to the network
  // The Settings "Check for updates" probe compares the live file against the cached
  // one, so it must reach the network and must not leave a ?fresh= entry behind.
  if (url.searchParams.has('fresh')) return;
  // Installed shell assets are immutable until the user activates the next
  // worker. Revalidating individual files can mix old code with new keys.
  const asset = ASSETS.find(path => new URL(path, self.registration.scope).pathname === url.pathname);
  if (!asset) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(new URL(asset, self.registration.scope).href);
    return hit || fetch(e.request);
  }));
});
