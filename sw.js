/* GymTrack service worker — cache-first app shell for full offline use. */
const CACHE = 'gymtrack-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // let API calls (GitHub) hit the network directly
  // Stale-while-revalidate: serve from cache instantly, refresh the cache in
  // the background so app updates arrive on the next launch.
  e.respondWith(
    caches.match(e.request).then(hit => {
      const refresh = fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
