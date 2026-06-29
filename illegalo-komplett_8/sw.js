// Minimal Service Worker — nur für PWA-Installierbarkeit, kein Offline-Caching
// (damit Firebase-Daten immer live bleiben und nicht veraltet aus dem Cache kommen)
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => self.clients.claim());
self.addEventListener("fetch", e => {
  // Passthrough — einfach normal aus dem Netz laden, kein Caching
});

// Klick auf eine Push-Notification → richtigen Tab fokussieren oder neu öffnen
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
