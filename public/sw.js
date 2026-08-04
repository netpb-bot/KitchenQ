/**
 * KitchenQ service worker.
 *
 * Its whole job is that the app opens on a phone with no signal instead of
 * showing the browser's error page. It is deliberately not a caching layer for
 * data: the club's session state is live, and a host acting on last night's
 * roster is worse than a host who can see they are offline.
 *
 * The rule that matters most here is navigations go to the network FIRST. The
 * classic PWA failure is a worker pinning everyone to a stale build forever,
 * and a host running last week's app during a live session is a worse outcome
 * than no offline support at all. The cache is only ever the fallback.
 *
 * Bump CACHE to retire every previous cache in one go.
 */
const CACHE = 'kitchenq-v1'
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Supabase is another origin and every one of its responses is live data.
  if (url.origin !== self.location.origin) return

  // Navigations: newest build wins, cached shell only when the network fails.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
          return response
        })
        .catch(() => caches.match(SHELL)),
    )
    return
  }

  // Built assets carry a content hash in the filename, so a hit is by
  // definition the right bytes and can be served without asking.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
