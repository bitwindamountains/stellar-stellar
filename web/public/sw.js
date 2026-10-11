// Minimal service worker: makes the app installable and opens offline to the last app shell.
// Only same-origin GETs are cached; Supabase API calls always go to the network.
const CACHE = 'postpilot-v2'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'postpilot-share').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Android share sheet -> PostPilot: park the file, then open the composer to pick it up.
  if (request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        const form = await request.formData()
        const file = form.get('media')
        const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n\n')
        const cache = await caches.open('postpilot-share')
        const meta = { text, name: file && file.name, type: file && file.type }
        await cache.put('/shared-meta', new Response(JSON.stringify(meta)))
        if (file) await cache.put('/shared-media', new Response(file))
        return Response.redirect('/#/new/shared', 303)
      })(),
    )
    return
  }
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  // Network first so new deploys show up at once; the cache is only the offline fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
  )
})
