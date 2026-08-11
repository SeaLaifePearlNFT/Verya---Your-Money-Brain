/* ══════════════════════════════════════════════════════════════════════
   Veyra service worker — app-shell caching for instant + offline loads.
   Saved budget data lives in localStorage and is NOT touched here.

   DEPLOY NOTE: bump SW_VERSION whenever any CSS/JS/HTML asset changes.
   A changed version installs a fresh cache, purges the old one, and takes
   control immediately (skipWaiting + clients.claim) — so every client picks
   up the new build on their next load with no manual hard-refresh.
   ────────────────────────────────────────────────────────────────────── */
const SW_VERSION = 'v8';
const CACHE_NAME = 'veyra-shell-' + SW_VERSION;

const CORE_ASSETS = [
  'index.html',
  'app.html',
  'styles/main.css',
  'styles/smart-insights.css',
  'styles/user-guide.css',
  'styles/overview-spacing.css',
  'styles/landing.css',
  'js/data/brand-config.js',
  'js/vendor/lz-string.min.js',
  'js/ui/theme-toggle.js',
  'js/core/app.js',
  'js/core/card-visibility.js',
  'js/data/durability.js',
  'js/features/usage-tab.js',
  'js/features/achievements.js',
  'js/features/smart-insights-bridge.js',
  'js/data/brand-runtime.js',
  'js/features/csv-import.js',
  'js/features/user-guide.js',
  'js/features/multi-account-cc.js',
  'js/core/nav-status-indicators.js',
  'js/ui/modal-manager.js',
  'js/ui/layout-shell.js',
  'js/features/smart-insights-engine.js',
  'js/features/smart-insights-workspace.js',
  'assets/veyra-logo.svg'
];

// Install: pre-cache the shell (resilient — one missing file won't abort the rest).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// Activate: drop old versioned caches, take control of open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('veyra-shell-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google's API/auth endpoints must NEVER be touched by this service
  // worker — not cached, not intercepted, not even looked at. These are
  // authenticated, time-sensitive calls (sign-in, Drive reads/writes,
  // the Picker); caching a response here — even briefly, even a failed
  // one — can serve stale or wrong data (or a stale ERROR) indefinitely,
  // since the cross-origin branch below caches regardless of status code.
  // Letting the fetch event pass through untouched (no respondWith call)
  // means the browser handles it completely normally, exactly as if this
  // service worker didn't exist for these requests.
  if (
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'accounts.google.com' ||
    url.hostname === 'apis.google.com' ||
    url.hostname === 'oauth2.googleapis.com' ||
    url.hostname === 'docs.google.com' ||
    url.hostname === 'content.googleapis.com'
  ) {
    return;
  }

  // Page navigations (app.html / index.html): network-first so the latest page
  // wins when online; fall back to cache when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('app.html')))
    );
    return;
  }

  // Same-origin assets (CSS / JS / images): stale-while-revalidate — serve from
  // cache instantly, refresh the cache in the background for next time.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (e.g. Google Fonts): cache-first, cache opportunistically.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
