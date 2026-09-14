const CACHE = "orbita-v3";
const ASSETS = ["./", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./icon-maskable.png", "./apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => null)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put("./", copy)).catch(() => null);
      return r;
    }).catch(() => caches.match("./").then(r => r || caches.match(req))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r && r.status === 200) {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => null);
    }
    return r;
  }).catch(() => caches.match("./"))));
});
