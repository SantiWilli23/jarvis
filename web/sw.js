// Service worker mínimo: guarda la "cáscara" de la app para que abra rápido. Nunca toca /api ni /ws.
const CACHE = "jarvis-shell-v8";
const SHELL = ["/", "/m", "/css/hud.css", "/css/movil.css", "/css/pro.css", "/js/pro.js", "/js/vista.js", "/js/movil.js", "/js/main.js", "/js/api.js", "/js/ws.js", "/js/state.js", "/js/orb.js", "/js/voice.js", "/js/panels.js", "/icon.svg", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Web Push: aviso sin contenido privado; al tocarlo abre la aprobación pendiente en la vista móvil.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* sin datos */ }
  e.waitUntil(self.registration.showNotification(d.title || "Jarvis", { body: d.body || "Aprobación pendiente", icon: "/apple-touch-icon.png", badge: "/apple-touch-icon.png", tag: "jarvis-aprobacion", data: { approvalId: d.approvalId ?? null } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.approvalId;
  const url = "/m" + (id != null ? "#aprobacion-" + id : "");
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => new URL(x.url).pathname.startsWith("/m"));
    if (c) return c.navigate(url).then((w) => (w || c).focus()).catch(() => c.focus());
    return self.clients.openWindow(url);
  }));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api") || u.pathname === "/health" || u.pathname === "/ws") return;
  // Red primero; si no hay red, la copia guardada.
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
