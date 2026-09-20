/* Yetflix service worker — instant repeat loads, offline-friendly
 *   image.tmdb.org  → cache-first (LRU ~400 entries)
 *   /api/tmdb/* and api.themoviedb.org → stale-while-revalidate
 * Everything else passes straight through. */
const VERSION = "yetflix-v2";
const IMG_CACHE = `${VERSION}-img`;
const API_CACHE = `${VERSION}-api`;
const IMG_LIMIT = 250;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  )
);

async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin && url.hostname !== "image.tmdb.org" && url.hostname !== "api.themoviedb.org")
    return;

  /* TMDB images: cache-first */
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMG_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) {
            cache.put(req, res.clone());
            trim(cache, IMG_LIMIT);
          }
          return res;
        } catch {
          return hit || Response.error();
        }
      })()
    );
    return;
  }

  /* TMDB API (proxy or direct): stale-while-revalidate */
  if (url.pathname.startsWith("/api/tmdb/") || url.hostname === "api.themoviedb.org") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        const hit = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return hit || (await refresh) || new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      })()
    );
  }
});
