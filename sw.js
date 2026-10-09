// Service Worker for Fast Map Tile Caching in QuickPull
const CACHE_NAME = 'quickpull-map-tiles-v2';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Clear out old caches (including v1 with watermarked tiles)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// Intercept map tile fetch requests strictly
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // ONLY intercept standard OpenStreetMap tiles
    if (url.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(event.request);
                if (cached) {
                    return cached; // 0ms local disk hit on refresh
                }
                try {
                    const networkResponse = await fetch(event.request);
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (err) {
                    return cached || Response.error();
                }
            })
        );
    }
});
