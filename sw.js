// Service worker för Ringenäs Tränare.
// Nätet först: finns det täckning hämtas alltid senaste versionen av appen.
// Är nätet segt eller borta (vanligt ute på rangen) visas den sparade kopian direkt,
// och den nya versionen hämtas i bakgrunden till nästa gång.
// Resultat och topplistor (Supabase) sparas ALDRIG här – de hämtas alltid live.
const CACHE = "ringenas-v2";
const TIMEOUT_MS = 3500;
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png"];
// Filer som aldrig ändras (versionsnummer i adressen) – får användas direkt från cachen.
const IMMUTABLE = [/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[\d.]+\//, /^https:\/\/fonts\.gstatic\.com\//];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function save(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

async function networkFirst(req) {
  const cacheKey = req.mode === "navigate" ? "./" : req;
  const net = fetch(req).then(res => save(cacheKey, res));
  const cached = await caches.match(cacheKey);
  if (!cached) return net;
  // Vänta på nätet en stund; går det för långsamt visas den sparade kopian.
  const slow = new Promise(r => setTimeout(() => r(cached), TIMEOUT_MS));
  try { return await Promise.race([net, slow]); } catch (err) { return cached; }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  return cached || fetch(req).then(res => save(req, res));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith(".supabase.co")) return; // live-data: aldrig cache
  if (IMMUTABLE.some(r => r.test(req.url))) { e.respondWith(cacheFirst(req)); return; }
  if (url.origin === location.origin || url.hostname === "fonts.googleapis.com") {
    e.respondWith(networkFirst(req));
  }
});
