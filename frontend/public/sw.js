/* Minimal service worker — installability + Web Push for tee-time alerts. */
const CACHE = 'tt-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/app/', '/app/manifest.webmanifest']).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept the web manifest — a HTML fallback here causes
  // "Manifest: Line: 1, column: 1, Syntax error."
  if (url.pathname.endsWith('manifest.webmanifest') || req.destination === 'manifest') {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((cache) => cache.put('/app/', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/app/').then((cached) => cached || caches.match('/app/index.html'))),
    );
    return;
  }

  if (url.pathname.startsWith('/app/')) {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => caches.match(req)),
    );
  }
});

function parsePushData(event) {
  try {
    if (!event.data) return null;
    const text = event.data.text();
    try {
      return JSON.parse(text);
    } catch {
      return { title: 'Tee-Time', body: text, url: '/app/' };
    }
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const data = parsePushData(event) || {
    title: 'Tee-Time',
    body: 'A matching tee time just opened.',
    url: '/app/',
  };
  const title = data.title || 'Tee-Time';
  const options = {
    body: data.body || '',
    icon: '/app/icons/icon-192.png',
    badge: '/app/icons/icon-192.png',
    data: { url: data.url || '/app/' },
    tag: data.tag || 'tee-time-alert',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification?.data?.url || '/app/';
  const target = new URL(raw, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client && client.url.startsWith(self.location.origin)) {
          void client.navigate?.(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
