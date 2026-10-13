const APP_CACHE = "points-card-shell-v2";
const APP_FILES = [
  "/", "/index.html", "/styles.css", "/android.js", "/app.js", "/pwa.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("points-card-shell-") && name !== APP_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Course data always uses the live API; offline changes are queued in app.js.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode !== "navigate" && !APP_FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    try {
      const response = await fetch(event.request);
      if (!response.ok) throw new Error("App resource unavailable");
      if (event.request.mode === "navigate") {
        await cache.put("/", response.clone());
      } else {
        await cache.put(url.pathname, response.clone());
      }
      return response;
    } catch {
      const saved = await cache.match(event.request.mode === "navigate" ? "/" : url.pathname);
      return saved || Response.error();
    }
  })());
});
