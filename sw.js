// ── sw.js ── service worker (PWA app-shell cache + offline support) ─────────────
//
// Keeps the app installable and usable offline.
// All sync logic runs in the main thread — this worker only caches static assets.

const CACHE = 'side-notes-v4';

const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './manifest.json',
    './firefox-extension/sidebar.js',
    './firefox-extension/lib/store.js',
    './firefox-extension/lib/merge.js',
    './firefox-extension/lib/dropbox.js',
    './firefox-extension/lib/sync.js',
    './firefox-extension/icons/favicon-32x32.png',
    './firefox-extension/icons/favicon-192x192.png',
    './firefox-extension/icons/favicon-512x512.png',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    // Never intercept Dropbox API requests — they must hit the network.
    const { hostname } = new URL(e.request.url);
    if (hostname.endsWith('dropbox.com') || hostname.endsWith('dropboxapi.com')) return;

    const reqUrl = new URL(e.request.url);
    const sameOrigin = reqUrl.origin === self.location.origin;

    // For top-level page navigations, try network first so new deployments show up,
    // then fall back to cached HTML when offline.
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put('./index.html', copy));
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Keep fast cache hits for same-origin app assets, and refresh in background.
    if (sameOrigin) {
        e.respondWith((async () => {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(e.request);

            const networkUpdate = fetch(e.request)
                .then((response) => {
                    if (response && response.ok) {
                        cache.put(e.request, response.clone());
                    }
                    return response;
                })
                .catch(() => null);

            if (cached) {
                e.waitUntil(networkUpdate);
                return cached;
            }

            const fresh = await networkUpdate;
            if (fresh) return fresh;

            return caches.match(e.request);
        })());
        return;
    }

    // For cross-origin requests, keep default network behavior with cache fallback.
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
