// Service worker mínimo: sirve la "cáscara" de la app desde la caché y la renueva en segundo plano. Nunca toca /api, /ws ni nada con datos.
const CACHE = "jarvis-shell-v24";
const CACHE_WAKE = "jarvis-wake-v1"; // wasm y modelos de "Hey Jarvis": la llena js/wake/worker.js y no cambia con la versión
const SHELL = ["/", "/m", "/css/hud.css", "/css/movil.css", "/css/pro.css", "/css/envivo.css", "/estudio", "/css/estudio.css", "/js/estudio.js", "/js/pro.js", "/js/pro-web.js", "/js/movil-pro.js", "/js/vista.js", "/js/movil.js", "/js/musica.js", "/js/juegos.js", "/js/nav.js", "/js/envivo.js", "/js/chats.js", "/js/estudiar.js", "/js/secciones.js", "/js/acciones-pc.js", "/js/bandeja.js", "/js/freno.js", "/js/registro.js", "/js/rutinas.js", "/js/repaso.js", "/js/memoria.js", "/js/main.js", "/js/api.js", "/js/sesion.js", "/js/ws.js", "/js/state.js", "/js/orb.js", "/js/voice.js", "/js/voz-ui.js", "/js/wake/escucha-m.js", "/js/wake/maquina.js", "/js/wake/worker.js", "/js/wake/worklet.js", "/js/wake/detector.js", "/js/panels.js", "/icon.svg", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== CACHE_WAKE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
// Solo se atienden las rutas de SHELL (archivos fijos); todo lo demás va directo a la red, sin guardarse.
// Se responde con la copia y se pide la nueva en segundo plano. Un error o un 404 no pisan la copia:
// así una página vieja sigue encontrando sus archivos hasta que una versión nueva cambie CACHE.
const EN_SHELL = new Set(SHELL);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !EN_SHELL.has(u.pathname)) return;
  const cache = caches.open(CACHE);
  const copia = cache.then((c) => c.match(u.pathname));
  const red = copia.then(async () => {
    const r = await fetch(u.pathname, { cache: "no-cache" });
    if (r.ok && !r.redirected) await (await cache).put(u.pathname, r.clone());
    return r;
  });
  e.waitUntil(red.catch(() => {}));
  e.respondWith(copia.then((c) => c || red));
});
