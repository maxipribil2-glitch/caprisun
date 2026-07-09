// MAP — Service Worker. Cached die Solo-Arcade-Spiele (Snake, Breakout) für offline play.
// Alle anderen Seiten (Admin, Shop, Gamecenter Multiplayer) laufen immer live — kein Caching
// damit Firebase-Daten nie veraltet aus dem Cache kommen. Solo-Games brauchen kein Firebase.

const CACHE_NAME = "illegalo-arcade-v2";
const ARCADE_ASSETS = [
  "./snake.html",
  "./snake.js",
  "./breakout.html",
  "./breakout.js",
  "./style.css",
  "./sfx.js",
  "./ads.js",
  "./firebase-config.js",
  "./maintenance.js",
  "./i18n.js",
];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ARCADE_ASSETS).catch(() => {}))
  );
});

self.addEventListener("activate", e => {
  self.clients.claim();
  // alte Cache-Versionen löschen
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Nur die gecachten Arcade-Files aus dem Cache servieren — alles andere network-first
  const isCached = ARCADE_ASSETS.some(a => url.pathname.endsWith(a.replace("./", "")));
  if (!isCached) return; // passthrough für Firebase, Admin, Multiplayer etc.

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Cache-first für Arcade-Assets, im Hintergrund updaten
      if (cached) {
        // Hintergrund-Update
        fetch(e.request).then(res => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      // Kein Cache: network
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

// Push-Notification Klick → richtigen Tab fokussieren
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientsArr => {
      for (const client of clientsArr) {
        if (client.url.includes(targetUrl) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
