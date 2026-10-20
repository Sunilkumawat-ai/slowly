/* Slowly - sw.js: offline shell + share target */
const VERSION = "slowly-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("slowly-v") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function handleShare(req) {
  const form = await req.formData();
  let text = (form.get("text") || "").toString();
  const file = form.get("file");
  if (file && typeof file !== "string") { try { text = await file.text(); } catch {} }
  const c = await caches.open("slowly-share");
  await c.put("shared-text", new Response(text));
  return Response.redirect("./?shared=file", 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== "GET") return;

  /* the AI engine files from the CDN: cache them so the app can start offline */
  if (/(^|\.)(esm\.run|jsdelivr\.net)$/.test(url.hostname)) {
    e.respondWith(caches.open("slowly-cdn").then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()).catch(() => {}); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  /* our own files: network first so updates arrive, cache as the offline fallback */
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./")))
    );
  }
});
