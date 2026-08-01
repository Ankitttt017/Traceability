const CACHE_NAME = "traceability-mes-shell-v2";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/analysis.png", "/No-Internet.avif"];
const MANIFEST_FALLBACK = {
  name: "Traceability System",
  short_name: "Traceability",
  description: "Manufacturing Traceability Application",
  start_url: "/operator-view",
  display: "standalone",
  background_color: "#0f172a",
  theme_color: "#0f172a",
  lang: "en",
  scope: "/",
  icons: [
    { src: "/analysis.png", sizes: "192x192", type: "image/png" },
    { src: "/analysis.png", sizes: "512x512", type: "image/png" },
    { src: "/analysis.png", sizes: "512x512", type: "image/png", purpose: "maskable any" },
  ],
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) {
    return;
  }
  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) =>
            cached ||
            new Response(JSON.stringify(MANIFEST_FALLBACK), {
              headers: { "Content-Type": "application/manifest+json" },
            })
          )
        )
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});
