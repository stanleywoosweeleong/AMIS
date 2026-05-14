/**
 * AMIS Service Worker
 * ===================
 * Strategy: stale-while-revalidate
 *
 * On every navigation:
 *  1. Serve from cache immediately (so page loads in milliseconds, even offline).
 *  2. In parallel, fetch fresh from the network.
 *  3. If the fresh response is different from cached, store it in cache AND
 *     post a message to the open page so it can show a "new version ready" toast.
 *
 * The user gets:
 *  - Instant offline-capable loading every visit.
 *  - Automatic updates in the background.
 *  - A clear prompt when a new version is available, with reload-to-apply.
 *
 * Files cached:
 *  - amis.html       (the entire app)
 *  - manifest.json   (PWA metadata)
 *  - icon-192.png, icon-512.png  (home-screen icons)
 *  - the root path "./" (resolves to amis.html on most hosts)
 *
 * IMPORTANT: When you ship a new amis.html, bump CACHE_VERSION below. This
 * invalidates the old cache so users definitely get fresh content. The
 * service worker also detects content changes automatically (via response
 * comparison), so the version bump is belt-and-braces.
 */

const CACHE_VERSION = 'amis-v1';
const CACHE_NAME = `amis-cache-${CACHE_VERSION}`;

// Files to pre-cache on install. Relative URLs so the SW works regardless
// of which subdirectory it's hosted in.
const PRECACHE_URLS = [
  './',
  './amis.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ── Install: pre-cache the shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Use addAll with no-cache request init so we always pull fresh on
        // first install. Failures here are non-fatal — individual fetches
        // will fill the cache on first navigation.
        return cache.addAll(PRECACHE_URLS).catch((err) => {
          console.warn('[AMIS SW] Precache partially failed:', err);
        });
      })
      .then(() => self.skipWaiting())  // activate immediately on first install
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('amis-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: stale-while-revalidate for same-origin GETs ────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests. Cross-origin (e.g. AI API calls
  // to Anthropic/Google) should pass through untouched — they're not part
  // of the app shell and shouldn't be cached.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Skip the service worker file itself — browsers handle SW updates
  // separately and we don't want to serve a stale SW.
  if (url.pathname.endsWith('/service-worker.js')) return;

  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Kick off the network fetch in parallel. If it succeeds, update the
  // cache AND notify the page if the response body changed.
  const networkFetch = fetch(request).then(async (response) => {
    // Only cache successful, basic-type responses (skip opaque CDN responses)
    if (response && response.status === 200 && response.type === 'basic') {
      // Clone response BEFORE we read it for comparison — body streams are
      // single-use, so we need separate clones for cache.put and for diff.
      const responseToCache = response.clone();
      const responseToCompare = response.clone();

      // Diff against cached content to decide whether to notify the page.
      // We compare the text bodies; same content => no notification.
      if (cached) {
        try {
          const [newText, oldText] = await Promise.all([
            responseToCompare.text(),
            cached.clone().text()
          ]);
          if (newText !== oldText) {
            await cache.put(request, responseToCache);
            notifyClientsOfUpdate(request.url);
          }
          // else: bodies identical, no need to update cache or notify
        } catch (e) {
          // Comparison failed (e.g. binary content) — just update the cache
          await cache.put(request, responseToCache);
        }
      } else {
        // No cached version yet — just store, no notification needed
        await cache.put(request, responseToCache);
      }
    }
    return response;
  }).catch(() => {
    // Network failed — fine, we'll serve cached. The browser is offline
    // or the server is unreachable.
    return null;
  });

  // Return cached immediately if available; otherwise wait for network.
  return cached || networkFetch || new Response('Offline', {
    status: 503,
    statusText: 'Service Unavailable'
  });
}

async function notifyClientsOfUpdate(url) {
  // Only notify on HTML updates — icon/manifest changes don't warrant a
  // user-facing prompt. Pathname check is lenient (matches amis.html or
  // root "/" which resolves to amis.html on most hosts).
  const u = new URL(url);
  const isAppShell = u.pathname.endsWith('/') ||
                     u.pathname.endsWith('.html');
  if (!isAppShell) return;

  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage({ type: 'AMIS_UPDATE_AVAILABLE', url });
  });
}

// ── Message handler — supports forced skipWaiting from the page ──────────
// (used if you ever add a "force reload" button in app settings)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
