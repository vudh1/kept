/* Kept app shell only. Private household data is never added to the SW cache. */
const CACHE = "kept-shell-v6";
const ASSETS = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./icons/icon.svg", "./lib/catalog.js", "./lib/catalog-extensions.js", "./lib/store.js", "./lib/schedules.js", "./lib/crypto.js", "./lib/sync.js"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !ASSETS.some(path => new URL(path, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request)));
});
self.addEventListener("push", event => {
  // Future VAPID sender integration; never display sensitive maintenance descriptions as cleartext.
  const title = "kept.";
  event.waitUntil(self.registration.showNotification(title, { body: "Your household has an update.", icon: "./icons/icon-192.png", tag: "kept-update" }));
});
self.addEventListener("notificationclick", event => { event.notification.close(); event.waitUntil(self.clients.openWindow("./")); });
