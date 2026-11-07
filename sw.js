/* ==========================================================================
   ComicVault service worker
   Makes the site installable ("Add to Home Screen") and shows saved copies
   of pages when there's no internet. It ALWAYS tries the network first, so
   while online you never get out-of-date files.
   Only registered on the live https site (see common.js).
   ========================================================================== */

const CACHE = "comicvault-v1";
const PRECACHE = ["./", "index.html", "css/styles.css", "common.js", "assets/icon-192.png"];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline - ComicVault</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;text-align:center;
font-family:system-ui,sans-serif;background:#0e0e11;color:#f2f1ee}p{color:#b4b3bc}</style></head>
<body><main><h1>You're offline</h1><p>Connect to the internet and try again.</p></main></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  // Only this site's own files. Supabase data/images and CDNs go straight to the network.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
        if (cached) return cached;
        if (request.mode === "navigate") {
          return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        return Response.error();
      })
  );
});
