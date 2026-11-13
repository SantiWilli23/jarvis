// Service worker mínimo: guarda la "cáscara" de la app para que abra rápido. Nunca toca /api ni /ws.
const CACHE = "jarvis-shell-v4";
const SHELL = ["/", "/m", "/css/hud.css", "/css/movil.css", "/js/movil.js", "/js/main.js", "/js/api.js", "/js/ws.js", "/js/state.js", "/js/orb.js", "/js/voice.js", "/js/panels.js", "/icon.svg", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api") || u.pathname === "/health" || u.pathname === "/ws") return;
  // Red primero; si no hay red, la copia guardada.
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
