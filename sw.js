// A simple Service Worker to cache files and allow offline installation
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open('numbattle-store').then((cache) => cache.addAll([
            './index.html',
            './style.css',
            './script.js',
            './manifest.json'
        ]))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
