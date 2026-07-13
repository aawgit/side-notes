// ── sw.js ── service worker (PWA app-shell cache + offline support) ─────────────
//
// Keeps the app installable and usable offline.
// All sync logic runs in the main thread — this worker only caches static assets.

const CACHE = 'side-notes-v2';

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
    './firefox-extension/icons/favicon.png',
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
    // Never intercept Dropbox API requests — they must hit the network.
    const { hostname } = new URL(e.request.url);
    if (hostname.endsWith('dropbox.com') || hostname.endsWith('dropboxapi.com')) return;

    // Cache-first for app-shell assets, network fallback for everything else.
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
