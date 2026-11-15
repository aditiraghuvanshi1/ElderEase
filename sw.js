// Network-first so updates always arrive; falls back to the cached copy when offline.
const CACHE = 'elderease-v5';
const ASSETS = ['index.html', 'adult.html', 'adult-request.html', 'adult-health.html', 'adult-summary.html', 'helper.html',
    'styles.css', 'auth.js', 'login.js', 'app.js', 'features.js', 'i18n.js', 'healthdata.js', 'health.js', 'summary.js', 'care.html', 'care.js', 'elder-sync.js', 'reset.html', 'reset.js',
    'manifest.json', 'icon-192.png', 'icon-512.png',
    'fonts/newsreader-latin-opsz-normal.woff2', 'fonts/newsreader-latin-opsz-italic.woff2',
    'fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-latin-700-normal.woff2',
    'fonts/atkinson-hyperlegible-latin-400-italic.woff2'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const req = e.request;
    const url = new URL(req.url);
    // never cache the API: it carries private health data and must not outlive a logout
    if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    e.respondWith(
        fetch(req).then(res => {
            // only keep good, same-origin copies of the app's own files
            if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
            return res;
        }).catch(() => caches.match(req, { ignoreSearch: true }).then(m => m || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
    );
});
