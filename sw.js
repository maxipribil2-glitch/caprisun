// Minimal Service Worker — nur für PWA-Installierbarkeit, kein Offline-Caching
// (damit Firebase-Daten immer live bleiben und nicht veraltet aus dem Cache kommen)
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => self.clients.claim());
self.addEventListener("fetch", e => {
  // Passthrough — einfach normal aus dem Netz laden, kein Caching
});
