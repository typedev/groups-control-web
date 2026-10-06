// Service worker: lets the app start without a network once it has run.
// Registered by src/main.tsx in production builds only.
//
// Immutable files (Pyodide of the pinned version from jsDelivr, hashed
// assets, versioned wheels) are served from the cache first. Everything
// else of our own (index.html, wheels/manifest.json) goes to the network
// first, so a new release is picked up at once; the cache is the fallback.
// The cache name carries the Pyodide version: an upgrade drops the old one.

const PYODIDE = new URL(self.location.href).searchParams.get('pyodide') || 'unknown'
const CACHE = `groups-control-pyodide-${PYODIDE}`

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('groups-control-') && name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

function immutable(url) {
  if (url.hostname === 'cdn.jsdelivr.net') return url.pathname.startsWith(`/pyodide/v${PYODIDE}/`)
  if (url.origin !== self.location.origin) return false
  return url.pathname.includes('/assets/') || (url.pathname.includes('/wheels/') && url.pathname.endsWith('.whl'))
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (err) {
    const hit = await cache.match(request)
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (immutable(url)) event.respondWith(cacheFirst(request))
  else if (url.origin === self.location.origin) event.respondWith(networkFirst(request))
})
