// Keep in sync with lib/pwa/version.ts (PWA_CACHE_NAME)
const CACHE_NAME = 'illam-v14';
const OFFLINE_URL = '/offline.html';

// Only cache static, auth-independent assets.
// Do NOT include '/' or any authenticated page — the middleware may redirect
// them to /login, causing the wrong page to be served from cache.
const PRECACHE_ASSETS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/icon.svg',
];

// Allow the page to trigger immediate activation via postMessage.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Install event - precache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Precaching assets');
      // Cache assets individually to avoid failing on missing files
      const cachePromises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (error) {
          console.warn(`[SW] Failed to cache ${url}:`, error);
        }
      });
      return Promise.all(cachePromises);
    })
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never cache Next.js internal chunks — they use content-addressed names in
  // production and change constantly in development. Let the browser handle them.
  if (url.pathname.startsWith('/_next/')) {
    return;
  }

  // Never cache API requests — always go straight to the network.
  // API data is user-specific, authenticated, and changes frequently.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Handle navigation requests - Network First.
  // Never serve navigations from cache: auth middleware controls redirects, so
  // a stale cached response (e.g. the login page) would break the first load.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Handle static assets - Cache First strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
