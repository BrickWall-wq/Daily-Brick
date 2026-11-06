// Daily Brick service worker: makes the app installable, lets it open without a connection,
// and shows the daily brick reminders. Live data (bricks, accounts) always comes fresh from the internet.
const CACHE = 'daily-brick-v3';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // Save each file on its own, so one missing file can never stop the helper (and the reminders) from starting.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Network first, so updates show straight away; fall back to the saved copy when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/')))
  );
});

// Daily reminder arrives from the server
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Your brick is waiting', {
    body: d.body || 'Place today\'s free brick on the wall.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'daily-brick-reminder',
    renotify: true,
    data: { url: d.url || '/#place' },
  }));
});

// Tapping the reminder opens Daily Brick on the Place screen
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/#place', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          c.postMessage({ type: 'open', hash: new URL(url).hash });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
